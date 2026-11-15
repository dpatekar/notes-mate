import { describe, expect, it } from 'vitest';
import { Session, type Results } from '../src/engine/session';
import { SONGS, part } from '../src/music/songs';
import type { Song } from '../src/music/types';

const tiny: Song = {
  id: 't', title: 't', level: 1, bpm: 60, beatsPerBar: 4,
  notes: [...part('R', 'C4 D4 E4+G4:2'), ...part('L', 'C3:4')].sort((a, b) => a.start - b.start),
};

describe('song notation', () => {
  it('parses durations, chords and fingers', () => {
    const n = part('R', 'C4@1 r:.5 E4+G4:2@1+3 | Bb3');
    expect(n.map((x) => [x.midi, x.start, x.dur, x.finger])).toEqual([
      [60, 0, 1, 1], [64, 1.5, 2, 1], [67, 1.5, 2, 3], [58, 3.5, 1, undefined],
    ]);
  });
  it('built-in songs fill whole bars', () => {
    for (const s of SONGS) {
      for (const hand of ['R', 'L'] as const) {
        const ns = s.notes.filter((n) => n.hand === hand);
        if (!ns.length) continue;
        const end = Math.max(...ns.map((n) => n.start + n.dur));
        expect(end % s.beatsPerBar, `${s.title} ${hand}`).toBe(0);
      }
    }
  });
});

describe('wait mode', () => {
  it('holds at each step until every note of it is played', () => {
    let res: Results | null = null;
    const wrong: number[] = [];
    const s = new Session(tiny, { mode: 'wait', hands: 'both', speed: 1 }, {
      onFinish: (r) => (res = r), onWrong: (m) => wrong.push(m),
    });
    s.start();
    let t = 0;
    const run = (sec: number) => { for (let i = 0; i < sec * 60; i++) s.update((t += 1 / 60)); };
    run(5);
    expect(s.position).toBe(0);
    s.noteOn(60, t);
    run(5);
    expect(s.position).toBe(0); // left hand C3 still missing
    s.noteOn(62, t); // not yet
    expect(wrong).toEqual([62]);
    s.noteOn(48, t);
    run(5);
    expect(s.position).toBe(1);
    s.noteOn(62, t);
    run(3);
    s.noteOn(67, t);
    s.noteOn(64, t);
    run(10);
    expect(res!.hits).toBe(5);
    expect(res!.wrong).toBe(1);
    expect(res!.stars).toBe(2);
  });

  it('only requires the chosen hand and reports the other for accompaniment', () => {
    const acc: number[] = [];
    const s = new Session(tiny, { mode: 'wait', hands: 'R', speed: 1 }, { onAccompany: (n) => acc.push(n.midi) });
    s.start();
    let t = 0;
    for (let i = 0; i < 200; i++) s.update((t += 0.016));
    expect(acc).toEqual([48]);
    expect(s.expectedPitches()).toEqual([60]);
  });
});

describe('tempo mode', () => {
  const play = (offset: number, skip = -1) => {
    let res: Results | null = null;
    const s = new Session(tiny, { mode: 'tempo', hands: 'R', speed: 1 }, { onFinish: (r) => (res = r) });
    s.start();
    const pending = s.steps.flatMap((st) => st.notes).map((n, i) => ({ n, i }));
    let t = 0;
    s.update(t);
    // 4 beats of count-in at 60 bpm = 4 seconds.
    while (!s.finished && t < 20) {
      t += 1 / 120;
      s.update(t);
      for (const p of pending) {
        if (p.i !== skip && p.n.start + 4 + offset <= t && !('done' in p)) {
          (p as { done?: boolean }).done = true;
          s.noteOn(p.n.midi, t);
        }
      }
    }
    return res!;
  };

  it('gives three stars for playing in time', () => {
    const r = play(0.03);
    expect(r.hits).toBe(4);
    expect(r.stars).toBe(3);
    expect(r.timing!).toBeLessThan(50);
  });
  it('counts late notes as missed', () => {
    const r = play(0.6);
    expect(r.hits).toBe(0);
  });
  it('counts a skipped note as a miss', () => {
    const r = play(0, 1);
    expect(r.hits).toBe(3);
    expect(r.misses).toBe(1);
  });
});
