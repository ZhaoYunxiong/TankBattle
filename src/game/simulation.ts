import { inRegion, mapFor, roadDistance, waterAt, type MapSize } from './maps';
import { COVER_REDUCTION, terrainCover } from './cover';
import { BOOST, CHARGE, chargeDamage, chargePower } from './abilities';
import { cleanLoadout, emptyLoadout } from './factory';
import { uniqueId } from '../id';
import { concealed, updateVisibility } from './visibility';
import { angleDiff, clamp, cleanInput, damageHandling, distance, EMPTY_INPUT, PROTOCOL_VERSION, rapidDuration, WAVES, type BattleEvent, type Difficulty, type GameMode, type Input, type Power, type Scar, type Shell, type State, type Tank } from './types';
import { blocked, createMap, findPath, seededRandom, segmentCircle } from './world';
import { groundHeight, slopeSpeed, terrainIntersection } from './terrain';
import { SHOT_HEIGHT, shotSlope, traceShot } from './combat';
import { attackSize, DIFFICULTIES, enemyLimit, reserveSize, waveSize } from './balance';

interface EnemyMemory {
  lastSeen?: { x: number; z: number };
  searchUntil: number;
  aimTarget?: string;
  readyAt: number;
  shotAt?: number;
  lockedAim: number;
}

export class Simulation {
  state: State;

  private random: () => number;

  private nextId = 1000;

  private inputs = new Map<string, { value: Input; at: number }>();

  private chargeReleases = new Set<string>();

  private chargeHeld = new Set<string>();

  private staminaRest = new Map<string, number>();

  private recoils = new Map<string, { x: number; z: number; time: number }>();

  private paths = new Map<string, { points: { x: number; z: number }[]; at: number }>();

  private bursts: { tank: string; at: number; count: number }[] = [];

  private spawnAt = 0;

  private dropAt = 20;

  private scoutAt = 0;

  private get map() { return mapFor(this.state.mapSize); }

  private attackersToSpawn = 0;

  private batchActive = false;

  private enemyKills = 0;

  private memories = new Map<string, EnemyMemory>();

  private focus = new Map<string, number>();

  private guardPosts = new Map<string, { x: number; z: number }>();

  private contributions = new Map<string, Map<string, number>>();

  private baseHitAt = -100;

  private repairAt = 30;

  constructor(seed = Math.floor(Math.random() * 0x7fffffff), mode: GameMode = 'classic', difficulty: Difficulty = 'normal', mapSize: MapSize = 'small') {
    this.random = seededRandom(seed);
    this.state = {
      version: PROTOCOL_VERSION, matchId: uniqueId(), seed, mode, difficulty, mapSize, enemyBaseDiscovered: false, visibleEnemies: [], explored: [], time: 0, phase: 'lobby', paused: false, wave: 0,
      countdown: 3, remaining: 0, reinforcementCountdown: 0, baseHp: 600, baseMaxHp: 600,
      enemyBaseHp: mode === 'classic' ? DIFFICULTIES[difficulty].baseHp : 0, enemyBaseMaxHp: mode === 'classic' ? DIFFICULTIES[difficulty].baseHp : 0,
      tanks: [], obstacles: createMap(seed, mode, mapFor(mapSize)), shells: [], drops: [], events: [], scars: [], pings: [], campUpgrades: { baseArmor: 0, repair: 0 },
    };
  }

  addPlayer(id: string, name: string, upgrades?: unknown): Tank | null {
    const existing = this.state.tanks.find(t => t.id === id);
    if (existing) { existing.connected = true; return existing; }
    const players = this.state.tanks.filter(t => t.team === 'player');
    if (players.length >= 4) return null;
    const t = this.makeTank(id, name.slice(0, 16) || '守卫者', 'player', 'standard');
    t.upgrades = cleanLoadout(upgrades);
    t.hp = t.maxHp = Math.round(120 * (1 + t.upgrades.armor * 0.08));
    t.color = [0, 1, 2, 3].find(color => !players.some(p => p.color === color)) ?? 0;
    t.x = this.map.spawn.x + (t.color - 1.5) * 2.5;
    t.z = this.map.spawn.z;
    t.angle = Math.PI;
    t.turret = Math.PI;
    t.ready = players.length === 0;
    this.state.tanks.push(t);
    this.updateCampUpgrades();
    return t;
  }

  disconnect(id: string) {
    const t = this.state.tanks.find(t => t.id === id);
    if (t) { t.connected = false; t.boosting = false; this.cancelCharge(t); this.inputs.delete(id); this.recoils.delete(id); }
    if (this.state.phase === 'lobby') this.state.tanks = this.state.tanks.filter(t => t.id !== id);
    this.updateCampUpgrades();
  }

