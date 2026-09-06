import { describe, expect, it } from 'vitest';
import { Simulation } from '../src/game/simulation';
import { EMPTY_INPUT, type Input } from '../src/game/types';

function battle() {
  const sim = new Simulation(47, 'classic', 'casual'), player = sim.addPlayer('p', '测试')!;
  sim.start(); sim.state.phase = 'battle'; sim.state.remaining = 0; sim.state.obstacles = []; sim.state.sites = [];
  const input = (value: Partial<Input> = {}) => sim.input(player.id, { ...EMPTY_INPUT, ...value });
  const shots = () => sim.state.events.filter(e => e.kind === 'shot' && e.owner === player.id);
  return { sim, player, input, shots };
}

describe('普通射击短按', () => {
  it('同一模拟帧内按下和松开仍发射一次，重复采样不会丢失或多发', () => {
    const { sim, input, shots } = battle();
    input({ fire: true }); input(); input(); sim.step(1 / 30);
    expect(shots()).toHaveLength(1);
    for (let i = 0; i < 60; i++) { input(); sim.step(1 / 30); }
    expect(shots()).toHaveLength(1);
  });

  it('冷却期间点按不会越过冷却或在松开很久后自动补发', () => {
    const { sim, player, input, shots } = battle();
    player.cooldown = 0.3;
    input({ fire: true }); input(); sim.step(1 / 30);
    for (let i = 0; i < 30; i++) { input(); sim.step(1 / 30); }
    expect(shots()).toHaveLength(0);
    input({ fire: true }); input(); sim.step(1 / 30);
    expect(shots()).toHaveLength(1);
  });

  it.each(['cancel', 'pause', 'disconnect', 'death', 'charge-mode'] as const)('%s 清除尚未消费的点按，恢复后不误发', reason => {
    const { sim, player, input, shots } = battle();
    input({ fire: true });
    if (reason === 'cancel') input({ cancelCharge: 1 });
    if (reason === 'pause') sim.state.paused = true;
    if (reason === 'disconnect') sim.disconnect(player.id);
    if (reason === 'death') player.hp = 0;
    if (reason === 'charge-mode') input({ chargeMode: true });
    sim.step(1 / 30);
    expect(shots()).toHaveLength(0);
    sim.state.paused = false; player.connected = true; player.hp = player.maxHp;
    input(reason === 'cancel' ? { cancelCharge: 1 } : {}); sim.step(1 / 30);
    expect(shots()).toHaveLength(0);
  });
});
