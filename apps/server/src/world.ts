import { randomInt, randomUUID } from "node:crypto";
import {
  ABILITIES,
  ITEMS,
  MONSTER_DEFINITIONS,
  PROTOCOL_VERSION,
  STARTER_ZONE,
  getClass,
  levelFromTotalXp,
  normalizeItemStats,
  type AbilityUseResult,
  type AbilityId,
  type ChatMessage,
  type ClientToServerEvents,
  type CombatEvent,
  type ConsumableEffect,
  type InterServerEvents,
  type InventoryStack,
  type InventoryView,
  type ItemId,
  type ItemStats,
  type ItemStatBlock,
  type LootSnapshot,
  type MonsterSnapshot,
  type MovementInput,
  type PlayerSnapshot,
  type QuestProgress,
  type ServerToClientEvents,
  type SocketData,
  type SystemMessage,
  type UseAbilityInput,
  type Vec3,
  type WorldSnapshot,
} from "@neivara/shared";
import type { Server, Socket } from "socket.io";
import { CharacterOperationQueue } from "./character-operation-queue.js";
import { deriveCharacterStats, type DerivedCharacterStats } from "./character-stats.js";
import {
  IdempotencyConflictError,
  inventoryStacks,
  type CharacterRecord,
  type GameStore,
  type InventoryState,
} from "./store/index.js";

export type GameIo = Server<
  ClientToServerEvents,
  ServerToClientEvents,
  InterServerEvents,
  SocketData
>;
export type GameSocket = Socket<
  ClientToServerEvents,
  ServerToClientEvents,
  InterServerEvents,
  SocketData
>;

interface RuntimePlayer extends PlayerSnapshot {
  socketId: string;
  accountId: string;
  inventory: InventoryStack[];
  inventoryView: InventoryView;
  equipmentStats: ItemStatBlock;
  derivedStats: DerivedCharacterStats;
  quest: QuestProgress;
  input: MovementInput;
  lastProcessedInput: number;
  cooldowns: Map<AbilityId, number>;
  damageReductionUntil: number;
  activeBuffs: Array<{ sourceItemId: ItemId; stats: ItemStats; expiresAt: number }>;
  respawnAt: number | null;
  lastPersistAt: number;
  lastChatAt: number;
  /** Durable balance acknowledged by the store; gold may include unflushed world rewards. */
  persistedGold: number;
  pendingGoldFlush: { operationId: string; goldDelta: number } | null;
}

interface RuntimeMonster extends MonsterSnapshot {
  spawn: Vec3;
  speed: number;
  attackPower: number;
  aggroRange: number;
  attackRange: number;
  attackCooldownMs: number;
  lastAttackAt: number;
}

interface RuntimeLoot extends LootSnapshot {
  audit: {
    sourceMonsterId: string;
    sourceMonsterKind: RuntimeMonster["kind"];
    sourceMonsterElite: boolean;
    rareRoll: number;
    rareChanceBps: number;
    quantityRoll: number;
    quantityBonusChanceBps: number;
  };
}

interface RuntimeResumeState {
  expiresAt: number;
  cooldowns: Map<AbilityId, number>;
  damageReductionUntil: number;
  activeBuffs: RuntimePlayer["activeBuffs"];
  alive: boolean;
  respawnAt: number | null;
}

type DamageTarget =
  | { kind: "player"; value: RuntimePlayer }
  | { kind: "monster"; value: RuntimeMonster };

const TICK_MS = 50;
const SNAPSHOT_EVERY_TICKS = 2;
const PERSIST_EVERY_MS = 10_000;
const RESUME_TTL_MS = 2 * 60_000;
const MAX_RESUME_STATES = 5_000;
const WORLD_LIMIT = 48;
const SPAWN: Vec3 = { x: 0, y: 0, z: 0 };
const ARENA_CENTER = { x: 29, z: 27 };
const ARENA_RADIUS = 10;

interface MonsterSpawnPocket {
  kind: RuntimeMonster["kind"];
  positions: readonly (readonly [x: number, z: number])[];
}

const MONSTER_SPAWN_POCKETS: readonly MonsterSpawnPocket[] = [
  {
    kind: "thorn_prowler",
    positions: [[-17, -8], [-22, -4], [-19, 3], [-13, -3]],
  },
  {
    kind: "moss_mauler",
    positions: [[-8, 18], [-1, 22], [6, 19]],
  },
  {
    kind: "cave_shrieker",
    positions: [[-31, 11], [-35, 17], [-28, 22]],
  },
  {
    kind: "bramble_boar",
    positions: [[13, -18], [19, -22], [24, -14], [9, -25]],
  },
  {
    kind: "ruin_sentinel",
    positions: [[-34, 30]],
  },
  {
    kind: "ember_drake",
    positions: [[35, -31]],
  },
];

