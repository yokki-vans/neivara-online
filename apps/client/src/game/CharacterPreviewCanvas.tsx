import { ArcRotateCamera } from "@babylonjs/core/Cameras/arcRotateCamera.js";
import { Engine } from "@babylonjs/core/Engines/engine.js";
import { DirectionalLight } from "@babylonjs/core/Lights/directionalLight.js";
import { HemisphericLight } from "@babylonjs/core/Lights/hemisphericLight.js";
import { Color3, Color4 } from "@babylonjs/core/Maths/math.color.js";
import { Vector3 } from "@babylonjs/core/Maths/math.vector.js";
import { Scene } from "@babylonjs/core/scene.js";
import { getClass, getGender, getRace, type ClassId, type GenderId, type RaceId } from "@neivara/shared";
import { useEffect, useRef, useState } from "react";
import { characterPreviewLabel } from "../characterModels";
import { NeivaraModelLibrary, type LoadedModelInstance } from "./modelAssets";
import { PreviewLoadSequence } from "./previewLoadSequence";

interface Props {
  race: RaceId;
  gender: GenderId;
  classId: ClassId;
}

type PreviewState = "loading" | "ready" | "error";

interface PreviewRuntime {
  readonly engine: Engine;
  readonly scene: Scene;
  readonly camera: ArcRotateCamera;
  readonly modelLibrary: NeivaraModelLibrary;
  activeModel: LoadedModelInstance | null;
  disposed: boolean;
}

