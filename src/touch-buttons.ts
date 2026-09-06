export function enableHudTouchButtons(hud: HTMLElement) {
  const reset = new Set<() => void>();
  for (const button of hud.querySelectorAll<HTMLButtonElement>('button:not(#fireButton)')) {
    let touch: { id: number; x: number; y: number; moved: boolean } | undefined;
    let suppressTouchClick = false;
    const clear = () => { touch = undefined; };
    reset.add(clear);

    button.addEventListener('pointerdown', event => {
      if (event.pointerType !== 'touch') { suppressTouchClick = false; return; }
      // 多指和防缩放拦截后不能依赖浏览器补发 click，每个按钮独立跟踪触点。
      suppressTouchClick = true;
      event.preventDefault();
      if (touch || button.disabled) return;
      touch = { id: event.pointerId, x: event.clientX, y: event.clientY, moved: false };
      button.setPointerCapture(event.pointerId);
    });
    button.addEventListener('pointermove', event => {
      if (touch?.id === event.pointerId && Math.hypot(event.clientX - touch.x, event.clientY - touch.y) > 10) touch.moved = true;
    });
    button.addEventListener('pointerup', event => {
      if (touch?.id !== event.pointerId) return;
      const candidate = touch; clear(); event.preventDefault();
      const rect = button.getBoundingClientRect();
      if (candidate.moved || Math.hypot(event.clientX - candidate.x, event.clientY - candidate.y) > 10 ||
        event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom ||
        button.disabled || button.closest('[hidden]') || document.querySelector('dialog[open]')) return;
      button.click();
    });
    for (const name of ['pointercancel', 'lostpointercapture'] as const) button.addEventListener(name, event => {
      if (touch?.id === event.pointerId) clear();
    });
    button.addEventListener('click', event => {
      // 部分浏览器还会补发原生点击；只保留上面的单次激活，键盘和鼠标正常工作。
      if (suppressTouchClick && event.isTrusted && event.detail > 0) { event.preventDefault(); event.stopImmediatePropagation(); }
    }, true);
  }
  window.addEventListener('blur', () => reset.forEach(clear => clear()));
  document.addEventListener('visibilitychange', () => { if (document.hidden) reset.forEach(clear => clear()); });
}
