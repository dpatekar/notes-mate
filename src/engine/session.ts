import type { Song, SongNote } from '../music/types';

export type Mode = 'wait' | 'tempo';
export type Hands = 'R' | 'L' | 'both';
export type NoteState = 'pending' | 'hit' | 'miss';

export interface SessionOptions {
  mode: Mode;
  hands: Hands;
  /** 1 = written tempo, 0.5 = half speed. */
  speed: number;
}

export interface Step {
  beat: number;
  /** Notes the player must play. */
  notes: SongNote[];
}

export interface Results {
  total: number;
  hits: number;
  misses: number;
  wrong: number;
  /** 0..1 */
  accuracy: number;
  stars: number;
  /** Mean absolute timing error in ms (tempo mode only). */
  timing: number | null;
}

export interface SessionEvents {
  /** The step the player should play next changed (null at the end). */
  onStep?(step: Step | null): void;
  /** A note the player should not have played. */
  onWrong?(midi: number): void;
  onHit?(note: SongNote): void;
  /** Notes of the hand the player is not playing; the app may sound them. */
  onAccompany?(note: SongNote, secondsPerBeat: number): void;
  onBeat?(beat: number, downbeat: boolean): void;
  onFinish?(results: Results): void;
}

const COUNT_IN_BARS = 1;
/** How far from the written time a note may be played and still count. */
const WINDOW_SECONDS = 0.3;

/**
 * Game logic for playing one song. Free of DOM and audio: it is driven by
 * `update(now)` and `noteOn(midi, time)`, with all times in seconds on the
 * same clock.
 */
export class Session {
  readonly song: Song;
  readonly opts: SessionOptions;
  readonly steps: Step[] = [];
  readonly state = new Map<SongNote, NoteState>();
  readonly required = new Set<SongNote>();
  /** Playhead, in beats. Negative during the count-in. */
  position: number;
  finished = false;

  private readonly events: SessionEvents;
  private readonly spb: number;
  private readonly endBeat: number;
  private readonly window: number;
  private stepIndex = 0;
  private last: number | null = null;
  private accompanyIndex = 0;
  private readonly accompany: SongNote[];
  private lastBeat: number;
  private wrong = 0;
  private offsets: number[] = [];

  constructor(song: Song, opts: SessionOptions, events: SessionEvents = {}) {
    this.song = song;
    this.opts = opts;
    this.events = events;
    this.spb = 60 / (song.bpm * opts.speed);
    this.window = Math.min(WINDOW_SECONDS / this.spb, 0.45);
    this.position = opts.mode === 'tempo' ? -COUNT_IN_BARS * song.beatsPerBar : -1;
    this.lastBeat = Math.floor(this.position) - 1;

    const byBeat = new Map<number, SongNote[]>();
    for (const n of song.notes) {
      if (opts.hands === 'both' || n.hand === opts.hands) {
        this.required.add(n);
        this.state.set(n, 'pending');
        const key = Math.round(n.start * 1000);
        if (!byBeat.has(key)) byBeat.set(key, []);
        byBeat.get(key)!.push(n);
      }
    }
    for (const key of [...byBeat.keys()].sort((a, b) => a - b)) {
      this.steps.push({ beat: key / 1000, notes: byBeat.get(key)! });
    }
    this.accompany = song.notes.filter((n) => !this.required.has(n));
    this.endBeat = Math.max(...song.notes.map((n) => n.start + n.dur));
  }

  get secondsPerBeat(): number {
    return this.spb;
  }

  get currentStep(): Step | null {
    return this.steps[this.stepIndex] ?? null;
  }

  /** Pitches the player is expected to play right now (for the mic detector). */
  expectedPitches(): number[] {
    const out: number[] = [];
    if (this.opts.mode === 'wait') {
      for (const n of this.currentStep?.notes ?? []) out.push(n.midi);
    } else {
      for (let i = this.stepIndex; i < this.steps.length; i++) {
        const s = this.steps[i];
        if (s.beat > this.position + 1) break;
        for (const n of s.notes) if (this.state.get(n) === 'pending') out.push(n.midi);
      }
    }
    return out;
  }

