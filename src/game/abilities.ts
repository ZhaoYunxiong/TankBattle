import { VEHICLES, type TankKind } from './vehicles';

export const BOOST = { speed: 1.6, capacity: 100, drain: 12.5, recovery: 15, recoveryDelay: 1, restart: 20 };

export const CHARGE = { seconds: 1.6, damage: 56, cooldown: 1.35, recoil: 1.2 };

export const chargePower = (seconds: number, kind: TankKind = 'standard') => Math.max(0, Math.min(1, seconds / VEHICLES[kind].chargeSeconds));

export const chargeDamage = (seconds: number, kind: TankKind = 'standard') => VEHICLES[kind].damage + Math.round((VEHICLES[kind].chargeDamage - VEHICLES[kind].damage) * chargePower(seconds, kind));
