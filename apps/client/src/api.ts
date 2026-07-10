import type {
  AuthResponse,
  CharacterSummary,
  ClassId,
  DerivedCharacterStats,
  EquipmentLoadout,
  EquipmentSlot,
  GenderId,
  InventoryView,
  QuestProgress,
  RaceId,
} from "@neivara/shared";
import { normalizeCharacterSummary } from "./contentCompatibility";

const configuredApiUrl = import.meta.env.VITE_API_URL?.trim();

function isLoopbackHostname(hostname: string): boolean {
  return hostname === "localhost" || hostname === "[::1]" || /^127(?:\.\d{1,3}){3}$/u.test(hostname);
}

function normalizeApiOrigin(value: string, production: boolean, name: string): string {
  let parsed: URL;
  try {
    parsed = new URL(value.trim());
  } catch {
    throw new Error(`${name} должен быть origin-only HTTP(S) URL`);
  }
  if (
    (parsed.protocol !== "http:" && parsed.protocol !== "https:") ||
    parsed.username ||
    parsed.password ||
    parsed.pathname !== "/" ||
    parsed.search ||
    parsed.hash
  ) {
    throw new Error(`${name} должен быть origin-only HTTP(S) URL`);
  }
  if (production && parsed.protocol !== "https:" && !isLoopbackHostname(parsed.hostname)) {
    throw new Error(`${name} должен использовать HTTPS в production`);
  }
  return parsed.origin;
}

export function resolveApiUrl(
  configured: string | undefined,
  production: boolean,
  browserOrigin: string | undefined,
): string {
  const explicit = configured?.trim();
  if (explicit) return normalizeApiOrigin(explicit, production, "VITE_API_URL");
  if (production) {
    if (!browserOrigin) {
      throw new Error("Browser origin is required for the unified production service");
    }
    return normalizeApiOrigin(browserOrigin, true, "Browser origin");
  }
  return "http://localhost:3001";
}

export const API_URL = resolveApiUrl(
  configuredApiUrl,
  import.meta.env.PROD,
  typeof window === "undefined" ? undefined : window.location.origin,
);

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

async function request<T>(path: string, init: RequestInit = {}, token?: string): Promise<T> {
  const headers = new Headers(init.headers);
  headers.set("Content-Type", "application/json");
  if (token) headers.set("Authorization", `Bearer ${token}`);

  let response: Response;
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), 15_000);
  try {
    response = await fetch(`${API_URL}${path}`, { ...init, headers, signal: controller.signal });
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") {
      throw new ApiError("Сервер не ответил вовремя. Повторите действие.", 0);
    }
    throw new ApiError("Сервер недоступен. Проверьте адрес API и подключение.", 0);
  } finally {
    window.clearTimeout(timeout);
  }

  const body = (await response.json().catch(() => ({}))) as { message?: string };
  if (!response.ok) {
    throw new ApiError(body.message ?? `Ошибка сервера (${response.status})`, response.status);
  }
  return body as T;
}

export interface InventoryApiResponse {
  inventory: InventoryView;
  equipment: EquipmentLoadout;
  derivedStats: DerivedCharacterStats;
  quest?: QuestProgress;
}

export interface UseItemApiResponse extends InventoryApiResponse {
  effect: {
    restoredHp: number;
    restoredMp: number;
  };
}

export interface EnhanceItemApiResponse extends InventoryApiResponse {
  enhancement: {
    success: boolean;
    previousLevel: number;
    enhancementLevel: number;
    downgraded: boolean;
    chanceBps: number;
  };
}

export const api = {
  register(username: string, password: string) {
    return request<AuthResponse>("/v1/auth/register", {
      method: "POST",
      body: JSON.stringify({ username, password }),
    });
  },
  login(username: string, password: string) {
    return request<AuthResponse>("/v1/auth/login", {
      method: "POST",
      body: JSON.stringify({ username, password }),
    });
  },
  listCharacters(token: string) {
    return request<{ characters: CharacterSummary[] }>("/v1/characters", {}, token).then(
      ({ characters }) => ({ characters: characters.map(normalizeCharacterSummary) }),
    );
  },
  createCharacter(
    token: string,
    input: { name: string; race: RaceId; gender: GenderId; classId: ClassId },
  ) {
    return request<{ character: CharacterSummary }>(
      "/v1/characters",
      { method: "POST", body: JSON.stringify(input) },
      token,
    ).then(({ character }) => ({ character: normalizeCharacterSummary(character) }));
  },
  getInventory(token: string, characterId: string) {
    return request<InventoryApiResponse>(
      `/v1/characters/${encodeURIComponent(characterId)}/inventory`,
      {},
      token,
    );
  },
  equipItem(token: string, characterId: string, instanceId: string, slot?: EquipmentSlot) {
    return request<InventoryApiResponse>(
      `/v1/characters/${encodeURIComponent(characterId)}/inventory/${encodeURIComponent(instanceId)}/equip`,
      { method: "POST", body: JSON.stringify(slot ? { slot } : {}) },
      token,
    );
  },
  unequipItem(token: string, characterId: string, slot: EquipmentSlot) {
    return request<InventoryApiResponse>(
      `/v1/characters/${encodeURIComponent(characterId)}/equipment/${encodeURIComponent(slot)}/unequip`,
      { method: "POST", body: "{}" },
      token,
    );
  },
  useItem(token: string, characterId: string, instanceId: string, idempotencyKey: string) {
    return request<UseItemApiResponse>(
      `/v1/characters/${encodeURIComponent(characterId)}/inventory/${encodeURIComponent(instanceId)}/use`,
      { method: "POST", body: "{}", headers: { "Idempotency-Key": idempotencyKey } },
      token,
    );
  },
  enhanceItem(token: string, characterId: string, instanceId: string, idempotencyKey: string) {
    return request<EnhanceItemApiResponse>(
      `/v1/characters/${encodeURIComponent(characterId)}/inventory/${encodeURIComponent(instanceId)}/enhance`,
      { method: "POST", body: "{}", headers: { "Idempotency-Key": idempotencyKey } },
      token,
    );
  },
};
