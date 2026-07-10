import { existsSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const candidates = [
  process.env.BLENDER_BIN,
  "/Applications/Blender.app/Contents/MacOS/Blender",
  "blender",
].filter(Boolean);
const blender = candidates.find((candidate) => candidate === "blender" || existsSync(candidate));

if (!blender) {
  throw new Error("Blender 4.x was not found. Set BLENDER_BIN to the Blender executable.");
}

const result = spawnSync(
  blender,
  [
    "--background",
    "--factory-startup",
    "--python",
    resolve(root, "tools/build_character_roster.py"),
    "--",
    "--output",
    resolve(root, "apps/client/public/assets/models"),
    "--source",
    resolve(root, "third_party/kaykit/adventurers"),
  ],
  { cwd: root, stdio: "inherit", env: { ...process.env, PYTHONHASHSEED: "0" } },
);

if (result.error) throw result.error;
if (result.status !== 0) process.exit(result.status ?? 1);
