import { createHash } from "node:crypto";
import Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import { env } from "../../config/env";
import { AppError, ConflictError, ValidationError } from "../../shared/errors";
import type { ProofFile } from "./payments.storage";

// With no gateway, the proof is all there is: before a transfer / Multicaixa Express payment
// is recorded, the receipt is read (Claude, vision) and what it says is checked here, in
// code — the model only transcribes, it never decides.

// What was read from the receipt, exactly as printed. The date/time is the local time on
// the receipt (Angolan banks print Luanda time), without a time zone.
const ReceiptReadingSchema = z.strictObject({
  isPaymentReceipt: z.boolean(),
  legible: z.boolean(),
  status: z.enum(["SUCCESS", "FAILED", "PENDING", "UNKNOWN"]),
  amount: z.number().nullable(),
  currency: z.string().nullable(),
  dateTime: z.string().nullable(),
  reference: z.string().nullable(),
  beneficiary: z.string().nullable(),
  tamperingSigns: z.array(z.string()),
});

export type ReceiptReading = z.infer<typeof ReceiptReadingSchema>;

// Without the "$schema" draft marker, which the API doesn't take.
const RECEIPT_JSON_SCHEMA: Record<string, unknown> = { ...z.toJSONSchema(ReceiptReadingSchema), $schema: undefined };

// The receipt can't be from long before the appointment (an old transfer reused), nor from
// after the moment it's handed in (clock drift between phone, bank and server aside).
const EARLIEST_BEFORE_APPOINTMENT_MS = 2 * 60 * 60 * 1000;
const CLOCK_TOLERANCE_MS = 10 * 60 * 1000;
// Kwanza amounts: rounding on the receipt, never a real difference.
const AMOUNT_TOLERANCE = 0.5;

const SYSTEM_PROMPT = `You read payment receipts from Angolan banks and Multicaixa Express (transfers, "comprovativo de transferência", "talão", app screenshots, PDFs) and transcribe them. Report only what is printed; never infer or guess a value that isn't visible.

- isPaymentReceipt: true only if this is a receipt/confirmation of a money transfer or payment.
- legible: false if the amount or the date/time can't be read with certainty.
- status: SUCCESS only if the receipt states the operation was completed/successful (or it is a final receipt with no pending wording); FAILED or PENDING if it says so; UNKNOWN otherwise.
- amount: the transferred amount as a plain number (e.g. "15.000,00 Kz" -> 15000). Not fees, not balances.
- currency: as printed (e.g. "AOA", "Kz").
- dateTime: the operation's date and time as printed, as "YYYY-MM-DDTHH:mm" (add ":ss" if seconds are printed). Angolan receipts write dates day-first. null if no time is printed.
- reference: the operation/transaction number or reference that identifies this transfer, exactly as printed. null if none.
- beneficiary: the receiving name, account, IBAN or phone number, as printed.
- tamperingSigns: concrete visible signs the image was edited (misaligned or mismatched fonts in the amount/date, pasted-over areas, inconsistent totals). Empty if none. Do not list JPEG compression or a photo taken of a screen.`;

function client(): Anthropic | null {
  return env.ANTHROPIC_API_KEY ? new Anthropic({ apiKey: env.ANTHROPIC_API_KEY, timeout: 60_000, maxRetries: 2 }) : null;
}

export function isReceiptVerificationConfigured(): boolean {
  return !!env.ANTHROPIC_API_KEY;
}

export function proofSha256(file: ProofFile): string {
  return createHash("sha256").update(file.buffer).digest("hex");
}

// Same reference however it was typed: case, spaces and separators don't matter.
export function normalizeReference(reference: string | null): string | null {
  const cleaned = reference?.toUpperCase().replace(/[^A-Z0-9]/g, "") ?? "";
  return cleaned.length >= 4 ? cleaned : null;
}

class ReceiptVerificationUnavailableError extends AppError {
  constructor() {
    super("PAYMENT_PROOF_CHECK_UNAVAILABLE", "Não foi possível verificar o comprovativo agora. Tente novamente dentro de instantes.", 503);
  }
}

