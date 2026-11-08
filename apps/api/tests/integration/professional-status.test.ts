import request from "supertest";
import { beforeEach, describe, expect, it } from "vitest";
import { resetRateLimits } from "../../src/shared/middleware/rateLimit";
import { app, auth, createAppointment, createBusinessFixture, prisma, resetDatabase, type BusinessFixture } from "./helpers";

let a: BusinessFixture;
let b: BusinessFixture;

beforeEach(async () => {
  await resetDatabase();
  resetRateLimits();
  a = await createBusinessFixture("A");
  b = await createBusinessFixture("B");
});

const statusOf = async (fx: BusinessFixture) => {
  const response = await request(app).get(`/api/v1/businesses/${fx.business.id}/professionals/status`);
  expect(response.status).toBe(200);
  return response.body.data.find((item: { professionalId: string }) => item.professionalId === fx.professional.id);
};

describe("estado dos profissionais na app", () => {
  it("livre; a atender com os minutos até ficar livre; e livre de novo quando conclui", async () => {
    expect((await statusOf(a)).status).toBe("AVAILABLE");

    // Começou há 10 minutos e dura 30: fica livre dentro de ~20 minutos.
    const now = await createAppointment(a, { status: "CONFIRMED", scheduledAt: new Date(Date.now() - 10 * 60_000) });
    const busy = await statusOf(a);
    expect(busy.status).toBe("BUSY");
    expect(busy.minutesUntilFree).toBeGreaterThanOrEqual(19);
    expect(busy.minutesUntilFree).toBeLessThanOrEqual(21);
    // Nada sobre o cliente que está a ser atendido.
    expect(JSON.stringify(busy)).not.toContain(a.customer.user.name);

    await prisma.appointment.update({ where: { id: now.id }, data: { status: "COMPLETED" } });
    expect((await statusOf(a)).status).toBe("AVAILABLE");
  });

  it("ausente hoje: aparece como ausente, sem horários para hoje; presente volta a estar livre", async () => {
    await request(app).post(`/api/v1/professionals/${a.professional.id}/absence`).set(auth(a.owner.token)).send({ reason: "Doente" }).expect(201);

    const away = await statusOf(a);
    expect(away).toMatchObject({ status: "AWAY", until: null, reason: null });

    // Não se consegue marcar com ele daqui a uma hora (se ainda for hoje).
    const inOneHour = new Date(Date.now() + 60 * 60_000);
    const sameDay = new Intl.DateTimeFormat("en-CA", { timeZone: "Africa/Luanda" }).format(inOneHour) === new Intl.DateTimeFormat("en-CA", { timeZone: "Africa/Luanda" }).format(new Date());
    if (sameDay) {
      const booked = await request(app)
        .post("/api/v1/appointments")
        .set(auth(a.customer.token))
        .send({ businessId: a.business.id, serviceId: a.service.id, professionalId: a.professional.id, scheduledAt: inOneHour.toISOString() });
      expect(booked.status).toBe(409);
    }

    await request(app).delete(`/api/v1/professionals/${a.professional.id}/absence`).set(auth(a.owner.token)).expect(200);
    expect((await statusOf(a)).status).toBe("AVAILABLE");
  });

  it("o próprio funcionário marca-se ausente; o dono de outro espaço não pode", async () => {
    await request(app).post(`/api/v1/professionals/${a.professional.id}/absence`).set(auth(a.employee.token)).send({}).expect(201);
    expect((await statusOf(a)).status).toBe("AWAY");

    expect((await request(app).delete(`/api/v1/professionals/${a.professional.id}/absence`).set(auth(b.owner.token))).status).toBe(403);
    expect((await request(app).post(`/api/v1/professionals/${a.professional.id}/absence`).set(auth(a.customer.token)).send({})).status).toBe(403);
  });
});
