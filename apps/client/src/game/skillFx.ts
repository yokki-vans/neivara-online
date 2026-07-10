import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial.js";
import { Color3 } from "@babylonjs/core/Maths/math.color.js";
import { Vector3 } from "@babylonjs/core/Maths/math.vector.js";
import { CreatePolyhedron } from "@babylonjs/core/Meshes/Builders/polyhedronBuilder.js";
import { CreateSphere } from "@babylonjs/core/Meshes/Builders/sphereBuilder.js";
import { CreateTorus } from "@babylonjs/core/Meshes/Builders/torusBuilder.js";
import { Mesh } from "@babylonjs/core/Meshes/mesh.js";
import { TransformNode } from "@babylonjs/core/Meshes/transformNode.js";
import type { Scene } from "@babylonjs/core/scene.js";
import { resolveSkillVisual, type SkillFxStyle } from "../skills/skillVisuals";

export type SkillFxKind = "cast" | "projectile" | "impact" | "aura";

export interface SkillFxMotionProfile {
  durationMs: number;
  ringCount: number;
  shardCount: number;
  translateProjectile: boolean;
  rotate: boolean;
}

export interface PlaySkillFxOptions {
  scene: Scene;
  kind: SkillFxKind;
  abilityId: string;
  origin: Vector3;
  target?: Vector3;
  roleHint?: string;
  reducedMotion?: boolean;
  scale?: number;
}

export interface SkillFxHandle {
  readonly completed: Promise<void>;
  dispose(): void;
}

export type SkillFxPhaseOptions = Omit<PlaySkillFxOptions, "kind">;

const BASE_DURATION: Readonly<Record<SkillFxKind, number>> = {
  cast: 680,
  projectile: 520,
  impact: 460,
  aura: 1_250,
};

let effectSequence = 0;

