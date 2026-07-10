import {
  PROTOCOL_VERSION,
  abilityInputSchema,
  chatInputSchema,
  movementInputSchema,
  pickupInputSchema,
  targetInputSchema,
} from "@neivara/shared";
import type { TokenService } from "./security.js";
import type { GameStore } from "./store/index.js";
import { GameWorld, type GameIo } from "./world.js";

function authValue(value: unknown, key: string): unknown {
  return typeof value === "object" && value !== null ? Reflect.get(value, key) : undefined;
}

export function setupRealtime(
  io: GameIo,
  world: GameWorld,
  store: GameStore,
  tokens: TokenService,
): void {
  io.use(async (socket, next) => {
    const token = authValue(socket.handshake.auth, "token");
    const characterId = authValue(socket.handshake.auth, "characterId");
    const protocolVersion = authValue(socket.handshake.auth, "protocolVersion");
    if (
      typeof token !== "string" ||
      typeof characterId !== "string" ||
      protocolVersion !== PROTOCOL_VERSION
    ) {
      next(new Error("Некорректные параметры игрового соединения"));
      return;
    }

    try {
      const claims = await tokens.verify(token);
      const character = await store.getCharacterForAccount(characterId, claims.accountId);
      if (!character) {
        next(new Error("Персонаж не принадлежит этому аккаунту"));
        return;
      }
      socket.data.accountId = claims.accountId;
      socket.data.characterId = character.id;
      socket.data.characterName = character.name;
      Reflect.set(socket.data, "characterRecord", character);
      next();
    } catch {
      next(new Error("Игровая сессия недействительна"));
    }
  });

  io.on("connection", (socket) => {
    const character = Reflect.get(socket.data, "characterRecord");
    void world.join(socket, character).catch(() => socket.disconnect(true));

    socket.on("world:input", (payload) => {
      const parsed = movementInputSchema.safeParse(payload);
      if (parsed.success) world.setInput(socket.id, parsed.data);
    });
    socket.on("world:target", (payload) => {
      const parsed = targetInputSchema.safeParse(payload);
      if (parsed.success) world.setTarget(socket.id, parsed.data.targetId);
    });
    socket.on("combat:use", (payload) => {
      const parsed = abilityInputSchema.safeParse(payload);
      if (parsed.success) world.useAbility(socket.id, parsed.data);
    });
    socket.on("loot:pickup", (payload) => {
      const parsed = pickupInputSchema.safeParse(payload);
      if (parsed.success) void world.pickup(socket.id, parsed.data.lootId);
    });
    socket.on("chat:send", (payload) => {
      const parsed = chatInputSchema.safeParse(payload);
      if (parsed.success) world.chat(socket.id, parsed.data.text);
    });
    socket.on("disconnect", () => {
      void world.leave(socket.id);
    });
  });
}
