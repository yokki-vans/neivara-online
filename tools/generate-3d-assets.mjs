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

const output = resolve(root, "apps/client/public/assets/models");
const script = resolve(root, "tools/generate_3d_assets.py");
const result = spawnSync(
  blender,
  ["--background", "--factory-startup", "--python", script, "--", "--output", output],
  { cwd: root, stdio: "inherit", env: { ...process.env, PYTHONHASHSEED: "0" } },
);

if (result.error) throw result.error;
if (result.status !== 0) process.exit(result.status ?? 1);
