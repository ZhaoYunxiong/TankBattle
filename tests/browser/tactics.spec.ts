import { test, expect, type Page } from '@playwright/test';

async function scenario(page: Page, grass = false, guest = false) {
  await page.evaluate(async ({ grass, guest }) => {
    const { Simulation } = await import('/TankBattle/src/game/simulation.ts');
    const { mapFor } = await import('/TankBattle/src/game/maps.ts');
    const { groundHeight } = await import('/TankBattle/src/game/terrain.ts');
    const { EMPTY_INPUT } = await import('/TankBattle/src/game/types.ts');
    const { BattleRenderer } = await import('/TankBattle/src/game/renderer.ts');
    const renderHit = (BattleRenderer.prototype as any).handleEvent;
    (BattleRenderer.prototype as any).handleEvent = function(event: any, local: any) {
      const before = new Set(this.scene.meshes);
      renderHit.call(this, event, local);
      if (event.impact) (window as any).fixtureSparkColors = this.scene.meshes.filter((m: any) => !before.has(m) && m.name === 'debris').map((m: any) => m.material.diffuseColor.toHexString());
    };
    const original = Simulation.prototype.step, enemyInput = (Simulation.prototype as any).enemyInput;
    let installed = false;
    (window as any).fixtureFacing = Math.PI;
    (Simulation.prototype as any).enemyInput = function(t: any, dt: number) { return t.id === 'target' ? { ...EMPTY_INPUT, aim: t.turret } : enemyInput.call(this, t, dt); };
    Simulation.prototype.step = function(dt: number) {
      if ((window as any).fixtureHold) return;
      if (this.state.phase === 'battle') {
        const players = this.state.tanks.filter(t => t.team === 'player');
        const player = players[guest ? 1 : 0];
        if (!installed && player) {
          installed = true; this.state.remaining = 0; this.state.obstacles = []; this.state.sites = []; this.state.drops = [];
          const region = mapFor(this.state.mapSize).grass[0];
          player.x = grass ? region.x : 0; player.z = grass ? region.z : 24; player.angle = player.turret = Math.PI;
          for (const other of players.filter(t => t !== player)) { other.x = player.x + 6; other.z = player.z; }
          this.state.tanks = [...players, { ...player, id: 'target', name: '重装目标', team: 'enemy', kind: 'heavy',
            x: player.x, z: player.z - 8, hp: 180, maxHp: 180, angle: (window as any).fixtureFacing, turret: 0, shield: 0,
            ambushCharge: 0, cooldown: 9999, stats: { ...player.stats }, buffs: { ...player.buffs } }];
        }
        const target = this.state.tanks.find(t => t.id === 'target');
        if (target) target.angle = (window as any).fixtureFacing;
        if ((window as any).fixtureIncoming && player) {
          (window as any).fixtureIncoming = false;
          this.state.shells.push({ id: 910000, owner: 'target', team: 'enemy', x: player.x, z: player.z + 0.2,
            y: groundHeight(player.x, player.z, mapFor(this.state.mapSize)) + 1, vx: 0, vy: 0, vz: -27, damage: 16, life: 1 });
        }
      }
      original.call(this, dt);
    };
  }, { grass, guest });
}

async function holdAtFeedback(page: Page, selector: string, label: string) {
  await page.evaluate(({ selector, label }) => {
    const element = document.querySelector<HTMLElement>(selector)!;
    // 提示只有约一秒；在浏览器内捕获出现时刻，避免云端指令往返错过提示。
    // 仅冻结测试场景的模拟时钟，截图后恢复，继续验证真实的自动消退。
    const observer = new MutationObserver(() => {
      if (element.hidden || element.textContent !== label || !element.getClientRects().length) return;
      (window as any).fixtureHold = true;
      window.dispatchEvent(new KeyboardEvent('keyup', { code: 'Space', bubbles: true }));
      observer.disconnect();
    });
    observer.observe(element, { attributes: true, childList: true, subtree: true });
  }, { selector, label });
}

async function resumeAndCheckExpiry(page: Page, selector: string) {
  await page.evaluate(() => { (window as any).fixtureHold = false; });
  await expect(page.locator(selector)).toBeHidden();
}

