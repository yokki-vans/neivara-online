import type {
  CharacterSummary,
  ClassId,
  InventoryStack,
  ItemId,
  QuestProgress,
  RaceId,
  Vec3,
} from "@neivara/shared";

export interface AccountRecord {
  id: string;
  username: string;
  usernameKey: string;
  passwordHash: string;
  createdAt: Date;
}

export interface CharacterRecord extends CharacterSummary {
  accountId: string;
  position: Vec3;
  hp: number;
  mp: number;
  createdAt: string;
}

export interface NewCharacter {
  accountId: string;
  name: string;
  race: RaceId;
  classId: ClassId;
  hp: number;
  mp: number;
}

export interface SavedCharacterState {
  id: string;
  position: Vec3;
  hp: number;
  mp: number;
  xp: number;
  level: number;
  gold: number;
}

export interface GameStore {
  initialize(): Promise<void>;
  close(): Promise<void>;
  createAccount(username: string, passwordHash: string): Promise<AccountRecord>;
  findAccountByUsername(username: string): Promise<AccountRecord | null>;
  listCharacters(accountId: string): Promise<CharacterSummary[]>;
  createCharacter(input: NewCharacter): Promise<CharacterRecord>;
  getCharacterForAccount(characterId: string, accountId: string): Promise<CharacterRecord | null>;
  saveCharacterState(state: SavedCharacterState): Promise<void>;
  getInventory(characterId: string): Promise<InventoryStack[]>;
  addInventoryItem(characterId: string, itemId: ItemId, quantity: number): Promise<InventoryStack[]>;
  getQuest(characterId: string): Promise<QuestProgress>;
  saveQuest(characterId: string, progress: QuestProgress): Promise<void>;
}

export class ConflictError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ConflictError";
  }
}

export class LimitError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "LimitError";
  }
}
