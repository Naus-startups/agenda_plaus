"use client";

import { useEffect, useState } from "react";
import { BarChart3, Gift, Megaphone, Settings2, Star, Users } from "lucide-react";
import type { LoyaltyProgramDTO } from "@slotix/types";

import { loyaltyFetch } from "@/lib/loyalty-api";
import { OverviewTab } from "./OverviewTab";
import { MembersTab } from "./MembersTab";
import { BenefitsTab, RewardsTab } from "./BenefitsTab";
import { PromotionsTab } from "./PromotionsTab";
import { SettingsTab } from "./SettingsTab";
import { Badge, Loading, type ServiceOption } from "./ui";

type Tab = "overview" | "members" | "benefits" | "rewards" | "promotions" | "settings";

const TABS: { id: Tab; label: string; icon: typeof Users; ownerOnly?: boolean }[] = [
  { id: "overview", label: "Visão geral", icon: BarChart3, ownerOnly: true },
  { id: "members", label: "Clientes", icon: Users },
  { id: "benefits", label: "Benefícios", icon: Star },
  { id: "rewards", label: "Recompensas", icon: Gift },
  { id: "promotions", label: "Promoções", icon: Megaphone },
  { id: "settings", label: "Configuração", icon: Settings2, ownerOnly: true },
];

/*
 * FIDELIZAÇÃO E BENEFÍCIOS — o programa de membros do espaço. O dono configura tudo; a
 * equipa consulta membros, benefícios, recompensas e promoções (é quem atende os clientes).
 * O que cada um pode fazer é sempre confirmado pela API.
 */
export function LoyaltyDashboard() {
  const [role, setRole] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab | null>(null);
  const [services, setServices] = useState<ServiceOption[]>([]);
  const [program, setProgram] = useState<LoyaltyProgramDTO | null | undefined>(undefined);

  useEffect(() => {
    fetch("/api/auth/me", { credentials: "include", cache: "no-store" })
      .then((response) => response.json())
      .then((data) => {
        const loadedRole = data?.user?.role ?? "EMPLOYEE";
        setRole(loadedRole);
        setTab(loadedRole === "OWNER" ? "overview" : "members");
        if (loadedRole === "OWNER") {
          loyaltyFetch<LoyaltyProgramDTO | null>("program")
            .then(setProgram)
            .catch(() => setProgram(null));
        }
      })
      .catch(() => {
        setRole("EMPLOYEE");
        setTab("members");
      });

    fetch("/api/services", { credentials: "include", cache: "no-store" })
      .then((response) => response.json())
      .then((data: unknown) => {
        if (!Array.isArray(data)) return;
        setServices(data.map((service) => ({ id: String(service.id), name: String(service.name), price: Number(service.price) || 0 })));
      })
      .catch(() => setServices([]));
  }, []);

  if (!role || !tab) return <Loading />;
  const isOwner = role === "OWNER";
  const visible = TABS.filter((item) => isOwner || !item.ownerOnly);

  return (
    <div className="mx-auto max-w-[1600px] space-y-6">
      {isOwner && program !== undefined && !program?.active ? (
        <div className="flex flex-col gap-3 rounded-xl border border-primary/25 bg-primary/5 p-4 sm:flex-row sm:items-center">
          <div className="flex-1">
            <p className="font-semibold text-[var(--foreground)]">{program ? "Os benefícios para clientes estão desligados" : "Ative os benefícios para os clientes do seu espaço"}</p>
            <p className="mt-0.5 text-sm text-[var(--muted)]">Enquanto estiverem desligados, os clientes não têm descontos, pontos nem recompensas.</p>
          </div>
          <button type="button" onClick={() => setTab("settings")} className="inline-flex h-10 items-center justify-center rounded-lg bg-primary px-4 text-sm font-semibold text-white hover:bg-primary-hover">
            Configurar benefícios
          </button>
        </div>
      ) : null}

      <div className="flex items-center gap-3">
        <nav className="flex gap-1 overflow-x-auto rounded-xl border border-[var(--border)] bg-[var(--surface)] p-1" role="tablist">
          {visible.map((item) => {
            const Icon = item.icon;
            const active = item.id === tab;
            return (
              <button
                key={item.id}
                type="button"
                role="tab"
                aria-selected={active}
                onClick={() => setTab(item.id)}
                className={`inline-flex h-9 shrink-0 items-center gap-2 rounded-lg px-3 text-sm font-medium transition ${
                  active ? "bg-primary text-white shadow-sm" : "text-[var(--muted)] hover:bg-[var(--surface-hover)] hover:text-[var(--foreground)]"
                }`}
              >
                <Icon size={16} />
                {item.label}
              </button>
            );
          })}
        </nav>
        {isOwner && program?.active ? <Badge tone="success">Benefícios ativos</Badge> : null}
      </div>

      {tab === "overview" ? <OverviewTab /> : null}
      {tab === "members" ? <MembersTab isOwner={isOwner} /> : null}
      {tab === "benefits" ? <BenefitsTab isOwner={isOwner} /> : null}
      {tab === "rewards" ? <RewardsTab isOwner={isOwner} services={services} /> : null}
      {tab === "promotions" ? <PromotionsTab isOwner={isOwner} services={services} /> : null}
      {tab === "settings" ? <SettingsTab services={services} onSaved={setProgram} /> : null}
    </div>
  );
}
