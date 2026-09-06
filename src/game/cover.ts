import { mapFor, waterAt, type MapDefinition, type Point } from './maps';
import { groundSlope } from './terrain';
import type { Obstacle, State } from './types';

export const TREE_FALL_TIME = 1.2;

export type Cover = 'water' | 'timber' | null;

export const COVER_REDUCTION = { water: 0.2, timber: 0.25 };

// 模型倒伏方向与掩护区域共用同一条轴线；坡面会改变倒木的水平长度。
export function fallenTreeShape(tree: Obstacle, map: MapDefinition) {
  const dx = Math.sin(tree.rotation), dz = Math.cos(tree.rotation);
  const slope = groundSlope(tree.x, tree.z, map);
  const pitch = Math.PI / 2 - Math.atan(slope.x * dx + slope.z * dz + 0.18);
  const length = tree.height * Math.sin(pitch);
  const radius = tree.variant === 'dead' ? 0.8 : (tree.variant === 'round' ? 1.35 : tree.variant === 'birch' ? 1 : 1.15) * (tree.crown ?? 1);
  return { dx, dz, pitch, length, radius, x: tree.x + dx * 0.35, z: tree.z + dz * 0.35 };
}

export function terrainCover(point: Point, state: State): Cover {
  const map = mapFor(state.mapSize);
  for (const tree of state.obstacles) {
    if (tree.kind !== 'tree' || tree.hp > 0 || state.time < (tree.fallenAt ?? -TREE_FALL_TIME) + TREE_FALL_TIME) continue;
    if (Math.hypot(point.x - tree.x, point.z - tree.z) > tree.height + 3) continue;
    const shape = fallenTreeShape(tree, map);
    const x = point.x - shape.x, z = point.z - shape.z;
    const along = x * shape.dx + z * shape.dz;
    const nearest = Math.max(shape.length * 0.12, Math.min(shape.length * 0.85, along));
    if (Math.hypot(x - shape.dx * nearest, z - shape.dz * nearest) <= shape.radius) return 'timber';
  }
  // 车身大部进入浅水才有保护；岸边擦水和桥面都不享受减伤。
  if (waterAt(point, map) === 'shallow' && [[0.6, 0], [-0.6, 0], [0, 0.6], [0, -0.6]].every(([x, z]) =>
    waterAt({ x: point.x + x, z: point.z + z }, map) === 'shallow')) return 'water';
  return null;
}

export function coverLabel(cover: Cover) {
  return cover === 'water' ? '浅水掩护 · 减伤 20%' : cover === 'timber' ? '倒木掩护 · 减伤 25%' : '';
}
