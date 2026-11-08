import React, { useCallback, useState } from "react";
import { ActivityIndicator, Image, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import Ionicons from "@expo/vector-icons/Ionicons";
import { SafeAreaView } from "react-native-safe-area-context";
import { useFocusEffect, useRouter } from "expo-router";
import type { MyMembershipDTO } from "@slotix/types";

import { useIOSColors } from "@/components/ios";
import { Typography } from "@/constants/theme";
import { useT } from "@/i18n";
import { listMyMemberships } from "../services/loyalty";

/*
 * OS MEUS ESPAÇOS — os estabelecimentos de que a pessoa é membro, com os pontos e as
 * recompensas por usar de cada um. Tocar num abre a área de membro desse espaço.
 */
export default function MySpacesScreen() {
  const t = useT();
  const router = useRouter();
  const colors = useIOSColors();
  const [memberships, setMemberships] = useState<MyMembershipDTO[] | null>(null);
  const [error, setError] = useState(false);

  useFocusEffect(
    useCallback(() => {
      let cancelled = false;
      listMyMemberships()
        .then((data) => !cancelled && setMemberships(data))
        .catch(() => !cancelled && setError(true));
      return () => {
        cancelled = true;
      };
    }, []),
  );

  return (
    <View style={[styles.flex, { backgroundColor: colors.background }]}>
      <SafeAreaView style={styles.flex} edges={["top"]}>
        <View style={styles.topBar}>
          <Pressable onPress={() => router.back()} hitSlop={10} accessibilityRole="button" accessibilityLabel={t("Voltar")}>
            <View style={[styles.iconButton, { backgroundColor: colors.card, borderColor: colors.divider }]}>
              <Ionicons name="chevron-back" size={20} color={colors.text} />
            </View>
          </Pressable>
          <Text style={[styles.title, { color: colors.text }]}>{t("Os meus espaços")}</Text>
        </View>

        {error ? (
          <View style={styles.center}>
            <Text style={[styles.text, { color: colors.textSecondary }]}>{t("Não foi possível carregar os seus espaços.")}</Text>
          </View>
        ) : !memberships ? (
          <View style={styles.center}>
            <ActivityIndicator color={colors.textSecondary} />
          </View>
        ) : memberships.length === 0 ? (
          <View style={styles.center}>
            <View style={[styles.emptyIcon, { backgroundColor: colors.infoBackground }]}>
              <Ionicons name="ribbon-outline" size={30} color={colors.primary} />
            </View>
            <Text style={[styles.emptyTitle, { color: colors.text }]}>{t("Ainda não é membro de nenhum espaço")}</Text>
            <Text style={[styles.text, { color: colors.textSecondary }]}>
              {t("Nos espaços com programa de membros, toque em “Tornar-me membro” para ter descontos, pontos e recompensas.")}
            </Text>
            <Pressable onPress={() => router.push("/explore" as never)} accessibilityRole="button">
              {({ pressed }) => (
                <View style={[styles.button, { backgroundColor: colors.primary, opacity: pressed ? 0.85 : 1 }]}>
                  <Text style={[styles.buttonText, { color: colors.primaryForeground }]}>{t("Explorar espaços")}</Text>
                </View>
              )}
            </Pressable>
          </View>
        ) : (
          <ScrollView contentContainerStyle={styles.list} showsVerticalScrollIndicator={false}>
            {memberships.map((membership) => (
              <Pressable
                key={membership.id}
                onPress={() => router.push({ pathname: "/membro", params: { businessId: membership.businessId } } as never)}
                accessibilityRole="button"
                accessibilityLabel={membership.businessName}
              >
                {({ pressed }) => (
                  <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.divider, transform: [{ scale: pressed ? 0.98 : 1 }] }]}>
                    {membership.businessLogoUrl ? (
                      <Image source={{ uri: membership.businessLogoUrl }} style={styles.logo} />
                    ) : (
                      <View style={[styles.logo, styles.logoEmpty, { backgroundColor: colors.input }]}>
                        <Ionicons name="storefront-outline" size={22} color={colors.textSecondary} />
                      </View>
                    )}
                    <View style={styles.flex}>
                      <Text style={[styles.name, { color: colors.text }]} numberOfLines={1}>
                        {membership.businessName}
                      </Text>
                      <Text style={[styles.meta, { color: colors.textSecondary }]} numberOfLines={1}>
                        {membership.programName}
                        {membership.status === "SUSPENDED" ? ` · ${t("suspensa")}` : ""}
                      </Text>
                      <View style={styles.badges}>
                        {membership.pointsEnabled ? (
                          <View style={[styles.badge, { backgroundColor: colors.infoBackground }]}>
                            <Text style={[styles.badgeText, { color: colors.primary }]}>{t("{0} pontos", [membership.pointsBalance])}</Text>
                          </View>
                        ) : null}
                        {membership.availableRewards.length > 0 ? (
                          <View style={[styles.badge, { backgroundColor: colors.successBackground }]}>
                            <Text style={[styles.badgeText, { color: colors.success }]}>
                              {membership.availableRewards.length === 1 ? t("1 recompensa") : t("{0} recompensas", [membership.availableRewards.length])}
                            </Text>
                          </View>
                        ) : null}
                      </View>
                    </View>
                    <Ionicons name="chevron-forward" size={18} color={colors.textTertiary} />
                  </View>
                )}
              </Pressable>
            ))}
          </ScrollView>
        )}
      </SafeAreaView>
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  topBar: { flexDirection: "row", alignItems: "center", gap: 12, paddingHorizontal: 16, paddingVertical: 8 },
  iconButton: { width: 40, height: 40, borderRadius: 20, borderWidth: StyleSheet.hairlineWidth, alignItems: "center", justifyContent: "center" },
  title: { ...Typography.title2 },
  center: { flex: 1, alignItems: "center", justifyContent: "center", padding: 32, gap: 10 },
  emptyIcon: { width: 64, height: 64, borderRadius: 32, alignItems: "center", justifyContent: "center", marginBottom: 6 },
  emptyTitle: { ...Typography.title3, textAlign: "center" },
  text: { ...Typography.subheadline, textAlign: "center" },
  button: { height: 46, paddingHorizontal: 22, borderRadius: 14, alignItems: "center", justifyContent: "center", marginTop: 10 },
  buttonText: { ...Typography.headline },
  list: { padding: 16, gap: 10, paddingBottom: 60 },
  card: { flexDirection: "row", alignItems: "center", gap: 12, padding: 12, borderRadius: 16, borderCurve: "continuous", borderWidth: StyleSheet.hairlineWidth },
  logo: { width: 56, height: 56, borderRadius: 14 },
  logoEmpty: { alignItems: "center", justifyContent: "center" },
  name: { ...Typography.headline },
  meta: { ...Typography.footnote, marginTop: 1 },
  badges: { flexDirection: "row", gap: 6, marginTop: 6 },
  badge: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 999 },
  badgeText: { ...Typography.caption1, fontWeight: "700" },
});
