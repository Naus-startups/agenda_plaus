import request from "supertest";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { expirePoints, expireRewards, grantBirthdayRewards } from "../../src/modules/loyalty/loyalty.jobs";
import { onAppointmentPaid } from "../../src/modules/loyalty/loyalty.booking";
import { registerNotificationListeners } from "../../src/modules/notifications";
import { resetRateLimits } from "../../src/shared/middleware/rateLimit";
import { app, auth, createBusinessFixture, createUser, prisma, resetDatabase, type BusinessFixture } from "./helpers";

/*
 * Programa de membros, benefícios e promoções, de ponta a ponta pela API: adesão, preço
 * calculado no servidor, vagas promocionais, pontos, recompensas, cancelamentos e
 * permissões entre espaços.
 */

let a: BusinessFixture;
let b: BusinessFixture;

// Os avisos do programa passam pelos ouvintes das notificações, como no servidor.
beforeAll(() => registerNotificationListeners());

beforeEach(async () => {
  await resetDatabase();
  resetRateLimits();
  a = await createBusinessFixture("A");
  b = await createBusinessFixture("B");
  // O corte de 3.000 Kz dos exemplos.
  await prisma.service.update({ where: { id: a.service.id }, data: { price: 3000 } });
});

afterEach(() => vi.restoreAllMocks());

const base = (fx: BusinessFixture) => `/api/v1/businesses/${fx.business.id}/loyalty`;

// Um dia da semana (ISO 1-7) futuro às 10:00 de Luanda (09:00 UTC).
function nextWeekday(isoWeekday: number, weeksAhead = 0): string {
  const date = new Date();
  date.setUTCHours(9, 0, 0, 0);
  do date.setUTCDate(date.getUTCDate() + 1);
  while (((date.getUTCDay() + 6) % 7) + 1 !== isoWeekday);
  date.setUTCDate(date.getUTCDate() + 7 * weeksAhead);
  return date.toISOString();
}

let slot = 0;
// Horários diferentes para não chocarem na agenda do profissional.
function futureSlot(): string {
  const date = new Date(nextWeekday(3, 1));
  date.setUTCMinutes(date.getUTCMinutes() + 45 * slot++);
  return date.toISOString();
}

async function openProgram(fx: BusinessFixture, extra: Record<string, unknown> = {}) {
  const response = await request(app)
    .put(`${base(fx)}/program`)
    .set(auth(fx.owner.token))
    .send({ active: true, name: "Clube", pointsEnabled: true, pointsPerUnit: 10, amountPerUnit: 1000, ...extra });
  expect(response.status).toBe(200);
}

async function join(fx: BusinessFixture, token = fx.customer.token) {
  return request(app).post(`${base(fx)}/join`).set(auth(token));
}

async function createPromotion(fx: BusinessFixture, body: Record<string, unknown>, activate = true) {
  const created = await request(app)
    .post(`${base(fx)}/promotions`)
    .set(auth(fx.owner.token))
    .send({ name: "Promo", audience: "ALL", discountType: "PERCENT", discountValue: 10, ...body });
  expect(created.status).toBe(201);
  if (activate) {
    const activated = await request(app).patch(`${base(fx)}/promotions/${created.body.data.id}/status`).set(auth(fx.owner.token)).send({ status: "ACTIVE" });
    expect(activated.status).toBe(200);
  }
  return created.body.data as { id: string };
}

async function book(fx: BusinessFixture, token: string, extra: Record<string, unknown> = {}, professionalId = fx.professional.id) {
  return request(app)
    .post("/api/v1/appointments")
    .set(auth(token))
    .send({ businessId: fx.business.id, serviceId: fx.service.id, professionalId, scheduledAt: futureSlot(), ...extra });
}

// Leva o agendamento até "pago": passa a hora marcada e o espaço recebe o pagamento.
async function pay(fx: BusinessFixture, appointmentId: string) {
  await prisma.appointment.update({ where: { id: appointmentId }, data: { status: "CONFIRMED", scheduledAt: new Date(Date.now() - 60_000) } });
  const response = await request(app).post("/api/v1/payments/receive").set(auth(fx.owner.token)).send({ appointmentId, method: "CASH" });
  expect(response.status).toBe(201);
}

