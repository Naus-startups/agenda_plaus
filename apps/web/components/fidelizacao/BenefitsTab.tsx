"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Gift, Pencil, Plus, Star, Trash2 } from "lucide-react";
import type { LoyaltyBenefitDTO, LoyaltyRewardDTO, LoyaltyRewardKind, DiscountType } from "@slotix/types";

import { brandButton } from "@/components/ui/PageActions";
import { confirmAction } from "@/lib/confirm-action";
import { discountText, formatDate, loyaltyFetch } from "@/lib/loyalty-api";
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

/* ======================================================================== */
/* Benefícios: o que os membros recebem, com condições e validade            */
/* ======================================================================== */

type BenefitForm = { title: string; description: string; conditions: string; validFrom: string; validUntil: string; active: boolean };
const EMPTY_BENEFIT: BenefitForm = { title: "", description: "", conditions: "", validFrom: "", validUntil: "", active: true };

export function BenefitsTab({ isOwner }: { isOwner: boolean }) {
  const { data: benefits, error, reload: load } = useLoyalty<LoyaltyBenefitDTO[]>("benefits");
  const [editing, setEditing] = useState<LoyaltyBenefitDTO | "new" | null>(null);
  const [form, setForm] = useState<BenefitForm>(EMPTY_BENEFIT);
  const [saving, setSaving] = useState(false);


  const open = (benefit: LoyaltyBenefitDTO | "new") => {
    setEditing(benefit);
    setForm(
      benefit === "new"
        ? EMPTY_BENEFIT
        : {
            title: benefit.title,
            description: benefit.description ?? "",
            conditions: benefit.conditions ?? "",
            validFrom: toLocalInput(benefit.validFrom),
            validUntil: toLocalInput(benefit.validUntil),
            active: benefit.active,
          },
    );
  };

  const save = async () => {
    if (form.title.trim().length < 2) return toast.error("Dê um nome ao benefício.");
    setSaving(true);
    try {
      const body = {
        title: form.title.trim(),
        description: form.description.trim() || null,
        conditions: form.conditions.trim() || null,
        validFrom: fromLocalInput(form.validFrom),
        validUntil: fromLocalInput(form.validUntil),
        active: form.active,
      };
      if (editing === "new") await loyaltyFetch("benefits", { method: "POST", body });
      else if (editing) await loyaltyFetch(`benefits/${editing.id}`, { method: "PUT", body });
      toast.success("Benefício guardado.");
      setEditing(null);
      load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Não foi possível guardar.");
    } finally {
      setSaving(false);
    }
  };

  const remove = async (benefit: LoyaltyBenefitDTO) => {
    if (!(await confirmAction(`Apagar o benefício "${benefit.title}"? Deixa de aparecer aos membros.`, "Apagar"))) return;
    try {
      await loyaltyFetch(`benefits/${benefit.id}`, { method: "DELETE" });
      toast.success("Benefício apagado.");
      load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Não foi possível apagar.");
    }
  };

  return (
    <Panel
      title="Benefícios"
      description="O que os membros ganham por pertencer ao programa (atendimento prioritário, acesso antecipado, ofertas…)"
      actions={
        isOwner ? (
          <button type="button" className={brandButton} onClick={() => open("new")}>
            <Plus size={16} /> Novo benefício
          </button>
        ) : null
      }
    >
      {error ? (
        <ErrorBox message={error} onRetry={load} />
      ) : !benefits ? (
        <Loading />
      ) : benefits.length === 0 ? (
        <EmptyState icon={<Star size={20} />} title="Sem benefícios" text="Os benefícios aparecem na página do espaço, na app, para convencer os clientes a aderir." />
      ) : (
        <ul className="divide-y divide-[var(--border)]">
          {benefits.map((benefit) => (
            <li key={benefit.id} className="flex flex-col gap-2 px-5 py-4 sm:flex-row sm:items-center">
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <p className="font-medium text-[var(--foreground)]">{benefit.title}</p>
                  <Badge tone={benefit.active ? "success" : "neutral"}>{benefit.active ? "Ativo" : "Inativo"}</Badge>
                </div>
                {benefit.description ? <p className="mt-0.5 text-sm text-[var(--muted)]">{benefit.description}</p> : null}
                <p className="mt-1 text-xs text-[var(--muted)]">
                  {benefit.validFrom || benefit.validUntil ? `Válido de ${formatDate(benefit.validFrom)} a ${formatDate(benefit.validUntil)}` : "Sem prazo"}
                  {benefit.conditions ? ` · ${benefit.conditions}` : ""}
                </p>
              </div>
              {isOwner ? (
                <div className="flex gap-2">
                  <button type="button" className={secondaryButton} onClick={() => open(benefit)} aria-label="Editar">
                    <Pencil size={15} />
                  </button>
                  <button type="button" className={secondaryButton} onClick={() => remove(benefit)} aria-label="Apagar">
                    <Trash2 size={15} />
                  </button>
                </div>
              ) : null}
            </li>
          ))}
        </ul>
      )}

      <Dialog
        open={editing !== null}
        title={editing === "new" ? "Novo benefício" : "Editar benefício"}
        onClose={() => !saving && setEditing(null)}
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
        <div className="space-y-4">
          <Field label="Nome">
            <input className={inputClass} value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} placeholder="Ex.: Atendimento prioritário" />
          </Field>
          <Field label="Descrição">
            <textarea className={inputClass} rows={3} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
          </Field>
          <Field label="Condições" hint="Ex.: válido de segunda a quinta, mediante marcação.">
            <input className={inputClass} value={form.conditions} onChange={(e) => setForm({ ...form, conditions: e.target.value })} />
          </Field>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Field label="Válido a partir de">
              <input type="datetime-local" className={inputClass} value={form.validFrom} onChange={(e) => setForm({ ...form, validFrom: e.target.value })} />
            </Field>
            <Field label="Válido até">
              <input type="datetime-local" className={inputClass} value={form.validUntil} onChange={(e) => setForm({ ...form, validUntil: e.target.value })} />
            </Field>
          </div>
          <Toggle checked={form.active} onChange={(active) => setForm({ ...form, active })} label="Ativo" hint="Inativo, deixa de aparecer na app." />
        </div>
      </Dialog>
    </Panel>
  );
}

