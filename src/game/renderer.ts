import { Color3, Color4 } from '@babylonjs/core/Maths/math.color';
import { Matrix, Vector3 } from '@babylonjs/core/Maths/math.vector';
import { DirectionalLight } from '@babylonjs/core/Lights/directionalLight';
import { HemisphericLight } from '@babylonjs/core/Lights/hemisphericLight';
import { Engine } from '@babylonjs/core/Engines/engine';
import { FreeCamera } from '@babylonjs/core/Cameras/freeCamera';
import { Mesh } from '@babylonjs/core/Meshes/mesh';
import { MeshBuilder } from '@babylonjs/core/Meshes/meshBuilder';
import { Scene } from '@babylonjs/core/scene';
import { ShadowGenerator } from '@babylonjs/core/Lights/Shadows/shadowGenerator';
import '@babylonjs/core/Lights/Shadows/shadowGeneratorSceneComponent';
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial';
import { TransformNode } from '@babylonjs/core/Meshes/transformNode';
import { VertexBuffer } from '@babylonjs/core/Buffers/buffer';
import { angleDiff, BASE, clamp, COLORS, distance, groundHeight, type BattleEvent, type Obstacle, type State, type Tank } from './types';
import { seededRandom, segmentCircle } from './world';
import { BattleAudio } from './audio';

type TankVisual = { root: TransformNode; turret: TransformNode; barrel: Mesh; body: Mesh; shield: Mesh };

type Particle = { mesh: Mesh; vx: number; vy: number; vz: number; life: number; max: number; grow: number };

export class BattleRenderer {
  readonly engine: Engine;

  readonly scene: Scene;

  readonly camera: FreeCamera;

  readonly audio = new BattleAudio();

  yaw = Math.PI;

  pitch = 0.48;

  zoom = 11.5;

  shakeEnabled = true;

  private shadows: ShadowGenerator;

  private materials = new Map<string, StandardMaterial>();

  private terrain: TransformNode;

  private tankVisuals = new Map<string, TankVisual>();

  private obstacles = new Map<number, TransformNode>();

  private shells = new Map<number, Mesh>();

  private drops = new Map<number, TransformNode>();

  private particles: Particle[] = [];

  private seenEvent = 0;

  private seed = -1;

  private shake = 0;

  private smokeClock = 0;

  private elapsed = 0;

  private baseCore: Mesh;

  private baseBeacon: Mesh;

  private lowQuality = false;

  constructor(readonly canvas: HTMLCanvasElement) {
    this.engine = new Engine(canvas, true, { stencil: true, powerPreference: 'high-performance' });
    this.scene = new Scene(this.engine);
    this.scene.clearColor = new Color4(0.84, 0.87, 0.83, 1);
    this.scene.ambientColor = Color3.FromHexString('#d6ddcf');
    this.scene.fogMode = Scene.FOGMODE_LINEAR;
    this.scene.fogColor = Color3.FromHexString('#d6dfd8');
    this.scene.fogStart = 40;
    this.scene.fogEnd = 105;
    this.camera = new FreeCamera('camera', new Vector3(18, 25, 36), this.scene);
    this.camera.minZ = 0.15;
    this.camera.maxZ = 180;
    this.camera.fov = 0.85;
    this.camera.setTarget(Vector3.Zero());
    const ambient = new HemisphericLight('sky', new Vector3(0, 1, 0), this.scene);
    ambient.intensity = 0.55;
    ambient.groundColor = Color3.FromHexString('#999786');
    const sun = new DirectionalLight('sun', new Vector3(-0.5, -1, 0.42), this.scene);
    sun.position = new Vector3(25, 45, -20);
    sun.intensity = 0.75;
    sun.diffuse = Color3.FromHexString('#fff0cf');
    this.shadows = new ShadowGenerator(1024, sun);
    this.shadows.usePercentageCloserFiltering = true;
    this.shadows.bias = 0.003;
    this.shadows.normalBias = 0.12;
    this.shadows.darkness = 0.3;
    this.terrain = new TransformNode('landscape', this.scene);
    this.baseCore = this.box('camp', 3.7, 2.2, 3.7, '#e9d9b7', this.terrain);
    this.baseBeacon = this.box('beacon', 1, 1, 1, '#b7e8d8', this.terrain);
    this.setQuality('auto');
    window.addEventListener('resize', () => this.engine.resize());
  }

