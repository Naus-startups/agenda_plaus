import { Platform } from "react-native";
import * as SecureStore from "expo-secure-store";

// As últimas pesquisas feitas neste telemóvel, para se repetirem com um toque.
const STORAGE_KEY = "slotix.recentSearches";
const MAX_RECENT = 6;

async function read(): Promise<string | null> {
  return Platform.OS === "web" ? (globalThis.localStorage?.getItem(STORAGE_KEY) ?? null) : SecureStore.getItemAsync(STORAGE_KEY);
}

async function write(searches: string[]): Promise<void> {
  const value = JSON.stringify(searches);
  if (Platform.OS === "web") globalThis.localStorage?.setItem(STORAGE_KEY, value);
  else await SecureStore.setItemAsync(STORAGE_KEY, value);
}

export async function loadRecentSearches(): Promise<string[]> {
  try {
    const parsed: unknown = JSON.parse((await read()) ?? "[]");
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === "string").slice(0, MAX_RECENT) : [];
  } catch {
    return [];
  }
}

// Guarda a pesquisa à frente das outras (sem a repetir) e devolve a lista nova.
export async function rememberSearch(query: string, current: string[]): Promise<string[]> {
  const next = [query, ...current.filter((item) => item.toLowerCase() !== query.toLowerCase())].slice(0, MAX_RECENT);
  try {
    await write(next);
  } catch {
    // sem armazenamento: a lista vale só até fechar a app
  }
  return next;
}

export async function clearRecentSearches(): Promise<void> {
  try {
    await write([]);
  } catch {
    // nada a limpar
  }
}
