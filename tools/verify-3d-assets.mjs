import { createHash } from "node:crypto";
import { readFile, stat } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const modelRoot = resolve(root, "apps/client/public/assets/models");
const manifest = JSON.parse(await readFile(resolve(modelRoot, "manifest.json"), "utf8"));

const EXPECTED_RACES = ["human", "light_elf", "dark_elf", "dwarf", "orc"];
const EXPECTED_GENDERS = ["male", "female"];
const EXPECTED_ARCHETYPES = ["warrior", "mage"];
const EXPECTED_HUMANOID_CLIPS = ["attack", "cast", "death", "hit", "idle", "run"];
const EXPECTED_MONSTER_CLIPS = ["attack", "death", "hit", "idle", "run"];

function invariant(condition, message) {
  if (!condition) throw new Error(message);
}

function parseGlb(buffer, label) {
  invariant(buffer.length >= 28, `${label}: truncated GLB`);
  invariant(buffer.toString("ascii", 0, 4) === "glTF", `${label}: invalid GLB magic`);
  invariant(buffer.readUInt32LE(4) === 2, `${label}: expected glTF 2.0`);
  invariant(buffer.readUInt32LE(8) === buffer.length, `${label}: declared length does not match file`);
  const jsonLength = buffer.readUInt32LE(12);
  invariant(buffer.toString("ascii", 16, 20) === "JSON", `${label}: missing JSON chunk`);
  const jsonEnd = 20 + jsonLength;
  const document = JSON.parse(buffer.toString("utf8", 20, jsonEnd).replace(/[\0 ]+$/u, ""));
  invariant(jsonEnd + 8 <= buffer.length, `${label}: missing binary chunk`);
  invariant(buffer.toString("ascii", jsonEnd + 4, jsonEnd + 8) === "BIN\0", `${label}: missing BIN chunk`);
  invariant(document.asset?.version === "2.0", `${label}: malformed glTF asset declaration`);
  return document;
}

function glbStats(document) {
  let triangles = 0;
  for (const mesh of document.meshes ?? []) {
    for (const primitive of mesh.primitives ?? []) {
      invariant(primitive.mode === undefined || primitive.mode === 4, "Only triangle-list primitives are supported");
      const accessor = document.accessors?.[primitive.indices];
      invariant(accessor?.count > 0, "Every mesh primitive must contain indexed geometry");
      triangles += Math.floor(accessor.count / 3);
      const position = document.accessors?.[primitive.attributes?.POSITION];
      invariant(position?.count >= 3, "Every mesh primitive must contain positions");
      invariant(Array.isArray(position.min) && Array.isArray(position.max), "Position bounds are required for culling");
    }
  }
  return {
    meshes: document.meshes?.length ?? 0,
    triangles,
    skins: document.skins?.length ?? 0,
    animations: (document.animations ?? []).map((animation) => animation.name).sort(),
    embeddedTextures: document.images?.length ?? 0,
  };
}

invariant(manifest.version === "1.0.0", "Unexpected 3D manifest version");
invariant(manifest.generator === "tools/generate_3d_assets.py", "Manifest must name the deterministic generator");
invariant(manifest.seed === 7012026, "Generator seed changed without a manifest version bump");
invariant(
  manifest.license === "Proprietary project-original clean-room assets; repository LICENSE applies",
  "3D manifest must use the repository's unambiguous proprietary license",
);
invariant(Array.isArray(manifest.assets), "Manifest assets must be an array");

const ids = new Set();
const humanoidCombinations = new Set();
const counts = { humanoid: 0, monster: 0, architecture: 0, prop: 0 };
let totalBytes = 0;
let totalTriangles = 0;

