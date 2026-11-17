import {
  distanceBetweenKm,
  normalizeText,
  sameLocality,
  type BusinessDTO,
  type LocalityDTO,
  type MunicipalityDTO,
  type PlaceDTO,
  type ProvinceDTO,
} from "@slotix/types";
import type { Coordinates } from "./location";
import { apiFetch } from "./api-client";
import { translate } from "@/i18n";

/*
 * O território como a app o organiza: província → município → bairro. As províncias e os
 * municípios são os oficiais (21 e 326, Lei n.º 14/24); os pontos e os bairros vêm do
 * OpenStreetMap. A lista muda só com uma nova versão da API, por isso cada resposta fica
 * guardada enquanto a app estiver aberta e voltar a uma província é instantâneo.
 */

export type LocalityOption = { name: string; count: number };

let provincesCache: Promise<ProvinceDTO[]> | null = null;
const municipalitiesCache = new Map<string, Promise<MunicipalityDTO[]>>();

// Um pedido que falhou não fica guardado: a próxima vez pergunta outra vez.
function remember<T>(request: Promise<T>, forget: () => void): Promise<T> {
  request.catch(forget);
  return request;
}

// As 21 províncias de Angola, com o centro e a sede de cada uma.
export function listProvinces(): Promise<ProvinceDTO[]> {
  provincesCache ??= remember(apiFetch<ProvinceDTO[]>("/geo/provinces"), () => {
    provincesCache = null;
  });
  return provincesCache;
}

// Os municípios de uma província, cada um com a sede e os seus bairros.
export function listMunicipalities(provincia: string): Promise<MunicipalityDTO[]> {
  const key = normalizeText(provincia);
  let request = municipalitiesCache.get(key);
  if (!request) {
    request = remember(apiFetch<MunicipalityDTO[]>(`/geo/provinces/${encodeURIComponent(provincia)}/municipalities`), () =>
      municipalitiesCache.delete(key),
    );
    municipalitiesCache.set(key, request);
  }
  return request;
}

// As localidades onde existem espaços registados, com quantos há em cada uma.
export async function listLocalities(): Promise<LocalityDTO[]> {
  return apiFetch<LocalityDTO[]>("/businesses/localities");
}

// O que os ecrãs de escolha de localização precisam: todas as províncias e as localidades
// com espaços. Se as províncias não vierem, ficam as que têm espaços — nunca uma lista vazia.
export async function loadLocationOptions(): Promise<{ provinces: ProvinceDTO[]; localities: LocalityDTO[] }> {
  const [provinces, localities] = await Promise.all([
    listProvinces().catch(() => [] as ProvinceDTO[]),
    listLocalities().catch(() => [] as LocalityDTO[]),
  ]);
  return { provinces, localities };
}

// O bairro, município e província de um ponto, nos nomes oficiais; null se não houver dados.
export async function reversePlace({ latitude, longitude }: Coordinates): Promise<PlaceDTO | null> {
  return apiFetch<PlaceDTO | null>(`/geo/reverse?latitude=${latitude}&longitude=${longitude}`);
}

// Um espaço conta como "deste bairro" até esta distância do centro dele.
export const BAIRRO_RADIUS_KM = 3;

// Um espaço é de um bairro se o tem por bairro (ou por município: há bairros que passaram a
// município), ou se o ponto marcado pelo dono fica perto do centro do bairro — os nomes nem
// sempre coincidem entre o que o mapa deu ao ponto e o nome por que o bairro é conhecido.
export function spaceInBairro(space: BusinessDTO, bairro: string, center: Coordinates | null): boolean {
  if (sameLocality(space.bairro, bairro) || sameLocality(space.municipio, bairro)) return true;
  if (!center || space.latitude === null || space.longitude === null) return false;
  return distanceBetweenKm(center, { latitude: space.latitude, longitude: space.longitude }) <= BAIRRO_RADIUS_KM;
}

// Um espaço é de um município se o tem por município, ou se o seu bairro é um dos bairros
// desse município: os espaços marcados antes da divisão de 2024 ainda têm o município
// antigo ("Belas", "Luanda"), mas o bairro diz onde ficam.
export function spaceInMunicipio(space: BusinessDTO, municipio: Pick<MunicipalityDTO, "name" | "bairros">): boolean {
  if (sameLocality(space.municipio, municipio.name) || sameLocality(space.bairro, municipio.name)) return true;
  return Boolean(space.bairro) && municipio.bairros.some((bairro) => sameLocality(space.bairro, bairro.name));
}

export type AreaOption = { name: string; count: number; center: Coordinates | null };
export type MunicipalityOption = AreaOption & { bairros: AreaOption[] };

const pointOf = (place: { latitude: number | null; longitude: number | null }): Coordinates | null =>
  place.latitude !== null && place.longitude !== null ? { latitude: place.latitude, longitude: place.longitude } : null;

// Primeiro os que têm espaços (os de mais espaços à frente), depois por ordem alfabética.
function byCount(a: AreaOption, b: AreaOption): number {
  return Number(b.count > 0) - Number(a.count > 0) || b.count - a.count || a.name.localeCompare(b.name, "pt");
}

// Os municípios de uma província e os bairros de cada um, com o número de espaços que lá
// ficam (de entre `spaces`, os espaços da província).
export function municipalityOptions(municipalities: MunicipalityDTO[], spaces: BusinessDTO[]): MunicipalityOption[] {
  return municipalities
    .map((municipality) => {
      const inside = spaces.filter((space) => spaceInMunicipio(space, municipality));
      const bairros = municipality.bairros
        .map((bairro) => {
          const center = pointOf(bairro);
          return { name: bairro.name, center, count: inside.filter((space) => spaceInBairro(space, bairro.name, center)).length };
        })
        .sort(byCount);
      return { name: municipality.name, center: pointOf(municipality), count: inside.length, bairros };
    })
    .sort(byCount);
}

// Todas as províncias, cada uma com o número de espaços que lá existem (0 se nenhum).
export function provinciasOf(localities: LocalityDTO[], provinces: ProvinceDTO[] = []): LocalityOption[] {
  const byName = new Map<string, LocalityOption>();
  for (const { name, count } of [
    ...provinces.map((item) => ({ name: item.name, count: 0 })),
    ...localities.map((item) => ({ name: item.provincia, count: item.count })),
  ]) {
    const key = normalizeText(name);
    byName.set(key, { name: byName.get(key)?.name ?? name, count: (byName.get(key)?.count ?? 0) + count });
  }
  return [...byName.values()].sort((a, b) => a.name.localeCompare(b.name, "pt"));
}

export function countLabel(count: number): string {
  return count === 0 ? translate("Sem espaços") : count === 1 ? translate("1 espaço") : translate("{0} espaços", [count]);
}
