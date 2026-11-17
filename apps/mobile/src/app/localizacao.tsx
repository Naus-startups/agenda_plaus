import React, { useEffect, useMemo, useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import Ionicons from "@expo/vector-icons/Ionicons";
import { useRouter } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";

import { FilledButton, useIOSColors } from "@/components/ios";
import { normalizeText, sameLocality, type LocalityDTO, type ProvinceDTO } from "@slotix/types";

import { Typography } from "@/constants/theme";
import { useSelectedLocation } from "@/contexts/LocationContext";
import { useProvinceAreas } from "@/hooks/use-province-areas";
import { countLabel, loadLocationOptions, provinciasOf, type AreaOption, type MunicipalityOption } from "@/services/localities";
import { useT } from "@/i18n";

/*
 * Ecrã que aparece logo depois de criar a conta: a pessoa indica onde quer ver espaços.
 * É essa a localização que a app passa a usar (pode ser mudada depois, ao tocar na
 * localização na Home ou no Explorar).
 *
 * Três passos no mesmo ecrã: a província (as 21 de Angola), o município dessa província
 * e, se a pessoa quiser, o bairro desse município — cada um com o número de espaços que
 * lá ficam. Em cada passo pode ficar-se pelo nível de cima ("Toda a província").
 */
type Step = "provincia" | "municipio" | "bairro";
type Item = AreaOption & { subtitle?: string; owner?: MunicipalityOption; chevron?: boolean };

export default function LocationOnboardingScreen() {
  const t = useT();
  const router = useRouter();
  const colors = useIOSColors();
  const { setArea, setProvincia: saveProvincia, chooseNearMe } = useSelectedLocation();

  const [step, setStep] = useState<Step>("provincia");
  const [provincia, setProvincia] = useState<string | null>(null);
  const [municipio, setMunicipio] = useState<MunicipalityOption | null>(null);
  const [bairro, setBairroChoice] = useState<AreaOption | null>(null);
  const [query, setQuery] = useState("");
  const [detecting, setDetecting] = useState(false);
  const [detectFailed, setDetectFailed] = useState(false);

  const [localities, setLocalities] = useState<LocalityDTO[]>([]);
  const [provinces, setProvinces] = useState<ProvinceDTO[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    loadLocationOptions()
      .then((data) => {
        if (cancelled) return;
        setLocalities(data.localities);
        setProvinces(data.provinces);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, []);

  const { municipalities, loading: loadingAreas, failed } = useProvinceAreas(provincia);
  const filtered = useMemo<Item[]>(() => {
    const target = normalizeText(query);
    const matches = (name: string) => !target || normalizeText(name).includes(target);
    if (step === "provincia") {
      return provinciasOf(localities, provinces)
        .filter((item) => matches(item.name))
        .map((item) => ({ ...item, center: null, chevron: true }));
    }
    if (step === "bairro") return (municipio?.bairros ?? []).filter((item) => matches(item.name));

    const found: Item[] = municipalities.filter((item) => matches(item.name)).map((item) => ({ ...item, chevron: item.bairros.length > 0 }));
    if (!target) return found;
    // A pesquisar, também os bairros: quem procura "Alvalade" não tem de saber o município.
    const bairros = municipalities.flatMap((owner) =>
      owner.bairros.filter((item) => matches(item.name)).map((item) => ({ ...item, owner, subtitle: owner.name })),
    );
    return [...found, ...bairros].slice(0, 80);
  }, [step, query, localities, provinces, municipalities, municipio]);
  const loadingItems = step === "provincia" ? loading : loadingAreas;

  const goTo = (next: Step) => {
    setQuery("");
    setStep(next);
  };

  const pickProvincia = (name: string) => {
    setProvincia(name);
    setMunicipio(null);
    setBairroChoice(null);
    goTo("municipio");
  };

  const pickItem = (item: Item) => {
    if (step === "provincia") return pickProvincia(item.name);
    if (step === "bairro") return setBairroChoice(item);
    if (item.owner) {
      // Um bairro encontrado na pesquisa dos municípios: escolhe os dois de uma vez.
      setMunicipio(item.owner);
      setBairroChoice(item);
      return goTo("bairro");
    }
    const chosen = municipalities.find((owner) => owner.name === item.name) ?? null;
    setMunicipio(chosen);
    setBairroChoice(null);
    if (chosen && chosen.bairros.length > 0) goTo("bairro");
  };

  const useGps = async () => {
    setDetecting(true);
    setDetectFailed(false);
    // Com a localização do telemóvel a app mostra os espaços à volta da pessoa.
    const ok = await chooseNearMe();
    setDetecting(false);

    if (ok) router.replace("/");
    else setDetectFailed(true);
  };

  const seeEverything = () => {
    saveProvincia(null);
    router.replace("/");
  };

  const finish = () => {
    if (!provincia) return;
    setArea({
      provincia,
      municipio: municipio?.name ?? null,
      bairro: bairro?.name ?? null,
      center: bairro?.center ?? municipio?.center ?? null,
    });
    router.replace("/");
  };

  const previous: Step | null = step === "bairro" ? "municipio" : step === "municipio" ? "provincia" : null;

  return (
    <SafeAreaView style={[styles.screen, { backgroundColor: colors.background }]} edges={["top", "bottom"]}>
      <View style={styles.header}>
        {previous ? (
          <Pressable onPress={() => goTo(previous)} hitSlop={10} style={styles.back} accessibilityRole="button">
            <Ionicons name="chevron-back" size={22} color={colors.primary} />
            <Text style={[styles.backText, { color: colors.primary }]}>
              {previous === "provincia" ? t("Província") : t("Município")}
            </Text>
          </Pressable>
        ) : (
          <View style={styles.back} />
        )}

        <View style={[styles.pin, { backgroundColor: colors.infoBackground }]}>
          <Ionicons name="location" size={30} color={colors.primary} />
        </View>
        <Text style={[styles.title, { color: colors.text }]}>
          {step === "provincia"
            ? t("Onde quer ver espaços?")
            : step === "municipio"
              ? t("Em que município de {0}?", [provincia])
              : t("Em que bairro de {0}?", [municipio?.name])}
        </Text>
        <Text style={[styles.subtitle, { color: colors.textSecondary }]}>
          {step === "provincia"
            ? t("Use a sua localização ou escolha uma província onde há espaços. Pode mudar isto mais tarde.")
            : step === "municipio"
              ? t("Escolha o município para ver os espaços de lá, ou veja a província toda.")
              : t("Escolha o bairro, ou fique com o município todo.")}
        </Text>
        <Text style={[styles.step, { color: colors.textTertiary }]}>
          {step === "provincia" ? t("PASSO 1 DE 3") : step === "municipio" ? t("PASSO 2 DE 3") : t("PASSO 3 DE 3")}
        </Text>
      </View>

      <View style={[styles.searchField, { backgroundColor: colors.input }]}>
        <Ionicons name="search" size={17} color={colors.textSecondary} />
        <TextInput
          value={query}
          onChangeText={setQuery}
          placeholder={
            step === "provincia" ? t("Pesquisar províncias") : step === "municipio" ? t("Município ou bairro") : t("Pesquisar bairros")
          }
          placeholderTextColor={colors.textSecondary}
          selectionColor={colors.primary}
          autoCorrect={false}
          style={[styles.searchInput, { color: colors.text }]}
        />
      </View>

      <ScrollView contentContainerStyle={styles.list} keyboardShouldPersistTaps="handled" keyboardDismissMode="on-drag">
        {step === "provincia" && !query ? (
          <>
            <View style={[styles.group, { backgroundColor: colors.card }]}>
              <Pressable onPress={useGps} disabled={detecting}>
                {({ pressed }) => (
                  <View style={[styles.row, pressed && { backgroundColor: colors.backgroundSelected }]}>
                    <Ionicons name="navigate" size={18} color={colors.primary} />
                    <Text style={[styles.rowText, { color: colors.primary }]}>{t("Usar a minha localização")}</Text>
                    {detecting ? <ActivityIndicator size="small" color={colors.textSecondary} /> : null}
                  </View>
                )}
              </Pressable>
              <View style={[styles.separator, { backgroundColor: colors.divider }]} />
              <Pressable onPress={seeEverything}>
                {({ pressed }) => (
                  <View style={[styles.row, pressed && { backgroundColor: colors.backgroundSelected }]}>
                    <Ionicons name="globe-outline" size={18} color={colors.primary} />
                    <Text style={[styles.rowText, { color: colors.primary }]}>{t("Ver todos os espaços")}</Text>
                  </View>
                )}
              </Pressable>
            </View>
            {detectFailed ? (
              <Text style={[styles.note, { color: colors.error }]}>
                {t("Sem acesso à sua localização. Autorize-a nas definições do telemóvel ou escolha uma província na lista.")}
              </Text>
            ) : null}
            <View style={styles.gap} />
          </>
        ) : null}

        <View style={[styles.group, { backgroundColor: colors.card }]}>
          {step !== "provincia" && !query ? (
            <>
              {step === "municipio" ? (
                <Option
                  label={t("Toda a província de {0}", [provincia])}
                  selected={municipio === null}
                  onPress={() => {
                    setMunicipio(null);
                    setBairroChoice(null);
                  }}
                />
              ) : (
                <Option
                  label={t("Todo o município de {0}", [municipio?.name])}
                  selected={bairro === null}
                  onPress={() => setBairroChoice(null)}
                />
              )}
              <View style={[styles.separator, { backgroundColor: colors.divider }]} />
            </>
          ) : null}
          {filtered.map((item, index) => (
            <View key={item.owner ? `${item.owner.name}/${item.name}` : item.name}>
              <Option
                label={item.name}
                detail={item.subtitle ? t("Bairro · {0}", [item.subtitle]) : countLabel(item.count)}
                selected={
                  step === "provincia"
                    ? provincia === item.name
                    : step === "bairro" || item.owner
                      ? sameLocality(bairro?.name, item.name) && sameLocality(municipio?.name, item.owner?.name ?? municipio?.name)
                      : !bairro && sameLocality(municipio?.name, item.name)
                }
                chevron={Boolean(item.chevron)}
                onPress={() => pickItem(item)}
              />
              {index < filtered.length - 1 ? (
                <View style={[styles.separator, { backgroundColor: colors.divider }]} />
              ) : null}
            </View>
          ))}
          {loadingItems && filtered.length === 0 ? (
            <View style={styles.row}>
              <ActivityIndicator size="small" color={colors.textSecondary} />
            </View>
          ) : filtered.length === 0 ? (
            <View style={styles.row}>
              <Text style={[styles.rowText, { color: colors.textSecondary }]}>
                {query
                  ? t("Sem resultados para “{0}”", [query])
                  : step === "provincia"
                    ? t("Não foi possível carregar as províncias. Verifique a ligação.")
                    : failed
                      ? t("Não foi possível carregar os municípios de {0}. Verifique a ligação.", [provincia])
                      : t("Sem bairros registados. Fique com o município todo.")}
              </Text>
            </View>
          ) : null}
        </View>
      </ScrollView>

      {step !== "provincia" ? (
        <View style={styles.footer}>
          <FilledButton title={t("Continuar")} onPress={finish} />
        </View>
      ) : null}
    </SafeAreaView>
  );
}

function Option({
  label,
  detail,
  selected,
  chevron,
  onPress,
}: {
  label: string;
  detail?: string;
  selected: boolean;
  chevron?: boolean;
  onPress: () => void;
}) {
  const colors = useIOSColors();
  return (
    <Pressable onPress={onPress} accessibilityRole="button" accessibilityState={{ selected }}>
      {({ pressed }) => (
        <View style={[styles.row, pressed && { backgroundColor: colors.backgroundSelected }]}>
          <Text style={[styles.rowText, { color: colors.text }]}>{label}</Text>
          {detail ? <Text style={[styles.rowDetail, { color: colors.textSecondary }]}>{detail}</Text> : null}
          {chevron ? (
            <Ionicons name="chevron-forward" size={17} color={colors.textTertiary} />
          ) : selected ? (
            <Ionicons name="checkmark" size={20} color={colors.primary} />
          ) : null}
        </View>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
  },
  header: {
    alignItems: "center",
    paddingHorizontal: 24,
    paddingBottom: 16,
  },
  back: {
    alignSelf: "flex-start",
    height: 40,
    marginLeft: -12,
    flexDirection: "row",
    alignItems: "center",
  },
  backText: {
    ...Typography.body,
  },
  pin: {
    width: 68,
    height: 68,
    borderRadius: 34,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 14,
  },
  title: {
    ...Typography.title1,
    textAlign: "center",
  },
  subtitle: {
    ...Typography.subheadline,
    textAlign: "center",
    marginTop: 6,
  },
  step: {
    ...Typography.caption1,
    fontWeight: "600",
    marginTop: 10,
  },
  searchField: {
    height: 36,
    marginHorizontal: 16,
    borderRadius: 10,
    borderCurve: "continuous",
    paddingHorizontal: 8,
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  searchInput: {
    ...Typography.body,
    flex: 1,
    paddingVertical: 0,
  },
  list: {
    padding: 16,
    paddingBottom: 32,
  },
  gap: {
    height: 20,
  },
  group: {
    borderRadius: 10,
    borderCurve: "continuous",
    overflow: "hidden",
  },
  row: {
    minHeight: 44,
    paddingHorizontal: 16,
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
  },
  rowText: {
    ...Typography.body,
    flex: 1,
  },
  rowDetail: {
    ...Typography.footnote,
  },
  separator: {
    height: StyleSheet.hairlineWidth,
    marginLeft: 16,
  },
  note: {
    ...Typography.footnote,
    marginHorizontal: 16,
    marginTop: 7,
  },
  footer: {
    paddingHorizontal: 16,
    paddingTop: 8,
    paddingBottom: 12,
  },
});
