import type { Config } from '../../preprocess.js';
import { esc, escText, labelSvg, num } from '../../svg/builder.js';
import { svgDocument } from '../../svg/root.js';
import { FONT_MONO, ROUNDED } from '../../svg/theme.js';
import { decodeEntities } from '../../text/entities.js';
import { layoutLabel } from '../../text/label.js';
import { Style, defaultMeasurer, type TextMeasurer } from '../../text/measurer.js';
import type { RenderOptions, Rendered } from '../../types.js';
import { tighten, titleRoom } from '../common/fit-width.js';
import { NONE, fold, parts } from './common.js';
import type { RailroadModel, RailroadNode } from './types.js';

const enum Kind {
  Terminal,
  NonTerminal,
  Special,
  Sequence,
  Choice,
  Bypass,
  Loop,
  Folded,
}

// A laid-out element. The track enters at the left edge and leaves at the right edge on one
// baseline, with `up` above it and `down` below it.
interface Box {
  kind: Kind;
  width: number;
  up: number;
  down: number;
  kids: readonly Box[];
  // A leaf's text, or a loop's count.
  text: string;
  // The name a non-terminal refers to.
  id: string;
  // How far a bypass rises above the baseline, or a loop drops below it.
  reach: number;
}

interface Metrics {
  measurer: TextMeasurer;
  size: number;
  padding: number;
  height: number;
  // Space between elements in a sequence, and between stacked branches.
  gap: number;
  sep: number;
  arc: number;
}

const LEAD = 12;
const HEAD_GAP = 6;
const RULE_GAP = 18;
const COUNT_SIZE = 12;
const ARROW = 7;

function option(config: Config, key: string, fallback: number, max: number): number {
  const value = (config.railroad as Config | undefined)?.[key];
  return typeof value === 'number' && value >= 0 ? Math.min(value, max) : fallback;
}

const RE_CONTROL = /[\n\r\t]/g;

// Text is literal here: a terminal such as "<br>" or "*" is itself, not markup. Mermaid's `#35;`
// codes still stand for characters, and escapes that would be invisible are written out.
function shown(text: string): string {
  const s = text.includes('¶ß') ? decodeEntities(text.replace(/&/g, '&amp;')) : text;
  return s.replace(RE_CONTROL, (c) => (c === '\n' ? '\\n' : c === '\r' ? '\\r' : '\\t'));
}

function reverse<T>(list: T[], from: number): void {
  for (let i = from, j = list.length - 1; i < j; i++, j--) {
    const held = list[i];
    list[i] = list[j];
    list[j] = held;
  }
}

function even(value: number): number {
  return Math.ceil(value / 2) * 2;
}

function leaf(kind: Kind, text: string, id: string, style: number, m: Metrics): Box {
  const half = m.height / 2;
  const width = Math.max(even(m.measurer.width(text, m.size, style) + 2 * m.padding), m.height);
  return { kind, width, up: half, down: half, kids: NONE, text, id, reach: 0 };
}

function count(min: number, max: number): string {
  if (max === Infinity && min <= 1) return '';
  const text = (value: number): string => (Number.isFinite(value) ? String(value) : '∞');
  if (min === max) return text(min) + '×';
  if (max === Infinity) return '≥' + text(min) + '×';
  return min === 0 ? '≤' + text(max) + '×' : text(min) + '–' + text(max) + '×';
}

// Where the next branch of a choice sits below the baseline, given the one above it.
function below(offset: number, above: Box, branch: Box, m: Metrics): number {
  return Math.max(offset + above.down + m.sep + branch.up, 2 * m.arc);
}

function bypass(kid: Box, m: Metrics): Box {
  const reach = Math.max(kid.up + m.sep, 2 * m.arc);
  return { kind: Kind.Bypass, width: kid.width + 4 * m.arc, up: reach, down: kid.down, kids: [kid], text: '', id: '', reach };
}

