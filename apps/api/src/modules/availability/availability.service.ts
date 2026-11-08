import type { AvailabilitySlotDTO, ProfessionalStatusDTO } from "@slotix/types";
import { env } from "../../config/env";
import { ValidationError } from "../../shared/errors";
import { computeAvailableSlots, resolveDayHours, type TimeWindow } from "../../shared/utils/scheduling";
import { weekdayOf, zonedDateKey, zonedDayStart } from "../../shared/utils/timezone";
import { professionalStatusAt } from "../../shared/utils/professionalStatus";
import { getBusinessOrThrow } from "../businesses";
import { businessesRepository } from "../businesses";
import { professionalsRepository } from "../professionals";
import { appointmentsRepository, validateBookingContext } from "../appointments";
import type { GetAvailabilityInput } from "./availability.schema";

const iso = (date: Date | null) => date?.toISOString() ?? null;

export const availabilityService = {
  // O estado de cada profissional ativo do espaço neste momento: livre, a atender (e
  // quando fica livre), ausente ou fora do horário. Público: só horas, nada dos clientes.
  async professionalsStatus(businessId: string, now: Date = new Date()): Promise<ProfessionalStatusDTO[]> {
    await getBusinessOrThrow(businessId);
    const today = zonedDateKey(now, env.APP_TIMEZONE);
    const dayStart = zonedDayStart(today, env.APP_TIMEZONE);
    const dayEnd = new Date(dayStart.getTime() + 24 * 60 * 60_000);
    // Uma marcação que começou ontem e ainda dura também conta.
    const lookback = new Date(dayStart.getTime() - 24 * 60 * 60_000);

    const [allHours, professionals] = await Promise.all([businessesRepository.findHours(businessId), professionalsRepository.findByBusiness(businessId)]);
    const dayHours = resolveDayHours(allHours, weekdayOf(today));

    return Promise.all(
      professionals
        .filter((professional) => professional.active)
        .map(async (professional) => {
          const [appointments, blocks] = await Promise.all([
            appointmentsRepository.findActiveInWindow(professional.id, lookback, dayEnd),
            professionalsRepository.findBlocksInRange(professional.id, dayStart, dayEnd),
          ]);
          const result = professionalStatusAt({
            now,
            timeZone: env.APP_TIMEZONE,
            dayHours,
            appointments: appointments.map((a) => ({ start: a.scheduledAt, end: new Date(a.scheduledAt.getTime() + a.durationMinutes * 60_000) })),
            blocks: blocks.map((b) => ({ start: b.startAt, end: b.endAt, reason: b.reason })),
          });
          return {
            professionalId: professional.id,
            status: result.status,
            until: iso(result.until),
            freeAt: iso(result.freeAt),
            minutesUntilFree: result.freeAt ? Math.max(0, Math.ceil((result.freeAt.getTime() - now.getTime()) / 60_000)) : null,
            nextBusyAt: iso(result.nextBusyAt),
            opensAt: iso(result.opensAt),
            // O motivo de uma ausência pode ser pessoal: nunca sai para o público.
            reason: null,
          };
        }),
    );
  },

  async getSlots(query: GetAvailabilityInput): Promise<AvailabilitySlotDTO[]> {
    const { service } = await validateBookingContext(query.businessId, query.serviceId, query.professionalId);

    // The day as the business lives it (APP_TIMEZONE), not the server's UTC day.
    const dayStart = zonedDayStart(query.date, env.APP_TIMEZONE);
    if (Number.isNaN(dayStart.getTime())) {
      throw new ValidationError("Data inválida.", "INVALID_DATE");
    }
    const dayEnd = new Date(dayStart.getTime() + 24 * 60 * 60_000);

    const [allHours, existingAppointments, blocks] = await Promise.all([
      businessesRepository.findHours(query.businessId),
      appointmentsRepository.findActiveInWindow(query.professionalId, dayStart, dayEnd),
      professionalsRepository.findBlocksInRange(query.professionalId, dayStart, dayEnd),
    ]);

    const dayHours = resolveDayHours(allHours, weekdayOf(query.date));

    const busy: TimeWindow[] = [
      ...existingAppointments.map((a) => ({ start: a.scheduledAt, end: new Date(a.scheduledAt.getTime() + a.durationMinutes * 60_000) })),
      ...blocks.map((b) => ({ start: b.startAt, end: b.endAt })),
    ];

    const slots = computeAvailableSlots({ date: query.date, timeZone: env.APP_TIMEZONE, durationMinutes: service.duration, dayHours, busy });
    return slots.map((slot) => ({ time: slot.toISOString() }));
  },
};
