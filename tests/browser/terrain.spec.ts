import { test, expect } from '@playwright/test';

for (const mobile of [false, true]) test((mobile ? '手机' : '桌面') + '坡地行驶、贴身血条与高地视野', async ({ browser }) => {
  const context = await browser.newContext({ viewport: mobile ? { width: 844, height: 390 } : { width: 1440, height: 900 }, isMobile: mobile, hasTouch: mobile, deviceScaleFactor: 1 });
  const page = await context.newPage();
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.addInitScript(low => {
    Math.random = () => 47 / 0x7fffffff;
    if (low) localStorage.setItem('tb-quality', 'low');
  }, !!process.env.CI);
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
    let sample;
    if (cdp) {
      const stick = (await page.locator('#joystick').boundingBox())!;
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: axis === 'x' ? stick.x + 10 : stick.x + stick.width / 2, y: axis === 'z' ? stick.y + 10 : stick.y + stick.height / 2, id: 1 }] });
    } else await page.keyboard.down(axis === 'x' ? 'KeyA' : 'KeyW');
    try {
      sample = await page.waitForFunction(({ axis, target, mobile }) => {
        const diagnostics = (window as any).__tankBattle;
        const tank = diagnostics.state.tanks[0];
        if (!(axis === 'x' ? tank.x >= target : tank.z <= target)) return false;
        // 在目标帧经正常键盘事件入口松键，避免 CI 的 RPC 延迟让车辆驶离横向道路。
        // 走 Controls 的正常 keyup 入口，随后再释放浏览器驱动器保存的按键状态。
        if (!mobile) window.dispatchEvent(new KeyboardEvent('keyup', { code: axis === 'x' ? 'KeyA' : 'KeyW', bubbles: true }));
        return { vehicle: diagnostics.vehicle, camera: diagnostics.camera, terrain: diagnostics.terrain };
      }, { axis, target, mobile }, { timeout: process.env.CI ? 90000 : 25000 });
    } finally {
      if (cdp) await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
      else {
        // 固定延迟用于重现云端松键滞后，验证坦克不会在等待驱动器期间越过目标路段。
        await page.waitForTimeout(650);
        await page.keyboard.up(axis === 'x' ? 'KeyA' : 'KeyW');
      }
    }
    const result = await sample.jsonValue();
    await sample.dispose();
    if (!result) throw new Error('未读取到目标位置的行驶状态');
    if (!mobile) {
      const stopped = await page.evaluate(axis => (window as any).__tankBattle.state.tanks[0][axis], axis);
      expect(Math.abs(stopped - target)).toBeLessThan(1.5);
    }
    return result;
  };
  await drive('z', 24);
  const slope = await drive('x', 13);
  expect(slope.vehicle.position.y).toBeGreaterThan(3);
  expect(Math.abs(slope.vehicle.pitch)).toBeGreaterThan(0.2);
  expect(slope.camera.position.y - slope.terrain.cameraGround).toBeGreaterThanOrEqual(1);
  await page.screenshot({ path: 'artifacts/terrain-' + (mobile ? 'mobile' : 'desktop') + '-slope.png' });
  const summit = await drive('x', 25);
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
