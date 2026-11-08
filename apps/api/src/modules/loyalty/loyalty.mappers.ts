import type {
  LoyaltyBenefitDTO,
  LoyaltyProgramDTO,
  LoyaltyRewardDTO,
  LoyaltyTransactionDTO,
  MemberRewardDTO,
  PromotionDTO,
} from "@slotix/types";
import type { LoyaltyBenefit, LoyaltyProgram, LoyaltyTransaction } from "@prisma/client";
import type { PricingPromotion } from "./loyalty.pricing";
import type { MemberRewardRow, PromotionRow, RewardRow } from "./loyalty.repository";

const iso = (date: Date | null) => date?.toISOString() ?? null;

export function toProgramDTO(program: LoyaltyProgram): LoyaltyProgramDTO {
  return {
    businessId: program.businessId,
    active: program.active,
    name: program.name,
    description: program.description,
    joinRules: program.joinRules,
    terms: program.terms,
    pointsEnabled: program.pointsEnabled,
    pointsPerUnit: program.pointsPerUnit,
    amountPerUnit: program.amountPerUnit,
    pointsExpireDays: program.pointsExpireDays,
  };
}

export function toBenefitDTO(benefit: LoyaltyBenefit): LoyaltyBenefitDTO {
  return {
    id: benefit.id,
    title: benefit.title,
    description: benefit.description,
    conditions: benefit.conditions,
    validFrom: iso(benefit.validFrom),
    validUntil: iso(benefit.validUntil),
    active: benefit.active,
  };
}

export function toRewardDTO(reward: RewardRow): LoyaltyRewardDTO {
  return {
    id: reward.id,
    name: reward.name,
    description: reward.description,
    kind: reward.kind,
    pointsCost: reward.pointsCost,
    visitsRequired: reward.visitsRequired,
    discountType: reward.discountType,
    discountValue: reward.discountValue.toNumber(),
    validDays: reward.validDays,
    active: reward.active,
    serviceIds: reward.services.map((service) => service.serviceId),
  };
}

export function toPromotionDTO(promotion: PromotionRow, usedCount = 0): PromotionDTO {
  return {
    id: promotion.id,
    name: promotion.name,
    description: promotion.description,
    audience: promotion.audience,
    status: promotion.status,
    discountType: promotion.discountType,
    discountValue: promotion.discountValue.toNumber(),
    startsAt: iso(promotion.startsAt),
    endsAt: iso(promotion.endsAt),
    membersFrom: iso(promotion.membersFrom),
    weekdays: promotion.weekdays,
    startMinute: promotion.startMinute,
    endMinute: promotion.endMinute,
    maxUses: promotion.maxUses,
    maxUsesPerClient: promotion.maxUsesPerClient,
    stackable: promotion.stackable,
    releaseOnCancel: promotion.releaseOnCancel,
    serviceIds: promotion.services.map((service) => service.serviceId),
    usedCount,
    remaining: promotion.maxUses === null ? null : Math.max(promotion.maxUses - usedCount, 0),
  };
}

export function toPricingPromotion(promotion: PromotionRow, usedCount: number, usedByClient: number): PricingPromotion {
  return {
    id: promotion.id,
    name: promotion.name,
    status: promotion.status,
    audience: promotion.audience,
    discountType: promotion.discountType,
    discountValue: promotion.discountValue.toNumber(),
    startsAt: promotion.startsAt,
    endsAt: promotion.endsAt,
    membersFrom: promotion.membersFrom,
    weekdays: promotion.weekdays,
    startMinute: promotion.startMinute,
    endMinute: promotion.endMinute,
    maxUses: promotion.maxUses,
    maxUsesPerClient: promotion.maxUsesPerClient,
    stackable: promotion.stackable,
    releaseOnCancel: promotion.releaseOnCancel,
    serviceIds: promotion.services.map((service) => service.serviceId),
    usedCount,
    usedByClient,
  };
}

export function toMemberRewardDTO(memberReward: MemberRewardRow): MemberRewardDTO {
  return {
    id: memberReward.id,
    rewardId: memberReward.rewardId,
    name: memberReward.reward.name,
    description: memberReward.reward.description,
    kind: memberReward.reward.kind,
    discountType: memberReward.reward.discountType,
    discountValue: memberReward.reward.discountValue.toNumber(),
    serviceIds: memberReward.reward.services.map((service) => service.serviceId),
    status: memberReward.status,
    expiresAt: iso(memberReward.expiresAt),
    createdAt: memberReward.createdAt.toISOString(),
  };
}

export function toTransactionDTO(transaction: LoyaltyTransaction): LoyaltyTransactionDTO {
  return {
    id: transaction.id,
    type: transaction.type,
    points: transaction.points,
    balanceAfter: transaction.balanceAfter,
    reason: transaction.reason,
    appointmentId: transaction.appointmentId,
    expiresAt: iso(transaction.expiresAt),
    createdAt: transaction.createdAt.toISOString(),
  };
}

// How a discount reads to people: "15%", "500 Kz", "Grátis".
export function discountLabel(type: "PERCENT" | "AMOUNT" | "FREE", value: number): string {
  if (type === "FREE") return "Grátis";
  if (type === "PERCENT") return `${value}%`;
  return `${value.toLocaleString("pt-PT")} Kz`;
}
