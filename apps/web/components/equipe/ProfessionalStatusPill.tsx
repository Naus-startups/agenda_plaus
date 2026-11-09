"use client";

import { useCallback, useEffect, useState } from "react";
import type { ProfessionalStatusDTO } from "@slotix/types";

const REFRESH_MS = 60_000;

// O estado da equipa agora, relido de minuto a minuto (e quando se pede, depois de uma mudança).
export function useTeamStatus() {
  const [statuses, setStatuses] = useState<Record<string, ProfessionalStatusDTO>>({});
  const [version, setVersion] = useState(0);

  useEffect(() => {
    let cancelled = false;
    const load = () =>
      fetch("/api/professionals/status", { credentials: "include", cache: "no-store" })
        .then((response) => response.json())
        .then((json) => {
          const list: ProfessionalStatusDTO[] = Array.isArray(json?.data) ? json.data : [];
          if (!cancelled) setStatuses(Object.fromEntries(list.map((item) => [item.professionalId, item])));
        })
        .catch(() => undefined);
    void load();
    const timer = setInterval(load, REFRESH_MS);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [version]);

  const reload = useCallback(() => setVersion((value) => value + 1), []);
  return { statuses, reload };
}

const time = (iso: string) => new Intl.DateTimeFormat("pt-PT", { hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date(iso));

export function ProfessionalStatusPill({ status }: { status?: ProfessionalStatusDTO }) {
  if (!status) return null;

  let className = "bg-emerald-50 text-emerald-700";
  let label = status.nextBusyAt ? `Livre até às ${time(status.nextBusyAt)}` : "Livre agora";
  if (status.status === "BUSY") {
    className = "bg-amber-50 text-amber-700";
    label = status.freeAt && status.minutesUntilFree !== null ? `A atender · livre em ${status.minutesUntilFree} min (${time(status.freeAt)})` : "A atender · ocupado até fechar";
  } else if (status.status === "AWAY") {
    className = "bg-red-50 text-red-700";
    label = status.until ? `Ausente até às ${time(status.until)}` : "Ausente hoje";
  } else if (status.status === "OFF_HOURS") {
    className = "bg-gray-100 text-gray-500";
    label = status.opensAt ? `Fora do horário · abre às ${time(status.opensAt)}` : "Fora do horário";
  }

  return <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${className}`}>{label}</span>;
}
