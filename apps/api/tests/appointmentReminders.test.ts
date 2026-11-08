import { describe, expect, it, vi } from "vitest";

vi.mock("../src/config/env", () => ({ env: { APP_TIMEZONE: "Africa/Luanda" } }));
vi.mock("../src/modules/notifications/notifications.repository", () => ({ notificationsRepository: {} }));

vi.mock("../src/modules/notifications/notifications.service", () => ({ notificationsService: {} }));
vi.mock("../src/modules/appointments", () => ({ announceAppointmentChange: vi.fn() }));

import { isNoShowDue, noShowBusinessText, noShowText, reminderKindFor, reminderText } from "../src/modules/notifications/appointmentReminders";

const TZ = "Africa/Luanda"; // UTC+1, sem hora de verão
const at = (iso: string) => new Date(iso);
const appointment = (iso: string, durationMinutes = 60) => ({ scheduledAt: at(iso), durationMinutes });

describe("reminderKindFor", () => {
  it("avisa na véspera, mesmo a menos de 24 horas", () => {
    // 23:30 de dia 9 em Luanda → marcação às 09:00 de dia 10
    expect(reminderKindFor(appointment("2026-10-10T08:00:00Z"), at("2026-10-09T22:30:00Z"), TZ)).toBe("APPOINTMENT_REMINDER_TOMORROW");
  });

  it("usa o dia de Luanda e não o de UTC", () => {
    // 00:30 de dia 10 em Luanda (ainda dia 9 em UTC) → marcação às 09:00 de dia 10: é hoje
    expect(reminderKindFor(appointment("2026-10-10T08:00:00Z"), at("2026-10-09T23:30:00Z"), TZ)).toBe("APPOINTMENT_REMINDER_TODAY");
  });

  it("não avisa a dois dias de distância", () => {
    expect(reminderKindFor(appointment("2026-10-12T08:00:00Z"), at("2026-10-10T08:00:00Z"), TZ)).toBeNull();
  });

  it("não avisa depois da hora marcada", () => {
    const booked = appointment("2026-10-10T08:00:00Z", 60);
    expect(reminderKindFor(booked, at("2026-10-10T08:30:00Z"), TZ)).toBeNull();
    expect(reminderKindFor(booked, at("2026-10-10T20:00:00Z"), TZ)).toBeNull();
  });
});

describe("isNoShowDue", () => {
  const booked = at("2026-10-10T08:00:00Z");

  it("só conta como falta 24 horas depois da hora marcada", () => {
    expect(isNoShowDue(booked, at("2026-10-11T07:59:00Z"))).toBe(false);
    expect(isNoShowDue(booked, at("2026-10-11T08:00:00Z"))).toBe(true);
  });
});

describe("reminderText", () => {
  it("escreve a hora marcada no fuso dos clientes", () => {
    const details = { scheduledAt: at("2026-10-10T08:00:00Z"), business: { name: "Barbearia Luz" }, service: { name: "Corte" } };
    expect(reminderText("APPOINTMENT_REMINDER_TODAY", details, TZ).message).toBe(
      "Hoje é o dia do seu agendamento em Barbearia Luz (Corte), às 09:00.",
    );
    expect(reminderText("APPOINTMENT_REMINDER_TOMORROW", details, TZ).message).toContain("amanhã, 10/10, às 09:00");
    expect(noShowText(details, TZ).message).toBe(
      "O seu agendamento em Barbearia Luz (Corte) de 10/10 às 09:00 foi cancelado porque não compareceu.",
    );
    expect(noShowBusinessText({ ...details, client: null, walkInClient: { name: "Ana" } }, TZ).message).toBe(
      "Agendamento cancelado porque o cliente não compareceu: Ana — Corte, 10/10 às 09:00.",
    );
  });
});
