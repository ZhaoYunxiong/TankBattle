import { clamp, type Input } from './game/types';
import type { BattleRenderer } from './game/renderer';

export class Controls {
  enabled = false;

  freeLook = false;

  onPause: () => void = () => {};

  onRecenter: () => void = () => {};

  private keys = new Set<string>();

  private firing = false;

  private joystick = { x: 0, y: 0 };

  private stickPointer = -1;

  private lookPointer = -1;

  private previous = { x: 0, y: 0 };

  private lastAim = Math.PI;

  constructor(private renderer: BattleRenderer, canvas: HTMLCanvasElement, stick: HTMLElement, fire: HTMLElement) {
    window.addEventListener('keydown', e => {
      if ((e.target as HTMLElement).matches('input, select, textarea')) return;
      if (e.code === 'Escape' && this.enabled) { this.reset(); this.onPause(); return; }
      if (!this.enabled) return;
      if (['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'AltLeft', 'AltRight'].includes(e.code)) e.preventDefault();
      this.keys.add(e.code);
      if (e.code === 'KeyC') this.onRecenter();
    });
    window.addEventListener('keyup', e => this.keys.delete(e.code));
    window.addEventListener('blur', () => this.reset());
    document.addEventListener('visibilitychange', () => { if (document.hidden) this.reset(); });
    canvas.addEventListener('contextmenu', e => e.preventDefault());
    const aimDown = (e: PointerEvent) => {
      if (!this.enabled) return;
      this.renderer.audio.unlock();
      if (e.pointerType === 'mouse' && e.button === 0) {
        this.firing = true;
        if (!document.pointerLockElement) {
          try { void canvas.requestPointerLock()?.catch(() => {}); } catch { /* 浏览器不允许锁定时仍可拖动瞄准。 */ }
        }
      }
      this.lookPointer = e.pointerId;
      this.previous = { x: e.clientX, y: e.clientY };
      if (!document.pointerLockElement) (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    };
    const aimMove = (e: PointerEvent) => {
      if (!this.enabled || (e.pointerId !== this.lookPointer && document.pointerLockElement !== canvas)) return;
      const dx = document.pointerLockElement ? e.movementX : e.clientX - this.previous.x;
      const dy = document.pointerLockElement ? e.movementY : e.clientY - this.previous.y;
      this.renderer.yaw += dx * 0.004;
      this.renderer.pitch = clamp(this.renderer.pitch + dy * 0.003, 0.18, 1.05);
      this.previous = { x: e.clientX, y: e.clientY };
    };
    const aimUp = (e: PointerEvent) => {
      if (e.pointerId === this.lookPointer) { this.lookPointer = -1; this.firing = false; }
    };
    canvas.addEventListener('pointerdown', aimDown);
    canvas.addEventListener('pointermove', aimMove);
    canvas.addEventListener('pointerup', aimUp);
    canvas.addEventListener('pointercancel', aimUp);
    window.addEventListener('mouseup', () => { this.firing = false; });
    canvas.addEventListener('wheel', e => {
      if (!this.enabled) return;
      e.preventDefault();
      this.renderer.zoom = clamp(this.renderer.zoom + e.deltaY * 0.01, 6, 19);
    }, { passive: false });
    stick.addEventListener('pointerdown', e => {
      if (!this.enabled || this.stickPointer !== -1) return;
      this.stickPointer = e.pointerId;
      stick.setPointerCapture(e.pointerId);
      updateStick(e);
      this.renderer.audio.unlock();
    });
    const updateStick = (e: PointerEvent) => {
      if (e.pointerId !== this.stickPointer) return;
      const rect = stick.getBoundingClientRect();
      const r = rect.width * 0.32;
      const x = e.clientX - rect.x - rect.width / 2;
      const y = e.clientY - rect.y - rect.height / 2;
      const factor = Math.max(1, Math.hypot(x, y) / r);
      this.joystick = { x: x / factor / r, y: -y / factor / r };
      (stick.firstElementChild as HTMLElement).style.transform = 'translate(' + x / factor + 'px, ' + y / factor + 'px)';
    };
    stick.addEventListener('pointermove', updateStick);
    const stickUp = (e: PointerEvent) => {
      if (this.stickPointer !== e.pointerId) return;
      this.stickPointer = -1;
      this.joystick = { x: 0, y: 0 };
      (stick.firstElementChild as HTMLElement).style.transform = '';
    };
    stick.addEventListener('pointerup', stickUp);
    stick.addEventListener('pointercancel', stickUp);
    fire.addEventListener('pointerdown', e => { aimDown(e); this.firing = true; fire.classList.add('pressed'); });
    fire.addEventListener('pointermove', aimMove);
    fire.addEventListener('pointerup', e => { aimUp(e); fire.classList.remove('pressed'); });
    fire.addEventListener('pointercancel', e => { aimUp(e); fire.classList.remove('pressed'); });
  }

  reset() {
    this.keys.clear();
    this.firing = false;
    this.joystick = { x: 0, y: 0 };
    this.stickPointer = -1;
    this.lookPointer = -1;
    const knob = document.querySelector<HTMLElement>('#joystick > span');
    if (knob) knob.style.transform = '';
  }

  read(): Input {
    if (!this.enabled) return { throttle: 0, steer: 0, aim: this.lastAim, fire: false };
    if (!this.freeLook && !this.keys.has('AltLeft') && !this.keys.has('AltRight')) this.lastAim = this.renderer.yaw;
    const key = (code: string) => this.keys.has(code) ? 1 : 0;
    return {
      throttle: clamp(key('KeyW') + key('ArrowUp') - key('KeyS') - key('ArrowDown') + this.joystick.y, -1, 1),
      steer: clamp(key('KeyD') + key('ArrowRight') - key('KeyA') - key('ArrowLeft') + this.joystick.x, -1, 1),
      aim: this.lastAim, fire: this.firing || this.keys.has('Space'),
    };
  }
}
