import type { PriceQuoteDTO, RewardOptionDTO } from "@slotix/types";
import type { LoyaltyMember, LoyaltyProgram, Prisma } from "@prisma/client";
import { prisma } from "../../config/database";
import { env } from "../../config/env";
import { AuthorizationError, ConflictError, NotFoundError, ValidationError } from "../../shared/errors";
import { domainEvents } from "../../shared/events/domainEvents";
import { loyaltyRepository, type MemberRewardRow, type RewardRow } from "./loyalty.repository";
import { toPricingPromotion } from "./loyalty.mappers";
import { appliesToService, calculatePrice, pointsForAmount, promotionIneligibility, type PriceResult, type PricingReward } from "./loyalty.pricing";

/*
 * Onde a fidelização encontra os agendamentos. O sistema de marcações chama isto:
 *   - priceBooking + recordBookingDiscounts, dentro da transação da marcação (com o
 *     profissional bloqueado): o preço final, as vagas promocionais e a recompensa usada
 *     ficam gravados juntos com o agendamento, ou nada fica;
 *   - releaseForAppointment, quando é cancelado ou o cliente falta: vagas e recompensas
 *     voltam, os pontos gastos são devolvidos;
 *   - onAppointmentPaid, quando é pago: usos consumidos, pontos e recompensas ganhos;
 *   - onPaymentRefunded: os pontos daquele pagamento são retirados.
 * Tudo idempotente: repetir uma chamada (pedido repetido, aviso duplicado) não muda nada.
 */

type Db = Prisma.TransactionClient;
const DAY_MS = 24 * 60 * 60_000;

export interface BookingParty {
  userId: string | null;
  walkInClientId: string | null;
}

export interface BookingPricing {
  result: PriceResult;
  member: LoyaltyMember | null;
  program: LoyaltyProgram | null;
  memberReward: MemberRewardRow | null;
  pointsReward: RewardRow | null;
}

function notify(userId: string, type: string, title: string, message: string) {
  domainEvents.emitEvent("LoyaltyNotification", { userId, type, title, message, promotional: false });
}

function rewardForPricing(reward: RewardRow, key: string): PricingReward {
  return {
    key,
    label: reward.name,
    discountType: reward.discountType,
    discountValue: reward.discountValue.toNumber(),
    serviceIds: reward.services.map((service) => service.serviceId),
  };
}

async function membershipOf(db: Db, businessId: string, userId: string | null, lock: boolean) {
  if (!userId) return { member: null, program: null, isMember: false };
  const program = await loyaltyRepository.findProgram(businessId, db);
  let member = await loyaltyRepository.findMember(businessId, userId, db);
  // A client of the space has the benefits, even if no member row was made for them yet.
  if (!member && (await loyaltyRepository.isBusinessClient(db, businessId, userId))) {
    member = await loyaltyRepository.ensureMemberForClient(db, businessId, userId);
  }
  if (member && lock) member = await loyaltyRepository.lockMember(db, member.id);
  const isMember = Boolean(program?.active && member?.status === "ACTIVE");
  return { member: isMember ? member : null, program, isMember };
}

/*
 * O preço de uma marcação, calculado no servidor. Com `lock`, as promoções em causa e o
 * membro ficam bloqueados até ao fim da transação — é o que impede dois clientes de
 * gastarem ao mesmo tempo a última vaga, ou os mesmos pontos.
 */