  private material(color: string, emissive = false) {
    const key = color + emissive;
    if (!this.materials.has(key)) {
      const m = new StandardMaterial(key, this.scene);
      m.diffuseColor = Color3.FromHexString(color);
      m.specularColor = new Color3(0.035, 0.035, 0.035);
      if (emissive) m.emissiveColor = Color3.FromHexString(color).scale(0.65);
      this.materials.set(key, m);
    }
    return this.materials.get(key)!;
  }

  private box(name: string, width: number, height: number, depth: number, color: string, parent?: TransformNode) {
    const mesh = MeshBuilder.CreateBox(name, { width, height, depth }, this.scene);
    mesh.material = this.material(color);
    if (parent) mesh.parent = parent;
    mesh.receiveShadows = true;
    return mesh;
  }

  private cylinder(name: string, top: number, bottom: number, height: number, color: string, parent?: TransformNode, sides = 6) {
    const mesh = MeshBuilder.CreateCylinder(name, { diameterTop: top, diameterBottom: bottom, height, tessellation: sides }, this.scene);
    mesh.material = this.material(color);
    if (parent) mesh.parent = parent;
    mesh.receiveShadows = true;
    return mesh;
  }

  setQuality(level: string) {
    this.lowQuality = level === 'low';
    const cap = level === 'high' ? 2 : level === 'low' ? 1 : matchMedia('(pointer: coarse)').matches ? 1.25 : 1.5;
    this.engine.setHardwareScalingLevel(1 / Math.min(window.devicePixelRatio || 1, cap));
    this.shadows.getShadowMap()?.resize(this.lowQuality ? 512 : 1024);
    this.engine.resize();
  }

