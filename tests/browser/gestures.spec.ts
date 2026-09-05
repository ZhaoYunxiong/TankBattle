import { test, expect } from '@playwright/test';
import { pinchCameraControls } from '../../scripts/touch-checks.mjs';

test('手机横竖屏防止页面缩放，多指不抢镜头且菜单仍可滑动', async ({ browser, browserName }) => {
  test.skip(browserName !== 'chromium', '多点触摸通过 Chromium 原生输入验证');
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 1 });
  const page = await context.newPage();
  const errors: string[] = [];
  page.on('pageerror', e => errors.push(e.message));
  if (process.env.CI) await page.addInitScript(() => localStorage.setItem('tb-quality', 'low'));
  await page.goto('./');
  await page.locator('#soloButton').tap();
  await expect(page.locator('#zoomIn')).toBeVisible();
  const cdp = await context.newCDPSession(page);
  for (const viewport of [{ width: 390, height: 844 }, { width: 844, height: 390 }]) {
    await page.setViewportSize(viewport);
    expect(await pinchCameraControls(page, cdp)).toBe(1);
    await page.touchscreen.tap(viewport.width / 2, viewport.height * 0.45);
    await page.touchscreen.tap(viewport.width / 2, viewport.height * 0.45);
    await page.waitForTimeout(300);
    expect(await page.evaluate(() => visualViewport!.scale)).toBe(1);
  }
  await page.setViewportSize({ width: 390, height: 844 });
  const before = await page.evaluate(() => (window as any).__tankBattle.camera);
  const owner = { id: 1, x: 100, y: 380 };
  const extra = { id: 2, x: 270, y: 380 };
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [owner] });
  try {
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [owner, extra] });
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [owner, { ...extra, x: 320, y: 440 }] });
    const untouched = await page.evaluate(() => (window as any).__tankBattle.camera);
    expect(untouched.yaw).toBe(before.yaw);
    expect(untouched.pitch).toBe(before.pitch);
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ ...owner, x: 130 }, { ...extra, x: 320, y: 440 }] });
    await expect.poll(() => page.evaluate(() => (window as any).__tankBattle.camera.yaw)).toBeCloseTo(before.yaw + 0.12);
  } finally { await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] }); }
  // 有意点击游戏缩放按钮仍可调节镜头，触控板捏合不能冒充滚轮缩放。
  await page.locator('#zoomIn').tap();
  await expect.poll(() => page.evaluate(() => (window as any).__tankBattle.camera.zoom)).toBe(16);
  await page.locator('#zoomOut').tap();
  await page.locator('#battlefield').dispatchEvent('wheel', { deltaY: 900, ctrlKey: true });
  expect(await page.evaluate(() => (window as any).__tankBattle.camera.zoom)).toBe(18);
  await page.locator('#pauseButton').tap();
  await page.locator('#backMenu').tap();
  await page.setViewportSize({ width: 320, height: 568 });
  await page.locator('#playerName').tap();
  await expect(page.locator('#playerName')).toBeFocused();
  expect(await page.evaluate(() => visualViewport!.scale)).toBe(1);
  await page.locator('#playerName').blur();
  const menu = page.locator('#menu');
  await menu.evaluate(element => { element.scrollTop = 0; });
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ id: 1, x: 150, y: 185 }] });
  try {
    for (let y = 180; y >= 70; y -= 10) {
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ id: 1, x: 150, y }] });
    }
  } finally { await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] }); }
  await expect.poll(() => menu.evaluate(element => element.scrollTop)).toBeGreaterThan(10);
  await page.locator('#difficulty').selectOption('casual');
  await page.locator('#soloButton').tap();
  await expect(page.locator('#difficultyBadge')).toHaveText('休闲');
  expect(errors).toEqual([]);
  await context.close();
});
