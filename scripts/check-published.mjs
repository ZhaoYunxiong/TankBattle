import { chromium } from '@playwright/test';
import assert from 'node:assert/strict';

const url = process.argv[2] || 'https://zhaoyunxiong.github.io/TankBattle/';
const browser = await chromium.launch({
  channel: process.platform === 'win32' ? 'msedge' : undefined,
  headless: true,
  args: ['--enable-unsafe-swiftshader', '--disable-background-timer-throttling', '--disable-renderer-backgrounding'],
});
const errors = [];
try {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 1 });
  const page = await context.newPage();
  page.on('pageerror', e => errors.push(e.message));
  const response = await page.goto(url, { waitUntil: 'networkidle', timeout: 60000 });
  assert.equal(response.status(), 200);
  await page.locator('#soloButton').waitFor({ state: 'visible' });
  assert.equal(await page.locator('#modeClassic').getAttribute('aria-pressed'), 'true');
  await page.screenshot({ path: 'artifacts/published-menu.png' });
  await page.locator('#soloButton').tap();
  await page.locator('#hud').waitFor({ state: 'visible' });
  await page.waitForFunction(() => /敌军/.test(document.querySelector('#enemyCount')?.textContent || ''), null, { timeout: 20000 });
  assert.match(await page.locator('#enemyCount').textContent(), /敌军/);
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  assert.equal(await page.locator('#modeName').textContent(), '经典模式');
  assert.equal(await page.locator('#enemyBaseCard').isVisible(), true);
  assert.equal(await page.locator('.player-card').count(), 0);
  assert.equal(await page.locator('#localTankStatus').isVisible(), true);
  assert.equal(await page.locator('#score').isVisible(), false);
  assert.match(await page.locator('#pickupLabels [data-power=heal]').textContent(), /满血无需维修/);
  await page.screenshot({ path: 'artifacts/published-battle.png' });
  await page.locator('#pauseButton').tap();
  assert.equal(await page.locator('#lives').isVisible(), true);
  assert.equal(await page.locator('#score').isVisible(), true);
  await page.locator('#backMenu').tap();
  await page.locator('#modeDefense').tap();
  await page.locator('#soloButton').tap();
  await page.waitForFunction(() => /敌军/.test(document.querySelector('#enemyCount')?.textContent || ''), null, { timeout: 20000 });
  assert.equal(await page.locator('#modeName').textContent(), '防守模式');
  assert.equal(await page.locator('#enemyBaseCard').isVisible(), false);
  await page.screenshot({ path: 'artifacts/published-defense.png' });
  await page.locator('#pauseButton').tap();
  await page.locator('#backMenu').tap();
  await page.locator('#hostButton').tap();
  await page.locator('#lobbyDialog').waitFor({ state: 'visible', timeout: 25000 });
  const code = await page.locator('#roomCode').textContent();
  const guestContext = await browser.newContext({ viewport: { width: 844, height: 390 }, isMobile: true, hasTouch: true, deviceScaleFactor: 1 });
  const guest = await guestContext.newPage();
  guest.on('pageerror', e => errors.push(e.message));
  await guest.goto(url + '?room=' + code);
  await guest.locator('#connectButton').tap();
  await guest.locator('#lobbyDialog').waitFor({ state: 'visible', timeout: 40000 });
  assert.match(await guest.locator('#lobbyMode').textContent(), /防守模式/);
  await guest.locator('#readyButton').tap();
  await page.locator('#startRoom').tap();
  await guest.locator('#hud').waitFor({ state: 'visible' });
  await guest.waitForFunction(() => /敌军/.test(document.querySelector('#enemyCount')?.textContent || ''), null, { timeout: 20000 });
  assert.match(await guest.locator('#enemyCount').textContent(), /敌军/);
  assert.equal(await guest.locator('#modeName').textContent(), '防守模式');
  assert.equal(await guest.locator('#enemyBaseCard').isVisible(), false);
  await guest.screenshot({ path: 'artifacts/published-multiplayer.png' });
  assert.deepEqual(errors, []);
  console.log(JSON.stringify({ url, http: response.status(), singlePlayer: 'passed', modes: ['classic', 'defense'], pickupFeedback: 'passed', mobileLayout: 'passed', publicWebRTC: 'passed', pageErrors: errors }));
} finally {
  await browser.close();
}
