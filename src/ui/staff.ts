import type { Session } from '../engine/session';
import { accidental, letter, staffStep } from '../music/theory';
import type { SongNote } from '../music/types';

export interface StaffOptions {
  /** Show letter names inside the notes. */
  names: boolean;
}

export const COLORS = {
  paper: '#fffdf8',
  line: '#9aa3b2',
  ink: '#1d2433',
  right: '#2f7df6',
  left: '#f08c1a',
  hit: '#1faa64',
  miss: '#e5484d',
  idle: '#b9c0cc',
};

/** Draws the scrolling staff for the current session state. Sizes are CSS pixels. */
export function drawStaff(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  session: Session,
  opts: StaffOptions,
): void {
  const song = session.song;
  const grand = song.notes.some((n) => n.hand === 'L');
  const units = grand ? 21 : 12.5;
  const s = Math.min(h / units, 26);
  const top = (h - units * s) / 2;
  const trebleBottom = top + 8 * s;
  const bassTop = trebleBottom + 4.5 * s;
  const clefW = s * 4.4;
  const playX = clefW + Math.min(w * 0.16, 150);
  const ppb = Math.max(56, Math.min(w / 7, 130));

  const yFor = (n: SongNote) => {
    const step = staffStep(n.midi);
    return grand && n.hand === 'L' ? bassTop - (step + 2) * (s / 2) : trebleBottom - (step - 2) * (s / 2);
  };
  const xFor = (beat: number) => playX + (beat - session.position) * ppb;

  ctx.fillStyle = COLORS.paper;
  ctx.fillRect(0, 0, w, h);

  // Staff lines.
  ctx.strokeStyle = COLORS.line;
  ctx.lineWidth = 1;
  ctx.beginPath();
  for (let i = 0; i < 5; i++) {
    const y = Math.round(trebleBottom - i * s) + 0.5;
    ctx.moveTo(0, y);
    ctx.lineTo(w, y);
    if (grand) {
      const yb = Math.round(bassTop + i * s) + 0.5;
      ctx.moveTo(0, yb);
      ctx.lineTo(w, yb);
    }
  }
  ctx.stroke();

  ctx.save();
  ctx.beginPath();
  ctx.rect(clefW, 0, w - clefW, h);
  ctx.clip();

  // Bar lines.
  const staffTop = trebleBottom - 4 * s;
  const staffBottom = grand ? bassTop + 4 * s : trebleBottom;
  const firstBar = Math.max(0, Math.floor((session.position - 4) / song.beatsPerBar));
  ctx.strokeStyle = COLORS.line;
  ctx.beginPath();
  for (let bar = firstBar; ; bar++) {
    const x = Math.round(xFor(bar * song.beatsPerBar) - s * 0.9) + 0.5;
    if (x > w) break;
    if (bar === 0) continue;
    ctx.moveTo(x, staffTop);
    ctx.lineTo(x, staffBottom);
  }
  ctx.stroke();

  // Playhead.
  ctx.fillStyle = 'rgba(47, 125, 246, 0.10)';
  ctx.fillRect(playX - s * 0.9, staffTop - s * 2.5, s * 1.8, staffBottom - staffTop + s * 5);

  for (const n of song.notes) {
    const x = xFor(n.start);
    const endX = xFor(n.start + n.dur);
    if (endX < clefW - 20 || x > w + 20) continue;
    drawNote(ctx, n, x, endX, yFor(n), s, session, opts, grand, trebleBottom, bassTop, staffTop);
  }
  ctx.restore();

  // Clefs on top of a soft fade so notes slide underneath.
  const fade = ctx.createLinearGradient(clefW * 0.75, 0, clefW, 0);
  fade.addColorStop(0, COLORS.paper);
  fade.addColorStop(1, 'rgba(255, 253, 248, 0)');
  ctx.fillStyle = COLORS.paper;
  ctx.fillRect(0, 0, clefW * 0.75, h);
  ctx.fillStyle = fade;
  ctx.fillRect(clefW * 0.75, 0, clefW * 0.25, h);
  ctx.strokeStyle = COLORS.line;
  ctx.beginPath();
  for (let i = 0; i < 5; i++) {
    const y = Math.round(trebleBottom - i * s) + 0.5;
    ctx.moveTo(0, y);
    ctx.lineTo(clefW, y);
    if (grand) {
      const yb = Math.round(bassTop + i * s) + 0.5;
      ctx.moveTo(0, yb);
      ctx.lineTo(clefW, yb);
    }
  }
  ctx.stroke();
  ctx.fillStyle = COLORS.ink;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'alphabetic';
  ctx.font = `${s * 4}px "Noto Music"`;
  ctx.fillText('\u{1D11E}', s * 0.7, trebleBottom - s); // sits on the G line
  if (grand) ctx.fillText('\u{1D122}', s * 0.7, bassTop + s); // sits on the F line
}

