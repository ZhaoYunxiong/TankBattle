import { test, expect } from '@playwright/test';

test('紧凑手机的模式选择、横竖屏大厅和防守入口', async ({ browser }) => {
  const context = await browser.newContext({ viewport: { width: 320, height: 568 }, isMobile: true, hasTouch: true, deviceScaleFactor: 1 });
  const page = await context.newPage();
  const errors: string[] = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.goto('./');
  await expect(page.locator('#modeClassic')).toHaveAttribute('aria-pressed', 'true');
  for (const viewport of [{ width: 320, height: 568 }, { width: 568, height: 320 }, { width: 844, height: 390 }]) {
    await page.setViewportSize(viewport);
    for (const selector of ['#modeClassic', '#modeDefense', '#soloButton', '#hostButton', '#joinButton']) {
      await page.locator(selector).scrollIntoViewIfNeeded();
      const box = (await page.locator(selector).boundingBox())!;
      expect(box.x).toBeGreaterThanOrEqual(0);
      expect(box.y).toBeGreaterThanOrEqual(0);
      expect(box.x + box.width).toBeLessThanOrEqual(viewport.width);
      expect(box.y + box.height).toBeLessThanOrEqual(viewport.height);
    }
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({ path: 'artifacts/mode-menu-' + viewport.width + '.png' });
  }
  await page.locator('#modeDefense').tap();
  await expect(page.locator('#modeDefense')).toHaveAttribute('aria-pressed', 'true');
  await page.locator('#soloButton').tap();
  await expect.poll(() => page.evaluate(() => (window as any).__tankBattle.state.mode)).toBe('defense');
  await expect(page.locator('#modeName')).toHaveText('防守模式');
  await expect(page.locator('#enemyBaseCard')).toBeHidden();
  await page.locator('#pauseButton').tap();
  await page.locator('#backMenu').tap();
  await expect(page.locator('#modeDefense')).toHaveAttribute('aria-pressed', 'true');
  await page.locator('#modeClassic').tap();
  await page.locator('#soloButton').tap();
  await expect(page.locator('#enemyBaseCard')).toBeVisible();
  await expect(page.locator('#modeName')).toHaveText('经典模式');
  expect(errors).toEqual([]);
  await context.close();
});
