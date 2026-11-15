import { useEffect, useState } from 'react';
import type { InputHub, InputKind, InputStatus } from '../input/hub';
import { noteName } from '../music/theory';

interface Props {
  hub: InputHub;
  status: InputStatus;
  onClose(): void;
}

export function Setup({ hub, status, onClose }: Props) {
  const [monitor, setMonitor] = useState({ level: 0, notes: [] as number[] });
  const [lastMidi, setLastMidi] = useState<number | null>(null);

  useEffect(() => hub.onNote((midi) => setLastMidi(midi)), [hub]);
  useEffect(() => {
    if (status.kind !== 'mic') return;
    const id = window.setInterval(() => setMonitor(hub.micMonitor()), 80);
    return () => window.clearInterval(id);
  }, [hub, status.kind]);

  const option = (kind: InputKind, title: string, body: React.ReactNode) => (
    <button
      type="button"
      className={`option ${status.kind === kind ? 'on' : ''}`}
      aria-pressed={status.kind === kind}
      onClick={() => void hub.use(kind)}
    >
      <span className="option-title">{title}</span>
      <span className="option-body">{body}</span>
    </button>
  );

  return (
    <div className="sheet-backdrop" onClick={onClose}>
      <div className="sheet" role="dialog" aria-label="How do you play?" onClick={(e) => e.stopPropagation()}>
        <h2>How do you play?</h2>
        {option(
          'midi',
          'Piano with a cable',
          !status.midiSupported
            ? 'This browser cannot talk to a piano over a cable. Use Chrome on Android or a computer.'
            : status.midiDevices.length
              ? `Connected: ${status.midiDevices.join(', ')}`
              : 'Plug the piano into this device with a USB cable, then tap here. Every note is recognised exactly.',
        )}
        {option('mic', 'Listen with the microphone', 'Works with any piano. Put the device on the music stand and keep the room quiet.')}
        {option('touch', 'Keys on the screen', 'No piano needed. Tap the keys at the bottom of the screen.')}

        {status.error && <p className="error">{status.error}</p>}

        <div className="tester" aria-live="polite">
          {status.kind === 'mic' && status.micActive && (
            <>
              <div className="meter"><div style={{ width: `${Math.min(100, Math.sqrt(monitor.level) * 220)}%` }} /></div>
              <p>{monitor.notes.length ? `I hear ${monitor.notes.map(noteName).join(' ')}` : 'Play a note to test…'}</p>
            </>
          )}
          {status.kind === 'midi' && (
            <p>{lastMidi !== null ? `Got ${noteName(lastMidi)} from the piano` : status.midiDevices.length ? 'Play a key to test…' : ''}</p>
          )}
        </div>

        <button type="button" className="btn primary wide" onClick={onClose}>Done</button>
      </div>
    </div>
  );
}
