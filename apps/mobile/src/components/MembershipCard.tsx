import React, { useCallback, useState } from "react";
import {
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
import { discountText, getBusinessLoyalty } from "../services/loyalty";

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
 * Os benefícios do espaço, na página do espaço. Ser cliente do espaço é o que dá direito a
 * eles: quem já é cliente vê os seus pontos e a sua área; quem ainda não é fica a saber que
 * se torna cliente na primeira marcação (a pergunta "É cliente do espaço?"), sem nenhum
 * registo à parte. Não aparece nada se o espaço não tiver os benefícios ligados.
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

  // Lido sempre que se volta à página: depois de uma marcação a pessoa pode já ser cliente.
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
                ? t("Cliente desde {0}", [
                    new Intl.DateTimeFormat(dateLocale(), { day: "numeric", month: "long", year: "numeric" }).format(
                      new Date(membership.joinedAt),
                    ),
                  ])
                : t("Benefícios para os clientes do espaço")}
            </Text>
          </View>
          {isMember ? (
            <View style={[styles.memberChip, { backgroundColor: colors.successBackground }]}>
              <Ionicons name="checkmark-circle" size={13} color={colors.success} />
              <Text style={[styles.memberChipText, { color: colors.success }]}>{t("Cliente")}</Text>
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
            {t("Os seus benefícios neste espaço estão suspensos. Fale com o espaço para os reativar.")}
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
                      {forMembers ? t("Só clientes do espaço") : t("Para todos")}
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
            {t("Só para clientes do espaço: {0}.", [exclusive.map((service) => service.name).join(", ")])}
          </Text>
        ) : null}

        {isMember ? (
          <Pressable onPress={openArea} accessibilityRole="button">
            {({ pressed }) => (
              <View style={[styles.secondaryButton, { borderColor: colors.primary, opacity: pressed ? 0.7 : 1 }]}>
                <Text style={[styles.secondaryButtonText, { color: colors.primary }]}>
                  {t("A minha área de cliente")}
                </Text>
                <Ionicons name="chevron-forward" size={16} color={colors.primary} />
              </View>
            )}
          </Pressable>
        ) : membership?.status !== "SUSPENDED" && membership?.status !== "REMOVED" ? (
          <View style={[styles.hint, { backgroundColor: colors.infoBackground }]}>
            <Ionicons name="information-circle" size={18} color={colors.primary} />
            <Text style={[styles.hintText, { color: colors.text }]}>
              {t("Ao fazer a sua primeira marcação, confirme que é cliente do espaço e estes benefícios passam a ser seus.")}
            </Text>
          </View>
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
  hint: { flexDirection: "row", alignItems: "center", gap: 8, borderRadius: 12, padding: 12 },
  hintText: { ...Typography.footnote, flex: 1 },
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
