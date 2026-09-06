// 保留已按住的手指，仅按下并松开新手指；CDP touchEnd 指定本次松开的触点。
export async function tapWhileHolding(page, cdp, selector, held, id = 3) {
  const rect = await page.locator(selector).boundingBox();
  const finger = { id, x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [...held, finger] });
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [finger] });
}

// 用真实触摸输入从 HUD 按钮上捏合；旧版会把页面放大到约 3.5 倍。
export async function pinchCameraControls(page, cdp) {
  const a = await page.locator('#zoomIn').boundingBox();
  const b = await page.locator('#freeLook').boundingBox();
  const left = { id: 1, x: a.x + a.width / 2, y: a.y + a.height / 2 };
  const right = { id: 2, x: b.x + b.width / 2, y: b.y + b.height / 2 };
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [left] });
  try {
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [left, right] });
    for (let i = 1; i <= 8; i++) {
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ ...left, x: left.x - i * 10 }, { ...right, x: right.x + i * 3 }] });
      await page.waitForTimeout(20);
    }
  } finally { await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] }); }
  await page.waitForTimeout(250);
  return page.evaluate(() => visualViewport.scale);
}
