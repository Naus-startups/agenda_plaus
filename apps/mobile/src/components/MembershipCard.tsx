import React, { useCallback, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Pressable,
  StyleSheet,
  Text,
  View,
  type StyleProp,
  type ViewStyle,
} from "react-native";
import Ionicons from "@expo/vector-icons/Ionicons";
import { useFocusEffect, useRouter } from "expo-router";
import type { BusinessLoyaltyDTO, PromotionDTO, ServiceDTO } from "@slotix/types";

import { useIOSColors } from "@/components/ios";
import { Typography } from "@/constants/theme";
import { dateLocale, useT } from "@/i18n";
import { ApiRequestError } from "../services/api-client";
import { discountText, getBusinessLoyalty, joinLoyalty } from "../services/loyalty";
import { tapFeedback } from "../services/haptics";

const WEEKDAYS = ["", "seg", "ter", "qua", "qui", "sex", "sáb", "dom"];

export function promotionConditions(promotion: PromotionDTO, t: ReturnType<typeof useT>): string {
  const parts: string[] = [];
  if (promotion.weekdays.length > 0) parts.push(promotion.weekdays.map((day) => t(WEEKDAYS[day])).join(", "));
  if (promotion.startMinute !== null || promotion.endMinute !== null) {
    const time = (minute: number | null, fallback: string) =>
      minute === null
        ? fallback
        : `${String(Math.floor(minute / 60)).padStart(2, "0")}:${String(minute % 60).padStart(2, "0")}`;
    parts.push(`${time(promotion.startMinute, "00:00")}–${time(promotion.endMinute, "24:00")}`);
  }
  if (promotion.endsAt) {
    parts.push(
      t("até {0}", [
        new Intl.DateTimeFormat(dateLocale(), { day: "numeric", month: "short" }).format(new Date(promotion.endsAt)),
      ]),
    );
  }
  if (promotion.remaining !== null)
    parts.push(promotion.remaining === 1 ? t("última vaga") : t("{0} vagas", [promotion.remaining]));
  return parts.join(" · ");
}

/*
 * O programa de membros na página do espaço: o que oferece, as promoções em curso e o
 * botão "Tornar-me membro" — ou, para quem já é membro, os pontos e a área de membro.
 * Não aparece nada se o espaço não tiver o programa ligado.
 */
