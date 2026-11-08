import React, { useCallback, useEffect, useState } from "react";
import { AppState, Modal, Pressable, StyleSheet, Text, View } from "react-native";
import Ionicons from "@expo/vector-icons/Ionicons";
import { useRouter } from "expo-router";
import type { NotificationDTO } from "@slotix/types";

import { useIOSColors } from "@/components/ios";
import { Typography } from "@/constants/theme";
import { useT } from "@/i18n";
import { useAuth } from "../contexts/AuthContext";
import { listNotifications, markNotificationRead } from "../services/notifications";

// O tipo que a API dá ao aviso de um agendamento cancelado por falta (appointmentReminders.ts).
const NO_SHOW = "APPOINTMENT_CANCELLED_NO_SHOW";

/*
 * Ao entrar na app (e ao voltar a ela), quem teve um agendamento cancelado por não ter
 * comparecido vê logo a mensagem, numa janela que só sai quando a pessoa a fecha. Fechada,
 * a notificação fica lida e não volta a aparecer.
 */
export function MissedAppointmentNotice() {
  const t = useT();
  const router = useRouter();
  const colors = useIOSColors();
  const { isAuthenticated } = useAuth();
  const [queue, setQueue] = useState<NotificationDTO[]>([]);

  const check = useCallback(async () => {
    try {
      const unread = (await listNotifications()).filter((item) => item.type === NO_SHOW && !item.read);
      // A lista vem sempre inteira da API: a de outra sessão (outra conta) não fica para trás.
      setQueue(unread);
    } catch {
      // sem rede: tenta outra vez quando a app voltar a ficar ativa
    }
  }, []);

  useEffect(() => {
    if (!isAuthenticated) return;
    void check();
    const subscription = AppState.addEventListener("change", (state) => {
      if (state === "active") void check();
    });
    return () => subscription.remove();
  }, [isAuthenticated, check]);

  const current = isAuthenticated ? queue[0] : undefined;

  const dismiss = (openAppointments: boolean) => {
    if (!current) return;
    void markNotificationRead(current.id).catch(() => undefined);
    setQueue((items) => items.slice(1));
    if (openAppointments) router.push("/appointments" as never);
  };

  return (
    <Modal visible={Boolean(current)} transparent animationType="fade" onRequestClose={() => dismiss(false)}>
      <View style={[styles.backdrop, { backgroundColor: colors.overlay }]}>
        {current ? (
          <View style={[styles.card, { backgroundColor: colors.card }]} accessibilityRole="alert">
            <View style={[styles.icon, { backgroundColor: colors.errorBackground }]}>
              <Ionicons name="calendar-clear-outline" size={28} color={colors.error} />
            </View>
            <Text style={[styles.title, { color: colors.text }]}>{t(current.title)}</Text>
            <Text style={[styles.message, { color: colors.textSecondary }]}>{current.message}</Text>

            <Pressable onPress={() => dismiss(true)} accessibilityRole="button">
              {({ pressed }) => (
                <View style={[styles.primary, { backgroundColor: colors.primary, opacity: pressed ? 0.8 : 1 }]}>
                  <Text style={[styles.primaryText, { color: colors.primaryForeground }]}>{t("Ver agendamentos")}</Text>
                </View>
              )}
            </Pressable>
            <Pressable onPress={() => dismiss(false)} accessibilityRole="button" hitSlop={6}>
              {({ pressed }) => (
                <Text style={[styles.secondary, { color: colors.primary, opacity: pressed ? 0.6 : 1 }]}>{t("Entendi")}</Text>
              )}
            </Pressable>
          </View>
        ) : null}
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    padding: 28,
  },
  card: {
    width: "100%",
    maxWidth: 360,
    borderRadius: 22,
    borderCurve: "continuous",
    paddingHorizontal: 22,
    paddingTop: 26,
    paddingBottom: 14,
    alignItems: "center",
  },
  icon: {
    width: 60,
    height: 60,
    borderRadius: 30,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 14,
  },
  title: {
    ...Typography.title3,
    textAlign: "center",
    marginBottom: 8,
  },
  message: {
    ...Typography.subheadline,
    textAlign: "center",
    marginBottom: 22,
  },
  primary: {
    height: 50,
    minWidth: 260,
    borderRadius: 14,
    borderCurve: "continuous",
    alignItems: "center",
    justifyContent: "center",
  },
  primaryText: {
    ...Typography.headline,
  },
  secondary: {
    ...Typography.headline,
    paddingVertical: 12,
  },
});