  private buildLandscape(state: State) {
    this.terrain.dispose();
    this.terrain = new TransformNode('landscape', this.scene);
    this.obstacles.clear();
    this.seed = state.seed;
    this.seenEvent = state.events.at(-1)?.id ?? 0;
    for (const p of this.particles) p.mesh.dispose();
    this.particles = [];
    const random = seededRandom(state.seed + 42);
    const floor = MeshBuilder.CreateGround('valley', { width: 60, height: 72, subdivisions: 48, updatable: true }, this.scene);
    const positions = floor.getVerticesData(VertexBuffer.PositionKind)!;
    for (let i = 0; i < positions.length; i += 3) positions[i + 1] = groundHeight(positions[i], positions[i + 2]);
    floor.updateVerticesData(VertexBuffer.PositionKind, positions);
    floor.material = this.material('#b7bc9c');
    floor.parent = this.terrain;
    floor.receiveShadows = true;
    const base = this.box('island-foundation', 60, 3, 72, '#baa990', this.terrain);
    base.position.y = -1.8;
    // 地面路径跟随高度，避免在坡面上出现悬浮或深度闪烁。
    const path = MeshBuilder.CreateGround('sand-path', { width: 5, height: 61, subdivisions: 35, updatable: true }, this.scene);
    const pv = path.getVerticesData(VertexBuffer.PositionKind)!;
    for (let i = 0; i < pv.length; i += 3) pv[i + 1] = groundHeight(pv[i], pv[i + 2]) + 0.025;
    path.updateVerticesData(VertexBuffer.PositionKind, pv);
    path.material = this.material('#d4c8a9');
    path.parent = this.terrain;
    path.receiveShadows = true;
    for (let i = 0; i < 46; i++) {
      const side = i % 2 ? -1 : 1;
      const x = side * (30 + random() * 7);
      const z = -36 + Math.floor(i / 2) * 3.4;
      const h = 5 + random() * 10;
      const peak = this.cylinder('mountain', 0.5 + random(), 9 + random() * 7, h, ['#9fae9e', '#bdc1a8', '#c6b7a3'][i % 3], this.terrain, 5);
      peak.position.set(x, h * 0.5 - 1, z);
      peak.rotation.y = random() * 6;
      this.shadows.addShadowCaster(peak);
      if (i % 3 === 0) {
        const cap = this.cylinder('summit', 0.1, 2.5, 2.1, '#e2ddc9', this.terrain, 5);
        cap.position.set(x, h - 1, z);
      }
    }
    for (let i = 0; i < 12; i++) {
      const m = this.cylinder('far-ridge', 0, 12, 8 + random() * 8, '#a7b9b0', this.terrain, 5);
      m.position.set(-39 + i * 7, 3, -40 - random() * 10);
    }
    for (let i = 0; i < 100; i++) {
      const x = (random() - 0.5) * 53;
      const z = (random() - 0.5) * 62;
      if (Math.abs(x) < 3 || distance({ x, z }, BASE) < 7) continue;
      const grass = this.cylinder('grass', 0.08, 0.5, 0.25 + random() * 0.2, i % 3 ? '#9da989' : '#d9ca9e', this.terrain, 4);
      grass.position.set(x, groundHeight(x, z) + 0.1, z);
      grass.rotation.y = random() * 6;
    }
    for (const obstacle of state.obstacles) this.buildObstacle(obstacle);
    const plinth = this.cylinder('camp-platform', 7.3, 7.6, 0.35, '#d7cbb0', this.terrain, 8);
    plinth.position.set(BASE.x, 0.07, BASE.z);
    this.baseCore = this.box('camp', 3.6, 2, 3.6, '#e6d9bc', this.terrain);
    this.baseCore.position.set(BASE.x, 1.1, BASE.z);
    const roof = this.cylinder('camp-roof', 2.8, 5, 0.8, '#6f8e81', this.terrain, 4);
    roof.rotation.y = Math.PI / 4;
    roof.position.set(BASE.x, 2.5, BASE.z);
    const door = this.box('camp-door', 0.8, 1.35, 0.05, '#6c7567', this.terrain);
    door.position.set(0, 0.8, BASE.z - 1.82);
    const pole = this.cylinder('flag-pole', 0.08, 0.08, 3, '#565f54', this.terrain);
    pole.position.set(2.9, 1.5, BASE.z);
    const flag = this.box('flag', 1.3, 0.75, 0.04, '#e5ae75', this.terrain);
    flag.position.set(3.5, 2.7, BASE.z);
    this.baseBeacon = this.cylinder('beacon', 0.7, 0.7, 0.8, '#a7ddcb', this.terrain, 4);
    this.baseBeacon.material = this.material('#b1ead4', true);
    this.baseBeacon.position.set(0, 3.6, BASE.z);
    this.baseBeacon.rotation.z = Math.PI / 4;
    this.shadows.addShadowCaster(this.baseCore);
    this.shadows.addShadowCaster(roof);
  }

  private buildObstacle(o: Obstacle) {
    const root = new TransformNode('obstacle-' + o.id, this.scene);
    root.parent = this.terrain;
    root.position.set(o.x, groundHeight(o.x, o.z), o.z);
    if (o.kind === 'tree') {
      const trunk = this.cylinder('trunk', 0.24, 0.42, 1.2, '#8c7860', root);
      trunk.position.y = 0.6;
      const foliage = this.cylinder('tree-crown', 0.1, 2.5, o.height - 0.5, o.id % 3 ? '#668779' : '#829884', root, 5);
      foliage.position.y = o.height / 2 + 0.65;
      const top = this.cylinder('tree-top', 0, 1.9, o.height * 0.65, '#88a18a', root, 5);
      top.position.y = o.height * 0.78;
      root.rotation.y = o.rotation;
    } else if (o.kind === 'rock') {
      const body = this.cylinder('rock', o.radius * 0.85, o.radius * 2.2, o.height, o.id % 2 ? '#c4bda6' : '#a9b4a1', root, 5);
      body.position.y = o.height / 2;
      const cap = this.cylinder('moss', o.radius * 0.65, o.radius * 0.95, 0.15, '#bec4a3', root, 5);
      cap.position.y = o.height + 0.02;
      root.rotation.y = o.rotation;
    } else {
      const wall = this.box('wall', 2, 1.45, 1.65, '#d7c9ad', root);
      wall.position.y = 0.72;
      for (const x of [-0.66, 0.66]) {
        const merlon = this.box('merlon', 0.58, 0.45, 1.7, '#e4d9bf', root);
        merlon.position.set(x, 1.58, 0);
      }
      if (Math.abs(o.x) > 5) root.rotation.y = Math.PI / 2;
    }
    for (const mesh of root.getChildMeshes()) this.shadows.addShadowCaster(mesh);
    root.setEnabled(o.hp > 0);
    this.obstacles.set(o.id, root);
  }

