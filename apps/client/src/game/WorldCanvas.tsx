import { ArcRotateCamera } from "@babylonjs/core/Cameras/arcRotateCamera.js";
import "@babylonjs/core/Culling/ray.js";
import { Engine } from "@babylonjs/core/Engines/engine.js";
import { PointerEventTypes } from "@babylonjs/core/Events/pointerEvents.js";
import { DirectionalLight } from "@babylonjs/core/Lights/directionalLight.js";
import { HemisphericLight } from "@babylonjs/core/Lights/hemisphericLight.js";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial.js";
import { DynamicTexture } from "@babylonjs/core/Materials/Textures/dynamicTexture.js";
import { Texture } from "@babylonjs/core/Materials/Textures/texture.js";
import { Color3, Color4 } from "@babylonjs/core/Maths/math.color.js";
import { Vector3 } from "@babylonjs/core/Maths/math.vector.js";
import { CreateCapsule } from "@babylonjs/core/Meshes/Builders/capsuleBuilder.js";
import { CreateBox } from "@babylonjs/core/Meshes/Builders/boxBuilder.js";
import { CreateCylinder } from "@babylonjs/core/Meshes/Builders/cylinderBuilder.js";
import { CreateDisc } from "@babylonjs/core/Meshes/Builders/discBuilder.js";
import { CreateGround } from "@babylonjs/core/Meshes/Builders/groundBuilder.js";
import { CreatePlane } from "@babylonjs/core/Meshes/Builders/planeBuilder.js";
import { CreatePolyhedron } from "@babylonjs/core/Meshes/Builders/polyhedronBuilder.js";
import { CreateSphere } from "@babylonjs/core/Meshes/Builders/sphereBuilder.js";
import { CreateTorus } from "@babylonjs/core/Meshes/Builders/torusBuilder.js";
import { CreateTorusKnot } from "@babylonjs/core/Meshes/Builders/torusKnotBuilder.js";
import { Mesh } from "@babylonjs/core/Meshes/mesh.js";
import { TransformNode } from "@babylonjs/core/Meshes/transformNode.js";
import { Scene } from "@babylonjs/core/scene.js";
import {
  ITEMS,
  getClass,
  getRace,
  type LootSnapshot,
  type MonsterSnapshot,
  type MovementInput,
  type PlayerSnapshot,
  type WorldSnapshot,
} from "@neivara/shared";
import { useEffect, useRef } from "react";

interface Props {
  snapshot: WorldSnapshot | null;
  selectedId: string | null;
  ownEquipment: VisualEquipmentLoadout;
  inputBlocked: boolean;
  onSelect: (id: string | null) => void;
  onInput: (input: MovementInput) => void;
  onPickup: (lootId: string) => void;
}

export interface VisualEquipmentLoadout {
  [slot: string]: string | null | undefined;
}

type SnapshotEntity = PlayerSnapshot | MonsterSnapshot | LootSnapshot;

interface EntityVisual {
  root: TransformNode;
  target: Vector3;
  entityType: "player" | "monster" | "loot";
  alive: boolean;
  equipmentKey: string;
}

