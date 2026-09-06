import { inRegion, mapFor } from './maps';
import { groundHeight, terrainIntersection } from './terrain';
import { distance, type State, type Tank } from './types';
import { segmentCircle } from './world';

export const SCOUT_RANGE = 28;

export const EXPLORE_STEP = 8;

export function concealed(tank: Tank, state: State) {
  return tank.hp > 0 && state.time >= tank.exposedUntil &&
    mapFor(state.mapSize).grass.some(g => inRegion(tank, g, -1.2));
}

export function sightClear(state: State, from: { x: number; z: number }, to: { x: number; z: number }, targetHeight = 1.2) {
  const map = mapFor(state.mapSize);
  const a = { ...from, y: groundHeight(from.x, from.z, map) + 1.4 };
  const b = { ...to, y: groundHeight(to.x, to.z, map) + targetHeight };
  if (terrainIntersection(a, b, 0.08, map) !== null) return false;
  return !state.obstacles.some(o => {
    if (o.hp <= 0) return false;
    const at = segmentCircle(a.x, a.z, b.x, b.z, o.x, o.z, o.radius);
    return at !== null && at < 0.98 && a.y + (b.y - a.y) * at <= groundHeight(o.x, o.z, map) + o.height;
  });
}

export function visibleTo(state: State, observer: Tank, target: Tank, range = SCOUT_RANGE) {
  return target.hp > 0 && target.connected && !concealed(target, state) && distance(observer, target) < range && sightClear(state, observer, target);
}

export function exploredCell(x: number, z: number, state: State) {
  const map = mapFor(state.mapSize);
  const width = Math.ceil(map.arena.x * 2 / EXPLORE_STEP);
  return Math.floor((x + map.arena.x) / EXPLORE_STEP) + Math.floor((z + map.arena.z) / EXPLORE_STEP) * width;
}

// 仅由房主更新，全队共用侦察结果。自由相机完全不参与发现判定。
export function updateVisibility(state: State) {
  const map = mapFor(state.mapSize);
  const players = state.tanks.filter(t => t.team === 'player' && t.connected && t.hp > 0);
  // 普通敌军全局显示；高草是唯一的单位隐蔽规则，与敌营侦察分开。
  state.visibleEnemies = state.tanks.filter(t => t.team === 'enemy' && t.hp > 0 && t.connected && !concealed(t, state)).map(t => t.id);
  if (state.mode === 'classic' && !state.enemyBaseDiscovered) {
    state.enemyBaseDiscovered = players.some(p => distance(p, map.enemyBase) < SCOUT_RANGE && sightClear(state, p, map.enemyBase, 2.7));
  }
  const explored = new Set(state.explored);
  const width = Math.ceil(map.arena.x * 2 / EXPLORE_STEP), height = Math.ceil(map.arena.z * 2 / EXPLORE_STEP);
  if (state.mode === 'defense' || state.enemyBaseDiscovered) {
    if (state.explored.length !== width * height) state.explored = Array.from({ length: width * height }, (_, i) => i);
    return;
  }
  for (const p of players) {
    const cx = Math.floor((p.x + map.arena.x) / EXPLORE_STEP), cz = Math.floor((p.z + map.arena.z) / EXPLORE_STEP);
    for (let iz = Math.max(0, cz - 4); iz <= Math.min(height - 1, cz + 4); iz++) for (let ix = Math.max(0, cx - 4); ix <= Math.min(width - 1, cx + 4); ix++) {
      const id = ix + iz * width;
      if (explored.has(id)) continue;
      const q = { x: ix * EXPLORE_STEP - map.arena.x + 4, z: iz * EXPLORE_STEP - map.arena.z + 4 };
      if (distance(p, q) < SCOUT_RANGE && sightClear(state, p, q)) explored.add(id);
    }
  }
  state.explored = [...explored];
}