export function MembershipCard({
  businessId,
  businessName,
  services,
  style,
}: {
  businessId: string;
  businessName: string;
  services: ServiceDTO[];
  style?: StyleProp<ViewStyle>;
}) {
  const t = useT();
  const router = useRouter();
  const colors = useIOSColors();
  const [loyalty, setLoyalty] = useState<BusinessLoyaltyDTO | null>(null);
  const [joining, setJoining] = useState(false);

  // Lido sempre que se volta à página: a adesão pode ter mudado na área de membro.
  useFocusEffect(
    useCallback(() => {
      let cancelled = false;
      getBusinessLoyalty(businessId)
        .then((data) => !cancelled && setLoyalty(data))
        .catch(() => undefined);
      return () => {
        cancelled = true;
      };
    }, [businessId]),
  );

  if (!loyalty?.program) return null;
  const { program, membership } = loyalty;
  const isMember = membership?.status === "ACTIVE";
  const exclusive = services.filter((service) => loyalty.membersOnlyServiceIds.includes(service.id));

  const openArea = () => router.push({ pathname: "/membro", params: { businessId } } as never);

  const join = async () => {
    setJoining(true);
    try {
      await joinLoyalty(businessId);
      tapFeedback();
      setLoyalty(await getBusinessLoyalty(businessId));
      Alert.alert(
        t("Bem-vindo ao {0}", [program.name]),
        t("Já é membro de {0}. Os seus benefícios aplicam-se nas próximas marcações.", [businessName]),
      );
    } catch (error) {
      Alert.alert(
        t("Não foi possível aderir"),
        error instanceof ApiRequestError ? error.message : t("Tente novamente."),
      );
    } finally {
      setJoining(false);
    }
  };

  const askToJoin = () => {
    const rules = [program.joinRules, program.terms].filter(Boolean).join("\n\n");
    Alert.alert(t("Tornar-me membro de {0}?", [businessName]), rules || t("A adesão é gratuita."), [
      { text: t("Cancelar"), style: "cancel" },
      { text: t("Aderir gratuitamente"), onPress: () => void join() },
    ]);
  };

  return (
    <View style={style}>
      <View
        style={[styles.card, { backgroundColor: colors.card, borderColor: isMember ? colors.primary : colors.divider }]}
      >
        <View style={styles.header}>
          <View style={[styles.headerIcon, { backgroundColor: colors.infoBackground }]}>
            <Ionicons name="ribbon" size={20} color={colors.primary} />
          </View>
          <View style={styles.flex}>
            <Text style={[styles.title, { color: colors.text }]}>{program.name}</Text>
            <Text style={[styles.subtitle, { color: colors.textSecondary }]}>
              {isMember
                ? t("Membro desde {0}", [
                    new Intl.DateTimeFormat(dateLocale(), { day: "numeric", month: "long", year: "numeric" }).format(
                      new Date(membership.joinedAt),
                    ),
                  ])
                : t("Programa de membros · adesão gratuita")}
            </Text>
          </View>
          {isMember ? (
            <View style={[styles.memberChip, { backgroundColor: colors.successBackground }]}>
              <Ionicons name="checkmark-circle" size={13} color={colors.success} />
              <Text style={[styles.memberChipText, { color: colors.success }]}>{t("Membro")}</Text>
            </View>
          ) : null}
        </View>

        {program.description && !isMember ? (
          <Text style={[styles.body, { color: colors.textSecondary }]}>{program.description}</Text>
        ) : null}

        {isMember && membership ? (
          <View style={[styles.pointsRow, { backgroundColor: colors.input }]}>
            {membership.pointsEnabled ? (
              <View style={styles.flex}>
                <Text style={[styles.pointsValue, { color: colors.text }]}>{membership.pointsBalance}</Text>
                <Text style={[styles.pointsLabel, { color: colors.textSecondary }]}>{t("pontos")}</Text>
              </View>
            ) : null}
            <View style={[styles.flex, { flex: 2 }]}>
              <Text style={[styles.pointsLabel, { color: colors.textSecondary }]}>{t("Próxima recompensa")}</Text>
              <Text style={[styles.nextReward, { color: colors.text }]} numberOfLines={2}>
                {membership.nextReward
                  ? membership.nextReward.pointsNeeded !== null
                    ? t("{0} — faltam {1} pontos", [membership.nextReward.name, membership.nextReward.pointsNeeded])
                    : t("{0} — faltam {1} serviços", [
                        membership.nextReward.name,
                        membership.nextReward.visitsNeeded ?? 0,
                      ])
                  : membership.availableRewards.length > 0
                    ? t("Tem {0} recompensa(s) para usar", [membership.availableRewards.length])
                    : "—"}
              </Text>
            </View>
          </View>
        ) : null}

        {membership?.status === "SUSPENDED" ? (
          <Text style={[styles.body, { color: colors.warning }]}>
            {t("A sua adesão a este espaço está suspensa. Fale com o espaço para a reativar.")}
          </Text>
        ) : null}

        {!isMember && loyalty.benefits.length > 0 ? (
          <View style={styles.list}>
            {loyalty.benefits.slice(0, 4).map((benefit) => (
              <View key={benefit.id} style={styles.listItem}>
                <Ionicons name="checkmark-circle" size={16} color={colors.primary} />
                <Text style={[styles.listText, { color: colors.text }]}>{benefit.title}</Text>
              </View>
            ))}
            {loyalty.rewards.slice(0, 2).map((reward) => (
              <View key={reward.id} style={styles.listItem}>
                <Ionicons name="gift-outline" size={16} color={colors.primary} />
                <Text style={[styles.listText, { color: colors.text }]}>
                  {reward.name}
                  {reward.kind === "VISITS"
                    ? t(" ao fim de {0} serviços", [reward.visitsRequired ?? 0])
                    : reward.kind === "POINTS"
                      ? t(" por {0} pontos", [reward.pointsCost ?? 0])
                      : t(" no seu aniversário")}
                </Text>
              </View>
            ))}
          </View>
        ) : null}

        {loyalty.promotions.length > 0 ? (
          <View style={styles.promotions}>
            <Text style={[styles.groupLabel, { color: colors.textSecondary }]}>{t("PROMOÇÕES ATIVAS")}</Text>
            {loyalty.promotions.map((promotion) => {
              const forMembers = promotion.audience === "MEMBERS";
              const conditions = promotionConditions(promotion, t);
              return (
                <View key={promotion.id} style={[styles.promotion, { borderColor: colors.divider }]}>
                  <View
                    style={[
                      styles.discountBadge,
                      { backgroundColor: forMembers ? colors.primary : colors.successBackground },
                    ]}
                  >
                    <Text
                      style={[styles.discountText, { color: forMembers ? colors.primaryForeground : colors.success }]}
                    >
                      −{t(discountText(promotion.discountType, promotion.discountValue))}
                    </Text>
                  </View>
                  <View style={styles.flex}>
                    <Text style={[styles.promotionName, { color: colors.text }]} numberOfLines={1}>
                      {promotion.name}
                    </Text>
                    <Text style={[styles.promotionMeta, { color: colors.textSecondary }]} numberOfLines={1}>
                      {forMembers ? t("Só membros") : t("Para todos")}
                      {conditions ? ` · ${conditions}` : ""}
                    </Text>
                  </View>
                </View>
              );
            })}
          </View>
        ) : null}

        {exclusive.length > 0 && !isMember ? (
          <Text style={[styles.body, { color: colors.textSecondary }]}>
            {t("Exclusivo para membros: {0}.", [exclusive.map((service) => service.name).join(", ")])}
          </Text>
        ) : null}

        {isMember ? (
          <Pressable onPress={openArea} accessibilityRole="button">
            {({ pressed }) => (
              <View style={[styles.secondaryButton, { borderColor: colors.primary, opacity: pressed ? 0.7 : 1 }]}>
                <Text style={[styles.secondaryButtonText, { color: colors.primary }]}>
                  {t("A minha área de membro")}
                </Text>
                <Ionicons name="chevron-forward" size={16} color={colors.primary} />
              </View>
            )}
          </Pressable>
        ) : membership?.status !== "SUSPENDED" && membership?.status !== "REMOVED" ? (
          <Pressable onPress={askToJoin} disabled={joining} accessibilityRole="button">
            {({ pressed }) => (
              <View
                style={[
                  styles.primaryButton,
                  { backgroundColor: colors.primary, opacity: pressed || joining ? 0.8 : 1 },
                ]}
              >
                {joining ? (
                  <ActivityIndicator color={colors.primaryForeground} />
                ) : (
                  <Ionicons name="sparkles" size={16} color={colors.primaryForeground} />
                )}
                <Text style={[styles.primaryButtonText, { color: colors.primaryForeground }]}>
                  {t("Tornar-me membro")}
                </Text>
              </View>
            )}
          </Pressable>
        ) : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  card: {
    borderRadius: 20,
    borderCurve: "continuous",
    borderWidth: 1,
    padding: 16,
    gap: 14,
  },
  header: { flexDirection: "row", alignItems: "center", gap: 12 },
  headerIcon: { width: 40, height: 40, borderRadius: 12, alignItems: "center", justifyContent: "center" },
  title: { ...Typography.headline },
  subtitle: { ...Typography.footnote, marginTop: 1 },
  memberChip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 999,
  },
  memberChipText: { ...Typography.caption1, fontWeight: "700" },
  body: { ...Typography.subheadline },
  pointsRow: { flexDirection: "row", alignItems: "center", gap: 12, borderRadius: 14, padding: 12 },
  pointsValue: { ...Typography.title2 },
  pointsLabel: { ...Typography.caption1 },
  nextReward: { ...Typography.subheadline, fontWeight: "600", marginTop: 2 },
  list: { gap: 8 },
  listItem: { flexDirection: "row", alignItems: "center", gap: 8 },
  listText: { ...Typography.subheadline, flex: 1 },
  promotions: { gap: 8 },
  groupLabel: { ...Typography.caption1, fontWeight: "600", letterSpacing: 0.4 },
  promotion: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 12,
    padding: 10,
  },
  discountBadge: { minWidth: 58, paddingHorizontal: 8, paddingVertical: 6, borderRadius: 9, alignItems: "center" },
  discountText: { ...Typography.footnote, fontWeight: "800" },
  promotionName: { ...Typography.subheadline, fontWeight: "600" },
  promotionMeta: { ...Typography.caption1, marginTop: 1 },
  primaryButton: {
    height: 48,
    borderRadius: 14,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
  },
  primaryButtonText: { ...Typography.headline },
  secondaryButton: {
    height: 46,
    borderRadius: 14,
    borderWidth: 1.5,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
  },
  secondaryButtonText: { ...Typography.headline },
});
