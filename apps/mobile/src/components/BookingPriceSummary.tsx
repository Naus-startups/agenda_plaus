import React from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import Ionicons from "@expo/vector-icons/Ionicons";
import type { PriceQuoteDTO, RewardOptionDTO } from "@slotix/types";

import { useIOSColors } from "@/components/ios";
import { Typography } from "@/constants/theme";
import { dateLocale, useT } from "@/i18n";
import { discountText, formatKz } from "../services/loyalty";

export const rewardKey = (option: RewardOptionDTO) => option.memberRewardId ?? option.pointsRewardId ?? "";

/*
 * Na confirmação da marcação: o que foi descontado e porquê (promoções, recompensa) e as
 * recompensas que o membro pode usar nesta marcação. Os valores vêm todos da API.
 */
export function BookingPriceSummary({
  quote,
  selected,
  onSelect,
}: {
  quote: PriceQuoteDTO;
  selected: string | null;
  onSelect: (key: string | null) => void;
}) {
  const t = useT();
  const colors = useIOSColors();
  const hasDiscounts = quote.discounts.length > 0;
  if (!hasDiscounts && quote.rewardOptions.length === 0 && !quote.membersOnlyService) return null;

  return (
    <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.divider }]}>
      {quote.membersOnlyService && !quote.isMember ? (
        <View style={[styles.notice, { backgroundColor: colors.warningBackground }]}>
          <Ionicons name="lock-closed" size={16} color={colors.warning} />
          <Text style={[styles.noticeText, { color: colors.text }]}>
            {t("Este serviço é exclusivo para membros do espaço. Torne-se membro na página do espaço para o marcar.")}
          </Text>
        </View>
      ) : null}

      {hasDiscounts ? (
        <View style={styles.lines}>
          <Text style={[styles.label, { color: colors.textSecondary }]}>{t("DESCONTOS APLICADOS")}</Text>
          <View style={styles.line}>
            <Text style={[styles.lineText, { color: colors.textSecondary }]}>{t("Preço normal")}</Text>
            <Text style={[styles.lineValue, styles.strike, { color: colors.textSecondary }]}>{formatKz(quote.originalPrice)}</Text>
          </View>
          {quote.discounts.map((discount, index) => (
            <View key={`${discount.label}-${index}`} style={styles.line}>
              <View style={styles.lineName}>
                <Ionicons name={discount.source === "REWARD" ? "gift" : "pricetag"} size={14} color={colors.success} />
                <Text style={[styles.lineText, { color: colors.text }]} numberOfLines={1}>
                  {discount.label}
                </Text>
              </View>
              <Text style={[styles.lineValue, { color: colors.success }]}>−{formatKz(discount.amount)}</Text>
            </View>
          ))}
          <View style={[styles.line, styles.totalLine, { borderTopColor: colors.divider }]}>
            <Text style={[styles.totalText, { color: colors.text }]}>{t("A pagar")}</Text>
            <Text style={[styles.totalText, { color: colors.text }]}>{formatKz(quote.finalPrice)}</Text>
          </View>
        </View>
      ) : null}

      {quote.rewardOptions.length > 0 ? (
        <View style={styles.lines}>
          <Text style={[styles.label, { color: colors.textSecondary }]}>
            {t("USAR UMA RECOMPENSA")}
            {quote.pointsBalance !== null ? ` · ${t("tem {0} pontos", [quote.pointsBalance])}` : ""}
          </Text>
          {[null, ...quote.rewardOptions].map((option) => {
            const key = option ? rewardKey(option) : null;
            const active = selected === key;
            return (
              <Pressable key={key ?? "none"} onPress={() => onSelect(key)} accessibilityRole="radio" accessibilityState={{ selected: active }}>
                <View style={[styles.option, { borderColor: active ? colors.primary : colors.divider, backgroundColor: active ? colors.infoBackground : "transparent" }]}>
                  <Ionicons name={active ? "radio-button-on" : "radio-button-off"} size={20} color={active ? colors.primary : colors.textTertiary} />
                  <View style={styles.flex}>
                    <Text style={[styles.optionTitle, { color: colors.text }]}>{option ? option.name : t("Não usar recompensa")}</Text>
                    {option ? (
                      <Text style={[styles.optionMeta, { color: colors.textSecondary }]}>
                        {t(discountText(option.discountType, option.discountValue))}
                        {option.pointsCost ? ` · ${t("{0} pontos", [option.pointsCost])}` : ""}
                        {option.expiresAt
                          ? ` · ${t("válida até {0}", [new Intl.DateTimeFormat(dateLocale(), { day: "numeric", month: "short" }).format(new Date(option.expiresAt))])}`
                          : ""}
                      </Text>
                    ) : null}
                  </View>
                </View>
              </Pressable>
            );
          })}
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  card: { marginTop: 15, padding: 16, borderRadius: 21, borderCurve: "continuous", borderWidth: StyleSheet.hairlineWidth, gap: 16 },
  notice: { flexDirection: "row", gap: 8, padding: 10, borderRadius: 12, alignItems: "center" },
  noticeText: { ...Typography.footnote, flex: 1 },
  lines: { gap: 8 },
  label: { fontSize: 10, letterSpacing: 0.3, fontWeight: "700" },
  line: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 12 },
  lineName: { flexDirection: "row", alignItems: "center", gap: 6, flex: 1 },
  lineText: { ...Typography.subheadline, flexShrink: 1 },
  lineValue: { ...Typography.subheadline, fontWeight: "600" },
  strike: { textDecorationLine: "line-through" },
  totalLine: { borderTopWidth: StyleSheet.hairlineWidth, paddingTop: 8, marginTop: 2 },
  totalText: { ...Typography.headline },
  option: { flexDirection: "row", alignItems: "center", gap: 10, borderWidth: 1, borderRadius: 14, padding: 12 },
  optionTitle: { ...Typography.subheadline, fontWeight: "600" },
  optionMeta: { ...Typography.footnote, marginTop: 1 },
});
