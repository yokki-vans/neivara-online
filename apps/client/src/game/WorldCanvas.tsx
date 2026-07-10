import { ArcRotateCamera } from "@babylonjs/core/Cameras/arcRotateCamera.js";
import "@babylonjs/core/Culling/ray.js";
import { Engine } from "@babylonjs/core/Engines/engine.js";
import { PointerEventTypes } from "@babylonjs/core/Events/pointerEvents.js";
import type { Material } from "@babylonjs/core/Materials/material.js";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial.js";
import { DynamicTexture } from "@babylonjs/core/Materials/Textures/dynamicTexture.js";
import { Color3 } from "@babylonjs/core/Maths/math.color.js";
import { Vector3 } from "@babylonjs/core/Maths/math.vector.js";
import { CreatePlane } from "@babylonjs/core/Meshes/Builders/planeBuilder.js";
import { CreateTorus } from "@babylonjs/core/Meshes/Builders/torusBuilder.js";
import { Mesh } from "@babylonjs/core/Meshes/mesh.js";
import type { TransformNode } from "@babylonjs/core/Meshes/transformNode.js";
import { Scene } from "@babylonjs/core/scene.js";
import {
  ITEMS,
  getClass,
  getRace,
  type CombatEvent,
  type LootSnapshot,
  type MonsterSnapshot,
  type MovementInput,
  type PlayerSnapshot,
  type WorldSnapshot,
} from "@neivara/shared";
import { useEffect, useRef, useState } from "react";
import { buildDawnmereEnvironment, type DawnmereEnvironment } from "./dawnmereScene";
import {
  NeivaraModelLibrary,
  type LoadedModelInstance,
  type MonsterModelId,
} from "./modelAssets";
import { shouldIgnoreDisposedSceneLoad } from "./sceneLoadErrors";
import {
  playSkillAuraFx,
  playSkillCastFx,
  playSkillImpactFx,
  playSkillProjectileFx,
  type SkillFxHandle,
} from "./skillFx";

interface Props {
  snapshot: WorldSnapshot | null;
  selectedId: string | null;
  ownEquipment: VisualEquipmentLoadout;
  inputBlocked: boolean;
  combatEvent: CombatEvent | null;
  onSelect: (id: string | null) => void;
  onInput: (input: MovementInput) => void;
  onPickup: (lootId: string) => void;
}

export interface VisualEquipmentLoadout {
  [slot: string]: string | null | undefined;
}

type SnapshotEntity = PlayerSnapshot | MonsterSnapshot | LootSnapshot;
type EntityType = "player" | "monster" | "loot";

interface EntityVisual {
  model: LoadedModelInstance;
  root: TransformNode;
  target: Vector3;
  entityType: EntityType;
  alive: boolean;
  assetKey: string;
  equipmentKey: string;
  height: number;
  animationLockedUntil: number;
  deathPlayed: boolean;
  ownedMaterials: Material[];
}

interface RuntimeItemVisual {
  color?: string;
  visual?: {
    primaryColor?: string;
    accentColor?: string;
  };
}

function color(hex: string): Color3 {
  return Color3.FromHexString(hex);
}

function material(scene: Scene, name: string, diffuse: Color3, emissive = 0): StandardMaterial {
  const value = new StandardMaterial(name, scene);
  value.diffuseColor = diffuse;
  value.specularColor = new Color3(0.08, 0.12, 0.13);
  value.emissiveColor = diffuse.scale(emissive);
  return value;
}

function normalizeEquipment(value: unknown): VisualEquipmentLoadout {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const result: VisualEquipmentLoadout = {};
  for (const [slot, entry] of Object.entries(value)) {
    if (typeof entry === "string") result[slot] = entry;
    else if (entry && typeof entry === "object" && "itemId" in entry && typeof entry.itemId === "string") {
      result[slot] = entry.itemId;
    }
  }
  return result;
}

function equipmentKey(loadout: VisualEquipmentLoadout): string {
  return Object.entries(loadout)
    .filter((entry): entry is [string, string] => typeof entry[1] === "string")
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([slot, itemId]) => `${slot}:${itemId}`)
    .join("|");
}

