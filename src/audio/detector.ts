import { FFT } from './fft';

/**
 * Polyphonic piano note detector for microphone input.
 *
 * Pure DSP with no browser dependencies: feed it raw mono samples, get
 * note-on / note-off events back. It is "score-informed": pitches the lesson
 * currently expects are accepted more readily than unexpected ones.
 *
 * Pipeline: decimate to ~16 kHz -> long FFT (pitch identity) + short FFT
 * (re-strike detection) -> spectral peaks -> iterative harmonic matching with
 * partial cancellation -> per-pitch tracking.
 */

export interface DetectorEvent {
  type: 'on' | 'off';
  midi: number;
  /** Seconds since the first sample fed to the detector. */
  time: number;
  strength: number;
}

export interface DetectorOptions {
  minMidi?: number;
  maxMidi?: number;
}

const LONG = 4096;
const SHORT = 1024;
const HOP = 256;
const MAX_H = 8;
const MAX_NOTES = 6;
const HIST = 16;
/** Re-strikes are judged this many frames late, so a new note's attack is known by then. */
const LAG = 5;
/** Typical delay between the physical onset and the first frame that sees it. */
const ONSET_LATENCY = 0.05;

interface Peak {
  freq: number;
  amp: number;
}

interface Candidate {
  midi: number;
  sal: number;
  amps: number[];
  idx: number[];
  count: number;
  maxAmp: number;
  /** Share of this note's partial energy not already explained by other notes. */
  fresh: number;
}

const midiToFreq = (m: number) => 440 * Math.pow(2, (m - 69) / 12);

export class PitchDetector {
  readonly minMidi: number;
  readonly maxMidi: number;
  private readonly sr: number;
  private readonly decim: number;
  private readonly dsr: number;
  private readonly fir: Float32Array;
  private readonly firBuf: Float32Array;
  private firPos = 0;
  private decimPhase = 0;
  private inputCount = 0;

  private readonly ring = new Float32Array(LONG);
  private ringPos = 0;
  private filled = 0;
  private sinceHop = 0;

  private readonly fftL = new FFT(LONG);
  private readonly fftS = new FFT(SHORT);
  private readonly winL = hann(LONG);
  private readonly winS = hann(SHORT);
  private readonly bufL = new Float32Array(LONG);
  private readonly bufS = new Float32Array(SHORT);
  private readonly magL = new Float32Array(LONG / 2);
  private readonly magS = new Float32Array(SHORT / 2);
  private readonly sortBuf: Float32Array;

  private expected = new Set<number>();
  private readonly n: number;
  private readonly active: Uint8Array;
  private readonly hits: Uint8Array;
  private readonly misses: Uint8Array;
  private readonly firstSeen: Float64Array;
  private readonly lastOn: Float64Array;
  private readonly offTime: Float64Array;
  /** Active notes that were expected when struck (e.g. a held bass note). */
  private readonly struckExpected: Uint8Array;
  private readonly shortHist: Float32Array[];
  private readonly shortBins: number[][] = [];
  private readonly allBins: number[][] = [];
  private readonly sortS = new Float32Array(SHORT / 2);
  private histPos = 0;
  private frame = 0;

  /** RMS of the most recent analysis window, for level meters. */
  level = 0;

  constructor(sampleRate: number, opts: DetectorOptions = {}) {
    this.sr = sampleRate;
    this.minMidi = opts.minMidi ?? 24;
    this.maxMidi = opts.maxMidi ?? 96;
    this.decim = Math.max(1, Math.round(sampleRate / 16000));
    this.dsr = sampleRate / this.decim;
    this.fir = lowpass(this.decim);
    this.firBuf = new Float32Array(this.fir.length);
    this.sortBuf = new Float32Array(LONG / 2);
    this.n = this.maxMidi - this.minMidi + 1;
    this.active = new Uint8Array(this.n);
    this.hits = new Uint8Array(this.n);
    this.misses = new Uint8Array(this.n);
    this.firstSeen = new Float64Array(this.n);
    this.lastOn = new Float64Array(this.n).fill(-1);
    this.offTime = new Float64Array(this.n).fill(-10);
    this.struckExpected = new Uint8Array(this.n);
    const binHz = this.dsr / SHORT;
    for (let m = this.minMidi; m <= this.maxMidi; m++) {
      const f0 = midiToFreq(m);
      const own: number[] = [];
      const all: number[] = [];
      for (let h = 1; h <= 16; h++) {
        const f = f0 * h;
        if (f > this.dsr * 0.45) break;
        const b = Math.round(f / binHz);
        all.push(b);
        if (own.length < 6 && (f >= 600 || f0 * (h + 1) > this.dsr * 0.45)) own.push(b);
      }
      this.shortBins.push(own);
      this.allBins.push(all);
    }
    this.shortHist = Array.from({ length: HIST }, () => new Float32Array(SHORT / 2));
  }

