import type { AppConfig } from "../config.js";
import { MemoryGameStore } from "./memory.js";
import { PostgresGameStore } from "./postgres.js";
import type { GameStore } from "./types.js";

export * from "./types.js";
export { MemoryGameStore } from "./memory.js";

export function createStore(config: AppConfig): GameStore {
  if (config.storageMode === "postgres") {
    return new PostgresGameStore(
      config.databaseUrl!,
      config.databaseSsl,
      config.autoMigrate,
      undefined,
      config.migrationLockTimeoutMs,
    );
  }
  return new MemoryGameStore();
}