function equippedItem(loadout: VisualEquipmentLoadout, ...slots: string[]): string | null {
  for (const slot of slots) {
    const itemId = loadout[slot];
    if (itemId) return itemId;
  }
  return null;
}

function itemVisual(itemId: string | null): RuntimeItemVisual | null {
  if (!itemId) return null;
  return (ITEMS as unknown as Record<string, RuntimeItemVisual | undefined>)[itemId] ?? null;
}

function recolorMaterial(source: Material, name: string, tint: Color3): Material | null {
  const clone = source.clone(name);
  if (!clone) return null;
  const tintable = clone as Material & {
    diffuseColor?: Color3;
    albedoColor?: Color3;
    emissiveColor?: Color3;
  };
  if (tintable.diffuseColor) tintable.diffuseColor = tint;
  if (tintable.albedoColor) tintable.albedoColor = tint;
  if (tintable.emissiveColor && /focus|crystal|rune/iu.test(name)) {
    tintable.emissiveColor = tint.scale(0.38);
  }
  return clone;
}

/** Applies inventory colors to authored armor and weapon meshes without replacing their geometry. */
function applyEquipmentAppearance(
  instance: LoadedModelInstance,
  loadout: VisualEquipmentLoadout,
): Material[] {
  const chest = equippedItem(loadout, "chest", "armor");
  const weapon = equippedItem(loadout, "main_hand", "weapon");
  const armorVisual = itemVisual(chest)?.visual;
  const weaponVisual = itemVisual(weapon)?.visual;
  if (!armorVisual && !weaponVisual) return [];
  const armorColor = color(armorVisual?.primaryColor ?? armorVisual?.accentColor ?? "#9d8669");
  const weaponColor = color(weaponVisual?.primaryColor ?? weaponVisual?.accentColor ?? "#c7b77e");
  const owned: Material[] = [];
  for (const mesh of instance.root.getChildMeshes()) {
    if (!mesh.material) continue;
    const name = mesh.name.toLowerCase();
    const weaponPart = /blade|staff|focus|weapon|shield|grip|spear|bow/iu.test(name);
    const armorPart = /cuirass|pauldron|robe|mantle|boot|shin|thigh|belt|cloth|armor/iu.test(name);
    if ((!weaponPart || !weaponVisual) && (!armorPart || !armorVisual)) continue;
    const replacement = recolorMaterial(
      mesh.material,
      `${mesh.material.name}-${instance.assetId}-${mesh.uniqueId}`,
      weaponPart && weaponVisual ? weaponColor : armorColor,
    );
    if (!replacement) continue;
    mesh.material = replacement;
    owned.push(replacement);
  }
  return owned;
}

function addNameplate(
  scene: Scene,
  root: TransformNode,
  text: string,
  tint: string,
  height: number,
): Material {
  const texture = new DynamicTexture(`label-${root.name}`, { width: 512, height: 96 }, scene, true);
  texture.hasAlpha = true;
  texture.drawText(text, null, 62, "bold 34px sans-serif", "#f5f1df", "transparent", true);
  const plate = CreatePlane(`plate-${root.name}`, { width: 3.7, height: 0.7 }, scene);
  plate.parent = root;
  plate.position.y = height;
  plate.billboardMode = Mesh.BILLBOARDMODE_ALL;
  plate.isPickable = false;
  const plateMaterial = new StandardMaterial(`plate-material-${root.name}`, scene);
  plateMaterial.diffuseTexture = texture;
  plateMaterial.opacityTexture = texture;
  plateMaterial.emissiveColor = color(tint).scale(0.65);
  plateMaterial.disableLighting = true;
  plateMaterial.backFaceCulling = false;
  plate.material = plateMaterial;
  return plateMaterial;
}

function hierarchyHeight(root: TransformNode): number {
  const bounds = root.getHierarchyBoundingVectors(true);
  return Math.max(0.8, bounds.max.y - bounds.min.y);
}

function disposeVisual(visual: EntityVisual): void {
  visual.ownedMaterials.forEach((value) => value.dispose(true, true));
  visual.model.dispose();
}

