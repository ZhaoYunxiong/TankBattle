import { test, expect } from '@playwright/test';

test('手机大地图切换、高草伏击和自由镜头侦察边界', async ({ browser }) => {
  test.setTimeout(90000);
  const context = await browser.newContext({ viewport: { width: 844, height: 390 }, isMobile: true, hasTouch: true, deviceScaleFactor: 1 });
  const page = await context.newPage();
  const errors: string[] = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.addInitScript(() => { localStorage.setItem('tb-quality', 'low'); Math.random = () => 47 / 0x7fffffff; });
  await page.goto('./');
  for (const [size, width, depth] of [['large', 192, 240], ['medium', 144, 180], ['small', 96, 120]] as const) {
    await page.locator('#mapSize').selectOption(size);
    await page.locator('#soloButton').tap();
    await page.waitForFunction(() => (window as any).__tankBattle.state.phase === 'battle');
    expect(await page.evaluate(() => (window as any).__tankBattle.terrain.size)).toEqual({ x: width, z: depth });
    expect(await page.evaluate(() => (window as any).__tankBattle.state.mapSize)).toBe(size);
    await expect(page.locator('#enemyBaseCard')).toBeHidden();
    await expect(page.locator('#wave')).toHaveText('循路侦察敌营');
    console.log('mobile-map', size, await page.evaluate(() => ({ fps: (window as any).__tankBattle.fps, rendering: (window as any).__tankBattle.rendering })));
    await page.screenshot({ path: 'artifacts/map-' + size + '-mobile.png' });
    if (size !== 'small') { await page.locator('#pauseButton').tap(); await page.locator('#backMenu').tap(); }
  }
  const cdp = await context.newCDPSession(page);
  const drive = async (axis: 'x' | 'z', target: number) => {
    const stick = (await page.locator('#joystick').boundingBox())!;
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ id: 1, x: axis === 'x' ? stick.x + stick.width - 10 : stick.x + stick.width / 2, y: axis === 'z' ? stick.y + 10 : stick.y + stick.height / 2 }] });
    try {
      await page.waitForFunction(({ axis, target }) => (window as any).__tankBattle.state.tanks[0][axis] <= target, { axis, target });
    } finally { await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] }); }
  };
  await drive('x', -8);
  await drive('z', 30);
  await expect(page.locator('#concealmentStatus')).toHaveText('隐蔽 · 首炮强化');
  await page.screenshot({ path: 'artifacts/grass-ambush-mobile.png' });
  const fire = (await page.locator('#fireButton').boundingBox())!;
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ id: 2, x: fire.x + fire.width / 2, y: fire.y + fire.height / 2 }] });
  await expect(page.locator('#concealmentStatus')).toContainText('暴露');
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await expect(page.locator('#concealmentStatus')).toHaveText('隐蔽 · 首炮强化', { timeout: 15000 });
  await page.locator('#freeLook').tap();
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ id: 2, x: 470, y: 190 }] });
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ id: 2, x: 700, y: 230 }] });
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  expect(await page.evaluate(() => (window as any).__tankBattle.state.enemyBaseDiscovered)).toBe(false);
  await expect(page.locator('#enemyBaseCard')).toBeHidden();
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.locator('#joystick')).toBeInViewport();
  await expect(page.locator('#fireButton')).toBeInViewport();
  expect(errors).toEqual([]);
  await context.close();
});
