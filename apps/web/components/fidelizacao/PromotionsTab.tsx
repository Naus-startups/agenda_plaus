"use client";

import { useState } from "react";
import { toast } from "sonner";
import { BarChart3, Megaphone, Pause, Pencil, Play, Plus, Square, Trash2 } from "lucide-react";
import type { DiscountType, PromotionAudience, PromotionDTO, PromotionResultsDTO, PromotionStatus } from "@slotix/types";

import { brandButton } from "@/components/ui/PageActions";
import { confirmAction } from "@/lib/confirm-action";
import { discountText, formatDate, formatKz, loyaltyFetch } from "@/lib/loyalty-api";
import { useLoyalty } from "./useLoyalty";
import {
  Badge,
  Dialog,
  EmptyState,
  ErrorBox,
  Field,
  Loading,
  Panel,
  ServicePicker,
  Toggle,
  fromLocalInput,
  inputClass,
  secondaryButton,
  toLocalInput,
  type ServiceOption,
} from "./ui";

export const PROMOTION_STATUS: Record<PromotionStatus, { label: string; tone: "success" | "warning" | "neutral" | "brand" }> = {
  DRAFT: { label: "Rascunho", tone: "neutral" },
  ACTIVE: { label: "Ativa", tone: "success" },
  PAUSED: { label: "Pausada", tone: "warning" },
  ENDED: { label: "Terminada", tone: "neutral" },
};

const WEEKDAYS = [
  { value: 1, label: "Seg" },
  { value: 2, label: "Ter" },
  { value: 3, label: "Qua" },
  { value: 4, label: "Qui" },
  { value: 5, label: "Sex" },
  { value: 6, label: "Sáb" },
  { value: 7, label: "Dom" },
];

const toTime = (minute: number | null) => (minute === null ? "" : `${String(Math.floor(minute / 60)).padStart(2, "0")}:${String(minute % 60).padStart(2, "0")}`);
const fromTime = (value: string) => {
  if (!value) return null;
  const [hours, minutes] = value.split(":").map(Number);
  return hours * 60 + minutes;
};

type Form = {
  name: string;
  description: string;
  audience: PromotionAudience;
  discountType: DiscountType;
  discountValue: string;
  serviceIds: string[];
  startsAt: string;
  endsAt: string;
  membersFrom: string;
  weekdays: number[];
  startTime: string;
  endTime: string;
  maxUses: string;
  maxUsesPerClient: string;
  stackable: boolean;
  releaseOnCancel: boolean;
};

const EMPTY: Form = {
  name: "",
  description: "",
  audience: "MEMBERS",
  discountType: "PERCENT",
  discountValue: "10",
  serviceIds: [],
  startsAt: "",
  endsAt: "",
  membersFrom: "",
  weekdays: [],
  startTime: "",
  endTime: "",
  maxUses: "",
  maxUsesPerClient: "",
  stackable: false,
  releaseOnCancel: true,
};

function toForm(promotion: PromotionDTO): Form {
  return {
    name: promotion.name,
    description: promotion.description ?? "",
    audience: promotion.audience,
    discountType: promotion.discountType,
    discountValue: promotion.discountType === "FREE" ? "" : String(promotion.discountValue),
    serviceIds: promotion.serviceIds,
    startsAt: toLocalInput(promotion.startsAt),
    endsAt: toLocalInput(promotion.endsAt),
    membersFrom: toLocalInput(promotion.membersFrom),
    weekdays: promotion.weekdays,
    startTime: toTime(promotion.startMinute),
    endTime: toTime(promotion.endMinute),
    maxUses: promotion.maxUses ? String(promotion.maxUses) : "",
    maxUsesPerClient: promotion.maxUsesPerClient ? String(promotion.maxUsesPerClient) : "",
    stackable: promotion.stackable,
    releaseOnCancel: promotion.releaseOnCancel,
  };
}

function describe(promotion: PromotionDTO, services: ServiceOption[]): string {
  const parts = [
    promotion.serviceIds.length === 0 ? "Todos os serviços" : services.filter((service) => promotion.serviceIds.includes(service.id)).map((service) => service.name).join(", "),
  ];
  if (promotion.weekdays.length > 0) parts.push(WEEKDAYS.filter((day) => promotion.weekdays.includes(day.value)).map((day) => day.label).join(", "));
  if (promotion.startMinute !== null || promotion.endMinute !== null) parts.push(`${toTime(promotion.startMinute) || "00:00"}–${toTime(promotion.endMinute) || "24:00"}`);
  if (promotion.startsAt || promotion.endsAt) parts.push(`${formatDate(promotion.startsAt)} a ${formatDate(promotion.endsAt)}`);
  if (promotion.stackable) parts.push("acumulável");
  return parts.join(" · ");
}

