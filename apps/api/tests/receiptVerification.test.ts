import { describe, expect, it, vi } from "vitest";

vi.mock("../src/config/env", () => ({ env: { APP_TIMEZONE: "Africa/Luanda" } }));

const { assertReceiptMatches, localDateTimeToUtc, normalizeReference } = await import("../src/modules/payments/payments.verification");

// Agendamento às 10:00 de Luanda (09:00 UTC), comprovativo entregue às 10:30.
const scheduledAt = new Date("2026-11-17T09:00:00Z");
const handedInAt = new Date("2026-11-17T09:30:00Z");
const expected = { amount: 15000, scheduledAt, handedInAt };

const reading = {
  isPaymentReceipt: true,
  legible: true,
  status: "SUCCESS" as const,
  amount: 15000,
  currency: "AOA",
  dateTime: "2026-11-17T10:05",
  reference: "TRF 0012-3456",
  beneficiary: "Salão X",
  tamperingSigns: [],
};

function codeOf(fn: () => unknown): string | undefined {
  try {
    fn();
  } catch (error) {
    return (error as { code?: string }).code;
  }
}

describe("Verificação do comprovativo", () => {
  it("a hora impressa é a de Luanda", () => {
    expect(localDateTimeToUtc("2026-11-17T10:05", "Africa/Luanda")?.toISOString()).toBe("2026-11-17T09:05:00.000Z");
    expect(localDateTimeToUtc("17/11/2026 10:05", "Africa/Luanda")).toBeNull();
  });

  it("aceita um comprovativo certo e normaliza a referência", () => {
    const result = assertReceiptMatches(reading, expected);
    expect(result.reference).toBe("TRF00123456");
    expect(result.receiptAt.toISOString()).toBe("2026-11-17T09:05:00.000Z");
    expect(normalizeReference("12")).toBeNull();
  });

  it("recusa valor diferente", () => {
    expect(codeOf(() => assertReceiptMatches({ ...reading, amount: 1500 }, expected))).toBe("PAYMENT_PROOF_AMOUNT_MISMATCH");
  });

  it("recusa um comprovativo antigo ou de depois da entrega", () => {
    expect(codeOf(() => assertReceiptMatches({ ...reading, dateTime: "2026-11-16T10:05" }, expected))).toBe("PAYMENT_PROOF_WRONG_TIME");
    expect(codeOf(() => assertReceiptMatches({ ...reading, dateTime: "2026-11-17T11:00" }, expected))).toBe("PAYMENT_PROOF_WRONG_TIME");
  });

  it("recusa o que não é comprovativo, ilegível, não concluído ou alterado", () => {
    expect(codeOf(() => assertReceiptMatches({ ...reading, isPaymentReceipt: false }, expected))).toBe("PAYMENT_PROOF_NOT_RECEIPT");
    expect(codeOf(() => assertReceiptMatches({ ...reading, dateTime: null }, expected))).toBe("PAYMENT_PROOF_UNREADABLE");
    expect(codeOf(() => assertReceiptMatches({ ...reading, status: "PENDING" }, expected))).toBe("PAYMENT_PROOF_NOT_COMPLETED");
    expect(codeOf(() => assertReceiptMatches({ ...reading, tamperingSigns: ["fonte diferente no valor"] }, expected))).toBe("PAYMENT_PROOF_TAMPERED");
  });
});
