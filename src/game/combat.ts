import { BASE, ENEMY_BASE, clamp, distance, type State, type Tank } from './types';
import { groundHeight, groundSlope, terrainIntersection, type Point3 } from './terrain';
import { segmentCircle } from './world';

export const SHOT_HEIGHT = 1.13;

export const SHOT_RANGE = 54;

export type ShotTarget = { type: 'obstacle' | 'tank' | 'base'; id: string | number };

export function shotSlope(state: State, tank: Tank, angle = tank.turret) {
  const sx = Math.sin(angle);
  const sz = Math.cos(angle);
  const slope = groundSlope(tank.x, tank.z);
  let result = slope.x * sx + slope.z * sz;
  let nearest = SHOT_RANGE;
  const consider = (x: number, z: number, radius: number, height: number) => {
    const d = distance(tank, { x, z });
    if (d < 0.5 || d >= nearest || segmentCircle(tank.x, tank.z, tank.x + sx * SHOT_RANGE, tank.z + sz * SHOT_RANGE, x, z, radius) === null) return;
    nearest = d;
    result = (groundHeight(x, z) + height - groundHeight(tank.x, tank.z) - SHOT_HEIGHT) / d;
  };
  // 只辅助炮管仰角，水平方向仍由玩家瞄准；被山坡遮挡的目标仍会被地形拦住。
  for (const t of state.tanks) if (t.hp > 0 && t.connected && t.team !== tank.team) consider(t.x, t.z, 0.95, 1);
  for (const o of state.obstacles) if (o.hp > 0) consider(o.x, o.z, o.radius, Math.min(1.1, o.height * 0.6));
  const base = tank.team === 'enemy' ? BASE : state.mode === 'classic' ? ENEMY_BASE : null;
  if (base) consider(base.x, base.z, base.radius, 1.1);
  return clamp(result, -0.65, 0.65);
}

function segmentCylinder(a: Point3, b: Point3, x: number, z: number, radius: number, bottom: number, top: number): number | null {
  let enter = 0;
  let leave = 1;
  const dx = b.x - a.x;
  const dz = b.z - a.z;
  const ox = a.x - x;
  const oz = a.z - z;
  const aa = dx * dx + dz * dz;
  const bb = 2 * (ox * dx + oz * dz);
  const cc = ox * ox + oz * oz - radius * radius;
  if (aa < 0.000001) { if (cc > 0) return null; }
  else {
    const disc = bb * bb - 4 * aa * cc;
    if (disc < 0) return null;
    enter = Math.max(enter, (-bb - Math.sqrt(disc)) / (2 * aa));
    leave = Math.min(leave, (-bb + Math.sqrt(disc)) / (2 * aa));
  }
  const dy = b.y - a.y;
  if (Math.abs(dy) < 0.000001) { if (a.y < bottom || a.y > top) return null; }
  else {
    const near = (bottom - a.y) / dy;
    const far = (top - a.y) / dy;
    enter = Math.max(enter, Math.min(near, far));
    leave = Math.min(leave, Math.max(near, far));
  }
  return enter <= leave ? enter : null;
}

export function traceShot(state: State, team: Tank['team'], a: Point3, b: Point3): { at: number; target: ShotTarget | null } | null {
  const ground = terrainIntersection(a, b);
  let at = ground ?? Infinity;
  let target: ShotTarget | null = null;
  const check = (x: number, z: number, radius: number, height: number, candidate: ShotTarget) => {
    const y = groundHeight(x, z);
    const t = segmentCylinder(a, b, x, z, radius, y - 0.3, y + height);
    if (t !== null && t < at) { at = t; target = candidate; }
  };
  for (const o of state.obstacles) if (o.hp > 0) check(o.x, o.z, o.radius, o.height, { type: 'obstacle', id: o.id });
  for (const t of state.tanks) if (t.hp > 0 && t.connected && t.team !== team) check(t.x, t.z, 0.95, 1.65, { type: 'tank', id: t.id });
  if (team === 'enemy' && state.baseHp > 0) check(BASE.x, BASE.z, BASE.radius, 2.9, { type: 'base', id: 'player' });
  if (team === 'player' && state.mode === 'classic' && state.enemyBaseHp > 0) check(ENEMY_BASE.x, ENEMY_BASE.z, ENEMY_BASE.radius, 2.9, { type: 'base', id: 'enemy' });
  return at === Infinity ? null : { at, target };
}
