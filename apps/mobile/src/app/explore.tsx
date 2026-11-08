import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  Animated,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
} from "react-native";
import { Image } from "expo-image";
import Ionicons from "@expo/vector-icons/Ionicons";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import type { BusinessDTO, BusinessSortBy } from "@slotix/types";

import { NotificationBell, Skeleton } from "@/components/HomeWidgets";
import { useIOSColors } from "@/components/ios";
import { FilterButton, OptionSheet } from "@/components/FilterControls";
import { CircleButton, Reveal } from "@/components/ScreenChrome";
import { HeroSpaceCard, SectionTitle, SpaceListCard, SpaceTile } from "@/components/SpaceCards";
import { CATEGORY_FILTERS as CATEGORIES } from "@/constants/categories";
import { Typography } from "@/constants/theme";
import { tapFeedback } from "@/services/haptics";
import { useFavorites } from "../contexts/FavoritesContext";
import { NEAR_ME_RADIUS_KM, useSelectedLocation } from "../contexts/LocationContext";
import { listBusinesses } from "../services/businesses";
import { useT } from "@/i18n";

import type { ScrollViewInstance } from "react-native";
type SortMode = Extract<BusinessSortBy, "recommended" | "nearest" | "topRated">;
type IconName = React.ComponentProps<typeof Ionicons>["name"];

const SORTS: { value: SortMode; label: string; icon: IconName }[] = [
  { value: "recommended", label: "Recomendados", icon: "sparkles-outline" },
  { value: "nearest", label: "Perto de mim", icon: "navigate-outline" },
  // A avaliação são as estrelas: primeiro os espaços com a melhor média.
  { value: "topRated", label: "Melhor avaliados", icon: "star-outline" },
];

/* Lugar guardado para os resultados enquanto chegam: destaque e algumas linhas. */
function ResultsSkeleton({ width }: { width: number }) {
  return (
    <View style={styles.skeleton}>
      <Skeleton width={width} height={width * 0.78} radius={22} />
      <Skeleton width={120} height={22} radius={8} />
      {[0, 1, 2].map((key) => (
        <View key={key} style={styles.skeletonRow}>
          <Skeleton width={64} height={64} radius={14} />
          <View style={styles.skeletonText}>
            <Skeleton width="70%" height={16} radius={6} />
            <Skeleton width="45%" height={13} radius={6} />
          </View>
        </View>
      ))}
    </View>
  );
}

