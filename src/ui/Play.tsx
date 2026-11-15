import { useEffect, useMemo, useRef, useState } from 'react';
import type { Synth } from '../audio/synth';
import { Session, type Hands, type Mode, type Results } from '../engine/session';
import type { InputHub, InputKind } from '../input/hub';
import type { Song } from '../music/types';
import { Keyboard, type KeyHint } from './Keyboard';
import { drawStaff } from './staff';
import { loadSettings, saveSettings, saveStars, type PlaySettings } from './store';

interface Props {
  song: Song;
  hub: InputHub;
  synth: Synth;
  input: InputKind;
  onExit(): void;
}

const SPEEDS = [0.5, 0.75, 1];

export function Play({ song, hub, synth, input, onExit }: Props) {
  const hasLeft = useMemo(() => song.notes.some((n) => n.hand === 'L'), [song]);
  const [settings, setSettings] = useState<PlaySettings>(loadSettings);
  const [attempt, setAttempt] = useState(0);
  const [results, setResults] = useState<Results | null>(null);
  const [hints, setHints] = useState<Map<number, KeyHint>>(new Map());
  const [pressed, setPressed] = useState<Map<number, 'ok' | 'bad' | 'free'>>(new Map());
  const [countIn, setCountIn] = useState<number | null>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const hands: Hands = hasLeft ? settings.hands : 'both';
  // The microphone would hear our own speaker, so stay silent when it is on.
  const quiet = input === 'mic';

  const update = (patch: Partial<PlaySettings>) => {
    const next = { ...settings, ...patch };
    setSettings(next);
    saveSettings(next);
  };

  const range = useMemo(() => {
    const lo = Math.min(...song.notes.map((n) => n.midi), 60);
    const hi = Math.max(...song.notes.map((n) => n.midi), 72);
    return { low: Math.floor(lo / 12) * 12, high: Math.ceil((hi + 1) / 12) * 12 };
  }, [song]);

  useEffect(() => {
    setResults(null);
    setPressed(new Map());
    const session = new Session(
      song,
      { mode: settings.mode, hands, speed: settings.speed },
      {
        onStep: (step) => {
          const next = new Map<number, KeyHint>();
          for (const n of step?.notes ?? []) next.set(n.midi, { hand: n.hand, finger: n.finger });
          setHints(next);
        },
        onAccompany: (n, spb) => {
          if (!quiet) synth.note(n.midi, n.dur * spb, 0.16);
        },
        onBeat: (beat, downbeat) => {
          synth.click(downbeat);
          setCountIn(beat < 0 ? -beat : null);
        },
        onFinish: (r) => {
          setResults(r);
          saveStars(song.id, r.stars);
        },
      },
    );
    session.start();
    setCountIn(null);

    const flash = (midi: number, kind: 'ok' | 'bad' | 'free') => {
      setPressed((p) => new Map(p).set(midi, kind));
      window.setTimeout(() => {
        setPressed((p) => {
          if (!p.has(midi)) return p;
          const next = new Map(p);
          next.delete(midi);
          return next;
        });
      }, 260);
    };
    const offNote = hub.onNote((midi, time) => {
      let verdict: 'ok' | 'bad' = 'bad';
      const before = session.results();
      session.noteOn(midi, time);
      const after = session.results();
      if (after.hits > before.hits) verdict = 'ok';
      flash(midi, session.finished ? 'free' : verdict);
    });

    const canvas = canvasRef.current!;
    const ctx = canvas.getContext('2d')!;
    let raf = 0;
    let frame = 0;
    const tick = () => {
      const now = performance.now() / 1000;
      session.update(now);
      if (frame++ % 6 === 0) hub.setExpected(session.expectedPitches());
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const w = canvas.clientWidth;
      const h = canvas.clientHeight;
      if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) {
        canvas.width = Math.round(w * dpr);
        canvas.height = Math.round(h * dpr);
      }
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      drawStaff(ctx, w, h, session, { names: settings.names });
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(raf);
      offNote();
      hub.setExpected([]);
    };
  }, [song, settings.mode, settings.speed, settings.names, hands, attempt, hub, synth, quiet]);

  const onKey = (midi: number, down: boolean) => {
    if (down && !quiet) synth.note(midi, 0.5);
    hub.touch(midi, down);
  };

  return (
    <div className="play">
      <header className="play-bar">
        <button type="button" className="icon-btn" onClick={onExit} aria-label="Back to songs">
          ‹
        </button>
        <h1 className="play-title">{song.title}</h1>
        <div className="controls">
          <Segmented<Mode>
            label="Mode"
            value={settings.mode}
            options={[['wait', 'Learn'], ['tempo', 'Play']]}
            onChange={(mode) => update({ mode })}
          />
          {hasLeft && (
            <Segmented<Hands>
              label="Hands"
              value={settings.hands}
              options={[['L', 'Left'], ['both', 'Both'], ['R', 'Right']]}
              onChange={(h) => update({ hands: h })}
            />
          )}
          <Segmented<number>
            label="Speed"
            value={settings.speed}
            options={SPEEDS.map((s) => [s, `${Math.round(s * 100)}%`] as [number, string])}
            onChange={(speed) => update({ speed })}
          />
          <button
            type="button"
            className={`chip ${settings.names ? 'on' : ''}`}
            aria-pressed={settings.names}
            onClick={() => update({ names: !settings.names })}
          >
            ABC
          </button>
          <button type="button" className="chip" onClick={() => setAttempt((a) => a + 1)}>
            Restart
          </button>
        </div>
      </header>

      <div className="stage">
        <canvas ref={canvasRef} className="staff" />
        {countIn !== null && <div className="count-in" aria-live="polite">{countIn}</div>}
        {results && (
          <div className="results" role="dialog" aria-label="Results">
            <div className="stars" aria-label={`${results.stars} of 3 stars`}>
              {[1, 2, 3].map((i) => (
                <span key={i} className={i <= results.stars ? 'star on' : 'star'}>★</span>
              ))}
            </div>
            <h2>{results.stars === 3 && !results.wrong ? 'Perfect!' : results.stars === 3 ? 'Brilliant!' : results.stars === 2 ? 'Great playing!' : results.stars === 1 ? 'Nice try!' : 'Keep practising!'}</h2>
            <p className="results-line">
              {results.hits} of {results.total} notes right
              {results.wrong > 0 && ` · ${results.wrong} extra`}
              {results.timing !== null && ` · timing ±${Math.round(results.timing)} ms`}
            </p>
            <div className="results-actions">
              <button type="button" className="btn" onClick={onExit}>Songs</button>
              <button type="button" className="btn primary" onClick={() => setAttempt((a) => a + 1)}>Play again</button>
            </div>
          </div>
        )}
      </div>

      <Keyboard low={range.low} high={range.high} hints={hints} pressed={pressed} names={settings.names} onKey={onKey} />
    </div>
  );
}

function Segmented<T extends string | number>(props: {
  label: string;
  value: T;
  options: [T, string][];
  onChange(v: T): void;
}) {
  return (
    <div className="segmented" role="group" aria-label={props.label}>
      {props.options.map(([v, text]) => (
        <button
          key={String(v)}
          type="button"
          className={v === props.value ? 'on' : ''}
          aria-pressed={v === props.value}
          onClick={() => props.onChange(v)}
        >
          {text}
        </button>
      ))}
    </div>
  );
}