  private buildTank(t: Tank): TankVisual {
    const root = new TransformNode(t.id, this.scene);
    const color = t.team === 'player' ? COLORS[t.color % 4] : t.kind === 'heavy' ? '#ad6e5d' : t.kind === 'scout' ? '#bf8964' : '#bd7967';
    const body = this.box('hull', 1.65, 0.52, 2.15, color, root);
    body.position.y = 0.56;
    const deck = this.box('deck', 1.4, 0.2, 1.8, color, root);
    deck.position.y = 0.86;
    for (const side of [-1, 1]) {
      const tread = this.box('track', 0.42, 0.52, 2.35, '#50594e', root);
      tread.position.set(side * 0.91, 0.36, 0);
      for (let i = -1; i <= 1; i++) {
        const wheel = this.cylinder('wheel', 0.4, 0.4, 0.45, '#76806b', root, 8);
        wheel.rotation.z = Math.PI / 2;
        wheel.position.set(side * 0.92, 0.35, i * 0.7);
      }
      const strip = this.box('track-guard', 0.5, 0.12, 2.25, color, root);
      strip.position.set(side * 0.91, 0.71, 0);
      const light = this.box('headlight', 0.18, 0.14, 0.08, '#f2dda9', root);
      light.material = this.material('#f3d9a5', true);
      light.position.set(side * 0.61, 0.65, 1.1);
    }
    const turret = new TransformNode('turret', this.scene);
    turret.parent = root;
    turret.position.y = 0.91;
    const top = this.cylinder('turret-armor', 0.9, 1.35, 0.52, color, turret, 6);
    top.position.y = 0.2;
    const hatch = this.cylinder('hatch', 0.5, 0.5, 0.09, '#d3cfaf', turret);
    hatch.position.set(-0.08, 0.51, -0.12);
    const barrel = this.cylinder('barrel', 0.18, 0.26, 1.65, color, turret);
    barrel.rotation.x = Math.PI / 2;
    barrel.position.set(0, 0.22, 1.13);
    const muzzle = this.cylinder('muzzle', 0.28, 0.28, 0.25, '#465a4e', turret);
    muzzle.rotation.x = Math.PI / 2;
    muzzle.position.set(0, 0.22, 1.94);
    const stripe = this.box('stripe', 0.13, 0.018, 0.6, '#f2e5c8', root);
    stripe.position.set(0.45, 0.973, -0.55);
    const antenna = this.cylinder('antenna', 0.025, 0.035, 0.75, '#4b594c', turret);
    antenna.position.set(0.4, 0.85, -0.4);
    const shield = MeshBuilder.CreateTorus('shield', { diameter: 2.75, thickness: 0.07, tessellation: 24 }, this.scene);
    shield.material = this.material('#b1e5d4', true);
    shield.parent = root;
    shield.position.y = 0.11;
    for (const mesh of root.getChildMeshes()) this.shadows.addShadowCaster(mesh);
    if (t.kind === 'heavy') root.scaling.setAll(1.12);
    return { root, turret, barrel, body, shield };
  }