export async function priceBooking(
  db: Db,
  input: {
    businessId: string;
    service: { id: string; price: Prisma.Decimal | number; membersOnly: boolean };
    scheduledAt: Date;
    party: BookingParty;
    // true quando o próprio cliente marca na app (só ele escolhe usar recompensas).
    selfBooking: boolean;
    memberRewardId?: string;
    pointsRewardId?: string;
    lock: boolean;
    excludeAppointmentId?: string;
    now?: Date;
  },
): Promise<BookingPricing> {
  const now = input.now ?? new Date();
  const { member, program, isMember } = await membershipOf(db, input.businessId, input.party.userId, input.lock);

  if (input.service.membersOnly && input.selfBooking && !isMember) {
    throw new AuthorizationError("Este serviço é só para clientes do espaço.", "SERVICE_MEMBERS_ONLY");
  }

  const promotionRows = input.lock
    ? await loyaltyRepository.lockApplicablePromotions(db, input.businessId, input.service.id)
    : await loyaltyRepository.applicablePromotions(db, input.businessId, input.service.id);
  const counts = await loyaltyRepository.usageCounts(
    db,
    promotionRows.map((promotion) => promotion.id),
    input.party,
    input.excludeAppointmentId,
  );
  const promotions = promotionRows.map((promotion) =>
    toPricingPromotion(promotion, counts.total.get(promotion.id) ?? 0, counts.byClient.get(promotion.id) ?? 0),
  );

  // A recompensa escolhida: validada aqui, nunca aceite só porque a app a enviou.
  let memberReward: MemberRewardRow | null = null;
  let pointsReward: RewardRow | null = null;
  let reward: PricingReward | null = null;

  if (input.memberRewardId || input.pointsRewardId) {
    if (!input.selfBooking || !member) throw new ValidationError("Só os clientes do espaço podem usar recompensas.", "LOYALTY_REWARD_NOT_ALLOWED");
    if (input.memberRewardId && input.pointsRewardId) throw new ValidationError("Escolha só uma recompensa.", "LOYALTY_ONE_REWARD");
  }

  if (input.memberRewardId && member) {
    const found = await loyaltyRepository.findMemberReward(input.memberRewardId, db);
    const valid = found && found.memberId === member.id && found.status === "AVAILABLE" && (!found.expiresAt || found.expiresAt > now);
    if (!valid) throw new ConflictError("Esta recompensa já não está disponível.", "LOYALTY_REWARD_UNAVAILABLE");
    if (!appliesToService(found.reward.services.map((service) => service.serviceId), input.service.id)) {
      throw new ValidationError("Esta recompensa não se aplica a este serviço.", "LOYALTY_REWARD_SERVICE");
    }
    memberReward = found;
    reward = rewardForPricing(found.reward, `memberReward:${found.id}`);
  }

  if (input.pointsRewardId && member) {
    const found = await loyaltyRepository.findReward(input.pointsRewardId, db);
    if (!found || found.businessId !== input.businessId || found.kind !== "POINTS" || !found.active || !found.pointsCost || !program?.pointsEnabled) {
      throw new NotFoundError("Recompensa não encontrada.", "LOYALTY_REWARD_NOT_FOUND");
    }
    if (member.pointsBalance < found.pointsCost) {
      throw new ConflictError(`Precisa de ${found.pointsCost} pontos; tem ${member.pointsBalance}.`, "LOYALTY_POINTS_INSUFFICIENT");
    }
    if (!appliesToService(found.services.map((service) => service.serviceId), input.service.id)) {
      throw new ValidationError("Esta recompensa não se aplica a este serviço.", "LOYALTY_REWARD_SERVICE");
    }
    pointsReward = found;
    reward = rewardForPricing(found, `pointsReward:${found.id}`);
  }

  const result = calculatePrice(
    { serviceId: input.service.id, basePrice: Number(input.service.price), scheduledAt: input.scheduledAt, now, isMember, timeZone: env.APP_TIMEZONE },
    promotions,
    reward,
  );
  return { result, member, program, memberReward, pointsReward };
}

