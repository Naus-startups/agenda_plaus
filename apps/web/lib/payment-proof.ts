import { shrinkImage } from "./shrink-image";

// O que a API aceita como comprovativo (apps/api/src/modules/payments/payments.storage.ts).
export const ACCEPTED_PROOF_TYPES = "image/jpeg,image/png,image/webp,application/pdf";

// O pedido passa por uma função do Vercel, que corta corpos acima de 4,5 MB.
export const MAX_PROOF_BYTES = 4 * 1024 * 1024;

// Acima disto, uma foto é reduzida antes de enviar — com detalhe suficiente para se ler.
const SHRINK_ABOVE_BYTES = 1.5 * 1024 * 1024;

// Transferência e Multicaixa Express só se registam com o comprovativo (a API também o exige).
export const METHODS_REQUIRING_PROOF = new Set(["TRANSFER", "MOBILE_MONEY"]);

export type PaymentProof = {
  fileName: string;
  mimeType: string;
  size: number;
  uploadedAt: string;
};

export function proofUrl(appointmentId: string): string {
  return `/api/appointments/payments/${encodeURIComponent(appointmentId)}/proof`;
}

export function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toLocaleString("pt-AO", { maximumFractionDigits: 1 })} MB`;
}

// Confirma o tipo e o tamanho e reduz as fotos grandes. Lança um erro com a mensagem a mostrar.
export async function prepareProof(file: File): Promise<File> {
  if (!ACCEPTED_PROOF_TYPES.split(",").includes(file.type)) {
    throw new Error("Formato não suportado. Use uma imagem (JPEG, PNG, WEBP) ou um PDF.");
  }

  let prepared = file;
  if (file.type.startsWith("image/") && file.size > SHRINK_ABOVE_BYTES) {
    prepared = await shrinkImage(file, { maxSide: 2400, quality: 0.85 }).catch(() => file);
  }

  if (prepared.size > MAX_PROOF_BYTES) {
    throw new Error(`O ficheiro é demasiado grande (${formatFileSize(prepared.size)}). O máximo é 4 MB.`);
  }
  return prepared;
}
