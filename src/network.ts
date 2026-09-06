import Peer, { type DataConnection, type PeerOptions } from 'peerjs';
import { PROTOCOL_VERSION, type Input, type State } from './game/types';
import { cleanLoadout, type Loadout } from './game/factory';
import { uniqueId } from './id';

// 房间地址前缀沿用旧值，握手版本不同时可以明确提示双方刷新页面。
const PREFIX = 'valley-tanks-v1-';

export class Rooms {
  role: 'solo' | 'host' | 'guest' = 'solo';

  code = '';

  readonly playerId = 'tank-player-' + uniqueId();

  onState: (state: State) => void = () => {};

  onJoin: (id: string, name: string, upgrades: Loadout) => boolean = () => false;

  onLeave: (id: string) => void = () => {};

  onInput: (id: string, input: unknown) => void = () => {};

  onReady: (id: string, ready: boolean) => void = () => {};

  onPing: (id: string, point: unknown) => void = () => {};

  onError: (message: string) => void = () => {};

  onStatus: (message: string) => void = () => {};

  lastStateAt = 0;

  private peer?: Peer;

  private connections = new Map<string, DataConnection>();

  private host?: DataConnection;

  private generation = 0;

  private options(): PeerOptions {
    const customHost = import.meta.env.VITE_PEER_HOST;
    let iceServers: RTCIceServer[] = [
      { urls: 'stun:stun.cloudflare.com:3478' },
      { urls: 'stun:stun.l.google.com:19302' },
    ];
    // 可接入自己的中继；构建到网页中的配置是公开的，生产环境应使用短期 TURN 凭证。
    if (import.meta.env.VITE_ICE_SERVERS) {
      try { iceServers = JSON.parse(import.meta.env.VITE_ICE_SERVERS); } catch { /* 保留默认直连配置。 */ }
    }
    return {
      debug: 0, secure: true, config: { iceServers },
      ...(customHost ? { host: customHost, port: Number(import.meta.env.VITE_PEER_PORT || 443), path: import.meta.env.VITE_PEER_PATH || '/' } : {}),
    };
  }

  private async open(id: string) {
    const generation = this.generation;
    const peer = new Peer(id, this.options());
    this.peer = peer;
    await new Promise<void>((resolve, reject) => {
      const timeout = window.setTimeout(() => reject(new Error('配对服务连接超时，请检查网络后重试。单人模式不受影响。')), 16000);
      const fail = (error: { type?: string }) => {
        clearTimeout(timeout);
        reject(new Error(error.type === 'unavailable-id' ? '房间号暂时被占用，请重新创建。' : '暂时无法连接配对服务，请稍后重试。'));
      };
      peer.once('error', fail);
      peer.once('open', () => {
        clearTimeout(timeout);
        peer.off('error', fail);
        if (generation !== this.generation) { reject(new Error('连接已取消')); return; }
        resolve();
      });
    });
    peer.on('error', error => {
      if (generation !== this.generation) return;
      this.onError(error.type === 'peer-unavailable' ? '没有找到这个房间，请确认房间号，并让房主保持游戏打开。' : '联机连接出现问题，请检查网络或重新加入。');
    });
    peer.on('disconnected', () => {
      if (generation !== this.generation) return;
      this.onStatus('配对服务暂时断开，已有直连可继续游戏。');
      if (!peer.destroyed) peer.reconnect();
    });
    return peer;
  }

  async create() {
    this.close();
    this.role = 'host';
    const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    this.code = Array.from(crypto.getRandomValues(new Uint8Array(6)), v => alphabet[v % alphabet.length]).join('');
    try {
      const peer = await this.open(PREFIX + this.code);
      peer.on('connection', connection => {
        connection.on('error', () => {});
        connection.on('open', () => {
          const metadata = connection.metadata as { name?: unknown; version?: number; upgrades?: unknown } | undefined;
          if (metadata?.version !== PROTOCOL_VERSION || this.connections.size >= 3 || !this.onJoin(connection.peer, typeof metadata.name === 'string' ? metadata.name.slice(0, 16) : '守卫者', cleanLoadout(metadata.upgrades))) {
            connection.send({ type: 'rejected', reason: '房间已满，或游戏版本不一致。请刷新后重试。' });
            window.setTimeout(() => connection.close(), 200);
            return;
          }
          this.connections.set(connection.peer, connection);
          connection.on('data', raw => {
            const packet = raw as { type?: string; input?: unknown; ready?: unknown; point?: unknown };
            if (!packet || typeof packet !== 'object') return;
            if (packet.type === 'input') this.onInput(connection.peer, packet.input);
            if (packet.type === 'ready' && typeof packet.ready === 'boolean') this.onReady(connection.peer, packet.ready);
            if (packet.type === 'ping') this.onPing(connection.peer, packet.point);
          });
          connection.on('close', () => {
            if (this.connections.get(connection.peer) !== connection) return;
            this.connections.delete(connection.peer);
            this.onLeave(connection.peer);
          });
        });
      });
    } catch (error) { this.close(); throw error; }
    return this.code;
  }

