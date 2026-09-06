import { test, expect, type Page } from '@playwright/test';
import { tapWhileHolding } from '../../scripts/touch-checks.mjs';

// 使用真实 CSS、Controls、Simulation 和原生触摸；手动推进模拟帧，稳定复现帧间短按。
async function touchScene(page: Page) {
  await page.route('**/touch-fixture', route => route.fulfill({ contentType: 'text/html', body: `<!doctype html>
    <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
    <link rel="stylesheet" href="./src/style.css">
    <canvas id="battlefield"></canvas><div id="app"><section id="hud">
      <div class="touch-controls"><div id="joystick"><span></span></div>
      <button id="fireButton"><svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="8"/></svg><small id="touchReload">按住蓄力</small></button></div>
      <div class="camera-buttons"><button id="zoomIn" class="icon-button">＋</button><button id="zoomOut" class="icon-button">−</button><button id="freeLook" class="icon-button">相机</button><button id="boostToggle" class="icon-button">加速</button><button id="chargeToggle" class="icon-button">蓄力</button></div>
    </section></div><input id="editable" value="房间号可复制" style="position:fixed;top:20px;left:20px">
    <script type="module">
      import { Controls } from './src/controls.ts';
      import { Simulation } from './src/game/simulation.ts';
      import { preventBrowserZoom } from './src/viewport.ts';
      import { enableHudTouchButtons } from './src/touch-buttons.ts';
      const get = id => document.getElementById(id), renderer = { yaw: Math.PI, pitch: .8, zoom: 18, audio: { unlock() {} } };
      const controls = new Controls(renderer, get('battlefield'), get('joystick'), get('fireButton'));
      const sim = new Simulation(47, 'classic', 'casual'), player = sim.addPlayer('p', '测试');
      sim.start(); sim.state.phase = 'battle'; sim.state.remaining = 0; sim.state.obstacles = []; sim.state.sites = []; sim.state.drops = [];
      controls.enabled = true; controls.onChange = () => sim.input('p', controls.read());
      get('chargeToggle').onclick = () => controls.setChargeMode(!controls.chargeMode);
      get('boostToggle').onclick = () => { controls.boost = !controls.boost; controls.onChange(); };
      preventBrowserZoom(); enableHudTouchButtons(get('hud'));
      window.fixture = { controls, sim, player, renderer, menus: [],
        step(frames = 1) { for (let i = 0; i < frames; i++) { sim.input('p', controls.read()); sim.step(1 / 30); } },
        shots() { return sim.state.events.filter(e => e.kind === 'shot' && e.owner === 'p'); }
      };
      document.addEventListener('contextmenu', e => window.fixture.menus.push(e.defaultPrevented));
    </script>` }));
  await page.goto('./touch-fixture');
  await page.waitForFunction(() => !!(window as any).fixture);
}

test('手机横竖屏射击边缘短按不漏发，战斗文字不可选而输入框仍可编辑', async ({ browser }) => {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  try {
    const page = await context.newPage(), errors: string[] = []; page.on('pageerror', e => errors.push(e.message));
    await touchScene(page);
    let shots = 0;
    for (const viewport of [{ width: 390, height: 844 }, { width: 844, height: 390 }]) {
      await page.setViewportSize(viewport);
      const rect = (await page.locator('#fireButton').boundingBox())!;
      for (let angle = 0; angle < Math.PI * 2; angle += Math.PI / 4) {
        const point = { x: rect.x + rect.width / 2 + Math.cos(angle) * (rect.width / 2 + 8), y: rect.y + rect.height / 2 + Math.sin(angle) * (rect.height / 2 + 8) };
        expect(await page.evaluate(({ x, y }) => document.elementFromPoint(x, y)?.closest('button')?.id, point)).toBe('fireButton');
        await page.touchscreen.tap(point.x, point.y);
        expect(await page.evaluate(() => { const f = (window as any).fixture; f.step(); return f.shots().length; })).toBe(++shots);
        await page.evaluate(() => (window as any).fixture.step(40));
      }
      // 边缘容错不能盖住相邻技能键，点击仍会切换一次。
      await page.locator('#boostToggle').tap();
      expect(await page.evaluate(() => (window as any).fixture.controls.boost)).toBe(viewport.width === 390);
      expect(await page.evaluate(() => visualViewport!.scale)).toBe(1);
    }
    for (const selector of ['#battlefield', '#joystick', '#fireButton', '#touchReload', '#fireButton svg']) {
      expect(await page.locator(selector).evaluate(e => getComputedStyle(e).webkitUserSelect)).toBe('none');
    }
    await page.locator('#touchReload').click({ button: 'right' });
    expect(await page.evaluate(() => (window as any).fixture.menus)).toEqual([true]);
    await page.locator('#touchReload').dblclick();
    expect(await page.evaluate(() => getSelection()!.toString())).toBe('');
    await page.locator('#editable').fill('ABC123'); await page.locator('#editable').press('ControlOrMeta+A');
    expect(await page.locator('#editable').evaluate(e => [(e as HTMLInputElement).selectionStart, (e as HTMLInputElement).selectionEnd])).toEqual([0, 6]);
    expect(errors).toEqual([]);
  } finally { await context.close(); }
});

test('手机竖屏移动和镜头触点不阻塞射击，长按拖出与系统取消不会卡键或误释放蓄力', async ({ browser, browserName }) => {
  test.skip(browserName !== 'chromium', '多指长按使用 Chromium 原生触摸协议');
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  try {
    const page = await context.newPage(), errors: string[] = []; page.on('pageerror', e => errors.push(e.message));
    await touchScene(page); await page.locator('#chargeToggle').tap();
    const cdp = await context.newCDPSession(page), stick = (await page.locator('#joystick').boundingBox())!, rect = (await page.locator('#fireButton').boundingBox())!;
    const drive = { id: 1, x: stick.x + stick.width / 2, y: stick.y + 12 }, look = { id: 2, x: 180, y: 360 }, fire = { id: 3, x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [drive, look] });
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [drive, look, fire] });
    await page.waitForTimeout(900);
    expect(await page.evaluate(() => { const f = (window as any).fixture; f.step(50); return f.player.charge; })).toBe(1.6);
    await expect(page.locator('#fireButton')).toHaveClass(/pressed/);
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [look] });
    await tapWhileHolding(page, cdp, '#boostToggle', [drive, fire], 4);
    await page.locator('#boostToggle').click();
    expect(await page.evaluate(() => { const f = (window as any).fixture; f.step(); return [f.player.charging, f.shots().length, f.controls.read().fire, getSelection()!.toString()]; })).toEqual([true, 0, true, '']);
    expect((await page.locator('#fireButton').boundingBox())!.width).toBe(rect.width);
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchCancel', touchPoints: [] });
    expect(await page.evaluate(() => { const f = (window as any).fixture; f.step(); return [f.player.charging, f.shots().length, f.controls.read().fire]; })).toEqual([false, 0, false]);
    // 被系统打断后重新按下可正常蓄力，手指滑出圆圈仍由原按钮跟踪到松开。
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [fire] });
    await page.evaluate(() => (window as any).fixture.step(50));
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ ...fire, x: fire.x - 90, y: fire.y - 90 }] });
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    expect(await page.evaluate(() => { const f = (window as any).fixture; f.step(); return f.shots().map((e: any) => e.charge); })).toEqual([1]);
    expect(await page.evaluate(() => (window as any).fixture.controls.read().fire)).toBe(false);
    await expect(page.locator('#fireButton')).not.toHaveClass(/pressed/);
    expect(errors).toEqual([]);
  } finally { await context.close(); }
});
