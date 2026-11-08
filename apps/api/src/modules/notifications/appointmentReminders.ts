import { env } from "../../config/env";
import { announceAppointmentChange } from "../appointments";
import { releaseForAppointment } from "../loyalty";
import { notificationsRepository } from "./notifications.repository";
import { notificationsService } from "./notifications.service";

/*
 * Avisos ligados à data de um agendamento, para o cliente que o marcou:
 *   - na véspera:        "Falta um dia…"
 *   - no próprio dia:    "Hoje é o dia…", com a hora marcada
 * e, 24 horas depois da hora marcada sem o atendimento ter sido concluído nem pago, o
 * agendamento é cancelado por o cliente não ter comparecido — ver markMissedAppointments.
 *
 * Não há eventos para isto (nada acontece no sistema quando o relógio avança), por isso um
 * ciclo verifica de minuto a minuto. Cada aviso só é criado uma vez: antes de gravar,
 * procura-se um igual (mesmo utilizador, tipo e texto). O texto leva o espaço, o serviço, o
 * dia e a hora, logo um agendamento remarcado volta a ser avisado para a nova data.
 */

const CHECK_EVERY_MS = 60_000;
const DAY_MS = 24 * 60 * 60_000;

export type ReminderKind = "APPOINTMENT_REMINDER_TOMORROW" | "APPOINTMENT_REMINDER_TODAY";

// O dia do calendário (AAAA-MM-DD) no fuso da aplicação — "amanhã" e "hoje" são os do
// cliente, não os do servidor (que corre em UTC).
function localDay(date: Date, timeZone: string): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(date);
}

function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / DAY_MS);
}

// Que aviso (se algum) um agendamento ainda por realizar merece neste momento.
export function reminderKindFor(
  appointment: { scheduledAt: Date; durationMinutes: number },
  now: Date,
  timeZone: string,
): ReminderKind | null {
  // Depois da hora marcada não há lembrete; o que fica por fazer trata-o o fim do dia.
  if (appointment.scheduledAt.getTime() <= now.getTime()) return null;

  const days = daysBetween(localDay(now, timeZone), localDay(appointment.scheduledAt, timeZone));
  if (days === 1) return "APPOINTMENT_REMINDER_TOMORROW";
  if (days === 0) return "APPOINTMENT_REMINDER_TODAY";
  return null;
}

export function reminderText(
  kind: ReminderKind,
  appointment: { scheduledAt: Date; business: { name: string }; service: { name: string } },
  timeZone: string,
): { title: string; message: string } {
  const day = new Intl.DateTimeFormat("pt-PT", { timeZone, day: "2-digit", month: "2-digit" }).format(appointment.scheduledAt);
  const time = new Intl.DateTimeFormat("pt-PT", { timeZone, hour: "2-digit", minute: "2-digit", hour12: false }).format(appointment.scheduledAt);
  const what = `${appointment.business.name} (${appointment.service.name})`;

  switch (kind) {
    case "APPOINTMENT_REMINDER_TOMORROW":
      return { title: "Falta um dia", message: `Falta um dia para o seu agendamento em ${what}: amanhã, ${day}, às ${time}.` };
    case "APPOINTMENT_REMINDER_TODAY":
      return { title: "É hoje o seu agendamento", message: `Hoje é o dia do seu agendamento em ${what}, às ${time}.` };
  }
}

// Quanto tempo depois da hora marcada o espaço ainda pode concluir ou receber o pagamento
// antes de o agendamento contar como falta.
export const NO_SHOW_AFTER_MS = DAY_MS;

export const NO_SHOW_NOTIFICATION = "APPOINTMENT_CANCELLED_NO_SHOW";

function dayAndTime(scheduledAt: Date, timeZone: string): string {
  const day = new Intl.DateTimeFormat("pt-PT", { timeZone, day: "2-digit", month: "2-digit" }).format(scheduledAt);
  const time = new Intl.DateTimeFormat("pt-PT", { timeZone, hour: "2-digit", minute: "2-digit", hour12: false }).format(scheduledAt);
  return `${day} às ${time}`;
}

export function noShowText(
  appointment: { scheduledAt: Date; business: { name: string }; service: { name: string } },
  timeZone: string,
): { title: string; message: string } {
  return {
    title: "Agendamento cancelado",
    message: `O seu agendamento em ${appointment.business.name} (${appointment.service.name}) de ${dayAndTime(appointment.scheduledAt, timeZone)} foi cancelado porque não compareceu.`,
  };
}

