"use client";

import type { ReactNode } from "react";
import { Loader2, X } from "lucide-react";

/*
 * Peças comuns às secções de Fidelização e benefícios, com as cores do tema do painel
 * (variáveis de globals.css), para ficarem certas no modo claro e no escuro.
 */

export const inputClass =
  "w-full rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3 py-2.5 text-sm text-[var(--foreground)] outline-none transition placeholder:text-[var(--subtle)] focus:border-primary focus:ring-2 focus:ring-primary/15";

export const secondaryButton =
  "inline-flex h-9 items-center justify-center gap-2 rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3 text-sm font-medium text-[var(--foreground)] transition hover:bg-[var(--surface-hover)] disabled:cursor-not-allowed disabled:opacity-60";

export const dangerButton =
  "inline-flex h-9 items-center justify-center gap-2 rounded-lg border border-red-500/30 bg-red-500/5 px-3 text-sm font-medium text-red-600 transition hover:bg-red-500/10 disabled:cursor-not-allowed disabled:opacity-60 dark:text-red-400";

export function Panel({ title, description, actions, children }: { title?: string; description?: string; actions?: ReactNode; children: ReactNode }) {
  return (
    <section className="rounded-xl border border-[var(--border)] bg-[var(--surface)] shadow-sm">
      {title || actions ? (
        <div className="flex flex-col gap-3 border-b border-[var(--border)] px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="min-w-0">
            {title ? <h2 className="text-base font-semibold text-[var(--foreground)]">{title}</h2> : null}
            {description ? <p className="mt-0.5 text-sm text-[var(--muted)]">{description}</p> : null}
          </div>
          {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
        </div>
      ) : null}
      <div>{children}</div>
    </section>
  );
}

type Tone = "brand" | "success" | "warning" | "danger" | "neutral";
const TONES: Record<Tone, string> = {
  brand: "bg-primary/10 text-[var(--brand-text)] ring-primary/20",
  success: "bg-emerald-500/10 text-emerald-700 ring-emerald-500/25 dark:text-emerald-400",
  warning: "bg-amber-500/10 text-amber-700 ring-amber-500/25 dark:text-amber-400",
  danger: "bg-red-500/10 text-red-700 ring-red-500/25 dark:text-red-400",
  neutral: "bg-[var(--surface-secondary)] text-[var(--muted)] ring-[var(--border)]",
};

export function Badge({ tone = "neutral", children }: { tone?: Tone; children: ReactNode }) {
  return <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold ring-1 ${TONES[tone]}`}>{children}</span>;
}

export function Field({ label, hint, children, className = "" }: { label: string; hint?: string; children: ReactNode; className?: string }) {
  return (
    <label className={`block ${className}`}>
      <span className="mb-1.5 block text-sm font-medium text-[var(--foreground)]">{label}</span>
      {children}
      {hint ? <span className="mt-1 block text-xs text-[var(--muted)]">{hint}</span> : null}
    </label>
  );
}

export function Toggle({ checked, onChange, label, hint }: { checked: boolean; onChange: (next: boolean) => void; label: string; hint?: string }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      onClick={() => onChange(!checked)}
      className="flex w-full items-start justify-between gap-4 rounded-lg border border-[var(--border)] px-3 py-2.5 text-left transition hover:bg-[var(--surface-hover)]"
    >
      <span className="min-w-0">
        <span className="block text-sm font-medium text-[var(--foreground)]">{label}</span>
        {hint ? <span className="mt-0.5 block text-xs text-[var(--muted)]">{hint}</span> : null}
      </span>
      <span className={`relative mt-0.5 inline-flex h-5 w-9 shrink-0 rounded-full transition ${checked ? "bg-primary" : "bg-[var(--border-strong)]"}`}>
        <span className={`absolute top-0.5 h-4 w-4 rounded-full bg-white shadow transition ${checked ? "left-[18px]" : "left-0.5"}`} />
      </span>
    </button>
  );
}

export function Dialog({
  open,
  title,
  description,
  onClose,
  children,
  footer,
  wide,
}: {
  open: boolean;
  title: string;
  description?: string;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
  wide?: boolean;
}) {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/50 p-4" onClick={onClose} role="dialog" aria-modal="true" aria-label={title}>
      <div
        className={`flex max-h-[92vh] w-full ${wide ? "max-w-3xl" : "max-w-lg"} flex-col overflow-hidden rounded-2xl border border-[var(--border)] bg-[var(--surface)] shadow-xl`}
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-4 border-b border-[var(--border)] px-6 py-4">
          <div>
            <h2 className="text-lg font-semibold text-[var(--foreground)]">{title}</h2>
            {description ? <p className="mt-0.5 text-sm text-[var(--muted)]">{description}</p> : null}
          </div>
          <button type="button" onClick={onClose} className="rounded-lg p-1.5 text-[var(--muted)] transition hover:bg-[var(--surface-hover)]" aria-label="Fechar">
            <X size={18} />
          </button>
        </div>
        <div className="flex-1 overflow-y-auto px-6 py-5">{children}</div>
        {footer ? <div className="flex flex-wrap justify-end gap-2 border-t border-[var(--border)] px-6 py-4">{footer}</div> : null}
      </div>
    </div>
  );
}

export function EmptyState({ icon, title, text, action }: { icon: ReactNode; title: string; text: string; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center px-6 py-12 text-center">
      <div className="flex h-12 w-12 items-center justify-center rounded-full bg-[var(--surface-secondary)] text-[var(--muted)]">{icon}</div>
      <p className="mt-3 font-semibold text-[var(--foreground)]">{title}</p>
      <p className="mt-1 max-w-sm text-sm text-[var(--muted)]">{text}</p>
      {action ? <div className="mt-4">{action}</div> : null}
    </div>
  );
}

export function Loading() {
  return (
    <div className="flex items-center justify-center py-16 text-[var(--muted)]">
      <Loader2 className="animate-spin" size={22} />
    </div>
  );
}

export function ErrorBox({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div className="m-5 rounded-lg border border-red-500/30 bg-red-500/5 p-4 text-sm text-red-700 dark:text-red-400">
      <p>{message}</p>
      {onRetry ? (
        <button type="button" onClick={onRetry} className="mt-2 font-semibold underline">
          Tentar novamente
        </button>
      ) : null}
    </div>
  );
}

export type ServiceOption = { id: string; name: string; price: number };

// Escolha de serviços: nenhum marcado quer dizer "todos os serviços".
export function ServicePicker({ services, value, onChange, allLabel = "Todos os serviços" }: { services: ServiceOption[]; value: string[]; onChange: (next: string[]) => void; allLabel?: string }) {
  const toggle = (id: string) => onChange(value.includes(id) ? value.filter((item) => item !== id) : [...value, id]);
  return (
    <div className="max-h-48 space-y-1 overflow-y-auto rounded-lg border border-[var(--border)] p-2">
      <label className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-[var(--surface-hover)]">
        <input type="checkbox" checked={value.length === 0} onChange={() => onChange([])} className="accent-[var(--brand)]" />
        <span className="font-medium text-[var(--foreground)]">{allLabel}</span>
      </label>
      {services.map((service) => (
        <label key={service.id} className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-[var(--surface-hover)]">
          <input type="checkbox" checked={value.includes(service.id)} onChange={() => toggle(service.id)} className="accent-[var(--brand)]" />
          <span className="flex-1 text-[var(--foreground)]">{service.name}</span>
          <span className="text-xs text-[var(--muted)]">{service.price.toLocaleString("pt-PT")} Kz</span>
        </label>
      ))}
    </div>
  );
}

// "2026-11-08T10:00" ⇄ ISO, para os campos datetime-local.
export function toLocalInput(iso: string | null): string {
  if (!iso) return "";
  const date = new Date(iso);
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

export function fromLocalInput(value: string): string | null {
  return value ? new Date(value).toISOString() : null;
}
