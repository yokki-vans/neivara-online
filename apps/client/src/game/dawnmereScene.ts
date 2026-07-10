import { DirectionalLight } from "@babylonjs/core/Lights/directionalLight.js";
import { HemisphericLight } from "@babylonjs/core/Lights/hemisphericLight.js";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial.js";
import { Texture } from "@babylonjs/core/Materials/Textures/texture.js";
import { Color3, Color4 } from "@babylonjs/core/Maths/math.color.js";
import { Vector3 } from "@babylonjs/core/Maths/math.vector.js";
import { Mesh } from "@babylonjs/core/Meshes/mesh.js";
import { VertexData } from "@babylonjs/core/Meshes/mesh.vertexData.js";
import { Scene } from "@babylonjs/core/scene.js";
import {
  NeivaraModelLibrary,
  type LoadedModelInstance,
  type ModelSpawnOptions,
} from "./modelAssets";
import { shouldIgnoreDisposedSceneLoad } from "./sceneLoadErrors";
import { appendTopFacingQuad } from "./surfaceGeometry";

export interface DawnmereEnvironment {
  readonly ground: Mesh;
  readonly ready: Promise<void>;
  dispose(): void;
}

interface DecorationPlacement extends ModelSpawnOptions {
  assetId: string;
}

const BASE = import.meta.env.BASE_URL;

function tint(value: string): Color3 {
  return Color3.FromHexString(value);
}

function makeMaterial(
  scene: Scene,
  name: string,
  color: string,
  textureUrl?: string,
  repeat = 1,
): StandardMaterial {
  const value = new StandardMaterial(name, scene);
  value.diffuseColor = tint(color);
  value.specularColor = new Color3(0.05, 0.07, 0.07);
  if (textureUrl) {
    const texture = new Texture(`${BASE}${textureUrl}`, scene);
    texture.wrapU = Texture.WRAP_ADDRESSMODE;
    texture.wrapV = Texture.WRAP_ADDRESSMODE;
    texture.uScale = repeat;
    texture.vScale = repeat;
    value.diffuseTexture = texture;
  }
  return value;
}

function terrainHeight(x: number, z: number): number {
  const edge = Math.max(0, (Math.hypot(x, z) - 39) / 17);
  const ridge = edge * edge * 5.4;
  const distantVariation = edge * (Math.sin(x * 0.17) + Math.cos(z * 0.14)) * 0.42;
  return -0.12 + ridge + distantVariation;
}

function createTerrain(scene: Scene): Mesh {
  const size = 112;
  const segments = 48;
  const positions: number[] = [];
  const normals: number[] = [];
  const uvs: number[] = [];
  const indices: number[] = [];
  for (let row = 0; row <= segments; row += 1) {
    const z = -size / 2 + (row / segments) * size;
    for (let column = 0; column <= segments; column += 1) {
      const x = -size / 2 + (column / segments) * size;
      positions.push(x, terrainHeight(x, z), z);
      uvs.push(column / segments, row / segments);
    }
  }
  for (let row = 0; row < segments; row += 1) {
    for (let column = 0; column < segments; column += 1) {
      const a = row * (segments + 1) + column;
      const b = a + 1;
      const c = a + segments + 1;
      const d = c + 1;
      appendTopFacingQuad(indices, a, b, c, d);
    }
  }
  VertexData.ComputeNormals(positions, indices, normals);
  const mesh = new Mesh("dawnmere-terrain", scene);
  const data = new VertexData();
  data.positions = positions;
  data.normals = normals;
  data.uvs = uvs;
  data.indices = indices;
  data.applyToMesh(mesh, true);
  mesh.material = makeMaterial(
    scene,
    "dawnmere-earth",
    "#a4a278",
    "assets/textures/dawnmere/packed-earth.jpg",
    17,
  );
  mesh.metadata = { ground: true, authoredTerrain: true };
  mesh.receiveShadows = true;
  return mesh;
}

