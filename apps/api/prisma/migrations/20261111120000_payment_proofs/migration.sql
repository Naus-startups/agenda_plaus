-- Comprovativo de um pagamento por transferência / Multicaixa Express (imagem ou PDF).
CREATE TABLE "payment_proofs" (
    "id" TEXT NOT NULL,
    "paymentId" TEXT NOT NULL,
    "fileName" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "size" INTEGER NOT NULL,
    "path" TEXT,
    "data" BYTEA,
    "uploadedById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "payment_proofs_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "payment_proofs_paymentId_key" ON "payment_proofs"("paymentId");

ALTER TABLE "payment_proofs" ADD CONSTRAINT "payment_proofs_paymentId_fkey" FOREIGN KEY ("paymentId") REFERENCES "payments"("id") ON DELETE CASCADE ON UPDATE CASCADE;
