/** Synthetic piano-like audio for detector tests. */

export interface ToneNote {
  midi: number;
  start: number;
  /** Key held for this long, then damped. */
  dur: number;
  gain?: number;
}

function rng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

export function render(
  notes: ToneNote[],
  seconds: number,
  sampleRate: number,
  noise = 0.002,
): Float32Array {
  const out = new Float32Array(Math.round(seconds * sampleRate));
  const rand = rng(12345);
  for (let i = 0; i < out.length; i++) out[i] = (rand() * 2 - 1) * noise;
  for (const n of notes) {
    const f0 = 440 * Math.pow(2, (n.midi - 69) / 12);
    const r = rng(n.midi * 7919);
    const B = 0.0002 + 0.0006 * Math.max(0, (n.midi - 60) / 48);
    const gain = n.gain ?? 0.2;
    const s0 = Math.round(n.start * sampleRate);
    const len = Math.min(out.length - s0, Math.round((n.dur + 0.25) * sampleRate));
    for (let h = 1; h <= 12; h++) {
      const fh = f0 * h * Math.sqrt(1 + B * h * h);
      if (fh > sampleRate * 0.45) break;
      // Uneven partial strengths, like a real instrument.
      let a = (gain / Math.pow(h, 1.1)) * (0.4 + 1.2 * r());
      // Low notes on small speakers have a weak fundamental.
      if (h === 1 && n.midi < 48) a *= 0.25;
      const decay = (1.2 + 0.5 * h) * (1 + (n.midi - 60) / 40);
      const phase = r() * Math.PI * 2;
      const w = (2 * Math.PI * fh) / sampleRate;
      for (let i = 0; i < len; i++) {
        const t = i / sampleRate;
        let env = Math.min(1, t / 0.004) * Math.exp(-decay * t);
        if (t > n.dur) env *= Math.exp(-(t - n.dur) / 0.03);
        out[s0 + i] += a * env * Math.sin(w * i + phase);
      }
    }
  }
  return out;
}
