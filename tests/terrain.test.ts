import { describe, expect, it } from 'vitest';
import { Simulation } from '../src/game/simulation';
import { BASE, ENEMY_BASE, PLAYER_SPAWN_Z, type Tank } from '../src/game/types';
import { groundHeight, groundSlope, slopeSpeed, terrainIntersection } from '../src/game/terrain';
import { SHOT_HEIGHT, shotSlope, traceShot } from '../src/game/combat';
import { createMap, findPath } from '../src/game/world';

describe('可驾驶山谷地形', () => {
  it('两侧有明显高地，营地、出生点和中央谷道保持平整', () => {
    expect(groundHeight(-25, -18)).toBeGreaterThan(7.8);
    expect(groundHeight(25, 18)).toBeGreaterThan(7);
    for (const z of [BASE.z, ENEMY_BASE.z, PLAYER_SPAWN_Z, -24, 0, 24]) expect(groundHeight(0, z)).toBe(0);
    for (const x of [-3.75, -1.25, 1.25, 3.75]) expect(groundHeight(x, PLAYER_SPAWN_Z)).toBe(0);
    for (let z = -59; z < 60; z += 2) for (let x = -47; x < 48; x += 2) {
      const slope = groundSlope(x, z);
      expect(Math.hypot(slope.x, slope.z)).toBeLessThan(0.8);
    }
  });

  it('沿坡面上行比平地慢，下坡仍可控且保持玩家输入方向', () => {
    const sim = new Simulation(47);
    const player = sim.addPlayer('player', '坡地坦克')!;
    sim.start();
    sim.state.obstacles = [];
    player.x = 12;
    player.z = 18;
    const height = groundHeight(player.x, player.z);
    for (let i = 0; i < 30; i++) {
      sim.input(player.id, { moveX: 1, moveZ: 0, aim: 0, fire: false });
      sim.step(1 / 30);
    }
    expect(groundHeight(player.x, player.z)).toBeGreaterThan(height + 1.5);
    expect(player.x - 12).toBeGreaterThan(4);
    expect(player.x - 12).toBeLessThan(6);
    expect(player.z).toBe(18);
    expect(slopeSpeed(12, 18, 1, 0)).toBeLessThan(slopeSpeed(12, 18, -1, 0));
    expect(slopeSpeed(12, 18, -1, 0)).toBeLessThanOrEqual(1);
  });

  it('不同随机布局都能从谷道沿横向通路驶上两侧高地', () => {
    for (const seed of [1, 47, 150, 9001]) {
      const map = createMap(seed);
      for (const side of [-1, 1]) {
        const destination = { x: side * 30, z: side * 24 };
        const path = findPath({ x: 0, z: side * 24 }, destination, map);
        expect(Math.hypot(path.at(-1)!.x - destination.x, path.at(-1)!.z - destination.z)).toBeLessThan(3);
        expect(path.some(p => groundHeight(p.x, p.z) > 5)).toBe(true);
      }
    }
  });

  it('长射线和分段射线命中同一个坡面，山坡不会被高速炮弹穿透', () => {
    const a = { x: -48, y: 1.13, z: -18 };
    const b = { x: 0, y: 1.13, z: -18 };
    const hit = terrainIntersection(a, b)!;
    expect(hit).toBeGreaterThan(0);
    expect(hit).toBeLessThan(0.3);
    const x = a.x + (b.x - a.x) * hit;
    expect(groundHeight(x, -18)).toBeCloseTo(1.05, 8);
    const start = { ...a, x: x - 0.5 };
    const end = { ...a, x: x + 0.5 };
    expect(terrainIntersection(start, end)).toBeCloseTo(0.5, 8);
    expect(terrainIntersection({ ...a, y: 12 }, { ...b, y: 12 })).toBeNull();
  });
});

describe('高低差炮战', () => {
  function scene() {
    const sim = new Simulation(47);
    const player = sim.addPlayer('player', '瞄准坦克')!;
    sim.start();
    sim.state.obstacles = [];
    player.x = 9;
    player.z = 18;
    player.turret = Math.PI / 2;
    const enemy: Tank = { ...player, id: 'target', team: 'enemy', x: 14, buffs: { ...player.buffs } };
    sim.state.tanks.push(enemy);
    return { sim, player, enemy };
  }

  it('炮管辅助仰角可命中坡上的目标，无需增加手机操作按钮', () => {
    const { sim, player, enemy } = scene();
    const slope = shotSlope(sim.state, player);
    expect(slope).toBeGreaterThan(0.3);
    const a = { x: player.x, y: groundHeight(player.x, player.z) + SHOT_HEIGHT, z: player.z };
    const b = { x: enemy.x, y: a.y + (enemy.x - player.x) * slope, z: enemy.z };
    expect(traceShot(sim.state, 'player', a, b)?.target).toEqual({ type: 'tank', id: enemy.id });
  });

  it('地形遮挡优先于坡后目标，不能隔着高地造成伤害', () => {
    const { sim, enemy } = scene();
    enemy.x = 0;
    enemy.z = -18;
    const hit = traceShot(sim.state, 'player', { x: -48, y: 1.13, z: -18 }, { x: 1, y: 1.13, z: -18 });
    expect(hit).not.toBeNull();
    expect(hit!.target).toBeNull();
  });

  it('高处炮弹能越过低处坦克和矮墙，降到实际碰撞高度才命中', () => {
    const { sim, enemy } = scene();
    enemy.x = 0;
    enemy.z = 0;
    sim.state.obstacles = [{ id: 1, kind: 'wall', team: 'enemy', x: -3, z: 0, radius: 1, height: 1.95, hp: 100, maxHp: 100, rotation: 0 }];
    expect(traceShot(sim.state, 'player', { x: -5, y: 4, z: 0 }, { x: 2, y: 4, z: 0 })).toBeNull();
    expect(traceShot(sim.state, 'player', { x: -5, y: 1.13, z: 0 }, { x: 2, y: 1.13, z: 0 })?.target).toEqual({ type: 'obstacle', id: 1 });
    expect(traceShot(sim.state, 'player', { x: -1, y: 4, z: 0 }, { x: 0, y: 1, z: 0 })?.target).toEqual({ type: 'tank', id: enemy.id });
  });
});
