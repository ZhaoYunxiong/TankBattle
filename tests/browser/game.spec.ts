import { test, expect } from '@playwright/test';
import { tapWhileHolding } from '../../scripts/touch-checks.mjs';
import { PROTOCOL_VERSION } from '../../src/game/types';

test('桌面真实三维渲染、驾驶、炮击和暂停', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.setViewportSize({ width: 1440, height: 900 });
  if (process.env.CI) await page.addInitScript(() => localStorage.setItem('tb-quality', 'low'));
  await page.goto('./');
  await expect(page.locator('#soloButton')).toBeVisible();
  await page.waitForFunction(() => (window as any).__tankBattle?.fps > 0);
  await page.screenshot({ path: 'artifacts/desktop-menu.png' });
  await expect(page.locator('#modeClassic')).toHaveAttribute('aria-pressed', 'true');
  await page.locator('#modeDefense').click();
  await expect(page.locator('#modeDefense')).toHaveAttribute('aria-pressed', 'true');
  await page.getByRole('button', { name: '开始单人战役' }).click();
  await expect(page.locator('#hud')).toBeVisible();
  await expect.poll(() => page.evaluate(() => (window as any).__tankBattle.state.phase)).toBe('battle');
  expect(await page.evaluate(() => (window as any).__tankBattle.state.mode)).toBe('defense');
  await expect(page.locator('#enemyBaseCard')).toBeHidden();
  await expect.poll(() => page.evaluate(() => (window as any).__tankBattle.camera.position.y)).toBeGreaterThan(11);
  const initial = await page.evaluate(() => (window as any).__tankBattle.state.tanks[0]);
  // 只按左键就应产生横向位移，不依赖前进键，炮塔仍对准原来的瞄准方向。
  await page.keyboard.down('KeyA');
  await expect.poll(() => page.evaluate(() => (window as any).__tankBattle.state.tanks[0].x)).toBeGreaterThan(initial.x + 1.2);
  await page.keyboard.up('KeyA');
  const left = await page.evaluate(() => (window as any).__tankBattle.state.tanks[0]);
  expect(left.z).toBeCloseTo(initial.z);
  expect(left.turret).toBeCloseTo(initial.turret);
  const before = await page.evaluate(() => (window as any).__tankBattle.state.tanks[0].z);
  await page.keyboard.down('KeyW');
  // 等待实际移动结果，避免 CI 软件渲染速度影响固定墙钟延迟的断言。
  await expect.poll(() => page.evaluate(() => (window as any).__tankBattle.state.tanks[0].z)).toBeLessThan(before - 1.5);
  await page.keyboard.up('KeyW');
  const after = await page.evaluate(() => (window as any).__tankBattle.state.tanks[0].z);
  expect(after).toBeLessThan(before - 1);
  await page.mouse.move(700, 400);
  await page.mouse.down();
  try {
    // 获取指针锁定时会释放指针捕获，鼠标持续按住仍应发出至少两炮。
    await expect.poll(() => page.evaluate(() => {
      const d = (window as any).__tankBattle;
      return d.state.events.filter((e: any) => e.kind === 'shot' && e.owner === d.localId).length;
    })).toBeGreaterThanOrEqual(2);
  } finally { await page.mouse.up(); }
  expect(await page.evaluate(() => (window as any).__tankBattle.state.events.some((e: any) => e.kind === 'shot'))).toBe(true);
  await page.screenshot({ path: 'artifacts/desktop-battle.png' });
  await page.keyboard.press('Escape');
  await expect.poll(() => page.evaluate(() => document.pointerLockElement === null)).toBe(true);
  if (!(await page.locator('#pauseDialog').isVisible())) await page.getByRole('button', { name: '暂停', exact: true }).click();
  await expect(page.locator('#pauseDialog')).toBeVisible();
  const time = await page.evaluate(() => (window as any).__tankBattle.state.time);
  await page.waitForTimeout(350);
  expect(await page.evaluate(() => (window as any).__tankBattle.state.time)).toBe(time);
  await page.getByRole('button', { name: '继续战斗' }).click();
  await expect(page.locator('#pauseDialog')).not.toBeVisible();
  await page.mouse.wheel(0, 10000);
  await expect.poll(() => page.evaluate(() => (window as any).__tankBattle.camera.zoom)).toBe(30);
  await page.keyboard.press('KeyC');
  const reset = await page.evaluate(() => (window as any).__tankBattle.camera);
  expect(reset.zoom).toBe(18);
  expect(reset.pitch).toBe(0.7);
  expect(errors).toEqual([]);
});

