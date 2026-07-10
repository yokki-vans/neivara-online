import {
  ABILITIES,
  PROTOCOL_VERSION,
  getAllowedEquipmentSlots,
  getClass,
  getItem,
  xpProgress,
  type AbilityUseResult,
  type AbilityId,
  type CharacterSummary,
  type ChatMessage,
  type ClientToServerEvents,
  type CombatEvent,
  type DerivedCharacterStats,
  type EquipmentSlot,
  type InventoryView,
  type ItemInstance,
  type MovementInput,
  type QuestProgress,
  type ServerToClientEvents,
  type SystemMessage,
  type WorldSnapshot,
} from "@neivara/shared";
import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { io, type Socket } from "socket.io-client";
import {
  API_URL,
  ApiError,
  api,
  type EnhanceItemApiResponse,
  type InventoryApiResponse,
  type UseItemApiResponse,
} from "../api";
import { InventoryPanel, type ItemAction } from "../components/InventoryPanel";
import { displayZoneName } from "../contentCompatibility";
import { SkillIcon } from "../components/SkillIcon";
import { WorldCanvas, type VisualEquipmentLoadout } from "../game/WorldCanvas";
import {
  canApplyInventoryMutationResponse,
  inventoryMutationFingerprint,
  isAmbiguousMutationFailure,
  isCurrentInventoryRead,
  isInventoryMutationReplayable,
  prepareInventoryMutation,
  readPersistedInventoryMutation,
  retryAmbiguousMutation,
  writePersistedInventoryMutation,
  type IdempotentInventoryAction,
  type InventoryMutationScope,
  type UncertainInventoryMutation,
} from "../inventoryReliability";
import type { Session } from "../session";

interface Props {
  session: Session;
  character: CharacterSummary;
  onExit: () => void;
  onSessionExpired: () => void;
}

type GameSocket = Socket<ServerToClientEvents, ClientToServerEvents>;
type FeedEntry =
  | { id: string; at: number; type: "chat"; text: string; sender: string }
  | { id: string; at: number; type: "combat" | "system"; text: string; sender?: never };
type IdempotentMutationResponse = UseItemApiResponse | EnhanceItemApiResponse;
const EXPIRED_MUTATION_WARNING = "Старую операцию нельзя безопасно подтвердить автоматически: окно защитного ключа истекло. Инвентарь перечитан — проверьте его перед новым действием.";

class ExpiredInventoryMutationError extends Error {
  constructor() {
    super("Защитное окно операции истекло");
    this.name = "ExpiredInventoryMutationError";
  }
}

function idempotentMutationMessage(
  mutation: UncertainInventoryMutation,
  response: IdempotentMutationResponse,
): string {
  if (mutation.action === "use" && "effect" in response) {
    const restored = response.effect.restoredHp + response.effect.restoredMp;
    return restored > 0
      ? `Предмет использован: восстановлено ${restored}.`
      : "Предмет использован.";
  }
  if (mutation.action === "enhance" && "enhancement" in response) {
    return response.enhancement.success
      ? `Усиление успешно: +${response.enhancement.enhancementLevel}.`
      : response.enhancement.downgraded
        ? `Усиление не удалось: уровень снижен до +${response.enhancement.enhancementLevel}.`
        : "Усиление не удалось, предмет сохранён.";
  }
  return "Операция с предметом подтверждена сервером.";
}

function barStyle(current: number, max: number): React.CSSProperties {
  return { "--bar-value": `${max > 0 ? Math.max(0, Math.min(100, (current / max) * 100)) : 0}%` } as React.CSSProperties;
}

function distance(a: { x: number; z: number }, b: { x: number; z: number }): number {
  return Math.hypot(a.x - b.x, a.z - b.z);
}

function initialInventory(gold: number): InventoryView {
  return { items: [], equipment: {}, gold, capacity: 48, usedSlots: 0 };
}

function initialDerivedStats(character: CharacterSummary): DerivedCharacterStats {
  const classInfo = getClass(character.classId);
  return {
    maxHp: classInfo.baseHp,
    maxMp: classInfo.baseMp,
    physicalAttack: 10,
    spellPower: 10,
    armor: 0,
    resistance: 0,
    accuracy: 75,
    evasion: 5,
    criticalChance: 0.05,
    hastePercent: 0,
    moveSpeed: classInfo.moveSpeed,
    basicRange: classInfo.basicRange,
    basicAttackIntervalMs: ABILITIES.basic.cooldownMs,
  };
}

