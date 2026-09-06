import { angleDiff, type ImpactKind, type Shell, type Tank } from './types';
import { concealed } from './visibility';
import type { State } from './types';

export const TACTICS = { rearBonus: 0.25, ambushBonus: 0.15, bonusCap: 0.35, frontReduction: 0.2, ambushSeconds: 1.5, ambushSpread: 0.4, revealSeconds: 5 };

export const IMPACTS = {
  normal: { label: '命中', received: '', color: '#edc788', priority: 0 },
  armor: { label: '正面装甲减伤', received: '正面装甲减伤', color: '#b8e2eb', priority: 1 },
  weakpoint: { label: '弱点命中', received: '后部受击', color: '#ffad78', priority: 2 },
  shield: { label: '护盾吸收', received: '护盾吸收', color: '#b1e5d4', priority: 1 },
} satisfies Record<ImpactKind, { label: string; received: string; color: string; priority: number }>;

export const ambushReady = (tank: Tank, state: State) => tank.connected && concealed(tank, state) && tank.ambushCharge >= TACTICS.ambushSeconds;

// 使用撞击瞬间的车身方向和来弹速度，炮塔转动不改变装甲方位。
export function impactKind(tank: Tank, shell: Pick<Shell, 'vx' | 'vz'>): ImpactKind {
  if (Math.hypot(shell.vx, shell.vz) < 0.001) return 'normal';
  const offset = Math.abs(angleDiff(Math.atan2(-shell.vx, -shell.vz), tank.angle));
  if (offset >= Math.PI * 2 / 3 - 1e-9) return 'weakpoint';
  return tank.kind === 'heavy' && offset <= Math.PI / 3 + 1e-9 ? 'armor' : 'normal';
}

export function attackDamage(shell: Pick<Shell, 'damage' | 'ambush'>, rear = false) {
  // 伏击和弱点采用加法并封顶，蓄力与连发也经过同一伤害入口。
  return Math.max(0, shell.damage) * (1 + Math.min(TACTICS.bonusCap, (shell.ambush ? TACTICS.ambushBonus : 0) + (rear ? TACTICS.rearBonus : 0)));
}

export function tankImpact(tank: Tank, shell: Shell, coverReduction: number) {
  const impact = impactKind(tank, shell);
  const enhanced = Math.min(attackDamage(shell, impact === 'weakpoint'), Math.max(0, tank.maxHp - 1));
  return { impact, damage: enhanced * (impact === 'armor' ? 1 - TACTICS.frontReduction : 1) * (1 - coverReduction) };
}
