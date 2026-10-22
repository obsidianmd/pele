import type { CNode } from '../layout/compound.js';
import { num } from './builder.js';
import { rounded } from './theme.js';

export interface ShapeSize {
  w: number;
  h: number;
  // Vertical shift of the label from the shape's center.
  dy: number;
}

export const PAD_X = 18;
export const PAD_Y = 12;

type Sizer = (tw: number, th: number) => ShapeSize;
type Drawer = (w: number, h: number, a: string, line: string) => string;

// Distance from the bounding box to the outline on a side: 0 top, 1 right, 2 bottom, 3 left.
// `t` is how far along the side from its middle, to the right or down.
type Inset = (w: number, h: number, side: number, t: number) => number;

// How much of a side edges may spread along, centered on its middle: the top and bottom, or the
// left and right when `sideways`. A shape without one keeps its edges at the middle.
type Span = (w: number, h: number, sideways: boolean) => number;

interface ShapeDef {
  size: Sizer;
  draw: Drawer;
  inset?: Inset;
  span?: Span;
  noLabel?: boolean;
}

// Kept clear at each end of a straight side, for the corner.
const CORNER = 12;

const flat: Span = (w, h, sideways) => (sideways ? h : w) - 2 * CORNER;
// Straight along the top and bottom except for `cut(h)` at each end, and not straight at the sides.
const flatAcross =
  (cut: (h: number) => number): Span =>
  (w, h, sideways) =>
    sideways ? 0 : w - 2 * cut(h) - 2 * CORNER;

// How far an ellipse's outline has fallen away from its bounding box, `t` from the middle of a side `half` long.
function bulge(t: number, half: number, depth: number): number {
  const k = Math.min(1, Math.abs(t) / half);
  return depth * (1 - Math.sqrt(1 - k * k));
}

const roundInset: Inset = (w, h, side, t) => (side & 1 ? bulge(t, h / 2, w / 2) : bulge(t, w / 2, h / 2));
const roundSpan: Span = (w, h, sideways) => (sideways ? h : w) * 0.6;
const capInset: Inset = (w, _h, side, t) => (side & 1 ? 0 : bulge(t, w / 2, Math.min(12, Math.max(6, w / 14))));

const fixed = (w: number, h: number): Sizer => () => ({ w, h, dy: 0 });

function triSize(tw: number, th: number, flip: boolean): ShapeSize {
  const w = Math.max(1.6 * tw + 40, 80);
  const h = (th + 10) / (1 - (tw + 8) / w);
  const dy = h / 2 - 10 - th / 2;
  return { w, h, dy: flip ? -dy : dy };
}

function path(d: string, a: string): string {
  return `<path d="${d}"${a}/>`;
}

const leanInset: Inset = (_w, h, side) => (side & 1 ? h / 8 : 0);

const box: Sizer = (tw, th) => ({ w: Math.max(tw + 2 * PAD_X, 2 * PAD_X + 12), h: th + 2 * PAD_Y, dy: 0 });

function poly(points: number[], a: string): string {
  let d = '';
  for (let i = 0; i < points.length; i += 2) d += (i ? ' ' : '') + num(points[i]) + ',' + num(points[i + 1]);
  return `<polygon points="${d}"${a}/>`;
}

function rect(w: number, h: number, a: string, rx = ''): string {
  return `<rect x="${num(-w / 2)}" y="${num(-h / 2)}" width="${num(w)}" height="${num(h)}"${rx}${a}/>`;
}

