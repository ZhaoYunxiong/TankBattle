import type { Loadout } from './factory';

export type TankKind = 'standard' | 'scout' | 'heavy' | 'engineer';

export type EnemyKind = Exclude<TankKind, 'engineer'>;

// 车型数据由战斗、选车、工厂和联机共用；标准型保持原来的驾驶与开火节奏。
export const VEHICLES = {
  standard: { name: '标准突击型', role: '均衡全能', description: '熟悉的山谷守卫者。火力、防护与机动均衡，适合独自出征。', trait: '灵活应变 · 加速与蓄力兼备', cost: 0, hp: 120, speed: 6, damage: 20, reload: 1, chargeDamage: 56, chargeSeconds: 1.6, chargeReload: 1.35, boostDrain: 12.5, radius: 0.95, scale: 1 },
  scout: { name: '轻型游击坦克', role: '绕后夺点', description: '轻巧的车体与高效履带，擅长抢占据点、穿林绕行和快速支援。', trait: '轻量履带 · 更快移动、更长加速', cost: 240, hp: 90, speed: 7.3, damage: 16, reload: 0.85, chargeDamage: 44, chargeSeconds: 1.25, chargeReload: 1.2, boostDrain: 9, radius: 0.82, scale: 0.86 },
  heavy: { name: '重型突破坦克', role: '正面推进', description: '宽履带、厚装甲与重炮，适合守住桥头和推进拆塔，注意移动与装填较慢。', trait: '正面装甲 · 前方 120° 来弹减伤 20%', cost: 360, hp: 180, speed: 4.5, damage: 28, reload: 1.45, chargeDamage: 78, chargeSeconds: 2, chargeReload: 1.85, boostDrain: 16, radius: 1.06, scale: 1.12 },
  engineer: { name: '工程支援坦克', role: '脱战维修', description: '携带维修设备，脱战后自动维护自己、附近队友与友方防御塔，火力较低。', trait: '战地维修 · 脱战 8 秒后自动维修', cost: 300, hp: 110, speed: 5.7, damage: 16, reload: 1.15, chargeDamage: 44, chargeSeconds: 1.6, chargeReload: 1.5, boostDrain: 12.5, radius: 0.95, scale: 1 },
} as const;

export const vehicleKinds = Object.keys(VEHICLES) as TankKind[];

export const isTankKind = (kind: unknown): kind is TankKind => typeof kind === 'string' && Object.hasOwn(VEHICLES, kind);

export const cleanTankKind = (kind: unknown): TankKind => isTankKind(kind) ? kind : 'standard';

export const vehicleStats = (kind: TankKind, upgrades: Loadout) => ({
  ...VEHICLES[kind],
  hp: Math.round(VEHICLES[kind].hp * (1 + upgrades.armor * 0.08)),
  speed: VEHICLES[kind].speed * (1 + upgrades.mobility * 0.04),
  reload: VEHICLES[kind].reload * (1 - upgrades.reload * 0.04),
  chargeReload: VEHICLES[kind].chargeReload * (1 - upgrades.reload * 0.04),
});

export const ENGINEER = { range: 7, peace: 8, cooldown: 10, self: 8, ally: 12, tower: 12 };

export const tankRadius = (tank: { team: string; kind: TankKind }) => tank.team === 'player' ? VEHICLES[tank.kind].radius : 0.95;
