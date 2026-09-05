import { mapFor, type MapSize } from './maps';

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
  warning: number;
  exposedUntil: number;
  lives: number;
  respawn: number;
  shield: number;
  buffs: Record<Power, number>;
  score: number;
  connected: boolean;
  ready: boolean;
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
}

export interface Shell {
  id: number;
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
}

export interface Drop {
  id: number;
  kind: Power;
  x: number;
  z: number;
  life: number;
}

export interface BattleEvent {
  id: number;
  kind: 'shot' | 'hit' | 'destroy' | 'pickup' | 'wave';
  x: number;
  y?: number;
  z: number;
  size: number;
  owner?: string;
  power?: Power;
  obstacle?: number;
  material?: Obstacle['kind'];
}

export const PROTOCOL_VERSION = 6;

export interface State {
  version: typeof PROTOCOL_VERSION;
  seed: number;
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
  obstacles: Obstacle[];
  shells: Shell[];
  drops: Drop[];
  events: BattleEvent[];
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
  rapid: '装填加快 · 12 秒', burst: '三枚连射 · 10 秒', heal: '恢复 35% 血量', armor: '受到伤害降低 30% · 12 秒',
};

export function pickupHint(kind: Power, tank: Tank) {
  return kind === 'heal' && tank.hp >= tank.maxHp ? '满血无需维修 · 受伤后拾取' : POWER_EFFECTS[kind];
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
  return { moveX: x / length, moveZ: z / length, aim: Math.atan2(Math.sin(i.aim), Math.cos(i.aim)), fire: i.fire === true };
}