// Grava, junto com o agendamento acabado de criar, de onde veio cada desconto, as vagas
// promocionais que ocupa e a recompensa que usou.
export async function recordBookingDiscounts(db: Db, appointmentId: string, pricing: BookingPricing, party: BookingParty, now = new Date()) {
  for (const discount of pricing.result.discounts) {
    if (discount.source === "PROMOTION" && discount.promotionId) {
      await loyaltyRepository.createUsage(db, {
        promotionId: discount.promotionId,
        appointmentId,
        userId: party.userId,
        walkInClientId: party.walkInClientId,
        discountAmount: discount.amount,
      });
      await loyaltyRepository.createAppointmentDiscount(db, { appointmentId, source: "PROMOTION", promotionId: discount.promotionId, label: discount.label, amount: discount.amount });
      continue;
    }

    if (discount.source === "REWARD" && pricing.member) {
      let memberRewardId: string;
      if (pricing.memberReward) {
        if (!(await loyaltyRepository.reserveMemberReward(db, pricing.memberReward.id, appointmentId, now))) {
          throw new ConflictError("Esta recompensa já não está disponível.", "LOYALTY_REWARD_UNAVAILABLE");
        }
        memberRewardId = pricing.memberReward.id;
      } else if (pricing.pointsReward?.pointsCost) {
        const bought = await loyaltyRepository.unlockReward(db, {
          memberId: pricing.member.id,
          rewardId: pricing.pointsReward.id,
          businessId: pricing.member.businessId,
          unlockKey: `points:${appointmentId}`,
          expiresAt: null,
          status: "RESERVED",
          appointmentId,
        });
        const spent = bought
          ? await loyaltyRepository.addTransaction(db, pricing.member, {
              type: "REDEEM",
              points: -pricing.pointsReward.pointsCost,
              idempotencyKey: `redeem:${appointmentId}`,
              appointmentId,
              memberRewardId: bought.id,
              reason: pricing.pointsReward.name,
            })
          : null;
        if (!bought || !spent) throw new ConflictError("Não tem pontos suficientes para esta recompensa.", "LOYALTY_POINTS_INSUFFICIENT");
        memberRewardId = bought.id;
      } else {
        continue;
      }
      await loyaltyRepository.createAppointmentDiscount(db, { appointmentId, source: "REWARD", memberRewardId, label: discount.label, amount: discount.amount });
    }
  }
}

// A pré-visualização do preço, para a app mostrar antes de confirmar (não grava nada).
export async function quote(
  userId: string,
  input: { businessId: string; serviceId: string; scheduledAt: string; memberRewardId?: string; pointsRewardId?: string },
): Promise<PriceQuoteDTO> {
  const service = await prisma.service.findUnique({ where: { id: input.serviceId } });
  if (!service || service.businessId !== input.businessId || !service.active) throw new NotFoundError("Serviço não encontrado.", "SERVICE_NOT_FOUND");

  return prisma.$transaction(async (db) => {
    const party = { userId, walkInClientId: null };
    const pricing = await priceBooking(db, {
      businessId: input.businessId,
      service,
      scheduledAt: new Date(input.scheduledAt),
      party,
      selfBooking: true,
      memberRewardId: input.memberRewardId,
      pointsRewardId: input.pointsRewardId,
      lock: false,
    }).catch(async (error) => {
      // Um serviço exclusivo continua a ter preço para mostrar; a marcação é que o recusa.
      if ((error as { code?: string }).code !== "SERVICE_MEMBERS_ONLY") throw error;
      return null;
    });

    const { member, program } = await membershipOf(db, input.businessId, userId, false);
    const rewardOptions: RewardOptionDTO[] = [];
    if (member) {
      const now = new Date();
      for (const owned of await loyaltyRepository.memberRewardsOf(member.id, ["AVAILABLE"], db)) {
        if (owned.expiresAt && owned.expiresAt <= now) continue;
        if (!appliesToService(owned.reward.services.map((s) => s.serviceId), service.id)) continue;
        rewardOptions.push({
          memberRewardId: owned.id,
          pointsRewardId: null,
          name: owned.reward.name,
          pointsCost: null,
          discountType: owned.reward.discountType,
          discountValue: owned.reward.discountValue.toNumber(),
          expiresAt: owned.expiresAt?.toISOString() ?? null,
        });
      }
      if (program?.pointsEnabled) {
        for (const reward of await loyaltyRepository.listRewards(input.businessId, true, db)) {
          if (reward.kind !== "POINTS" || !reward.pointsCost || reward.pointsCost > member.pointsBalance) continue;
          if (!appliesToService(reward.services.map((s) => s.serviceId), service.id)) continue;
          rewardOptions.push({
            memberRewardId: null,
            pointsRewardId: reward.id,
            name: reward.name,
            pointsCost: reward.pointsCost,
            discountType: reward.discountType,
            discountValue: reward.discountValue.toNumber(),
            expiresAt: null,
          });
        }
      }
    }

    const result = pricing?.result ?? { originalPrice: service.price.toNumber(), discounts: [], discountTotal: 0, finalPrice: service.price.toNumber() };
    return {
      originalPrice: result.originalPrice,
      discounts: result.discounts.map((discount) => ({ source: discount.source, label: discount.label, amount: discount.amount, promotionId: discount.promotionId ?? null })),
      discountTotal: result.discountTotal,
      finalPrice: result.finalPrice,
      isMember: Boolean(member),
      membersOnlyService: service.membersOnly,
      rewardOptions,
      pointsBalance: member ? member.pointsBalance : null,
    };
  });
}

