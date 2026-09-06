import { describe, expect, it } from 'vitest';
import { Simulation } from '../src/game/simulation';
import { MAPS, mapFor } from '../src/game/maps';
import { updateVisibility, EXPLORE_STEP } from '../src/game/visibility';
import { groundHeight } from '../src/game/terrain';
import { createMap, blocked } from '../src/game/world';
import { emptyLoadout } from '../src/game/factory';
import { type Shell, type Tank } from '../src/game/types';

function setup(size: 'small' | 'medium' | 'large' = 'small') {
  const sim = new Simulation(47, 'classic', 'normal', size), player = sim.addPlayer('p', '玩家')!;
  sim.start(); sim.state.phase = 'battle'; sim.state.remaining = 0; sim.state.obstacles = []; sim.state.drops = [];
  return { sim, player };
}
const advance = (sim: Simulation, seconds: number) => { for (let i = 0; i < seconds * 30; i++) sim.step(1 / 30); };
const shot = (target: Tank, sim: Simulation, damage = 20, owner = 'p'): Shell => ({ id: 900000, owner, team: target.team === 'enemy' ? 'player' : 'enemy', x: target.x, z: target.z, y: groundHeight(target.x, target.z, mapFor(sim.state.mapSize)) + 1, vx: 0, vy: 0, vz: 0, damage, life: 1 });

describe('休闲侦察与长效补给', () => {
  it.each(Object.keys(MAPS) as ('small' | 'medium' | 'large')[])('%s 的普通敌军远处可见，发现营地一次开全图', size => {
    const { sim, player } = setup(size), map = MAPS[size];
    const enemy: Tank = { ...player, id: 'e', team: 'enemy', x: map.enemySpawn.x, z: map.enemySpawn.z };
    sim.state.tanks.push(enemy); updateVisibility(sim.state);
    expect(sim.state.visibleEnemies).toContain('e'); expect(sim.state.enemyBaseDiscovered).toBe(false);
    enemy.x = map.grass[0].x; enemy.z = map.grass[0].z; updateVisibility(sim.state);
    expect(sim.state.visibleEnemies).not.toContain('e');
    enemy.exposedUntil = 5; updateVisibility(sim.state); expect(sim.state.visibleEnemies).toContain('e');
    player.x = map.enemyBase.x; player.z = map.enemyBase.z + 8; updateVisibility(sim.state);
    const cells = Math.ceil(map.arena.x * 2 / EXPLORE_STEP) * Math.ceil(map.arena.z * 2 / EXPLORE_STEP);
    expect(sim.state.explored).toHaveLength(cells);
    player.hp = 0; updateVisibility(sim.state); expect(sim.state.explored).toHaveLength(cells);
    const defense = new Simulation(47, 'defense', 'normal', size); defense.addPlayer('p', '玩家'); defense.start();
    expect(defense.state.explored).toHaveLength(cells);
  });

  it.each([['small', 60], ['medium', 90], ['large', 120]] as const)('%s 攻速持续 %s 秒，同类补充不超两份', (size, duration) => {
    const { sim, player } = setup(size);
    const drop = () => { sim.state.drops.push({ id: 9, kind: 'rapid', x: player.x, z: player.z, life: 100 }); sim.step(1 / 30); };
    drop(); expect(player.buffs.rapid).toBe(duration); drop(); drop(); expect(player.buffs.rapid).toBe(duration * 2);
  });

  it('连发只按主动开炮消耗一次，护盾按伤害消耗，赶路均不减少', () => {
    const { sim, player } = setup(); player.buffs.burst = 24; player.buffs.armor = 90;
    advance(sim, 30); expect(player.buffs.burst).toBe(24); expect(player.buffs.armor).toBe(90);
    sim.input('p', { moveX: 0, moveZ: 0, aim: Math.PI, fire: true }); sim.step(1 / 30);
    sim.input('p', { moveX: 0, moveZ: 0, aim: Math.PI, fire: false }); advance(sim, 0.5);
    expect(player.buffs.burst).toBe(23);
    expect(sim.state.events.filter(e => e.kind === 'shot')).toHaveLength(3);
    sim.state.shells.push(shot(player, sim, 100)); sim.step(1 / 30);
    expect(player.buffs.armor).toBe(0); expect(player.hp).toBe(110);
  });
});

