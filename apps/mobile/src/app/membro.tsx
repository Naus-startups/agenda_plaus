import React, { useCallback, useState } from "react";
import { ActivityIndicator, Alert, Image, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import Ionicons from "@expo/vector-icons/Ionicons";
import { SafeAreaView } from "react-native-safe-area-context";
import { useFocusEffect, useLocalSearchParams, useRouter } from "expo-router";
import type { LoyaltyTransactionType, MemberAreaDTO, MemberRewardDTO } from "@slotix/types";

import { useIOSColors } from "@/components/ios";
import { promotionConditions } from "@/components/MembershipCard";
import { Typography } from "@/constants/theme";
import { dateLocale, useT } from "@/i18n";
import { discountText, getMemberArea, leaveLoyalty } from "../services/loyalty";

const TRANSACTION: Record<LoyaltyTransactionType, { label: string; icon: React.ComponentProps<typeof Ionicons>["name"] }> = {
  EARN: { label: "Pontos recebidos", icon: "add-circle" },
  REDEEM: { label: "Pontos utilizados", icon: "gift" },
  REFUND: { label: "Pontos devolvidos", icon: "arrow-undo-circle" },
  REVERSAL: { label: "Pontos retirados", icon: "remove-circle" },
  EXPIRE: { label: "Pontos expirados", icon: "time" },
  ADJUST: { label: "Ajuste do espaço", icon: "create" },
};

const REWARD_STATUS: Record<MemberRewardDTO["status"], string> = {
  AVAILABLE: "Disponível",
  RESERVED: "Reservada para uma marcação",
  USED: "Utilizada",
  EXPIRED: "Expirada",
  CANCELLED: "Cancelada",
};

const STATUS: Record<string, string> = { ACTIVE: "Ativa", SUSPENDED: "Suspensa", REMOVED: "Removida", LEFT: "Terminada" };

/*
 * A MINHA ÁREA DE MEMBRO — num espaço: estado e data da adesão, pontos, próxima
 * recompensa, recompensas por usar, benefícios, promoções exclusivas e o histórico.
 */
export default function MemberAreaScreen() {
  const t = useT();
  const router = useRouter();
  const colors = useIOSColors();
  const params = useLocalSearchParams<{ businessId?: string }>();
  const businessId = params.businessId ?? "";
  const [area, setArea] = useState<MemberAreaDTO | null>(null);
  const [error, setError] = useState(false);
  const [history, setHistory] = useState<"points" | "rewards">("points");

  useFocusEffect(
    useCallback(() => {
      let cancelled = false;
      getMemberArea(businessId)
        .then((data) => !cancelled && setArea(data))
        .catch(() => !cancelled && setError(true));
      return () => {
        cancelled = true;
      };
    }, [businessId]),
  );

  const formatDay = (iso: string) => new Intl.DateTimeFormat(dateLocale(), { day: "numeric", month: "short", year: "numeric" }).format(new Date(iso));

  const leave = () =>
    Alert.alert(t("Sair do programa?"), t("Deixa de ter os preços e recompensas de membro neste espaço. Pode voltar a aderir quando quiser."), [
      { text: t("Cancelar"), style: "cancel" },
      {
        text: t("Sair do programa"),
        style: "destructive",
        onPress: () =>
          void leaveLoyalty(businessId)
            .then(() => router.back())
            .catch(() => Alert.alert(t("Não foi possível sair do programa"), t("Tente novamente."))),
      },
    ]);

  const book = () => router.push({ pathname: "/booking/service", params: { businessId } } as never);

  return (
    <View style={[styles.flex, { backgroundColor: colors.background }]}>
      <SafeAreaView style={styles.flex} edges={["top"]}>
        <View style={styles.topBar}>
          <Pressable onPress={() => router.back()} hitSlop={10} accessibilityRole="button" accessibilityLabel={t("Voltar")}>
            <View style={[styles.iconButton, { backgroundColor: colors.card, borderColor: colors.divider }]}>
              <Ionicons name="chevron-back" size={20} color={colors.text} />
            </View>
          </Pressable>
          <Text style={[styles.topTitle, { color: colors.text }]}>{t("A minha área de membro")}</Text>
          <View style={styles.iconButtonSpace} />
        </View>

        {error ? (
          <View style={styles.center}>
            <Text style={[styles.body, { color: colors.textSecondary }]}>{t("Não foi possível carregar a sua área de membro.")}</Text>
          </View>
        ) : !area ? (
          <View style={styles.center}>
            <ActivityIndicator color={colors.textSecondary} />
          </View>
        ) : (
          <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
            {/* Cartão de membro */}
            <View style={[styles.hero, { backgroundColor: colors.primary }]}>
              <View style={styles.heroTop}>
                {area.businessLogoUrl ? (
                  <Image source={{ uri: area.businessLogoUrl }} style={styles.logo} />
                ) : (
                  <View style={[styles.logo, styles.logoEmpty]}>
                    <Ionicons name="storefront" size={20} color="#FFFFFF" />
                  </View>
                )}
                <View style={styles.flex}>
                  <Text style={styles.heroName} numberOfLines={1}>
                    {area.businessName}
                  </Text>
                  <Text style={styles.heroProgram} numberOfLines={1}>
                    {area.programName}
                  </Text>
                </View>
                <View style={styles.heroChip}>
                  <Text style={styles.heroChipText}>{t(STATUS[area.status] ?? area.status)}</Text>
                </View>
              </View>

              {area.pointsEnabled ? (
                <View>
                  <Text style={styles.heroPoints}>{area.pointsBalance}</Text>
                  <Text style={styles.heroLabel}>{t("pontos disponíveis")}</Text>
                </View>
              ) : null}

              <View style={styles.heroFooter}>
                <Text style={styles.heroLabel}>{t("Membro desde {0}", [formatDay(area.joinedAt)])}</Text>
                <Text style={styles.heroLabel}>{t("{0} serviços", [area.visits])}</Text>
              </View>
            </View>

            {area.status === "SUSPENDED" ? (
              <View style={[styles.notice, { backgroundColor: colors.warningBackground }]}>
                <Ionicons name="alert-circle" size={18} color={colors.warning} />
                <Text style={[styles.noticeText, { color: colors.text }]}>{t("A sua adesão está suspensa pelo espaço: os benefícios não se aplicam até ser reativada.")}</Text>
              </View>
            ) : null}

            {area.nextReward ? (
              <View style={[styles.card, { backgroundColor: colors.card }]}>
                <Text style={[styles.cardLabel, { color: colors.textSecondary }]}>{t("PRÓXIMA RECOMPENSA")}</Text>
                <Text style={[styles.cardTitle, { color: colors.text }]}>{area.nextReward.name}</Text>
                <Text style={[styles.body, { color: colors.textSecondary }]}>
                  {area.nextReward.pointsNeeded !== null
                    ? t("Faltam {0} pontos.", [area.nextReward.pointsNeeded])
                    : t("Faltam {0} serviços pagos.", [area.nextReward.visitsNeeded ?? 0])}
                </Text>
              </View>
            ) : null}

            <Section title={t("Recompensas para usar")}>
              {area.availableRewards.length === 0 ? (
                <Text style={[styles.empty, { color: colors.textSecondary }]}>{t("Ainda não tem recompensas. Continue a marcar para as desbloquear.")}</Text>
              ) : (
                area.availableRewards.map((reward) => (
                  <View key={reward.id} style={[styles.row, { backgroundColor: colors.card }]}>
                    <View style={[styles.rowIcon, { backgroundColor: colors.successBackground }]}>
                      <Ionicons name="gift" size={18} color={colors.success} />
                    </View>
                    <View style={styles.flex}>
                      <Text style={[styles.rowTitle, { color: colors.text }]}>{reward.name}</Text>
                      <Text style={[styles.rowMeta, { color: colors.textSecondary }]}>
                        {t(discountText(reward.discountType, reward.discountValue))}
                        {reward.expiresAt ? ` · ${t("válida até {0}", [formatDay(reward.expiresAt)])}` : ""}
                      </Text>
                    </View>
                  </View>
                ))
              )}
              {area.availableRewards.length > 0 || area.rewards.some((reward) => reward.kind === "POINTS") ? (
                <Text style={[styles.hint, { color: colors.textSecondary }]}>{t("Escolha a recompensa no último passo da marcação.")}</Text>
              ) : null}
            </Section>

            {area.promotions.length > 0 ? (
              <Section title={t("Promoções exclusivas")}>
                {area.promotions.map((promotion) => {
                  const conditions = promotionConditions(promotion, t);
                  return (
                    <View key={promotion.id} style={[styles.row, { backgroundColor: colors.card }]}>
                      <View style={[styles.discount, { backgroundColor: colors.primary }]}>
                        <Text style={styles.discountText}>−{t(discountText(promotion.discountType, promotion.discountValue))}</Text>
                      </View>
                      <View style={styles.flex}>
                        <Text style={[styles.rowTitle, { color: colors.text }]}>{promotion.name}</Text>
                        {conditions ? <Text style={[styles.rowMeta, { color: colors.textSecondary }]}>{conditions}</Text> : null}
                      </View>
                    </View>
                  );
                })}
              </Section>
            ) : null}

            {area.benefits.length > 0 ? (
              <Section title={t("Os seus benefícios")}>
                <View style={[styles.card, { backgroundColor: colors.card, gap: 12 }]}>
                  {area.benefits.map((benefit) => (
                    <View key={benefit.id} style={styles.benefit}>
                      <Ionicons name="checkmark-circle" size={18} color={colors.primary} />
                      <View style={styles.flex}>
                        <Text style={[styles.rowTitle, { color: colors.text }]}>{benefit.title}</Text>
                        {benefit.description || benefit.conditions ? (
                          <Text style={[styles.rowMeta, { color: colors.textSecondary }]}>{[benefit.description, benefit.conditions].filter(Boolean).join(" · ")}</Text>
                        ) : null}
                      </View>
                    </View>
                  ))}
                </View>
              </Section>
            ) : null}

            <Section title={t("Histórico")}>
              <View style={[styles.segmented, { backgroundColor: colors.input }]}>
                {(["points", "rewards"] as const).map((key) => (
                  <Pressable key={key} onPress={() => setHistory(key)} style={[styles.segment, history === key && { backgroundColor: colors.card }]}>
                    <Text style={[styles.segmentText, { color: colors.text, fontWeight: history === key ? "600" : "500" }]}>{key === "points" ? t("Pontos") : t("Recompensas")}</Text>
                  </Pressable>
                ))}
              </View>
              <View style={[styles.card, { backgroundColor: colors.card, paddingVertical: 4 }]}>
                {history === "points" ? (
                  area.transactions.length === 0 ? (
                    <Text style={[styles.empty, { color: colors.textSecondary, paddingVertical: 12 }]}>{t("Ainda sem movimentos de pontos.")}</Text>
                  ) : (
                    area.transactions.map((transaction, index) => (
                      <View key={transaction.id} style={[styles.historyRow, index > 0 && { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.divider }]}>
                        <Ionicons name={TRANSACTION[transaction.type].icon} size={18} color={transaction.points > 0 ? colors.success : colors.textSecondary} />
                        <View style={styles.flex}>
                          <Text style={[styles.rowTitle, { color: colors.text }]}>{t(TRANSACTION[transaction.type].label)}</Text>
                          <Text style={[styles.rowMeta, { color: colors.textSecondary }]}>
                            {formatDay(transaction.createdAt)}
                            {transaction.reason ? ` · ${t(transaction.reason)}` : ""}
                          </Text>
                        </View>
                        <Text style={[styles.historyPoints, { color: transaction.points > 0 ? colors.success : colors.text }]}>
                          {transaction.points > 0 ? "+" : ""}
                          {transaction.points}
                        </Text>
                      </View>
                    ))
                  )
                ) : area.rewardHistory.length === 0 ? (
                  <Text style={[styles.empty, { color: colors.textSecondary, paddingVertical: 12 }]}>{t("Ainda sem recompensas.")}</Text>
                ) : (
                  area.rewardHistory.map((reward, index) => (
                    <View key={reward.id} style={[styles.historyRow, index > 0 && { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.divider }]}>
                      <Ionicons name="gift-outline" size={18} color={colors.textSecondary} />
                      <View style={styles.flex}>
                        <Text style={[styles.rowTitle, { color: colors.text }]}>{reward.name}</Text>
                        <Text style={[styles.rowMeta, { color: colors.textSecondary }]}>
                          {formatDay(reward.createdAt)} · {t(REWARD_STATUS[reward.status])}
                        </Text>
                      </View>
                    </View>
                  ))
                )}
              </View>
            </Section>

            {area.status === "ACTIVE" ? (
              <Pressable onPress={book} accessibilityRole="button">
                {({ pressed }) => (
                  <View style={[styles.primaryButton, { backgroundColor: colors.primary, opacity: pressed ? 0.85 : 1 }]}>
                    <Ionicons name="calendar" size={17} color={colors.primaryForeground} />
                    <Text style={[styles.primaryButtonText, { color: colors.primaryForeground }]}>{t("Marcar com benefícios de membro")}</Text>
                  </View>
                )}
              </Pressable>
            ) : null}

            {area.status === "ACTIVE" ? (
              <Pressable onPress={leave} accessibilityRole="button" hitSlop={6}>
                <Text style={[styles.leave, { color: colors.error }]}>{t("Sair do programa")}</Text>
              </Pressable>
            ) : null}
          </ScrollView>
        )}
      </SafeAreaView>
    </View>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  const colors = useIOSColors();
  return (
    <View style={styles.section}>
      <Text style={[styles.sectionTitle, { color: colors.text }]}>{title}</Text>
      <View style={styles.sectionBody}>{children}</View>
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  center: { flex: 1, alignItems: "center", justifyContent: "center", padding: 32 },
  topBar: { flexDirection: "row", alignItems: "center", paddingHorizontal: 16, paddingVertical: 8, gap: 12 },
  topTitle: { ...Typography.headline, flex: 1, textAlign: "center" },
  iconButton: { width: 40, height: 40, borderRadius: 20, borderWidth: StyleSheet.hairlineWidth, alignItems: "center", justifyContent: "center" },
  iconButtonSpace: { width: 40 },
  content: { padding: 16, paddingBottom: 60, gap: 16 },
  hero: { borderRadius: 22, borderCurve: "continuous", padding: 18, gap: 16 },
  heroTop: { flexDirection: "row", alignItems: "center", gap: 12 },
  logo: { width: 44, height: 44, borderRadius: 12, backgroundColor: "rgba(255,255,255,0.18)" },
  logoEmpty: { alignItems: "center", justifyContent: "center" },
  heroName: { ...Typography.headline, color: "#FFFFFF" },
  heroProgram: { ...Typography.footnote, color: "rgba(255,255,255,0.8)" },
  heroChip: { backgroundColor: "rgba(255,255,255,0.2)", paddingHorizontal: 10, paddingVertical: 4, borderRadius: 999 },
  heroChipText: { ...Typography.caption1, color: "#FFFFFF", fontWeight: "700" },
  heroPoints: { fontSize: 40, lineHeight: 46, fontWeight: "800", color: "#FFFFFF", letterSpacing: -0.5 },
  heroLabel: { ...Typography.footnote, color: "rgba(255,255,255,0.85)" },
  heroFooter: { flexDirection: "row", justifyContent: "space-between" },
  notice: { flexDirection: "row", gap: 10, padding: 12, borderRadius: 14, alignItems: "center" },
  noticeText: { ...Typography.footnote, flex: 1 },
  card: { borderRadius: 16, borderCurve: "continuous", padding: 14, gap: 4 },
  cardLabel: { ...Typography.caption1, fontWeight: "600", letterSpacing: 0.4 },
  cardTitle: { ...Typography.headline },
  body: { ...Typography.subheadline },
  section: { gap: 10 },
  sectionTitle: { ...Typography.title3 },
  sectionBody: { gap: 8 },
  row: { flexDirection: "row", alignItems: "center", gap: 12, padding: 12, borderRadius: 14 },
  rowIcon: { width: 36, height: 36, borderRadius: 10, alignItems: "center", justifyContent: "center" },
  rowTitle: { ...Typography.subheadline, fontWeight: "600" },
  rowMeta: { ...Typography.footnote, marginTop: 1 },
  discount: { minWidth: 58, paddingHorizontal: 8, paddingVertical: 6, borderRadius: 9, alignItems: "center" },
  discountText: { ...Typography.footnote, fontWeight: "800", color: "#FFFFFF" },
  benefit: { flexDirection: "row", gap: 10, alignItems: "flex-start" },
  empty: { ...Typography.subheadline },
  hint: { ...Typography.footnote },
  segmented: { flexDirection: "row", borderRadius: 10, padding: 2 },
  segment: { flex: 1, alignItems: "center", paddingVertical: 7, borderRadius: 8 },
  segmentText: { ...Typography.footnote },
  historyRow: { flexDirection: "row", alignItems: "center", gap: 10, paddingVertical: 10 },
  historyPoints: { ...Typography.headline, fontVariant: ["tabular-nums"] },
  primaryButton: { height: 50, borderRadius: 14, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, marginTop: 4 },
  primaryButtonText: { ...Typography.headline },
  leave: { ...Typography.subheadline, fontWeight: "600", textAlign: "center", paddingVertical: 8 },
});
