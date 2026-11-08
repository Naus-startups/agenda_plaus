import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Alert,
  Animated,
  Image,
  Keyboard,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import Ionicons from "@expo/vector-icons/Ionicons";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import type { BusinessDTO, SearchResultDTO, SearchSortBy } from "@slotix/types";
import { formatDistance } from "@slotix/types";

import { DISTANCE_OPTIONS, distanceLabel } from "@/components/DistanceChips";
import { FilterButton, FilterIconButton, OptionSheet } from "@/components/FilterControls";
import { useIOSColors } from "@/components/ios";
import { Typography } from "@/constants/theme";
import { placeText } from "@/components/SpaceCards";
import { listBusinesses } from "../services/businesses";
import { search } from "../services/search";
import { clearRecentSearches, loadRecentSearches, rememberSearch } from "../services/search-history";
import { tapFeedback } from "../services/haptics";
import { useFavorites } from "../contexts/FavoritesContext";
import { useSelectedLocation } from "../contexts/LocationContext";
import { useT } from "@/i18n";

import type { TextInputInstance } from "react-native";

type Filter = "recommended" | "nearest" | "topRated" | "bestPrice";
type IconName = React.ComponentProps<typeof Ionicons>["name"];

const FILTERS: { value: Filter; label: string; icon: IconName }[] = [
  { value: "recommended", label: "Relevantes", icon: "sparkles-outline" },
  { value: "nearest", label: "Perto de mim", icon: "navigate-outline" },
  { value: "topRated", label: "Melhor avaliados", icon: "star-outline" },
  { value: "bestPrice", label: "Mais baratos", icon: "pricetag-outline" },
];

// O que se pesquisa ao tocar numa categoria; a API percebe a frase como se fosse escrita.
const CATEGORIES: { label: string; query: string; icon: IconName }[] = [
  { label: "Cabelo", query: "Corte de cabelo", icon: "cut-outline" },
  { label: "Barbearia", query: "Barbearia", icon: "man-outline" },
  { label: "Unhas", query: "Manicure", icon: "hand-left-outline" },
  { label: "Tranças", query: "Tranças", icon: "sparkles-outline" },
  { label: "Maquilhagem", query: "Maquilhagem", icon: "color-palette-outline" },
  { label: "Massagem", query: "Massagem", icon: "leaf-outline" },
  { label: "Sobrancelhas", query: "Sobrancelhas", icon: "eye-outline" },
  { label: "Depilação", query: "Depilação", icon: "flower-outline" },
];

function formatPrice(value: number): string {
  return `${value.toLocaleString("pt-AO")} Kz`;
}

/* ------------------------------------------------------------------------ */
/* Pílula de filtro                                                         */
/* ------------------------------------------------------------------------ */

function FilterPill({
  label,
  icon,
  active,
  onPress,
}: {
  label: string;
  icon?: IconName;
  active: boolean;
  onPress: () => void;
}) {
  const colors = useIOSColors();
  return (
    <Pressable onPress={onPress} accessibilityRole="button" accessibilityState={{ selected: active }}>
      {({ pressed }) => (
        <View
          style={[
            styles.pill,
            {
              backgroundColor: active ? colors.primary : colors.card,
              borderColor: active ? colors.primary : colors.divider,
              opacity: pressed ? 0.7 : 1,
            },
          ]}
        >
          {icon ? <Ionicons name={icon} size={14} color={active ? colors.primaryForeground : colors.text} /> : null}
          <Text style={[styles.pillText, { color: active ? colors.primaryForeground : colors.text }]}>{label}</Text>
        </View>
      )}
    </Pressable>
  );
}

/* ------------------------------------------------------------------------ */
/* Cartão de resultado                                                      */
/* ------------------------------------------------------------------------ */

