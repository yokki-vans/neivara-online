import type { AnimationGroup } from "@babylonjs/core/Animations/animationGroup.js";
import type { AssetContainer, InstantiatedEntries } from "@babylonjs/core/assetContainer.js";
import { LoadAssetContainerAsync } from "@babylonjs/core/Loading/sceneLoader.js";
import { Vector3 } from "@babylonjs/core/Maths/math.vector.js";
import { TransformNode } from "@babylonjs/core/Meshes/transformNode.js";
import type { Scene } from "@babylonjs/core/scene.js";
import "@babylonjs/loaders/glTF/glTFFileLoader.js";
import "@babylonjs/loaders/glTF/2.0/glTFLoader.js";

export const MODEL_RACE_IDS = ["human", "light_elf", "dark_elf", "dwarf", "orc"] as const;
export const MODEL_GENDERS = ["male", "female"] as const;
export const MODEL_ARCHETYPES = ["warrior", "mage"] as const;
export const HUMANOID_CLIPS = ["idle", "run", "attack", "cast", "hit", "death"] as const;
export const MONSTER_MODEL_IDS = [
  "thorn_prowler",
  "moss_mauler",
  "cave_shrieker",
  "ruin_sentinel",
  "bramble_boar",
  "ember_drake",
] as const;

export type ModelRaceId = (typeof MODEL_RACE_IDS)[number];
export type ModelGender = (typeof MODEL_GENDERS)[number];
export type ModelArchetype = (typeof MODEL_ARCHETYPES)[number];
export type HumanoidClip = (typeof HUMANOID_CLIPS)[number];
export type MonsterModelId = (typeof MONSTER_MODEL_IDS)[number];

export type ModelAssetKind = "humanoid" | "monster" | "architecture" | "prop";

interface ModelAssetEntry {
  id: string;
  kind: ModelAssetKind;
  url: string;
  scale: number;
  race?: ModelRaceId;
  gender?: ModelGender;
  archetype?: ModelArchetype;
}

interface ModelManifest {
  version: string;
  assets: ModelAssetEntry[];
}

export interface ModelSpawnOptions {
  name?: string;
  position?: Vector3 | readonly [number, number, number];
  rotationY?: number;
  scale?: number;
  pickable?: boolean;
  metadata?: Record<string, unknown>;
}

export interface LoadedModelInstance {
  readonly assetId: string;
  readonly root: TransformNode;
  readonly animations: ModelAnimationController;
  setPickable(pickable: boolean, metadata?: Record<string, unknown>): void;
  dispose(): void;
}

export interface StarterLocationPlacement {
  readonly id: string;
  readonly assetId: string;
  readonly position: readonly [number, number, number];
  readonly rotationY: number;
  readonly scale: number;
}

/**
 * Authored layout for the Dawnmere Crossing starting settlement. Ground, collision
 * and navmesh stay with the world scene; every visible structure comes from GLB.
 */
