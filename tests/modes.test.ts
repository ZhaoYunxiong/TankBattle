import { mapFor } from '../src/game/maps';
import { describe, expect, it } from 'vitest';
import { Simulation } from '../src/game/simulation';
import { groundHeight } from '../src/game/terrain';
import { ARENA, BASE, ENEMY_BASE, PLAYER_SPAWN_Z, SIDE_LANE, CROSSINGS, distance, pickupHint, type GameMode, type Power, type Shell, type Tank } from '../src/game/types';
import { blocked, createMap, findPath } from '../src/game/world';

function battle(mode: GameMode = 'classic') {
  const sim = new Simulation(47, mode);
  const player = sim.addPlayer('player', '坦克手')!;
  sim.start();
  sim.state.countdown = 0;
  sim.step(1 / 30);
  return { sim, player };
}

function shell(x: number, z: number, team: Tank['team']): Shell {
  return { id: 999999, owner: team === 'player' ? 'player' : 'enemy-test', team, x, y: groundHeight(x, z) + 1.13, z, vx: 0, vy: 0, vz: 0, damage: 20, life: 1 };
}

describe('经典攻防与防守模式', () => {
  it('默认经典模式有双方营地和围墙，防守模式只有己方阵地', () => {
    const classic = new Simulation(47).state;
    const defense = new Simulation(47, 'defense').state;
    expect(classic.mode).toBe('classic');
    expect(classic.enemyBaseHp).toBe(360);
    expect(classic.obstacles.filter(o => o.team === 'enemy')).toHaveLength(15);
    expect(classic.obstacles.filter(o => o.team === 'player')).toHaveLength(15);
    expect(defense.enemyBaseHp).toBe(0);
    expect(defense.obstacles.some(o => o.team === 'enemy')).toBe(false);
    expect(blocked(ENEMY_BASE.x, ENEMY_BASE.z, [], 0.85, 'defense')).toBe(false);
    expect(blocked(ENEMY_BASE.x, ENEMY_BASE.z, [], 0.85, 'classic')).toBe(true);
  });

  it('经典模式清空敌军不获胜，敌军营地需要多炮才能摧毁', () => {
    const { sim, player } = battle();
    sim.state.remaining = 0;
    sim.step(1 / 30);
    expect(sim.state.phase).toBe('battle');
    for (let shot = 1; shot <= 18; shot++) {
      sim.state.shells.push(shell(ENEMY_BASE.x, ENEMY_BASE.z, 'player'));
      sim.step(1 / 30);
      expect(sim.state.enemyBaseHp).toBe(360 - shot * 20);
      expect(sim.state.phase).toBe(shot < 18 ? 'battle' : 'won');
    }
    expect(player.score).toBe(1000);
    expect(sim.state.events.filter(e => e.kind === 'destroy' && e.z === ENEMY_BASE.z)).toHaveLength(1);
    const time = sim.state.time;
    sim.step(1 / 30);
    expect(sim.state.time).toBe(time);
  });

  it('经典模式己方营地被毁判负，本方炮弹不会伤害自己的核心', () => {
    const { sim } = battle();
    sim.state.shells.push(shell(BASE.x, BASE.z, 'player'));
    sim.state.shells.push(shell(ENEMY_BASE.x, ENEMY_BASE.z, 'enemy'));
    sim.step(1 / 30);
    expect(sim.state.baseHp).toBe(600);
    expect(sim.state.enemyBaseHp).toBe(360);
    sim.state.baseHp = 20;
    sim.state.shells.push(shell(BASE.x, BASE.z, 'enemy'));
    sim.step(1 / 30);
    expect(sim.state.phase).toBe('lost');
    expect(sim.state.baseHp).toBe(0);
  });

  it.each(['player', 'enemy'] as const)('%s 围墙承受敌方炮击，本方炮弹不会破坏围墙', team => {
    const { sim } = battle();
    const wall = { id: 1, kind: 'wall' as const, team, x: 0, z: 0, radius: 1, height: 1.5, hp: 100, maxHp: 100, rotation: 0 };
    sim.state.obstacles = [wall];
    sim.state.shells.push(shell(0, 0, team));
    sim.step(1 / 30);
    expect(wall.hp).toBe(100);
    sim.state.shells.push(shell(0, 0, team === 'player' ? 'enemy' : 'player'));
    sim.step(1 / 30);
    expect(wall.hp).toBe(80);
  });

  it('防守模式仍按五波推进，最后一波清空后获胜', () => {
    const { sim } = battle('defense');
    for (let wave = 1; wave <= 5; wave++) {
      expect(sim.state.wave).toBe(wave);
      expect(sim.state.remaining).toBe(3 + wave);
      sim.state.remaining = 0;
      sim.state.tanks = sim.state.tanks.filter(t => t.team === 'player');
      sim.step(1 / 30);
      expect(sim.state.phase).toBe(wave < 5 ? 'intermission' : 'won');
      if (wave < 5) {
        sim.state.countdown = 0;
        sim.step(1 / 30);
      }
    }
  });

  it('经典模式首批两辆进攻与一辆驻军，同时在场不超过三辆', () => {
    const { sim } = battle();
    for (let frame = 0; frame < 900; frame++) sim.step(1 / 30);
    const enemies = sim.state.tanks.filter(t => t.team === 'enemy');
    expect(enemies.length).toBeGreaterThanOrEqual(3);
    expect(enemies.length).toBeLessThanOrEqual(3);
    expect(enemies.some(t => t.z < ENEMY_BASE.z + 13)).toBe(true);
    expect(enemies.some(t => t.z > -20)).toBe(true);
    expect(sim.state.phase).toBe('battle');
  });
});

