import { ARENA, BASE, ENEMY_BASE, CROSSINGS, SIDE_LANE, distance, type GameMode, type Obstacle, type Tank } from './types';
import { groundHeight } from './terrain';

export function seededRandom(seed: number) {
  return () => {
    seed |= 0;
    seed = seed + 0x6d2b79f5 | 0;
    let t = Math.imul(seed ^ seed >>> 15, 1 | seed);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}

export function createMap(seed: number, mode: GameMode = 'classic'): Obstacle[] {
  const random = seededRandom(seed);
  const result: Obstacle[] = [];
  const add = (kind: Obstacle['kind'], x: number, z: number, radius: number, height: number, team?: Tank['team']) => {
    const hp = kind === 'tree' ? 35 : kind === 'rock' ? 80 : 100;
    result.push({ id: result.length + 1, kind, x, z, radius, height, hp, maxHp: hp, rotation: random() * Math.PI * 2, ...(team ? { team } : {}) });
  };

  // 主路、两条侧翼通路和三处横向连接保持畅通，岩壁之间还能炸出捷径。
  for (const side of [-1, 1]) {
    for (const z of [-38, -34, -14, -10, 10, 14, 34]) {
      add('rock', side * (14 + random() * 2), z, 1.8 + random() * 0.6, 2.8 + random() * 2);
    }
  }
  for (let i = 0; i < 160; i++) {
    const x = (random() - 0.5) * (ARENA.x * 2 - 6);
    const z = (random() - 0.5) * (ARENA.z * 2 - 8);
    if (Math.abs(x) < 4.8 || Math.abs(Math.abs(x) - SIDE_LANE) < 2.5 || CROSSINGS.some(crossing => Math.abs(z - crossing) < 2.5)) continue;
    if (distance({ x, z }, BASE) < 9 || distance({ x, z }, ENEMY_BASE) < 9 || (Math.abs(z) > 34 && Math.abs(x) < 9)) continue;
    if (result.some(o => distance(o, { x, z }) < o.radius + 2.1)) continue;
    add('tree', x, z, 0.65, 2.6 + random() * 2.4);
  }
  const camp = (z: number, facing: number, team: Tank['team']) => {
    for (const x of [-4.4, -2.2, 2.2, 4.4]) add('wall', x, z + facing * 4.5, 1, 1.95, team);
    for (const x of [-4.4, -2.2, 0, 2.2, 4.4]) add('wall', x, z - facing * 4.5, 1, 1.95, team);
    for (const offset of [-2.2, 0, 2.2]) {
      add('wall', -5.5, z + offset, 1, 1.95, team);
      add('wall', 5.5, z + offset, 1, 1.95, team);
    }
  };
  camp(BASE.z, -1, 'player');
  if (mode === 'classic') camp(ENEMY_BASE.z, 1, 'enemy');
  return result;
}

export function blocked(x: number, z: number, obstacles: Obstacle[], radius = 0.85, mode: GameMode = 'classic') {
  if (Math.abs(x) > ARENA.x - radius || Math.abs(z) > ARENA.z - radius) return true;
  if (distance({ x, z }, BASE) < BASE.radius + radius) return true;
  if (mode === 'classic' && distance({ x, z }, ENEMY_BASE) < ENEMY_BASE.radius + radius) return true;
  return obstacles.some(o => o.hp > 0 && Math.hypot(x - o.x, z - o.z) < o.radius + radius);
}

// A* 使用当前障碍状态；障碍被摧毁后，下一次规划自然会使用新开辟的道路。
export function findPath(start: { x: number; z: number }, end: { x: number; z: number }, obstacles: Obstacle[], mode: GameMode = 'classic') {
  const step = 2;
  const minX = -ARENA.x + step;
  const minZ = -ARENA.z + step;
  const width = ARENA.x - 1;
  const height = ARENA.z - 1;
  const point = (id: number) => ({ x: (id % width) * step + minX, z: Math.floor(id / width) * step + minZ });
  const cell = (p: { x: number; z: number }) => Math.max(0, Math.min(width - 1, Math.round((p.x - minX) / step))) + Math.max(0, Math.min(height - 1, Math.round((p.z - minZ) / step))) * width;
  // 营地核心不可驶入；到达外侧射击位置即视为寻路完成，避免穷举整张大地图。
  const campTarget = distance(end, BASE) < 0.1 || (mode === 'classic' && distance(end, ENEMY_BASE) < 0.1);
  const arrive = campTarget ? 5.2 : 2.8;
  const first = cell(start);
  const open = new Set([first]);
  const came = new Map<number, number>();
  const g = new Map([[first, 0]]);
  const h = (id: number) => distance(point(id), end);
  const closed = new Set<number>();
  let best = first;
  for (let iteration = 0; iteration < width * height && open.size; iteration++) {
    let current = -1;
    let lowest = Infinity;
    for (const id of open) {
      const f = (g.get(id) ?? Infinity) + h(id);
      if (f < lowest) { current = id; lowest = f; }
    }
    if (h(current) < h(best)) best = current;
    if (h(current) < arrive) { best = current; break; }
    open.delete(current);
    closed.add(current);
    const p = point(current);
    for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const x = p.x + dx * step;
      const z = p.z + dz * step;
      if (blocked(x, z, obstacles, 0.95, mode)) continue;
      const next = cell({ x, z });
      if (closed.has(next)) continue;
      const rise = groundHeight(x, z) - groundHeight(p.x, p.z);
      const cost = (g.get(current) ?? 0) + Math.hypot(step, rise) + Math.max(0, rise) * 0.24;
      if (cost < (g.get(next) ?? Infinity)) {
        came.set(next, current);
        g.set(next, cost);
        open.add(next);
      }
    }
  }
  const path: { x: number; z: number }[] = [];
  while (best !== first && came.has(best)) { path.unshift(point(best)); best = came.get(best)!; }
  return path;
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