export function noShowBusinessText(
  appointment: { scheduledAt: Date; service: { name: string }; client: { name: string } | null; walkInClient: { name: string } | null },
  timeZone: string,
): { title: string; message: string } {
  const client = appointment.client?.name ?? appointment.walkInClient?.name ?? "Cliente";
  return {
    title: "Cliente não compareceu",
    message: `Agendamento cancelado porque o cliente não compareceu: ${client} — ${appointment.service.name}, ${dayAndTime(appointment.scheduledAt, timeZone)}.`,
  };
}

// Passou o prazo desde a hora marcada?
export function isNoShowDue(scheduledAt: Date, now: Date): boolean {
  return now.getTime() - scheduledAt.getTime() >= NO_SHOW_AFTER_MS;
}

// Os agendamentos que, 24 horas depois da hora marcada, continuam por concluir (pendentes
// ou confirmados) e sem pagamento ficam como "Não compareceu": saem da agenda como por
// fazer, e o painel e a app veem-no logo (realtime). O cliente e o espaço (dono e
// profissional) são avisados — mas só dos recentes: os antigos que já estavam por fechar
// quando isto entrou mudam de estado sem notificação.
export async function markMissedAppointments(now: Date = new Date()): Promise<number> {
  const timeZone = env.APP_TIMEZONE;
  const open = await notificationsRepository.findOpenUnpaidAppointmentsBefore(new Date(now.getTime() - NO_SHOW_AFTER_MS));

  let marked = 0;
  for (const appointment of open) {
    if (!isNoShowDue(appointment.scheduledAt, now)) continue;
    if (!(await notificationsRepository.markNoShowIfUnpaid(appointment.id, (db) => releaseForAppointment(appointment.id, db)))) continue;
    marked++;

    await announceAppointmentChange(appointment.id, "no_show");

    if (now.getTime() - appointment.scheduledAt.getTime() >= NO_SHOW_AFTER_MS + 2 * DAY_MS) continue;

    if (appointment.clientId) {
      const { title, message } = noShowText(appointment, timeZone);
      await notificationsService.notify(appointment.clientId, NO_SHOW_NOTIFICATION, title, message);
    }
    const business = noShowBusinessText(appointment, timeZone);
    const staff = new Set([appointment.business.ownerId, appointment.professional.userId]);
    await Promise.all([...staff].map((userId) => notificationsService.notify(userId, NO_SHOW_NOTIFICATION, business.title, business.message)));
  }
  return marked;
}

// Uma passagem: devolve quantos avisos novos criou.
export async function sendDueAppointmentReminders(now: Date = new Date()): Promise<number> {
  const timeZone = env.APP_TIMEZONE;
  // Do último dia (os que expiraram há mais tempo já não interessam a ninguém, e assim a
  // primeira passagem não despeja avisos de agendamentos antigos) até depois de amanhã.
  const appointments = await notificationsRepository.findAppointmentsAwaitingReminders(
    new Date(now.getTime() - DAY_MS),
    new Date(now.getTime() + 2 * DAY_MS),
  );

  let created = 0;
  for (const appointment of appointments) {
    if (!appointment.clientId) continue;

    const kind = reminderKindFor(appointment, now, timeZone);
    if (!kind) continue;

    const { title, message } = reminderText(kind, appointment, timeZone);
    if (await notificationsRepository.exists(appointment.clientId, kind, message)) continue;

    await notificationsRepository.create({ userId: appointment.clientId, type: kind, title, message });
    created++;
  }
  return created;
}

export function startAppointmentReminders(): void {
  let running = false;

  const tick = async () => {
    // Uma passagem lenta (base de dados remota) não se sobrepõe à seguinte: duas ao mesmo
    // tempo criariam o mesmo aviso em duplicado.
    if (running) return;
    running = true;
    try {
      await markMissedAppointments();
      await sendDueAppointmentReminders();
    } catch (error) {
      console.error("Avisos de agendamento: a verificação falhou, repete no próximo minuto.", error);
    } finally {
      running = false;
    }
  };

  void tick();
  // unref: este ciclo não deve, sozinho, manter o processo vivo.
  setInterval(() => void tick(), CHECK_EVERY_MS).unref();
}