const SHAPES: Record<string, ShapeDef> = {
  rect: { size: box, span: flat, draw: (w, h, a) => rect(w, h, rounded(a)) },
  rounded: {
    size: box,
    span: flat,
    draw: (w, h, a) => rect(w, h, a, ` rx="${num(Math.min(12, h / 2))}"`),
  },
  stadium: {
    inset: (_w, h, side, t) => (side & 1 ? bulge(t, h / 2, h / 2) : 0),
    span: (w, h, sideways) => (sideways ? h * 0.6 : w - h),
    size: (tw, th) => {
      const h = th + 2 * PAD_Y;
      return { w: tw + h * 0.5 + 2 * PAD_X - 8, h, dy: 0 };
    },
    draw: (w, h, a) => rect(w, h, a, ` rx="${num(h / 2)}"`),
  },
  'fr-rect': {
    span: flat,
    size: (tw, th) => ({ w: tw + 2 * PAD_X + 16, h: th + 2 * PAD_Y, dy: 0 }),
    draw: (w, h, a, line) => {
      const x = w / 2 - 8;
      return (
        rect(w, h, rounded(a)) +
        `<path d="M${num(-x)},${num(-h / 2)}V${num(h / 2)}M${num(x)},${num(-h / 2)}V${num(h / 2)}" fill="none"${line}/>`
      );
    },
  },
  cyl: {
    inset: capInset,
    span: (w, h, sideways) => (sideways ? h - 2 * CORNER - 12 : w * 0.6),
    size: (tw, th) => {
      const w = Math.max(tw + 2 * PAD_X, 56);
      const ry = Math.min(12, Math.max(6, w / 14));
      return { w, h: th + 2 * PAD_Y + 2 * ry, dy: ry / 2 };
    },
    draw: (w, h, a, line) => {
      const rx = w / 2;
      const ry = Math.min(12, Math.max(6, w / 14));
      const top = -h / 2 + ry;
      const bottom = h / 2 - ry;
      return (
        `<path d="M${num(-rx)},${num(top)}A${num(rx)},${num(ry)} 0 0 1 ${num(rx)},${num(top)}V${num(bottom)}A${num(
          rx
        )},${num(ry)} 0 0 1 ${num(-rx)},${num(bottom)}Z"${a}/>` +
        `<path d="M${num(-rx)},${num(top)}A${num(rx)},${num(ry)} 0 0 0 ${num(rx)},${num(top)}" fill="none"${line}/>`
      );
    },
  },
  circle: {
    inset: roundInset,
    span: roundSpan,
    size: (tw, th) => {
      const d = Math.max(Math.sqrt(tw * tw + th * th) + 16, 44);
      return { w: d, h: d, dy: 0 };
    },
    draw: (w, _h, a) => `<circle r="${num(w / 2)}"${a}/>`,
  },
  'dbl-circ': {
    inset: roundInset,
    span: roundSpan,
    size: (tw, th) => {
      const d = Math.max(Math.sqrt(tw * tw + th * th) + 26, 54);
      return { w: d, h: d, dy: 0 };
    },
    draw: (w, _h, a, line) => `<circle r="${num(w / 2)}"${a}/><circle r="${num(w / 2 - 5)}" fill="none"${line}/>`,
  },
  ellipse: {
    inset: roundInset,
    span: roundSpan,
    size: (tw, th) => ({ w: tw * 1.3 + 2 * PAD_X, h: th * 1.2 + 2 * PAD_Y, dy: 0 }),
    draw: (w, h, a) => `<ellipse rx="${num(w / 2)}" ry="${num(h / 2)}"${a}/>`,
  },
  diam: {
    inset: (w, h, side, t) => (side & 1 ? (Math.abs(t) * w) / h : (Math.abs(t) * h) / w),
    span: (w, h, sideways) => (sideways ? h : w) * 0.6,
    size: (tw, th) => {
      const a = tw + 16;
      const b = th + 8;
      return { w: a + 1.6 * b, h: a / 1.6 + b, dy: 0 };
    },
    draw: (w, h, a) => poly([0, -h / 2, w / 2, 0, 0, h / 2, -w / 2, 0], a),
  },
  hex: {
    inset: (_w, _h, side, t) => (side & 1 ? Math.abs(t) / 2 : 0),
    span: (w, h, sideways) => (sideways ? h * 0.5 : w - h / 2 - CORNER),
    size: (tw, th) => {
      const h = th + 2 * PAD_Y;
      return { w: tw + 2 * PAD_X + h / 2, h, dy: 0 };
    },
    draw: (w, h, a) => {
      const m = h / 4;
      return poly([-w / 2 + m, -h / 2, w / 2 - m, -h / 2, w / 2, 0, w / 2 - m, h / 2, -w / 2 + m, h / 2, -w / 2, 0], a);
    },
  },
  odd: {
    inset: (_w, h, side) => (side === 3 ? h / 4 : 0),
    span: flatAcross(() => 0),
    size: (tw, th) => {
      const h = th + 2 * PAD_Y;
      return { w: tw + 2 * PAD_X + h / 4, h, dy: 0 };
    },
    draw: (w, h, a) => {
      const notch = h / 4;
      return poly([-w / 2, -h / 2, w / 2, -h / 2, w / 2, h / 2, -w / 2, h / 2, -w / 2 + notch, 0], a);
    },
  },
  'lean-r': {
    inset: leanInset,
    span: flatAcross((h) => h / 4),
    size: (tw, th) => {
      const h = th + 2 * PAD_Y;
      return { w: tw + 2 * PAD_X + h / 2, h, dy: 0 };
    },
    draw: (w, h, a) => {
      const s = h / 4;
      return poly([-w / 2 + s, -h / 2, w / 2, -h / 2, w / 2 - s, h / 2, -w / 2, h / 2], a);
    },
  },
  'lean-l': {
    inset: leanInset,
    span: flatAcross((h) => h / 4),
    size: (tw, th) => {
      const h = th + 2 * PAD_Y;
      return { w: tw + 2 * PAD_X + h / 2, h, dy: 0 };
    },
    draw: (w, h, a) => {
      const s = h / 4;
      return poly([-w / 2, -h / 2, w / 2 - s, -h / 2, w / 2, h / 2, -w / 2 + s, h / 2], a);
    },
  },
  'trap-b': {
    inset: leanInset,
    span: flatAcross((h) => h / 4),
    size: (tw, th) => {
      const h = th + 2 * PAD_Y;
      return { w: tw + 2 * PAD_X + h / 2, h, dy: 0 };
    },
    draw: (w, h, a) => {
      const s = h / 4;
      return poly([-w / 2 + s, -h / 2, w / 2 - s, -h / 2, w / 2, h / 2, -w / 2, h / 2], a);
    },
  },
  'trap-t': {
    inset: leanInset,
    span: flatAcross((h) => h / 4),
    size: (tw, th) => {
      const h = th + 2 * PAD_Y;
      return { w: tw + 2 * PAD_X + h / 2, h, dy: 0 };
    },
    draw: (w, h, a) => {
      const s = h / 4;
      return poly([-w / 2, -h / 2, w / 2, -h / 2, w / 2 - s, h / 2, -w / 2 + s, h / 2], a);
    },
  },
  text: {
    span: flat,
    size: (tw, th) => ({ w: tw + 8, h: th + 8, dy: 0 }),
    draw: (w, h) => rect(w, h, ' fill="none" stroke="none"'),
  },
  'sm-circ': {
    noLabel: true,
    inset: roundInset,
    span: roundSpan,
    size: fixed(14, 14),
    draw: (w, _h, a) => `<circle r="${num(w / 2)}"${a}/>` },
  'f-circ': {
    noLabel: true,
    inset: roundInset,
    span: roundSpan,
    size: fixed(14, 14),
    draw: (w, _h, _a, line) => `<circle r="${num(w / 2)}" fill="var(--_l)"${line}/>`,
  },
  'fr-circ': {
    noLabel: true,
    inset: roundInset,
    span: roundSpan,
    size: fixed(18, 18),
    draw: (w, _h, a, line) => `<circle r="${num(w / 2)}"${a}/><circle r="${num(w / 2 - 4)}" fill="var(--_l)"${line}/>`,
  },
  fork: {
    noLabel: true,
    span: (w, h, sideways) => (sideways ? h : w) - 8,
    size: fixed(72, 8),
    draw: (w, h, _a, line) => rect(w, h, ` fill="var(--_l)"${line}`, ' rx="2"'),
  },
  'notch-rect': {
    size: box,
    span: flat,
    draw: (w, h, a) => {
      const c = 10;
      return poly([-w / 2 + c, -h / 2, w / 2, -h / 2, w / 2, h / 2, -w / 2, h / 2, -w / 2, -h / 2 + c], a);
    },
  },
  'lin-rect': {
    span: flat,
    size: (tw, th) => ({ w: tw + 2 * PAD_X + 8, h: th + 2 * PAD_Y, dy: 0 }),
    draw: (w, h, a, line) =>
      rect(w, h, rounded(a)) +
      `<path d="M${num(-w / 2 + 8)},${num(-h / 2)}V${num(h / 2)}" fill="none"${line}/>`,
  },
  'div-rect': {
    span: flat,
    size: (tw, th) => ({ w: tw + 2 * PAD_X, h: th + 2 * PAD_Y + 8, dy: 4 }),
    draw: (w, h, a, line) =>
      rect(w, h, rounded(a)) +
      `<path d="M${num(-w / 2)},${num(-h / 2 + 8)}H${num(w / 2)}" fill="none"${line}/>`,
  },
  'win-pane': {
    span: flat,
    size: (tw, th) => ({ w: tw + 2 * PAD_X + 8, h: th + 2 * PAD_Y + 8, dy: 4 }),
    draw: (w, h, a, line) =>
      rect(w, h, rounded(a)) +
      `<path d="M${num(-w / 2 + 8)},${num(-h / 2)}V${num(h / 2)}M${num(-w / 2)},${num(-h / 2 + 8)}H${num(
        w / 2
      )}" fill="none"${line}/>`,
  },
  tri: {
    inset: (w, _h, side) => (side & 1 ? w / 4 : 0),
    size: (tw, th) => triSize(tw, th, false),
    draw: (w, h, a) => poly([0, -h / 2, w / 2, h / 2, -w / 2, h / 2], a),
  },
  'flip-tri': {
    inset: (w, _h, side) => (side & 1 ? w / 4 : 0),
    size: (tw, th) => triSize(tw, th, true),
    draw: (w, h, a) => poly([-w / 2, -h / 2, w / 2, -h / 2, 0, h / 2], a),
  },
  'sl-rect': {
    inset: (_w, _h, side) => (side === 0 ? 5 : 0),
    size: (tw, th) => ({ w: tw + 2 * PAD_X, h: th + 2 * PAD_Y + 10, dy: 5 }),
    draw: (w, h, a) => poly([-w / 2, -h / 2 + 10, w / 2, -h / 2, w / 2, h / 2, -w / 2, h / 2], a),
  },
  'notch-pent': {
    span: flat,
    size: (tw, th) => ({ w: tw + 2 * PAD_X, h: th + 2 * PAD_Y, dy: 0 }),
    draw: (w, h, a) => {
      const c = 10;
      return poly([-w / 2 + c, -h / 2, w / 2 - c, -h / 2, w / 2, -h / 2 + c, w / 2, h / 2, -w / 2, h / 2, -w / 2, -h / 2 + c], a);
    },
  },
  hourglass: {
    noLabel: true,
    inset: (w, _h, side) => (side & 1 ? w / 2 : 0),
    size: fixed(32, 40),
    draw: (w, h, a) => poly([-w / 2, -h / 2, w / 2, -h / 2, -w / 2, h / 2, w / 2, h / 2], a),
  },
  delay: {
    size: (tw, th) => {
      const h = th + 2 * PAD_Y;
      return { w: tw + 2 * PAD_X + h / 4, h, dy: 0 };
    },
    draw: (w, h, a) => {
      const r = h / 2;
      return `<path d="M${num(-w / 2)},${num(-r)}H${num(w / 2 - r)}A${num(r)},${num(r)} 0 0 1 ${num(w / 2 - r)},${num(
        r
      )}H${num(-w / 2)}Z"${a}/>`;
    },
  },
  'h-cyl': {
    size: (tw, th) => {
      const h = th + 2 * PAD_Y;
      const rx = Math.min(12, h / 4);
      return { w: tw + 2 * PAD_X + 2 * rx, h, dy: 0 };
    },
    draw: (w, h, a, line) => {
      const ry = h / 2;
      const rx = Math.min(12, h / 4);
      const l = -w / 2 + rx;
      const r = w / 2 - rx;
      return (
        `<path d="M${num(l)},${num(-ry)}H${num(r)}A${num(rx)},${num(ry)} 0 0 1 ${num(r)},${num(ry)}H${num(l)}A${num(
          rx
        )},${num(ry)} 0 0 1 ${num(l)},${num(-ry)}Z"${a}/>` +
        `<path d="M${num(r)},${num(-ry)}A${num(rx)},${num(ry)} 0 0 0 ${num(r)},${num(ry)}" fill="none"${line}/>`
      );
    },
  },
  'cross-circ': {
    noLabel: true,
    inset: roundInset,
    span: roundSpan,
    size: fixed(44, 44),
    draw: (w, _h, a, line) => {
      const r = w / 2;
      const k = r * Math.SQRT1_2;
      return (
        `<circle r="${num(r)}"${a}/>` +
        `<path d="M${num(-k)},${num(-k)}L${num(k)},${num(k)}M${num(k)},${num(-k)}L${num(-k)},${num(k)}" fill="none"${line}/>`
      );
    },
  },
  'st-rect': {
    span: (w, h, sideways) => (sideways ? h : w) - 2 * CORNER - 8,
    size: (tw, th) => ({ w: tw + 2 * PAD_X + 8, h: th + 2 * PAD_Y + 8, dy: 4 }),
    draw: (w, h, a) => {
      const bw = w - 8;
      const bh = h - 8;
      let out = '';
      for (let i = 0; i < 3; i++) {
        const x = -w / 2 + (2 - i) * 4;
        const y = -h / 2 + i * 4;
        out += `<rect x="${num(x)}" y="${num(y)}" width="${num(bw)}" height="${num(bh)}"${rounded(a)}/>`;
      }
      return out;
    },
  },
  doc: {
    inset: (_w, _h, side) => (side === 2 ? 10 : 0),
    size: (tw, th) => ({ w: tw + 2 * PAD_X, h: th + 2 * PAD_Y + 10, dy: -5 }),
    draw: (w, h, a) => wave(w, h, a),
  },
  flag: {
    inset: (_w, _h, side) => (side & 1 ? 0 : 8),
    size: (tw, th) => ({ w: tw + 2 * PAD_X, h: th + 2 * PAD_Y + 16, dy: 0 }),
    draw: (w, h, a) => {
      const x = w / 2;
      const y = h / 2 - 8;
      const q = w / 4;
      return `<path d="M${num(-x)},${num(-y)}q${num(q)},-10 ${num(2 * q)},0t${num(2 * q)},0V${num(y)}q${num(-q)},10 ${num(
        -2 * q
      )},0t${num(-2 * q)},0Z"${a}/>`;
    },
  },
  datastore: {
    size: box,
    span: flat,
    draw: (w, h, a, line) =>
      rect(w, h, a.replace('stroke="var(--_b)"', 'stroke="none"')) +
      `<path d="M${num(-w / 2)},${num(-h / 2)}H${num(w / 2)}M${num(-w / 2)},${num(h / 2)}H${num(w / 2)}" fill="none"${line}/>`,
  },
  folder: {
    size: (tw, th) => ({ w: Math.max(tw + 2 * PAD_X, 64), h: th + 2 * PAD_Y + 8, dy: 4 }),
    draw: (w, h, a) => {
      const x = w / 2;
      const y = h / 2;
      const tab = Math.min(w * 0.4, 48);
      return path(
        `M${num(-x)},${num(-y)}H${num(-x + tab)}L${num(-x + tab + 8)},${num(-y + 8)}H${num(x)}V${num(y)}H${num(-x)}Z`,
        a
      );
    },
  },
  bucket: {
    size: (tw, th) => ({ w: tw + 2 * PAD_X + 20, h: th + 2 * PAD_Y + 10, dy: 3 }),
    inset: (_w, h, side) => (side & 1 ? h / 12 : 0),
    draw: (w, h, a, line) => {
      const x = w / 2;
      const y = h / 2;
      const ry = 5;
      const taper = h / 6;
      return (
        path(
          `M${num(-x)},${num(-y + ry)}A${num(x)},${num(ry)} 0 0 1 ${num(x)},${num(-y + ry)}L${num(x - taper)},${num(
            y - ry
          )}A${num(x - taper)},${num(ry)} 0 0 1 ${num(-x + taper)},${num(y - ry)}Z`,
          a
        ) + `<path d="M${num(-x)},${num(-y + ry)}A${num(x)},${num(ry)} 0 0 0 ${num(x)},${num(-y + ry)}" fill="none"${line}/>`
      );
    },
  },
  console: {
    span: flat,
    size: (tw, th) => ({ w: Math.max(tw + 2 * PAD_X, 72), h: th + 2 * PAD_Y + 12, dy: 6 }),
    draw: (w, h, a, line) =>
      rect(w, h, rounded(a)) +
      `<path d="M${num(-w / 2)},${num(-h / 2 + 12)}H${num(w / 2)}M${num(-w / 2 + 7)},${num(-h / 2 + 4)}l3,2.5l-3,2.5M${num(
        -w / 2 + 13
      )},${num(-h / 2 + 9)}h4" fill="none"${line}/>`,
  },
  browser: {
    span: flat,
    size: (tw, th) => ({ w: Math.max(tw + 2 * PAD_X, 72), h: th + 2 * PAD_Y + 12, dy: 6 }),
    draw: (w, h, a, line) => {
      let dots = '';
      for (let i = 0; i < 3; i++) dots += `<circle cx="${num(-w / 2 + 8 + i * 7)}" cy="${num(-h / 2 + 6)}" r="1.5" fill="none"${line}/>`;
      return rect(w, h, rounded(a)) + `<path d="M${num(-w / 2)},${num(-h / 2 + 12)}H${num(w / 2)}" fill="none"${line}/>` + dots;
    },
  },
  person: {
    size: (tw, th) => ({ w: Math.max(tw + 2 * PAD_X, 56), h: th + 2 * PAD_Y + 26, dy: 13 }),
    draw: (w, h, a) => {
      const top = -h / 2;
      return (
        `<rect x="${num(-w / 2)}" y="${num(top + 26)}" width="${num(w)}" height="${num(h - 26)}" rx="12"${a}/>` +
        `<circle cy="${num(top + 14)}" r="13"${a}/>`
      );
    },
  },
  bang: {
    size: (tw, th) => ({ w: tw + 2 * PAD_X + 28, h: th + 2 * PAD_Y + 24, dy: 0 }),
    inset: () => 3,
    draw: (w, h, a) => {
      const spikes = 14;
      const pts: number[] = [];
      for (let i = 0; i < spikes * 2; i++) {
        const angle = (Math.PI * i) / spikes - Math.PI / 2;
        const k = i % 2 === 0 ? 1 : 0.82;
        pts.push(Math.cos(angle) * (w / 2) * k, Math.sin(angle) * (h / 2) * k);
      }
      return poly(pts, a);
    },
  },
  cloud: {
    size: (tw, th) => ({ w: tw + 2 * PAD_X + 32, h: th + 2 * PAD_Y + 24, dy: 0 }),
    inset: (_w, _h, side) => (side & 1 ? 2 : 1),
    draw: (w, h, a) => {
      const x = w / 2;
      const y = h / 2;
      const r = y * 0.55;
      return path(
        `M${num(-x + r)},${num(y)}A${num(r)},${num(r)} 0 0 1 ${num(-x + r * 0.6)},${num(-y * 0.1)}A${num(x * 0.42)},${num(
          y * 0.7
        )} 0 0 1 ${num(-x * 0.1)},${num(-y * 0.72)}A${num(x * 0.4)},${num(y * 0.62)} 0 0 1 ${num(x * 0.62)},${num(
          -y * 0.42
        )}A${num(r * 1.05)},${num(r * 1.05)} 0 0 1 ${num(x - r)},${num(y)}Z`,
        a
      );
    },
  },
  brace: {
    size: (tw, th) => ({ w: tw + 2 * PAD_X + 12, h: th + 2 * PAD_Y, dy: 0 }),
    draw: (w, h, _a, line) => rect(w, h, ' fill="none" stroke="none"') + brace(-w / 2 + 12, h, -1, line),
  },
  'brace-r': {
    size: (tw, th) => ({ w: tw + 2 * PAD_X + 12, h: th + 2 * PAD_Y, dy: 0 }),
    draw: (w, h, _a, line) => rect(w, h, ' fill="none" stroke="none"') + brace(w / 2 - 12, h, 1, line),
  },
  braces: {
    size: (tw, th) => ({ w: tw + 2 * PAD_X + 24, h: th + 2 * PAD_Y, dy: 0 }),
    draw: (w, h, _a, line) =>
      rect(w, h, ' fill="none" stroke="none"') + brace(-w / 2 + 12, h, -1, line) + brace(w / 2 - 12, h, 1, line),
  },
  bolt: {
    noLabel: true,
    size: fixed(36, 56),
    inset: (w, _h, side) => (side & 1 ? w / 4 : 0),
    draw: (w, h, a) => poly([w * 0.15, -h / 2, -w / 2, h * 0.08, -w * 0.05, h * 0.08, -w * 0.15, h / 2, w / 2, -h * 0.08, w * 0.05, -h * 0.08], a),
  },
  'lin-cyl': {
    inset: capInset,
    span: (w, h, sideways) => (sideways ? h - 2 * CORNER - 20 : w * 0.6),
    size: (tw, th) => {
      const w = Math.max(tw + 2 * PAD_X, 56);
      const ry = Math.min(12, Math.max(6, w / 14));
      return { w, h: th + 2 * PAD_Y + 2 * ry + 8, dy: ry / 2 + 4 };
    },
    draw: (w, h, a, line) => {
      const rx = w / 2;
      const ry = Math.min(12, Math.max(6, w / 14));
      const top = -h / 2 + ry;
      const bottom = h / 2 - ry;
      const arc = (y: number): string => `M${num(-rx)},${num(y)}A${num(rx)},${num(ry)} 0 0 0 ${num(rx)},${num(y)}`;
      return (
        path(
          `M${num(-rx)},${num(top)}A${num(rx)},${num(ry)} 0 0 1 ${num(rx)},${num(top)}V${num(bottom)}A${num(rx)},${num(
            ry
          )} 0 0 1 ${num(-rx)},${num(bottom)}Z`,
          a
        ) + `<path d="${arc(top)}${arc(top + 8)}" fill="none"${line}/>`
      );
    },
  },
  'curv-trap': {
    size: (tw, th) => {
      const h = th + 2 * PAD_Y;
      return { w: tw + 2 * PAD_X + h * 0.6, h, dy: 0 };
    },
    draw: (w, h, a) => {
      const x = w / 2;
      const y = h / 2;
      const k = h * 0.3;
      return path(
        `M${num(-x + k)},${num(-y)}H${num(x - k)}A${num(k)},${num(y)} 0 0 1 ${num(x - k)},${num(y)}H${num(-x + k)}L${num(
          -x
        )},0Z`,
        a
      );
    },
  },
  docs: {
    size: (tw, th) => ({ w: tw + 2 * PAD_X + 8, h: th + 2 * PAD_Y + 18, dy: -1 }),
    inset: (_w, _h, side) => (side === 2 ? 10 : 0),
    draw: (w, h, a) => {
      let out = '';
      for (let i = 0; i < 3; i++) {
        out += `<g transform="translate(${(1 - i) * 4},${(i - 1) * 4})">${wave(w - 8, h - 8, a)}</g>`;
      }
      return out;
    },
  },
  'bow-rect': {
    size: (tw, th) => {
      const h = th + 2 * PAD_Y;
      return { w: tw + 2 * PAD_X + h * 0.4, h, dy: 0 };
    },
    inset: (_w, h, side) => (side === 1 ? h * 0.2 : 0),
    draw: (w, h, a) => {
      const x = w / 2;
      const y = h / 2;
      const k = h * 0.2;
      return path(
        `M${num(-x + k)},${num(-y)}H${num(x)}A${num(k)},${num(y)} 0 0 0 ${num(x)},${num(y)}H${num(-x + k)}A${num(k)},${num(
          y
        )} 0 0 1 ${num(-x + k)},${num(-y)}Z`,
        a
      );
    },
  },
  'tag-rect': {
    size: box,
    span: flat,
    draw: (w, h, a, line) =>
      rect(w, h, rounded(a)) +
      `<path d="M${num(w / 2 - 12)},${num(h / 2)}L${num(w / 2)},${num(h / 2 - 12)}" fill="none"${line}/>`,
  },
  'tag-doc': {
    size: (tw, th) => ({ w: tw + 2 * PAD_X, h: th + 2 * PAD_Y + 10, dy: -5 }),
    inset: (_w, _h, side) => (side === 2 ? 10 : 0),
    draw: (w, h, a, line) =>
      wave(w, h, a) + `<path d="M${num(w / 2 - 12)},${num(h / 2 - 14)}L${num(w / 2)},${num(h / 2 - 26)}" fill="none"${line}/>`,
  },
  'lin-doc': {
    size: (tw, th) => ({ w: tw + 2 * PAD_X + 8, h: th + 2 * PAD_Y + 10, dy: -5 }),
    inset: (_w, _h, side) => (side === 2 ? 10 : 0),
    draw: (w, h, a, line) =>
      wave(w, h, a) + `<path d="M${num(-w / 2 + 8)},${num(-h / 2)}V${num(h / 2 - 6)}" fill="none"${line}/>`,
  },
  collapsedGroup: {
    size: (tw, th) => ({ w: tw + 2 * PAD_X + 8, h: th + 2 * PAD_Y + 8, dy: -2 }),
    draw: (w, h, a) =>
      `<rect x="${num(-w / 2 + 6)}" y="${num(-h / 2 + 8)}" width="${num(w - 12)}" height="${num(h - 8)}"${rounded(a)}/>` +
      `<rect x="${num(-w / 2)}" y="${num(-h / 2)}" width="${num(w)}" height="${num(h - 4)}"${rounded(a)}/>`,
  },
};

