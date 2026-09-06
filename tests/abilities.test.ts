import { describe, expect, it } from 'vitest';
import { BOOST, CHARGE } from '../src/game/abilities';
import { Simulation } from '../src/game/simulation';
import { mapFor, waterAt } from '../src/game/maps';
import { cleanInput, type Input } from '../src/game/types';

function battle() {
  const sim = new Simulation(47, 'classic', 'casual');
  const player = sim.addPlayer('player', '测试坦克')!;
  sim.start(); sim.state.phase = 'battle'; sim.state.remaining = 0; sim.state.obstacles = []; sim.state.drops = [];
  player.x = 0; player.z = 0;
  const input = (value: Partial<Input> = {}) => sim.input(player.id, { moveX: 0, moveZ: 0, aim: Math.PI, fire: false, ...value });
  const tick = (frames: number, value: Partial<Input> = {}) => {
    for (let i = 0; i < frames; i++) { input(value); sim.step(1 / 30); }
  };
  const shots = () => sim.state.events.filter(e => e.kind === 'shot' && e.owner === player.id);
  return { sim, player, input, tick, shots };
}

describe('加速耐力与移动', () => {
  it('提高 60% 移速，斜向不额外加速，只有实际行驶消耗耐力', () => {
    const { sim, player, tick } = battle();
    tick(1, { moveX: 1, moveZ: 1, boost: true });
    expect(Math.hypot(player.x, player.z)).toBeCloseTo(6 / 30 * BOOST.speed);
    const used = player.stamina;
    expect(used).toBeCloseTo(100 - 12.5 / 30);
    tick(10, { boost: true }); expect(player.stamina).toBe(used); expect(player.boosting).toBe(false);
    player.x = 0; player.z = 0;
    sim.state.obstacles = [{ id: 1, kind: 'rock', x: 2, z: 0, radius: 1, height: 3, hp: 80, maxHp: 80, rotation: 0 }];
    tick(1, { moveX: 1, boost: true }); expect(player.x).toBe(0); expect(player.stamina).toBe(used);
  });

  it('停止一秒后恢复耐力且不超过上限', () => {
    const { player, tick } = battle();
    player.z = 15; tick(30, { moveX: 1, boost: true }); const used = player.stamina;
    tick(29); expect(player.stamina).toBe(used);
    tick(16); expect(player.stamina).toBeGreaterThan(used + 7);
    tick(100); expect(player.stamina).toBe(100);
  });

  it('加速仍受浅水减速，无法横穿深水，桥梁可以正常加速通行', () => {
    const normal = battle(), boost = battle();
    for (const b of [normal, boost]) { b.player.x = 24; b.player.z = -28; expect(waterAt(b.player, mapFor())).toBe('shallow'); }
    normal.tick(1, { moveX: 1 }); boost.tick(1, { moveX: 1, boost: true });
    expect(boost.player.x - 24).toBeCloseTo((normal.player.x - 24) * 1.6);
    expect(boost.player.x - 24).toBeCloseTo(6 / 30 * 0.6 * 1.6);
    boost.player.x = 10; boost.player.z = 4; boost.tick(40, { moveZ: -1, boost: true });
    expect(boost.player.z).toBeGreaterThan(0); expect(boost.player.boosting).toBe(false);
    boost.player.x = 0; boost.player.z = 4; boost.tick(40, { moveZ: -1, boost: true });
    expect(boost.player.z).toBeLessThan(-7); expect(boost.player.boosting).toBe(true);
  });

  it('连续使用约八秒耗尽并锁定，恢复后需要重新开启', () => {
    const { sim, player, input, tick } = battle();
    for (let i = 0; i < 241; i++) {
      // 固定在空旷平地测完整耐力周期，避免地图边界先于耐力耗尽。
      player.x = 0; player.z = 0; input({ moveX: 1, boost: true }); sim.step(1 / 30);
    }
    expect(player.stamina).toBe(0); expect(player.boostLocked).toBe(true); expect(player.boosting).toBe(false);
    tick(100, { boost: true }); expect(player.stamina).toBeGreaterThan(20); expect(player.boostLocked).toBe(true);
    tick(1); tick(1, { moveX: 1, boost: true }); expect(player.boosting).toBe(true);
  });
});

