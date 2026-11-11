"use client";

import { useEffect, useState } from "react";
import { AlertCircle, Download, ExternalLink, FileText, Loader2, Paperclip, RefreshCw } from "lucide-react";
import { formatFileSize, proofUrl, type PaymentProof } from "@/lib/payment-proof";
import { formatDateTime } from "@/components/financeiro/finance-utils";

type Props = {
  appointmentId: string;
  proof: PaymentProof;
};

/*
 * Mostra o comprovativo anexado ao pagamento: a imagem, ou o PDF num visualizador.
 * O ficheiro é lido para um blob: as respostas do site não se deixam abrir em <iframe>
 * (X-Frame-Options: DENY), mas um blob: criado aqui pode.
 */
export function ProofViewer({ appointmentId, proof }: Props) {
  const [result, setResult] = useState<{ key: string; url?: string; error?: string } | null>(null);
  const [attempt, setAttempt] = useState(0);

  const requestKey = `${appointmentId}#${attempt}`;
  const current = result?.key === requestKey ? result : null;
  const isPdf = proof.mimeType === "application/pdf";

  useEffect(() => {
    const controller = new AbortController();
    let objectUrl: string | null = null;

    fetch(proofUrl(appointmentId), { cache: "no-store", signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) {
          const data = await response.json().catch(() => null);
          throw new Error(data?.error || "Não foi possível abrir o comprovativo.");
        }
        objectUrl = URL.createObjectURL(await response.blob());
        setResult({ key: requestKey, url: objectUrl });
      })
      .catch((err) => {
        if (controller.signal.aborted) return;
        setResult({ key: requestKey, error: err instanceof Error ? err.message : "Não foi possível abrir o comprovativo." });
      });

    return () => {
      controller.abort();
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [appointmentId, requestKey]);

  return (
    <section className="overflow-hidden rounded-2xl border border-[var(--border)] bg-[var(--surface)]">
      <header className="flex items-center gap-3 border-b border-[var(--border)] px-4 py-3">
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
          <Paperclip size={18} />
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold text-[var(--foreground)]">Comprovativo</p>
          <p className="truncate text-xs text-[var(--muted)]" title={proof.fileName}>
            {proof.fileName} · {formatFileSize(proof.size)} · {formatDateTime(proof.uploadedAt)}
          </p>
        </div>

        {current?.url && (
          <div className="flex shrink-0 gap-1.5">
            <a
              href={current.url}
              target="_blank"
              rel="noopener"
              aria-label="Abrir numa nova janela"
              title="Abrir"
              className="flex h-9 w-9 items-center justify-center rounded-lg border border-[var(--border)] text-[var(--foreground)] transition hover:bg-[var(--surface-secondary)]"
            >
              <ExternalLink size={16} />
            </a>
            <a
              href={current.url}
              download={proof.fileName}
              aria-label="Descarregar"
              title="Descarregar"
              className="flex h-9 w-9 items-center justify-center rounded-lg border border-[var(--border)] text-[var(--foreground)] transition hover:bg-[var(--surface-secondary)]"
            >
              <Download size={16} />
            </a>
          </div>
        )}
      </header>

      <div className="bg-[var(--surface-secondary)]">
        {!current && (
          <div className="flex h-48 items-center justify-center gap-2 text-sm text-[var(--muted)]">
            <Loader2 size={18} className="animate-spin" />A abrir o comprovativo...
          </div>
        )}

        {current?.error && (
          <div className="flex h-48 flex-col items-center justify-center gap-3 px-6 text-center">
            <p className="flex items-center gap-1.5 text-sm text-rose-600 dark:text-rose-400">
              <AlertCircle size={16} />
              {current.error}
            </p>
            <button
              type="button"
              onClick={() => setAttempt((value) => value + 1)}
              className="inline-flex items-center gap-1.5 rounded-lg border border-[var(--border)] px-3 py-1.5 text-xs font-semibold text-[var(--foreground)] transition hover:bg-[var(--surface)]"
            >
              <RefreshCw size={14} />
              Tentar novamente
            </button>
          </div>
        )}

        {current?.url &&
          (isPdf ? (
            <>
              <iframe src={current.url} title={`Comprovativo: ${proof.fileName}`} className="hidden h-[480px] w-full border-0 sm:block" />
              {/* Nos telemóveis o PDF não se mostra dentro da página: abre-se à parte. */}
              <a
                href={current.url}
                target="_blank"
                rel="noopener"
                className="flex h-32 flex-col items-center justify-center gap-2 text-sm font-semibold text-primary sm:hidden"
              >
                <FileText size={28} />
                Abrir o PDF
              </a>
            </>
          ) : (
            <a href={current.url} target="_blank" rel="noopener" className="block" title="Ver em tamanho real">
              {/* Imagem lida para um blob:, por isso <img>. */}
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={current.url} alt={`Comprovativo: ${proof.fileName}`} className="mx-auto max-h-[480px] w-auto object-contain" />
            </a>
          ))}
      </div>
    </section>
  );
}
