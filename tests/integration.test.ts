import { describe, expect, it } from 'vitest';
import { PitchDetector } from '../src/audio/detector';
import { Session } from '../src/engine/session';
import { SONGS } from '../src/music/songs';
import { noteName } from '../src/music/theory';
import { render } from './tones';

/**
 * Plays each built-in song as synthetic piano audio into the detector, with
 * the lesson engine in "learn" mode telling it which notes to expect - the
 * same loop the app runs with a real microphone.
 */
function playThrough(songId: string, secondsPerBeat: number, log = false) {
  const song = SONGS.find((s) => s.id === songId)!;
  const sr = 48000;
  const lead = 1;
  const notes = song.notes.map((n) => ({
    midi: n.midi,
    start: lead + n.start * secondsPerBeat,
    dur: n.dur * secondsPerBeat * 0.8,
    gain: n.hand === 'L' ? 0.15 : 0.2,
  }));
  const seconds = lead + (Math.max(...song.notes.map((n) => n.start + n.dur)) + 1) * secondsPerBeat;
  const audio = render(notes, seconds, sr);
  const det = new PitchDetector(sr);
  const wrong: string[] = [];
  const session = new Session(song, { mode: 'wait', hands: 'both', speed: 1 }, {
    onWrong: (m) => wrong.push(noteName(m)),
  });
  session.start();
  let stalledAt = '';
  for (let i = 0; i < audio.length; i += 1024) {
    const t = i / sr;
    session.update(t);
    det.setExpected(session.expectedPitches());
    for (const e of det.process(audio.subarray(i, i + 1024))) {
      if (log) console.log(e.time.toFixed(2), e.type, noteName(e.midi), 'expecting', session.expectedPitches().map(noteName).join('+'));
      if (e.type === 'on') session.noteOn(e.midi, e.time);
    }
  }
  const step = session.currentStep;
  if (step) stalledAt = `beat ${step.beat} waiting for ${session.expectedPitches().map(noteName).join('+')}`;
  return { results: session.results(), wrong, stalledAt };
}

describe('songs through the microphone detector', () => {
  for (const song of SONGS) {
    for (const spb of [0.7, 0.45]) {
      it(`${song.title} at ${Math.round(60 / spb)} bpm`, () => {
        const r = playThrough(song.id, spb);
        expect(r.stalledAt).toBe('');
        expect(r.results.hits).toBe(r.results.total);
        expect(r.wrong).toEqual([]);
      });
    }
  }
});