function ResultCard({
  result,
  favorite,
  onFavorite,
  onPress,
}: {
  result: SearchResultDTO;
  favorite: boolean;
  onFavorite: () => void;
  onPress: () => void;
}) {
  const t = useT();
  const colors = useIOSColors();
  const { business, matchedService } = result;
  const image = business.logoUrl ?? business.imageUrl;
  const place = placeText(business);
  const rating = business.ratingCount > 0 ? business.ratingAvg : null;

  return (
    <Pressable onPress={onPress} accessibilityRole="button" accessibilityLabel={business.name}>
      {({ pressed }) => (
        <View
          style={[
            styles.card,
            { backgroundColor: colors.card, borderColor: colors.divider, transform: [{ scale: pressed ? 0.98 : 1 }] },
          ]}
        >
          {image ? (
            <Image source={{ uri: image }} style={styles.thumbnail} />
          ) : (
            <View style={[styles.thumbnail, styles.thumbnailEmpty, { backgroundColor: colors.input }]}>
              <Ionicons name="storefront-outline" size={24} color={colors.textSecondary} />
            </View>
          )}

          <View style={styles.cardBody}>
            <View style={styles.cardTitleRow}>
              <Text style={[styles.cardTitle, { color: colors.text }]} numberOfLines={1}>
                {business.name}
              </Text>
              <Pressable
                onPress={onFavorite}
                hitSlop={12}
                accessibilityRole="button"
                accessibilityLabel={favorite ? t("Remover dos favoritos") : t("Adicionar aos favoritos")}
              >
                <Ionicons
                  name={favorite ? "heart" : "heart-outline"}
                  size={20}
                  color={favorite ? colors.error : colors.textTertiary}
                />
              </Pressable>
            </View>

            <View style={styles.metaRow}>
              {rating !== null ? (
                <View style={styles.metaItem}>
                  <Ionicons name="star" size={12} color={colors.warning} />
                  <Text style={[styles.metaStrong, { color: colors.text }]}>{rating.toFixed(1)}</Text>
                  <Text style={[styles.metaText, { color: colors.textSecondary }]}>({business.ratingCount})</Text>
                </View>
              ) : (
                <Text style={[styles.metaText, { color: colors.primary }]}>{t("Novo")}</Text>
              )}
              {business.distanceKm !== null ? (
                <View style={styles.metaItem}>
                  <Ionicons name="navigate" size={11} color={colors.textSecondary} />
                  <Text style={[styles.metaText, { color: colors.textSecondary }]}>{formatDistance(business.distanceKm)}</Text>
                </View>
              ) : null}
              {business.category ? (
                <Text style={[styles.metaText, { color: colors.textSecondary, flexShrink: 1 }]} numberOfLines={1}>
                  {t(business.category)}
                </Text>
              ) : null}
            </View>

            {place ? (
              <View style={styles.metaItem}>
                <Ionicons name="location-outline" size={12} color={colors.textSecondary} />
                <Text style={[styles.metaText, { color: colors.textSecondary, flex: 1 }]} numberOfLines={1}>
                  {place}
                </Text>
              </View>
            ) : null}

            {matchedService ? (
              <View style={[styles.servicePill, { backgroundColor: colors.infoBackground }]}>
                <Text style={[styles.serviceName, { color: colors.primary }]} numberOfLines={1}>
                  {matchedService.name}
                </Text>
                <Text style={[styles.servicePrice, { color: colors.primary }]}>
                  {t("desde {0}", [formatPrice(matchedService.price)])}
                </Text>
              </View>
            ) : null}
          </View>
        </View>
      )}
    </Pressable>
  );
}

function SkeletonCard() {
  const colors = useIOSColors();
  const [pulse] = useState(() => new Animated.Value(0.5));

  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, { toValue: 1, duration: 700, useNativeDriver: true }),
        Animated.timing(pulse, { toValue: 0.5, duration: 700, useNativeDriver: true }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [pulse]);

  return (
    <Animated.View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.divider, opacity: pulse }]}>
      <View style={[styles.thumbnail, { backgroundColor: colors.input }]} />
      <View style={[styles.cardBody, { gap: 8 }]}>
        <View style={[styles.skeletonLine, { width: "70%", backgroundColor: colors.input }]} />
        <View style={[styles.skeletonLine, { width: "45%", backgroundColor: colors.input }]} />
        <View style={[styles.skeletonLine, { width: "60%", height: 22, backgroundColor: colors.input }]} />
      </View>
    </Animated.View>
  );
}

