# Neivara 3D asset pipeline

The browser catalog has explicit mixed provenance. Monsters, buildings and
environment props are project-original clean-room work. Humanoids are adapted
from KayKit Adventurers 1.0 by Kay Lousberg, distributed under CC0 1.0. The
upstream license and four immutable GLB inputs live in
`third_party/kaykit/adventurers`.

No Lineage II meshes, textures, rigs, animations, names, maps or extracted client
data are read, traced, converted or bundled. Genre references inform broad
fantasy readability only.

## Delivered catalog

- 20 skinned humanoids: human, light elf, dark elf, dwarf, and orc; male and
  female; warrior and mage. The roster uses four professionally authored base
  silhouettes, selected class equipment, race skin palettes and proportions,
  skinned elven ears, and skinned orc tusks.
- Six skinned creatures: thorn prowler, moss mauler, cave shrieker, ruin
  sentinel, bramble boar, and ember drake.
- Four modular buildings: sanctuary, gatehouse, dwelling, and bridge.
- Four environment sets: ancient tree, market stall, waystone, and rock cluster.
- Humanoid clips: `idle`, `run`, `attack`, `cast`, `hit`, `death`.
- Creature clips: `idle`, `run`, `attack`, `hit`, `death`.

Humanoid variants use deterministic 256×256 gradient atlases. These are embedded
in each GLB for one-request loading; inspectable race/class PNGs live under
`apps/client/public/assets/models/textures`. The export strips the 75-animation
upstream library to the six gameplay clips used by the client and removes all
unequipped weapon meshes.

## Rebuild and verify

Blender 4.5 LTS is the reference exporter. Set `BLENDER_BIN` on platforms where
the executable is not on `PATH`.

```sh
npm run assets:generate:3d
npm run assets:generate:characters
npm run assets:check:3d
```

The verifier parses every GLB container and checks its header, JSON/BIN chunks,
SHA-256, byte budget, indexed triangle topology, mesh/node counts, skins,
embedded textures, required animation names, all 5×2×2 character variants, the
CC0 notice, and the hashes of all four vendored upstream GLBs.

Current browser budgets are enforced in CI: humanoids contain roughly 4.7–5.4k
triangles with 8–11 visible body/equipment meshes, creatures 3.5–7.5k, and every
individual runtime GLB stays below 1 MB. The six selected humanoid clips keep
each production character near 0.5 MB instead of shipping all 75 source clips.

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