async function createPlayerVisual(
  scene: Scene,
  models: NeivaraModelLibrary,
  player: PlayerSnapshot,
  loadout: VisualEquipmentLoadout,
): Promise<EntityVisual> {
  const classInfo = getClass(player.classId);
  const raceInfo = getRace(player.race);
  const model = await models.spawnHumanoid(player.race, player.gender, player.classId, {
    name: `player-${player.id}`,
    position: [player.position.x, player.position.y, player.position.z],
    rotationY: player.rotationY,
    pickable: true,
    metadata: { entityId: player.id, entityType: "player" },
  });
  const height = hierarchyHeight(model.root);
  const ownedMaterials = applyEquipmentAppearance(model, loadout);
  ownedMaterials.push(addNameplate(
    scene,
    model.root,
    `${player.name}  ·  ${player.level}`,
    raceInfo.accent,
    height + 0.38,
  ));
  model.setPickable(true, { entityId: player.id, entityType: "player" });
  model.animations.play("idle", { loop: true, speedRatio: classInfo.moveSpeed / 5.3 });
  return {
    model,
    root: model.root,
    target: new Vector3(player.position.x, player.position.y, player.position.z),
    entityType: "player",
    alive: player.alive,
    assetKey: `${player.race}/${player.gender}/${player.classId}`,
    equipmentKey: equipmentKey(loadout),
    height,
    animationLockedUntil: 0,
    deathPlayed: false,
    ownedMaterials,
  };
}

const MONSTER_HEIGHTS: Readonly<Record<MonsterModelId, number>> = {
  thorn_prowler: 1.25,
  moss_mauler: 1.5,
  cave_shrieker: 1.35,
  ruin_sentinel: 2.05,
  bramble_boar: 1.25,
  ember_drake: 1.45,
};

async function createMonsterVisual(
  scene: Scene,
  models: NeivaraModelLibrary,
  monster: MonsterSnapshot,
): Promise<EntityVisual> {
  const model = await models.spawnMonster(monster.kind, {
    name: `monster-${monster.id}`,
    position: [monster.position.x, monster.position.y, monster.position.z],
    rotationY: monster.rotationY,
    scale: monster.elite ? 1.22 : 1,
    pickable: true,
    metadata: { entityId: monster.id, entityType: "monster" },
  });
  const height = Math.max(MONSTER_HEIGHTS[monster.kind], hierarchyHeight(model.root));
  const label = addNameplate(
    scene,
    model.root,
    `${monster.name}  ·  ${monster.level}`,
    monster.elite ? "#ef8a63" : "#75d4ac",
    height + 0.34,
  );
  model.setPickable(true, { entityId: monster.id, entityType: "monster" });
  return {
    model,
    root: model.root,
    target: new Vector3(monster.position.x, monster.position.y, monster.position.z),
    entityType: "monster",
    alive: monster.alive,
    assetKey: `${monster.kind}/${monster.elite ? "elite" : "common"}`,
    equipmentKey: "",
    height,
    animationLockedUntil: 0,
    deathPlayed: false,
    ownedMaterials: [label],
  };
}

async function createLootVisual(
  models: NeivaraModelLibrary,
  loot: LootSnapshot,
): Promise<EntityVisual> {
  const model = await models.spawn("prop.waystone", {
    name: `loot-${loot.id}`,
    position: [loot.position.x, loot.position.y + 0.05, loot.position.z],
    scale: 0.16,
    pickable: true,
    metadata: { entityId: loot.id, entityType: "loot" },
  });
  model.setPickable(true, { entityId: loot.id, entityType: "loot" });
  return {
    model,
    root: model.root,
    target: new Vector3(loot.position.x, loot.position.y + 0.05, loot.position.z),
    entityType: "loot",
    alive: true,
    assetKey: `loot/${loot.itemId}`,
    equipmentKey: "",
    height: 0.6,
    animationLockedUntil: 0,
    deathPlayed: false,
    ownedMaterials: [],
  };
}

