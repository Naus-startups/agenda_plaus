"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";
import type { LoyaltyProgramDTO } from "@slotix/types";

import { brandButton } from "@/components/ui/PageActions";
import { loyaltyFetch } from "@/lib/loyalty-api";
import { ErrorBox, Field, Loading, Panel, ServicePicker, Toggle, inputClass, type ServiceOption } from "./ui";

type Form = {
  active: boolean;
  name: string;
  description: string;
  joinRules: string;
  terms: string;
  pointsEnabled: boolean;
  pointsPerUnit: string;
  amountPerUnit: string;
  pointsExpireDays: string;
};

const DEFAULTS: Form = {
  active: false,
  name: "Clientes do espaço",
  description: "",
  joinRules: "Para todos os clientes do espaço com conta na app Agenda+.",
  terms: "",
  pointsEnabled: true,
  pointsPerUnit: "10",
  amountPerUnit: "1000",
  pointsExpireDays: "365",
};

// Um campo que não venha preenchido fica com o valor de origem (nunca "undefined" no ecrã).
function toForm(program: LoyaltyProgramDTO): Form {
  return {
    active: program.active ?? DEFAULTS.active,
    name: program.name ?? DEFAULTS.name,
    description: program.description ?? "",
    joinRules: program.joinRules ?? "",
    terms: program.terms ?? "",
    pointsEnabled: program.pointsEnabled ?? DEFAULTS.pointsEnabled,
    pointsPerUnit: program.pointsPerUnit != null ? String(program.pointsPerUnit) : DEFAULTS.pointsPerUnit,
    amountPerUnit: program.amountPerUnit != null ? String(program.amountPerUnit) : DEFAULTS.amountPerUnit,
    pointsExpireDays: program.pointsExpireDays ? String(program.pointsExpireDays) : "",
  };
}

export function SettingsTab({ services, onSaved }: { services: ServiceOption[]; onSaved: (program: LoyaltyProgramDTO) => void }) {
  const [form, setForm] = useState<Form | null>(null);
  const [exclusive, setExclusive] = useState<string[]>([]);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    Promise.all([loyaltyFetch<LoyaltyProgramDTO | null>("program"), loyaltyFetch<string[]>("members-only-services")])
      .then(([program, membersOnly]) => {
        setForm(program ? toForm(program) : DEFAULTS);
        setExclusive(membersOnly);
      })
      .catch((err: Error) => setError(err.message));
  }, []);

  if (error) return <ErrorBox message={error} />;
  if (!form) return <Loading />;

  const set = <K extends keyof Form>(key: K, value: Form[K]) => setForm((current) => (current ? { ...current, [key]: value } : current));

  const save = async () => {
    setSaving(true);
    try {
      const program = await loyaltyFetch<LoyaltyProgramDTO>("program", {
        method: "PUT",
        body: {
          active: form.active,
          name: form.name.trim(),
          description: form.description.trim() || null,
          joinRules: form.joinRules.trim() || null,
          terms: form.terms.trim() || null,
          pointsEnabled: form.pointsEnabled,
          pointsPerUnit: Number(form.pointsPerUnit) || 1,
          amountPerUnit: Number(form.amountPerUnit) || 1,
          pointsExpireDays: Number(form.pointsExpireDays) || null,
        },
      });
      await loyaltyFetch("members-only-services", { method: "PUT", body: { serviceIds: exclusive } });
      onSaved(program);
      toast.success(program.active ? "Programa guardado e ativo na app." : "Programa guardado (desligado na app).");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Não foi possível guardar.");
    } finally {
      setSaving(false);
    }
  };

  const example = Math.floor(3000 / (Number(form.amountPerUnit) || 1)) * (Number(form.pointsPerUnit) || 0);

  return (
    <div className="grid grid-cols-1 gap-6 xl:grid-cols-[1fr_380px]">
      <Panel title="Benefícios para clientes" description="Ser cliente do espaço dá estes benefícios. É o que a app mostra na página do espaço.">
        <div className="space-y-4 p-5">
          <Toggle checked={form.active} onChange={(value) => set("active", value)} label="Benefícios ativos" hint="Desligados, os clientes do espaço não têm descontos, pontos nem recompensas." />
          <Field label="Nome (aparece na app)">
            <input className={inputClass} value={form.name} onChange={(e) => set("name", e.target.value)} />
          </Field>
          <Field label="Descrição">
            <textarea className={inputClass} rows={3} value={form.description} onChange={(e) => set("description", e.target.value)} placeholder="Porque vale a pena ser membro deste espaço." />
          </Field>
          <Field label="Quem tem direito">
            <textarea className={inputClass} rows={2} value={form.joinRules} onChange={(e) => set("joinRules", e.target.value)} />
          </Field>
          <Field label="Condições de utilização">
            <textarea className={inputClass} rows={3} value={form.terms} onChange={(e) => set("terms", e.target.value)} placeholder="Ex.: as recompensas não são trocáveis por dinheiro." />
          </Field>
        </div>
      </Panel>

      <div className="space-y-6">
        <Panel title="Sistema de pontos" description="Os pontos só são dados quando o serviço é pago.">
          <div className="space-y-4 p-5">
            <Toggle checked={form.pointsEnabled} onChange={(value) => set("pointsEnabled", value)} label="Dar pontos aos clientes" />
            {form.pointsEnabled ? (
              <>
                <div className="grid grid-cols-2 gap-3">
                  <Field label="Pontos">
                    <input className={inputClass} inputMode="numeric" value={form.pointsPerUnit} onChange={(e) => set("pointsPerUnit", e.target.value)} />
                  </Field>
                  <Field label="Por cada (Kz)">
                    <input className={inputClass} inputMode="numeric" value={form.amountPerUnit} onChange={(e) => set("amountPerUnit", e.target.value)} />
                  </Field>
                </div>
                <p className="rounded-lg bg-[var(--surface-secondary)] px-3 py-2 text-xs text-[var(--muted)]">Um serviço de 3.000 Kz dá {example} pontos.</p>
                <Field label="Validade dos pontos (dias)" hint="Vazio = os pontos nunca expiram.">
                  <input className={inputClass} inputMode="numeric" value={form.pointsExpireDays} onChange={(e) => set("pointsExpireDays", e.target.value)} />
                </Field>
              </>
            ) : null}
          </div>
        </Panel>

        <Panel title="Serviços só para clientes" description="Só os clientes do espaço os podem marcar na app.">
          <div className="p-5">
            <ServicePicker services={services} value={exclusive} onChange={setExclusive} allLabel="Nenhum serviço exclusivo" />
          </div>
        </Panel>

        <button type="button" className={`${brandButton} w-full`} onClick={save} disabled={saving}>
          {saving ? "A guardar…" : "Guardar configuração"}
        </button>
      </div>
    </div>
  );
}
