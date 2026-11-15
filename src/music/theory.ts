const LETTERS = ['C', 'C', 'D', 'E', 'E', 'F', 'F', 'G', 'G', 'A', 'B', 'B'];
const STEPS = [0, 0, 1, 2, 2, 3, 3, 4, 4, 5, 6, 6];
/** Black keys are spelled as sharps, except E♭ and B♭ which read more naturally. */
const ACCIDENTAL = ['', '♯', '', '♭', '', '', '♯', '', '♯', '', '♭', ''];
const NAME_TO_PC: Record<string, number> = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };

export const isBlack = (midi: number) => ACCIDENTAL[midi % 12] !== '';
export const letter = (midi: number) => LETTERS[midi % 12];
export const accidental = (midi: number) => ACCIDENTAL[midi % 12];
export const noteName = (midi: number) =>
  `${LETTERS[midi % 12]}${ACCIDENTAL[midi % 12]}${Math.floor(midi / 12) - 1}`;

/** Position on the staff in diatonic steps, where middle C (C4) is 0. */
export function staffStep(midi: number): number {
  return (Math.floor(midi / 12) - 5) * 7 + STEPS[midi % 12];
}

/** "C4", "F#3", "Bb4" -> MIDI number. */
export function parsePitch(name: string): number {
  const m = /^([A-G])([#b]?)(-?\d)$/.exec(name);
  if (!m) throw new Error(`Bad pitch "${name}"`);
  const acc = m[2] === '#' ? 1 : m[2] === 'b' ? -1 : 0;
  return NAME_TO_PC[m[1]] + acc + (Number(m[3]) + 1) * 12;
}
