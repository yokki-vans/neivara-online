import {
  ABILITIES,
  CLASSES,
  CONTENT_VERSION,
  PROTOCOL_VERSION,
  RACES,
  createCharacterSchema,
  getClass,
  loginSchema,
  registerSchema,
  type AccountView,
  type AuthResponse,
} from "@neivara/shared";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type { TokenService, AccessClaims } from "./security.js";
import { hashPassword, verifyPassword } from "./security.js";
import { ConflictError, LimitError, type GameStore } from "./store/index.js";

function accountView(account: {
  id: string;
  username: string;
  createdAt: Date;
}): AccountView {
  return {
    id: account.id,
    username: account.username,
    createdAt: account.createdAt.toISOString(),
  };
}

function validationError(reply: FastifyReply, issues: { message: string; path: PropertyKey[] }[]) {
  return reply.code(400).send({
    error: "validation_error",
    message: issues[0]?.message ?? "Некорректные данные",
    fields: issues.map((issue) => ({ path: issue.path.join("."), message: issue.message })),
  });
}

async function authenticate(
  request: FastifyRequest,
  reply: FastifyReply,
  tokens: TokenService,
): Promise<AccessClaims | null> {
  const header = request.headers.authorization;
  if (!header?.startsWith("Bearer ")) {
    await reply.code(401).send({ error: "unauthorized", message: "Требуется вход в аккаунт" });
    return null;
  }

  try {
    return await tokens.verify(header.slice(7));
  } catch {
    await reply.code(401).send({ error: "unauthorized", message: "Сессия истекла" });
    return null;
  }
}

export function registerRoutes(
  app: FastifyInstance,
  store: GameStore,
  tokens: TokenService,
): void {
  app.get("/healthz", async () => ({ status: "ok", service: "neivara-server" }));
  app.get("/readyz", async () => ({ status: "ready" }));

  app.get("/v1/catalog", async () => ({
    protocolVersion: PROTOCOL_VERSION,
    contentVersion: CONTENT_VERSION,
    races: RACES,
    classes: CLASSES,
    abilities: ABILITIES,
    zone: {
      id: "silent_wellspring_vale",
      name: "Долина Тихих Истоков",
      description: "Первый общий регион Нейвары с поселением, охотничьими угодьями и ареной.",
    },
  }));

  app.post(
    "/v1/auth/register",
    { config: { rateLimit: { max: 8, timeWindow: "1 minute" } } },
    async (request, reply) => {
      const parsed = registerSchema.safeParse(request.body);
      if (!parsed.success) return validationError(reply, parsed.error.issues);

      try {
        const passwordHash = await hashPassword(parsed.data.password);
        const account = await store.createAccount(parsed.data.username, passwordHash);
        const response: AuthResponse = {
          token: await tokens.issue({ accountId: account.id, username: account.username }),
          account: accountView(account),
        };
        return reply.code(201).send(response);
      } catch (error) {
        if (error instanceof ConflictError) {
          return reply.code(409).send({ error: "conflict", message: error.message });
        }
        throw error;
      }
    },
  );

  app.post(
    "/v1/auth/login",
    { config: { rateLimit: { max: 12, timeWindow: "1 minute" } } },
    async (request, reply) => {
      const parsed = loginSchema.safeParse(request.body);
      if (!parsed.success) return validationError(reply, parsed.error.issues);

      const account = await store.findAccountByUsername(parsed.data.username);
      const valid = account
        ? await verifyPassword(parsed.data.password, account.passwordHash)
        : false;
      if (!account || !valid) {
        return reply
          .code(401)
          .send({ error: "invalid_credentials", message: "Неверный логин или пароль" });
      }

      const response: AuthResponse = {
        token: await tokens.issue({ accountId: account.id, username: account.username }),
        account: accountView(account),
      };
      return response;
    },
  );

  app.get("/v1/auth/me", async (request, reply) => {
    const claims = await authenticate(request, reply, tokens);
    if (!claims) return;
    return { id: claims.accountId, username: claims.username };
  });

  app.get("/v1/characters", async (request, reply) => {
    const claims = await authenticate(request, reply, tokens);
    if (!claims) return;
    return { characters: await store.listCharacters(claims.accountId) };
  });

  app.post(
    "/v1/characters",
    { config: { rateLimit: { max: 12, timeWindow: "1 minute" } } },
    async (request, reply) => {
      const claims = await authenticate(request, reply, tokens);
      if (!claims) return;

      const parsed = createCharacterSchema.safeParse(request.body);
      if (!parsed.success) return validationError(reply, parsed.error.issues);

      const classDefinition = getClass(parsed.data.classId);
      try {
        const character = await store.createCharacter({
          accountId: claims.accountId,
          name: parsed.data.name,
          race: parsed.data.race,
          classId: parsed.data.classId,
          hp: classDefinition.baseHp,
          mp: classDefinition.baseMp,
        });
        return reply.code(201).send({ character });
      } catch (error) {
        if (error instanceof ConflictError) {
          return reply.code(409).send({ error: "conflict", message: error.message });
        }
        if (error instanceof LimitError) {
          return reply.code(422).send({ error: "limit_reached", message: error.message });
        }
        throw error;
      }
    },
  );

  app.get<{ Params: { id: string } }>("/v1/characters/:id/inventory", async (request, reply) => {
    const claims = await authenticate(request, reply, tokens);
    if (!claims) return;
    const character = await store.getCharacterForAccount(request.params.id, claims.accountId);
    if (!character) {
      return reply.code(404).send({ error: "not_found", message: "Персонаж не найден" });
    }
    return {
      inventory: await store.getInventory(character.id),
      quest: await store.getQuest(character.id),
    };
  });
}