  private updateCampUpgrades() {
    if (this.state.phase !== 'lobby') return;
    const players = this.state.tanks.filter(t => t.team === 'player' && t.connected);
    this.state.campUpgrades = { baseArmor: Math.max(0, ...players.map(t => t.upgrades.baseArmor)), repair: Math.max(0, ...players.map(t => t.upgrades.repair)) };
    this.state.baseHp = this.state.baseMaxHp = Math.round(600 * (1 + this.state.campUpgrades.baseArmor * 0.08));
  }

  ping(id: string, raw: unknown) {
    if (!raw || typeof raw !== 'object' || !this.state.tanks.some(t => t.id === id && t.team === 'player' && t.connected)) return;
    const p = raw as { x: number; z: number };
    if (![p.x, p.z].every(Number.isFinite) || Math.abs(p.x) > this.map.arena.x || Math.abs(p.z) > this.map.arena.z) return;
    const previous = this.state.pings.find(p => p.owner === id);
    if (previous && previous.until - this.state.time > 11) return;
    this.state.pings = [...this.state.pings.filter(p => p.owner !== id), { owner: id, x: p.x, z: p.z, until: this.state.time + 12 }];
  }

  input(id: string, raw: unknown) {
    const value = cleanInput(raw);
    const tank = this.state.tanks.find(t => t.id === id && t.team === 'player' && t.connected);
    if (!value || !tank) return;
    const received = this.inputs.get(id), previous = received?.value;
    // 按下和松开都即时发送；即便两次输入落在同一模拟帧，也保留一次松开发射。
    if (!value.chargeMode || (value.cancelCharge ?? 0) !== (previous?.cancelCharge ?? 0) || this.state.paused || this.state.phase !== 'battle') this.cancelCharge(tank);
    else if (previous?.chargeMode && previous.fire && !value.fire && this.state.time - received!.at < 0.4 && this.chargeHeld.has(id)) this.chargeReleases.add(id);
    if (value.chargeMode && value.fire && !this.state.paused && this.state.phase === 'battle') this.chargeHeld.add(id);
    this.inputs.set(id, { value, at: this.state.time });
  }

  private cancelCharge(tank: Tank) {
    tank.charge = 0; tank.charging = false; this.chargeReleases.delete(tank.id); this.chargeHeld.delete(tank.id);
  }

  start() {
    if (this.state.phase !== 'lobby') return;
    this.state.phase = 'intermission';
    this.state.countdown = 3;
    if (this.state.mode === 'classic') this.state.remaining = reserveSize(this.state.difficulty, this.playerCount);
    this.addDrop('heal', this.map.spawn.x - 3, this.map.spawn.z - 3);
    this.addDrop('rapid', this.map.spawn.x + 3, this.map.spawn.z - 5);
    // 沿主要路线设置少量补给停靠点，大地图赶路有收获，但不增加敌军总量。
    for (const [i, p] of this.map.roads[0].slice(1, -1).entries()) this.addDrop(i % 2 ? 'armor' : 'burst', p.x - 2, p.z + 3);
    updateVisibility(this.state);
  }

  private makeTank(id: string, name: string, team: Tank['team'], kind: Tank['kind']): Tank {
    const hp = team === 'player' ? 120 : DIFFICULTIES[this.state.difficulty].hp[kind];
    return {
      id, name, team, kind, color: 0, x: 0, z: 0, angle: 0, turret: 0, hp, maxHp: hp,
      cooldown: 0, stamina: BOOST.capacity, boosting: false, boostLocked: false, charging: false, charge: 0, recoil: 0,
      warning: 0, exposedUntil: 0, lives: 2, respawn: 0, shield: 0, buffs: { rapid: 0, burst: 0, heal: 0, armor: 0 },
      score: 0, connected: true, ready: true, upgrades: emptyLoadout(), stats: { kills: 0, assists: 0, defenses: 0, baseDamage: 0, teamBonus: 0 },
    };
  }

  private event(kind: BattleEvent['kind'], x: number, z: number, size = 1, owner?: string, power?: Power, y?: number) {
    this.state.events.push({ id: this.nextId++, kind, x, z, size, owner, ...(y === undefined ? {} : { y }), ...(power ? { power } : {}) });
    if (this.state.events.length > 80) this.state.events.shift();
  }

  private addDrop(kind: Power, x: number, z: number) {
    // 补给只放在坦克可到达的位置，避免卡在岩石或营地核心里。
    if (blocked(x, z, this.state.obstacles, 0.9, this.state.mode, this.map)) {
      for (let i = 0; i < 24; i++) {
        const nx = x + Math.cos(i * 2.4) * (2 + i * 0.35);
        const nz = z + Math.sin(i * 2.4) * (2 + i * 0.35);
        if (!blocked(nx, nz, this.state.obstacles, 0.9, this.state.mode, this.map)) { x = nx; z = nz; break; }
      }
    }
    const source = this.state.tanks.find(t => t.team === 'player' && t.hp > 0 && t.connected) ?? this.map.spawn;
    const path = findPath(source, { x, z }, this.state.obstacles, this.state.mode, this.map, true);
    const reachable = distance(source, { x, z }) < 2 || path.length > 0 && distance(path.at(-1)!, { x, z }) < 1.6;
    if (reachable && !blocked(x, z, this.state.obstacles, 0.9, this.state.mode, this.map)) {
      this.state.drops.push({ id: this.nextId++, kind, x, z, life: rapidDuration(this.state.mapSize) * 2 });
    }
  }

