import { angleDiff, ARENA, BASE, ENEMY_BASE, PLAYER_SPAWN_Z, clamp, cleanInput, damageHandling, distance, EMPTY_INPUT, PROTOCOL_VERSION, WAVES, type BattleEvent, type GameMode, type Input, type Power, type Shell, type State, type Tank } from './types';
import { blocked, createMap, findPath, seededRandom, segmentCircle } from './world';

export class Simulation {
  state: State;

  private random: () => number;

  private nextId = 1000;

  private inputs = new Map<string, { value: Input; at: number }>();

  private paths = new Map<string, { points: { x: number; z: number }[]; at: number }>();

  private bursts: { tank: string; at: number; count: number }[] = [];

  private spawnAt = 0;

  private dropAt = 20;

  private spawned = 0;

  private guardPosts = new Map<string, { x: number; z: number }>();

  constructor(seed = Math.floor(Math.random() * 0x7fffffff), mode: GameMode = 'classic') {
    this.random = seededRandom(seed);
    this.state = {
      version: PROTOCOL_VERSION, seed, mode, time: 0, phase: 'lobby', paused: false, wave: 0,
      countdown: 3, remaining: 0, baseHp: 600, baseMaxHp: 600,
      enemyBaseHp: mode === 'classic' ? 600 : 0, enemyBaseMaxHp: mode === 'classic' ? 600 : 0,
      tanks: [], obstacles: createMap(seed, mode), shells: [], drops: [], events: [],
    };
  }

  addPlayer(id: string, name: string): Tank | null {
    const existing = this.state.tanks.find(t => t.id === id);
    if (existing) { existing.connected = true; return existing; }
    const players = this.state.tanks.filter(t => t.team === 'player');
    if (players.length >= 4) return null;
    const t = this.makeTank(id, name.slice(0, 16) || '守卫者', 'player', 'standard');
    t.color = [0, 1, 2, 3].find(color => !players.some(p => p.color === color)) ?? 0;
    t.x = (t.color - 1.5) * 2.5;
    t.z = PLAYER_SPAWN_Z;
    t.angle = Math.PI;
    t.turret = Math.PI;
    t.ready = players.length === 0;
    this.state.tanks.push(t);
    return t;
  }

  disconnect(id: string) {
    const t = this.state.tanks.find(t => t.id === id);
    if (t) { t.connected = false; this.inputs.delete(id); }
    if (this.state.phase === 'lobby') this.state.tanks = this.state.tanks.filter(t => t.id !== id);
  }

  input(id: string, raw: unknown) {
    const value = cleanInput(raw);
    if (value) this.inputs.set(id, { value, at: this.state.time });
  }

  start() {
    if (this.state.phase !== 'lobby') return;
    this.state.phase = 'intermission';
    this.state.countdown = 3;
    this.addDrop('heal', -3, PLAYER_SPAWN_Z - 3);
    this.addDrop('rapid', 3, PLAYER_SPAWN_Z - 5);
  }

  private makeTank(id: string, name: string, team: Tank['team'], kind: Tank['kind']): Tank {
    const hp = team === 'player' ? 120 : kind === 'scout' ? 80 : kind === 'heavy' ? 180 : 120;
    return {
      id, name, team, kind, color: 0, x: 0, z: 0, angle: 0, turret: 0, hp, maxHp: hp,
      cooldown: 0, lives: 2, respawn: 0, shield: 0, buffs: { rapid: 0, burst: 0, heal: 0, armor: 0 },
      score: 0, connected: true, ready: true,
    };
  }

  private event(kind: BattleEvent['kind'], x: number, z: number, size = 1, owner?: string, power?: Power) {
    this.state.events.push({ id: this.nextId++, kind, x, z, size, owner, ...(power ? { power } : {}) });
    if (this.state.events.length > 80) this.state.events.shift();
  }

  private addDrop(kind: Power, x: number, z: number) {
    // 补给只放在坦克可到达的位置，避免卡在岩石或营地核心里。
    if (blocked(x, z, this.state.obstacles, 0.9, this.state.mode)) {
      for (let i = 0; i < 24; i++) {
        const nx = x + Math.cos(i * 2.4) * (2 + i * 0.35);
        const nz = z + Math.sin(i * 2.4) * (2 + i * 0.35);
        if (!blocked(nx, nz, this.state.obstacles, 0.9, this.state.mode)) { x = nx; z = nz; break; }
      }
    }
    if (!blocked(x, z, this.state.obstacles, 0.9, this.state.mode)) {
      this.state.drops.push({ id: this.nextId++, kind, x, z, life: 60 });
    }
  }

