# Notes Mate

A piano-learning app for the family: follow the scrolling notes, play them on a real piano, get instant feedback.

## Run it

```
npm install
npm run dev      # then open the printed address in Chrome
npm test         # detector, engine and song tests
npm run build    # production build in dist/
```

## How notes are recognised

- **Piano with a cable (best):** a digital piano connected by USB sends exact key presses (Web MIDI; Chrome on Android or desktop).
- **Microphone:** `src/audio/detector.ts` listens for piano notes. It knows which notes the lesson expects, which is what lets it tell a note from its overtones.
- **Screen keys:** tap the keyboard at the bottom; no piano needed.

## Layout

| Path | What it is |
|---|---|
| `src/audio/detector.ts` | Microphone note detector (no browser dependencies) |
| `src/engine/session.ts` | Lesson logic: Learn mode (waits for you) and Play mode (in time, scored) |
| `src/music/songs.ts` | Song notation and the starter songs |
| `src/input/hub.ts` | MIDI, microphone and touch input behind one interface |
| `src/ui/` | Screens: song list, play view, staff drawing, keyboard |
| `tests/` | Unit tests plus full songs played through the detector as synthetic audio |
| `scripts/makewav.ts` | Renders a song to a WAV file for browser microphone tests |

The detector tests use synthesized piano tones, not recordings of a real instrument.
