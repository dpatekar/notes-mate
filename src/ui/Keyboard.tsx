import { useMemo } from 'react';
import { isBlack, letter } from '../music/theory';

export interface KeyHint {
  hand: 'R' | 'L';
  finger?: number;
}

interface Props {
  low: number;
  high: number;
  /** Keys to play next. */
  hints: Map<number, KeyHint>;
  /** Keys being pressed and whether they were right. */
  pressed: Map<number, 'ok' | 'bad' | 'free'>;
  names: boolean;
  onKey(midi: number, down: boolean): void;
}

export function Keyboard({ low, high, hints, pressed, names, onKey }: Props) {
  const keys = useMemo(() => {
    const whites: number[] = [];
    const blacks: { midi: number; after: number }[] = [];
    for (let m = low; m <= high; m++) {
      if (isBlack(m)) blacks.push({ midi: m, after: whites.length });
      else whites.push(m);
    }
    return { whites, blacks };
  }, [low, high]);
  const n = keys.whites.length;

  const cls = (midi: number, base: string) => {
    const p = pressed.get(midi);
    const h = hints.get(midi);
    return [base, p && `is-${p}`, !p && h && `hint-${h.hand}`].filter(Boolean).join(' ');
  };
  const handlers = (midi: number) => ({
    onPointerDown: (e: React.PointerEvent) => {
      e.preventDefault();
      (e.target as Element).releasePointerCapture?.(e.pointerId);
      onKey(midi, true);
    },
    onPointerUp: () => onKey(midi, false),
    onPointerLeave: (e: React.PointerEvent) => {
      if (e.buttons || e.pointerType === 'touch') onKey(midi, false);
    },
    onPointerCancel: () => onKey(midi, false),
  });

  return (
    <div className="keyboard" role="group" aria-label="Piano keys">
      {keys.whites.map((midi, i) => {
        const h = hints.get(midi);
        return (
          <button
            key={midi}
            type="button"
            aria-label={letter(midi)}
            className={cls(midi, 'key white')}
            style={{ left: `${(i / n) * 100}%`, width: `${100 / n}%` }}
            {...handlers(midi)}
          >
            {h?.finger && <span className="finger">{h.finger}</span>}
            {(names || midi % 12 === 0) && <span className="key-name">{letter(midi)}</span>}
          </button>
        );
      })}
      {keys.blacks.map(({ midi, after }) => {
        const h = hints.get(midi);
        return (
          <button
            key={midi}
            type="button"
            aria-label={`${letter(midi)} black key`}
            className={cls(midi, 'key black')}
            style={{ left: `${((after - 0.32) / n) * 100}%`, width: `${(0.64 / n) * 100}%` }}
            {...handlers(midi)}
          >
            {h?.finger && <span className="finger">{h.finger}</span>}
          </button>
        );
      })}
    </div>
  );
}
