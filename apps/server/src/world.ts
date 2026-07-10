import { randomUUID } from "node:crypto";
import {
  ABILITIES,
  ITEMS,
  PROTOCOL_VERSION,
  getClass,
  levelFromTotalXp,
  type AbilityId,
  type ChatMessage,
  type ClientToServerEvents,
  type CombatEvent,
  type InterServerEvents,
  type InventoryStack,
  type ItemId,
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
import type { CharacterRecord, GameStore } from "./store/index.js";

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
  quest: QuestProgress;
  input: MovementInput;
  lastProcessedInput: number;
  cooldowns: Map<AbilityId, number>;
  damageReductionUntil: number;
  respawnAt: number | null;
  lastPersistAt: number;
  lastChatAt: number;
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

interface RuntimeLoot extends LootSnapshot {}

type DamageTarget =
  | { kind: "player"; value: RuntimePlayer }
  | { kind: "monster"; value: RuntimeMonster };

const TICK_MS = 50;
const SNAPSHOT_EVERY_TICKS = 2;
const PERSIST_EVERY_MS = 10_000;
const WORLD_LIMIT = 48;
const SPAWN: Vec3 = { x: 0, y: 0, z: 0 };
const ARENA_CENTER = { x: 29, z: 27 };
const ARENA_RADIUS = 10;

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

function playerStats(classId: RuntimePlayer["classId"], level: number) {
  const definition = getClass(classId);
  return {
    maxHp: definition.baseHp + (level - 1) * 14,
    maxMp: definition.baseMp + (level - 1) * 9,
    moveSpeed: definition.moveSpeed,
    basicRange: definition.basicRange,
  };
}

function publicPlayer(player: RuntimePlayer): PlayerSnapshot {
  return {
    id: player.id,
    name: player.name,
    race: player.race,
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

function createMonster(
  kind: RuntimeMonster["kind"],
  x: number,
  z: number,
  elite = false,
): RuntimeMonster {
  const level = elite ? 3 : 1;
  const hp = elite ? 280 : 82;
  const position = { x, y: 0, z };
  return {
    id: randomUUID(),
    kind,
    name: elite ? "Полый дозорный" : "Топкий отголосок",
    position: { ...position },
    spawn: { ...position },
    rotationY: 0,
    level,
    hp,
    maxHp: hp,
    alive: true,
    elite,
    targetId: null,
    respawnAt: null,
    speed: elite ? 2.5 : 2.1,
    attackPower: elite ? 19 : 8,
    aggroRange: elite ? 13 : 8,
    attackRange: elite ? 2.4 : 1.8,
    attackCooldownMs: elite ? 1_600 : 2_000,
    lastAttackAt: 0,
  };
}

export class GameWorld {
  private readonly players = new Map<string, RuntimePlayer>();
  private readonly socketToCharacter = new Map<string, string>();
  private readonly monsters = new Map<string, RuntimeMonster>();
  private readonly loot = new Map<string, RuntimeLoot>();
  private timer: ReturnType<typeof setInterval> | null = null;
  private tickNumber = 0;

  constructor(
    private readonly io: GameIo,
    private readonly store: GameStore,
  ) {
    const spawns: Array<[number, number]> = [
      [-17, -8],
      [-21, 3],
      [-13, 13],
      [2, 19],
      [14, 14],
      [18, -4],
      [8, -20],
      [-9, -21],
    ];
    for (const [x, z] of spawns) {
      const monster = createMonster("mireling", x, z);
      this.monsters.set(monster.id, monster);
    }
    const elite = createMonster("hollow_sentinel", -34, 30, true);
    this.monsters.set(elite.id, elite);
  }

  start(): void {
    if (this.timer) return;
    this.timer = setInterval(() => this.tick(), TICK_MS);
    this.timer.unref?.();
  }

  async stop(): Promise<void> {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    await Promise.all([...this.players.values()].map((player) => this.persist(player)));
  }

  async join(socket: GameSocket, character: CharacterRecord): Promise<void> {
    const existing = this.players.get(character.id);
    if (existing) {
      await this.persist(existing);
      this.players.delete(existing.id);
      this.socketToCharacter.delete(existing.socketId);
      this.io.sockets.sockets.get(existing.socketId)?.disconnect(true);
    }

    const inventory = await this.store.getInventory(character.id);
    const quest = await this.store.getQuest(character.id);
    const stats = playerStats(character.classId, character.level);
    const savedPosition =
      Math.abs(character.position.x) <= WORLD_LIMIT && Math.abs(character.position.z) <= WORLD_LIMIT
        ? character.position
        : SPAWN;
    const hp = character.hp > 0 ? clamp(character.hp, 1, stats.maxHp) : stats.maxHp;

    const player: RuntimePlayer = {
      id: character.id,
      accountId: character.accountId,
      socketId: socket.id,
      name: character.name,
      race: character.race,
      classId: character.classId,
      position: { ...savedPosition },
      rotationY: 0,
      level: character.level,
      xp: character.xp,
      hp,
      maxHp: stats.maxHp,
      mp: clamp(character.mp, 0, stats.maxMp),
      maxMp: stats.maxMp,
      gold: character.gold,
      alive: true,
      pvpEnabled: this.isArena(savedPosition),
      targetId: null,
      inventory,
      quest,
      input: { seq: 0, direction: { x: 0, z: 0 }, facing: 0, sprint: false },
      lastProcessedInput: 0,
      cooldowns: new Map(),
      damageReductionUntil: 0,
      respawnAt: null,
      lastPersistAt: Date.now(),
      lastChatAt: 0,
    };
    this.players.set(player.id, player);
    this.socketToCharacter.set(socket.id, player.id);

    socket.emit("world:ready", {
      character: {
        id: player.id,
        name: player.name,
        race: player.race,
        classId: player.classId,
        level: player.level,
        xp: player.xp,
        gold: player.gold,
        lastSeenAt: character.lastSeenAt,
      },
      inventory: player.inventory,
      quest: player.quest,
      message: "Вы ощущаете тихий зов Истока. Найдите и победите три отголоска.",
    });
    this.broadcastChat({
      id: randomUUID(),
      at: Date.now(),
      senderId: null,
      senderName: "Мир",
      text: `${player.name} вступает в Долину Тихих Истоков.`,
      channel: "system",
    });
    this.sendSnapshots();
  }

  async leave(socketId: string): Promise<void> {
    const characterId = this.socketToCharacter.get(socketId);
    if (!characterId) return;
    const player = this.players.get(characterId);
    this.socketToCharacter.delete(socketId);
    this.players.delete(characterId);
    if (!player) return;

    await this.persist(player);
    this.broadcastChat({
      id: randomUUID(),
      at: Date.now(),
      senderId: null,
      senderName: "Мир",
      text: `${player.name} покидает долину.`,
      channel: "system",
    });
  }

  setInput(socketId: string, input: MovementInput): void {
    const player = this.playerBySocket(socketId);
    if (!player || input.seq <= player.lastProcessedInput) return;
    player.input = {
      ...input,
      direction: normalizedDirection(input.direction),
    };
  }

  setTarget(socketId: string, targetId: string | null): void {
    const player = this.playerBySocket(socketId);
    if (!player) return;
    if (targetId && !this.players.has(targetId) && !this.monsters.has(targetId)) return;
    player.targetId = targetId;
  }

  useAbility(socketId: string, input: UseAbilityInput): void {
    const player = this.playerBySocket(socketId);
    if (!player || !player.alive) return;
    this.resolveAbility(player, input);
  }

  async pickup(socketId: string, lootId: string): Promise<void> {
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
      player.inventory = await this.store.addInventoryItem(
        player.id,
        drop.itemId,
        drop.quantity,
      );
      this.io.to(player.socketId).emit("inventory:update", {
        inventory: player.inventory,
        gold: player.gold,
      });
      this.system(player, "success", `Получено: ${drop.name} ×${drop.quantity}.`);
    } catch (error) {
      this.loot.set(drop.id, drop);
      throw error;
    }
  }

  chat(socketId: string, text: string): void {
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

      const { moveSpeed } = playerStats(player.classId, player.level);
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
    const reduced = player.damageReductionUntil > Date.now();
    const amount = Math.max(1, Math.floor(monster.attackPower * (reduced ? 0.55 : 1)));
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
      this.system(player, "error", "Это умение недоступно вашему классу.");
      return;
    }
    const ability = ABILITIES[input.abilityId];
    const readyAt = player.cooldowns.get(input.abilityId) ?? 0;
    if (now < readyAt) return;
    if (player.mp < ability.manaCost) {
      this.system(player, "warning", "Недостаточно ресурса для умения.");
      return;
    }

    if (input.abilityId === "mending_current") {
      const target = input.targetId ? this.players.get(input.targetId) : player;
      if (!target || !target.alive || distance2d(player.position, target.position) > ability.range) {
        this.system(player, "warning", "Цель лечения вне досягаемости.");
        return;
      }
      player.mp -= ability.manaCost;
      player.cooldowns.set(input.abilityId, now + ability.cooldownMs);
      const amount = Math.floor(30 + player.level * 8);
      const applied = Math.max(0, Math.min(amount, target.maxHp - target.hp));
      target.hp += applied;
      this.combat({
        sourceId: player.id,
        targetId: target.id,
        abilityId: input.abilityId,
        kind: "heal",
        amount: applied,
        critical: false,
        message: `${player.name} восстанавливает ${applied} здоровья герою ${target.name}.`,
      });
      return;
    }

    const targetId = input.targetId ?? player.targetId;
    const target = targetId ? this.damageTarget(targetId) : null;
    if (!target || !target.value.alive) {
      this.system(player, "warning", "Сначала выберите живую цель.");
      return;
    }
    if (target.kind === "player" && (!player.pvpEnabled || !target.value.pvpEnabled)) {
      this.system(player, "warning", "Сражение между игроками возможно только внутри Круга Спора.");
      return;
    }

    const range = input.abilityId === "basic" ? classDefinition.basicRange : ability.range;
    if (distance2d(player.position, target.value.position) > range) {
      this.system(player, "warning", "Цель слишком далеко.");
      return;
    }

    player.mp -= ability.manaCost;
    player.cooldowns.set(input.abilityId, now + ability.cooldownMs);
    if (input.abilityId === "iron_vow") player.damageReductionUntil = now + 4_000;

    const criticalChance = input.abilityId === "far_mark" ? 0.3 : 0.11;
    const critical = Math.random() < criticalChance;
    const multiplier =
      input.abilityId === "basic"
        ? 1
        : input.abilityId === "ember_sigil"
          ? 1.75
          : input.abilityId === "echo_companion"
            ? 1.5
            : 1.35;
    let amount = Math.floor((12 + player.level * 4) * multiplier * (critical ? 1.65 : 1));
    if (target.kind === "player") {
      amount = Math.floor(amount * 0.72);
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
    monster.alive = false;
    monster.hp = 0;
    monster.targetId = null;
    monster.respawnAt = Date.now() + (monster.elite ? 22_000 : 12_000);

    const oldLevel = killer.level;
    killer.xp += (monster.elite ? 125 : 42) * monster.level;
    killer.gold += monster.elite ? 18 : 5 + Math.floor(Math.random() * 5);
    killer.level = levelFromTotalXp(killer.xp);
    if (killer.level > oldLevel) {
      const stats = playerStats(killer.classId, killer.level);
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

    // Alpha vertical slice keeps drops deterministic so every new player learns the loot loop.
    const shouldDrop = true;
    if (shouldDrop) {
      const itemId: ItemId = monster.elite && Math.random() < 0.4 ? "field_tonic" : "mire_shard";
      const definition = ITEMS[itemId];
      const drop: RuntimeLoot = {
        id: randomUUID(),
        itemId,
        name: definition.name,
        quantity: monster.elite ? 2 : 1,
        position: { ...monster.position },
        ownerId: killer.id,
        publicAt: Date.now() + 8_000,
        expiresAt: Date.now() + 45_000,
      };
      this.loot.set(drop.id, drop);
    }

    if (monster.kind === "mireling" && killer.quest.status === "active") {
      killer.quest.current = Math.min(killer.quest.required, killer.quest.current + 1);
      if (killer.quest.current >= killer.quest.required) {
        killer.quest.status = "completed";
        killer.gold += 25;
        this.system(killer, "success", "Поручение «Первые отголоски» выполнено. Награда: 25 марок.");
      }
      this.io.to(killer.socketId).emit("quest:update", { ...killer.quest });
      void this.store.saveQuest(killer.id, killer.quest);
    }

    this.io.to(killer.socketId).emit("inventory:update", {
      inventory: killer.inventory,
      gold: killer.gold,
    });
    void this.persist(killer);
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
    const stats = playerStats(player.classId, player.level);
    player.position = { ...SPAWN };
    player.maxHp = stats.maxHp;
    player.maxMp = stats.maxMp;
    player.hp = player.maxHp;
    player.mp = player.maxMp;
    player.alive = true;
    player.respawnAt = null;
    player.pvpEnabled = false;
    this.system(player, "info", "Исток возвращает вас к Звёздному мосту.");
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

  private sendSnapshots(): void {
    const players = [...this.players.values()].map(publicPlayer);
    const monsters = [...this.monsters.values()].map(publicMonster);
    const loot = [...this.loot.values()].map((drop) => ({ ...drop, position: { ...drop.position } }));
    for (const player of this.players.values()) {
      const snapshot: WorldSnapshot = {
        protocolVersion: PROTOCOL_VERSION,
        serverTime: Date.now(),
        tick: this.tickNumber,
        selfId: player.id,
        lastProcessedInput: player.lastProcessedInput,
        zoneId: "silent_wellspring_vale",
        zoneName: "Долина Тихих Истоков",
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

  private async persist(player: RuntimePlayer): Promise<void> {
    await this.store.saveCharacterState({
      id: player.id,
      position: { ...player.position },
      hp: Math.round(player.hp),
      mp: Math.round(player.mp),
      xp: player.xp,
      level: player.level,
      gold: player.gold,
    });
  }
}
