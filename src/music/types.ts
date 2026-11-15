export type Hand = 'R' | 'L';

export interface SongNote {
  midi: number;
  /** Start, in beats from the beginning of the song. */
  start: number;
  /** Length in beats. */
  dur: number;
  hand: Hand;
  /** 1 = thumb ... 5 = little finger. */
  finger?: number;
}

export interface Song {
  id: string;
  title: string;
  composer?: string;
  /** 1 = first notes ... 5 = hands together. */
  level: number;
  bpm: number;
  beatsPerBar: number;
  notes: SongNote[];
}