export const STARTER_LOCATION_LAYOUT: readonly StarterLocationPlacement[] = [
  { id: "heart-sanctuary", assetId: "architecture.sanctuary", position: [0, 0, 5], rotationY: Math.PI, scale: 1.25 },
  { id: "north-gate", assetId: "architecture.gatehouse", position: [0, 0, 17], rotationY: 0, scale: 1.15 },
  { id: "creek-bridge", assetId: "architecture.bridge", position: [-12, 0.15, 5], rotationY: Math.PI / 2, scale: 1.15 },
  { id: "dwelling-east-1", assetId: "architecture.dwelling", position: [9, 0, 8], rotationY: -2.2, scale: 1 },
  { id: "dwelling-east-2", assetId: "architecture.dwelling", position: [11, 0, 1], rotationY: -1.45, scale: 0.92 },
  { id: "dwelling-west", assetId: "architecture.dwelling", position: [-8, 0, -3], rotationY: 0.72, scale: 1.06 },
  { id: "market-north", assetId: "prop.market_stall", position: [5, 0, 11], rotationY: -2.75, scale: 1 },
  { id: "market-south", assetId: "prop.market_stall", position: [-4, 0, 10], rotationY: 2.8, scale: 1 },
  { id: "waystone-arrival", assetId: "prop.waystone", position: [0, 0, -7], rotationY: 0, scale: 0.9 },
  { id: "waystone-gate", assetId: "prop.waystone", position: [-4.5, 0, 14], rotationY: 0.35, scale: 0.72 },
  { id: "elder-tree", assetId: "prop.ancient_tree", position: [-10, 0, 11], rotationY: 1.2, scale: 1.35 },
  { id: "tree-east", assetId: "prop.ancient_tree", position: [14, 0, 12], rotationY: -0.5, scale: 1.05 },
  { id: "tree-south", assetId: "prop.ancient_tree", position: [8, 0, -8], rotationY: 2.1, scale: 0.88 },
  { id: "rocks-creek", assetId: "prop.rock_cluster", position: [-10, 0, 1], rotationY: 0.3, scale: 1.25 },
  { id: "rocks-gate", assetId: "prop.rock_cluster", position: [6, 0, 16], rotationY: 1.8, scale: 0.8 },
] as const;

const KNOWN_ANIMATION_NAMES = new Set<string>([...HUMANOID_CLIPS, "run", "attack", "hit", "death"]);

function canonicalAnimationName(name: string): string | null {
  const lower = name.toLowerCase();
  for (const candidate of KNOWN_ANIMATION_NAMES) {
    const expression = new RegExp(`(?:^|[:/|._-])${candidate}(?:\\.\\d+)?$`, "u");
    if (expression.test(lower)) return candidate;
  }
  return null;
}

function toVector3(value: ModelSpawnOptions["position"]): Vector3 {
  if (!value) return Vector3.Zero();
  return value instanceof Vector3 ? value.clone() : new Vector3(value[0], value[1], value[2]);
}

function isAssetKind(value: unknown): value is ModelAssetKind {
  return value === "humanoid" || value === "monster" || value === "architecture" || value === "prop";
}

function parseManifest(value: unknown): ModelManifest {
  if (!value || typeof value !== "object" || !("version" in value) || !("assets" in value)) {
    throw new Error("Invalid Neivara model manifest");
  }
  const candidate = value as { version?: unknown; assets?: unknown };
  if (typeof candidate.version !== "string" || !Array.isArray(candidate.assets)) {
    throw new Error("Invalid Neivara model manifest fields");
  }
  const assets = candidate.assets.map((entry): ModelAssetEntry => {
    if (!entry || typeof entry !== "object") throw new Error("Invalid model entry");
    const item = entry as Record<string, unknown>;
    if (typeof item.id !== "string" || !isAssetKind(item.kind) || typeof item.url !== "string") {
      throw new Error("Invalid model entry identity");
    }
    const parsed: ModelAssetEntry = {
      id: item.id,
      kind: item.kind,
      url: item.url,
      scale: typeof item.scale === "number" ? item.scale : 1,
    };
    const race = MODEL_RACE_IDS.find((value) => value === item.race);
    const gender = MODEL_GENDERS.find((value) => value === item.gender);
    const archetype = MODEL_ARCHETYPES.find((value) => value === item.archetype);
    if (race) parsed.race = race;
    if (gender) parsed.gender = gender;
    if (archetype) parsed.archetype = archetype;
    return parsed;
  });
  return { version: candidate.version, assets };
}

/** Controls mutually-exclusive rig clips and returns to idle after one-shots. */
export class ModelAnimationController {
  private readonly clips = new Map<string, AnimationGroup>();
  private playToken = 0;
  private disposed = false;
  private current: AnimationGroup | null = null;

  constructor(animationGroups: readonly AnimationGroup[]) {
    for (const group of animationGroups) {
      const canonical = canonicalAnimationName(group.name);
      if (canonical && !this.clips.has(canonical)) this.clips.set(canonical, group);
      group.enableBlending = true;
      group.blendingSpeed = 0.08;
    }
  }

