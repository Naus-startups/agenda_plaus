import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { Platform } from "react-native";
import * as Location from "expo-location";
import * as SecureStore from "expo-secure-store";
import { distanceBetweenKm, formatLocation } from "@slotix/types";

import { reversePlace } from "@/services/localities";
import { getCoordinatesIfAllowed, type Coordinates } from "@/services/location";
import { saveMyLocation } from "@/services/users";
import { useAuth } from "./AuthContext";
import { usePreferences } from "./PreferencesContext";
import { useT } from "@/i18n";

// "Perto de si" mostra só os espaços até esta distância de onde a pessoa está agora
// (a Home, o Explorar e o filtro de localização usam todos o mesmo raio).
export const NEAR_ME_RADIUS_KM = 5;

const STORAGE_KEY = "slotix.location";

// Uma área escolhida: a província e, dentro dela, o município e o bairro (cada nível é
// opcional — "Luanda", "Talatona, Luanda" ou "Benfica, Talatona"). `center` é o ponto do
// nível mais fino escolhido, quando o mapa o tem.
export interface Area {
  provincia: string | null;
  municipio?: string | null;
  bairro?: string | null;
  center?: Coordinates | null;
}

interface LocationContextValue {
  // null = todas as províncias.
  provincia: string | null;
  // O município escolhido dentro da província.
  municipio: string | null;
  // O bairro escolhido dentro do município.
  bairro: string | null;
  // O ponto do município ou bairro escolhido (para enquadrar o mapa e achar os espaços perto).
  center: Coordinates | null;
  nearMe: boolean;
  coordinates: Coordinates | null;
  // Onde a pessoa está agora, por extenso ("Cacuaco, Luanda"); null enquanto não se sabe.
  place: string | null;
  // Falso até a pessoa escolher a sua localização pela primeira vez (ecrã a seguir ao cadastro).
  chosen: boolean;
  // Verdadeiro depois de a escolha guardada no telemóvel ter sido lida.
  loaded: boolean;
  // "Perto de si", "Benfica, Talatona", "Talatona, Luanda", só "Luanda" ou "Todas as localidades".
  label: string;
  setProvincia: (provincia: string | null) => void;
  // Escolhe uma área (província, município e bairro de uma vez).
  setArea: (area: Area) => void;
  // Liga "Perto de si" (pede a localização). Devolve false se não foi possível obtê-la.
  chooseNearMe: () => Promise<boolean>;
  // Pede a localização ao telemóvel (com o pedido de autorização). null se não der.
  requestPosition: () => Promise<Coordinates | null>;
}

const LocationContext = createContext<LocationContextValue | undefined>(undefined);

// expo-secure-store não existe no browser, por isso na versão web usa-se o localStorage.
async function readStored(): Promise<string | null> {
  try {
    if (Platform.OS === "web") return globalThis.localStorage?.getItem(STORAGE_KEY) ?? null;
    return await SecureStore.getItemAsync(STORAGE_KEY);
  } catch {
    return null;
  }
}

type StoredArea = { provincia: string | null; municipio: string | null; bairro: string | null; center: Coordinates | null };

function writeStored(value: StoredArea): void {
  const text = JSON.stringify(value);
  try {
    if (Platform.OS === "web") globalThis.localStorage?.setItem(STORAGE_KEY, text);
    else void SecureStore.setItemAsync(STORAGE_KEY, text);
  } catch {
    // sem armazenamento disponível: a escolha vale só até fechar a app
  }
}

// Sem província não há município nem bairro; o ponto só vale com um município ou bairro.
function cleanArea(area: Area): StoredArea {
  const provincia = area.provincia ?? null;
  const municipio = provincia ? (area.municipio ?? null) : null;
  const bairro = provincia ? (area.bairro ?? null) : null;
  return { provincia, municipio, bairro, center: municipio || bairro ? (area.center ?? null) : null };
}

// A área em duas partes, da mais fina para a de cima: "Benfica, Talatona", "Talatona,
// Luanda", "Luanda". null para "Todas as localidades".
export function areaLabel(area: Area): string | null {
  if (!area.provincia) return null;
  return [area.bairro, area.municipio, area.provincia].filter(Boolean).slice(0, 2).join(", ");
}