function createRibbon(
  scene: Scene,
  name: string,
  points: readonly (readonly [number, number])[],
  width: number,
  y: number,
  material: StandardMaterial,
  pickable = true,
): Mesh {
  const positions: number[] = [];
  const normals: number[] = [];
  const uvs: number[] = [];
  const indices: number[] = [];
  let travelled = 0;
  const distances = points.map((point, index) => {
    if (index > 0) {
      const previous = points[index - 1]!;
      travelled += Math.hypot(point[0] - previous[0], point[1] - previous[1]);
    }
    return travelled;
  });
  points.forEach((point, index) => {
    const previous = points[Math.max(0, index - 1)]!;
    const next = points[Math.min(points.length - 1, index + 1)]!;
    const directionX = next[0] - previous[0];
    const directionZ = next[1] - previous[1];
    const length = Math.max(0.001, Math.hypot(directionX, directionZ));
    const perpendicularX = -directionZ / length;
    const perpendicularZ = directionX / length;
    for (const side of [-1, 1]) {
      positions.push(
        point[0] + perpendicularX * width * 0.5 * side,
        y,
        point[1] + perpendicularZ * width * 0.5 * side,
      );
      uvs.push(side < 0 ? 0 : 1, distances[index]! / Math.max(width, 0.1));
    }
  });
  for (let index = 0; index < points.length - 1; index += 1) {
    const a = index * 2;
    appendTopFacingQuad(indices, a, a + 1, a + 2, a + 3);
  }
  VertexData.ComputeNormals(positions, indices, normals);
  const mesh = new Mesh(name, scene);
  const data = new VertexData();
  data.positions = positions;
  data.normals = normals;
  data.uvs = uvs;
  data.indices = indices;
  data.applyToMesh(mesh, false);
  mesh.material = material;
  mesh.isPickable = pickable;
  mesh.metadata = pickable ? { ground: true, authoredRibbon: true } : { authoredRibbon: true };
  mesh.receiveShadows = true;
  return mesh;
}

function buildSurfaceDetails(scene: Scene): Mesh[] {
  const stone = makeMaterial(
    scene,
    "dawnmere-path-stone",
    "#c4b99a",
    "assets/textures/dawnmere/river-stone.jpg",
    1,
  );
  const riverbed = makeMaterial(
    scene,
    "dawnmere-riverbed",
    "#84908d",
    "assets/textures/dawnmere/moss-limestone.jpg",
    1,
  );
  const water = makeMaterial(scene, "dawnmere-water", "#3b9fa4");
  water.emissiveColor = tint("#276f79").scale(0.42);
  water.alpha = 0.72;
  water.specularColor = tint("#d5fff3");

  const riverPoints = [
    [-17, -56], [-14, -36], [-15, -17], [-12, 5], [-13, 24], [-10, 42], [-14, 56],
  ] as const;
  return [
    createRibbon(scene, "riverbed", riverPoints, 7.8, -0.05, riverbed, false),
    createRibbon(scene, "dawnmere-river", riverPoints, 6.4, 0.015, water, false),
    createRibbon(scene, "arrival-road", [[0, -15], [0, -6], [1, 3], [0, 17], [2, 29]], 3.2, 0.03, stone),
    createRibbon(scene, "market-road", [[-7, 8], [0, 9], [7, 8], [12, 4]], 2.4, 0.035, stone),
    createRibbon(scene, "bridge-road", [[-1, 6], [-6, 6], [-12, 5], [-20, 7], [-28, 13]], 2.2, 0.04, stone),
    createRibbon(scene, "ruin-road", [[0, 17], [-8, 22], [-18, 26], [-31, 30]], 2.05, 0.04, stone),
  ];
}

