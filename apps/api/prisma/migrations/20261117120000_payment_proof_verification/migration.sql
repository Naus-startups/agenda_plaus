-- Verificação do comprovativo: hash do ficheiro e referência do banco (para recusar um
-- comprovativo reutilizado), data/hora da operação lida e quando foi verificado.
ALTER TABLE "payment_proofs" ADD COLUMN "sha256" TEXT,
ADD COLUMN "reference" TEXT,
ADD COLUMN "receiptAt" TIMESTAMP(3),
ADD COLUMN "verifiedAt" TIMESTAMP(3);

CREATE INDEX "payment_proofs_sha256_idx" ON "payment_proofs"("sha256");

CREATE INDEX "payment_proofs_reference_idx" ON "payment_proofs"("reference");
