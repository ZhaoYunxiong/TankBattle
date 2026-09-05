export function preventBrowserZoom() {
  const cancel = (event: Event) => { if (event.cancelable) event.preventDefault(); };

  // Safari 可能忽略 viewport 的缩放限制，显式拦截页面手势；不阻止游戏指针事件传播。
  for (const name of ['gesturestart', 'gesturechange', 'gestureend']) {
    document.addEventListener(name, cancel, { passive: false });
  }
  const pinch = (event: TouchEvent) => { if (event.touches.length > 1) cancel(event); };
  document.addEventListener('touchstart', pinch, { passive: false });
  document.addEventListener('touchmove', pinch, { passive: false });

  document.addEventListener('dblclick', event => {
    if (!(event.target instanceof Element) || !event.target.closest('input, textarea')) cancel(event);
  });
  document.addEventListener('wheel', event => {
    // 触控板捏合会以 Ctrl + wheel 送达，普通滚轮仍交给游戏镜头或菜单滚动。
    if (event.ctrlKey) cancel(event);
  }, { passive: false });
}