describe('蓄力、松开发射与后座力', () => {
  it('持续按住不会自动开炮，松开只发一炮且满蓄力仍低于最低满血', () => {
    const { sim, player, input, tick, shots } = battle();
    player.buffs.burst = 24; tick(75, { chargeMode: true, fire: true });
    expect(shots()).toHaveLength(0); expect(player.charge).toBe(CHARGE.seconds); expect(player.charging).toBe(true);
    input({ chargeMode: true }); sim.step(1 / 30);
    expect(shots()).toHaveLength(1); expect(shots()[0].charge).toBe(1);
    expect(sim.state.shells[0].damage).toBe(56); expect(sim.state.shells[0].damage).toBeLessThan(60);
    expect(player.cooldown).toBe(CHARGE.cooldown); expect(player.buffs.burst).toBe(24);
    tick(60, { chargeMode: true }); expect(shots()).toHaveLength(1);
  });

  it('同帧快速点按也能发射，重复松开包不会重复开炮，仍受冷却限制', () => {
    const { sim, input, tick, shots } = battle();
    input({ chargeMode: true, fire: true }); input({ chargeMode: true }); input({ chargeMode: true }); sim.step(1 / 30);
    expect(shots()).toHaveLength(1); expect(sim.state.shells[0].damage).toBe(20);
    tick(5, { chargeMode: true, fire: true }); tick(1, { chargeMode: true }); expect(shots()).toHaveLength(1);
  });

  it('未蓄满伤害逐步增加，快速装填与工厂升级继续生效', () => {
    const { sim, player, tick } = battle();
    player.buffs.rapid = 90; player.upgrades.reload = 2;
    tick(24, { chargeMode: true, fire: true }); tick(1, { chargeMode: true });
    expect(sim.state.shells[0].damage).toBe(38); expect(player.cooldown).toBeCloseTo(1.35 * 0.7 * 0.92);
  });

  it.each(['pause', 'mode', 'cancel', 'stale', 'disconnect', 'death'] as const)('%s 取消蓄力，恢复后松开不会补发', reason => {
    const { sim, player, input, tick, shots } = battle();
    tick(30, { chargeMode: true, fire: true });
    if (reason === 'pause') { sim.state.paused = true; sim.step(1 / 30); sim.state.paused = false; }
    if (reason === 'mode') input({ chargeMode: false });
    if (reason === 'cancel') input({ chargeMode: true, cancelCharge: 1 });
    if (reason === 'stale') for (let i = 0; i < 20; i++) sim.step(1 / 30);
    if (reason === 'disconnect') { sim.disconnect(player.id); player.connected = true; }
    if (reason === 'death') { player.hp = 0; player.respawn = 5; sim.step(1 / 30); player.hp = 120; player.respawn = 0; }
    input({ chargeMode: true, ...(reason === 'cancel' ? { cancelCharge: 1 } : {}) }); sim.step(1 / 30);
    expect(player.charging).toBe(false); expect(player.charge).toBe(0); expect(shots()).toHaveLength(0);
    tick(2, { chargeMode: true, fire: true }); tick(1, { chargeMode: true }); expect(shots()).toHaveLength(1);
  });

  it('满蓄力沿实际炮塔反方向后退，移动加速无法抵消后座力', () => {
    const { player, tick } = battle();
    player.angle = Math.PI / 2;
    tick(48, { chargeMode: true, fire: true }); tick(1, { chargeMode: true });
    expect(player.recoil).toBe(1);
    tick(6, { chargeMode: true, moveZ: -1, boost: true });
    expect(player.z).toBeCloseTo(1.2, 2); expect(Math.abs(player.x)).toBeLessThan(0.02); expect(player.boosting).toBe(false);
  });

  it('后退遵守碰撞，不穿过身后的岩壁', () => {
    const { sim, player, tick } = battle();
    sim.state.obstacles = [{ id: 1, kind: 'rock', x: 0, z: 2.5, radius: 0.8, height: 3, hp: 80, maxHp: 80, rotation: 0 }];
    tick(48, { chargeMode: true, fire: true }); tick(1, { chargeMode: true }); tick(6, { chargeMode: true });
    expect(player.z).toBeGreaterThan(0.3); expect(player.z).toBeLessThan(0.86);
  });

  it('不信任网络传来的速度、伤害、耐力与无效模式字段', () => {
    const input = { moveX: 50, moveZ: 50, aim: 0, fire: true, boost: 'true', chargeMode: 1, cancelCharge: NaN, stamina: 999, damage: 999 };
    const clean = cleanInput(input)!;
    expect(Math.hypot(clean.moveX, clean.moveZ)).toBeCloseTo(1);
    expect(clean.boost).toBeUndefined(); expect(clean.chargeMode).toBeUndefined(); expect(clean.cancelCharge).toBeUndefined();
    expect(clean).not.toHaveProperty('damage'); expect(clean).not.toHaveProperty('stamina');
  });
});
