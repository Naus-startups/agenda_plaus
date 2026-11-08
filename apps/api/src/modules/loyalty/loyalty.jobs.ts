import { prisma } from "../../config/database";
import { env } from "../../config/env";
import { domainEvents } from "../../shared/events/domainEvents";
import { zonedDateKey } from "../../shared/utils/timezone";
import { loyaltyRepository } from "./loyalty.repository";
import { pointsToExpire } from "./loyalty.pricing";
import { onAppointmentPaid } from "./loyalty.booking";

/*
 * O que o relógio faz acontecer no programa de membros (nenhum pedido o dispara):
 *   - pontos fora da validade saem do saldo (os mais antigos primeiro);
 *   - recompensas por usar que passaram do prazo expiram, e quem as tem é avisado 3 dias antes;
 *   - no mês de aniversário, os membros recebem a recompensa de aniversário do espaço;
 *   - promoções cuja data de fim passou terminam.
 * Cada passo é idempotente: correr duas vezes seguidas não muda nada à segunda.
 */

const CHECK_EVERY_MS = 15 * 60_000;
const DAY_MS = 24 * 60 * 60_000;
const EXPIRY_NOTICE_MS = 3 * DAY_MS;

function notify(userId: string, type: string, title: string, message: string, promotional = false) {
  domainEvents.emitEvent("LoyaltyNotification", { userId, type, title, message, promotional });
}

export async function expirePoints(now: Date = new Date()): Promise<number> {
  let expiredMembers = 0;
  for (const { memberId } of await loyaltyRepository.membersWithExpiredEarnings(now)) {
    const expired = await prisma.$transaction(async (db) => {
      const member = await loyaltyRepository.lockMember(db, memberId);
      const totals = await loyaltyRepository.expiryTotals(db, memberId, now);
      const points = pointsToExpire({ ...totals, balance: member.pointsBalance });
      if (points <= 0) return 0;
      await loyaltyRepository.addTransaction(db, member, {
        type: "EXPIRE",
        points: -points,
        idempotencyKey: `expire:${memberId}:${now.getTime()}`,
        reason: "Pontos fora da validade",
      });
      return points;
    });
    if (expired > 0) expiredMembers++;
  }
  return expiredMembers;
}

export async function expireRewards(now: Date = new Date()) {
  const soon = await loyaltyRepository.rewardsExpiringSoon(now, new Date(now.getTime() + EXPIRY_NOTICE_MS));
  for (const held of soon) {
    const day = new Intl.DateTimeFormat("pt-PT", { timeZone: env.APP_TIMEZONE, day: "2-digit", month: "2-digit" }).format(held.expiresAt!);
    notify(held.member.userId, "LOYALTY_REWARD_EXPIRING", "Recompensa prestes a expirar", `${held.member.business.name}: "${held.reward.name}" expira a ${day}. Use-a numa marcação antes disso.`);
    await prisma.memberReward.update({ where: { id: held.id }, data: { expiryNotifiedAt: now } });
  }
  return (await loyaltyRepository.expireMemberRewards(now)).count;
}

export async function grantBirthdayRewards(now: Date = new Date()): Promise<number> {
  const [year, month] = zonedDateKey(now, env.APP_TIMEZONE).split("-").map(Number);
  // Válida até ao fim do mês de aniversário (no fuso da app, com folga de um dia).
  const endOfMonth = new Date(Date.UTC(month === 12 ? year + 1 : year, month === 12 ? 0 : month, 1) + DAY_MS / 2);

  let granted = 0;
  for (const reward of await loyaltyRepository.activeBirthdayRewards()) {
    const business = await prisma.business.findUnique({ where: { id: reward.businessId }, select: { name: true } });
    for (const member of await loyaltyRepository.birthdayMembers(reward.businessId, month)) {
      const created = await loyaltyRepository.unlockReward(prisma, {
        memberId: member.id,
        rewardId: reward.id,
        businessId: reward.businessId,
        unlockKey: `birthday:${reward.id}:${member.id}:${year}`,
        expiresAt: reward.validDays ? new Date(Math.min(now.getTime() + reward.validDays * DAY_MS, endOfMonth.getTime())) : endOfMonth,
      });
      if (!created) continue;
      granted++;
      notify(member.userId, "LOYALTY_BIRTHDAY_REWARD", "Feliz aniversário!", `${business?.name ?? "O seu espaço"} oferece-lhe: ${reward.name}. Use-a este mês.`);
    }
  }
  return granted;
}

export async function endExpiredPromotions(now: Date = new Date()): Promise<number> {
  return (await loyaltyRepository.endExpiredPromotions(now)).count;
}

// Pagamentos recentes cujo registo na fidelização possa ter falhado: repetir não duplica nada.
export async function settleRecentPayments(now: Date = new Date()) {
  const recent = await prisma.payment.findMany({
    where: { status: "PAID", paidAt: { gte: new Date(now.getTime() - 2 * DAY_MS) } },
    select: { appointmentId: true },
  });
  for (const { appointmentId } of recent) await onAppointmentPaid(appointmentId);
}

export async function runLoyaltyJobs(now: Date = new Date()) {
  await endExpiredPromotions(now);
  await settleRecentPayments(now);
  await expireRewards(now);
  await expirePoints(now);
  await grantBirthdayRewards(now);
}

export function startLoyaltyJobs(): void {
  let running = false;
  const tick = async () => {
    if (running) return;
    running = true;
    try {
      await runLoyaltyJobs();
    } catch (error) {
      console.error("Fidelização: a verificação periódica falhou, repete na próxima passagem.", error);
    } finally {
      running = false;
    }
  };
  void tick();
  setInterval(() => void tick(), CHECK_EVERY_MS).unref();
}