describe('战场痕迹、合作贡献与工厂生效', () => {
  it('坦克炸毁留下持久弹坑，临时事件清空后仍可同步，且不影响通行', () => {
    const { sim, player } = setup();
    const enemy: Tank = { ...player, id: 'e', team: 'enemy', x: 0, z: 20, hp: 20, upgrades: emptyLoadout(), stats: { ...player.stats } };
    sim.state.tanks.push(enemy); sim.state.shells.push(shot(enemy, sim)); sim.step(1 / 30);
    expect(sim.state.events.some(e => e.target === 'tank' && e.kind === 'destroy')).toBe(true);
    expect(sim.state.scars).toHaveLength(1); sim.state.events = []; advance(sim, 8);
    const snapshot = JSON.parse(JSON.stringify(sim.state));
    expect(snapshot.scars[0].kind).toBe('crater'); expect(blocked(0, 20, snapshot.obstacles)).toBe(false);
  });

  it('助攻和营地防守共同奖励，不依赖最后一炮', () => {
    const { sim, player } = setup(), ally = sim.addPlayer('q', '队友')!;
    const enemy: Tank = { ...player, id: 'e', team: 'enemy', x: 0, z: 24, hp: 40, stats: { ...player.stats } };
    sim.state.tanks.push(enemy);
    sim.state.shells.push(shot(enemy, sim, 20, ally.id)); sim.step(1 / 30);
    sim.state.shells.push(shot(enemy, sim, 20, player.id)); sim.step(1 / 30);
    expect(player.stats.kills).toBe(1); expect(ally.stats.assists).toBe(1);
    expect(player.stats.defenses).toBe(1); expect(ally.stats.defenses).toBe(1);
    expect(ally.score).toBe(150);
  });

  it('维修工坊受脱战时间限制，存档中的机动与冷却升级实际生效', () => {
    const sim = new Simulation(47), p = sim.addPlayer('p', '玩家', { ...emptyLoadout(), mobility: 3, reload: 3, repair: 2 })!;
    sim.start(); sim.state.phase = 'battle'; sim.state.remaining = 0; sim.state.obstacles = []; sim.state.drops = [];
    const x = p.x;
    for (let i = 0; i < 30; i++) { sim.input(p.id, { moveX: 1, moveZ: 0, aim: Math.PI, fire: false }); sim.step(1 / 30); }
    expect(p.x - x).toBeCloseTo(6.72, 4);
    sim.input(p.id, { moveX: 0, moveZ: 0, aim: Math.PI, fire: true }); sim.step(1 / 30); expect(p.cooldown).toBeCloseTo(0.88);
    sim.input(p.id, { moveX: 0, moveZ: 0, aim: Math.PI, fire: false }); sim.state.baseHp = 500;
    advance(sim, 30); expect(sim.state.baseHp).toBe(520);
    sim.state.time = 59; const base = mapFor().base;
    sim.state.shells.push({ ...shot(p, sim), x: base.x, z: base.z, y: 1.13 }); sim.step(1 / 30);
    advance(sim, 2); expect(sim.state.baseHp).toBe(500); advance(sim, 10); expect(sim.state.baseHp).toBe(520);
  });

  it('森林比旧地图更密集，高度、树冠和色系具有差异', () => {
    const trees = createMap(47, 'classic', MAPS.large).filter(o => o.kind === 'tree');
    expect(trees.length).toBeGreaterThan(400);
    expect(Math.max(...trees.map(t => t.height)) - Math.min(...trees.map(t => t.height))).toBeGreaterThan(5);
    expect(new Set(trees.map(t => t.tone)).size).toBeGreaterThanOrEqual(5);
    expect(Math.max(...trees.map(t => t.crown!)) - Math.min(...trees.map(t => t.crown!))).toBeGreaterThan(0.6);
    for (const map of Object.values(MAPS)) for (const seed of [1, 47, 9001]) {
      const obstacles = createMap(seed, 'classic', map), grass = map.grass[0];
      for (let z = grass.z; z <= map.spawn.z; z += 0.5) expect(blocked(grass.x, z, obstacles, 0.85, 'classic', map)).toBe(false);
    }
  });

  it('标记限频且受地图边界约束，同一玩家只有一个有效标记', () => {
    const { sim } = setup(); sim.ping('p', { x: 0, z: 0 }); sim.ping('p', { x: 8, z: 8 });
    expect(sim.state.pings).toHaveLength(1); expect(sim.state.pings[0].x).toBe(0);
    sim.state.time += 2; sim.ping('p', { x: 8, z: 8 }); expect(sim.state.pings[0].x).toBe(8);
    sim.ping('fake', { x: 0, z: 0 }); sim.ping('p', { x: NaN, z: 0 }); expect(sim.state.pings).toHaveLength(1);
    advance(sim, 13); expect(sim.state.pings).toHaveLength(0);
  });
});