  private particle(x: number, y: number, z: number, color: string, smoke = false, force = 1) {
    if (this.particles.length >= (this.lowQuality ? 65 : 150)) return;
    const m = smoke
      ? MeshBuilder.CreateIcoSphere('smoke', { radius: 0.3, subdivisions: 1, flat: true }, this.scene)
      : MeshBuilder.CreateBox('debris', { size: 0.12 + Math.random() * 0.14 }, this.scene);
    m.material = this.material(color, !smoke && color === '#f5bc75');
    m.position.set(x, y, z);
    m.rotation.set(Math.random() * 6, Math.random() * 6, Math.random() * 6);
    const life = smoke ? 1.6 : 0.65;
    this.particles.push({
      mesh: m, vx: (Math.random() - 0.5) * (smoke ? 0.6 : 7 * force),
      vy: smoke ? 1 + Math.random() : 2 + Math.random() * 4 * force,
      vz: (Math.random() - 0.5) * (smoke ? 0.6 : 7 * force), life, max: life, grow: smoke ? 1.3 : 0,
    });
  }

  private handleEvent(event: BattleEvent, local?: Tank) {
    const d = local ? distance(event, local) : 25;
    const falloff = clamp(1 - d / 35, 0, 1);
    this.audio.play(event.kind, falloff);
    if (event.kind === 'destroy') {
      this.shake = Math.min(0.7, this.shake + event.size * 0.2 * falloff);
      for (let i = 0; i < (this.lowQuality ? 10 : 22); i++) this.particle(event.x, groundHeight(event.x, event.z) + 1, event.z, i % 3 ? '#a59b84' : '#f5bc75', false, event.size);
      for (let i = 0; i < 5; i++) this.particle(event.x, 1, event.z, '#9b9e90', true);
    } else if (event.kind === 'shot') {
      const tank = this.tankVisuals.get(event.owner ?? '');
      if (tank) {
        tank.barrel.position.z = 0.92;
        const muzzle = tank.turret.getAbsolutePosition();
        const angle = tank.root.rotation.y + tank.turret.rotation.y;
        for (let i = 0; i < 4; i++) this.particle(muzzle.x + Math.sin(angle) * 2, muzzle.y + 0.2, muzzle.z + Math.cos(angle) * 2, '#f5bc75');
      }
      if (event.owner === local?.id) this.shake = Math.min(0.25, this.shake + 0.1);
    } else if (event.kind === 'hit') {
      this.shake = Math.min(0.4, this.shake + 0.08 * falloff);
      for (let i = 0; i < 4; i++) this.particle(event.x, groundHeight(event.x, event.z) + 0.7, event.z, '#edc788');
    } else if (event.kind === 'pickup') {
      for (let i = 0; i < 8; i++) this.particle(event.x, 1, event.z, '#b5ddbc');
    }
  }

