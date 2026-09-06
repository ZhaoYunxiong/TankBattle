import { describe, expect, it } from 'vitest';
import { Simulation } from '../src/game/simulation';
import { MAPS, mapFor, waterAt, waterBlocked } from '../src/game/maps';
import { blocked, createMap, findPath } from '../src/game/world';
import { groundHeight, groundSlope } from '../src/game/terrain';
import { concealed, updateVisibility, visibleTo } from '../src/game/visibility';
import { traceShot } from '../src/game/combat';
import { distance, type Tank } from '../src/game/types';

const advance = (sim: Simulation, seconds: number) => { for (let i = 0; i < seconds * 30; i++) sim.step(1 / 30); };

describe('可扩展地图、河流与路径', () => {
  it.each(Object.values(MAPS))('$name 为双方、桥梁和补给保留可达路线', map => {
    expect(map.enemyBase.x).not.toBe(-map.base.x);
    for (const seed of [1, 47, 150, 9001]) for (const mode of ['classic', 'defense'] as const) {
      const obstacles = createMap(seed, mode, map);
      expect(createMap(seed, mode, map)).toEqual(obstacles);
      for (const x of [-3.75, -1.25, 1.25, 3.75]) expect(blocked(map.spawn.x + x, map.spawn.z, obstacles, 0.85, mode, map)).toBe(false);
      for (const [start, end] of [[map.spawn, map.enemyBase], [map.enemySpawn, map.base]]) {
        const path = findPath(start, end, obstacles, mode, map);
        expect(path.length).toBeGreaterThan(0);
        expect(distance(path.at(-1)!, end)).toBeLessThan(5.3);
        for (let i = 1; i < path.length; i++) {
          expect(blocked(path[i].x, path[i].z, obstacles, 0.95, mode, map)).toBe(false);
          for (const t of [0.25, 0.5, 0.75]) expect(waterBlocked({ x: path[i - 1].x + (path[i].x - path[i - 1].x) * t, z: path[i - 1].z + (path[i].z - path[i - 1].z) * t }, map, 0.85)).toBe(false);
        }
      }
      const sim = new Simulation(seed, mode, 'normal', map.id);
      sim.addPlayer('p', '探路者'); sim.start();
      expect(sim.state.drops.length).toBe(2 + map.roads[0].length - 2);
      for (const drop of sim.state.drops) {
        expect(waterAt(drop, map)).not.toBe('deep');
        const path = findPath(sim.state.tanks[0], drop, sim.state.obstacles, mode, map, true);
        expect(distance(path.at(-1)!, drop)).toBeLessThan(1.6);
      }
    }
  });

  it('地图面积递增，地形缓存互相独立，所有地图坡度可驾驶', () => {
    expect(Object.values(MAPS).map(m => m.arena.x * m.arena.z * 4)).toEqual([96 * 120, 144 * 180, 192 * 240]);
    const smallHeight = groundHeight(25, 18, MAPS.small);
    expect(groundHeight(25, 18, MAPS.large)).not.toBe(smallHeight);
    expect(groundHeight(25, 18, MAPS.small)).toBe(smallHeight);
    for (const map of Object.values(MAPS)) for (let x = -map.arena.x; x <= map.arena.x; x += 3) for (let z = -map.arena.z; z <= map.arena.z; z += 3) {
      const slope = groundSlope(x, z, map);
      expect(Math.hypot(slope.x, slope.z)).toBeLessThan(0.85);
    }
  });

  it('树木与岩石包含不同体积的完整素材种类', () => {
    const obstacles = createMap(47, 'classic', MAPS.large);
    expect(new Set(obstacles.filter(o => o.kind === 'tree').map(o => o.variant))).toEqual(new Set(['pine', 'round', 'birch', 'dead']));
    expect(new Set(obstacles.filter(o => o.kind === 'rock').map(o => o.variant))).toEqual(new Set(['low', 'boulder', 'layered']));
    expect(obstacles.find(o => o.variant === 'low')!.height).toBeLessThan(1);
    expect(obstacles.find(o => o.variant === 'layered')!.height).toBeGreaterThan(4);
  });

  it('浅河保持六成移动速度，深河碰撞包含车身宽度，桥梁可通行', () => {
    const move = (x: number, z: number) => {
      const sim = new Simulation(47); const player = sim.addPlayer('p', '玩家')!;
      sim.start(); sim.state.countdown = 100; sim.state.obstacles = []; player.x = x; player.z = z;
      for (let i = 0; i < 30; i++) { sim.input(player.id, { moveX: 1, moveZ: 0, aim: 0, fire: false }); sim.step(1 / 30); }
      return player.x - x;
    };
    expect(move(24, -28) / move(-4, 40)).toBeCloseTo(0.6, 5);
    expect(blocked(20, -4, [])).toBe(true);
    expect(blocked(0, -4, [])).toBe(false);
    expect(blocked(3.2, -4, [])).toBe(true);
  });

  it('敌军在大地图沿桥梁推进，不穿深水，随机补给可达', () => {
    const sim = new Simulation(47, 'classic', 'normal', 'large');
    sim.addPlayer('p', '玩家'); sim.start();
    for (let i = 0; i < 180 * 30; i++) {
      sim.step(1 / 30);
      for (const t of sim.state.tanks) expect(waterBlocked(t, MAPS.large, 0.84)).toBe(false);
    }
    expect(sim.state.tanks.some(t => t.team === 'enemy' && t.z > -20)).toBe(true);
    for (const drop of sim.state.drops) {
      expect(blocked(drop.x, drop.z, sim.state.obstacles, 0.85, 'classic', MAPS.large)).toBe(false);
      const path = findPath(MAPS.large.spawn, drop, sim.state.obstacles, 'classic', MAPS.large, true);
      expect(distance(path.at(-1)!, drop)).toBeLessThan(1.6);
    }
  }, 20000);
});

