import type {
  BusinessLoyaltyDTO,
  LoyaltyBenefitDTO,
  LoyaltyMemberDTO,
  LoyaltyMemberDetailDTO,
  LoyaltyOverviewDTO,
  LoyaltyProgramDTO,
  LoyaltyRewardDTO,
  MemberAreaDTO,
  MyMembershipDTO,
  NextRewardDTO,
  PromotionDTO,
  PromotionResultsDTO,
} from "@slotix/types";
import type { LoyaltyMember, LoyaltyProgram, Prisma } from "@prisma/client";
import { AuthorizationError, ConflictError, NotFoundError, ValidationError } from "../../shared/errors";
import { assertStaffOfBusiness } from "../../shared/authz";
import { domainEvents } from "../../shared/events/domainEvents";
import { assertBusinessOwner, getBusinessOrThrow } from "../businesses";
import { loyaltyRepository, type PromotionRow } from "./loyalty.repository";
import {
  discountLabel,
  toBenefitDTO,
  toMemberRewardDTO,
  toProgramDTO,
  toPromotionDTO,
  toRewardDTO,
  toTransactionDTO,
} from "./loyalty.mappers";
import type { BenefitInput, MemberStatusInput, PointsAdjustmentInput, ProgramInput, PromotionInput, RewardInput } from "./loyalty.schema";

const DAY_MS = 24 * 60 * 60_000;

/* ------------------------------------------------------------------------ */
/* Permissões                                                               */
/* ------------------------------------------------------------------------ */

// Só o dono do espaço configura o programa, os benefícios, as promoções e os pontos.
async function assertOwner(businessId: string, requesterId: string) {
  const business = await getBusinessOrThrow(businessId);
  assertBusinessOwner(business, requesterId);
  return business;
}

// Qualquer pessoa da equipa pode consultar os membros (são as pessoas que atende).
async function assertStaff(businessId: string, requesterId: string) {
  await assertStaffOfBusiness(businessId, requesterId);
}

// Uma linha de outro espaço é tratada como inexistente: nunca se revela que existe.
function assertSameBusiness<T extends { businessId: string }>(row: T | null, businessId: string, message: string, code: string): T {
  if (!row || row.businessId !== businessId) throw new NotFoundError(message, code);
  return row;
}

function notify(userId: string, type: string, title: string, message: string, promotional = false) {
  domainEvents.emitEvent("LoyaltyNotification", { userId, type, title, message, promotional });
}

async function audit(businessId: string, actorId: string, action: string, entityType: string, entityId: string | null, details?: Prisma.InputJsonValue) {
  await loyaltyRepository.audit({ businessId, actorId, action, entityType, entityId, details });
}

const toDate = (value: string | null | undefined) => (value ? new Date(value) : null);

async function assertServicesOfBusiness(businessId: string, serviceIds: string[]) {
  if (serviceIds.length === 0) return;
  const found = await loyaltyRepository.servicesOfBusiness(businessId, serviceIds);
  if (found.length !== new Set(serviceIds).size) {
    throw new ValidationError("Um dos serviços escolhidos não pertence a este espaço.", "LOYALTY_SERVICE_MISMATCH");
  }
}

async function promotionsWithCounts(promotions: PromotionRow[]): Promise<PromotionDTO[]> {
  const totals = await loyaltyRepository.promotionUsageTotals(promotions.map((promotion) => promotion.id));
  const used = new Map<string, number>();
  for (const row of totals) {
    if (row.status === "RELEASED") continue;
    used.set(row.promotionId, (used.get(row.promotionId) ?? 0) + row._count._all);
  }
  return promotions.map((promotion) => toPromotionDTO(promotion, used.get(promotion.id) ?? 0));
}

/* ------------------------------------------------------------------------ */
/* A área de membro                                                         */
/* ------------------------------------------------------------------------ */

