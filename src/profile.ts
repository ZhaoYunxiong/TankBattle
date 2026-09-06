import { cleanLoadout, COSTS, emptyLoadout, loadoutCost, loadoutTier, MAX_LEVEL, upgradeKeys, type Loadout, type Upgrade } from './game/factory';
import type { State, Tank } from './game/types';
import { uniqueId } from './id';
import { isTankKind, VEHICLES, vehicleKinds, type TankKind } from './game/vehicles';

export interface MatchRecord {
  id: string;
  at: string;
  mode: State['mode'];
  difficulty: State['difficulty'];
  mapSize: State['mapSize'];
  won: boolean;
  seconds: number;
  score: number;
  honor: number;
  coins: number;
  rank: number;
  players: number;
  equipment: string;
  vehicle: TankKind;
}

export interface Profile {
  version: 2;
  id: string;
  honor: number;
  coins: number;
  earned: number;
  battles: number;
  wins: number;
  upgrades: Loadout;
  unlockedVehicles: TankKind[];
  selectedVehicle: TankKind;
  records: MatchRecord[];
  settled: string[];
}

export const PROFILE_KEY = 'tb-profile-v1';

export function newProfile(): Profile {
  return { version: 2, unlockedVehicles: ['standard'], selectedVehicle: 'standard', id: uniqueId(), honor: 0, coins: 0, earned: 0, battles: 0, wins: 0, upgrades: emptyLoadout(), records: [], settled: [] };
}

const natural = (n: unknown): n is number => Number.isSafeInteger(n) && (n as number) >= 0;

// 存档解析集中在边界；后续云端存储可沿用档案和对局记录，不混入战斗模拟。
export function parseProfile(text: string): Profile {
  if (text.length > 4_000_000) throw new Error('存档文件过大。');
  const p = JSON.parse(text) as Omit<Profile, 'version'> & { version: number };
  if (!p || ![1, 2].includes(p.version) || typeof p.id !== 'string' || p.id.length > 100 || !p.id ||
    ![p.honor, p.coins, p.earned, p.battles, p.wins].every(natural) || p.wins > p.battles ||
    !Array.isArray(p.records) || p.records.length > 200 || !Array.isArray(p.settled) ||
    p.settled.some(id => typeof id !== 'string' || id.length > 100) || !p.upgrades) throw new Error('存档格式或版本不正确。');
  const unlocked = p.version === 1 ? ['standard'] : p.unlockedVehicles;
  const selected = p.version === 1 ? 'standard' : p.selectedVehicle;
  if (!Array.isArray(unlocked) || unlocked.length > 4 || !unlocked.includes('standard') || !unlocked.every(isTankKind) || new Set(unlocked).size !== unlocked.length || !isTankKind(selected) || !unlocked.includes(selected)) throw new Error('存档的车型数据不完整。');
  const unlockedVehicles = vehicleKinds.filter(kind => unlocked.includes(kind));
  const upgrades = cleanLoadout(p.upgrades);
  if (upgradeKeys.some(key => upgrades[key] !== p.upgrades[key]) || p.coins + loadoutCost(upgrades) + unlockedVehicles.reduce((n, kind) => n + VEHICLES[kind].cost, 0) !== p.earned) throw new Error('存档的工厂数据不完整。');
  const records = p.records.map(r => {
    if (!r || typeof r.id !== 'string' || !p.settled.includes(r.id) || typeof r.at !== 'string' || !Number.isFinite(Date.parse(r.at)) ||
      !['classic', 'defense'].includes(r.mode) || !['casual', 'normal', 'challenge'].includes(r.difficulty) || !['small', 'medium', 'large'].includes(r.mapSize) ||
      typeof r.won !== 'boolean' || ![r.seconds, r.score, r.honor, r.coins, r.rank, r.players].every(natural) || r.players < 1 || r.players > 4 || r.rank < 1 || r.rank > r.players || typeof r.equipment !== 'string' || r.equipment.length > 160 || p.version === 2 && !isTankKind(r.vehicle)) throw new Error('存档的战绩数据不完整。');
    const equipment = p.version === 1 ? r.equipment.split('|')[0].split('/').map(item => 'standard:' + item).join('/') + '|' + (r.equipment.split('|')[1] ?? '0,0') : r.equipment;
    return { vehicle: p.version === 1 ? 'standard' as const : r.vehicle, id: r.id, at: r.at, mode: r.mode, difficulty: r.difficulty, mapSize: r.mapSize, won: r.won, seconds: r.seconds, score: r.score, honor: r.honor, coins: r.coins, rank: r.rank, players: r.players, equipment };
  });
  return { version: 2, unlockedVehicles, selectedVehicle: selected, id: p.id, honor: p.honor, coins: p.coins, earned: p.earned, battles: p.battles, wins: p.wins, upgrades, records, settled: [...new Set(p.settled)] };
}