function SectionTitle({ title, action, onAction }: { title: string; action?: string; onAction?: () => void }) {
  const colors = useIOSColors();
  return (
    <View style={styles.sectionTitleRow}>
      <Text style={[styles.sectionTitle, { color: colors.text }]}>{title}</Text>
      {action && onAction ? (
        <Pressable onPress={onAction} hitSlop={8} accessibilityRole="button">
          <Text style={[styles.sectionAction, { color: colors.primary }]}>{action}</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

/* ------------------------------------------------------------------------ */
/* Ecrã                                                                     */
/* ------------------------------------------------------------------------ */

export default function SearchScreen() {
  const t = useT();
  const router = useRouter();
  const colors = useIOSColors();
  const inputRef = useRef<TextInputInstance>(null);
  const { isFavorite, toggleFavorite } = useFavorites();

  const [query, setQuery] = useState("");
  const [debouncedQuery, setDebouncedQuery] = useState("");
  const [filter, setFilter] = useState<Filter>("recommended");
  // null = qualquer distância; senão só os espaços até esses km de onde a pessoa está.
  const [radiusKm, setRadiusKm] = useState<number | null>(null);
  const [allResults, setResults] = useState<SearchResultDTO[]>([]);
  const [loading, setLoading] = useState(false);
  const [focused, setFocused] = useState(false);
  const [recent, setRecent] = useState<string[]>([]);
  const [sheet, setSheet] = useState<"sort" | "distance" | null>(null);
  const { coordinates: myPosition, requestPosition } = useSelectedLocation();

  useEffect(() => {
    void loadRecentSearches().then(setRecent);
  }, []);

  // A pesquisa procura à volta da pessoa, não numa província: com distância escolhida,
  // ficam só os espaços com o ponto marcado dentro desse raio.
  const results = useMemo(
    () =>
      radiusKm === null
        ? allResults
        : allResults.filter((result) => result.business.distanceKm !== null && result.business.distanceKm <= radiusKm),
    [allResults, radiusKm],
  );

  useEffect(() => {
    const timer = setTimeout(() => setDebouncedQuery(query.trim()), 300);
    return () => clearTimeout(timer);
  }, [query]);

  // A localização só é pedida quando é precisa: em "Perto de mim" ou ao escolher uma distância.
  const needPosition = useCallback(async () => {
    if (myPosition ?? (await requestPosition())) return true;
    Alert.alert(t("Sem acesso à localização"), t("Autorize a localização para procurar espaços perto de si."));
    return false;
  }, [myPosition, requestPosition]);

  const selectFilter = useCallback(
    async (next: Filter) => {
      tapFeedback();
      if (next === "nearest" && !(await needPosition())) return;
      setFilter(next);
    },
    [needPosition],
  );

  const selectRadius = useCallback(
    async (next: number | null) => {
      tapFeedback();
      if (next !== null && !(await needPosition())) return;
      setRadiusKm(next);
    },
    [needPosition],
  );

  const hasQuery = debouncedQuery.length > 0;
  // Sem texto mas com distância, a pesquisa lista tudo o que há nesse raio.
  const browsing = !hasQuery && radiusKm !== null && myPosition !== null;
  const latitude = myPosition?.latitude;
  const longitude = myPosition?.longitude;

  useEffect(() => {
    if (!hasQuery && !browsing) {
      setResults([]);
      setLoading(false);
      return;
    }

    let cancelled = false;
    setLoading(true);

    const request = hasQuery
      ? search({ q: debouncedQuery, sortBy: filter as SearchSortBy, latitude, longitude, limit: 100 })
      : listBusinesses({
          latitude,
          longitude,
          radiusKm: radiusKm ?? undefined,
          // "Mais baratos" depende de um serviço procurado; sem texto, vale a ordem por distância.
          sortBy: filter === "topRated" ? "topRated" : filter === "recommended" ? "recommended" : "nearest",
          limit: 100,
        }).then((response) => ({ data: response.data.map((business) => ({ business, matchedService: null })) }));

    request
      .then((response) => {
        if (!cancelled) setResults(response.data);
      })
      .catch(() => {
        if (!cancelled) setResults([]);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [debouncedQuery, filter, hasQuery, browsing, radiusKm, latitude, longitude]);

  const remember = (value: string) => {
    const trimmed = value.trim();
    if (trimmed.length >= 2) void rememberSearch(trimmed, recent).then(setRecent);
  };

  const runQuery = (value: string) => {
    tapFeedback();
    setQuery(value);
    setDebouncedQuery(value);
    Keyboard.dismiss();
  };

  const openSpace = (business: BusinessDTO) => {
    Keyboard.dismiss();
    if (hasQuery) remember(debouncedQuery);
    router.push({ pathname: "/space", params: { businessId: business.id } } as never);
  };

  const openMap = () => {
    Keyboard.dismiss();
    router.push({ pathname: "/mapa", params: radiusKm !== null ? { radiusKm: String(radiusKm) } : {} } as never);
  };

  // Sair da pesquisa: volta ao ecrã anterior, ou ao Início se a pesquisa foi aberta diretamente.
  const exit = () => {
    Keyboard.dismiss();
    if (router.canGoBack()) router.back();
    else router.replace("/");
  };

  const showingResults = hasQuery || browsing;
  const typing = query.trim() !== debouncedQuery;

  return (
    <View style={[styles.flex, { backgroundColor: colors.background }]}>
      <SafeAreaView style={styles.flex} edges={["top"]}>
        {/* Cabeçalho: voltar + campo de pesquisa */}
        <View style={styles.header}>
          <Pressable onPress={exit} hitSlop={10} accessibilityRole="button" accessibilityLabel={t("Fechar pesquisa")}>
            {({ pressed }) => (
              <View style={[styles.iconButton, { backgroundColor: colors.card, borderColor: colors.divider, opacity: pressed ? 0.6 : 1 }]}>
                <Ionicons name="chevron-back" size={20} color={colors.text} />
              </View>
            )}
          </Pressable>

          <View
            style={[
              styles.searchField,
              { backgroundColor: colors.card, borderColor: focused ? colors.primary : colors.divider },
            ]}
          >
            <Ionicons name="search" size={18} color={focused ? colors.primary : colors.textSecondary} />
            <TextInput
              ref={inputRef}
              value={query}
              onChangeText={setQuery}
              onFocus={() => setFocused(true)}
              onBlur={() => setFocused(false)}
              onSubmitEditing={() => {
                setDebouncedQuery(query.trim());
                remember(query);
              }}
              autoFocus
              placeholder={t("Do que precisa? Ex.: cortar o cabelo")}
              placeholderTextColor={colors.textSecondary}
              selectionColor={colors.primary}
              returnKeyType="search"
              autoCorrect={false}
              style={[styles.searchInput, { color: colors.text }]}
            />
            {query.length > 0 ? (
              <Pressable
                onPress={() => {
                  setQuery("");
                  inputRef.current?.focus();
                }}
                hitSlop={10}
                accessibilityLabel={t("Limpar pesquisa")}
              >
                <Ionicons name="close-circle" size={18} color={colors.textTertiary} />
              </Pressable>
            ) : null}
          </View>
        </View>

        {/* Filtros numa só linha, alinhados: ordem, distância e mapa */}
        <View style={styles.toolbar}>
          <FilterButton
            icon="swap-vertical"
            label={t(FILTERS.find((option) => option.value === filter)?.label ?? "")}
            highlighted={filter !== "recommended"}
            accessibilityLabel={t("Ordenar")}
            onPress={() => setSheet("sort")}
            style={styles.flex}
          />
          <FilterButton
            icon="navigate-outline"
            label={distanceLabel(radiusKm)}
            highlighted={radiusKm !== null}
            accessibilityLabel={t("Distância")}
            onPress={() => setSheet("distance")}
            style={styles.flex}
          />
          <FilterIconButton icon="map-outline" label={t("Ver os espaços no mapa")} onPress={openMap} />
        </View>

        <OptionSheet
          visible={sheet === "sort"}
          title={t("Ordenar por")}
          options={FILTERS.map((option) => ({ ...option, label: t(option.label) }))}
          value={filter}
          onSelect={(next) => void selectFilter(next)}
          onClose={() => setSheet(null)}
        />
        <OptionSheet
          visible={sheet === "distance"}
          title={t("Distância")}
          options={DISTANCE_OPTIONS.map((option) => ({
            value: option,
            label: option === null ? distanceLabel(null) : t("Até {0} km de si", [option]),
            icon: option === null ? ("globe-outline" as const) : ("navigate-outline" as const),
          }))}
          value={radiusKm}
          onSelect={(next) => void selectRadius(next)}
          onClose={() => setSheet(null)}
        />

        <View style={[styles.headerRule, { backgroundColor: colors.divider }]} />

        <ScrollView
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="on-drag"
          showsVerticalScrollIndicator={false}
          contentContainerStyle={styles.content}
        >
          {!showingResults ? (
            <>
              <View style={[styles.hint, { backgroundColor: colors.infoBackground }]}>
                <Ionicons name="chatbubble-ellipses-outline" size={20} color={colors.primary} />
                <View style={styles.flex}>
                  <Text style={[styles.hintTitle, { color: colors.text }]}>{t("Escreva o que precisa")}</Text>
                  <Text style={[styles.hintText, { color: colors.textSecondary }]}>
                    {t("Ex.: “quero cortar o cabelo” ou “fazer as unhas em Talatona”. Mostramos os espaços que fazem esse serviço.")}
                  </Text>
                </View>
              </View>

              {recent.length > 0 ? (
                <>
                  <SectionTitle
                    title={t("Pesquisas recentes")}
                    action={t("Limpar")}
                    onAction={() => {
                      setRecent([]);
                      void clearRecentSearches();
                    }}
                  />
                  <View style={styles.recentList}>
                    {recent.map((item) => (
                      <Pressable key={item} onPress={() => runQuery(item)} accessibilityRole="button">
                        {({ pressed }) => (
                          <View style={[styles.recentRow, { opacity: pressed ? 0.6 : 1 }]}>
                            <Ionicons name="time-outline" size={18} color={colors.textSecondary} />
                            <Text style={[styles.recentText, { color: colors.text }]} numberOfLines={1}>
                              {item}
                            </Text>
                            <Ionicons name="arrow-up-outline" size={16} color={colors.textTertiary} style={styles.fillArrow} />
                          </View>
                        )}
                      </Pressable>
                    ))}
                  </View>
                </>
              ) : null}

              <SectionTitle title={t("Categorias")} />
              <View style={styles.grid}>
                {CATEGORIES.map((category) => (
                  <Pressable
                    key={category.label}
                    onPress={() => runQuery(category.query)}
                    accessibilityRole="button"
                    style={styles.gridItem}
                  >
                    {({ pressed }) => (
                      <View
                        style={[
                          styles.categoryTile,
                          { backgroundColor: colors.card, borderColor: colors.divider, transform: [{ scale: pressed ? 0.97 : 1 }] },
                        ]}
                      >
                        <View style={[styles.categoryIcon, { backgroundColor: colors.infoBackground }]}>
                          <Ionicons name={category.icon} size={18} color={colors.primary} />
                        </View>
                        <Text style={[styles.categoryLabel, { color: colors.text }]} numberOfLines={1}>
                          {t(category.label)}
                        </Text>
                      </View>
                    )}
                  </Pressable>
                ))}
              </View>
            </>
          ) : loading || (typing && allResults.length === 0) ? (
            <View style={styles.list}>
              {[0, 1, 2, 3].map((index) => (
                <SkeletonCard key={index} />
              ))}
            </View>
          ) : results.length === 0 ? (
            <View style={styles.state}>
              <View style={[styles.stateIcon, { backgroundColor: colors.input }]}>
                <Ionicons name="search" size={30} color={colors.textSecondary} />
              </View>
              <Text style={[styles.stateTitle, { color: colors.text }]}>{t("Sem resultados")}</Text>
              <Text style={[styles.stateText, { color: colors.textSecondary }]}>
                {hasQuery
                  ? t("Não encontrámos nada para “{0}”{1}. Tente outra palavra{2}.", [debouncedQuery, radiusKm !== null ? t(" a menos de {0} km de si", [radiusKm]) : "", radiusKm !== null ? t(" ou aumente a distância") : ""])
                  : t("Não há espaços a menos de {0} km de si. Aumente a distância.", [radiusKm])}
              </Text>
              <View style={styles.stateSuggestions}>
                {CATEGORIES.slice(0, 4).map((category) => (
                  <FilterPill
                    key={category.label}
                    label={t(category.label)}
                    icon={category.icon}
                    active={false}
                    onPress={() => runQuery(category.query)}
                  />
                ))}
              </View>
            </View>
          ) : (
            <>
              <Text style={[styles.resultsCount, { color: colors.textSecondary }]}>
                {hasQuery
                  ? results.length === 1
                    ? t("1 espaço para “{0}”", [debouncedQuery])
                    : t("{0} espaços para “{1}”", [results.length, debouncedQuery])
                  : results.length === 1
                    ? t("1 espaço perto de si")
                    : t("{0} espaços perto de si", [results.length])}
              </Text>
              <View style={styles.list}>
                {results.map((result) => (
                  <ResultCard
                    key={result.business.id}
                    result={result}
                    favorite={isFavorite(result.business.id)}
                    onFavorite={() => {
                      tapFeedback();
                      void toggleFavorite(result.business.id);
                    }}
                    onPress={() => openSpace(result.business)}
                  />
                ))}
              </View>
            </>
          )}
        </ScrollView>
      </SafeAreaView>
    </View>
  );
}

const styles = StyleSheet.create({
  flex: {
    flex: 1,
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingHorizontal: 16,
    paddingTop: 8,
    paddingBottom: 12,
  },
  iconButton: {
    width: 44,
    height: 44,
    borderRadius: 22,
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: "center",
    justifyContent: "center",
  },
  searchField: {
    flex: 1,
    height: 46,
    borderRadius: 14,
    borderCurve: "continuous",
    borderWidth: 1,
    paddingHorizontal: 12,
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    shadowColor: "#000000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.06,
    shadowRadius: 8,
    elevation: 1,
  },
  searchInput: {
    ...Typography.callout,
    flex: 1,
    paddingVertical: 0,
  },
  toolbar: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingHorizontal: 16,
    paddingBottom: 12,
  },
  pill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 13,
    height: 34,
    borderRadius: 999,
    borderWidth: StyleSheet.hairlineWidth,
  },
  pillText: {
    ...Typography.footnote,
    fontWeight: "600",
  },
  headerRule: {
    height: StyleSheet.hairlineWidth,
  },
  content: {
    paddingHorizontal: 16,
    paddingTop: 16,
    paddingBottom: 140,
  },
  hint: {
    flexDirection: "row",
    gap: 12,
    padding: 14,
    borderRadius: 16,
    borderCurve: "continuous",
    marginBottom: 24,
  },
  hintTitle: {
    ...Typography.subheadline,
    fontWeight: "600",
    marginBottom: 2,
  },
  hintText: {
    ...Typography.footnote,
  },
  sectionTitleRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 10,
  },
  sectionTitle: {
    ...Typography.headline,
  },
  sectionAction: {
    ...Typography.subheadline,
    fontWeight: "500",
  },
  recentList: {
    marginBottom: 24,
  },
  recentRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    minHeight: 44,
  },
  recentText: {
    ...Typography.body,
    flex: 1,
  },
  fillArrow: {
    transform: [{ rotate: "-45deg" }],
  },
  grid: {
    flexDirection: "row",
    flexWrap: "wrap",
    marginHorizontal: -5,
  },
  gridItem: {
    width: "50%",
    padding: 5,
  },
  categoryTile: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    padding: 12,
    borderRadius: 14,
    borderCurve: "continuous",
    borderWidth: StyleSheet.hairlineWidth,
  },
  categoryIcon: {
    width: 34,
    height: 34,
    borderRadius: 10,
    borderCurve: "continuous",
    alignItems: "center",
    justifyContent: "center",
  },
  categoryLabel: {
    ...Typography.subheadline,
    fontWeight: "600",
    flex: 1,
  },
  resultsCount: {
    ...Typography.footnote,
    fontWeight: "500",
    marginBottom: 10,
  },
  list: {
    gap: 10,
  },
  card: {
    flexDirection: "row",
    gap: 12,
    padding: 12,
    borderRadius: 16,
    borderCurve: "continuous",
    borderWidth: StyleSheet.hairlineWidth,
  },
  thumbnail: {
    width: 76,
    height: 76,
    borderRadius: 12,
    borderCurve: "continuous",
  },
  thumbnailEmpty: {
    alignItems: "center",
    justifyContent: "center",
  },
  cardBody: {
    flex: 1,
    gap: 4,
    justifyContent: "center",
  },
  cardTitleRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  cardTitle: {
    ...Typography.headline,
    flex: 1,
  },
  metaRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  metaItem: {
    flexDirection: "row",
    alignItems: "center",
    gap: 3,
  },
  metaStrong: {
    ...Typography.footnote,
    fontWeight: "600",
  },
  metaText: {
    ...Typography.footnote,
  },
  servicePill: {
    flexDirection: "row",
    alignItems: "center",
    alignSelf: "flex-start",
    maxWidth: "100%",
    gap: 6,
    marginTop: 2,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 8,
    borderCurve: "continuous",
  },
  serviceName: {
    ...Typography.caption1,
    fontWeight: "600",
    flexShrink: 1,
  },
  servicePrice: {
    ...Typography.caption1,
  },
  skeletonLine: {
    height: 12,
    borderRadius: 6,
  },
  state: {
    alignItems: "center",
    paddingTop: 48,
    paddingHorizontal: 16,
    gap: 8,
  },
  stateIcon: {
    width: 64,
    height: 64,
    borderRadius: 32,
    alignItems: "center",
    justifyContent: "center",
  },
  stateTitle: {
    ...Typography.title3,
    marginTop: 8,
  },
  stateText: {
    ...Typography.subheadline,
    textAlign: "center",
  },
  stateSuggestions: {
    flexDirection: "row",
    flexWrap: "wrap",
    justifyContent: "center",
    gap: 8,
    marginTop: 16,
  },
});
