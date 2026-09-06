import { describe, expect, it } from 'vitest';
import { Simulation } from '../src/game/simulation';
import { advanceCapture, createSites, SITE } from '../src/game/sites';
import { MAPS, waterAt } from '../src/game/maps';
import { blocked, findPath } from '../src/game/world';
import { groundHeight } from '../src/game/terrain';
import { distance, type Site, type Tank } from '../src/game/types';

const advance = (sim: Simulation, seconds: number) => { for (let i = 0; i < Math.ceil(seconds * 30); i++) sim.step(1 / 30); };

function fixture(kind: Site['kind'] = 'tower') {
  const sim = new Simulation(47), p = sim.addPlayer('p', '玩家')!;
  sim.start(); sim.state.phase = 'battle'; sim.state.remaining = 0; sim.state.obstacles = []; sim.state.drops = [];
  const site = { ...sim.state.sites.find(s => s.capturable && s.kind === kind)!, x: 0, z: 25 };
  sim.state.sites = [site]; p.x = 0; p.z = 20; p.shield = 100;
  return { sim, p, site };
}

const enemy = (p: Tank, id = 'e1'): Tank => ({ ...p, id, team: 'enemy', shield: 0, cooldown: 100, buffs: { ...p.buffs }, stats: { ...p.stats } });

describe('据点布局与实际通路', () => {
  it.each(Object.values(MAPS))('$name 塔数正确，双方能到达每个占领圈，塔体不封桥', map => {
    for (const mode of ['classic', 'defense'] as const) for (const seed of [47, 9001]) {
      const sim = new Simulation(seed, mode, 'normal', map.id), n = { small: 1, medium: 2, large: 3 }[map.id];
      expect(sim.state.sites.filter(s => s.kind === 'tower' && s.team === 'player')).toHaveLength(n);
      expect(sim.state.sites.filter(s => s.kind === 'tower' && s.team === 'enemy')).toHaveLength(mode === 'classic' ? n : 0);
      expect(sim.state.sites.filter(s => s.kind === 'tower' && s.team === 'neutral')).toHaveLength(n);
      expect(sim.state.sites.filter(s => s.kind === 'supply')).toHaveLength(n);
      const solids = [...sim.state.obstacles, ...sim.state.sites.filter(s => s.kind === 'tower')];
      for (const site of sim.state.sites) {
        expect(waterAt(site, map)).toBe(null);
        expect(sim.state.obstacles.every(o => distance(o, site) > o.radius + 2)).toBe(true);
        if (!site.capturable) continue;
        for (const start of [map.spawn, map.enemySpawn]) {
          const path = findPath(start, site, solids, mode, map);
          expect(path.length, `site ${site.id} from ${start.x},${start.z}`).toBeGreaterThan(0);
          expect(distance(path.at(-1)!, site), `site ${site.id}`).toBeLessThan(SITE.captureRadius - 0.5);
          expect(path.every(p => !blocked(p.x, p.z, solids, 0.85, mode, map))).toBe(true);
        }
      }
    }
  }, 15000);
});

describe('占领、争夺、易主与维修', () => {
  it('六秒占领自动启用，离开衰减、争夺冻结，掉线和死亡不占领', () => {
    const { sim, p, site } = fixture();
    advanceCapture(site, sim.state, 3); expect(site.capture).toBe(3);
    const e = enemy(p); e.x = 3; sim.state.tanks.push(e);
    advanceCapture(site, sim.state, 2); expect(site.capture).toBe(3); expect(site.contested).toBe(true);
    e.connected = false; p.z = 10;
    advanceCapture(site, sim.state, 2); expect(site.capture).toBe(2);
    p.z = 20; p.hp = 0;
    advanceCapture(site, sim.state, 1); expect(site.capture).toBe(1.5);
    p.hp = 120; advance(sim, 4.6);
    expect(site.team).toBe('player'); expect(site.capture).toBe(0); expect(p.stats.objectives).toBe(1); expect(p.score).toBe(100);
    site.hp = 75; site.cooldown = 12;
    p.z = 10; e.connected = true; e.z = 22;
    expect(advanceCapture(site, sim.state, 6)).toEqual([e]);
    expect(site.team).toBe('enemy'); expect(site.hp).toBe(75); expect(site.cooldown).toBe(12);
    e.connected = false; p.z = 20; advance(sim, 6.1);
    expect(site.team).toBe('player'); expect(p.score).toBe(100); expect(p.stats.objectives).toBe(1);
  });

  it('暂停冻结占领；维修对圈内全队生效，有冷却，满血不消耗', () => {
    const { sim, p, site } = fixture('supply');
    advance(sim, 3); const progress = site.capture;
    sim.state.paused = true; advance(sim, 5); expect(site.capture).toBe(progress);
    sim.state.paused = false; advance(sim, 3.1);
    expect(site.team).toBe('player'); expect(site.cooldown).toBe(0);
    const ally = sim.addPlayer('p2', '队友')!; ally.x = 3; ally.z = 23; ally.hp = 60; p.hp = 50;
    sim.step(1 / 30); expect(p.hp).toBe(92); expect(ally.hp).toBe(102); expect(site.cooldown).toBe(30);
    p.hp = 40; advance(sim, 10); expect(p.hp).toBe(40);
    site.team = 'enemy'; site.capture = 0; site.captureTeam = 'neutral';
    advance(sim, 6.1); expect(site.team).toBe('player'); expect(p.hp).toBe(40); expect(site.cooldown).toBeGreaterThan(13);
    advance(sim, 14); expect(p.hp).toBe(82);
  });
});