  private get playerCount() {
    return this.state.tanks.filter(t => t.team === 'player' && t.connected).length;
  }

  private beginBatch() {
    this.attackersToSpawn = Math.min(attackSize(this.state.difficulty, this.playerCount), this.state.remaining);
    this.batchActive = true;
  }

  private spawnEnemy() {
    const s = this.state;
    const classic = s.mode === 'classic';
    const lanes = [-5, 0, 5];
    const first = Math.floor(this.random() * lanes.length);
    const candidates = [0, 2.5].flatMap(offset => lanes.map((_, i) => ({
      x: this.map.enemySpawn.x + lanes[(first + i) % lanes.length],
      z: this.map.enemySpawn.z + offset,
    })));
    const spawn = candidates.find(p => !blocked(p.x, p.z, s.obstacles, 1, s.mode, this.map) &&
      !s.tanks.some(t => t.hp > 0 && t.connected && distance(t, p) < 2.2));
    if (!spawn) { this.spawnAt = s.time + 1; return; }
    const kind = (classic || s.wave >= 2) && this.random() < 0.25 ? 'heavy' : this.random() < 0.35 ? 'scout' : 'standard';
    const t = this.makeTank('enemy-' + this.nextId++, '敌军', 'enemy', kind);
    t.x = spawn.x;
    t.z = spawn.z;
    t.shield = 1.5;
    s.tanks.push(t);
    // 留一辆驻军，进攻部队整批消灭后才补下一批，驻军不会阻止休整。
    if (classic && !s.tanks.some(other => other.hp > 0 && this.guardPosts.has(other.id)) && s.remaining > this.attackersToSpawn) this.guardPosts.set(t.id, spawn);
    else if (classic) this.attackersToSpawn--;
    s.remaining--;
    this.attackersToSpawn = Math.min(this.attackersToSpawn, s.remaining);
    this.spawnAt = s.time + (classic ? 4 : Math.max(2.5, 5 - s.wave * 0.3));
  }

