import { num } from '../../svg/builder.js';

export const RIGHT = 1;
export const LEFT = 2;
export const UP = 4;
export const DOWN = 8;

// How far a head reaches past each side of its shaft.
export const OVERHANG = 7;
const MAX_DEPTH = 20;
const NUB = 12;

export interface ArrowSize {
  w: number;
  h: number;
  // Shift of the label from the center, away from the heads.
  dx: number;
  dy: number;
}

// Mermaid compares directions exactly, so `( up )` draws no arrow there. Here spaces are ignored.
export function arrowMask(directions: string[] | undefined): number {
  let mask = 0;
  if (directions) {
    for (const direction of directions) {
      switch (direction.trim()) {
        case 'right':
          mask |= RIGHT;
          break;
        case 'left':
          mask |= LEFT;
          break;
        case 'up':
          mask |= UP;
          break;
        case 'down':
          mask |= DOWN;
          break;
        case 'x':
          mask |= RIGHT | LEFT;
          break;
        case 'y':
          mask |= UP | DOWN;
          break;
      }
    }
  }
  return mask;
}

const bit = (mask: number, flag: number): number => (mask & flag ? 1 : 0);

// An arrow along one axis has a shaft and heads wider than it. One that points along both axes
// is a box with a small point on each side it names.
export function arrowAxis(mask: number): 'x' | 'y' | '' {
  if (mask !== 0 && (mask & (UP | DOWN)) === 0) return 'x';
  if (mask !== 0 && (mask & (RIGHT | LEFT)) === 0) return 'y';
  return '';
}

export function arrowSize(mask: number, tw: number, th: number): ArrowSize {
  const axis = arrowAxis(mask);
  const across = bit(mask, LEFT) - bit(mask, RIGHT);
  const along = bit(mask, UP) - bit(mask, DOWN);
  if (axis === 'x') {
    const h = Math.max(th + 8, 14) + 2 * OVERHANG;
    const depth = Math.min(h / 2, MAX_DEPTH);
    return { w: Math.max(tw + 12, 16) + depth * (mask === (RIGHT | LEFT) ? 2 : 1), h, dx: (across * depth) / 2, dy: 0 };
  }
  if (axis === 'y') {
    const w = Math.max(tw + 16, 14) + 2 * OVERHANG;
    const depth = Math.min(w / 2, MAX_DEPTH);
    return { w, h: Math.max(th + 8, 16) + depth * (mask === (UP | DOWN) ? 2 : 1), dx: 0, dy: (along * depth) / 2 };
  }
  return {
    w: Math.max(tw + 16, 24) + NUB * (bit(mask, LEFT) + bit(mask, RIGHT)),
    h: Math.max(th + 8, 24) + NUB * (bit(mask, UP) + bit(mask, DOWN)),
    dx: (across * NUB) / 2,
    dy: (along * NUB) / 2,
  };
}

export function arrowPoints(mask: number, w: number, h: number): number[] {
  const axis = arrowAxis(mask);
  const x = w / 2;
  const y = h / 2;
  let p: number[];
  if (axis === 'x') {
    const depth = Math.min(y, MAX_DEPTH);
    const s = y - OVERHANG;
    const x0 = mask & LEFT ? -x + depth : -x;
    const x1 = mask & RIGHT ? x - depth : x;
    p = [x0, -s, x1, -s];
    if (mask & RIGHT) p.push(x1, -y, x, 0, x1, y);
    p.push(x1, s, x0, s);
    if (mask & LEFT) p.push(x0, y, -x, 0, x0, -y);
  } else if (axis === 'y') {
    const depth = Math.min(x, MAX_DEPTH);
    const s = x - OVERHANG;
    const y0 = mask & UP ? -y + depth : -y;
    const y1 = mask & DOWN ? y - depth : y;
    p = [s, y0, s, y1];
    if (mask & DOWN) p.push(x, y1, 0, y, -x, y1);
    p.push(-s, y1, -s, y0);
    if (mask & UP) p.push(-x, y0, 0, -y, x, y0);
  } else {
    const x0 = mask & LEFT ? -x + NUB : -x;
    const x1 = mask & RIGHT ? x - NUB : x;
    const y0 = mask & UP ? -y + NUB : -y;
    const y1 = mask & DOWN ? y - NUB : y;
    const cx = (x0 + x1) / 2;
    const cy = (y0 + y1) / 2;
    const kx = Math.min(10, (x1 - x0) / 2);
    const ky = Math.min(10, (y1 - y0) / 2);
    p = [x0, y0];
    if (mask & UP) p.push(cx - kx, y0, cx, -y, cx + kx, y0);
    p.push(x1, y0);
    if (mask & RIGHT) p.push(x1, cy - ky, x, cy, x1, cy + ky);
    p.push(x1, y1);
    if (mask & DOWN) p.push(cx + kx, y1, cx, y, cx - kx, y1);
    p.push(x0, y1);
    if (mask & LEFT) p.push(x0, cy + ky, -x, cy, x0, cy - ky);
  }
  return p;
}

export function drawArrow(mask: number, w: number, h: number, attrs: string): string {
  const p = arrowPoints(mask, w, h);
  let points = '';
  for (let i = 0; i < p.length; i += 2) points += (i ? ' ' : '') + num(p[i]) + ',' + num(p[i + 1]);
  return `<polygon points="${points}" stroke-linejoin="round"${attrs}/>`;
}
