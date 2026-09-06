import { distance, type GameMode, type Obstacle, type Tank } from './types';
import { groundHeight } from './terrain';
import { mapFor, inRegion, roadDistance, waterAt, waterBlocked, type MapDefinition, type Point } from './maps';

export function seededRandom(seed: number) {
  return () => {
    seed |= 0;
    seed = seed + 0x6d2b79f5 | 0;
    let t = Math.imul(seed ^ seed >>> 15, 1 | seed);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}

export function createMap(seed: number, mode: GameMode = 'classic', map = mapFor()): Obstacle[] {
  const random = seededRandom(seed);
  const result: Obstacle[] = [];
  const add = (kind: Obstacle['kind'], x: number, z: number, radius: number, height: number, variant?: Obstacle['variant'], team?: Tank['team'], rotation = random() * Math.PI * 2) => {
    const hp = kind === 'tree' ? 35 : kind === 'rock' ? variant === 'layered' ? 100 : 80 : 100;
    result.push({ id: result.length + 1, kind, x, z, radius, height, hp, maxHp: hp, rotation, ...(variant ? { variant } : {}), ...(team ? { team } : {}) });
  };
  const groves = Array.from({ length: Math.ceil(map.vegetation / 18) }, (_, i) => ({
    x: (random() - 0.5) * (map.arena.x * 2 - 18), z: (random() - 0.5) * (map.arena.z * 2 - 18),
    radius: 9 + random() * 9, species: (['pine', 'round', 'birch'] as const)[i % 3], tone: i % 3,
  }));
  // 林区集中生长、外围自然稀疏；道路、桥头和高草仍预留可达空间。
  for (let i = 0; i < map.vegetation * 9 && result.length < map.vegetation; i++) {
    const grove = groves[i % groves.length], a = random() * Math.PI * 2, r = random() * grove.radius;
    const scatter = i % 7 === 0;
    const x = scatter ? (random() - 0.5) * (map.arena.x * 2 - 6) : grove.x + Math.sin(a) * r;
    const z = scatter ? (random() - 0.5) * (map.arena.z * 2 - 8) : grove.z + Math.cos(a) * r;
    if (Math.abs(x) > map.arena.x - 3 || Math.abs(z) > map.arena.z - 3) continue;
    const rock = i % 9 === 0;
    const variant: Obstacle['variant'] = rock ? (['low', 'boulder', 'layered'] as const)[Math.floor(i / 9) % 3] : random() < 0.045 ? 'dead' : random() < 0.18 ? (['pine', 'round', 'birch'] as const)[i % 3] : grove.species;
    const radius = rock ? variant === 'low' ? 1.1 : 1.8 : 0.48 + random() * 0.32;
    if (roadDistance({ x, z }, map) < radius + 2.7 || waterAt({ x, z }, map) || map.bridges.some(b => inRegion({ x, z }, b, 3))) continue;
    const firstGrass = map.grass[0];
    // 出生区到第一片高草留出入口，玩家无需先开炮清树就能尝试伏击。
    if (firstGrass && (segmentCircle(map.spawn.x, map.spawn.z, firstGrass.x, map.spawn.z, x, z, radius + 1.6) !== null ||
      segmentCircle(firstGrass.x, map.spawn.z, firstGrass.x, firstGrass.z, x, z, radius + 1.6) !== null)) continue;
    if ([map.base, map.enemyBase, map.spawn, map.enemySpawn].some(p => distance(p, { x, z }) < 10)) continue;
    if (map.grass.some(g => inRegion({ x, z }, g, 1.4))) continue;
    if (result.some(o => distance(o, { x, z }) < o.radius + radius + (rock ? 1.4 : 0.4))) continue;
    const height = rock ? variant === 'low' ? 0.85 : variant === 'layered' ? 4.5 : 3 : 2.2 + Math.pow(random(), 0.8) * (variant === 'pine' ? 5.6 : variant === 'birch' ? 4.8 : 4);
    add(rock ? 'rock' : 'tree', x, z, radius, height, variant);
    if (!rock) Object.assign(result.at(-1)!, { tone: grove.tone * 2 + Math.floor(random() * 2), crown: 0.75 + random() * 0.7 });
  }
  const camp = (p: Point, facing: number, team: Tank['team']) => {
    for (const x of [-4.4, -2.2, 2.2, 4.4]) add('wall', p.x + x, p.z + facing * 4.5, 1, 1.95, undefined, team, 0);
    for (const x of [-4.4, -2.2, 0, 2.2, 4.4]) add('wall', p.x + x, p.z - facing * 4.5, 1, 1.95, undefined, team, 0);
    for (const offset of [-2.2, 0, 2.2]) for (const side of [-1, 1]) add('wall', p.x + side * 5.5, p.z + offset, 1, 1.95, undefined, team, Math.PI / 2);
  };
  camp(map.base, -1, 'player');
  if (mode === 'classic') camp(map.enemyBase, 1, 'enemy');
  return result;
}

export function blocked(x: number, z: number, obstacles: Obstacle[], radius = 0.85, mode: GameMode = 'classic', map = mapFor()) {
  if (Math.abs(x) > map.arena.x - radius || Math.abs(z) > map.arena.z - radius || waterBlocked({ x, z }, map, radius)) return true;
  if (distance({ x, z }, map.base) < map.base.radius + radius) return true;
  if (mode === 'classic' && distance({ x, z }, map.enemyBase) < map.enemyBase.radius + radius) return true;
  return obstacles.some(o => o.hp > 0 && Math.hypot(x - o.x, z - o.z) < o.radius + radius);
}

// 占用网格只在障碍摧毁后重建，避免大地图的每一步 A* 扫描全部树木。
const navigation = new WeakMap<Obstacle[], { signature: string; cells: Uint8Array }>();

const waterEdges = new WeakMap<MapDefinition, Map<number, boolean>>();

function navGrid(obstacles: Obstacle[], mode: GameMode, map: MapDefinition) {
  const signature = map.id + mode + obstacles.filter(o => o.hp > 0).map(o => o.id).join(',');
  const previous = navigation.get(obstacles);
  if (previous?.signature === signature) return previous.cells;
  const width = map.arena.x - 1, height = map.arena.z - 1;
  const cells = new Uint8Array(width * height);
  for (let id = 0; id < cells.length; id++) {
    const x = (id % width) * 2 - map.arena.x + 2, z = Math.floor(id / width) * 2 - map.arena.z + 2;
    cells[id] = blocked(x, z, obstacles, 0.95, mode, map) ? 1 : 0;
  }
  navigation.set(obstacles, { signature, cells });
  return cells;
}

class Frontier {
  private entries: { id: number; cost: number }[] = [];

  get length() { return this.entries.length; }

  push(id: number, cost: number) {
    const entry = { id, cost };
    let at = this.entries.length;
    this.entries.push(entry);
    while (at > 0) {
      const parent = (at - 1) >> 1;
      if (this.entries[parent].cost <= cost) break;
      this.entries[at] = this.entries[parent]; at = parent;
    }
    this.entries[at] = entry;
  }

  pop() {
    const first = this.entries[0], last = this.entries.pop()!;
    if (this.entries.length) {
      let at = 0;
      while (at * 2 + 1 < this.entries.length) {
        let child = at * 2 + 1;
        if (child + 1 < this.entries.length && this.entries[child + 1].cost < this.entries[child].cost) child++;
        if (last.cost <= this.entries[child].cost) break;
        this.entries[at] = this.entries[child]; at = child;
      }
      this.entries[at] = last;
    }
    return first.id;
  }
}

export function findPath(start: Point, end: Point, obstacles: Obstacle[], mode: GameMode = 'classic', map = mapFor(), exact = false) {
  const width = map.arena.x - 1, height = map.arena.z - 1;
  const point = (id: number) => ({ x: (id % width) * 2 - map.arena.x + 2, z: Math.floor(id / width) * 2 - map.arena.z + 2 });
  const cell = (p: Point) => Math.max(0, Math.min(width - 1, Math.round((p.x + map.arena.x - 2) / 2))) + Math.max(0, Math.min(height - 1, Math.round((p.z + map.arena.z - 2) / 2))) * width;
  const campTarget = distance(end, map.base) < 0.1 || (mode === 'classic' && distance(end, map.enemyBase) < 0.1);
  const arrive = exact ? 1.5 : campTarget ? 5.2 : 2.8;
  const first = cell(start), grid = navGrid(obstacles, mode, map);
  let edges = waterEdges.get(map);
  if (!edges) { edges = new Map(); waterEdges.set(map, edges); }
  const open = new Frontier();
  const came = new Int32Array(grid.length).fill(-1);
  const g = new Float64Array(grid.length).fill(Infinity);
  const h = (id: number) => distance(point(id), end);
  const closed = new Uint8Array(grid.length);
  g[first] = 0; open.push(first, h(first));
  let best = first;
  while (open.length) {
    const current = open.pop();
    if (closed[current]) continue;
    if (h(current) < h(best)) best = current;
    if (h(current) < arrive) { best = current; break; }
    closed[current] = 1;
    const p = point(current);
    for (const next of [current - 1, current + 1, current - width, current + width]) {
      if (next < 0 || next >= width * height || closed[next] || grid[next]) continue;
      const q = point(next);
      if (distance(p, q) > 2.1) continue;
      // 弯曲岸线不能仅检查端点，否则路径会切入深水边缘后让坦克卡住。
      const edgeKey = Math.min(current, next) * grid.length + Math.max(current, next);
      let crossesWater = edges.get(edgeKey);
      if (crossesWater === undefined) {
        crossesWater = [0.25, 0.5, 0.75].some(t => waterBlocked({ x: p.x + (q.x - p.x) * t, z: p.z + (q.z - p.z) * t }, map, 0.95));
        edges.set(edgeKey, crossesWater);
      }
      if (crossesWater) continue;
      const rise = groundHeight(q.x, q.z, map) - groundHeight(p.x, p.z, map);
      const cost = g[current] + (Math.hypot(2, rise) + Math.max(0, rise) * 0.24) / (waterAt(q, map) === 'shallow' ? 0.6 : 1);
      if (cost < g[next]) { came[next] = current; g[next] = cost; open.push(next, cost + h(next)); }
    }
  }
  const path: Point[] = [];
  while (best !== first && came[best] >= 0) { path.push(point(best)); best = came[best]; }
  return path.reverse();
}

export function segmentCircle(ax: number, az: number, bx: number, bz: number, cx: number, cz: number, radius: number): number | null {
  const dx = bx - ax;
  const dz = bz - az;
  const ox = ax - cx;
  const oz = az - cz;
  const a = dx * dx + dz * dz;
  const c = ox * ox + oz * oz - radius * radius;
  if (c <= 0) return 0;
  if (a < 0.000001) return null;
  const b = 2 * (ox * dx + oz * dz);
  const discriminant = b * b - 4 * a * c;
  if (discriminant < 0) return null;
  const t = (-b - Math.sqrt(discriminant)) / (2 * a);
  return t >= 0 && t <= 1 ? t : null;
}