describe("adesão", () => {
  it("adere gratuitamente, não adere duas vezes e pode ser membro de vários espaços", async () => {
    // Sem programa ativo não há adesão.
    expect((await join(a)).status).toBe(409);

    await openProgram(a);
    await openProgram(b);

    const joined = await join(a);
    expect(joined.status).toBe(201);
    expect(joined.body.data.status).toBe("ACTIVE");
    expect(joined.body.data.plan).toBe("FREE");

    const again = await join(a);
    expect(again.status).toBe(409);
    expect(again.body.error.code).toBe("LOYALTY_ALREADY_MEMBER");

    // O cliente do espaço A pode também ser membro do B.
    expect((await join(b, a.customer.token)).status).toBe(201);
    const mine = await request(app).get("/api/v1/loyalty/memberships").set(auth(a.customer.token));
    expect(mine.body.data.map((m: { businessId: string }) => m.businessId).sort()).toEqual([a.business.id, b.business.id].sort());

    // Ao aderir passa também a ser cliente do espaço.
    expect(await prisma.businessClient.count({ where: { businessId: a.business.id, userId: a.customer.user.id } })).toBe(1);
  });

  it("dois pedidos de adesão ao mesmo tempo criam um só membro", async () => {
    await openProgram(a);
    const results = await Promise.all([join(a), join(a), join(a)]);
    expect(results.filter((r) => r.status === 201)).toHaveLength(1);
    expect(await prisma.loyaltyMember.count({ where: { businessId: a.business.id } })).toBe(1);
  });

  it("quem foi suspenso não volta sozinho nem tem preços de membro", async () => {
    await openProgram(a);
    const member = (await join(a)).body.data;
    await createPromotion(a, { audience: "MEMBERS", discountValue: 15 });

    const suspended = await request(app).patch(`${base(a)}/members/${member.id}/status`).set(auth(a.owner.token)).send({ status: "SUSPENDED", reason: "teste" });
    expect(suspended.status).toBe(200);

    await request(app).delete(`${base(a)}/membership`).set(auth(a.customer.token));
    expect((await join(a)).status).toBe(403);

    const booked = await book(a, a.customer.token);
    expect(booked.body.data.price).toBe(3000);
  });
});

describe("descontos na marcação", () => {
  it("cliente normal paga 3.000 Kz; membro com 15% paga 2.550 Kz, com a origem guardada", async () => {
    await openProgram(a);
    const promotion = await createPromotion(a, { name: "Membros 15%", audience: "MEMBERS", discountValue: 15 });

    const normal = await book(a, a.customer.token);
    expect(normal.status).toBe(201);
    expect(normal.body.data.price).toBe(3000);
    expect(normal.body.data.discountTotal).toBe(0);

    await join(a);
    const quote = await request(app)
      .post("/api/v1/loyalty/quote")
      .set(auth(a.customer.token))
      .send({ businessId: a.business.id, serviceId: a.service.id, scheduledAt: futureSlot() });
    expect(quote.body.data).toMatchObject({ originalPrice: 3000, finalPrice: 2550, isMember: true });

    const member = await book(a, a.customer.token, { expectedPrice: 2550 });
    expect(member.status).toBe(201);
    expect(member.body.data).toMatchObject({ price: 2550, originalPrice: 3000, discountTotal: 450 });

    const discounts = await prisma.appointmentDiscount.findMany({ where: { appointmentId: member.body.data.id } });
    expect(discounts).toHaveLength(1);
    expect(discounts[0]).toMatchObject({ source: "PROMOTION", promotionId: promotion.id, label: "Membros 15%" });
    expect(discounts[0].amount.toNumber()).toBe(450);
  });

  it("10% para todos às terças-feiras, e só às terças", async () => {
    await createPromotion(a, { name: "Terças", audience: "ALL", discountValue: 10, weekdays: [2] });

    const tuesday = await book(a, a.customer.token, { scheduledAt: nextWeekday(2) });
    expect(tuesday.body.data.price).toBe(2700);
    const thursday = await book(a, a.customer.token, { scheduledAt: nextWeekday(4) });
    expect(thursday.body.data.price).toBe(3000);
  });

  it("o preço é sempre do servidor: um preço diferente do calculado é recusado", async () => {
    const response = await book(a, a.customer.token, { expectedPrice: 1, price: 1, discountTotal: 2999 });
    expect(response.status).toBe(409);
    expect(response.body.error.code).toBe("APPOINTMENT_PRICE_CHANGED");

    const ignored = await book(a, a.customer.token, { price: 1, discountTotal: 2999 });
    expect(ignored.body.data.price).toBe(3000);
  });

  it("serviços exclusivos só se marcam sendo membro", async () => {
    await openProgram(a);
    await request(app).put(`${base(a)}/members-only-services`).set(auth(a.owner.token)).send({ serviceIds: [a.service.id] }).expect(200);

    const refused = await book(a, a.customer.token);
    expect(refused.status).toBe(403);
    expect(refused.body.error.code).toBe("SERVICE_MEMBERS_ONLY");

    await join(a);
    expect((await book(a, a.customer.token)).status).toBe(201);
  });
});

