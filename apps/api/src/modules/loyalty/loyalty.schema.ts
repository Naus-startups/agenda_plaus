import { z } from "zod";
import { longText, shortText } from "../../shared/validation/fields";

const MAX_AMOUNT = 99_999_999.99;
const isoDateTime = z.iso.datetime({ offset: true });
const nullableDate = isoDateTime.nullable().optional();
const serviceIds = z.array(z.guid()).max(200).default([]);
const discount = {
  discountType: z.enum(["PERCENT", "AMOUNT", "FREE"]),
  discountValue: z.number().nonnegative().max(MAX_AMOUNT).default(0),
};

// A percentagem nunca passa de 100, e "grátis" não precisa de valor.
function validDiscount(value: { discountType: string; discountValue: number }) {
  return value.discountType !== "PERCENT" || value.discountValue <= 100;
}
const discountMessage = { message: "A percentagem de desconto tem de estar entre 0 e 100.", path: ["discountValue"] };

export const programSchema = z.object({
  active: z.boolean(),
  name: shortText(80).pipe(z.string().min(2)),
  description: longText(2000).nullable().optional(),
  joinRules: longText(2000).nullable().optional(),
  terms: longText(4000).nullable().optional(),
  pointsEnabled: z.boolean(),
  pointsPerUnit: z.number().int().min(1).max(100_000),
  amountPerUnit: z.number().int().min(1).max(10_000_000),
  pointsExpireDays: z.number().int().min(1).max(3650).nullable().optional(),
});

export const benefitSchema = z.object({
  title: shortText(120).pipe(z.string().min(2)),
  description: longText(2000).nullable().optional(),
  conditions: longText(2000).nullable().optional(),
  validFrom: nullableDate,
  validUntil: nullableDate,
  active: z.boolean().default(true),
});

export const rewardSchema = z
  .object({
    name: shortText(120).pipe(z.string().min(2)),
    description: longText(2000).nullable().optional(),
    kind: z.enum(["POINTS", "VISITS", "BIRTHDAY"]),
    pointsCost: z.number().int().min(1).max(10_000_000).nullable().optional(),
    visitsRequired: z.number().int().min(1).max(1000).nullable().optional(),
    ...discount,
    validDays: z.number().int().min(1).max(3650).nullable().optional(),
    active: z.boolean().default(true),
    serviceIds,
  })
  .refine(validDiscount, discountMessage)
  .refine((value) => value.kind !== "POINTS" || Boolean(value.pointsCost), { message: "Indique quantos pontos custa a recompensa.", path: ["pointsCost"] })
  .refine((value) => value.kind !== "VISITS" || Boolean(value.visitsRequired), {
    message: "Indique ao fim de quantos serviços a recompensa fica disponível.",
    path: ["visitsRequired"],
  });

export const promotionSchema = z
  .object({
    name: shortText(120).pipe(z.string().min(2)),
    description: longText(2000).nullable().optional(),
    audience: z.enum(["ALL", "MEMBERS"]),
    ...discount,
    startsAt: nullableDate,
    endsAt: nullableDate,
    membersFrom: nullableDate,
    weekdays: z.array(z.number().int().min(1).max(7)).max(7).default([]),
    startMinute: z.number().int().min(0).max(1439).nullable().optional(),
    endMinute: z.number().int().min(1).max(1440).nullable().optional(),
    maxUses: z.number().int().min(1).max(1_000_000).nullable().optional(),
    maxUsesPerClient: z.number().int().min(1).max(1000).nullable().optional(),
    stackable: z.boolean().default(false),
    releaseOnCancel: z.boolean().default(true),
    serviceIds,
  })
  .refine(validDiscount, discountMessage)
  .refine((value) => !value.startsAt || !value.endsAt || Date.parse(value.startsAt) < Date.parse(value.endsAt), { message: "O fim tem de ser depois do início.", path: ["endsAt"] })
  .refine((value) => value.startMinute == null || value.endMinute == null || value.startMinute < value.endMinute, {
    message: "A hora de fim tem de ser depois da hora de início.",
    path: ["endMinute"],
  })
  .refine((value) => !value.membersFrom || !value.startsAt || Date.parse(value.membersFrom) <= Date.parse(value.startsAt), {
    message: "O acesso antecipado dos clientes tem de começar antes da promoção.",
    path: ["membersFrom"],
  });

export const promotionStatusSchema = z.object({ status: z.enum(["ACTIVE", "PAUSED", "ENDED"]) });

export const memberStatusSchema = z.object({
  status: z.enum(["ACTIVE", "SUSPENDED", "REMOVED"]),
  reason: shortText(300).optional(),
});

export const pointsAdjustmentSchema = z.object({
  points: z
    .number()
    .int()
    .min(-1_000_000)
    .max(1_000_000)
    .refine((value) => value !== 0, "Indique um número de pontos diferente de zero."),
  reason: shortText(300).pipe(z.string().min(3)),
});

export const servicesMembersOnlySchema = z.object({
  serviceIds: z.array(z.guid()).max(500),
});

export const quoteSchema = z.object({
  businessId: z.guid(),
  serviceId: z.guid(),
  scheduledAt: isoDateTime,
  memberRewardId: z.guid().optional(),
  pointsRewardId: z.guid().optional(),
});

export type ProgramInput = z.infer<typeof programSchema>;
export type BenefitInput = z.infer<typeof benefitSchema>;
export type RewardInput = z.infer<typeof rewardSchema>;
export type PromotionInput = z.infer<typeof promotionSchema>;
export type MemberStatusInput = z.infer<typeof memberStatusSchema>;
export type PointsAdjustmentInput = z.infer<typeof pointsAdjustmentSchema>;
export type QuoteInput = z.infer<typeof quoteSchema>;
