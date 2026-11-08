import { zonedDateKey } from "../../shared/utils/timezone";

/*
 * O preço de uma marcação: o do serviço, menos as promoções que se aplicam e a recompensa
 * que o cliente escolheu usar. Tudo aqui é cálculo puro, sem base de dados — o mesmo
 * cálculo serve a pré-visualização (quote) e a marcação, que o repete com os dados
 * bloqueados na transação. Nunca se aceita um preço vindo da app.
 *
 * Regras de combinação:
 *  - uma promoção "não acumulável" aplica-se sozinha;
 *  - as acumuláveis aplicam-se todas, uma a seguir à outra, sobre o que ainda falta pagar;
 *  - fica a opção que dá o maior desconto (a melhor não acumulável, ou a soma das acumuláveis);
 *  - uma recompensa escolhida pelo cliente aplica-se sempre: junta-se às acumuláveis e
 *    afasta as não acumuláveis.
 */

export type DiscountKind = "PERCENT" | "AMOUNT" | "FREE";

export interface PricingPromotion {
  id: string;
  name: string;
  status: "DRAFT" | "ACTIVE" | "PAUSED" | "ENDED";
  audience: "ALL" | "MEMBERS";
  discountType: DiscountKind;
  discountValue: number;
  startsAt: Date | null;
  endsAt: Date | null;
  membersFrom: Date | null;
  weekdays: number[];
  startMinute: number | null;
  endMinute: number | null;
  maxUses: number | null;
  maxUsesPerClient: number | null;
  stackable: boolean;
  releaseOnCancel?: boolean;
  serviceIds: string[];
  // Usos que contam (reservados e consumidos), no total e deste cliente.
  usedCount: number;
  usedByClient: number;
}

export interface PricingReward {
  // memberReward:<id> ou pointsReward:<id>
  key: string;
  label: string;
  discountType: DiscountKind;
  discountValue: number;
  serviceIds: string[];
}

export interface PricingContext {
  serviceId: string;
  basePrice: number;
  scheduledAt: Date;
  now: Date;
  isMember: boolean;
  timeZone: string;
}

export interface AppliedDiscount {
  source: "PROMOTION" | "REWARD";
  promotionId?: string;
  rewardKey?: string;
  label: string;
  amount: number;
}

export interface PriceResult {
  originalPrice: number;
  discounts: AppliedDiscount[];
  discountTotal: number;
  finalPrice: number;
}

export type Ineligibility =
  | "NOT_ACTIVE"
  | "MEMBERS_ONLY"
  | "SERVICE"
  | "NOT_STARTED"
  | "ENDED"
  | "OUTSIDE_PERIOD"
  | "WEEKDAY"
  | "TIME"
  | "SOLD_OUT"
  | "CLIENT_LIMIT";

const round = (value: number) => Math.round(value * 100) / 100;

// Dia da semana ISO (1 = segunda … 7 = domingo) e minutos desde a meia-noite, no fuso da app.
export function localWeekdayAndMinute(instant: Date, timeZone: string): { weekday: number; minute: number } {
  const key = zonedDateKey(instant, timeZone);
  const sunday0 = new Date(`${key}T12:00:00Z`).getUTCDay();
  const time = new Intl.DateTimeFormat("en-GB", { timeZone, hour: "2-digit", minute: "2-digit", hour12: false }).format(instant);
  const [hours, minutes] = time.split(":").map(Number);
  return { weekday: sunday0 === 0 ? 7 : sunday0, minute: (hours % 24) * 60 + minutes };
}

export function appliesToService(serviceIds: string[], serviceId: string): boolean {
  return serviceIds.length === 0 || serviceIds.includes(serviceId);
}

// Porque é que a promoção não serve para esta marcação (null = serve).
export function promotionIneligibility(promotion: PricingPromotion, context: PricingContext): Ineligibility | null {
  if (promotion.status !== "ACTIVE") return "NOT_ACTIVE";
  if (promotion.audience === "MEMBERS" && !context.isMember) return "MEMBERS_ONLY";
  if (!appliesToService(promotion.serviceIds, context.serviceId)) return "SERVICE";

  // As marcações abrem em startsAt — ou antes, em membersFrom, para os membros (acesso antecipado).
  const opensAt = context.isMember && promotion.membersFrom ? promotion.membersFrom : promotion.startsAt;
  if (opensAt && context.now < opensAt) return "NOT_STARTED";
  if (promotion.endsAt && context.now > promotion.endsAt) return "ENDED";
  // A marcação tem de ser para dentro do período da campanha.
  if (promotion.endsAt && context.scheduledAt > promotion.endsAt) return "OUTSIDE_PERIOD";
  if (promotion.startsAt && !promotion.membersFrom && context.scheduledAt < promotion.startsAt) return "OUTSIDE_PERIOD";

  const { weekday, minute } = localWeekdayAndMinute(context.scheduledAt, context.timeZone);
  if (promotion.weekdays.length > 0 && !promotion.weekdays.includes(weekday)) return "WEEKDAY";
  if (promotion.startMinute !== null && minute < promotion.startMinute) return "TIME";
  if (promotion.endMinute !== null && minute >= promotion.endMinute) return "TIME";

  if (promotion.maxUses !== null && promotion.usedCount >= promotion.maxUses) return "SOLD_OUT";
  if (promotion.maxUsesPerClient !== null && promotion.usedByClient >= promotion.maxUsesPerClient) return "CLIENT_LIMIT";
  return null;
}