/* ======================================================================== */
/* Recompensas: por pontos, por número de serviços ou de aniversário         */
/* ======================================================================== */

const KIND: Record<LoyaltyRewardKind, { label: string; describe: (reward: LoyaltyRewardDTO) => string }> = {
  POINTS: { label: "Por pontos", describe: (reward) => `Custa ${reward.pointsCost} pontos` },
  VISITS: { label: "Por frequência", describe: (reward) => `Ao fim de ${reward.visitsRequired} serviços pagos` },
  BIRTHDAY: { label: "Aniversário", describe: () => "No mês de aniversário do membro" },
};

type RewardForm = {
  name: string;
  description: string;
  kind: LoyaltyRewardKind;
  pointsCost: string;
  visitsRequired: string;
  discountType: DiscountType;
  discountValue: string;
  validDays: string;
  active: boolean;
  serviceIds: string[];
};
const EMPTY_REWARD: RewardForm = { name: "", description: "", kind: "VISITS", pointsCost: "", visitsRequired: "5", discountType: "FREE", discountValue: "", validDays: "60", active: true, serviceIds: [] };

export function RewardsTab({ isOwner, services }: { isOwner: boolean; services: ServiceOption[] }) {
  const { data: rewards, error, reload: load } = useLoyalty<LoyaltyRewardDTO[]>("rewards");
  const [editing, setEditing] = useState<LoyaltyRewardDTO | "new" | null>(null);
  const [form, setForm] = useState<RewardForm>(EMPTY_REWARD);
  const [saving, setSaving] = useState(false);


  const open = (reward: LoyaltyRewardDTO | "new") => {
    setEditing(reward);
    setForm(
      reward === "new"
        ? EMPTY_REWARD
        : {
            name: reward.name,
            description: reward.description ?? "",
            kind: reward.kind,
            pointsCost: reward.pointsCost ? String(reward.pointsCost) : "",
            visitsRequired: reward.visitsRequired ? String(reward.visitsRequired) : "",
            discountType: reward.discountType,
            discountValue: reward.discountType === "FREE" ? "" : String(reward.discountValue),
            validDays: reward.validDays ? String(reward.validDays) : "",
            active: reward.active,
            serviceIds: reward.serviceIds,
          },
    );
  };

  const save = async () => {
    setSaving(true);
    try {
      const body = {
        name: form.name.trim(),
        description: form.description.trim() || null,
        kind: form.kind,
        pointsCost: form.kind === "POINTS" ? Number(form.pointsCost) || null : null,
        visitsRequired: form.kind === "VISITS" ? Number(form.visitsRequired) || null : null,
        discountType: form.discountType,
        discountValue: form.discountType === "FREE" ? 0 : Number(form.discountValue) || 0,
        validDays: form.kind === "POINTS" ? null : Number(form.validDays) || null,
        active: form.active,
        serviceIds: form.serviceIds,
      };
      if (editing === "new") await loyaltyFetch("rewards", { method: "POST", body });
      else if (editing) await loyaltyFetch(`rewards/${editing.id}`, { method: "PUT", body });
      toast.success("Recompensa guardada.");
      setEditing(null);
      load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Não foi possível guardar.");
    } finally {
      setSaving(false);
    }
  };

  const remove = async (reward: LoyaltyRewardDTO) => {
    if (!(await confirmAction(`Apagar a recompensa "${reward.name}"? Se algum membro já a tiver, fica apenas desativada.`, "Apagar"))) return;
    try {
      const result = await loyaltyFetch<{ deleted: boolean }>(`rewards/${reward.id}`, { method: "DELETE" });
      toast.success(result.deleted ? "Recompensa apagada." : "Recompensa desativada (já foi atribuída a membros).");
      load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Não foi possível apagar.");
    }
  };

  const serviceNames = (ids: string[]) => (ids.length === 0 ? "Todos os serviços" : services.filter((service) => ids.includes(service.id)).map((service) => service.name).join(", "));

  return (
    <Panel
      title="Recompensas"
      description="O que os membros desbloqueiam: com pontos, por frequência ou no aniversário. Usam-nas ao marcar, na app."
      actions={
        isOwner ? (
          <button type="button" className={brandButton} onClick={() => open("new")}>
            <Plus size={16} /> Nova recompensa
          </button>
        ) : null
      }
    >
      {error ? (
        <ErrorBox message={error} onRetry={load} />
      ) : !rewards ? (
        <Loading />
      ) : rewards.length === 0 ? (
        <EmptyState icon={<Gift size={20} />} title="Sem recompensas" text="Ex.: um corte grátis depois de 5 serviços, ou 1.000 Kz de desconto por 100 pontos." />
      ) : (
        <ul className="divide-y divide-[var(--border)]">
          {rewards.map((reward) => (
            <li key={reward.id} className="flex flex-col gap-2 px-5 py-4 sm:flex-row sm:items-center">
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <p className="font-medium text-[var(--foreground)]">{reward.name}</p>
                  <Badge tone="brand">{KIND[reward.kind].label}</Badge>
                  <Badge tone={reward.active ? "success" : "neutral"}>{reward.active ? "Ativa" : "Inativa"}</Badge>
                </div>
                <p className="mt-1 text-sm text-[var(--muted)]">
                  {KIND[reward.kind].describe(reward)} · {discountText(reward.discountType, reward.discountValue)} · {serviceNames(reward.serviceIds)}
                  {reward.validDays ? ` · válida ${reward.validDays} dias` : ""}
                </p>
              </div>
              {isOwner ? (
                <div className="flex gap-2">
                  <button type="button" className={secondaryButton} onClick={() => open(reward)} aria-label="Editar">
                    <Pencil size={15} />
                  </button>
                  <button type="button" className={secondaryButton} onClick={() => remove(reward)} aria-label="Apagar">
                    <Trash2 size={15} />
                  </button>
                </div>
              ) : null}
            </li>
          ))}
        </ul>
      )}

      <Dialog
        open={editing !== null}
        title={editing === "new" ? "Nova recompensa" : "Editar recompensa"}
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
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field label="Nome" className="sm:col-span-2">
            <input className={inputClass} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Ex.: Corte grátis" />
          </Field>
          <Field label="Descrição" className="sm:col-span-2">
            <input className={inputClass} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
          </Field>
          <Field label="Como se ganha">
            <select className={inputClass} value={form.kind} onChange={(e) => setForm({ ...form, kind: e.target.value as LoyaltyRewardKind })}>
              <option value="VISITS">Ao fim de N serviços pagos</option>
              <option value="POINTS">Trocada por pontos</option>
              <option value="BIRTHDAY">No mês de aniversário</option>
            </select>
          </Field>
          {form.kind === "POINTS" ? (
            <Field label="Pontos necessários">
              <input className={inputClass} inputMode="numeric" value={form.pointsCost} onChange={(e) => setForm({ ...form, pointsCost: e.target.value })} />
            </Field>
          ) : form.kind === "VISITS" ? (
            <Field label="Serviços pagos necessários">
              <input className={inputClass} inputMode="numeric" value={form.visitsRequired} onChange={(e) => setForm({ ...form, visitsRequired: e.target.value })} />
            </Field>
          ) : (
            <div />
          )}
          <Field label="Desconto">
            <select className={inputClass} value={form.discountType} onChange={(e) => setForm({ ...form, discountType: e.target.value as DiscountType })}>
              <option value="FREE">Serviço grátis</option>
              <option value="PERCENT">Percentagem</option>
              <option value="AMOUNT">Valor em Kz</option>
            </select>
          </Field>
          {form.discountType !== "FREE" ? (
            <Field label={form.discountType === "PERCENT" ? "Percentagem (%)" : "Valor (Kz)"}>
              <input className={inputClass} inputMode="decimal" value={form.discountValue} onChange={(e) => setForm({ ...form, discountValue: e.target.value })} />
            </Field>
          ) : (
            <div />
          )}
          {form.kind !== "POINTS" ? (
            <Field label="Validade depois de desbloqueada (dias)" hint="Vazio = não expira.">
              <input className={inputClass} inputMode="numeric" value={form.validDays} onChange={(e) => setForm({ ...form, validDays: e.target.value })} />
            </Field>
          ) : null}
          <Field label={form.kind === "VISITS" ? "Serviços que contam e onde se usa" : "Serviços onde se usa"} className="sm:col-span-2">
            <ServicePicker services={services} value={form.serviceIds} onChange={(serviceIds) => setForm({ ...form, serviceIds })} />
          </Field>
          <div className="sm:col-span-2">
            <Toggle checked={form.active} onChange={(active) => setForm({ ...form, active })} label="Ativa" />
          </div>
        </div>
      </Dialog>
    </Panel>
  );
}
