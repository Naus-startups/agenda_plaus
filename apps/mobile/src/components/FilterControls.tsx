import React from "react";
import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import Ionicons from "@expo/vector-icons/Ionicons";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { useIOSColors } from "@/components/ios";
import { Typography } from "@/constants/theme";
import { useT } from "@/i18n";

type IconName = React.ComponentProps<typeof Ionicons>["name"];

export type FilterOption<T> = { value: T; label: string; icon?: IconName };

/*
 * Botão de filtro: diz o que está escolhido ("Relevantes", "10 km") e abre a folha com as
 * opções. Fica realçado quando a escolha não é a de origem, para se ver que há um filtro.
 */
export function FilterButton({
  icon,
  label,
  highlighted,
  onPress,
  accessibilityLabel,
  style,
}: {
  icon: IconName;
  label: string;
  highlighted?: boolean;
  onPress: () => void;
  accessibilityLabel?: string;
  style?: object;
}) {
  const colors = useIOSColors();
  const tint = highlighted ? colors.primary : colors.text;
  return (
    <Pressable onPress={onPress} accessibilityRole="button" accessibilityLabel={accessibilityLabel ?? label} style={style}>
      {({ pressed }) => (
        <View
          style={[
            styles.button,
            {
              backgroundColor: highlighted ? colors.infoBackground : colors.card,
              borderColor: highlighted ? colors.primary : colors.divider,
              opacity: pressed ? 0.7 : 1,
            },
          ]}
        >
          <Ionicons name={icon} size={15} color={tint} />
          <Text style={[styles.buttonText, { color: tint }]} numberOfLines={1}>
            {label}
          </Text>
          <Ionicons name="chevron-down" size={14} color={highlighted ? colors.primary : colors.textSecondary} />
        </View>
      )}
    </Pressable>
  );
}

/* Botão quadrado só com ícone, da mesma altura que os botões de filtro (ex.: Mapa). */
export function FilterIconButton({ icon, label, onPress }: { icon: IconName; label: string; onPress: () => void }) {
  const colors = useIOSColors();
  return (
    <Pressable onPress={onPress} accessibilityRole="button" accessibilityLabel={label}>
      {({ pressed }) => (
        <View style={[styles.iconButton, { backgroundColor: colors.card, borderColor: colors.divider, opacity: pressed ? 0.7 : 1 }]}>
          <Ionicons name={icon} size={17} color={colors.primary} />
        </View>
      )}
    </Pressable>
  );
}

/* Folha de baixo com uma lista de opções; a escolhida leva o visto. */
export function OptionSheet<T>({
  visible,
  title,
  options,
  value,
  onSelect,
  onClose,
}: {
  visible: boolean;
  title: string;
  options: FilterOption<T>[];
  value: T;
  onSelect: (value: T) => void;
  onClose: () => void;
}) {
  const t = useT();
  const colors = useIOSColors();
  const insets = useSafeAreaInsets();

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose} accessibilityLabel={t("Fechar")} />
      <View style={[styles.sheet, { backgroundColor: colors.card, paddingBottom: insets.bottom + 12 }]}>
        <View style={[styles.grabber, { backgroundColor: colors.textTertiary }]} />
        <View style={styles.header}>
          <Text style={[styles.title, { color: colors.text }]}>{title}</Text>
          <Pressable onPress={onClose} hitSlop={8} accessibilityRole="button" accessibilityLabel={t("Fechar")}>
            <View style={[styles.close, { backgroundColor: colors.input }]}>
              <Ionicons name="close" size={18} color={colors.text} />
            </View>
          </Pressable>
        </View>

        <ScrollView bounces={false} style={styles.options}>
          {options.map((option, index) => {
            const selected = option.value === value;
            return (
              <Pressable
                key={String(option.value)}
                onPress={() => {
                  onSelect(option.value);
                  onClose();
                }}
                accessibilityRole="button"
                accessibilityState={{ selected }}
              >
                {({ pressed }) => (
                  <View
                    style={[
                      styles.option,
                      index > 0 && { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.divider },
                      pressed && { opacity: 0.6 },
                    ]}
                  >
                    {option.icon ? (
                      <View style={[styles.optionIcon, { backgroundColor: selected ? colors.infoBackground : colors.input }]}>
                        <Ionicons name={option.icon} size={16} color={selected ? colors.primary : colors.text} />
                      </View>
                    ) : null}
                    <Text
                      style={[styles.optionText, { color: selected ? colors.primary : colors.text, fontWeight: selected ? "600" : "400" }]}
                    >
                      {option.label}
                    </Text>
                    {selected ? <Ionicons name="checkmark" size={20} color={colors.primary} /> : null}
                  </View>
                )}
              </Pressable>
            );
          })}
        </ScrollView>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  button: {
    height: 38,
    borderRadius: 12,
    borderCurve: "continuous",
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 14,
    flexDirection: "row",
    alignItems: "center",
    gap: 7,
  },
  buttonText: {
    ...Typography.footnote,
    fontWeight: "600",
    flexShrink: 1,
    flexGrow: 1,
  },
  iconButton: {
    width: 38,
    height: 38,
    borderRadius: 12,
    borderCurve: "continuous",
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: "center",
    justifyContent: "center",
  },
  backdrop: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.35)",
  },
  sheet: {
    borderTopLeftRadius: 22,
    borderTopRightRadius: 22,
    borderCurve: "continuous",
    paddingHorizontal: 20,
    paddingTop: 8,
    // Tapa a costura entre o fundo escurecido e a folha.
    marginTop: -22,
    maxHeight: "70%",
  },
  grabber: {
    alignSelf: "center",
    width: 36,
    height: 5,
    borderRadius: 3,
    marginBottom: 14,
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    marginBottom: 8,
  },
  title: {
    ...Typography.title3,
    flex: 1,
  },
  close: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: "center",
    justifyContent: "center",
  },
  options: {
    flexGrow: 0,
  },
  option: {
    minHeight: 54,
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
  },
  optionIcon: {
    width: 32,
    height: 32,
    borderRadius: 9,
    borderCurve: "continuous",
    alignItems: "center",
    justifyContent: "center",
  },
  optionText: {
    ...Typography.body,
    flex: 1,
  },
});