function discountOn(price: number, type: DiscountKind, value: number): number {
  if (price <= 0) return 0;
  const raw = type === "FREE" ? price : type === "PERCENT" ? (price * Math.min(Math.max(value, 0), 100)) / 100 : Math.max(value, 0);
  return round(Math.min(raw, price));
}

// Aplica os descontos por ordem, cada um sobre o que ainda falta pagar.
function applyInOrder(basePrice: number, items: { discount: Omit<AppliedDiscount, "amount">; type: DiscountKind; value: number }[]): AppliedDiscount[] {
  let remaining = basePrice;
  const applied: AppliedDiscount[] = [];
  for (const item of items) {
    const amount = discountOn(remaining, item.type, item.value);
    if (amount <= 0) continue;
    remaining = round(remaining - amount);
    applied.push({ ...item.discount, amount });
  }
  return applied;
}

const total = (discounts: AppliedDiscount[]) => round(discounts.reduce((sum, discount) => sum + discount.amount, 0));

export function calculatePrice(context: PricingContext, promotions: PricingPromotion[], reward: PricingReward | null): PriceResult {
  const basePrice = round(context.basePrice);
  const eligible = promotions.filter((promotion) => promotionIneligibility(promotion, context) === null);

  const asItem = (promotion: PricingPromotion) => ({
    discount: { source: "PROMOTION" as const, promotionId: promotion.id, label: promotion.name },
    type: promotion.discountType,
    value: promotion.discountValue,
  });
  // As maiores primeiro, para o resultado não depender da ordem em que vieram da base.
  const byValue = (a: PricingPromotion, b: PricingPromotion) =>
    discountOn(basePrice, b.discountType, b.discountValue) - discountOn(basePrice, a.discountType, a.discountValue) || a.id.localeCompare(b.id);

  const stackable = eligible.filter((promotion) => promotion.stackable).sort(byValue);
  const exclusive = eligible.filter((promotion) => !promotion.stackable).sort(byValue);

  let discounts: AppliedDiscount[];
  if (reward && appliesToService(reward.serviceIds, context.serviceId)) {
    discounts = applyInOrder(basePrice, [
      ...stackable.map(asItem),
      { discount: { source: "REWARD", rewardKey: reward.key, label: reward.label }, type: reward.discountType, value: reward.discountValue },
    ]);
  } else {
    const stacked = applyInOrder(basePrice, stackable.map(asItem));
    const single = exclusive.length > 0 ? applyInOrder(basePrice, [asItem(exclusive[0])]) : [];
    discounts = total(single) > total(stacked) ? single : stacked;
  }

  const discountTotal = total(discounts);
  return { originalPrice: basePrice, discounts, discountTotal, finalPrice: round(Math.max(basePrice - discountTotal, 0)) };
}

// Quantos pontos vale um pagamento, segundo o programa do espaço.
export function pointsForAmount(amountPaid: number, program: { pointsPerUnit: number; amountPerUnit: number }): number {
  if (program.amountPerUnit <= 0 || program.pointsPerUnit <= 0 || amountPaid <= 0) return 0;
  return Math.floor(amountPaid / program.amountPerUnit) * program.pointsPerUnit;
}

/*
 * Pontos a expirar agora, com a regra "os mais antigos gastam-se primeiro": os pontos
 * ganhos que já passaram da validade, menos tudo o que já saiu do saldo (gastos,
 * retirados, expirados antes). Nunca negativo, nunca mais do que o saldo.
 */
export function pointsToExpire(input: { expiredEarned: number; debitsExcludingExpiry: number; alreadyExpired: number; balance: number }): number {
  const due = input.expiredEarned - input.debitsExcludingExpiry - input.alreadyExpired;
  return Math.max(0, Math.min(due, input.balance));
}