export function PromotionsTab({ isOwner, services }: { isOwner: boolean; services: ServiceOption[] }) {
  const { data: promotions, error, reload: load } = useLoyalty<PromotionDTO[]>("promotions");
  const [editing, setEditing] = useState<PromotionDTO | "new" | null>(null);
  const [form, setForm] = useState<Form>(EMPTY);
  const [saving, setSaving] = useState(false);
  const [results, setResults] = useState<PromotionResultsDTO | null>(null);


  const open = (promotion: PromotionDTO | "new") => {
    setEditing(promotion);
    setForm(promotion === "new" ? EMPTY : toForm(promotion));
  };

  const save = async () => {
    setSaving(true);
    try {
      const body = {
        name: form.name.trim(),
        description: form.description.trim() || null,
        audience: form.audience,
        discountType: form.discountType,
        discountValue: form.discountType === "FREE" ? 0 : Number(form.discountValue) || 0,
        serviceIds: form.serviceIds,
        startsAt: fromLocalInput(form.startsAt),
        endsAt: fromLocalInput(form.endsAt),
        membersFrom: form.audience === "ALL" ? fromLocalInput(form.membersFrom) : null,
        weekdays: form.weekdays,
        startMinute: fromTime(form.startTime),
        endMinute: fromTime(form.endTime),
        maxUses: Number(form.maxUses) || null,
        maxUsesPerClient: Number(form.maxUsesPerClient) || null,
        stackable: form.stackable,
        releaseOnCancel: form.releaseOnCancel,
      };
      if (editing === "new") await loyaltyFetch("promotions", { method: "POST", body });
      else if (editing) await loyaltyFetch(`promotions/${editing.id}`, { method: "PUT", body });
      toast.success(editing === "new" ? "Promoção criada como rascunho. Ative-a quando estiver pronta." : "Promoção guardada.");
      setEditing(null);
      load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Não foi possível guardar.");
    } finally {
      setSaving(false);
    }
  };

  const setStatus = async (promotion: PromotionDTO, status: "ACTIVE" | "PAUSED" | "ENDED") => {
    if (status === "ENDED" && !(await confirmAction(`Terminar "${promotion.name}"? Uma promoção terminada não pode voltar a ser ativada.`, "Terminar"))) return;
    try {
      await loyaltyFetch(`promotions/${promotion.id}/status`, { method: "PATCH", body: { status } });
      toast.success(status === "ACTIVE" ? "Promoção ativa." : status === "PAUSED" ? "Promoção pausada." : "Promoção terminada.");
      load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Não foi possível alterar.");
    }
  };

  const remove = async (promotion: PromotionDTO) => {
    if (!(await confirmAction(`Apagar o rascunho "${promotion.name}"?`, "Apagar"))) return;
    try {
      await loyaltyFetch(`promotions/${promotion.id}`, { method: "DELETE" });
      toast.success("Promoção apagada.");
      load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Não foi possível apagar.");
    }
  };

  const showResults = async (promotion: PromotionDTO) => {
    try {
      setResults(await loyaltyFetch<PromotionResultsDTO>(`promotions/${promotion.id}/results`));
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Não foi possível carregar os resultados.");
    }
  };

  const set = <K extends keyof Form>(key: K, value: Form[K]) => setForm((current) => ({ ...current, [key]: value }));

  return (
    <Panel
      title="Promoções"
      description="Campanhas com desconto, para todos os clientes ou só para membros. O desconto é aplicado automaticamente na marcação."
      actions={
        isOwner ? (
          <button type="button" className={brandButton} onClick={() => open("new")}>
            <Plus size={16} /> Nova promoção
          </button>
        ) : null
      }
    >
      {error ? (
        <ErrorBox message={error} onRetry={load} />
      ) : !promotions ? (
        <Loading />
      ) : promotions.length === 0 ? (
        <EmptyState icon={<Megaphone size={20} />} title="Sem promoções" text="Ex.: 20% no corte para membros, ou 10% para todos às terças-feiras." />
      ) : (
        <ul className="divide-y divide-[var(--border)]">
          {promotions.map((promotion) => {
            const status = PROMOTION_STATUS[promotion.status];
            const share = promotion.maxUses ? Math.min(100, Math.round((promotion.usedCount / promotion.maxUses) * 100)) : null;
            return (
              <li key={promotion.id} className="flex flex-col gap-3 px-5 py-4 lg:flex-row lg:items-center">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="font-medium text-[var(--foreground)]">{promotion.name}</p>
                    <Badge tone={status.tone}>{status.label}</Badge>
                    <Badge tone="brand">{promotion.audience === "MEMBERS" ? "Só membros" : "Todos os clientes"}</Badge>
                    <span className="text-sm font-semibold text-[var(--foreground)]">−{discountText(promotion.discountType, promotion.discountValue)}</span>
                  </div>
                  <p className="mt-1 text-sm text-[var(--muted)]">{describe(promotion, services)}</p>
                  <div className="mt-2 flex items-center gap-3">
                    <span className="text-xs text-[var(--muted)]">
                      {promotion.usedCount}
                      {promotion.maxUses ? ` de ${promotion.maxUses} vagas usadas` : " usos"}
                      {promotion.maxUsesPerClient ? ` · máx. ${promotion.maxUsesPerClient} por cliente` : ""}
                    </span>
                    {share !== null ? (
                      <div className="h-1.5 w-32 overflow-hidden rounded-full bg-[var(--surface-secondary)]">
                        <div className="h-full rounded-full bg-primary" style={{ width: `${share}%` }} />
                      </div>
                    ) : null}
                  </div>
                </div>
                <div className="flex flex-wrap gap-2">
                  {isOwner ? (
                    <>
                      <button type="button" className={secondaryButton} onClick={() => showResults(promotion)}>
                        <BarChart3 size={15} /> Resultados
                      </button>
                      {promotion.status === "DRAFT" || promotion.status === "PAUSED" ? (
                        <button type="button" className={secondaryButton} onClick={() => setStatus(promotion, "ACTIVE")}>
                          <Play size={15} /> Ativar
                        </button>
                      ) : null}
                      {promotion.status === "ACTIVE" ? (
                        <button type="button" className={secondaryButton} onClick={() => setStatus(promotion, "PAUSED")}>
                          <Pause size={15} /> Pausar
                        </button>
                      ) : null}
                      {promotion.status !== "ENDED" ? (
                        <>
                          <button type="button" className={secondaryButton} onClick={() => setStatus(promotion, "ENDED")} aria-label="Terminar">
                            <Square size={15} />
                          </button>
                          <button type="button" className={secondaryButton} onClick={() => open(promotion)} aria-label="Editar">
                            <Pencil size={15} />
                          </button>
                        </>
                      ) : null}
                      {promotion.status === "DRAFT" && promotion.usedCount === 0 ? (
                        <button type="button" className={secondaryButton} onClick={() => remove(promotion)} aria-label="Apagar">
                          <Trash2 size={15} />
                        </button>
                      ) : null}
                    </>
                  ) : null}
                </div>
              </li>
            );
          })}
        </ul>
      )}

      <Dialog
        open={editing !== null}
        title={editing === "new" ? "Nova promoção" : "Editar promoção"}
        description="Fica como rascunho até a ativar."
        onClose={() => !saving && setEditing(null)}
        wide
        footer={
          <>
            <button type="button" className={secondaryButton} onClick={() => setEditing(null)} disabled={saving}>
              Cancelar
            </button>
            <button type="button" className={brandButton} onClick={save} disabled={saving}>
              Guardar
            </button>
          </>
        }
      >
        <div className="space-y-6">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Field label="Nome" className="sm:col-span-2">
              <input className={inputClass} value={form.name} onChange={(e) => set("name", e.target.value)} placeholder="Ex.: Corte com 20% para membros" />
            </Field>
            <Field label="Descrição" className="sm:col-span-2">
              <textarea className={inputClass} rows={2} value={form.description} onChange={(e) => set("description", e.target.value)} />
            </Field>
            <Field label="Para quem">
              <select className={inputClass} value={form.audience} onChange={(e) => set("audience", e.target.value as PromotionAudience)}>
                <option value="MEMBERS">Só membros</option>
                <option value="ALL">Todos os clientes</option>
              </select>
            </Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Desconto">
                <select className={inputClass} value={form.discountType} onChange={(e) => set("discountType", e.target.value as DiscountType)}>
                  <option value="PERCENT">%</option>
                  <option value="AMOUNT">Kz</option>
                  <option value="FREE">Grátis</option>
                </select>
              </Field>
              {form.discountType !== "FREE" ? (
                <Field label="Valor">
                  <input className={inputClass} inputMode="decimal" value={form.discountValue} onChange={(e) => set("discountValue", e.target.value)} />
                </Field>
              ) : null}
            </div>
            <Field label="Serviços abrangidos" className="sm:col-span-2">
              <ServicePicker services={services} value={form.serviceIds} onChange={(serviceIds) => set("serviceIds", serviceIds)} />
            </Field>
          </div>

          <div>
            <p className="mb-3 text-sm font-semibold text-[var(--foreground)]">Quando se aplica</p>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <Field label="Início" hint="Vazio = a partir de quando for ativada.">
                <input type="datetime-local" className={inputClass} value={form.startsAt} onChange={(e) => set("startsAt", e.target.value)} />
              </Field>
              <Field label="Fim" hint="Vazio = até a terminar.">
                <input type="datetime-local" className={inputClass} value={form.endsAt} onChange={(e) => set("endsAt", e.target.value)} />
              </Field>
              {form.audience === "ALL" ? (
                <Field label="Acesso antecipado dos membros" hint="Os membros podem marcar com o desconto a partir desta data, antes do início." className="sm:col-span-2">
                  <input type="datetime-local" className={inputClass} value={form.membersFrom} onChange={(e) => set("membersFrom", e.target.value)} />
                </Field>
              ) : null}
              <div className="sm:col-span-2">
                <span className="mb-1.5 block text-sm font-medium text-[var(--foreground)]">Dias da semana</span>
                <div className="flex flex-wrap gap-2">
                  {WEEKDAYS.map((day) => {
                    const on = form.weekdays.includes(day.value);
                    return (
                      <button
                        key={day.value}
                        type="button"
                        onClick={() => set("weekdays", on ? form.weekdays.filter((value) => value !== day.value) : [...form.weekdays, day.value])}
                        className={`h-9 w-12 rounded-lg border text-sm font-medium transition ${on ? "border-primary bg-primary text-white" : "border-[var(--border)] text-[var(--foreground)] hover:bg-[var(--surface-hover)]"}`}
                      >
                        {day.label}
                      </button>
                    );
                  })}
                </div>
                <span className="mt-1 block text-xs text-[var(--muted)]">Nenhum escolhido = todos os dias.</span>
              </div>
              <Field label="Das (hora da marcação)">
                <input type="time" className={inputClass} value={form.startTime} onChange={(e) => set("startTime", e.target.value)} />
              </Field>
              <Field label="Até">
                <input type="time" className={inputClass} value={form.endTime} onChange={(e) => set("endTime", e.target.value)} />
              </Field>
            </div>
          </div>

          <div>
            <p className="mb-3 text-sm font-semibold text-[var(--foreground)]">Disponibilidade e regras</p>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <Field label="Vagas promocionais (total)" hint="Ex.: 20 cortes. Vazio = sem limite.">
                <input className={inputClass} inputMode="numeric" value={form.maxUses} onChange={(e) => set("maxUses", e.target.value)} />
              </Field>
              <Field label="Limite por cliente" hint="Vazio = sem limite.">
                <input className={inputClass} inputMode="numeric" value={form.maxUsesPerClient} onChange={(e) => set("maxUsesPerClient", e.target.value)} />
              </Field>
              <Toggle checked={form.stackable} onChange={(value) => set("stackable", value)} label="Acumulável" hint="Soma-se a outras promoções acumuláveis e a recompensas." />
              <Toggle
                checked={form.releaseOnCancel}
                onChange={(value) => set("releaseOnCancel", value)}
                label="Cancelamentos libertam a vaga"
                hint="Uma marcação cancelada ou a que o cliente faltou devolve a vaga à campanha."
              />
            </div>
          </div>
        </div>
      </Dialog>

      <Dialog open={results !== null} title={results ? `Resultados: ${results.promotion.name}` : "Resultados"} onClose={() => setResults(null)} wide>
        {results ? (
          <div className="space-y-5">
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              {[
                ["Reservadas", results.reserved],
                ["Utilizadas (pagas)", results.consumed],
                ["Libertadas", results.released],
                ["Descontos dados", formatKz(results.discountGiven)],
              ].map(([label, value]) => (
                <div key={String(label)} className="rounded-lg border border-[var(--border)] p-3">
                  <p className="text-xs text-[var(--muted)]">{label}</p>
                  <p className="mt-1 text-lg font-semibold tabular-nums text-[var(--foreground)]">{value}</p>
                </div>
              ))}
            </div>
            {results.usages.length === 0 ? (
              <p className="text-sm text-[var(--muted)]">Ainda ninguém marcou com esta promoção.</p>
            ) : (
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-[var(--border)] text-left text-xs uppercase tracking-wide text-[var(--muted)]">
                    <th className="py-2 font-medium">Cliente</th>
                    <th className="py-2 font-medium">Marcação</th>
                    <th className="py-2 font-medium">Estado</th>
                    <th className="py-2 text-right font-medium">Desconto</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[var(--border)]">
                  {results.usages.map((usage) => (
                    <tr key={usage.id}>
                      <td className="py-2 text-[var(--foreground)]">{usage.clientName}</td>
                      <td className="py-2 text-[var(--muted)]">{formatDate(usage.scheduledAt)}</td>
                      <td className="py-2">
                        <Badge tone={usage.status === "CONSUMED" ? "success" : usage.status === "RESERVED" ? "brand" : "neutral"}>
                          {usage.status === "CONSUMED" ? "Utilizada" : usage.status === "RESERVED" ? "Reservada" : "Libertada"}
                        </Badge>
                      </td>
                      <td className="py-2 text-right tabular-nums text-[var(--foreground)]">{formatKz(usage.discountAmount)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        ) : null}
      </Dialog>
    </Panel>
  );
}
