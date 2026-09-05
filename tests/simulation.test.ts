import { describe, expect, it } from 'vitest';
import { Simulation } from '../src/game/simulation';
import { BASE, cleanInput, damageHandling, type Power, type Shell } from '../src/game/types';
import { blocked, createMap, findPath, segmentCircle } from '../src/game/world';

function battle() {
  const sim = new Simulation(25, 'defense');
  const player = sim.addPlayer('player', '测试坦克')!;
  sim.start();
  sim.state.phase = 'battle';
  sim.state.wave = 1;
  sim.state.remaining = 5;
  player.x = 0;
  player.z = 0;
  return { sim, player };
}

function impact(x: number, z: number, damage = 20): Shell {
  return { id: 99999, owner: 'enemy-test', team: 'enemy', x, z, vx: 0, vz: 27, damage, life: 1 };
}

describe('战斗规则', () => {
  it.each([
    { moveX: 1, moveZ: 0 },
    { moveX: -1, moveZ: 0 },
    { moveX: 0, moveZ: 1 },
    { moveX: 0, moveZ: -1 },
  ])('方向输入 $moveX / $moveZ 立即移动，车身自动转向且炮塔独立', movement => {
    const { sim, player } = battle();
    sim.state.obstacles = [];
    sim.input(player.id, { ...movement, aim: Math.PI, fire: false });
    sim.step(1 / 30);
    expect(player.x).toBeCloseTo(movement.moveX * 0.2);
    expect(player.z).toBeCloseTo(movement.moveZ * 0.2);
    for (let i = 0; i < 15; i++) {
      sim.input(player.id, { ...movement, aim: Math.PI, fire: false });
      sim.step(1 / 30);
    }
    expect(Math.sin(player.angle)).toBeCloseTo(movement.moveX);
    expect(Math.cos(player.angle)).toBeCloseTo(movement.moveZ);
    expect(player.turret).toBeCloseTo(Math.PI);
  });

  it('方向移动保持碰撞约束、受损减速与斜向限速', () => {
    const { sim, player } = battle();
    player.hp = 10;
    sim.state.obstacles = [{ id: 1, kind: 'rock', x: 2, z: 0, radius: 1, height: 3, hp: 80, maxHp: 80, rotation: 0 }];
    sim.input(player.id, { moveX: 1, moveZ: 0, aim: Math.PI, fire: false });
    sim.step(1 / 30);
    expect(player.x).toBe(0);
    sim.state.obstacles = [];
    sim.input(player.id, { moveX: 1, moveZ: 1, aim: Math.PI, fire: false });
    sim.step(1 / 30);
    expect(Math.hypot(player.x, player.z)).toBeCloseTo(0.2 * damageHandling(player.hp, player.maxHp).speed);
  });

  it('普通炮弹不会秒杀满血坦克和营地', () => {
    const { sim, player } = battle();
    sim.state.shells.push(impact(player.x, player.z));
    sim.step(1 / 30);
    expect(player.hp).toBe(100);
    sim.state.shells.push(impact(BASE.x, BASE.z));
    sim.step(1 / 30);
    expect(sim.state.baseHp).toBe(580);
  });

  it('持续按住开火仍受装填冷却限制', () => {
    const { sim, player } = battle();
    for (let i = 0; i < 90; i++) {
      sim.input(player.id, { moveX: 0, moveZ: 0, aim: Math.PI, fire: true });
      sim.step(1 / 30);
    }
    const shots = sim.state.events.filter(e => e.kind === 'shot' && e.owner === player.id);
    expect(shots.length).toBe(3);
  });

  it('受损状态逐步减速、扩大散布，并保留最低机动能力', () => {
    const normal = damageHandling(120, 120);
    const damaged = damageHandling(50, 120);
    const critical = damageHandling(10, 120);
    expect(damaged.speed).toBeLessThan(normal.speed);
    expect(critical.speed).toBeGreaterThanOrEqual(0.75);
    expect(critical.spread).toBeGreaterThan(damaged.spread);
  });

  it('维修恢复血量，强化装甲减少后续伤害', () => {
    const { sim, player } = battle();
    player.hp = 30;
    sim.state.drops.push({ id: 100, kind: 'heal', x: 0, z: 0, life: 10 });
    sim.step(1 / 30);
    expect(player.hp).toBe(72);
    player.buffs.armor = 10;
    sim.state.shells.push(impact(0, 0));
    sim.step(1 / 30);
    expect(player.hp).toBe(58);
  });

  it('同一份补给只能被一辆坦克拾取', () => {
    const { sim, player } = battle();
    const teammate = sim.addPlayer('second', '队友')!;
    teammate.x = 0;
    teammate.z = 0;
    for (const t of [player, teammate]) t.hp = 30;
    sim.state.drops = [{ id: 10, kind: 'heal', x: 0, z: 0, life: 10 }];
    sim.step(1 / 30);
    expect([player.hp, teammate.hp].sort()).toEqual([30, 72]);
  });

  it('满血时保留维修包，留给受伤后或队友使用', () => {
    const { sim, player } = battle();
    sim.state.drops = [{ id: 10, kind: 'heal', x: 0, z: 0, life: 10 }];
    sim.step(1 / 30);
    expect(sim.state.drops.length).toBe(1);
    player.hp = 50;
    sim.step(1 / 30);
    expect(player.hp).toBe(92);
    expect(sim.state.drops.length).toBe(0);
  });

  it('连发的三枚炮弹仍无法一轮击毁满血轻型坦克', () => {
    const { sim, player } = battle();
    player.buffs.burst = 10;
    sim.input(player.id, { moveX: 0, moveZ: 0, aim: Math.PI, fire: true });
    for (let i = 0; i < 10; i++) sim.step(1 / 30);
    const shells = sim.state.shells.filter(s => s.owner === player.id);
    expect(shells.length).toBe(3);
    expect(shells.reduce((sum, s) => sum + s.damage, 0)).toBeLessThan(80);
  });

  it('断线输入过期后不会一直前进', () => {
    const { sim, player } = battle();
    sim.input(player.id, { moveX: 0, moveZ: -1, aim: Math.PI, fire: false });
    for (let i = 0; i < 30; i++) sim.step(1 / 30);
    const stopped = player.z;
    for (let i = 0; i < 30; i++) sim.step(1 / 30);
    expect(player.z).toBe(stopped);
    expect(stopped).toBeLessThan(0);
  });

  it('备用坦克耗尽后判负，清除最后一波后判胜', () => {
    const { sim, player } = battle();
    player.hp = 10;
    player.lives = 0;
    sim.state.shells.push(impact(0, 0));
    sim.step(1 / 30);
    expect(sim.state.phase).toBe('lost');
    const won = battle().sim;
    won.state.wave = 5;
    won.state.remaining = 0;
    won.step(1 / 30);
    expect(won.state.phase).toBe('won');
  });

  it('被击毁后消耗备用坦克，复活带保护且重置增益', () => {
    const { sim, player } = battle();
    player.hp = 10;
    player.buffs.rapid = 12;
    sim.state.shells.push(impact(0, 0));
    sim.step(1 / 30);
    expect(player.lives).toBe(1);
    expect(player.respawn).toBe(5);
    for (let i = 0; i < 151; i++) sim.step(1 / 30);
    expect(player.hp).toBe(120);
    expect(player.shield).toBeGreaterThan(3);
    expect(player.buffs.rapid).toBe(0);
  });

  it('暂停后模拟时间、装填和炮弹都停止', () => {
    const { sim, player } = battle();
    player.cooldown = 0.8;
    sim.state.paused = true;
    sim.step(1 / 30);
    expect(sim.state.time).toBe(0);
    expect(player.cooldown).toBe(0.8);
  });
});