  private spawnEnemy() {
    const s = this.state;
    const classic = s.mode === 'classic';
    const lanes = classic ? [-6, 0, 6] : [-25, 0, 25];
    const first = Math.floor(this.random() * lanes.length);
    const candidates = [0, 2.5].flatMap(offset => lanes.map((_, i) => ({
      x: lanes[(first + i) % lanes.length],
      z: classic ? ENEMY_BASE.z + 9 + offset : -ARENA.z + 4 + offset,
    })));
    const spawn = candidates.find(p => !blocked(p.x, p.z, s.obstacles, 1, s.mode) &&
      !s.tanks.some(t => t.hp > 0 && t.connected && distance(t, p) < 2.2));
    if (!spawn) { this.spawnAt = s.time + 1; return; }
    const kind = (classic || s.wave >= 2) && this.random() < 0.25 ? 'heavy' : this.random() < 0.35 ? 'scout' : 'standard';
    const t = this.makeTank('enemy-' + this.nextId++, '敌军', 'enemy', kind);
    t.x = spawn.x;
    t.z = spawn.z;
    t.shield = 1.5;
    s.tanks.push(t);
    // 经典模式保留驻守部队；其余敌军出击，阵地被攻破后停止增援。
    if (classic && this.spawned % 3 === 0) this.guardPosts.set(t.id, spawn);
    this.spawned++;
    if (!classic) s.remaining--;
    const players = s.tanks.filter(t => t.team === 'player' && t.connected).length;
    this.spawnAt = s.time + (classic ? Math.max(3.5, 6.5 - (players - 1) * 0.7) : Math.max(2.2, 4.8 - s.wave * 0.35));
  }