test('手机竖屏、横屏和双拇指输入', async ({ browser }) => {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 1 });
  const page = await context.newPage();
  const errors: string[] = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.goto('./');
  await expect(page.locator('#soloButton')).toBeVisible();
  await page.waitForFunction(() => (window as any).__tankBattle?.fps > 0);
  await page.screenshot({ path: 'artifacts/mobile-menu.png' });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.locator('#soloButton').tap();
  await expect(page.locator('#joystick')).toBeVisible();
  await expect.poll(() => page.evaluate(() => (window as any).__tankBattle.state.phase)).toBe('battle');
  expect(await page.evaluate(() => (window as any).__tankBattle.state.mode)).toBe('classic');
  await expect(page.locator('#enemyBaseCard')).toBeHidden();
  await expect(page.locator('#wave')).toHaveText('循路侦察敌营');
  expect(await page.evaluate(() => (window as any).__tankBattle.state.enemyBaseMaxHp)).toBe(360);
  await expect(page.locator('#pickupLabels [data-power="heal"]')).toContainText('满血无需维修');
  await expect.poll(() => page.evaluate(() => (window as any).__tankBattle.camera.position.y)).toBeGreaterThan(13);
  const before = await page.evaluate(() => (window as any).__tankBattle.state.tanks[0]);
  const cdp = await context.newCDPSession(page);
  const stick = (await page.locator('#joystick').boundingBox())!;
  const fire = (await page.locator('#fireButton').boundingBox())!;
  const left = { x: stick.x + 12, y: stick.y + stick.height / 2, id: 1 };
  const right = { x: fire.x + fire.width / 2, y: fire.y + fire.height / 2, id: 2 };
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [left] });
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [left, right] });
  await expect.poll(() => page.evaluate(() => (window as any).__tankBattle.state.tanks[0].x)).toBeGreaterThan(before.x + 1.2);
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  const moved = await page.evaluate(() => (window as any).__tankBattle.state.tanks[0]);
  expect(moved.z).toBeCloseTo(before.z);
  // 转动镜头后反向返回中央空地，避免慢速 CI 的额外行进撞上侧翼岩石。
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [right] });
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ ...right, x: right.x - 100 }] });
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  const rotated = await page.evaluate(() => (window as any).__tankBattle);
  const returnStick = { x: stick.x + stick.width - 12, y: stick.y + stick.height / 2, id: 1 };
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [returnStick] });
  await expect.poll(() => page.evaluate(() => (window as any).__tankBattle.state.tanks[0].x)).toBeLessThan(moved.x - 1);
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  const diagnostics = await page.evaluate(() => (window as any).__tankBattle);
  const dx = diagnostics.state.tanks[0].x - rotated.state.tanks[0].x;
  const dz = diagnostics.state.tanks[0].z - rotated.state.tanks[0].z;
  expect(dz / dx).toBeCloseTo(-Math.tan(rotated.camera.yaw), 1);
  expect(Math.abs(diagnostics.camera.yaw - Math.PI)).toBeGreaterThan(0.1);
  expect(diagnostics.state.events.some((e: any) => e.kind === 'shot')).toBe(true);
  await page.screenshot({ path: 'artifacts/mobile-portrait.png' });
  await page.setViewportSize({ width: 844, height: 390 });
  await page.waitForTimeout(500);
  await page.screenshot({ path: 'artifacts/mobile-landscape.png' });
  for (const selector of ['#joystick', '#fireButton', '#pauseButton']) {
    const rect = (await page.locator(selector).boundingBox())!;
    expect(rect.x).toBeGreaterThanOrEqual(0);
    expect(rect.y).toBeGreaterThanOrEqual(0);
    expect(rect.x + rect.width).toBeLessThanOrEqual(844);
    expect(rect.y + rect.height).toBeLessThanOrEqual(390);
  }
  expect(errors).toEqual([]);
  await context.close();
});