  start(): void {
    this.events.onStep?.(this.currentStep);
  }

  update(now: number): void {
    if (this.finished) return;
    const dt = this.last === null ? 0 : Math.min(0.1, now - this.last);
    this.last = now;
    const step = this.currentStep;

    if (this.opts.mode === 'wait') {
      // Glide to the next note and wait there until it is played.
      const target = step ? step.beat : this.endBeat + 1;
      const gap = target - this.position;
      const speed = Math.max(1 / this.spb, gap * 6);
      this.position = Math.min(target, this.position + speed * dt);
    } else {
      this.position += dt / this.spb;
      while (this.stepIndex < this.steps.length) {
        const s = this.steps[this.stepIndex];
        if (this.position <= s.beat + this.window) break;
        for (const n of s.notes) if (this.state.get(n) === 'pending') this.state.set(n, 'miss');
        this.stepIndex++;
        this.events.onStep?.(this.currentStep);
      }
      const beat = Math.floor(this.position);
      if (beat > this.lastBeat && this.position < this.endBeat) {
        this.lastBeat = beat;
        const inBar = ((beat % this.song.beatsPerBar) + this.song.beatsPerBar) % this.song.beatsPerBar;
        this.events.onBeat?.(beat, inBar === 0);
      }
    }

    while (this.accompanyIndex < this.accompany.length) {
      const n = this.accompany[this.accompanyIndex];
      if (n.start > this.position) break;
      this.accompanyIndex++;
      this.events.onAccompany?.(n, this.spb);
    }

    if (this.position >= this.endBeat + (this.opts.mode === 'wait' ? 1 : 0.5)) this.finish();
  }

  /** `time` is when the key went down, on the same clock as `update`. */
  noteOn(midi: number, time: number): void {
    if (this.finished) return;
    if (this.opts.mode === 'wait') {
      const step = this.currentStep;
      const note = step?.notes.find((n) => n.midi === midi && this.state.get(n) === 'pending');
      if (!step || !note) {
        this.markWrong(midi);
        return;
      }
      this.hit(note);
      if (step.notes.every((n) => this.state.get(n) === 'hit')) {
        this.stepIndex++;
        this.events.onStep?.(this.currentStep);
      }
      return;
    }

    // Tempo mode: where was the playhead when the key went down?
    const at = this.last === null ? this.position : this.position - (this.last - time) / this.spb;
    let best: SongNote | null = null;
    let bestDist = Infinity;
    for (let i = this.stepIndex; i < this.steps.length; i++) {
      const s = this.steps[i];
      if (s.beat - at > this.window) break;
      const dist = Math.abs(s.beat - at);
      if (dist > this.window) continue;
      const n = s.notes.find((x) => x.midi === midi && this.state.get(x) === 'pending');
      if (n && dist < bestDist) {
        best = n;
        bestDist = dist;
      }
    }
    if (!best) {
      if (at >= -0.5) this.markWrong(midi);
      return;
    }
    this.offsets.push((at - best.start) * this.spb * 1000);
    this.hit(best);
  }

  results(): Results {
    let hits = 0;
    let misses = 0;
    for (const s of this.state.values()) {
      if (s === 'hit') hits++;
      else misses++;
    }
    const total = this.state.size;
    // Wrong notes cost as much as missed ones, but can never push below zero.
    const accuracy = total ? Math.max(0, hits - this.wrong * 0.5) / total : 0;
    const stars = accuracy >= 0.95 ? 3 : accuracy >= 0.8 ? 2 : accuracy >= 0.6 ? 1 : 0;
    const timing = this.offsets.length
      ? this.offsets.reduce((a, b) => a + Math.abs(b), 0) / this.offsets.length
      : null;
    return { total, hits, misses, wrong: this.wrong, accuracy, stars, timing };
  }

  private hit(note: SongNote): void {
    this.state.set(note, 'hit');
    this.events.onHit?.(note);
  }

  private markWrong(midi: number): void {
    this.wrong++;
    this.events.onWrong?.(midi);
  }

  private finish(): void {
    this.finished = true;
    this.events.onStep?.(null);
    this.events.onFinish?.(this.results());
  }
}
