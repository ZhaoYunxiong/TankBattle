import { test, expect } from '@playwright/test';
import { tapWhileHolding } from '../../scripts/touch-checks.mjs';

test('桌面加速与蓄力操作、透明 HUD 和暂停取消', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.addInitScript(() => { Math.random = () => 47 / 0x7fffffff; localStorage.setItem('tb-quality', 'low'); });
  const errors: string[] = []; page.on('pageerror', e => errors.push(e.message));
  await page.goto('./'); await page.locator('#soloButton').click();
  await expect.poll(() => page.evaluate(() => (window as any).__tankBattle.state.phase)).toBe('battle');
  const layout = await page.evaluate(() => {
    const rect = (id: string) => document.querySelector(id)!.getBoundingClientRect().toJSON();
    return { pause: rect('#pauseButton'), camp: rect('.camp-card'), map: rect('#radarPanel'),
      campBackground: getComputedStyle(document.querySelector('.camp-card')!).backgroundColor,
      mapBackground: getComputedStyle(document.querySelector('#radarPanel')!).backgroundColor,
      floatingCamp: !document.querySelector('.hud-top #enemyBaseCard'), statsInPause: !!document.querySelector('#pauseDialog #enemyCount') };
  });
  expect(layout.pause.x).toBeLessThan(30); expect(layout.camp.x).toBeGreaterThan(layout.pause.x + layout.pause.width);
  expect(layout.map.x).toBeGreaterThan(1000); expect(layout.campBackground).toBe('rgba(0, 0, 0, 0)'); expect(layout.mapBackground).toBe('rgba(0, 0, 0, 0)');
  expect(layout.floatingCamp).toBe(true); expect(layout.statsInPause).toBe(true);
  await page.keyboard.press('KeyB'); await expect(page.locator('#boostToggle')).toHaveAttribute('aria-pressed', 'true');
  await page.keyboard.down('KeyW');
  await expect.poll(() => page.evaluate(() => (window as any).__tankBattle.state.tanks[0].stamina)).toBeLessThan(92);
  await page.keyboard.up('KeyW'); await page.keyboard.press('KeyB');
  const used = await page.evaluate(() => (window as any).__tankBattle.state.tanks[0].stamina);
  await expect.poll(() => page.evaluate(() => (window as any).__tankBattle.state.tanks[0].stamina)).toBeGreaterThan(used + 3);
  await page.keyboard.press('KeyQ'); await expect(page.locator('#chargeToggle')).toHaveAttribute('aria-pressed', 'true');
  await page.keyboard.down('Space');
  await expect.poll(() => page.evaluate(() => (window as any).__tankBattle.state.tanks[0].charge)).toBe(1.6);
  const charged = await page.evaluate(() => (window as any).__tankBattle.state);
  expect(charged.events.filter((e: any) => e.kind === 'shot' && e.owner === charged.tanks[0].id)).toHaveLength(0);
  await page.screenshot({ path: 'artifacts/charged-desktop.png' });
  await page.keyboard.up('Space');
  await expect.poll(() => page.evaluate(() => (window as any).__tankBattle.state.events.filter((e: any) => e.kind === 'shot' && e.charge === 1).length)).toBe(1);
  await expect.poll(() => page.evaluate(() => (window as any).__tankBattle.state.tanks[0].z)).toBeGreaterThan(charged.tanks[0].z + 0.7);
  await expect.poll(() => page.evaluate(() => (window as any).__tankBattle.state.tanks[0].cooldown)).toBe(0);
  await page.keyboard.down('Space'); await expect(page.locator('#chargeProgress')).toBeVisible();
  await page.keyboard.press('Escape'); await expect(page.locator('#pauseDialog')).toBeVisible(); await page.keyboard.up('Space');
  await page.locator('#resumeButton').click();
  await expect.poll(() => page.evaluate(() => (window as any).__tankBattle.state.tanks[0].charging)).toBe(false);
  expect(await page.evaluate(() => (window as any).__tankBattle.state.events.filter((e: any) => e.kind === 'shot' && e.charge !== undefined).length)).toBe(1);
  expect(errors).toEqual([]);
});

