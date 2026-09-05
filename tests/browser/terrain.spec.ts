import { test, expect } from '@playwright/test';

for (const mobile of [false, true]) test((mobile ? '手机' : '桌面') + '坡地行驶、贴身血条与高地视野', async ({ browser }) => {
  const context = await browser.newContext({ viewport: mobile ? { width: 844, height: 390 } : { width: 1440, height: 900 }, isMobile: mobile, hasTouch: mobile, deviceScaleFactor: 1 });
  const page = await context.newPage();
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.addInitScript(() => { Math.random = () => 47 / 0x7fffffff; });
  await page.goto('./');
  await page.locator('#soloButton').click();
  await expect.poll(() => page.evaluate(() => (window as any).__tankBattle.state.phase)).toBe('battle');
  await expect(page.locator('.player-card')).toHaveCount(0);
  await expect(page.locator('#localTankStatus')).toBeVisible();
  await expect(page.locator('#tankHp')).toHaveText('120 / 120');
  await expect(page.locator('#score')).toBeHidden();
  const health = (await page.locator('#localTankStatus').boundingBox())!;
  expect(health.width).toBeLessThan(80);
  expect(health.height).toBeLessThan(40);
  // 浮动标签逐帧更新，在同一帧内读取所有矩形，避免取到刚被替换的节点。
  expect(await page.evaluate(() => {
    const health = document.querySelector('#localTankStatus')!.getBoundingClientRect();
    return [...document.querySelectorAll('#pickupLabels .pickup-label')].every(box => {
      const rect = box.getBoundingClientRect();
      return rect.right < health.left || rect.left > health.right || rect.bottom < health.top || rect.top > health.bottom;
    });
  })).toBe(true);
  const cdp = mobile ? await context.newCDPSession(page) : null;
  const drive = async (axis: 'x' | 'z', target: number) => {
    if (cdp) {
      const stick = (await page.locator('#joystick').boundingBox())!;
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: axis === 'x' ? stick.x + 10 : stick.x + stick.width / 2, y: axis === 'z' ? stick.y + 10 : stick.y + stick.height / 2, id: 1 }] });
    } else await page.keyboard.down(axis === 'x' ? 'KeyA' : 'KeyW');
    try {
      await page.waitForFunction(({ axis, target }) => {
        const tank = (window as any).__tankBattle.state.tanks[0];
        return axis === 'x' ? tank.x >= target : tank.z <= target;
      }, { axis, target }, { timeout: process.env.CI ? 90000 : 25000 });
    } finally {
      if (cdp) await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
      else await page.keyboard.up(axis === 'x' ? 'KeyA' : 'KeyW');
    }
  };
  await drive('z', 24);
  await drive('x', 16);
  await page.waitForTimeout(250);
  const slope = await page.evaluate(() => (window as any).__tankBattle);
  expect(slope.vehicle.position.y).toBeGreaterThan(3);
  expect(Math.abs(slope.vehicle.pitch)).toBeGreaterThan(0.2);
  expect(slope.camera.position.y - slope.terrain.cameraGround).toBeGreaterThanOrEqual(1);
  await page.screenshot({ path: 'artifacts/terrain-' + (mobile ? 'mobile' : 'desktop') + '-slope.png' });
  await drive('x', 25);
  await page.waitForTimeout(250);
  const summit = await page.evaluate(() => (window as any).__tankBattle);
  expect(summit.vehicle.position.y).toBeGreaterThan(6.5);
  expect(summit.terrain.size).toEqual({ x: 96, z: 120 });
  expect(summit.camera.position.y - summit.terrain.cameraGround).toBeGreaterThanOrEqual(1);
  await expect(page.locator('#localTankStatus')).toBeVisible();
  await page.screenshot({ path: 'artifacts/terrain-' + (mobile ? 'mobile' : 'desktop') + '-summit.png' });
  await page.locator('#pauseButton').click();
  await expect(page.locator('#lives')).toBeVisible();
  await expect(page.locator('#score')).toBeVisible();
  expect(errors).toEqual([]);
  await context.close();
});
