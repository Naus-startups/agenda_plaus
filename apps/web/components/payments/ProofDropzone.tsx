"use client";

import { ClipboardEvent, DragEvent, useEffect, useId, useMemo, useRef, useState } from "react";
import { AlertCircle, FileText, Loader2, UploadCloud, X } from "lucide-react";
import { ACCEPTED_PROOF_TYPES, formatFileSize, prepareProof } from "@/lib/payment-proof";

type Props = {
  file: File | null;
  onChange: (file: File | null) => void;
  disabled?: boolean;
};

/*
 * Área para largar o comprovativo (imagem ou PDF). Também abre o seletor de ficheiros com
 * um clique e aceita uma imagem colada (Ctrl+V), que é como chega muitas vezes pelo WhatsApp.
 */
export function ProofDropzone({ file, onChange, disabled = false }: Props) {
  const inputId = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  const [preparing, setPreparing] = useState(false);
  const [error, setError] = useState("");
  const previewUrl = useMemo(() => (file?.type.startsWith("image/") ? URL.createObjectURL(file) : null), [file]);

  useEffect(() => {
    if (!previewUrl) return;
    return () => URL.revokeObjectURL(previewUrl);
  }, [previewUrl]);

  async function accept(picked: File | undefined) {
    if (!picked || disabled) return;
    setError("");
    setPreparing(true);
    try {
      onChange(await prepareProof(picked));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Não foi possível usar este ficheiro.");
    } finally {
      setPreparing(false);
    }
  }

  function onDrop(event: DragEvent<HTMLElement>) {
    event.preventDefault();
    setDragging(false);
    accept(event.dataTransfer.files[0]);
  }

  function onPaste(event: ClipboardEvent<HTMLElement>) {
    const pasted = event.clipboardData.files[0];
    if (!pasted) return;
    event.preventDefault();
    accept(pasted);
  }

  const input = (
    <input
      ref={inputRef}
      id={inputId}
      type="file"
      accept={ACCEPTED_PROOF_TYPES}
      className="sr-only"
      disabled={disabled || preparing}
      onChange={(event) => {
        accept(event.target.files?.[0]);
        event.target.value = "";
      }}
    />
  );

  if (file) {
    const isPdf = file.type === "application/pdf";

    return (
      <div className="flex items-center gap-3 rounded-2xl border border-primary/40 bg-primary/[0.04] p-3">
        {previewUrl ? (
          // Pré-visualização local (blob:), por isso <img>.
          // eslint-disable-next-line @next/next/no-img-element
          <img src={previewUrl} alt="" className="h-14 w-14 shrink-0 rounded-xl border border-[var(--border)] object-cover" />
        ) : (
          <span className="flex h-14 w-14 shrink-0 items-center justify-center rounded-xl bg-red-500/10 text-red-600 dark:text-red-400">
            <FileText className="h-6 w-6" />
          </span>
        )}

        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold">{file.name}</p>
          <p className="mt-0.5 text-xs text-[var(--muted)]">
            {isPdf ? "PDF" : "Imagem"} · {formatFileSize(file.size)}
          </p>
          <label htmlFor={inputId} className={`mt-1 inline-block text-xs font-semibold text-primary ${disabled ? "pointer-events-none opacity-50" : "cursor-pointer hover:underline"}`}>
            Trocar ficheiro
          </label>
          {input}
        </div>

        <button
          type="button"
          onClick={() => onChange(null)}
          disabled={disabled}
          aria-label="Remover comprovativo"
          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl text-[var(--muted)] transition hover:bg-[var(--surface-secondary)] hover:text-[var(--foreground)] disabled:opacity-40"
        >
          <X className="h-[18px] w-[18px]" />
        </button>
      </div>
    );
  }

  return (
    <div>
      <label
        htmlFor={inputId}
        tabIndex={0}
        onKeyDown={(event) => {
          if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            inputRef.current?.click();
          }
        }}
        onDragOver={(event) => {
          event.preventDefault();
          if (!disabled) setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={onDrop}
        onPaste={onPaste}
        className={`flex cursor-pointer flex-col items-center rounded-2xl border-2 border-dashed px-6 py-7 text-center outline-none transition focus-visible:border-primary focus-visible:ring-4 focus-visible:ring-primary/10 ${
          dragging
            ? "border-primary bg-primary/[0.06]"
            : error
              ? "border-red-500/50"
              : "border-[var(--border)] hover:border-primary/40 hover:bg-[var(--surface-secondary)]"
        } ${disabled ? "pointer-events-none opacity-50" : ""}`}
      >
        <span className="flex h-11 w-11 items-center justify-center rounded-2xl bg-primary/10 text-primary">
          {preparing ? <Loader2 className="h-[22px] w-[22px] animate-spin" /> : <UploadCloud className="h-[22px] w-[22px]" />}
        </span>
        <span className="mt-3 text-sm font-semibold">
          {preparing ? "A preparar o ficheiro..." : dragging ? "Largue para anexar" : "Arraste o comprovativo para aqui"}
        </span>
        <span className="mt-1 text-xs text-[var(--muted)]">
          ou <span className="font-semibold text-primary">escolha um ficheiro</span> · imagem ou PDF, até 4 MB
        </span>
      </label>
      {input}

      {error && (
        <p className="mt-2 flex items-start gap-1.5 text-xs text-red-600 dark:text-red-300">
          <AlertCircle className="mt-px h-3.5 w-3.5 shrink-0" />
          {error}
        </p>
      )}
    </div>
  );
}
