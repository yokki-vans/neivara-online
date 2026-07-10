import { ArcRotateCamera } from "@babylonjs/core/Cameras/arcRotateCamera.js";
import "@babylonjs/core/Culling/ray.js";
import { Engine } from "@babylonjs/core/Engines/engine.js";
import { PointerEventTypes } from "@babylonjs/core/Events/pointerEvents.js";
import { DirectionalLight } from "@babylonjs/core/Lights/directionalLight.js";
import { HemisphericLight } from "@babylonjs/core/Lights/hemisphericLight.js";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial.js";
import { DynamicTexture } from "@babylonjs/core/Materials/Textures/dynamicTexture.js";
import { Color3, Color4 } from "@babylonjs/core/Maths/math.color.js";
import { Vector3 } from "@babylonjs/core/Maths/math.vector.js";
import { CreateCapsule } from "@babylonjs/core/Meshes/Builders/capsuleBuilder.js";
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
  onSelect: (id: string | null) => void;
  onInput: (input: MovementInput) => void;
  onPickup: (lootId: string) => void;
}

type SnapshotEntity = PlayerSnapshot | MonsterSnapshot | LootSnapshot;

interface EntityVisual {
  root: TransformNode;
  target: Vector3;
  entityType: "player" | "monster" | "loot";
  alive: boolean;
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

function playerVisual(scene: Scene, player: PlayerSnapshot): EntityVisual {
  const root = new TransformNode(`player-${player.id}`, scene);
  root.position.copyFromFloats(player.position.x, player.position.y, player.position.z);
  const race = getRace(player.race);
  const classInfo = getClass(player.classId);

  const body = CreateCapsule(`body-${player.id}`, { height: 1.9, radius: 0.42 }, scene);
  body.parent = root;
  body.position.y = 1.05;
  body.material = material(scene, `body-mat-${player.id}`, color(race.color));

  const mantle = CreateTorus(
    `mantle-${player.id}`,
    { diameter: 0.9, thickness: 0.12, tessellation: 18 },
    scene,
  );
  mantle.parent = root;
  mantle.position.y = 1.45;
  mantle.rotation.x = Math.PI / 2;
  mantle.material = material(scene, `class-mat-${player.id}`, color(classInfo.color), 0.25);

  const focus = CreatePolyhedron(
    `focus-${player.id}`,
    { type: 1, size: 0.23 },
    scene,
  );
  focus.parent = root;
  focus.position.y = 2.3;
  focus.material = material(scene, `focus-mat-${player.id}`, color(classInfo.color), 0.75);

  addNameplate(scene, root, `${player.name}  ·  ${player.level}`, race.accent, 2.8);
  markPickable(root, player.id, "player");
  return {
    root,
    target: new Vector3(player.position.x, player.position.y, player.position.z),
    entityType: "player",
    alive: player.alive,
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
  ground.material = material(scene, "ground-material", color("#315c49"));
  ground.metadata = { ground: true };

  const path = CreateGround("path", { width: 9, height: 72 }, scene);
  path.position.y = 0.015;
  path.rotation.y = -0.55;
  path.material = material(scene, "path-material", color("#7b6d50"));
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

export function WorldCanvas({ snapshot, selectedId, onSelect, onInput, onPickup }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const sceneRef = useRef<Scene | null>(null);
  const cameraRef = useRef<ArcRotateCamera | null>(null);
  const visualsRef = useRef(new Map<string, EntityVisual>());
  const snapshotRef = useRef(snapshot);
  const selectedRef = useRef(selectedId);
  const callbacksRef = useRef({ onSelect, onInput, onPickup });
  const keysRef = useRef(new Set<string>());
  const destinationRef = useRef<Vector3 | null>(null);
  const sequenceRef = useRef(0);
  const lastFacingRef = useRef(0);

  snapshotRef.current = snapshot;
  selectedRef.current = selectedId;
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
      const axisX = (keys.has("KeyD") ? 1 : 0) - (keys.has("KeyA") ? 1 : 0);
      const axisZ = (keys.has("KeyW") ? 1 : 0) - (keys.has("KeyS") ? 1 : 0);
      let direction = forward.scale(axisZ).add(right.scale(axisX));

      if (direction.lengthSquared() <= 0.0001 && destinationRef.current) {
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
        sprint: keys.has("ShiftLeft") || keys.has("ShiftRight"),
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
    ) => {
      incoming.add(entity.id);
      let visual = visualsRef.current.get(entity.id);
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
      update(player, "player", () => playerVisual(scene, player), player.alive);
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
  }, [snapshot]);

  return <canvas ref={canvasRef} className="world-canvas" aria-label="Трёхмерный мир Нейвары" />;
}