test('手机创建房间，第二位玩家通过真实 WebRTC 同步战场', async ({ browser }) => {
  test.setTimeout(150000);
  const hostContext = await browser.newContext({ viewport: { width: 844, height: 390 }, isMobile: true, hasTouch: true, deviceScaleFactor: 1 });
  const guestContext = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 1 });
  const host = await hostContext.newPage();
  const guest = await guestContext.newPage();
  // 使用确定超过旧 JSON 通道上限的大地图，覆盖完整战场快照的传输回归。
  await host.addInitScript(() => { Math.random = () => 47 / 0x7fffffff; });
  for (const [page, upgrades, coins] of [
    [host, { armor: 1, mobility: 0, reload: 0, baseArmor: 1, repair: 0 }, 700],
    [guest, { armor: 0, mobility: 0, reload: 1, baseArmor: 2, repair: 1 }, 250],
  ] as const) await page.addInitScript(({ upgrades, coins }) => localStorage.setItem('tb-profile-v1', JSON.stringify({ version: 1, id: 'network-test', honor: 2000, coins, earned: 1000, battles: 0, wins: 0, upgrades, records: [], settled: [] })), { upgrades, coins });
  const errors: string[] = [];
  host.on('pageerror', e => errors.push(e.message));
  guest.on('pageerror', e => errors.push(e.message));
  await host.goto('./');
  await host.locator('#playerName').fill('房主坦克');
  await host.locator('#difficulty').selectOption('casual');
  await host.locator('#mapSize').selectOption('large');
  await host.locator('#hostButton').tap();
  await expect(host.locator('#lobbyDialog')).toBeVisible({ timeout: 25000 });
  await expect(host.locator('#lobbyMode')).toContainText('经典模式');
  const code = (await host.locator('#roomCode').textContent())!;
  expect(code).toMatch(/^[A-Z2-9]{6}$/);
  await host.screenshot({ path: 'artifacts/mobile-lobby.png' });
  await guest.goto('./?room=' + code);
  await guest.locator('#connectButton').tap();
  await expect(guest.locator('#lobbyDialog')).toBeVisible({ timeout: 45000 });
  await expect(guest.locator('#lobbyMode')).toContainText('经典模式');
  await guest.locator('#readyButton').tap();
  await expect(host.locator('#startRoom')).toBeEnabled();
  await host.locator('#startRoom').tap();
  try { await expect(guest.locator('#hud')).toBeVisible(); }
  catch (error) {
    for (const [name, view] of [['host', host], ['guest', guest]] as const) console.log('network-start', name, await view.evaluate(() => { const d = (window as any).__tankBattle; return { phase: d.state.phase, paused: d.state.paused, time: d.state.time, fps: d.fps, players: d.state.tanks.filter((t: any) => t.team === 'player') }; }));
    console.log('network-errors', errors); throw error;
  }
  await expect.poll(() => guest.evaluate(() => (window as any).__tankBattle.state.tanks.filter((t: any) => t.team === 'player').length)).toBe(2);
  await expect.poll(() => guest.evaluate(() => (window as any).__tankBattle.state.phase), { timeout: 15000 }).toBe('battle');
  const hostState = await host.evaluate(() => (window as any).__tankBattle.state);
  const guestState = await guest.evaluate(() => (window as any).__tankBattle.state);
  expect(hostState.seed).toBe(guestState.seed);
  expect(new TextEncoder().encode(JSON.stringify(hostState)).length).toBeGreaterThan(16300);
  expect(guestState.version).toBe(PROTOCOL_VERSION);
  expect(guestState.mapSize).toBe('large');
  expect(guestState.enemyBaseDiscovered).toBe(false);
  expect(guestState.explored.length).toBeGreaterThan(0);
  expect(guestState.difficulty).toBe('casual');
  expect(guestState.enemyBaseMaxHp).toBe(280);
  expect(guestState.baseMaxHp).toBe(696);
  expect(guestState.campUpgrades).toEqual({ baseArmor: 2, repair: 1 });
  expect(guestState.tanks.find((t: any) => t.name === '房主坦克').maxHp).toBe(130);
  expect(guestState.tanks.find((t: any) => t.name !== '房主坦克' && t.team === 'player').upgrades.reload).toBe(1);
  await expect(guest.locator('#difficultyBadge')).toHaveText('休闲');
  expect(hostState.mode).toBe('classic');
  expect(guestState.mode).toBe(hostState.mode);
  expect(guestState.enemyBaseHp).toBe(hostState.enemyBaseHp);
  expect(hostState.obstacles).toEqual(guestState.obstacles);
  expect(hostState.sites).toEqual(guestState.sites);
  expect(guestState.sites.filter((s: any) => s.kind === 'tower')).toHaveLength(9);
  const guestBefore = await guest.evaluate(() => {
    const d = (window as any).__tankBattle;
    return d.state.tanks.find((t: any) => t.id === d.localId);
  });
  const cdp = await guestContext.newCDPSession(guest);
  const stick = (await guest.locator('#joystick').boundingBox())!;
  const drive = { x: stick.x + 12, y: stick.y + stick.height / 2, id: 1 };
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [drive] });
  await tapWhileHolding(guest, cdp, '#boostToggle', [drive]);
  await expect(guest.locator('#boostToggle')).toHaveAttribute('aria-pressed', 'true');
  await tapWhileHolding(guest, cdp, '#chargeToggle', [drive]);
  await expect(guest.locator('#chargeToggle')).toHaveAttribute('aria-pressed', 'true');
  await expect.poll(() => host.evaluate(() => (window as any).__tankBattle.state.tanks.find((t: any) => t.team === 'player' && t.name !== '房主坦克').x)).toBeGreaterThan(guestBefore.x + 1);
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await guest.waitForTimeout(600);
  await guest.locator('#boostToggle').tap();
  const hostGuest = await host.evaluate(() => (window as any).__tankBattle.state.tanks.find((t: any) => t.team === 'player' && t.name !== '房主坦克'));
  const guestSelf = await guest.evaluate(() => {
    const d = (window as any).__tankBattle;
    return d.state.tanks.find((t: any) => t.id === d.localId);
  });
  expect(hostGuest.x).toBeGreaterThan(guestBefore.x + 1);
  expect(hostGuest.stamina).toBeLessThan(100);
  expect(Math.abs(hostGuest.stamina - guestSelf.stamina)).toBeLessThan(3);
  expect(hostGuest.z).toBeCloseTo(guestBefore.z);
  expect(Math.abs(hostGuest.x - guestSelf.x)).toBeLessThan(0.4);
  expect(Math.abs(hostGuest.z - guestSelf.z)).toBeLessThan(0.4);
  const fire = (await guest.locator('#fireButton').boundingBox())!;
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ id: 2, x: fire.x + fire.width / 2, y: fire.y + fire.height / 2 }] });
  await expect.poll(() => host.evaluate(id => (window as any).__tankBattle.state.tanks.find((t: any) => t.id === id).charge, guestSelf.id)).toBe(1.6);
  await expect.poll(() => guest.evaluate(id => (window as any).__tankBattle.state.tanks.find((t: any) => t.id === id).charge, guestSelf.id)).toBe(1.6);
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  for (const view of [host, guest]) await expect.poll(() => view.evaluate(id => (window as any).__tankBattle.state.events.filter((e: any) => e.owner === id && e.kind === 'shot' && e.charge === 1).length, guestSelf.id)).toBe(1);
  await guest.locator('#mapToggle').tap();
  const radar = (await guest.locator('#radar').boundingBox())!;
  await guest.touchscreen.tap(radar.x + radar.width / 2, radar.y + radar.height / 2);
  await expect.poll(() => host.evaluate(() => (window as any).__tankBattle.state.pings.length)).toBe(1);
  expect(await host.evaluate(() => (window as any).__tankBattle.state.pings[0].owner)).toBe(guestSelf.id);
  await guest.locator('#mapToggle').tap();
  await expect.poll(() => guest.evaluate(id => (window as any).__tankBattle.state.tanks.find((t: any) => t.id === id).cooldown, guestSelf.id)).toBe(0);
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ id: 2, x: fire.x + fire.width / 2, y: fire.y + fire.height / 2 }] });
  await expect.poll(() => host.evaluate(id => (window as any).__tankBattle.state.tanks.find((t: any) => t.id === id).charge, guestSelf.id)).toBeGreaterThan(0.3);
  await host.locator('#pauseButton').tap();
  await expect.poll(() => guest.evaluate(() => (window as any).__tankBattle.state.paused)).toBe(true);
  await expect.poll(() => guest.evaluate(id => (window as any).__tankBattle.state.tanks.find((t: any) => t.id === id).charging, guestSelf.id)).toBe(false);
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await guest.screenshot({ path: 'artifacts/multiplayer-guest.png' });
  await host.locator('#resumeButton').tap();
  await expect.poll(() => guest.evaluate(() => (window as any).__tankBattle.state.paused)).toBe(false);
  expect(await host.evaluate(id => (window as any).__tankBattle.state.events.filter((e: any) => e.owner === id && e.kind === 'shot' && e.charge !== undefined).length, guestSelf.id)).toBe(1);
  // 客机通过实际摇杆驶入补给圈，验证占领由房主计算并同步给两端。
  const move = async (x: number, y: number, axis: 'x' | 'z', goal: number, less: boolean) => {
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ id: 1, x, y }] });
    const position = expect.poll(() => guest.evaluate(axis => {
      const d = (window as any).__tankBattle; return d.state.tanks.find((t: any) => t.id === d.localId)[axis];
    }, axis));
    if (less) await position.toBeLessThan(goal); else await position.toBeGreaterThan(goal);
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  };
  await move(stick.x + stick.width - 12, stick.y + stick.height / 2, 'x', -39.5, true);
  await move(stick.x + stick.width / 2, stick.y + 12, 'z', 66, true);
  await move(stick.x + 12, stick.y + stick.height / 2, 'x', -35, false);
  for (const view of [host, guest]) await expect.poll(() => view.evaluate(() => (window as any).__tankBattle.state.sites.find((s: any) => s.kind === 'supply').team)).toBe('player');
  expect(await host.evaluate(id => (window as any).__tankBattle.state.tanks.find((t: any) => t.id === id).stats.objectives, guestSelf.id)).toBe(1);
  await guest.screenshot({ path: 'artifacts/multiplayer-captured-supply.png' });
  expect(errors).toEqual([]);
  await guestContext.close();
  await hostContext.close();
});
