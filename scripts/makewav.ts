import { writeFileSync } from 'node:fs';
import { SONGS } from '../src/music/songs';
import { render } from '../tests/tones';

// Renders a built-in song as a WAV file: 8 s of silence, then the notes.
const [id, out] = process.argv.slice(2);
const song = SONGS.find((s) => s.id === id)!;
const spb = 0.7;
const notes = song.notes.map((n) => ({ midi: n.midi, start: 8 + n.start * spb, dur: n.dur * spb * 0.8 }));
const seconds = 8 + (Math.max(...song.notes.map((n) => n.start + n.dur)) + 2) * spb;
const audio = render(notes, seconds, 48000);
const buf = Buffer.alloc(44 + audio.length * 2);
buf.write('RIFF', 0); buf.writeUInt32LE(36 + audio.length * 2, 4); buf.write('WAVEfmt ', 8);
buf.writeUInt32LE(16, 16); buf.writeUInt16LE(1, 20); buf.writeUInt16LE(1, 22);
buf.writeUInt32LE(48000, 24); buf.writeUInt32LE(96000, 28); buf.writeUInt16LE(2, 32); buf.writeUInt16LE(16, 34);
buf.write('data', 36); buf.writeUInt32LE(audio.length * 2, 40);
for (let i = 0; i < audio.length; i++) buf.writeInt16LE(Math.round(Math.max(-1, Math.min(1, audio[i])) * 32767), 44 + i * 2);
writeFileSync(out, buf);
console.log(out, seconds.toFixed(1) + 's');
