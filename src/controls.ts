import { clamp, type Input } from './game/types';
import type { BattleRenderer } from './game/renderer';
import { CAMERA } from './game/camera';

export function cameraRelativeMovement(right: number, forward: number, yaw: number) {
  const length = Math.max(1, Math.hypot(right, forward));
  // 以镜头的地面朝向为基准；摇杆的轻推幅度保留，斜向按键不会加速。
  return {
    moveX: (right * Math.cos(yaw) + forward * Math.sin(yaw)) / length,
    moveZ: (forward * Math.cos(yaw) - right * Math.sin(yaw)) / length,
  };
}

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
      // 瞄准手指在松开前保持独占，额外手指不能抢走镜头并造成视角突跳。
      if (!this.enabled || this.lookPointer !== -1) return;
      this.renderer.audio.unlock();
      this.lookPointer = e.pointerId;
      this.previous = { x: e.clientX, y: e.clientY };
      // 先捕获再申请鼠标锁定，避免锁定请求过程中再次捕获触发 InvalidStateError。
      if (!document.pointerLockElement) (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
      if (e.pointerType === 'mouse' && e.button === 0) {
        this.firing = true;
        if (!document.pointerLockElement) {
          try { void canvas.requestPointerLock()?.catch(() => {}); } catch { /* 浏览器不允许锁定时仍可拖动瞄准。 */ }
        }
      }
    };
    const aimMove = (e: PointerEvent) => {
      if (!this.enabled || (e.pointerId !== this.lookPointer && document.pointerLockElement !== canvas)) return;
      const dx = document.pointerLockElement ? e.movementX : e.clientX - this.previous.x;
      const dy = document.pointerLockElement ? e.movementY : e.clientY - this.previous.y;
      this.renderer.yaw += dx * 0.004;
      this.renderer.pitch = clamp(this.renderer.pitch + dy * 0.003, CAMERA.minPitch, CAMERA.maxPitch);
      this.previous = { x: e.clientX, y: e.clientY };
    };
    const aimUp = (e: PointerEvent) => {
      if (e.pointerId === this.lookPointer) { this.lookPointer = -1; this.firing = false; }
    };
    canvas.addEventListener('pointerdown', aimDown);
    canvas.addEventListener('pointermove', aimMove);
    canvas.addEventListener('pointerup', aimUp);
    canvas.addEventListener('pointercancel', aimUp);
    canvas.addEventListener('lostpointercapture', e => {
      // 鼠标进入指针锁定也会释放捕获，此时仍然需要保持按住开火。
      if (document.pointerLockElement !== canvas) aimUp(e);
    });
    window.addEventListener('mouseup', () => { this.firing = false; fire.classList.remove('pressed'); });
    canvas.addEventListener('wheel', e => {
      if (!this.enabled) return;
      e.preventDefault();
      if (e.ctrlKey) return;
      this.renderer.zoom = clamp(this.renderer.zoom + e.deltaY * 0.01, CAMERA.minZoom, CAMERA.maxZoom);
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
    stick.addEventListener('lostpointercapture', stickUp);
    fire.addEventListener('pointerdown', e => {
      aimDown(e);
      if (this.lookPointer === e.pointerId) { this.firing = true; fire.classList.add('pressed'); }
    });
    fire.addEventListener('pointermove', aimMove);
    const fireUp = (e: PointerEvent) => {
      if (this.lookPointer !== e.pointerId) return;
      aimUp(e);
      fire.classList.remove('pressed');
    };
    fire.addEventListener('pointerup', fireUp);
    fire.addEventListener('pointercancel', fireUp);
    fire.addEventListener('lostpointercapture', e => { if (document.pointerLockElement !== canvas) fireUp(e); });
  }

  reset() {
    this.keys.clear();
    this.firing = false;
    this.joystick = { x: 0, y: 0 };
    this.stickPointer = -1;
    this.lookPointer = -1;
    document.getElementById('fireButton')?.classList.remove('pressed');
    const knob = document.querySelector<HTMLElement>('#joystick > span');
    if (knob) knob.style.transform = '';
  }

  read(): Input {
    if (!this.enabled) return { moveX: 0, moveZ: 0, aim: this.lastAim, fire: false };
    if (!this.freeLook && !this.keys.has('AltLeft') && !this.keys.has('AltRight')) this.lastAim = this.renderer.yaw;
    const key = (code: string) => this.keys.has(code) ? 1 : 0;
    const right = clamp(key('KeyD') + key('ArrowRight') - key('KeyA') - key('ArrowLeft') + this.joystick.x, -1, 1);
    const forward = clamp(key('KeyW') + key('ArrowUp') - key('KeyS') - key('ArrowDown') + this.joystick.y, -1, 1);
    return {
      ...cameraRelativeMovement(right, forward, this.renderer.yaw),
      aim: this.lastAim, fire: this.firing || this.keys.has('Space'),
    };
  }
}
