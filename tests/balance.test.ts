import { describe, expect, it } from 'vitest';
import { Simulation } from '../src/game/simulation';
import { DIFFICULTIES, enemyLimit, waveSize } from '../src/game/balance';
import { damageHandling, distance, ENEMY_BASE, type Difficulty, type Shell, type Tank } from '../src/game/types';
import { groundHeight } from '../src/game/terrain';
import { blocked } from '../src/game/world';

function advance(sim: Simulation, seconds: number) {
  for (let i = 0; i < Math.round(seconds * 30); i++) sim.step(1 / 30);
}

function battle(difficulty: Difficulty = 'normal', count = 1) {
  const sim = new Simulation(47, 'classic', difficulty);
  for (let i = 0; i < count; i++) sim.addPlayer('p' + i, '玩家');
  sim.start();
  sim.state.countdown = 0;
  sim.step(1 / 30);
  return sim;
}

// 此处验证击毁后的出兵节奏，足量伤害避免浅水掩护改变测试前提。
function damage(sim: Simulation, tank: Tank, amount = tank.maxHp * 2) {
  tank.shield = 0;
  const shell: Shell = { id: 900000, owner: 'p0', team: 'player', x: tank.x, y: groundHeight(tank.x, tank.z) + 1, z: tank.z, vx: 0, vy: 0, vz: 0, damage: amount, life: 1 };
  sim.state.shells.push(shell);
}

function encounter(enemyCount = 1) {
  const sim = battle();
  sim.state.remaining = 0;
  sim.state.obstacles = [];
  sim.state.drops = [];
  const player = sim.state.tanks[0];
  player.x = 0;
  player.z = 0;
  player.shield = 100;
  for (let i = 0; i < enemyCount; i++) sim.state.tanks.push({ ...player, id: 'e' + i, team: 'enemy', x: (i - (enemyCount - 1) / 2) * 3, z: -8, hp: 100, maxHp: 100, angle: 0, turret: 0, shield: 0, buffs: { rapid: 0, burst: 0, armor: 0, heal: 0 } });
  return { sim, player, enemy: sim.state.tanks[1] };
}

describe('难度与可反攻的出兵节奏', () => {
  it('默认普通，休闲和挑战确实改变部队强度，合作不叠加敌人血量', () => {
    expect(battle().state.difficulty).toBe('normal');
    const caps: number[] = [];
    for (const difficulty of ['casual', 'normal', 'challenge'] as const) {
      const solo = battle(difficulty);
      const coop = battle(difficulty, 4);
      advance(solo, 1.1);
      advance(coop, 1.1);
      expect(solo.state.enemyBaseHp).toBe(DIFFICULTIES[difficulty].baseHp);
      expect(coop.state.enemyBaseHp).toBe(solo.state.enemyBaseHp);
      expect(coop.state.tanks.find(t => t.team === 'enemy')!.maxHp).toBe(solo.state.tanks.find(t => t.team === 'enemy')!.maxHp);
      expect(coop.state.remaining).toBeGreaterThan(solo.state.remaining);
      caps.push(enemyLimit(difficulty, 1));
    }
    expect(caps).toEqual([2, 3, 4]);
    expect(battle().state.enemyBaseHp).toBe(360);
    expect(DIFFICULTIES.normal.hp).toEqual({ scout: 80, standard: 100, heavy: 140 });
  });

  it('两辆进攻坦克被击毁后休整二十秒，存活驻军不阻止反攻窗口', () => {
    const sim = battle();
    advance(sim, 13);
    const enemies = sim.state.tanks.filter(t => t.team === 'enemy');
    expect(enemies).toHaveLength(3);
    const guard = enemies[0];
    expect(distance(guard, ENEMY_BASE)).toBeLessThan(15);
    for (const tank of enemies.slice(1)) damage(sim, tank);
    sim.step(1 / 30);
    sim.step(1 / 30);
    expect(sim.state.reinforcementCountdown).toBe(20);
    const remaining = sim.state.remaining;
    advance(sim, 19);
    expect(sim.state.remaining).toBe(remaining);
    expect(sim.state.tanks.filter(t => t.team === 'enemy').map(t => t.id)).toEqual([guard.id]);
    advance(sim, 1.2);
    expect(sim.state.remaining).toBe(remaining - 1);
  });

  it('普通单人总共只有十八辆增援，全部消灭后仍需摧毁敌营', () => {
    const sim = battle();
    const seen = new Set<string>();
    for (let i = 0; i < 180 * 30; i++) {
      for (const t of sim.state.tanks.filter(t => t.team === 'enemy')) { seen.add(t.id); damage(sim, t); }
      sim.step(1 / 30);
    }
    expect(seen.size).toBe(18);
    expect(sim.state.remaining).toBe(0);
    expect(sim.state.tanks.every(t => t.team === 'player')).toBe(true);
    expect(sim.state.phase).toBe('battle');
    expect(sim.state.enemyBaseHp).toBe(360);
  });

  it('普通防守五波为四到八辆，波间十五秒并修复营地', () => {
    expect(Array.from({ length: 5 }, (_, i) => waveSize('normal', i + 1, 1))).toEqual([4, 5, 6, 7, 8]);
    const sim = new Simulation(47, 'defense');
    sim.addPlayer('p0', '玩家');
    sim.start();
    sim.state.countdown = 0;
    sim.step(1 / 30);
    sim.state.remaining = 0;
    sim.state.baseHp = 400;
    sim.step(1 / 30);
    expect(sim.state.phase).toBe('intermission');
    expect(sim.state.countdown).toBe(15);
    expect(sim.state.baseHp).toBe(445);
  });
});

