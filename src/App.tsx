import { useEffect, useMemo, useState } from 'react';
import { Synth } from './audio/synth';
import { InputHub, type InputStatus } from './input/hub';
import { SONGS } from './music/songs';
import type { Song } from './music/types';
import { Play } from './ui/Play';
import { Setup } from './ui/Setup';
import { loadStars } from './ui/store';

const INPUT_LABEL = { midi: 'Piano connected', mic: 'Microphone', touch: 'Screen keys' } as const;
const LEVELS = ['', 'First notes', 'Easy', 'Hands together', 'Getting harder', 'Challenge'];

export function App() {
  const hub = useMemo(() => new InputHub(), []);
  const synth = useMemo(() => new Synth(), []);
  const [status, setStatus] = useState<InputStatus>(hub.status);
  const [song, setSong] = useState<Song | null>(null);
  const [setup, setSetup] = useState(false);
  const [stars, setStars] = useState(loadStars);

  useEffect(() => {
    const off = hub.onStatus(setStatus);
    // A plugged-in piano is the best input, so pick it up without asking.
    void hub.connectMidi().then((found) => {
      if (found) void hub.use('midi');
    });
    return () => {
      off();
    };
  }, [hub]);

  if (song) {
    return (
      <Play
        song={song}
        hub={hub}
        synth={synth}
        input={status.kind}
        onExit={() => {
          setStars(loadStars());
          setSong(null);
        }}
      />
    );
  }

  return (
    <div className="home">
      <header className="home-bar">
        <h1>Notes Mate</h1>
        <button type="button" className={`input-chip ${status.kind}`} onClick={() => setSetup(true)}>
          <span className="dot" />
          {status.kind === 'midi' && !status.midiDevices.length ? 'No piano found' : INPUT_LABEL[status.kind]}
        </button>
      </header>
      <main className="songs">
        <h2>Songs</h2>
        <ul>
          {SONGS.map((s) => (
            <li key={s.id}>
              <button
                type="button"
                className="song-card"
                onClick={() => {
                  synth.resume();
                  setSong(s);
                }}
              >
                <span className={`level level-${s.level}`}>{LEVELS[s.level]}</span>
                <span className="song-title">{s.title}</span>
                <span className="song-by">{s.composer}</span>
                <span className="song-stars" aria-label={`${stars[s.id] ?? 0} of 3 stars`}>
                  {[1, 2, 3].map((i) => (
                    <span key={i} className={i <= (stars[s.id] ?? 0) ? 'star on' : 'star'}>★</span>
                  ))}
                </span>
              </button>
            </li>
          ))}
        </ul>
      </main>
      {setup && <Setup hub={hub} status={status} onClose={() => setSetup(false)} />}
    </div>
  );
}