interface RuntimeItemVisual {
  color?: string;
  weaponType?: string;
  armorWeight?: string;
  visual?: {
    model?: string;
    primaryColor?: string;
    accentColor?: string;
    scale?: number;
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

function markPickable(root: TransformNode, id: string, entityType: EntityVisual["entityType"]): void {
  for (const mesh of root.getChildMeshes()) {
    mesh.isPickable = true;
    mesh.metadata = { entityId: id, entityType };
  }
}

function addNameplate(scene: Scene, root: TransformNode, text: string, tint: string, height: number): void {
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

function visualColor(itemId: string | null, fallback: string): string {
  const definition = itemVisual(itemId);
  return definition?.visual?.primaryColor ?? definition?.color ?? fallback;
}

function addWeapon(
  scene: Scene,
  root: TransformNode,
  playerId: string,
  itemId: string,
  side: 1 | -1,
  fallback: string,
): void {
  const definition = itemVisual(itemId);
  const modelHint = `${itemId} ${definition?.weaponType ?? ""} ${definition?.visual?.model ?? ""}`.toLowerCase();
  const primary = visualColor(itemId, fallback);
  const accent = definition?.visual?.accentColor ?? "#ead18c";
  const scale = Math.max(0.75, Math.min(1.35, definition?.visual?.scale ?? 1));
  const mount = new TransformNode(`weapon-${playerId}-${side}`, scene);
  mount.parent = root;
  mount.position.copyFromFloats(0.68 * side, 1.12, 0.1);
  mount.rotation.z = side * -0.16;
  mount.scaling.scaleInPlace(scale);

  if (/bow|longbow|shortbow|лук/.test(modelHint)) {
    const bow = CreateTorus(`bow-${playerId}-${side}`, { diameter: 1.25, thickness: 0.055, tessellation: 32 }, scene);
    bow.parent = mount;
    bow.scaling.x = 0.42;
    bow.rotation.x = Math.PI / 2;
    bow.material = material(scene, `bow-mat-${playerId}-${side}`, color(primary));
    const grip = CreateCylinder(`bow-grip-${playerId}-${side}`, { height: 0.32, diameter: 0.09 }, scene);
    grip.parent = mount;
    grip.material = material(scene, `bow-grip-mat-${playerId}-${side}`, color(accent));
    return;
  }

  if (/staff|wand|scepter|посох|жезл|скипетр/.test(modelHint)) {
    const shaft = CreateCylinder(`staff-${playerId}-${side}`, { height: 2.05, diameter: 0.095, tessellation: 10 }, scene);
    shaft.parent = mount;
    shaft.position.y = 0.12;
    shaft.material = material(scene, `staff-mat-${playerId}-${side}`, color(primary));
    const focus = CreatePolyhedron(`staff-focus-${playerId}-${side}`, { type: 1, size: 0.22 }, scene);
    focus.parent = mount;
    focus.position.y = 1.18;
    focus.material = material(scene, `staff-focus-mat-${playerId}-${side}`, color(accent), 0.55);
    return;
  }

  if (/spear|lance|копь/.test(modelHint)) {
    const shaft = CreateCylinder(`spear-${playerId}-${side}`, { height: 2.25, diameter: 0.085, tessellation: 10 }, scene);
    shaft.parent = mount;
    shaft.position.y = 0.2;
    shaft.material = material(scene, `spear-mat-${playerId}-${side}`, color(primary));
    const point = CreatePolyhedron(`spear-point-${playerId}-${side}`, { type: 1, size: 0.2 }, scene);
    point.parent = mount;
    point.position.y = 1.42;
    point.scaling.y = 1.75;
    point.material = material(scene, `spear-point-mat-${playerId}-${side}`, color(accent), 0.18);
    return;
  }

  if (/tome|book|codex|grimoire|фолиант/.test(modelHint)) {
    const book = CreateBox(`tome-${playerId}-${side}`, { width: 0.52, height: 0.68, depth: 0.14 }, scene);
    book.parent = mount;
    book.position.y = 0.35;
    book.rotation.z = side * 0.28;
    book.material = material(scene, `tome-mat-${playerId}-${side}`, color(primary), 0.12);
    const clasp = CreateBox(`tome-clasp-${playerId}-${side}`, { width: 0.1, height: 0.7, depth: 0.16 }, scene);
    clasp.parent = mount;
    clasp.position.copyFromFloats(0.08 * side, 0.35, 0);
    clasp.material = material(scene, `tome-clasp-mat-${playerId}-${side}`, color(accent), 0.2);
    return;
  }

  if (/spear|lance|копь|пика/.test(modelHint)) {
    const shaft = CreateCylinder(
      `spear-shaft-${playerId}-${side}`,
      { height: 2.35, diameter: 0.075, tessellation: 10 },
      scene,
    );
    shaft.parent = mount;
    shaft.position.y = 0.52;
    shaft.material = material(scene, `spear-shaft-mat-${playerId}-${side}`, color(accent));
    const tip = CreatePolyhedron(`spear-tip-${playerId}-${side}`, { type: 1, size: 0.22 }, scene);
    tip.parent = mount;
    tip.position.y = 1.78;
    tip.scaling.copyFromFloats(0.58, 1.55, 0.4);
    tip.material = material(scene, `spear-tip-mat-${playerId}-${side}`, color(primary), 0.12);
    const counterweight = CreateSphere(
      `spear-counterweight-${playerId}-${side}`,
      { diameter: 0.14, segments: 8 },
      scene,
    );
    counterweight.parent = mount;
    counterweight.position.y = -0.69;
    counterweight.material = material(scene, `spear-counterweight-mat-${playerId}-${side}`, color(primary));
    return;
  }

  const isMace = /mace|hammer|maul|булав|молот/.test(modelHint);
  const isDagger = /dagger|knife|кинжал/.test(modelHint);
  const isGreatblade = /greatblade|greatsword|claymore|двуруч/.test(modelHint);
  const shaft = CreateCylinder(
    `weapon-grip-${playerId}-${side}`,
    { height: isDagger ? 0.38 : 0.62, diameter: 0.1, tessellation: 10 },
    scene,
  );
  shaft.parent = mount;
  shaft.position.y = -0.22;
  shaft.material = material(scene, `weapon-grip-mat-${playerId}-${side}`, color(accent));
  if (isMace) {
    const head = CreatePolyhedron(`mace-${playerId}-${side}`, { type: 1, size: 0.28 }, scene);
    head.parent = mount;
    head.position.y = 0.25;
    head.material = material(scene, `mace-mat-${playerId}-${side}`, color(primary), 0.08);
  } else {
    const blade = CreateBox(
      `blade-${playerId}-${side}`,
      {
        width: isDagger ? 0.14 : isGreatblade ? 0.3 : 0.19,
        height: isDagger ? 0.55 : isGreatblade ? 1.62 : 1.22,
        depth: isGreatblade ? 0.085 : 0.055,
      },
      scene,
    );
    blade.parent = mount;
    blade.position.y = isDagger ? 0.23 : isGreatblade ? 0.78 : 0.58;
    blade.material = material(scene, `blade-mat-${playerId}-${side}`, color(primary), 0.12);
    const guard = CreateBox(`guard-${playerId}-${side}`, { width: 0.42, height: 0.08, depth: 0.1 }, scene);
    guard.parent = mount;
    guard.position.y = -0.01;
    guard.material = material(scene, `guard-mat-${playerId}-${side}`, color(accent));
  }
}

function addRaceSilhouette(scene: Scene, root: TransformNode, player: PlayerSnapshot): void {
  const race = getRace(player.race);
  const primary = material(scene, `race-detail-${player.id}`, color(race.accent), 0.18);
  const secondary = material(scene, `race-detail-secondary-${player.id}`, color(race.color), 0.05);

  if (player.race === "erim") {
    const circlet = CreateTorus(
      `erim-circlet-${player.id}`,
      { diameter: 0.56, thickness: 0.035, tessellation: 20 },
      scene,
    );
    circlet.parent = root;
    circlet.position.copyFromFloats(0, 2.38, -0.01);
    circlet.rotation.x = Math.PI / 2;
    circlet.material = primary;
    return;
  }

  if (player.race === "vaeli") {
    for (const side of [-1, 1] as const) {
      const leaf = CreatePolyhedron(`vaeli-leaf-${player.id}-${side}`, { type: 1, size: 0.18 }, scene);
      leaf.parent = root;
      leaf.position.copyFromFloats(0.34 * side, 2.29, -0.01);
      leaf.scaling.copyFromFloats(1.45, 0.5, 0.28);
      leaf.rotation.z = side * 0.35;
      leaf.material = primary;
      const bud = CreateSphere(`vaeli-bud-${player.id}-${side}`, { diameter: 0.09, segments: 8 }, scene);
      bud.parent = root;
      bud.position.copyFromFloats(0.17 * side, 2.58, -0.02);
      bud.material = secondary;
    }
    return;
  }

  if (player.race === "kerran") {
    for (const side of [-1, 1] as const) {
      const brow = CreatePolyhedron(`kerran-brow-${player.id}-${side}`, { type: 1, size: 0.15 }, scene);
      brow.parent = root;
      brow.position.copyFromFloats(0.17 * side, 2.42, -0.24);
      brow.scaling.copyFromFloats(1.2, 0.68, 0.42);
      brow.rotation.z = side * -0.2;
      brow.material = primary;
      const shoulderPlate = CreatePolyhedron(
        `kerran-plate-${player.id}-${side}`,
        { type: 1, size: 0.2 },
        scene,
      );
      shoulderPlate.parent = root;
      shoulderPlate.position.copyFromFloats(0.59 * side, 1.6, -0.04);
      shoulderPlate.scaling.copyFromFloats(1.15, 0.65, 0.7);
      shoulderPlate.material = secondary;
    }
    return;
  }

  if (player.race === "narai") {
    const halo = CreateTorus(
      `narai-halo-${player.id}`,
      { diameter: 0.74, thickness: 0.025, tessellation: 28 },
      scene,
    );
    halo.parent = root;
    halo.position.copyFromFloats(0, 2.33, 0.15);
    halo.rotation.x = Math.PI / 2;
    halo.material = primary;
    for (const side of [-1, 1] as const) {
      const veil = CreateBox(
        `narai-veil-${player.id}-${side}`,
        { width: 0.09, height: 0.7, depth: 0.025 },
        scene,
      );
      veil.parent = root;
      veil.position.copyFromFloats(0.22 * side, 1.98, 0.15);
      veil.rotation.z = side * 0.12;
      veil.material = secondary;
    }
    return;
  }

  for (const side of [-1, 1] as const) {
    const horn = CreateCylinder(
      `dairi-horn-${player.id}-${side}`,
      { height: 0.36, diameterTop: 0.02, diameterBottom: 0.11, tessellation: 8 },
      scene,
    );
    horn.parent = root;
    horn.position.copyFromFloats(0.19 * side, 2.56, -0.03);
    horn.rotation.z = side * -0.38;
    horn.material = primary;
  }
}

function addShield(scene: Scene, root: TransformNode, playerId: string, itemId: string, fallback: string): void {
  const shield = CreateCylinder(
    `shield-${playerId}`,
    { diameter: 0.9, height: 0.13, tessellation: 8 },
    scene,
  );
  shield.parent = root;
  shield.position.copyFromFloats(-0.66, 1.22, 0.22);
  shield.rotation.x = Math.PI / 2;
  shield.rotation.z = -0.13;
  shield.material = material(scene, `shield-mat-${playerId}`, color(visualColor(itemId, fallback)), 0.06);
  const boss = CreateSphere(`shield-boss-${playerId}`, { diameter: 0.23, segments: 8 }, scene);
  boss.parent = shield;
  boss.position.y = -0.09;
  boss.material = material(scene, `shield-boss-mat-${playerId}`, color("#d9bd78"), 0.12);
}

function playerVisual(scene: Scene, player: PlayerSnapshot, loadout: VisualEquipmentLoadout): EntityVisual {
  const root = new TransformNode(`player-${player.id}`, scene);
  root.position.copyFromFloats(player.position.x, player.position.y, player.position.z);
  const race = getRace(player.race);
  const classInfo = getClass(player.classId);

  const chestItem = equippedItem(loadout, "chest", "armor");
  const headItem = equippedItem(loadout, "head", "helmet");
  const handsItem = equippedItem(loadout, "hands", "gloves");
  const legsItem = equippedItem(loadout, "legs");
  const feetItem = equippedItem(loadout, "feet", "boots");
  const mainHandItem = equippedItem(loadout, "main_hand", "weapon");
  const offHandItem = equippedItem(loadout, "off_hand", "shield");
  const armorColor = visualColor(chestItem, race.color);
  const armorAccent = itemVisual(chestItem)?.visual?.accentColor ?? classInfo.color;
  const armorWeight = itemVisual(chestItem)?.armorWeight;
  const bodyWidth = player.race === "kerran" ? 1.12 : player.race === "narai" ? 0.9 : 1;
  const bodyHeight = player.race === "narai" || player.race === "vaeli" ? 1.05 : 1;
  const armorBulk = armorWeight === "heavy" ? 1.12 : armorWeight === "light" ? 0.94 : 1;

  const body = CreateCapsule(`body-${player.id}`, { height: 1.55, radius: 0.39 }, scene);
  body.parent = root;
  body.position.y = 1.32;
  body.scaling.copyFromFloats(bodyWidth * armorBulk, bodyHeight, bodyWidth * armorBulk);
  body.material = material(scene, `body-mat-${player.id}`, color(armorColor));

  const chest = CreateCylinder(
    `chest-${player.id}`,
    { height: 0.92, diameterTop: 0.66, diameterBottom: 0.86, tessellation: 10 },
    scene,
  );
  chest.parent = root;
  chest.position.y = 1.48;
  chest.scaling.copyFromFloats(bodyWidth * armorBulk, bodyHeight, bodyWidth * armorBulk);
  chest.material = material(scene, `chest-mat-${player.id}`, color(armorColor), chestItem ? 0.04 : 0);

  const head = CreateSphere(`head-${player.id}`, { diameter: 0.54, segments: 12 }, scene);
  head.parent = root;
  head.position.y = 2.25;
  head.material = material(scene, `head-mat-${player.id}`, color(race.color));

  const hair = CreateSphere(`hair-${player.id}`, { diameter: 0.57, segments: 10 }, scene);
  hair.parent = root;
  hair.position.copyFromFloats(0, 2.34, -0.035);
  hair.scaling.y = 0.55;
  hair.material = material(scene, `hair-mat-${player.id}`, color(race.accent));
  addRaceSilhouette(scene, root, player);

  for (const side of [-1, 1] as const) {
    const arm = CreateCylinder(`arm-${player.id}-${side}`, { height: 0.88, diameter: 0.2, tessellation: 8 }, scene);
    arm.parent = root;
    arm.position.copyFromFloats(0.51 * side, 1.32, 0);
    arm.rotation.z = side * -0.14;
    arm.material = material(scene, `arm-mat-${player.id}-${side}`, color(visualColor(handsItem, armorColor)));
    const leg = CreateCylinder(`leg-${player.id}-${side}`, { height: 0.92, diameter: 0.25, tessellation: 8 }, scene);
    leg.parent = root;
    leg.position.copyFromFloats(0.2 * side, 0.54, 0);
    leg.material = material(scene, `leg-mat-${player.id}-${side}`, color(visualColor(legsItem, armorColor)));
    const boot = CreateBox(`boot-${player.id}-${side}`, { width: 0.28, height: 0.26, depth: 0.42 }, scene);
    boot.parent = root;
    boot.position.copyFromFloats(0.2 * side, 0.16, 0.09);
    boot.material = material(scene, `boot-mat-${player.id}-${side}`, color(visualColor(feetItem, "#3c3430")));
  }

  if (chestItem && armorWeight === "heavy") {
    for (const side of [-1, 1] as const) {
      const pauldron = CreateSphere(`pauldron-${player.id}-${side}`, { diameter: 0.42, segments: 8 }, scene);
      pauldron.parent = root;
      pauldron.position.copyFromFloats(0.53 * side, 1.7, 0);
      pauldron.scaling.copyFromFloats(1.15, 0.58, 0.9);
      pauldron.material = material(scene, `pauldron-mat-${player.id}-${side}`, color(armorAccent), 0.08);
    }
  } else if (chestItem) {
    const collar = CreateTorus(
      `collar-${player.id}`,
      { diameter: 0.82, thickness: armorWeight === "light" ? 0.055 : 0.085, tessellation: 18 },
      scene,
    );
    collar.parent = root;
    collar.position.y = 1.73;
    collar.rotation.x = Math.PI / 2;
    collar.material = material(scene, `collar-mat-${player.id}`, color(armorAccent), 0.08);
  }

  if (headItem) {
    const headWeight = itemVisual(headItem)?.armorWeight;
    const helm = headWeight === "light"
      ? CreateSphere(`helm-${player.id}`, { diameter: 0.64, segments: 10 }, scene)
      : CreateCylinder(`helm-${player.id}`, { height: 0.43, diameterTop: 0.43, diameterBottom: 0.58, tessellation: 10 }, scene);
    helm.parent = root;
    helm.position.y = headWeight === "light" ? 2.35 : 2.38;
    if (headWeight === "light") helm.scaling.copyFromFloats(1, 1.08, 0.92);
    helm.material = material(scene, `helm-mat-${player.id}`, color(visualColor(headItem, armorColor)), 0.04);
    if (headWeight !== "light") {
      const crest = CreateBox(`helm-crest-${player.id}`, { width: 0.08, height: 0.36, depth: 0.34 }, scene);
      crest.parent = root;
      crest.position.copyFromFloats(0, 2.68, -0.04);
      crest.material = material(scene, `helm-crest-mat-${player.id}`, color(armorAccent), 0.08);
    }
  }

  const mantle = CreateTorus(
    `mantle-${player.id}`,
    { diameter: 0.9, thickness: 0.12, tessellation: 18 },
    scene,
  );
  mantle.parent = root;
  mantle.position.y = 1.72;
  mantle.rotation.x = Math.PI / 2;
  mantle.material = material(scene, `class-mat-${player.id}`, color(classInfo.color), 0.25);

  if (mainHandItem) addWeapon(scene, root, player.id, mainHandItem, 1, classInfo.color);
  if (offHandItem) {
    const hint = `${offHandItem} ${itemVisual(offHandItem)?.visual?.model ?? ""}`.toLowerCase();
    if (/shield|buckler|щит/.test(hint)) addShield(scene, root, player.id, offHandItem, armorColor);
    else addWeapon(scene, root, player.id, offHandItem, -1, classInfo.color);
  }

  if (!mainHandItem) {
    const focus = CreatePolyhedron(`focus-${player.id}`, { type: 1, size: 0.19 }, scene);
    focus.parent = root;
    focus.position.copyFromFloats(0.68, 1.1, 0.1);
    focus.material = material(scene, `focus-mat-${player.id}`, color(classInfo.color), 0.75);
  }

  addNameplate(scene, root, `${player.name}  ·  ${player.level}`, race.accent, 3.05);
  markPickable(root, player.id, "player");
  return {
    root,
    target: new Vector3(player.position.x, player.position.y, player.position.z),
    entityType: "player",
    alive: player.alive,
    equipmentKey: equipmentKey(loadout),
  };
}

function monsterVisual(scene: Scene, monster: MonsterSnapshot): EntityVisual {
  const root = new TransformNode(`monster-${monster.id}`, scene);
  root.position.copyFromFloats(monster.position.x, monster.position.y, monster.position.z);
  const baseColor = monster.elite ? "#c46775" : "#5cb49c";
  const body = CreateSphere(
    `monster-body-${monster.id}`,
    { diameter: monster.elite ? 2.4 : 1.35, segments: 12 },
    scene,
  );
  body.parent = root;
  body.position.y = monster.elite ? 1.1 : 0.7;
  body.scaling.z = 1.25;
  body.material = material(scene, `monster-mat-${monster.id}`, color(baseColor), 0.08);

  for (const side of [-1, 1]) {
    const eye = CreateSphere(`eye-${monster.id}-${side}`, { diameter: 0.17 }, scene);
    eye.parent = root;
    eye.position.copyFromFloats(side * 0.25, monster.elite ? 1.35 : 0.88, 0.64);
    eye.material = material(scene, `eye-mat-${monster.id}-${side}`, color("#f4c86d"), 1);
  }
  if (monster.elite) {
    const crown = CreateTorusKnot(
      `crown-${monster.id}`,
      { radius: 0.45, tube: 0.08, radialSegments: 32, tubularSegments: 12 },
      scene,
    );
    crown.parent = root;
    crown.position.y = 2.35;
    crown.scaling.scaleInPlace(0.55);
    crown.material = material(scene, `crown-mat-${monster.id}`, color("#e3a665"), 0.65);
  }
  addNameplate(scene, root, `${monster.name}  ·  ${monster.level}`, baseColor, monster.elite ? 3.2 : 2.05);
  markPickable(root, monster.id, "monster");
  return {
    root,
    target: new Vector3(monster.position.x, monster.position.y, monster.position.z),
    entityType: "monster",
    alive: monster.alive,
    equipmentKey: "",
  };
}

function lootVisual(scene: Scene, loot: LootSnapshot): EntityVisual {
  const root = new TransformNode(`loot-${loot.id}`, scene);
  root.position.copyFromFloats(loot.position.x, loot.position.y, loot.position.z);
  const gem = CreatePolyhedron(`loot-gem-${loot.id}`, { type: 1, size: 0.38 }, scene);
  gem.parent = root;
  gem.position.y = 0.48;
  gem.material = material(scene, `loot-mat-${loot.id}`, color("#72ddc5"), 0.8);
  markPickable(root, loot.id, "loot");
  return {
    root,
    target: new Vector3(loot.position.x, loot.position.y, loot.position.z),
    entityType: "loot",
    alive: true,
    equipmentKey: "",
  };
}

function buildEnvironment(scene: Scene): Mesh {
  scene.clearColor = new Color4(0.025, 0.085, 0.09, 1);
  scene.fogMode = Scene.FOGMODE_EXP2;
  scene.fogColor = new Color3(0.06, 0.15, 0.15);
  scene.fogDensity = 0.012;

  const ambient = new HemisphericLight("ambient", new Vector3(0.2, 1, -0.3), scene);
  ambient.intensity = 1.15;
  ambient.diffuse = color("#c6e0c2");
  ambient.groundColor = color("#193c36");
  const sun = new DirectionalLight("sun", new Vector3(-0.4, -1, 0.25), scene);
  sun.intensity = 1.5;
  sun.diffuse = color("#ffdca3");

  const ground = CreateGround("ground", { width: 100, height: 100, subdivisions: 2 }, scene);
  const groundMaterial = material(scene, "ground-material", color("#7d9b80"));
  const groundTexture = new Texture(
    `${import.meta.env.BASE_URL}assets/textures/neivara-ground.jpg`,
    scene,
  );
  groundTexture.uScale = 8;
  groundTexture.vScale = 8;
  groundMaterial.diffuseTexture = groundTexture;
  ground.material = groundMaterial;
  ground.metadata = { ground: true };

  const path = CreateGround("path", { width: 9, height: 72 }, scene);
  path.position.y = 0.015;
  path.rotation.y = -0.55;
  const pathMaterial = material(scene, "path-material", color("#9c9075"));
  const pathTexture = new Texture(
    `${import.meta.env.BASE_URL}assets/textures/neivara-stone-path.jpg`,
    scene,
  );
  pathTexture.uScale = 2;
  pathTexture.vScale = 14;
  pathMaterial.diffuseTexture = pathTexture;
  path.material = pathMaterial;
  path.isPickable = false;

  const sanctuary = CreateDisc("sanctuary", { radius: 9, tessellation: 48 }, scene);
  sanctuary.rotation.x = Math.PI / 2;
  sanctuary.position.y = 0.035;
  const sanctuaryMaterial = material(scene, "sanctuary-material", color("#65d8cc"), 0.28);
  sanctuaryMaterial.alpha = 0.12;
  sanctuary.material = sanctuaryMaterial;
  sanctuary.isPickable = false;

  const arena = CreateDisc("arena", { radius: 10, tessellation: 48 }, scene);
  arena.rotation.x = Math.PI / 2;
  arena.position.copyFromFloats(29, 0.04, 27);
  const arenaMaterial = material(scene, "arena-material", color("#a84e56"), 0.18);
  arenaMaterial.alpha = 0.22;
  arena.material = arenaMaterial;
  arena.isPickable = false;
  const arenaRing = CreateTorus(
    "arena-ring",
    { diameter: 20, thickness: 0.18, tessellation: 64 },
    scene,
  );
  arenaRing.position.copyFromFloats(29, 0.08, 27);
  arenaRing.material = material(scene, "arena-ring-material", color("#db7278"), 0.55);
  arenaRing.isPickable = false;

  const well = CreateCylinder(
    "wellspring",
    { diameter: 4.4, height: 0.8, tessellation: 32 },
    scene,
  );
  well.position.copyFromFloats(0, 0.38, -2.2);
  well.material = material(scene, "well-stone", color("#7c9182"));
  well.isPickable = false;
  const water = CreateDisc("well-water", { radius: 1.7, tessellation: 32 }, scene);
  water.rotation.x = Math.PI / 2;
  water.position.copyFromFloats(0, 0.82, -2.2);
  const waterMaterial = material(scene, "well-water-material", color("#4fe0d4"), 0.8);
  waterMaterial.alpha = 0.82;
  water.material = waterMaterial;
  water.isPickable = false;

  const treePositions: Array<[number, number, number]> = [
    [-40, -34, 1.2], [-35, -17, 1], [-42, 7, 1.4], [-28, 39, 1.1],
    [-8, 38, 1.35], [12, 39, 1], [39, 8, 1.35], [42, -16, 1.15],
    [31, -38, 1.25], [4, -41, 1.15], [-18, -39, 1], [24, 7, 0.9],
  ];
  for (const [x, z, scale] of treePositions) {
    const trunk = CreateCylinder(`trunk-${x}-${z}`, { diameter: 0.75, height: 4.5 }, scene);
    trunk.position.copyFromFloats(x, 2.2, z);
    trunk.scaling.scaleInPlace(scale);
    trunk.material = material(scene, `trunk-mat-${x}-${z}`, color("#594c3a"));
    trunk.isPickable = false;
    const crown = CreateSphere(`tree-${x}-${z}`, { diameter: 4.2, segments: 8 }, scene);
    crown.position.copyFromFloats(x, 5.1 * scale, z);
    crown.scaling.copyFromFloats(1.1 * scale, 0.85 * scale, scale);
    crown.material = material(scene, `tree-mat-${x}-${z}`, color("#3f7454"));
    crown.isPickable = false;
  }

  const stonePositions: Array<[number, number]> = [
    [-7, 3], [7, 4], [-4, 7], [5, -7], [-12, -1], [13, 1], [32, 17], [38, 31],
  ];
  for (const [index, position] of stonePositions.entries()) {
    const stone = CreatePolyhedron(`standing-stone-${index}`, { type: 2, size: 1.2 }, scene);
    stone.position.copyFromFloats(position[0], 1.1, position[1]);
    stone.scaling.y = 1.8;
    stone.material = material(scene, `stone-mat-${index}`, color("#82968a"));
    stone.isPickable = false;
  }

  return ground;
}

export function WorldCanvas({
  snapshot,
  selectedId,
  ownEquipment,
  inputBlocked,
  onSelect,
  onInput,
  onPickup,
}: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const sceneRef = useRef<Scene | null>(null);
  const cameraRef = useRef<ArcRotateCamera | null>(null);
  const visualsRef = useRef(new Map<string, EntityVisual>());
  const snapshotRef = useRef(snapshot);
  const selectedRef = useRef(selectedId);
  const ownEquipmentRef = useRef(ownEquipment);
  const inputBlockedRef = useRef(inputBlocked);
  const callbacksRef = useRef({ onSelect, onInput, onPickup });
  const keysRef = useRef(new Set<string>());
  const destinationRef = useRef<Vector3 | null>(null);
  const sequenceRef = useRef(0);
  const lastFacingRef = useRef(0);

  snapshotRef.current = snapshot;
  selectedRef.current = selectedId;
  ownEquipmentRef.current = ownEquipment;
  inputBlockedRef.current = inputBlocked;
  callbacksRef.current = { onSelect, onInput, onPickup };

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const engine = new Engine(canvas, true, { preserveDrawingBuffer: false, stencil: true }, true);
    if (window.devicePixelRatio > 1.5) engine.setHardwareScalingLevel(1.25);
    const scene = new Scene(engine);
    sceneRef.current = scene;
    const ground = buildEnvironment(scene);
    const camera = new ArcRotateCamera(
      "camera",
      -Math.PI / 2.3,
      1.02,
      18,
      new Vector3(0, 1.1, 0),
      scene,
    );
    camera.lowerRadiusLimit = 7;
    camera.upperRadiusLimit = 28;
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
        | { entityId?: string; entityType?: EntityVisual["entityType"]; ground?: boolean }
        | undefined;
      if (metadata?.entityId) {
        if (metadata.entityType === "loot") callbacksRef.current.onPickup(metadata.entityId);
        else callbacksRef.current.onSelect(metadata.entityId);
        destinationRef.current = null;
        return;
      }
      if (picked === ground || metadata?.ground) {
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
      for (const [id, visual] of visualsRef.current) {
        visual.root.position = Vector3.Lerp(visual.root.position, visual.target, visual.entityType === "player" ? 0.32 : 0.22);
        if (visual.entityType === "loot") visual.root.rotation.y += 0.025;
        visual.root.setEnabled(visual.entityType === "player" || visual.alive);
        if (id === selectedRef.current && visual.alive) {
          selection.setEnabled(true);
          selection.position.copyFrom(visual.root.position);
          selection.position.y = 0.08;
          selection.rotation.y += 0.035;
        }
      }
      if (!selectedRef.current) selection.setEnabled(false);
      if (selectedRef.current && !visualsRef.current.has(selectedRef.current)) selection.setEnabled(false);

      if (own) {
        camera.target = Vector3.Lerp(
          camera.target,
          new Vector3(own.position.x, 1.2, own.position.z),
          0.12,
        );
      }

      const now = performance.now();
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
      if (direction.lengthSquared() > 0.0001) {
        lastFacingRef.current = Math.atan2(direction.x, direction.z);
      }
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
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
      window.removeEventListener("blur", onBlur);
      window.removeEventListener("resize", onResize);
      visualsRef.current.clear();
      scene.dispose();
      engine.dispose();
      sceneRef.current = null;
      cameraRef.current = null;
    };
  }, []);

  useEffect(() => {
    const scene = sceneRef.current;
    if (!scene || !snapshot) return;
    const incoming = new Set<string>();
    const update = (
      entity: SnapshotEntity,
      entityType: EntityVisual["entityType"],
      create: () => EntityVisual,
      alive = true,
      nextEquipmentKey = "",
    ) => {
      incoming.add(entity.id);
      let visual = visualsRef.current.get(entity.id);
      if (visual && entityType === "player" && visual.equipmentKey !== nextEquipmentKey) {
        visual.root.dispose(false, true);
        visualsRef.current.delete(entity.id);
        visual = undefined;
      }
      if (!visual) {
        visual = create();
        visualsRef.current.set(entity.id, visual);
      }
      visual.target.copyFromFloats(entity.position.x, entity.position.y, entity.position.z);
      visual.alive = alive;
      if ("rotationY" in entity) visual.root.rotation.y = entity.rotationY;
      if (entityType === "player" && !alive) visual.root.scaling.copyFromFloats(1, 0.45, 1);
      else visual.root.scaling.copyFromFloats(1, 1, 1);
    };

    for (const player of snapshot.players) {
      const remoteEquipment = normalizeEquipment((player as unknown as { equipment?: unknown }).equipment);
      const loadout = player.id === snapshot.selfId
        ? { ...remoteEquipment, ...ownEquipmentRef.current }
        : remoteEquipment;
      const key = equipmentKey(loadout);
      update(player, "player", () => playerVisual(scene, player, loadout), player.alive, key);
    }
    for (const monster of snapshot.monsters) {
      update(monster, "monster", () => monsterVisual(scene, monster), monster.alive);
    }
    for (const loot of snapshot.loot) {
      update(loot, "loot", () => lootVisual(scene, loot));
    }
    for (const [id, visual] of visualsRef.current) {
      if (!incoming.has(id)) {
        visual.root.dispose(false, true);
        visualsRef.current.delete(id);
      }
    }
  }, [snapshot, ownEquipment]);

  return <canvas ref={canvasRef} className="world-canvas" aria-label="Трёхмерный мир Нейвары" />;
}