async function nextRewardFor(member: LoyaltyMember, program: LoyaltyProgram | null): Promise<{ next: NextRewardDTO | null; visits: number }> {
  const rewards = await loyaltyRepository.listRewards(member.businessId, true);
  const visits = await loyaltyRepository.paidVisits(member.businessId, member.userId, member.joinedAt);

  const candidates: (NextRewardDTO & { distance: number })[] = [];
  for (const reward of rewards) {
    if (reward.kind === "POINTS" && reward.pointsCost && program?.pointsEnabled && reward.pointsCost > member.pointsBalance) {
      const missing = reward.pointsCost - member.pointsBalance;
      // Compara pontos com serviços pelo número de serviços que faltam para os juntar.
      const perVisit = Math.max(program.pointsPerUnit, 1);
      candidates.push({ rewardId: reward.id, name: reward.name, kind: reward.kind, pointsNeeded: missing, visitsNeeded: null, distance: missing / perVisit });
    }
    if (reward.kind === "VISITS" && reward.visitsRequired) {
      const eligible = await loyaltyRepository.paidVisits(member.businessId, member.userId, member.joinedAt, reward.services.map((service) => service.serviceId));
      const missing = reward.visitsRequired - (eligible % reward.visitsRequired);
      candidates.push({ rewardId: reward.id, name: reward.name, kind: reward.kind, pointsNeeded: null, visitsNeeded: missing, distance: missing });
    }
  }
  candidates.sort((a, b) => a.distance - b.distance);
  const next = candidates[0];
  return { next: next ? { rewardId: next.rewardId, name: next.name, kind: next.kind, pointsNeeded: next.pointsNeeded, visitsNeeded: next.visitsNeeded } : null, visits };
}

async function toMyMembership(
  member: LoyaltyMember,
  business: { id: string; name: string; logoUrl: string | null; imageUrl: string | null },
  program: LoyaltyProgram | null,
): Promise<MyMembershipDTO> {
  const [{ next, visits }, available] = await Promise.all([nextRewardFor(member, program), loyaltyRepository.memberRewardsOf(member.id, ["AVAILABLE"])]);
  return {
    id: member.id,
    businessId: business.id,
    businessName: business.name,
    businessLogoUrl: business.logoUrl ?? business.imageUrl,
    programName: program?.name ?? "Programa de membros",
    status: member.status,
    plan: member.plan,
    joinedAt: member.joinedAt.toISOString(),
    pointsBalance: member.pointsBalance,
    pointsEnabled: Boolean(program?.pointsEnabled),
    visits,
    level: null,
    nextReward: member.status === "ACTIVE" ? next : null,
    availableRewards: member.status === "ACTIVE" ? available.map(toMemberRewardDTO) : [],
  };
}

/* ------------------------------------------------------------------------ */
/* Serviço                                                                  */
/* ------------------------------------------------------------------------ */