  step(dt: number) {
    if (this.state.paused || ['lobby', 'won', 'lost'].includes(this.state.phase)) {
      for (const t of this.state.tanks) { this.cancelCharge(t); t.boosting = false; }
      return;
    }
    dt = clamp(dt, 0, 0.05);
    const s = this.state;
    s.time += dt;
    if (s.phase === 'intermission') {
      s.countdown -= dt;
      if (s.countdown <= 0) {
        s.wave++;
        s.phase = 'battle';
        if (s.mode === 'defense') s.remaining = waveSize(s.difficulty, s.wave, this.playerCount);
        else this.beginBatch();
        this.spawnAt = s.time + 1;
        this.event('wave', 0, -this.map.arena.z + 12, s.wave);
      }
    }
    if (s.mode === 'classic' && s.phase === 'battle' && s.enemyBaseHp > 0) {
      if (this.batchActive && this.attackersToSpawn === 0 && !s.tanks.some(t => t.team === 'enemy' && t.hp > 0 && !this.guardPosts.has(t.id))) {
        this.batchActive = false;
        s.reinforcementCountdown = s.remaining > 0 ? DIFFICULTIES[s.difficulty].raidRest + this.map.restBonus : 0;
      } else if (s.reinforcementCountdown > 0) {
        s.reinforcementCountdown = Math.max(0, s.reinforcementCountdown - dt);
        if (s.reinforcementCountdown === 0) this.beginBatch();
      }
    }
    const reinforcements = s.remaining > 0 && (s.mode === 'defense' || s.enemyBaseHp > 0 && this.batchActive && this.attackersToSpawn > 0);
    if (s.phase === 'battle' && reinforcements && s.time >= this.spawnAt && s.tanks.filter(t => t.team === 'enemy' && t.hp > 0).length < enemyLimit(s.difficulty, this.playerCount)) this.spawnEnemy();
    this.focus.clear();
    for (const t of s.tanks) {
      if (!t.connected) continue;
      t.cooldown = Math.max(0, t.cooldown - dt);
      t.recoil *= Math.exp(-dt * 8);
      t.shield = Math.max(0, t.shield - dt);
      t.buffs.rapid = Math.max(0, t.buffs.rapid - dt);
      if (t.hp <= 0) {
        this.cancelCharge(t); t.boosting = false; this.recoils.delete(t.id);
        if (t.team === 'player' && t.respawn > 0) {
          t.respawn -= dt;
          if (t.respawn <= 0) {
            t.hp = t.maxHp;
            t.x = this.map.spawn.x + (t.color - 1.5) * 2.5;
            t.z = this.map.spawn.z;
            t.shield = 4;
            t.stamina = BOOST.capacity; t.boostLocked = false; t.recoil = 0; this.staminaRest.delete(t.id);
            t.buffs = { rapid: 0, burst: 0, heal: 0, armor: 0 };
          }
        }
        continue;
      }
      let input: Input;
      if (t.team === 'player') {
        const received = this.inputs.get(t.id);
        // 断线或触控中断时，旧输入最多保持 0.4 秒，不让坦克持续失控。
        input = received && s.time - received.at < 0.4 ? received.value : { ...EMPTY_INPUT, aim: t.turret };
        if (Math.hypot(input.moveX, input.moveZ) > 0.001) {
          // 按方向立即移动，车身快速跟随朝向，不必先原地转完再前进。
          const heading = Math.atan2(input.moveX, input.moveZ);
          t.angle += clamp(angleDiff(heading, t.angle), -dt * 8, dt * 8);
        }
      } else input = this.enemyInput(t, dt);
      t.turret += clamp(angleDiff(input.aim, t.turret), -dt * 3.4, dt * 3.4);
      const speed = (t.team === 'player' ? 6 * (1 + t.upgrades.mobility * 0.04) : t.kind === 'scout' ? 4.4 : t.kind === 'heavy' ? 2.5 : 3.3) * damageHandling(t.hp, t.maxHp).speed;
      const slope = slopeSpeed(t.x, t.z, input.moveX, input.moveZ, this.map);
      if (!input.boost) t.boostLocked = false;
      const boost = t.team === 'player' && input.boost && !t.boostLocked && t.stamina > 0 && (t.boosting || t.stamina >= BOOST.restart);
      const x = t.x, z = t.z, kick = this.recoils.get(t.id);
      if (kick) {
        const at = Math.min(1, dt / kick.time);
        this.move(t, kick.x * at, kick.z * at); kick.x *= 1 - at; kick.z *= 1 - at; kick.time -= dt;
        if (kick.time <= 0.001) this.recoils.delete(t.id);
      } else this.move(t, input.moveX * speed * slope * (waterAt(t, this.map) === 'shallow' ? 0.6 : 1) * (boost ? BOOST.speed : 1) * dt,
        input.moveZ * speed * slope * (waterAt(t, this.map) === 'shallow' ? 0.6 : 1) * (boost ? BOOST.speed : 1) * dt);
      t.boosting = !!boost && !kick && Math.hypot(t.x - x, t.z - z) > 0.001;
      if (t.boosting) {
        t.stamina = Math.max(0, t.stamina - BOOST.drain * dt); this.staminaRest.set(t.id, s.time);
        if (t.stamina <= 0.001) { t.stamina = 0; t.boostLocked = true; t.boosting = false; }
      } else if (s.time - (this.staminaRest.get(t.id) ?? -BOOST.recoveryDelay) >= BOOST.recoveryDelay) t.stamina = Math.min(BOOST.capacity, t.stamina + BOOST.recovery * dt);
      const received = this.inputs.get(t.id), fresh = !!received && s.time - received.at < 0.4;
      if (t.team === 'player' && input.chargeMode && fresh && s.phase === 'battle') {
        if (this.chargeReleases.delete(t.id)) {
          if (t.cooldown <= 0) {
            const power = chargePower(t.charge);
            this.fire(t, chargeDamage(t.charge), power);
            t.cooldown = CHARGE.cooldown * (t.buffs.rapid > 0 ? 0.7 : 1) * (1 - t.upgrades.reload * 0.04);
          }
          this.cancelCharge(t);
        } else if (input.fire && t.cooldown <= 0) { t.charging = true; t.charge = Math.min(CHARGE.seconds, t.charge + dt); }
      } else {
        this.cancelCharge(t);
        if (input.fire && t.cooldown <= 0 && s.phase === 'battle') {
          const burst = t.buffs.burst > 0;
          this.fire(t, burst ? 12 : t.team === 'player' ? 20 : 14);
          const balance = DIFFICULTIES[s.difficulty];
          t.cooldown = t.team === 'player' ? (t.buffs.rapid > 0 ? 0.7 : 1) * (1 - t.upgrades.reload * 0.04) : t.kind === 'heavy' ? balance.heavyCooldown : balance.cooldown;
          t.warning = 0;
          const memory = this.memories.get(t.id);
          if (memory) memory.shotAt = undefined;
          if (burst) { t.buffs.burst--; this.bursts.push({ tank: t.id, at: s.time + 0.12, count: 2 }); }
        }
      }
    }
    for (const b of this.bursts) {
      if (s.time < b.at || b.count <= 0) continue;
      const t = s.tanks.find(t => t.id === b.tank);
      if (t && t.hp > 0 && t.connected) this.fire(t, 12);
      b.count--;
      b.at = s.time + 0.12;
    }
    this.bursts = this.bursts.filter(b => b.count > 0);
    this.advanceShells(dt);
    if (s.time >= this.scoutAt) {
      const discovered = s.enemyBaseDiscovered;
      updateVisibility(s); this.scoutAt = s.time + 0.2;
      if (!discovered && s.enemyBaseDiscovered) for (const t of s.tanks) if (t.team === 'player' && t.connected) t.score += 100;
    }
    for (const drop of s.drops) {
      drop.life -= dt;
      for (const t of s.tanks) {
        if (t.team !== 'player' || t.hp <= 0 || !t.connected || distance(t, drop) > 1.8 || drop.life <= 0) continue;
        if (drop.kind === 'heal' && t.hp >= t.maxHp) continue;
        if (drop.kind === 'heal') t.hp = Math.min(t.maxHp, t.hp + t.maxHp * 0.35);
        else if (drop.kind === 'rapid') t.buffs.rapid = Math.min(rapidDuration(s.mapSize) * 2, t.buffs.rapid + rapidDuration(s.mapSize));
        else if (drop.kind === 'burst') t.buffs.burst = Math.min(48, t.buffs.burst + 24);
        else t.buffs.armor = Math.min(180, t.buffs.armor + 90);
        this.event('pickup', drop.x, drop.z, 1, t.id, drop.kind);
        drop.life = 0;
      }
    }
    s.drops = s.drops.filter(d => d.life > 0);
    s.pings = s.pings.filter(p => p.until > s.time);
    s.tanks = s.tanks.filter(t => t.team === 'player' || t.hp > 0);
    if (s.time >= this.dropAt && s.drops.length < 7) {
      const kinds: Power[] = ['heal', 'rapid', 'burst', 'armor'];
      const players = s.tanks.filter(t => t.team === 'player' && t.hp > 0 && t.connected);
      const nearby = players[Math.floor(this.random() * players.length)] ?? this.map.spawn;
      const angle = this.random() * Math.PI * 2;
      this.addDrop(kinds[Math.floor(this.random() * 4)], clamp(nearby.x + Math.sin(angle) * 15, -this.map.arena.x + 5, this.map.arena.x - 5), clamp(nearby.z + Math.cos(angle) * 15, -this.map.arena.z + 5, this.map.arena.z - 5));
      this.dropAt = s.time + 20;
    }
    if (s.mode === 'defense' && s.phase === 'battle' && s.remaining === 0 && !s.tanks.some(t => t.team === 'enemy')) {
      if (s.wave === WAVES) s.phase = 'won';
      else {
        s.phase = 'intermission';
        s.countdown = DIFFICULTIES[s.difficulty].waveRest + this.map.restBonus / 2;
        s.baseHp = Math.min(s.baseMaxHp, s.baseHp + 45);
        this.addDrop('heal', this.map.spawn.x - 3, this.map.spawn.z - 2);
        for (const o of s.obstacles) if (o.kind === 'wall' && o.team === 'player' && o.hp > 0) o.hp = Math.min(o.maxHp, o.hp + 20);
      }
    }
    if (s.mode === 'classic' && s.phase === 'battle' && s.enemyBaseHp <= 0) s.phase = 'won';
    if (s.baseHp <= 0 || !s.tanks.some(t => t.team === 'player' && t.connected && (t.hp > 0 || t.respawn > 0))) {
      s.phase = 'lost';
      s.baseHp = Math.max(0, s.baseHp);
    }
    if (s.time >= this.repairAt && s.time - this.baseHitAt >= 10 && s.baseHp > 0) {
      s.baseHp = Math.min(s.baseMaxHp, s.baseHp + s.campUpgrades.repair * 10);
      this.repairAt = s.time + 30;
    }
    if (s.phase === 'won' || s.phase === 'lost') {
      for (const t of s.tanks) if (t.team === 'player') {
        t.stats.teamBonus = s.phase === 'won' ? 600 + Math.round(s.baseHp / s.baseMaxHp * 200) : 0;
        t.score += t.stats.teamBonus;
      }
    }
  }

