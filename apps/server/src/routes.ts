import {
  ABILITIES,
  CLASSES,
  CONTENT_VERSION,
  EQUIPMENT_SLOT_LABELS,
  ITEM_CATALOG,
  ITEM_GRADE_DEFINITIONS,
  PROTOCOL_VERSION,
  RACES,
  createCharacterSchema,
  enhanceItemInputSchema,
  equipItemInputSchema,
  getClass,
  loginSchema,
  registerSchema,
  unequipItemInputSchema,
  useItemInputSchema,
  type AccountView,
  type AuthResponse,
  type ConsumableEffect,
  type ItemId,
} from "@neivara/shared";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type { TokenService, AccessClaims } from "./security.js";
import { hashPassword, verifyLoginPassword } from "./security.js";
import { deriveCharacterStats } from "./character-stats.js";
import { assertIdempotencyKey } from "./store/idempotency.js";
import {
  CooldownError,
  ConflictError,
  InsufficientFundsError,
  InvalidOperationError,
  InventoryFullError,
  IdempotencyConflictError,
  InvalidIdempotencyKeyError,
  LimitError,
  NotFoundError,
  type CharacterRecord,
  type GameStore,
  type InventoryState,
  type EnhanceItemResult,
  type UseItemResult,
} from "./store/index.js";

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

function inventoryResponse(character: CharacterRecord, state: InventoryState) {
  return {
    inventory: state.inventory,
    equipment: state.inventory.equipment,
    derivedStats: deriveCharacterStats(
      character.classId,
      character.level,
      state.equipmentStats,
      state.inventory.equipment.main_hand?.itemId,
    ),
  };
}

function idempotentInventoryResponse(
  state: UseItemResult | EnhanceItemResult,
) {
  return {
    inventory: state.inventory,
    equipment: state.inventory.equipment,
    derivedStats: deriveCharacterStats(
      state.characterClassId,
      state.characterLevel,
      state.equipmentStats,
      state.inventory.equipment.main_hand?.itemId,
    ),
  };
}

function readIdempotencyKey(request: FastifyRequest, reply: FastifyReply): string | null {
  const value = request.headers["idempotency-key"];
  if (typeof value !== "string") {
    reply.code(400).send({
      error: "idempotency_key_required",
      message: "Для этой операции требуется заголовок Idempotency-Key",
    });
    return null;
  }
  try {
    assertIdempotencyKey(value);
    return value;
  } catch (error) {
    const message = error instanceof Error ? error.message : "Некорректный Idempotency-Key";
    reply.code(400).send({ error: "invalid_idempotency_key", message });
    return null;
  }
}

