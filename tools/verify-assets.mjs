import { createHash } from "node:crypto";
import { readFile, stat } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const assetRoot = resolve(root, "apps/client/public/assets");
const manifestPath = resolve(assetRoot, "manifest.json");
const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
const provenancePath = resolve(root, "docs/art/PROVENANCE.json");
const provenance = JSON.parse(await readFile(provenancePath, "utf8"));

const runtimeUrls = [
  ...Object.values(manifest.textures).map((entry) => entry.url),
  ...Object.values(manifest.concepts),
];
const manifestRuntimePaths = new Set(
  runtimeUrls.map((url) => `apps/client/public/assets/${url.replace(/^\.\//, "")}`),
);
const provenanceRuntimePaths = new Set(
  provenance.assets.map((asset) => asset.runtimePath),
);
if (
  manifestRuntimePaths.size !== provenanceRuntimePaths.size
  || [...manifestRuntimePaths].some((path) => !provenanceRuntimePaths.has(path))
) {
  throw new Error("Asset manifest and provenance runtime sets do not match");
}

const checked = [];
for (const relativeUrl of runtimeUrls) {
  const normalized = relativeUrl.replace(/^\.\//, "");
  const absolute = resolve(assetRoot, normalized);
  if (!absolute.startsWith(`${assetRoot}/`)) throw new Error(`Unsafe asset path: ${relativeUrl}`);
  const details = await stat(absolute);
  if (!details.isFile() || details.size === 0) throw new Error(`Missing asset: ${relativeUrl}`);
  if (details.size > 1_000_000) {
    throw new Error(`Runtime asset exceeds 1 MB budget: ${relativeUrl} (${details.size} bytes)`);
  }
  checked.push({ path: relativeUrl, bytes: details.size });
}

const verifiedHashes = [];
for (const asset of provenance.assets) {
  for (const [kind, relativePath, expectedHash] of [
    ["source", asset.sourcePath, asset.sourceSha256],
    ["runtime", asset.runtimePath, asset.runtimeSha256],
  ]) {
    const absolute = resolve(root, relativePath);
    if (!absolute.startsWith(`${root}/`)) throw new Error(`Unsafe provenance path: ${relativePath}`);
    const digest = createHash("sha256").update(await readFile(absolute)).digest("hex");
    if (digest !== expectedHash) {
      throw new Error(`Asset provenance hash mismatch: ${relativePath}`);
    }
    verifiedHashes.push({ id: asset.id, kind, sha256: digest });
  }
}

console.log(JSON.stringify({ ok: true, version: manifest.version, checked, verifiedHashes }, null, 2));
