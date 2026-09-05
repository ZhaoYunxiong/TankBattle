import { ARENA, clamp } from './types';

export const TERRAIN_STEP = 2;

const smooth = (t: number) => t * t * (3 - 2 * t);

function mesa(x: number, z: number, cx: number, cz: number, rx: number, rz: number, height: number) {
  const radius = Math.hypot((x - cx) / rx, (z - cz) / rz);
  return height * smooth(clamp((1 - radius) / 0.72, 0, 1));
}

function elevation(x: number, z: number) {
  // 中央谷道和营地保留平整空地；两侧台地通过宽缓坡连通，没有不可驶出的凹坑。
  return Math.max(
    mesa(x, z, -25, -18, 22, 28, 8),
    mesa(x, z, 25, 18, 22, 28, 7.2),
    mesa(x, z, -35, 24, 14, 20, 4.2),
    mesa(x, z, 35, -25, 14, 20, 5.4),
  );
}

// 房主模拟、客机和渲染共用同一网格，坡面碰撞高度与实际三角形严格一致。
const heights = new Map<string, number>();

export function terrainVertex(x: number, z: number) {
  const key = x + ',' + z;
  let height = heights.get(key);
  if (height === undefined) {
    height = elevation(x, z);
    if (Math.abs(x) <= ARENA.x + 8 && Math.abs(z) <= ARENA.z + 8) heights.set(key, height);
  }
  return height;
}

export function groundHeight(x: number, z: number) {
  const x0 = Math.floor(x / TERRAIN_STEP) * TERRAIN_STEP;
  const z0 = Math.floor(z / TERRAIN_STEP) * TERRAIN_STEP;
  const u = (x - x0) / TERRAIN_STEP;
  const v = (z - z0) / TERRAIN_STEP;
  const a = terrainVertex(x0, z0);
  const b = terrainVertex(x0 + TERRAIN_STEP, z0);
  const c = terrainVertex(x0, z0 + TERRAIN_STEP);
  if (u + v <= 1) return a + (b - a) * u + (c - a) * v;
  const d = terrainVertex(x0 + TERRAIN_STEP, z0 + TERRAIN_STEP);
  return d + (c - d) * (1 - u) + (b - d) * (1 - v);
}

export function groundSlope(x: number, z: number) {
  return {
    x: (groundHeight(x + 0.8, z) - groundHeight(x - 0.8, z)) / 1.6,
    z: (groundHeight(x, z + 1) - groundHeight(x, z - 1)) / 2,
  };
}

export function slopeSpeed(x: number, z: number, dx: number, dz: number) {
  const length = Math.hypot(dx, dz);
  if (length < 0.00001) return 1;
  const slope = groundSlope(x, z);
  const rise = (slope.x * dx + slope.z * dz) / length;
  // 坡面路程更长，上坡略慢；下坡保持可控，不额外加速。
  return 1 / Math.sqrt(1 + rise * rise) * (1 - clamp(rise, 0, 0.8) * 0.24);
}

export type Point3 = { x: number; y: number; z: number };

export function terrainIntersection(a: Point3, b: Point3, clearance = 0.08): number | null {
  const cuts = [0, 1];
  // 在网格边和对角线上切分；每段都是线性高度，快速炮弹也不会穿过坡顶。
  for (const [from, to] of [[a.x, b.x], [a.z, b.z], [a.x + a.z, b.x + b.z]]) {
    if (Math.abs(to - from) < 0.000001) continue;
    const lo = Math.min(from, to);
    const hi = Math.max(from, to);
    for (let edge = (Math.floor(lo / TERRAIN_STEP) + 1) * TERRAIN_STEP; edge < hi; edge += TERRAIN_STEP) cuts.push((edge - from) / (to - from));
  }
  cuts.sort((x, y) => x - y);
  const gap = (t: number) => a.y + (b.y - a.y) * t - groundHeight(a.x + (b.x - a.x) * t, a.z + (b.z - a.z) * t) - clearance;
  let previous = 0;
  let previousGap = gap(0);
  if (previousGap <= 0) return 0;
  for (const t of cuts.slice(1)) {
    const currentGap = gap(t);
    if (currentGap <= 0) return previous + (t - previous) * previousGap / (previousGap - currentGap);
    previous = t;
    previousGap = currentGap;
  }
  return null;
}
