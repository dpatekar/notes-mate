import { parsePitch } from './theory';
import type { Hand, Song, SongNote } from './types';

/**
 * Compact notation for one hand: tokens separated by spaces, `|` is ignored.
 *   E4        quarter note        E4:2      half note
 *   C3+G3:4   chord               r:1       rest
 *   E4@3      play with finger 3  C3+G3@5+1 fingers per chord note
 */
export function part(hand: Hand, src: string): SongNote[] {
  const notes: SongNote[] = [];
  let beat = 0;
  for (const tok of src.split(/\s+/)) {
    if (!tok || tok === '|') continue;
    const [body, fingers] = tok.split('@');
    const [pitches, durStr] = body.split(':');
    const dur = durStr ? Number(durStr) : 1;
    if (!(dur > 0)) throw new Error(`Bad duration in "${tok}"`);
    if (pitches !== 'r') {
      const fs = fingers ? fingers.split('+').map(Number) : [];
      pitches.split('+').forEach((p, i) => {
        notes.push({ midi: parsePitch(p), start: beat, dur, hand, finger: fs[i] });
      });
    }
    beat += dur;
  }
  return notes;
}

function song(meta: Omit<Song, 'notes'>, right: string, left?: string): Song {
  const notes = [...part('R', right), ...(left ? part('L', left) : [])];
  notes.sort((a, b) => a.start - b.start || a.midi - b.midi);
  return { ...meta, notes };
}

/** Starter songs. All are traditional or long out of copyright. */
export const SONGS: Song[] = [
  song(
    { id: 'hot-cross-buns', title: 'Hot Cross Buns', composer: 'Traditional', level: 1, bpm: 84, beatsPerBar: 4 },
    `E4@3 D4@2 C4:2@1 | E4@3 D4@2 C4:2@1 |
     C4:.5@1 C4:.5 C4:.5 C4:.5 D4:.5@2 D4:.5 D4:.5 D4:.5 | E4@3 D4@2 C4:2@1`,
  ),
  song(
    { id: 'mary-lamb', title: 'Mary Had a Little Lamb', composer: 'Traditional', level: 1, bpm: 92, beatsPerBar: 4 },
    `E4@3 D4@2 C4@1 D4@2 | E4@3 E4 E4:2 | D4@2 D4 D4:2 | E4@3 G4@5 G4:2 |
     E4@3 D4@2 C4@1 D4@2 | E4@3 E4 E4 E4 | D4@2 D4 E4@3 D4@2 | C4:4@1`,
  ),
  song(
    { id: 'twinkle', title: 'Twinkle, Twinkle, Little Star', composer: 'Traditional', level: 2, bpm: 96, beatsPerBar: 4 },
    `C4 C4 G4 G4 | A4 A4 G4:2 | F4 F4 E4 E4 | D4 D4 C4:2 |
     G4 G4 F4 F4 | E4 E4 D4:2 | G4 G4 F4 F4 | E4 E4 D4:2 |
     C4 C4 G4 G4 | A4 A4 G4:2 | F4 F4 E4 E4 | D4 D4 C4:2`,
  ),
  song(
    { id: 'frere-jacques', title: 'Frère Jacques', composer: 'Traditional', level: 2, bpm: 100, beatsPerBar: 4 },
    `C4 D4 E4 C4 | C4 D4 E4 C4 | E4 F4 G4:2 | E4 F4 G4:2 |
     G4:.5 A4:.5 G4:.5 F4:.5 E4 C4 | G4:.5 A4:.5 G4:.5 F4:.5 E4 C4 |
     C4 G3 C4:2 | C4 G3 C4:2`,
  ),
  song(
    { id: 'ode-to-joy', title: 'Ode to Joy', composer: 'Ludwig van Beethoven', level: 3, bpm: 100, beatsPerBar: 4 },
    `E4@3 E4 F4@4 G4@5 | G4 F4@4 E4@3 D4@2 | C4@1 C4 D4@2 E4@3 | E4:1.5 D4:.5@2 D4:2 |
     E4@3 E4 F4@4 G4@5 | G4 F4@4 E4@3 D4@2 | C4@1 C4 D4@2 E4@3 | D4:1.5@2 C4:.5@1 C4:2`,
    `C3:4@5 | G3:4@1 | C3:4@5 | G3:4@1 | C3:4@5 | G3:4@1 | C3:4@5 | G3:2@1 C3:2@5`,
  ),
];