function measure(root: RailroadNode, m: Metrics, room = Infinity): Box {
  const budgets = new Map<RailroadNode, number>();
  const pending: [RailroadNode, number][] = [[root, room]];
  for (let i = 0; room !== Infinity && i < pending.length; i++) {
    const [node, width] = pending[i];
    budgets.set(node, width);
    // A sequence that folds puts its rows inside rails, so its parts are sized for those rows.
    const around = node.type === 'choice' || node.type === 'optional' ? 4 * m.arc : node.type === 'repetition' ? (node.min === 0 ? 6 : 2) * m.arc : node.type === 'sequence' ? 6 * m.arc : 0;
    for (const child of parts(node)) pending.push([child, Math.max(40, width - around)]);
  }
  return fold<RailroadNode, Box>(root, parts, (node, kids) => {
    const room = budgets.get(node) ?? Infinity;
    switch (node.type) {
      case 'terminal': {
        const text = shown(node.value);
        return leaf(Kind.Terminal, /^ +$/.test(text) ? '␣'.repeat(text.length) : text, '', Style.Mono, m);
      }
      case 'nonterminal':
        return leaf(Kind.NonTerminal, shown(node.name), node.name, 0, m);
      case 'special':
        return leaf(Kind.Special, '? ' + shown(node.text) + ' ?', '', Style.Italic, m);
      case 'sequence': {
        let width = Math.max(0, kids.length - 1) * m.gap;
        let up = 0;
        let down = 0;
        for (const kid of kids) {
          width += kid.width;
          up = Math.max(up, kid.up);
          down = Math.max(down, kid.down);
        }
        const sequence: Box = { kind: Kind.Sequence, width, up, down, kids, text: '', id: '', reach: 0 };
        if (width <= room || kids.length < 2) return sequence;
        const rows: Box[] = [];
        let row: Box[] = [];
        let rowW = 0;
        const flush = (): void => {
          let up = 0, down = 0;
          for (const kid of row) { up = Math.max(up, kid.up); down = Math.max(down, kid.down); }
          rows.push({ kind: Kind.Sequence, width: rowW, up, down, kids: row, text: '', id: '', reach: 0 });
          row = []; rowW = 0;
        };
        for (const kid of kids) {
          if (row.length && rowW + m.gap + kid.width > Math.max(40, room - 6 * m.arc)) flush();
          rowW += (row.length ? m.gap : 0) + kid.width;
          row.push(kid);
        }
        flush();
        if (rows.length < 2) return sequence;
        let foldedWidth = 0, offset = 0;
        for (let i = 0; i < rows.length; i++) {
          foldedWidth = Math.max(foldedWidth, rows[i].width);
          if (i) offset += rows[i - 1].down + Math.max(m.sep, 2 * m.arc) + rows[i].up;
        }
        return { kind: Kind.Folded, width: foldedWidth + 6 * m.arc, up: rows[0].up, down: offset + rows[rows.length - 1].down, kids: rows, text: '', id: '', reach: 0 };
      }
      case 'choice': {
        let inner = 0;
        let offset = 0;
        for (let i = 0; i < kids.length; i++) {
          inner = Math.max(inner, kids[i].width);
          if (i > 0) offset = below(offset, kids[i - 1], kids[i], m);
        }
        const last = kids[kids.length - 1];
        return {
          kind: Kind.Choice,
          width: inner + 4 * m.arc,
          up: kids.length > 0 ? kids[0].up : 0,
          down: last ? offset + last.down : 0,
          kids,
          text: '',
          id: '',
          reach: 0,
        };
      }
      case 'optional':
        return bypass(kids[0], m);
      case 'repetition': {
        const { min, max } = node;
        const kid = kids[0];
        if (min === 1 && max === 1) return kid;
        const text = count(min, max);
        const reach = Math.max(kid.down + m.sep, 2 * m.arc);
        const label = text === '' ? 0 : even(m.measurer.width(text, COUNT_SIZE, 0));
        const loop: Box = {
          kind: Kind.Loop,
          width: Math.max(kid.width, label) + 2 * m.arc,
          up: kid.up,
          down: reach + (text === '' ? ARROW / 2 + 1 : COUNT_SIZE + 6),
          kids: [kid],
          text,
          id: '',
          reach,
        };
        return min === 0 ? bypass(loop, m) : loop;
      }
    }
  });
}