  /** Pitches the lesson is waiting for; they are accepted more readily. */
  setExpected(midis: Iterable<number>): void {
    this.expected = new Set(midis);
  }

  activeNotes(): number[] {
    const out: number[] = [];
    for (let i = 0; i < this.n; i++) if (this.active[i]) out.push(i + this.minMidi);
    return out;
  }

  process(chunk: Float32Array): DetectorEvent[] {
    const events: DetectorEvent[] = [];
    const { fir, firBuf, decim } = this;
    const taps = fir.length;
    for (let i = 0; i < chunk.length; i++) {
      firBuf[this.firPos] = chunk[i];
      this.firPos = (this.firPos + 1) % taps;
      this.inputCount++;
      if (++this.decimPhase < decim) continue;
      this.decimPhase = 0;
      let acc = 0;
      let p = this.firPos;
      for (let t = 0; t < taps; t++) {
        acc += fir[t] * firBuf[p];
        if (++p === taps) p = 0;
      }
      this.ring[this.ringPos] = acc;
      this.ringPos = (this.ringPos + 1) % LONG;
      if (this.filled < LONG) this.filled++;
      if (++this.sinceHop >= HOP) {
        this.sinceHop = 0;
        if (this.filled >= SHORT) this.analyse(this.inputCount / this.sr, events);
      }
    }
    return events;
  }

  private analyse(now: number, events: DetectorEvent[]): void {
    const { ring, bufL, bufS, winL, winS, magL, magS } = this;
    // Unroll the ring so the newest sample is last.
    let sumSq = 0;
    for (let i = 0; i < LONG; i++) {
      const v = ring[(this.ringPos + i) % LONG];
      bufL[i] = v * winL[i];
      if (i >= LONG - SHORT) {
        bufS[i - (LONG - SHORT)] = v * winS[i - (LONG - SHORT)];
        sumSq += v * v;
      }
    }
    this.level = Math.sqrt(sumSq / SHORT);
    this.fftL.magnitudes(bufL, magL);
    this.fftS.magnitudes(bufS, magS);
    const normL = 4 / LONG;
    for (let i = 0; i < LONG / 2; i++) magL[i] *= normL;

    const peaks = this.findPeaks();
    const found = this.matchNotes(peaks);
    this.track(found, now, events);
    this.frame++;
  }

  private findPeaks(): Peak[] {
    const mag = this.magL;
    const binHz = this.dsr / LONG;
    const lo = Math.max(2, Math.floor(55 / binHz));
    const hi = Math.min(LONG / 2 - 2, Math.floor((this.dsr * 0.47) / binHz));
    const sorted = this.sortBuf.subarray(0, hi - lo);
    sorted.set(mag.subarray(lo, hi));
    sorted.sort();
    const median = sorted[sorted.length >> 1];
    const floor = Math.max(0.0006, median * 6);
    const peaks: Peak[] = [];
    for (let i = lo; i < hi; i++) {
      const m = mag[i];
      if (m < floor || m <= mag[i - 1] || m < mag[i + 1]) continue;
      // Reject window side lobes of a much louder neighbour.
      let localMax = m;
      for (let j = Math.max(lo, i - 8); j <= Math.min(hi, i + 8); j++) {
        if (mag[j] > localMax) localMax = mag[j];
      }
      if (m < localMax * 0.05) continue;
      const a = Math.log(mag[i - 1] + 1e-12);
      const b = Math.log(m);
      const c = Math.log(mag[i + 1] + 1e-12);
      const d = a - 2 * b + c;
      const off = d < 0 ? Math.max(-0.5, Math.min(0.5, (0.5 * (a - c)) / d)) : 0;
      peaks.push({ freq: (i + off) * binHz, amp: m });
    }
    return peaks;
  }