export const loyaltyService = {
  /* ===== Cliente (app) ===== */

  // O que a página do espaço mostra: o programa (só se estiver ligado), o que oferece e,
  // para quem está autenticado, a sua adesão.
  async getBusinessLoyalty(businessId: string, userId?: string): Promise<BusinessLoyaltyDTO> {
    const business = await getBusinessOrThrow(businessId);
    const program = await loyaltyRepository.findProgram(businessId);
    if (!program?.active) {
      return { program: null, benefits: [], rewards: [], promotions: [], membersOnlyServiceIds: [], membership: null };
    }

    const member = userId ? await loyaltyRepository.findMember(businessId, userId) : null;
    const [benefits, rewards, promotions, membersOnly] = await Promise.all([
      loyaltyRepository.listBenefits(businessId, true),
      loyaltyRepository.listRewards(businessId, true),
      loyaltyRepository.listPromotions(businessId, ["ACTIVE"]),
      loyaltyRepository.membersOnlyServiceIds(businessId),
    ]);

    return {
      program: toProgramDTO(program),
      benefits: benefits.map(toBenefitDTO),
      rewards: rewards.map(toRewardDTO),
      promotions: await promotionsWithCounts(promotions),
      membersOnlyServiceIds: membersOnly.map((service) => service.id),
      membership: member && member.status !== "LEFT" ? await toMyMembership(member, business, program) : null,
    };
  },

  // Aderir é gratuito e só o próprio cliente o faz. Quem saiu pode voltar; quem foi
  // suspenso ou removido pelo espaço não volta sozinho.
  async join(businessId: string, userId: string): Promise<MyMembershipDTO> {
    const business = await getBusinessOrThrow(businessId);
    const program = await loyaltyRepository.findProgram(businessId);
    if (!program?.active) throw new ConflictError("Este espaço não tem um programa de membros ativo.", "LOYALTY_PROGRAM_INACTIVE");

    const member = await loyaltyRepository.transaction(async (db) => {
      const existing = await loyaltyRepository.findMember(businessId, userId, db);
      if (existing?.status === "ACTIVE") throw new ConflictError("Já é membro deste espaço.", "LOYALTY_ALREADY_MEMBER");
      if (existing && existing.status !== "LEFT") {
        throw new AuthorizationError("A sua adesão a este espaço está suspensa. Fale com o espaço.", "LOYALTY_MEMBERSHIP_BLOCKED");
      }

      let joined: LoyaltyMember;
      if (existing) {
        joined = await loyaltyRepository.updateMember(db, existing.id, { status: "ACTIVE", joinedAt: new Date(), statusChangedAt: new Date() });
      } else {
        try {
          joined = await loyaltyRepository.createMember(db, businessId, userId);
        } catch (error) {
          // Dois pedidos de adesão ao mesmo tempo: a restrição única deixa entrar só um.
          if ((error as { code?: string }).code === "P2002") throw new ConflictError("Já é membro deste espaço.", "LOYALTY_ALREADY_MEMBER");
          throw error;
        }
      }
      await loyaltyRepository.addMemberEvent(db, joined.id, "JOINED", userId);
      await loyaltyRepository.ensureBusinessClient(db, businessId, userId);
      return joined;
    });

    notify(userId, "LOYALTY_JOINED", "Bem-vindo ao programa de membros", `Agora é membro de ${business.name}. Veja os seus benefícios na área de membro.`);
    notify(business.ownerId, "LOYALTY_NEW_MEMBER", "Novo membro", `Um cliente aderiu ao programa de membros de ${business.name}.`);
    return toMyMembership(member, business, program);
  },

  async leave(businessId: string, userId: string): Promise<{ left: boolean }> {
    await loyaltyRepository.transaction(async (db) => {
      const member = await loyaltyRepository.findMember(businessId, userId, db);
      if (!member || member.status !== "ACTIVE") throw new NotFoundError("Não é membro deste espaço.", "LOYALTY_NOT_MEMBER");
      await loyaltyRepository.updateMember(db, member.id, { status: "LEFT", statusChangedAt: new Date() });
      await loyaltyRepository.addMemberEvent(db, member.id, "LEFT", userId);
    });
    return { left: true };
  },

  // "Os meus espaços": onde o cliente é membro.
  async myMemberships(userId: string): Promise<MyMembershipDTO[]> {
    const members = await loyaltyRepository.listMembershipsOfUser(userId);
    return Promise.all(members.map((member) => toMyMembership(member, member.business, member.business.loyaltyProgram)));
  },

  async memberArea(businessId: string, userId: string): Promise<MemberAreaDTO> {
    const business = await getBusinessOrThrow(businessId);
    const member = await loyaltyRepository.findMember(businessId, userId);
    if (!member || member.status === "LEFT" || member.status === "REMOVED") throw new NotFoundError("Não é membro deste espaço.", "LOYALTY_NOT_MEMBER");

    const program = await loyaltyRepository.findProgram(businessId);
    const [summary, benefits, rewards, promotions, transactions, rewardHistory] = await Promise.all([
      toMyMembership(member, business, program),
      loyaltyRepository.listBenefits(businessId, true),
      loyaltyRepository.listRewards(businessId, true),
      loyaltyRepository.listPromotions(businessId, ["ACTIVE"]),
      loyaltyRepository.transactionsOf(member.id),
      loyaltyRepository.memberRewardsOf(member.id),
    ]);

    return {
      ...summary,
      benefits: benefits.map(toBenefitDTO),
      rewards: rewards.map(toRewardDTO),
      promotions: (await promotionsWithCounts(promotions)).filter((promotion) => promotion.audience === "MEMBERS"),
      transactions: transactions.map(toTransactionDTO),
      rewardHistory: rewardHistory.map(toMemberRewardDTO),
    };
  },

  /* ===== Dono / equipa (painel) ===== */

  async getProgram(businessId: string, requesterId: string): Promise<LoyaltyProgramDTO | null> {
    await assertOwner(businessId, requesterId);
    const program = await loyaltyRepository.findProgram(businessId);
    return program ? toProgramDTO(program) : null;
  },

  async saveProgram(businessId: string, requesterId: string, input: ProgramInput): Promise<LoyaltyProgramDTO> {
    await assertOwner(businessId, requesterId);
    const program = await loyaltyRepository.upsertProgram(businessId, {
      active: input.active,
      name: input.name,
      description: input.description ?? null,
      joinRules: input.joinRules ?? null,
      terms: input.terms ?? null,
      pointsEnabled: input.pointsEnabled,
      pointsPerUnit: input.pointsPerUnit,
      amountPerUnit: input.amountPerUnit,
      pointsExpireDays: input.pointsExpireDays ?? null,
    });
    await audit(businessId, requesterId, "PROGRAM_SAVED", "LoyaltyProgram", program.id, input as Prisma.InputJsonValue);
    return toProgramDTO(program);
  },

  async overview(businessId: string, requesterId: string): Promise<LoyaltyOverviewDTO> {
    await assertOwner(businessId, requesterId);
    const since = new Date(Date.now() - 30 * DAY_MS);

    const [[totalMembers, activeMembers, newMembers30d], issued, redeemed, rewardsUsed, promotions, members] = await Promise.all([
      loyaltyRepository.memberCounts(businessId, since),
      loyaltyRepository.sumPoints(businessId, ["EARN", "ADJUST"], "positive"),
      loyaltyRepository.sumPoints(businessId, ["REDEEM"], "negative"),
      loyaltyRepository.rewardsUsed(businessId),
      loyaltyRepository.listPromotions(businessId),
      loyaltyRepository.listMembers(businessId),
    ]);

    const stats = await loyaltyRepository.visitStats(businessId, members.map((member) => member.userId));
    const visitsOf = new Map(stats.map((row) => [row.clientId, row._count._all]));
    const topMembers = members
      .map((member) => ({ memberId: member.id, name: member.user.name, visits: visitsOf.get(member.userId) ?? 0, pointsBalance: member.pointsBalance }))
      .sort((a, b) => b.visits - a.visits || b.pointsBalance - a.pointsBalance)
      .slice(0, 5);

    const totals = await loyaltyRepository.promotionUsageTotals(promotions.map((promotion) => promotion.id));
    const campaigns = promotions.map((promotion) => {
      const rows = totals.filter((row) => row.promotionId === promotion.id);
      return {
        id: promotion.id,
        name: promotion.name,
        status: promotion.status,
        usedCount: rows.filter((row) => row.status !== "RELEASED").reduce((sum, row) => sum + row._count._all, 0),
        maxUses: promotion.maxUses,
        discountGiven: rows.filter((row) => row.status === "CONSUMED").reduce((sum, row) => sum + (row._sum.discountAmount?.toNumber() ?? 0), 0),
      };
    });

    return {
      totalMembers,
      activeMembers,
      newMembers30d,
      pointsIssued: issued._sum.points ?? 0,
      pointsRedeemed: -(redeemed._sum.points ?? 0),
      rewardsUsed,
      activePromotions: promotions.filter((promotion) => promotion.status === "ACTIVE").length,
      topMembers,
      campaigns,
    };
  },

  async listMembers(businessId: string, requesterId: string, search?: string): Promise<LoyaltyMemberDTO[]> {
    await assertStaff(businessId, requesterId);
    const members = await loyaltyRepository.listMembers(businessId, search);
    const stats = await loyaltyRepository.visitStats(businessId, members.map((member) => member.userId));
    const byUser = new Map(stats.map((row) => [row.clientId, row]));

    return members.map((member) => ({
      id: member.id,
      userId: member.userId,
      name: member.user.name,
      email: member.user.email,
      phone: member.user.phone,
      avatarUrl: member.user.avatarUrl,
      status: member.status,
      plan: member.plan,
      pointsBalance: member.pointsBalance,
      joinedAt: member.joinedAt.toISOString(),
      visits: byUser.get(member.userId)?._count._all ?? 0,
      lastVisit: byUser.get(member.userId)?._max.scheduledAt?.toISOString() ?? null,
    }));
  },

  async getMember(businessId: string, requesterId: string, memberId: string): Promise<LoyaltyMemberDetailDTO> {
    await assertStaff(businessId, requesterId);
    const member = assertSameBusiness(await loyaltyRepository.findMemberById(memberId), businessId, "Membro não encontrado.", "LOYALTY_MEMBER_NOT_FOUND");
    const [transactions, rewards, history, stats] = await Promise.all([
      loyaltyRepository.transactionsOf(member.id, 200),
      loyaltyRepository.memberRewardsOf(member.id),
      loyaltyRepository.memberEvents(member.id),
      loyaltyRepository.visitStats(businessId, [member.userId]),
    ]);

    return {
      id: member.id,
      userId: member.userId,
      name: member.user.name,
      email: member.user.email,
      phone: member.user.phone,
      avatarUrl: member.user.avatarUrl,
      status: member.status,
      plan: member.plan,
      pointsBalance: member.pointsBalance,
      joinedAt: member.joinedAt.toISOString(),
      visits: stats[0]?._count._all ?? 0,
      lastVisit: stats[0]?._max.scheduledAt?.toISOString() ?? null,
      transactions: transactions.map(toTransactionDTO),
      rewards: rewards.map(toMemberRewardDTO),
      history: history.map((event) => ({ id: event.id, action: event.action, reason: event.reason, createdAt: event.createdAt.toISOString() })),
    };
  },

  async setMemberStatus(businessId: string, requesterId: string, memberId: string, input: MemberStatusInput): Promise<LoyaltyMemberDetailDTO> {
    const business = await assertOwner(businessId, requesterId);
    const member = assertSameBusiness(await loyaltyRepository.findMemberById(memberId), businessId, "Membro não encontrado.", "LOYALTY_MEMBER_NOT_FOUND");
    if (member.status === "LEFT") throw new ConflictError("Este cliente já saiu do programa.", "LOYALTY_MEMBER_LEFT");
    if (member.status === input.status) return this.getMember(businessId, requesterId, memberId);

    const action = input.status === "ACTIVE" ? "REACTIVATED" : input.status;
    await loyaltyRepository.transaction(async (db) => {
      await loyaltyRepository.updateMember(db, member.id, { status: input.status, statusChangedAt: new Date() });
      await loyaltyRepository.addMemberEvent(db, member.id, action, requesterId, input.reason);
    });
    await audit(businessId, requesterId, `MEMBER_${action}`, "LoyaltyMember", member.id, { reason: input.reason ?? null });

    const message =
      input.status === "ACTIVE"
        ? `A sua adesão ao programa de membros de ${business.name} foi reativada.`
        : input.status === "SUSPENDED"
          ? `A sua adesão ao programa de membros de ${business.name} foi suspensa.`
          : `Deixou de ser membro de ${business.name}.`;
    notify(member.userId, "LOYALTY_MEMBERSHIP_CHANGED", "Programa de membros", message);
    return this.getMember(businessId, requesterId, memberId);
  },

  // Correção manual de pontos pelo dono, sempre com motivo; fica no histórico e no registo.
  async adjustPoints(businessId: string, requesterId: string, memberId: string, input: PointsAdjustmentInput): Promise<LoyaltyMemberDetailDTO> {
    await assertOwner(businessId, requesterId);
    const found = assertSameBusiness(await loyaltyRepository.findMemberById(memberId), businessId, "Membro não encontrado.", "LOYALTY_MEMBER_NOT_FOUND");

    await loyaltyRepository.transaction(async (db) => {
      const member = await loyaltyRepository.lockMember(db, found.id);
      if (member.pointsBalance + input.points < 0) {
        throw new ValidationError(`O membro só tem ${member.pointsBalance} pontos.`, "LOYALTY_POINTS_INSUFFICIENT");
      }
      await loyaltyRepository.addTransaction(db, member, {
        type: "ADJUST",
        points: input.points,
        reason: input.reason,
        actorId: requesterId,
        idempotencyKey: `adjust:${member.id}:${Date.now()}:${Math.random().toString(36).slice(2)}`,
      });
    });
    await audit(businessId, requesterId, "POINTS_ADJUSTED", "LoyaltyMember", found.id, { points: input.points, reason: input.reason });
    if (input.points > 0) notify(found.userId, "LOYALTY_POINTS_EARNED", "Recebeu pontos", `Recebeu ${input.points} pontos: ${input.reason}.`);
    return this.getMember(businessId, requesterId, memberId);
  },

  /* ----- Benefícios ----- */

  async listBenefits(businessId: string, requesterId: string): Promise<LoyaltyBenefitDTO[]> {
    await assertStaff(businessId, requesterId);
    return (await loyaltyRepository.listBenefits(businessId)).map(toBenefitDTO);
  },

  async createBenefit(businessId: string, requesterId: string, input: BenefitInput): Promise<LoyaltyBenefitDTO> {
    const business = await assertOwner(businessId, requesterId);
    const benefit = await loyaltyRepository.createBenefit({
      businessId,
      title: input.title,
      description: input.description ?? null,
      conditions: input.conditions ?? null,
      validFrom: toDate(input.validFrom),
      validUntil: toDate(input.validUntil),
      active: input.active,
    });
    await audit(businessId, requesterId, "BENEFIT_CREATED", "LoyaltyBenefit", benefit.id, { title: benefit.title });
    if (benefit.active) await this.tellMembers(businessId, "LOYALTY_NEW_BENEFIT", "Novo benefício para membros", `${business.name}: ${benefit.title}.`);
    return toBenefitDTO(benefit);
  },

  async updateBenefit(businessId: string, requesterId: string, benefitId: string, input: BenefitInput): Promise<LoyaltyBenefitDTO> {
    await assertOwner(businessId, requesterId);
    assertSameBusiness(await loyaltyRepository.findBenefit(benefitId), businessId, "Benefício não encontrado.", "LOYALTY_BENEFIT_NOT_FOUND");
    const benefit = await loyaltyRepository.updateBenefit(benefitId, {
      title: input.title,
      description: input.description ?? null,
      conditions: input.conditions ?? null,
      validFrom: toDate(input.validFrom),
      validUntil: toDate(input.validUntil),
      active: input.active,
    });
    await audit(businessId, requesterId, "BENEFIT_UPDATED", "LoyaltyBenefit", benefit.id, { title: benefit.title, active: benefit.active });
    return toBenefitDTO(benefit);
  },

  async deleteBenefit(businessId: string, requesterId: string, benefitId: string) {
    await assertOwner(businessId, requesterId);
    assertSameBusiness(await loyaltyRepository.findBenefit(benefitId), businessId, "Benefício não encontrado.", "LOYALTY_BENEFIT_NOT_FOUND");
    await loyaltyRepository.deleteBenefit(benefitId);
    await audit(businessId, requesterId, "BENEFIT_DELETED", "LoyaltyBenefit", benefitId);
    return { deleted: true };
  },

  /* ----- Recompensas ----- */

  async listRewards(businessId: string, requesterId: string): Promise<LoyaltyRewardDTO[]> {
    await assertStaff(businessId, requesterId);
    return (await loyaltyRepository.listRewards(businessId)).map(toRewardDTO);
  },

  async createReward(businessId: string, requesterId: string, input: RewardInput): Promise<LoyaltyRewardDTO> {
    await assertOwner(businessId, requesterId);
    await assertServicesOfBusiness(businessId, input.serviceIds);
    const reward = await loyaltyRepository.createReward(
      {
        businessId,
        name: input.name,
        description: input.description ?? null,
        kind: input.kind,
        pointsCost: input.kind === "POINTS" ? (input.pointsCost ?? null) : null,
        visitsRequired: input.kind === "VISITS" ? (input.visitsRequired ?? null) : null,
        discountType: input.discountType,
        discountValue: input.discountType === "FREE" ? 0 : input.discountValue,
        validDays: input.validDays ?? null,
        active: input.active,
      },
      input.serviceIds,
    );
    await audit(businessId, requesterId, "REWARD_CREATED", "LoyaltyReward", reward.id, { name: reward.name, kind: reward.kind });
    return toRewardDTO(reward);
  },

  async updateReward(businessId: string, requesterId: string, rewardId: string, input: RewardInput): Promise<LoyaltyRewardDTO> {
    await assertOwner(businessId, requesterId);
    assertSameBusiness(await loyaltyRepository.findReward(rewardId), businessId, "Recompensa não encontrada.", "LOYALTY_REWARD_NOT_FOUND");
    await assertServicesOfBusiness(businessId, input.serviceIds);
    const reward = await loyaltyRepository.updateReward(
      rewardId,
      {
        name: input.name,
        description: input.description ?? null,
        kind: input.kind,
        pointsCost: input.kind === "POINTS" ? (input.pointsCost ?? null) : null,
        visitsRequired: input.kind === "VISITS" ? (input.visitsRequired ?? null) : null,
        discountType: input.discountType,
        discountValue: input.discountType === "FREE" ? 0 : input.discountValue,
        validDays: input.validDays ?? null,
        active: input.active,
      },
      input.serviceIds,
    );
    await audit(businessId, requesterId, "REWARD_UPDATED", "LoyaltyReward", reward.id, { name: reward.name, active: reward.active });
    return toRewardDTO(reward);
  },

  // Uma recompensa que algum membro já tem não se apaga (é histórico): fica desativada.
  async deleteReward(businessId: string, requesterId: string, rewardId: string) {
    await assertOwner(businessId, requesterId);
    const reward = assertSameBusiness(await loyaltyRepository.findReward(rewardId), businessId, "Recompensa não encontrada.", "LOYALTY_REWARD_NOT_FOUND");
    if (await loyaltyRepository.rewardHasHolders(rewardId)) {
      await loyaltyRepository.updateReward(rewardId, { active: false }, reward.services.map((service) => service.serviceId));
      await audit(businessId, requesterId, "REWARD_DEACTIVATED", "LoyaltyReward", rewardId);
      return { deleted: false, deactivated: true };
    }
    await loyaltyRepository.deleteReward(rewardId);
    await audit(businessId, requesterId, "REWARD_DELETED", "LoyaltyReward", rewardId);
    return { deleted: true, deactivated: false };
  },

  /* ----- Promoções ----- */

  async listPromotions(businessId: string, requesterId: string): Promise<PromotionDTO[]> {
    await assertStaff(businessId, requesterId);
    return promotionsWithCounts(await loyaltyRepository.listPromotions(businessId));
  },

  async createPromotion(businessId: string, requesterId: string, input: PromotionInput): Promise<PromotionDTO> {
    await assertOwner(businessId, requesterId);
    await assertServicesOfBusiness(businessId, input.serviceIds);
    const promotion = await loyaltyRepository.createPromotion(
      {
        businessId,
        ...promotionFields(input),
        status: "DRAFT",
      },
      input.serviceIds,
    );
    await audit(businessId, requesterId, "PROMOTION_CREATED", "Promotion", promotion.id, { name: promotion.name });
    return toPromotionDTO(promotion);
  },

  async updatePromotion(businessId: string, requesterId: string, promotionId: string, input: PromotionInput): Promise<PromotionDTO> {
    await assertOwner(businessId, requesterId);
    const current = assertSameBusiness(await loyaltyRepository.findPromotion(promotionId), businessId, "Promoção não encontrada.", "PROMOTION_NOT_FOUND");
    if (current.status === "ENDED") throw new ConflictError("Uma promoção terminada já não pode ser alterada.", "PROMOTION_ENDED");
    await assertServicesOfBusiness(businessId, input.serviceIds);
    const promotion = await loyaltyRepository.updatePromotion(promotionId, promotionFields(input), input.serviceIds);
    await audit(businessId, requesterId, "PROMOTION_UPDATED", "Promotion", promotion.id, { name: promotion.name });
    return (await promotionsWithCounts([promotion]))[0];
  },

  // Ativar, pausar ou terminar. Terminada não volta atrás. Ao ativar pela primeira vez,
  // os membros são avisados (se aceitam promoções).
  async setPromotionStatus(businessId: string, requesterId: string, promotionId: string, status: "ACTIVE" | "PAUSED" | "ENDED"): Promise<PromotionDTO> {
    const business = await assertOwner(businessId, requesterId);
    const current = assertSameBusiness(await loyaltyRepository.findPromotion(promotionId), businessId, "Promoção não encontrada.", "PROMOTION_NOT_FOUND");
    if (current.status === "ENDED") throw new ConflictError("Esta promoção já terminou.", "PROMOTION_ENDED");
    if (status === "ACTIVE" && current.endsAt && current.endsAt < new Date()) {
      throw new ConflictError("A data de fim desta promoção já passou. Altere-a antes de a ativar.", "PROMOTION_PAST_END");
    }

    const firstActivation = status === "ACTIVE" && !current.notifiedAt;
    const promotion = await loyaltyRepository.updatePromotion(promotionId, { status, ...(firstActivation ? { notifiedAt: new Date() } : {}) });
    await audit(businessId, requesterId, `PROMOTION_${status}`, "Promotion", promotionId, { name: promotion.name });

    if (firstActivation) {
      const what = `${promotion.name} — ${discountLabel(promotion.discountType, promotion.discountValue.toNumber())} de desconto`;
      await this.tellMembers(
        businessId,
        "LOYALTY_NEW_PROMOTION",
        promotion.audience === "MEMBERS" ? "Promoção exclusiva para membros" : "Nova promoção",
        `${business.name}: ${what}.`,
      );
    }
    return (await promotionsWithCounts([promotion]))[0];
  },

  async deletePromotion(businessId: string, requesterId: string, promotionId: string) {
    await assertOwner(businessId, requesterId);
    const current = assertSameBusiness(await loyaltyRepository.findPromotion(promotionId), businessId, "Promoção não encontrada.", "PROMOTION_NOT_FOUND");
    const totals = await loyaltyRepository.promotionUsageTotals([promotionId]);
    if (current.status !== "DRAFT" || totals.length > 0) {
      throw new ConflictError("Só pode apagar promoções em rascunho e nunca usadas. Termine-a em vez disso.", "PROMOTION_NOT_DELETABLE");
    }
    await loyaltyRepository.deletePromotion(promotionId);
    await audit(businessId, requesterId, "PROMOTION_DELETED", "Promotion", promotionId);
    return { deleted: true };
  },

  async promotionResults(businessId: string, requesterId: string, promotionId: string): Promise<PromotionResultsDTO> {
    await assertOwner(businessId, requesterId);
    const promotion = assertSameBusiness(await loyaltyRepository.findPromotion(promotionId), businessId, "Promoção não encontrada.", "PROMOTION_NOT_FOUND");
    const usages = await loyaltyRepository.promotionUsages(promotionId);
    const count = (status: string) => usages.filter((usage) => usage.status === status).length;

    return {
      promotion: (await promotionsWithCounts([promotion]))[0],
      reserved: count("RESERVED"),
      consumed: count("CONSUMED"),
      released: count("RELEASED"),
      discountGiven: usages.filter((usage) => usage.status === "CONSUMED").reduce((sum, usage) => sum + usage.discountAmount.toNumber(), 0),
      usages: usages.map((usage) => ({
        id: usage.id,
        appointmentId: usage.appointmentId,
        clientName: usage.appointment.client?.name ?? usage.appointment.walkInClient?.name ?? "Cliente",
        status: usage.status,
        discountAmount: usage.discountAmount.toNumber(),
        scheduledAt: usage.appointment.scheduledAt.toISOString(),
        createdAt: usage.createdAt.toISOString(),
      })),
    };
  },

  /* ----- Serviços exclusivos para membros ----- */

  async getMembersOnlyServices(businessId: string, requesterId: string): Promise<string[]> {
    await assertStaff(businessId, requesterId);
    return (await loyaltyRepository.membersOnlyServiceIds(businessId)).map((service) => service.id);
  },

  async setMembersOnlyServices(businessId: string, requesterId: string, serviceIds: string[]): Promise<string[]> {
    await assertOwner(businessId, requesterId);
    await assertServicesOfBusiness(businessId, serviceIds);
    await loyaltyRepository.setMembersOnly(businessId, serviceIds);
    await audit(businessId, requesterId, "MEMBERS_ONLY_SERVICES_SET", "Service", null, { serviceIds });
    return serviceIds;
  },

  // Aviso a todos os membros ativos (promocional: respeita quem não quer promoções).
  async tellMembers(businessId: string, type: string, title: string, message: string) {
    const members = await loyaltyRepository.findActiveMembers(businessId);
    for (const member of members) notify(member.userId, type, title, message, true);
  },
};

function promotionFields(input: PromotionInput) {
  return {
    name: input.name,
    description: input.description ?? null,
    audience: input.audience,
    discountType: input.discountType,
    discountValue: input.discountType === "FREE" ? 0 : input.discountValue,
    startsAt: toDate(input.startsAt),
    endsAt: toDate(input.endsAt),
    membersFrom: toDate(input.membersFrom),
    weekdays: [...new Set(input.weekdays)].sort(),
    startMinute: input.startMinute ?? null,
    endMinute: input.endMinute ?? null,
    maxUses: input.maxUses ?? null,
    maxUsesPerClient: input.maxUsesPerClient ?? null,
    stackable: input.stackable,
    releaseOnCancel: input.releaseOnCancel,
  };
}