export async function readReceipt(file: ProofFile): Promise<ReceiptReading> {
  const anthropic = client();
  if (!anthropic) throw new ReceiptVerificationUnavailableError();

  const data = file.buffer.toString("base64");
  const attachment: Anthropic.Beta.BetaContentBlockParam =
    file.mimetype === "application/pdf"
      ? { type: "document", source: { type: "base64", media_type: "application/pdf", data } }
      : { type: "image", source: { type: "base64", media_type: file.mimetype as "image/jpeg" | "image/png" | "image/webp", data } };

  try {
    const response = await anthropic.beta.messages.create({
      model: "claude-opus-5",
      max_tokens: 4096,
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
      output_config: { effort: "low", format: { type: "json_schema", schema: RECEIPT_JSON_SCHEMA } },
      system: SYSTEM_PROMPT,
      messages: [{ role: "user", content: [attachment, { type: "text", text: "Transcribe this receipt." }] }],
    });
    const text = response.content.find((block) => block.type === "text");
    if (response.stop_reason !== "end_turn" || !text || text.type !== "text") throw new ReceiptVerificationUnavailableError();
    return ReceiptReadingSchema.parse(JSON.parse(text.text));
  } catch (error) {
    if (error instanceof AppError) throw error;
    console.error("Verificação do comprovativo: a leitura falhou.", error);
    throw new ReceiptVerificationUnavailableError();
  }
}

// "YYYY-MM-DDTHH:mm[:ss]" as printed (local time in `timeZone`) -> the instant it names.
export function localDateTimeToUtc(value: string, timeZone: string): Date | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?$/.exec(value.trim());
  if (!match) return null;
  const [year, month, day, hour, minute, second] = match.slice(1).map((part) => Number(part ?? 0));
  const guess = Date.UTC(year, month - 1, day, hour, minute, second);
  if (Number.isNaN(guess)) return null;

  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", { timeZone, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit" })
      .formatToParts(new Date(guess))
      .map((part) => [part.type, part.value]),
  );
  const asLocal = Date.UTC(+parts.year, +parts.month - 1, +parts.day, +parts.hour, +parts.minute, +parts.second);
  return new Date(guess - (asLocal - guess));
}

function formatKz(amount: number): string {
  return `${new Intl.NumberFormat("pt-PT", { minimumFractionDigits: 0, maximumFractionDigits: 2 }).format(amount)} Kz`;
}

function formatLocal(date: Date): string {
  return new Intl.DateTimeFormat("pt-PT", { timeZone: env.APP_TIMEZONE, day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false }).format(date);
}

// The checks themselves: the amount is the appointment's, the operation went through, and
// it happened around the appointment — from shortly before it up to when it is handed in.
export function assertReceiptMatches(
  reading: ReceiptReading,
  expected: { amount: number; scheduledAt: Date; handedInAt: Date },
): { receiptAt: Date; reference: string | null } {
  if (!reading.isPaymentReceipt) {
    throw new ValidationError("O ficheiro enviado não é um comprovativo de pagamento.", "PAYMENT_PROOF_NOT_RECEIPT");
  }
  if (!reading.legible || reading.amount === null || !reading.dateTime) {
    throw new ValidationError("Não foi possível ler o valor e a data/hora do comprovativo. Envie uma imagem mais nítida ou o PDF do banco.", "PAYMENT_PROOF_UNREADABLE");
  }
  if (reading.status === "FAILED" || reading.status === "PENDING") {
    throw new ValidationError("O comprovativo indica que a operação não foi concluída.", "PAYMENT_PROOF_NOT_COMPLETED");
  }
  if (reading.tamperingSigns.length > 0) {
    throw new ValidationError(`O comprovativo parece ter sido alterado (${reading.tamperingSigns.join("; ")}).`, "PAYMENT_PROOF_TAMPERED");
  }
  if (Math.abs(reading.amount - expected.amount) > AMOUNT_TOLERANCE) {
    throw new ValidationError(
      `O valor do comprovativo (${formatKz(reading.amount)}) não corresponde ao valor a pagar (${formatKz(expected.amount)}).`,
      "PAYMENT_PROOF_AMOUNT_MISMATCH",
    );
  }

  const receiptAt = localDateTimeToUtc(reading.dateTime, env.APP_TIMEZONE);
  if (!receiptAt) {
    throw new ValidationError("Não foi possível ler a data/hora do comprovativo.", "PAYMENT_PROOF_UNREADABLE");
  }
  const earliest = expected.scheduledAt.getTime() - EARLIEST_BEFORE_APPOINTMENT_MS;
  const latest = expected.handedInAt.getTime() + CLOCK_TOLERANCE_MS;
  if (receiptAt.getTime() < earliest || receiptAt.getTime() > latest) {
    throw new ValidationError(
      `O comprovativo é de ${formatLocal(receiptAt)}: tem de ser de uma operação feita na altura do agendamento (${formatLocal(expected.scheduledAt)}).`,
      "PAYMENT_PROOF_WRONG_TIME",
    );
  }

  return { receiptAt, reference: normalizeReference(reading.reference) };
}

export function receiptAlreadyUsedError(): ConflictError {
  return new ConflictError("Este comprovativo já foi usado noutro pagamento.", "PAYMENT_PROOF_ALREADY_USED");
}