function MiniMap({ snapshot }: { snapshot: WorldSnapshot }) {
  const place = (x: number, z: number): React.CSSProperties => ({
    left: `${((x + 48) / 96) * 100}%`,
    top: `${((48 - z) / 96) * 100}%`,
  });
  return (
    <div className="minimap" aria-label="Мини-карта">
      <div className="minimap-arena" style={place(29, 27)} />
      {snapshot.monsters.filter((monster) => monster.alive).map((monster) => (
        <span key={monster.id} className={monster.elite ? "map-dot elite" : "map-dot monster"} style={place(monster.position.x, monster.position.z)} />
      ))}
      {snapshot.players.map((player) => (
        <span key={player.id} className={player.id === snapshot.selfId ? "map-dot self" : "map-dot ally"} style={place(player.position.x, player.position.z)} />
      ))}
      <span className="minimap-north">N</span>
    </div>
  );
}

export function GameScreen({ session, character, onExit, onSessionExpired }: Props) {
  const socketRef = useRef<GameSocket | null>(null);
  const classInfo = getClass(character.classId);
  const [snapshot, setSnapshot] = useState<WorldSnapshot | null>(null);
  const [connection, setConnection] = useState<"connecting" | "online" | "offline">("connecting");
  const [connectionError, setConnectionError] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [inventory, setInventory] = useState<InventoryView>(() => initialInventory(character.gold));
  const [derivedStats, setDerivedStats] = useState<DerivedCharacterStats>(() => initialDerivedStats(character));
  const [inventoryOpen, setInventoryOpen] = useState(false);
  const [inventoryBusy, setInventoryBusy] = useState<string | null>(null);
  const inventoryActionInFlight = useRef(false);
  const inventoryRecoveryInFlight = useRef(false);
  const inventoryReadSequence = useRef(0);
  const inventoryRevision = useRef(0);
  const mutationScope = useMemo<InventoryMutationScope>(() => ({
    accountId: session.account.id,
    characterId: character.id,
  }), [character.id, session.account.id]);
  const persistedMutationRead = useMemo(
    () => readPersistedInventoryMutation(window.localStorage, mutationScope),
    [mutationScope],
  );
  const uncertainMutation = useRef<UncertainInventoryMutation | null>(
    persistedMutationRead.status === "ready" ? persistedMutationRead.mutation : null,
  );
  const [inventoryError, setInventoryError] = useState<string | null>(null);
  const [inventoryRecoveryWarning, setInventoryRecoveryWarning] = useState<string | null>(
    persistedMutationRead.status === "expired" ? EXPIRED_MUTATION_WARNING : null,
  );
  const [quest, setQuest] = useState<QuestProgress>({
    questId: "first_echoes",
    status: "active",
    current: 0,
    required: 3,
  });
  const [feed, setFeed] = useState<FeedEntry[]>([]);
  const [combatCue, setCombatCue] = useState<CombatEvent | null>(null);
  const [chatText, setChatText] = useState("");
  const [cooldowns, setCooldowns] = useState<Partial<Record<AbilityId, number>>>({});
  const [pendingAbilities, setPendingAbilities] = useState<Partial<Record<AbilityId, number>>>({});
  const abilitySequence = useRef(0);
  const [, forceClock] = useState(0);

  const addFeed = useCallback((entry: FeedEntry) => {
    setFeed((current) => [...current.slice(-44), entry]);
  }, []);

  const persistUncertainMutation = useCallback((mutation: UncertainInventoryMutation): boolean => {
    if (!writePersistedInventoryMutation(window.localStorage, mutationScope, mutation)) return false;
    uncertainMutation.current = mutation;
    return true;
  }, [mutationScope]);

  const clearUncertainMutation = useCallback((expectedKey: string): void => {
    if (uncertainMutation.current?.key !== expectedKey) return;
    uncertainMutation.current = null;
    writePersistedInventoryMutation(window.localStorage, mutationScope, null);
  }, [mutationScope]);

  const applyInventoryResponse = useCallback((payload: {
    inventory: InventoryView;
    derivedStats: DerivedCharacterStats;
    quest?: QuestProgress;
  }) => {
    inventoryRevision.current += 1;
    setInventory(payload.inventory);
    setDerivedStats(payload.derivedStats);
    if (payload.quest) setQuest(payload.quest);
  }, []);

  const refreshInventory = useCallback(async () => {
    const token = {
      requestId: inventoryReadSequence.current + 1,
      revision: inventoryRevision.current,
    };
    inventoryReadSequence.current = token.requestId;
    try {
      const payload = await api.getInventory(session.token, character.id);
      if (!isCurrentInventoryRead(
        token,
        inventoryReadSequence.current,
        inventoryRevision.current,
      )) return false;
      applyInventoryResponse(payload);
      if (!uncertainMutation.current) setInventoryError(null);
      return true;
    } catch (error) {
      if (!isCurrentInventoryRead(
        token,
        inventoryReadSequence.current,
        inventoryRevision.current,
      )) return false;
      if (error instanceof ApiError && error.status === 401) {
        onSessionExpired();
        return false;
      }
      setInventoryError(error instanceof Error ? error.message : "Не удалось обновить инвентарь");
      return false;
    }
  }, [applyInventoryResponse, character.id, onSessionExpired, session.token]);

  const quarantineExpiredMutation = useCallback(async (expectedKey: string): Promise<void> => {
    clearUncertainMutation(expectedKey);
    setInventoryRecoveryWarning(EXPIRED_MUTATION_WARNING);
    setInventoryError(null);
    await refreshInventory();
  }, [clearUncertainMutation, refreshInventory]);

  const requestIdempotentMutation = useCallback((
    mutation: UncertainInventoryMutation,
  ): Promise<IdempotentMutationResponse> => retryAmbiguousMutation<IdempotentMutationResponse>(
    mutation,
    (descriptor) => {
      if (!isInventoryMutationReplayable(descriptor)) {
        throw new ExpiredInventoryMutationError();
      }
      return descriptor.action === "use"
        ? api.useItem(
          session.token,
          character.id,
          descriptor.instanceId,
          descriptor.key,
        )
        : api.enhanceItem(
          session.token,
          character.id,
          descriptor.instanceId,
          descriptor.key,
        );
    },
  ), [character.id, session.token]);

  const reconcileMutationResponse = useCallback(async (
    payload: InventoryApiResponse,
    revisionAtRequestStart: number,
  ): Promise<void> => {
    if (canApplyInventoryMutationResponse(
      revisionAtRequestStart,
      inventoryRevision.current,
    )) {
      applyInventoryResponse(payload);
      return;
    }

    // A socket event or newer read already advanced the state. The POST body can be
    // an older snapshot, so cross the server read barrier instead of applying it.
    await refreshInventory();
  }, [applyInventoryResponse, refreshInventory]);

  const replayPersistedMutation = useCallback(async (): Promise<void> => {
    const mutation = uncertainMutation.current;
    if (!mutation || inventoryRecoveryInFlight.current || inventoryActionInFlight.current) return;

    inventoryRecoveryInFlight.current = true;
    inventoryActionInFlight.current = true;
    setInventoryBusy(mutation.instanceId);
    setInventoryError("Проверяем незавершённую операцию с сервером…");
    const revisionAtRequestStart = inventoryRevision.current;
    try {
      const payload = await requestIdempotentMutation(mutation);
      await reconcileMutationResponse(payload, revisionAtRequestStart);
      clearUncertainMutation(mutation.key);
      setInventoryError(null);
      addFeed({
        id: crypto.randomUUID(),
        at: Date.now(),
        type: "system",
        text: `Восстановлена операция. ${idempotentMutationMessage(mutation, payload)}`,
      });
    } catch (error) {
      if (error instanceof ExpiredInventoryMutationError) {
        await quarantineExpiredMutation(mutation.key);
        return;
      }
      if (error instanceof ApiError && error.status === 401) {
        // Keep the descriptor: a fresh login for the same account can safely replay it.
        onSessionExpired();
        return;
      }
      if (isAmbiguousMutationFailure(error)) {
        await refreshInventory();
        setInventoryError(
          "Сервер пока не подтвердил незавершённую операцию. Она будет безопасно повторена после переподключения.",
        );
      } else {
        clearUncertainMutation(mutation.key);
        setInventoryError(error instanceof Error
          ? `Незавершённая операция отклонена: ${error.message}`
          : "Незавершённая операция отклонена сервером.");
      }
    } finally {
      inventoryRecoveryInFlight.current = false;
      inventoryActionInFlight.current = false;
      setInventoryBusy(null);
    }
  }, [
    addFeed,
    clearUncertainMutation,
    onSessionExpired,
    quarantineExpiredMutation,
    reconcileMutationResponse,
    refreshInventory,
    requestIdempotentMutation,
  ]);

  useEffect(() => {
    const socket: GameSocket = io(API_URL, {
      auth: {
        token: session.token,
        characterId: character.id,
        protocolVersion: PROTOCOL_VERSION,
      },
      transports: ["websocket", "polling"],
      reconnection: true,
      reconnectionDelay: 800,
      reconnectionDelayMax: 5_000,
    });
    socketRef.current = socket;
    socket.on("connect", () => {
      setConnection("online");
      setConnectionError(null);
      setPendingAbilities({});
      if (uncertainMutation.current) void replayPersistedMutation();
      else void refreshInventory();
    });
    socket.on("disconnect", () => {
      setConnection("offline");
      setPendingAbilities({});
    });
    socket.on("connect_error", (error) => {
      setConnection("offline");
      setConnectionError(error.message);
      if (/сессия|session|token/i.test(error.message)) onSessionExpired();
    });
    socket.on("world:ready", (payload) => {
      setQuest(payload.quest);
      void refreshInventory();
      addFeed({ id: crypto.randomUUID(), at: Date.now(), type: "system", text: payload.message });
    });
    socket.on("world:snapshot", setSnapshot);
    socket.on("combat:event", (event: CombatEvent) => {
      addFeed({ id: event.id, at: event.at, type: "combat", text: event.message });
      setCombatCue(event);
    });
    socket.on("combat:ability-result", (result: AbilityUseResult) => {
      setPendingAbilities((current) => {
        if (current[result.abilityId] !== result.seq) return current;
        const next = { ...current };
        delete next[result.abilityId];
        return next;
      });
      const remaining = Math.max(0, result.cooldownReadyAt - result.serverTime);
      if (remaining > 0) {
        setCooldowns((current) => ({
          ...current,
          [result.abilityId]: Date.now() + remaining,
        }));
      }
      if (!result.accepted && result.reason) {
        addFeed({ id: crypto.randomUUID(), at: Date.now(), type: "system", text: result.reason });
      }
    });
    socket.on("system:message", (event: SystemMessage) => {
      addFeed({ id: event.id, at: event.at, type: "system", text: event.text });
    });
    socket.on("chat:message", (event: ChatMessage) => {
      addFeed({ id: event.id, at: event.at, type: "chat", sender: event.senderName, text: event.text });
    });
    socket.on("inventory:update", (payload) => {
      if (payload.view && payload.derivedStats) {
        applyInventoryResponse({ inventory: payload.view, derivedStats: payload.derivedStats });
        return;
      }
      inventoryRevision.current += 1;
      setInventory((current) => ({ ...current, gold: payload.gold }));
      void refreshInventory();
    });
    socket.on("quest:update", setQuest);

    return () => {
      socket.removeAllListeners();
      socket.disconnect();
      socketRef.current = null;
    };
  }, [
    session.token,
    character.id,
    addFeed,
    onSessionExpired,
    refreshInventory,
    replayPersistedMutation,
  ]);

  useEffect(() => {
    if (uncertainMutation.current) void replayPersistedMutation();
    else void refreshInventory();
  }, [refreshInventory, replayPersistedMutation]);

  useEffect(() => {
    const timer = window.setInterval(() => forceClock((value) => value + 1), 100);
    return () => window.clearInterval(timer);
  }, []);

  const own = snapshot?.players.find((player) => player.id === snapshot.selfId) ?? null;
  const selected = useMemo(() => {
    if (!snapshot || !selectedId) return null;
    return (
      snapshot.players.find((entry) => entry.id === selectedId) ??
      snapshot.monsters.find((entry) => entry.id === selectedId) ??
      null
    );
  }, [snapshot, selectedId]);
  const progression = xpProgress(own?.xp ?? character.xp);
  const visualEquipment = useMemo<VisualEquipmentLoadout>(() => Object.fromEntries(
    Object.entries(inventory.equipment)
      .filter((entry): entry is [string, ItemInstance] => Boolean(entry[1]))
      .map(([slot, item]) => [slot, item.itemId]),
  ), [inventory.equipment]);

  const select = useCallback((id: string | null) => {
    setSelectedId(id);
    socketRef.current?.emit("world:target", { targetId: id });
  }, []);

  const move = useCallback((input: MovementInput) => {
    socketRef.current?.emit("world:input", input);
  }, []);

  const useAbility = useCallback(
    (abilityId: AbilityId) => {
      const readyAt = cooldowns[abilityId] ?? 0;
      if (
        connection !== "online"
        || !own?.alive
        || pendingAbilities[abilityId]
        || Date.now() < readyAt
      ) return;
      abilitySequence.current += 1;
      const seq = abilitySequence.current;
      socketRef.current?.emit("combat:use", {
        seq,
        abilityId,
        targetId: selectedId,
      });
      setPendingAbilities((current) => ({ ...current, [abilityId]: seq }));
      window.setTimeout(() => {
        setPendingAbilities((current) => {
          if (current[abilityId] !== seq) return current;
          const next = { ...current };
          delete next[abilityId];
          return next;
        });
      }, 4_000);
    },
    [connection, cooldowns, own?.alive, pendingAbilities, selectedId],
  );

  const pickup = useCallback((lootId: string) => {
    socketRef.current?.emit("loot:pickup", { lootId });
  }, []);

  const handleItemAction = useCallback(async (
    action: ItemAction,
    item: ItemInstance,
    slot?: EquipmentSlot,
  ) => {
    if (connection !== "online") {
      setInventoryError("Действие недоступно, пока соединение с миром не восстановлено.");
      return;
    }
    if (inventoryActionInFlight.current) return;
    if (
      uncertainMutation.current
      && !isInventoryMutationReplayable(uncertainMutation.current)
    ) {
      await quarantineExpiredMutation(uncertainMutation.current.key);
      return;
    }
    const idempotentAction: IdempotentInventoryAction | null = action === "use" || action === "enhance"
      ? action
      : null;
    const intent = idempotentAction
      ? { action: idempotentAction, instanceId: item.instanceId }
      : null;
    const fingerprint = intent
      ? inventoryMutationFingerprint(intent)
      : `${action}:${item.instanceId}`;
    if (uncertainMutation.current && uncertainMutation.current.fingerprint !== fingerprint) {
      setInventoryError(
        "Сначала повторите предыдущее действие: сервер безопасно вернёт его исходный результат.",
      );
      return;
    }
    const preparedMutation = intent
      ? prepareInventoryMutation(uncertainMutation.current, intent, () => crypto.randomUUID())
      : null;
    if (preparedMutation?.blocked) {
      setInventoryError(
        "Сначала повторите предыдущее действие: сервер безопасно вернёт его исходный результат.",
      );
      return;
    }
    if (preparedMutation && !persistUncertainMutation(preparedMutation.mutation)) {
      setInventoryError(
        "Браузер не позволил сохранить защитный ключ операции. Освободите локальное хранилище и повторите.",
      );
      return;
    }
    inventoryActionInFlight.current = true;
    setInventoryBusy(item.instanceId);
    setInventoryError(null);
    const revisionAtRequestStart = inventoryRevision.current;
    try {
      let payload: InventoryApiResponse;
      let actionMessage: string;
      if (action === "equip") {
        const allowed = getAllowedEquipmentSlots(getItem(item.itemId));
        const targetSlot = slot ?? allowed.find((candidate) => !inventory.equipment[candidate]);
        payload = await api.equipItem(session.token, character.id, item.instanceId, targetSlot);
        actionMessage = "Снаряжение экипировано.";
      } else if (action === "unequip") {
        const targetSlot = slot ?? item.equippedSlot;
        if (!targetSlot) throw new Error("Предмет не экипирован");
        payload = await api.unequipItem(session.token, character.id, targetSlot);
        actionMessage = "Снаряжение снято.";
      } else {
        const mutation = preparedMutation?.mutation;
        if (!mutation) throw new Error("Не удалось подготовить защищённую операцию");
        const idempotentPayload = await requestIdempotentMutation(mutation);
        payload = idempotentPayload;
        actionMessage = idempotentMutationMessage(mutation, idempotentPayload);
      }
      await reconcileMutationResponse(payload, revisionAtRequestStart);
      if (preparedMutation) clearUncertainMutation(preparedMutation.mutation.key);
      addFeed({ id: crypto.randomUUID(), at: Date.now(), type: "system", text: actionMessage });
    } catch (error) {
      if (error instanceof ExpiredInventoryMutationError && preparedMutation) {
        await quarantineExpiredMutation(preparedMutation.mutation.key);
        return;
      }
      if (error instanceof ApiError && error.status === 401) {
        // A pending idempotent intent survives reauthentication for the same account.
        onSessionExpired();
        return;
      }
      if (preparedMutation && isAmbiguousMutationFailure(error)) {
        await refreshInventory();
        setInventoryError(
          "Исход операции пока не подтверждён. Она будет автоматически повторена с тем же защитным ключом.",
        );
      } else {
        if (preparedMutation) clearUncertainMutation(preparedMutation.mutation.key);
        setInventoryError(error instanceof Error ? error.message : "Действие с предметом не выполнено");
      }
    } finally {
      inventoryActionInFlight.current = false;
      setInventoryBusy(null);
    }
  }, [
    addFeed,
    character.id,
    clearUncertainMutation,
    connection,
    inventory.equipment,
    onSessionExpired,
    persistUncertainMutation,
    quarantineExpiredMutation,
    reconcileMutationResponse,
    refreshInventory,
    requestIdempotentMutation,
    session.token,
  ]);

  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      if (event.code === "Escape" && inventoryOpen) {
        event.preventDefault();
        setInventoryOpen(false);
        return;
      }
      if (event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement) return;
      if (event.code === "KeyI" || event.code === "KeyB") {
        event.preventDefault();
        setInventoryOpen((current) => !current);
        return;
      }
      if (inventoryOpen) return;
      if (event.code === "Digit1") useAbility("basic");
      if (event.code === "Digit2") useAbility(classInfo.signatureAbilityId);
      if (event.code === "KeyF" && own && snapshot) {
        const nearest = [...snapshot.loot]
          .sort((a, b) => distance(own.position, a.position) - distance(own.position, b.position))[0];
        if (nearest && distance(own.position, nearest.position) <= 3.3) pickup(nearest.id);
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [classInfo.signatureAbilityId, inventoryOpen, own, pickup, snapshot, useAbility]);

  const sendChat = (event: FormEvent) => {
    event.preventDefault();
    const text = chatText.trim();
    if (!text) return;
    socketRef.current?.emit("chat:send", { text });
    setChatText("");
  };

  const signature = ABILITIES[classInfo.signatureAbilityId];

  return (
    <main className="game-shell">
      <WorldCanvas
        snapshot={snapshot}
        selectedId={selectedId}
        ownEquipment={visualEquipment}
        inputBlocked={inventoryOpen}
        combatEvent={combatCue}
        onSelect={select}
        onInput={move}
        onPickup={pickup}
      />

      <header className="game-topbar hud-panel">
        <div className="zone-copy">
          <p className="eyebrow">Текущая область</p>
          <strong>{displayZoneName(snapshot?.zoneName)}</strong>
        </div>
        <div className={`connection-pill ${connection}`}>
          <span />
          {connection === "online" ? "Связь стабильна" : connection === "connecting" ? "Соединяемся" : "Переподключение"}
        </div>
        <button className="exit-button" onClick={onExit}>К выбору героя</button>
      </header>

      {own && (
        <section className="player-frame hud-panel">
          <div className="portrait" style={{ "--portrait": classInfo.color } as React.CSSProperties}>
            {own.level}
          </div>
          <div className="unit-bars">
            <div className="unit-title"><strong>{own.name}</strong><span>{classInfo.name}</span></div>
            <div className="bar hp" style={barStyle(own.hp, own.maxHp)}><span>{own.hp} / {own.maxHp}</span></div>
            <div className="bar mp" style={barStyle(own.mp, own.maxMp)}><span>{own.mp} / {own.maxMp}</span></div>
            <div className="bar xp" style={barStyle(progression.current, progression.required || 1)}><span>Опыт {progression.current} / {progression.required || "MAX"}</span></div>
          </div>
        </section>
      )}

      {selected && (
        <section className="target-frame hud-panel">
          <div className="unit-title">
            <strong>{selected.name}</strong>
            <span>{"elite" in selected && selected.elite ? "Элита" : `Уровень ${selected.level}`}</span>
          </div>
          <div className="bar target-hp" style={barStyle(selected.hp, selected.maxHp)}>
            <span>{selected.hp} / {selected.maxHp}</span>
          </div>
        </section>
      )}

      <aside className="right-hud">
        {snapshot && <MiniMap snapshot={snapshot} />}
        <section className="quest-card hud-panel">
          <p className="eyebrow">Поручение</p>
          <strong>Зов переправы</strong>
          <span>{quest.status === "completed" ? "Завершено" : "Обезопасьте подступы Донмера"}</span>
          <div className="quest-progress"><i style={{ width: `${(quest.current / quest.required) * 100}%` }} /></div>
          <small>{quest.current} / {quest.required}</small>
        </section>
        <section className="inventory-card hud-panel">
          <button className="inventory-quick" onClick={() => setInventoryOpen(true)}>
            <span className="inventory-quick-copy">
              <small>Инвентарь</small>
              <strong>{inventory.usedSlots} / {inventory.capacity} ячеек</strong>
            </span>
            <span className="inventory-quick-items" aria-hidden="true">
              {inventory.items.slice(0, 4).map((item) => (
                <i key={item.instanceId} style={{ background: getItem(item.itemId).visual.primaryColor }} />
              ))}
            </span>
            <span className="inventory-quick-wallet">{inventory.gold.toLocaleString("ru-RU")} ◇</span>
            <kbd>I</kbd>
          </button>
        </section>
      </aside>

      <section className="chat-panel hud-panel">
        <div className="feed" aria-live="polite">
          {feed.slice(-9).map((entry) => (
            <div key={entry.id} className={`feed-entry ${entry.type}`}>
              {entry.type === "chat" && <b>{entry.sender}:</b>} {entry.text}
            </div>
          ))}
        </div>
        <form onSubmit={sendChat}>
          <span>Рядом</span>
          <input value={chatText} onChange={(event) => setChatText(event.target.value)} maxLength={240} placeholder="Enter — отправить сообщение" />
          <button type="submit" aria-label="Отправить сообщение">↗</button>
        </form>
      </section>

      <section className="action-bar hud-panel">
        {[ABILITIES.basic, signature].map((ability) => {
          const remaining = Math.max(0, (cooldowns[ability.id] ?? 0) - Date.now());
          const pending = Boolean(pendingAbilities[ability.id]);
          return (
            <button
              key={ability.id}
              className={pending ? "ability-button is-casting" : "ability-button"}
              onClick={() => useAbility(ability.id)}
              disabled={connection !== "online" || !own?.alive || pending || remaining > 0}
              title={ability.description}
              aria-label={`${ability.name}. ${ability.description}`}
              aria-keyshortcuts={ability.hotkey}
              aria-busy={pending}
            >
              <SkillIcon
                abilityId={ability.id}
                roleHint={`${character.classId} ${classInfo.role}`}
                active={pending}
              />
              <strong>{ability.name}</strong>
              <kbd>{ability.hotkey}</kbd>
              {pending ? <i>…</i> : remaining > 0 && <i>{(remaining / 1000).toFixed(1)}</i>}
            </button>
          );
        })}
        <div className="control-hint"><b>WASD / клик</b><span>движение</span></div>
        <div className="control-hint"><b>F</b><span>поднять</span></div>
      </section>

      <button className="mobile-inventory-trigger hud-panel" onClick={() => setInventoryOpen(true)}>
        <span aria-hidden="true">◇</span>
        <strong>Сумка</strong>
        <small>{inventory.usedSlots}/{inventory.capacity}</small>
      </button>

      {inventoryRecoveryWarning && (
        <div className="inventory-recovery-warning" role="alert">
          {inventoryRecoveryWarning}
        </div>
      )}

      <InventoryPanel
        open={inventoryOpen}
        characterName={own?.name ?? character.name}
        characterLevel={own?.level ?? character.level}
        characterClassId={character.classId}
        className={classInfo.name}
        inventory={inventory}
        derivedStats={derivedStats}
        busyAction={inventoryBusy}
        actionsDisabled={connection !== "online"}
        error={inventoryError}
        onClose={() => setInventoryOpen(false)}
        onAction={handleItemAction}
      />

      {own?.pvpEnabled && <div className="pvp-warning">КРУГ СПОРА · PVP</div>}
      {connectionError && connection === "offline" && <div className="connection-error">{connectionError}</div>}
    </main>
  );
}
