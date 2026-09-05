export class BattleAudio {
  enabled = true;

  private context?: AudioContext;

  unlock() {
    if (!this.context) {
      const AudioConstructor = globalThis.AudioContext ?? (globalThis as typeof globalThis & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      // 部分 WebKit 或内置浏览器没有音频上下文；降级为静音，不能阻断开始游戏。
      if (!AudioConstructor) { this.enabled = false; return; }
      try { this.context = new AudioConstructor(); } catch { this.enabled = false; return; }
    }
    void this.context.resume().catch(() => {});
  }

  play(kind: 'shot' | 'hit' | 'destroy' | 'pickup' | 'wave', volume = 1) {
    if (!this.enabled || !this.context || this.context.state !== 'running') return;
    const ctx = this.context;
    const start = ctx.currentTime;
    const gain = ctx.createGain();
    gain.connect(ctx.destination);
    const duration = kind === 'destroy' ? 0.48 : kind === 'pickup' ? 0.22 : 0.13;
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
      filter.frequency.setValueAtTime(kind === 'destroy' ? 500 : kind === 'shot' ? 950 : 1400, start);
      filter.frequency.exponentialRampToValueAtTime(80, start + duration);
      source.buffer = buffer;
      source.connect(filter);
      filter.connect(gain);
      source.start(start);
      source.stop(start + duration);
    }
  }
}
