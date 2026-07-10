import {
  ABILITIES,
  ITEMS,
  PROTOCOL_VERSION,
  getClass,
  xpProgress,
  type AbilityId,
  type CharacterSummary,
  type ChatMessage,
  type ClientToServerEvents,
  type CombatEvent,
  type InventoryStack,
  type MovementInput,
  type QuestProgress,
  type ServerToClientEvents,
  type SystemMessage,
  type WorldSnapshot,
} from "@neivara/shared";
import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { io, type Socket } from "socket.io-client";
import { API_URL } from "../api";
import { WorldCanvas } from "../game/WorldCanvas";
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

function barStyle(current: number, max: number): React.CSSProperties {
  return { "--bar-value": `${max > 0 ? Math.max(0, Math.min(100, (current / max) * 100)) : 0}%` } as React.CSSProperties;
}

function distance(a: { x: number; z: number }, b: { x: number; z: number }): number {
  return Math.hypot(a.x - b.x, a.z - b.z);
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
  const [snapshot, setSnapshot] = useState<WorldSnapshot | null>(null);
  const [connection, setConnection] = useState<"connecting" | "online" | "offline">("connecting");
  const [connectionError, setConnectionError] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [inventory, setInventory] = useState<InventoryStack[]>([]);
  const [quest, setQuest] = useState<QuestProgress>({
    questId: "first_echoes",
    status: "active",
    current: 0,
    required: 3,
  });
  const [feed, setFeed] = useState<FeedEntry[]>([]);
  const [chatText, setChatText] = useState("");
  const [cooldowns, setCooldowns] = useState<Partial<Record<AbilityId, number>>>({});
  const [, forceClock] = useState(0);

  const addFeed = useCallback((entry: FeedEntry) => {
    setFeed((current) => [...current.slice(-44), entry]);
  }, []);

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
    });
    socket.on("disconnect", () => setConnection("offline"));
    socket.on("connect_error", (error) => {
      setConnection("offline");
      setConnectionError(error.message);
      if (/сессия|session|token/i.test(error.message)) onSessionExpired();
    });
    socket.on("world:ready", (payload) => {
      setInventory(payload.inventory);
      setQuest(payload.quest);
      addFeed({ id: crypto.randomUUID(), at: Date.now(), type: "system", text: payload.message });
    });
    socket.on("world:snapshot", setSnapshot);
    socket.on("combat:event", (event: CombatEvent) => {
      addFeed({ id: event.id, at: event.at, type: "combat", text: event.message });
    });
    socket.on("system:message", (event: SystemMessage) => {
      addFeed({ id: event.id, at: event.at, type: "system", text: event.text });
    });
    socket.on("chat:message", (event: ChatMessage) => {
      addFeed({ id: event.id, at: event.at, type: "chat", sender: event.senderName, text: event.text });
    });
    socket.on("inventory:update", (payload) => setInventory(payload.inventory));
    socket.on("quest:update", setQuest);

    return () => {
      socket.removeAllListeners();
      socket.disconnect();
      socketRef.current = null;
    };
  }, [session.token, character.id, addFeed, onSessionExpired]);

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
  const classInfo = getClass(character.classId);
  const progression = xpProgress(own?.xp ?? character.xp);

  const select = useCallback((id: string | null) => {
    setSelectedId(id);
    socketRef.current?.emit("world:target", { targetId: id });
  }, []);

  const move = useCallback((input: MovementInput) => {
    socketRef.current?.emit("world:input", input);
  }, []);

  const useAbility = useCallback(
    (abilityId: AbilityId) => {
      const ability = ABILITIES[abilityId];
      const readyAt = cooldowns[abilityId] ?? 0;
      if (Date.now() < readyAt) return;
      socketRef.current?.emit("combat:use", {
        seq: Date.now(),
        abilityId,
        targetId: selectedId,
      });
      setCooldowns((current) => ({ ...current, [abilityId]: Date.now() + ability.cooldownMs }));
    },
    [cooldowns, selectedId],
  );

  const pickup = useCallback((lootId: string) => {
    socketRef.current?.emit("loot:pickup", { lootId });
  }, []);

  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      if (event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement) return;
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
  }, [classInfo.signatureAbilityId, own, pickup, snapshot, useAbility]);

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
        onSelect={select}
        onInput={move}
        onPickup={pickup}
      />

      <header className="game-topbar hud-panel">
        <div className="zone-copy">
          <p className="eyebrow">Текущая область</p>
          <strong>{snapshot?.zoneName ?? "Долина Тихих Истоков"}</strong>
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
          <strong>Первые отголоски</strong>
          <span>{quest.status === "completed" ? "Завершено" : "Рассейте топкие отголоски"}</span>
          <div className="quest-progress"><i style={{ width: `${(quest.current / quest.required) * 100}%` }} /></div>
          <small>{quest.current} / {quest.required}</small>
        </section>
        <section className="inventory-card hud-panel">
          <div className="inventory-title"><span>Сумка</span><b>{own?.gold ?? character.gold} ◇</b></div>
          <div className="inventory-items">
            {inventory.length === 0 ? <small>Пока пусто</small> : inventory.map((stack) => (
              <div key={stack.itemId} className="inventory-item" title={ITEMS[stack.itemId].description}>
                <i style={{ background: ITEMS[stack.itemId].color }} />
                <span>{ITEMS[stack.itemId].name}</span>
                <b>{stack.quantity}</b>
              </div>
            ))}
          </div>
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
          return (
            <button key={ability.id} onClick={() => useAbility(ability.id)} disabled={remaining > 0} title={ability.description}>
              <span className="ability-glyph" style={{ background: ability.color }} />
              <strong>{ability.name}</strong>
              <kbd>{ability.hotkey}</kbd>
              {remaining > 0 && <i>{(remaining / 1000).toFixed(1)}</i>}
            </button>
          );
        })}
        <div className="control-hint"><b>WASD / клик</b><span>движение</span></div>
        <div className="control-hint"><b>F</b><span>поднять</span></div>
      </section>

      {own?.pvpEnabled && <div className="pvp-warning">КРУГ СПОРА · PVP</div>}
      {connectionError && connection === "offline" && <div className="connection-error">{connectionError}</div>}
    </main>
  );
}
