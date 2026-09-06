import { describe, expect, it } from 'vitest';
import { Simulation } from '../src/game/simulation';
import { mapFor } from '../src/game/maps';
import { groundHeight } from '../src/game/terrain';
import { concealed } from '../src/game/visibility';
import { ambushReady, attackDamage, impactKind, tankImpact, TACTICS } from '../src/game/tactics';
import { EMPTY_INPUT, type Input, type Shell, type Tank } from '../src/game/types';
import { vehicleKinds, type TankKind } from '../src/game/vehicles';

function setup(kind: TankKind = 'standard') {
  const sim = new Simulation(47), player = sim.addPlayer('p', '玩家', undefined, kind)!;
  sim.start(); sim.state.phase = 'battle'; sim.state.remaining = 0;
  sim.state.sites = []; sim.state.obstacles = []; sim.state.drops = [];
  player.x = 0; player.z = 24; player.angle = player.turret = 0; player.repairCooldown = 9999;
  // 隔离命中规则，目标保持原位；仍通过真实弹道、命中与维修流程。
  (sim as any).enemyInput = (t: Tank) => ({ ...EMPTY_INPUT, aim: t.turret });
  const tick = (seconds: number, input: Partial<Input> = {}) => {
    for (let i = 0; i < Math.round(seconds * 30); i++) { sim.input('p', { ...EMPTY_INPUT, aim: player.turret, ...input }); sim.step(1 / 30); }
  };
  const hit = (tank: Tank, angle: number, damage = 20, ambush = false) => {
    const shell: Shell = { id: 900000, owner: tank.team === 'player' ? 'e' : 'p', team: tank.team === 'player' ? 'enemy' : 'player',
      x: tank.x + Math.sin(angle) * 0.2, z: tank.z + Math.cos(angle) * 0.2, y: groundHeight(tank.x, tank.z, mapFor(sim.state.mapSize)) + 1,
      vx: -Math.sin(angle) * 27, vy: 0, vz: -Math.cos(angle) * 27, damage, life: 1, ...(ambush ? { ambush: true } : {}) };
    sim.state.shells = [shell]; tick(1 / 30);
    return sim.state.events.findLast(e => e.kind === 'hit')!;
  };
  return { sim, player, tick, hit };
}

describe('方向装甲与后部弱点', () => {
  it.each(vehicleKinds)('%s 敌我坦克都按车身朝向结算，炮塔和射手位置不参与方位判断', kind => {
    const { sim, player, hit } = setup(kind);
    for (const team of ['player', 'enemy'] as const) {
      const tank = team === 'player' ? player : { ...player, id: 'e', team, x: 10, stats: { ...player.stats }, buffs: { ...player.buffs } };
      if (team === 'enemy') sim.state.tanks.push(tank);
      tank.angle = 0; tank.turret = Math.PI;
      for (const [angle, expected, amount] of [[0, kind === 'heavy' ? 'armor' : 'normal', kind === 'heavy' ? 16 : 20], [Math.PI / 2, 'normal', 20], [Math.PI, 'weakpoint', 25]] as const) {
        tank.hp = tank.maxHp;
        const event = hit(tank, angle);
        expect(tank.maxHp - tank.hp).toBeCloseTo(amount);
        expect(event).toMatchObject({ impact: expected, target: 'tank', victim: tank.id });
      }
    }
  });

  it('方位角跨越 ±π 和前后 120° 边界时正确，静止弹道没有弱点奖励', () => {
    const { player } = setup('heavy');
    const shell = (angle: number) => ({ vx: -Math.sin(angle), vz: -Math.cos(angle) });
    for (const heading of [0, 1.7, Math.PI, -Math.PI]) {
      player.angle = heading;
      expect(impactKind(player, shell(heading + Math.PI / 3))).toBe('armor');
      expect(impactKind(player, shell(heading + Math.PI / 3 + 0.01))).toBe('normal');
      expect(impactKind(player, shell(heading + Math.PI * 2 / 3))).toBe('weakpoint');
      expect(impactKind(player, shell(heading - Math.PI))).toBe('weakpoint');
    }
    expect(impactKind(player, { vx: 0, vz: 0 })).toBe('normal');
  });

  it('伏击与后部增伤合计封顶 35%，所有车型的蓄力炮也不能单发击毁满血坦克', () => {
    expect(attackDamage({ damage: 20, ambush: true }, true)).toBe(27);
    for (const kind of vehicleKinds) for (const hp of [60, 90, 110, 120, 180, 223]) {
      const { player, hit } = setup(kind); player.hp = player.maxHp = hp;
      const event = hit(player, Math.PI, 10000, true);
      expect(player.hp).toBe(1); expect(event.ambush).toBe(true); expect(event.impact).toBe('weakpoint');
      hit(player, Math.PI); expect(player.hp).toBe(0);
    }
  });

  it('方向、掩护和道具护盾按顺序计算，护盾全吸收时不显示虚假的弱点受伤', () => {
    const { player, hit } = setup('heavy');
    const shell = { damage: 20, vx: 0, vz: -27, ambush: true } as Shell;
    expect(tankImpact(player, shell, 0.25).damage).toBeCloseTo(13.8);
    player.buffs.armor = 30; const event = hit(player, Math.PI);
    expect(player.hp).toBe(180); expect(player.buffs.armor).toBe(5); expect(event.impact).toBe('shield');
    hit(player, Math.PI); expect(player.hp).toBe(160); expect(player.buffs.armor).toBe(0);
    player.shield = 3; const shield = hit(player, Math.PI, 100, true);
    expect(player.hp).toBe(160); expect(shield.impact).toBe('shield');
  });
});