  private scar(x: number, z: number, radius: number, kind: Scar['kind'], stone = false) {
    if (Math.abs(x) > this.map.arena.x || Math.abs(z) > this.map.arena.z || waterAt({ x, z }, this.map)) return;
    const surface: Scar['surface'] = this.map.bridges.some(b => inRegion({ x, z }, b)) ? 'bridge' : stone || groundHeight(x, z, this.map) > 7 && roadDistance({ x, z }, this.map) > 3 ? 'stone' : 'earth';
    const old = this.state.scars.find(s => s.kind === kind && s.surface === surface && distance(s, { x, z }) < (kind === 'impact' ? 4 : 1.5));
    if (old) return;
    this.state.scars.push({ id: this.nextId++, x, z, radius, kind, surface, rotation: this.random() * Math.PI * 2 });
  }

  private move(t: Tank, dx: number, dz: number) {
    const free = (x: number, z: number) => !blocked(x, z, this.state.obstacles, 0.85, this.state.mode, this.map) && !this.state.tanks.some(other =>
      other.id !== t.id && other.connected && other.hp > 0 && Math.hypot(x - other.x, z - other.z) < 1.5);
    if (free(t.x + dx, t.z)) t.x += dx;
    if (free(t.x, t.z + dz)) t.z += dz;
  }

