import { describe, expect, it } from 'vitest';
import { COVER_REDUCTION, fallenTreeShape, terrainCover, TREE_FALL_TIME } from '../src/game/cover';
import { Simulation } from '../src/game/simulation';
import { MAPS, mapFor, riverSection, waterAt, type MapSize } from '../src/game/maps';
import { groundHeight } from '../src/game/terrain';
import { blocked } from '../src/game/world';
import { concealed, updateVisibility } from '../src/game/visibility';
import type { Obstacle, Tank } from '../src/game/types';

function setup(size: MapSize = 'small') {
  const sim = new Simulation(47, 'classic', 'normal', size), player = sim.addPlayer('p', '玩家')!;
  sim.start(); sim.state.phase = 'battle'; sim.state.remaining = 0; sim.state.obstacles = []; sim.state.drops = [];
  return { sim, player };
}

function hit(sim: Simulation, target: Tank, damage = 20) {
  sim.state.shells.push({ id: 900000, owner: 'incoming', team: target.team === 'player' ? 'enemy' : 'player', x: target.x, z: target.z,
    y: groundHeight(target.x, target.z, mapFor(sim.state.mapSize)) + 1, vx: 0, vy: 0, vz: 0, damage, life: 1 });
  sim.step(1 / 30);
}

const tree = (rotation = 0): Obstacle => ({ id: 901, kind: 'tree', variant: 'pine', x: 0, z: 20, radius: 0.8, height: 6, hp: 0, maxHp: 35, rotation, crown: 1.1 });

describe('水域与倒木掩护', () => {
  it.each(Object.keys(MAPS) as MapSize[])('%s 浅水减伤 20%，岸边与桥面不提供保护', size => {
    const { sim, player } = setup(size), map = MAPS[size], river = map.rivers.find(r => r.kind === 'shallow')!;
    player.x = river.x; player.z = river.z;
    expect(terrainCover(player, sim.state)).toBe('water');
    hit(sim, player); expect(player.hp).toBe(104);
    const edge = riverSection(river, 0);
    player.z = river.z + edge.offset + edge.half - 0.2;
    expect(waterAt(player, map)).toBe('shallow'); expect(terrainCover(player, sim.state)).toBeNull();
    player.x = map.bridges[0].x; player.z = map.bridges[0].z;
    hit(sim, player); expect(player.hp).toBe(84); expect(terrainCover(player, sim.state)).toBeNull();
  });

  it.each([0, Math.PI / 2, Math.PI, -1.1])('倒木方向 %s 的保护范围跟随实际树干，离开即解除', rotation => {
    const { sim, player } = setup(), timber = tree(rotation), shape = fallenTreeShape(timber, mapFor());
    sim.state.obstacles = [timber]; player.x = shape.x + shape.dx * shape.length / 2; player.z = shape.z + shape.dz * shape.length / 2;
    expect(terrainCover(player, sim.state)).toBe('timber'); expect(blocked(player.x, player.z, sim.state.obstacles)).toBe(false);
    hit(sim, player); expect(player.hp).toBe(105);
    player.x += shape.dz * (shape.radius + 0.1); player.z -= shape.dx * (shape.radius + 0.1);
    expect(terrainCover(player, sim.state)).toBeNull(); hit(sim, player); expect(player.hp).toBe(85);
  });

  it('树木被炮弹击倒后才产生掩护，动画期间、活树和树桩附近都不产生光环', () => {
    const { sim, player } = setup(), timber = tree(); timber.hp = 35; sim.state.obstacles = [timber];
    player.x = 0; player.z = 23;
    expect(terrainCover(player, sim.state)).toBeNull();
    sim.state.shells.push({ id: 902, owner: 'p', team: 'player', x: timber.x, z: timber.z, y: groundHeight(timber.x, timber.z) + 1, vx: 0, vy: 0, vz: 0, damage: 40, life: 1 });
    sim.step(1 / 30); expect(timber.hp).toBe(0); expect(timber.fallenAt).toBe(sim.state.time);
    expect(terrainCover(player, sim.state)).toBeNull();
    sim.state.time = timber.fallenAt! + TREE_FALL_TIME; expect(terrainCover(player, sim.state)).toBe('timber');
    player.z = 18.5; expect(terrainCover(player, sim.state)).toBeNull();
  });

  it('多棵倒木与水域重叠只减伤 25%，护盾吸收减伤后的伤害', () => {
    const { sim, player } = setup(); player.x = 24; player.z = -28;
    sim.state.obstacles = [0, 1].map(i => ({ ...tree(), id: 910 + i, x: 24, z: -31 }));
    expect(terrainCover(player, sim.state)).toBe('timber');
    player.buffs.armor = 10; hit(sim, player);
    expect(player.buffs.armor).toBe(0); expect(player.hp).toBe(115);
    player.shield = 1; hit(sim, player); expect(player.hp).toBe(115);
    expect(COVER_REDUCTION.timber).toBeGreaterThan(COVER_REDUCTION.water);
  });

  it('敌我使用相同减伤规则；倒木不隐蔽敌军，开火也不失去掩护', () => {
    const { sim, player } = setup(); sim.state.obstacles = [tree()]; player.x = 0; player.z = 23;
    const enemy: Tank = { ...player, id: 'e', team: 'enemy', buffs: { ...player.buffs }, stats: { ...player.stats }, cooldown: 10 };
    player.x = 15; player.z = 35; sim.state.tanks.push(enemy);
    enemy.exposedUntil = 10; expect(concealed(enemy, sim.state)).toBe(false);
    updateVisibility(sim.state); expect(sim.state.visibleEnemies).toContain('e');
    hit(sim, enemy); expect(enemy.hp).toBe(105); expect(terrainCover(enemy, sim.state)).toBe('timber');
  });

  it('无事件的联机快照仍恢复倒木掩护，新对局不继承倒木', () => {
    const { sim, player } = setup(); sim.state.obstacles = [tree()]; player.x = 0; player.z = 23;
    sim.state.events = []; const snapshot = JSON.parse(JSON.stringify(sim.state));
    expect(terrainCover(snapshot.tanks[0], snapshot)).toBe('timber');
    expect(terrainCover(player, setup().sim.state)).toBeNull();
  });
});