export function renderRailroad(model: RailroadModel, config: Config, options: RenderOptions): Rendered {
  return tighten(options, (tight) => draw(model, config, options, tight));
}

function draw(model: RailroadModel, config: Config, options: RenderOptions, tight: boolean): Rendered {
  const base = options.fontSize ?? 16;
  const fontSize = option(config, 'fontSize', 0, 200);
  const size = fontSize || Math.round(base * 0.875);
  const headSize = fontSize || base;
  const padding = option(config, 'padding', -1, 200);
  const lineHeight = Math.round(size * 1.5);
  const m: Metrics = {
    measurer: options.measurer ?? defaultMeasurer(options.fontFamily, options.fontFamilyMono),
    size,
    padding: padding < 0 ? 12 : padding,
    height: even(lineHeight + (padding < 0 ? 9 : 2 * padding)),
    gap: Math.min(option(config, 'horizontalSeparation', 16, 500), tight ? 12 : Infinity),
    sep: option(config, 'verticalSeparation', 10, 500),
    arc: Math.min(option(config, 'arcRadius', 10, 200), tight ? 6 : Infinity),
  };
  const radius = (config.railroad as Config | undefined)?.showMarkers === false ? 0 : option(config, 'markerRadius', 4, 50);
  const strokeWidth = option(config, 'strokeWidth', 0, 20);
  const stroke = strokeWidth > 0 ? ` stroke-width="${num(strokeWidth)}"` : '';
  const pad = options.padding ?? 8;
  const { arc } = m;

  const A = num(arc);
  const turn = (sweep: number, dx: string, dy: string): string => `a${A},${A} 0 0 ${sweep} ${dx}${A},${dy}${A}`;
  const eastToSouth = turn(1, '', '');
  const southToEast = turn(0, '', '');
  const eastToNorth = turn(0, '', '-');
  const northToEast = turn(1, '', '-');
  const loopDown = turn(0, '-', '');
  const loopUp = turn(0, '-', '-');

  const title = layoutLabel(model.title, false, m.measurer, base, tight ? titleRoom(options) : 4000, Style.Bold);
  const titleHeight = title.height > 0 ? title.height + 16 : 0;
  const headHeight = Math.round(headSize * 1.5);
  const textShift = size * 0.35;
  const boxTop = m.height / 2;

  let track = '';
  let arrows = '';
  let nodes = '';

  const line = (x1: number, y: number, x2: number): void => {
    if (x2 > x1) track += `M${num(x1)},${num(y)}H${num(x2)}`;
  };

  const place = (root: Box, left: number, baseline: number): void => {
    const boxes: Box[] = [root];
    const at: number[] = [left, baseline];
    while (boxes.length > 0) {
      const box = boxes.pop()!;
      const y = at.pop()!;
      const x = at.pop()!;
      const kids = box.kids;
      const right = x + box.width;
      switch (box.kind) {
        case Kind.Sequence: {
          let kx = right;
          for (let i = kids.length - 1; i >= 0; i--) {
            kx -= kids[i].width;
            boxes.push(kids[i]);
            at.push(kx, y);
            if (i > 0) line(kx - m.gap, y, kx);
            kx -= m.gap;
          }
          break;
        }
        case Kind.Folded: {
          const start = x + 2 * arc;
          const from = boxes.length;
          let offset = 0;
          line(x, y, start);
          for (let i = 0; i < kids.length; i++) {
            const kid = kids[i];
            const ky = y + offset;
            boxes.push(kid); at.push(ky, start);
            if (i + 1 < kids.length) {
              const next = kids[i + 1];
              const nextOffset = offset + kid.down + Math.max(m.sep, 2 * arc) + next.up;
              const mid = y + offset + kid.down + Math.max(m.sep, 2 * arc) / 2;
              track += `M${num(start + kid.width)},${num(ky)}H${num(right - 2 * arc)}V${num(mid)}H${num(x + arc)}V${num(y + nextOffset)}H${num(start)}`;
              arrows += `M${num(start - ARROW)},${num(y + nextOffset - ARROW / 2)}l${ARROW},${ARROW / 2}l${-ARROW},${ARROW / 2}z`;
              offset = nextOffset;
            } else {
              track += `M${num(start + kid.width)},${num(ky)}H${num(right - arc)}V${num(y)}H${num(right)}`;
            }
          }
          reverse(boxes, from);
          reverse(at, 2 * from);
          break;
        }
        case Kind.Choice: {
          const inner = box.width - 4 * arc;
          const railIn = x + arc;
          const railOut = right - arc;
          const from = boxes.length;
          let offset = 0;
          for (let i = 0; i < kids.length; i++) {
            const kid = kids[i];
            if (i > 0) offset = below(offset, kids[i - 1], kid, m);
            const ky = y + offset;
            const kx = x + 2 * arc + (inner - kid.width) / 2;
            const last = i === kids.length - 1;
            if (i === 0) {
              line(x, y, kx);
              line(kx + kid.width, y, right);
            } else {
              track +=
                (last ? `M${num(x)},${num(y)}${eastToSouth}V${num(ky - arc)}` : `M${num(railIn)},${num(ky - arc)}`) +
                southToEast +
                (kx > railIn + arc ? `H${num(kx)}` : '') +
                `M${num(kx + kid.width)},${num(ky)}` +
                (kx > railIn + arc ? `H${num(railOut - arc)}` : '') +
                eastToNorth +
                (last ? `V${num(y + arc)}${northToEast}` : '');
            }
            boxes.push(kid);
            at.push(ky, kx);
          }
          // Reversed, so that the branches come off the stack top to bottom.
          reverse(boxes, from);
          reverse(at, 2 * from);
          break;
        }
        case Kind.Bypass: {
          const kid = kids[0];
          const kx = x + 2 * arc;
          line(x, y, kx);
          line(kx + kid.width, y, right);
          track +=
            `M${num(x)},${num(y)}${eastToNorth}V${num(y - box.reach + arc)}${northToEast}H${num(right - 2 * arc)}` +
            `${eastToSouth}V${num(y - arc)}${southToEast}`;
          boxes.push(kid);
          at.push(kx, y);
          break;
        }
        case Kind.Loop: {
          const kid = kids[0];
          const kx = x + (box.width - kid.width) / 2;
          const loopY = y + box.reach;
          const middle = x + box.width / 2;
          line(x, y, kx);
          line(kx + kid.width, y, right);
          track +=
            `M${num(x + arc)},${num(y)}${loopDown}V${num(loopY - arc)}${southToEast}H${num(right - arc)}` +
            `${eastToNorth}V${num(y + arc)}${loopUp}`;
          arrows += `M${num(middle - ARROW / 2)},${num(loopY)}l${ARROW},${-ARROW / 2}v${ARROW}z`;
          if (box.text !== '') {
            nodes += `<text class="pele-edge-label pele-count" x="${num(middle)}" y="${num(loopY + COUNT_SIZE + 3)}" font-size="${COUNT_SIZE}" fill="var(--_m)">${esc(box.text)}</text>`;
          }
          boxes.push(kid);
          at.push(kx, y);
          break;
        }
        default: {
          const text = box.text;
          const space = text.startsWith(' ') || text.endsWith(' ') || text.includes('  ') ? ' xml:space="preserve"' : '';
          const shape = `<rect x="${num(x)}" y="${num(y - boxTop)}" width="${num(box.width)}" height="${num(m.height)}"`;
          const label = `<text x="${num(x + box.width / 2)}" y="${num(y + textShift)}"${space}`;
          if (box.kind === Kind.Terminal) {
            nodes += `<g class="pele-node pele-terminal">${shape} rx="${num(boxTop)}" fill="var(--_s)" stroke="var(--_b)"${stroke}/>${label} font-family="${FONT_MONO}">${esc(text)}</text></g>`;
          } else if (box.kind === Kind.NonTerminal) {
            nodes += `<g class="pele-node pele-nonterminal" data-id="${escText(box.id)}">${shape} fill="var(--_bg)" stroke="var(--_b)"${stroke}${ROUNDED}/>${label}>${esc(text)}</text></g>`;
          } else {
            nodes +=
              `<g class="pele-node pele-special">${shape} fill="var(--_bg)" stroke="var(--_b)" stroke-dasharray="4 3"${stroke}${ROUNDED}/>` +
              `${label} font-style="italic"><tspan fill="var(--_m)">? </tspan>${esc(text.slice(2, -2))}<tspan fill="var(--_m)"> ?</tspan></text></g>`;
          }
        }
      }
    }
  };

  let rules = '';
  let width = title.width;
  let top = pad + titleHeight;
  let bottom = pad + title.height;
  for (const rule of model.rules) {
    const box = measure(rule.definition, m, tight ? Math.max(80, (options.maxWidth ?? 320) - 2 * pad - 4 * radius - 2 * LEAD - 1) : Infinity);
    const name = shown(rule.name);
    const baseline = top + headHeight + HEAD_GAP + box.up;
    const start = pad + 2 * radius;
    const left = start + LEAD;
    const end = left + box.width + LEAD;
    track = '';
    arrows = '';
    nodes = '';
    line(start, baseline, left);
    line(left + box.width, baseline, end);
    place(box, left, baseline);
    const markers =
      radius > 0
        ? `<circle class="pele-marker pele-start" cx="${num(pad + radius)}" cy="${num(baseline)}" r="${num(radius)}" fill="var(--_l)"/>` +
          `<circle class="pele-marker pele-end" cx="${num(end + radius)}" cy="${num(baseline)}" r="${num(radius)}" fill="var(--_l)"/>`
        : '';
    rules +=
      `<g class="pele-rule" data-id="${escText(rule.name)}">` +
      `<text class="pele-rule-name" x="${num(pad)}" y="${num(top + headHeight / 2 + headSize * 0.35)}" font-size="${num(headSize)}" font-weight="var(--_hw)" text-anchor="start">${esc(name)}</text>` +
      `<path class="pele-edge pele-track" d="${track}" fill="none" stroke="var(--_l)"${stroke}/>` +
      (arrows ? `<path class="pele-marker" d="${arrows}" fill="var(--_l)"/>` : '') +
      markers +
      nodes +
      '</g>';
    width = Math.max(width, end + 2 * radius - pad, m.measurer.width(name, headSize, Style.Bold));
    bottom = baseline + box.down;
    top = bottom + m.sep + RULE_GAP;
  }

  const totalWidth = Math.ceil(width + 2 * pad);
  const totalHeight = Math.ceil(bottom + pad);
  const content =
    labelSvg(title, totalWidth / 2, pad + title.height / 2, ' class="pele-title" font-weight="var(--_tw)"') +
    (rules ? `<g class="pele-rules" transform="translate(0.5,0.5)" font-size="${num(size)}" text-anchor="middle">${rules}</g>` : '');

  return {
    svg: svgDocument('railroad', totalWidth, totalHeight, base, options, model, content),
    width: totalWidth,
    height: totalHeight,
    links: [],
  };
}