describe("vagas e limites das promoções", () => {
  it("limite por cliente: a segunda marcação já não tem desconto", async () => {
    await createPromotion(a, { maxUsesPerClient: 1 });
    expect((await book(a, a.customer.token)).body.data.price).toBe(2700);
    expect((await book(a, a.customer.token)).body.data.price).toBe(3000);
  });

  it("última vaga: dois clientes ao mesmo tempo, só um a consegue", async () => {
    await createPromotion(a, { maxUses: 1 });
    const other = await createUser("CUSTOMER");
    // Profissionais diferentes: o bloqueio da agenda não os põe em fila, só a vaga da promoção.
    const employee = await createUser("EMPLOYEE");
    const second = await prisma.professional.create({ data: { businessId: a.business.id, userId: employee.user.id } });

    const results = await Promise.all([
      book(a, a.customer.token, { expectedPrice: 2700 }),
      book(a, other.token, { expectedPrice: 2700 }, second.id),
    ]);
    expect(results.map((r) => r.status).sort()).toEqual([201, 409]);
    expect(await prisma.promotionUsage.count({ where: { status: "RESERVED" } })).toBe(1);
  });

  it("cancelar liberta a vaga para outro cliente", async () => {
    await createPromotion(a, { maxUses: 1 });
    const first = await book(a, a.customer.token);
    expect(first.body.data.price).toBe(2700);

    const other = await createUser("CUSTOMER");
    expect((await book(a, other.token)).body.data.price).toBe(3000);

    await request(app).patch(`/api/v1/appointments/${first.body.data.id}/cancel`).set(auth(a.customer.token)).expect(200);
    expect((await book(a, other.token)).body.data.price).toBe(2700);
  });

  it("uma campanha pode não devolver as vagas de marcações canceladas", async () => {
    await createPromotion(a, { maxUses: 1, releaseOnCancel: false });
    const first = await book(a, a.customer.token);
    await request(app).patch(`/api/v1/appointments/${first.body.data.id}/cancel`).set(auth(a.customer.token)).expect(200);
    expect((await book(a, a.customer.token)).body.data.price).toBe(3000);
  });

  it("reagendar para fora das condições da promoção é recusado", async () => {
    await createPromotion(a, { weekdays: [2] });
    const booked = await book(a, a.customer.token, { scheduledAt: nextWeekday(2) });
    const moved = await request(app)
      .patch(`/api/v1/appointments/${booked.body.data.id}/reschedule`)
      .set(auth(a.customer.token))
      .send({ scheduledAt: nextWeekday(4) });
    expect(moved.status).toBe(409);
    expect(moved.body.error.code).toBe("PROMOTION_NOT_VALID_AT_NEW_TIME");
  });
});

