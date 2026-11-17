import React, { useCallback, useEffect, useMemo, useState } from "react";
import { ActivityIndicator, Alert, Keyboard, Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import Ionicons from "@expo/vector-icons/Ionicons";
import { Image } from "expo-image";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import type { BusinessDTO, MunicipalityDTO, ProvinceDTO } from "@slotix/types";
import { formatDistance, normalizeText, sameLocality } from "@slotix/types";

import { useIOSColors } from "@/components/ios";
import { LocationPicker } from "@/components/LocationPicker";
import { MapFiltersSheet, NO_MAP_FILTERS, priceLabel, type MapFilters } from "@/components/MapFiltersSheet";
import { ratingLabel, placeText } from "@/components/SpaceCards";
import { SpacesMap } from "@/components/SpacesMap";
import { Typography } from "@/constants/theme";
import { useColorScheme } from "@/hooks/use-color-scheme";
import { areaLabel, useSelectedLocation } from "../contexts/LocationContext";
import { getBusinessServices, listAllBusinesses } from "../services/businesses";
import { listMunicipalities, listProvinces, reversePlace, spaceInBairro, spaceInMunicipio } from "../services/localities";
import { useT } from "@/i18n";

// Uma linha de informação do espaço: ícone e texto.
function Fact({ icon, text, lines = 1 }: { icon: React.ComponentProps<typeof Ionicons>["name"]; text: string; lines?: number }) {
  const colors = useIOSColors();
  return (
    <View style={styles.fact}>
      <Ionicons name={icon} size={16} color={colors.textSecondary} />
      <Text style={[styles.factText, { color: colors.text }]} numberOfLines={lines}>
        {text}
      </Text>
    </View>
  );
}

// O zoom com que o mapa mostra uma área sem espaços: a província, o município, o bairro.
const AREA_ZOOM = { provincia: 8, municipio: 12, bairro: 15 };

/*
 * O mapa dos espaços: os da área escolhida (província, município ou bairro — o botão por
 * baixo da pesquisa muda-a) que têm o ponto marcado, com o ícone da agenda+. Sem área
 * escolhida vale a província onde a pessoa está (lida do GPS). A barra de pesquisa procura
 * por nome, província, município ou bairro, em todo o país; os filtros limitam pela
 * distância (desenha o círculo) e pelo preço. Tocar num marcador mostra o espaço — com a
 * distância e o preço — e leva à página dele.
 */
export default function MapScreen() {
  const t = useT();
  const router = useRouter();
  const colors = useIOSColors();
  const insets = useSafeAreaInsets();
  const dark = useColorScheme() === "dark";
  const {
    coordinates: position,
    requestPosition,
    provincia: chosenProvincia,
    municipio: chosenMunicipio,
    bairro: chosenBairro,
    center: chosenCenter,
    chosen,
    nearMe,
  } = useSelectedLocation();
  const [pickerVisible, setPickerVisible] = useState(false);

  const params = useLocalSearchParams<{ radiusKm?: string }>();
  const initialRadius = Number(params.radiusKm);
  const [filters, setFilters] = useState<MapFilters>({ ...NO_MAP_FILTERS, radiusKm: initialRadius > 0 ? initialRadius : null });
  const [filtersVisible, setFiltersVisible] = useState(false);
  const [query, setQuery] = useState("");
  // O preço mais baixo de cada espaço já consultado (null = sem serviços com preço).
  const [prices, setPrices] = useState<Record<string, number | null>>({});
  const { radiusKm, maxPrice } = filters;
  const [spaces, setSpaces] = useState<BusinessDTO[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  // Ao abrir, pede a localização (uma vez) para mostrar onde a pessoa está e as distâncias.
  useEffect(() => {
    if (!position) void requestPosition();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    let cancelled = false;
    // O mapa mostra todos os espaços de uma vez: lê as páginas todas, não só a primeira.
    listAllBusinesses({
      // Com preço escolhido, vêm só os espaços com algum serviço até esse valor.
      maxPrice: maxPrice ?? undefined,
      ...(position ? { latitude: position.latitude, longitude: position.longitude } : {}),
    })
      .then((all) => {
        if (!cancelled) setSpaces(all);
      })
      .catch(() => {
        if (!cancelled) setSpaces([]);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [position, maxPrice]);

  // A província onde a pessoa está, dada pelo OpenStreetMap ao ponto do GPS. Só volta a
  // perguntar quando a pessoa mudou de sítio (~1 km): coordenadas arredondadas a duas casas.
  const [geoProvincia, setGeoProvincia] = useState<string | null>(null);
  const geoLatitude = position ? Number(position.latitude.toFixed(2)) : null;
  const geoLongitude = position ? Number(position.longitude.toFixed(2)) : null;
  useEffect(() => {
    if (geoLatitude === null || geoLongitude === null) return;

    let cancelled = false;
    reversePlace({ latitude: geoLatitude, longitude: geoLongitude })
      .then((found) => {
        if (!cancelled) setGeoProvincia(found?.provincia ?? null);
      })
      .catch(() => {
        if (!cancelled) setGeoProvincia(null);
      });

    return () => {
      cancelled = true;
    };
  }, [geoLatitude, geoLongitude]);

  // A área escolhida na app; sem escolha (ou em "Perto de si"), a província onde a pessoa
  // está, e sem GPS a província guardada.
  const byGps = !chosen || nearMe;
  const provincia = byGps ? ((position ? geoProvincia : null) ?? chosenProvincia) : chosenProvincia;
  const municipio = byGps ? null : chosenMunicipio;
  const bairro = byGps ? null : chosenBairro;

  // Os municípios da província (com os bairros de cada um) e o centro de cada província:
  // dizem que espaços são do município escolhido e onde pôr o mapa quando lá não há nenhum.
  const [tree, setTree] = useState<{ provincia: string; municipalities: MunicipalityDTO[] } | null>(null);
  const [provinces, setProvinces] = useState<ProvinceDTO[]>([]);
  useEffect(() => {
    void listProvinces()
      .then(setProvinces)
      .catch(() => undefined);
  }, []);
  useEffect(() => {
    if (!provincia) return;
    let cancelled = false;
    listMunicipalities(provincia)
      .then((found) => {
        if (!cancelled) setTree({ provincia, municipalities: found });
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [provincia]);
  const municipalities = useMemo(() => (tree && tree.provincia === provincia ? tree.municipalities : []), [tree, provincia]);

  const selectedMunicipality = municipio ? municipalities.find((item) => sameLocality(item.name, municipio)) : undefined;
  const inArea = useCallback(
    (space: BusinessDTO) => {
      if (!provincia) return true;
      if (!sameLocality(space.provincia, provincia)) return false;
      if (bairro) return spaceInBairro(space, bairro, chosenCenter);
      if (municipio) return selectedMunicipality ? spaceInMunicipio(space, selectedMunicipality) : sameLocality(space.municipio, municipio);
      return true;
    },
    [provincia, municipio, bairro, chosenCenter, selectedMunicipality],
  );

  // Onde o mapa fica quando a área não tem espaços: o ponto do bairro ou do município, ou o
  // centro da província.
  const focus = useMemo(() => {
    if (!provincia) return null;
    if ((bairro || municipio) && chosenCenter) return { ...chosenCenter, zoom: bairro ? AREA_ZOOM.bairro : AREA_ZOOM.municipio };
    if (municipio && selectedMunicipality && selectedMunicipality.latitude !== null && selectedMunicipality.longitude !== null) {
      return { latitude: selectedMunicipality.latitude, longitude: selectedMunicipality.longitude, zoom: AREA_ZOOM.municipio };
    }
    const province = provinces.find((item) => sameLocality(item.name, provincia));
    return province ? { latitude: province.latitude, longitude: province.longitude, zoom: AREA_ZOOM.provincia } : null;
  }, [provincia, municipio, bairro, chosenCenter, selectedMunicipality, provinces]);
  const areaText = areaLabel({ provincia, municipio, bairro });

  const applyFilters = useCallback(
    async (next: MapFilters) => {
      let radius = next.radiusKm;
      if (radius !== null && !position && !(await requestPosition())) {
        Alert.alert(t("Sem acesso à localização"), t("Autorize a localização para procurar espaços por distância."));
        radius = null;
      }
      setSelectedId(null);
      setFilters({ ...next, radiusKm: radius });
    },
    [position, requestPosition],
  );

  // Só entram no mapa os espaços com o ponto marcado. Sem texto, todos os da área escolhida;
  // com distância, os que ficam dentro dela; com texto, os que o têm no nome, na província,
  // no município, no bairro ou na morada (em todo o país).
  const shown = useMemo(() => {
    const words = normalizeText(query).split(/\s+/).filter(Boolean);
    return spaces.filter((space) => {
      if (space.latitude === null || space.longitude === null) return false;
      if (radiusKm !== null && position && (space.distanceKm === null || space.distanceKm > radiusKm)) return false;
      if (words.length === 0) return inArea(space);
      const text = normalizeText(
        [space.name, space.provincia, space.municipio, space.bairro, space.address, space.category].filter(Boolean).join(" "),
      );
      return words.every((word) => text.includes(word));
    });
  }, [spaces, radiusKm, position, query, inArea]);

  const markers = useMemo(
    () =>
      shown.map((space) => ({
        id: space.id,
        name: space.name,
        latitude: space.latitude!,
        longitude: space.longitude!,
      })),
    [shown],
  );

  const selected = shown.find((space) => space.id === selectedId) ?? null;

  // O preço do espaço escolhido ("desde ..."): o serviço mais barato dele, lido uma vez.
  useEffect(() => {
    if (!selectedId || selectedId in prices) return;
    let cancelled = false;
    getBusinessServices(selectedId)
      .then((services) => (services.length > 0 ? Math.min(...services.map((service) => service.price)) : null))
      .catch(() => null)
      .then((lowest) => {
        if (!cancelled) setPrices((current) => ({ ...current, [selectedId]: lowest }));
      });

    return () => {
      cancelled = true;
    };
  }, [selectedId, prices]);

  const filtering = query.trim().length > 0 || radiusKm !== null || maxPrice !== null;
  const activeFilters = Number(radiusKm !== null) + Number(maxPrice !== null);
  const summary =
    shown.length === 0
      ? query.trim().length > 0
        ? t("Não há nenhum espaço em “{0}”{1}.", [query.trim(), radiusKm !== null || maxPrice !== null ? t(" com estes filtros") : ""])
        : filtering
          ? t("Nenhum espaço com estes filtros. Alargue a distância ou o preço.")
        : areaText
          ? t("Ainda não há espaços marcados no mapa em {0}.", [areaText])
          : t("Ainda não há espaços marcados no mapa.")
      : t("{0}{1}. Toque num para o ver.", [shown.length === 1 ? t("1 espaço") : t("{0} espaços", [shown.length]), [query.trim().length === 0 && areaText ? t(" em {0}", [areaText]) : "", radiusKm !== null ? t(" a menos de {0} km", [radiusKm]) : ""].join("")]);
  const selectedPrice = selected ? prices[selected.id] : undefined;

  return (
    <View style={[styles.screen, { backgroundColor: colors.background }]}>
      <SpacesMap
        spaces={markers}
        position={position}
        radiusKm={position ? radiusKm : null}
        // A pesquisar, o mapa enquadra o que encontrou; senão, a área escolhida.
        focus={query.trim().length === 0 && radiusKm === null ? focus : null}
        dark={dark}
        tint={colors.primary}
        onSelect={setSelectedId}
      />

      <View style={[styles.top, { paddingTop: insets.top + 8 }]} pointerEvents="box-none">
        <Pressable onPress={() => (router.canGoBack() ? router.back() : router.replace("/"))} hitSlop={8} accessibilityRole="button" accessibilityLabel={t("Voltar")}>
          {({ pressed }) => (
            <View style={[styles.back, styles.shadow, { backgroundColor: colors.card, opacity: pressed ? 0.6 : 1 }]}>
              <Ionicons name="chevron-back" size={22} color={colors.text} />
            </View>
          )}
        </Pressable>
        <View style={[styles.search, styles.shadow, { backgroundColor: colors.card }]}>
          <Ionicons name="search" size={17} color={colors.textSecondary} />
          <TextInput
            value={query}
            onChangeText={(text) => {
              setSelectedId(null);
              setQuery(text);
            }}
            placeholder={t("Província, município, bairro ou espaço")}
            placeholderTextColor={colors.textSecondary}
            selectionColor={colors.primary}
            returnKeyType="search"
            autoCorrect={false}
            style={[styles.searchInput, { color: colors.text }]}
          />
          {query.length > 0 ? (
            <Pressable onPress={() => setQuery("")} hitSlop={10} accessibilityLabel={t("Limpar pesquisa")}>
              <Ionicons name="close-circle" size={17} color={colors.textSecondary} />
            </Pressable>
          ) : null}
        </View>
        <Pressable
          onPress={() => {
            Keyboard.dismiss();
            setFiltersVisible(true);
          }}
          hitSlop={6}
          accessibilityRole="button"
          accessibilityLabel={t("Filtros de distância e preço")}
        >
          {({ pressed }) => (
            <View
              style={[styles.back, styles.shadow, { backgroundColor: activeFilters > 0 ? colors.primary : colors.card, opacity: pressed ? 0.6 : 1 }]}
            >
              <Ionicons name="options-outline" size={20} color={activeFilters > 0 ? colors.primaryForeground : colors.text} />
            </View>
          )}
        </Pressable>
      </View>

      <View style={[styles.areaRow, { top: insets.top + 8 + 38 + 10 }]} pointerEvents="box-none">
        <Pressable
          onPress={() => {
            Keyboard.dismiss();
            setPickerVisible(true);
          }}
          hitSlop={6}
          accessibilityRole="button"
          accessibilityLabel={t("Mudar a área do mapa: {0}", [areaText ?? t("Todas as localidades")])}
        >
          {({ pressed }) => (
            <View style={[styles.areaChip, styles.shadow, { backgroundColor: colors.card, opacity: pressed ? 0.7 : 1 }]}>
              <Ionicons name={byGps && position ? "navigate" : "location"} size={14} color={colors.primary} />
              <Text style={[styles.areaText, { color: colors.text }]} numberOfLines={1}>
                {areaText ?? t("Todas as localidades")}
              </Text>
              <Ionicons name="chevron-down" size={14} color={colors.textSecondary} />
            </View>
          )}
        </Pressable>
      </View>

      <View style={[styles.bottom, { paddingBottom: insets.bottom + 16 }]} pointerEvents="box-none">
        {selected ? (
          // As informações do espaço tocado; o mapa continua a mexer-se por trás.
          <View style={[styles.card, styles.shadow, { backgroundColor: colors.card }]}>
            <View style={styles.cardHeader}>
              {selected.logoUrl || selected.imageUrl ? (
                <Image source={{ uri: selected.logoUrl ?? selected.imageUrl ?? undefined }} style={styles.logo} contentFit="cover" />
              ) : (
                <View style={[styles.logo, styles.logoEmpty, { backgroundColor: colors.input }]}>
                  <Ionicons name="storefront-outline" size={24} color={colors.textSecondary} />
                </View>
              )}
              <View style={styles.cardText}>
                <Text style={[styles.cardTitle, { color: colors.text }]} numberOfLines={2}>
                  {selected.name}
                </Text>
                <Text style={[styles.cardLine, { color: colors.textSecondary }]} numberOfLines={1}>
                  {[ratingLabel(selected), t(selected.category)].filter(Boolean).join("  ·  ")}
                </Text>
              </View>
              <Pressable onPress={() => setSelectedId(null)} hitSlop={10} accessibilityRole="button" accessibilityLabel={t("Fechar")}>
                <View style={[styles.close, { backgroundColor: colors.input }]}>
                  <Ionicons name="close" size={17} color={colors.text} />
                </View>
              </Pressable>
            </View>

            <View style={styles.facts}>
              <Fact icon="location-outline" text={placeText(selected) ?? t("Sem morada")} />
              {selected.distanceKm !== null ? <Fact icon="navigate-outline" text={t("A {0} de si", [formatDistance(selected.distanceKm)])} /> : null}
              {typeof selectedPrice === "number" ? <Fact icon="pricetag-outline" text={t("Serviços desde {0}", [priceLabel(selectedPrice)])} /> : null}
              {selected.description ? <Fact icon="information-circle-outline" text={t(selected.description)} lines={2} /> : null}
            </View>

            <Pressable
              onPress={() => router.push({ pathname: "/space", params: { businessId: selected.id } } as never)}
              accessibilityRole="button"
              accessibilityLabel={t("Ver {0}", [selected.name])}
            >
              {({ pressed }) => (
                <View style={[styles.open, { backgroundColor: colors.primary, opacity: pressed ? 0.7 : 1 }]}>
                  <Text style={[styles.openText, { color: colors.primaryForeground }]}>{t("Ver espaço")}</Text>
                </View>
              )}
            </Pressable>
          </View>
        ) : (
          <View style={[styles.note, styles.shadow, { backgroundColor: colors.card }]}>
            {loading ? <ActivityIndicator color={colors.textSecondary} /> : <Text style={[styles.noteText, { color: colors.textSecondary }]}>{summary}</Text>}
          </View>
        )}
      </View>

      <LocationPicker
        visible={pickerVisible}
        onClose={() => {
          setSelectedId(null);
          setPickerVisible(false);
        }}
      />

      <MapFiltersSheet
        visible={filtersVisible}
        initial={filters}
        onApply={(next) => void applyFilters(next)}
        onClose={() => setFiltersVisible(false)}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
  },
  shadow: {
    shadowColor: "#000000",
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.16,
    shadowRadius: 10,
    elevation: 4,
  },
  top: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 16,
    gap: 10,
  },
  search: {
    flex: 1,
    height: 38,
    borderRadius: 19,
    paddingHorizontal: 12,
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  searchInput: {
    ...Typography.subheadline,
    flex: 1,
    paddingVertical: 0,
  },
  back: {
    width: 38,
    height: 38,
    borderRadius: 19,
    alignItems: "center",
    justifyContent: "center",
  },
  areaRow: {
    position: "absolute",
    left: 16 + 38 + 10,
    right: 16,
    flexDirection: "row",
  },
  areaChip: {
    height: 32,
    maxWidth: "100%",
    borderRadius: 16,
    paddingHorizontal: 12,
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  areaText: {
    ...Typography.subheadline,
    fontWeight: "600",
    flexShrink: 1,
  },
  bottom: {
    position: "absolute",
    left: 16,
    right: 16,
    bottom: 0,
  },
  card: {
    borderRadius: 22,
    borderCurve: "continuous",
    padding: 16,
    gap: 14,
  },
  cardHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
  },
  logo: {
    width: 60,
    height: 60,
    borderRadius: 14,
    borderCurve: "continuous",
  },
  logoEmpty: {
    alignItems: "center",
    justifyContent: "center",
  },
  cardText: {
    flex: 1,
    gap: 2,
  },
  cardTitle: {
    ...Typography.headline,
  },
  cardLine: {
    ...Typography.footnote,
  },
  close: {
    width: 30,
    height: 30,
    borderRadius: 15,
    alignItems: "center",
    justifyContent: "center",
    alignSelf: "flex-start",
  },
  facts: {
    gap: 8,
  },
  fact: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 8,
  },
  factText: {
    ...Typography.subheadline,
    flex: 1,
  },
  open: {
    height: 46,
    borderRadius: 13,
    borderCurve: "continuous",
    alignItems: "center",
    justifyContent: "center",
  },
  openText: {
    ...Typography.headline,
  },
  note: {
    borderRadius: 14,
    borderCurve: "continuous",
    paddingHorizontal: 16,
    paddingVertical: 12,
    alignItems: "center",
  },
  noteText: {
    ...Typography.footnote,
    textAlign: "center",
  },
});
