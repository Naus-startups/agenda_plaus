import { zonedDateKey, zonedDayStart } from "./timezone";
import type { DayHours, TimeWindow } from "./scheduling";

/*
 * O estado de um profissional agora, para os clientes saberem com quem podem marcar:
 *   AVAILABLE  livre (e até quando, se tiver uma marcação mais tarde)
 *   BUSY       a atender; livre de novo em freeAt (fim da marcação, ou das seguidas)
 *   AWAY       ausente (o espaço ou o próprio marcou a ausência): até `until`, ou o dia todo
 *   OFF_HOURS  o espaço está fechado agora (opensAt: quando abre hoje, se ainda abrir)
 * Só usa horas, nunca quem é o cliente: nada de privado sai daqui.
 */
export type ProfessionalStatus = "AVAILABLE" | "BUSY" | "AWAY" | "OFF_HOURS";

export interface StatusResult {
  status: ProfessionalStatus;
  // AWAY: até quando (null = o resto do dia). BUSY: quando acaba o que está a fazer.
  until: Date | null;
  // Quando volta a estar livre para uma marcação hoje (null = hoje já não).
  freeAt: Date | null;
  // AVAILABLE: a próxima marcação de hoje (null = livre até fechar).
  nextBusyAt: Date | null;
  // OFF_HOURS: quando abre hoje (null = hoje já não abre).
  opensAt: Date | null;
  reason: string | null;
}

export function professionalStatusAt(input: {
  now: Date;
  timeZone: string;
  dayHours: DayHours[];
  appointments: TimeWindow[];
  blocks: (TimeWindow & { reason?: string | null })[];
}): StatusResult {
  const { now, timeZone } = input;
  const dayStart = zonedDayStart(zonedDateKey(now, timeZone), timeZone);
  const at = (minute: number) => new Date(dayStart.getTime() + minute * 60_000);
  const minuteNow = (now.getTime() - dayStart.getTime()) / 60_000;

  const openWindow = input.dayHours.find((hours) => hours.startMinute <= minuteNow && minuteNow < hours.endMinute);
  const closeAt = openWindow ? at(openWindow.endMinute) : null;
  const busy: TimeWindow[] = [...input.appointments, ...input.blocks];
  const covering = (time: Date, windows: TimeWindow[]) => windows.find((window) => window.start <= time && time < window.end);

  // Livre de novo no fim de tudo o que está seguido (uma marcação logo a seguir a outra).
  const freeFrom = (time: Date): Date | null => {
    let current = time;
    for (let guard = 0; guard < 200; guard++) {
      const window = covering(current, busy);
      if (!window) break;
      current = window.end;
    }
    return closeAt && current >= closeAt ? null : current;
  };

  const base = { until: null, freeAt: null, nextBusyAt: null, opensAt: null, reason: null };

  const block = input.blocks.find((window) => window.start <= now && now < window.end);
  if (block) {
    const allDay = !closeAt || block.end >= closeAt;
    return { ...base, status: "AWAY", until: allDay ? null : block.end, freeAt: allDay ? null : freeFrom(block.end), reason: block.reason ?? null };
  }

  if (!openWindow) {
    const later = input.dayHours.filter((hours) => hours.startMinute > minuteNow).sort((a, b) => a.startMinute - b.startMinute)[0];
    return { ...base, status: "OFF_HOURS", opensAt: later ? at(later.startMinute) : null };
  }

  const appointment = covering(now, input.appointments);
  if (appointment) {
    const freeAt = freeFrom(appointment.end);
    return { ...base, status: "BUSY", until: appointment.end, freeAt };
  }

  const next = busy
    .filter((window) => window.start > now && (!closeAt || window.start < closeAt))
    .sort((a, b) => a.start.getTime() - b.start.getTime())[0];
  return { ...base, status: "AVAILABLE", freeAt: now, nextBusyAt: next?.start ?? null };
}