describe("pontos e recompensas", () => {
  it("pontos só depois de pago, sem duplicar, e retirados num reembolso", async () => {
    await openProgram(a);
    await join(a);
    const booked = await book(a, a.customer.token);
    const member = () => prisma.loyaltyMember.findFirstOrThrow({ where: { businessId: a.business.id } });

    expect((await member()).pointsBalance).toBe(0);
    await pay(a, booked.body.data.id);
    expect((await member()).pointsBalance).toBe(30); // 3.000 Kz → 30 pontos

    // A mesma notificação de pagamento outra vez não dá pontos outra vez.
    await onAppointmentPaid(booked.body.data.id);
    await onAppointmentPaid(booked.body.data.id);
    expect((await member()).pointsBalance).toBe(30);
    expect(await prisma.loyaltyTransaction.count({ where: { type: "EARN" } })).toBe(1);

    const payment = await prisma.payment.findUniqueOrThrow({ where: { appointmentId: booked.body.data.id } });
    await request(app).patch(`/api/v1/payments/${payment.id}/refund`).set(auth(a.owner.token)).expect(200);
    expect((await member()).pointsBalance).toBe(0);
  });

  it("um serviço grátis depois de 2 serviços pagos; ao cancelar a marcação a recompensa volta", async () => {
    await openProgram(a);
    await join(a);
    await request(app)
      .post(`${base(a)}/rewards`)
      .set(auth(a.owner.token))
      .send({ name: "Corte grátis", kind: "VISITS", visitsRequired: 2, discountType: "FREE" })
      .expect(201);

    for (let i = 0; i < 2; i++) await pay(a, (await book(a, a.customer.token)).body.data.id);
    const unlocked = await prisma.memberReward.findFirstOrThrow({ where: { status: "AVAILABLE" } });

    const free = await book(a, a.customer.token, { memberRewardId: unlocked.id, expectedPrice: 0 });
    expect(free.status).toBe(201);
    expect(free.body.data.price).toBe(0);
    expect((await prisma.memberReward.findUniqueOrThrow({ where: { id: unlocked.id } })).status).toBe("RESERVED");

    // Não se usa a mesma recompensa duas vezes.
    expect((await book(a, a.customer.token, { memberRewardId: unlocked.id })).status).toBe(409);

    await request(app).patch(`/api/v1/appointments/${free.body.data.id}/cancel`).set(auth(a.customer.token)).expect(200);
    expect((await prisma.memberReward.findUniqueOrThrow({ where: { id: unlocked.id } })).status).toBe("AVAILABLE");
  });

  it("resgate com pontos: debita ao marcar, devolve ao cancelar, recusa sem saldo", async () => {
    await openProgram(a);
    const member = (await join(a)).body.data;
    const reward = await request(app)
      .post(`${base(a)}/rewards`)
      .set(auth(a.owner.token))
      .send({ name: "1.000 Kz de desconto", kind: "POINTS", pointsCost: 50, discountType: "AMOUNT", discountValue: 1000 });

    expect((await book(a, a.customer.token, { pointsRewardId: reward.body.data.id })).status).toBe(409);

    await request(app).post(`${base(a)}/members/${member.id}/adjustments`).set(auth(a.owner.token)).send({ points: 60, reason: "Oferta de boas-vindas" }).expect(201);
    const booked = await book(a, a.customer.token, { pointsRewardId: reward.body.data.id });
    expect(booked.body.data.price).toBe(2000);
    expect((await prisma.loyaltyMember.findUniqueOrThrow({ where: { id: member.id } })).pointsBalance).toBe(10);

    await request(app).patch(`/api/v1/appointments/${booked.body.data.id}/cancel`).set(auth(a.customer.token)).expect(200);
    expect((await prisma.loyaltyMember.findUniqueOrThrow({ where: { id: member.id } })).pointsBalance).toBe(60);
  });

  it("recompensas e pontos expiram; aniversários dão a recompensa uma vez", async () => {
    await openProgram(a, { pointsExpireDays: 30 });
    const member = (await join(a)).body.data;
    const reward = (
      await request(app).post(`${base(a)}/rewards`).set(auth(a.owner.token)).send({ name: "Prenda", kind: "BIRTHDAY", discountType: "PERCENT", discountValue: 50 })
    ).body.data;

    // Aniversário este mês: recebe a recompensa, e só uma vez.
    const today = new Date();
    await prisma.user.update({ where: { id: a.customer.user.id }, data: { birthDate: new Date(Date.UTC(1990, today.getUTCMonth(), 15)) } });
    expect(await grantBirthdayRewards()).toBe(1);
    expect(await grantBirthdayRewards()).toBe(0);

    // Passado o prazo, expira e já não serve numa marcação.
    const gift = await prisma.memberReward.findFirstOrThrow({ where: { rewardId: reward.id } });
    await prisma.memberReward.update({ where: { id: gift.id }, data: { expiresAt: new Date(Date.now() - 1000) } });
    await expireRewards();
    expect((await prisma.memberReward.findUniqueOrThrow({ where: { id: gift.id } })).status).toBe("EXPIRED");
    expect((await book(a, a.customer.token, { memberRewardId: gift.id })).status).toBe(409);

    // Pontos ganhos que passaram da validade saem do saldo.
    await pay(a, (await book(a, a.customer.token)).body.data.id);
    await prisma.loyaltyTransaction.updateMany({ where: { type: "EARN" }, data: { expiresAt: new Date(Date.now() - 1000) } });
    await expirePoints();
    await expirePoints();
    expect((await prisma.loyaltyMember.findUniqueOrThrow({ where: { id: member.id } })).pointsBalance).toBe(0);
    expect(await prisma.loyaltyTransaction.count({ where: { type: "EXPIRE" } })).toBe(1);
  });

  it("benefícios fora da validade não aparecem na app", async () => {
    await openProgram(a);
    const yesterday = new Date(Date.now() - 24 * 3600_000).toISOString();
    await request(app).post(`${base(a)}/benefits`).set(auth(a.owner.token)).send({ title: "Atendimento prioritário" }).expect(201);
    await request(app).post(`${base(a)}/benefits`).set(auth(a.owner.token)).send({ title: "Campanha antiga", validUntil: yesterday }).expect(201);

    const info = await request(app).get(base(a));
    expect(info.body.data.benefits.map((benefit: { title: string }) => benefit.title)).toEqual(["Atendimento prioritário"]);
  });
});