describe('草丛首炮伏击', () => {
  it('持续隐蔽后准备首炮，短暂进出、受击和断线会重置准备', () => {
    const { sim, player, tick, hit } = setup();
    const grass = mapFor().grass[0]; player.x = grass.x; player.z = grass.z;
    tick(1); expect(ambushReady(player, sim.state)).toBe(false);
    player.x = 0; player.z = 24; tick(1 / 30); expect(player.ambushCharge).toBe(0);
    player.x = grass.x; player.z = grass.z; tick(1.6); expect(ambushReady(player, sim.state)).toBe(true);
    hit(player, 0); expect(player.ambushCharge).toBe(0);
    tick(1.6); expect(ambushReady(player, sim.state)).toBe(true);
    sim.disconnect(player.id); expect(player.ambushCharge).toBe(0);
    sim.addPlayer(player.id, '重连'); expect(ambushReady(player, sim.state)).toBe(false);
  });

  it('三连发只有第一弹获得伏击，开火后暴露，重新隐蔽并准备才能再次触发', () => {
    const { sim, player, tick } = setup();
    Object.assign(player, mapFor().grass[0]); player.buffs.burst = 2;
    tick(1.6); expect(ambushReady(player, sim.state)).toBe(true);
    tick(1 / 30, { fire: true }); tick(0.3);
    expect(sim.state.events.filter(e => e.kind === 'shot').map(e => !!e.ambush)).toEqual([true, false, false]);
    expect(concealed(player, sim.state)).toBe(false); expect(player.ambushCharge).toBe(0);
    tick(4); expect(ambushReady(player, sim.state)).toBe(false);
    tick(TACTICS.revealSeconds + TACTICS.ambushSeconds); expect(ambushReady(player, sim.state)).toBe(true);
  });

  it('蓄力取消不会消费首炮，松开发射才消费；暂停不累积伏击准备', () => {
    const { sim, player, tick } = setup('heavy'); Object.assign(player, mapFor().grass[0]);
    sim.state.paused = true; tick(5); expect(player.ambushCharge).toBe(0);
    sim.state.paused = false; tick(1.6); tick(0.5, { fire: true, chargeMode: true });
    tick(1 / 30, { chargeMode: true, cancelCharge: 1 });
    expect(ambushReady(player, sim.state)).toBe(true); expect(sim.state.events.some(e => e.kind === 'shot')).toBe(false);
    tick(2.1, { fire: true, chargeMode: true, cancelCharge: 1 }); tick(1 / 30, { chargeMode: true, cancelCharge: 1 });
    expect(sim.state.events.findLast(e => e.kind === 'shot')).toMatchObject({ charge: 1, ambush: true });
    expect(player.ambushCharge).toBe(0);
    player.hp = 0; player.respawn = 0.05; tick(0.1); expect(player.ambushCharge).toBe(0);
  });

  it('实际伏击炮的散布只有普通炮的 40%，转动炮塔不会获得准备奖励', () => {
    const { sim, player, tick } = setup(); Object.assign(player, mapFor().grass[0]); player.hp = 60;
    (sim as any).random = () => 0.8;
    tick(1.6); tick(1 / 30, { fire: true });
    const first = sim.state.shells.at(-1)!; const ambushAngle = Math.atan2(first.vx, first.vz) - player.turret;
    expect(first.ambush).toBe(true);
    player.cooldown = 0; tick(1 / 30, { fire: true });
    const second = sim.state.shells.at(-1)!;
    expect(second.ambush).toBeUndefined(); expect(ambushAngle / (Math.atan2(second.vx, second.vz) - player.turret)).toBeCloseTo(0.4);
    player.x = 0; player.z = 24; tick(6, { aim: 1 }); expect(ambushReady(player, sim.state)).toBe(false);
  });

  it('伏击伤害同样作用于可破坏物，掩护区域本身不提供伏击奖励', () => {
    const { sim, player, tick } = setup();
    sim.state.obstacles = [{ id: 9900, kind: 'rock', x: 8, z: 24, hp: 100, maxHp: 100, height: 3, radius: 1, rotation: 0 }];
    sim.state.shells = [{ id: 9901, owner: 'p', team: 'player', x: 8, z: 24, y: groundHeight(8, 24) + 1, vx: 0, vy: 0, vz: 0, damage: 20, ambush: true, life: 1 }];
    tick(1 / 30); expect(sim.state.obstacles[0].hp).toBe(77);
    const river = mapFor().rivers.find(r => r.kind === 'shallow')!; player.x = river.x; player.z = river.z;
    tick(2); expect(ambushReady(player, sim.state)).toBe(false);
  });
});