function brace(x: number, h: number, dir: number, line: string): string {
  const y = h / 2;
  const k = 6 * dir;
  return `<path d="M${num(x)},${num(-y)}q${num(k)},0 ${num(k)},6V-6q0,6 ${num(k)},6q${num(-k)},0 ${num(-k)},6V${num(
    y - 6
  )}q0,6 ${num(-k)},6" fill="none"${line}/>`;
}

function wave(w: number, h: number, a: string): string {
  const x = w / 2;
  const top = -h / 2;
  const base = h / 2 - 10;
  const q = w / 4;
  return `<path d="M${num(-x)},${num(top)}H${num(x)}V${num(base)}q${num(-q)},-12 ${num(-2 * q)},0t${num(
    -2 * q
  )},0Z"${a}/>`;
}

const FALLBACK = SHAPES.rect;

// Looked up through a Map so that names like "constructor" cannot reach Object.prototype.
const BY_NAME = new Map(Object.entries(SHAPES));

export function shapeSize(shape: string, tw: number, th: number): ShapeSize {
  return (BY_NAME.get(shape) ?? FALLBACK).size(tw, th);
}

export function drawShape(shape: string, w: number, h: number, a: string, line: string): string {
  return (BY_NAME.get(shape) ?? FALLBACK).draw(w, h, a, line);
}

