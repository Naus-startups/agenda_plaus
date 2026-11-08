import { describe, expect, it } from "vitest";
import {
  calculatePrice,
  localWeekdayAndMinute,
  pointsForAmount,
  pointsToExpire,
  promotionIneligibility,
  type PricingContext,
  type PricingPromotion,
} from "../src/modules/loyalty/loyalty.pricing";

const TZ = "Africa/Luanda";
// Terça-feira, 10:00 em Luanda.
const TUESDAY_10 = new Date("2026-11-10T09:00:00Z");
const NOW = new Date("2026-11-08T12:00:00Z");

function promotion(overrides: Partial<PricingPromotion> = {}): PricingPromotion {
  return {
    id: overrides.id ?? "p1",
    name: "Promoção",
    status: "ACTIVE",
    audience: "ALL",
    discountType: "PERCENT",
    discountValue: 10,
    startsAt: null,
    endsAt: null,
    membersFrom: null,
    weekdays: [],
    startMinute: null,
    endMinute: null,
    maxUses: null,
    maxUsesPerClient: null,
    stackable: false,
    serviceIds: [],
    usedCount: 0,
    usedByClient: 0,
    ...overrides,
  };
}

const context = (overrides: Partial<PricingContext> = {}): PricingContext => ({
  serviceId: "corte",
  basePrice: 3000,
  scheduledAt: TUESDAY_10,
  now: NOW,
  isMember: false,
  timeZone: TZ,
  ...overrides,
});

describe("preço de uma marcação", () => {
  it("cliente normal paga o preço do serviço; membro com 15% paga 2.550 Kz", () => {
    const members = promotion({ audience: "MEMBERS", discountValue: 15 });
    expect(calculatePrice(context(), [members], null).finalPrice).toBe(3000);

    const result = calculatePrice(context({ isMember: true }), [members], null);
    expect(result.finalPrice).toBe(2550);
    expect(result.discounts).toEqual([{ source: "PROMOTION", promotionId: "p1", label: "Promoção", amount: 450 }]);
  });

  it("só se aplica aos serviços escolhidos", () => {
    const onlyColour = promotion({ serviceIds: ["coloracao"] });
    expect(calculatePrice(context(), [onlyColour], null).finalPrice).toBe(3000);
    expect(calculatePrice(context({ serviceId: "coloracao" }), [onlyColour], null).finalPrice).toBe(2700);
  });

  it("às terças: 10% para todos só à terça-feira", () => {
    const tuesdays = promotion({ weekdays: [2] });
    expect(calculatePrice(context(), [tuesdays], null).finalPrice).toBe(2700);
    const wednesday = new Date("2026-11-11T09:00:00Z");
    expect(calculatePrice(context({ scheduledAt: wednesday }), [tuesdays], null).finalPrice).toBe(3000);
  });

  it("respeita o horário (hora de Luanda, não de UTC)", () => {
    const mornings = promotion({ startMinute: 9 * 60, endMinute: 12 * 60 });
    expect(promotionIneligibility(mornings, context())).toBeNull();
    expect(promotionIneligibility(mornings, context({ scheduledAt: new Date("2026-11-10T11:00:00Z") }))).toBe("TIME"); // 12:00
    expect(localWeekdayAndMinute(TUESDAY_10, TZ)).toEqual({ weekday: 2, minute: 600 });
  });

  it("não acumuláveis: fica a melhor; acumuláveis: somam-se sobre o que falta", () => {
    const ten = promotion({ id: "a", discountValue: 10 });
    const twenty = promotion({ id: "b", discountValue: 20 });
    expect(calculatePrice(context(), [ten, twenty], null).finalPrice).toBe(2400);

    const stack10 = promotion({ id: "a", discountValue: 10, stackable: true });
    const stack500 = promotion({ id: "b", discountType: "AMOUNT", discountValue: 500, stackable: true });
    // 3000 − 500 = 2500; − 10% = 2250
    const stacked = calculatePrice(context(), [stack10, stack500], null);
    expect(stacked.finalPrice).toBe(2250);
    expect(stacked.discountTotal).toBe(750);
  });

  it("o preço nunca fica negativo", () => {
    const huge = promotion({ discountType: "AMOUNT", discountValue: 10_000 });
    expect(calculatePrice(context(), [huge], null).finalPrice).toBe(0);
  });

  it("uma recompensa escolhida afasta as promoções não acumuláveis", () => {
    const exclusive = promotion({ discountValue: 50 });
    const free = { key: "memberReward:r1", label: "Corte grátis", discountType: "FREE" as const, discountValue: 0, serviceIds: [] };
    const result = calculatePrice(context({ isMember: true }), [exclusive], free);
    expect(result.finalPrice).toBe(0);
    expect(result.discounts.map((discount) => discount.source)).toEqual(["REWARD"]);
  });

  it("valida datas, acesso antecipado, esgotamento e limite por cliente", () => {
    const campaign = promotion({ startsAt: new Date("2026-11-09T00:00:00Z"), endsAt: new Date("2026-11-30T00:00:00Z") });
    expect(promotionIneligibility(campaign, context())).toBe("NOT_STARTED");
    expect(promotionIneligibility({ ...campaign, membersFrom: new Date("2026-11-01T00:00:00Z") }, context({ isMember: true }))).toBeNull();
    expect(promotionIneligibility(campaign, context({ now: new Date("2026-12-01T00:00:00Z") }))).toBe("ENDED");
    expect(promotionIneligibility(promotion({ maxUses: 20, usedCount: 20 }), context())).toBe("SOLD_OUT");
    expect(promotionIneligibility(promotion({ maxUsesPerClient: 1, usedByClient: 1 }), context())).toBe("CLIENT_LIMIT");
    expect(promotionIneligibility(promotion({ status: "PAUSED" }), context())).toBe("NOT_ACTIVE");
  });
});

describe("pontos", () => {
  it("10 pontos por cada 1.000 Kz pagos", () => {
    expect(pointsForAmount(2550, { pointsPerUnit: 10, amountPerUnit: 1000 })).toBe(20);
    expect(pointsForAmount(999, { pointsPerUnit: 10, amountPerUnit: 1000 })).toBe(0);
  });

  it("expiram os mais antigos primeiro, sem passar do saldo", () => {
    // Ganhou 100 que já expiraram; gastou 30: expiram 70.
    expect(pointsToExpire({ expiredEarned: 100, debitsExcludingExpiry: 30, alreadyExpired: 0, balance: 150 })).toBe(70);
    // A segunda passagem não expira nada de novo.
    expect(pointsToExpire({ expiredEarned: 100, debitsExcludingExpiry: 30, alreadyExpired: 70, balance: 80 })).toBe(0);
    // Gastou mais do que os pontos que expiraram: nada a expirar.
    expect(pointsToExpire({ expiredEarned: 50, debitsExcludingExpiry: 80, alreadyExpired: 0, balance: 20 })).toBe(0);
  });
});
