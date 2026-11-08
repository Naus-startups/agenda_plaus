import { EventEmitter } from "node:events";
import type { AppointmentDTO, PaymentDTO } from "@slotix/types";

export type AppointmentChange = "created" | "confirmed" | "cancelled" | "completed" | "no_show" | "rescheduled";

export interface DomainEvents {
  AppointmentCreated: AppointmentDTO;
  // Booked in the dashboard for an app client: they're told in the app.
  AppointmentBookedForClient: AppointmentDTO;
  // byClient: cancelled by the client in the app (the business is told), not by staff.
  AppointmentCancelled: AppointmentDTO & { byClient: boolean };
  AppointmentConfirmed: AppointmentDTO;
  // Any change to an appointment (created by the client or the business, confirmed,
  // cancelled, completed, no-show, rescheduled), for the live views (realtime module).
  AppointmentChanged: { appointment: AppointmentDTO; change: AppointmentChange };
  PaymentCreated: PaymentDTO;
  PaymentPaid: PaymentDTO;
  PaymentFailed: PaymentDTO;
  PaymentRefunded: PaymentDTO;
  // Something from a space's loyalty programme to tell a client (points, rewards,
  // promotions). `promotional` ones respect the client's choice to receive promotions.
  LoyaltyNotification: { userId: string; type: string; title: string; message: string; promotional: boolean };
}

class DomainEventBus extends EventEmitter {
  emitEvent<K extends keyof DomainEvents>(event: K, payload: DomainEvents[K]): void {
    this.emit(event, payload);
  }

  onEvent<K extends keyof DomainEvents>(event: K, listener: (payload: DomainEvents[K]) => void): void {
    this.on(event, listener);
  }
}

export const domainEvents = new DomainEventBus();