describe("permissões e isolamento", () => {
  it("o dono de outro espaço não vê nem altera nada deste", async () => {
    await openProgram(a);
    const member = (await join(a)).body.data;
    const promotion = await createPromotion(a, {});

    expect((await request(app).get(`${base(a)}/members`).set(auth(b.owner.token))).status).toBe(403);
    expect((await request(app).get(`${base(a)}/overview`).set(auth(b.owner.token))).status).toBe(403);
    // Pela URL do próprio espaço, com o id de uma linha do outro: não existe.
    expect((await request(app).get(`${base(b)}/members/${member.id}`).set(auth(b.owner.token))).status).toBe(404);
    expect((await request(app).patch(`${base(b)}/promotions/${promotion.id}/status`).set(auth(b.owner.token)).send({ status: "ENDED" })).status).toBe(404);
    expect((await request(app).post(`${base(b)}/members/${member.id}/adjustments`).set(auth(b.owner.token)).send({ points: 999, reason: "fraude" })).status).toBe(404);
    // Uma promoção não pode apontar para serviços de outro espaço.
    const foreign = await request(app).post(`${base(b)}/promotions`).set(auth(b.owner.token)).send({ name: "X", audience: "ALL", discountType: "FREE", serviceIds: [a.service.id] });
    expect(foreign.status).toBe(400);
  });

  it("só o dono configura; a equipa consulta; o cliente não mexe no seu estado nem nos pontos", async () => {
    await openProgram(a);
    const member = (await join(a)).body.data;

    expect((await request(app).get(`${base(a)}/members`).set(auth(a.employee.token))).status).toBe(200);
    expect((await request(app).post(`${base(a)}/promotions`).set(auth(a.employee.token)).send({ name: "X", audience: "ALL", discountType: "FREE" })).status).toBe(403);
    expect((await request(app).put(`${base(a)}/program`).set(auth(a.employee.token)).send({ active: false, name: "X", pointsEnabled: false, pointsPerUnit: 1, amountPerUnit: 1 })).status).toBe(403);

    expect((await request(app).patch(`${base(a)}/members/${member.id}/status`).set(auth(a.customer.token)).send({ status: "ACTIVE" })).status).toBe(403);
    expect((await request(app).post(`${base(a)}/members/${member.id}/adjustments`).set(auth(a.customer.token)).send({ points: 1000, reason: "eu" })).status).toBe(403);
    expect((await prisma.loyaltyMember.findUniqueOrThrow({ where: { id: member.id } })).pointsBalance).toBe(0);
  });

  it("retirar mais pontos do que o saldo é recusado, e fica registado o que o dono fez", async () => {
    await openProgram(a);
    const member = (await join(a)).body.data;
    const response = await request(app).post(`${base(a)}/members/${member.id}/adjustments`).set(auth(a.owner.token)).send({ points: -5, reason: "erro" });
    expect(response.status).toBe(400);
    expect(await prisma.loyaltyAuditLog.count({ where: { businessId: a.business.id, action: "PROGRAM_SAVED" } })).toBe(1);
  });

  it("os membros que não querem promoções não são avisados delas", async () => {
    await openProgram(a);
    await join(a);
    await prisma.user.update({ where: { id: a.customer.user.id }, data: { notifyPromotions: false } });
    await createPromotion(a, { audience: "MEMBERS" });
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(await prisma.notification.count({ where: { userId: a.customer.user.id, type: "LOYALTY_NEW_PROMOTION" } })).toBe(0);

    await prisma.user.update({ where: { id: a.customer.user.id }, data: { notifyPromotions: true } });
    await createPromotion(a, { name: "Outra", audience: "MEMBERS" });
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(await prisma.notification.count({ where: { userId: a.customer.user.id, type: "LOYALTY_NEW_PROMOTION" } })).toBe(1);
  });
});