export function shapeInset(shape: string, w: number, h: number, side: number, t = 0): number {
  return BY_NAME.get(shape)?.inset?.(w, h, side, t) ?? 0;
}

// How much of a side of the shape edges may spread along, when the flow runs down or, if `sideways`, across.
export function shapeSpan(shape: string, w: number, h: number, sideways: boolean): number {
  return Math.max(0, BY_NAME.get(shape)?.span?.(w, h, sideways) ?? 0);
}

export function shapeHasLabel(shape: string): boolean {
  return BY_NAME.get(shape)?.noLabel !== true;
}

// The side of a node's layout box that a route end lies on: 0 top, 1 right, 2 bottom, 3 left, or -1 for none.
export function endSide(route: number[], at: number, c: CNode): number {
  const dx = route[at] - c.x;
  const dy = route[at + 1] - c.y;
  if (Math.abs(Math.abs(dy) - c.h / 2) < 0.5) return dy < 0 ? 0 : 2;
  if (Math.abs(Math.abs(dx) - c.w / 2) < 0.5) return dx < 0 ? 3 : 1;
  return -1;
}

// Moves a route end from a node's layout box onto the outline of the shape drawn in it.
export function insetRoute(route: number[], at: number, view: { shape: string; w: number; h: number }, c: CNode): void {
  if (c.isGroup) return;
  const side = endSide(route, at, c);
  if (side === 0 || side === 2) {
    const amount = shapeInset(view.shape, view.w, view.h, side, route[at] - c.x) + (c.h - view.h) / 2;
    route[at + 1] += side === 0 ? amount : -amount;
  } else if (side >= 0) {
    const amount = shapeInset(view.shape, view.w, view.h, side, route[at + 1] - c.y) + (c.w - view.w) / 2;
    route[at] += side === 3 ? amount : -amount;
  }
}
