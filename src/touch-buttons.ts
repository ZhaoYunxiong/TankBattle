// HUD 与可滚动车库共用触点判定，动态生成的车型按钮也能响应。
function wireTouchButtons(root: HTMLElement, canActivate: (button: HTMLButtonElement) => boolean) {
  const touches = new Map<number, { button: HTMLButtonElement; x: number; y: number; moved: boolean }>();
  const suppressTouchClick = new WeakSet<HTMLButtonElement>();
  const buttonAt = (event: Event) => {
    const button = event.target instanceof Element ? event.target.closest<HTMLButtonElement>('button:not(#fireButton)') : null;
    return button && root.contains(button) ? button : null;
  };
  root.addEventListener('pointerdown', event => {
    const button = buttonAt(event); if (!button) return;
    if (event.pointerType !== 'touch') { suppressTouchClick.delete(button); return; }
    // 浏览器可能在拖动、旋屏或防缩放后不补发 click，每个按钮独立跟踪触点。
    suppressTouchClick.add(button); event.preventDefault();
    if (button.disabled || [...touches.values()].some(t => t.button === button)) return;
    touches.set(event.pointerId, { button, x: event.clientX, y: event.clientY, moved: false });
    button.setPointerCapture(event.pointerId);
  });
  root.addEventListener('pointermove', event => {
    const touch = touches.get(event.pointerId);
    if (touch && Math.hypot(event.clientX - touch.x, event.clientY - touch.y) > 10) touch.moved = true;
  });
  root.addEventListener('pointerup', event => {
    const touch = touches.get(event.pointerId); if (!touch) return;
    touches.delete(event.pointerId); event.preventDefault();
    const button = touch.button, rect = button.getBoundingClientRect();
    if (touch.moved || Math.hypot(event.clientX - touch.x, event.clientY - touch.y) > 10 ||
      event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom ||
      !root.contains(button) || button.disabled || button.closest('[hidden]') || !canActivate(button)) return;
    button.click();
  });
  for (const name of ['pointercancel', 'lostpointercapture'] as const) root.addEventListener(name, event => touches.delete(event.pointerId));
  root.addEventListener('click', event => {
    const button = buttonAt(event);
    // 只保留单次激活；浏览器补发的原生点击被忽略，键盘与鼠标仍然正常工作。
    if (button && suppressTouchClick.has(button) && event.isTrusted && event.detail > 0) { event.preventDefault(); event.stopImmediatePropagation(); }
  }, true);
  window.addEventListener('blur', () => touches.clear());
  document.addEventListener('visibilitychange', () => { if (document.hidden) touches.clear(); });
}

export function enableHudTouchButtons(hud: HTMLElement) {
  wireTouchButtons(hud, () => !document.querySelector('dialog[open]'));
}

export function enableDialogTouchButtons(dialog: HTMLDialogElement) {
  wireTouchButtons(dialog, button => dialog.open && button.closest('dialog') === dialog);
}
