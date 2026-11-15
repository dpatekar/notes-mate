import { PitchDetector } from '../audio/detector';

export type InputKind = 'midi' | 'mic' | 'touch';

export interface InputStatus {
  kind: InputKind;
  /** MIDI device names currently connected. */
  midiDevices: string[];
  midiSupported: boolean;
  micActive: boolean;
  error: string | null;
}

type NoteListener = (midi: number, time: number) => void;

const CAPTURE_WORKLET = `
class Capture extends AudioWorkletProcessor {
  constructor() { super(); this.buf = new Float32Array(1024); this.n = 0; }
  process(inputs) {
    const ch = inputs[0] && inputs[0][0];
    if (ch) {
      for (let i = 0; i < ch.length; i++) {
        this.buf[this.n++] = ch[i];
        if (this.n === this.buf.length) { this.port.postMessage(this.buf.slice()); this.n = 0; }
      }
    }
    return true;
  }
}
registerProcessor('capture', Capture);
`;

/** Extra delay of the microphone hardware path, in seconds. */
const MIC_HARDWARE_LATENCY = 0.03;

/**
 * One place that turns MIDI keyboards, the microphone and on-screen keys into
 * note events. Times are seconds on the `performance.now()` clock.
 */
export class InputHub {
  private kind: InputKind = 'touch';
  private readonly onListeners = new Set<NoteListener>();
  private readonly offListeners = new Set<(midi: number) => void>();
  private readonly statusListeners = new Set<(s: InputStatus) => void>();
  private midi: MIDIAccess | null = null;
  private error: string | null = null;

  private micCtx: AudioContext | null = null;
  private micStream: MediaStream | null = null;
  private detector: PitchDetector | null = null;
  private clockOffset = Infinity;
  private expected: number[] = [];

  readonly midiSupported = typeof navigator !== 'undefined' && 'requestMIDIAccess' in navigator;

  get status(): InputStatus {
    return {
      kind: this.kind,
      midiDevices: this.midiDevices(),
      midiSupported: this.midiSupported,
      micActive: !!this.detector,
      error: this.error,
    };
  }

  /** Microphone level 0..1 and the notes currently heard, for the setup screen. */
  micMonitor(): { level: number; notes: number[] } {
    return { level: this.detector?.level ?? 0, notes: this.detector?.activeNotes() ?? [] };
  }

  onNote(fn: NoteListener): () => void {
    this.onListeners.add(fn);
    return () => this.onListeners.delete(fn);
  }

  onNoteOff(fn: (midi: number) => void): () => void {
    this.offListeners.add(fn);
    return () => this.offListeners.delete(fn);
  }

  onStatus(fn: (s: InputStatus) => void): () => void {
    this.statusListeners.add(fn);
    return () => this.statusListeners.delete(fn);
  }

  /** Tell the microphone detector which pitches the lesson is waiting for. */
  setExpected(midis: number[]): void {
    if (midis.length === this.expected.length && midis.every((m, i) => m === this.expected[i])) return;
    this.expected = midis;
    this.detector?.setExpected(midis);
  }

  /** On-screen key pressed. */
  touch(midi: number, down: boolean): void {
    if (down) this.emitOn(midi, performance.now() / 1000);
    else this.emitOff(midi);
  }

  /** Look for MIDI keyboards; switches to MIDI automatically when one is found. */
  async connectMidi(): Promise<boolean> {
    if (!this.midiSupported) return false;
    try {
      if (!this.midi) {
        this.midi = await navigator.requestMIDIAccess();
        this.midi.onstatechange = () => {
          this.bindMidi();
          if (this.midiDevices().length && this.kind === 'touch') this.kind = 'midi';
          this.notify();
        };
      }
      this.bindMidi();
      return this.midiDevices().length > 0;
    } catch {
      this.error = 'This browser blocked access to MIDI devices.';
      this.notify();
      return false;
    }
  }

  async use(kind: InputKind): Promise<void> {
    this.error = null;
    if (kind !== 'mic') this.stopMic();
    if (kind === 'midi') await this.connectMidi();
    if (kind === 'mic') {
      try {
        await this.startMic();
      } catch {
        this.error = 'Could not use the microphone. Check the permission and try again.';
        this.kind = 'touch';
        this.notify();
        return;
      }
    }
    this.kind = kind;
    try {
      localStorage.setItem('input', kind);
    } catch {
      /* storage unavailable */
    }
    this.notify();
  }

  private midiDevices(): string[] {
    const names: string[] = [];
    this.midi?.inputs.forEach((input) => {
      if (input.state === 'connected') names.push(input.name ?? 'MIDI keyboard');
    });
    return names;
  }

  private bindMidi(): void {
    this.midi?.inputs.forEach((input) => {
      input.onmidimessage = (ev) => {
        if (this.kind !== 'midi' || !ev.data) return;
        const [status, note, velocity] = ev.data;
        const type = status & 0xf0;
        if (type === 0x90 && velocity > 0) this.emitOn(note, ev.timeStamp / 1000);
        else if (type === 0x80 || type === 0x90) this.emitOff(note);
      };
    });
  }

  private async startMic(): Promise<void> {
    if (this.detector) return;
    // Phone "voice" processing destroys piano sound, so switch all of it off.
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false, channelCount: 1 },
    });
    const ctx = new AudioContext({ latencyHint: 'interactive' });
    const url = URL.createObjectURL(new Blob([CAPTURE_WORKLET], { type: 'application/javascript' }));
    await ctx.audioWorklet.addModule(url);
    URL.revokeObjectURL(url);
    const node = new AudioWorkletNode(ctx, 'capture', { numberOfInputs: 1, numberOfOutputs: 0 });
    ctx.createMediaStreamSource(stream).connect(node);
    const detector = new PitchDetector(ctx.sampleRate);
    detector.setExpected(this.expected);
    let seconds = 0;
    this.clockOffset = Infinity;
    node.port.onmessage = (ev: MessageEvent<Float32Array>) => {
      seconds += ev.data.length / ctx.sampleRate;
      // Messages arrive late by a varying amount; the smallest gap seen is
      // the best estimate of how detector time maps onto the wall clock.
      const gap = performance.now() / 1000 - seconds;
      this.clockOffset = Math.min(this.clockOffset + 0.0002, gap);
      for (const e of detector.process(ev.data)) {
        if (this.kind !== 'mic') continue;
        if (e.type === 'on') this.emitOn(e.midi, e.time + this.clockOffset - MIC_HARDWARE_LATENCY);
        else this.emitOff(e.midi);
      }
    };
    this.micCtx = ctx;
    this.micStream = stream;
    this.detector = detector;
  }

  private stopMic(): void {
    this.micStream?.getTracks().forEach((t) => t.stop());
    void this.micCtx?.close();
    this.micStream = null;
    this.micCtx = null;
    this.detector = null;
  }

  private emitOn(midi: number, time: number): void {
    this.onListeners.forEach((fn) => fn(midi, time));
  }

  private emitOff(midi: number): void {
    this.offListeners.forEach((fn) => fn(midi));
  }

  private notify(): void {
    const s = this.status;
    this.statusListeners.forEach((fn) => fn(s));
  }
}