// A localização escolhida é partilhada pelos ecrãs e fica guardada no telemóvel: é a
// província, o município e o bairro que a pessoa indicou ao criar a conta (e pode mudar a
// qualquer momento, por exemplo no mapa).
export function LocationProvider({ children }: { children: React.ReactNode }) {
  const t = useT();
  const [area, setAreaState] = useState<StoredArea>({ provincia: null, municipio: null, bairro: null, center: null });
  const { provincia, municipio, bairro, center } = area;
  const { user } = useAuth();
  const userId = user?.id;
  // Com a localização desligada no Perfil, a app não lê o GPS nem guarda a posição.
  const { preferences, loaded: preferencesLoaded } = usePreferences();
  const locationAllowed = preferences.location;
  const lastSaved = useRef<Coordinates | null>(null);
  const [nearMe, setNearMe] = useState(false);
  const [coordinates, setCoordinates] = useState<Coordinates | null>(null);
  const [place, setPlace] = useState<string | null>(null);
  const [chosen, setChosen] = useState(false);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    void readStored().then((stored) => {
      try {
        // Guardado por versões anteriores: sem município, e `bairro` era uma "zona" (um
        // município ou um bairro) — continua a valer como bairro.
        const saved = stored ? (JSON.parse(stored) as Partial<StoredArea>) : null;
        if (saved) {
          setAreaState(cleanArea({ provincia: saved.provincia ?? null, municipio: saved.municipio, bairro: saved.bairro, center: saved.center }));
          setChosen(true);
        }
      } catch {
        // valor guardado ilegível: fica a localização por omissão
      }
      setLoaded(true);
    });
  }, []);

  // Quem já autorizou a localização tem a posição lida logo ao abrir a app (sem pedido
  // nenhum), para todos os ecrãs mostrarem a distância até cada espaço. A posição fica só
  // na memória da app e segue nos pedidos que a usam; nunca é guardada.
  useEffect(() => {
    if (!preferencesLoaded) return;

    if (!locationAllowed) {
      setCoordinates(null);
      setNearMe(false);
      return;
    }

    void getCoordinatesIfAllowed().then((current) => {
      if (current) setCoordinates(current);
    });
  }, [preferencesLoaded, locationAllowed]);

  // Depois de autorizada, a posição acompanha a pessoa: o GPS avisa a cada ~50 m que ela
  // se desloca, e "Perto de ti" passa a mostrar os espaços à volta do sítio onde está agora.
  const [permissionGranted, setPermissionGranted] = useState(false);
  useEffect(() => {
    if (!preferencesLoaded || !locationAllowed) {
      setPermissionGranted(false);
      return;
    }
    void Location.getForegroundPermissionsAsync()
      .then(({ status }) => setPermissionGranted(status === "granted"))
      .catch(() => setPermissionGranted(false));
  }, [preferencesLoaded, locationAllowed]);

  useEffect(() => {
    if (!permissionGranted) return;

    let subscription: Location.LocationSubscription | null = null;
    let cancelled = false;
    Location.watchPositionAsync({ accuracy: Location.Accuracy.High, distanceInterval: 50, timeInterval: 10000 }, (position) =>
      setCoordinates({ latitude: position.coords.latitude, longitude: position.coords.longitude }),
    )
      .then((watch) => {
        if (cancelled) watch.remove();
        else subscription = watch;
      })
      .catch(() => {
        // sem GPS disponível: fica a última posição conhecida
      });

    return () => {
      cancelled = true;
      subscription?.remove();
    };
  }, [permissionGranted]);

  // O nome do sítio onde a pessoa está (bairro ou município, e província), para o Perfil
  // mostrar a localização real. Só volta a perguntar quando a pessoa mudou de sítio
  // (~100 m): as coordenadas são arredondadas a três casas.
  const placeLatitude = coordinates ? Number(coordinates.latitude.toFixed(3)) : null;
  const placeLongitude = coordinates ? Number(coordinates.longitude.toFixed(3)) : null;
  useEffect(() => {
    if (placeLatitude === null || placeLongitude === null || !userId) {
      setPlace(null);
      return;
    }

    let cancelled = false;
    reversePlace({ latitude: placeLatitude, longitude: placeLongitude })
      .then((found) => {
        if (cancelled) return;
        const text = found ? formatLocation({ bairro: found.bairro ?? found.municipio, provincia: found.provincia }) : "";
        setPlace(text || null);
      })
      .catch(() => {
        if (!cancelled) setPlace(null);
      });

    return () => {
      cancelled = true;
    };
  }, [placeLatitude, placeLongitude, userId]);

  // A posição da pessoa fica também guardada no servidor (na conta dela), para a distância
  // aos espaços continuar a aparecer quando o telemóvel não dá uma leitura nova. Só volta
  // a enviar quando a pessoa se deslocou — não a cada leitura do GPS.
  useEffect(() => {
    if (!userId || !coordinates) return;
    if (lastSaved.current && distanceBetweenKm(lastSaved.current, coordinates) < 0.1) return;

    void saveMyLocation(coordinates).then((saved) => {
      if (saved) lastSaved.current = coordinates;
    });
  }, [userId, coordinates]);

  const setArea = useCallback((next: Area) => {
    const cleaned = cleanArea(next);
    setAreaState(cleaned);
    setNearMe(false);
    setChosen(true);
    writeStored(cleaned);
  }, []);

  const readPosition = useCallback(async (): Promise<Coordinates | null> => {
    if (!locationAllowed) return null;
    try {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== "granted") return null;

      const position = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.High });
      const current = { latitude: position.coords.latitude, longitude: position.coords.longitude };
      setCoordinates(current);
      setPermissionGranted(true);
      return current;
    } catch {
      return null;
    }
  }, [locationAllowed]);

  const chooseNearMe = useCallback(async () => {
    const current = coordinates ?? (await readPosition());
    if (!current) return false;

    setAreaState((current) => ({ ...current, municipio: null, bairro: null, center: null }));
    setNearMe(true);
    return true;
  }, [coordinates, readPosition]);

  const setProvincia = useCallback((next: string | null) => setArea({ provincia: next }), [setArea]);

  const value = useMemo(
    () => ({
      provincia,
      municipio,
      bairro,
      center,
      nearMe,
      coordinates,
      place,
      chosen,
      loaded,
      label: nearMe ? t("Perto de si") : areaLabel(area) ?? t("Todas as localidades"),
      setProvincia,
      setArea,
      chooseNearMe,
      requestPosition: readPosition,
    }),
    [area, provincia, municipio, bairro, center, nearMe, coordinates, place, chosen, loaded, setProvincia, setArea, chooseNearMe, readPosition, t],
  );

  return <LocationContext.Provider value={value}>{children}</LocationContext.Provider>;
}

export function useSelectedLocation(): LocationContextValue {
  const t = useT();
  const context = useContext(LocationContext);
  if (!context) throw new Error(t("useSelectedLocation tem de ser usado dentro de um LocationProvider."));
  return context;
}
