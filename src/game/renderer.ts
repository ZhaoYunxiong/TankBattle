import { mapFor, inRegion, waterAt, roadDistance, riverSection, type River } from './maps';
import { fallenTreeShape, TREE_FALL_TIME } from './cover';
import { chargePower } from './abilities';
import { SITE, SITE_COLORS } from './sites';
import { Color3, Color4 } from '@babylonjs/core/Maths/math.color';
import { Matrix, Vector3 } from '@babylonjs/core/Maths/math.vector';
import { DirectionalLight } from '@babylonjs/core/Lights/directionalLight';
import { HemisphericLight } from '@babylonjs/core/Lights/hemisphericLight';
import { PointLight } from '@babylonjs/core/Lights/pointLight';
import { Engine } from '@babylonjs/core/Engines/engine';
import { FreeCamera } from '@babylonjs/core/Cameras/freeCamera';
import { Mesh } from '@babylonjs/core/Meshes/mesh';
import { MeshBuilder } from '@babylonjs/core/Meshes/meshBuilder';
import { Scene } from '@babylonjs/core/scene';
import { ShadowGenerator } from '@babylonjs/core/Lights/Shadows/shadowGenerator';
import '@babylonjs/core/Lights/Shadows/shadowGeneratorSceneComponent';
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial';
import { TransformNode } from '@babylonjs/core/Meshes/transformNode';
import { VertexData } from '@babylonjs/core/Meshes/mesh.vertexData';
import { angleDiff, clamp, COLORS, distance, type BattleEvent, type GameMode, type Obstacle, type Scar, type Site, type State, type Tank } from './types';
import { seededRandom, segmentCircle } from './world';
import { BattleAudio } from './audio';
import { CAMERA } from './camera';
import { groundHeight, groundSlope, terrainVertex, terrainIntersection, TERRAIN_STEP } from './terrain';
import { SHOT_HEIGHT, shotSlope, traceShot } from './combat';

import { buildTankModel, type TankVisual } from './tank-model';
import { IMPACTS } from './tactics';

type Particle = { mesh: Mesh; vx: number; vy: number; vz: number; life: number; max: number; grow: number };

export class BattleRenderer {
  readonly engine: Engine;

  readonly scene: Scene;

  readonly camera: FreeCamera;

  readonly audio = new BattleAudio();

  yaw = Math.PI;

  pitch = CAMERA.pitch;

  zoom = CAMERA.zoom;

  shakeEnabled = true;

  shakeStrength = 1.4;

  private siteVisuals = new Map<number, { root: TransformNode; intact: TransformNode; ruin: TransformNode; gun: TransformNode; trim: Mesh; beacon: Mesh; circle: ReturnType<typeof MeshBuilder.CreateLines>; range: ReturnType<typeof MeshBuilder.CreateLines> }>();

  private shadows: ShadowGenerator;

  private materials = new Map<string, StandardMaterial>();

  private terrain: TransformNode;

  private tankVisuals = new Map<string, TankVisual>();

  private obstacles = new Map<number, TransformNode>();

  private shells = new Map<number, Mesh>();

  private drops = new Map<number, TransformNode>();

  private particles: Particle[] = [];

  private flags: Mesh[] = [];

  private grassPatches: Mesh[] = [];

  private clouds: TransformNode[] = [];

  private ripples: Mesh[] = [];

  private eddies: Mesh[] = [];

  private fallen = new Map<number, number>();

  private fallenVisuals = new Map<number, { body: TransformNode; pitch: number; lift: number }>();

  private settledTrees = new Set<number>();

  private scars = new Map<number, Mesh>();

  private flash: PointLight;

  private pulses: { mesh: Mesh; age: number; size: number; water: boolean }[] = [];

  private cameraKick = Vector3.Zero();

  private matchId = '';

  private tracks: { mesh: Mesh; life: number }[] = [];

  private shadowClock = 0;

  private seenEvent = 0;

  private seed = -1;

  private map = mapFor();

  private shake = 0;

  private smokeClock = 0;

  private elapsed = 0;

  private camps = new Map<Tank['team'], { root: TransformNode; beacon: Mesh }>();

  private mode: GameMode | null = null;

  private lowQuality = false;

