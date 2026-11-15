import type { Hands, Mode } from '../engine/session';

export interface PlaySettings {
  mode: Mode;
  hands: Hands;
  speed: number;
  names: boolean;
}

const DEFAULTS: PlaySettings = { mode: 'wait', hands: 'both', speed: 1, names: true };

function read<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw ? { ...fallback, ...JSON.parse(raw) } : fallback;
  } catch {
    return fallback;
  }
}

function write(key: string, value: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* storage unavailable: settings just won't persist */
  }
}

export const loadSettings = () => read<PlaySettings>('settings', DEFAULTS);
export const saveSettings = (s: PlaySettings) => write('settings', s);

export const loadStars = () => read<Record<string, number>>('stars', {});
export function saveStars(songId: string, stars: number): void {
  const all = loadStars();
  if ((all[songId] ?? 0) < stars) write('stars', { ...all, [songId]: stars });
}
