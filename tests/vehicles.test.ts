import { describe, it, expect } from 'vitest';
import { Simulation } from '../src/game/simulation';
import { VEHICLES, vehicleKinds, type TankKind } from '../src/game/vehicles';
import { emptyLoadout } from '../src/game/factory';
import { groundHeight } from '../src/game/terrain';
import { mapFor } from '../src/game/maps';
import { boardKey, buyUpgrade, newProfile, parseProfile, resetFactory, selectVehicle, settle, unlockVehicle } from '../src/profile';
import type { Input, Tank } from '../src/game/types';

function battle(kind: TankKind = 'standard') {
  const sim = new Simulation(47), player = sim.addPlayer('p', '玩家', undefined, kind)!;
  sim.start(); Object.assign(sim.state, { phase: 'battle', remaining: 0, obstacles: [], sites: [], drops: [] });
  player.x = 0; player.z = 24;
  const tick = (seconds: number, value: Partial<Input> = {}) => {
    for (let i = 0; i < Math.round(seconds * 30); i++) {
      sim.input('p', { moveX: 0, moveZ: 0, aim: 0, fire: false, ...value }); sim.step(1 / 30);
    }
  };
  return { sim, player, tick };
}

function hit(sim: Simulation, tank: Tank, damage: number, vz = -27) {
  sim.state.shells.push({ id: 900000, owner: 'enemy', team: tank.team === 'player' ? 'enemy' : 'player', x: tank.x, z: tank.z + (vz < 0 ? 0.3 : -0.3), y: groundHeight(tank.x, tank.z, mapFor(sim.state.mapSize)) + 1, vx: 0, vy: 0, vz, damage, life: 1 });
  sim.step(1 / 30);
}

