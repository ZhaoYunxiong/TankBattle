import { mapFor } from './maps';
import { sightClear } from './visibility';
import { distance, type Difficulty, type GameMode, type Site, type State, type Tank } from './types';
import type { MapSize } from './maps';

export const SITE = { captureRadius: 6, captureSeconds: 6, range: 24, height: 3.1, warning: 0.9, reload: 3.2, repairCooldown: 30 };

export const SITE_COLORS = { player: '#80b9a4', enemy: '#d79078', neutral: '#ddc883' };

export const siteName = (site: Site) => site.kind === 'supply' ? '补给点' : site.capturable ? '可占领防御塔' : '防御塔';

export function createSites(size: MapSize, mode: GameMode, difficulty: Difficulty): Site[] {
  return mapFor(size).sites.filter(p => mode === 'classic' || p.team !== 'enemy').map((p, i) => {
    const hp = p.team === 'enemy' ? { casual: 180, normal: 220, challenge: 260 }[difficulty] : p.team === 'neutral' ? 200 : 220;
    return { ...p, id: -1 - i, capturable: p.team === 'neutral', hp, maxHp: hp, radius: p.kind === 'tower' ? 1.6 : 0,
      capture: 0, captureTeam: 'neutral', contested: false, rewarded: false, cooldown: 0, angle: p.team === 'player' ? Math.PI : 0, warning: 0, target: null };
  });
}

// 房主按模拟时间计算占领；人数不加速，暂停、死亡和掉线都不能继续占领。
export function advanceCapture(site: Site, state: State, dt: number): Tank[] | null {
  if (!site.capturable || site.hp <= 0) return null;
  const occupants = state.tanks.filter(t => t.hp > 0 && t.connected && distance(t, site) <= SITE.captureRadius && sightClear(state, site, t));
  const teams = new Set(occupants.map(t => t.team));
  site.contested = teams.size > 1;
  if (site.contested) return null;
  const team = occupants[0]?.team;
  if (!team || team === site.team) {
    site.capture = Math.max(0, site.capture - dt * 0.5);
    if (!site.capture) site.captureTeam = 'neutral';
    return null;
  }
  if (site.captureTeam !== team) { site.capture = 0; site.captureTeam = team; }
  site.capture = Math.min(SITE.captureSeconds, site.capture + dt);
  if (site.capture < SITE.captureSeconds) return null;
  site.team = team; site.capture = 0; site.captureTeam = 'neutral'; site.warning = 0; site.target = null;
  // 易主不刷新血量或补给冷却，防止反复占领刷维修。
  site.cooldown = Math.max(site.cooldown, site.kind === 'tower' ? 1 : 0);
  return occupants;
}