export default function ExploreScreen() {
  const t = useT();
  const router = useRouter();
  const colors = useIOSColors();
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const params = useLocalSearchParams<{ category?: string; sort?: string }>();
  const { isFavorite, toggleFavorite } = useFavorites();
  const { coordinates: myPosition, requestPosition } = useSelectedLocation();

  // Uma categoria escolhida na Home chega como parâmetro, e já conta no primeiro pedido.
  const [category, setCategory] = useState(() =>
    params.category && CATEGORIES.some((item) => item.name === params.category) ? params.category : "Todos",
  );
  const [sortMode, setSortMode] = useState<SortMode>(() => (params.sort === "nearest" ? "nearest" : "recommended"));
  const [results, setResults] = useState<BusinessDTO[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [sortSheet, setSortSheet] = useState(false);
  // Onde começa o bloco dos filtros na página: a partir daí ficam presos no topo.
  const [filtersY, setFiltersY] = useState(0);

  const scrollRef = useRef<ScrollViewInstance>(null);
  const chipsRef = useRef<ScrollViewInstance>(null);
  const scrollY = useRef(new Animated.Value(0)).current;
  const scrollOffset = useRef(0);
  // Onde está cada categoria na fila (para a manter à vista).
  const chipX = useRef<Record<string, number>>({});
  // Só a resposta do pedido mais recente conta: uma mais lenta, de outra categoria, não
  // pode vir depois pôr espaços que não são da categoria escolhida.
  const latestRequest = useRef(0);

  // O ecrã pode já estar aberto quando se escolhe outra categoria na Home.
  useEffect(() => {
    if (params.category && CATEGORIES.some((item) => item.name === params.category)) setCategory(params.category);
  }, [params.category]);

  useEffect(() => {
    if (params.sort === "nearest") setSortMode("nearest");
  }, [params.sort]);

  // A categoria escolhida fica sempre à vista na fila, mesmo quando vem da Home.
  useEffect(() => {
    const x = chipX.current[category];
    if (x !== undefined) chipsRef.current?.scrollTo({ x: Math.max(x - 16, 0), animated: true });
  }, [category]);

  // A posição vem do contexto, que segue a pessoa enquanto se desloca. Arredondada (~100 m)
  // para não repetir o pedido a cada pequena leitura do GPS.
  const latitude = myPosition ? Number(myPosition.latitude.toFixed(3)) : null;
  const longitude = myPosition ? Number(myPosition.longitude.toFixed(3)) : null;
  const nearest = sortMode === "nearest";

  const load = useCallback(async () => {
    const request = ++latestRequest.current;
    // "Perto" sem posição não tem espaços para mostrar.
    if (nearest && (latitude === null || longitude === null)) {
      setResults([]);
      setLoading(false);
      return;
    }
    try {
      // A posição da pessoa dá a distância até cada espaço em qualquer filtro; em "Perto"
      // ficam só os espaços até NEAR_ME_RADIUS_KM de onde ela está, dos mais próximos primeiro.
      const data = await listBusinesses({
        category: category !== "Todos" ? category : undefined,
        latitude: latitude ?? undefined,
        longitude: longitude ?? undefined,
        radiusKm: nearest ? NEAR_ME_RADIUS_KM : undefined,
        sortBy: sortMode,
        limit: 50,
      });
      if (request === latestRequest.current) setResults(data.data);
    } catch {
      if (request === latestRequest.current) setResults([]);
    } finally {
      if (request === latestRequest.current) setLoading(false);
    }
  }, [category, latitude, longitude, nearest, sortMode]);

  useEffect(() => {
    setLoading(true);
    void load();
  }, [load]);

  const refresh = async () => {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  };

  // Ao mudar de filtro com a página já em baixo, volta ao início dos resultados (com os
  // filtros ainda presos no topo), para a pessoa ver logo o que mudou.
  const backToResults = () => {
    if (scrollOffset.current > filtersY) {
      scrollRef.current?.scrollTo({ y: filtersY, animated: true });
    }
  };

  const selectCategory = (name: string) => {
    if (name === category) return;
    tapFeedback();
    backToResults();
    setCategory(name);
  };

  const selectSort = async (mode: SortMode) => {
    if (mode === sortMode) return;
    tapFeedback();
    if (mode === "nearest" && !myPosition && !(await requestPosition())) return;
    backToResults();
    setSortMode(mode);
  };

  // Um espaço sem ponto marcado no mapa não tem distância: não entra em "Perto".
  const spaces = nearest
    ? results.filter((space) => space.distanceKm !== null && space.distanceKm <= NEAR_ME_RADIUS_KM)
    : results;
  const browsing = category === "Todos" && sortMode === "recommended";
  // "Escolha do dia" e "Em alta" são só espaços que alguém pôs nos favoritos — a API já os
  // devolve primeiro, dos mais favoritos para os menos. Sem favoritos, ficam só na lista.
  const favorited = browsing ? spaces.filter((space) => space.favoriteCount > 0) : [];
  const featured = favorited[0];
  const trending = favorited.slice(1, 7);
  const list = browsing ? spaces.filter((space) => space !== featured && !trending.includes(space)) : spaces;

  const openSpace = (space: BusinessDTO) =>
    router.push({ pathname: "/space", params: { businessId: space.id } } as never);

  // A linha fina por baixo dos filtros só aparece quando estão presos sobre a lista.
  const filtersBorder = scrollY.interpolate({
    inputRange: [Math.max(filtersY - 1, 0), filtersY + 12],
    outputRange: [0, 1],
    extrapolate: "clamp",
  });

  // O que fazer quando não há resultados: ligar a localização ou voltar a todas as categorias.
  const emptyAction =
    nearest && !myPosition
      ? { label: t("Ativar"), icon: "navigate" as IconName, onPress: () => void requestPosition() }
      : category !== "Todos"
        ? { label: t("Ver tudo"), icon: "apps" as IconName, onPress: () => selectCategory("Todos") }
        : null;

  return (
    <View style={[styles.screen, { backgroundColor: colors.background, paddingTop: insets.top }]}>
      <Animated.ScrollView
        ref={scrollRef}
        showsVerticalScrollIndicator={false}
        contentContainerStyle={styles.content}
        stickyHeaderIndices={[1]}
        onScroll={Animated.event([{ nativeEvent: { contentOffset: { y: scrollY } } }], {
          useNativeDriver: true,
          listener: (event: { nativeEvent: { contentOffset: { y: number } } }) => {
            scrollOffset.current = event.nativeEvent.contentOffset.y;
          },
        })}
        scrollEventThrottle={16}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refresh} tintColor={colors.textSecondary} />}
      >
        {/* Pesquisa, mapa e avisos numa só linha */}
        <View style={styles.searchRow}>
          <Pressable onPress={() => router.push("/search")} style={styles.flex} accessibilityRole="search">
            {({ pressed }) => (
              <View style={[styles.searchBar, { backgroundColor: colors.input, opacity: pressed ? 0.7 : 1 }]}>
                <Ionicons name="search" size={18} color={colors.textSecondary} />
                <Text style={[styles.searchPlaceholder, { color: colors.textSecondary }]} numberOfLines={1}>
                  {t("Espaços, serviços ou bairros")}
                </Text>
              </View>
            )}
          </Pressable>
          {/* Abre o mapa com todos os espaços registados */}
          <CircleButton icon="map" tint={colors.primary} label={t("Ver os espaços no mapa")} onPress={() => router.push("/mapa" as never)} />
          {/* O mesmo sino do Início, com o número real de avisos por ler */}
          <NotificationBell />
        </View>

        {/* Filtros: ficam presos no topo enquanto a lista desliza */}
        <View
          style={[styles.filters, { backgroundColor: colors.background }]}
          onLayout={(event) => setFiltersY(event.nativeEvent.layout.y)}
        >
          <ScrollView
            ref={chipsRef}
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.chips}
            style={styles.chipsScroll}
          >
            {CATEGORIES.map((item) => {
              const active = item.name === category;
              return (
                <Pressable
                  key={item.name}
                  onPress={() => selectCategory(item.name)}
                  onLayout={(event) => (chipX.current[item.name] = event.nativeEvent.layout.x)}
                  accessibilityRole="button"
                  accessibilityState={{ selected: active }}
                >
                  {({ pressed }) => (
                    <View
                      style={[
                        styles.chip,
                        {
                          backgroundColor: active ? colors.primary : colors.card,
                          borderColor: active ? colors.primary : colors.divider,
                          transform: [{ scale: pressed ? 0.95 : 1 }],
                        },
                      ]}
                    >
                      <Image source={item.image} style={styles.chipImage} contentFit="cover" />
                      <Text style={[styles.chipText, { color: active ? colors.primaryForeground : colors.text }]}>{t(item.name)}</Text>
                    </View>
                  )}
                </Pressable>
              );
            })}
          </ScrollView>

          {/* Quantos espaços há e como estão ordenados, numa linha direita */}
          <View style={styles.toolbar}>
            <Text style={[styles.toolbarTitle, { color: colors.text }]} numberOfLines={1}>
              {loading
                ? t(category === "Todos" ? "Todos os espaços" : category)
                : spaces.length === 1
                  ? t("1 espaço")
                  : t("{0} espaços", [spaces.length])}
            </Text>
            <FilterButton
              icon="swap-vertical"
              label={t(SORTS.find((sort) => sort.value === sortMode)?.label ?? "")}
              highlighted={sortMode !== "recommended"}
              accessibilityLabel={t("Ordenar")}
              onPress={() => setSortSheet(true)}
            />
          </View>

          <Animated.View style={[styles.filtersBorder, { backgroundColor: colors.divider, opacity: filtersBorder }]} />
        </View>

        {/* Resultados; a chave muda com o filtro para a entrada animada se repetir */}
        <View key={`${category}-${sortMode}`} style={styles.results}>
          {loading ? (
            <ResultsSkeleton width={width - 32} />
          ) : spaces.length === 0 ? (
            <Reveal index={0}>
              <View style={styles.state}>
                <View style={[styles.stateIcon, { backgroundColor: colors.card }]}>
                  <Ionicons name={nearest ? "navigate" : "compass"} size={32} color={colors.textTertiary} />
                </View>
                <Text style={[styles.stateTitle, { color: colors.text }]}>{t("Nenhum espaço encontrado")}</Text>
                <Text style={[styles.stateText, { color: colors.textSecondary }]}>
                  {nearest
                    ? myPosition
                      ? t("Ainda não há espaços a menos de {0} km de si.", [NEAR_ME_RADIUS_KM])
                      : t("Ative a localização para ver os espaços perto de si.")
                    : t("Experimente outra categoria.")}
                </Text>
                {emptyAction ? (
                  <Pressable onPress={emptyAction.onPress} accessibilityRole="button">
                    {({ pressed }) => (
                      <View style={[styles.stateButton, { backgroundColor: colors.primary, opacity: pressed ? 0.85 : 1 }]}>
                        <Ionicons name={emptyAction.icon} size={17} color="#FFFFFF" />
                        <Text style={styles.stateButtonText}>{emptyAction.label}</Text>
                      </View>
                    )}
                  </Pressable>
                ) : null}
              </View>
            </Reveal>
          ) : (
            <>
              {featured ? (
                <Reveal index={0}>
                  <View style={styles.section}>
                    <HeroSpaceCard
                      space={featured}
                      width={width - 32}
                      height={(width - 32) * 0.78}
                      eyebrow={t("Escolha do dia")}
                      favorite={isFavorite(featured.id)}
                      onFavorite={() => void toggleFavorite(featured.id)}
                      onPress={() => openSpace(featured)}
                    />
                  </View>
                </Reveal>
              ) : null}

              {trending.length > 0 ? (
                <Reveal index={1}>
                  <View style={styles.section}>
                    <SectionTitle title={t("Em alta")} />
                    <ScrollView
                      horizontal
                      showsHorizontalScrollIndicator={false}
                      style={styles.bleed}
                      contentContainerStyle={styles.tiles}
                      snapToInterval={194}
                      decelerationRate="fast"
                    >
                      {trending.map((space) => (
                        <SpaceTile
                          key={space.id}
                          space={space}
                          width={180}
                          favorite={isFavorite(space.id)}
                          onFavorite={() => void toggleFavorite(space.id)}
                          onPress={() => openSpace(space)}
                        />
                      ))}
                    </ScrollView>
                  </View>
                </Reveal>
              ) : null}

              {list.length > 0 ? (
                <Reveal index={2}>
                  <View style={styles.section}>
                    {browsing && (featured || trending.length > 0) ? <SectionTitle title={t("Todos os espaços")} /> : null}
                    <View style={styles.cards}>
                      {list.map((space) => (
                        <SpaceListCard
                          key={space.id}
                          space={space}
                          favorite={isFavorite(space.id)}
                          onFavorite={() => void toggleFavorite(space.id)}
                          onPress={() => openSpace(space)}
                        />
                      ))}
                    </View>
                  </View>
                </Reveal>
              ) : null}
            </>
          )}
        </View>
      </Animated.ScrollView>

      <OptionSheet
        visible={sortSheet}
        title={t("Ordenar por")}
        options={SORTS.map((sort) => ({ ...sort, label: t(sort.label) }))}
        value={sortMode}
        onSelect={(mode) => void selectSort(mode)}
        onClose={() => setSortSheet(false)}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
  },
  content: {
    paddingHorizontal: 16,
    paddingBottom: 140,
  },
  flex: {
    flex: 1,
  },
  searchRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingTop: 20,
    paddingBottom: 8,
  },
  searchBar: {
    height: 40,
    borderRadius: 12,
    borderCurve: "continuous",
    paddingHorizontal: 10,
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  searchPlaceholder: {
    ...Typography.body,
    flex: 1,
  },
  // O bloco preso estende-se até às bordas do ecrã, para tapar a lista que passa por baixo.
  filters: {
    marginHorizontal: -16,
    paddingHorizontal: 16,
    paddingTop: 12,
    paddingBottom: 16,
    gap: 18,
  },
  filtersBorder: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 0,
    height: StyleSheet.hairlineWidth,
  },
  chipsScroll: {
    marginHorizontal: -16,
  },
  chips: {
    gap: 8,
    paddingHorizontal: 16,
  },
  chip: {
    height: 38,
    borderRadius: 19,
    borderWidth: StyleSheet.hairlineWidth,
    paddingLeft: 4,
    paddingRight: 14,
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  chipImage: {
    width: 28,
    height: 28,
    borderRadius: 14,
  },
  chipText: {
    ...Typography.subheadline,
    fontWeight: "600",
  },
  toolbar: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
    paddingTop: 2,
  },
  toolbarTitle: {
    ...Typography.headline,
    flex: 1,
  },
  // Afasta o primeiro bloco da linha "N espaços · Ordenar", para não ficar colado a ela.
  results: {
    paddingTop: 8,
  },
  section: {
    marginTop: 24,
  },
  cards: {
    gap: 12,
  },
  // A fila "Em alta" vai até à borda do ecrã, como na App Store.
  bleed: {
    marginHorizontal: -16,
  },
  tiles: {
    gap: 14,
    paddingHorizontal: 16,
  },
  skeleton: {
    marginTop: 24,
    gap: 16,
  },
  skeletonRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
  },
  skeletonText: {
    flex: 1,
    gap: 8,
  },
  state: {
    alignItems: "center",
    paddingTop: 56,
    paddingHorizontal: 32,
    gap: 8,
  },
  stateIcon: {
    width: 76,
    height: 76,
    borderRadius: 38,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 6,
  },
  stateTitle: {
    ...Typography.title3,
    fontWeight: "700",
    textAlign: "center",
  },
  stateText: {
    ...Typography.subheadline,
    textAlign: "center",
    marginBottom: 12,
  },
  stateButton: {
    height: 46,
    paddingHorizontal: 22,
    borderRadius: 23,
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  stateButtonText: {
    ...Typography.headline,
    color: "#FFFFFF",
  },
});