  private evaluate(midi: number, peaks: Peak[], amp: Float32Array, raw: Float32Array): Candidate | null {
    const f0 = midiToFreq(midi);
    const nyq = this.dsr * 0.47;
    const amps: number[] = [];
    const idx: number[] = [];
    let sal = 0;
    let count = 0;
    let maxAmp = 0;
    let rawSum = 0;
    let resSum = 0;
    for (let h = 1; h <= MAX_H; h++) {
      const fh = f0 * h;
      if (fh > nyq) break;
      // Piano strings are slightly stretched, so allow upper partials to sit sharp.
      const tolLo = Math.pow(2, -30 / 1200);
      const tolHi = Math.pow(2, (30 + 4 * h) / 1200);
      let best = -1;
      let bestAmp = 0;
      let k = lowerBound(peaks, fh * tolLo);
      for (; k < peaks.length && peaks[k].freq <= fh * tolHi; k++) {
        if (amp[k] > bestAmp) {
          bestAmp = amp[k];
          best = k;
        }
      }
      amps.push(bestAmp);
      idx.push(best);
      if (best >= 0) {
        count++;
        sal += Math.sqrt(bestAmp) / Math.sqrt(h);
        if (bestAmp > maxAmp) maxAmp = bestAmp;
        rawSum += raw[best];
        resSum += bestAmp;
      }
    }
    if (!count) return null;
    return { midi, sal, amps, idx, count, maxAmp, fresh: resSum / rawSum };
  }

  private valid(c: Candidate): boolean {
    const a = c.amps;
    // Mostly made of another note's overtones: not a note of its own.
    if (c.fresh < (this.expected.has(c.midi) ? 0.25 : 0.5)) return false;
    if (c.midi >= 45) {
      // The fundamental must be audible; this rejects "phantom" notes an
      // octave or more below what was actually played.
      if (a[0] < c.maxAmp * 0.04) return false;
    } else {
      // Small speakers and phone mics lose low fundamentals.
      const low = (a[0] > 0 ? 1 : 0) + (a[1] > 0 ? 1 : 0) + (a[2] > 0 ? 1 : 0);
      if (low < 2) return false;
    }
    const need = a.length <= 2 ? 1 : c.midi >= 79 ? 1 : c.midi >= 67 ? 2 : 3;
    return c.count >= Math.min(need, a.length);
  }

  /** True when the odd partials prove this pitch (not its octave) is sounding. */
  private hasOddEvidence(c: Candidate): boolean {
    const a = c.amps;
    let odd = 0;
    let even = 0;
    let oddCount = 0;
    for (let h = 0; h < a.length; h++) {
      const v = Math.sqrt(a[h]);
      if (h % 2 === 0) {
        odd += v;
        if (a[h] > 0) oddCount++;
      } else even += v;
    }
    return a[0] > 0 && oddCount >= Math.min(2, Math.ceil(a.length / 2)) && odd >= even * 0.25;
  }

  private matchNotes(peaks: Peak[]): Map<number, number> {
    const found = new Map<number, number>();
    if (!peaks.length) return found;
    const amp = new Float32Array(peaks.length);
    for (let i = 0; i < peaks.length; i++) amp[i] = peaks[i].amp;
    const raw = amp.slice();
    let top = 0;

    for (let iter = 0; iter < MAX_NOTES; iter++) {
      let best: Candidate | null = null;
      let bestLenient = false;
      for (let m = this.minMidi; m <= this.maxMidi; m++) {
        if (found.has(m)) continue;
        const c = this.evaluate(m, peaks, amp, raw);
        if (!c || !this.valid(c)) continue;
        const lenient = this.expected.has(m) || this.active[m - this.minMidi];
        const score = c.sal * (lenient ? 1.25 : 1);
        if (!best || score > best.sal * (bestLenient ? 1.25 : 1)) {
          best = c;
          bestLenient = !!lenient;
        }
      }
      if (!best) break;

      // Prefer the lowest pitch that explains the peaks: if a note an octave
      // (or twelfth, or two octaves) below has real odd partials, it is the
      // note being played and this candidate is one of its overtones.
      for (let guard = 0; guard < 3; guard++) {
        let moved = false;
        for (const down of [12, 19, 24]) {
          const m = best.midi - down;
          if (m < this.minMidi || found.has(m)) continue;
          const c = this.evaluate(m, peaks, amp, raw);
          if (c && this.valid(c) && this.hasOddEvidence(c)) {
            best = c;
            moved = true;
            break;
          }
        }
        if (!moved) break;
      }

      const i = best.midi - this.minMidi;
      const lenient = this.expected.has(best.midi) || this.active[i];
      if (iter === 0) top = best.sal;
      const rel = lenient ? 0.12 : 0.3;
      if (best.sal < top * rel) break;
      found.set(best.midi, best.sal);
      this.cancel(best, amp, peaks);
    }
    return found;
  }

