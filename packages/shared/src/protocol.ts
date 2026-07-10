import type {
  AbilityId,
  ClassId,
  GenderId,
  MonsterKind,
  RaceId,
  StarterZoneId,
} from "./content.js";
import type {
  DerivedCharacterStats,
  EquipmentSlot,
  InventoryView,
  ItemId,
} from "./items.js";

export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

export interface AccountView {
  id: string;
  username: string;
  createdAt: string;
}

export interface CharacterSummary {
  id: string;
  name: string;
  race: RaceId;
  gender: GenderId;
  classId: ClassId;
  level: number;
  xp: number;
  gold: number;
  lastSeenAt: string;
}

export interface AuthResponse {
  token: string;
  account: AccountView;
}

export interface InventoryStack {
  itemId: ItemId;
  quantity: number;
}

export interface QuestProgress {
  questId: "first_echoes";
  status: "active" | "completed";
  current: number;
  required: number;
}

export interface PlayerSnapshot {
  id: string;
  name: string;
  race: RaceId;
  gender: GenderId;
  classId: ClassId;
  position: Vec3;
  rotationY: number;
  level: number;
  xp: number;
  hp: number;
  maxHp: number;
  mp: number;
  maxMp: number;
  gold: number;
  alive: boolean;
  pvpEnabled: boolean;
  targetId: string | null;
  equipment: Partial<Record<EquipmentSlot, ItemId>>;
}

export interface MonsterSnapshot {
  id: string;
  kind: MonsterKind;
  name: string;
  position: Vec3;
  rotationY: number;
  level: number;
  hp: number;
  maxHp: number;
  alive: boolean;
  elite: boolean;
  targetId: string | null;
  respawnAt: number | null;
}

export interface LootSnapshot {
  id: string;
  itemId: ItemId;
  name: string;
  quantity: number;
  position: Vec3;
  ownerId: string | null;
  publicAt: number;
  expiresAt: number;
}

export interface WorldSnapshot {
  protocolVersion: number;
  serverTime: number;
  tick: number;
  selfId: string;
  lastProcessedInput: number;
  zoneId: StarterZoneId;
  zoneName: string;
  players: PlayerSnapshot[];
  monsters: MonsterSnapshot[];
  loot: LootSnapshot[];
}

export interface WorldReady {
  character: CharacterSummary;
  inventory: InventoryStack[];
  quest: QuestProgress;
  message: string;
}

export interface MovementInput {
  seq: number;
  direction: { x: number; z: number };
  facing: number;
  sprint: boolean;
}

export interface TargetInput {
  targetId: string | null;
}

export interface UseAbilityInput {
  seq: number;
  abilityId: AbilityId;
  targetId: string | null;
}

export interface PickupInput {
  lootId: string;
}

export interface CombatEvent {
  id: string;
  at: number;
  sourceId: string;
  targetId: string;
  abilityId: AbilityId;
  kind: "damage" | "heal" | "miss" | "defeat";
  amount: number;
  critical: boolean;
  message: string;
}

export interface AbilityUseResult {
  seq: number;
  abilityId: AbilityId;
  accepted: boolean;
  serverTime: number;
  cooldownReadyAt: number;
  reason?: string;
}

export interface ChatMessage {
  id: string;
  at: number;
  senderId: string | null;
  senderName: string;
  text: string;
  channel: "local" | "system";
}

export interface SystemMessage {
  id: string;
  at: number;
  level: "info" | "success" | "warning" | "error";
  text: string;
}

export interface InventoryUpdate {
  inventory: InventoryStack[];
  gold: number;
  view?: InventoryView;
  derivedStats?: DerivedCharacterStats;
}

export interface ServerToClientEvents {
  "world:ready": (payload: WorldReady) => void;
  "world:snapshot": (payload: WorldSnapshot) => void;
  "combat:event": (payload: CombatEvent) => void;
  "combat:ability-result": (payload: AbilityUseResult) => void;
  "chat:message": (payload: ChatMessage) => void;
  "system:message": (payload: SystemMessage) => void;
  "inventory:update": (payload: InventoryUpdate) => void;
  "quest:update": (payload: QuestProgress) => void;
}

export interface ClientToServerEvents {
  "world:input": (payload: MovementInput) => void;
  "world:target": (payload: TargetInput) => void;
  "combat:use": (payload: UseAbilityInput) => void;
  "loot:pickup": (payload: PickupInput) => void;
  "chat:send": (payload: { text: string }) => void;
}

export interface InterServerEvents {}

export interface SocketData {
  accountId: string;
  characterId: string;
  characterName: string;
}