describe('四种可驾驶车型', () => {
  it('标准型保留原数值，四种车型各自应用现有工厂升级', () => {
    const standard = battle().player;
    expect(standard.kind).toBe('standard'); expect(standard.maxHp).toBe(120);
    expect(VEHICLES.standard).toMatchObject({ damage: 20, speed: 6, reload: 1, chargeDamage: 56 });
    const sim = new Simulation(47);
    for (const kind of vehicleKinds) {
      const p = sim.addPlayer(kind, kind, { ...emptyLoadout(), armor: 3 }, kind)!;
      expect(p.maxHp).toBe(Math.round(VEHICLES[kind].hp * 1.24));
    }
    expect(sim.state.tanks).toHaveLength(4);
  });

  it('大厅允许同款车型并取消客机准备，开战、死亡与重连不能换车刷新属性', () => {
    const sim = new Simulation(47), host = sim.addPlayer('h', '房主')!, guest = sim.addPlayer('g', '队友')!;
    guest.ready = true;
    expect(sim.selectVehicle('g', 'heavy')).toBe(true); expect(guest.ready).toBe(false); expect(guest.maxHp).toBe(180);
    expect(sim.selectVehicle('h', 'heavy')).toBe(true); expect(host.ready).toBe(true);
    expect(sim.selectVehicle('g', 'unknown')).toBe(false);
    sim.start(); guest.hp = 17;
    expect(sim.selectVehicle('g', 'scout')).toBe(false); expect(guest.hp).toBe(17);
    sim.disconnect('g'); sim.addPlayer('g', '改名', { armor: 3 }, 'engineer');
    expect(guest.kind).toBe('heavy'); expect(guest.hp).toBe(17); expect(guest.maxHp).toBe(180);
    guest.hp = 0; guest.respawn = 0.05; sim.step(0.1);
    expect(guest.kind).toBe('heavy'); expect(guest.hp).toBe(180);
  });

  it('实际行驶速度、射击间隔和加速消耗随车型改变', () => {
    const results = vehicleKinds.map(kind => {
      const { sim, player, tick } = battle(kind);
      tick(1, { moveX: 1, boost: true, fire: true });
      return { kind, distance: player.x, stamina: player.stamina, shots: sim.state.events.filter(e => e.kind === 'shot').length, damage: sim.state.shells[0]?.damage };
    });
    const [standard, scout, heavy] = results;
    expect(scout.distance).toBeGreaterThan(standard.distance); expect(heavy.distance).toBeLessThan(standard.distance);
    expect(scout.stamina).toBeGreaterThan(standard.stamina); expect(heavy.stamina).toBeLessThan(standard.stamina);
    expect(scout.shots).toBeGreaterThan(heavy.shots);
    expect(results.map(r => r.damage)).toEqual([20, 16, 28, 16]);
  });

  it.each(vehicleKinds)('%s 的蓄满时间、松开发射、装填与三连发道具正确', kind => {
    const { sim, player, tick } = battle(kind);
    player.buffs.burst = 4;
    tick(VEHICLES[kind].chargeSeconds, { chargeMode: true, fire: true });
    expect(sim.state.events.filter(e => e.kind === 'shot')).toHaveLength(0);
    expect(player.charge).toBeCloseTo(VEHICLES[kind].chargeSeconds, 1);
    tick(1 / 30, { chargeMode: true });
    expect(sim.state.shells[0].damage).toBe(VEHICLES[kind].chargeDamage);
    expect(player.cooldown).toBeCloseTo(VEHICLES[kind].chargeReload);
    expect(player.buffs.burst).toBe(4); expect(player.recoil).toBeGreaterThan(0.9);
    sim.state.shells = []; player.cooldown = 0;
    tick(1 / 30, { fire: true }); tick(0.3);
    expect(player.buffs.burst).toBe(3);
    expect(sim.state.shells).toHaveLength(3);
    expect(sim.state.shells.every(s => s.damage === Math.round(VEHICLES[kind].damage * 0.6))).toBe(true);
  });

  it('重装正面按车身朝向减伤，与护盾计算兼容，背面没有正面保护', () => {
    const { sim, player } = battle('heavy'); player.angle = 0; player.turret = Math.PI;
    hit(sim, player, 20); expect(player.hp).toBe(164);
    hit(sim, player, 20, 27); expect(player.hp).toBe(144);
    player.buffs.armor = 10;
    hit(sim, player, 20); expect(player.hp).toBe(138); expect(player.buffs.armor).toBe(0);
  });

  it('重炮与强化伤害不能单发击毁任何满血坦克，后续命中仍能正常击毁', () => {
    for (const hp of [60, 80, 90, 100, 110, 120, 180, 223]) {
      const { sim, player } = battle(); player.hp = player.maxHp = hp;
      hit(sim, player, 10000); expect(player.hp).toBe(1); expect(player.lives).toBe(2);
      hit(sim, player, 20); expect(player.hp).toBe(0); expect(player.lives).toBe(1);
    }
  });

  it('轻型的实体与受击范围更小，重型仍能通过三种地图桥梁', () => {
    for (const size of ['small', 'medium', 'large'] as const) {
      const sim = new Simulation(47, 'classic', 'normal', size), p = sim.addPlayer('p', '重装', undefined, 'heavy')!;
      sim.start(); sim.state.phase = 'battle'; sim.state.remaining = 0; sim.state.obstacles = []; sim.state.sites = [];
      const bridge = mapFor(size).bridges[0]; p.x = bridge.x; p.z = bridge.z;
      for (let i = 0; i < 15; i++) { sim.input('p', { moveX: 0, moveZ: 1, aim: 0, fire: false }); sim.step(1 / 30); }
      expect(p.z).toBeGreaterThan(bridge.z + 1);
    }
  });
});

