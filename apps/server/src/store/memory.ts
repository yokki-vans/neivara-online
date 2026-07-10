import { randomUUID } from "node:crypto";
import type { CharacterSummary, InventoryStack, ItemId, QuestProgress } from "@neivara/shared";
import {
  ConflictError,
  LimitError,
  type AccountRecord,
  type CharacterRecord,
  type GameStore,
  type NewCharacter,
  type SavedCharacterState,
} from "./types.js";

function cloneCharacter(record: CharacterRecord): CharacterRecord {
  return { ...record, position: { ...record.position } };
}

function toSummary(record: CharacterRecord): CharacterSummary {
  const { id, name, race, classId, level, xp, gold, lastSeenAt } = record;
  return { id, name, race, classId, level, xp, gold, lastSeenAt };
}

export class MemoryGameStore implements GameStore {
  private readonly accounts = new Map<string, AccountRecord>();
  private readonly accountByUsername = new Map<string, string>();
  private readonly characters = new Map<string, CharacterRecord>();
  private readonly characterByName = new Map<string, string>();
  private readonly inventories = new Map<string, Map<ItemId, number>>();
  private readonly quests = new Map<string, QuestProgress>();

  async initialize(): Promise<void> {}

  async close(): Promise<void> {}

  async createAccount(username: string, passwordHash: string): Promise<AccountRecord> {
    const usernameKey = username.toLocaleLowerCase("ru");
    if (this.accountByUsername.has(usernameKey)) {
      throw new ConflictError("Аккаунт с таким логином уже существует");
    }

    const account: AccountRecord = {
      id: randomUUID(),
      username,
      usernameKey,
      passwordHash,
      createdAt: new Date(),
    };
    this.accounts.set(account.id, account);
    this.accountByUsername.set(usernameKey, account.id);
    return { ...account };
  }

  async findAccountByUsername(username: string): Promise<AccountRecord | null> {
    const id = this.accountByUsername.get(username.toLocaleLowerCase("ru"));
    const value = id ? this.accounts.get(id) : undefined;
    return value ? { ...value } : null;
  }

  async listCharacters(accountId: string): Promise<CharacterSummary[]> {
    return [...this.characters.values()]
      .filter((character) => character.accountId === accountId)
      .sort((a, b) => b.lastSeenAt.localeCompare(a.lastSeenAt))
      .map(toSummary);
  }

  async createCharacter(input: NewCharacter): Promise<CharacterRecord> {
    const owned = [...this.characters.values()].filter(
      (character) => character.accountId === input.accountId,
    );
    if (owned.length >= 7) throw new LimitError("Достигнут лимит в 7 персонажей");

    const nameKey = input.name.toLocaleLowerCase("ru");
    if (this.characterByName.has(nameKey)) {
      throw new ConflictError("Это имя уже занято");
    }

    const now = new Date().toISOString();
    const record: CharacterRecord = {
      id: randomUUID(),
      accountId: input.accountId,
      name: input.name,
      race: input.race,
      classId: input.classId,
      level: 1,
      xp: 0,
      hp: input.hp,
      mp: input.mp,
      gold: 0,
      position: { x: 0, y: 0, z: 0 },
      createdAt: now,
      lastSeenAt: now,
    };

    this.characters.set(record.id, record);
    this.characterByName.set(nameKey, record.id);
    this.inventories.set(record.id, new Map());
    this.quests.set(record.id, {
      questId: "first_echoes",
      status: "active",
      current: 0,
      required: 3,
    });
    return cloneCharacter(record);
  }

  async getCharacterForAccount(
    characterId: string,
    accountId: string,
  ): Promise<CharacterRecord | null> {
    const record = this.characters.get(characterId);
    return record?.accountId === accountId ? cloneCharacter(record) : null;
  }

  async saveCharacterState(state: SavedCharacterState): Promise<void> {
    const record = this.characters.get(state.id);
    if (!record) return;
    Object.assign(record, {
      position: { ...state.position },
      hp: state.hp,
      mp: state.mp,
      xp: state.xp,
      level: state.level,
      gold: state.gold,
      lastSeenAt: new Date().toISOString(),
    });
  }

  async getInventory(characterId: string): Promise<InventoryStack[]> {
    const inventory = this.inventories.get(characterId) ?? new Map<ItemId, number>();
    return [...inventory.entries()].map(([itemId, quantity]) => ({ itemId, quantity }));
  }

  async addInventoryItem(
    characterId: string,
    itemId: ItemId,
    quantity: number,
  ): Promise<InventoryStack[]> {
    const inventory = this.inventories.get(characterId) ?? new Map<ItemId, number>();
    inventory.set(itemId, Math.max(0, (inventory.get(itemId) ?? 0) + quantity));
    this.inventories.set(characterId, inventory);
    return this.getInventory(characterId);
  }

  async getQuest(characterId: string): Promise<QuestProgress> {
    return {
      ...(this.quests.get(characterId) ?? {
        questId: "first_echoes",
        status: "active",
        current: 0,
        required: 3,
      }),
    };
  }

  async saveQuest(characterId: string, progress: QuestProgress): Promise<void> {
    this.quests.set(characterId, { ...progress });
  }
}