test('桌面方向装甲、侧面与弱点反馈跟随真实炮弹，提示自动消退', async ({ page }) => {
  test.setTimeout(process.env.CI ? 180000 : 60000);
  const errors: string[] = []; page.on('pageerror', e => errors.push(e.message));
  await page.addInitScript(() => localStorage.setItem('tb-quality', 'low'));
  await page.setViewportSize({ width: 1280, height: 800 }); await page.goto('./'); await scenario(page);
  await page.locator('#soloButton').click();
  await expect.poll(() => page.evaluate(() => (window as any).__tankBattle.state.phase)).toBe('battle');
  let hp = 180;
  for (const [angle, impact, label, damage] of [[0, 'armor', '正面装甲减伤', 16], [Math.PI / 2, 'normal', '命中', 20], [Math.PI, 'weakpoint', '弱点命中', 25]] as const) {
    await page.evaluate(angle => { (window as any).fixtureFacing = angle; }, angle);
    await holdAtFeedback(page, '#hitFeedback', label);
    await page.keyboard.down('Space');
    try {
      await page.waitForFunction(() => (window as any).fixtureHold);
    } finally { await page.keyboard.up('Space'); }
    hp -= damage;
    expect(await page.evaluate(() => (window as any).__tankBattle.state.tanks.find((t: any) => t.id === 'target').hp)).toBeCloseTo(hp);
    await expect(page.locator('#hitFeedback')).toHaveText(label); await expect(page.locator('#hitFeedback')).toBeVisible();
    await expect(page.locator('#hitFeedback')).toHaveAttribute('data-impact', impact);
    const expectedColor = { armor: '#B8E2EB', normal: '#EDC788', weakpoint: '#FFAD78' }[impact];
    expect(await page.evaluate(() => (window as any).fixtureSparkColors)).toContain(expectedColor);
    expect(await page.locator('#hitFeedback').evaluate(e => getComputedStyle(e).backgroundColor)).toBe('rgba(0, 0, 0, 0)');
    await page.screenshot({ path: `artifacts/impact-${impact}.png` });
    await resumeAndCheckExpiry(page, '#hitFeedback');
  }
  await holdAtFeedback(page, '#impactStatus', '后部受击');
  await page.evaluate(() => { (window as any).fixtureIncoming = true; });
  await expect(page.locator('#impactStatus')).toHaveText('后部受击'); await expect(page.locator('#impactStatus')).toBeVisible();
  await resumeAndCheckExpiry(page, '#impactStatus');
  expect(errors).toEqual([]);
});

test('装甲、弱点与护盾音效实际渲染出不同音色，并在短时间内结束', async ({ page }) => {
  await page.goto('./');
  test.skip(!await page.evaluate(() => typeof (window.OfflineAudioContext ?? (window as any).webkitOfflineAudioContext) === 'function'), '当前浏览器测试运行时不提供离线音频接口');
  const tones = await page.evaluate(async () => {
    const { BattleAudio } = await import('/TankBattle/src/game/audio.ts');
    const Offline = window.OfflineAudioContext ?? (window as any).webkitOfflineAudioContext;
    const result = [];
    for (const material of ['armor', 'weakpoint', 'shield']) {
      const context = new Offline(1, 22050, 44100), audio = new BattleAudio();
      // 离线渲染开始前须先排好节点；适配已解锁状态，实际音频节点和采样仍由 Web Audio 生成。
      (audio as any).context = new Proxy(context, { get(target, key) {
        if (key === 'state') return 'running';
        const value = Reflect.get(target, key, target);
        return typeof value === 'function' ? value.bind(target) : value;
      } });
      audio.play('hit', 1, material);
      const samples = (await context.startRendering()).getChannelData(0);
      let crossings = 0, energy = 0;
      for (let i = 1; i < 8820; i++) { if (samples[i] * samples[i - 1] < 0) crossings++; energy += samples[i] ** 2; }
      result.push({ material, crossings, rms: Math.sqrt(energy / 8820), silentTail: samples.slice(11025).every(n => n === 0) });
    }
    return result;
  });
  for (const tone of tones) { expect(tone.rms).toBeGreaterThan(0.001); expect(tone.silentTail).toBe(true); }
  expect(tones[0].crossings).toBeGreaterThan(tones[2].crossings);
  expect(tones[2].crossings).toBeGreaterThan(tones[1].crossings);
});

