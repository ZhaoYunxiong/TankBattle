import { mapFor, inRegion, waterAt, roadDistance } from './maps';
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
import { VertexData } from '@babylonjs/core/Meshes/mesh.vertexData';
import { angleDiff, clamp, COLORS, distance, type BattleEvent, type GameMode, type Obstacle, type State, type Tank } from './types';
import { seededRandom, segmentCircle } from './world';
import { BattleAudio } from './audio';
import { CAMERA } from './camera';
import { groundHeight, groundSlope, terrainVertex, terrainIntersection, TERRAIN_STEP } from './terrain';
import { SHOT_HEIGHT, shotSlope, traceShot } from './combat';

type TankVisual = { root: TransformNode; chassis: TransformNode; gun: TransformNode; turret: TransformNode; barrel: Mesh; body: Mesh; shield: Mesh; warning: Mesh; wheels: Mesh[]; speed: number; trailAt: number };

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

  private fallen = new Map<number, number>();

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
    this.scene.fogMode = Scene.FOGMODE_LINEAR;
    this.scene.fogColor = Color3.FromHexString('#d6dfd8');
    this.scene.fogStart = 60;
    this.scene.fogEnd = 145;
    this.camera = new FreeCamera('camera', new Vector3(18, 25, 36), this.scene);
    this.camera.minZ = 0.15;
    this.camera.maxZ = 220;
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
    this.flags = []; this.grassPatches = []; this.clouds = []; this.ripples = []; this.fallen.clear();
    for (const mark of this.tracks) mark.mesh.dispose();
    this.tracks = [];
    for (const visual of this.tankVisuals.values()) visual.root.dispose();
    this.tankVisuals.clear();
    this.camps.clear();
    this.seed = state.seed;
    this.map = mapFor(state.mapSize);
    this.mode = state.mode;
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
      const water = this.box(river.kind + '-river', river.width, 0.025, river.depth, river.kind === 'deep' ? '#629b9f' : '#9dc5bb', this.terrain);
      water.position.set(river.x, 0.025, river.z);
      const horizontal = river.width > river.depth;
      const count = Math.ceil(Math.max(river.width, river.depth) / 8);
      for (let i = 0; i < count; i++) {
        const ripple = this.box('water-current', horizontal ? 2.4 : 0.12, 0.014, horizontal ? 0.12 : 2.4, '#d2e6d7', this.terrain);
        ripple.position.set(river.x + (horizontal ? (i / count - 0.5) * river.width : (random() - 0.5) * river.width * 0.6), 0.05, river.z + (horizontal ? (random() - 0.5) * river.depth * 0.6 : (i / count - 0.5) * river.depth));
        this.ripples.push(ripple);
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

  private drivingTrail(tank: Tank) {
    if (waterAt(tank, this.map) === 'shallow') {
      this.particle(tank.x, groundHeight(tank.x, tank.z, this.map) + 0.2, tank.z, '#c8e5de', false, 0.18);
      return;
    }
    const x = tank.x - Math.sin(tank.angle), z = tank.z - Math.cos(tank.angle);
    this.particle(x, groundHeight(x, z, this.map) + 0.15, z, '#c6bfa3', true, 0.2);
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
      const trunk = this.cylinder('trunk', 0.18, 0.42, o.variant === 'dead' ? o.height : o.variant === 'birch' ? o.height * 0.8 : 1.4, o.variant === 'birch' ? '#e5dfc9' : '#8c7860', root);
      trunk.position.y = o.variant === 'dead' ? o.height / 2 : o.variant === 'birch' ? o.height * 0.4 : 0.7;
      if (o.variant === 'round') {
        const crown = MeshBuilder.CreateIcoSphere('round-crown', { radius: 1, subdivisions: 1, flat: true }, this.scene);
        crown.parent = root; crown.material = this.material('#8da582');
        crown.scaling.set(1.25, (o.height - 1.2) / 2, 1.2); crown.position.y = (o.height + 1.2) / 2;
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
    root.setEnabled(o.hp > 0);
    this.obstacles.set(o.id, root);
  }

  private buildTank(t: Tank): TankVisual {
    const root = new TransformNode(t.id, this.scene);
    const chassis = new TransformNode('suspension', this.scene);
    chassis.parent = root;
    const color = t.team === 'player' ? COLORS[t.color % 4] : t.kind === 'heavy' ? '#ad6e5d' : t.kind === 'scout' ? '#bf8964' : '#bd7967';
    const body = this.box('hull', 1.65, 0.52, 2.15, color, chassis);
    body.position.y = 0.56;
    const deck = this.box('deck', 1.4, 0.2, 1.8, color, chassis);
    deck.position.y = 0.86;
    const wheels: Mesh[] = [];
    for (const side of [-1, 1]) {
      const tread = this.box('track', 0.42, 0.52, 2.35, '#50594e', chassis);
      tread.position.set(side * 0.91, 0.36, 0);
      for (let i = -1; i <= 1; i++) {
        const wheel = this.cylinder('wheel', 0.4, 0.4, 0.45, '#76806b', chassis, 8);
        wheel.rotation.z = Math.PI / 2;
        wheels.push(wheel);
        wheel.position.set(side * 0.92, 0.35, i * 0.7);
      }
      const strip = this.box('track-guard', 0.5, 0.12, 2.25, color, chassis);
      strip.position.set(side * 0.91, 0.71, 0);
      const light = this.box('headlight', 0.18, 0.14, 0.08, '#f2dda9', chassis);
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
    const gun = new TransformNode('gun-elevation', this.scene);
    gun.parent = turret;
    gun.position.y = 0.22;
    const barrel = this.cylinder('barrel', 0.18, 0.26, 1.65, color, gun);
    barrel.rotation.x = Math.PI / 2;
    barrel.position.set(0, 0, 1.13);
    const muzzle = this.cylinder('muzzle', 0.28, 0.28, 0.25, '#465a4e', gun);
    muzzle.rotation.x = Math.PI / 2;
    muzzle.position.set(0, 0, 1.94);
    const warning = MeshBuilder.CreateSphere('aim-warning', { diameter: 0.42, segments: 4 }, this.scene);
    warning.parent = gun;
    warning.position.set(0, 0, 2.12);
    warning.material = this.material('#ffe6a0', true);
    warning.setEnabled(false);
    const stripe = this.box('stripe', 0.13, 0.018, 0.6, '#f2e5c8', chassis);
    stripe.position.set(0.45, 0.973, -0.55);
    const antenna = this.cylinder('antenna', 0.025, 0.035, 0.75, '#4b594c', turret);
    antenna.position.set(0.4, 0.85, -0.4);
    const shield = MeshBuilder.CreateTorus('shield', { diameter: 2.75, thickness: 0.07, tessellation: 24 }, this.scene);
    shield.material = this.material('#b1e5d4', true);
    shield.parent = root;
    shield.position.y = 0.11;
    for (const mesh of root.getChildMeshes()) this.shadows.addShadowCaster(mesh);
    if (t.kind === 'heavy') root.scaling.setAll(1.12);
    return { root, chassis, gun, turret, barrel, body, shield, warning, wheels, speed: 0, trailAt: 0 };
  }

  private particle(x: number, y: number, z: number, color: string, smoke = false, force = 1, material?: BattleEvent['material']) {
    if (this.particles.length >= (this.lowQuality ? 65 : 150)) return;
    const m = smoke
      ? MeshBuilder.CreateIcoSphere('smoke', { radius: 0.3, subdivisions: 1, flat: true }, this.scene)
      : material === 'rock' ? MeshBuilder.CreateIcoSphere('stone-fragment', { radius: 0.22 + Math.random() * 0.24, subdivisions: 0, flat: true }, this.scene) : MeshBuilder.CreateBox(material === 'wall' ? 'wall-block' : 'debris', { size: material === 'wall' ? 0.45 : 0.12 + Math.random() * 0.14 }, this.scene);
    m.material = this.material(color, !smoke && color === '#f5bc75');
    m.position.set(x, y, z);
    m.rotation.set(Math.random() * 6, Math.random() * 6, Math.random() * 6);
    if (smoke && force < 1) m.scaling.setAll(0.45);
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
    this.audio.play(event.kind, falloff);
    if (event.kind === 'destroy') {
      this.shake = Math.min(0.7, this.shake + event.size * 0.2 * falloff);
      if (event.material === 'tree' && event.obstacle !== undefined) this.fallen.set(event.obstacle, 0);
      for (let i = 0; i < (this.lowQuality ? 8 : 18); i++) this.particle(event.x, groundHeight(event.x, event.z, this.map) + 1, event.z, event.material === 'tree' ? '#91a080' : event.material ? '#c8bba2' : i % 3 ? '#a59b84' : '#f5bc75', false, event.size, event.material);
      for (let i = 0; i < 5; i++) this.particle(event.x, groundHeight(event.x, event.z, this.map) + 1, event.z, '#9b9e90', true);
    } else if (event.kind === 'shot') {
      const tank = this.tankVisuals.get(event.owner ?? '');
      if (tank) {
        tank.barrel.position.z = 0.92;
        const muzzle = tank.turret.getAbsolutePosition();
        const angle = tank.root.rotation.y + tank.turret.rotation.y;
        for (let i = 0; i < 4; i++) this.particle(muzzle.x + Math.sin(angle) * 2, muzzle.y + 0.2 - Math.sin(tank.gun.rotation.x) * 2, muzzle.z + Math.cos(angle) * 2, '#f5bc75');
      }
      if (event.owner === local?.id) this.shake = Math.min(0.25, this.shake + 0.1);
    } else if (event.kind === 'hit') {
      this.shake = Math.min(0.4, this.shake + 0.08 * falloff);
      for (let i = 0; i < 4; i++) this.particle(event.x, event.y ?? groundHeight(event.x, event.z, this.map) + 0.7, event.z, '#edc788');
    } else if (event.kind === 'pickup') {
      for (let i = 0; i < 8; i++) this.particle(event.x, groundHeight(event.x, event.z, this.map) + 1, event.z, '#b5ddbc');
    }
  }

  render(state: State, localId: string, dt: number, menu: boolean) {
    this.elapsed += dt;
    if (this.seed !== state.seed || this.mode !== state.mode || this.map.id !== state.mapSize) this.buildLandscape(state);
    const lerp = 1 - Math.exp(-dt * 20);
    for (const o of state.obstacles) {
      const mesh = this.obstacles.get(o.id);
      if (mesh) {
        mesh.setEnabled((o.hp > 0 || this.fallen.has(o.id)) && (o.team !== 'enemy' || state.enemyBaseDiscovered) && (menu || distance(o, this.camera.position) < (this.lowQuality ? 75 : 105)));
        mesh.scaling.y = o.hp > 0 ? 0.92 + o.hp / o.maxHp * 0.08 : 1;
        if (o.kind === 'tree' && o.hp > 0) { mesh.rotation.z = Math.sin(this.elapsed * 1.3 + o.id) * 0.018; mesh.rotation.x = Math.cos(this.elapsed + o.id) * 0.012; }
        if (this.fallen.has(o.id)) {
          const age = this.fallen.get(o.id)! + dt; this.fallen.set(o.id, age);
          mesh.rotation.z = Math.min(1.5, age * age * 1.5);
          for (const part of mesh.getChildMeshes()) part.visibility = clamp(2.5 - age, 0, 1);
          if (age > 2.5) { mesh.setEnabled(false); this.fallen.delete(o.id); }
        }
      }
    }
    for (const t of state.tanks) {
      let visual = this.tankVisuals.get(t.id);
      if (!visual) {
        visual = this.buildTank(t);
        visual.root.position.set(t.x, groundHeight(t.x, t.z, this.map), t.z);
        visual.root.rotation.y = t.angle;
        this.tankVisuals.set(t.id, visual);
      }
      visual.root.setEnabled(t.hp > 0 && t.connected && (t.team === 'player' || state.visibleEnemies.includes(t.id)));
      const travel = Math.hypot(t.x - visual.root.position.x, t.z - visual.root.position.z) * lerp;
      const speed = travel / Math.max(dt, 0.001);
      const acceleration = clamp((speed - visual.speed) * 0.035, -0.05, 0.05);
      visual.speed = speed;
      for (const wheel of visual.wheels) wheel.rotation.x += travel * 4;
      if (visual.root.isEnabled() && speed > 0.5 && this.elapsed > visual.trailAt) { this.drivingTrail(t); visual.trailAt = this.elapsed + (this.lowQuality ? 0.3 : 0.18); }
      visual.root.position.x += (t.x - visual.root.position.x) * lerp;
      visual.root.position.z += (t.z - visual.root.position.z) * lerp;
      visual.root.position.y = groundHeight(visual.root.position.x, visual.root.position.z, this.map);
      visual.root.rotation.y += angleDiff(t.angle, visual.root.rotation.y) * lerp;
      const slope = groundSlope(visual.root.position.x, visual.root.position.z, this.map);
      const heading = visual.root.rotation.y;
      visual.chassis.rotation.x = -Math.atan(slope.x * Math.sin(heading) + slope.z * Math.cos(heading)) + acceleration;
      visual.chassis.rotation.z = Math.atan(slope.x * Math.cos(heading) - slope.z * Math.sin(heading)) + Math.sin(this.elapsed * 11) * Math.min(0.012, speed * 0.002);
      visual.gun.rotation.x += (-Math.atan(shotSlope(state, t)) - visual.gun.rotation.x) * lerp;
      visual.turret.rotation.y += angleDiff(t.turret - visual.root.rotation.y, visual.turret.rotation.y) * lerp;
      visual.barrel.position.z += (1.13 - visual.barrel.position.z) * Math.min(1, dt * 12);
      visual.shield.setEnabled(t.shield > 0 || t.buffs.armor > 0);
      visual.shield.visibility = 0.65 + Math.sin(this.elapsed * 6) * 0.25;
      visual.warning.setEnabled(t.team === 'enemy' && t.warning > 0);
      visual.warning.scaling.setAll(0.65 + t.warning * 0.9);
      visual.warning.visibility = 0.65 + Math.sin(this.elapsed * 22) * 0.3;
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
    if (!menu) for (const event of state.events) if (event.id > this.seenEvent) this.handleEvent(event, local);
    if (state.events.length) this.seenEvent = state.events[state.events.length - 1].id;
    this.smokeClock += dt;
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
    this.shake = Math.max(0, this.shake - dt * 1.3);
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
        this.camera.position.x += (Math.random() - 0.5) * this.shake;
        this.camera.position.y += (Math.random() - 0.5) * this.shake;
      }
      // 只淡化确实位于镜头和坦克之间的树冠。
      for (const o of state.obstacles) if (o.kind === 'tree' && o.hp > 0) {
        const at = segmentCircle(this.camera.position.x, this.camera.position.z, focus.x, focus.z, o.x, o.z, 1.5);
        for (const mesh of this.obstacles.get(o.id)?.getChildMeshes() ?? []) mesh.visibility = at !== null ? 0.25 : 1;
      }
    }
    for (const flag of this.flags) { flag.rotation.y = Math.sin(this.elapsed * 3 + flag.position.x) * 0.18; flag.scaling.z = 1 + Math.sin(this.elapsed * 4) * 0.12; }
    for (const grass of this.grassPatches) grass.rotation.z = Math.sin(this.elapsed * 1.7 + grass.position.x) * 0.014;
    for (const ripple of this.ripples) ripple.visibility = 0.2 + (Math.sin(this.elapsed * 1.5 + ripple.position.x + ripple.position.z) + 1) * 0.18;
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
      const list = [...this.obstacles.values(), ...[...this.tankVisuals.values()].map(v => v.root), ...[...this.camps.values()].map(c => c.root), ...this.clouds];
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
