import type { FinancialsSummaryDTO, PaymentDTO, PaymentMethod } from "@slotix/types";
import type { CreatePaymentInput } from "@slotix/validation";
import { env } from "../../config/env";
import { AuthorizationError, ConflictError, NotFoundError, ValidationError } from "../../shared/errors";
import { domainEvents } from "../../shared/events/domainEvents";
import { DEFAULT_CURRENCY } from "../../shared/constants";
import { assertStaffOfBusiness } from "../../shared/authz";
import { announceAppointmentChange, getAppointmentOrThrow } from "../appointments";
import { getBusinessOrThrow } from "../businesses";
import { professionalsRepository } from "../professionals";
import { paymentsRepository } from "./payments.repository";
import { assertValidProof, cleanProofFileName, discardProof, readProof, storeProof, type ProofFile } from "./payments.storage";
import { onAppointmentPaid, onPaymentRefunded } from "../loyalty";

// Points, rewards and promotional uses follow the payment. A failure here never undoes the
// payment: it is logged, and the loyalty job retries every recent paid appointment
// (onAppointmentPaid is idempotent).
async function settleLoyalty(task: Promise<void>) {
  await task.catch((error) => console.error("Fidelização: falhou ao registar o pagamento, tenta de novo mais tarde.", error));
}

const PAYMENT_METHODS: PaymentMethod[] = ["CASH", "CARD", "MULTICAIXA", "BANK_TRANSFER", "OTHER"];

// With no gateway, the only evidence that a transfer or a Multicaixa Express payment
// happened is the proof the client shows the staff — so those can't be received without it.
const METHODS_REQUIRING_PROOF = new Set<PaymentMethod>(["MULTICAIXA", "BANK_TRANSFER"]);

type RequesterRole = "CUSTOMER" | "OWNER" | "EMPLOYEE" | "ADMIN";

// Nothing is paid before the scheduled time: from that minute on it can be (at the time
// or any time later that day — once the day is over it becomes "Não compareceu").
function assertPaymentTimeReached(scheduledAt: Date, now: Date = new Date()): void {
  if (now >= scheduledAt) return;

  const time = new Intl.DateTimeFormat("pt-PT", { timeZone: env.APP_TIMEZONE, hour: "2-digit", minute: "2-digit", hour12: false }).format(scheduledAt);
  throw new ConflictError(`O pagamento só pode ser feito a partir da hora marcada (${time}).`, "PAYMENT_TOO_EARLY");
}

// The calendar day in the app's time zone (the server runs in UTC).
function localDay(date: Date): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: env.APP_TIMEZONE, year: "numeric", month: "2-digit", day: "2-digit" }).format(date);
}

const APPOINTMENT_STATUS_MESSAGES: Record<string, string> = {
  PENDING: "Este agendamento ainda não foi confirmado.",
  COMPLETED: "Este agendamento já foi concluído.",
  CANCELLED: "Este agendamento foi cancelado.",
  NO_SHOW: "Este agendamento foi marcado como falta.",
};

function toPaymentDTO(payment: {
  id: string;
  appointmentId: string;
  userId: string | null;
  walkInClientId: string | null;
  businessId: string;
  amount: { toNumber(): number };
  currency: string;
  method: PaymentDTO["method"];
  status: PaymentDTO["status"];
  paidAt: Date | null;
  proof: { fileName: string; mimeType: string; size: number; createdAt: Date } | null;
  createdAt: Date;
  updatedAt: Date;
}): PaymentDTO {
  return {
    id: payment.id,
    appointmentId: payment.appointmentId,
    userId: payment.userId,
    walkInClientId: payment.walkInClientId,
    businessId: payment.businessId,
    amount: payment.amount.toNumber(),
    currency: payment.currency,
    method: payment.method,
    status: payment.status,
    paidAt: payment.paidAt?.toISOString() ?? null,
    proof: payment.proof
      ? { fileName: payment.proof.fileName, mimeType: payment.proof.mimeType, size: payment.proof.size, uploadedAt: payment.proof.createdAt.toISOString() }
      : null,
    createdAt: payment.createdAt.toISOString(),
    updatedAt: payment.updatedAt.toISOString(),
  };
}