  render(state: State, localId: string, dt: number, menu: boolean) {
    this.elapsed += dt;
    if (this.seed !== state.seed) this.buildLandscape(state);
    const lerp = 1 - Math.exp(-dt * 20);
    for (const o of state.obstacles) {
      const mesh = this.obstacles.get(o.id);
      if (mesh) {
        mesh.setEnabled(o.hp > 0);
        mesh.scaling.y = o.hp > 0 ? 0.92 + o.hp / o.maxHp * 0.08 : 1;
      }
    }
    for (const t of state.tanks) {
      let visual = this.tankVisuals.get(t.id);
      if (!visual) {
        visual = this.buildTank(t);
        visual.root.position.set(t.x, groundHeight(t.x, t.z), t.z);
        visual.root.rotation.y = t.angle;
        this.tankVisuals.set(t.id, visual);
      }
      visual.root.setEnabled(t.hp > 0 && t.connected);
      visual.root.position.x += (t.x - visual.root.position.x) * lerp;
      visual.root.position.z += (t.z - visual.root.position.z) * lerp;
      visual.root.position.y = groundHeight(visual.root.position.x, visual.root.position.z);
      visual.root.rotation.y += angleDiff(t.angle, visual.root.rotation.y) * lerp;
      visual.turret.rotation.y += angleDiff(t.turret - visual.root.rotation.y, visual.turret.rotation.y) * lerp;
      visual.barrel.position.z += (1.13 - visual.barrel.position.z) * Math.min(1, dt * 12);
      visual.shield.setEnabled(t.shield > 0 || t.buffs.armor > 0);
      visual.shield.visibility = 0.65 + Math.sin(this.elapsed * 6) * 0.25;
    }
    for (const [id, visual] of this.tankVisuals) {
      if (!state.tanks.some(t => t.id === id)) { visual.root.dispose(); this.tankVisuals.delete(id); }
    }
    for (const s of state.shells) {
      let mesh = this.shells.get(s.id);
      if (!mesh) {
        mesh = this.box('shell', 0.12, 0.12, 0.85, '#ffe1a2');
        mesh.material = this.material('#ffdc92', true);
        this.shells.set(s.id, mesh);
      }
      mesh.position.set(s.x, groundHeight(s.x, s.z) + 1.08, s.z);
      mesh.rotation.y = Math.atan2(s.vx, s.vz);
    }
    for (const [id, mesh] of this.shells) if (!state.shells.some(s => s.id === id)) { mesh.dispose(); this.shells.delete(id); }
    const dropColors = { heal: '#a2d7b2', rapid: '#e5c077', burst: '#c9957d', armor: '#8ebcce' };
    for (const d of state.drops) {
      let root = this.drops.get(d.id);
      if (!root) {
        root = new TransformNode('drop-' + d.id, this.scene);
        const bottom = this.cylinder('drop-ring', 1.6, 1.6, 0.05, dropColors[d.kind], root, 16);
        bottom.material = this.material(dropColors[d.kind], true);
        const cube = this.box('supply', 0.75, 0.75, 0.75, dropColors[d.kind], root);
        cube.position.y = 0.85;
        const band = this.box('supply-mark', 0.16, 0.8, 0.8, '#f3edda', root);
        band.position.y = 0.85;
        if (d.kind === 'heal') {
          const cross = this.box('repair-cross', 0.6, 0.16, 0.81, '#f3edda', root);
          cross.position.y = 0.85;
        }
        this.drops.set(d.id, root);
      }
      root.position.set(d.x, groundHeight(d.x, d.z) + 0.18 + Math.sin(this.elapsed * 2.5 + d.id) * 0.15, d.z);
      root.rotation.y += dt * 0.65;
      root.setEnabled(d.life > 5 || Math.sin(this.elapsed * 8) > -0.4);
    }
    for (const [id, root] of this.drops) if (!state.drops.some(d => d.id === id)) { root.dispose(); this.drops.delete(id); }
    const local = state.tanks.find(t => t.id === localId);
    if (!menu) for (const event of state.events) if (event.id > this.seenEvent) this.handleEvent(event, local);
    if (state.events.length) this.seenEvent = state.events[state.events.length - 1].id;
    this.smokeClock += dt;
    if (this.smokeClock > 0.18) {
      this.smokeClock = 0;
      for (const t of state.tanks) if (t.hp > 0 && t.hp / t.maxHp < 0.6) {
        this.particle(t.x, groundHeight(t.x, t.z) + 1, t.z, t.hp / t.maxHp < 0.3 ? '#66726a' : '#a5aa99', true);
      }
      if (state.baseHp / state.baseMaxHp < 0.5) this.particle(BASE.x, 2.2, BASE.z, '#899184', true);
    }
    for (const p of this.particles) {
      p.life -= dt;
      p.mesh.position.addInPlaceFromFloats(p.vx * dt, p.vy * dt, p.vz * dt);
      if (!p.grow) p.vy -= dt * 12;
      else p.mesh.scaling.addInPlaceFromFloats(dt * p.grow, dt * p.grow, dt * p.grow);
      p.mesh.visibility = clamp(p.life / p.max, 0, 1) * (p.grow ? 0.65 : 1);
      if (p.life <= 0) p.mesh.dispose();
    }
    this.particles = this.particles.filter(p => p.life > 0);
    this.baseCore.scaling.y = state.baseHp > 0 ? 1 : 0.2;
    this.baseBeacon.rotation.y += dt * 0.7;
    this.baseBeacon.setEnabled(state.baseHp > 0);
    this.shake = Math.max(0, this.shake - dt * 1.3);
    if (menu) {
      const a = 0.42 + Math.sin(this.elapsed * 0.045) * 0.15;
      this.camera.position.set(Math.sin(a) * 42, 29, Math.cos(a) * 42);
      this.camera.setTarget(new Vector3(-3, 0, 0));
      this.camera.fov = 0.86;
    } else {
      const focus = this.tankVisuals.get(localId)?.root.position ?? new Vector3(BASE.x, 0, BASE.z - 7);
      const portrait = this.engine.getRenderWidth() < this.engine.getRenderHeight();
      const r = this.zoom * (portrait ? 1.18 : 1);
      const target = new Vector3(focus.x + Math.sin(this.yaw) * 3, focus.y + 0.85, focus.z + Math.cos(this.yaw) * 3);
      let actualR = r;
      // 镜头沿坦克到相机的线段收缩，山壁和围墙不会穿过相机。
      const cx = focus.x - Math.sin(this.yaw) * Math.cos(this.pitch) * r;
      const cz = focus.z - Math.cos(this.yaw) * Math.cos(this.pitch) * r;
      for (const o of state.obstacles) {
        if (o.hp <= 0 || o.kind === 'tree') continue;
        const at = segmentCircle(focus.x, focus.z, cx, cz, o.x, o.z, o.radius + 0.4);
        // 使用镜头射线的实际起始高度，避免出生点低围墙把手机镜头错误推到车身上。
        const rayHeight = at === null ? Infinity : focus.y + 0.85 + (0.35 + Math.sin(this.pitch) * r) * at;
        if (at !== null && at > 0.1 && rayHeight < groundHeight(o.x, o.z) + o.height + 0.35) actualR = Math.min(actualR, Math.max(4.5, r * at - 0.6));
      }
      const desired = new Vector3(focus.x - Math.sin(this.yaw) * Math.cos(this.pitch) * actualR, focus.y + 1.2 + Math.sin(this.pitch) * actualR, focus.z - Math.cos(this.yaw) * Math.cos(this.pitch) * actualR);
      Vector3.LerpToRef(this.camera.position, desired, Math.min(1, dt * 12), this.camera.position);
      this.camera.setTarget(target);
      this.camera.fov = portrait ? 1.04 : 0.85;
      if (this.shakeEnabled) {
        this.camera.position.x += (Math.random() - 0.5) * this.shake;
        this.camera.position.y += (Math.random() - 0.5) * this.shake;
      }
      // 只淡化确实位于镜头和坦克之间的树冠。
      for (const o of state.obstacles) if (o.kind === 'tree') {
        const at = segmentCircle(this.camera.position.x, this.camera.position.z, focus.x, focus.z, o.x, o.z, 1.5);
        for (const mesh of this.obstacles.get(o.id)?.getChildMeshes() ?? []) mesh.visibility = at !== null ? 0.25 : 1;
      }
    }
    this.scene.render();
  }

