import { describe, expect, it } from 'vitest';
import { PitchDetector, type DetectorEvent } from '../src/audio/detector';
import { render, type ToneNote } from './tones';

function run(notes: ToneNote[], seconds: number, sr = 48000, expected?: number[], noise?: number) {
  const det = new PitchDetector(sr);
  if (expected) det.setExpected(expected);
  const audio = render(notes, seconds, sr, noise);
  const events: DetectorEvent[] = [];
  for (let i = 0; i < audio.length; i += 1024) {
    events.push(...det.process(audio.subarray(i, i + 1024)));
  }
  return events.filter((e) => e.type === 'on');
}

/** Like a lesson: only the notes about to be played are expected. */
function runLesson(notes: ToneNote[], seconds: number, sr = 48000) {
  const det = new PitchDetector(sr);
  const audio = render(notes, seconds, sr);
  const events: DetectorEvent[] = [];
  for (let i = 0; i < audio.length; i += 1024) {
    const t = i / sr;
    det.setExpected(notes.filter((n) => n.start > t - 0.15 && n.start < t + 0.25).map((n) => n.midi));
    events.push(...det.process(audio.subarray(i, i + 1024)));
  }
  return events.filter((e) => e.type === 'on');
}

const midis = (ev: DetectorEvent[]) => ev.map((e) => e.midi).sort((a, b) => a - b);

describe('PitchDetector', () => {
  it('detects every single note from C2 to C7 with no extras', () => {
    const bad: string[] = [];
    for (let m = 36; m <= 96; m++) {
      for (const sr of [48000, 44100]) {
        const on = run([{ midi: m, start: 0.4, dur: 0.6 }], 1.4, sr);
        if (on.length !== 1 || on[0].midi !== m) bad.push(`${m}@${sr}: ${midis(on)}`);
        else if (Math.abs(on[0].time - 0.4) > 0.06) bad.push(`${m}@${sr}: time ${on[0].time}`);
      }
    }
    expect(bad).toEqual([]);
  });

  it('detects single notes when they are the expected ones', () => {
    const bad: string[] = [];
    for (let m = 36; m <= 96; m++) {
      const on = run([{ midi: m, start: 0.4, dur: 0.6 }], 1.4, 48000, [m]);
      if (on.length !== 1 || on[0].midi !== m) bad.push(`${m}: ${midis(on)}`);
    }
    expect(bad).toEqual([]);
  });

  it('does not accept a wrong neighbouring note for the expected one', () => {
    const bad: string[] = [];
    for (let m = 40; m <= 90; m++) {
      for (const off of [-12, -2, -1, 1, 2, 7, 12]) {
        // Below A2 a microphone often cannot hear the fundamental at all.
        if (m + off < 45) continue;
        const on = run([{ midi: m + off, start: 0.4, dur: 0.6 }], 1.4, 48000, [m]);
        if (on.some((e) => e.midi === m)) bad.push(`expected ${m}, played ${m + off}`);
      }
    }
    expect(bad).toEqual([]);
  });

  it('detects chords', () => {
    const chords = [
      [60, 64, 67],
      [48, 64, 67],
      [53, 57, 60],
      [55, 59, 62, 65],
      [36, 60],
      [43, 59, 62],
      [60, 62],
      [60, 61],
      [48, 52, 55, 72],
    ];
    const bad: string[] = [];
    for (const chord of chords) {
      const on = run(chord.map((midi) => ({ midi, start: 0.4, dur: 0.8 })), 1.6, 48000, chord);
      if ([...new Set(midis(on))].join() !== chord.join()) bad.push(`${chord} -> ${midis(on)}`);
    }
    expect(bad).toEqual([]);
  });

  it('detects octaves when expected', () => {
    for (const chord of [[60, 72], [48, 60], [55, 67]]) {
      const on = run(chord.map((midi) => ({ midi, start: 0.4, dur: 0.8 })), 1.6, 48000, chord);
      expect(midis(on)).toEqual(chord);
    }
  });

  it('detects repeated notes', () => {
    const notes = [0, 1, 2, 3, 4].map((i) => ({ midi: 64, start: 0.4 + i * 0.3, dur: 0.22 }));
    const on = run(notes, 2.4, 48000, [64]);
    expect(midis(on)).toEqual([64, 64, 64, 64, 64]);
    on.forEach((e, i) => expect(Math.abs(e.time - (0.4 + i * 0.3))).toBeLessThan(0.07));
  });

  it('follows a melody over a held bass note', () => {
    const melody = [64, 62, 60, 62, 64, 64, 64];
    const notes: ToneNote[] = melody.map((midi, i) => ({ midi, start: 0.4 + i * 0.35, dur: 0.3 }));
    notes.push({ midi: 48, start: 0.4, dur: 2.6 });
    const on = runLesson(notes, 3.4).sort((a, b) => a.time - b.time);
    expect(on.filter((e) => e.midi !== 48).map((e) => e.midi)).toEqual(melody);
    expect(on.filter((e) => e.midi === 48).length).toBe(1);
  });

  it('hears a note again after it was released a moment ago', () => {
    const notes: ToneNote[] = [
      { midi: 48, start: 0.4, dur: 2.6 },
      { midi: 62, start: 0.4, dur: 0.5 },
      { midi: 60, start: 1.1, dur: 0.5 },
      { midi: 60, start: 1.8, dur: 0.5 },
      { midi: 62, start: 2.5, dur: 0.5 },
    ];
    const on = runLesson(notes, 3.4).sort((a, b) => a.time - b.time);
    expect(on.filter((e) => e.midi !== 48).map((e) => e.midi)).toEqual([62, 60, 60, 62]);
  });

  it('stays silent on noise', () => {
    expect(run([], 2, 48000, [60, 64, 67], 0.05)).toEqual([]);
  });

  it('works with quiet playing and a noisy room', () => {
    const on = run([{ midi: 60, start: 0.4, dur: 0.6, gain: 0.02 }], 1.4, 48000, [60], 0.004);
    expect(midis(on)).toEqual([60]);
  });
});