// Ao reagendar, as promoções aplicadas têm de continuar válidas no novo horário (dia da
// semana, horas, período). Se não forem, o reagendamento é recusado — o preço não muda às escondidas.
export async function assertDiscountsValidAt(appointmentId: string, scheduledAt: Date) {
  const usages = await loyaltyRepository.usagesOfAppointment(prisma, appointmentId);
  const reserved = usages.filter((usage) => usage.status === "RESERVED");
  if (reserved.length === 0) return;

  const appointment = await prisma.appointment.findUniqueOrThrow({ where: { id: appointmentId } });
  const { isMember } = await membershipOf(prisma, appointment.businessId, appointment.clientId, false);
  const counts = await loyaltyRepository.usageCounts(
    prisma,
    reserved.map((usage) => usage.promotionId),
    { userId: appointment.clientId, walkInClientId: appointment.walkInClientId },
    appointmentId,
  );

  for (const usage of reserved) {
    const promotion = toPricingPromotion(usage.promotion, counts.total.get(usage.promotionId) ?? 0, counts.byClient.get(usage.promotionId) ?? 0);
    const reason = promotionIneligibility(promotion, {
      serviceId: appointment.serviceId,
      basePrice: 0,
      scheduledAt,
      now: new Date(),
      isMember,
      timeZone: env.APP_TIMEZONE,
    });
    // Os limites de usos não contam: a vaga já é deste agendamento.
    if (reason && reason !== "SOLD_OUT" && reason !== "CLIENT_LIMIT" && reason !== "ENDED") {
      throw new ConflictError(
        `A promoção "${usage.promotion.name}" não é válida no novo horário. Escolha um horário dentro das condições da promoção, ou cancele e marque de novo.`,
        "PROMOTION_NOT_VALID_AT_NEW_TIME",
      );
    }
  }
}

// Cancelado ou não compareceu: as vagas promocionais voltam à campanha (se a campanha o
// prevê), as recompensas voltam ao membro e os pontos gastos são devolvidos.
export async function releaseForAppointment(appointmentId: string, inTransaction?: Db) {
  const release = async (db: Db) => {
    const usages = await loyaltyRepository.usagesOfAppointment(db, appointmentId);
    const releasable = usages.filter((usage) => usage.status === "RESERVED" && usage.promotion.releaseOnCancel).map((usage) => usage.promotionId);
    if (releasable.length > 0) await loyaltyRepository.setUsageStatus(db, appointmentId, "RESERVED", "RELEASED", releasable);

    const now = new Date();
    for (const held of await loyaltyRepository.reservedRewardsOf(db, appointmentId)) {
      if (!held.unlockKey.startsWith("points:")) {
        const expired = held.expiresAt !== null && held.expiresAt <= now;
        await loyaltyRepository.updateMemberReward(db, held.id, { status: expired ? "EXPIRED" : "AVAILABLE", appointmentId: null });
        continue;
      }
      await loyaltyRepository.updateMemberReward(db, held.id, { status: "CANCELLED" });
      const redeemed = await loyaltyRepository.findTransactionByKey(db, `redeem:${appointmentId}`);
      if (!redeemed) continue;
      const member = await loyaltyRepository.lockMember(db, held.memberId);
      await loyaltyRepository.addTransaction(db, member, {
        type: "REFUND",
        points: -redeemed.points,
        idempotencyKey: `refund:${appointmentId}`,
        appointmentId,
        memberRewardId: held.id,
        reason: "Agendamento cancelado: pontos devolvidos",
      });
    }
  };
  // Inside the caller's transaction when given: the status change and the release commit together.
  if (inTransaction) await release(inTransaction);
  else await prisma.$transaction(release);
}

