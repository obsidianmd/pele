import { labelSvg, num, type IconResolver } from '../../svg/builder.js';
import { ROUNDED } from '../../svg/theme.js';
import type { Label } from '../../text/label.js';

const PAD_X = 16;
const PAD_Y = 10;
const GLYPH = 34;
const GLYPH_GAP = 4;
const STACK = 5;
const CAP = 6;
const SHAPE = ' fill="var(--_s)" stroke="var(--_b)"';
const LINE = ' fill="none" stroke="var(--_b)"';

const KINDS = new Set(['participant', 'actor', 'boundary', 'control', 'entity', 'database', 'collections', 'queue']);
const FIGURES = new Set(['actor', 'boundary', 'control', 'entity', 'database']);

export interface ActorSize {
  w: number;
  h: number;
}

export function actorKind(type: string): string {
  return KINDS.has(type) ? type : 'participant';
}

// A figure stands above its label. The other kinds hold the label inside.
export function isFigure(kind: string): boolean {
  return FIGURES.has(kind);
}

export function actorSize(kind: string, label: Label, minW: number, minH: number, paddingX = PAD_X): ActorSize {
  if (isFigure(kind)) return { w: Math.max(40, label.width + 8), h: GLYPH + (label.height > 0 ? GLYPH_GAP + label.height : 0) };
  const extra = kind === 'collections' ? STACK : kind === 'queue' ? 2 * CAP : 0;
  return {
    w: Math.max(minW, label.width + 2 * paddingX) + extra,
    h: Math.max(minH, label.height + 2 * PAD_Y) + (kind === 'collections' ? STACK : 0),
  };
}

function figure(kind: string, cx: number, top: number): string {
  const x = num(cx);
  const y = (dy: number): string => num(top + dy);
  switch (kind) {
    case 'actor':
      return (
        `<circle cx="${x}" cy="${y(7)}" r="6"${SHAPE}/>` +
        `<path d="M${x},${y(13)}V${y(24)}M${num(cx - 10)},${y(17)}H${num(cx + 10)}M${num(cx - 8)},${y(34)}L${x},${y(24)}L${num(
          cx + 8
        )},${y(34)}"${LINE}/>`
      );
    case 'boundary':
      return (
        `<path d="M${num(cx - 19)},${y(6)}V${y(28)}M${num(cx - 19)},${y(17)}H${num(cx - 8)}"${LINE}/>` +
        `<circle cx="${num(cx + 3)}" cy="${y(17)}" r="11"${SHAPE}/>`
      );
    case 'control':
      return (
        `<circle cx="${x}" cy="${y(21)}" r="11"${SHAPE}/>` +
        `<path d="M${num(cx + 5)},${y(5)}L${num(cx - 1)},${y(10)}L${num(cx + 5)},${y(15)}"${LINE}/>`
      );
    case 'entity':
      return (
        `<circle cx="${x}" cy="${y(15)}" r="11"${SHAPE}/>` + `<path d="M${num(cx - 11)},${y(30)}H${num(cx + 11)}"${LINE}/>`
      );
    default: {
      const l = num(cx - 14);
      const r = num(cx + 14);
      return (
        `<path d="M${l},${y(7)}V${y(27)}A14,5 0 0 0 ${r},${y(27)}V${y(7)}A14,5 0 0 0 ${l},${y(7)}Z"${SHAPE}/>` +
        `<path d="M${l},${y(7)}A14,5 0 0 0 ${r},${y(7)}"${LINE}/>`
      );
    }
  }
}

// Draws a participant whose bounding box has its top center at (cx, top).
export function drawActor(
  kind: string,
  cx: number,
  top: number,
  size: ActorSize,
  label: Label,
  icons: IconResolver | undefined
): string {
  const { w, h } = size;
  const text = ' class="pele-label"';
  if (isFigure(kind)) {
    return figure(kind, cx, top) + labelSvg(label, cx, top + GLYPH + GLYPH_GAP + label.height / 2, text, icons);
  }
  const left = cx - w / 2;
  if (kind === 'collections') {
    const bw = w - STACK;
    const bh = h - STACK;
    const back = `<rect x="${num(left + STACK)}" y="${num(top)}" width="${num(bw)}" height="${num(bh)}"${SHAPE}${ROUNDED}/>`;
    const front = `<rect x="${num(left)}" y="${num(top + STACK)}" width="${num(bw)}" height="${num(bh)}"${SHAPE}${ROUNDED}/>`;
    return back + front + labelSvg(label, left + bw / 2, top + STACK + bh / 2, text, icons);
  }
  if (kind === 'queue') {
    const l = num(left + CAP);
    const r = num(left + w - CAP);
    const b = num(top + h);
    const ry = num(h / 2);
    return (
      `<path d="M${l},${num(top)}H${r}A${CAP},${ry} 0 0 1 ${r},${b}H${l}A${CAP},${ry} 0 0 1 ${l},${num(top)}Z"${SHAPE}/>` +
      `<path d="M${r},${num(top)}A${CAP},${ry} 0 0 0 ${r},${b}"${LINE}/>` +
      labelSvg(label, cx - CAP / 2, top + h / 2, text, icons)
    );
  }
  return (
    `<rect x="${num(left)}" y="${num(top)}" width="${num(w)}" height="${num(h)}"${SHAPE}${ROUNDED}/>` +
    labelSvg(label, cx, top + h / 2, text, icons)
  );
}
