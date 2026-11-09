import { Prisma, type LoyaltyTransactionType } from "@prisma/client";
import { prisma } from "../../config/database";

type Db = Prisma.TransactionClient;

const promotionInclude = { services: { select: { serviceId: true } } } satisfies Prisma.PromotionInclude;
const rewardInclude = { services: { select: { serviceId: true } } } satisfies Prisma.LoyaltyRewardInclude;
const memberRewardInclude = { reward: { include: rewardInclude } } satisfies Prisma.MemberRewardInclude;

export type PromotionRow = Prisma.PromotionGetPayload<{ include: typeof promotionInclude }>;
export type RewardRow = Prisma.LoyaltyRewardGetPayload<{ include: typeof rewardInclude }>;
export type MemberRewardRow = Prisma.MemberRewardGetPayload<{ include: typeof memberRewardInclude }>;

// Uses that hold a promotional slot: booked and not cancelled, or already paid.
const COUNTING = ["RESERVED", "CONSUMED"] as const;

export const loyaltyRepository = {
  transaction<T>(fn: (db: Db) => Promise<T>) {
    return prisma.$transaction(fn);
  },

  /* ---------------- Programa ---------------- */

  findProgram(businessId: string, db: Db = prisma) {
    return db.loyaltyProgram.findUnique({ where: { businessId } });
  },

  upsertProgram(businessId: string, data: Omit<Prisma.LoyaltyProgramUncheckedCreateInput, "businessId">) {
    return prisma.loyaltyProgram.upsert({ where: { businessId }, create: { businessId, ...data }, update: data });
  },

  /* ---------------- Membros ---------------- */

  findMember(businessId: string, userId: string, db: Db = prisma) {
    return db.loyaltyMember.findUnique({ where: { businessId_userId: { businessId, userId } } });
  },

  findMemberById(id: string) {
    return prisma.loyaltyMember.findUnique({ where: { id }, include: { user: true } });
  },

  // The member row, locked until the transaction ends: every change to the points balance
  // goes through here, so two requests can never both read the same balance and both spend it.
  async lockMember(db: Db, memberId: string) {
    await db.$queryRaw`SELECT id FROM loyalty_members WHERE id = ${memberId} FOR UPDATE`;
    return db.loyaltyMember.findUniqueOrThrow({ where: { id: memberId } });
  },

  createMember(db: Db, businessId: string, userId: string) {
    return db.loyaltyMember.create({ data: { businessId, userId } });
  },

  updateMember(db: Db, id: string, data: Prisma.LoyaltyMemberUpdateInput) {
    return db.loyaltyMember.update({ where: { id }, data });
  },

  addMemberEvent(db: Db, memberId: string, action: string, actorId: string | null, reason?: string | null) {
    return db.loyaltyMemberEvent.create({ data: { memberId, action, actorId, reason: reason ?? null } });
  },

  /*
   * Being a client of the space IS being in its programme: every client (BusinessClient)
   * has a member row, created here the first time it is needed. A client who had left
   * comes back in; one the owner suspended or removed stays as the owner left them.
   */
  async ensureMemberForClient(db: Db, businessId: string, userId: string) {
    const existing = await db.loyaltyMember.findUnique({ where: { businessId_userId: { businessId, userId } } });
    if (existing) {
      if (existing.status !== "LEFT") return existing;
      const back = await db.loyaltyMember.update({ where: { id: existing.id }, data: { status: "ACTIVE", joinedAt: new Date(), statusChangedAt: new Date() } });
      await db.loyaltyMemberEvent.create({ data: { memberId: back.id, action: "JOINED", actorId: userId, reason: "Cliente do espaço" } });
      return back;
    }
    try {
      const created = await db.loyaltyMember.create({ data: { businessId, userId } });
      await db.loyaltyMemberEvent.create({ data: { memberId: created.id, action: "JOINED", actorId: userId, reason: "Cliente do espaço" } });
      return created;
    } catch (error) {
      // Two requests at once: the unique (businessId, userId) lets only one create it.
      if ((error as { code?: string }).code === "P2002") return db.loyaltyMember.findUniqueOrThrow({ where: { businessId_userId: { businessId, userId } } });
      throw error;
    }
  },

  isBusinessClient(db: Db, businessId: string, userId: string) {
    return db.businessClient.findUnique({ where: { businessId_userId: { businessId, userId } } });
  },

  // The member is also a client of the space (the existing "Cliente do espaço" relation).
  ensureBusinessClient(db: Db, businessId: string, userId: string) {
    return db.businessClient.upsert({ where: { businessId_userId: { businessId, userId } }, create: { businessId, userId }, update: {} });
  },

  listMembers(businessId: string, search?: string) {
    const q = search?.trim();
    return prisma.loyaltyMember.findMany({
      where: {
        businessId,
        status: { not: "LEFT" },
        ...(q
          ? {
              user: {
                OR: [
                  { name: { contains: q, mode: "insensitive" } },
                  { email: { contains: q, mode: "insensitive" } },
                  { phone: { contains: q } },
                ],
              },
            }
          : {}),
      },
      include: { user: true },
      orderBy: { joinedAt: "desc" },
      take: 500,
    });
  },

  listMembershipsOfUser(userId: string) {
    return prisma.loyaltyMember.findMany({
      where: { userId, status: { in: ["ACTIVE", "SUSPENDED"] } },
      include: { business: { include: { loyaltyProgram: true } } },
      orderBy: { joinedAt: "desc" },
    });
  },

  findActiveMembers(businessId: string) {
    return prisma.loyaltyMember.findMany({ where: { businessId, status: "ACTIVE" }, select: { userId: true } });
  },

  memberEvents(memberId: string) {
    return prisma.loyaltyMemberEvent.findMany({ where: { memberId }, orderBy: { createdAt: "desc" }, take: 100 });
  },

  // Appointments of the client at this space paid since joining — the "visits" rewards count.
  // Paid, not booked: someone who joins at the counter just before paying gets that visit.
  paidVisits(businessId: string, userId: string, since: Date, serviceIds: string[] = [], db: Db = prisma) {
    return db.appointment.count({
      where: {
        businessId,
        clientId: userId,
        status: "COMPLETED",
        payment: { is: { status: "PAID", paidAt: { gte: since } } },
        ...(serviceIds.length > 0 ? { serviceId: { in: serviceIds } } : {}),
      },
    });
  },

  visitStats(businessId: string, userIds: string[]) {
    return prisma.appointment.groupBy({
      by: ["clientId"],
      where: { businessId, clientId: { in: userIds }, status: "COMPLETED" },
      _count: { _all: true },
      _max: { scheduledAt: true },
    });
  },

  /* ---------------- Pontos ---------------- */

  findTransactionByKey(db: Db, idempotencyKey: string) {
    return db.loyaltyTransaction.findUnique({ where: { idempotencyKey } });
  },

  // Writes one ledger row and moves the balance with it, on a member already locked by
  // lockMember. A key that already exists means the event was already recorded: nothing
  // changes. The balance can't go below zero (also a CHECK in the database).
  async addTransaction(
    db: Db,
    member: { id: string; businessId: string; pointsBalance: number },
    input: {
      type: LoyaltyTransactionType;
      points: number;
      idempotencyKey: string;
      appointmentId?: string | null;
      memberRewardId?: string | null;
      reason?: string | null;
      actorId?: string | null;
      expiresAt?: Date | null;
    },
  ) {
    if (await db.loyaltyTransaction.findUnique({ where: { idempotencyKey: input.idempotencyKey } })) return null;
    const balanceAfter = member.pointsBalance + input.points;
    if (balanceAfter < 0) return null;

    const transaction = await db.loyaltyTransaction.create({
      data: {
        memberId: member.id,
        businessId: member.businessId,
        type: input.type,
        points: input.points,
        balanceAfter,
        appointmentId: input.appointmentId ?? null,
        memberRewardId: input.memberRewardId ?? null,
        reason: input.reason ?? null,
        actorId: input.actorId ?? null,
        expiresAt: input.expiresAt ?? null,
        idempotencyKey: input.idempotencyKey,
      },
    });
    await db.loyaltyMember.update({ where: { id: member.id }, data: { pointsBalance: balanceAfter } });
    member.pointsBalance = balanceAfter;
    return transaction;
  },

  transactionsOf(memberId: string, take = 100) {
    return prisma.loyaltyTransaction.findMany({ where: { memberId }, orderBy: { createdAt: "desc" }, take });
  },

  // What the FIFO expiry needs, per member.
  async expiryTotals(db: Db, memberId: string, now: Date) {
    const sum = async (where: Prisma.LoyaltyTransactionWhereInput) =>
      (await db.loyaltyTransaction.aggregate({ where: { memberId, ...where }, _sum: { points: true } }))._sum.points ?? 0;

    const [expiredEarned, debits, refunds, alreadyExpired] = await Promise.all([
      sum({ type: "EARN", expiresAt: { lte: now } }),
      sum({ OR: [{ type: { in: ["REDEEM", "REVERSAL"] } }, { type: "ADJUST", points: { lt: 0 } }] }),
      sum({ type: "REFUND" }),
      sum({ type: "EXPIRE" }),
    ]);
    // Debits are stored negative; refunds give back points that a redemption had taken.
    return { expiredEarned, debitsExcludingExpiry: -debits - refunds, alreadyExpired: -alreadyExpired };
  },

  membersWithExpiredEarnings(now: Date) {
    return prisma.loyaltyTransaction.findMany({
      where: { type: "EARN", expiresAt: { lte: now } },
      distinct: ["memberId"],
      select: { memberId: true },
    });
  },

  sumPoints(businessId: string, types: LoyaltyTransactionType[], sign: "positive" | "negative") {
    return prisma.loyaltyTransaction.aggregate({
      where: { businessId, type: { in: types }, points: sign === "positive" ? { gt: 0 } : { lt: 0 } },
      _sum: { points: true },
    });
  },

  /* ---------------- Benefícios ---------------- */

  listBenefits(businessId: string, onlyCurrent = false, now = new Date()) {
    return prisma.loyaltyBenefit.findMany({
      where: {
        businessId,
        ...(onlyCurrent
          ? { active: true, AND: [{ OR: [{ validFrom: null }, { validFrom: { lte: now } }] }, { OR: [{ validUntil: null }, { validUntil: { gte: now } }] }] }
          : {}),
      },
      orderBy: { createdAt: "desc" },
    });
  },

  findBenefit(id: string) {
    return prisma.loyaltyBenefit.findUnique({ where: { id } });
  },

  createBenefit(data: Prisma.LoyaltyBenefitUncheckedCreateInput) {
    return prisma.loyaltyBenefit.create({ data });
  },

  updateBenefit(id: string, data: Prisma.LoyaltyBenefitUncheckedUpdateInput) {
    return prisma.loyaltyBenefit.update({ where: { id }, data });
  },

  deleteBenefit(id: string) {
    return prisma.loyaltyBenefit.delete({ where: { id } });
  },

  /* ---------------- Recompensas ---------------- */

  listRewards(businessId: string, onlyActive = false, db: Db = prisma) {
    return db.loyaltyReward.findMany({ where: { businessId, ...(onlyActive ? { active: true } : {}) }, include: rewardInclude, orderBy: { createdAt: "asc" } });
  },

  findReward(id: string, db: Db = prisma) {
    return db.loyaltyReward.findUnique({ where: { id }, include: rewardInclude });
  },

  createReward(data: Omit<Prisma.LoyaltyRewardUncheckedCreateInput, "services">, serviceIds: string[]) {
    return prisma.loyaltyReward.create({ data: { ...data, services: { create: serviceIds.map((serviceId) => ({ serviceId })) } }, include: rewardInclude });
  },

  updateReward(id: string, data: Omit<Prisma.LoyaltyRewardUncheckedUpdateInput, "services">, serviceIds: string[]) {
    return prisma.$transaction(async (db) => {
      await db.loyaltyRewardService.deleteMany({ where: { rewardId: id } });
      return db.loyaltyReward.update({
        where: { id },
        data: { ...data, services: { create: serviceIds.map((serviceId) => ({ serviceId })) } },
        include: rewardInclude,
      });
    });
  },

  rewardHasHolders(id: string) {
    return prisma.memberReward.count({ where: { rewardId: id } });
  },

  deleteReward(id: string) {
    return prisma.loyaltyReward.delete({ where: { id } });
  },

  memberRewardsOf(memberId: string, statuses?: ("AVAILABLE" | "RESERVED" | "USED" | "EXPIRED" | "CANCELLED")[], db: Db = prisma) {
    return db.memberReward.findMany({
      where: { memberId, ...(statuses ? { status: { in: statuses } } : {}) },
      include: memberRewardInclude,
      orderBy: { createdAt: "desc" },
      take: 100,
    });
  },

  findMemberReward(id: string, db: Db = prisma) {
    return db.memberReward.findUnique({ where: { id }, include: memberRewardInclude });
  },

  // Creates the reward unless the same unlock already happened (unique unlockKey).
  async unlockReward(db: Db, data: { memberId: string; rewardId: string; businessId: string; unlockKey: string; expiresAt: Date | null; status?: "AVAILABLE" | "RESERVED"; appointmentId?: string }) {
    if (await db.memberReward.findUnique({ where: { unlockKey: data.unlockKey } })) return null;
    return db.memberReward.create({ data, include: memberRewardInclude });
  },

  countUnlocks(db: Db, memberId: string, rewardId: string) {
    return db.memberReward.count({ where: { memberId, rewardId } });
  },

  // Holds an available reward for an appointment, only if it is still available and valid.
  async reserveMemberReward(db: Db, id: string, appointmentId: string, now: Date) {
    const { count } = await db.memberReward.updateMany({
      where: { id, status: "AVAILABLE", OR: [{ expiresAt: null }, { expiresAt: { gt: now } }] },
      data: { status: "RESERVED", appointmentId },
    });
    return count === 1;
  },

  reservedRewardsOf(db: Db, appointmentId: string) {
    return db.memberReward.findMany({ where: { appointmentId, status: "RESERVED" } });
  },

  updateMemberReward(db: Db, id: string, data: Prisma.MemberRewardUncheckedUpdateInput) {
    return db.memberReward.update({ where: { id }, data });
  },

  expireMemberRewards(now: Date) {
    return prisma.memberReward.updateMany({ where: { status: "AVAILABLE", expiresAt: { lte: now } }, data: { status: "EXPIRED" } });
  },

  rewardsExpiringSoon(now: Date, until: Date) {
    return prisma.memberReward.findMany({
      where: { status: "AVAILABLE", expiryNotifiedAt: null, expiresAt: { gt: now, lte: until } },
      include: { reward: true, member: { include: { business: true } } },
    });
  },

  rewardsUsed(businessId: string) {
    return prisma.memberReward.count({ where: { businessId, status: "USED" } });
  },

  activeBirthdayRewards() {
    return prisma.loyaltyReward.findMany({ where: { kind: "BIRTHDAY", active: true, business: { loyaltyProgram: { active: true } } } });
  },

  // Active members of `businessId` whose birthday is in `month` (1-12).
  async birthdayMembers(businessId: string, month: number) {
    return prisma.$queryRaw<{ id: string; userId: string }[]>`
      SELECT m.id, m."userId" FROM loyalty_members m JOIN users u ON u.id = m."userId"
      WHERE m."businessId" = ${businessId} AND m.status = 'ACTIVE' AND u."birthDate" IS NOT NULL
        AND EXTRACT(MONTH FROM u."birthDate") = ${month}`;
  },

  /* ---------------- Promoções ---------------- */

  listPromotions(businessId: string, statuses?: ("DRAFT" | "ACTIVE" | "PAUSED" | "ENDED")[], db: Db = prisma) {
    return db.promotion.findMany({
      where: { businessId, ...(statuses ? { status: { in: statuses } } : {}) },
      include: promotionInclude,
      orderBy: { createdAt: "desc" },
    });
  },

  findPromotion(id: string) {
    return prisma.promotion.findUnique({ where: { id }, include: promotionInclude });
  },

  createPromotion(data: Omit<Prisma.PromotionUncheckedCreateInput, "services">, serviceIds: string[]) {
    return prisma.promotion.create({ data: { ...data, services: { create: serviceIds.map((serviceId) => ({ serviceId })) } }, include: promotionInclude });
  },

  updatePromotion(id: string, data: Omit<Prisma.PromotionUncheckedUpdateInput, "services">, serviceIds?: string[]) {
    return prisma.$transaction(async (db) => {
      if (serviceIds) await db.promotionService.deleteMany({ where: { promotionId: id } });
      return db.promotion.update({
        where: { id },
        data: { ...data, ...(serviceIds ? { services: { create: serviceIds.map((serviceId) => ({ serviceId })) } } : {}) },
        include: promotionInclude,
      });
    });
  },

  deletePromotion(id: string) {
    return prisma.promotion.delete({ where: { id } });
  },

  // Active promotions of the space for this service, locked until the booking's transaction
  // ends: two bookings racing for the last promotional slot run one after the other, and the
  // second one sees the slot taken. Locked in id order, so they can't deadlock each other.
  async lockApplicablePromotions(db: Db, businessId: string, serviceId: string) {
    await db.$queryRaw`
      SELECT p.id FROM promotions p
      WHERE p."businessId" = ${businessId} AND p.status = 'ACTIVE'
        AND (NOT EXISTS (SELECT 1 FROM promotion_services s WHERE s."promotionId" = p.id)
             OR EXISTS (SELECT 1 FROM promotion_services s WHERE s."promotionId" = p.id AND s."serviceId" = ${serviceId}))
      ORDER BY p.id
      FOR UPDATE OF p`;
    return loyaltyRepository.applicablePromotions(db, businessId, serviceId);
  },

  applicablePromotions(db: Db, businessId: string, serviceId: string) {
    return db.promotion.findMany({
      where: { businessId, status: "ACTIVE", OR: [{ services: { none: {} } }, { services: { some: { serviceId } } }] },
      include: promotionInclude,
    });
  },

  async usageCounts(db: Db, promotionIds: string[], client: { userId?: string | null; walkInClientId?: string | null }, excludeAppointmentId?: string) {
    if (promotionIds.length === 0) return { total: new Map<string, number>(), byClient: new Map<string, number>() };
    const base = { promotionId: { in: promotionIds }, status: { in: [...COUNTING] }, ...(excludeAppointmentId ? { appointmentId: { not: excludeAppointmentId } } : {}) };
    const [total, byClient] = await Promise.all([
      db.promotionUsage.groupBy({ by: ["promotionId"], where: base, _count: { _all: true } }),
      client.userId || client.walkInClientId
        ? db.promotionUsage.groupBy({
            by: ["promotionId"],
            where: { ...base, ...(client.userId ? { userId: client.userId } : { walkInClientId: client.walkInClientId }) },
            _count: { _all: true },
          })
        : Promise.resolve([]),
    ]);
    return {
      total: new Map(total.map((row) => [row.promotionId, row._count._all])),
      byClient: new Map(byClient.map((row) => [row.promotionId, row._count._all])),
    };
  },

  async promotionUsageTotals(promotionIds: string[]) {
    if (promotionIds.length === 0) return [];
    return prisma.promotionUsage.groupBy({ by: ["promotionId", "status"], where: { promotionId: { in: promotionIds } }, _count: { _all: true }, _sum: { discountAmount: true } });
  },

  promotionUsages(promotionId: string) {
    return prisma.promotionUsage.findMany({
      where: { promotionId },
      include: { appointment: { include: { client: { select: { name: true } }, walkInClient: { select: { name: true } } } } },
      orderBy: { createdAt: "desc" },
      take: 500,
    });
  },

  createUsage(db: Db, data: Prisma.PromotionUsageUncheckedCreateInput) {
    return db.promotionUsage.create({ data });
  },

  createAppointmentDiscount(db: Db, data: Prisma.AppointmentDiscountUncheckedCreateInput) {
    return db.appointmentDiscount.create({ data });
  },

  usagesOfAppointment(db: Db, appointmentId: string) {
    return db.promotionUsage.findMany({ where: { appointmentId }, include: { promotion: { include: promotionInclude } } });
  },

  setUsageStatus(db: Db, appointmentId: string, from: "RESERVED", to: "CONSUMED" | "RELEASED", promotionIds?: string[]) {
    return db.promotionUsage.updateMany({
      where: { appointmentId, status: from, ...(promotionIds ? { promotionId: { in: promotionIds } } : {}) },
      data: { status: to },
    });
  },

  endExpiredPromotions(now: Date) {
    return prisma.promotion.updateMany({ where: { status: "ACTIVE", endsAt: { lt: now } }, data: { status: "ENDED" } });
  },

  /* ---------------- Serviços exclusivos ---------------- */

  membersOnlyServiceIds(businessId: string) {
    return prisma.service.findMany({ where: { businessId, membersOnly: true, active: true }, select: { id: true } });
  },

  setMembersOnly(businessId: string, serviceIds: string[]) {
    return prisma.$transaction([
      prisma.service.updateMany({ where: { businessId, id: { notIn: serviceIds } }, data: { membersOnly: false } }),
      prisma.service.updateMany({ where: { businessId, id: { in: serviceIds } }, data: { membersOnly: true } }),
    ]);
  },

  servicesOfBusiness(businessId: string, ids: string[]) {
    return prisma.service.findMany({ where: { businessId, id: { in: ids } }, select: { id: true } });
  },

  /* ---------------- Registo ---------------- */

  audit(data: { businessId: string; actorId: string; action: string; entityType: string; entityId?: string | null; details?: Prisma.InputJsonValue }) {
    return prisma.loyaltyAuditLog.create({ data });
  },

  /* ---------------- Visão geral ---------------- */

  memberCounts(businessId: string, since: Date) {
    return Promise.all([
      prisma.loyaltyMember.count({ where: { businessId, status: { not: "LEFT" } } }),
      prisma.loyaltyMember.count({ where: { businessId, status: "ACTIVE" } }),
      prisma.loyaltyMember.count({ where: { businessId, status: { not: "LEFT" }, joinedAt: { gte: since } } }),
    ]);
  },
};

export { promotionInclude };