for (const asset of manifest.assets) {
  invariant(!ids.has(asset.id), `Duplicate asset id: ${asset.id}`);
  ids.add(asset.id);
  invariant(Object.hasOwn(counts, asset.kind), `Unknown asset kind: ${asset.kind}`);
  counts[asset.kind] += 1;
  invariant(typeof asset.url === "string" && asset.url.startsWith("./"), `${asset.id}: URL must be manifest-relative`);
  const absolute = resolve(modelRoot, asset.url.replace(/^\.\//u, ""));
  invariant(absolute.startsWith(`${modelRoot}/`), `${asset.id}: unsafe asset path`);
  const details = await stat(absolute);
  invariant(details.isFile() && details.size > 0, `${asset.id}: missing GLB`);
  invariant(details.size <= 1_000_000, `${asset.id}: exceeds the 1 MB per-model web budget`);
  const bytes = await readFile(absolute);
  const hash = createHash("sha256").update(bytes).digest("hex");
  invariant(hash === asset.stats.sha256, `${asset.id}: SHA-256 mismatch; regenerate the manifest`);
  invariant(details.size === asset.stats.bytes, `${asset.id}: byte count mismatch`);
  const document = parseGlb(bytes, asset.id);
  const actual = glbStats(document);
  invariant(actual.meshes === asset.stats.meshes, `${asset.id}: mesh count mismatch`);
  invariant(actual.triangles === asset.stats.triangles, `${asset.id}: triangle count mismatch`);
  invariant(actual.skins === asset.stats.skins, `${asset.id}: skin count mismatch`);
  invariant(JSON.stringify(actual.animations) === JSON.stringify([...asset.stats.animations].sort()), `${asset.id}: animation list mismatch`);
  invariant(actual.embeddedTextures === asset.stats.embeddedTextures, `${asset.id}: embedded texture count mismatch`);
  invariant(actual.meshes > 0 && actual.triangles > 0, `${asset.id}: empty geometry`);
  invariant((document.nodes?.length ?? 0) >= actual.meshes, `${asset.id}: mesh nodes are missing`);

  if (asset.kind === "humanoid") {
    invariant(EXPECTED_RACES.includes(asset.race), `${asset.id}: unsupported race`);
    invariant(EXPECTED_GENDERS.includes(asset.gender), `${asset.id}: unsupported gender`);
    invariant(EXPECTED_ARCHETYPES.includes(asset.archetype), `${asset.id}: unsupported archetype`);
    humanoidCombinations.add(`${asset.race}/${asset.gender}/${asset.archetype}`);
    invariant(actual.meshes >= 60, `${asset.id}: humanoid lost modeled components`);
    invariant(actual.triangles >= 9_000, `${asset.id}: humanoid geometry is below the authored-detail floor`);
    invariant(actual.triangles <= 15_000, `${asset.id}: humanoid exceeds the browser topology budget`);
    invariant(actual.skins >= 1, `${asset.id}: humanoid must be skinned`);
    invariant((document.nodes?.length ?? 0) > actual.meshes, `${asset.id}: humanoid rig hierarchy is missing`);
    invariant(actual.embeddedTextures >= 1, `${asset.id}: humanoid must embed its generated outfit texture`);
    invariant(JSON.stringify(actual.animations) === JSON.stringify(EXPECTED_HUMANOID_CLIPS), `${asset.id}: incomplete animation set`);
  } else if (asset.kind === "monster") {
    invariant(actual.meshes >= 20 && actual.triangles >= 3_000, `${asset.id}: monster geometry is below the authored-detail floor`);
    invariant(actual.triangles <= 8_500, `${asset.id}: monster exceeds the browser topology budget`);
    invariant(actual.skins >= 1, `${asset.id}: monster must be skinned`);
    invariant((document.nodes?.length ?? 0) > actual.meshes, `${asset.id}: monster rig hierarchy is missing`);
    invariant(JSON.stringify(actual.animations) === JSON.stringify(EXPECTED_MONSTER_CLIPS), `${asset.id}: incomplete monster animation set`);
  } else if (asset.kind === "architecture") {
    invariant(actual.skins === 0 && actual.animations.length === 0, `${asset.id}: static scenery must not contain stray rigs/clips`);
    invariant(actual.meshes >= 30 && actual.triangles >= 4_500, `${asset.id}: architecture lost production detail`);
  } else {
    invariant(actual.skins === 0 && actual.animations.length === 0, `${asset.id}: static scenery must not contain stray rigs/clips`);
    invariant(actual.meshes >= 20 && actual.triangles >= 3_000, `${asset.id}: environment prop lost production detail`);
  }
  totalBytes += details.size;
  totalTriangles += actual.triangles;
}

for (const race of EXPECTED_RACES) {
  for (const gender of EXPECTED_GENDERS) {
    for (const archetype of EXPECTED_ARCHETYPES) {
      invariant(humanoidCombinations.has(`${race}/${gender}/${archetype}`), `Missing humanoid: ${race}/${gender}/${archetype}`);
    }
  }
}
invariant(counts.humanoid === 20, `Expected 20 humanoids, found ${counts.humanoid}`);
invariant(counts.monster >= 6, `Expected at least 6 monsters, found ${counts.monster}`);
invariant(counts.architecture >= 4, `Expected at least 4 architecture assets, found ${counts.architecture}`);
invariant(counts.prop >= 4, `Expected at least 4 environment props, found ${counts.prop}`);

// The source PNGs make texture iteration inspectable even though every GLB has
// its own texture embedded for one-request loading in the browser.
for (const race of EXPECTED_RACES) {
  for (const gender of EXPECTED_GENDERS) {
    for (const archetype of EXPECTED_ARCHETYPES) {
      const path = resolve(modelRoot, "textures", `${race}_${gender}_${archetype}.png`);
      const png = await readFile(path);
      invariant(png.toString("hex", 0, 8) === "89504e470d0a1a0a", `Invalid texture PNG: ${path}`);
      invariant(png.readUInt32BE(16) === 128 && png.readUInt32BE(20) === 128, `Texture must be 128x128: ${path}`);
    }
  }
}

console.log(JSON.stringify({ ok: true, manifestVersion: manifest.version, counts, totalBytes, totalTriangles }, null, 2));