// Pago (e por isso concluído): usos e recompensas passam a consumidos; o membro ganha os
// pontos do valor pago e as recompensas por número de serviços que acabou de completar.
export async function onAppointmentPaid(appointmentId: string) {
  const appointment = await prisma.appointment.findUnique({ where: { id: appointmentId }, include: { payment: true, business: true } });
  if (!appointment || appointment.payment?.status !== "PAID") return;

  const news: { title: string; message: string; type: string }[] = [];
  let userToTell: string | null = null;

  await prisma.$transaction(async (db) => {
    await loyaltyRepository.setUsageStatus(db, appointmentId, "RESERVED", "CONSUMED");
    for (const held of await loyaltyRepository.reservedRewardsOf(db, appointmentId)) {
      await loyaltyRepository.updateMemberReward(db, held.id, { status: "USED" });
    }

    if (!appointment.clientId) return;
    const { member: found, program } = await membershipOf(db, appointment.businessId, appointment.clientId, false);
    if (!found || !program) return;
    const member = await loyaltyRepository.lockMember(db, found.id);
    userToTell = member.userId;
    const now = new Date();

    if (program.pointsEnabled) {
      const points = pointsForAmount(appointment.payment!.amount.toNumber(), program);
      const earned =
        points > 0
          ? await loyaltyRepository.addTransaction(db, member, {
              type: "EARN",
              points,
              idempotencyKey: `earn:${appointmentId}`,
              appointmentId,
              reason: "Serviço pago",
              expiresAt: program.pointsExpireDays ? new Date(now.getTime() + program.pointsExpireDays * DAY_MS) : null,
            })
          : null;
      if (earned) {
        news.push({
          type: "LOYALTY_POINTS_EARNED",
          title: "Ganhou pontos",
          message: `Ganhou ${points} pontos em ${appointment.business.name}. Tem agora ${member.pointsBalance} pontos.`,
        });
      }
    }

    for (const reward of await loyaltyRepository.listRewards(appointment.businessId, true, db)) {
      if (reward.kind !== "VISITS" || !reward.visitsRequired) continue;
      const serviceIds = reward.services.map((service) => service.serviceId);
      const visits = await loyaltyRepository.paidVisits(appointment.businessId, member.userId, member.joinedAt, serviceIds, db);
      const earnedSoFar = Math.floor(visits / reward.visitsRequired);
      const unlocked = await loyaltyRepository.countUnlocks(db, member.id, reward.id);
      for (let n = unlocked + 1; n <= earnedSoFar; n++) {
        const created = await loyaltyRepository.unlockReward(db, {
          memberId: member.id,
          rewardId: reward.id,
          businessId: member.businessId,
          unlockKey: `visits:${reward.id}:${member.id}:${n}`,
          expiresAt: reward.validDays ? new Date(now.getTime() + reward.validDays * DAY_MS) : null,
        });
        if (created) {
          news.push({ type: "LOYALTY_REWARD_UNLOCKED", title: "Recompensa desbloqueada", message: `${appointment.business.name}: ${reward.name} já está disponível para usar.` });
        }
      }
    }
  });

  if (userToTell) for (const item of news) notify(userToTell, item.type, item.title, item.message);
}

// Pagamento reembolsado: os pontos que ele deu saem do saldo (até onde o saldo chega).
export async function onPaymentRefunded(appointmentId: string) {
  await prisma.$transaction(async (db) => {
    const earned = await loyaltyRepository.findTransactionByKey(db, `earn:${appointmentId}`);
    if (!earned) return;
    const member = await loyaltyRepository.lockMember(db, earned.memberId);
    const points = Math.min(earned.points, member.pointsBalance);
    if (points <= 0) return;
    await loyaltyRepository.addTransaction(db, member, {
      type: "REVERSAL",
      points: -points,
      idempotencyKey: `reverse:${appointmentId}`,
      appointmentId,
      reason: "Pagamento reembolsado",
    });
  });
}