describe('自动炮塔的预警、遮挡与战斗', () => {
  it('锁定后预警，再发射可躲避炮弹，普通命中不秒杀', () => {
    const { sim, p, site } = fixture(); site.team = 'enemy'; site.capturable = false; site.angle = Math.PI;
    p.z = 13; p.shield = 0;
    advance(sim, 0.7); expect(site.warning).toBeGreaterThan(0); expect(sim.state.shells).toHaveLength(0);
    advance(sim, 0.35); expect(sim.state.events.some(e => e.kind === 'shot' && e.owner === 'site-' + site.id)).toBe(true);
    advance(sim, 0.6); expect(p.hp).toBe(104);
    advance(sim, 1); expect(p.hp).toBe(104);
  });

  it('不会发现草丛里的坦克，遮挡和目标离开会取消预警', () => {
    const { sim, p, site } = fixture(); site.team = 'enemy'; site.capturable = false;
    site.x = -8; site.z = 20; site.angle = 0; p.x = -8; p.z = 30;
    advance(sim, 1.5); expect(site.target).toBe(null); expect(site.warning).toBe(0);
    p.exposedUntil = 20; advance(sim, 0.5); expect(site.warning).toBeGreaterThan(0);
    sim.state.obstacles = [{ id: 777, kind: 'rock', x: -8, z: 25, radius: 2, height: 10, hp: 100, maxHp: 100, rotation: 0 }];
    advance(sim, 1); expect(site.warning).toBe(0); expect(sim.state.events.some(e => e.kind === 'shot')).toBe(false);
    sim.state.obstacles = []; advance(sim, 0.5); p.z = 50; advance(sim, 0.5);
    expect(site.target).toBe(null); expect(sim.state.events.some(e => e.kind === 'shot')).toBe(false);
  });

  it('塔和坦克共用集火限制，占领我方塔会反击敌军', () => {
    const { sim, p, site } = fixture(); site.team = 'enemy'; site.capturable = false;
    p.z = 0;
    sim.state.sites = [-4, 0, 4].map((x, i) => ({ ...site, id: -1 - i, x, z: 12, angle: Math.PI }));
    const e = enemy(p); e.z = 10; e.cooldown = 0; e.angle = e.turret = Math.PI; sim.state.tanks.push(e);
    for (let i = 0; i < 90; i++) {
      sim.step(1 / 30);
      expect(sim.state.sites.filter(s => s.warning > 0).length + sim.state.tanks.filter(t => t.warning > 0).length).toBeLessThanOrEqual(2);
    }
    sim.state.sites = [site]; site.team = 'player'; site.angle = 0; e.x = 0; e.z = 37; e.cooldown = 100; e.shield = 100;
    sim.state.events = []; advance(sim, 1.3);
    expect(sim.state.events.some(e => e.kind === 'shot' && e.owner === 'site-' + site.id)).toBe(true);
  });

  it('塔可被蓄力摧毁，残骸不挡路、不复活，占领不能刷新拆塔奖励', () => {
    const { sim, p, site } = fixture(); site.team = 'enemy'; site.hp = 100; site.cooldown = 100;
    const hit = (damage: number) => {
      sim.state.shells.push({ id: 999, owner: p.id, team: 'player', x: site.x, y: groundHeight(site.x, site.z) + 2, z: site.z, vx: 0, vy: 0, vz: 0, damage, life: 1, power: 1 });
      sim.step(1 / 30);
    };
    hit(56); expect(site.hp).toBe(44); expect(blocked(site.x, site.z, [site])).toBe(true);
    hit(56); expect(site.hp).toBe(0); expect(blocked(site.x, site.z, [site])).toBe(false);
    expect(sim.state.scars.some(s => s.kind === 'crater' && distance(s, site) < 1)).toBe(true);
    expect(p.score).toBe(240); expect(p.stats.objectives).toBe(1);
    advance(sim, 10); expect(site.hp).toBe(0); expect(site.team).toBe('enemy'); expect(p.score).toBe(240);
    expect(JSON.parse(JSON.stringify(sim.state)).sites[0].hp).toBe(0);
  });

  it('未占领的塔可以摧毁，但不能刷拆敌塔积分', () => {
    const { sim, p, site } = fixture();
    sim.state.shells.push({ id: 999, owner: p.id, team: 'player', x: site.x, y: groundHeight(site.x, site.z) + 2, z: site.z, vx: 0, vy: 0, vz: 0, damage: 500, life: 1 });
    sim.step(1 / 30);
    expect(site.hp).toBe(0); expect(p.score).toBe(0); expect(site.team).toBe('neutral');
  });

  it('敌塔易主会清除旧伤害归属，我方塔被毁不奖励旧拆塔贡献', () => {
    const { sim, p, site } = fixture(); site.team = 'enemy'; site.cooldown = 100;
    const hit = (team: Tank['team'], owner: string, damage: number) => {
      sim.state.shells.push({ id: 999, owner, team, x: site.x, y: groundHeight(site.x, site.z) + 2, z: site.z, vx: 0, vy: 0, vz: 0, damage, life: 1 });
      sim.step(1 / 30);
    };
    hit('player', p.id, 20); advance(sim, 6.1);
    expect(site.team).toBe('player'); expect(p.score).toBe(100);
    hit('enemy', 'enemy-shell', 500);
    expect(site.hp).toBe(0); expect(p.score).toBe(100); expect(p.stats.objectives).toBe(1);
  });
});

