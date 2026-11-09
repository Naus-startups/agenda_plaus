"use client";

import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { Search, Users } from "lucide-react";
import type { LoyaltyMemberDTO, LoyaltyMemberDetailDTO, LoyaltyMemberStatus, LoyaltyTransactionType } from "@slotix/types";

import { ClientAvatar } from "@/components/ui/ClientAvatar";
import { brandButton } from "@/components/ui/PageActions";
import { discountText, formatDate, loyaltyFetch } from "@/lib/loyalty-api";
import { Badge, Dialog, EmptyState, ErrorBox, Loading, Panel, dangerButton, inputClass, secondaryButton } from "./ui";

export const MEMBER_STATUS: Record<LoyaltyMemberStatus, { label: string; tone: "success" | "warning" | "danger" | "neutral" }> = {
  ACTIVE: { label: "Ativo", tone: "success" },
  SUSPENDED: { label: "Suspenso", tone: "warning" },
  REMOVED: { label: "Removido", tone: "danger" },
  LEFT: { label: "Saiu", tone: "neutral" },
};

const TRANSACTION: Record<LoyaltyTransactionType, string> = {
  EARN: "Pontos recebidos",
  REDEEM: "Pontos utilizados",
  REFUND: "Pontos devolvidos",
  REVERSAL: "Pontos retirados (reembolso)",
  EXPIRE: "Pontos expirados",
  ADJUST: "Ajuste administrativo",
};

const HISTORY: Record<string, string> = {
  JOINED: "Aderiu ao programa",
  LEFT: "Saiu do programa",
  SUSPENDED: "Suspenso",
  REMOVED: "Removido",
  REACTIVATED: "Reativado",
};

const REWARD_STATUS: Record<string, string> = {
  AVAILABLE: "Disponível",
  RESERVED: "Reservada",
  USED: "Utilizada",
  EXPIRED: "Expirada",
  CANCELLED: "Cancelada",
};