function distance2d(a: Vec3, b: Vec3): number {
  return Math.hypot(a.x - b.x, a.z - b.z);
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function normalizedDirection(direction: { x: number; z: number }): { x: number; z: number } {
  const length = Math.hypot(direction.x, direction.z);
  if (length <= 0.0001) return { x: 0, z: 0 };
  return { x: direction.x / Math.max(1, length), z: direction.z / Math.max(1, length) };
}

function playerStats(player: RuntimePlayer, now = Date.now()) {
  return deriveCharacterStats(
    player.classId,
    player.level,
    effectiveItemStats(player, now),
    player.inventoryView.equipment.main_hand?.itemId,
  );
}

function effectiveItemStats(player: RuntimePlayer, now = Date.now()): ItemStatBlock {
  const result = { ...player.equipmentStats };
  for (const buff of player.activeBuffs) {
    if (buff.expiresAt <= now) continue;
    const stats = normalizeItemStats(buff.stats);
    for (const key of Object.keys(result) as Array<keyof ItemStatBlock>) {
      result[key] += stats[key];
    }
  }
  return result;
}

function refreshDerivedStats(player: RuntimePlayer, now = Date.now()): void {
  player.derivedStats = deriveCharacterStats(
    player.classId,
    player.level,
    effectiveItemStats(player, now),
    player.inventoryView.equipment.main_hand?.itemId,
  );
  player.maxHp = player.derivedStats.maxHp;
  player.maxMp = player.derivedStats.maxMp;
  player.hp = clamp(player.hp, 0, player.maxHp);
  player.mp = clamp(player.mp, 0, player.maxMp);
}

function publicEquipment(inventory: InventoryView): PlayerSnapshot["equipment"] {
  return Object.fromEntries(
    Object.entries(inventory.equipment)
      .filter((entry): entry is [string, NonNullable<(typeof entry)[1]>] => Boolean(entry[1]))
      .map(([slot, item]) => [slot, item.itemId]),
  ) as PlayerSnapshot["equipment"];
}

function publicPlayer(player: RuntimePlayer): PlayerSnapshot {
  return {
    id: player.id,
    name: player.name,
    race: player.race,
    gender: player.gender,
    classId: player.classId,
    position: { ...player.position },
    rotationY: player.rotationY,
    level: player.level,
    xp: player.xp,
    hp: Math.round(player.hp),
    maxHp: player.maxHp,
    mp: Math.round(player.mp),
    maxMp: player.maxMp,
    gold: player.gold,
    alive: player.alive,
    pvpEnabled: player.pvpEnabled,
    targetId: player.targetId,
    equipment: publicEquipment(player.inventoryView),
  };
}

function publicMonster(monster: RuntimeMonster): MonsterSnapshot {
  return {
    id: monster.id,
    kind: monster.kind,
    name: monster.name,
    position: { ...monster.position },
    rotationY: monster.rotationY,
    level: monster.level,
    hp: Math.round(monster.hp),
    maxHp: monster.maxHp,
    alive: monster.alive,
    elite: monster.elite,
    targetId: monster.targetId,
    respawnAt: monster.respawnAt,
  };
}

function publicLoot(drop: RuntimeLoot): LootSnapshot {
  return {
    id: drop.id,
    itemId: drop.itemId,
    name: drop.name,
    quantity: drop.quantity,
    position: { ...drop.position },
    ownerId: drop.ownerId,
    publicAt: drop.publicAt,
    expiresAt: drop.expiresAt,
  };
}

function createMonster(
  kind: RuntimeMonster["kind"],
  x: number,
  z: number,
): RuntimeMonster {
  const definition = MONSTER_DEFINITIONS[kind];
  const position = { x, y: 0, z };
  return {
    id: randomUUID(),
    kind,
    name: definition.name,
    position: { ...position },
    spawn: { ...position },
    rotationY: 0,
    level: definition.level,
    hp: definition.maxHp,
    maxHp: definition.maxHp,
    alive: true,
    elite: definition.elite,
    targetId: null,
    respawnAt: null,
    speed: definition.speed,
    attackPower: definition.attackPower,
    aggroRange: definition.aggroRange,
    attackRange: definition.attackRange,
    attackCooldownMs: definition.attackCooldownMs,
    lastAttackAt: 0,
  };
}

export class GameWorld {
  private readonly players = new Map<string, RuntimePlayer>();
  private readonly socketToCharacter = new Map<string, string>();
  private readonly monsters = new Map<string, RuntimeMonster>();
  private readonly loot = new Map<string, RuntimeLoot>();
  private readonly resumeStates = new Map<string, RuntimeResumeState>();
  private readonly characterOperations = new CharacterOperationQueue();
  private timer: ReturnType<typeof setInterval> | null = null;
  private tickNumber = 0;
  private stopping = false;

  constructor(
    private readonly io: GameIo,
    private readonly store: GameStore,
    private readonly lootRoll: () => number = () => randomInt(10_000),
  ) {
    for (const pocket of MONSTER_SPAWN_POCKETS) {
      for (const [x, z] of pocket.positions) {
        const monster = createMonster(pocket.kind, x, z);
        this.monsters.set(monster.id, monster);
      }
    }
  }

  start(): void {
    if (this.timer) return;
    this.stopping = false;
    this.timer = setInterval(() => this.tick(), TICK_MS);
    this.timer.unref?.();
  }

  async stop(): Promise<void> {
    this.stopping = true;
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    const results = await Promise.allSettled(
      [...this.players.values()].map((player) => this.persist(player)),
    );
    await this.characterOperations.drain();
    this.players.clear();
    this.socketToCharacter.clear();
    this.resumeStates.clear();
    const failed = results.find(
      (result): result is PromiseRejectedResult => result.status === "rejected",
    );
    if (failed) throw failed.reason;
  }

  async join(socket: GameSocket, character: CharacterRecord): Promise<void> {
    if (this.stopping) return;
    await this.characterOperations.run(character.id, () => this.joinUnsafe(socket, character));
  }

  private async joinUnsafe(socket: GameSocket, character: CharacterRecord): Promise<void> {
    const existing = this.players.get(character.id);
    if (existing) {
      await this.persistUnsafe(existing);
      this.rememberResumeState(existing);
      this.players.delete(existing.id);
      this.socketToCharacter.delete(existing.socketId);
      this.io.sockets.sockets.get(existing.socketId)?.disconnect(true);
    }

    character =
      (await this.store.getCharacterForAccount(character.id, character.accountId)) ?? character;
    const inventoryState = await this.store.getInventoryState(character.id);
    const inventory = inventoryStacks(inventoryState.inventory.items);
    const quest = await this.store.getQuest(character.id);
    const stats = deriveCharacterStats(
      character.classId,
      character.level,
      inventoryState.equipmentStats,
      inventoryState.inventory.equipment.main_hand?.itemId,
    );
    const savedPosition =
      Math.abs(character.position.x) <= WORLD_LIMIT && Math.abs(character.position.z) <= WORLD_LIMIT
        ? character.position
        : SPAWN;
    if (this.stopping || socket.connected === false) return;
    const resume = this.takeResumeState(character.id);
    const alive = resume?.alive ?? character.hp > 0;
    const hp = alive ? clamp(character.hp, 1, stats.maxHp) : 0;
    const respawnAt = alive ? null : (resume?.respawnAt ?? Date.now() + 5_000);

    const player: RuntimePlayer = {
      id: character.id,
      accountId: character.accountId,
      socketId: socket.id,
      name: character.name,
      race: character.race,
      gender: character.gender,
      classId: character.classId,
      position: { ...savedPosition },
      rotationY: 0,
      level: character.level,
      xp: character.xp,
      hp,
      maxHp: stats.maxHp,
      mp: clamp(character.mp, 0, stats.maxMp),
      maxMp: stats.maxMp,
      gold: inventoryState.inventory.gold,
      alive,
      pvpEnabled: this.isArena(savedPosition),
      targetId: null,
      inventory,
      inventoryView: inventoryState.inventory,
      equipmentStats: inventoryState.equipmentStats,
      derivedStats: stats,
      equipment: publicEquipment(inventoryState.inventory),
      quest,
      input: { seq: 0, direction: { x: 0, z: 0 }, facing: 0, sprint: false },
      lastProcessedInput: 0,
      cooldowns: resume?.cooldowns ?? new Map(),
      damageReductionUntil: resume?.damageReductionUntil ?? 0,
      activeBuffs: resume?.activeBuffs ?? [],
      respawnAt,
      lastPersistAt: Date.now(),
      lastChatAt: 0,
      persistedGold: inventoryState.inventory.gold,
      pendingGoldFlush: null,
    };
    refreshDerivedStats(player);
    this.players.set(player.id, player);
    this.socketToCharacter.set(socket.id, player.id);

    socket.emit("world:ready", {
      character: {
        id: player.id,
        name: player.name,
        race: player.race,
        gender: player.gender,
        classId: player.classId,
        level: player.level,
        xp: player.xp,
        gold: player.gold,
        lastSeenAt: character.lastSeenAt,
      },
      inventory: player.inventory,
      quest: player.quest,
      message: "Вы прибыли на Переправу Донмер. Обезопасьте подступы и победите трёх обычных существ.",
    });
    this.broadcastChat({
      id: randomUUID(),
      at: Date.now(),
      senderId: null,
      senderName: "Мир",
      text: `${player.name} прибывает в зону «${STARTER_ZONE.name}».`,
      channel: "system",
    });
    this.sendSnapshots();
  }

  async leave(socketId: string): Promise<void> {
    const characterId = this.socketToCharacter.get(socketId);
    if (!characterId) return;
    let departedName: string | null = null;
    await this.characterOperations.run(characterId, async () => {
      const player = this.players.get(characterId);
      if (!player || player.socketId !== socketId) {
        this.socketToCharacter.delete(socketId);
        return;
      }
      await this.persistUnsafe(player);
      this.rememberResumeState(player);
      this.socketToCharacter.delete(socketId);
      this.players.delete(characterId);
      departedName = player.name;
    });
    if (!departedName) return;
    this.broadcastChat({
      id: randomUUID(),
      at: Date.now(),
      senderId: null,
      senderName: "Мир",
      text: `${departedName} покидает долину.`,
      channel: "system",
    });
  }

  setInput(socketId: string, input: MovementInput): void {
    if (this.stopping) return;
    const player = this.playerBySocket(socketId);
    if (!player || input.seq <= player.lastProcessedInput) return;
    player.input = {
      ...input,
      direction: normalizedDirection(input.direction),
    };
  }

  setTarget(socketId: string, targetId: string | null): void {
    if (this.stopping) return;
    const player = this.playerBySocket(socketId);
    if (!player) return;
    if (targetId && !this.players.has(targetId) && !this.monsters.has(targetId)) return;
    player.targetId = targetId;
  }

  useAbility(socketId: string, input: UseAbilityInput): void {
    if (this.stopping) return;
    const player = this.playerBySocket(socketId);
    if (!player) return;
    if (!player.alive) {
      this.emitAbilityResult(player, input, false, Date.now(), "Герой ожидает возвращения в безопасный двор.");
      return;
    }
    this.resolveAbility(player, input);
  }

  async pickup(socketId: string, lootId: string): Promise<void> {
    if (this.stopping) return;
    const player = this.playerBySocket(socketId);
    const drop = this.loot.get(lootId);
    if (!player || !player.alive || !drop) return;
    const now = Date.now();
    if (distance2d(player.position, drop.position) > 3.2) {
      this.system(player, "warning", "Подойдите ближе к добыче.");
      return;
    }
    if (drop.ownerId && drop.ownerId !== player.id && now < drop.publicAt) {
      this.system(player, "warning", "Эта добыча пока принадлежит другому Свидетелю.");
      return;
    }

    this.loot.delete(drop.id);
    try {
      await this.runCharacterOperation(player.id, async () => {
        player.inventory = await this.store.addInventoryItem(
          player.id,
          drop.itemId,
          drop.quantity,
          drop.audit,
          drop.id,
        );
        const state = await this.store.getInventoryState(player.id);
        this.applyInventoryState(player.id, state);
      });
      this.system(player, "success", `Получено: ${drop.name} ×${drop.quantity}.`);
    } catch (error) {
      if (error instanceof IdempotencyConflictError) {
        this.system(player, "warning", "Эта добыча уже была получена.");
      } else {
        this.loot.set(drop.id, drop);
        this.system(player, "error", "Не удалось переместить добычу в инвентарь.");
      }
    }
  }

  chat(socketId: string, text: string): void {
    if (this.stopping) return;
    const player = this.playerBySocket(socketId);
    if (!player) return;
    const now = Date.now();
    if (now - player.lastChatAt < 700) {
      this.system(player, "warning", "Сообщения отправляются слишком часто.");
      return;
    }
    player.lastChatAt = now;
    this.broadcastChat({
      id: randomUUID(),
      at: now,
      senderId: player.id,
      senderName: player.name,
      text,
      channel: "local",
    });
  }

  async runCharacterOperation<T>(
    characterId: string,
    operation: () => Promise<T>,
  ): Promise<T> {
    return this.characterOperations.run(characterId, async () => {
      const player = this.players.get(characterId);
      if (player) await this.persistUnsafe(player);
      return operation();
    });
  }

  isCharacterOnline(characterId: string): boolean {
    return !this.stopping && this.players.has(characterId);
  }

  /** Flushes an online character through the same FIFO used by REST and realtime mutations. */
  async flushCharacter(characterId: string): Promise<void> {
    const player = this.players.get(characterId);
    if (player) await this.persist(player);
  }

  applyInventoryState(
    characterId: string,
    state: InventoryState,
    vitalDeltas?: { hp: number; mp: number },
  ): void {
    const player = this.players.get(characterId);
    if (!player) return;
    const pendingWorldGold = player.gold - player.persistedGold;
    player.persistedGold = state.inventory.gold;
    player.gold = state.inventory.gold + pendingWorldGold;
    state.inventory = { ...state.inventory, gold: player.gold };
    player.inventoryView = state.inventory;
    player.inventory = inventoryStacks(state.inventory.items);
    player.equipmentStats = state.equipmentStats;
    player.equipment = publicEquipment(state.inventory);
    refreshDerivedStats(player);
    player.hp = clamp(player.hp + (vitalDeltas?.hp ?? 0), 0, player.maxHp);
    player.mp = clamp(player.mp + (vitalDeltas?.mp ?? 0), 0, player.maxMp);
    this.emitInventoryUpdate(player);
  }

  mergeRuntimeInventoryState(characterId: string, state: InventoryState): void {
    const player = this.players.get(characterId);
    if (!player) return;
    const pendingWorldGold = player.gold - player.persistedGold;
    state.inventory = {
      ...state.inventory,
      gold: state.inventory.gold + pendingWorldGold,
    };
  }

  applyConsumableEffect(
    characterId: string,
    sourceItemId: ItemId,
    effect: ConsumableEffect,
    effectExpiresAt: number | null,
  ): void {
    const player = this.players.get(characterId);
    if (!player) return;
    if (effect.kind === "buff") {
      const expiresAt = effectExpiresAt ?? Date.now() + effect.durationMs;
      const existing = player.activeBuffs.find((buff) => buff.sourceItemId === sourceItemId);
      if (existing) {
        existing.stats = effect.stats;
        existing.expiresAt = Math.max(existing.expiresAt, expiresAt);
      } else if (expiresAt > Date.now()) {
        player.activeBuffs.push({ sourceItemId, stats: effect.stats, expiresAt });
      }
      refreshDerivedStats(player);
      this.system(player, "success", "Эффект расходуемого предмета активирован.");
    } else if (effect.kind === "return") {
      player.position = { ...SPAWN };
      player.input = { ...player.input, direction: { x: 0, z: 0 }, sprint: false };
      player.pvpEnabled = false;
      this.system(player, "info", `Камень возвращает вас в безопасный двор зоны «${STARTER_ZONE.name}».`);
    }
  }

  private tick(): void {
    this.tickNumber += 1;
    const now = Date.now();
    this.updatePlayers(now);
    this.updateMonsters(now);
    this.expireLoot(now);

    if (this.tickNumber % SNAPSHOT_EVERY_TICKS === 0) this.sendSnapshots();
  }

  private updatePlayers(now: number): void {
    for (const player of this.players.values()) {
      if (!player.alive) {
        if (player.respawnAt && now >= player.respawnAt) this.respawnPlayer(player);
        continue;
      }

      const activeBuffCount = player.activeBuffs.length;
      player.activeBuffs = player.activeBuffs.filter((buff) => buff.expiresAt > now);
      if (player.activeBuffs.length !== activeBuffCount) refreshDerivedStats(player, now);

      const { moveSpeed } = player.derivedStats;
      const speed = moveSpeed * (player.input.sprint ? 1.16 : 1);
      const step = speed * (TICK_MS / 1_000);
      player.position.x = clamp(
        player.position.x + player.input.direction.x * step,
        -WORLD_LIMIT,
        WORLD_LIMIT,
      );
      player.position.z = clamp(
        player.position.z + player.input.direction.z * step,
        -WORLD_LIMIT,
        WORLD_LIMIT,
      );
      player.position.y = 0;
      player.rotationY = player.input.facing;
      player.lastProcessedInput = player.input.seq;

      const wasPvp = player.pvpEnabled;
      player.pvpEnabled = this.isArena(player.position);
      if (wasPvp !== player.pvpEnabled) {
        this.system(
          player,
          player.pvpEnabled ? "warning" : "info",
          player.pvpEnabled
            ? "Вы вошли в Круг Спора: PvP разрешено."
            : "Вы покинули Круг Спора: PvP отключено.",
        );
      }

      if (this.tickNumber % 20 === 0) {
        player.mp = Math.min(player.maxMp, player.mp + 3);
        player.hp = Math.min(player.maxHp, player.hp + 1);
      }

      if (now - player.lastPersistAt >= PERSIST_EVERY_MS) {
        player.lastPersistAt = now;
        void this.persist(player).catch(() => {
          this.system(player, "error", "Не удалось сохранить состояние. Сервер повторит попытку.");
        });
      }
    }
  }

  private updateMonsters(now: number): void {
    for (const monster of this.monsters.values()) {
      if (!monster.alive) {
        if (monster.respawnAt && now >= monster.respawnAt) {
          monster.alive = true;
          monster.hp = monster.maxHp;
          monster.position = { ...monster.spawn };
          monster.targetId = null;
          monster.respawnAt = null;
        }
        continue;
      }

      let target = monster.targetId ? this.players.get(monster.targetId) : undefined;
      if (
        !target ||
        !target.alive ||
        distance2d(monster.position, target.position) > monster.aggroRange * 1.8 ||
        this.isSanctuary(target.position)
      ) {
        target = this.closestPlayer(monster.position, monster.aggroRange);
        monster.targetId = target?.id ?? null;
      }

      if (!target) {
        const homeDistance = distance2d(monster.position, monster.spawn);
        if (homeDistance > 0.3) this.moveToward(monster, monster.spawn, monster.speed * 0.7);
        continue;
      }

      const distance = distance2d(monster.position, target.position);
      monster.rotationY = Math.atan2(
        target.position.x - monster.position.x,
        target.position.z - monster.position.z,
      );
      if (distance > monster.attackRange) {
        this.moveToward(monster, target.position, monster.speed);
      } else if (now - monster.lastAttackAt >= monster.attackCooldownMs) {
        monster.lastAttackAt = now;
        this.monsterAttack(monster, target);
      }
    }
  }

  private moveToward(monster: RuntimeMonster, target: Vec3, speed: number): void {
    const dx = target.x - monster.position.x;
    const dz = target.z - monster.position.z;
    const length = Math.hypot(dx, dz);
    if (length <= 0.001) return;
    const step = Math.min(length, speed * (TICK_MS / 1_000));
    monster.position.x += (dx / length) * step;
    monster.position.z += (dz / length) * step;
  }

  private closestPlayer(position: Vec3, radius: number): RuntimePlayer | undefined {
    let closest: RuntimePlayer | undefined;
    let closestDistance = radius;
    for (const player of this.players.values()) {
      if (!player.alive || this.isSanctuary(player.position)) continue;
      const distance = distance2d(position, player.position);
      if (distance < closestDistance) {
        closest = player;
        closestDistance = distance;
      }
    }
    return closest;
  }

  private monsterAttack(monster: RuntimeMonster, player: RuntimePlayer): void {
    const hitChance = clamp(0.62 + monster.level * 0.04 - player.derivedStats.evasion / 500, 0.45, 0.94);
    if (Math.random() > hitChance) {
      this.combat({
        sourceId: monster.id,
        targetId: player.id,
        abilityId: "basic",
        kind: "miss",
        amount: 0,
        critical: false,
        message: `${player.name} уклоняется от атаки существа ${monster.name}.`,
      });
      return;
    }
    const reduced = player.damageReductionUntil > Date.now();
    const armorMultiplier = 100 / (100 + player.derivedStats.armor * 2.2);
    const amount = Math.max(
      1,
      Math.floor(monster.attackPower * armorMultiplier * (reduced ? 0.55 : 1)),
    );
    player.hp = Math.max(0, player.hp - amount);
    this.combat({
      sourceId: monster.id,
      targetId: player.id,
      abilityId: "basic",
      kind: "damage",
      amount,
      critical: false,
      message: `${monster.name} наносит ${amount} урона герою ${player.name}.`,
    });
    if (player.hp <= 0) this.defeatPlayer(player, monster.name);
  }

  private resolveAbility(player: RuntimePlayer, input: UseAbilityInput): void {
    const now = Date.now();
    const classDefinition = getClass(player.classId);
    if (input.abilityId !== "basic" && input.abilityId !== classDefinition.signatureAbilityId) {
      this.emitAbilityResult(player, input, false, now, "Это умение недоступно вашему классу.");
      return;
    }
    const ability = ABILITIES[input.abilityId];
    const readyAt = player.cooldowns.get(input.abilityId) ?? 0;
    if (now < readyAt) {
      this.emitAbilityResult(player, input, false, now, "Умение ещё восстанавливается.");
      return;
    }
    if (player.mp < ability.manaCost) {
      this.emitAbilityResult(player, input, false, now, "Недостаточно ресурса для умения.");
      return;
    }

    const targetId = input.targetId ?? player.targetId;
    const target = targetId ? this.damageTarget(targetId) : null;
    if (!target || !target.value.alive) {
      this.emitAbilityResult(player, input, false, now, "Сначала выберите живую цель.");
      return;
    }
    if (target.kind === "player" && (!player.pvpEnabled || !target.value.pvpEnabled)) {
      this.emitAbilityResult(
        player,
        input,
        false,
        now,
        "Сражение между игроками возможно только внутри Круга Спора.",
      );
      return;
    }

    const range = input.abilityId === "basic" ? player.derivedStats.basicRange : ability.range;
    if (distance2d(player.position, target.value.position) > range) {
      this.emitAbilityResult(player, input, false, now, "Цель слишком далеко.");
      return;
    }

    player.mp -= ability.manaCost;
    const baseCooldownMs = input.abilityId === "basic"
      ? player.derivedStats.basicAttackIntervalMs
      : ability.cooldownMs;
    const cooldownReadyAt = now + (input.abilityId === "basic"
      ? baseCooldownMs
      : baseCooldownMs / (1 + player.derivedStats.hastePercent));
    player.cooldowns.set(input.abilityId, cooldownReadyAt);
    this.emitAbilityResult(player, input, true, now);
    if (input.abilityId === "vanguard_strike") player.damageReductionUntil = now + 4_000;

    const targetEvasion = target.kind === "player" ? target.value.derivedStats.evasion : target.value.level * 3;
    const hitChance = clamp(
      0.72 + (player.derivedStats.accuracy - targetEvasion) / 250,
      0.58,
      0.99,
    );
    if (Math.random() > hitChance) {
      this.combat({
        sourceId: player.id,
        targetId: target.value.id,
        abilityId: input.abilityId,
        kind: "miss",
        amount: 0,
        critical: false,
        message: `${player.name} промахивается.`,
      });
      return;
    }

    const criticalChance = clamp(
      player.derivedStats.criticalChance,
      0,
      0.65,
    );
    const critical = Math.random() < criticalChance;
    const multiplier =
      input.abilityId === "basic"
        ? 1
        : input.abilityId === "aether_bolt"
          ? 1.75
          : 1.35;
    const spellAttack =
      input.abilityId === "aether_bolt" ||
      (input.abilityId === "basic" && player.classId === "mage");
    const attackPower = spellAttack
      ? player.derivedStats.spellPower
      : player.derivedStats.physicalAttack;
    let amount = Math.floor((7 + attackPower * 0.58) * multiplier * (critical ? 1.65 : 1));
    if (target.kind === "player") {
      const defense = spellAttack
        ? target.value.derivedStats.resistance
        : target.value.derivedStats.armor;
      amount = Math.floor(amount * 0.8 * (100 / (100 + defense * 1.8)));
      if (target.value.damageReductionUntil > now) amount = Math.floor(amount * 0.55);
    }
    amount = Math.max(1, amount);
    target.value.hp = Math.max(0, target.value.hp - amount);

    this.combat({
      sourceId: player.id,
      targetId: target.value.id,
      abilityId: input.abilityId,
      kind: "damage",
      amount,
      critical,
      message: `${player.name} наносит ${amount} урона${critical ? " (критический удар)" : ""}.`,
    });

    if (target.value.hp <= 0) {
      if (target.kind === "monster") this.defeatMonster(target.value, player);
      else this.defeatPlayer(target.value, player.name);
    } else if (target.kind === "monster") {
      target.value.targetId = player.id;
    }
  }

  private damageTarget(id: string): DamageTarget | null {
    const player = this.players.get(id);
    if (player) return { kind: "player", value: player };
    const monster = this.monsters.get(id);
    return monster ? { kind: "monster", value: monster } : null;
  }

  private defeatMonster(monster: RuntimeMonster, killer: RuntimePlayer): void {
    const definition = MONSTER_DEFINITIONS[monster.kind];
    monster.alive = false;
    monster.hp = 0;
    monster.targetId = null;
    monster.respawnAt = Date.now() + definition.respawnMs;

    const oldLevel = killer.level;
    killer.xp += definition.xpReward;
    const goldSpread = definition.goldMax - definition.goldMin;
    const baseGold = definition.goldMin
      + (goldSpread > 0 ? this.nextLootRoll() % (goldSpread + 1) : 0);
    const salvageBonus = Math.min(
      0.25,
      (killer.equipmentStats.criticalRating + killer.equipmentStats.accuracy) / 1_000,
    );
    killer.gold += baseGold + Math.floor(baseGold * salvageBonus);
    killer.level = levelFromTotalXp(killer.xp);
    if (killer.level > oldLevel) {
      const stats = playerStats(killer);
      killer.derivedStats = stats;
      killer.maxHp = stats.maxHp;
      killer.maxMp = stats.maxMp;
      killer.hp = killer.maxHp;
      killer.mp = killer.maxMp;
      this.system(killer, "success", `Новый уровень: ${killer.level}. Силы полностью восстановлены.`);
    }

    this.combat({
      sourceId: killer.id,
      targetId: monster.id,
      abilityId: "basic",
      kind: "defeat",
      amount: 0,
      critical: false,
      message: `${killer.name} рассеивает ${monster.name.toLocaleLowerCase("ru")}.`,
    });

    // Every kill teaches the loot loop; equipment precision can increase salvage yield and
    // elite enemies can award a real equippable item instead of only crafting materials.
    const shouldDrop = true;
    if (shouldDrop) {
      const eliteEquipment: ItemId =
        killer.classId === "warrior"
          ? "memoryglass_buckler"
          : "moonsilt_amulet";
      const rareEquipmentChance = 0.12 + Math.min(0.18, salvageBonus);
      const rareChanceBps = monster.elite ? Math.round(rareEquipmentChance * 10_000) : 0;
      const rareRoll = this.nextLootRoll();
      const quantityBonusChanceBps = monster.elite
        ? 0
        : Math.round(killer.derivedStats.criticalChance * 10_000);
      const quantityRoll = this.nextLootRoll();
      const itemId: ItemId = monster.elite
        ? rareRoll < rareChanceBps
          ? eliteEquipment
          : "resonant_dust"
        : "mire_shard";
      const definition = ITEMS[itemId];
      const drop: RuntimeLoot = {
        id: randomUUID(),
        itemId,
        name: definition.name,
        quantity:
          monster.elite && itemId === "resonant_dust"
            ? 2
            : !monster.elite && quantityRoll < quantityBonusChanceBps
              ? 2
              : 1,
        position: { ...monster.position },
        ownerId: killer.id,
        publicAt: Date.now() + 8_000,
        expiresAt: Date.now() + 45_000,
        audit: {
          sourceMonsterId: monster.id,
          sourceMonsterKind: monster.kind,
          sourceMonsterElite: monster.elite,
          rareRoll,
          rareChanceBps,
          quantityRoll,
          quantityBonusChanceBps,
        },
      };
      this.loot.set(drop.id, drop);
    }

    this.emitInventoryUpdate(killer);
    if (definition.starterQuestEligible && killer.quest.status === "active") {
      void this.recordQuestKill(killer).catch(() => {
        this.system(killer, "error", "Не удалось записать прогресс поручения. Попробуйте ещё раз.");
      });
    } else {
      void this.persist(killer).catch(() => {
        this.system(killer, "error", "Награда сохранится при следующей синхронизации.");
      });
    }
  }

  private defeatPlayer(player: RuntimePlayer, defeatedBy: string): void {
    player.alive = false;
    player.hp = 0;
    player.targetId = null;
    player.input = {
      ...player.input,
      direction: { x: 0, z: 0 },
      sprint: false,
    };
    player.respawnAt = Date.now() + 5_000;
    this.combat({
      sourceId: player.id,
      targetId: player.id,
      abilityId: "basic",
      kind: "defeat",
      amount: 0,
      critical: false,
      message: `${player.name} повержен (${defeatedBy}). Возвращение через 5 секунд.`,
    });
  }

  private respawnPlayer(player: RuntimePlayer): void {
    const stats = playerStats(player);
    player.derivedStats = stats;
    player.position = { ...SPAWN };
    player.maxHp = stats.maxHp;
    player.maxMp = stats.maxMp;
    player.hp = player.maxHp;
    player.mp = player.maxMp;
    player.alive = true;
    player.respawnAt = null;
    player.pvpEnabled = false;
    this.system(player, "info", "Вы возвращаетесь в безопасный двор Переправы Донмер.");
  }

  private isArena(position: Vec3): boolean {
    return Math.hypot(position.x - ARENA_CENTER.x, position.z - ARENA_CENTER.z) <= ARENA_RADIUS;
  }

  private isSanctuary(position: Vec3): boolean {
    return Math.hypot(position.x - SPAWN.x, position.z - SPAWN.z) <= 9;
  }

  private expireLoot(now: number): void {
    for (const drop of this.loot.values()) {
      if (drop.expiresAt <= now) this.loot.delete(drop.id);
    }
  }

  private playerBySocket(socketId: string): RuntimePlayer | undefined {
    const id = this.socketToCharacter.get(socketId);
    return id ? this.players.get(id) : undefined;
  }

  private rememberResumeState(player: RuntimePlayer): void {
    const now = Date.now();
    this.pruneResumeStates(now);
    const cooldowns = new Map(
      [...player.cooldowns].filter(([, readyAt]) => readyAt > now),
    );
    const activeBuffs = player.activeBuffs
      .filter(({ expiresAt }) => expiresAt > now)
      .map((buff) => ({ ...buff, stats: { ...buff.stats } }));
    this.resumeStates.set(player.id, {
      expiresAt: now + RESUME_TTL_MS,
      cooldowns,
      damageReductionUntil:
        player.damageReductionUntil > now ? player.damageReductionUntil : 0,
      activeBuffs,
      alive: player.alive,
      respawnAt: player.respawnAt,
    });
    while (this.resumeStates.size > MAX_RESUME_STATES) {
      const oldest = this.resumeStates.keys().next().value as string | undefined;
      if (!oldest) break;
      this.resumeStates.delete(oldest);
    }
  }

  private takeResumeState(characterId: string): RuntimeResumeState | null {
    const now = Date.now();
    this.pruneResumeStates(now);
    const state = this.resumeStates.get(characterId);
    if (!state) return null;
    this.resumeStates.delete(characterId);
    return {
      ...state,
      cooldowns: new Map(state.cooldowns),
      activeBuffs: state.activeBuffs.map((buff) => ({
        ...buff,
        stats: { ...buff.stats },
      })),
    };
  }

  private pruneResumeStates(now: number): void {
    for (const [characterId, state] of this.resumeStates) {
      if (state.expiresAt <= now) this.resumeStates.delete(characterId);
    }
  }

  private sendSnapshots(): void {
    const players = [...this.players.values()].map(publicPlayer);
    const monsters = [...this.monsters.values()].map(publicMonster);
    const loot = [...this.loot.values()].map(publicLoot);
    for (const player of this.players.values()) {
      const snapshot: WorldSnapshot = {
        protocolVersion: PROTOCOL_VERSION,
        serverTime: Date.now(),
        tick: this.tickNumber,
        selfId: player.id,
        lastProcessedInput: player.lastProcessedInput,
        zoneId: STARTER_ZONE.id,
        zoneName: STARTER_ZONE.name,
        players,
        monsters,
        loot,
      };
      this.io.to(player.socketId).emit("world:snapshot", snapshot);
    }
  }

  private system(
    player: RuntimePlayer,
    level: SystemMessage["level"],
    text: string,
  ): void {
    this.io.to(player.socketId).emit("system:message", {
      id: randomUUID(),
      at: Date.now(),
      level,
      text,
    });
  }

  private combat(event: Omit<CombatEvent, "id" | "at">): void {
    this.io.emit("combat:event", { id: randomUUID(), at: Date.now(), ...event });
  }

  private broadcastChat(message: ChatMessage): void {
    this.io.emit("chat:message", message);
  }

  private emitAbilityResult(
    player: RuntimePlayer,
    input: UseAbilityInput,
    accepted: boolean,
    serverTime: number,
    reason?: string,
  ): void {
    const result: AbilityUseResult = {
      seq: input.seq,
      abilityId: input.abilityId,
      accepted,
      serverTime,
      cooldownReadyAt: Math.ceil(player.cooldowns.get(input.abilityId) ?? 0),
      ...(reason ? { reason } : {}),
    };
    this.io.to(player.socketId).emit("combat:ability-result", result);
  }

  private emitInventoryUpdate(player: RuntimePlayer): void {
    this.io.to(player.socketId).emit("inventory:update", {
      inventory: player.inventory,
      gold: player.gold,
      view: { ...player.inventoryView, gold: player.gold },
      derivedStats: { ...player.derivedStats },
    });
  }

  private nextLootRoll(): number {
    const roll = this.lootRoll();
    if (!Number.isInteger(roll) || roll < 0 || roll >= 10_000) {
      throw new Error("Loot RNG must return an integer from 0 through 9999");
    }
    return roll;
  }

  private async recordQuestKill(player: RuntimePlayer): Promise<void> {
    await this.runCharacterOperation(player.id, async () => {
      const result = await this.store.advanceQuest(player.id, "first_echoes", 1);
      const pendingWorldGold = player.gold - player.persistedGold;
      player.persistedGold = result.gold;
      player.gold = result.gold + pendingWorldGold;
      player.inventoryView = { ...player.inventoryView, gold: player.gold };
      player.quest = result.progress;
      this.io.to(player.socketId).emit("quest:update", { ...player.quest });
      this.emitInventoryUpdate(player);
      if (result.rewarded) {
        this.system(
          player,
          "success",
          `Поручение «Первые отголоски» выполнено. Награда: ${result.rewardGold} марок.`,
        );
      }
    });
  }

  private async persist(player: RuntimePlayer): Promise<void> {
    await this.characterOperations.run(player.id, () => this.persistUnsafe(player));
  }

  private async persistUnsafe(player: RuntimePlayer): Promise<void> {
    const unflushedGold = player.gold - player.persistedGold;
    if (!player.pendingGoldFlush && unflushedGold !== 0) {
      player.pendingGoldFlush = {
        operationId: randomUUID(),
        goldDelta: unflushedGold,
      };
    }
    const pending = player.pendingGoldFlush;
    const acknowledgedRuntimeGold = player.persistedGold + (pending?.goldDelta ?? 0);
    const result = await this.store.saveCharacterState({
      id: player.id,
      operationId: pending?.operationId ?? null,
      position: { ...player.position },
      hp: Math.round(player.hp),
      mp: Math.round(player.mp),
      xp: player.xp,
      level: player.level,
      goldDelta: pending?.goldDelta ?? 0,
    });
    const worldGoldEarnedWhileSaving = player.gold - acknowledgedRuntimeGold;
    player.persistedGold = result.gold;
    player.gold = result.gold + worldGoldEarnedWhileSaving;
    if (player.pendingGoldFlush === pending) player.pendingGoldFlush = null;
    player.inventoryView = { ...player.inventoryView, gold: player.gold };
  }
}