  constructor(readonly canvas: HTMLCanvasElement) {
    this.engine = new Engine(canvas, true, { stencil: true, powerPreference: 'high-performance' });
    this.scene = new Scene(this.engine);
    this.scene.clearColor = new Color4(0.84, 0.87, 0.83, 1);
    this.scene.ambientColor = Color3.FromHexString('#d6ddcf');
    this.flash = new PointLight('explosion-flash', Vector3.Zero(), this.scene);
    this.flash.diffuse = Color3.FromHexString('#ffd9a4'); this.flash.intensity = 0; this.flash.range = 22;
    this.scene.fogMode = Scene.FOGMODE_LINEAR;
    this.scene.fogColor = Color3.FromHexString('#d6dfd8');
    this.scene.fogStart = 60;
    this.scene.fogEnd = 145;
    this.camera = new FreeCamera('camera', new Vector3(18, 25, 36), this.scene);
    this.camera.minZ = 0.15;
    this.camera.maxZ = 420;
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
    this.setQuality('auto');
    this.scene.onDisposeObservable.add(() => this.audio.dispose());
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
    this.flags = []; this.grassPatches = []; this.clouds = []; this.ripples = []; this.eddies = []; this.fallen.clear(); this.fallenVisuals.clear(); this.settledTrees.clear(); this.scars.clear();
    for (const p of this.pulses) p.mesh.dispose();
    this.pulses = []; this.flash.intensity = 0; this.shake = 0; this.cameraKick.setAll(0);
    for (const mark of this.tracks) mark.mesh.dispose();
    this.tracks = [];
    for (const visual of this.tankVisuals.values()) visual.root.dispose();
    this.tankVisuals.clear();
    this.camps.clear();
    this.siteVisuals.clear();
    this.seed = state.seed;
    this.matchId = state.matchId;
    this.map = mapFor(state.mapSize);
    this.mode = state.mode;
    this.scene.fogStart = 110; this.scene.fogEnd = Math.hypot(this.map.arena.x * 2, this.map.arena.z * 2) + 35;
    this.seenEvent = state.events.at(-1)?.id ?? 0;
    for (const p of this.particles) p.mesh.dispose();
    this.particles = [];
    const random = seededRandom(state.seed + 42);
    const floor = new Mesh('valley', this.scene);
    const positions: number[] = [];
    const indices: number[] = [];
    const colors: number[] = [];
    const halfX = this.map.arena.x + 4;
    const halfZ = this.map.arena.z + 4;
    const width = halfX * 2 / TERRAIN_STEP + 1;
    const rows = halfZ * 2 / TERRAIN_STEP + 1;
    for (let row = 0; row < rows; row++) for (let col = 0; col < width; col++) {
      const x = -halfX + col * TERRAIN_STEP;
      const z = -halfZ + row * TERRAIN_STEP;
      positions.push(x, terrainVertex(x, z, this.map), z);
    }
    for (let row = 0; row < rows - 1; row++) for (let col = 0; col < width - 1; col++) {
      const a = row * width + col;
      indices.push(a, a + 1, a + width, a + 1, a + width + 1, a + width);
    }
    const normals: number[] = [];
    VertexData.ComputeNormals(positions, indices, normals);
    const data = new VertexData();
    data.positions = positions;
    data.indices = indices;
    data.normals = normals;
    data.applyToMesh(floor);
    floor.convertToFlatShadedMesh();
    const flat = floor.getVerticesData('position')!;
    // 道路直接着色在同一坡面上，既保留几何切面的光影，也不会出现浮空道路。
    for (let i = 0; i < flat.length; i += 9) {
      const x = (flat[i] + flat[i + 3] + flat[i + 6]) / 3;
      const z = (flat[i + 2] + flat[i + 5] + flat[i + 8]) / 3;
      const y = groundHeight(x, z, this.map);
      const slope = groundSlope(x, z, this.map);
      const cellX = Math.floor(x / TERRAIN_STEP) * TERRAIN_STEP + TERRAIN_STEP / 2;
      const cellZ = Math.floor(z / TERRAIN_STEP) * TERRAIN_STEP + TERRAIN_STEP / 2;
      const path = roadDistance({ x: cellX, z: cellZ }, this.map) < 2.4;
      const grass = Color3.Lerp(Color3.FromHexString('#b7bc9c'), Color3.FromHexString('#97ac8e'), clamp(y / 7, 0, 1));
      const color = this.map.grass.some(g => inRegion({ x, z }, g)) ? Color3.FromHexString('#a4af7f') : path ? Color3.FromHexString('#d8c8a6') : Color3.Lerp(grass, Color3.FromHexString('#bcae93'), clamp(Math.hypot(slope.x, slope.z) * 1.6, 0, 1));
      for (let vertex = 0; vertex < 3; vertex++) colors.push(color.r, color.g, color.b, 1);
    }
    floor.setVerticesData('color', colors);
    floor.material = this.material('#ffffff');
    floor.parent = this.terrain;
    floor.receiveShadows = true;
    const base = this.box('island-foundation', halfX * 2, 3, halfZ * 2, '#baa990', this.terrain);
    base.position.y = -1.55;
    for (let i = 0; i < 48; i++) {
      const side = i % 2 ? -1 : 1;
      const x = side * (this.map.arena.x + 3 + random() * 7);
      const z = -this.map.arena.z - 5 + Math.floor(i / 2) * (this.map.arena.z * 2 + 10) / 23;
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
    for (let i = 0; i < 14; i++) {
      const m = this.cylinder('far-ridge', 0, 12, 8 + random() * 8, '#a7b9b0', this.terrain, 5);
      m.position.set(-this.map.arena.x - 12 + i * (this.map.arena.x * 2 + 24) / 13, 3, -this.map.arena.z - 8 - random() * 10);
    }
    for (let i = 0; i < 140; i++) {
      const x = (random() - 0.5) * (this.map.arena.x * 2 - 4);
      const z = (random() - 0.5) * (this.map.arena.z * 2 - 4);
      if (roadDistance({ x, z }, this.map) < 2.5 || waterAt({ x, z }, this.map) || [this.map.base, this.map.enemyBase].some(p => distance({ x, z }, p) < 7)) continue;
      const grass = this.cylinder('grass', 0.08, 0.5, 0.25 + random() * 0.2, i % 3 ? '#9da989' : '#d9ca9e', this.terrain, 4);
      grass.position.set(x, groundHeight(x, z, this.map) + 0.1, z);
      grass.rotation.y = random() * 6;
    }
    this.buildNature(random);
    for (const obstacle of state.obstacles) this.buildObstacle(obstacle);
    this.buildCamp('player');
    if (state.mode === 'classic') this.buildCamp('enemy');
  }

  private buildNature(random: () => number) {
    for (const river of this.map.rivers) {
      this.buildRiver(river);
      const horizontal = river.width > river.depth;
      const count = Math.ceil(Math.max(river.width, river.depth) / 4);
      for (let i = 0; i < count; i++) {
        const length = 1.2 + random() * 2.6;
        const ripple = this.box('water-current', horizontal ? length : 0.11, 0.014, horizontal ? 0.11 : length, '#deefdc', this.terrain);
        ripple.metadata = { river, start: i / count, lane: (random() - 0.5) * 1.5, speed: 1.4 + random() * 0.9 };
        this.ripples.push(ripple);
      }
      for (let along = -Math.max(river.width, river.depth) / 2 + 1; along < Math.max(river.width, river.depth) / 2; along += 7) for (const side of [-1, 1]) {
        const section = riverSection(river, along), cross = section.offset + side * (section.half - 0.1);
        const foam = this.box('river-bank-foam', horizontal ? 2.4 : 0.25, 0.025, horizontal ? 0.25 : 2.4, '#d5e3c8', this.terrain);
        foam.position.set(river.x + (horizontal ? along : cross), 0.068, river.z + (horizontal ? cross : along)); foam.rotation.y = Math.sin(along) * 0.1;
      }
      // 浅河裸露的卵石提示可以涉水；深河使用更深的青色。
      if (river.kind === 'shallow') for (let i = 0; i < 12; i++) {
        const stone = this.cylinder('river-pebble', 0.3, 0.65, 0.09, '#d3ccae', this.terrain, 5);
        stone.position.set(river.x + (random() - 0.5) * river.width, 0.025, river.z + (random() - 0.5) * river.depth);
      }
    }
    for (const bridge of this.map.bridges) {
      const horizontal = bridge.width > bridge.depth;
      const deck = this.box('bridge-deck', bridge.width, 0.12, bridge.depth, '#d6c5a6', this.terrain);
      deck.position.set(bridge.x, 0.07, bridge.z);
      const length = horizontal ? bridge.width : bridge.depth;
      for (let i = 0; i <= length; i += 1.2) {
        const seam = this.box('bridge-plank', horizontal ? 0.07 : bridge.width, 0.018, horizontal ? bridge.depth : 0.07, '#ac9e84', this.terrain);
        seam.position.set(bridge.x + (horizontal ? i - length / 2 : 0), 0.14, bridge.z + (horizontal ? 0 : i - length / 2));
      }
      for (const end of [-1, 1]) for (const side of [-1, 1]) {
        const post = this.box('bridge-post', 0.35, 0.8, 0.35, '#b9aa8f', this.terrain);
        post.position.set(bridge.x + (horizontal ? end * (bridge.width / 2 - 0.3) : side * (bridge.width / 2 - 0.25)), 0.4, bridge.z + (horizontal ? side * (bridge.depth / 2 - 0.25) : end * (bridge.depth / 2 - 0.3)));
        const whirl = MeshBuilder.CreateTorus('bridge-eddy', { diameter: 0.8, thickness: 0.06, tessellation: 12 }, this.scene);
        whirl.parent = this.terrain; whirl.material = this.material('#dcebd7'); whirl.position.copyFrom(post.position); whirl.position.y = 0.07;
        if (horizontal) whirl.position.z += side * 0.8; else whirl.position.x += side * 0.8;
        whirl.scaling.z = 0.7;
        this.eddies.push(whirl);
      }
    }
    for (const patch of this.map.grass) {
      const blades: Mesh[] = [];
      for (let x = -patch.width / 2 + 0.4; x < patch.width / 2; x += 0.95) for (let z = -patch.depth / 2 + 0.4; z < patch.depth / 2; z += 0.95) {
        const height = 1.65 + random() * 0.45;
        const blade = this.cylinder('tall-grass', 0.06, 0.5, height, '#9dab70', undefined, 3);
        const px = patch.x + x + (random() - 0.5) * 0.55, pz = patch.z + z + (random() - 0.5) * 0.55;
        blade.position.set(px, groundHeight(px, pz, this.map) + height / 2, pz);
        blade.rotation.z = (random() - 0.5) * 0.22;
        blade.rotation.y = random() * 6; blades.push(blade);
      }
      const merged = Mesh.MergeMeshes(blades, true, true)!;
      merged.name = 'concealing-grass'; merged.parent = this.terrain;
      // 合并为一张网格，大片高草也只需一次绘制。
      merged.bakeCurrentTransformIntoVertices();
      merged.setPivotPoint(new Vector3(patch.x, groundHeight(patch.x, patch.z, this.map), patch.z));
      this.grassPatches.push(merged);
    }
    for (let i = 0; i < 3; i++) {
      const cloud = new TransformNode('drifting-cloud', this.scene); cloud.parent = this.terrain;
      cloud.position.set(i * 30, 33 + i * 2, (i - 1) * this.map.arena.z * 0.6);
      for (let part = 0; part < 3; part++) {
        const puff = MeshBuilder.CreateIcoSphere('cloud', { radius: 1, subdivisions: 1, flat: true }, this.scene);
        puff.material = this.material('#e5e9de'); puff.parent = cloud;
        puff.scaling.set(5, 0.65, 3.6); puff.position.x = (part - 1) * 4;
        this.shadows.addShadowCaster(puff);
      }
      this.clouds.push(cloud);
    }
  }

  private buildRiver(river: River) {
    const horizontal = river.width > river.depth, length = Math.max(river.width, river.depth);
    const positions: number[] = [], indices: number[] = [], colors: number[] = [], normals: number[] = [];
    const rows = Math.ceil(length / 2);
    for (let i = 0; i <= rows; i++) {
      const along = (i / rows - 0.5) * length, section = riverSection(river, along);
      for (let lane = 0; lane <= 4; lane++) {
        const cross = section.offset + (lane / 2 - 1) * section.half;
        positions.push(river.x + (horizontal ? along : cross), 0.048, river.z + (horizontal ? cross : along));
        const color = Color3.FromHexString(lane === 0 || lane === 4 ? '#93c6b6' : river.kind === 'deep' ? lane === 2 ? '#397f96' : '#529eac' : lane === 2 ? '#75b5b0' : '#96c9bb');
        colors.push(color.r, color.g, color.b, 1);
      }
    }
    for (let i = 0; i < rows; i++) for (let lane = 0; lane < 4; lane++) {
      const a = i * 5 + lane;
      if (horizontal) indices.push(a, a + 5, a + 1, a + 1, a + 5, a + 6);
      else indices.push(a, a + 1, a + 5, a + 1, a + 6, a + 5);
    }
    VertexData.ComputeNormals(positions, indices, normals);
    const mesh = new Mesh(river.kind + '-river', this.scene), data = new VertexData();
    data.positions = positions; data.indices = indices; data.colors = colors; data.normals = normals; data.applyToMesh(mesh);
    mesh.material = this.material('#ffffff'); mesh.parent = this.terrain; mesh.receiveShadows = true;
  }

  private pulse(x: number, z: number, size: number, water = false) {
    if (this.pulses.length >= (this.lowQuality ? 12 : 24)) return;
    const mesh = MeshBuilder.CreateTorus(water ? 'water-wake' : 'blast-wave', { diameter: 1, thickness: water ? 0.045 : 0.13, tessellation: 20 }, this.scene);
    mesh.material = this.material(water ? '#d6f0e7' : '#e3cda8');
    mesh.position.set(x, groundHeight(x, z, this.map) + (water ? 0.1 : 0.25), z);
    this.pulses.push({ mesh, age: 0, size, water });
  }

  private buildScar(scar: Scar) {
    const positions: number[] = [], indices: number[] = [], colors: number[] = [], normals: number[] = [];
    const random = seededRandom(scar.id), sides = 20;
    const bridge = scar.surface === 'bridge' ? this.map.bridges.find(b => inRegion(scar, b)) : undefined;
    const ratios = [0, 0.52, 0.78, 1, 1.13];
    const rim = scar.kind === 'crater' && scar.surface === 'earth';
    const palette = rim ? ['#454b42', '#555548', '#95836b', '#b09c7c', '#8f9475'] : ['#424c46', '#535d51', '#6b715e', '#80846c', '#929779'];
    const jitter = Array.from({ length: sides }, () => 0.86 + random() * 0.24);
    for (let ring = 0; ring < ratios.length; ring++) for (let side = 0; side < sides; side++) {
      const a = side / sides * Math.PI * 2 + scar.rotation;
      let x = scar.x + Math.sin(a) * scar.radius * ratios[ring] * jitter[side];
      let z = scar.z + Math.cos(a) * scar.radius * ratios[ring] * jitter[side];
      if (bridge) { x = clamp(x, bridge.x - bridge.width / 2 + 0.04, bridge.x + bridge.width / 2 - 0.04); z = clamp(z, bridge.z - bridge.depth / 2 + 0.04, bridge.z + bridge.depth / 2 - 0.04); }
      positions.push(x, (bridge ? 0.16 : groundHeight(x, z, this.map)) + 0.035 + (rim && ring === 2 ? scar.radius * 0.11 : ring === 3 ? 0.03 : 0), z);
      const color = Color3.FromHexString(palette[ring]).scale(side % 3 === 0 ? 0.94 : 1);
      colors.push(color.r, color.g, color.b, 1);
    }
    for (let ring = 0; ring < 4; ring++) for (let side = 0; side < sides; side++) {
      const a = ring * sides + side, b = ring * sides + (side + 1) % sides;
      indices.push(a, b, b + sides, a, b + sides, a + sides);
    }
    // 残片并入同一网格，弹坑保留整局而不持续占用粒子和物理预算。
    if (scar.kind === 'crater') for (let i = 0; i < 4; i++) {
      const x = scar.x + (random() - 0.5) * scar.radius, z = scar.z + (random() - 0.5) * scar.radius;
      const y = (bridge ? 0.17 : groundHeight(x, z, this.map)) + 0.08, n = positions.length / 3;
      positions.push(x - 0.18, y, z, x + 0.24, y, z, x, y + 0.15, z + 0.35);
      indices.push(n, n + 1, n + 2); colors.push(0.27, 0.32, 0.29, 1, 0.35, 0.39, 0.35, 1, 0.4, 0.43, 0.35, 1);
    }
    VertexData.ComputeNormals(positions, indices, normals);
    const mesh = new Mesh(scar.kind === 'crater' ? 'persistent-crater' : 'persistent-impact', this.scene), data = new VertexData();
    data.positions = positions; data.indices = indices; data.colors = colors; data.normals = normals; data.applyToMesh(mesh);
    mesh.material = this.material('#ffffff'); mesh.parent = this.terrain; mesh.receiveShadows = true;
    this.scars.set(scar.id, mesh);
  }

  private prepareFallenTree(o: Obstacle, root: TransformNode) {
    const parts = root.getChildMeshes();
    const body = new TransformNode('fallen-tree-body', this.scene); body.parent = root;
    for (const part of parts) { part.parent = body; part.visibility = 1; }
    root.rotation.set(0, o.rotation, 0); root.scaling.setAll(1);
    const shape = fallenTreeShape(o, this.map);
    body.rotation.x = shape.pitch; body.position.set(0, 0.35, 0.35);
    if (o.variant === 'pine' || o.variant === 'round') for (const side of [-1, 1]) {
      const branch = this.cylinder('fallen-branch', 0.06, 0.17, o.height * 0.28, '#8c7860', body, 5);
      branch.position.set(side * 0.35, o.height * (side > 0 ? 0.48 : 0.64), 0); branch.rotation.z = side * -0.85;
      this.shadows.addShadowCaster(branch);
    }
    // 保留原树冠的立体网格与配色，按实际顶点托住坡面，避免树冠埋地或被压扁。
    let lift = 0;
    for (const part of body.getChildMeshes()) {
      const matrix = part.computeWorldMatrix(true), positions = part.getVerticesData('position') ?? [];
      for (let i = 0; i < positions.length; i += 3) {
        const p = Vector3.TransformCoordinates(new Vector3(positions[i], positions[i + 1], positions[i + 2]), matrix);
        lift = Math.max(lift, groundHeight(p.x, p.z, this.map) + 0.025 - p.y);
      }
      part.receiveShadows = true;
    }
    const stump = this.cylinder('persistent-stump', 0.35, 0.48, 0.42, o.variant === 'birch' ? '#d8d0b5' : '#8c7860', root, 7);
    stump.position.y = 0.21;
    const cut = this.cylinder('stump-cut', 0.32, 0.35, 0.07, '#c7ad83', root, 7); cut.position.y = 0.45; cut.rotation.z = 0.12;
    this.shadows.addShadowCaster(stump); this.shadows.addShadowCaster(cut);
    const visual = { body, pitch: shape.pitch, lift: body.position.y + lift };
    this.fallenVisuals.set(o.id, visual);
    return visual;
  }

  private drivingTrail(tank: Tank) {
    if (waterAt(tank, this.map) === 'shallow') {
      for (let i = 0; i < (tank.boosting ? 3 : 1); i++) this.particle(tank.x, groundHeight(tank.x, tank.z, this.map) + 0.2, tank.z, '#c8e5de', false, tank.boosting ? 0.5 : 0.18);
      this.pulse(tank.x, tank.z, tank.boosting ? 1.7 : 1.1, true);
      return;
    }
    const x = tank.x - Math.sin(tank.angle), z = tank.z - Math.cos(tank.angle);
    for (let i = 0; i < (tank.boosting ? 3 : 1); i++) this.particle(x + (i - 1) * (tank.boosting ? 0.4 : 0), groundHeight(x, z, this.map) + 0.15, z, '#c6bfa3', true, tank.boosting ? 0.65 : 0.2);
    for (const side of [-1, 1]) {
      const mark = this.box('track-print', 0.32, 0.018, 0.7, '#7f8065');
      const px = x + Math.cos(tank.angle) * side * 0.87, pz = z - Math.sin(tank.angle) * side * 0.87;
      const slope = groundSlope(px, pz, this.map);
      mark.position.set(px, groundHeight(px, pz, this.map) + 0.025, pz);
      mark.rotation.set(-Math.atan(slope.x * Math.sin(tank.angle) + slope.z * Math.cos(tank.angle)), tank.angle, Math.atan(slope.x * Math.cos(tank.angle) - slope.z * Math.sin(tank.angle)));
      mark.visibility = 0.2; this.tracks.push({ mesh: mark, life: 5 });
    }
    while (this.tracks.length > (this.lowQuality ? 36 : 90)) this.tracks.shift()!.mesh.dispose();
  }

  private buildSite(site: Site) {
    const root = new TransformNode('site-' + site.id, this.scene); root.parent = this.terrain;
    root.position.set(site.x, groundHeight(site.x, site.z, this.map), site.z);
    const intact = new TransformNode('site-intact', this.scene); intact.parent = root;
    const platform = this.cylinder('site-foundation', 3.6, 4.1, 0.65, '#c9c3aa', intact, 8); platform.position.y = 0.16;
    const gun = new TransformNode('tower-gun', this.scene); gun.parent = intact;
    let trim: Mesh;
    if (site.kind === 'tower') {
      const pillar = this.cylinder('tower-pillar', 1.9, 2.7, 2.1, '#d7d0b6', intact, 6); pillar.position.y = 1.5;
      for (const side of [-1, 1]) {
        const brace = this.box('tower-brace', 0.35, 1.7, 1.4, '#929d88', intact); brace.position.set(side * 1.15, 1.2, 0);
      }
      trim = this.cylinder('tower-collar', 2.8, 2.8, 0.3, SITE_COLORS[site.team], intact, 8); trim.position.y = 2.55;
      gun.position.y = 2.8;
      const turret = this.box('tower-turret', 1.85, 0.7, 1.8, '#748574', gun); turret.position.y = 0.2;
      const barrel = this.box('tower-barrel', 0.38, 0.38, 2, '#566659', gun); barrel.position.set(0, 0.3, 1.3);
      const muzzle = this.box('tower-muzzle', 0.52, 0.5, 0.4, '#bbbd9d', gun); muzzle.position.set(0, 0.3, 2.3);
    } else {
      const crate = this.box('supply-station', 2.4, 1.3, 1.8, '#e4d9b8', intact); crate.position.y = 1;
      trim = this.box('supply-roof', 2.9, 0.25, 2.3, SITE_COLORS[site.team], intact); trim.position.y = 1.8;
      for (const horizontal of [true, false]) {
        const cross = this.box('repair-cross', horizontal ? 0.9 : 0.26, horizontal ? 0.26 : 0.9, 0.06, '#eff3dc', intact);
        cross.position.set(0, 1, 0.94);
      }
    }
    const beacon = this.cylinder('site-beacon', 0.28, 0.28, 0.6, SITE_COLORS[site.team], gun, 4);
    beacon.position.set(0, site.kind === 'tower' ? 1 : 2.2, -0.5);
    const ring = (name: string, radius: number) => {
      const points = Array.from({ length: 65 }, (_, i) => {
        const angle = i / 64 * Math.PI * 2, x = site.x + Math.sin(angle) * radius, z = site.z + Math.cos(angle) * radius;
        return new Vector3(x - site.x, groundHeight(x, z, this.map) - root.position.y + 0.07, z - site.z);
      });
      const line = MeshBuilder.CreateLines(name, { points }, this.scene); line.parent = root; line.isPickable = false; return line;
    };
    const circle = ring('capture-circle', SITE.captureRadius), range = ring('tower-range', SITE.range);
    const ruin = new TransformNode('tower-ruins', this.scene); ruin.parent = root;
    const foundation = this.cylinder('broken-tower-base', 2.5, 3.7, 0.8, '#878b77', ruin, 7); foundation.position.y = 0.25;
    for (let i = 0; i < 5; i++) {
      const debris = this.box('tower-rubble', 0.65 + i * 0.12, 0.6 + i % 2 * 0.4, 0.85, i % 2 ? '#9da28b' : '#c0bba1', ruin);
      debris.position.set(Math.sin(i * 2.4) * 1.6, 0.4, Math.cos(i * 2.4) * 1.6); debris.rotation.set(i * 0.15, i, 0.3);
    }
    const wreck = this.box('fallen-tower-gun', 0.5, 0.5, 2.8, '#657464', ruin); wreck.position.set(1.5, 0.6, 0); wreck.rotation.set(0.25, 0.8, 0.4);
    ruin.setEnabled(false);
    for (const mesh of root.getChildMeshes()) if (mesh !== circle && mesh !== range) this.shadows.addShadowCaster(mesh);
    const visual = { root, intact, ruin, gun, trim, beacon, circle, range }; this.siteVisuals.set(site.id, visual); return visual;
  }

  private renderSites(state: State, local: Tank | undefined, dt: number) {
    for (const site of state.sites) {
      const visual = this.siteVisuals.get(site.id) ?? this.buildSite(site);
      const color = site.contested ? '#f1dfb7' : SITE_COLORS[site.team];
      visual.intact.setEnabled(site.hp > 0); visual.ruin.setEnabled(site.hp <= 0);
      visual.trim.material = this.material(color);
      visual.beacon.material = this.material(site.warning > 0 ? '#ffe6ac' : color, true);
      visual.beacon.scaling.setAll(site.warning > 0 ? 1 + Math.sin(state.time * 24) * 0.25 : 1);
      visual.gun.rotation.y += angleDiff(site.angle, visual.gun.rotation.y) * (1 - Math.exp(-dt * 15));
      visual.circle.color = Color3.FromHexString(site.captureTeam === 'neutral' ? color : SITE_COLORS[site.captureTeam]);
      visual.circle.setEnabled(site.hp > 0 && site.capturable && !!local && distance(site, local) < 17);
      visual.range.color = Color3.FromHexString('#e8ad89');
      visual.range.setEnabled(site.hp > 0 && site.kind === 'tower' && site.team === 'enemy' && !!local && distance(site, local) < SITE.range + 4);
      if (site.hp > 0 && site.kind === 'tower' && site.hp < site.maxHp * 0.4 && this.smokeClock > 0.18 && (!local || distance(site, local) < 65)) {
        this.particle(site.x, visual.root.position.y + 3, site.z, '#8d9184', true);
      }
    }
  }

  private buildCamp(team: Tank['team']) {
    const enemy = team === 'enemy';
    const position = enemy ? this.map.enemyBase : this.map.base;
    const root = new TransformNode(team + '-camp', this.scene);
    root.parent = this.terrain;
    root.position.set(position.x, groundHeight(position.x, position.z, this.map), position.z);
    root.rotation.y = enemy ? Math.PI : 0;
    const plinth = this.cylinder('camp-platform', 7.3, 7.6, 0.35, enemy ? '#d3b39c' : '#d7cbb0', root, 8);
    plinth.position.y = 0.07;
    const core = this.box('camp', 3.6, 2, 3.6, enemy ? '#d8bba3' : '#e6d9bc', root);
    core.position.y = 1.1;
    const roof = this.cylinder('camp-roof', 2.8, 5, 0.8, enemy ? '#a26655' : '#6f8e81', root, 4);
    roof.rotation.y = Math.PI / 4;
    roof.position.y = 2.5;
    const door = this.box('camp-door', 0.8, 1.35, 0.05, '#6c7567', root);
    door.position.set(0, 0.8, -1.82);
    const pole = this.cylinder('flag-pole', 0.08, 0.08, 3, '#565f54', root);
    pole.position.set(2.9, 1.5, 0);
    const flag = this.box('flag', 1.3, 0.75, 0.04, enemy ? '#c27863' : '#83ad94', root);
    flag.position.set(3.5, 2.7, 0);
    this.flags.push(flag);
    const beacon = this.cylinder('beacon', 0.7, 0.7, 0.8, enemy ? '#f0b290' : '#a7ddcb', root, 4);
    beacon.material = this.material(enemy ? '#ffc5a3' : '#b1ead4', true);
    beacon.position.set(0, 3.6, 0);
    beacon.rotation.z = Math.PI / 4;
    this.camps.set(team, { root, beacon });
    this.shadows.addShadowCaster(core);
    this.shadows.addShadowCaster(roof);
  }

  private buildObstacle(o: Obstacle) {
    const root = new TransformNode('obstacle-' + o.id, this.scene);
    root.parent = this.terrain;
    root.position.set(o.x, groundHeight(o.x, o.z, this.map), o.z);
    if (o.kind === 'tree') {
      const trunkHeight = o.height * (o.variant === 'dead' ? 1 : o.variant === 'birch' ? 0.8 : 0.72);
      const trunk = this.cylinder('trunk', 0.18, 0.42, trunkHeight, o.variant === 'birch' ? '#e5dfc9' : '#8c7860', root);
      trunk.position.y = trunkHeight / 2;
      if (o.variant === 'round') {
        const crown = MeshBuilder.CreateIcoSphere('round-crown', { radius: 1, subdivisions: 1, flat: true }, this.scene);
        crown.parent = root; crown.material = this.material('#8da582');
        crown.scaling.set(1.25, (o.height - 1.2) / 2, 1.2); crown.position.y = (o.height + 1.2) / 2;
        const side = MeshBuilder.CreateIcoSphere('round-crown-side', { radius: 1, subdivisions: 0, flat: true }, this.scene);
        side.parent = root; side.material = this.material('#9daf7e'); side.scaling.set(1.1, o.height * 0.19, 0.9); side.position.set(0.65, o.height * 0.64, 0.2);
      } else if (o.variant === 'birch' || o.variant === 'dead') {
        for (const side of [-1, 1]) {
          const branch = this.cylinder('branch', 0.08, 0.2, 1.25, o.variant === 'birch' ? '#ddd9c3' : '#8c7860', root, 5);
          branch.position.set(side * 0.35, o.height * 0.55, 0); branch.rotation.z = side * -0.7;
          if (o.variant === 'birch') {
            const crown = this.cylinder('birch-crown', 0.5, 1.7, o.height * 0.48, '#b3bb80', root, 5);
            crown.position.set(side * 0.3, o.height * 0.75, 0);
          }
        }
      } else {
        const crown = this.cylinder('pine-crown', 0, 2.4, o.height - 0.8, '#668779', root, 5);
        crown.position.y = (o.height + 0.8) / 2;
        const top = this.cylinder('pine-top', 0, 1.6, o.height * 0.5, '#91a78c', root, 5);
        top.position.y = o.height * 0.75;
      }
      const palettes = o.variant === 'pine' ? ['#46776c', '#638675', '#54816c', '#78957d', '#5b7a60', '#8aa181'] : o.variant === 'birch' ? ['#abc387', '#c2ce95', '#8cae85', '#b1c494', '#c6b77a', '#d4c592'] : ['#6f986f', '#8eb084', '#819d67', '#a6b47b', '#b6a374', '#c6b080'];
      for (const part of root.getChildMeshes()) if (part.name.includes('crown') || part.name === 'pine-top') {
        part.material = this.material(palettes[((o.tone ?? 0) + (part.name.endsWith('top') ? 1 : 0)) % palettes.length]);
        part.scaling.x *= o.crown ?? 1; part.scaling.z *= o.crown ?? 1;
      }
      root.rotation.y = o.rotation;
    } else if (o.kind === 'rock') {
      const layers = o.variant === 'layered' ? 3 : 1;
      for (let layer = 0; layer < layers; layer++) {
        const body = this.cylinder('rock-' + (o.variant ?? 'boulder'), o.radius * (1.6 - layer * 0.2), o.radius * (2 - layer * 0.2), o.height / layers, layer % 2 ? '#b3ab98' : '#c4bda6', root, 5);
        body.position.y = o.height / layers * (layer + 0.5); body.rotation.y = layer * 0.2;
      }
      const cap = this.cylinder('moss', o.radius * 1.2, o.radius * 1.5, 0.12, '#bec4a3', root, 5);
      cap.position.y = o.height;
      root.rotation.y = o.rotation;
    } else {
      const wall = this.box('wall', 2, 1.45, 1.65, o.team === 'enemy' ? '#c3a28b' : '#d7c9ad', root);
      wall.position.y = 0.72;
      for (const x of [-0.66, 0.66]) {
        const merlon = this.box('merlon', 0.58, 0.45, 1.7, o.team === 'enemy' ? '#dfb89b' : '#e4d9bf', root);
        merlon.position.set(x, 1.58, 0);
      }
      root.rotation.y = o.rotation;
    }
    for (const mesh of root.getChildMeshes()) this.shadows.addShadowCaster(mesh);
    root.setEnabled(o.hp > 0 || o.kind === 'tree');
    if (o.kind === 'tree' && o.hp <= 0) this.fallen.set(o.id, 2);
    this.obstacles.set(o.id, root);
  }

  private buildTank(t: Tank): TankVisual {
    const visual = buildTankModel(t, { scene: this.scene, material: this.material.bind(this), box: this.box.bind(this), cylinder: this.cylinder.bind(this) });
    for (const mesh of visual.root.getChildMeshes()) this.shadows.addShadowCaster(mesh);
    return visual;
  }

  private particle(x: number, y: number, z: number, color: string, smoke = false, force = 1, material?: BattleEvent['material']) {
    if (this.particles.length >= (this.lowQuality ? 65 : 150)) return;
    const m = smoke
      ? MeshBuilder.CreateIcoSphere('smoke', { radius: 0.3, subdivisions: 1, flat: true }, this.scene)
      : material === 'rock' ? MeshBuilder.CreateIcoSphere('stone-fragment', { radius: 0.22 + Math.random() * 0.24, subdivisions: 0, flat: true }, this.scene) : MeshBuilder.CreateBox(material === 'wall' ? 'wall-block' : 'debris', { size: material === 'wall' ? 0.45 : 0.12 + Math.random() * 0.14 }, this.scene);
    m.material = this.material(color, color === '#f5bc75');
    m.position.set(x, y, z);
    m.rotation.set(Math.random() * 6, Math.random() * 6, Math.random() * 6);
    if (smoke && force < 1) m.scaling.setAll(0.35 + force * 0.8);
    const life = smoke ? force < 1 ? 0.65 : 1.6 : material ? 2 : 0.65;
    this.particles.push({
      mesh: m, vx: (Math.random() - 0.5) * (smoke ? 0.6 : 7 * force),
      vy: smoke ? 1 + Math.random() : 2 + Math.random() * 4 * force,
      vz: (Math.random() - 0.5) * (smoke ? 0.6 : 7 * force), life, max: life, grow: smoke ? force < 1 ? 0.6 : 1.3 : 0,
    });
  }

  private handleEvent(event: BattleEvent, local?: Tank) {
    const d = local ? distance(event, local) : 25;
    const falloff = clamp(1 - d / 35, 0, 1);
    this.audio.play(event.kind === 'capture' || event.kind === 'repair' ? 'pickup' : event.kind, falloff,
      event.impact && event.impact !== 'normal' ? event.impact : event.charge === undefined ? event.material ?? event.target : 'charged');
    if (event.kind === 'destroy') {
      const force = event.target === 'tank' ? event.owner === local?.id ? 1.5 : 1.15 : event.target === 'base' || event.target === 'tower' ? 1.4 : event.size * 0.2;
      this.shake = Math.min(1.65, this.shake + force * falloff);
      if (event.material === 'tree' && event.obstacle !== undefined) this.fallen.set(event.obstacle, 0);
      if (event.target) {
        const water = !!waterAt(event, this.map);
        this.pulse(event.x, event.z, event.size * 2.3, water);
        this.flash.position.set(event.x, groundHeight(event.x, event.z, this.map) + 2.5, event.z);
        this.flash.intensity = this.lowQuality ? 1.5 : 3;
        for (let i = 0; i < 4; i++) this.particle(event.x, groundHeight(event.x, event.z, this.map) + 1, event.z, water ? '#d0e9e2' : '#f5bc75', true, 1.6);
      }
      for (let i = 0; i < (this.lowQuality ? 8 : 18); i++) this.particle(event.x, groundHeight(event.x, event.z, this.map) + 1, event.z, event.material === 'tree' ? '#91a080' : event.material ? '#c8bba2' : i % 3 ? '#a59b84' : '#f5bc75', false, event.size, event.material);
      for (let i = 0; i < 5; i++) this.particle(event.x, groundHeight(event.x, event.z, this.map) + 1, event.z, '#9b9e90', true);
    } else if (event.kind === 'shot') {
      if (event.owner?.startsWith('site-')) {
        this.particle(event.x, event.y ?? SITE.height, event.z, '#ffe0a3', false, 1);
      }
      const tank = this.tankVisuals.get(event.owner ?? '');
      if (tank) {
        tank.barrel.position.z = event.charge === undefined ? 0.92 : 0.64;
        const muzzle = tank.turret.getAbsolutePosition();
        const angle = tank.root.rotation.y + tank.turret.rotation.y;
        for (let i = 0; i < 4; i++) this.particle(muzzle.x + Math.sin(angle) * 2, muzzle.y + 0.2 - Math.sin(tank.gun.rotation.x) * 2, muzzle.z + Math.cos(angle) * 2, '#f5bc75');
        if (event.charge !== undefined) {
          this.flash.position.copyFrom(muzzle); this.flash.intensity = Math.max(this.flash.intensity, (1 + event.charge * 2) * falloff);
          for (let i = 0; i < 6; i++) this.particle(muzzle.x + Math.sin(angle) * 2, muzzle.y + 0.4, muzzle.z + Math.cos(angle) * 2, '#f5bc75', false, 0.7 + event.charge);
        }
      }
      if (event.charge !== undefined) this.shake = Math.min(1.65, this.shake + (0.25 + event.charge * 0.95) * falloff);
      else if (event.owner === local?.id) this.shake = Math.max(this.shake, Math.min(0.25, this.shake + 0.1));
    } else if (event.kind === 'hit') {
      this.shake = Math.max(this.shake, Math.min(0.4, this.shake + 0.08 * falloff));
      const impact = event.impact ?? 'normal', spark = IMPACTS[impact];
      const count = impact === 'weakpoint' ? this.lowQuality ? 6 : 8 : impact === 'normal' ? 4 : 6;
      for (let i = 0; i < count; i++) this.particle(event.x, event.y ?? groundHeight(event.x, event.z, this.map) + 0.7, event.z, spark.color, false, impact === 'weakpoint' ? 1.15 : impact === 'armor' ? 0.55 : 1);
      if (waterAt(event, this.map)) this.pulse(event.x, event.z, 1.7, true);
      if (event.charge !== undefined) {
        this.pulse(event.x, event.z, 1.5 + event.charge * 2.5, !!waterAt(event, this.map));
        for (let i = 0; i < 6; i++) this.particle(event.x, event.y ?? groundHeight(event.x, event.z, this.map) + 0.5, event.z, '#efc58c', false, 0.8 + event.charge);
      }
    } else if (event.kind === 'pickup' || event.kind === 'capture' || event.kind === 'repair') {
      for (let i = 0; i < 8; i++) this.particle(event.x, groundHeight(event.x, event.z, this.map) + 1, event.z, '#b5ddbc');
    }
  }

  render(state: State, localId: string, dt: number, menu: boolean) {
    this.elapsed += dt;
    if (this.matchId !== state.matchId || this.seed !== state.seed || this.mode !== state.mode || this.map.id !== state.mapSize) this.buildLandscape(state);
    const lerp = 1 - Math.exp(-dt * 20);
    for (const o of state.obstacles) {
      const mesh = this.obstacles.get(o.id);
      if (mesh) {
        mesh.setEnabled((o.hp > 0 || o.kind === 'tree') && (o.team !== 'enemy' || state.enemyBaseDiscovered) && (menu || distance(o, this.camera.position) < (this.lowQuality ? 75 : 120)));
        mesh.scaling.y = o.hp > 0 ? 0.92 + o.hp / o.maxHp * 0.08 : 1;
        if (o.kind === 'tree' && o.hp > 0) { mesh.rotation.z = Math.sin(this.elapsed * 1.3 + o.id) * 0.018 + Math.sin(o.id) * 0.045; mesh.rotation.x = Math.cos(this.elapsed + o.id) * 0.012; }
        if (o.kind === 'tree' && o.hp <= 0 && !this.fallen.has(o.id)) this.fallen.set(o.id, 0);
        if (this.fallen.has(o.id) && !this.settledTrees.has(o.id)) {
          const age = Math.max(this.fallen.get(o.id)! + dt, o.fallenAt === undefined ? 0 : state.time - o.fallenAt); this.fallen.set(o.id, age);
          const visual = this.fallenVisuals.get(o.id) ?? this.prepareFallenTree(o, mesh);
          const progress = Math.min(1, age / TREE_FALL_TIME), eased = 1 - Math.cos(progress * Math.PI / 2);
          visual.body.rotation.x = visual.pitch * eased; visual.body.position.set(0, visual.lift * eased, 0.35 * eased);
          if (progress === 1) this.settledTrees.add(o.id);
        }
      }
    }
    for (const t of state.tanks) {
      let visual = this.tankVisuals.get(t.id);
      if (!visual || visual.kind !== t.kind || visual.color !== t.color) {
        if (visual) { for (const mesh of visual.root.getChildMeshes()) this.shadows.removeShadowCaster(mesh); visual.root.dispose(); }
        visual = this.buildTank(t);
        visual.root.position.set(t.x, groundHeight(t.x, t.z, this.map), t.z);
        visual.root.rotation.y = t.angle;
        this.tankVisuals.set(t.id, visual);
      }
      visual.root.setEnabled(t.hp > 0 && t.connected && (t.team === 'player' || state.visibleEnemies.includes(t.id)));
      const travel = Math.hypot(t.x - visual.root.position.x, t.z - visual.root.position.z) * lerp;
      const speed = travel / Math.max(dt, 0.001);
      visual.speed += (speed - visual.speed) * (1 - Math.exp(-dt * 10));
      for (const wheel of visual.wheels) wheel.rotation.x += travel * 4;
      if (visual.root.isEnabled() && speed > 0.5 && this.elapsed > visual.trailAt) { this.drivingTrail(t); visual.trailAt = this.elapsed + (this.lowQuality ? 0.3 : 0.18) * (t.boosting ? 0.55 : 1); }
      visual.root.position.x += (t.x - visual.root.position.x) * lerp;
      visual.root.position.z += (t.z - visual.root.position.z) * lerp;
      visual.root.position.y = groundHeight(visual.root.position.x, visual.root.position.z, this.map);
      visual.root.rotation.y += angleDiff(t.angle, visual.root.rotation.y) * lerp;
      const slope = groundSlope(visual.root.position.x, visual.root.position.z, this.map);
      const heading = visual.root.rotation.y;
      // 地面姿态只跟随平滑后的坡度；匀速行驶不再人为周期摆动。
      const settle = 1 - Math.exp(-dt * 12), recoil = t.recoil ?? 0;
      visual.slopePitch += (-Math.atan(slope.x * Math.sin(heading) + slope.z * Math.cos(heading)) - visual.slopePitch) * settle;
      visual.slopeRoll += (Math.atan(slope.x * Math.cos(heading) - slope.z * Math.sin(heading)) - visual.slopeRoll) * settle;
      const kick = recoil * (0.12 + Math.sin(state.time * 42) * 0.08), recoilAngle = t.turret - heading;
      visual.chassis.rotation.x = visual.slopePitch - kick * Math.cos(recoilAngle);
      visual.chassis.rotation.z = visual.slopeRoll + kick * Math.sin(recoilAngle);
      visual.chassis.position.set(Math.sin(state.time * 36) * recoil * 0.035, Math.sin(state.time * 45) * recoil * 0.045, 0);
      visual.gun.rotation.x += (-Math.atan(shotSlope(state, t)) - visual.gun.rotation.x) * lerp;
      visual.turret.rotation.y += angleDiff(t.turret - visual.root.rotation.y, visual.turret.rotation.y) * lerp;
      visual.barrel.position.z += (1.13 - visual.barrel.position.z) * Math.min(1, dt * 12);
      visual.shield.setEnabled(t.shield > 0 || t.buffs.armor > 0);
      visual.shield.visibility = 0.65 + Math.sin(this.elapsed * 6) * 0.25;
      visual.warning.setEnabled(t.team === 'enemy' && t.warning > 0);
      visual.warning.scaling.setAll(0.65 + t.warning * 0.9);
      visual.warning.visibility = 0.65 + Math.sin(this.elapsed * 22) * 0.3;
      visual.glow.setEnabled(t.charging);
      visual.glow.scaling.setAll(0.4 + chargePower(t.charge, t.kind) * 1.2 + Math.sin(this.elapsed * 12) * 0.08);
    }
    for (const [id, visual] of this.tankVisuals) {
      if (!state.tanks.some(t => t.id === id)) { visual.root.dispose(); this.tankVisuals.delete(id); }
    }
    for (const s of state.shells) {
      let mesh = this.shells.get(s.id);
      if (!mesh) {
        const charged = s.power !== undefined;
        mesh = this.box(charged ? 'charged-shell' : 'shell', charged ? 0.26 : 0.12, charged ? 0.26 : 0.12, charged ? 1.1 : 0.85, '#ffe1a2');
        mesh.material = this.material(charged ? '#fff1c4' : '#ffdc92', true);
        if (charged) {
          const tail = this.box('charged-trail', 0.14, 0.14, 1.4 + s.power! * 1.4, '#ffc67e', mesh);
          tail.position.z = -1.25; tail.material = this.material('#ffc67e', true); tail.visibility = 0.55;
        }
        this.shells.set(s.id, mesh);
      }
      mesh.position.set(s.x, s.y, s.z);
      mesh.rotation.x = -Math.atan2(s.vy, Math.hypot(s.vx, s.vz));
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
      root.position.set(d.x, groundHeight(d.x, d.z, this.map) + 0.18 + Math.sin(this.elapsed * 2.5 + d.id) * 0.15, d.z);
      root.rotation.y += dt * 0.65;
      root.setEnabled(d.life > 5 || Math.sin(this.elapsed * 8) > -0.4);
    }
    for (const [id, root] of this.drops) if (!state.drops.some(d => d.id === id)) { root.dispose(); this.drops.delete(id); }
    const local = state.tanks.find(t => t.id === localId);
    this.audio.ambience(!menu && !!local && local.hp > 0 ? this.tankVisuals.get(localId)?.speed ?? 0 : 0, !menu && !!local && this.map.rivers.some(r => Math.abs(r.width > r.depth ? local.z - r.z : local.x - r.x) < Math.min(r.width, r.depth) / 2 + 12));
    for (const scar of state.scars) {
      if (!this.scars.has(scar.id)) this.buildScar(scar);
      this.scars.get(scar.id)!.setEnabled(distance(scar, this.camera.position) < (this.lowQuality ? 80 : 140));
    }
    if (!menu) for (const event of state.events) if (event.id > this.seenEvent) this.handleEvent(event, local);
    if (state.events.length) this.seenEvent = state.events[state.events.length - 1].id;
    this.smokeClock += dt;
    this.renderSites(state, menu ? undefined : local, dt);
    if (this.smokeClock > 0.18) {
      this.smokeClock = 0;
      for (const t of state.tanks) if (t.hp > 0 && t.hp / t.maxHp < 0.6 && (t.team === 'player' || state.visibleEnemies.includes(t.id))) {
        this.particle(t.x, groundHeight(t.x, t.z, this.map) + 1, t.z, t.hp / t.maxHp < 0.3 ? '#66726a' : '#a5aa99', true);
      }
      if (state.baseHp / state.baseMaxHp < 0.5) this.particle(this.map.base.x, groundHeight(this.map.base.x, this.map.base.z, this.map) + 2.2, this.map.base.z, '#899184', true);
      if (state.mode === 'classic' && state.enemyBaseDiscovered && state.enemyBaseHp > 0 && state.enemyBaseHp / state.enemyBaseMaxHp < 0.5) this.particle(this.map.enemyBase.x, groundHeight(this.map.enemyBase.x, this.map.enemyBase.z, this.map) + 2.2, this.map.enemyBase.z, '#899184', true);
    }
    for (const p of this.particles) {
      p.life -= dt;
      p.mesh.position.addInPlaceFromFloats(p.vx * dt, p.vy * dt, p.vz * dt);
      if (!p.grow) {
        p.vy -= dt * 12;
        const floor = groundHeight(p.mesh.position.x, p.mesh.position.z, this.map) + 0.1;
        if (p.mesh.position.y < floor) { p.mesh.position.y = floor; p.vy = Math.abs(p.vy) * 0.18; p.vx *= 0.8; p.vz *= 0.8; }
      }
      else p.mesh.scaling.addInPlaceFromFloats(dt * p.grow, dt * p.grow, dt * p.grow);
      p.mesh.visibility = clamp(p.life / p.max, 0, 1) * (p.grow ? 0.65 : 1);
      if (p.life <= 0) p.mesh.dispose();
    }
    this.particles = this.particles.filter(p => p.life > 0);
    for (const [team, camp] of this.camps) {
      camp.root.setEnabled(team === 'player' || state.enemyBaseDiscovered);
      const hp = team === 'player' ? state.baseHp : state.enemyBaseHp;
      camp.root.scaling.y = hp > 0 ? 1 : 0.2;
      camp.beacon.rotation.y += dt * 0.7;
      camp.beacon.setEnabled(hp > 0);
    }
    this.shake *= Math.exp(-dt * 6);
    this.flash.intensity *= Math.exp(-dt * 13);
    for (const p of this.pulses) {
      p.age += dt; const life = p.water ? 1.15 : 0.65;
      p.mesh.scaling.setAll(0.6 + p.age / life * p.size);
      p.mesh.visibility = (1 - p.age / life) * (p.water ? 0.55 : 0.4);
      if (p.age >= life) p.mesh.dispose();
    }
    this.pulses = this.pulses.filter(p => !p.mesh.isDisposed());
    this.camera.position.subtractInPlace(this.cameraKick); this.cameraKick.setAll(0);
    if (menu) {
      const a = 0.42 + Math.sin(this.elapsed * 0.045) * 0.15;
      this.camera.position.set(Math.sin(a) * 54, 36, Math.cos(a) * 58 + 8);
      this.camera.setTarget(new Vector3(-3, 0, 10));
      this.camera.fov = 0.86;
    } else {
      const focus = this.tankVisuals.get(localId)?.root.position ?? new Vector3(this.map.base.x, 0, this.map.base.z - 7);
      const portrait = this.engine.getRenderWidth() < this.engine.getRenderHeight();
      const r = this.zoom * (portrait ? 1.18 : 1);
      const target = new Vector3(focus.x + Math.sin(this.yaw) * 3, focus.y + 0.85, focus.z + Math.cos(this.yaw) * 3);
      let actualR = r;
      // 镜头沿坦克到相机的线段收缩，山壁和围墙不会穿过相机。
      const cx = focus.x - Math.sin(this.yaw) * Math.cos(this.pitch) * r;
      const cz = focus.z - Math.cos(this.yaw) * Math.cos(this.pitch) * r;
      const terrainAt = terrainIntersection(
        { x: focus.x, y: focus.y + 1.2, z: focus.z },
        { x: cx, y: focus.y + 1.2 + Math.sin(this.pitch) * r, z: cz }, 0.7, this.map);
      if (terrainAt !== null) actualR = Math.max(4.5, r * terrainAt - 0.6);
      for (const o of state.obstacles) {
        if (o.hp <= 0 || o.kind === 'tree') continue;
        const at = segmentCircle(focus.x, focus.z, cx, cz, o.x, o.z, o.radius + 0.4);
        // 使用镜头射线的实际起始高度，避免出生点低围墙把手机镜头错误推到车身上。
        const rayHeight = at === null ? Infinity : focus.y + 0.85 + (0.35 + Math.sin(this.pitch) * r) * at;
        if (at !== null && at > 0.1 && rayHeight < groundHeight(o.x, o.z, this.map) + o.height + 0.35) actualR = Math.min(actualR, Math.max(4.5, r * at - 0.6));
      }
      const desired = new Vector3(focus.x - Math.sin(this.yaw) * Math.cos(this.pitch) * actualR, focus.y + 1.2 + Math.sin(this.pitch) * actualR, focus.z - Math.cos(this.yaw) * Math.cos(this.pitch) * actualR);
      Vector3.LerpToRef(this.camera.position, desired, Math.min(1, dt * 12), this.camera.position);
      this.camera.position.y = Math.max(this.camera.position.y, groundHeight(this.camera.position.x, this.camera.position.z, this.map) + 1);
      this.camera.setTarget(target);
      this.camera.fov = portrait ? 1.04 : 0.85;
      if (this.shakeEnabled) {
        const kick = this.shake * this.shakeStrength;
        this.cameraKick.set(Math.sin(this.elapsed * 79) * kick * 0.42, Math.sin(this.elapsed * 97 + 1) * kick * 0.32, Math.cos(this.elapsed * 71) * kick * 0.2);
        this.camera.position.addInPlace(this.cameraKick);
      }
      // 只淡化确实位于镜头和坦克之间的树冠。
      for (const o of state.obstacles) if (o.kind === 'tree' && o.hp > 0) {
        const at = segmentCircle(this.camera.position.x, this.camera.position.z, focus.x, focus.z, o.x, o.z, 1.5);
        for (const mesh of this.obstacles.get(o.id)?.getChildMeshes() ?? []) mesh.visibility = at !== null ? 0.25 : 1;
      }
    }
    for (const flag of this.flags) { flag.rotation.y = Math.sin(this.elapsed * 3 + flag.position.x) * 0.18; flag.scaling.z = 1 + Math.sin(this.elapsed * 4) * 0.12; }
    for (const grass of this.grassPatches) grass.rotation.z = Math.sin(this.elapsed * 1.7 + grass.position.x) * 0.014;
    for (const ripple of this.ripples) {
      const { river, start, lane, speed } = ripple.metadata as { river: River; start: number; lane: number; speed: number };
      const horizontal = river.width > river.depth, length = Math.max(river.width, river.depth);
      const along = ((start * length + this.elapsed * speed) % length) - length / 2;
      const section = riverSection(river, along), cross = section.offset + lane * section.half;
      ripple.position.set(river.x + (horizontal ? along : cross), 0.079, river.z + (horizontal ? cross : along));
      ripple.visibility = 0.36 + Math.sin(this.elapsed * 2 + start * 8) * 0.15;
    }
    for (const eddy of this.eddies) eddy.rotation.y += dt * 0.7;
    for (let i = 0; i < this.clouds.length; i++) {
      const cloud = this.clouds[i];
      cloud.position.x = ((this.elapsed * 1.1 + i * 47) % (this.map.arena.x * 2)) - this.map.arena.x;
      cloud.setEnabled(distance(cloud.position, this.camera.position) < 90);
    }
    for (const mark of this.tracks) { mark.life -= dt; mark.mesh.visibility = Math.min(0.22, mark.life * 0.06); if (mark.life <= 0) mark.mesh.dispose(); }
    this.tracks = this.tracks.filter(m => m.life > 0);
    // 阴影范围跟随附近物体，远处树林不挤占手机的阴影分辨率。
    this.shadowClock += dt;
    if (this.shadowClock > 0.5) {
      this.shadowClock = 0;
      const list = [...this.obstacles.values(), ...[...this.siteVisuals.values()].map(v => v.root), ...[...this.tankVisuals.values()].map(v => v.root), ...[...this.camps.values()].map(c => c.root), ...this.clouds];
      this.shadows.getShadowMap()!.renderList = list.filter(r => r.isEnabled() && distance(r.position, this.camera.position) < (this.lowQuality ? 40 : 60)).flatMap(r => r.getChildMeshes());
    }
    this.scene.render();
  }

  project(x: number, y: number, z: number) {
    const projected = Vector3.Project(new Vector3(x, y, z), Matrix.IdentityReadOnly, this.scene.getTransformMatrix(), this.camera.viewport.toGlobal(this.canvas.clientWidth, this.canvas.clientHeight));
    return { x: projected.x, y: projected.y, visible: projected.z > 0 && projected.z < 1 && projected.x > 0 && projected.x < this.canvas.clientWidth && projected.y > 0 && projected.y < this.canvas.clientHeight };
  }

  reticle(state: State, tank: Tank) {
    const length = 40;
    const start = { x: tank.x, y: groundHeight(tank.x, tank.z, this.map) + SHOT_HEIGHT, z: tank.z };
    const end = { x: start.x + Math.sin(tank.turret) * length, y: start.y + shotSlope(state, tank) * length, z: start.z + Math.cos(tank.turret) * length };
    const at = traceShot(state, tank.team, start, end)?.at ?? 1;
    return this.project(start.x + (end.x - start.x) * at, start.y + (end.y - start.y) * at, start.z + (end.z - start.z) * at);
  }
}