export function loadProfile(storage: Pick<Storage, 'getItem'>): { profile: Profile; warning: string } {
  try {
    const raw = storage.getItem(PROFILE_KEY);
    if (!raw) return { profile: newProfile(), warning: '' };
    try { return { profile: parseProfile(raw), warning: '' }; }
    catch {
      const backup = storage.getItem(PROFILE_KEY + '-backup');
      if (backup) return { profile: parseProfile(backup), warning: '已从本机备份恢复档案，请导出一份备份。' };
      return { profile: newProfile(), warning: '原档案无法读取，已保留原始数据。请导入备份恢复；本次先使用临时档案。' };
    }
  } catch { return { profile: newProfile(), warning: '浏览器暂不允许保存档案，本次进度请使用导出备份。' }; }
}

export function saveProfile(storage: Pick<Storage, 'getItem' | 'setItem'>, profile: Profile) {
  const text = JSON.stringify(profile);
  const previous = storage.getItem(PROFILE_KEY);
  // 先原子写入主档案；备份失败不影响已经完成的结算保存。
  storage.setItem(PROFILE_KEY, text);
  if (previous) try { parseProfile(previous); storage.setItem(PROFILE_KEY + '-backup', previous); } catch { /* 不用损坏的旧内容覆盖有效备份。 */ }
}

export const rankName = (honor: number) => honor >= 50000 ? '山谷传奇' : honor >= 20000 ? '精英指挥官' : honor >= 8000 ? '装甲先锋' : honor >= 2000 ? '山谷老兵' : '新晋守卫';

export function standings(state: State) {
  return state.tanks.filter(t => t.team === 'player').sort((a, b) => b.score - a.score || a.id.localeCompare(b.id));
}

export function settle(profile: Profile, state: State, player: Tank): MatchRecord | null {
  if (!['won', 'lost'].includes(state.phase) || player.team !== 'player' || profile.settled.includes(state.matchId)) return null;
  const team = standings(state), score = Math.max(0, Math.round(player.score));
  const honor = Math.floor(score * ({ casual: 0.8, normal: 1, challenge: 1.25 }[state.difficulty]));
  const coins = Math.floor(honor * 0.15) + (state.phase === 'won' ? 80 : 0);
  const record: MatchRecord = {
    vehicle: player.kind, id: state.matchId, at: new Date().toISOString(), mode: state.mode, difficulty: state.difficulty, mapSize: state.mapSize,
    won: state.phase === 'won', seconds: Math.floor(state.time), score, honor, coins,
    rank: 1 + team.filter(t => t.score > player.score).length, players: team.length,
    equipment: team.map(t => `${t.kind}:${loadoutTier(t.upgrades)}:${upgradeKeys.map(k => t.upgrades[k]).join('')}`).sort().join('/') + `|${state.campUpgrades.baseArmor},${state.campUpgrades.repair}`,
  };
  profile.honor += honor; profile.coins += coins; profile.earned += coins; profile.battles++;
  if (record.won) profile.wins++;
  profile.settled.push(record.id);
  profile.records = [record, ...profile.records].slice(0, 200);
  return record;
}

export function buyUpgrade(profile: Profile, key: Upgrade) {
  const level = profile.upgrades[key];
  if (level >= MAX_LEVEL || profile.coins < COSTS[level]) return false;
  profile.coins -= COSTS[level]; profile.upgrades[key]++;
  return true;
}

export function unlockVehicle(profile: Profile, kind: unknown): boolean {
  if (!isTankKind(kind) || profile.unlockedVehicles.includes(kind) || profile.coins < VEHICLES[kind].cost) return false;
  profile.coins -= VEHICLES[kind].cost;
  profile.unlockedVehicles = vehicleKinds.filter(k => k === kind || profile.unlockedVehicles.includes(k));
  return true;
}

export function selectVehicle(profile: Profile, kind: unknown): boolean {
  if (!isTankKind(kind) || !profile.unlockedVehicles.includes(kind)) return false;
  profile.selectedVehicle = kind;
  return true;
}

export function resetFactory(profile: Profile) {
  profile.coins += loadoutCost(profile.upgrades);
  profile.upgrades = emptyLoadout();
}

export const boardKey = (r: MatchRecord) => `${r.mode}/${r.difficulty}/${r.mapSize}/${r.players}/${r.vehicle}/${r.equipment}`;
