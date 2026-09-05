import { ARENA, BASE, distance, type Obstacle } from './types';

export function seededRandom(seed: number) {
  return () => {
    seed |= 0;
    seed = seed + 0x6d2b79f5 | 0;
    let t = Math.imul(seed ^ seed >>> 15, 1 | seed);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}

export function createMap(seed: number): Obstacle[] {
  const random = seededRandom(seed);
  const result: Obstacle[] = [];
  const add = (kind: Obstacle['kind'], x: number, z: number, radius: number, height: number) => {
    const hp = kind === 'tree' ? 35 : kind === 'rock' ? 80 : 100;
    result.push({ id: result.length + 1, kind, x, z, radius, height, hp, maxHp: hp, rotation: random() * Math.PI * 2 });
  };

  // 保留贯通山谷的主路；两侧岩壁可以炸开，形成新的侧翼通道。
  for (const side of [-1, 1]) {
    for (let row = 0; row < 6; row++) {
      add('rock', side * (8 + random() * 2), -21 + row * 6.2, 1.8 + random() * 0.6, 2.8 + random() * 2);
    }
  }
  for (let i = 0; i < 65; i++) {
    const x = (random() - 0.5) * 49;
    const z = (random() - 0.5) * 53;
    if (Math.abs(x) < 3.7 || distance({ x, z }, BASE) < 9 || (z > 12 && Math.abs(x) < 8)) continue;
    if (result.some(o => distance(o, { x, z }) < o.radius + 2.1)) continue;
    add('tree', x, z, 0.65, 2.6 + random() * 2.4);
  }
  for (const x of [-4.4, -2.2, 2.2, 4.4]) add('wall', x, 18.5, 1, 1.5);
  for (const x of [-4.4, -2.2, 0, 2.2, 4.4]) add('wall', x, 27.5, 1, 1.5);
  for (const z of [20.7, 22.9, 25.1]) {
    add('wall', -5.5, z, 1, 1.5);
    add('wall', 5.5, z, 1, 1.5);
  }
  return result;
}

export function blocked(x: number, z: number, obstacles: Obstacle[], radius = 0.85) {
  if (Math.abs(x) > ARENA.x - radius || Math.abs(z) > ARENA.z - radius) return true;
  if (distance({ x, z }, BASE) < BASE.radius + radius) return true;
  return obstacles.some(o => o.hp > 0 && Math.hypot(x - o.x, z - o.z) < o.radius + radius);
}

// A* 使用当前障碍状态；障碍被摧毁后，下一次规划自然会使用新开辟的道路。
export function findPath(start: { x: number; z: number }, end: { x: number; z: number }, obstacles: Obstacle[]) {
  const step = 2;
  const width = 27;
  const height = 32;
  const point = (id: number) => ({ x: (id % width) * step - 26, z: Math.floor(id / width) * step - 31 });
  const cell = (p: { x: number; z: number }) => Math.max(0, Math.min(width - 1, Math.round((p.x + 26) / step))) + Math.max(0, Math.min(height - 1, Math.round((p.z + 31) / step))) * width;
  const first = cell(start);
  const open = new Set([first]);
  const came = new Map<number, number>();
  const g = new Map([[first, 0]]);
  const h = (id: number) => distance(point(id), end);
  const closed = new Set<number>();
  let best = first;
  for (let iteration = 0; iteration < 700 && open.size; iteration++) {
    let current = -1;
    let lowest = Infinity;
    for (const id of open) {
      const f = (g.get(id) ?? Infinity) + h(id);
      if (f < lowest) { current = id; lowest = f; }
    }
    if (h(current) < h(best)) best = current;
    if (h(current) < 2.8) { best = current; break; }
    open.delete(current);
    closed.add(current);
    const p = point(current);
    for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const x = p.x + dx * step;
      const z = p.z + dz * step;
      if (blocked(x, z, obstacles, 0.95)) continue;
      const next = cell({ x, z });
      if (closed.has(next)) continue;
      const cost = (g.get(current) ?? 0) + step;
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
