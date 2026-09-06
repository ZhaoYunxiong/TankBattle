export type MapSize = 'small' | 'medium' | 'large';

export interface Point { x: number; z: number }

export interface Region extends Point { width: number; depth: number }

export type River = Region & { kind: 'shallow' | 'deep' };

export interface MapDefinition {
  id: MapSize;
  name: string;
  label: string;
  arena: Point;
  base: Point & { radius: number };
  enemyBase: Point & { radius: number };
  spawn: Point;
  enemySpawn: Point;
  hills: (Point & { rx: number; rz: number; height: number })[];
  rivers: River[];
  bridges: Region[];
  grass: Region[];
  roads: Point[][];
  restBonus: number;
  vegetation: number;
}

const small: MapDefinition = {
  id: 'small', name: '薄雾山谷', label: '小型 · 96 × 120', arena: { x: 48, z: 60 },
  base: { x: 0, z: 49, radius: 2.2 }, enemyBase: { x: 26, z: -43, radius: 2.2 },
  spawn: { x: 0, z: 40 }, enemySpawn: { x: 26, z: -34 },
  hills: [{ x: -25, z: -18, rx: 22, rz: 28, height: 8 }, { x: 25, z: 18, rx: 22, rz: 28, height: 7.2 }, { x: -35, z: 24, rx: 14, rz: 20, height: 4.2 }, { x: 35, z: -25, rx: 14, rz: 20, height: 5.4 }],
  rivers: [{ x: 0, z: -4, width: 96, depth: 8, kind: 'deep' }, { x: 24, z: -28, width: 48, depth: 4, kind: 'shallow' }],
  bridges: [{ x: 0, z: -4, width: 7, depth: 16 }, { x: -30, z: -4, width: 7, depth: 16 }],
  grass: [{ x: -8, z: 30, width: 7, depth: 9 }, { x: 9, z: -18, width: 10, depth: 8 }, { x: -23, z: 10, width: 9, depth: 10 }, { x: 35, z: -14, width: 8, depth: 8 }],
  roads: [[{ x: 0, z: 44 }, { x: 0, z: -24 }, { x: 26, z: -34 }, { x: 26, z: -40 }], [{ x: -30, z: 40 }, { x: -30, z: -40 }], [{ x: 30, z: 40 }, { x: 30, z: 4 }], ...[-24, 0, 24].map(z => [{ x: -42, z }, { x: 42, z }])],
  restBonus: 0, vegetation: 170,
};

const medium: MapDefinition = {
  id: 'medium', name: '白桦河湾', label: '中型 · 144 × 180', arena: { x: 72, z: 90 },
  base: { x: -20, z: 72, radius: 2.2 }, enemyBase: { x: 40, z: -60, radius: 2.2 },
  spawn: { x: -20, z: 63 }, enemySpawn: { x: 40, z: -51 },
  hills: [{ x: -40, z: -35, rx: 27, rz: 36, height: 11 }, { x: 32, z: 32, rx: 29, rz: 31, height: 9 }, { x: -50, z: 40, rx: 18, rz: 26, height: 6 }, { x: 55, z: -38, rx: 18, rz: 25, height: 7 }],
  rivers: [{ x: 0, z: -14, width: 144, depth: 12, kind: 'deep' }, { x: 14, z: 43, width: 100, depth: 5, kind: 'shallow' }],
  bridges: [{ x: -20, z: -14, width: 8, depth: 20 }, { x: 44, z: -14, width: 8, depth: 20 }],
  grass: [{ x: -30, z: 51, width: 12, depth: 10 }, { x: 3, z: 24, width: 14, depth: 12 }, { x: 31, z: -36, width: 11, depth: 12 }, { x: -38, z: -64, width: 15, depth: 10 }, { x: 54, z: 14, width: 10, depth: 15 }],
  roads: [[{ x: -20, z: 68 }, { x: -20, z: -40 }, { x: 40, z: -51 }, { x: 40, z: -57 }], [{ x: -20, z: 25 }, { x: 44, z: 25 }, { x: 44, z: -40 }, { x: 40, z: -51 }], [{ x: -57, z: 0 }, { x: -57, z: -60 }, { x: -20, z: -40 }]],
  restBonus: 10, vegetation: 370,
};

