import { normalizeText, type MunicipalityDTO, type PlaceDTO, type ProvinceDTO, type ZoneDTO } from "@slotix/types";
import { nominatim, photon, type PhotonFeature } from "./geo.client";
import { gazetteer } from "./geo.gazetteer";

// Only the fields used below; Nominatim's `address` has many more, all optional, and
// which ones are filled depends on how the place was mapped.
interface NominatimPlace {
  lat: string;
  lon: string;
  name?: string;
  display_name: string;
  address?: Record<string, string | undefined>;
  error?: string;
}

// Businesses are only in Angola for now.
const COUNTRY_CODES = "ao";

// Coordinates are rounded so that pins a few metres apart share one cached answer.
const round = (value: number, digits: number) => Number(value.toFixed(digits));

// "Província de Luanda" and "Luanda" are the same province: keep the bare name, so
// businesses mapped either way group together.
function provinceName(state: string | undefined): string | null {
  return (
    state
      // OpenStreetMap has some names with decomposed accents ("i" + combining accent).
      ?.normalize("NFC")
      .replace(/^prov[ií]ncia\s+(de|do|da)\s+/i, "")
      .replace(/\s+province$/i, "")
      .trim() || null
  );
}

// Same for "Município do Talatona" → "Talatona".
function municipalityName(name: string | null): string | null {
  return name?.normalize("NFC").replace(/^munic[ií]pio\s+(de|do|da)\s+/i, "").trim() || null;
}

function toPlace(place: NominatimPlace): PlaceDTO {
  const address = place.address ?? {};
  const first = (...keys: string[]) => keys.map((key) => address[key]).find(Boolean) ?? null;

  const provincia = provinceName(address.state ?? address.region);
  const municipio = municipalityName(first("county", "municipality", "city", "town"));
  // OpenStreetMap files Luanda's urban districts under whichever key the mapper picked
  // (often "suburb"): one named "Distrito ..." is the district, not the bairro.
  const areas = ["suburb", "neighbourhood", "quarter", "city_district", "district", "village", "hamlet"]
    .map((key) => address[key]?.normalize("NFC"))
    .filter((value): value is string => Boolean(value));
  // ...and sometimes it is only in the full address line, not in any key at all.
  const named = [...areas, ...place.display_name.normalize("NFC").split(/\s*,\s*/)].find((value) => /^distrito\b/i.test(value));
  const distrito = named ?? first("city_district", "district")?.normalize("NFC") ?? null;
  // A bairro equal to the município adds nothing ("Talatona, Talatona"): take the next one.
  const bairro =
    areas.find((value) => value !== distrito && normalizeText(value) !== normalizeText(municipio ?? "")) ?? null;
  const road = [address.road, address.house_number].filter(Boolean).join(" ");
  // No street at that point: the place's own name ("Shopping Avennida") is still a
  // better first line than nothing, as long as it isn't just the region again.
  const name = place.name && ![provincia, municipio, bairro].includes(place.name) ? place.name : "";

  return {
    displayName: place.display_name,
    street: road || name,
    bairro,
    distrito,
    municipio,
    provincia,
    latitude: round(Number(place.lat), 6),
    longitude: round(Number(place.lon), 6),
  };
}

// Photon answers with the same OpenStreetMap data under other names: put it in
// Nominatim's shape so toPlace reads both the same way.
function fromPhoton(feature: PhotonFeature): NominatimPlace {
  const p = feature.properties;
  const [lon, lat] = feature.geometry.coordinates;
  const road = [p.street, p.housenumber].filter(Boolean).join(" ");
  const parts = [p.name, road, p.locality, p.district, p.city, p.county, p.state, p.country].filter(
    (part, index, all): part is string => Boolean(part) && all.indexOf(part) === index,
  );

  return {
    lat: String(lat),
    lon: String(lon),
    name: p.name,
    display_name: parts.join(", "),
    address: {
      road: p.street,
      house_number: p.housenumber,
      suburb: p.district ?? p.locality,
      neighbourhood: p.district ? p.locality : undefined,
      city: p.city,
      county: p.county,
      state: p.state,
      country_code: p.countrycode?.toLowerCase(),
    },
  };
}

// The province, município and bairro under their official names (see gazetteer.resolve):
// what a business stores, so it is found when someone picks that município in the app.
function withOfficialNames(place: PlaceDTO): PlaceDTO {
  return { ...place, ...gazetteer.resolve(place) };
}

// Angola, roughly: keeps Photon's search (which has no country filter) inside it.
const ANGOLA_BBOX = "11.4,-18.1,24.1,-4.3";

// Nominatim first; Photon when it fails. Only when both fail does the caller see an error.
async function eitherProvider<T>(primary: () => Promise<T>, fallback: () => Promise<T>): Promise<T> {
  try {
    return await primary();
  } catch (error) {
    return fallback().catch(() => {
      throw error;
    });
  }
}

export const geoService = {
  provinces(): ProvinceDTO[] {
    return gazetteer.provinces();
  },

  // null when `name` isn't one of Angola's provinces.
  municipalities(provinceName: string): MunicipalityDTO[] | null {
    return gazetteer.municipalities(provinceName);
  },

  zones(provinceName: string): ZoneDTO[] | null {
    return gazetteer.zones(provinceName);
  },

  async search(query: string): Promise<PlaceDTO[]> {
    const places = await eitherProvider(
      () => nominatim<NominatimPlace[]>("/search", { q: query.toLowerCase(), countrycodes: COUNTRY_CODES, limit: "5" }),
      async () =>
        (await photon("/api", { q: query.toLowerCase(), bbox: ANGOLA_BBOX, limit: "5" }))
          .filter((feature) => feature.properties.countrycode?.toLowerCase() === COUNTRY_CODES)
          .map(fromPhoton),
    );
    return places.map((place) => withOfficialNames(toPlace(place)));
  },

  // null when OpenStreetMap has nothing at that point (open sea, outside the country).
  async reverse(latitude: number, longitude: number): Promise<PlaceDTO | null> {
    const lat = String(round(latitude, 4));
    const lon = String(round(longitude, 4));
    const place = await eitherProvider(
      () => nominatim<NominatimPlace>("/reverse", { lat, lon, zoom: "18" }),
      async () => {
        const [nearest] = await photon("/reverse", { lat, lon });
        return nearest ? fromPhoton(nearest) : { lat, lon, display_name: "", error: "Unable to geocode" };
      },
    );
    if (place.error || place.address?.country_code !== COUNTRY_CODES) return null;

    // The lookup was rounded for the cache; the answer keeps the exact point asked for.
    return withOfficialNames({ ...toPlace(place), latitude: round(latitude, 6), longitude: round(longitude, 6) });
  },
};
