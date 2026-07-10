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
import {
  ActiveSocketRegistry,
  RealtimeRateGuard,
  type RealtimeEventName,
} from "./realtime-security.js";

function authValue(value: unknown, key: string): unknown {
  return typeof value === "object" && value !== null ? Reflect.get(value, key) : undefined;
}

export function setupRealtime(
  io: GameIo,
  world: GameWorld,
  store: GameStore,
  tokens: TokenService,
  options: { maxSocketsPerAccount: number } = { maxSocketsPerAccount: 3 },
): void {
  const sockets = new ActiveSocketRegistry();

  io.use(async (socket, next) => {
    const token = authValue(socket.handshake.auth, "token");
    const characterId = authValue(socket.handshake.auth, "characterId");
    const protocolVersion = authValue(socket.handshake.auth, "protocolVersion");
    if (protocolVersion !== PROTOCOL_VERSION) {
      next(new Error(`Версия клиента устарела. Обновите страницу (протокол ${PROTOCOL_VERSION}).`));
      return;
    }
    if (typeof token !== "string" || typeof characterId !== "string") {
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
      const reservation = sockets.reserve(
        socket.id,
        claims.accountId,
        character.id,
        options.maxSocketsPerAccount,
      );
      if (!reservation.accepted) {
        next(new Error("Достигнут лимит одновременных игровых соединений аккаунта"));
        return;
      }
      Reflect.set(socket.data, "replacesSocketId", reservation.replacesSocketId);
      socket.once("disconnect", () => sockets.release(socket.id));
      next();
    } catch {
      next(new Error("Игровая сессия недействительна"));
    }
  });

  io.on("connection", (socket) => {
    const replacedSocketId = Reflect.get(socket.data, "replacesSocketId");
    if (typeof replacedSocketId === "string" && replacedSocketId !== socket.id) {
      io.sockets.sockets.get(replacedSocketId)?.disconnect(true);
    }
    const character = Reflect.get(socket.data, "characterRecord");
    const joining = world.join(socket, character);
    void joining.catch(() => socket.disconnect(true));

    const rateGuard = new RealtimeRateGuard();
    const permit = (event: RealtimeEventName): boolean => {
      const decision = rateGuard.check(event);
      if (decision.disconnect) socket.disconnect(true);
      return decision.allowed;
    };

    socket.on("world:input", (payload) => {
      if (!permit("world:input")) return;
      const parsed = movementInputSchema.safeParse(payload);
      if (parsed.success) world.setInput(socket.id, parsed.data);
    });
    socket.on("world:target", (payload) => {
      if (!permit("world:target")) return;
      const parsed = targetInputSchema.safeParse(payload);
      if (parsed.success) world.setTarget(socket.id, parsed.data.targetId);
    });
    socket.on("combat:use", (payload) => {
      if (!permit("combat:use")) return;
      const parsed = abilityInputSchema.safeParse(payload);
      if (parsed.success) world.useAbility(socket.id, parsed.data);
    });
    socket.on("loot:pickup", (payload) => {
      if (!permit("loot:pickup")) return;
      const parsed = pickupInputSchema.safeParse(payload);
      if (parsed.success) {
        void world.pickup(socket.id, parsed.data.lootId).catch(() => socket.disconnect(true));
      }
    });
    socket.on("chat:send", (payload) => {
      if (!permit("chat:send")) return;
      const parsed = chatInputSchema.safeParse(payload);
      if (parsed.success) world.chat(socket.id, parsed.data.text);
    });
    socket.on("disconnect", () => {
      void joining
        .then(() => world.leave(socket.id))
        .catch(() => undefined);
    });
  });
}
