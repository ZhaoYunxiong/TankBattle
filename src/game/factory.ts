export const UPGRADES = {
  armor: { name: '坦克装甲', description: '每级增加 8% 耐久', step: 0.08 },
  mobility: { name: '履带传动', description: '每级增加 4% 移动速度', step: 0.04 },
  reload: { name: '装填机构', description: '每级缩短 4% 装填时间', step: 0.04 },
  baseArmor: { name: '阵地加固', description: '每级增加 8% 营地耐久', step: 0.08 },
  repair: { name: '维修工坊', description: '脱战 10 秒后，每 30 秒修复每级 10 点营地耐久', step: 10 },
} as const;

export type Upgrade = keyof typeof UPGRADES;

export type Loadout = Record<Upgrade, number>;

export const upgradeKeys = Object.keys(UPGRADES) as Upgrade[];

export const MAX_LEVEL = 3;

export const COSTS = [150, 300, 500];

export const emptyLoadout = (): Loadout => ({ armor: 0, mobility: 0, reload: 0, baseArmor: 0, repair: 0 });

// 房主只接受有界整数，任何联机装备都经过同一套规则。
export function cleanLoadout(value: unknown): Loadout {
  const result = emptyLoadout();
  if (value && typeof value === 'object') for (const key of upgradeKeys) {
    const level = (value as Loadout)[key];
    result[key] = Number.isInteger(level) ? Math.max(0, Math.min(MAX_LEVEL, level)) : 0;
  }
  return result;
}

export function loadoutCost(loadout: Loadout) {
  return upgradeKeys.reduce((total, key) => total + COSTS.slice(0, loadout[key]).reduce((a, b) => a + b, 0), 0);
}

export const loadoutTier = (loadout: Loadout) => upgradeKeys.reduce((n, key) => n + loadout[key], 0);