  has(clip: string): boolean {
    return this.clips.has(clip);
  }

  play(clip: HumanoidClip | string, options: { loop?: boolean; speedRatio?: number; returnToIdle?: boolean } = {}): boolean {
    if (this.disposed) return false;
    const next = this.clips.get(clip);
    if (!next) return false;
    const loop = options.loop ?? (clip === "idle" || clip === "run");
    if (this.current === next && next.isPlaying && loop) {
      next.speedRatio = options.speedRatio ?? next.speedRatio;
      return true;
    }
    this.playToken += 1;
    const token = this.playToken;
    for (const group of this.clips.values()) {
      if (group !== next && (group.isPlaying || group.isStarted)) group.stop();
    }
    next.stop();
    next.start(loop, options.speedRatio ?? 1);
    this.current = next;
    if (!loop && (options.returnToIdle ?? clip !== "death")) {
      next.onAnimationGroupEndObservable.addOnce(() => {
        if (!this.disposed && this.playToken === token) this.play("idle", { loop: true });
      });
    }
    return true;
  }

  setLocomotion(moving: boolean, normalizedSpeed = 1): void {
    const speedRatio = Math.max(0.55, Math.min(1.65, normalizedSpeed));
    this.play(moving && this.has("run") ? "run" : "idle", { loop: true, speedRatio });
  }

  stop(): void {
    this.playToken += 1;
    for (const group of this.clips.values()) group.stop();
    this.current = null;
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.stop();
  }
}

class RuntimeModelInstance implements LoadedModelInstance {
  readonly animations: ModelAnimationController;
  private disposed = false;

  constructor(
    readonly assetId: string,
    readonly root: TransformNode,
    private readonly entries: InstantiatedEntries,
  ) {
    this.animations = new ModelAnimationController(entries.animationGroups);
  }

  setPickable(pickable: boolean, metadata: Record<string, unknown> = {}): void {
    for (const mesh of this.root.getChildMeshes()) {
      mesh.isPickable = pickable;
      mesh.metadata = { ...(mesh.metadata as Record<string, unknown> | null), ...metadata, modelAssetId: this.assetId };
    }
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.animations.dispose();
    this.entries.dispose();
    this.root.dispose(false, false);
  }
}

export function humanoidModelAssetId(race: ModelRaceId, gender: ModelGender, archetype: ModelArchetype): string {
  return `humanoid.${race}.${gender}.${archetype}`;
}

export function monsterModelAssetId(monster: MonsterModelId): string {
  return `monster.${monster}`;
}

/**
 * Cached GLB catalog shared by the world scene and character-creation preview.
 * Containers stay outside the scene; each spawn receives its own rig and clips.
 */
export class NeivaraModelLibrary {
  private manifestPromise: Promise<ModelManifest> | null = null;
  private readonly containers = new Map<string, Promise<AssetContainer>>();
  private readonly modelBaseUrl: URL;
  private instanceSerial = 0;

  constructor(private readonly scene: Scene, baseUrl?: string | URL) {
    const defaultUrl = new URL(`${import.meta.env.BASE_URL}assets/models/`, window.location.origin);
    this.modelBaseUrl = new URL(baseUrl?.toString() ?? defaultUrl.toString(), window.location.href);
  }

  async getManifest(): Promise<ModelManifest> {
    if (this.manifestPromise) return this.manifestPromise;
    // Revalidate the release manifest instead of pinning it in the browser cache.
    // Model GLBs keep their stable URLs and use server ETags independently.
    const loading = fetch(new URL("manifest.json", this.modelBaseUrl), { cache: "no-cache" })
      .then(async (response) => {
        if (!response.ok) throw new Error(`Model manifest failed with HTTP ${response.status}`);
        return parseManifest(await response.json());
      });
    this.manifestPromise = loading;
    try {
      return await loading;
    } catch (error) {
      // A retry must make a fresh request; successful manifests remain shared.
      if (this.manifestPromise === loading) this.manifestPromise = null;
      throw error;
    }
  }

