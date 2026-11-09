"use client";

import { Award, Gift, Megaphone, Sparkles, UserPlus, Users } from "lucide-react";
import type { LoyaltyOverviewDTO } from "@slotix/types";

import { StatCard } from "@/components/ui/StatCard";
import { formatKz } from "@/lib/loyalty-api";
import { useLoyalty } from "./useLoyalty";
import { Badge, EmptyState, ErrorBox, Loading, Panel } from "./ui";
import { PROMOTION_STATUS } from "./PromotionsTab";

export function OverviewTab() {
  const { data, error, reload: load } = useLoyalty<LoyaltyOverviewDTO>("overview");


  if (error) return <ErrorBox message={error} onRetry={load} />;
  if (!data) return <Loading />;

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
        <StatCard label="Clientes com benefícios" value={data.totalMembers} icon={Users} description={`${data.activeMembers} ativos`} index={0} />
        <StatCard label="Novos clientes (30 dias)" value={data.newMembers30d} icon={UserPlus} tone="success" index={1} />
        <StatCard label="Promoções ativas" value={data.activePromotions} icon={Megaphone} tone="warning" index={2} />
        <StatCard label="Pontos distribuídos" value={data.pointsIssued} icon={Sparkles} index={3} />
        <StatCard label="Pontos resgatados" value={data.pointsRedeemed} icon={Award} tone="neutral" index={4} />
        <StatCard label="Recompensas utilizadas" value={data.rewardsUsed} icon={Gift} tone="success" index={5} />
      </div>

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
        <Panel title="Clientes mais frequentes" description="Clientes do espaço com mais serviços concluídos">
          {data.topMembers.length === 0 ? (
            <EmptyState icon={<Users size={20} />} title="Ainda sem clientes" text="Quando os clientes aderirem ao programa, aparecem aqui os mais frequentes." />
          ) : (
            <ul className="divide-y divide-[var(--border)]">
              {data.topMembers.map((member, index) => (
                <li key={member.memberId} className="flex items-center gap-3 px-5 py-3">
                  <span className="flex h-7 w-7 items-center justify-center rounded-full bg-primary/10 text-xs font-bold text-[var(--brand-text)]">{index + 1}</span>
                  <span className="flex-1 truncate text-sm font-medium text-[var(--foreground)]">{member.name}</span>
                  <span className="text-sm text-[var(--muted)]">{member.visits} serviços</span>
                  <span className="w-24 text-right text-sm font-semibold tabular-nums text-[var(--foreground)]">{member.pointsBalance} pts</span>
                </li>
              ))}
            </ul>
          )}
        </Panel>

        <Panel title="Resultados das campanhas" description="Usos e descontos dados por promoção">
          {data.campaigns.length === 0 ? (
            <EmptyState icon={<Megaphone size={20} />} title="Sem campanhas" text="Crie uma promoção no separador Promoções." />
          ) : (
            <ul className="divide-y divide-[var(--border)]">
              {data.campaigns.map((campaign) => {
                const status = PROMOTION_STATUS[campaign.status];
                const share = campaign.maxUses ? Math.min(100, Math.round((campaign.usedCount / campaign.maxUses) * 100)) : null;
                return (
                  <li key={campaign.id} className="px-5 py-3">
                    <div className="flex items-center gap-3">
                      <span className="flex-1 truncate text-sm font-medium text-[var(--foreground)]">{campaign.name}</span>
                      <Badge tone={status.tone}>{status.label}</Badge>
                    </div>
                    <div className="mt-1.5 flex items-center gap-3 text-xs text-[var(--muted)]">
                      <span>
                        {campaign.usedCount}
                        {campaign.maxUses ? ` / ${campaign.maxUses}` : ""} usos
                      </span>
                      <span>·</span>
                      <span>{formatKz(campaign.discountGiven)} em descontos</span>
                    </div>
                    {share !== null ? (
                      <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-[var(--surface-secondary)]">
                        <div className="h-full rounded-full bg-primary" style={{ width: `${share}%` }} />
                      </div>
                    ) : null}
                  </li>
                );
              })}
            </ul>
          )}
        </Panel>
      </div>
    </div>
  );
}