  private enemyInput(t: Tank, dt: number): Input {
    const s = this.state;
    const balance = DIFFICULTIES[s.difficulty];
    const post = this.guardPosts.get(t.id);
    let memory = this.memories.get(t.id);
    if (!memory) {
      memory = { searchUntil: 0, readyAt: 0, lockedAim: t.turret };
      this.memories.set(t.id, memory);
    }
    const visible = s.tanks.filter(p => p.team === 'player' && p.connected && p.hp > 0 && distance(t, p) < 23 &&
      (!post || distance(p, this.map.enemyBase) < 26) && !concealed(p, s) && this.canSee(t, p))
      .sort((a, b) => distance(t, a) - distance(t, b));
    // 每个玩家只有有限的交战名额，其余敌军推进或守营，避免全场集火。
    const nearby = visible.find(p => (this.focus.get(p.id) ?? 0) < balance.focusLimit);
    if (nearby) {
      this.focus.set(nearby.id, (this.focus.get(nearby.id) ?? 0) + 1);
      memory.lastSeen = { x: nearby.x, z: nearby.z };
      memory.searchUntil = s.time + 3;
    }
    // 掩体后只保留最后目击位置；不再读取隐藏玩家的当前位置。
    const searching = !nearby && memory.lastSeen && s.time < memory.searchUntil;
    const target = nearby ?? (searching ? memory.lastSeen! : post ?? this.map.base);
    const returning = !!post && !nearby && !searching;
    const obstruction = s.obstacles.filter(o => o.hp > 0 && segmentCircle(t.x, t.z, target.x, target.z, o.x, o.z, o.radius + 0.1) !== null)
      .sort((a, b) => distance(a, t) - distance(b, t))[0];
    let path = this.paths.get(t.id);
    if (!path || s.time >= path.at) {
      path = { points: findPath(t, target, s.obstacles, s.mode, this.map), at: s.time + 1.3 + this.random() * 0.4 };
      this.paths.set(t.id, path);
    }
    while (path.points.length > 1 && distance(t, path.points[0]) < 1.1) path.points.shift();
    const waypoint = path.points[0] ?? target;
    const turn = angleDiff(Math.atan2(waypoint.x - t.x, waypoint.z - t.z), t.angle);
    const firingAt = !nearby && obstruction && distance(obstruction, t) < 17 ? obstruction : target;
    const firingAim = Math.atan2(firingAt.x - t.x, firingAt.z - t.z);
    const hiddenByGround = !returning && distance(t, firingAt) < 23 && terrainIntersection(
      { x: t.x, y: groundHeight(t.x, t.z, this.map) + SHOT_HEIGHT, z: t.z },
      { x: firingAt.x, y: groundHeight(firingAt.x, firingAt.z, this.map) + 1, z: firingAt.z }, 0.08, this.map) !== null;
    const throttle = distance(t, target) > (returning ? 1.5 : hiddenByGround || searching ? 2.8 : 9) || (!returning && obstruction) ? Math.abs(turn) < 1.2 ? 1 : 0.15 : 0;
    t.angle += clamp(turn * 2, -1, 1) * dt * (t.kind === 'heavy' ? 1.3 : 1.9);
    const lineHit = traceShot(s, t.team,
      { x: t.x, y: groundHeight(t.x, t.z, this.map) + SHOT_HEIGHT, z: t.z },
      { x: firingAt.x, y: groundHeight(firingAt.x, firingAt.z, this.map) + 1, z: firingAt.z });
    const unassignedPlayer = lineHit?.target?.type === 'tank' && lineHit.target.id !== nearby?.id;
    const canFire = !unassignedPlayer && s.phase === 'battle' && !returning && !searching && !hiddenByGround && distance(t, firingAt) < 23;
    const aimTarget = nearby ? nearby.id : obstruction ? 'obstacle-' + obstruction.id : 'base';
    if (!canFire) {
      memory.aimTarget = undefined;
      memory.shotAt = undefined;
    } else if (memory.aimTarget !== aimTarget) {
      memory.aimTarget = aimTarget;
      memory.readyAt = s.time + balance.reaction[0] + this.random() * (balance.reaction[1] - balance.reaction[0]);
      memory.shotAt = undefined;
    }
    if (canFire && memory.shotAt === undefined && t.shield <= 0 && t.cooldown <= balance.warningTime &&
      s.time >= memory.readyAt - balance.warningTime && Math.abs(angleDiff(t.turret, firingAim)) < 0.12) {
      memory.shotAt = Math.max(memory.readyAt, s.time + balance.warningTime, s.time + t.cooldown);
      // 预警期间锁定这一发的方向，给玩家看到闪光后躲开的机会。
      memory.lockedAim = firingAim;
    }
    t.warning = memory.shotAt === undefined ? 0 : clamp(1 - (memory.shotAt - s.time) / balance.warningTime, 0.05, 1);
    return {
      moveX: Math.sin(t.angle) * throttle, moveZ: Math.cos(t.angle) * throttle,
      aim: memory.shotAt === undefined ? firingAim : memory.lockedAim,
      fire: canFire && memory.shotAt !== undefined && s.time >= memory.shotAt && Math.abs(angleDiff(t.turret, memory.lockedAim)) < 0.12,
    };
  }

