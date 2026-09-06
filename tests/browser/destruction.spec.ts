import { test, expect } from '@playwright/test';

test('树木残骸持续保留，石块和墙块的临时碎片回收', async ({ page }) => {
  await page.goto('./');
  await page.waitForFunction(() => (window as any).__tankBattle?.fps > 0);
  // 独立组件场景走真实命中和渲染流程，不向游戏页面暴露可写诊断入口。
  const result = await page.evaluate(async () => {
    const { Simulation } = await import('/TankBattle/src/game/simulation.ts');
    const { BattleRenderer } = await import('/TankBattle/src/game/renderer.ts');
    const { groundHeight } = await import('/TankBattle/src/game/terrain.ts');
    const canvas = document.createElement('canvas'); canvas.width = 640; canvas.height = 480; document.body.append(canvas);
    const renderer = new BattleRenderer(canvas); renderer.setQuality('low'); renderer.audio.enabled = false;
    try {
      const sim = new Simulation(47); sim.addPlayer('test-tank', '坦克'); sim.start();
      sim.state.phase = 'battle'; sim.state.remaining = 0; sim.state.enemyBaseDiscovered = true;
      sim.state.obstacles = [
        { id: 1, kind: 'tree', variant: 'pine', x: 0, z: 18, radius: 0.75, height: 4, hp: 35, maxHp: 35, rotation: 0 },
        { id: 2, kind: 'rock', variant: 'layered', x: 4, z: 18, radius: 1.8, height: 4, hp: 100, maxHp: 100, rotation: 0 },
        { id: 3, kind: 'wall', team: 'enemy', x: -4, z: 18, radius: 1, height: 1.95, hp: 100, maxHp: 100, rotation: 0 },
      ];
      renderer.render(sim.state, 'test-tank', 1 / 60, false);
      for (const o of sim.state.obstacles) sim.state.shells.push({ id: o.id + 50, owner: 'test-tank', team: 'player', x: o.x, z: o.z, y: groundHeight(o.x, o.z) + 1, vx: 0, vy: 0, vz: 0, damage: 100, life: 1 });
      sim.step(1 / 30);
      for (let frame = 0; frame < 20; frame++) renderer.render(sim.state, 'test-tank', 1 / 60, false);
      const tree = renderer.scene.getTransformNodeByName('obstacle-1')!;
      const during = { treeVisible: tree.isEnabled(), treeTilt: tree.rotation.z, stone: renderer.scene.meshes.filter(m => m.name === 'stone-fragment').length, wall: renderer.scene.meshes.filter(m => m.name === 'wall-block').length };
      for (let frame = 0; frame < 180; frame++) renderer.render(sim.state, 'test-tank', 1 / 60, false);
      return { during, treeAfter: tree.isEnabled(), debrisAfter: renderer.scene.meshes.filter(m => ['stone-fragment', 'wall-block', 'debris', 'smoke'].includes(m.name)).length, materials: sim.state.events.filter(e => e.kind === 'destroy').map(e => e.material) };
    } finally { renderer.scene.dispose(); renderer.engine.dispose(); canvas.remove(); }
  });
  expect(result.materials).toEqual(['tree', 'rock', 'wall']);
  expect(result.during.treeVisible).toBe(true);
  expect(result.during.treeTilt).toBeGreaterThan(0.1);
  expect(result.during.stone).toBeGreaterThan(0);
  expect(result.during.wall).toBeGreaterThan(0);
  expect(result.treeAfter).toBe(true);
  expect(result.debrisAfter).toBe(0);
});