export function MembersTab({ isOwner }: { isOwner: boolean }) {
  const [members, setMembers] = useState<LoyaltyMemberDTO[] | null>(null);
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<string | null>(null);

  const load = useCallback(async (query: string) => {
    try {
      const loaded = await loyaltyFetch<LoyaltyMemberDTO[]>(`members${query ? `?q=${encodeURIComponent(query)}` : ""}`);
      setMembers(loaded);
      setError("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erro ao carregar os clientes.");
    }
  }, []);

  useEffect(() => {
    const timer = setTimeout(() => void load(search.trim()), 250);
    return () => clearTimeout(timer);
  }, [search, load]);

  return (
    <Panel
      title="Clientes do espaço"
      description="Os clientes com conta na app, com os seus pontos e recompensas"
      actions={
        <div className="relative w-full sm:w-72">
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--subtle)]" />
          <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Pesquisar por nome, email ou telefone" className={`${inputClass} pl-9`} />
        </div>
      }
    >
      {error ? (
        <ErrorBox message={error} onRetry={() => load(search.trim())} />
      ) : !members ? (
        <Loading />
      ) : members.length === 0 ? (
        <EmptyState icon={<Users size={20} />} title={search ? "Nenhum cliente encontrado" : "Ainda sem clientes"} text="Os clientes aparecem aqui quando, ao marcar na app, confirmam que são clientes do espaço." />
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-[var(--border)] text-left text-xs uppercase tracking-wide text-[var(--muted)]">
                <th className="px-5 py-3 font-medium">Cliente</th>
                <th className="px-3 py-3 font-medium">Estado</th>
                <th className="px-3 py-3 text-right font-medium">Pontos</th>
                <th className="px-3 py-3 text-right font-medium">Serviços</th>
                <th className="px-3 py-3 font-medium">Adesão</th>
                <th className="px-5 py-3 font-medium">Última visita</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--border)]">
              {members.map((member) => (
                <tr key={member.id} onClick={() => setSelected(member.id)} className="cursor-pointer transition hover:bg-[var(--surface-hover)]">
                  <td className="px-5 py-3">
                    <div className="flex items-center gap-3">
                      <ClientAvatar name={member.name} src={member.avatarUrl} className="h-8 w-8 text-xs" />
                      <div className="min-w-0">
                        <p className="truncate font-medium text-[var(--foreground)]">{member.name}</p>
                        <p className="truncate text-xs text-[var(--muted)]">{member.email}</p>
                      </div>
                    </div>
                  </td>
                  <td className="px-3 py-3">
                    <Badge tone={MEMBER_STATUS[member.status].tone}>{MEMBER_STATUS[member.status].label}</Badge>
                  </td>
                  <td className="px-3 py-3 text-right font-semibold tabular-nums text-[var(--foreground)]">{member.pointsBalance}</td>
                  <td className="px-3 py-3 text-right tabular-nums text-[var(--muted)]">{member.visits}</td>
                  <td className="px-3 py-3 text-[var(--muted)]">{formatDate(member.joinedAt)}</td>
                  <td className="px-5 py-3 text-[var(--muted)]">{formatDate(member.lastVisit)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <MemberDialog memberId={selected} isOwner={isOwner} onClose={() => setSelected(null)} onChanged={() => load(search.trim())} />
    </Panel>
  );
}

function MemberDialog({ memberId, isOwner, onClose, onChanged }: { memberId: string | null; isOwner: boolean; onClose: () => void; onChanged: () => void }) {
  const [member, setMember] = useState<LoyaltyMemberDetailDTO | null>(null);
  const [points, setPoints] = useState("");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!memberId) return;
    let cancelled = false;
    loyaltyFetch<LoyaltyMemberDetailDTO>(`members/${memberId}`)
      .then((loaded) => !cancelled && setMember(loaded))
      .catch((err: Error) => toast.error(err.message));
    return () => {
      cancelled = true;
      setMember(null);
      setPoints("");
      setReason("");
    };
  }, [memberId]);

  const run = async (task: () => Promise<LoyaltyMemberDetailDTO>, done: string) => {
    setBusy(true);
    try {
      setMember(await task());
      toast.success(done);
      onChanged();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Não foi possível concluir.");
    } finally {
      setBusy(false);
    }
  };

  const setStatus = (status: "ACTIVE" | "SUSPENDED" | "REMOVED", done: string) =>
    run(() => loyaltyFetch(`members/${memberId}/status`, { method: "PATCH", body: { status } }), done);

  const adjust = () => {
    const value = Number(points);
    if (!Number.isInteger(value) || value === 0) return toast.error("Indique um número inteiro de pontos (negativo para retirar).");
    if (reason.trim().length < 3) return toast.error("Indique o motivo do ajuste.");
    void run(() => loyaltyFetch(`members/${memberId}/adjustments`, { method: "POST", body: { points: value, reason: reason.trim() } }), "Pontos ajustados.").then(() => {
      setPoints("");
      setReason("");
    });
  };

  return (
    <Dialog open={Boolean(memberId)} title={member?.name ?? "Cliente"} description={member ? `${member.email}${member.phone ? ` · ${member.phone}` : ""}` : undefined} onClose={onClose} wide>
      {!member ? (
        <Loading />
      ) : (
        <div className="space-y-6">
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            {[
              ["Estado", <Badge key="s" tone={MEMBER_STATUS[member.status].tone}>{MEMBER_STATUS[member.status].label}</Badge>],
              ["Pontos", <span key="p" className="text-lg font-semibold tabular-nums">{member.pointsBalance}</span>],
              ["Serviços", <span key="v" className="text-lg font-semibold tabular-nums">{member.visits}</span>],
              ["Adesão", <span key="j" className="text-sm font-medium">{formatDate(member.joinedAt)}</span>],
            ].map(([label, value]) => (
              <div key={String(label)} className="rounded-lg border border-[var(--border)] p-3">
                <p className="text-xs text-[var(--muted)]">{label}</p>
                <div className="mt-1 text-[var(--foreground)]">{value}</div>
              </div>
            ))}
          </div>

          {isOwner && member.status !== "LEFT" ? (
            <div className="flex flex-wrap gap-2">
              {member.status !== "ACTIVE" ? (
                <button type="button" disabled={busy} className={secondaryButton} onClick={() => setStatus("ACTIVE", "Benefícios reativados.")}>
                  Reativar
                </button>
              ) : (
                <button type="button" disabled={busy} className={secondaryButton} onClick={() => setStatus("SUSPENDED", "Benefícios suspensos.")}>
                  Suspender
                </button>
              )}
              {member.status !== "REMOVED" ? (
                <button type="button" disabled={busy} className={dangerButton} onClick={() => setStatus("REMOVED", "Benefícios retirados.")}>
                  Retirar benefícios
                </button>
              ) : null}
            </div>
          ) : null}

          {isOwner && member.status === "ACTIVE" ? (
            <div className="rounded-lg border border-[var(--border)] p-4">
              <p className="text-sm font-semibold text-[var(--foreground)]">Ajustar pontos</p>
              <p className="mt-0.5 text-xs text-[var(--muted)]">Fica registado no histórico do cliente, com o motivo.</p>
              <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-[120px_1fr_auto]">
                <input value={points} onChange={(event) => setPoints(event.target.value)} placeholder="+50 ou −20" inputMode="numeric" className={inputClass} />
                <input value={reason} onChange={(event) => setReason(event.target.value)} placeholder="Motivo" className={inputClass} />
                <button type="button" disabled={busy} onClick={adjust} className={brandButton}>
                  Aplicar
                </button>
              </div>
            </div>
          ) : null}

          <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
            <div>
              <p className="mb-2 text-sm font-semibold text-[var(--foreground)]">Movimentos de pontos</p>
              {member.transactions.length === 0 ? (
                <p className="text-sm text-[var(--muted)]">Sem movimentos.</p>
              ) : (
                <ul className="divide-y divide-[var(--border)] rounded-lg border border-[var(--border)]">
                  {member.transactions.map((transaction) => (
                    <li key={transaction.id} className="flex items-center gap-3 px-3 py-2 text-sm">
                      <div className="min-w-0 flex-1">
                        <p className="text-[var(--foreground)]">{TRANSACTION[transaction.type]}</p>
                        <p className="truncate text-xs text-[var(--muted)]">
                          {formatDate(transaction.createdAt)}
                          {transaction.reason ? ` · ${transaction.reason}` : ""}
                        </p>
                      </div>
                      <span className={`font-semibold tabular-nums ${transaction.points > 0 ? "text-emerald-600 dark:text-emerald-400" : "text-red-600 dark:text-red-400"}`}>
                        {transaction.points > 0 ? "+" : ""}
                        {transaction.points}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
            <div className="space-y-6">
              <div>
                <p className="mb-2 text-sm font-semibold text-[var(--foreground)]">Recompensas</p>
                {member.rewards.length === 0 ? (
                  <p className="text-sm text-[var(--muted)]">Ainda sem recompensas.</p>
                ) : (
                  <ul className="divide-y divide-[var(--border)] rounded-lg border border-[var(--border)]">
                    {member.rewards.map((reward) => (
                      <li key={reward.id} className="flex items-center gap-3 px-3 py-2 text-sm">
                        <span className="flex-1 text-[var(--foreground)]">
                          {reward.name} <span className="text-xs text-[var(--muted)]">({discountText(reward.discountType, reward.discountValue)})</span>
                        </span>
                        <Badge tone={reward.status === "AVAILABLE" ? "success" : "neutral"}>{REWARD_STATUS[reward.status]}</Badge>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
              <div>
                <p className="mb-2 text-sm font-semibold text-[var(--foreground)]">Histórico da adesão</p>
                <ul className="space-y-1.5 text-sm">
                  {member.history.map((event) => (
                    <li key={event.id} className="flex gap-2 text-[var(--muted)]">
                      <span className="w-24 shrink-0">{formatDate(event.createdAt)}</span>
                      <span className="text-[var(--foreground)]">
                        {HISTORY[event.action] ?? event.action}
                        {event.reason ? ` — ${event.reason}` : ""}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          </div>
        </div>
      )}
    </Dialog>
  );
}