async function getPaymentOrThrow(id: string) {
  const payment = await paymentsRepository.findById(id);
  if (!payment) throw new NotFoundError("Pagamento não encontrado.", "PAYMENT_NOT_FOUND");
  return payment;
}

// The payer (the appointment's client), the business's owner or one of its employees, or
// an admin — never anyone else. Reused by every read/transition below so the rule can't drift between them.
async function assertCanAccess(payment: { userId: string | null; businessId: string }, requesterId: string, requesterRole: RequesterRole): Promise<void> {
  if (requesterRole === "ADMIN") return;
  if (payment.userId === requesterId) return;

  if (requesterRole === "OWNER") {
    const business = await getBusinessOrThrow(payment.businessId);
    if (business.ownerId === requesterId) return;
  }

  if (requesterRole === "EMPLOYEE") {
    const professional = await professionalsRepository.findByUserId(requesterId);
    if (professional?.businessId === payment.businessId) return;
  }

  throw new AuthorizationError("Não tem permissão para aceder a este pagamento.", "PAYMENT_NOT_AUTHORIZED");
}

// Only the business side confirms/fails/refunds money changing hands — the payer
// (CUSTOMER) can create and view their own payment, but can't mark it paid themselves.
async function assertCanManage(payment: { businessId: string }, requesterId: string, requesterRole: RequesterRole): Promise<void> {
  if (requesterRole === "ADMIN") return;

  if (requesterRole === "OWNER") {
    const business = await getBusinessOrThrow(payment.businessId);
    if (business.ownerId === requesterId) return;
  }

  throw new AuthorizationError("Não tem permissão para gerir este pagamento.", "PAYMENT_NOT_AUTHORIZED");
}