  async join(code: string, name: string, upgrades?: Loadout) {
    this.close();
    this.role = 'guest';
    this.code = code.trim().toUpperCase();
    if (!/^[A-Z2-9]{6}$/.test(this.code)) { this.close(); throw new Error('请输入 6 位房间号。'); }
    try {
      const peer = await this.open(this.playerId);
      // JSON 通道会拒绝超过 16,300 字节的消息；大地图改用可自动分片重组的二进制序列化。
      const connection = peer.connect(PREFIX + this.code, { reliable: true, serialization: 'binary', metadata: { name, version: PROTOCOL_VERSION, upgrades: cleanLoadout(upgrades) } });
      this.host = connection;
      await new Promise<void>((resolve, reject) => {
        const timer = window.setTimeout(() => reject(new Error('没有连上房主。请检查房间号；同一 Wi-Fi 通常更容易直连。')), 18000);
        let receivedState = false;
        connection.on('data', raw => {
          const packet = raw as { type?: string; state?: State; reason?: string };
          if (!packet || typeof packet !== 'object') return;
          if (packet.type === 'rejected') { clearTimeout(timer); reject(new Error(packet.reason || '房间拒绝了连接。')); return; }
          const state = packet.state;
          if (packet.type === 'state' && state?.version === PROTOCOL_VERSION && typeof state.matchId === 'string' && (state.mode === 'classic' || state.mode === 'defense') && ['casual', 'normal', 'challenge'].includes(state.difficulty) && ['small', 'medium', 'large'].includes(state.mapSize) && typeof state.enemyBaseDiscovered === 'boolean' && Array.isArray(state.visibleEnemies) && Array.isArray(state.explored) && Array.isArray(state.tanks) && state.tanks.length <= 20 && state.tanks.every(t => t.upgrades && t.stats && typeof t.name === 'string' && [t.score, t.stamina, t.charge, t.recoil, t.stats.kills, t.stats.assists, t.stats.defenses, t.stats.baseDamage, t.stats.teamBonus].every(Number.isFinite) && [t.boosting, t.boostLocked, t.charging].every(v => typeof v === 'boolean')) && state.campUpgrades && Array.isArray(state.scars) && Array.isArray(state.pings) && Array.isArray(state.obstacles) && Array.isArray(state.events)) {
            this.lastStateAt = performance.now();
            this.onState(state);
            if (!receivedState) { receivedState = true; clearTimeout(timer); resolve(); }
          }
        });
        connection.on('error', () => { clearTimeout(timer); reject(new Error('直连失败，请换用同一 Wi-Fi 或检查网络。')); });
        connection.on('close', () => {
          clearTimeout(timer);
          if (!receivedState) reject(new Error('房主已断开连接。'));
          else this.onError('与房主的连接已断开。可以返回大厅，使用原房间号重新加入。');
        });
      });
    } catch (error) { this.close(); throw error; }
  }

  broadcast(state: State) {
    if (this.role !== 'host') return;
    for (const connection of this.connections.values()) {
      // 网络拥塞时丢弃旧快照，下一份完整快照会补齐所有状态。
      if (connection.open && connection.dataChannel.bufferedAmount < 64000) connection.send({ type: 'state', state });
    }
  }

  sendInput(input: Input) {
    if (this.host?.open && this.host.dataChannel.bufferedAmount < 16000) this.host.send({ type: 'input', input });
  }

  ready(value: boolean) {
    if (this.host?.open) this.host.send({ type: 'ready', ready: value });
  }

  ping(point: { x: number; z: number }) {
    if (this.host?.open) this.host.send({ type: 'ping', point });
  }

  close() {
    this.generation++;
    this.connections.forEach(c => { c.removeAllListeners(); c.close(); });
    this.connections.clear();
    this.host?.removeAllListeners();
    this.host?.close();
    this.host = undefined;
    this.peer?.destroy();
    this.peer = undefined;
    this.role = 'solo';
    this.code = '';
  }
}
