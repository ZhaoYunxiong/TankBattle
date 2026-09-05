import { test, expect } from '@playwright/test';

test('普通单人经典模式探索、过桥、回攻与通关', async ({ page }) => {
  test.setTimeout(150000);
  await page.setViewportSize({ width: 1280, height: 800 });
  // 只用真实键盘操作，诊断入口仅读取状态；包含备用坦克回攻的完整流程。
  await page.addInitScript(() => { Math.random = () => 47 / 0x7fffffff; });
  await page.goto('./');
  await page.locator('#soloButton').click();
  await expect.poll(() => page.evaluate(() => (window as any).__tankBattle.state.phase)).toBe('battle');
  await expect(page.locator('#enemyBaseCard')).toBeHidden();
  const drive = async (axis: 'x' | 'z', target: number) => {
    const key = axis === 'x' ? 'KeyA' : 'KeyW';
    await page.keyboard.down(key);
    try {
      await page.waitForFunction(({ axis, target }) => {
        const s = (window as any).__tankBattle.state;
        return s.tanks[0].hp <= 0 || (axis === 'x' ? s.tanks[0].x >= target : s.tanks[0].z <= target);
      }, { axis, target }, { timeout: 25000 });
    } finally { await page.keyboard.up(key); }
  };
  for (let attack = 0; attack < 3; attack++) {
    await page.waitForFunction(() => (window as any).__tankBattle.state.tanks[0].hp > 0, null, { timeout: 10000 });
    await drive('x', -0.1);
    await page.keyboard.down('Space');
    try {
      await drive('z', -22);
      await drive('x', 25.8);
      await expect.poll(() => page.evaluate(() => (window as any).__tankBattle.state.enemyBaseDiscovered)).toBe(true);
      await expect(page.locator('#enemyBaseCard')).toBeVisible();
      await page.screenshot({ path: 'artifacts/classic-enemy-camp.png' });
      const deadline = Date.now() + 50000;
      let right = false;
      while (Date.now() < deadline) {
        const s = await page.evaluate(() => (window as any).__tankBattle.state);
        if (s.phase !== 'battle' || s.tanks[0].hp <= 0) break;
        const key = right ? 'KeyA' : 'KeyD';
        await page.keyboard.down(key);
        try {
          await page.waitForFunction(right => {
            const s = (window as any).__tankBattle.state;
            return s.phase !== 'battle' || s.tanks[0].hp <= 0 || (right ? s.tanks[0].x >= 26.7 : s.tanks[0].x <= 25.3);
          }, right, { timeout: 4000 });
        } finally { await page.keyboard.up(key); }
        right = !right;
      }
    } finally { await page.keyboard.up('Space'); }
    const phase = await page.evaluate(() => (window as any).__tankBattle.state.phase);
    if (phase !== 'battle') break;
  }
  const result = await page.evaluate(() => (window as any).__tankBattle.state);
  await page.screenshot({ path: 'artifacts/normal-solo-victory.png' });
  console.log('raid-result', { phase: result.phase, base: result.baseHp, enemyBase: result.enemyBaseHp, lives: result.tanks[0].lives, time: result.time });
  expect(result.phase).toBe('won');
  expect(result.difficulty).toBe('normal');
  expect(result.enemyBaseHp).toBe(0);
  expect(result.baseHp).toBeGreaterThan(0);
  expect(result.tanks[0].score).toBeGreaterThanOrEqual(1000);
  await expect(page.locator('#resultDialog')).toBeVisible();
});