test('手机竖屏加速蓄力双指操作与触控取消', async ({ browser }) => {
  test.skip(process.env.TANK_TEST_BROWSER === 'webkit', '多指持续触摸通过 Chromium CDP 驱动');
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 1 });
  const page = await context.newPage(), errors: string[] = []; page.on('pageerror', e => errors.push(e.message));
  await page.addInitScript(() => { Math.random = () => 47 / 0x7fffffff; localStorage.setItem('tb-quality', 'low'); });
  await page.goto('./'); await page.locator('#difficulty').selectOption('casual'); await page.locator('#soloButton').tap();
  await expect.poll(() => page.evaluate(() => (window as any).__tankBattle.state.phase)).toBe('battle');
  for (const size of [{ width: 320, height: 640 }, { width: 844, height: 390 }, { width: 390, height: 844 }]) {
    await page.setViewportSize(size);
    for (const id of ['pauseButton', 'radarPanel', 'joystick', 'fireButton', 'boostToggle', 'chargeToggle', 'staminaMeter']) {
      const rect = (await page.locator('#' + id).boundingBox())!;
      expect(rect.x).toBeGreaterThanOrEqual(0); expect(rect.y).toBeGreaterThanOrEqual(0);
      expect(rect.x + rect.width).toBeLessThanOrEqual(size.width); expect(rect.y + rect.height).toBeLessThanOrEqual(size.height);
    }
    const camp = (await page.locator('.camp-card').boundingBox())!, map = (await page.locator('#radarPanel').boundingBox())!;
    expect(camp.x + camp.width).toBeLessThan(map.x);
    await page.screenshot({ path: `artifacts/abilities-mobile-${size.width}.png` });
  }
  const cdp = await context.newCDPSession(page), stick = (await page.locator('#joystick').boundingBox())!, fire = (await page.locator('#fireButton').boundingBox())!;
  const drive = { id: 1, x: stick.x + stick.width / 2, y: stick.y + 12 }, aim = { id: 2, x: fire.x + fire.width / 2, y: fire.y + fire.height / 2 };
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [drive] });
  await tapWhileHolding(page, cdp, '#boostToggle', [drive]);
  await expect(page.locator('#boostToggle')).toHaveAttribute('aria-pressed', 'true');
  await expect.poll(() => page.evaluate(() => (window as any).__tankBattle.state.tanks[0].stamina)).toBeLessThan(98);
  await tapWhileHolding(page, cdp, '#chargeToggle', [drive]);
  await expect(page.locator('#chargeToggle')).toHaveAttribute('aria-pressed', 'true');
  // 后续相机检查期间手指仍按住摇杆，回到中心停驶，避免慢速 CI 把坦克开到河岸。
  drive.y = stick.y + stick.height / 2;
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [drive] });
  await tapWhileHolding(page, cdp, '#zoomIn', [drive]);
  await expect.poll(() => page.evaluate(() => (window as any).__tankBattle.camera.zoom)).toBe(16);
  await tapWhileHolding(page, cdp, '#zoomOut', [drive]);
  await expect.poll(() => page.evaluate(() => (window as any).__tankBattle.camera.zoom)).toBe(18);
  await tapWhileHolding(page, cdp, '#freeLook', [drive]);
  await expect(page.locator('#freeLook')).toHaveClass(/active/);
  await tapWhileHolding(page, cdp, '#freeLook', [drive]);
  await expect(page.locator('#freeLook')).not.toHaveClass(/active/);
  drive.y = stick.y + 12;
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [drive] });
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [drive, aim] });
  await expect.poll(() => page.evaluate(() => (window as any).__tankBattle.state.tanks[0].charge)).toBe(1.6);
  // 移动和蓄力手指都不松开，第三根手指仍能关闭/开启加速，蓄力不会被误释放。
  await tapWhileHolding(page, cdp, '#boostToggle', [drive, aim]);
  await expect(page.locator('#boostToggle')).toHaveAttribute('aria-pressed', 'false');
  await tapWhileHolding(page, cdp, '#boostToggle', [drive, aim]);
  await expect(page.locator('#boostToggle')).toHaveAttribute('aria-pressed', 'true');
  expect(await page.evaluate(() => (window as any).__tankBattle.state.tanks[0].charging)).toBe(true);
  await page.screenshot({ path: 'artifacts/charged-mobile.png' });
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [aim] });
  await expect.poll(() => page.evaluate(() => (window as any).__tankBattle.state.events.filter((e: any) => e.kind === 'shot' && e.charge === 1).length)).toBe(1);
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await expect.poll(() => page.evaluate(() => (window as any).__tankBattle.state.tanks[0].cooldown)).toBe(0);
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [aim] });
  await expect.poll(() => page.evaluate(() => (window as any).__tankBattle.state.tanks[0].charge)).toBeGreaterThan(0.3);
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchCancel', touchPoints: [] });
  await expect.poll(() => page.evaluate(() => (window as any).__tankBattle.state.tanks[0].charging)).toBe(false);
  expect(await page.evaluate(() => (window as any).__tankBattle.state.events.filter((e: any) => e.kind === 'shot' && e.charge !== undefined).length)).toBe(1);
  expect(errors).toEqual([]); await context.close();
});

