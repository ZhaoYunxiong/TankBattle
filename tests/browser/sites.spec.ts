import { test, expect } from '@playwright/test';

const simulationWait = { timeout: process.env.CI ? 45000 : 15000 };
test.describe.configure({ timeout: process.env.CI ? 240000 : 60000 });

test('桌面实际驶入补给点和中立防御塔，占领后界面与模型更新', async ({ page }) => {
  await page.setViewportSize({ width: 1200, height: 780 });
  await page.addInitScript(() => { Math.random = () => 47 / 0x7fffffff; localStorage.setItem('tb-quality', 'low'); });
  const errors: string[] = []; page.on('pageerror', e => errors.push(e.message));
  await page.goto('./'); await expect(page.locator('#shake')).toHaveValue('1.4');
  await page.locator('#difficulty').selectOption('casual'); await page.locator('#soloButton').click();
  await expect.poll(() => page.evaluate(() => (window as any).__tankBattle.state.phase), simulationWait).toBe('battle');
  await page.keyboard.down('KeyW');
  await expect.poll(() => page.evaluate(() => (window as any).__tankBattle.state.tanks[0].z), simulationWait).toBeLessThan(24.7);
  await page.keyboard.up('KeyW');
  await expect.poll(() => page.evaluate(() => (window as any).__tankBattle.state.sites.find((s: any) => s.kind === 'supply').team), simulationWait).toBe('player');
  await expect(page.locator('.site-label[data-site="-4"]')).toHaveAttribute('data-team', 'player');
  await page.screenshot({ path: 'artifacts/supply-captured.png' });
  await page.keyboard.down('KeyD');
  await expect.poll(() => page.evaluate(() => (window as any).__tankBattle.state.tanks[0].x), simulationWait).toBeLessThan(-23.5);
  await page.keyboard.up('KeyD'); await page.keyboard.down('KeyW');
  await expect.poll(() => page.evaluate(() => (window as any).__tankBattle.state.tanks[0].z), simulationWait).toBeLessThan(10.2);
  await page.keyboard.up('KeyW');
  await expect.poll(() => page.evaluate(() => (window as any).__tankBattle.state.sites.find((s: any) => s.kind === 'tower' && s.capturable).team), simulationWait).toBe('player');
  await expect(page.locator('.site-label[data-site="-3"]')).toHaveAttribute('data-team', 'player');
  expect(await page.evaluate(() => (window as any).__tankBattle.state.tanks[0].stats.objectives)).toBe(2);
  await page.screenshot({ path: 'artifacts/tower-captured.png' });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: 'artifacts/tower-narrow-desktop.png' });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  expect(errors).toEqual([]);
});

test('防御塔毁坏保留立体残骸，重新载入快照仍正确显示', async ({ page }) => {
  await page.setViewportSize({ width: 1000, height: 700 }); await page.goto('./');
  const result = await page.evaluate(async () => {
    const { Simulation } = await import('/TankBattle/src/game/simulation.ts');
    const { BattleRenderer } = await import('/TankBattle/src/game/renderer.ts');
    const sim = new Simulation(47), p = sim.addPlayer('visual', '玩家')!;
    sim.state.phase = 'battle'; sim.state.remaining = 0; p.x = -24; p.z = 12;
    const tower = sim.state.sites.find(s => s.kind === 'tower' && s.capturable)!;
    tower.team = 'enemy'; tower.hp = 0;
    const canvas = document.createElement('canvas'); canvas.width = 1000; canvas.height = 700;
    canvas.style.cssText = 'position:fixed;inset:0;width:100vw;height:100vh;z-index:50;pointer-events:none'; document.body.append(canvas);
    const renderer = new BattleRenderer(canvas); renderer.setQuality('low'); renderer.shakeEnabled = false;
    const snapshot = JSON.parse(JSON.stringify(sim.state));
    for (let i = 0; i < 45; i++) renderer.render(snapshot, p.id, 1 / 30);
    await renderer.scene.whenReadyAsync();
    renderer.engine.runRenderLoop(() => renderer.render(snapshot, p.id, 1 / 60));
    const root = renderer.scene.getTransformNodeByName('site-' + tower.id)!;
    const ruin = root.getChildTransformNodes(true).find(n => n.name === 'tower-ruins')!;
    const intact = root.getChildTransformNodes(true).find(n => n.name === 'site-intact')!;
    (window as any).__siteVisual = { renderer, canvas };
    return { ruin: ruin.isEnabled(), intact: intact.isEnabled(), fragments: ruin.getChildMeshes().length,
      tall: ruin.getChildMeshes().some(m => m.getBoundingInfo().boundingBox.extendSizeWorld.y > 0.3) };
  });
  expect(result).toEqual({ ruin: true, intact: false, fragments: 7, tall: true });
  await page.screenshot({ path: 'artifacts/tower-ruins.png' });
  await page.evaluate(() => { (window as any).__siteVisual.renderer.engine.dispose(); (window as any).__siteVisual.canvas.remove(); });
});

test('手机竖屏通过摇杆占领补给点，横竖屏据点提示完整', async ({ browser }) => {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  const page = await context.newPage();
  await page.addInitScript(() => { Math.random = () => 47 / 0x7fffffff; localStorage.setItem('tb-quality', 'low'); });
  await page.goto('./'); await page.locator('#difficulty').selectOption('casual'); await page.locator('#soloButton').tap();
  await expect.poll(() => page.evaluate(() => (window as any).__tankBattle.state.phase), simulationWait).toBe('battle');
  const cdp = await context.newCDPSession(page), stick = (await page.locator('#joystick').boundingBox())!;
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ id: 1, x: stick.x + stick.width / 2, y: stick.y + 12 }] });
  await expect.poll(() => page.evaluate(() => (window as any).__tankBattle.state.tanks[0].z), simulationWait).toBeLessThan(24.7);
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await expect.poll(() => page.evaluate(() => (window as any).__tankBattle.state.sites.find((s: any) => s.kind === 'supply').team), simulationWait).toBe('player');
  await expect(page.locator('.site-label[data-site="-4"]')).toHaveAttribute('data-team', 'player');
  await page.screenshot({ path: 'artifacts/supply-portrait.png' });
  await page.setViewportSize({ width: 844, height: 390 }); await page.waitForTimeout(200);
  await page.screenshot({ path: 'artifacts/supply-landscape.png' });
  // 世界标签逐帧重建，同一次浏览器求值内读取，避免跨帧持有已移除的元素。
  const rects = await page.evaluate(() => ['#joystick', '#fireButton', '.site-label[data-site="-4"]'].map(selector => document.querySelector(selector)!.getBoundingClientRect().toJSON()));
  for (const rect of rects) {
    expect(rect.x).toBeGreaterThanOrEqual(0); expect(rect.x + rect.width).toBeLessThanOrEqual(844);
  }
  await context.close();
});

test('震动默认最高，迁移旧标准档后仍记住主动选择', async ({ page }) => {
  await page.addInitScript(() => {
    if (!localStorage.getItem('shake-test-initialized')) {
      localStorage.setItem('tb-shake-strength', '1'); localStorage.setItem('shake-test-initialized', 'true');
    }
  });
  await page.goto('./'); await page.locator('#settingsButton').click();
  await expect(page.locator('#shake')).toHaveValue('1.4');
  await page.locator('#shake').selectOption('1'); await page.reload();
  await expect(page.locator('#shake')).toHaveValue('1');
  await page.locator('#settingsButton').click(); await page.locator('#shake').selectOption('0'); await page.reload();
  await expect(page.locator('#shake')).toHaveValue('0');
});