  step(dt: number) {
    if (this.state.paused || ['lobby', 'won', 'lost'].includes(this.state.phase)) return;
    dt = clamp(dt, 0, 0.05);
    const s = this.state;
    s.time += dt;
    if (s.phase === 'intermission') {
      s.countdown -= dt;
      if (s.countdown <= 0) {
        s.wave++;
        s.phase = 'battle';
        const count = s.tanks.filter(t => t.team === 'player' && t.connected).length;
        s.remaining = s.mode === 'defense' ? 3 + s.wave * 2 + (count - 1) * (2 + s.wave) : 0;
        this.spawnAt = s.time + 1;
        this.event('wave', 0, -ARENA.z + 12, s.wave);
      }
    }
    const reinforcements = s.mode === 'classic' ? s.enemyBaseHp > 0 : s.remaining > 0;
    const enemyLimit = s.mode === 'classic' ? Math.min(10, 4 + s.tanks.filter(t => t.team === 'player' && t.connected).length * 2) : 10;
    if (s.phase === 'battle' && reinforcements && s.time >= this.spawnAt && s.tanks.filter(t => t.team === 'enemy' && t.hp > 0).length < enemyLimit) this.spawnEnemy();
    for (const t of s.tanks) {
      if (!t.connected) continue;
      t.cooldown = Math.max(0, t.cooldown - dt);
      t.shield = Math.max(0, t.shield - dt);
      for (const key of Object.keys(t.buffs) as Power[]) t.buffs[key] = Math.max(0, t.buffs[key] - dt);
      if (t.hp <= 0) {
        if (t.team === 'player' && t.respawn > 0) {
          t.respawn -= dt;
          if (t.respawn <= 0) {
            t.hp = t.maxHp;
            t.x = (t.color - 1.5) * 2.5;
            t.z = PLAYER_SPAWN_Z;
            t.shield = 4;
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
      const speed = (t.team === 'player' ? 6 : t.kind === 'scout' ? 4.4 : t.kind === 'heavy' ? 2.5 : 3.3) * damageHandling(t.hp, t.maxHp).speed;
      this.move(t, input.moveX * speed * dt, input.moveZ * speed * dt);
      if (input.fire && t.cooldown <= 0 && s.phase === 'battle') {
        const burst = t.buffs.burst > 0;
        this.fire(t, burst ? 12 : t.team === 'player' ? 20 : 14);
        t.cooldown = t.team === 'player' ? t.buffs.rapid > 0 ? 0.7 : 1 : t.kind === 'heavy' ? 2 : 2.5;
        if (burst) this.bursts.push({ tank: t.id, at: s.time + 0.12, count: 2 });
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
    for (const drop of s.drops) {
      drop.life -= dt;
      for (const t of s.tanks) {
        if (t.team !== 'player' || t.hp <= 0 || !t.connected || distance(t, drop) > 1.8 || drop.life <= 0) continue;
        if (drop.kind === 'heal' && t.hp >= t.maxHp) continue;
        if (drop.kind === 'heal') t.hp = Math.min(t.maxHp, t.hp + t.maxHp * 0.35);
        else t.buffs[drop.kind] = drop.kind === 'burst' ? 10 : 12;
        this.event('pickup', drop.x, drop.z, 1, t.id, drop.kind);
        drop.life = 0;
      }
    }
    s.drops = s.drops.filter(d => d.life > 0);
    s.tanks = s.tanks.filter(t => t.team === 'player' || t.hp > 0);
    if (s.time >= this.dropAt && s.drops.length < 7) {
      const kinds: Power[] = ['heal', 'rapid', 'burst', 'armor'];
      this.addDrop(kinds[Math.floor(this.random() * 4)], (this.random() - 0.5) * (ARENA.x * 2 - 18), (this.random() - 0.5) * (ARENA.z * 2 - 24));
      this.dropAt = s.time + 20;
    }
    if (s.mode === 'defense' && s.phase === 'battle' && s.remaining === 0 && !s.tanks.some(t => t.team === 'enemy')) {
      if (s.wave === WAVES) s.phase = 'won';
      else {
        s.phase = 'intermission';
        s.countdown = 9;
        s.baseHp = Math.min(s.baseMaxHp, s.baseHp + 45);
        this.addDrop('heal', -3, PLAYER_SPAWN_Z - 2);
        for (const o of s.obstacles) if (o.kind === 'wall' && o.team === 'player' && o.hp > 0) o.hp = Math.min(o.maxHp, o.hp + 20);
      }
    }
    if (s.mode === 'classic' && s.phase === 'battle' && s.enemyBaseHp <= 0) s.phase = 'won';
    if (s.baseHp <= 0 || !s.tanks.some(t => t.team === 'player' && t.connected && (t.hp > 0 || t.respawn > 0))) {
      s.phase = 'lost';
      s.baseHp = Math.max(0, s.baseHp);
    }
  }

  private move(t: Tank, dx: number, dz: number) {
    const free = (x: number, z: number) => !blocked(x, z, this.state.obstacles, 0.85, this.state.mode) && !this.state.tanks.some(other =>
      other.id !== t.id && other.connected && other.hp > 0 && Math.hypot(x - other.x, z - other.z) < 1.5);
    if (free(t.x + dx, t.z)) t.x += dx;
    if (free(t.x, t.z + dz)) t.z += dz;
  }

  private enemyInput(t: Tank, dt: number): Input {
    const players = this.state.tanks.filter(p => p.team === 'player' && p.connected && p.hp > 0);
    const nearby = players.sort((a, b) => distance(a, t) - distance(b, t))[0];
    const post = this.guardPosts.get(t.id);
    const intruder = nearby && distance(nearby, ENEMY_BASE) < 26 ? nearby : undefined;
    const target = post ? intruder ?? post : nearby && distance(t, nearby) < (t.kind === 'scout' ? 10 : 20) ? nearby : BASE;
    const returning = !!post && !intruder;
    const aim = Math.atan2(target.x - t.x, target.z - t.z);
    const obstruction = this.state.obstacles.filter(o => o.hp > 0 && segmentCircle(t.x, t.z, target.x, target.z, o.x, o.z, o.radius + 0.1) !== null)
      .sort((a, b) => distance(a, t) - distance(b, t))[0];
    let path = this.paths.get(t.id);
    if (!path || this.state.time >= path.at) {
      path = { points: findPath(t, target, this.state.obstacles, this.state.mode), at: this.state.time + 1.3 + this.random() * 0.4 };
      this.paths.set(t.id, path);
    }
    while (path.points.length > 1 && distance(t, path.points[0]) < 1.1) path.points.shift();
    const waypoint = path.points[0] ?? target;
    const turn = angleDiff(Math.atan2(waypoint.x - t.x, waypoint.z - t.z), t.angle);
    const firingAt = obstruction && distance(obstruction, t) < 17 ? obstruction : target;
    const firingAim = Math.atan2(firingAt.x - t.x, firingAt.z - t.z);
    const throttle = distance(t, target) > (returning ? 1.5 : 9) || (!returning && obstruction) ? Math.abs(turn) < 1.2 ? 1 : 0.15 : 0;
    // 敌军保留沿寻路路线转向的驾驶方式，玩家方向控制不改变其行为。
    t.angle += clamp(turn * 2, -1, 1) * dt * (t.kind === 'heavy' ? 1.3 : 1.9);
    return {
      moveX: Math.sin(t.angle) * throttle, moveZ: Math.cos(t.angle) * throttle, aim: firingAim,
      fire: !returning && distance(t, firingAt) < 23 && Math.abs(angleDiff(t.turret, obstruction ? firingAim : aim)) < 0.12,
    };
  }

  private fire(t: Tank, damage: number) {
    const spread = damageHandling(t.hp, t.maxHp).spread + (t.team === 'enemy' ? 0.035 : 0);
    const angle = t.turret + (this.random() - 0.5) * spread * 2;
    const speed = 27;
    // 从炮塔中心开始做连续碰撞检测，避免炮口穿过近距离墙体后凭空射到墙后。
    this.state.shells.push({
      id: this.nextId++, owner: t.id, team: t.team, x: t.x, z: t.z,
      vx: Math.sin(angle) * speed, vz: Math.cos(angle) * speed, damage, life: 2,
    });
    this.event('shot', t.x, t.z, 0.6, t.id);
  }

  private advanceShells(dt: number) {
    for (const shell of this.state.shells) {
      shell.life -= dt;
      const nx = shell.x + shell.vx * dt;
      const nz = shell.z + shell.vz * dt;
      let nearest = Infinity;
      let hit: { type: 'obstacle' | 'tank' | 'base'; id: string | number } | null = null;
      const check = (x: number, z: number, radius: number, candidate: typeof hit) => {
        const at = segmentCircle(shell.x, shell.z, nx, nz, x, z, radius);
        if (at !== null && at < nearest) { nearest = at; hit = candidate; }
      };
      for (const o of this.state.obstacles) if (o.hp > 0) check(o.x, o.z, o.radius, { type: 'obstacle', id: o.id });
      for (const t of this.state.tanks) {
        if (t.hp > 0 && t.connected && t.team !== shell.team) check(t.x, t.z, 0.95, { type: 'tank', id: t.id });
      }
      if (shell.team === 'enemy' && this.state.baseHp > 0) check(BASE.x, BASE.z, BASE.radius, { type: 'base', id: 'player' });
      if (shell.team === 'player' && this.state.mode === 'classic' && this.state.enemyBaseHp > 0) check(ENEMY_BASE.x, ENEMY_BASE.z, ENEMY_BASE.radius, { type: 'base', id: 'enemy' });
      const collision = hit as { type: 'obstacle' | 'tank' | 'base'; id: string | number } | null;
      if (collision) {
        shell.x += (nx - shell.x) * nearest;
        shell.z += (nz - shell.z) * nearest;
        shell.life = 0;
        this.hit(shell, collision);
      } else { shell.x = nx; shell.z = nz; }
      if (Math.abs(shell.x) > ARENA.x + 3 || Math.abs(shell.z) > ARENA.z + 3) shell.life = 0;
    }
    this.state.shells = this.state.shells.filter(s => s.life > 0);
  }

  private hit(shell: Shell, target: { type: 'obstacle' | 'tank' | 'base'; id: string | number }) {
    this.event('hit', shell.x, shell.z, 0.7, shell.owner);
    if (target.type === 'base') {
      const enemy = target.id === 'enemy';
      const key = enemy ? 'enemyBaseHp' : 'baseHp';
      this.state[key] = Math.max(0, this.state[key] - shell.damage);
      if (this.state[key] === 0) {
        const base = enemy ? ENEMY_BASE : BASE;
        this.event('destroy', base.x, base.z, 3);
        const killer = this.state.tanks.find(t => t.id === shell.owner);
        if (enemy && killer) killer.score += 1000;
      }
    } else if (target.type === 'obstacle') {
      const o = this.state.obstacles.find(o => o.id === target.id)!;
      // 双方都不会误伤本方围墙，但可以炸开敌方阵地。
      if (o.kind === 'wall' && shell.team === (o.team ?? 'player')) return;
      o.hp = Math.max(0, o.hp - shell.damage);
      if (o.hp === 0) this.event('destroy', o.x, o.z, o.kind === 'tree' ? 1.1 : 1.8);
    } else {
      const t = this.state.tanks.find(t => t.id === target.id)!;
      if (t.shield > 0) return;
      t.hp = Math.max(0, t.hp - shell.damage * (t.buffs.armor > 0 ? 0.7 : 1));
      if (t.hp === 0) {
        this.event('destroy', t.x, t.z, 2.4, t.id);
        const killer = this.state.tanks.find(t => t.id === shell.owner);
        if (killer) killer.score += t.kind === 'heavy' ? 300 : t.kind === 'scout' ? 120 : 180;
        if (t.team === 'player' && t.lives > 0) { t.lives--; t.respawn = 5; }
        if (t.team === 'enemy' && this.random() < 0.4) {
          const kinds: Power[] = ['heal', 'rapid', 'burst', 'armor'];
          this.addDrop(kinds[Math.floor(this.random() * 4)], t.x, t.z);
        }
        this.paths.delete(t.id);
        this.guardPosts.delete(t.id);
      }
    }
  }
}