test('蓄力视觉有炮口与炮弹特效，平地车身无周期晃动', async ({ page }) => {
  await page.setViewportSize({ width: 1000, height: 700 }); await page.goto('./');
  const result = await page.evaluate(async () => {
    const { Simulation } = await import('/TankBattle/src/game/simulation.ts');
    const { BattleRenderer } = await import('/TankBattle/src/game/renderer.ts');
    const canvas = document.createElement('canvas'); canvas.width = 1000; canvas.height = 700;
    canvas.style.cssText = 'position:fixed;inset:0;width:100vw;height:100vh;z-index:50;pointer-events:none'; document.body.append(canvas);
    const renderer = new BattleRenderer(canvas); renderer.setQuality('low'); renderer.audio.enabled = false;
    const sim = new Simulation(47), p = sim.addPlayer('p', '玩家')!; sim.start(); sim.state.phase = 'battle'; sim.state.remaining = 0; sim.state.obstacles = []; sim.state.drops = [];
    p.x = 0; p.z = 30; renderer.render(sim.state, p.id, 1 / 60, false); await renderer.scene.whenReadyAsync();
    const chassis = renderer.scene.getTransformNodeByName('suspension')!;
    let sway = 0;
    for (let i = 0; i < 90; i++) {
      sim.input(p.id, { moveX: 0, moveZ: -1, aim: Math.PI, fire: false }); sim.step(1 / 60); renderer.render(sim.state, p.id, 1 / 60, false);
      sway = Math.max(sway, Math.abs(chassis.rotation.x), Math.abs(chassis.rotation.z), chassis.position.length());
    }
    for (let i = 0; i < 100; i++) { sim.input(p.id, { moveX: 0, moveZ: 0, aim: Math.PI, fire: true, chargeMode: true }); sim.step(1 / 60); renderer.render(sim.state, p.id, 1 / 60, false); }
    const glow = renderer.scene.getMeshByName('charge-glow')!.isEnabled();
    sim.input(p.id, { moveX: 0, moveZ: 0, aim: Math.PI, fire: false, chargeMode: true }); sim.step(1 / 60); renderer.render(sim.state, p.id, 1 / 60, false);
    const recoil = Math.abs(chassis.rotation.x), shake = (renderer as any).shake;
    const shell = !!renderer.scene.getMeshByName('charged-shell'), trail = !!renderer.scene.getMeshByName('charged-trail');
    await renderer.scene.whenReadyAsync(); renderer.engine.runRenderLoop(() => renderer.render(sim.state, p.id, 1 / 60, false));
    return { sway, glow, recoil, shake, shell, trail };
  });
  expect(result.sway).toBeLessThan(0.001); expect(result.glow).toBe(true); expect(result.recoil).toBeGreaterThan(0.03);
  expect(result.shake).toBeGreaterThan(0.8); expect(result.shell).toBe(true); expect(result.trail).toBe(true);
  await page.screenshot({ path: 'artifacts/charged-shell-recoil.png' });
});