function snapshotHasEntity(snapshot: WorldSnapshot | null, id: string, entityType: EntityType): boolean {
  if (!snapshot) return false;
  if (entityType === "player") return snapshot.players.some((entity) => entity.id === id);
  if (entityType === "monster") return snapshot.monsters.some((entity) => entity.id === id);
  return snapshot.loot.some((entity) => entity.id === id);
}

function trackFx(collection: Set<SkillFxHandle>, handle: SkillFxHandle): void {
  collection.add(handle);
  void handle.completed.finally(() => collection.delete(handle));
}

export function WorldCanvas({
  snapshot,
  selectedId,
  ownEquipment,
  inputBlocked,
  combatEvent,
  onSelect,
  onInput,
  onPickup,
}: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const sceneRef = useRef<Scene | null>(null);
  const cameraRef = useRef<ArcRotateCamera | null>(null);
  const modelsRef = useRef<NeivaraModelLibrary | null>(null);
  const environmentRef = useRef<DawnmereEnvironment | null>(null);
  const visualsRef = useRef(new Map<string, EntityVisual>());
  const loadingRef = useRef(new Map<string, string>());
  const activeFxRef = useRef(new Set<SkillFxHandle>());
  const snapshotRef = useRef(snapshot);
  const selectedRef = useRef(selectedId);
  const ownEquipmentRef = useRef(ownEquipment);
  const inputBlockedRef = useRef(inputBlocked);
  const callbacksRef = useRef({ onSelect, onInput, onPickup });
  const keysRef = useRef(new Set<string>());
  const destinationRef = useRef<Vector3 | null>(null);
  const sequenceRef = useRef(0);
  const spawnSequenceRef = useRef(0);
  const lastFacingRef = useRef(0);
  const handledCombatEventRef = useRef<string | null>(null);
  const [assetState, setAssetState] = useState<"loading" | "ready" | "error">("loading");

  snapshotRef.current = snapshot;
  selectedRef.current = selectedId;
  ownEquipmentRef.current = ownEquipment;
  inputBlockedRef.current = inputBlocked;
  callbacksRef.current = { onSelect, onInput, onPickup };

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    let disposed = false;
    const engine = new Engine(canvas, true, { preserveDrawingBuffer: false, stencil: true }, true);
    if (window.devicePixelRatio > 1.5) engine.setHardwareScalingLevel(1.25);
    const scene = new Scene(engine);
    sceneRef.current = scene;
    const models = new NeivaraModelLibrary(scene);
    modelsRef.current = models;
    const environment = buildDawnmereEnvironment(scene, models);
    environmentRef.current = environment;
    void environment.ready.then(() => {
      if (!disposed) setAssetState("ready");
    }).catch((error: unknown) => {
      if (shouldIgnoreDisposedSceneLoad(error, disposed)) return;
      console.error("Не удалось полностью загрузить окружение Донмера", error);
      if (!disposed) setAssetState("error");
    });

    const camera = new ArcRotateCamera(
      "camera",
      -Math.PI / 2.3,
      1.02,
      20,
      new Vector3(0, 1.1, 0),
      scene,
    );
    camera.lowerRadiusLimit = 7;
    camera.upperRadiusLimit = 30;
    camera.lowerBetaLimit = 0.4;
    camera.upperBetaLimit = 1.35;
    camera.wheelDeltaPercentage = 0.01;
    camera.panningSensibility = 0;
    camera.attachControl(canvas, true);
    cameraRef.current = camera;

    const selection = CreateTorus(
      "selection-ring",
      { diameter: 2.15, thickness: 0.09, tessellation: 40 },
      scene,
    );
    selection.material = material(scene, "selection-material", color("#f2d47d"), 0.8);
    selection.isPickable = false;
    selection.setEnabled(false);

    scene.onPointerObservable.add((info) => {
      if (info.type !== PointerEventTypes.POINTERPICK) return;
      const picked = info.pickInfo?.pickedMesh;
      if (!picked) return;
      const metadata = picked.metadata as
        | { entityId?: string; entityType?: EntityType; ground?: boolean }
        | undefined;
      if (metadata?.entityId) {
        if (metadata.entityType === "loot") callbacksRef.current.onPickup(metadata.entityId);
        else callbacksRef.current.onSelect(metadata.entityId);
        destinationRef.current = null;
        return;
      }
      if (metadata?.ground) {
        const point = info.pickInfo?.pickedPoint;
        if (point) destinationRef.current = point.clone();
      }
    });

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement) return;
      if (inputBlockedRef.current) return;
      keysRef.current.add(event.code);
      if (event.code === "Escape") callbacksRef.current.onSelect(null);
    };
    const onKeyUp = (event: KeyboardEvent) => keysRef.current.delete(event.code);
    const onBlur = () => keysRef.current.clear();
    const onResize = () => engine.resize();
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
    window.addEventListener("blur", onBlur);
    window.addEventListener("resize", onResize);

    let lastInputAt = 0;
    scene.onBeforeRenderObservable.add(() => {
      const currentSnapshot = snapshotRef.current;
      const own = currentSnapshot?.players.find((entry) => entry.id === currentSnapshot.selfId);
      const now = performance.now();
      let selectedVisible = false;
      for (const [id, visual] of visualsRef.current) {
        const distance = Vector3.Distance(visual.root.position, visual.target);
        visual.root.position.copyFrom(Vector3.Lerp(
          visual.root.position,
          visual.target,
          visual.entityType === "player" ? 0.32 : 0.22,
        ));
        if (visual.entityType === "loot") visual.root.rotation.y += 0.018;
        visual.root.setEnabled(visual.entityType === "player" || visual.alive);
        if (visual.alive && now >= visual.animationLockedUntil && visual.entityType !== "loot") {
          visual.model.animations.setLocomotion(distance > 0.035, Math.min(1.6, 0.7 + distance * 0.45));
        }
        if (id === selectedRef.current && visual.alive) {
          selectedVisible = true;
          selection.setEnabled(true);
          selection.position.copyFrom(visual.root.position);
          selection.position.y = 0.08;
          const diameter = visual.entityType === "monster" ? Math.max(1.55, visual.height * 0.82) : 1.75;
          selection.scaling.setAll(diameter / 2.15);
          selection.rotation.y += 0.035;
        }
      }
      if (!selectedVisible) selection.setEnabled(false);

      if (own) {
        camera.target.copyFrom(Vector3.Lerp(
          camera.target,
          new Vector3(own.position.x, 1.2, own.position.z),
          0.12,
        ));
      }

      if (now - lastInputAt < 50 || !own) return;
      lastInputAt = now;
      const keys = keysRef.current;
      const forwardRay = camera.getForwardRay().direction;
      const forward = new Vector3(forwardRay.x, 0, forwardRay.z).normalize();
      const right = new Vector3(forward.z, 0, -forward.x);
      const axisX = inputBlockedRef.current ? 0 : (keys.has("KeyD") ? 1 : 0) - (keys.has("KeyA") ? 1 : 0);
      const axisZ = inputBlockedRef.current ? 0 : (keys.has("KeyW") ? 1 : 0) - (keys.has("KeyS") ? 1 : 0);
      let direction = forward.scale(axisZ).add(right.scale(axisX));

      if (inputBlockedRef.current) {
        destinationRef.current = null;
        keysRef.current.clear();
      } else if (direction.lengthSquared() <= 0.0001 && destinationRef.current) {
        direction = destinationRef.current.subtract(new Vector3(own.position.x, 0, own.position.z));
        direction.y = 0;
        if (direction.length() < 0.45) {
          destinationRef.current = null;
          direction.setAll(0);
        }
      } else if (direction.lengthSquared() > 0.0001) {
        destinationRef.current = null;
      }
      if (direction.lengthSquared() > 1) direction.normalize();
      if (direction.lengthSquared() > 0.0001) lastFacingRef.current = Math.atan2(direction.x, direction.z);
      sequenceRef.current += 1;
      callbacksRef.current.onInput({
        seq: sequenceRef.current,
        direction: { x: direction.x, z: direction.z },
        facing: lastFacingRef.current,
        sprint: !inputBlockedRef.current && (keys.has("ShiftLeft") || keys.has("ShiftRight")),
      });
    });

    engine.runRenderLoop(() => scene.render());
    return () => {
      disposed = true;
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
      window.removeEventListener("blur", onBlur);
      window.removeEventListener("resize", onResize);
      activeFxRef.current.forEach((handle) => handle.dispose());
      activeFxRef.current.clear();
      visualsRef.current.forEach(disposeVisual);
      visualsRef.current.clear();
      loadingRef.current.clear();
      environment.dispose();
      models.dispose();
      scene.dispose();
      engine.dispose();
      sceneRef.current = null;
      cameraRef.current = null;
      modelsRef.current = null;
      environmentRef.current = null;
    };
  }, []);

  useEffect(() => {
    const scene = sceneRef.current;
    const models = modelsRef.current;
    if (!scene || !models || !snapshot) return;
    const incoming = new Set<string>();

    const queueVisual = (
      entity: SnapshotEntity,
      entityType: EntityType,
      assetKey: string,
      create: () => Promise<EntityVisual>,
    ) => {
      const token = `${assetKey}#${spawnSequenceRef.current += 1}`;
      loadingRef.current.set(entity.id, token);
      void create().then((visual) => {
        if (
          sceneRef.current !== scene
          || loadingRef.current.get(entity.id) !== token
          || !snapshotHasEntity(snapshotRef.current, entity.id, entityType)
        ) {
          disposeVisual(visual);
          return;
        }
        const previous = visualsRef.current.get(entity.id);
        if (previous) disposeVisual(previous);
        visualsRef.current.set(entity.id, visual);
        loadingRef.current.delete(entity.id);
      }).catch((error: unknown) => {
        if (loadingRef.current.get(entity.id) === token) loadingRef.current.delete(entity.id);
        const sceneWasReplaced = sceneRef.current !== scene;
        if (shouldIgnoreDisposedSceneLoad(error, sceneWasReplaced)) return;
        console.error(`Не удалось загрузить ${entityType} ${entity.id}`, error);
        if (!sceneWasReplaced) setAssetState("error");
      });
    };

    const update = (
      entity: SnapshotEntity,
      entityType: EntityType,
      assetKey: string,
      create: () => Promise<EntityVisual>,
      alive = true,
      nextEquipmentKey = "",
    ) => {
      incoming.add(entity.id);
      let visual = visualsRef.current.get(entity.id);
      if (visual && (visual.assetKey !== assetKey || visual.equipmentKey !== nextEquipmentKey)) {
        disposeVisual(visual);
        visualsRef.current.delete(entity.id);
        visual = undefined;
      }
      const loading = loadingRef.current.get(entity.id);
      if (!visual && (!loading || !loading.startsWith(`${assetKey}#`))) {
        queueVisual(entity, entityType, assetKey, create);
        return;
      }
      if (!visual) return;
      visual.target.copyFromFloats(entity.position.x, entity.position.y, entity.position.z);
      if ("rotationY" in entity) visual.root.rotation.y = entity.rotationY;
      if (visual.alive && !alive && !visual.deathPlayed) {
        visual.deathPlayed = true;
        visual.animationLockedUntil = Number.POSITIVE_INFINITY;
        visual.model.animations.play("death", { loop: false, returnToIdle: false });
      } else if (!visual.alive && alive) {
        visual.deathPlayed = false;
        visual.animationLockedUntil = 0;
        visual.model.animations.play("idle", { loop: true });
      }
      visual.alive = alive;
    };

    for (const player of snapshot.players) {
      const remoteEquipment = normalizeEquipment(player.equipment);
      const loadout = player.id === snapshot.selfId
        ? { ...remoteEquipment, ...ownEquipmentRef.current }
        : remoteEquipment;
      const key = equipmentKey(loadout);
      const assetKey = `${player.race}/${player.gender}/${player.classId}`;
      update(
        player,
        "player",
        assetKey,
        () => createPlayerVisual(scene, models, player, loadout),
        player.alive,
        key,
      );
    }
    for (const monster of snapshot.monsters) {
      const assetKey = `${monster.kind}/${monster.elite ? "elite" : "common"}`;
      update(
        monster,
        "monster",
        assetKey,
        () => createMonsterVisual(scene, models, monster),
        monster.alive,
      );
    }
    for (const loot of snapshot.loot) {
      update(loot, "loot", `loot/${loot.itemId}`, () => createLootVisual(models, loot));
    }
    for (const [id, visual] of visualsRef.current) {
      if (!incoming.has(id)) {
        disposeVisual(visual);
        visualsRef.current.delete(id);
      }
    }
    for (const id of loadingRef.current.keys()) {
      if (!incoming.has(id)) loadingRef.current.delete(id);
    }
  }, [snapshot, ownEquipment]);

  useEffect(() => {
    const scene = sceneRef.current;
    if (!scene || !combatEvent || handledCombatEventRef.current === combatEvent.id) return;
    handledCombatEventRef.current = combatEvent.id;
    const source = visualsRef.current.get(combatEvent.sourceId);
    const target = visualsRef.current.get(combatEvent.targetId);
    if (!source || !target) return;

    const sourcePlayer = snapshotRef.current?.players.find((entry) => entry.id === combatEvent.sourceId);
    const roleHint = sourcePlayer ? `${sourcePlayer.race} ${sourcePlayer.classId}` : "monster";
    const origin = source.root.position.add(new Vector3(0, source.height * 0.42, 0));
    const destination = target.root.position.add(new Vector3(0, target.height * 0.42, 0));
    const now = performance.now();
    const cast = combatEvent.abilityId === "aether_bolt";
    source.animationLockedUntil = now + (cast ? 760 : 620);
    source.model.animations.play(cast ? "cast" : "attack", { loop: false });

    if (combatEvent.kind === "damage") {
      target.animationLockedUntil = now + 420;
      target.model.animations.play("hit", { loop: false });
    } else if (combatEvent.kind === "defeat") {
      target.deathPlayed = true;
      target.animationLockedUntil = Number.POSITIVE_INFINITY;
      target.model.animations.play("death", { loop: false, returnToIdle: false });
    }

    if (combatEvent.abilityId === "aether_bolt") {
      trackFx(activeFxRef.current, playSkillCastFx({
        scene,
        abilityId: combatEvent.abilityId,
        origin,
        roleHint,
      }));
      const projectile = playSkillProjectileFx({
        scene,
        abilityId: combatEvent.abilityId,
        origin,
        target: destination,
        roleHint,
      });
      trackFx(activeFxRef.current, projectile);
      void projectile.completed.then(() => {
        if (sceneRef.current !== scene || combatEvent.kind === "miss") return;
        trackFx(activeFxRef.current, playSkillImpactFx({
          scene,
          abilityId: combatEvent.abilityId,
          origin: destination,
          roleHint,
          scale: combatEvent.critical ? 1.45 : 1,
        }));
      });
    } else if (combatEvent.abilityId === "vanguard_strike") {
      trackFx(activeFxRef.current, playSkillAuraFx({
        scene,
        abilityId: combatEvent.abilityId,
        origin: source.root.position,
        roleHint,
        scale: 0.82,
      }));
      if (combatEvent.kind !== "miss") {
        trackFx(activeFxRef.current, playSkillImpactFx({
          scene,
          abilityId: combatEvent.abilityId,
          origin: destination,
          roleHint,
          scale: combatEvent.critical ? 1.35 : 0.9,
        }));
      }
    } else if (combatEvent.kind !== "miss") {
      trackFx(activeFxRef.current, playSkillImpactFx({
        scene,
        abilityId: combatEvent.abilityId,
        origin: destination,
        roleHint,
        scale: combatEvent.critical ? 1.2 : 0.68,
      }));
    }
  }, [combatEvent]);

  return (
    <>
      <canvas ref={canvasRef} className="world-canvas" aria-label="Трёхмерный мир Переправы Донмер" />
      {assetState !== "ready" && (
        <div className={`world-asset-status ${assetState}`} role={assetState === "error" ? "alert" : "status"}>
          {assetState === "error" ? "Часть 3D-моделей не загрузилась" : "Загружаем Донмер и героев…"}
        </div>
      )}
    </>
  );
}
