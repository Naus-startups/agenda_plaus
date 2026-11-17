import { distanceBetweenKm, normalizeText, type MunicipalityDTO, type ProvinceDTO, type ZoneDTO } from "@slotix/types";
import data from "./data/angola.json";

/*
 * Angola's territory as the app organises it: the 21 provinces and 326 municípios of the
 * official division (Lei n.º 14/24), each município with the point of its seat and its
 * bairros. It ships with the API (data/angola.json, built by scripts/geo) instead of being
 * asked of OpenStreetMap on every request: the division changes once a decade, and the
 * live queries it replaces were slow, often down, and knew only the old municípios.
 */

interface Point {
  latitude: number;
  longitude: number;
}

interface Bairro extends Point {
  name: string;
}

interface Municipality {
  name: string;
  latitude: number | null;
  longitude: number | null;
  bairros: Bairro[];
}

interface Province extends Point {
  name: string;
  capital: string;
  municipalities: Municipality[];
}

const PROVINCES = data.provinces as Province[];

// Names are compared without accents, case, hyphens or apostrophes, and without a leading
// "Província de" / "Município do" / "Bairro": "Cuanza-Norte" = "Cuanza Norte",
// "Município do Talatona" = "Talatona", "M'banza Kongo" = "Mbanza Kongo".
export function areaKey(name: string): string {
  return normalizeText(name)
    .replace(/^(provincia|municipio|bairro|distrito urbano)\s+(de|do|da|dos|das)\s+/, "")
    .replace(/^bairro\s+/, "")
    .replace(/['’`]/g, "")
    .replace(/[-–]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

// The names OpenStreetMap and older data still use for a province.
const PROVINCE_ALIASES: Record<string, string> = {
  "kwanza norte": "Cuanza Norte",
  "kwanza sul": "Cuanza Sul",
};

const provinceByKey = new Map<string, Province>();
for (const province of PROVINCES) provinceByKey.set(areaKey(province.name), province);
for (const [alias, name] of Object.entries(PROVINCE_ALIASES)) provinceByKey.set(areaKey(alias), provinceByKey.get(areaKey(name))!);

function findProvince(name: string | null | undefined): Province | null {
  return name ? (provinceByKey.get(areaKey(name)) ?? null) : null;
}

const hasPoint = (municipality: Municipality): municipality is Municipality & Point =>
  municipality.latitude !== null && municipality.longitude !== null;

export const gazetteer = {
  provinces(): ProvinceDTO[] {
    return PROVINCES.map(({ name, capital, latitude, longitude, municipalities }) => ({
      name,
      capital,
      latitude,
      longitude,
      municipalityCount: municipalities.length,
    }));
  },

  // null when `name` isn't a province of Angola.
  municipalities(provinceName: string): MunicipalityDTO[] | null {
    return findProvince(provinceName)?.municipalities ?? null;
  },

  // The old flat list (municípios and bairros together), for app versions that ask for it.
  zones(provinceName: string): ZoneDTO[] | null {
    const province = findProvince(provinceName);
    if (!province) return null;
    const zones: ZoneDTO[] = [];
    for (const municipality of province.municipalities) {
      if (hasPoint(municipality)) zones.push({ name: municipality.name, latitude: municipality.latitude, longitude: municipality.longitude });
      zones.push(...municipality.bairros);
    }
    return zones.sort((a, b) => a.name.localeCompare(b.name, "pt"));
  },

  /*
   * The official names for a place OpenStreetMap described. OpenStreetMap still files most
   * of Angola under the old municípios ("Belas" for what is now Talatona, or just "Luanda"),
   * so its município is the last thing trusted:
   *   1. a bairro of the province with the same name decides the município;
   *   2. else a bairro or district that is now a município of its own ("Talatona" inside
   *      the old Belas, "Distrito Urbano da Maianga") is that município;
   *   3. else a município with the name OpenStreetMap gave;
   *   4. else the município whose bairro or seat is nearest the point (in the provinces,
   *      where municípios are large and seats far apart, that is usually its own seat).
   * A province that isn't Angola's leaves everything as it came.
   */
  resolve(
    place: { provincia: string | null; municipio: string | null; distrito?: string | null; bairro: string | null } & Point,
  ): {
    provincia: string | null;
    municipio: string | null;
    bairro: string | null;
  } {
    const province = findProvince(place.provincia);
    if (!province) return { provincia: place.provincia, municipio: place.municipio, bairro: place.bairro };

    const distance = (point: Point) => distanceBetweenKm(place, point);
    const municipalityNamed = (name: string | null | undefined) =>
      name ? province.municipalities.find((item) => areaKey(item.name) === areaKey(name)) : undefined;

    if (place.bairro) {
      const target = areaKey(place.bairro);
      const matches = province.municipalities.flatMap((municipality) =>
        municipality.bairros.filter((bairro) => areaKey(bairro.name) === target).map((bairro) => ({ municipality, bairro })),
      );
      const best = matches.sort((a, b) => distance(a.bairro) - distance(b.bairro))[0];
      if (best) return { provincia: province.name, municipio: best.municipality.name, bairro: best.bairro.name };
    }

    const promoted = municipalityNamed(place.bairro);
    if (promoted) return { provincia: province.name, municipio: promoted.name, bairro: null };
    const district = municipalityNamed(place.distrito);
    if (district) return { provincia: province.name, municipio: district.name, bairro: place.bairro };

    const named = municipalityNamed(place.municipio);
    if (named) return { provincia: province.name, municipio: named.name, bairro: place.bairro };

    let nearest: { municipality: Municipality; km: number } | null = null;
    for (const municipality of province.municipalities) {
      for (const point of [...(hasPoint(municipality) ? [municipality] : []), ...municipality.bairros]) {
        const km = distance(point);
        if (!nearest || km < nearest.km) nearest = { municipality, km };
      }
    }
    return { provincia: province.name, municipio: nearest?.municipality.name ?? place.municipio, bairro: place.bairro };
  },
};
