import { mapFor, type MapSize } from './maps';
import type { Loadout } from './factory';

export type Phase = 'lobby' | 'intermission' | 'battle' | 'won' | 'lost';

export type Power = 'rapid' | 'burst' | 'heal' | 'armor';

export type GameMode = 'classic' | 'defense';

export type Difficulty = 'casual' | 'normal' | 'challenge';

export const MODES: Record<GameMode, { name: string; description: string }> = {
  classic: { name: '经典模式', description: '守住己方营地，攻破敌军阵地' },
  defense: { name: '防守模式', description: '守护营地，击退五波来袭敌军' },
};

export interface Input {
  moveX: number;
  moveZ: number;
  aim: number;
  fire: boolean;
  boost?: boolean;
  chargeMode?: boolean;
  cancelCharge?: number;
}

export interface Tank {
  id: string;
  name: string;
  team: 'player' | 'enemy';
  kind: 'scout' | 'standard' | 'heavy';
  color: number;
  x: number;
  z: number;
  angle: number;
  turret: number;
  hp: number;
  maxHp: number;
  cooldown: number;
  stamina: number;
  boosting: boolean;
  boostLocked: boolean;
  charging: boolean;
  charge: number;
  recoil: number;
  warning: number;
  exposedUntil: number;
  lives: number;
  respawn: number;
  shield: number;
  buffs: Record<Power, number>;
  score: number;
  connected: boolean;
  ready: boolean;
  upgrades: Loadout;
  stats: { kills: number; assists: number; defenses: number; baseDamage: number; teamBonus: number; objectives: number };
}

export interface Obstacle {
  id: number;
  kind: 'tree' | 'rock' | 'wall';
  variant?: 'pine' | 'round' | 'birch' | 'dead' | 'low' | 'boulder' | 'layered';
  x: number;
  z: number;
  radius: number;
  height: number;
  hp: number;
  maxHp: number;
  rotation: number;
  team?: Tank['team'];
  tone?: number;
  crown?: number;
  fallenAt?: number;
}

export interface Shell {
  id: number;
  site?: number;
  owner: string;
  team: Tank['team'];
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  damage: number;
  life: number;
  power?: number;
}

export interface Drop {
  id: number;
  kind: Power;
  x: number;
  z: number;
  life: number;
}

export type SiteTeam = Tank['team'] | 'neutral';

export interface Site {
  id: number;
  kind: 'tower' | 'supply';
  x: number;
  z: number;
  team: SiteTeam;
  capturable: boolean;
  hp: number;
  maxHp: number;
  radius: number;
  capture: number;
  captureTeam: SiteTeam;
  contested: boolean;
  rewarded: boolean;
  cooldown: number;
  angle: number;
  warning: number;
  target: string | null;
}

export interface BattleEvent {
  id: number;
  kind: 'shot' | 'hit' | 'destroy' | 'pickup' | 'wave' | 'capture';
  x: number;
  y?: number;
  z: number;
  size: number;
  owner?: string;
  power?: Power;
  obstacle?: number;
  material?: Obstacle['kind'];
  target?: 'tank' | 'base' | 'tower' | 'supply';
  team?: SiteTeam;
  sourceX?: number;
  sourceZ?: number;
  charge?: number;
}

export interface Scar { id: number; x: number; z: number; radius: number; kind: 'crater' | 'impact'; surface: 'earth' | 'stone' | 'bridge'; rotation: number }

export interface Ping { owner: string; x: number; z: number; until: number }

export const PROTOCOL_VERSION = 10;

export interface State {
  version: typeof PROTOCOL_VERSION;
  seed: number;
  matchId: string;
  mode: GameMode;
  difficulty: Difficulty;
  mapSize: MapSize;
  enemyBaseDiscovered: boolean;
  visibleEnemies: string[];
  explored: number[];
  time: number;
  phase: Phase;
  paused: boolean;
  wave: number;
  countdown: number;
  remaining: number;
  reinforcementCountdown: number;
  baseHp: number;
  baseMaxHp: number;
  enemyBaseHp: number;
  enemyBaseMaxHp: number;
  tanks: Tank[];
  sites: Site[];
  obstacles: Obstacle[];
  shells: Shell[];
  drops: Drop[];
  events: BattleEvent[];
  scars: Scar[];
  pings: Ping[];
  campUpgrades: { baseArmor: number; repair: number };
}

export const EMPTY_INPUT: Input = { moveX: 0, moveZ: 0, aim: Math.PI, fire: false };

export const BASE = mapFor().base;

export const ENEMY_BASE = mapFor().enemyBase;

export const PLAYER_SPAWN_Z = BASE.z - 9;

export const ARENA = { x: 48, z: 60 };

export const SIDE_LANE = 30;

export const CROSSINGS = [-24, 0, 24];

export const WAVES = 5;

export const COLORS = ['#59847a', '#dfb265', '#7097b5', '#af829b'];

export const POWER_LABELS: Record<Power, string> = {
  rapid: '快速装填', burst: '三连发', heal: '战地维修', armor: '强化装甲',
};

export const POWER_EFFECTS: Record<Power, string> = {
  rapid: '装填加快 · 小 / 中 / 大地图 60 / 90 / 120 秒', burst: '三枚连射 · 24 次主动开炮', heal: '恢复 35% 血量', armor: '吸收 90 点伤害 · 赶路不消耗',
};

export function rapidDuration(size: MapSize) { return { small: 60, medium: 90, large: 120 }[size]; }

export function pickupHint(kind: Power, tank: Tank, size: MapSize = 'small') {
  return kind === 'heal' && tank.hp >= tank.maxHp ? '满血无需维修 · 受伤后拾取' : kind === 'rapid' ? '装填加快 · ' + rapidDuration(size) + ' 秒' : POWER_EFFECTS[kind];
}

export const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));

export const distance = (a: { x: number; z: number }, b: { x: number; z: number }) => Math.hypot(a.x - b.x, a.z - b.z);

export const angleDiff = (a: number, b: number) => Math.atan2(Math.sin(a - b), Math.cos(a - b));

export function damageHandling(hp: number, maxHp: number) {
  const damage = clamp((0.6 - hp / maxHp) / 0.6, 0, 1);
  return { speed: 1 - damage * 0.15, spread: 0.008 + damage * 0.075 };
}

export function cleanInput(value: unknown): Input | null {
  if (!value || typeof value !== 'object') return null;
  const i = value as Input;
  if (![i.moveX, i.moveZ, i.aim].every(Number.isFinite)) return null;
  const x = clamp(i.moveX, -1, 1);
  const z = clamp(i.moveZ, -1, 1);
  // 房主也限制向量长度，斜向移动和网络输入都不能超过正常速度。
  const length = Math.max(1, Math.hypot(x, z));
  return { moveX: x / length, moveZ: z / length, aim: Math.atan2(Math.sin(i.aim), Math.cos(i.aim)), fire: i.fire === true,
    ...(i.boost === true ? { boost: true } : {}), ...(i.chargeMode === true ? { chargeMode: true } : {}),
    ...(Number.isSafeInteger(i.cancelCharge) && i.cancelCharge! >= 0 && i.cancelCharge! <= 1e9 ? { cancelCharge: i.cancelCharge } : {}) };
}