describe('高草伏击与全队侦察', () => {
  function encounter() {
    const sim = new Simulation(47); const p = sim.addPlayer('p', '玩家')!;
    sim.start(); sim.state.phase = 'battle'; sim.state.remaining = 0; sim.state.obstacles = [];
    p.x = -8; p.z = 30;
    const enemy: Tank = { ...p, id: 'e', team: 'enemy', x: -8, z: 19, turret: 0, angle: 0, buffs: { ...p.buffs } };
    sim.state.tanks.push(enemy);
    return { sim, p, enemy };
  }

  it('第一炮前 AI 不锁定；开炮暴露五秒，进出高草不重置时间', () => {
    const { sim, p, enemy } = encounter();
    expect(concealed(p, sim.state)).toBe(true);
    advance(sim, 1);
    expect(enemy.warning).toBe(0);
    expect(sim.state.events.some(e => e.owner === enemy.id && e.kind === 'shot')).toBe(false);
    sim.input('p', { moveX: 0, moveZ: 0, aim: Math.PI, fire: true }); sim.step(1 / 30);
    const deadline = p.exposedUntil;
    expect(deadline - sim.state.time).toBeCloseTo(5);
    expect(concealed(p, sim.state)).toBe(false);
    sim.input('p', { moveX: 0, moveZ: 0, aim: Math.PI, fire: false });
    p.x = 0; sim.step(1 / 30); p.x = -8; sim.step(1 / 30);
    expect(p.exposedUntil).toBe(deadline);
    sim.state.time = deadline - 0.01; expect(concealed(p, sim.state)).toBe(false);
    sim.state.time = deadline; expect(concealed(p, sim.state)).toBe(true);
  });

  it('隐蔽敌军在模型和雷达的共用名单里消失，但盲射仍能击中', () => {
    const { sim, p, enemy } = encounter();
    p.x = -8; p.z = 19; enemy.x = -8; enemy.z = 30;
    updateVisibility(sim.state);
    expect(sim.state.visibleEnemies).not.toContain(enemy.id);
    expect(visibleTo(sim.state, p, enemy)).toBe(false);
    const hit = traceShot(sim.state, 'player', { x: enemy.x, y: groundHeight(enemy.x, enemy.z) + 1, z: enemy.z }, { x: enemy.x, y: groundHeight(enemy.x, enemy.z) + 1, z: enemy.z + 1 });
    expect(hit?.target).toEqual({ type: 'tank', id: enemy.id });
    enemy.exposedUntil = sim.state.time + 5; updateVisibility(sim.state);
    expect(sim.state.visibleEnemies).toContain(enemy.id);
  });

  it('营地需要范围和真实视线，队友发现后共享并永久保留', () => {
    const { sim, p } = encounter();
    updateVisibility(sim.state); expect(sim.state.enemyBaseDiscovered).toBe(false);
    const scout = sim.addPlayer('scout', '侦察兵')!;
    const base = mapFor().enemyBase;
    scout.x = base.x; scout.z = base.z + 8;
    sim.state.obstacles = [{ id: 800, kind: 'rock', x: base.x, z: base.z + 4, radius: 2, height: 6, hp: 80, maxHp: 80, rotation: 0 }];
    updateVisibility(sim.state); expect(sim.state.enemyBaseDiscovered).toBe(false);
    sim.state.obstacles[0].hp = 0; updateVisibility(sim.state);
    expect(sim.state.enemyBaseDiscovered).toBe(true);
    expect(sim.state.explored.length).toBeGreaterThan(0);
    scout.hp = 0; p.z = 40; updateVisibility(sim.state);
    expect(sim.state.enemyBaseDiscovered).toBe(true);
  });
});