test('手机竖屏和横屏高草准备、原生触摸蓄力与伏击弱点命中', async ({ browser, browserName }) => {
  test.skip(browserName !== 'chromium', '原生多指输入使用 Chromium CDP');
  test.setTimeout(process.env.CI ? 240000 : 90000);
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 1 });
  try {
    const page = await context.newPage(), errors: string[] = []; page.on('pageerror', e => errors.push(e.message));
    await page.addInitScript(() => localStorage.setItem('tb-quality', 'low'));
    await page.goto('./'); await scenario(page, true); await page.locator('#soloButton').tap();
    const cdp = await context.newCDPSession(page);
    for (const viewport of [{ width: 390, height: 844 }, { width: 844, height: 390 }]) {
      await page.setViewportSize(viewport);
      await expect(page.locator('#concealmentStatus')).toHaveText('隐蔽 · 首炮强化', { timeout: 30000 });
      if (await page.locator('#chargeToggle').getAttribute('aria-pressed') !== 'true') await page.locator('#chargeToggle').tap();
      const rect = (await page.locator('#fireButton').boundingBox())!;
      const finger = { id: 2, x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [finger] });
      await expect(page.locator('#touchReload')).toHaveText('松开发射');
      await holdAtFeedback(page, '#hitFeedback', '伏击 · 弱点命中');
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
      await expect(page.locator('#hitFeedback')).toHaveText('伏击 · 弱点命中');
      await expect(page.locator('#hitFeedback')).toBeVisible();
      await expect(page.locator('#concealmentStatus')).toContainText('暴露');
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      expect(await page.evaluate(() => visualViewport!.scale)).toBe(1);
      await page.screenshot({ path: `artifacts/ambush-mobile-${viewport.width}.png` });
      await resumeAndCheckExpiry(page, '#hitFeedback');
    }
    const target = await page.evaluate(() => (window as any).__tankBattle.state.tanks.find((t: any) => t.id === 'target'));
    expect(target.hp).toBeCloseTo(28.8);
    expect(errors).toEqual([]);
  } finally { await context.close(); }
});

test('联机客机开炮后双方同步后部伤害，命中提示只属于射手', async ({ browser }) => {
  test.setTimeout(120000);
  const contexts = await Promise.all([0, 1].map(() => browser.newContext({ viewport: { width: 844, height: 390 }, isMobile: true, hasTouch: true })));
  try {
    const [host, guest] = await Promise.all(contexts.map(c => c.newPage()));
    for (const p of [host, guest]) { await p.addInitScript(() => localStorage.setItem('tb-quality', 'low')); await p.goto('./'); }
    await scenario(host, false, true);
    await host.locator('#hostButton').tap(); await expect(host.locator('#lobbyDialog')).toBeVisible({ timeout: 30000 });
    const code = (await host.locator('#roomCode').textContent())!;
    await guest.locator('#joinButton').tap(); await guest.locator('#roomInput').fill(code); await guest.locator('#connectButton').tap();
    await expect(guest.locator('#lobbyDialog')).toBeVisible({ timeout: 30000 }); await guest.locator('#readyButton').tap();
    await host.locator('#startRoom').tap(); await expect(guest.locator('#hud')).toBeVisible();
    await expect.poll(() => guest.evaluate(() => (window as any).__tankBattle.state.phase)).toBe('battle');
    await guest.keyboard.down('Space');
    try { await expect(guest.locator('#hitFeedback')).toHaveText('弱点命中'); }
    finally { await guest.keyboard.up('Space'); }
    for (const p of [host, guest]) {
      await expect.poll(() => p.evaluate(() => (window as any).__tankBattle.state.tanks.find((t: any) => t.id === 'target').hp)).toBe(155);
      expect(await p.evaluate(() => (window as any).__tankBattle.state.events.findLast((e: any) => e.impact)?.impact)).toBe('weakpoint');
    }
    await expect(host.locator('#hitFeedback')).toBeHidden();
    await guest.screenshot({ path: 'artifacts/weakpoint-network.png' });
  } finally { await Promise.all(contexts.map(c => c.close())); }
});