export function CharacterPreviewCanvas({ race, gender, classId }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const resetCameraRef = useRef<() => void>(() => undefined);
  const runtimeRef = useRef<PreviewRuntime | null>(null);
  const loadSequenceRef = useRef(new PreviewLoadSequence());
  const [previewState, setPreviewState] = useState<PreviewState>("loading");
  const [retryKey, setRetryKey] = useState(0);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const engine = new Engine(canvas, true, {
      adaptToDeviceRatio: true,
      preserveDrawingBuffer: false,
      stencil: true,
    });
    const scene = new Scene(engine);
    scene.clearColor = new Color4(0.018, 0.055, 0.058, 1);
    const modelLibrary = new NeivaraModelLibrary(scene);

    const camera = new ArcRotateCamera(
      "character-preview-camera",
      Math.PI / 2,
      1.22,
      3.6,
      new Vector3(0, 1.05, 0),
      scene,
    );
    camera.lowerRadiusLimit = 1.8;
    camera.upperRadiusLimit = 6;
    camera.lowerBetaLimit = 0.72;
    camera.upperBetaLimit = 1.48;
    camera.panningSensibility = 0;
    camera.wheelPrecision = 55;
    camera.attachControl(canvas, true);

    const skyLight = new HemisphericLight(
      "character-preview-fill",
      new Vector3(0.2, 1, 0.25),
      scene,
    );
    skyLight.intensity = 1.25;
    skyLight.diffuse = new Color3(0.72, 0.91, 0.86);
    skyLight.groundColor = new Color3(0.08, 0.12, 0.13);
    const keyLight = new DirectionalLight(
      "character-preview-key",
      new Vector3(-0.8, -1.2, 0.7),
      scene,
    );
    keyLight.intensity = 2.1;
    keyLight.diffuse = new Color3(1, 0.8, 0.58);

    const resetCamera = () => {
      camera.alpha = Math.PI / 2;
      camera.beta = 1.22;
      camera.radius = 3.6;
    };
    resetCameraRef.current = resetCamera;

    const runtime: PreviewRuntime = {
      engine,
      scene,
      camera,
      modelLibrary,
      activeModel: null,
      disposed: false,
    };
    runtimeRef.current = runtime;

    const resizeObserver = new ResizeObserver(() => engine.resize());
    resizeObserver.observe(canvas);
    engine.runRenderLoop(() => scene.render());

    return () => {
      runtime.disposed = true;
      loadSequenceRef.current.cancelAll();
      if (runtimeRef.current === runtime) runtimeRef.current = null;
      resizeObserver.disconnect();
      camera.detachControl();
      resetCameraRef.current = () => undefined;
      runtime.activeModel?.dispose();
      runtime.activeModel = null;
      modelLibrary.dispose();
      scene.dispose();
      engine.dispose();
    };
  }, []);

  useEffect(() => {
    const runtime = runtimeRef.current;
    if (!runtime) return;
    const sequence = loadSequenceRef.current;
    const ticket = sequence.begin();
    let candidate: LoadedModelInstance | null = null;
    setPreviewState("loading");

    const isCurrent = () =>
      !runtime.disposed && runtimeRef.current === runtime && sequence.isCurrent(ticket);

    const loadModel = async () => {
      try {
        candidate = await runtime.modelLibrary.spawnHumanoid(race, gender, classId, {
          name: `character-creation-preview-${ticket}`,
        });
        if (!isCurrent()) {
          candidate.dispose();
          candidate = null;
          return;
        }

        const root = candidate.root;
        if (root.getChildMeshes().every((mesh) => mesh.getTotalVertices() === 0)) {
          throw new Error("GLB не содержит отображаемой геометрии");
        }

        const bounds = root.getHierarchyBoundingVectors(true);
        const height = Math.max(0.5, bounds.max.y - bounds.min.y);
        const center = bounds.min.add(bounds.max).scale(0.5);
        runtime.camera.setTarget(new Vector3(center.x, bounds.min.y + height * 0.53, center.z));
        runtime.camera.radius = Math.min(5.4, Math.max(2.4, height * 1.42));
        runtime.camera.lowerRadiusLimit = Math.max(1.5, runtime.camera.radius * 0.62);
        runtime.camera.upperRadiusLimit = Math.max(4.5, runtime.camera.radius * 1.7);

        if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
          candidate.animations.stop();
        }

        const previous = runtime.activeModel;
        runtime.activeModel = candidate;
        candidate = null;
        previous?.dispose();
        setPreviewState("ready");
      } catch {
        candidate?.dispose();
        candidate = null;
        if (isCurrent()) setPreviewState("error");
      }
    };
    void loadModel();

    return () => {
      sequence.cancel(ticket);
    };
  }, [race, gender, classId, retryKey]);

  const raceInfo = getRace(race);
  const genderInfo = getGender(gender);
  const classInfo = getClass(classId);
  const label = characterPreviewLabel(race, gender, classId);

  return (
    <section className="character-preview" aria-label="Внешность создаваемого героя">
      <div className="character-preview-stage" aria-busy={previewState === "loading"}>
        <canvas
          ref={canvasRef}
          tabIndex={0}
          aria-label={label}
          aria-describedby="character-preview-instructions"
        />
        {previewState === "loading" && (
          <div className="character-preview-state loading" role="status" aria-live="polite">
            Загружаем трёхмерную модель…
          </div>
        )}
        {previewState === "error" && (
          <div className="character-preview-state error" role="alert">
            <strong>Модель не загрузилась</strong>
            <span>Проверьте подключение и повторите попытку.</span>
            <button type="button" onClick={() => setRetryKey((value) => value + 1)}>
              Повторить
            </button>
          </div>
        )}
        <div className="character-preview-controls" aria-hidden={previewState !== "ready"}>
          <span id="character-preview-instructions">
            Тяните для поворота · колесо для масштаба
          </span>
          <button type="button" onClick={() => resetCameraRef.current()} disabled={previewState !== "ready"}>
            Сбросить камеру
          </button>
        </div>
      </div>
      <div className="character-preview-caption" aria-live="polite">
        <span style={{ "--preview-color": raceInfo.color } as React.CSSProperties} />
        <div>
          <strong>{raceInfo.name}</strong>
          <small>{genderInfo.name} · {classInfo.name}</small>
        </div>
      </div>
    </section>
  );
}
