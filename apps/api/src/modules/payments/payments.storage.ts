import { randomUUID } from "node:crypto";
import { PROOFS_BUCKET, getStorageClient, isStorageConfigured } from "../../config/storage";
import { ValidationError } from "../../shared/errors";

export type ProofFile = { buffer: Buffer; mimetype: string; originalname: string; size: number };

// Where a stored proof's bytes are: a path in the private bucket, or the bytes themselves
// when Supabase isn't configured (then kept in the payment_proofs row).
export type StoredProof = { path: string | null; data: Uint8Array<ArrayBuffer> | null };

const EXTENSION_BY_MIME_TYPE: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "application/pdf": "pdf",
};

// Without external storage the file goes in the database row, so it is kept smaller.
const MAX_INLINE_BYTES = 2 * 1024 * 1024;

// As in gallery.storage.ts, the declared type is only a claim: the first bytes have to
// match it, or an HTML page could be stored and later served as a "proof".
function hasProofSignature(buffer: Buffer, mimetype: string): boolean {
  switch (mimetype) {
    case "image/jpeg":
      return buffer.length > 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff;
    case "image/png":
      return buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
    case "image/webp":
      return buffer.subarray(0, 4).toString("latin1") === "RIFF" && buffer.subarray(8, 12).toString("latin1") === "WEBP";
    case "application/pdf":
      return buffer.subarray(0, 5).toString("latin1") === "%PDF-";
    default:
      return false;
  }
}

// The name is only shown back to staff and used for the download; anything that could
// break a Content-Disposition header (quotes, control characters, path parts) goes.
// Multer reads the name's bytes as latin1, so "transferência.pdf" arrives mangled; they are
// read again as UTF-8 unless that doesn't decode cleanly (a name that really was latin1).
export function cleanProofFileName(name: string, mimetype: string): string {
  const utf8 = Buffer.from(name, "latin1").toString("utf8");
  const base = (utf8.includes("\uFFFD") ? name : utf8).split(/[\\/]/).pop() ?? "";
  const cleaned = base.replace(/[\u0000-\u001f\u007f"\\]/g, "").trim().slice(0, 120);
  return cleaned || `comprovativo.${EXTENSION_BY_MIME_TYPE[mimetype] ?? "bin"}`;
}

export function assertValidProof(file: ProofFile): void {
  if (!(file.mimetype in EXTENSION_BY_MIME_TYPE)) {
    throw new ValidationError("O comprovativo tem de ser uma imagem (JPEG, PNG, WEBP) ou um PDF.", "PAYMENT_PROOF_INVALID_TYPE");
  }
  if (!hasProofSignature(file.buffer, file.mimetype)) {
    throw new ValidationError("O ficheiro do comprovativo está corrompido ou não é do tipo indicado.", "PAYMENT_PROOF_CONTENT_INVALID");
  }
  if (!isStorageConfigured() && file.buffer.length > MAX_INLINE_BYTES) {
    throw new ValidationError("O comprovativo é demasiado grande (máximo 2 MB).", "PAYMENT_PROOF_TOO_LARGE");
  }
}

// The bucket is private and created the first time it's needed, so a deploy doesn't need
// a manual step in the Supabase console.
async function uploadToBucket(path: string, file: ProofFile) {
  const bucket = getStorageClient().storage.from(PROOFS_BUCKET);
  const first = await bucket.upload(path, file.buffer, { contentType: file.mimetype });
  if (!first.error) return;

  if (!/not found/i.test(first.error.message)) {
    throw new Error(`Falha ao enviar o comprovativo para o storage: ${first.error.message}`);
  }
  const created = await getStorageClient().storage.createBucket(PROOFS_BUCKET, { public: false });
  if (created.error && !/already exists/i.test(created.error.message)) {
    throw new Error(`Falha ao criar o bucket dos comprovativos: ${created.error.message}`);
  }
  const retry = await bucket.upload(path, file.buffer, { contentType: file.mimetype });
  if (retry.error) {
    throw new Error(`Falha ao enviar o comprovativo para o storage: ${retry.error.message}`);
  }
}

export async function storeProof(businessId: string, file: ProofFile): Promise<StoredProof> {
  if (!isStorageConfigured()) return { path: null, data: new Uint8Array(file.buffer) };

  const path = `businesses/${businessId}/${randomUUID()}.${EXTENSION_BY_MIME_TYPE[file.mimetype]}`;
  await uploadToBucket(path, file);
  return { path, data: null };
}

// Best-effort cleanup of a file whose payment was never written.
export async function discardProof(stored: StoredProof): Promise<void> {
  if (!stored.path) return;
  const { error } = await getStorageClient().storage.from(PROOFS_BUCKET).remove([stored.path]);
  if (error) console.error("Comprovativo órfão por apagar do storage:", stored.path, error.message);
}

export async function readProof(stored: { path: string | null; data: Uint8Array | null }): Promise<Buffer> {
  if (stored.data) return Buffer.from(stored.data);
  if (!stored.path) throw new Error("Comprovativo sem ficheiro associado.");

  const { data, error } = await getStorageClient().storage.from(PROOFS_BUCKET).download(stored.path);
  if (error || !data) throw new Error(`Falha ao ler o comprovativo do storage: ${error?.message ?? "sem dados"}`);
  return Buffer.from(await data.arrayBuffer());
}