describe('扩大后的地图和补给反馈', () => {
  it.each(['classic', 'defense'] as const)('%s 出生区、桥梁可通行，深河不能直接穿越', mode => {
    expect(ARENA.x * 2 * ARENA.z * 2).toBe(96 * 120);
    const obstacles = createMap(47, mode);
    for (const x of [-3.75, -1.25, 1.25, 3.75]) expect(blocked(x, PLAYER_SPAWN_Z, obstacles, 0.85, mode)).toBe(false);
    for (const bridge of mapFor().bridges) for (let z = bridge.z - 7; z <= bridge.z + 7; z += 0.5) expect(blocked(bridge.x, z, obstacles, 0.85, mode)).toBe(false);
    expect(blocked(20, -4, obstacles, 0.85, mode)).toBe(true);
    expect(blocked(ARENA.x, 0, [], 0.85, mode)).toBe(true);
    expect(blocked(0, ARENA.z, [], 0.85, mode)).toBe(true);
  });

  it('导航覆盖扩大后的南北区域，能通过营地正门到达攻击位置', () => {
    const obstacles = createMap(47, 'classic');
    const path = findPath({ x: 0, z: PLAYER_SPAWN_Z }, ENEMY_BASE, obstacles, 'classic');
    expect(path.some(p => p.z < -30)).toBe(true);
    expect(distance(path.at(-1)!, ENEMY_BASE)).toBeLessThan(5.3);
    expect(path.every(p => !blocked(p.x, p.z, obstacles, 0.95, 'classic'))).toBe(true);
  });

  it('满血维修包有明确提示，受伤后显示回血效果', () => {
    const { player } = battle();
    expect(pickupHint('heal', player)).toContain('满血无需维修');
    player.hp = 60;
    expect(pickupHint('heal', player)).toContain('恢复 35%');
  });

  it.each(['rapid', 'burst', 'armor'] as Power[])('满血可正常拾取 %s，反馈事件带有补给名称', kind => {
    const { sim, player } = battle();
    sim.state.drops = [{ id: 10, kind, x: player.x, z: player.z, life: 10 }];
    sim.step(1 / 30);
    expect(sim.state.drops).toHaveLength(0);
    expect(player.buffs[kind]).toBeGreaterThan(0);
    expect(sim.state.events.at(-1)).toMatchObject({ kind: 'pickup', power: kind, owner: player.id });
  });
});