export const paymentsService = {
  async create(requesterId: string, requesterRole: RequesterRole, input: CreatePaymentInput): Promise<PaymentDTO> {
    const appointment = await getAppointmentOrThrow(input.appointmentId);

    if (requesterRole !== "ADMIN" && appointment.clientId !== requesterId) {
      throw new AuthorizationError("Só pode pagar os seus próprios agendamentos.", "PAYMENT_NOT_AUTHORIZED");
    }
    if (appointment.status === "CANCELLED") {
      throw new ValidationError("Não é possível pagar um agendamento cancelado.", "PAYMENT_APPOINTMENT_CANCELLED");
    }
    if (appointment.status === "NO_SHOW") {
      throw new ValidationError(APPOINTMENT_STATUS_MESSAGES.NO_SHOW, "PAYMENT_APPOINTMENT_NO_SHOW");
    }
    assertPaymentTimeReached(appointment.scheduledAt);

    const existing = await paymentsRepository.findByAppointmentId(input.appointmentId);
    if (existing) {
      throw new ConflictError("Este agendamento já tem um pagamento associado.", "PAYMENT_ALREADY_EXISTS");
    }

    // amount/currency/userId/businessId always come from the appointment, never the
    // request body — the mobile app cannot influence what gets charged.
    const payment = await paymentsRepository.createIfAppointmentPayable({
      appointmentId: appointment.id,
      userId: appointment.clientId ?? undefined,
      businessId: appointment.businessId,
      amount: appointment.price,
      currency: DEFAULT_CURRENCY,
      method: input.method,
    });
    if (!payment) {
      throw new ConflictError("Não é possível pagar um agendamento cancelado.", "PAYMENT_APPOINTMENT_CANCELLED");
    }

    domainEvents.emitEvent("PaymentCreated", toPaymentDTO(payment));
    return toPaymentDTO(payment);
  },

  // Staff recording a payment received in person (cash/card/etc), on behalf of the
  // business — as opposed to `create`, which is the customer paying for their own
  // appointment through the app. Skips the PENDING state: the payment is PAID and the
  // appointment COMPLETED atomically, the instant it's recorded. A transfer or Multicaixa
  // Express payment comes with the proof the client sent, stored before the payment is
  // written (and removed again if it never is).
  async receivePayment(requesterId: string, input: CreatePaymentInput, proofFile?: ProofFile): Promise<PaymentDTO> {
    const appointment = await getAppointmentOrThrow(input.appointmentId);
    await assertStaffOfBusiness(appointment.businessId, requesterId);

    const existing = await paymentsRepository.findByAppointmentId(input.appointmentId);
    if (existing) {
      throw new ConflictError("Este agendamento já tem um pagamento associado.", "PAYMENT_ALREADY_EXISTS");
    }

    if (appointment.status !== "CONFIRMED") {
      const message = APPOINTMENT_STATUS_MESSAGES[appointment.status] ?? "Este agendamento não pode receber pagamento.";
      throw new ConflictError(message, "PAYMENT_APPOINTMENT_NOT_CONFIRMED");
    }

    const now = new Date();
    if (localDay(now) !== localDay(appointment.scheduledAt)) {
      throw new ConflictError("Só é possível receber o pagamento no dia do agendamento.", "PAYMENT_NOT_SAME_DAY");
    }
    assertPaymentTimeReached(appointment.scheduledAt, now);

    if (!proofFile && METHODS_REQUIRING_PROOF.has(input.method)) {
      throw new ValidationError("Anexe o comprovativo do pagamento (imagem ou PDF).", "PAYMENT_PROOF_REQUIRED");
    }
    if (proofFile) assertValidProof(proofFile);

    const stored = proofFile ? await storeProof(appointment.businessId, proofFile) : null;
    const payment = await paymentsRepository
      .receivePayment({
        appointmentId: appointment.id,
        userId: appointment.clientId ?? undefined,
        walkInClientId: appointment.walkInClientId ?? undefined,
        businessId: appointment.businessId,
        amount: appointment.price,
        currency: DEFAULT_CURRENCY,
        method: input.method,
        proof:
          proofFile && stored
            ? {
                fileName: cleanProofFileName(proofFile.originalname, proofFile.mimetype),
                mimeType: proofFile.mimetype,
                size: proofFile.size,
                ...stored,
                uploadedById: requesterId,
              }
            : undefined,
      })
      .catch(async (error: unknown) => {
        if (stored) await discardProof(stored);
        throw error;
      });
    if (!payment) {
      if (stored) await discardProof(stored);
      throw new ConflictError("Este agendamento já não pode receber pagamento.", "PAYMENT_APPOINTMENT_NOT_CONFIRMED");
    }

    domainEvents.emitEvent("PaymentPaid", toPaymentDTO(payment));
    await settleLoyalty(onAppointmentPaid(appointment.id));
    await announceAppointmentChange(appointment.id, "completed");
    return toPaymentDTO(payment);
  },

  // The proof file itself, for whoever may see the payment (see assertCanAccess).
  async getProofFile(id: string, requesterId: string, requesterRole: RequesterRole): Promise<{ buffer: Buffer; fileName: string; mimeType: string }> {
    const payment = await getPaymentOrThrow(id);
    await assertCanAccess(payment, requesterId, requesterRole);

    const proof = await paymentsRepository.findProofFile(id);
    if (!proof) throw new NotFoundError("Este pagamento não tem comprovativo.", "PAYMENT_PROOF_NOT_FOUND");

    return { buffer: await readProof(proof), fileName: proof.fileName, mimeType: proof.mimeType };
  },

  // Staff attaching the proof later, to a paid payment that has none yet (e.g. one received
  // before proofs existed). An existing proof is never replaced.
  async attachProof(id: string, requesterId: string, proofFile: ProofFile): Promise<PaymentDTO> {
    const payment = await getPaymentOrThrow(id);
    await assertStaffOfBusiness(payment.businessId, requesterId);

    if (payment.status !== "PAID") {
      throw new ConflictError("Só é possível anexar o comprovativo a um pagamento pago.", "PAYMENT_INVALID_STATUS");
    }
    if (payment.proof) throw new ConflictError("Este pagamento já tem comprovativo.", "PAYMENT_PROOF_EXISTS");
    assertValidProof(proofFile);

    const stored = await storeProof(payment.businessId, proofFile);
    const updated = await paymentsRepository
      .attachProof(id, {
        fileName: cleanProofFileName(proofFile.originalname, proofFile.mimetype),
        mimeType: proofFile.mimetype,
        size: proofFile.size,
        ...stored,
        uploadedById: requesterId,
      })
      .catch(async (error: unknown) => {
        await discardProof(stored);
        throw error;
      });
    if (!updated) {
      await discardProof(stored);
      throw new ConflictError("Este pagamento já tem comprovativo.", "PAYMENT_PROOF_EXISTS");
    }
    return toPaymentDTO(updated);
  },

  async getById(id: string, requesterId: string, requesterRole: RequesterRole): Promise<PaymentDTO> {
    const payment = await getPaymentOrThrow(id);
    await assertCanAccess(payment, requesterId, requesterRole);
    return toPaymentDTO(payment);
  },

  async getByAppointment(appointmentId: string, requesterId: string, requesterRole: RequesterRole): Promise<PaymentDTO> {
    const appointment = await getAppointmentOrThrow(appointmentId);

    const payment = await paymentsRepository.findByAppointmentId(appointmentId);
    if (!payment) throw new NotFoundError("Este agendamento ainda não tem pagamento.", "PAYMENT_NOT_FOUND");

    await assertCanAccess({ userId: appointment.clientId, businessId: appointment.businessId }, requesterId, requesterRole);
    return toPaymentDTO(payment);
  },

  async listMine(userId: string): Promise<PaymentDTO[]> {
    const payments = await paymentsRepository.findByUser(userId);
    return payments.map(toPaymentDTO);
  },

  // Staff need the payments to know which appointments are already paid; the money
  // totals (getFinancials) stay with the owner.
  async listByBusiness(businessId: string, requesterId: string): Promise<PaymentDTO[]> {
    await assertStaffOfBusiness(businessId, requesterId);

    const payments = await paymentsRepository.findByBusiness(businessId);
    return payments.map(toPaymentDTO);
  },

  async markAsPaid(id: string, requesterId: string, requesterRole: RequesterRole): Promise<PaymentDTO> {
    const payment = await getPaymentOrThrow(id);
    await assertCanManage(payment, requesterId, requesterRole);

    if (payment.status === "PAID") throw new ConflictError("Este pagamento já está pago.", "PAYMENT_ALREADY_PAID");
    if (payment.status === "REFUNDED") throw new ConflictError("Este pagamento já foi reembolsado.", "PAYMENT_ALREADY_REFUNDED");
    if (payment.status !== "PENDING") {
      throw new ConflictError("Só é possível marcar como pago um pagamento pendente.", "PAYMENT_INVALID_STATUS");
    }

    // paidAt is always server-generated — never accepted from the client.
    const result = await paymentsRepository.markPaidIfAppointmentActive(id, payment.appointmentId);
    if (result.outcome === "appointment_cancelled") {
      throw new ConflictError("O agendamento deste pagamento foi cancelado ou marcado como falta.", "PAYMENT_APPOINTMENT_CANCELLED");
    }
    if (result.outcome === "not_pending") {
      throw new ConflictError("Só é possível marcar como pago um pagamento pendente.", "PAYMENT_INVALID_STATUS");
    }
    const updated = result.payment;
    domainEvents.emitEvent("PaymentPaid", toPaymentDTO(updated));
    await settleLoyalty(onAppointmentPaid(updated.appointmentId));
    return toPaymentDTO(updated);
  },

  async markAsFailed(id: string, requesterId: string, requesterRole: RequesterRole): Promise<PaymentDTO> {
    const payment = await getPaymentOrThrow(id);
    await assertCanManage(payment, requesterId, requesterRole);

    if (payment.status === "PAID") throw new ConflictError("Este pagamento já está pago.", "PAYMENT_ALREADY_PAID");
    if (payment.status === "REFUNDED") throw new ConflictError("Este pagamento já foi reembolsado.", "PAYMENT_ALREADY_REFUNDED");
    if (payment.status !== "PENDING") {
      throw new ConflictError("Só é possível marcar como falhado um pagamento pendente.", "PAYMENT_INVALID_STATUS");
    }

    const updated = await paymentsRepository.updateStatusIfCurrent(id, "PENDING", { status: "FAILED" });
    if (!updated) throw new ConflictError("Só é possível marcar como falhado um pagamento pendente.", "PAYMENT_INVALID_STATUS");
    domainEvents.emitEvent("PaymentFailed", toPaymentDTO(updated));
    return toPaymentDTO(updated);
  },

  async refund(id: string, requesterId: string, requesterRole: RequesterRole): Promise<PaymentDTO> {
    const payment = await getPaymentOrThrow(id);
    await assertCanManage(payment, requesterId, requesterRole);

    if (payment.status === "REFUNDED") throw new ConflictError("Este pagamento já foi reembolsado.", "PAYMENT_ALREADY_REFUNDED");
    if (payment.status !== "PAID") {
      throw new ConflictError("Só é possível reembolsar um pagamento pago.", "PAYMENT_INVALID_STATUS");
    }

    // Keep the original paidAt — it's history, not the current state, and the row itself
    // is never deleted.
    const updated = await paymentsRepository.updateStatusIfCurrent(id, "PAID", { status: "REFUNDED" });
    if (!updated) throw new ConflictError("Só é possível reembolsar um pagamento pago.", "PAYMENT_INVALID_STATUS");
    domainEvents.emitEvent("PaymentRefunded", toPaymentDTO(updated));
    await settleLoyalty(onPaymentRefunded(updated.appointmentId));
    return toPaymentDTO(updated);
  },

  // `month` defaults to the current month; `todayRevenue`/`todayPayments` always reflect
  // the real current day regardless of which month is selected — same two-clock design
  // as the old dashboard's financial report.
  async getFinancials(businessId: string, ownerId: string, month?: string): Promise<FinancialsSummaryDTO> {
    const business = await getBusinessOrThrow(businessId);
    if (business.ownerId !== ownerId) {
      throw new AuthorizationError("Não é o proprietário deste negócio.", "PAYMENT_NOT_AUTHORIZED");
    }

    const now = new Date();
    const [year, monthIndex] = month ? month.split("-").map(Number) : [now.getFullYear(), now.getMonth() + 1];
    const startOfMonth = new Date(year, monthIndex - 1, 1);
    const startOfNextMonth = new Date(year, monthIndex, 1);

    const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const startOfTomorrow = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);

    const [monthPayments, todayPayments] = await Promise.all([
      paymentsRepository.findPaidByBusinessInRange(businessId, startOfMonth, startOfNextMonth),
      paymentsRepository.findPaidByBusinessInRange(businessId, startOfToday, startOfTomorrow),
    ]);

    const paymentMethods = Object.fromEntries(PAYMENT_METHODS.map((m) => [m, 0])) as Record<PaymentMethod, number>;
    let monthlyRevenue = 0;
    for (const payment of monthPayments) {
      const amount = payment.amount.toNumber();
      monthlyRevenue += amount;
      paymentMethods[payment.method] += amount;
    }
    const todayRevenue = todayPayments.reduce((sum, p) => sum + p.amount.toNumber(), 0);

    return {
      period: { month: `${year}-${String(monthIndex).padStart(2, "0")}`, start: startOfMonth.toISOString(), end: startOfNextMonth.toISOString() },
      summary: {
        todayRevenue,
        monthlyRevenue,
        paymentsReceived: monthPayments.length,
        todayPayments: todayPayments.length,
      },
      paymentMethods,
      payments: monthPayments.map((payment) => ({
        id: payment.id,
        amount: payment.amount.toNumber(),
        method: payment.method,
        paidAt: payment.paidAt!.toISOString(),
        appointmentId: payment.appointment.id,
        scheduledAt: payment.appointment.scheduledAt.toISOString(),
        clientName: payment.user?.name ?? payment.walkInClient?.name ?? "Cliente",
        // Só os clientes com conta na app têm foto.
        clientAvatarUrl: payment.user?.avatarUrl ?? null,
        serviceName: payment.appointment.service.name,
        professionalName: payment.appointment.professional.user.name,
      })),
    };
  },
};