describe('地图、导航与网络边界', () => {
  it('同一地图种子得到一致的障碍布局', () => {
    expect(createMap(42)).toEqual(createMap(42));
    expect(createMap(42)).not.toEqual(createMap(43));
  });

  it('岩壁摧毁后碰撞解除，A* 能找到穿过缺口的道路', () => {
    const wall = { id: 1, kind: 'rock' as const, x: 0, z: -1, radius: 2.5, height: 4, hp: 80, maxHp: 80, rotation: 0 };
    expect(blocked(0, -1, [wall])).toBe(true);
    const before = findPath({ x: 0, z: 7 }, { x: 0, z: -9 }, [wall]);
    expect(before.some(p => Math.abs(p.x) >= 4)).toBe(true);
    wall.hp = 0;
    expect(blocked(0, -1, [wall])).toBe(false);
    const after = findPath({ x: 0, z: 7 }, { x: 0, z: -9 }, [wall]);
    expect(after.every(p => p.x === 0)).toBe(true);
  });

  it('高速炮弹的连续碰撞不会跳过薄墙', () => {
    expect(segmentCircle(0, 0, 100, 0, 50, 0, 1)).toBeCloseTo(0.49);
    expect(segmentCircle(0, 0, 100, 0, 50, 5, 1)).toBeNull();
  });

  it('拒绝非法输入，限制客户端提供的移动量', () => {
    expect(cleanInput({ moveX: NaN, moveZ: 0, aim: 0, fire: true })).toBeNull();
    expect(cleanInput({ moveX: 100, moveZ: 0, aim: 0, fire: 1 })).toEqual({ moveX: 1, moveZ: 0, aim: 0, fire: false });
    const diagonal = cleanInput({ moveX: 100, moveZ: -100, aim: 0, fire: false })!;
    expect(Math.hypot(diagonal.moveX, diagonal.moveZ)).toBeCloseTo(1);
    expect(cleanInput({ moveX: 0, moveZ: Infinity, aim: 0, fire: false })).toBeNull();
    expect(cleanInput({ throttle: 1, steer: 0, aim: 0, fire: false })).toBeNull();
  });

  it('房间最多容纳四人，重连恢复同一辆坦克', () => {
    const sim = new Simulation(1);
    for (let i = 0; i < 4; i++) sim.addPlayer(String(i), '守卫者');
    expect(sim.addPlayer('fifth', '第五人')).toBeNull();
    sim.start();
    sim.state.tanks[1].hp = 50;
    sim.disconnect('1');
    expect(sim.addPlayer('1', '重连')?.hp).toBe(50);
    expect(sim.state.tanks.length).toBe(4);
  });
});
