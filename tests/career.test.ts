import { describe, expect, it } from 'vitest';
import { buyUpgrade, loadProfile, newProfile, parseProfile, PROFILE_KEY, resetFactory, saveProfile, settle, standings, boardKey } from '../src/profile';
import { cleanLoadout, emptyLoadout } from '../src/game/factory';
import { Simulation } from '../src/game/simulation';

const storage = () => {
  const values = new Map<string, string>();
  return { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => { values.set(key, value); } };
};

describe('本地生涯与工厂', () => {
  it('胜负均按贡献结算，同一对局重载后也不能重复领取', () => {
    const sim = new Simulation(47), player = sim.addPlayer('p', '玩家')!, profile = newProfile();
    player.score = 1000; sim.state.phase = 'won';
    const first = settle(profile, sim.state, player)!;
    expect(first.honor).toBe(1000); expect(first.coins).toBe(230);
    const disk = storage(); saveProfile(disk, profile);
    const loaded = loadProfile(disk).profile;
    expect(settle(loaded, sim.state, player)).toBeNull();
    expect(loaded.honor).toBe(1000); expect(loaded.wins).toBe(1);
    sim.state.matchId = crypto.randomUUID(); sim.state.phase = 'lost'; player.score = 300;
    expect(settle(loaded, sim.state, player)?.coins).toBe(45);
    expect(loaded.battles).toBe(2); expect(loaded.wins).toBe(1); expect(loaded.honor).toBe(1300);
  });

  it('消费不降低荣誉，价格、等级和重置退款保持一致', () => {
    const p = newProfile(); p.honor = 9000; p.coins = p.earned = 1000;
    expect(buyUpgrade(p, 'armor')).toBe(true); expect(p.coins).toBe(850);
    expect(buyUpgrade(p, 'armor')).toBe(true); expect(p.coins).toBe(550);
    expect(buyUpgrade(p, 'armor')).toBe(true); expect(p.coins).toBe(50);
    expect(buyUpgrade(p, 'armor')).toBe(false); expect(buyUpgrade(p, 'reload')).toBe(false);
    expect(p.honor).toBe(9000); expect(parseProfile(JSON.stringify(p))).toEqual(p);
    resetFactory(p); expect(p.coins).toBe(1000); expect(p.upgrades).toEqual(emptyLoadout());
  });

  it('导入拒绝不兼容版本、损坏数据和无效装备，不改动现有档案', () => {
    const p = newProfile();
    expect(() => parseProfile(JSON.stringify({ ...p, version: 2 }))).toThrow();
    expect(() => parseProfile(JSON.stringify({ ...p, coins: -1 }))).toThrow();
    expect(() => parseProfile(JSON.stringify({ ...p, upgrades: { ...p.upgrades, armor: 99 } }))).toThrow();
    expect(() => parseProfile('{bad')).toThrow();
    const disk = storage(); saveProfile(disk, p); saveProfile(disk, p); disk.setItem(PROFILE_KEY, '{bad');
    expect(loadProfile(disk).profile.id).toBe(p.id); expect(loadProfile(disk).warning).toContain('备份');
  });

  it('同分并列，装备不同的成绩分榜；战绩轮换后累计荣誉仍保留', () => {
    const sim = new Simulation(47), p = sim.addPlayer('p', '玩家')!, q = sim.addPlayer('q', '队友')!, profile = newProfile();
    sim.state.phase = 'won'; p.score = q.score = 800;
    const first = settle(profile, sim.state, p)!; expect(first.rank).toBe(1); expect(standings(sim.state)).toHaveLength(2);
    q.upgrades.armor = 1; sim.state.matchId = crypto.randomUUID();
    expect(boardKey(settle(profile, sim.state, p)!)).not.toBe(boardKey(first));
    for (let i = 0; i < 201; i++) { sim.state.matchId = crypto.randomUUID(); settle(profile, sim.state, p); }
    expect(profile.records).toHaveLength(200); expect(profile.honor).toBe(203 * 800);
    sim.state.matchId = first.id; expect(settle(profile, sim.state, p)).toBeNull();
  });

  it('联机装备有界，营地逐项取最高值且离开大厅后重新计算', () => {
    expect(cleanLoadout({ armor: 999, reload: -1, mobility: NaN, repair: 1.5 })).toEqual({ ...emptyLoadout(), armor: 3 });
    const sim = new Simulation(47);
    const p = sim.addPlayer('p', '房主', { ...emptyLoadout(), armor: 2, baseArmor: 1 })!;
    expect(p.maxHp).toBe(139);
    sim.addPlayer('q', '队友', { ...emptyLoadout(), baseArmor: 3, repair: 2 });
    expect(sim.state.baseMaxHp).toBe(744); expect(sim.state.campUpgrades.repair).toBe(2);
    sim.addPlayer('r', '队友', { ...emptyLoadout(), baseArmor: 3, repair: 2 });
    expect(sim.state.baseMaxHp).toBe(744);
    sim.disconnect('q'); sim.disconnect('r'); expect(sim.state.baseMaxHp).toBe(648);
    sim.start(); sim.disconnect('p'); expect(sim.state.baseMaxHp).toBe(648);
  });

  it('存储空间不足时不会声称保存成功，原档案仍可读取', () => {
    const disk = storage(), p = newProfile(); saveProfile(disk, p);
    expect(() => saveProfile({ ...disk, setItem: () => { throw new Error('quota'); } }, { ...p, honor: 100 })).toThrow('quota');
    expect(loadProfile(disk).profile.honor).toBe(0);
  });
});
