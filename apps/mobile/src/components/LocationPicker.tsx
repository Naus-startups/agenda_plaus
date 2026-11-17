import React, { useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { SafeAreaView } from 'react-native-safe-area-context';

import { useIOSColors } from '@/components/ios';
import { formatDistance, normalizeText, sameLocality, type LocalityDTO, type ProvinceDTO } from '@slotix/types';

import { Typography } from '@/constants/theme';
import { NEAR_ME_RADIUS_KM, useSelectedLocation } from '@/contexts/LocationContext';
import { useProvinceAreas } from '@/hooks/use-province-areas';
import { listBusinesses } from '@/services/businesses';
import { countLabel, loadLocationOptions, provinciasOf, type AreaOption, type MunicipalityOption } from '@/services/localities';
import { useT } from "@/i18n";

type Level = 'provincias' | 'municipios' | 'bairros';
type NearbyArea = { provincia: string; municipio: string | null; bairro: string | null; count: number; distanceKm: number };

// Uma linha da lista: o que se escolhe, com o subtítulo (o município de um bairro, nas
// pesquisas) e o número de espaços.
type Row = { key: string; label: string; subtitle?: string; count?: number; selected: boolean; chevron: boolean; onPress: () => void };

/*
 * Folha de escolha de localização, como as do iOS (Definições → Região), em três níveis:
 * a província, os seus municípios e os bairros de cada município — os oficiais, cada um
 * com o número de espaços que lá ficam. No topo, "Perto de si" e os sítios com espaços à
 * volta da pessoa. A pesquisa dos municípios procura também os bairros da província.
 */
export function LocationPicker({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  const t = useT();
  const colors = useIOSColors();
  const { provincia, municipio, bairro, nearMe, coordinates, setProvincia, setArea, chooseNearMe } = useSelectedLocation();

  const [level, setLevel] = useState<Level>(provincia ? 'municipios' : 'provincias');
  // O município aberto no nível dos bairros.
  const [openMunicipio, setOpenMunicipio] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [locating, setLocating] = useState(false);
  const [locationFailed, setLocationFailed] = useState(false);
  const [nearby, setNearby] = useState<NearbyArea[]>([]);
  const [loadingNearby, setLoadingNearby] = useState(false);
  const [localities, setLocalities] = useState<LocalityDTO[]>([]);
  const [provinces, setProvinces] = useState<ProvinceDTO[]>([]);
  const [loadingProvinces, setLoadingProvinces] = useState(false);

  // Ao abrir, começa onde a pessoa está: nos municípios da província escolhida.
  const [wasVisible, setWasVisible] = useState(visible);
  if (visible !== wasVisible) {
    setWasVisible(visible);
    if (visible) {
      setLevel(provincia ? 'municipios' : 'provincias');
      setOpenMunicipio(null);
    }
  }

  useEffect(() => {
    if (!visible) return;

    let cancelled = false;
    setLoadingProvinces(true);
    loadLocationOptions()
      .then((data) => {
        if (cancelled) return;
        setLocalities(data.localities);
        setProvinces(data.provinces);
      })
      .finally(() => {
        if (!cancelled) setLoadingProvinces(false);
      });

    return () => {
      cancelled = true;
    };
  }, [visible]);

  // Os sítios com espaços perto da pessoa vêm dos espaços registados à volta dela.
  useEffect(() => {
    if (!visible || !coordinates) return;

    let cancelled = false;
    setLoadingNearby(true);

    listBusinesses({
      latitude: coordinates.latitude,
      longitude: coordinates.longitude,
      radiusKm: 25,
      sortBy: 'nearest',
      limit: 100,
    })
      .then(({ data }) => {
        if (cancelled) return;
        const byArea = new Map<string, NearbyArea>();
        for (const space of data) {
          if (!space.provincia || !(space.bairro || space.municipio)) continue;
          const key = normalizeText(`${space.provincia}|${space.municipio ?? ''}|${space.bairro ?? ''}`);
          const current = byArea.get(key);
          const distance = space.distanceKm ?? Number.POSITIVE_INFINITY;
          byArea.set(key, {
            provincia: space.provincia,
            municipio: space.municipio,
            bairro: space.bairro,
            count: (current?.count ?? 0) + 1,
            distanceKm: Math.min(current?.distanceKm ?? Number.POSITIVE_INFINITY, distance),
          });
        }
        setNearby([...byArea.values()].sort((a, b) => a.distanceKm - b.distanceKm).slice(0, 6));
      })
      .catch(() => {
        if (!cancelled) setNearby([]);
      })
      .finally(() => {
        if (!cancelled) setLoadingNearby(false);
      });

    return () => {
      cancelled = true;
    };
  }, [visible, coordinates]);

  const { municipalities, loading: loadingAreas, failed } = useProvinceAreas(visible ? provincia : null);
  const opened = municipalities.find((item) => item.name === openMunicipio) ?? null;

  const close = () => {
    setQuery('');
    setLocationFailed(false);
    onClose();
  };

  const pickNearMe = async () => {
    setLocating(true);
    setLocationFailed(false);
    const ok = await chooseNearMe();
    setLocating(false);

    if (!ok) {
      setLocationFailed(true);
      return;
    }
    close();
  };

  const goTo = (next: Level) => {
    setQuery('');
    setLevel(next);
  };

  const pickProvincia = (name: string | null) => {
    setProvincia(name);
    if (name) goTo('municipios');
    else close();
  };

  const pickMunicipio = (item: MunicipalityOption) => {
    setArea({ provincia, municipio: item.name, center: item.center });
    close();
  };

  const pickBairro = (owner: MunicipalityOption, item: AreaOption) => {
    setArea({ provincia, municipio: owner.name, bairro: item.name, center: item.center });
    close();
  };

  const openBairros = (item: MunicipalityOption) => {
    if (item.bairros.length === 0) {
      pickMunicipio(item);
      return;
    }
    setOpenMunicipio(item.name);
    goTo('bairros');
  };

  const rows = useMemo<Row[]>(() => {
    const target = normalizeText(query);
    const matches = (name: string) => !target || normalizeText(name).includes(target);

    if (level === 'provincias') {
      return provinciasOf(localities, provinces)
        .filter((item) => matches(item.name))
        .map((item) => ({
          key: item.name,
          label: item.name,
          count: item.count,
          selected: !nearMe && sameLocality(provincia, item.name),
          chevron: true,
          onPress: () => pickProvincia(item.name),
        }));
    }

    if (level === 'bairros') {
      if (!opened) return [];
      return opened.bairros
        .filter((item) => matches(item.name))
        .map((item) => ({
          key: item.name,
          label: item.name,
          count: item.count,
          selected: !nearMe && sameLocality(municipio, opened.name) && sameLocality(bairro, item.name),
          chevron: false,
          onPress: () => pickBairro(opened, item),
        }));
    }

    const municipioRows: Row[] = municipalities
      .filter((item) => matches(item.name))
      .map((item) => ({
        key: item.name,
        label: item.name,
        count: item.count,
        selected: !nearMe && !bairro && sameLocality(municipio, item.name),
        chevron: item.bairros.length > 0,
        onPress: () => openBairros(item),
      }));
    if (!target) return municipioRows;

    // A pesquisar, também os bairros da província: quem procura "Alvalade" não tem de
    // saber que fica na Maianga.
    const bairroRows: Row[] = municipalities.flatMap((owner) =>
      owner.bairros
        .filter((item) => matches(item.name))
        .map((item) => ({
          key: `${owner.name}/${item.name}`,
          label: item.name,
          subtitle: t('Bairro · {0}', [owner.name]),
          count: item.count,
          selected: !nearMe && sameLocality(municipio, owner.name) && sameLocality(bairro, item.name),
          chevron: false,
          onPress: () => pickBairro(owner, item),
        })),
    );
    return [...municipioRows, ...bairroRows].slice(0, 80);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [level, query, localities, provinces, municipalities, opened, provincia, municipio, bairro, nearMe]);

  const loadingRows = level === 'provincias' ? loadingProvinces : loadingAreas;
  const showTop = level === 'municipios' && !query;

  const title = level === 'provincias' ? t("Província") : level === 'bairros' ? (opened?.name ?? '') : t("Localização");
  const back: { label: string; to: Level } | null =
    level === 'bairros' ? { label: provincia ?? t("Voltar"), to: 'municipios' } : level === 'provincias' && provincia ? { label: t("Voltar"), to: 'municipios' } : null;

  const header =
    level === 'provincias'
      ? t("PROVÍNCIAS")
      : level === 'bairros'
        ? t("BAIRROS DE {0}", [(opened?.name ?? '').toUpperCase()])
        : provincia
          ? query
            ? t("RESULTADOS EM {0}", [provincia.toUpperCase()])
            : t("MUNICÍPIOS DE {0}", [provincia.toUpperCase()])
          : t("MUNICÍPIOS");

  // A primeira linha de cada lista: escolher o nível de cima inteiro.
  const wholeRow: Row | null = query
    ? null
    : level === 'provincias'
      ? { key: '*', label: t("Todas as províncias"), selected: !nearMe && provincia === null, chevron: false, onPress: () => pickProvincia(null) }
      : level === 'bairros' && opened
        ? {
            key: '*',
            label: t("Todo o município de {0}", [opened.name]),
            count: opened.count,
            selected: !nearMe && !bairro && sameLocality(municipio, opened.name),
            chevron: false,
            onPress: () => pickMunicipio(opened),
          }
        : provincia
          ? {
              key: '*',
              label: t("Toda a província de {0}", [provincia]),
              selected: !nearMe && !municipio && !bairro,
              chevron: false,
              onPress: () => {
                setArea({ provincia });
                close();
              },
            }
          : null;

  const allRows = wholeRow ? [wholeRow, ...rows] : rows;
  const emptyMessage = query
    ? t("Sem resultados para “{0}”", [query])
    : level === 'municipios' && !provincia
      ? t("Escolha uma província para ver os seus municípios.")
      : failed
        ? t("Não foi possível carregar os municípios de {0}. Verifique a ligação.", [provincia])
        : null;

  return (
    <Modal
      visible={visible}
      animationType="slide"
      presentationStyle={Platform.OS === 'ios' ? 'pageSheet' : 'fullScreen'}
      onRequestClose={close}
    >
      <SafeAreaView style={[styles.screen, { backgroundColor: colors.background }]} edges={Platform.OS === 'ios' ? [] : ['top']}>
        <View style={styles.grabber}>
          <View style={[styles.grabberBar, { backgroundColor: colors.textTertiary }]} />
        </View>

        <View style={styles.navBar}>
          {back ? (
            <Pressable onPress={() => goTo(back.to)} hitSlop={10} style={styles.navSide} accessibilityRole="button">
              <Ionicons name="chevron-back" size={24} color={colors.primary} />
              <Text style={[styles.navButton, { color: colors.primary }]} numberOfLines={1}>
                {back.label}
              </Text>
            </Pressable>
          ) : (
            <View style={styles.navSide} />
          )}
          <Text style={[styles.navTitle, { color: colors.text }]} numberOfLines={1}>
            {title}
          </Text>
          <Pressable onPress={close} hitSlop={10} style={[styles.navSide, styles.navSideRight]} accessibilityRole="button">
            <Text style={[styles.navButton, styles.navDone, { color: colors.primary }]}>{t("OK")}</Text>
          </Pressable>
        </View>

        <View style={[styles.searchField, { backgroundColor: colors.input }]}>
          <Ionicons name="search" size={17} color={colors.textSecondary} />
          <TextInput
            value={query}
            onChangeText={setQuery}
            placeholder={
              level === 'provincias'
                ? t("Pesquisar províncias")
                : level === 'bairros'
                  ? t("Pesquisar bairros de {0}", [opened?.name ?? ''])
                  : provincia
                    ? t("Município ou bairro em {0}", [provincia])
                    : t("Pesquisar")
            }
            placeholderTextColor={colors.textSecondary}
            selectionColor={colors.primary}
            autoCorrect={false}
            style={[styles.searchInput, { color: colors.text }]}
          />
          {query ? (
            <Pressable onPress={() => setQuery('')} hitSlop={10} accessibilityLabel={t("Limpar pesquisa")}>
              <Ionicons name="close-circle" size={17} color={colors.textSecondary} />
            </Pressable>
          ) : null}
        </View>

        <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled" keyboardDismissMode="on-drag">
          {showTop ? (
            <>
              <View style={[styles.group, { backgroundColor: colors.card }]}>
                <Pressable onPress={pickNearMe} disabled={locating}>
                  {({ pressed }) => (
                    <View style={[styles.row, pressed && { backgroundColor: colors.backgroundSelected }]}>
                      <View style={[styles.rowIcon, { backgroundColor: colors.primary }]}>
                        <Ionicons name="navigate" size={15} color="#FFFFFF" />
                      </View>
                      <View style={styles.rowTextBlock}>
                        <Text style={[styles.rowText, { color: colors.text }]}>{t("Perto de si")}</Text>
                        <Text style={[styles.rowSubtext, { color: colors.textSecondary }]}>
                          {t("Espaços até {0} km de onde está", [NEAR_ME_RADIUS_KM])}
                        </Text>
                      </View>
                      {locating ? (
                        <ActivityIndicator size="small" color={colors.textSecondary} />
                      ) : nearMe ? (
                        <Ionicons name="checkmark" size={20} color={colors.primary} />
                      ) : null}
                    </View>
                  )}
                </Pressable>
                <View style={[styles.separator, styles.separatorIcon, { backgroundColor: colors.divider }]} />
                <Pressable onPress={() => goTo('provincias')}>
                  {({ pressed }) => (
                    <View style={[styles.row, pressed && { backgroundColor: colors.backgroundSelected }]}>
                      <View style={[styles.rowIcon, { backgroundColor: '#34C759' }]}>
                        <Ionicons name="map" size={15} color="#FFFFFF" />
                      </View>
                      <Text style={[styles.rowText, styles.flex, { color: colors.text }]}>{t("Província")}</Text>
                      <Text style={[styles.rowValue, { color: colors.textSecondary }]}>{provincia ?? t("Todas")}</Text>
                      <Ionicons name="chevron-forward" size={17} color={colors.textTertiary} />
                    </View>
                  )}
                </Pressable>
              </View>
              {locationFailed ? (
                <Text style={[styles.footer, { color: colors.error }]}>
                  {t("Não foi possível obter a sua localização. Verifique a autorização nas definições do telemóvel.")}
                </Text>
              ) : null}

              {coordinates ? (
                <>
                  <Text style={[styles.header, { color: colors.textSecondary }]}>{t("COM ESPAÇOS PERTO DE SI")}</Text>
                  <View style={[styles.group, { backgroundColor: colors.card }]}>
                    {loadingNearby ? (
                      <View style={styles.row}>
                        <ActivityIndicator size="small" color={colors.textSecondary} />
                      </View>
                    ) : nearby.length === 0 ? (
                      <View style={styles.row}>
                        <Text style={[styles.rowSubtext, { color: colors.textSecondary }]}>{t("Ainda não há espaços registados à sua volta.")}</Text>
                      </View>
                    ) : (
                      nearby.map((item, index) => (
                        <View key={`${item.provincia}|${item.municipio}|${item.bairro}`}>
                          <OptionRow
                            row={{
                              key: '',
                              label: item.bairro ?? item.municipio ?? '',
                              subtitle: [
                                item.bairro ? item.municipio : item.provincia,
                                countLabel(item.count),
                                Number.isFinite(item.distanceKm) ? t("a {0}", [formatDistance(item.distanceKm)]) : null,
                              ]
                                .filter(Boolean)
                                .join(' · '),
                              selected:
                                !nearMe &&
                                sameLocality(provincia, item.provincia) &&
                                sameLocality(municipio, item.municipio) &&
                                (item.bairro ? sameLocality(bairro, item.bairro) : !bairro),
                              chevron: false,
                              onPress: () => {
                                setArea({ provincia: item.provincia, municipio: item.municipio, bairro: item.bairro });
                                close();
                              },
                            }}
                          />
                          {index < nearby.length - 1 ? <View style={[styles.separator, { backgroundColor: colors.divider }]} /> : null}
                        </View>
                      ))
                    )}
                  </View>
                </>
              ) : null}
            </>
          ) : null}

          <Text style={[styles.header, { color: colors.textSecondary }]}>{header}</Text>

          <View style={[styles.group, { backgroundColor: colors.card }]}>
            {allRows.map((row, index) => (
              <View key={row.key}>
                <OptionRow row={row} />
                {index < allRows.length - 1 ? <View style={[styles.separator, { backgroundColor: colors.divider }]} /> : null}
              </View>
            ))}
            {loadingRows && rows.length === 0 ? (
              <View style={styles.row}>
                <ActivityIndicator size="small" color={colors.textSecondary} />
              </View>
            ) : rows.length === 0 && emptyMessage ? (
              <View style={styles.row}>
                <Text style={[styles.rowSubtext, { color: colors.textSecondary }]}>{emptyMessage}</Text>
              </View>
            ) : null}
          </View>
          {level === 'bairros' ? (
            <Text style={[styles.footer, { color: colors.textSecondary }]}>
              {t("Bairros do OpenStreetMap. Se o seu não aparece, escolha o município inteiro.")}
            </Text>
          ) : null}
        </ScrollView>
      </SafeAreaView>
    </Modal>
  );
}

function OptionRow({ row }: { row: Row }) {
  const colors = useIOSColors();
  const detail = row.count === undefined || row.subtitle ? null : countLabel(row.count);
  return (
    <Pressable onPress={row.onPress} accessibilityRole="button" accessibilityState={{ selected: row.selected }}>
      {({ pressed }) => (
        <View style={[styles.row, pressed && { backgroundColor: colors.backgroundSelected }]}>
          <View style={styles.rowTextBlock}>
            <Text style={[styles.rowText, { color: colors.text }]}>{row.label}</Text>
            {row.subtitle ? (
              <Text style={[styles.rowSubtext, { color: colors.textSecondary }]} numberOfLines={1}>
                {row.count ? `${row.subtitle} · ${countLabel(row.count)}` : row.subtitle}
              </Text>
            ) : null}
          </View>
          {detail ? <Text style={[styles.rowSubtext, { color: row.count ? colors.textSecondary : colors.textTertiary }]}>{detail}</Text> : null}
          {row.selected ? <Ionicons name="checkmark" size={20} color={colors.primary} /> : null}
          {row.chevron ? <Ionicons name="chevron-forward" size={17} color={colors.textTertiary} /> : null}
        </View>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
  },
  flex: {
    flex: 1,
  },
  grabber: {
    alignItems: 'center',
    paddingTop: 6,
  },
  grabberBar: {
    width: 36,
    height: 5,
    borderRadius: 3,
  },
  navBar: {
    height: 52,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 8,
  },
  navSide: {
    width: 110,
    flexDirection: 'row',
    alignItems: 'center',
  },
  navSideRight: {
    justifyContent: 'flex-end',
    paddingRight: 8,
  },
  navTitle: {
    ...Typography.headline,
    flex: 1,
    textAlign: 'center',
  },
  navButton: {
    ...Typography.body,
    flexShrink: 1,
  },
  navDone: {
    fontWeight: '600',
  },
  searchField: {
    height: 36,
    marginHorizontal: 16,
    marginBottom: 8,
    borderRadius: 10,
    borderCurve: 'continuous',
    paddingHorizontal: 8,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  searchInput: {
    ...Typography.body,
    flex: 1,
    paddingVertical: 0,
  },
  content: {
    paddingHorizontal: 16,
    paddingTop: 16,
    paddingBottom: 48,
  },
  header: {
    ...Typography.footnote,
    marginHorizontal: 16,
    marginTop: 24,
    marginBottom: 7,
  },
  footer: {
    ...Typography.footnote,
    marginHorizontal: 16,
    marginTop: 7,
  },
  group: {
    borderRadius: 10,
    borderCurve: 'continuous',
    overflow: 'hidden',
  },
  row: {
    minHeight: 44,
    paddingHorizontal: 16,
    paddingVertical: 6,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  rowIcon: {
    width: 29,
    height: 29,
    borderRadius: 7,
    borderCurve: 'continuous',
    alignItems: 'center',
    justifyContent: 'center',
  },
  rowTextBlock: {
    flex: 1,
  },
  rowText: {
    ...Typography.body,
  },
  rowSubtext: {
    ...Typography.footnote,
  },
  rowValue: {
    ...Typography.body,
  },
  separator: {
    height: StyleSheet.hairlineWidth,
    marginLeft: 16,
  },
  separatorIcon: {
    marginLeft: 57,
  },
});
