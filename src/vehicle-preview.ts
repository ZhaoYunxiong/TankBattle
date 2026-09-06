import { Engine } from '@babylonjs/core/Engines/engine';
import { Scene } from '@babylonjs/core/scene';
import { FreeCamera } from '@babylonjs/core/Cameras/freeCamera';
import { Vector3 } from '@babylonjs/core/Maths/math.vector';
import { Color3, Color4 } from '@babylonjs/core/Maths/math.color';
import { HemisphericLight } from '@babylonjs/core/Lights/hemisphericLight';
import { DirectionalLight } from '@babylonjs/core/Lights/directionalLight';
import { ShadowGenerator } from '@babylonjs/core/Lights/Shadows/shadowGenerator';
import { MeshBuilder } from '@babylonjs/core/Meshes/meshBuilder';
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial';
import { buildTankModel, type ModelKit, type TankVisual } from './game/tank-model';
import type { TankKind } from './game/vehicles';

export class VehiclePreview {
  private engine: Engine;

  private scene: Scene;

  private shadows: ShadowGenerator;

  private kit: ModelKit;

  private model?: TankVisual;

  private resize: ResizeObserver;

  private input = new AbortController();

  private pointer?: { id: number; x: number };

  private turned = false;

  constructor(private canvas: HTMLCanvasElement) {
    this.engine = new Engine(canvas, true, { preserveDrawingBuffer: true });
    this.engine.setHardwareScalingLevel(1 / Math.min(devicePixelRatio || 1, 1.5));
    this.scene = new Scene(this.engine);
    this.scene.clearColor = new Color4(0.88, 0.9, 0.83, 1);
    const camera = new FreeCamera('garage-camera', new Vector3(5, 3.7, 5), this.scene);
    camera.setTarget(new Vector3(0, 0.85, 0)); camera.fov = 0.58; camera.minZ = 0.1;
    const sky = new HemisphericLight('garage-sky', new Vector3(0, 1, 0), this.scene); sky.intensity = 0.6;
    const sun = new DirectionalLight('garage-sun', new Vector3(-0.5, -1, 0.4), this.scene); sun.position.set(6, 10, -5); sun.intensity = 0.55;
    this.shadows = new ShadowGenerator(512, sun); this.shadows.useBlurExponentialShadowMap = true; this.shadows.blurKernel = 8;
    const materials = new Map<string, StandardMaterial>();
    const material = (color: string, emissive = false) => {
      const key = color + emissive;
      if (!materials.has(key)) {
        const m = new StandardMaterial(key, this.scene); m.diffuseColor = Color3.FromHexString(color); m.specularColor.setAll(0.03);
        if (emissive) m.emissiveColor = m.diffuseColor.scale(0.6);
        materials.set(key, m);
      }
      return materials.get(key)!;
    };
    const box: ModelKit['box'] = (name, width, height, depth, color, parent) => {
      const mesh = MeshBuilder.CreateBox(name, { width, height, depth }, this.scene); mesh.material = material(color); mesh.parent = parent ?? null; mesh.receiveShadows = true; return mesh;
    };
    const cylinder: ModelKit['cylinder'] = (name, top, bottom, height, color, parent, sides = 6) => {
      const mesh = MeshBuilder.CreateCylinder(name, { diameterTop: top, diameterBottom: bottom, height, tessellation: sides }, this.scene); mesh.material = material(color); mesh.parent = parent ?? null; mesh.receiveShadows = true; return mesh;
    };
    this.kit = { scene: this.scene, material, box, cylinder };
    const ground = box('garage-ground', 100, 0.1, 100, '#e1e5d5'); ground.position.y = -0.32;
    const plinth = cylinder('garage-plinth', 4.5, 4.7, 0.3, '#d2d6c1', undefined, 8); plinth.position.y = -0.15;
    this.resize = new ResizeObserver(() => this.engine.resize()); this.resize.observe(canvas);
    const options = { signal: this.input.signal };
    canvas.addEventListener('pointerdown', e => { if (this.pointer) return; this.pointer = { id: e.pointerId, x: e.clientX }; this.turned = true; canvas.setPointerCapture(e.pointerId); }, options);
    canvas.addEventListener('pointermove', e => {
      if (this.pointer?.id !== e.pointerId || !this.model) return;
      this.model.root.rotation.y += (e.clientX - this.pointer.x) * 0.012; this.pointer.x = e.clientX;
    }, options);
    const release = (e: PointerEvent) => { if (this.pointer?.id === e.pointerId) this.pointer = undefined; };
    canvas.addEventListener('pointerup', release, options); canvas.addEventListener('pointercancel', release, options); canvas.addEventListener('lostpointercapture', release, options);
    this.engine.runRenderLoop(() => {
      if (this.model && !this.turned && !document.hidden) this.model.root.rotation.y += Math.min(this.engine.getDeltaTime(), 50) * 0.00013;
      this.scene.render();
    });
  }

  show(kind: TankKind) {
    if (this.model?.kind === kind) return;
    if (this.model) { for (const mesh of this.model.root.getChildMeshes()) this.shadows.removeShadowCaster(mesh); this.model.root.dispose(); }
    this.canvas.dataset.ready = 'false'; this.turned = false;
    this.model = buildTankModel({ id: 'garage-' + kind, kind, team: 'player', color: 0 }, this.kit);
    this.model.shield.setEnabled(false);
    for (const mesh of this.model.root.getChildMeshes()) this.shadows.addShadowCaster(mesh);
    this.model.root.rotation.y = -0.25;
    this.engine.resize();
    void this.scene.whenReadyAsync().then(() => { if (!this.scene.isDisposed && this.model?.kind === kind) this.canvas.dataset.ready = 'true'; });
  }

  dispose() {
    this.input.abort(); this.resize.disconnect(); this.engine.stopRenderLoop(); this.scene.dispose(); this.engine.dispose();
  }
}
