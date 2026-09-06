import type { Difficulty, Tank } from './types';
import type { MapSize } from './maps';

interface Balance {
  name: string;
  description: string;
  hp: Record<Tank['kind'], number>;
  baseHp: number;
  cooldown: number;
  heavyCooldown: number;
  reaction: readonly [number, number];
  warningTime: number;
  focusLimit: number;
  attackers: number;
  reserves: number;
  raidRest: number;
  waveRest: number;
  firstWave: number;
}

export const DIFFICULTIES: Record<Difficulty, Balance> = {
  casual: {
    name: '休闲', description: '敌军更少、反应更慢，适合轻松游玩',
    hp: { scout: 60, standard: 80, heavy: 120 }, baseHp: 280,
    cooldown: 4, heavyCooldown: 3.5, reaction: [1.1, 1.5], warningTime: 0.5,
    focusLimit: 1, attackers: 1, reserves: 12, raidRest: 25, waveRest: 18, firstWave: 3,
  },
  normal: {
    name: '普通', description: '留出维修和反攻时间，适合单人战役',
    hp: { scout: 80, standard: 100, heavy: 140 }, baseHp: 360,
    cooldown: 3.5, heavyCooldown: 3, reaction: [0.8, 1.2], warningTime: 0.4,
    focusLimit: 2, attackers: 2, reserves: 18, raidRest: 20, waveRest: 15, firstWave: 4,
  },
  challenge: {
    name: '挑战', description: '更多敌军、更紧凑的攻势，适合熟练坦克手',
    hp: { scout: 80, standard: 120, heavy: 180 }, baseHp: 480,
    cooldown: 3, heavyCooldown: 2.5, reaction: [0.6, 0.9], warningTime: 0.35,
    focusLimit: 2, attackers: 3, reserves: 24, raidRest: 12, waveRest: 12, firstWave: 5,
  },
};

// 合作主要增加部队数量，每辆敌军的血量与反应保持所选难度的标准。
export const MAP_PRESSURE = {
  small: { attackers: 0, reserves: 0, speed: 1, reload: 1 },
  medium: { attackers: 2, reserves: 10, speed: 1.12, reload: 0.94 },
  large: { attackers: 4, reserves: 22, speed: 1.24, reload: 0.88 },
};

export const attackSize = (difficulty: Difficulty, players: number, size: MapSize = 'small') => DIFFICULTIES[difficulty].attackers + Math.max(0, players - 1) + MAP_PRESSURE[size].attackers;

export const enemyLimit = (difficulty: Difficulty, players: number, size: MapSize = 'small') => attackSize(difficulty, players, size) + 1;

export const reserveSize = (difficulty: Difficulty, players: number, size: MapSize = 'small') => DIFFICULTIES[difficulty].reserves + Math.max(0, players - 1) * 8 + MAP_PRESSURE[size].reserves;

export const waveSize = (difficulty: Difficulty, wave: number, players: number, size: MapSize = 'small') => DIFFICULTIES[difficulty].firstWave + wave - 1 + Math.max(0, players - 1) * (2 + Math.floor(wave / 2)) + MAP_PRESSURE[size].attackers;