  async preload(assetIds: readonly string[]): Promise<void> {
    await Promise.all(assetIds.map(async (assetId) => { await this.loadContainer(assetId); }));
  }

  async preloadCharacterPreview(): Promise<void> {
    const ids = MODEL_RACE_IDS.flatMap((race) =>
      MODEL_GENDERS.flatMap((gender) => MODEL_ARCHETYPES.map((archetype) => humanoidModelAssetId(race, gender, archetype))),
    );
    await this.preload(ids);
  }

  async spawnHumanoid(
    race: ModelRaceId,
    gender: ModelGender,
    archetype: ModelArchetype,
    options: ModelSpawnOptions = {},
  ): Promise<LoadedModelInstance> {
    const instance = await this.spawn(humanoidModelAssetId(race, gender, archetype), options);
    instance.animations.play("idle", { loop: true });
    return instance;
  }

  async spawnMonster(monster: MonsterModelId, options: ModelSpawnOptions = {}): Promise<LoadedModelInstance> {
    const instance = await this.spawn(monsterModelAssetId(monster), options);
    instance.animations.play("idle", { loop: true });
    return instance;
  }

  async spawn(assetId: string, options: ModelSpawnOptions = {}): Promise<LoadedModelInstance> {
    const manifest = await this.getManifest();
    const asset = manifest.assets.find((entry) => entry.id === assetId);
    if (!asset) throw new Error(`Unknown model asset: ${assetId}`);
    const container = await this.loadContainer(assetId);
    const serial = ++this.instanceSerial;
    const prefix = options.name ?? `${asset.id}#${serial}`;
    const entries = container.instantiateModelsToScene((sourceName) => `${prefix}:${sourceName}`, false, {
      // Independent clones are intentional: animated characters need their own
      // bone transforms and scenery instances may later receive per-instance LOD.
      doNotInstantiate: true,
    });
    for (const skeleton of entries.skeletons) skeleton.useTextureToStoreBoneMatrices = true;
    const root = new TransformNode(prefix, this.scene);
    for (const node of entries.rootNodes) node.parent = root;
    root.position.copyFrom(toVector3(options.position));
    root.rotation.y = options.rotationY ?? 0;
    root.scaling.setAll((options.scale ?? 1) * asset.scale);
    root.metadata = { ...options.metadata, modelAssetId: assetId, modelAssetKind: asset.kind };
    const instance = new RuntimeModelInstance(assetId, root, entries);
    instance.setPickable(options.pickable ?? false, options.metadata);
    return instance;
  }

  async spawnStarterLocation(): Promise<LoadedModelInstance[]> {
    const uniqueAssets = [...new Set(STARTER_LOCATION_LAYOUT.map((placement) => placement.assetId))];
    await this.preload(uniqueAssets);
    return Promise.all(STARTER_LOCATION_LAYOUT.map((placement) => this.spawn(placement.assetId, {
      name: placement.id,
      position: placement.position,
      rotationY: placement.rotationY,
      scale: placement.scale,
      pickable: false,
      metadata: { starterLocation: true, placementId: placement.id },
    })));
  }

  dispose(): void {
    for (const promise of this.containers.values()) {
      void promise.then((container) => container.dispose()).catch(() => undefined);
    }
    this.containers.clear();
    this.manifestPromise = null;
  }

  private async loadContainer(assetId: string): Promise<AssetContainer> {
    const cached = this.containers.get(assetId);
    if (cached) return cached;
    const loading = this.getManifest().then(async (manifest) => {
      const asset = manifest.assets.find((entry) => entry.id === assetId);
      if (!asset) throw new Error(`Unknown model asset: ${assetId}`);
      const source = new URL(asset.url.replace(/^\.\//u, ""), this.modelBaseUrl).toString();
      return LoadAssetContainerAsync(source, this.scene, { pluginExtension: ".glb", name: asset.id });
    });
    this.containers.set(assetId, loading);
    try {
      return await loading;
    } catch (error) {
      if (this.containers.get(assetId) === loading) this.containers.delete(assetId);
      throw error;
    }
  }
}
