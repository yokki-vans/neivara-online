import type { AuthResponse, CharacterSummary, ClassId, RaceId } from "@neivara/shared";

export const API_URL = (import.meta.env.VITE_API_URL ?? "http://localhost:3001").replace(/\/$/, "");

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
  try {
    response = await fetch(`${API_URL}${path}`, { ...init, headers });
  } catch {
    throw new ApiError("Сервер недоступен. Проверьте адрес API и подключение.", 0);
  }

  const body = (await response.json().catch(() => ({}))) as { message?: string };
  if (!response.ok) {
    throw new ApiError(body.message ?? `Ошибка сервера (${response.status})`, response.status);
  }
  return body as T;
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
    return request<{ characters: CharacterSummary[] }>("/v1/characters", {}, token);
  },
  createCharacter(
    token: string,
    input: { name: string; race: RaceId; classId: ClassId },
  ) {
    return request<{ character: CharacterSummary }>(
      "/v1/characters",
      { method: "POST", body: JSON.stringify(input) },
      token,
    );
  },
};
