/** Small built-in piano-ish synth for on-screen keys, accompaniment and the metronome. */
export class Synth {
  private ctx: AudioContext | null = null;
  private out: GainNode | null = null;

  /** Must first be called from a user gesture (browser autoplay rules). */
  resume(): AudioContext {
    if (!this.ctx) {
      this.ctx = new AudioContext({ latencyHint: 'interactive' });
      this.out = this.ctx.createGain();
      this.out.gain.value = 0.8;
      this.out.connect(this.ctx.destination);
    }
    if (this.ctx.state === 'suspended') void this.ctx.resume();
    return this.ctx;
  }

  note(midi: number, seconds: number, gain = 0.22): void {
    const ctx = this.resume();
    const t = ctx.currentTime;
    const f = 440 * Math.pow(2, (midi - 69) / 12);
    const env = ctx.createGain();
    const hold = Math.max(0.15, seconds);
    env.gain.setValueAtTime(0, t);
    env.gain.linearRampToValueAtTime(gain, t + 0.006);
    env.gain.exponentialRampToValueAtTime(gain * 0.35, t + hold);
    env.gain.exponentialRampToValueAtTime(0.0001, t + hold + 0.25);
    env.connect(this.out!);
    for (const [mult, type, level] of [[1, 'triangle', 1], [2, 'sine', 0.35], [3, 'sine', 0.12]] as const) {
      const osc = ctx.createOscillator();
      const g = ctx.createGain();
      osc.type = type;
      osc.frequency.value = f * mult;
      g.gain.value = level;
      osc.connect(g).connect(env);
      osc.start(t);
      osc.stop(t + hold + 0.3);
    }
  }

  click(accent: boolean): void {
    const ctx = this.resume();
    const t = ctx.currentTime;
    const osc = ctx.createOscillator();
    const env = ctx.createGain();
    osc.type = 'square';
    osc.frequency.value = accent ? 1760 : 1320;
    env.gain.setValueAtTime(accent ? 0.12 : 0.07, t);
    env.gain.exponentialRampToValueAtTime(0.0001, t + 0.03);
    osc.connect(env).connect(this.out!);
    osc.start(t);
    osc.stop(t + 0.04);
  }
}