const large: MapDefinition = {
  id: 'large', name: '双桥远山', label: '大型 · 192 × 240', arena: { x: 96, z: 120 },
  base: { x: -40, z: 96, radius: 2.2 }, enemyBase: { x: 60, z: -78, radius: 2.2 },
  spawn: { x: -40, z: 87 }, enemySpawn: { x: 60, z: -69 },
  hills: [{ x: -61, z: 12, rx: 29, rz: 45, height: 11 }, { x: -26, z: -62, rx: 33, rz: 40, height: 10 }, { x: 60, z: 30, rx: 30, rz: 42, height: 12 }, { x: 76, z: -52, rx: 18, rz: 30, height: 7 }, { x: -73, z: 79, rx: 19, rz: 24, height: 7 }],
  rivers: [{ x: 14, z: 0, width: 14, depth: 240, kind: 'deep' }, { x: -47, z: 42, width: 98, depth: 6, kind: 'shallow' }, { x: 61, z: -26, width: 70, depth: 5, kind: 'shallow' }],
  bridges: [{ x: 14, z: 54, width: 22, depth: 8 }, { x: 14, z: -54, width: 22, depth: 8 }],
  grass: [{ x: -51, z: 74, width: 13, depth: 13 }, { x: -22, z: 19, width: 14, depth: 15 }, { x: 35, z: 65, width: 13, depth: 13 }, { x: 53, z: -43, width: 14, depth: 13 }, { x: -57, z: -72, width: 16, depth: 15 }, { x: 72, z: 3, width: 12, depth: 16 }],
  roads: [[{ x: -40, z: 92 }, { x: -40, z: 54 }, { x: 40, z: 54 }, { x: 40, z: -54 }, { x: 60, z: -69 }, { x: 60, z: -75 }], [{ x: -40, z: 54 }, { x: -14, z: 20 }, { x: -14, z: -54 }, { x: 40, z: -54 }], [{ x: -78, z: -90 }, { x: -78, z: -30 }, { x: -14, z: 20 }]],
  restBonus: 20, vegetation: 640,
};

export const MAPS: Record<MapSize, MapDefinition> = { small, medium, large };

export const mapFor = (size: MapSize = 'small') => MAPS[size];

export function inRegion(p: Point, r: Region, margin = 0) {
  return Math.abs(p.x - r.x) <= r.width / 2 + margin && Math.abs(p.z - r.z) <= r.depth / 2 + margin;
}

export function waterAt(p: Point, map: MapDefinition) {
  if (map.bridges.some(b => inRegion(p, b))) return null;
  return map.rivers.find(r => riverDistance(p, r) <= 0)?.kind ?? null;
}

export function waterBlocked(p: Point, map: MapDefinition, radius: number) {
  return map.rivers.some(r => r.kind === 'deep' && riverDistance(p, r) <= radius) &&
    !map.bridges.some(b => inRegion(p, b, -radius));
}

export function riverSection(r: River, along: number) {
  return { offset: Math.sin(along * 0.085) * 0.55 + Math.sin(along * 0.19) * 0.2, half: Math.min(r.width, r.depth) / 2 + Math.sin(along * 0.12 + 1) * 0.25 };
}

// 水面造型、地形缓坡与坦克碰撞共用岸线，视觉上能走的桥实际也能走。
export function riverDistance(p: Point, r: River) {
  const horizontal = r.width > r.depth;
  const along = horizontal ? p.x - r.x : p.z - r.z;
  const cross = horizontal ? p.z - r.z : p.x - r.x;
  const section = riverSection(r, along);
  return Math.max(Math.abs(along) - Math.max(r.width, r.depth) / 2, Math.abs(cross - section.offset) - section.half);
}

export function roadDistance(p: Point, map: MapDefinition) {
  let best = Infinity;
  for (const road of map.roads) for (let i = 1; i < road.length; i++) {
    const a = road[i - 1], b = road[i];
    const dx = b.x - a.x, dz = b.z - a.z;
    const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.z - a.z) * dz) / (dx * dx + dz * dz)));
    best = Math.min(best, Math.hypot(p.x - a.x - dx * t, p.z - a.z - dz * t));
  }
  return best;
}