  /**
   * Remove the chosen note's partials from the residual spectrum.
   *
   * Normally everything is removed, so overtones are never reported as notes.
   * The exception is score-informed: when the lesson expects this note together
   * with one that sits exactly on its overtones (an octave, a twelfth...), the
   * shared partials keep whatever exceeds a smooth estimate of this note's own
   * contribution, so the upper note can still be found.
   */
  private cancel(c: Candidate, amp: Float32Array, peaks: Peak[]): void {
    const a = c.amps;
    const n = a.length;
    const shared: number[] = [];
    if (this.expected.has(c.midi) || this.struckExpected[c.midi - this.minMidi]) {
      const lesson = new Set(this.expected);
      for (let o = 0; o < this.n; o++) if (this.struckExpected[o]) lesson.add(o + this.minMidi);
      for (const q of lesson) {
        const k = Math.pow(2, (q - c.midi) / 12);
        const r = Math.round(k);
        if (r >= 2 && r <= 6 && Math.abs(k - r) < 0.03 * r) shared.push(r);
      }
    }
    const f0 = midiToFreq(c.midi);
    const nyq = this.dsr * 0.47;
    for (let h = 1; f0 * h < nyq && h <= 40; h++) {
      const keep = shared.some((r) => h % r === 0);
      const lo = f0 * h * Math.pow(2, -30 / 1200);
      const hi = f0 * h * Math.pow(2, Math.min(90, 30 + 4 * h) / 1200);
      for (let k = lowerBound(peaks, lo); k < peaks.length && peaks[k].freq <= hi; k++) {
        if (keep && h >= n) continue; // upper partials: leave to the higher note
        if (keep && k === c.idx[h - 1]) {
          const est = Math.min(a[h - 1], 0.5 * (a[h - 2] + a[h]));
          amp[k] = Math.max(0, amp[k] - est);
        } else {
          amp[k] = 0;
        }
      }
    }
  }

  /**
   * Has this (already sounding) note been struck again?
   *
   * Looks at the note's partials in the short window over the last ~190 ms.
   * Only partials above ~600 Hz are used (lower ones cannot be separated from
   * neighbouring notes in so short a window), and partials shared with other
   * sounding notes are ignored so their attacks are not mistaken for ours.
   * A re-strike needs a dip (the key was released) followed by a jump.
   */
  private restruck(i: number, found: Map<number, number>, floor: number, now: number): boolean {
    // Other notes sounding now or until a moment ago.
    const others = new Set(found.keys());
    for (let o = 0; o < this.n; o++) {
      if (this.active[o] || now - this.offTime[o] < 0.3) others.add(o + this.minMidi);
    }
    const freeBins = (allowLesson: boolean) => {
      const free: number[] = [];
      for (const b of this.shortBins[i]) {
        let shared = false;
        for (const other of others) {
          const o = other - this.minMidi;
          if (o === i || (allowLesson && (this.expected.has(other) || this.struckExpected[o]))) continue;
          if (this.allBins[o].some((ob) => Math.abs(ob - b) <= 3)) {
            shared = true;
            break;
          }
        }
        if (!shared) free.push(b);
      }
      return free;
    };
    let free = freeBins(false);
    // No partial of its own (e.g. doubled an octave lower): judge it on the
    // partials it shares with other notes of the lesson. A held lower note
    // shows no dip in its own partials, so the re-strike is credited here.
    if (!free.length && this.expected.has(i + this.minMidi)) free = freeBins(true);
    if (!free.length) return false;
    const energy = (k: number) => {
      const mag = this.shortHist[(this.histPos - k + HIST) % HIST];
      let e = 0;
      for (const b of free) e += mag[b] * mag[b];
      return e;
    };
    const e = energy(LAG);
    if (e < free.length * floor * floor) return false;
    // A freshly struck note is never a negligible part of the sound.
    const lagMag = this.shortHist[(this.histPos - LAG + HIST) % HIST];
    let total = 0;
    for (let b = 4; b < SHORT / 2; b++) total += lagMag[b] * lagMag[b];
    if (e < total * 0.003) return false;
    let min = Infinity;
    let minAt = 0;
    for (let k = LAG + 1; k <= LAG + 5; k++) {
      const v = energy(k);
      if (v < min) {
        min = v;
        minAt = k;
      }
    }
    // Loudest moment before the dip. (A note's own attack only ever rises,
    // so it has no louder past and is not mistaken for a re-strike.)
    let recentMax = 0;
    for (let k = minAt + 1; k < HIST; k++) recentMax = Math.max(recentMax, energy(k));
    // ...and the jump must bring it back near its earlier loudness.
    //
    // The level must then hold: the click of a neighbouring key going down
    // also splashes energy into these bins, but only for a few frames.
    if (recentMax < free.length * floor * floor) return false; // it was never clearly audible
    const need = Math.max(min * 2.5, recentMax * 0.2);
    return min < recentMax * 0.4 && e > need && e >= energy(LAG + 1) && energy(0) > need && energy(1) > need;
  }

