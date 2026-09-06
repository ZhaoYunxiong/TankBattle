import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';

test('手机工厂、存档导入导出、跨局装备与战术地图标记', async ({ browser }) => {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 1 });
  const page = await context.newPage(), errors: string[] = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.goto('./'); await page.locator('#careerButton').click();
  await expect(page.locator('#careerDialog')).toBeVisible();
  await expect(page.locator('#careerSummary')).toContainText('新晋守卫');
  const backup = { version: 1, id: 'browser-factory-fixture', honor: 3000, coins: 1000, earned: 1000, battles: 0, wins: 0, upgrades: { armor: 0, mobility: 0, reload: 0, baseArmor: 0, repair: 0 }, records: [], settled: [] };
  await page.locator('#profileFile').setInputFiles({ name: '档案备份.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(backup)) });
  await expect(page.locator('#importDescription')).toContainText('金币 1000');
  await page.locator('#confirmImport').click();
  await page.getByRole('button', { name: '坦克工厂', exact: true }).click();
  for (const key of ['armor', 'reload', 'baseArmor']) {
    await page.locator(`[data-upgrade="${key}"]`).click();
    await expect(page.locator(`[data-upgrade="${key}"]`)).toContainText('300');
  }
  await expect(page.locator('#careerSummary')).toContainText('550');
  await page.screenshot({ path: 'artifacts/factory-mobile.png' });
  expect(await page.locator('#careerDialog').evaluate(e => e.scrollWidth <= e.clientWidth)).toBe(true);
  await page.getByRole('button', { name: '战绩与荣誉', exact: true }).click();
  const downloadEvent = page.waitForEvent('download'); await page.locator('#exportProfile').click();
  const download = await downloadEvent; const saved = JSON.parse(await readFile((await download.path())!, 'utf8'));
  expect(saved.honor).toBe(3000); expect(saved.coins).toBe(550); expect(saved.upgrades.armor).toBe(1);
  await page.reload(); await page.locator('#mapSize').selectOption('large'); await page.locator('#soloButton').click();
  await expect.poll(() => page.evaluate(() => (window as any).__tankBattle.state.tanks[0].maxHp)).toBe(130);
  await expect(page.locator('#baseHp')).toHaveText('648 / 648');
  await page.waitForFunction(() => { const s = (window as any).__tankBattle.state; return s.tanks.some((t: any) => t.team === 'enemy' && s.visibleEnemies.includes(t.id)); });
  await page.locator('#mapToggle').click(); await expect(page.locator('#mapToggle')).toHaveAttribute('aria-expanded', 'true');
  const radar = await page.locator('#radar').boundingBox();
  await page.touchscreen.tap(radar!.x + radar!.width / 2, radar!.y + radar!.height / 2);
  await expect.poll(() => page.evaluate(() => (window as any).__tankBattle.state.pings.length)).toBe(1);
  await page.screenshot({ path: 'artifacts/tactical-map-mobile.png' });
  await page.locator('#mapToggle').click();
  await expect(page.locator('#mapToggle')).toHaveAttribute('aria-expanded', 'false');
  expect(errors).toEqual([]); await context.close();
});

test('流动河水、坦克大爆炸与弹坑在重建场景后持续存在', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 }); await page.goto('./');
  await page.waitForFunction(() => (window as any).__tankBattle?.fps > 0);
  const result = await page.evaluate(async () => {
    const { Simulation } = await import('/TankBattle/src/game/simulation.ts');
    const { BattleRenderer } = await import('/TankBattle/src/game/renderer.ts');
    const { groundHeight } = await import('/TankBattle/src/game/terrain.ts');
    const create = () => {
      const canvas = document.createElement('canvas'); canvas.width = 1280; canvas.height = 800;
      canvas.style.cssText = 'position:fixed;inset:0;width:100vw;height:100vh;z-index:50;pointer-events:none'; document.body.append(canvas);
      const renderer = new BattleRenderer(canvas); renderer.setQuality('low'); renderer.audio.enabled = false; renderer.zoom = 22; renderer.pitch = 0.8;
      return { renderer, canvas };
    };
    const first = create(), sim = new Simulation(47), p = sim.addPlayer('test', '试验坦克')!;
    sim.start(); sim.state.phase = 'battle'; sim.state.remaining = 0; sim.state.enemyBaseDiscovered = true; p.x = 0; p.z = 14;
    sim.state.obstacles.push({ id: 99990, kind: 'tree', variant: 'birch', x: -5, z: 8, radius: 0.6, height: 6, hp: 35, maxHp: 35, rotation: 0.4 });
    const enemy = { ...p, id: 'victim', team: 'enemy' as const, x: 0, z: 6, hp: 20, shield: 0, stats: { ...p.stats } };
    sim.state.tanks.push(enemy);
    first.renderer.render(sim.state, 'test', 1 / 60, false);
    await first.renderer.scene.whenReadyAsync();
    const water = first.renderer.scene.getMeshByName('deep-river')!;
    const normals = water.getVerticesData('normal')!;
    const waterNormal = normals.filter((_, i) => i % 3 === 1).reduce((a, b) => a + b, 0) / (normals.length / 3);
    const ripple = first.renderer.scene.getMeshByName('water-current')!, x = ripple.position.x;
    for (const target of [{ x: 0, z: 6 }, { x: -5, z: 8 }]) sim.state.shells.push({ id: 90000 + target.x, owner: 'test', team: 'player', x: target.x, z: target.z, y: groundHeight(target.x, target.z) + 1, vx: 0, vy: 0, vz: 0, damage: 100, life: 1 });
    sim.step(1 / 30); first.renderer.render(sim.state, 'test', 1 / 60, false);
    const peakShake = (first.renderer as any).shake;
    for (let i = 0; i < 90; i++) first.renderer.render(sim.state, 'test', 1 / 60, false);
    const flow = Math.abs(ripple.position.x - x), settledShake = (first.renderer as any).shake;
    sim.state.events = [];
    const snapshot = JSON.parse(JSON.stringify(sim.state));
    first.renderer.scene.dispose(); first.renderer.engine.dispose(); first.canvas.remove();
    const second = create();
    for (let i = 0; i < 80; i++) second.renderer.render(snapshot, 'test', 1 / 60, false);
    await second.renderer.scene.whenReadyAsync();
    second.renderer.engine.runRenderLoop(() => second.renderer.render(snapshot, 'test', 1 / 60, false));
    const crater = second.renderer.scene.getMeshByName('persistent-crater')!, craterNormals = crater.getVerticesData('normal')!;
    return { waterNormal, flow, peakShake, settledShake, craterVisible: crater.isEnabled(), craterUp: Math.max(...craterNormals.filter((_, i) => i % 3 === 1)), stump: !!second.renderer.scene.getMeshByName('persistent-stump'), particles: second.renderer.scene.meshes.filter(m => ['smoke', 'debris', 'blast-wave'].includes(m.name)).length };
  });
  expect(result.waterNormal).toBeGreaterThan(0.9); expect(result.flow).toBeGreaterThan(1);
  expect(result.peakShake).toBeGreaterThan(0.7); expect(result.settledShake).toBeLessThan(0.01);
  expect(result.craterVisible).toBe(true); expect(result.craterUp).toBeGreaterThan(0.8); expect(result.stump).toBe(true); expect(result.particles).toBe(0);
  await page.screenshot({ path: 'artifacts/persistent-crater-and-river.png' });
});
