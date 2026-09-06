import { test, expect, type Page } from '@playwright/test';
import { tapWhileHolding } from '../../scripts/touch-checks.mjs';

const funded = { version: 1, id: 'vehicle-ui-test', honor: 5000, coins: 1600, earned: 1600, battles: 0, wins: 0, upgrades: { armor: 0, mobility: 0, reload: 0, baseArmor: 0, repair: 0 }, records: [], settled: [] };
const wait = { timeout: process.env.CI ? 45000 : 15000 };

async function prepare(page: Page) {
  await page.addInitScript(profile => { localStorage.setItem('tb-profile-v1', JSON.stringify(profile)); localStorage.setItem('tb-quality', 'low'); }, funded);
}

async function pick(page: Page, kind: string, lobby = false) {
  await page.locator(lobby ? '#lobbyVehicle' : '#vehicleButton').click();
  await page.locator(`[data-vehicle="${kind}"]`).click();
  await expect(page.locator('#vehiclePreview')).toHaveAttribute('data-ready', 'true', wait);
  await page.locator('#selectVehicle').click();
  await expect(page.locator('#vehicleDialog')).toBeHidden(wait);
}

test('桌面车库四种模型、金币解锁与实际出征车型一致', async ({ page }) => {
  test.setTimeout(process.env.CI ? 300000 : 120000);
  await prepare(page); await page.setViewportSize({ width: 1280, height: 900 }); await page.goto('./');
  const errors: string[] = []; page.on('pageerror', e => errors.push(e.message));
  for (const [kind, hp, mesh] of [['standard', 120, 'hull'], ['scout', 90, 'scout-stowage'], ['heavy', 180, 'heavy-front-armor'], ['engineer', 110, 'engineer-toolbox']] as const) {
    await page.locator('#vehicleButton').click(); await page.locator(`[data-vehicle="${kind}"]`).click();
    await expect(page.locator('#vehiclePreview')).toHaveAttribute('data-ready', 'true', wait);
    await page.screenshot({ path: `artifacts/garage-${kind}.png` });
    await page.locator('#selectVehicle').click(); await expect(page.locator('#vehicleDialog')).toBeHidden(wait);
    expect(await page.evaluate(() => JSON.parse(localStorage.getItem('tb-profile-v1')!).selectedVehicle)).toBe(kind);
    await page.locator('#soloButton').click();
    await expect.poll(() => page.evaluate(() => (window as any).__tankBattle.state.phase), wait).toBe('battle');
    const tank = await page.evaluate(() => (window as any).__tankBattle.state.tanks[0]);
    expect(tank.kind).toBe(kind); expect(tank.maxHp).toBe(hp);
    // 检查实际战场的模型节点，预览之外也确实使用了该车型。
    expect(await page.evaluate(() => (window as any).__tankBattle.vehicle.parts)).toContain(mesh);
    await page.keyboard.down('Space');
    await expect.poll(() => page.evaluate(() => (window as any).__tankBattle.state.events.some((e: any) => e.kind === 'shot' && e.owner === (window as any).__tankBattle.localId)), wait).toBe(true);
    await page.keyboard.up('Space');
    await page.screenshot({ path: `artifacts/vehicle-battle-${kind}.png` });
    await page.locator('#pauseButton').click(); await page.locator('#backMenu').click();
  }
  const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('tb-profile-v1')!));
  expect(saved.version).toBe(2); expect(saved.coins).toBe(700); expect(saved.unlockedVehicles).toHaveLength(4);
  expect(errors).toEqual([]);
});

test('手机竖屏选车记忆、模型旋转、横竖屏布局与重型多指蓄力', async ({ browser, browserName }) => {
  test.skip(browserName !== 'chromium', '多点触摸通过 Chromium 原生输入验证');
  test.setTimeout(process.env.CI ? 240000 : 120000);
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  try {
    const page = await context.newPage(); await prepare(page); await page.goto('./');
    await pick(page, 'heavy');
    // 刷新时只设置画质，不重新注入旧档案，验证实际保存的车型和解锁状态。
    await page.close();
    const restored = await context.newPage(); await restored.goto('./');
    await expect(restored.locator('#selectedVehicleName')).toHaveText('重型突破坦克');
    const errors: string[] = []; restored.on('pageerror', e => errors.push(e.message));
    await restored.locator('#vehicleButton').tap();
    await expect(restored.locator('#vehiclePreview')).toHaveAttribute('data-ready', 'true', wait);
    const cdp = await context.newCDPSession(restored), preview = (await restored.locator('#vehiclePreview').boundingBox())!;
    const finger = { id: 1, x: preview.x + preview.width / 2, y: preview.y + preview.height / 2 };
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [finger] });
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ ...finger, x: finger.x + 70 }] });
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    for (const [width, height] of [[390, 844], [320, 568], [844, 390]]) {
      await restored.setViewportSize({ width, height });
      await expect(restored.locator('#selectVehicle')).toBeEnabled();
      expect(await restored.locator('#vehicleDialog').evaluate(e => e.scrollWidth <= e.clientWidth)).toBe(true);
      await restored.screenshot({ path: `artifacts/garage-mobile-${width}.png` });
      if (width === 320) {
        const option = (await restored.locator('[data-vehicle="scout"]').boundingBox())!;
        const start = { id: 4, x: option.x + option.width / 2, y: option.y + option.height / 2 };
        await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [start] });
        for (let move = 10; move <= 90; move += 10) await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ ...start, y: start.y - move }] });
        await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
        await expect.poll(() => restored.locator('#vehicleDialog').evaluate(e => e.scrollTop)).toBeGreaterThan(20);
        await expect(restored.locator('#vehicleName')).toHaveText('重型突破坦克');
        await restored.locator('#vehicleDialog').evaluate(e => { e.scrollTop = 0; });
      }
    }
    await restored.setViewportSize({ width: 390, height: 844 });
    await restored.locator('#selectVehicle').tap(); await expect(restored.locator('#vehicleDialog')).toBeHidden(wait); await restored.locator('#soloButton').tap();
    await expect.poll(() => restored.evaluate(() => (window as any).__tankBattle.state.phase), wait).toBe('battle');
    expect(await restored.evaluate(() => (window as any).__tankBattle.state.tanks[0].maxHp)).toBe(180);
    const stick = (await restored.locator('#joystick').boundingBox())!;
    const drive = { id: 1, x: stick.x + stick.width / 2, y: stick.y + stick.height / 2 - 18 };
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [drive] });
    await tapWhileHolding(restored, cdp, '#boostToggle', [drive]);
    await expect(restored.locator('#boostToggle')).toHaveAttribute('aria-pressed', 'true');
    await expect.poll(() => restored.evaluate(() => (window as any).__tankBattle.state.tanks[0].stamina), wait).toBeLessThan(99);
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await restored.locator('#chargeToggle').tap();
    const fire = (await restored.locator('#fireButton').boundingBox())!;
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ id: 2, x: fire.x + fire.width / 2, y: fire.y + fire.height / 2 }] });
    await expect.poll(() => restored.evaluate(() => (window as any).__tankBattle.state.tanks[0].charge), wait).toBe(2);
    await expect(restored.locator('#touchReload')).toHaveText('松开发射');
    await restored.screenshot({ path: 'artifacts/heavy-mobile-charge.png' });
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await expect.poll(() => restored.evaluate(() => (window as any).__tankBattle.state.events.some((e: any) => e.kind === 'shot' && e.charge === 1)), wait).toBe(true);
    expect(errors).toEqual([]);
  } finally { await context.close(); }
});