  /** Did this pitch's upper partials get clearly louder within the last ~250 ms? */
  private rising(i: number): boolean {
    const energy = (k: number) => {
      const mag = this.shortHist[(this.histPos - k + HIST) % HIST];
      let e = 0;
      for (const b of this.shortBins[i]) e += mag[b] * mag[b];
      return e;
    };
    let min = Infinity;
    for (let k = 4; k < HIST; k++) min = Math.min(min, energy(k));
    return Math.max(energy(0), energy(1)) > min * 3;
  }

  private track(found: Map<number, number>, now: number, events: DetectorEvent[]): void {
    this.shortHist[this.histPos].set(this.magS);
    this.sortS.set(this.magS);
    this.sortS.sort();
    const floor = this.sortS[SHORT / 4] * 6;
    const lagSeconds = (LAG * HOP) / this.dsr;
    for (let i = 0; i < this.n; i++) {
      const midi = i + this.minMidi;
      const sal = found.get(midi);
      // A note that faded below the others while still ringing is not a new
      // note when it flickers back: a real strike makes it suddenly louder.
      const faded = sal !== undefined && !this.active[i] && now - this.offTime[i] < 2 && !this.rising(i);
      if (sal !== undefined && !faded) {
        this.misses[i] = 0;
        if (!this.active[i]) {
          if (this.hits[i] === 0) this.firstSeen[i] = now;
          this.hits[i]++;
          // Unexpected notes wait longer: the first frames after an attack
          // are too blurred to tell a low note from its overtones.
          const need = this.expected.has(midi) ? 2 : 5;
          if (this.hits[i] >= need) {
            this.active[i] = 1;
            this.struckExpected[i] = this.expected.has(midi) ? 1 : 0;
            const t = Math.max(0, this.firstSeen[i] - ONSET_LATENCY);
            this.lastOn[i] = t;
            events.push({ type: 'on', midi, time: t, strength: sal });
          }
        } else if (now - lagSeconds - this.lastOn[i] > 0.12 && this.frame >= HIST && this.restruck(i, found, floor, now)) {
          const t = Math.max(0, now - lagSeconds - ONSET_LATENCY);
          this.lastOn[i] = t;
          events.push({ type: 'on', midi, time: t, strength: sal });
        }
      } else {
        this.hits[i] = 0;
        if (this.active[i] && ++this.misses[i] >= 5) {
          this.active[i] = 0;
          this.offTime[i] = now;
          this.struckExpected[i] = 0;
          this.misses[i] = 0;
          events.push({ type: 'off', midi, time: now, strength: 0 });
        }
      }
    }
    this.histPos = (this.histPos + 1) % HIST;
  }
}

function hann(n: number): Float32Array {
  const w = new Float32Array(n);
  for (let i = 0; i < n; i++) w[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (n - 1));
  return w;
}

function lowpass(decim: number): Float32Array {
  if (decim === 1) return new Float32Array([1]);
  const taps = 16 * decim + 1;
  const fc = 0.45 / decim;
  const h = new Float32Array(taps);
  const mid = (taps - 1) / 2;
  let sum = 0;
  for (let i = 0; i < taps; i++) {
    const x = i - mid;
    const sinc = x === 0 ? 2 * fc : Math.sin(2 * Math.PI * fc * x) / (Math.PI * x);
    h[i] = sinc * (0.54 - 0.46 * Math.cos((2 * Math.PI * i) / (taps - 1)));
    sum += h[i];
  }
  for (let i = 0; i < taps; i++) h[i] /= sum;
  return h;
}

function lowerBound(peaks: Peak[], freq: number): number {
  let lo = 0;
  let hi = peaks.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (peaks[mid].freq < freq) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}