export function prefersReducedSkillMotion(): boolean {
  return typeof window !== "undefined"
    && typeof window.matchMedia === "function"
    && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

export function getSkillFxMotionProfile(
  kind: SkillFxKind,
  reducedMotion: boolean,
): SkillFxMotionProfile {
  if (reducedMotion) {
    return {
      durationMs: kind === "aura" ? 420 : 220,
      ringCount: 1,
      shardCount: 0,
      translateProjectile: false,
      rotate: false,
    };
  }
  return {
    durationMs: BASE_DURATION[kind],
    ringCount: kind === "impact" ? 2 : 1,
    shardCount: kind === "aura" ? 5 : kind === "cast" || kind === "impact" ? 3 : 1,
    translateProjectile: kind === "projectile",
    rotate: true,
  };
}

function hex(value: string): Color3 {
  return Color3.FromHexString(value);
}

function fxMaterial(
  scene: Scene,
  name: string,
  color: string,
  alpha: number,
): StandardMaterial {
  const material = new StandardMaterial(name, scene);
  const tint = hex(color);
  material.diffuseColor = tint.scale(0.25);
  material.emissiveColor = tint;
  material.specularColor = Color3.Black();
  material.alpha = alpha;
  material.disableLighting = true;
  material.backFaceCulling = false;
  return material;
}

function easeOutCubic(value: number): number {
  return 1 - (1 - value) ** 3;
}

function easeInOut(value: number): number {
  return value < 0.5 ? 2 * value * value : 1 - ((-2 * value + 2) ** 2) / 2;
}

/**
 * Starts a self-disposing effect. Geometry is deliberately procedural and
 * texture-free so the effect remains original, lightweight, and usable with
 * any future rigged character or monster model.
 */
export function playSkillFx(options: PlaySkillFxOptions): SkillFxHandle {
  const {
    scene,
    kind,
    abilityId,
    origin,
    target = origin,
    roleHint = "",
    reducedMotion = prefersReducedSkillMotion(),
    scale = 1,
  } = options;
  const visual = resolveSkillVisual(abilityId, roleHint);
  const profile = getSkillFxMotionProfile(kind, reducedMotion);
  const id = `${abilityId}-${kind}-${effectSequence += 1}`;
  const root = new TransformNode(`skill-fx-${id}`, scene);
  root.position.copyFrom(profile.translateProjectile ? origin : kind === "projectile" ? target : origin);
  root.scaling.setAll(scale);

  const meshes: Mesh[] = [];
  const materials: StandardMaterial[] = [];
  const addMaterial = (name: string, color: string, alpha: number) => {
    const value = fxMaterial(scene, `${name}-${id}`, color, alpha);
    materials.push(value);
    return value;
  };

  for (let index = 0; index < profile.ringCount; index += 1) {
    const ring = CreateTorus(
      `skill-ring-${index}-${id}`,
      { diameter: 1.45 + index * 0.45, thickness: 0.055 + index * 0.018, tessellation: 32 },
      scene,
    );
    ring.parent = root;
    ring.rotation.x = Math.PI / 2;
    ring.position.y = kind === "cast" || kind === "aura" ? 0.08 : 0.65;
    ring.material = addMaterial(`skill-ring-material-${index}`, index === 0 ? visual.glow : visual.primary, 0.86);
    ring.isPickable = false;
    meshes.push(ring);
  }

  const core = CreateSphere(
    `skill-core-${id}`,
    { diameter: kind === "projectile" ? 0.32 : 0.5, segments: 12 },
    scene,
  );
  core.parent = root;
  core.position.y = kind === "cast" || kind === "aura" ? 0.62 : 0.68;
  core.material = addMaterial("skill-core-material", visual.primary, 0.92);
  core.isPickable = false;
  meshes.push(core);

  for (let index = 0; index < profile.shardCount; index += 1) {
    const shard = CreatePolyhedron(
      `skill-shard-${index}-${id}`,
      { type: 1, size: 0.12 },
      scene,
    );
    const angle = (index / Math.max(1, profile.shardCount)) * Math.PI * 2;
    shard.parent = root;
    shard.position.copyFromFloats(Math.cos(angle) * 0.52, 0.4 + (index % 2) * 0.28, Math.sin(angle) * 0.52);
    shard.scaling.y = 1.7;
    shard.rotation.z = angle;
    shard.material = addMaterial(`skill-shard-material-${index}`, index % 2 === 0 ? visual.primary : visual.glow, 0.82);
    shard.isPickable = false;
    meshes.push(shard);
  }

  let elapsed = 0;
  let settled = false;
  let resolveCompleted: () => void = () => undefined;
  const completed = new Promise<void>((resolve) => { resolveCompleted = resolve; });

  const dispose = () => {
    if (settled) return;
    settled = true;
    scene.onBeforeRenderObservable.remove(observer);
    for (const mesh of meshes) mesh.dispose(false, false);
    for (const material of materials) material.dispose();
    root.dispose();
    resolveCompleted();
  };

  const tick = () => {
    elapsed += Math.min(scene.getEngine().getDeltaTime(), 50);
    const progress = Math.min(1, elapsed / profile.durationMs);
    const eased = easeOutCubic(progress);
    const pulse = 0.9 + Math.sin(progress * Math.PI) * 0.32;

    if (profile.translateProjectile) {
      root.position.copyFrom(Vector3.Lerp(origin, target, easeInOut(progress)));
      root.position.y += Math.sin(progress * Math.PI) * 0.35;
    }
    if (profile.rotate) root.rotation.y += 0.045;

    if (kind === "cast") root.scaling.setAll(scale * (0.58 + eased * 0.66));
    else if (kind === "impact") root.scaling.setAll(scale * (0.5 + eased * 1.18));
    else if (kind === "aura") root.scaling.setAll(scale * pulse);
    else root.scaling.setAll(scale * (0.85 + pulse * 0.16));

    const fade = kind === "aura"
      ? Math.min(1, progress * 5) * Math.min(1, (1 - progress) * 5)
      : Math.min(1, (1 - progress) * 2.4);
    for (const material of materials) material.alpha = Math.max(0, fade * 0.9);
    if (progress >= 1) dispose();
  };

  const observer = scene.onBeforeRenderObservable.add(tick);
  return { completed, dispose };
}

export function skillFxPalette(abilityId: string, roleHint = ""): {
  style: SkillFxStyle;
  primary: string;
  glow: string;
} {
  const visual = resolveSkillVisual(abilityId, roleHint);
  return { style: visual.fxStyle, primary: visual.primary, glow: visual.glow };
}

export function playSkillCastFx(options: SkillFxPhaseOptions): SkillFxHandle {
  return playSkillFx({ ...options, kind: "cast" });
}

export function playSkillProjectileFx(
  options: SkillFxPhaseOptions & { target: Vector3 },
): SkillFxHandle {
  return playSkillFx({ ...options, kind: "projectile" });
}

export function playSkillImpactFx(options: SkillFxPhaseOptions): SkillFxHandle {
  return playSkillFx({ ...options, kind: "impact" });
}

export function playSkillAuraFx(options: SkillFxPhaseOptions): SkillFxHandle {
  return playSkillFx({ ...options, kind: "aura" });
}