describe('敌军反应、视线与集火限制', () => {
  it('发现目标后先反应和炮口预警，持续射击至少间隔三点五秒', () => {
    const { sim, enemy } = encounter();
    const warnings: number[] = [];
    const shots: number[] = [];
    const start = sim.state.time;
    for (let i = 0; i < 150; i++) {
      const previous = sim.state.events.at(-1)?.id ?? 0;
      sim.step(1 / 30);
      if (enemy.warning > 0) warnings.push(sim.state.time);
      if (sim.state.events.some(e => e.id > previous && e.kind === 'shot' && e.owner === enemy.id)) shots.push(sim.state.time);
    }
    expect(shots).toHaveLength(2);
    expect(shots[0] - start).toBeGreaterThanOrEqual(0.8);
    expect(shots[0] - start).toBeLessThanOrEqual(1.3);
    expect(shots[0] - warnings[0]).toBeGreaterThanOrEqual(0.36);
    expect(shots[1] - shots[0]).toBeGreaterThanOrEqual(3.5);
  });

  it('进入掩体后取消开火，不跟踪隐藏玩家的新位置，重新看到仍需反应', () => {
    const { sim, player, enemy } = encounter();
    advance(sim, 0.7);
    sim.state.obstacles = [{ id: 1, kind: 'rock', x: 0, z: -4, radius: 3, height: 5, hp: 100, maxHp: 100, rotation: 0 }];
    player.x = 5;
    advance(sim, 0.7);
    expect(sim.state.events.some(e => e.kind === 'shot')).toBe(false);
    expect(enemy.warning).toBe(0);
    expect(Math.abs(enemy.turret)).toBeLessThan(0.05);
    sim.state.obstacles = [];
    player.x = 0;
    advance(sim, 0.6);
    expect(sim.state.events.some(e => e.kind === 'shot')).toBe(false);
    advance(sim, 0.7);
    expect(sim.state.events.some(e => e.kind === 'shot' && e.owner === enemy.id)).toBe(true);
  });

  it('四个敌人看见同一玩家时，最多两个进入开炮预警和交火', () => {
    const { sim } = encounter(4);
    const shooters = new Set<string>();
    for (let i = 0; i < 90; i++) {
      sim.step(1 / 30);
      expect(sim.state.tanks.filter(t => t.warning > 0).length).toBeLessThanOrEqual(2);
      for (const event of sim.state.events) if (event.kind === 'shot') shooters.add(event.owner!);
    }
    expect(shooters.size).toBe(2);
  });
});

describe('战地维修与受损机动', () => {
  it('每三次击毁保证一个玩家身旁可达的维修包，满血时可留存', () => {
    const { sim, player, enemy } = encounter();
    for (let i = 1; i <= 6; i++) {
      const target = { ...enemy, id: 'kill-' + i, hp: 100, z: -15 };
      sim.state.tanks = [player, target];
      sim.state.drops = [];
      damage(sim, target);
      sim.step(1 / 30);
      if (i % 3 === 0) {
        const heal = sim.state.drops.find(d => d.kind === 'heal')!;
        expect(heal).toBeDefined();
        expect(distance(heal, player)).toBeLessThanOrEqual(3);
        expect(blocked(heal.x, heal.z, sim.state.obstacles, 0.85, sim.state.mode)).toBe(false);
        player.hp = 60;
        player.x = heal.x;
        player.z = heal.z;
        sim.step(1 / 30);
        expect(player.hp).toBe(102);
        player.hp = 120;
      }
    }
  });

  it('重损最多减速百分之十五，同时保留散布惩罚', () => {
    expect(damageHandling(0, 120).speed).toBe(0.85);
    expect(damageHandling(1, 120).spread).toBeGreaterThan(damageHandling(120, 120).spread);
  });
});
