import * as SecureStore from "expo-secure-store";
import { Platform } from "react-native";
import type { ApiListResponse, ApiResponse, PaginationMeta } from "@slotix/types";

// The web build runs in a browser, so the API must allow its origin (CORS). The deployed
// API doesn't allow localhost, so while developing the web build talks to the local API
// instead; the native app keeps using EXPO_PUBLIC_API_URL.
const API_URL =
  Platform.OS === "web" && __DEV__
    ? (process.env.EXPO_PUBLIC_WEB_API_URL ?? "http://localhost:3000/api/v1")
    : (process.env.EXPO_PUBLIC_API_URL ?? "http://localhost:3000/api/v1");
const ACCESS_TOKEN_KEY = "slotix.accessToken";
const REFRESH_TOKEN_KEY = "slotix.refreshToken";

let accessToken: string | null = null;
let refreshToken: string | null = null;

// expo-secure-store has no web implementation (every call throws there), so the web build
// keeps the tokens in localStorage instead.
const tokenStorage = {
  async get(key: string): Promise<string | null> {
    if (Platform.OS !== "web") return SecureStore.getItemAsync(key);
    try {
      return globalThis.localStorage?.getItem(key) ?? null;
    } catch {
      return null;
    }
  },
  async set(key: string, token: string | null): Promise<void> {
    if (Platform.OS !== "web") {
      if (token) await SecureStore.setItemAsync(key, token);
      else await SecureStore.deleteItemAsync(key);
      return;
    }
    try {
      if (token) globalThis.localStorage?.setItem(key, token);
      else globalThis.localStorage?.removeItem(key);
    } catch {
      // storage unavailable (private mode, static render): the session just won't persist
    }
  },
};

export async function loadStoredAccessToken(): Promise<string | null> {
  [accessToken, refreshToken] = await Promise.all([tokenStorage.get(ACCESS_TOKEN_KEY), tokenStorage.get(REFRESH_TOKEN_KEY)]);
  return accessToken;
}

export function getApiUrl(): string {
  return API_URL;
}

export function getAccessToken(): string | null {
  return accessToken;
}

export function getRefreshToken(): string | null {
  return refreshToken;
}

// A new session (login, sign-up, Google/Apple): both tokens are kept, so the session
// outlives the access token's 15 minutes.
export async function setSession(tokens: { accessToken: string; refreshToken: string }): Promise<void> {
  accessToken = tokens.accessToken;
  refreshToken = tokens.refreshToken;
  await Promise.all([tokenStorage.set(ACCESS_TOKEN_KEY, accessToken), tokenStorage.set(REFRESH_TOKEN_KEY, refreshToken)]);
}

// null ends the session on this device (logout, or a session the server refused).
export async function setAccessToken(token: string | null): Promise<void> {
  accessToken = token;
  await tokenStorage.set(ACCESS_TOKEN_KEY, token);
  if (token === null) {
    refreshToken = null;
    await tokenStorage.set(REFRESH_TOKEN_KEY, null);
  }
}

export class ApiRequestError extends Error {
  constructor(public code: string, message: string, public statusCode: number) {
    super(message);
  }
}

// Told when the session is over for good (the refresh token itself was refused), so the
// app can show the login screen instead of failing every request.
const sessionEndedListeners = new Set<() => void>();
export function onSessionEnded(listener: () => void): () => void {
  sessionEndedListeners.add(listener);
  return () => sessionEndedListeners.delete(listener);
}

/*
 * Swaps the refresh token for a new pair. The API rotates refresh tokens (the old one stops
 * working once used), so concurrent 401s must share ONE refresh: a second call with the
 * same token would be seen as a stolen token and end every session of the account.
 * Resolves true when there is a fresh access token to retry with.
 */
let pendingRefresh: Promise<boolean> | null = null;

export function refreshSession(): Promise<boolean> {
  if (pendingRefresh) return pendingRefresh;
  const presented = refreshToken;
  if (!presented) return Promise.resolve(false);

  pendingRefresh = (async () => {
    try {
      const response = await fetch(`${API_URL}/auth/refresh`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ refreshToken: presented }),
      });
      const body = (await response.json().catch(() => null)) as ApiResponse<{ accessToken: string; refreshToken: string }> | null;
      if (response.ok && body?.success) {
        await setSession(body.data);
        return true;
      }
      // Only a refused refresh token ends the session; a busy or unreachable API (429, 5xx)
      // says nothing about it, and the next request tries again.
      if (response.status === 401 || response.status === 400) {
        await setAccessToken(null);
        for (const listener of sessionEndedListeners) listener();
      }
      return false;
    } catch {
      return false;
    } finally {
      pendingRefresh = null;
    }
  })();
  return pendingRefresh;
}

function send(path: string, options: RequestInit): Promise<Response> {
  return fetch(`${API_URL}${path}`, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
      ...options.headers,
    },
  });
}

// An expired access token (401 on a signed-in request) is renewed once and the request
// sent again. The /auth/ endpoints are left alone: a 401 there is a wrong password or an
// invalid sign-in, not an expired session.
async function request(path: string, options: RequestInit = {}): Promise<Response> {
  const response = await send(path, options);
  if (response.status !== 401 || !accessToken || path.startsWith("/auth/")) return response;
  return (await refreshSession()) ? send(path, options) : response;
}

export async function apiFetch<T>(path: string, options: RequestInit = {}): Promise<T> {
  const response = await request(path, options);
  const body = (await response.json()) as ApiResponse<T>;

  if (!body.success) {
    throw new ApiRequestError(body.error.code, body.error.message, response.status);
  }

  return body.data;
}

// For endpoints returning the {data, meta} paginated envelope (GET /businesses, /search,
// etc.) rather than a single item — apiFetch alone would silently drop `meta`.
export async function apiFetchList<T>(path: string, options: RequestInit = {}): Promise<{ data: T[]; meta: PaginationMeta }> {
  const response = await request(path, options);
  const body = (await response.json()) as ApiListResponse<T>;

  if (!body.success) {
    throw new ApiRequestError(body.error.code, body.error.message, response.status);
  }

  return { data: body.data, meta: body.meta };
}

// Builds a URLSearchParams-style query string, skipping undefined values so callers can
// pass a plain object of optional filters (a BusinessListQuery, SearchQuery, etc.)
// without manually filtering it first. `object` (not Record<string, ...>) as the
// parameter type so named DTO interfaces — which have no index signature — are accepted
// directly, without TS's implicit-index-signature restriction rejecting the call.
export function buildQuery(params: object): string {
  const entries = Object.entries(params as Record<string, unknown>).filter(
    (entry): entry is [string, string | number | boolean] => entry[1] !== undefined,
  );
  if (entries.length === 0) return "";
  return `?${entries.map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(String(value))}`).join("&")}`;
}
