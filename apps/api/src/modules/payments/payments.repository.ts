import { prisma } from "../../config/database";
import type { PaymentMethod, PaymentStatus, Prisma } from "@prisma/client";
import { requireId } from "../../shared/utils/requireId";

class StaleAppointmentError extends Error {}

// Locks the appointment row until the transaction ends and returns its status (null when
// it doesn't exist). A cancel updates that same row, so the two can't interleave: whichever
// comes second sees the other's result.
async function lockAppointmentStatus(tx: Prisma.TransactionClient, appointmentId: string): Promise<string | null> {
  const rows = await tx.$queryRaw<{ status: string }[]>`SELECT "status"::text AS "status" FROM "appointments" WHERE "id" = ${appointmentId} FOR UPDATE`;
  return rows[0]?.status ?? null;
}

// Appointments that will never be paid for: cancelled, or the client didn't show up.
const CLOSED_STATUSES = new Set(["CANCELLED", "NO_SHOW"]);

// Every payment read back for a DTO carries its proof's metadata — never the file's bytes.
const withProof = {
  proof: { select: { fileName: true, mimeType: true, size: true, createdAt: true } },
} satisfies Prisma.PaymentInclude;

export type NewPaymentProof = {
  fileName: string;
  mimeType: string;
  size: number;
  path: string | null;
  data: Uint8Array<ArrayBuffer> | null;
  uploadedById: string;
};

export const paymentsRepository = {
  // Staff receiving a payment in person: the payment is created already PAID and the
  // appointment moves straight to COMPLETED, atomically — there's no PENDING step for
  // this path (unlike the customer self-pay flow in `create`).
  receivePayment(data: {
    appointmentId: string;
    userId?: string;
    walkInClientId?: string;
    businessId: string;
    amount: Prisma.Decimal | number;
    currency: string;
    method: PaymentMethod;
    proof?: NewPaymentProof;
  }) {
    const { proof, ...payment } = data;
    // The appointment is completed first, and only if it is still CONFIRMED: that row lock
    // makes a concurrent cancel, or a second payment, wait and then find nothing to update.
    // null = the appointment had moved on; the transaction is rolled back with nothing written.
    return prisma
      .$transaction(async (tx) => {
        const { count } = await tx.appointment.updateMany({ where: { id: payment.appointmentId, status: "CONFIRMED" }, data: { status: "COMPLETED" } });
        if (count !== 1) throw new StaleAppointmentError();
        return tx.payment.create({
          data: { ...payment, status: "PAID", paidAt: new Date(), proof: proof ? { create: proof } : undefined },
          include: withProof,
        });
      })
      .catch((error: unknown) => {
        if (error instanceof StaleAppointmentError) return null;
        throw error;
      });
  },

  findById(id: string) {
    return prisma.payment.findUnique({ where: { id }, include: withProof });
  },

  // The customer paying through the app: only while the appointment isn't cancelled, judged
  // under the row lock. null = it was cancelled (or vanished) in the meantime.
  createIfAppointmentPayable(data: {
    appointmentId: string;
    userId?: string;
    businessId: string;
    amount: Prisma.Decimal | number;
    currency: string;
    method: PaymentMethod;
  }) {
    return prisma
      .$transaction(async (tx) => {
        const status = await lockAppointmentStatus(tx, data.appointmentId);
        if (!status || CLOSED_STATUSES.has(status)) throw new StaleAppointmentError();
        return tx.payment.create({ data, include: withProof });
      })
      .catch((error: unknown) => {
        if (error instanceof StaleAppointmentError) return null;
        throw error;
      });
  },

  // The business confirming a pending payment: the payment must still be PENDING and its
  // appointment not cancelled — both decided inside one transaction holding the row lock.
  markPaidIfAppointmentActive(paymentId: string, appointmentId: string) {
    return prisma.$transaction(async (tx) => {
      const status = await lockAppointmentStatus(tx, appointmentId);
      if (!status || CLOSED_STATUSES.has(status)) return { outcome: "appointment_cancelled" as const };
      const { count } = await tx.payment.updateMany({ where: { id: paymentId, status: "PENDING" }, data: { status: "PAID", paidAt: new Date() } });
      if (count !== 1) return { outcome: "not_pending" as const };
      return { outcome: "paid" as const, payment: await tx.payment.findUniqueOrThrow({ where: { id: paymentId }, include: withProof }) };
    });
  },

  findByAppointmentId(appointmentId: string) {
    return prisma.payment.findUnique({ where: { appointmentId }, include: withProof });
  },

  findByUser(userId: string) {
    return prisma.payment.findMany({ where: { userId: requireId(userId, "userId") }, include: withProof, orderBy: { createdAt: "desc" } });
  },

  findByBusiness(businessId: string) {
    return prisma.payment.findMany({ where: { businessId }, include: withProof, orderBy: { createdAt: "desc" } });
  },

  // Revenue is recognized by paidAt (when the money actually moved), not createdAt —
  // matches the old dashboard's financial report exactly.
  findPaidByBusinessInRange(businessId: string, start: Date, end: Date) {
    return prisma.payment.findMany({
      where: { businessId, status: "PAID", paidAt: { gte: start, lt: end } },
      include: {
        user: { select: { name: true, avatarUrl: true } },
        walkInClient: { select: { name: true } },
        appointment: {
          select: {
            id: true,
            scheduledAt: true,
            service: { select: { id: true, name: true } },
            professional: { select: { id: true, user: { select: { name: true } } } },
          },
        },
      },
      orderBy: { paidAt: "desc" },
    });
  },

  // An appointment that was cancelled or missed: a payment the client started in the app and
  // that never went through no longer stands. Runs in the caller's transaction, next to the
  // status change.
  failPendingForAppointment(appointmentId: string, db: Prisma.TransactionClient) {
    return db.payment.updateMany({ where: { appointmentId, status: "PENDING" }, data: { status: "FAILED" } });
  },

  // Same idea as appointmentsRepository.updateIfStatus: null when the payment was no longer
  // in `from` at the moment of writing.
  async updateStatusIfCurrent(id: string, from: PaymentStatus, data: { status: PaymentStatus; paidAt?: Date | null }) {
    const { count } = await prisma.payment.updateMany({ where: { id, status: from }, data });
    return count === 1 ? prisma.payment.findUniqueOrThrow({ where: { id }, include: withProof }) : null;
  },

  // The proof with its bytes (or where they are), only for serving the file itself.
  findProofFile(paymentId: string) {
    return prisma.paymentProof.findUnique({ where: { paymentId } });
  },

  // Attaching a proof to a payment received without one. null = it already had one: a
  // proof is never replaced, so what was checked when the money came in stays on record.
  async attachProof(paymentId: string, proof: NewPaymentProof) {
    const created = await prisma.paymentProof.createMany({ data: [{ paymentId, ...proof }], skipDuplicates: true });
    return created.count === 1 ? prisma.payment.findUniqueOrThrow({ where: { id: paymentId }, include: withProof }) : null;
  },
};
