import { clamp } from './types';
import { mapFor, type MapDefinition } from './maps';

export const TERRAIN_STEP = 2;

const smooth = (t: number) => t * t * (3 - 2 * t);

function mesa(x: number, z: number, cx: number, cz: number, rx: number, rz: number, height: number) {
  const radius = Math.hypot((x - cx) / rx, (z - cz) / rz);
  return height * smooth(clamp((1 - radius) / 0.72, 0, 1));
}

function elevation(x: number, z: number, map: MapDefinition) {
  let height = Math.max(0, ...map.hills.map(h => mesa(x, z, h.x, h.z, h.rx, h.rz, h.height)));
  // 河岸以缓坡接入统一水面；营地与出生区保持平整，换图不继承旧高度缓存。
  for (const r of map.rivers) {
    const edge = Math.max(Math.abs(x - r.x) - r.width / 2, Math.abs(z - r.z) - r.depth / 2);
    height = Math.min(height, Math.max(0, edge) * 0.65);
  }
  for (const p of [map.base, map.enemyBase, map.spawn, map.enemySpawn]) height = Math.min(height, Math.max(0, Math.hypot(x - p.x, z - p.z) - 9) * 0.6);
  return height;
}

// 配置对象各自缓存，单人、房主、客机均采样同一份三角网格。
const heights = new WeakMap<MapDefinition, Map<string, number>>();

export function terrainVertex(x: number, z: number, map = mapFor()) {
  let cache = heights.get(map);
  if (!cache) { cache = new Map(); heights.set(map, cache); }
  const key = x + ',' + z;
  let height = cache.get(key);
  if (height === undefined) {
    height = elevation(x, z, map);
    if (Math.abs(x) <= map.arena.x + 8 && Math.abs(z) <= map.arena.z + 8) cache.set(key, height);
  }
  return height;
}

export function groundHeight(x: number, z: number, map = mapFor()) {
  const x0 = Math.floor(x / TERRAIN_STEP) * TERRAIN_STEP;
  const z0 = Math.floor(z / TERRAIN_STEP) * TERRAIN_STEP;
  const u = (x - x0) / TERRAIN_STEP;
  const v = (z - z0) / TERRAIN_STEP;
  const a = terrainVertex(x0, z0, map);
  const b = terrainVertex(x0 + TERRAIN_STEP, z0, map);
  const c = terrainVertex(x0, z0 + TERRAIN_STEP, map);
  if (u + v <= 1) return a + (b - a) * u + (c - a) * v;
  const d = terrainVertex(x0 + TERRAIN_STEP, z0 + TERRAIN_STEP, map);
  return d + (c - d) * (1 - u) + (b - d) * (1 - v);
}

export function groundSlope(x: number, z: number, map = mapFor()) {
  return {
    x: (groundHeight(x + 0.8, z, map) - groundHeight(x - 0.8, z, map)) / 1.6,
    z: (groundHeight(x, z + 1, map) - groundHeight(x, z - 1, map)) / 2,
  };
}

export function slopeSpeed(x: number, z: number, dx: number, dz: number, map = mapFor()) {
  const length = Math.hypot(dx, dz);
  if (length < 0.00001) return 1;
  const slope = groundSlope(x, z, map);
  const rise = (slope.x * dx + slope.z * dz) / length;
  // 坡面路程更长，上坡略慢；下坡保持可控，不额外加速。
  return 1 / Math.sqrt(1 + rise * rise) * (1 - clamp(rise, 0, 0.8) * 0.24);
}

export type Point3 = { x: number; y: number; z: number };

export function terrainIntersection(a: Point3, b: Point3, clearance = 0.08, map = mapFor()): number | null {
  const cuts = [0, 1];
  // 在网格边和对角线上切分；每段都是线性高度，快速炮弹也不会穿过坡顶。
  for (const [from, to] of [[a.x, b.x], [a.z, b.z], [a.x + a.z, b.x + b.z]]) {
    if (Math.abs(to - from) < 0.000001) continue;
    const lo = Math.min(from, to);
    const hi = Math.max(from, to);
    for (let edge = (Math.floor(lo / TERRAIN_STEP) + 1) * TERRAIN_STEP; edge < hi; edge += TERRAIN_STEP) cuts.push((edge - from) / (to - from));
  }
  cuts.sort((x, y) => x - y);
  const gap = (t: number) => a.y + (b.y - a.y) * t - groundHeight(a.x + (b.x - a.x) * t, a.z + (b.z - a.z) * t, map) - clearance;
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