  private canSee(t: Tank, target: Tank) {
    const hit = traceShot(this.state, t.team,
      { x: t.x, y: groundHeight(t.x, t.z, this.map) + SHOT_HEIGHT, z: t.z },
      { x: target.x, y: groundHeight(target.x, target.z, this.map) + 1, z: target.z });
    return hit?.target?.type === 'tank' && hit.target.id === target.id;
  }

  private repairDrop(killer: Tank | undefined) {
    const players = this.state.tanks.filter(t => t.team === 'player' && t.connected && t.hp > 0);
    const recipient = killer?.team === 'player' && killer.hp > 0 && killer.connected ? killer : players.sort((a, b) => a.hp / a.maxHp - b.hp / b.maxHp)[0];
    if (!recipient) return;
    // 从玩家身边沿无障碍短线放置；找不到空地就放脚下，确保维修包可达。
    for (let i = 0; i < 12; i++) {
      const angle = recipient.angle + Math.PI + i * Math.PI / 6;
      const x = recipient.x + Math.sin(angle) * 2.8;
      const z = recipient.z + Math.cos(angle) * 2.8;
      if (Array.from({ length: 8 }, (_, j) => (j + 1) / 8).every(at =>
        !blocked(recipient.x + (x - recipient.x) * at, recipient.z + (z - recipient.z) * at, this.state.obstacles, 0.85, this.state.mode, this.map))) {
        this.state.drops.push({ id: this.nextId++, kind: 'heal', x, z, life: 60 });
        return;
      }
    }
    this.state.drops.push({ id: this.nextId++, kind: 'heal', x: recipient.x, z: recipient.z, life: 60 });
  }

  private fire(t: Tank, damage: number, power?: number) {
    t.exposedUntil = this.state.time + 5;
    const spread = damageHandling(t.hp, t.maxHp).spread + (t.team === 'enemy' ? 0.035 : 0);
    const angle = t.turret + (this.random() - 0.5) * spread * 2;
    const speed = power === undefined ? 27 : 32 + power * 8;
    const slope = shotSlope(this.state, t, angle);
    // 从炮塔中心开始做连续碰撞检测，避免炮口穿过近距离墙体后凭空射到墙后。
    this.state.shells.push({
      id: this.nextId++, owner: t.id, team: t.team, x: t.x, y: groundHeight(t.x, t.z, this.map) + SHOT_HEIGHT, z: t.z,
      vx: Math.sin(angle) * speed, vy: slope * speed, vz: Math.cos(angle) * speed, damage, life: 2, ...(power === undefined ? {} : { power }),
    });
    this.event('shot', t.x, t.z, 0.6, t.id);
    if (power !== undefined) {
      Object.assign(this.state.events.at(-1)!, { charge: power });
      const recoil = CHARGE.recoil * (0.25 + power * 0.75);
      this.recoils.set(t.id, { x: -Math.sin(angle) * recoil, z: -Math.cos(angle) * recoil, time: 0.2 });
      t.recoil = 0.25 + power * 0.75;
    }
  }

  private advanceShells(dt: number) {
    for (const shell of this.state.shells) {
      shell.life -= dt;
      const next = { x: shell.x + shell.vx * dt, y: shell.y + shell.vy * dt, z: shell.z + shell.vz * dt };
      const collision = traceShot(this.state, shell.team, shell, next);
      const at = collision?.at ?? 1;
      shell.x += (next.x - shell.x) * at;
      shell.y += (next.y - shell.y) * at;
      shell.z += (next.z - shell.z) * at;
      if (collision) {
        shell.life = 0;
        if (collision.target) this.hit(shell, collision.target);
        else {
          this.event('hit', shell.x, shell.z, 0.7, shell.owner, undefined, shell.y);
          if (shell.power !== undefined) Object.assign(this.state.events.at(-1)!, { charge: shell.power });
          this.scar(shell.x, shell.z, 0.45 + (shell.power ?? 0) * 0.35, 'impact');
        }
      }
      if (Math.abs(shell.x) > this.map.arena.x + 3 || Math.abs(shell.z) > this.map.arena.z + 3) shell.life = 0;
    }
    this.state.shells = this.state.shells.filter(s => s.life > 0);
  }