describe('工程支援与维修贡献', () => {
  it('双方脱战后修自己、队友和友塔，满血、敌方与毁塔不接受维修', () => {
    const { sim, player, tick } = battle('engineer'); player.hp = 80; player.combatUntil = 8;
    const ally = { ...player, id: 'ally', kind: 'standard' as const, x: 3, hp: 100, maxHp: 120, stats: { ...player.stats } };
    sim.state.tanks.push(ally);
    const tower = new Simulation(47).state.sites[0]; Object.assign(tower, { x: -3, z: 24, hp: 200 }); sim.state.sites = [tower];
    tick(7.9); expect(player.hp).toBe(80); expect(ally.hp).toBe(100); expect(tower.hp).toBe(200);
    tick(0.2); expect(player.hp).toBe(88); expect(ally.hp).toBe(112); expect(tower.hp).toBe(212);
    expect(player.stats.repairs).toBe(24); expect(player.score).toBe(12);
    tick(1); expect(ally.hp).toBe(112);
    tower.hp = 0; tick(10); expect(tower.hp).toBe(0); expect(ally.hp).toBe(120);
  });

  it('开火、受击、暂停、遮挡与断线都正确限制维修', () => {
    const { sim, player, tick } = battle('engineer'); player.hp = 80;
    tick(1 / 30, { fire: true }); expect(player.hp).toBe(80); expect(player.combatUntil).toBeGreaterThan(8);
    sim.state.paused = true; tick(12); expect(player.hp).toBe(80); expect(sim.state.time).toBeCloseTo(1 / 30);
    sim.state.paused = false;
    const ally = { ...player, id: 'ally', kind: 'standard' as const, x: 5, hp: 40, combatUntil: 0, stats: { ...player.stats } };
    sim.state.tanks.push(ally);
    sim.state.obstacles = [{ id: 999, kind: 'rock', x: 2.5, z: 24, radius: 1.1, height: 5, hp: 100, maxHp: 100, rotation: 0 }];
    tick(8.1); expect(player.hp).toBe(88); expect(ally.hp).toBe(40);
    sim.state.obstacles = []; ally.connected = false; tick(10.1); expect(ally.hp).toBe(40);
    ally.connected = true; hit(sim, ally, 20); const before = ally.hp; tick(7.8); expect(ally.hp).toBe(before);
  });

  it('多辆工程车不会叠加同一目标的维修，维修积分有本局上限', () => {
    const { sim, player, tick } = battle('engineer');
    const other = { ...player, id: 'other', x: -3, stats: { ...player.stats } };
    const ally = { ...player, id: 'ally', kind: 'standard' as const, x: 3, hp: 30, stats: { ...player.stats } };
    sim.state.tanks.push(other, ally);
    tick(1 / 30); expect(ally.hp).toBe(42);
    tick(9); expect(ally.hp).toBe(42);
    for (let i = 0; i < 60; i++) { ally.hp = 10; tick(10.1); }
    expect(player.score + other.score).toBeLessThanOrEqual(600);
    expect(player.score).toBeLessThanOrEqual(300);
    expect(player.stats.repairs + other.stats.repairs).toBeGreaterThan(600);
  });
});

describe('车型解锁、旧档案与排行榜', () => {
  it('旧存档迁移保留余额、升级、战绩与已结算标记，并归入标准型', () => {
    const p = newProfile(); p.coins = 850; p.earned = 1000; p.upgrades.armor = 1;
    const { sim, player } = battle(); sim.state.phase = 'won'; settle(p, sim.state, player);
    const legacy = { ...p, version: 1, unlockedVehicles: undefined, selectedVehicle: undefined, records: p.records.map(r => ({ ...r, vehicle: undefined, equipment: r.equipment.replaceAll('standard:', '') })) };
    const loaded = parseProfile(JSON.stringify(legacy));
    expect(loaded.version).toBe(2); expect(loaded.coins).toBe(p.coins); expect(loaded.upgrades).toEqual(p.upgrades);
    expect(loaded.records).toEqual(p.records); expect(loaded.settled).toEqual(p.settled);
    expect(loaded.selectedVehicle).toBe('standard'); expect(loaded.unlockedVehicles).toEqual(['standard']);
  });

  it('解锁只扣一次、选车必须拥有，升级退款保留车型，导出能完整恢复', () => {
    const p = newProfile(); p.coins = p.earned = 1500;
    expect(selectVehicle(p, 'heavy')).toBe(false);
    expect(unlockVehicle(p, 'heavy')).toBe(true); expect(unlockVehicle(p, 'heavy')).toBe(false);
    expect(p.coins).toBe(1140); expect(selectVehicle(p, 'heavy')).toBe(true);
    buyUpgrade(p, 'armor'); resetFactory(p);
    expect(p.coins).toBe(1140); expect(p.selectedVehicle).toBe('heavy'); expect(p.unlockedVehicles).toContain('heavy');
    expect(parseProfile(JSON.stringify(p))).toEqual(p);
    expect(unlockVehicle(p, '__proto__')).toBe(false);
    expect(unlockVehicle(newProfile(), 'scout')).toBe(false);
    expect(() => parseProfile(JSON.stringify({ ...p, selectedVehicle: 'engineer' }))).toThrow();
    expect(() => parseProfile(JSON.stringify({ ...p, unlockedVehicles: ['standard', 'heavy', 'heavy'] }))).toThrow();
  });

  it('战绩记录实际出战车型，个人和队伍不同车型分别排名', () => {
    const { sim, player } = battle('scout'), p = newProfile();
    sim.state.phase = 'won'; const scout = settle(p, sim.state, player)!;
    expect(scout.vehicle).toBe('scout');
    sim.state.matchId = 'other'; player.kind = 'heavy';
    const heavy = settle(p, sim.state, player)!;
    expect(boardKey(scout)).not.toBe(boardKey(heavy)); expect(heavy.equipment).toContain('heavy:');
  });
});
