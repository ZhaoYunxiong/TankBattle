import { test, expect } from '@playwright/test';

test('手机浅水掩护提示随进入和离开水域切换', async ({ browser }) => {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 1 });
  const page = await context.newPage(), errors: string[] = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.addInitScript(() => { Math.random = () => 47 / 0x7fffffff; localStorage.setItem('tb-quality', 'low'); });
  await page.goto('./'); await page.locator('#mapSize').selectOption('medium'); await page.locator('#difficulty').selectOption('casual'); await page.locator('#soloButton').click();
  await expect.poll(() => page.evaluate(() => (window as any).__tankBattle.state.phase)).toBe('battle');
  await expect(page.locator('#coverStatus')).toBeHidden();
  // 经正常输入入口开到河里；同帧松键，避免云端驱动延迟把坦克开过窄河。
  const drive = async (code: string, axis: 'x' | 'z', target: number) => {
    await page.keyboard.down(code);
    try {
      await page.waitForFunction(({ code, axis, target }) => {
        const p = (window as any).__tankBattle.state.tanks[0];
        if (axis === 'x' ? p.x < target : p.z > target) return false;
        window.dispatchEvent(new KeyboardEvent('keyup', { code, bubbles: true })); return true;
      }, { code, axis, target }, { timeout: process.env.CI ? 90000 : 30000 });
    } finally { await page.keyboard.up(code); }
  };
  await drive('KeyA', 'x', -20); await drive('KeyW', 'z', 43);
  await expect(page.locator('#coverStatus')).toHaveText('浅水掩护 · 减伤 20%'); await expect(page.locator('#coverStatus')).toBeVisible();
  expect(await page.locator('#localTankStatus').evaluate(e => e.getBoundingClientRect().width)).toBeLessThan(80);
  await page.screenshot({ path: 'artifacts/water-cover-mobile.png' });
  await drive('KeyW', 'z', 37); await expect(page.locator('#coverStatus')).toBeHidden();
  expect(errors).toEqual([]); await context.close();
});

test('倒木掩护保留四种立体树型、坡面接触与阴影', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 }); await page.goto('./');
  await page.waitForFunction(() => (window as any).__tankBattle?.fps > 0);
  const result = await page.evaluate(async () => {
    const { Simulation } = await import('/TankBattle/src/game/simulation.ts');
    const { BattleRenderer } = await import('/TankBattle/src/game/renderer.ts');
    const { groundHeight } = await import('/TankBattle/src/game/terrain.ts');
    const { Vector3 } = await import('/TankBattle/node_modules/@babylonjs/core/Maths/math.vector.js');
    const canvas = document.createElement('canvas'); canvas.width = 1280; canvas.height = 800;
    canvas.style.cssText = 'position:fixed;inset:0;width:100vw;height:100vh;z-index:50;pointer-events:none'; document.body.append(canvas);
    const renderer = new BattleRenderer(canvas); renderer.setQuality('low'); renderer.audio.enabled = false; renderer.zoom = 23; renderer.pitch = 0.85;
    const sim = new Simulation(47), p = sim.addPlayer('p', '玩家')!; sim.start(); sim.state.phase = 'battle'; sim.state.remaining = 0; sim.state.enemyBaseDiscovered = true;
    p.x = 0; p.z = 30;
    sim.state.obstacles = (['pine', 'round', 'birch', 'dead', 'pine', 'round'] as const).map((variant, i) => ({ id: 8000 + i, kind: 'tree' as const, variant,
      x: i < 4 ? -9 + i * 6 : -25, z: i < 4 ? 17 : -18 - (i - 4) * 8, radius: 0.8, height: [6, 5, 6.5, 5, 6, 5][i],
      hp: 35, maxHp: 35, rotation: [-0.8, -0.35, 0.7, 1.3, 0.8, -2.4][i], crown: 1.1, tone: i }));
    renderer.render(sim.state, 'p', 1 / 60, false); await renderer.scene.whenReadyAsync();
    const before = sim.state.obstacles.map(o => renderer.scene.getTransformNodeByName('obstacle-' + o.id)!.getChildMeshes().filter(m => m.name.includes('crown') || m.name === 'pine-top').map(m => ({ name: m.name, vertices: m.getTotalVertices() })));
    for (const mesh of renderer.scene.getTransformNodeByName('obstacle-8000')!.getChildMeshes()) mesh.visibility = 0.25;
    for (const o of sim.state.obstacles) sim.state.shells.push({ id: o.id + 100, owner: 'p', team: 'player', x: o.x, z: o.z, y: groundHeight(o.x, o.z) + 1, vx: 0, vy: 0, vz: 0, damage: 40, life: 1 });
    sim.step(1 / 30);
    for (let i = 0; i < 100; i++) { sim.step(1 / 60); renderer.render(sim.state, 'p', 1 / 60, false); }
    await renderer.scene.whenReadyAsync();
    const shapes = sim.state.obstacles.map((o, i) => {
      if (i >= 4) {
        p.x = o.x; p.z = o.z + 8;
        for (let frame = 0; frame < 40; frame++) renderer.render(sim.state, 'p', 1 / 60, false);
      }
      const root = renderer.scene.getTransformNodeByName('obstacle-' + o.id)!, parts = root.getChildMeshes();
      const crowns = parts.filter(m => m.name.includes('crown') || m.name === 'pine-top');
      let clearance = Infinity, thickness = 0;
      for (const mesh of parts) {
        const positions = mesh.getVerticesData('position') ?? [], matrix = mesh.computeWorldMatrix(true);
        let minY = Infinity, maxY = -Infinity;
        for (let j = 0; j < positions.length; j += 3) {
          const v = Vector3.TransformCoordinates(new Vector3(positions[j], positions[j + 1], positions[j + 2]), matrix);
          if (!mesh.name.includes('stump')) clearance = Math.min(clearance, v.y - groundHeight(v.x, v.z));
          minY = Math.min(minY, v.y); maxY = Math.max(maxY, v.y);
        }
        if (crowns.includes(mesh)) thickness = Math.max(thickness, maxY - minY);
      }
      const shadows = (renderer as any).shadows.getShadowMap().renderList;
      return { variant: o.variant, before: before[i], after: crowns.map(m => ({ name: m.name, vertices: m.getTotalVertices() })), thickness, clearance, castsShadow: crowns.every(m => shadows.includes(m)), opaque: parts.every(m => m.visibility === 1), stump: parts.some(m => m.name === 'persistent-stump') };
    });
    p.x = 0; p.z = 30; for (let i = 0; i < 80; i++) renderer.render(sim.state, 'p', 1 / 60, false);
    renderer.engine.runRenderLoop(() => renderer.render(sim.state, 'p', 1 / 60, false));
    return shapes;
  });
  for (const shape of result) {
    expect(shape.after).toEqual(shape.before); expect(shape.clearance).toBeGreaterThanOrEqual(-0.01); expect(shape.stump).toBe(true); expect(shape.castsShadow).toBe(true); expect(shape.opaque).toBe(true);
    if (shape.variant !== 'dead') expect(shape.thickness).toBeGreaterThan(0.9);
  }
  await page.screenshot({ path: 'artifacts/volumetric-fallen-trees.png' });
});