test('四人房间独立选车、准备状态与工程维修同步', async ({ browser }) => {
  test.setTimeout(240000);
  const contexts = await Promise.all([0, 1, 2, 3].map(() => browser.newContext({ viewport: { width: 844, height: 390 }, isMobile: true, hasTouch: true })));
  try {
    const pages = await Promise.all(contexts.map(c => c.newPage())), [host] = pages;
    const errors: string[] = [];
    for (const page of pages) { page.on('pageerror', e => errors.push(e.message)); await prepare(page); await page.goto('./'); }
    const kinds = ['engineer', 'scout', 'heavy', 'standard'];
    for (let i = 0; i < pages.length; i++) await pick(pages[i], kinds[i]);
    await host.locator('#mapSize').selectOption('medium'); await host.locator('#hostButton').tap();
    await expect(host.locator('#lobbyDialog')).toBeVisible({ timeout: 25000 });
    const code = (await host.locator('#roomCode').textContent())!;
    for (const page of pages.slice(1)) {
      await page.locator('#joinButton').tap(); await page.locator('#roomInput').fill(code); await page.locator('#connectButton').tap();
      await expect(page.locator('#lobbyDialog')).toBeVisible({ timeout: 30000 });
    }
    for (const page of pages.slice(1)) await page.locator('#readyButton').tap();
    await expect(host.locator('#startRoom')).toBeEnabled();
    await pick(pages[3], 'heavy', true);
    await expect(host.locator('#startRoom')).toBeDisabled();
    await expect(host.locator('#players')).toContainText('重型突破坦克');
    await pick(pages[3], 'standard', true); await pages[3].locator('#readyButton').tap();
    await expect(host.locator('#startRoom')).toBeEnabled();
    await host.screenshot({ path: 'artifacts/vehicles-four-player-lobby.png' });
    // 在房主模拟中注入一次受击测试场景，维修依然完整经过命中、脱战和网络快照。
    await host.evaluate(async () => {
      const { Simulation } = await import('/TankBattle/src/game/simulation.ts');
      const { groundHeight } = await import('/TankBattle/src/game/terrain.ts');
      const { mapFor } = await import('/TankBattle/src/game/maps.ts');
      const step = Simulation.prototype.step; let injected = false;
      Simulation.prototype.step = function(dt: number) {
        if (!injected && this.state.phase === 'battle') {
          injected = true; const t = this.state.tanks.find(t => t.team === 'player' && t.kind === 'scout')!;
          this.state.shells.push({ id: 990000, owner: 'fixture-enemy', team: 'enemy', x: t.x, y: groundHeight(t.x, t.z, mapFor(this.state.mapSize)) + 1, z: t.z, vx: 0, vy: 0, vz: 0, damage: 30, life: 1 });
        }
        step.call(this, dt);
      };
    });
    await host.locator('#startRoom').tap();
    for (const page of pages) {
      await expect(page.locator('#hud')).toBeVisible();
      await expect.poll(() => page.evaluate(() => (window as any).__tankBattle.state.tanks.filter((t: any) => t.team === 'player').map((t: any) => t.kind))).toEqual(kinds);
    }
    await expect.poll(() => pages[1].evaluate(() => (window as any).__tankBattle.state.tanks.find((t: any) => t.kind === 'scout').hp)).toBe(60);
    for (const page of pages) await expect.poll(() => page.evaluate(() => (window as any).__tankBattle.state.tanks.find((t: any) => t.kind === 'engineer').stats.repairs), { timeout: 30000 }).toBeGreaterThanOrEqual(12);
    await expect.poll(() => pages[1].evaluate(() => (window as any).__tankBattle.state.tanks.find((t: any) => t.kind === 'scout').hp)).toBeGreaterThanOrEqual(72);
    await host.screenshot({ path: 'artifacts/engineer-network-repair.png' });
    expect(errors).toEqual([]);
  } finally { await Promise.all(contexts.map(c => c.close())); }
});