const DECORATIONS: readonly DecorationPlacement[] = [
  { assetId: "architecture.gatehouse", name: "rooted-ruin-arch", position: [-34, 0, 30], rotationY: 1.18, scale: 0.82 },
  { assetId: "prop.waystone", name: "ruin-waystone", position: [-29, 0, 27], rotationY: -0.4, scale: 0.8 },
  { assetId: "prop.rock_cluster", name: "cave-mouth-a", position: [35, 0, -22], rotationY: 0.2, scale: 2.3 },
  { assetId: "prop.rock_cluster", name: "cave-mouth-b", position: [39, 0, -19], rotationY: 1.8, scale: 2.1 },
  { assetId: "prop.rock_cluster", name: "cave-mouth-c", position: [37, 1.3, -21], rotationY: -0.7, scale: 1.55 },
  { assetId: "prop.waystone", name: "cave-marker", position: [30, 0, -18], rotationY: 0.4, scale: 0.72 },
  { assetId: "prop.ancient_tree", name: "forest-01", position: [-41, 0, -31], rotationY: 0.1, scale: 1.35 },
  { assetId: "prop.ancient_tree", name: "forest-02", position: [-36, 0, -17], rotationY: 1.7, scale: 1.1 },
  { assetId: "prop.ancient_tree", name: "forest-03", position: [-44, 0, 5], rotationY: -0.4, scale: 1.45 },
  { assetId: "prop.ancient_tree", name: "forest-04", position: [-25, 0, 43], rotationY: 2.2, scale: 1.25 },
  { assetId: "prop.ancient_tree", name: "forest-05", position: [-4, 0, 45], rotationY: 0.8, scale: 1.5 },
  { assetId: "prop.ancient_tree", name: "forest-06", position: [19, 0, 42], rotationY: -1.1, scale: 1.18 },
  { assetId: "prop.ancient_tree", name: "forest-07", position: [42, 0, 25], rotationY: 1.4, scale: 1.42 },
  { assetId: "prop.ancient_tree", name: "forest-08", position: [45, 0, 3], rotationY: 2.5, scale: 1.16 },
  { assetId: "prop.ancient_tree", name: "forest-09", position: [43, 0, -35], rotationY: -0.6, scale: 1.38 },
  { assetId: "prop.ancient_tree", name: "forest-10", position: [16, 0, -44], rotationY: 0.7, scale: 1.28 },
  { assetId: "prop.ancient_tree", name: "forest-11", position: [-8, 0, -45], rotationY: -2, scale: 1.2 },
  { assetId: "prop.ancient_tree", name: "forest-12", position: [-29, 0, -42], rotationY: 1.1, scale: 1.48 },
  { assetId: "prop.rock_cluster", name: "river-rock-a", position: [-18, 0, -8], rotationY: 0.2, scale: 1.2 },
  { assetId: "prop.rock_cluster", name: "river-rock-b", position: [-8, 0, 21], rotationY: 2.1, scale: 0.9 },
  { assetId: "prop.rock_cluster", name: "ruin-rock-a", position: [-37, 0, 26], rotationY: 0.8, scale: 1.35 },
  { assetId: "prop.rock_cluster", name: "ruin-rock-b", position: [-31, 0, 34], rotationY: -1.2, scale: 1.05 },
] as const;

/** Builds custom terrain and places only authored GLB architecture and props. */
export function buildDawnmereEnvironment(
  scene: Scene,
  models: NeivaraModelLibrary,
): DawnmereEnvironment {
  scene.clearColor = new Color4(0.045, 0.105, 0.12, 1);
  scene.fogMode = Scene.FOGMODE_EXP2;
  scene.fogColor = tint("#789a91");
  scene.fogDensity = 0.008;

  const ambient = new HemisphericLight("dawnmere-ambient", new Vector3(0.2, 1, -0.3), scene);
  ambient.intensity = 1.02;
  ambient.diffuse = tint("#d8e8c9");
  ambient.groundColor = tint("#29453c");
  const sun = new DirectionalLight("dawnmere-sun", new Vector3(-0.52, -1, 0.28), scene);
  sun.position.copyFromFloats(28, 46, -24);
  sun.intensity = 1.65;
  sun.diffuse = tint("#ffe0aa");

  const ground = createTerrain(scene);
  const surfaceMeshes = buildSurfaceDetails(scene);
  const instances: LoadedModelInstance[] = [];
  let disposed = false;
  const ready = (async () => {
    const settlement = await models.spawnStarterLocation();
    if (disposed) {
      settlement.forEach((instance) => instance.dispose());
      return;
    }
    instances.push(...settlement);
    const decorationInstances = await Promise.all(DECORATIONS.map((placement) => models.spawn(
      placement.assetId,
      { ...placement, pickable: false, metadata: { environment: true } },
    )));
    if (disposed) decorationInstances.forEach((instance) => instance.dispose());
    else instances.push(...decorationInstances);
  })().catch((error: unknown) => {
    if (shouldIgnoreDisposedSceneLoad(error, disposed)) return;
    throw error;
  });

  return {
    ground,
    ready,
    dispose() {
      if (disposed) return;
      disposed = true;
      instances.forEach((instance) => instance.dispose());
      surfaceMeshes.forEach((mesh) => mesh.dispose(false, true));
      ground.dispose(false, true);
      ambient.dispose();
      sun.dispose();
    },
  };
}
