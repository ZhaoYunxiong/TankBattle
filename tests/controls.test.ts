import { describe, expect, it } from 'vitest';
import { cameraRelativeMovement } from '../src/controls';

describe('镜头相对移动', () => {
  it.each([
    { key: '上', right: 0, forward: 1, yaw: Math.PI, x: 0, z: -1 },
    { key: '下', right: 0, forward: -1, yaw: Math.PI, x: 0, z: 1 },
    { key: '左', right: -1, forward: 0, yaw: Math.PI, x: 1, z: 0 },
    { key: '右', right: 1, forward: 0, yaw: Math.PI, x: -1, z: 0 },
    { key: '转动镜头后向前', right: 0, forward: 1, yaw: Math.PI / 2, x: 1, z: 0 },
    { key: '转动镜头后向左', right: -1, forward: 0, yaw: Math.PI / 2, x: 0, z: 1 },
  ])('$key 与镜头的地面方向一致', ({ right, forward, yaw, x, z }) => {
    const movement = cameraRelativeMovement(right, forward, yaw);
    expect(movement.moveX).toBeCloseTo(x);
    expect(movement.moveZ).toBeCloseTo(z);
  });

  it('斜向按键不加速，轻推摇杆保留慢行幅度', () => {
    for (const yaw of [0, 0.7, Math.PI]) {
      const diagonal = cameraRelativeMovement(1, 1, yaw);
      expect(Math.hypot(diagonal.moveX, diagonal.moveZ)).toBeCloseTo(1);
      const gentle = cameraRelativeMovement(0.3, 0.4, yaw);
      expect(Math.hypot(gentle.moveX, gentle.moveZ)).toBeCloseTo(0.5);
    }
  });
});
