export class BattleAudio {
  enabled = true;

  private context?: AudioContext;

  private river?: GainNode;

  private engine?: GainNode;

  private motor?: OscillatorNode;

  unlock() {
    if (!this.context) {
      const AudioConstructor = globalThis.AudioContext ?? (globalThis as typeof globalThis & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      // 部分 WebKit 或内置浏览器没有音频上下文；降级为静音，不能阻断开始游戏。
      if (!AudioConstructor) { this.enabled = false; return; }
      try { this.context = new AudioConstructor(); } catch { this.enabled = false; return; }
      const ctx = this.context;
      const buffer = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
      const data = buffer.getChannelData(0);
      for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
      const source = ctx.createBufferSource(), filter = ctx.createBiquadFilter();
      this.river = ctx.createGain(); this.river.gain.value = 0;
      filter.type = 'lowpass'; filter.frequency.value = 950;
      source.buffer = buffer; source.loop = true; source.connect(filter); filter.connect(this.river); this.river.connect(ctx.destination); source.start();
      this.engine = ctx.createGain(); this.engine.gain.value = 0;
      this.motor = ctx.createOscillator(); this.motor.type = 'triangle'; this.motor.frequency.value = 42;
      this.motor.connect(this.engine); this.engine.connect(ctx.destination); this.motor.start();
    }
    void this.context.resume().catch(() => {});
  }

  ambience(speed: number, nearWater: boolean) {
    if (!this.context || this.context.state !== 'running') return;
    const at = this.context.currentTime;
    this.river?.gain.setTargetAtTime(this.enabled && nearWater ? 0.035 : 0, at, 0.25);
    this.engine?.gain.setTargetAtTime(this.enabled ? Math.min(0.035, speed * 0.006) : 0, at, 0.12);
    this.motor?.frequency.setTargetAtTime(38 + Math.min(8, speed) * 8, at, 0.12);
  }

  dispose() { void this.context?.close().catch(() => {}); }

  play(kind: 'shot' | 'hit' | 'destroy' | 'pickup' | 'wave', volume = 1, material?: string) {
    if (!this.enabled || !this.context || this.context.state !== 'running') return;
    const ctx = this.context;
    const start = ctx.currentTime;
    const gain = ctx.createGain();
    gain.connect(ctx.destination);
    const duration = kind === 'destroy' ? material === 'tank' || material === 'base' ? 0.85 : 0.4 : kind === 'pickup' ? 0.22 : 0.13;
    gain.gain.setValueAtTime(Math.max(0.001, volume * (kind === 'destroy' ? 0.15 : 0.075)), start);
    gain.gain.exponentialRampToValueAtTime(0.001, start + duration);
    if (kind === 'pickup' || kind === 'wave') {
      const oscillator = ctx.createOscillator();
      oscillator.type = 'sine';
      oscillator.frequency.setValueAtTime(kind === 'pickup' ? 660 : 330, start);
      oscillator.frequency.exponentialRampToValueAtTime(kind === 'pickup' ? 990 : 440, start + duration);
      oscillator.connect(gain);
      oscillator.start(start);
      oscillator.stop(start + duration);
    } else {
      const buffer = ctx.createBuffer(1, ctx.sampleRate * duration, ctx.sampleRate);
      const data = buffer.getChannelData(0);
      for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
      const source = ctx.createBufferSource();
      const filter = ctx.createBiquadFilter();
      filter.type = 'lowpass';
      filter.frequency.setValueAtTime(kind === 'destroy' ? material === 'tree' ? 1100 : material === 'rock' ? 380 : material === 'tank' ? 240 : 500 : kind === 'shot' ? 950 : 1400, start);
      filter.frequency.exponentialRampToValueAtTime(80, start + duration);
      source.buffer = buffer;
      source.connect(filter);
      filter.connect(gain);
      source.start(start);
      source.stop(start + duration);
    }
  }
}
