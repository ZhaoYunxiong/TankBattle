import { test, expect } from '@playwright/test';

test('普通单人经典模式行军、炮击与通关', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  // 固定地图种子，仅通过键鼠操作行军和射击，诊断入口用于读取实际战场结果。
  await page.addInitScript(() => { Math.random = () => 47 / 0x7fffffff; });
  await page.goto('./');
  await page.locator('#soloButton').click();
  await expect.poll(() => page.evaluate(() => (window as any).__tankBattle.state.phase)).toBe('battle');
  await page.keyboard.down('KeyA');
  await page.waitForFunction(() => (window as any).__tankBattle.state.tanks[0].x >= -0.25);
  await page.keyboard.up('KeyA');
  await page.keyboard.down('Space');
  await page.keyboard.down('KeyW');
  await expect.poll(() => page.evaluate(() => (window as any).__tankBattle.state.tanks[0].z), { timeout: 20000, intervals: [100] }).toBeLessThan(-15);
  await page.keyboard.up('KeyW');
  await expect.poll(() => page.evaluate(() => (window as any).__tankBattle.state.enemyBaseHp), { timeout: 15000 }).toBeLessThan(360);
  await page.keyboard.up('Space');
  const state = await page.evaluate(() => (window as any).__tankBattle.state);
  expect(state.mode).toBe('classic');
  expect(state.enemyBaseHp).toBeGreaterThan(0);
  expect(state.phase).toBe('battle');
  await expect(page.locator('#enemyBaseHp')).not.toHaveText('360 / 360');
  await page.screenshot({ path: 'artifacts/classic-enemy-camp.png' });
  await page.keyboard.down('Space');
  try {
    await expect.poll(() => page.evaluate(() => (window as any).__tankBattle.state.phase), { timeout: 35000 }).toBe('won');
  } finally { await page.keyboard.up('Space'); }
  await expect(page.locator('#resultDialog')).toBeVisible();
  const result = await page.evaluate(() => (window as any).__tankBattle.state);
  expect(result.difficulty).toBe('normal');
  expect(result.enemyBaseHp).toBe(0);
  expect(result.baseHp).toBeGreaterThan(0);
  await page.screenshot({ path: 'artifacts/normal-solo-victory.png' });
});