it('中大地图实际增加出兵、保有更多在场敌军，仍保留有限增援', () => {
  const peaks: number[] = [], totals: number[] = [];
  for (const size of ['small', 'medium', 'large'] as const) {
    const sim = new Simulation(47, 'classic', 'normal', size); sim.addPlayer('p', '玩家'); sim.start(); totals.push(sim.state.remaining);
    let peak = 0;
    for (let i = 0; i < 35 * 30; i++) { sim.step(1 / 30); peak = Math.max(peak, sim.state.tanks.filter(t => t.team === 'enemy').length); }
    peaks.push(peak);
  }
  expect(totals).toEqual([18, 28, 40]); expect(peaks).toEqual([3, 5, 7]);
}, 15000);

it.each(['small', 'medium'] as const)('%s 地图的残兵补充遵守规模规则、总兵力和在场上限', size => {
  const sim = new Simulation(47, 'classic', 'normal', size), p = sim.addPlayer('p', '玩家')!;
  sim.start(); p.shield = 1000; advance(sim, 22);
  const initial = sim.state.tanks.filter(t => t.team === 'enemy'), survivor = initial.at(-1)!;
  for (const target of initial.slice(1, -1)) {
    target.shield = 0;
    sim.state.shells.push({ id: 90000 + target.x, owner: p.id, team: 'player', x: target.x, z: target.z, y: groundHeight(target.x, target.z, MAPS[size]) + 1, vx: 0, vy: 0, vz: 0, damage: 10000, life: 1 });
  }
  sim.step(1 / 30);
  for (const t of sim.state.tanks.filter(t => t.team === 'enemy')) t.shield = 1000;
  const reserve = sim.state.remaining;
  let peak = 0;
  for (let i = 0; i < 60 * 30; i++) { sim.step(1 / 30); peak = Math.max(peak, sim.state.tanks.filter(t => t.team === 'enemy').length); }
  expect(survivor.hp).toBeGreaterThan(0);
  expect(peak).toBeLessThanOrEqual(size === 'small' ? 3 : 5);
  if (size === 'small') expect(sim.state.remaining).toBe(reserve);
  else expect(sim.state.remaining).toBeLessThan(reserve);
}, 15000);
