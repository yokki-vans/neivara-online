# Neivara 3D asset pipeline

The browser models are project-original clean-room work. The generator does not
read, trace, convert, or bundle Lineage II meshes, textures, rigs, animations,
names, maps, or extracted client data. Genre references may inform broad fantasy
readability only; every silhouette, surface, color system, and topology rule is
authored for Neivara.

## Delivered catalog

- 20 skinned humanoids: human, light elf, dark elf, dwarf, and orc; male and
  female; warrior and mage.
- Six skinned creatures: thorn prowler, moss mauler, cave shrieker, ruin
  sentinel, bramble boar, and ember drake.
- Four modular buildings: sanctuary, gatehouse, dwelling, and bridge.
- Four environment sets: ancient tree, market stall, waystone, and rock cluster.
- Humanoid clips: `idle`, `run`, `attack`, `cast`, `hit`, `death`.
- Creature clips: `idle`, `run`, `attack`, `hit`, `death`.

Humanoid outfits use deterministic 128×128 woven/engraved textures. These are
embedded in each GLB for one-request loading; inspectable PNG sources live under
`apps/client/public/assets/models/textures`.

## Rebuild and verify

Blender 4.5 LTS is the reference exporter. Set `BLENDER_BIN` on platforms where
the executable is not on `PATH`.

```sh
npm run assets:generate:3d
npm run assets:check:3d
```

The verifier parses every GLB container and checks its header, JSON/BIN chunks,
SHA-256, byte budget, indexed triangle topology, mesh/node counts, skins,
embedded textures, required animation names, and all 5×2×2 character variants.

Current browser budgets are enforced in CI: humanoids contain roughly 11.6–12.4k
triangles, creatures 3.5–7.5k, and every individual GLB stays below 1 MB. The
complete 34-model catalog is about 13.7 MB before HTTP compression.

## Visual QA

Blender contact sheets are regenerated from the exact runtime GLBs and stored
outside the deployed asset tree:

- `docs/art/review/glb-humanoids.png`
- `docs/art/review/glb-monsters.png`
- `docs/art/review/glb-architecture.png`
- `docs/art/review/glb-props.png`

Use `tools/render_3d_asset_preview.py` for additional angles. These review PNGs
are evidence only; the client never downloads them.

## Babylon integration

`apps/client/src/game/modelAssets.ts` exposes `NeivaraModelLibrary`. It caches
asset containers while giving every spawned animated entity an independent rig.

```ts
const models = new NeivaraModelLibrary(scene);
const hero = await models.spawnHumanoid("human", "female", "warrior", {
  name: "preview",
  position: [0, 0, 0],
});
hero.animations.play("idle", { loop: true });

const monsters = await models.spawnMonster("thorn_prowler", { position: [5, 0, 3] });
const settlement = await models.spawnStarterLocation();
```

Dispose entity instances when snapshots remove them, and call `models.dispose()`
when the Babylon scene is torn down.