  private hit(shell: Shell, target: { type: 'obstacle' | 'tank' | 'base'; id: string | number }) {
    this.event('hit', shell.x, shell.z, 0.7, shell.owner, undefined, shell.y);
    if (shell.power !== undefined) Object.assign(this.state.events.at(-1)!, { charge: shell.power });
    const shooter = this.state.tanks.find(t => t.id === shell.owner);
    if (shooter) Object.assign(this.state.events.at(-1)!, { sourceX: shooter.x, sourceZ: shooter.z });
    if (target.type === 'base') {
      const enemy = target.id === 'enemy';
      const key = enemy ? 'enemyBaseHp' : 'baseHp';
      if (this.state[key] <= 0) return;
      const damage = Math.min(this.state[key], shell.damage);
      if (enemy && shooter?.team === 'player') { shooter.stats.baseDamage += damage; shooter.score += Math.round(damage * 0.5); }
      if (!enemy) this.baseHitAt = this.state.time;
      this.state[key] = Math.max(0, this.state[key] - shell.damage);
      if (this.state[key] === 0) {
        const base = enemy ? this.map.enemyBase : this.map.base;
        this.event('destroy', base.x, base.z, 3);
        Object.assign(this.state.events.at(-1)!, { target: 'base' });
        this.scar(base.x, base.z, 3.8, 'crater');
        if (enemy) for (const t of this.state.tanks) if (t.team === 'player' && t.connected) t.score += 250;
      }
    } else if (target.type === 'obstacle') {
      const o = this.state.obstacles.find(o => o.id === target.id)!;
      Object.assign(this.state.events.at(-1)!, { material: o.kind });
      // 双方都不会误伤本方围墙，但可以炸开敌方阵地。
      if (o.kind === 'wall' && shell.team === (o.team ?? 'player')) return;
      o.hp = Math.max(0, o.hp - shell.damage);
      if (o.hp === 0) {
        if (o.kind === 'tree') o.fallenAt = this.state.time;
        this.event('destroy', o.x, o.z, o.kind === 'tree' ? 1.1 : 1.8);
        Object.assign(this.state.events.at(-1)!, { obstacle: o.id, material: o.kind });
      }
    } else {
      const t = this.state.tanks.find(t => t.id === target.id)!;
      if (t.shield > 0) return;
      const cover = terrainCover(t, this.state);
      // 环境掩护先减伤，再扣除护盾耐久；多种环境只取最强一项。
      const damage = shell.damage * (1 - (cover ? COVER_REDUCTION[cover] : 0));
      const absorbed = Math.min(t.buffs.armor, damage);
      t.buffs.armor -= absorbed;
      t.hp = Math.max(0, t.hp - (damage - absorbed));
      if (t.team === 'enemy' && shooter?.team === 'player') {
        if (!this.contributions.has(t.id)) this.contributions.set(t.id, new Map());
        this.contributions.get(t.id)!.set(shooter.id, this.state.time);
      }
      if (t.hp === 0) {
        this.event('destroy', t.x, t.z, t.kind === 'heavy' ? 3 : 2.4, t.id);
        Object.assign(this.state.events.at(-1)!, { target: 'tank' });
        this.scar(t.x, t.z, t.kind === 'heavy' ? 2.9 : 2.3, 'crater');
        const killer = shooter;
        if (t.team === 'enemy') {
          const points = t.kind === 'heavy' ? 300 : t.kind === 'scout' ? 120 : 180;
          if (killer?.team === 'player') { killer.score += points; killer.stats.kills++; }
          for (const [id, at] of this.contributions.get(t.id) ?? []) {
            const ally = this.state.tanks.find(p => p.id === id);
            if (!ally || this.state.time - at > 20) continue;
            if (ally !== killer) { ally.score += Math.round(points * 0.5); ally.stats.assists++; }
            if (distance(t, this.map.base) < 28) { ally.score += 60; ally.stats.defenses++; }
          }
        }
        this.contributions.delete(t.id);
        if (t.team === 'player' && t.lives > 0) { t.lives--; t.respawn = 5; }
        if (t.team === 'enemy' && ++this.enemyKills % 3 === 0) this.repairDrop(killer);
        else if (t.team === 'enemy' && this.random() < 0.4) {
          const kinds: Power[] = ['heal', 'rapid', 'burst', 'armor'];
          this.addDrop(kinds[Math.floor(this.random() * 4)], t.x, t.z);
        }
        this.paths.delete(t.id);
        this.guardPosts.delete(t.id);
        this.memories.delete(t.id);
      }
    }
  }
}