function drawNote(
  ctx: CanvasRenderingContext2D,
  n: SongNote,
  x: number,
  endX: number,
  y: number,
  s: number,
  session: Session,
  opts: StaffOptions,
  grand: boolean,
  trebleBottom: number,
  bassTop: number,
  staffTop: number,
): void {
  const state = session.state.get(n);
  const required = session.required.has(n);
  const handColor = n.hand === 'R' ? COLORS.right : COLORS.left;
  const color = !required ? COLORS.idle : state === 'hit' ? COLORS.hit : state === 'miss' ? COLORS.miss : handColor;
  const onBass = grand && n.hand === 'L';
  const step = staffStep(n.midi);

  // Ledger lines.
  ctx.strokeStyle = COLORS.ink;
  ctx.lineWidth = 1.2;
  ctx.beginPath();
  const ledger = (st: number) => {
    const ly = onBass ? bassTop - (st + 2) * (s / 2) : trebleBottom - (st - 2) * (s / 2);
    ctx.moveTo(x - s * 0.95, Math.round(ly) + 0.5);
    ctx.lineTo(x + s * 0.95, Math.round(ly) + 0.5);
  };
  const low = onBass ? -12 : 0;
  const high = onBass ? 0 : 12;
  for (let st = low; st >= step; st -= 2) ledger(st);
  for (let st = high; st <= step; st += 2) ledger(st);
  ctx.stroke();

  // Length tail: how long to hold the key.
  const tail = endX - x - s * 0.9;
  if (tail > s * 0.4) {
    ctx.globalAlpha = 0.28;
    ctx.fillStyle = color;
    roundRect(ctx, x, y - s * 0.3, tail + s * 0.4, s * 0.6, s * 0.3);
    ctx.fill();
    ctx.globalAlpha = 1;
  }

  if (opts.names) {
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.arc(x, y, s * 0.68, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#fff';
    ctx.font = `700 ${s * 0.82}px system-ui, sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(letter(n.midi), x, y + s * 0.04);
  } else {
    const hollow = n.dur >= 2;
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(-0.35);
    ctx.beginPath();
    ctx.ellipse(0, 0, s * 0.66, s * 0.46, 0, 0, Math.PI * 2);
    if (hollow) {
      ctx.strokeStyle = color;
      ctx.lineWidth = s * 0.17;
      ctx.stroke();
    } else {
      ctx.fillStyle = color;
      ctx.fill();
    }
    ctx.restore();
    if (n.dur < 4) {
      const up = onBass ? step < -6 : step < 6;
      ctx.strokeStyle = color;
      ctx.lineWidth = Math.max(1.4, s * 0.1);
      ctx.beginPath();
      const sx = up ? x + s * 0.6 : x - s * 0.6;
      ctx.moveTo(sx, y);
      ctx.lineTo(sx, up ? y - s * 3.2 : y + s * 3.2);
      ctx.stroke();
      if (n.dur < 1) {
        // Flag for notes shorter than a beat.
        const dir = up ? 1 : -1;
        const fy = up ? y - s * 3.2 : y + s * 3.2;
        ctx.beginPath();
        ctx.moveTo(sx, fy);
        ctx.quadraticCurveTo(sx + s * 0.9, fy + dir * s * 0.8, sx + s * 0.5, fy + dir * s * 1.7);
        ctx.stroke();
      }
    }
  }

  const acc = accidental(n.midi);
  if (acc) {
    ctx.fillStyle = color;
    ctx.font = `${s * 1.5}px "Noto Music", system-ui`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(acc, x - s * 1.35, y);
  }

  if (n.finger && required && !onBass) {
    ctx.fillStyle = state === 'hit' ? COLORS.hit : '#6b7385';
    ctx.font = `600 ${s * 0.95}px system-ui, sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'alphabetic';
    ctx.fillText(String(n.finger), x, Math.min(staffTop - s * 0.9, y - s * 3.6));
  } else if (n.finger && required) {
    ctx.fillStyle = state === 'hit' ? COLORS.hit : '#6b7385';
    ctx.font = `600 ${s * 0.95}px system-ui, sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    ctx.fillText(String(n.finger), x, Math.max(bassTop + s * 4.7, y + s * 3.6));
  }
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}