function itemOperationError(reply: FastifyReply, error: unknown) {
  if (error instanceof NotFoundError) {
    return reply.code(404).send({ error: "not_found", message: error.message });
  }
  if (error instanceof InsufficientFundsError) {
    return reply.code(402).send({ error: "insufficient_funds", message: error.message });
  }
  if (error instanceof CooldownError) {
    reply.header("Retry-After", Math.max(1, Math.ceil(error.retryAfterMs / 1_000)));
    return reply.code(429).send({
      error: "cooldown_active",
      message: error.message,
      retryAfterMs: error.retryAfterMs,
    });
  }
  if (error instanceof InvalidIdempotencyKeyError) {
    return reply.code(400).send({ error: "invalid_idempotency_key", message: error.message });
  }
  if (error instanceof IdempotencyConflictError) {
    return reply.code(409).send({ error: "idempotency_conflict", message: error.message });
  }
  if (error instanceof InventoryFullError || error instanceof LimitError) {
    return reply.code(422).send({ error: "limit_reached", message: error.message });
  }
  if (error instanceof InvalidOperationError) {
    return reply.code(409).send({ error: "invalid_operation", message: error.message });
  }
  throw error;
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
  inventoryRuntime?: {
    runCharacterOperation<T>(characterId: string, operation: () => Promise<T>): Promise<T>;
    applyInventoryState(
      characterId: string,
      state: InventoryState,
      vitalDeltas?: { hp: number; mp: number },
    ): void;
    mergeRuntimeInventoryState(characterId: string, state: InventoryState): void;
    isCharacterOnline(characterId: string): boolean;
    applyConsumableEffect(
      characterId: string,
      sourceItemId: ItemId,
      effect: ConsumableEffect,
      effectExpiresAt: number | null,
    ): void;
  },
): void {
  app.get("/healthz", async () => ({ status: "ok", service: "neivara-server" }));
  app.get("/readyz", async (_request, reply) => {
    let ready: boolean;
    try {
      ready = await store.checkReadiness();
    } catch {
      return reply.code(503).send({ status: "not_ready" });
    }
    if (!ready) {
      return reply.code(503).send({ status: "not_ready" });
    }
    return { status: "ready" };
  });

  app.get("/v1/catalog", async () => ({
    protocolVersion: PROTOCOL_VERSION,
    contentVersion: CONTENT_VERSION,
    races: RACES,
    classes: CLASSES,
    abilities: ABILITIES,
    items: ITEM_CATALOG,
    equipmentSlots: EQUIPMENT_SLOT_LABELS,
    itemGrades: ITEM_GRADE_DEFINITIONS,
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
      const valid = await verifyLoginPassword(parsed.data.password, account?.passwordHash ?? null);
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
    const operation = async () => {
      const currentCharacter =
        (await store.getCharacterForAccount(character.id, claims.accountId)) ?? character;
      const state = await store.getInventoryState(character.id);
      inventoryRuntime?.mergeRuntimeInventoryState(character.id, state);
      return {
        ...inventoryResponse(currentCharacter, state),
        quest: await store.getQuest(character.id),
      };
    };
    return inventoryRuntime
      ? await inventoryRuntime.runCharacterOperation(character.id, operation)
      : await operation();
  });

  app.post<{
    Params: { id: string; instanceId: string };
  }>(
    "/v1/characters/:id/inventory/:instanceId/equip",
    { config: { rateLimit: { max: 40, timeWindow: "1 minute" } } },
    async (request, reply) => {
    const claims = await authenticate(request, reply, tokens);
    if (!claims) return;
    const character = await store.getCharacterForAccount(request.params.id, claims.accountId);
    if (!character) {
      return reply.code(404).send({ error: "not_found", message: "Персонаж не найден" });
    }
    const body = typeof request.body === "object" && request.body !== null ? request.body : {};
    const parsed = equipItemInputSchema.safeParse({ ...body, instanceId: request.params.instanceId });
    if (!parsed.success) return validationError(reply, parsed.error.issues);
    try {
      const operation = async () => {
        const state = await store.equipItem(character.id, parsed.data.instanceId, parsed.data.slot);
        inventoryRuntime?.applyInventoryState(character.id, state);
        return inventoryResponse(character, state);
      };
      return inventoryRuntime
        ? await inventoryRuntime.runCharacterOperation(character.id, operation)
        : await operation();
    } catch (error) {
      return itemOperationError(reply, error);
    }
    },
  );

  app.post<{
    Params: { id: string; slot: string };
  }>(
    "/v1/characters/:id/equipment/:slot/unequip",
    { config: { rateLimit: { max: 40, timeWindow: "1 minute" } } },
    async (request, reply) => {
    const claims = await authenticate(request, reply, tokens);
    if (!claims) return;
    const character = await store.getCharacterForAccount(request.params.id, claims.accountId);
    if (!character) {
      return reply.code(404).send({ error: "not_found", message: "Персонаж не найден" });
    }
    const parsed = unequipItemInputSchema.safeParse({ slot: request.params.slot });
    if (!parsed.success) return validationError(reply, parsed.error.issues);
    try {
      const operation = async () => {
        const state = await store.unequipItem(character.id, parsed.data.slot);
        inventoryRuntime?.applyInventoryState(character.id, state);
        return inventoryResponse(character, state);
      };
      return inventoryRuntime
        ? await inventoryRuntime.runCharacterOperation(character.id, operation)
        : await operation();
    } catch (error) {
      return itemOperationError(reply, error);
    }
    },
  );

  app.post<{
    Params: { id: string; instanceId: string };
  }>(
    "/v1/characters/:id/inventory/:instanceId/use",
    { config: { rateLimit: { max: 30, timeWindow: "1 minute" } } },
    async (request, reply) => {
    const claims = await authenticate(request, reply, tokens);
    if (!claims) return;
    const character = await store.getCharacterForAccount(request.params.id, claims.accountId);
    if (!character) {
      return reply.code(404).send({ error: "not_found", message: "Персонаж не найден" });
    }
    const body = typeof request.body === "object" && request.body !== null ? request.body : {};
    const parsed = useItemInputSchema.safeParse({ ...body, instanceId: request.params.instanceId });
    if (!parsed.success) return validationError(reply, parsed.error.issues);
    const idempotencyKey = readIdempotencyKey(request, reply);
    if (!idempotencyKey) return;
    try {
      const operation = async () => {
        const outcome = await store.useItem(
          character.id,
          parsed.data.instanceId,
          idempotencyKey,
          parsed.data.quantity,
          inventoryRuntime?.isCharacterOnline(character.id) ?? false,
        );
        const result = outcome.result;
        if (outcome.replayed) {
          inventoryRuntime?.applyInventoryState(character.id, result);
        } else {
          inventoryRuntime?.applyInventoryState(character.id, result, {
            hp: result.restoredHp,
            mp: result.restoredMp,
          });
        }
        inventoryRuntime?.applyConsumableEffect(
          character.id,
          result.sourceItemId,
          result.effect,
          result.effectExpiresAt,
        );
        return { ...idempotentInventoryResponse(result), effect: result };
      };
      return inventoryRuntime
        ? await inventoryRuntime.runCharacterOperation(character.id, operation)
        : await operation();
    } catch (error) {
      return itemOperationError(reply, error);
    }
    },
  );

  app.post<{
    Params: { id: string; instanceId: string };
  }>(
    "/v1/characters/:id/inventory/:instanceId/enhance",
    { config: { rateLimit: { max: 12, timeWindow: "1 minute" } } },
    async (request, reply) => {
    const claims = await authenticate(request, reply, tokens);
    if (!claims) return;
    const character = await store.getCharacterForAccount(request.params.id, claims.accountId);
    if (!character) {
      return reply.code(404).send({ error: "not_found", message: "Персонаж не найден" });
    }
    const parsed = enhanceItemInputSchema.safeParse({ instanceId: request.params.instanceId });
    if (!parsed.success) return validationError(reply, parsed.error.issues);
    const idempotencyKey = readIdempotencyKey(request, reply);
    if (!idempotencyKey) return;
    try {
      const operation = async () => {
        const outcome = await store.enhanceItem(
          character.id,
          parsed.data.instanceId,
          idempotencyKey,
        );
        const result = outcome.result;
        inventoryRuntime?.applyInventoryState(character.id, result);
        return { ...idempotentInventoryResponse(result), enhancement: result };
      };
      return inventoryRuntime
        ? await inventoryRuntime.runCharacterOperation(character.id, operation)
        : await operation();
    } catch (error) {
      return itemOperationError(reply, error);
    }
    },
  );
}
