import React, { useCallback, useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import Ionicons from "@expo/vector-icons/Ionicons";
import { useFocusEffect } from "expo-router";
import type { ProfessionalStatusDTO } from "@slotix/types";

import { useIOSColors } from "@/components/ios";
import { Typography } from "@/constants/theme";
import { dateLocale, useT } from "@/i18n";
import { getProfessionalsStatus } from "../services/businesses";

const REFRESH_MS = 60_000;

/*
 * O estado dos profissionais de um espaço, lido ao abrir o ecrã e de minuto a minuto
 * enquanto está aberto (os minutos até ficar livre vão descendo).
 */
export function useProfessionalsStatus(businessId: string | undefined) {
  const [statuses, setStatuses] = useState<Record<string, ProfessionalStatusDTO>>({});

  useFocusEffect(
    useCallback(() => {
      if (!businessId) return;
      let cancelled = false;
      const load = () =>
        getProfessionalsStatus(businessId)
          .then((list) => !cancelled && setStatuses(Object.fromEntries(list.map((item) => [item.professionalId, item]))))
          .catch(() => undefined);
      void load();
      const timer = setInterval(load, REFRESH_MS);
      return () => {
        cancelled = true;
        clearInterval(timer);
      };
    }, [businessId]),
  );

  return statuses;
}

function minutesText(minutes: number, t: ReturnType<typeof useT>): string {
  if (minutes < 60) return t("{0} min", [Math.max(minutes, 1)]);
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest === 0 ? t("{0} h", [hours]) : t("{0} h {1} min", [hours, rest]);
}

// "Disponível agora" · "A atender · livre em 25 min (15:30)" · "Ausente hoje" · "Fora do horário"
export function ProfessionalStatusBadge({ status }: { status?: ProfessionalStatusDTO }) {
  const t = useT();
  const colors = useIOSColors();
  if (!status) return null;

  const time = (iso: string) => new Intl.DateTimeFormat(dateLocale(), { hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date(iso));

  let tone: string = colors.success;
  let background: string = colors.successBackground;
  let icon: React.ComponentProps<typeof Ionicons>["name"] = "ellipse";
  let label: string;

  switch (status.status) {
    case "AVAILABLE":
      label = status.nextBusyAt ? t("Disponível agora · livre até às {0}", [time(status.nextBusyAt)]) : t("Disponível agora");
      break;
    case "BUSY":
      tone = colors.warning;
      background = colors.warningBackground;
      icon = "time";
      label =
        status.freeAt && status.minutesUntilFree !== null
          ? t("A atender · livre em {0} ({1})", [minutesText(status.minutesUntilFree, t), time(status.freeAt)])
          : t("A atender · sem horários livres hoje");
      break;
    case "AWAY":
      tone = colors.error;
      background = colors.errorBackground;
      icon = "close-circle";
      label = status.until ? t("Ausente até às {0}", [time(status.until)]) : t("Ausente hoje");
      break;
    default:
      tone = colors.textSecondary;
      background = colors.input;
      icon = "moon";
      label = status.opensAt ? t("Fora do horário · abre às {0}", [time(status.opensAt)]) : t("Fora do horário");
  }

  return (
    <View style={[styles.badge, { backgroundColor: background }]} accessibilityLabel={label}>
      <Ionicons name={icon} size={status.status === "AVAILABLE" ? 8 : 12} color={tone} />
      <Text style={[styles.text, { color: tone }]} numberOfLines={1}>
        {label}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  badge: {
    flexDirection: "row",
    alignItems: "center",
    alignSelf: "flex-start",
    maxWidth: "100%",
    gap: 5,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 999,
    marginTop: 6,
  },
  text: { ...Typography.caption1, fontWeight: "600", flexShrink: 1 },
});