  project(x: number, y: number, z: number) {
    const projected = Vector3.Project(new Vector3(x, y, z), Matrix.IdentityReadOnly, this.scene.getTransformMatrix(), this.camera.viewport.toGlobal(this.canvas.clientWidth, this.canvas.clientHeight));
    return { x: projected.x, y: projected.y, visible: projected.z > 0 && projected.z < 1 && projected.x > 0 && projected.x < this.canvas.clientWidth && projected.y > 0 && projected.y < this.canvas.clientHeight };
  }

  reticle(state: State, tank: Tank) {
    let length = 24;
    const bx = tank.x + Math.sin(tank.turret) * length;
    const bz = tank.z + Math.cos(tank.turret) * length;
    for (const o of state.obstacles) if (o.hp > 0) {
      const at = segmentCircle(tank.x, tank.z, bx, bz, o.x, o.z, o.radius);
      if (at !== null) length = Math.min(length, at * 24);
    }
    for (const t of state.tanks) if (t.team === 'enemy' && t.hp > 0) {
      const at = segmentCircle(tank.x, tank.z, bx, bz, t.x, t.z, 0.95);
      if (at !== null) length = Math.min(length, at * 24);
    }
    const x = tank.x + Math.sin(tank.turret) * length;
    const z = tank.z + Math.cos(tank.turret) * length;
    return this.project(x, groundHeight(x, z) + 1.08, z);
  }
}
