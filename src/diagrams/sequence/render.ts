import type { Config } from '../../preprocess.js';
import { titleLabel } from '../../svg/title.js';
import { esc, escText, labelSvg, num } from '../../svg/builder.js';
import { ARROW, marker } from '../../svg/edges.js';
import { svgDocument } from '../../svg/root.js';
import { ROUNDED, classNames, resolveStyle, rounded } from '../../svg/theme.js';
import { layoutLabel, type Label } from '../../text/label.js';
import { Style, defaultMeasurer } from '../../text/measurer.js';
import type { RenderOptions, Rendered } from '../../types.js';
import { breakLabel } from '../common/literal-label.js';
import { tighten, titleRoom } from '../common/fit-width.js';
import { actorKind, actorSize, drawActor, isFigure, type ActorSize } from './actors.js';
import type { SeqDb } from './db.js';
import { LINETYPE, PLACEMENT, type SeqActor, type SeqBox, type SeqMessage, type SeqNumbering } from './types.js';

const enum Head {
  None,
  Arrow,
  Cross,
  Open,
  HalfSolid,
  HalfStick,
}

interface LineStyle {
  dotted: boolean;
  head: Head;
  // Where the heads are: at the receiver, at the sender only (the reverse arrows), or at both.
  atStart: boolean;
  atEnd: boolean;
  bottom: boolean;
}

const STYLES: (LineStyle | undefined)[] = [];
function style(type: number, dotted: boolean, head: Head, ends = 1, bottom = false): void {
  STYLES[type] = { dotted, head, atStart: ends !== 1, atEnd: ends !== 0, bottom };
}
style(LINETYPE.SOLID, false, Head.Arrow);
style(LINETYPE.DOTTED, true, Head.Arrow);
style(LINETYPE.SOLID_CROSS, false, Head.Cross);
style(LINETYPE.DOTTED_CROSS, true, Head.Cross);
style(LINETYPE.SOLID_OPEN, false, Head.None);
style(LINETYPE.DOTTED_OPEN, true, Head.None);
style(LINETYPE.SOLID_POINT, false, Head.Open);
style(LINETYPE.DOTTED_POINT, true, Head.Open);
style(LINETYPE.BIDIRECTIONAL_SOLID, false, Head.Arrow, 2);
style(LINETYPE.BIDIRECTIONAL_DOTTED, true, Head.Arrow, 2);
for (const dotted of [false, true]) {
  const d = dotted ? 10 : 0;
  style(LINETYPE.SOLID_TOP + d, dotted, Head.HalfSolid);
  style(LINETYPE.SOLID_BOTTOM + d, dotted, Head.HalfSolid, 1, true);
  style(LINETYPE.STICK_TOP + d, dotted, Head.HalfStick);
  style(LINETYPE.STICK_BOTTOM + d, dotted, Head.HalfStick, 1, true);
  style(LINETYPE.SOLID_ARROW_TOP_REVERSE + d, dotted, Head.HalfSolid, 0);
  style(LINETYPE.SOLID_ARROW_BOTTOM_REVERSE + d, dotted, Head.HalfSolid, 0, true);
  style(LINETYPE.STICK_ARROW_TOP_REVERSE + d, dotted, Head.HalfStick, 0);
  style(LINETYPE.STICK_ARROW_BOTTOM_REVERSE + d, dotted, Head.HalfStick, 0, true);
}

const FRAME_KIND = new Map<number, string>([
  [LINETYPE.LOOP_START, 'loop'],
  [LINETYPE.ALT_START, 'alt'],
  [LINETYPE.OPT_START, 'opt'],
  [LINETYPE.PAR_START, 'par'],
  [LINETYPE.PAR_OVER_START, 'par'],
  [LINETYPE.CRITICAL_START, 'critical'],
  [LINETYPE.BREAK_START, 'break'],
  [LINETYPE.RECT_START, 'rect'],
]);

const MSG_PAD = 12;
const SELF_W = 28;
const SELF_H = 22;
const ACT_W = 10;
const ACT_STEP = 4;
const ACT_MIN = 14;
const NOTE_GAP = 10;
const NOTE_OVER = 16;
const FRAME_PAD = 20;
const FRAME_NEST = 10;
const TAB_H = 20;
const FRAME_TEXT = 240;
const BADGE_H = 16;
const CENTRAL_R = 4;
const DASH = ' stroke-dasharray="4 4"';

export interface Numbering {
  // The number each message line carries, whether or not it is shown. NaN for everything else.
  index: number[];
  shown: boolean[];
  // Whether numbers are on after the last statement.
  visible: boolean;
}

export function isLineMessage(type: number | undefined): boolean {
  return type !== undefined && STYLES[type] !== undefined;
}

// Counts message lines the way Mermaid's renderer does while it draws.
export function numberMessages(messages: SeqMessage[], always: boolean): Numbering {
  const index = new Array<number>(messages.length);
  const shown = new Array<boolean>(messages.length);
  let current = 1;
  let step = 1;
  let visible = false;
  for (let i = 0; i < messages.length; i++) {
    const m = messages[i];
    index[i] = NaN;
    shown[i] = false;
    if (m.type === LINETYPE.AUTONUMBER) {
      const spec = m.message as SeqNumbering;
      current = spec.start || current;
      step = spec.step || step;
      visible = spec.visible;
    } else if (isLineMessage(m.type)) {
      index[i] = current;
      shown[i] = visible || always;
      current = Math.round((current + step) * 100) / 100;
    }
  }
  return { index, shown, visible };
}

interface Column {
  id: string;
  actor: SeqActor;
  kind: string;
  label: Label;
  size: ActorSize;
  x: number;
  createAt: number;
  destroyAt: number;
  top: number;
  lifeStart: number;
  lifeEnd: number;
  activations: number[];
}

const enum V {
  Line,
  Self,
  Note,
}

interface View {
  kind: V;
  a: number;
  b: number;
  label: Label;
  x: number;
  w: number;
}

interface Frame {
  kind: string;
  x0: number;
  x1: number;
  top: number;
  title: Label;
  tabW: number;
  fill: string;
  dividers: number[];
  dividerY: number[];
  dividerLabels: Label[];
}

interface BoxRun {
  box: SeqBox;
  first: number;
  last: number;
  title: Label;
  grow: number;
}

const NO_LABEL: Label = { lines: [], widths: [], width: 0, height: 0, size: 0, lineHeight: 0 };

function option(conf: Config, key: string, fallback: number): number {
  const value = conf[key];
  return typeof value === 'number' && value >= 0 && value <= 2000 ? value : fallback;
}

function half(x: number, y: number, dir: number, up: number, stick: boolean): string {
  const bx = num(x - dir * ARROW);
  if (stick) return `<path class="pele-marker" d="M${num(x)},${num(y)}L${bx},${num(y + up * 5)}"/>`;
  return `<path class="pele-marker" d="M${num(x)},${num(y)}L${bx},${num(y + up * 4.5)}V${num(y)}Z" fill="var(--_l)" stroke="none"/>`;
}

// Draws the head whose tip is at (x, y) and points along dir. `up` is the side a half head sits on.
function head(type: Head, x: number, y: number, dir: number, up: number): string {
  switch (type) {
    case Head.Arrow:
      return marker('arrow_point', x, y, dir, 0, 'var(--_l)');
    case Head.Cross:
      return marker('arrow_cross', x, y, dir, 0, 'var(--_l)');
    case Head.Open:
      return `<path class="pele-marker" d="M${num(x - dir * ARROW)},${num(y - 4.5)}L${num(x)},${num(y)}L${num(x - dir * ARROW)},${num(
        y + 4.5
      )}" stroke-linejoin="round"/>`;
    case Head.HalfSolid:
      return half(x, y, dir, up, false);
    case Head.HalfStick:
      return half(x, y, dir, up, true);
    default:
      return '';
  }
}

function trim(type: Head): number {
  return type === Head.Arrow ? ARROW - 1 : type === Head.Cross ? 4 : 0;
}

export function renderSequence(db: SeqDb, config: Config, options: RenderOptions): Rendered {
  return tighten(options, (tight) => draw(db, config, options, tight));
}

function draw(db: SeqDb, config: Config, options: RenderOptions, tight: boolean): Rendered {
  const conf = (config.sequence ?? {}) as Config;
  const size = options.fontSize ?? 16;
  const small = Math.round(size * 0.875);
  const tiny = Math.round(size * 0.75);
  const measurer = options.measurer ?? defaultMeasurer(options.fontFamily, options.fontFamilyMono);
  const icons = options.icons;
  const pad = options.padding ?? 8;
  const mirror = conf.mirrorActors !== false;
  const rightAngles = conf.rightAngles === true;
  const actorMargin = Math.min(option(conf, 'actorMargin', 40), tight ? 8 : Infinity);
  const minW = Math.min(option(conf, 'width', 64), tight ? 48 : Infinity);
  const minH = option(conf, 'height', Math.round(size * 1.5) + 20);
  const wrapW = Math.min(option(conf, 'width', 160), tight ? Math.max(32, ((options.maxWidth ?? 320) - 2 * pad) / Math.max(1, db.actors.size) - actorMargin - 24) : Infinity);
  // Mermaid's default of 35 corresponds to Pele's default gap. Other values move it by the difference.
  const msgGap = Math.max(4, 14 + option(conf, 'messageMargin', 35) - 35);
  const notePad = Math.min(option(conf, 'noteMargin', 10), tight ? 6 : Infinity);
  const boxPad = Math.min(option(conf, 'boxMargin', 10), tight ? 6 : Infinity);
  const align = conf.messageAlign === 'left' ? -1 : conf.messageAlign === 'right' ? 1 : 0;

  const msgPad = tight ? 6 : MSG_PAD;
  const noteOver = tight ? 8 : NOTE_OVER;
  const framePad = tight ? 12 : FRAME_PAD;
  const frameNest = tight ? 6 : FRAME_NEST;
  const messages = db.messages;
  const count = messages.length;
  const numbering = numberMessages(messages, conf.showSequenceNumbers === true);
  const text = (raw: string | undefined, fontSize: number, wrap: boolean, width = wrapW, base = 0): Label => {
    const label = layoutLabel(raw, false, measurer, fontSize, tight || wrap ? width : Infinity, base);
    return tight ? breakLabel(label, measurer, Math.max(120, width)) : label;
  };

  let used: Set<string | undefined> | undefined;
  if (conf.hideUnusedParticipants === true) {
    used = new Set();
    for (const m of messages) used.add(m.from).add(m.to);
  }

  const nextLine = new Int32Array(count + 1);
  nextLine[count] = -1;
  for (let i = count - 1; i >= 0; i--) nextLine[i] = isLineMessage(messages[i].type) ? i : nextLine[i + 1];

  const cols: Column[] = [];
  const colOf = new Map<string, number>();
  for (const [id, actor] of db.actors) {
    if (used && !used.has(id)) continue;
    const kind = actorKind(actor.type);
    const label = text(actor.description, size, actor.wrap);
    const created = db.createdActors.get(id);
    const destroyed = db.destroyedActors.get(id);
    let createAt = created === undefined ? -1 : nextLine[Math.min(created, count)];
    if (createAt >= 0 && messages[createAt].to !== id) createAt = -1;
    let destroyAt = destroyed === undefined ? -1 : nextLine[Math.min(destroyed, count)];
    if (destroyAt >= 0 && messages[destroyAt].to !== id && messages[destroyAt].from !== id) destroyAt = -1;
    colOf.set(id, cols.length);
    cols.push({
      id,
      actor,
      kind,
      label,
      size: actorSize(kind, label, minW, minH, tight ? 8 : undefined),
      x: 0,
      createAt,
      destroyAt,
      top: 0,
      lifeStart: 0,
      lifeEnd: -1,
      activations: [],
    });
  }
  const last = cols.length - 1;

  // Widths between lifelines. Every message and note says how far apart the lifelines it touches must be.
  const needs = new Map<number, number>();
  const need = (lo: number, hi: number, width: number): void => {
    if (lo < 0 || hi > last) return;
    const key = lo * cols.length + hi;
    if ((needs.get(key) ?? 0) < width) needs.set(key, width);
  };
  const badgeWidth = (i: number): number =>
    numbering.shown[i] ? Math.max(BADGE_H, measurer.width(String(numbering.index[i]), tiny, 0) + 8) : 0;

  const views = new Array<View | undefined>(count);
  for (let i = 0; i < count; i++) {
    const m = messages[i];
    const a = m.from === undefined ? undefined : colOf.get(m.from);
    const b = m.to === undefined ? undefined : colOf.get(m.to);
    if (a === undefined || b === undefined || typeof m.message !== 'string') continue;
    if (m.type === LINETYPE.NOTE) {
      const label = text(m.message, small, m.wrap);
      const w = label.width + 2 * notePad;
      if (m.placement === PLACEMENT.LEFTOF) need(a - 1, a, w + 2 * NOTE_GAP + ACT_W);
      else if (m.placement === PLACEMENT.RIGHTOF) need(a, a + 1, w + 2 * NOTE_GAP + ACT_W);
      else if (a === b) {
        need(a - 1, a, w / 2 + NOTE_GAP);
        need(a, a + 1, w / 2 + NOTE_GAP);
      } else need(Math.min(a, b), Math.max(a, b), w - 2 * noteOver);
      views[i] = { kind: V.Note, a, b, label, x: 0, w };
    } else if (isLineMessage(m.type)) {
      const label = text(m.message, small, m.wrap);
      const badge = badgeWidth(i);
      if (a === b) {
        need(a, a + 1, SELF_W + 8 + label.width + 16 + ACT_W + badge);
        views[i] = { kind: V.Self, a, b, label, x: 0, w: 0 };
      } else {
        const created = cols[b].createAt === i ? cols[b].size.w / 2 : 0;
        const central = m.centralConnection ? 4 * CENTRAL_R : 0;
        need(Math.min(a, b), Math.max(a, b), (tight ? Math.min(label.width, Math.max(16, wrapW - 16)) : label.width) + 2 * msgPad + ACT_W + badge + created + central);
        views[i] = { kind: V.Line, a, b, label, x: 0, w: 0 };
      }
    }
  }

  const runs: BoxRun[] = [];
  for (let i = 0; i <= last; i++) {
    const box = cols[i].actor.box;
    const run = runs[runs.length - 1];
    if (box && run && run.box === box && run.last === i - 1) run.last = i;
    else if (box) runs.push({ box, first: i, last: i, title: text(box.name, small, box.wrap), grow: 0 });
  }

  const gaps = new Array<number>(Math.max(last, 0));
  for (let i = 0; i < last; i++) {
    const left = cols[i];
    const right = cols[i + 1];
    const boxed = left.actor.box !== right.actor.box ? (left.actor.box ? boxPad : 0) + (right.actor.box ? boxPad : 0) : 0;
    gaps[i] = Math.max(left.size.w / 2 + right.size.w / 2 + actorMargin + boxed, needs.get(i * cols.length + i + 1) ?? 0);
  }
  // A message across several lifelines widens each gap it crosses by an equal share of what is missing.
  const spans: [number, number, number][] = [];
  for (const [key, width] of needs) {
    const lo = Math.floor(key / cols.length);
    const hi = key % cols.length;
    if (hi - lo > 1) spans.push([lo, hi, width]);
  }
  spans.sort((p, q) => p[1] - p[0] - (q[1] - q[0]) || p[0] - q[0]);
  for (const [lo, hi, width] of spans) {
    let total = 0;
    for (let i = lo; i < hi; i++) total += gaps[i];
    if (total >= width) continue;
    const share = (width - total) / (hi - lo);
    for (let i = lo; i < hi; i++) gaps[i] += share;
  }
  const place = (): void => {
    for (let i = 1; i <= last; i++) cols[i].x = cols[i - 1].x + gaps[i - 1];
  };
  place();
  for (const run of runs) {
    const inner = cols[run.last].x + cols[run.last].size.w / 2 - (cols[run.first].x - cols[run.first].size.w / 2);
    run.grow = Math.max(0, (run.title.width - inner) / 2);
    if (run.grow === 0) continue;
    if (run.first > 0) gaps[run.first - 1] += run.grow;
    if (run.last < last) gaps[run.last] += run.grow;
  }
  place();

  let minX = Infinity;
  let maxX = -Infinity;
  const extend = (x0: number, x1: number): void => {
    if (x0 < minX) minX = x0;
    if (x1 > maxX) maxX = x1;
  };
  for (const col of cols) extend(col.x - col.size.w / 2, col.x + col.size.w / 2);
  for (const run of runs) {
    extend(cols[run.first].x - cols[run.first].size.w / 2 - boxPad - run.grow, cols[run.last].x + cols[run.last].size.w / 2 + boxPad + run.grow);
  }

  // Horizontal extents of every block, from what it holds.
  const frames = new Array<Frame | undefined>(count);
  const open: Frame[] = [];
  const spanAll = (): [number, number] => (last < 0 ? [0, 120] : [cols[0].x - framePad, cols[last].x + framePad]);
  for (let i = 0; i < count; i++) {
    const m = messages[i];
    const type = m.type;
    const frameKind = type === undefined ? undefined : FRAME_KIND.get(type);
    const view = views[i];
    if (frameKind !== undefined) {
      const frame: Frame = {
        kind: frameKind,
        x0: Infinity,
        x1: -Infinity,
        top: 0,
        title: NO_LABEL,
        tabW: 0,
        fill: frameKind === 'rect' && typeof m.message === 'string' ? m.message : '',
        dividers: [i],
        dividerY: [],
        dividerLabels: [],
      };
      frames[i] = frame;
      open.push(frame);
    } else if (type === LINETYPE.ALT_ELSE || type === LINETYPE.PAR_AND || type === LINETYPE.CRITICAL_OPTION) {
      open[open.length - 1]?.dividers.push(i);
    } else if (
      type === LINETYPE.LOOP_END ||
      type === LINETYPE.ALT_END ||
      type === LINETYPE.OPT_END ||
      type === LINETYPE.PAR_END ||
      type === LINETYPE.CRITICAL_END ||
      type === LINETYPE.BREAK_END ||
      type === LINETYPE.RECT_END
    ) {
      const frame = open.pop();
      if (!frame) continue;
      frames[i] = frame;
      if (frame.x0 > frame.x1) [frame.x0, frame.x1] = spanAll();
      if (frame.kind !== 'rect') {
        frame.tabW = measurer.width(frame.kind, tiny, Style.Bold) + 14;
        // A block grows to the right to give its texts up to FRAME_TEXT of width before they wrap.
        for (let k = 0; k < frame.dividers.length; k++) {
          const raw = messages[frame.dividers[k]].message;
          const tab = k === 0 ? frame.tabW + 8 : 0;
          const room = frame.x1 - frame.x0 - 16 - tab;
          const label = raw ? text(`[${raw as string}]`, small, true, Math.max(room, tight ? Math.min(FRAME_TEXT, wrapW) : FRAME_TEXT)) : NO_LABEL;
          if (label.width > room) frame.x1 += label.width - room;
          if (k === 0) frame.title = label;
          else frame.dividerLabels.push(label);
        }
      }
      extend(frame.x0, frame.x1);
      const parent = open[open.length - 1];
      if (parent) {
        parent.x0 = Math.min(parent.x0, frame.x0 - frameNest);
        parent.x1 = Math.max(parent.x1, frame.x1 + frameNest);
      }
    } else if (view) {
      const a = cols[view.a];
      const b = cols[view.b];
      let x0: number;
      let x1: number;
      if (view.kind === V.Note) {
        if (m.placement === PLACEMENT.LEFTOF) view.x = a.x - NOTE_GAP - view.w;
        else if (m.placement === PLACEMENT.RIGHTOF) view.x = a.x + NOTE_GAP;
        else if (view.a === view.b) view.x = a.x - view.w / 2;
        else {
          const lo = Math.min(a.x, b.x) - noteOver;
          const hi = Math.max(a.x, b.x) + noteOver;
          if (tight || m.wrap) view.label = text(m.message as string, small, true, Math.max(wrapW, hi - lo - 2 * notePad));
          view.w = Math.max(hi - lo, view.label.width + 2 * notePad);
          view.x = (lo + hi - view.w) / 2;
        }
        x0 = view.x;
        x1 = view.x + view.w;
      } else if (view.kind === V.Self) {
        x0 = a.x;
        x1 = a.x + ACT_W + SELF_W + 8 + view.label.width + badgeWidth(i);
      } else {
        x0 = Math.min(a.x, b.x);
        x1 = Math.max(a.x, b.x);
        if (tight || m.wrap) view.label = text(m.message as string, small, true, Math.max(wrapW, x1 - x0 - 2 * msgPad - ACT_W));
        if (b.createAt === i) {
          if (b.x > a.x) x1 += b.size.w / 2;
          else x0 -= b.size.w / 2;
        }
      }
      extend(x0, x1);
      const frame = open[open.length - 1];
      if (frame) {
        frame.x0 = Math.min(frame.x0, x0 - framePad);
        frame.x1 = Math.max(frame.x1, x1 + framePad);
      }
    }
  }

  // Vertical placement, top to bottom, drawing as it goes.
  let boxTitleH = 0;
  for (const run of runs) boxTitleH = Math.max(boxTitleH, run.title.height);
  const boxTop = runs.length > 0 ? boxPad + (boxTitleH > 0 ? boxTitleH + 4 : 0) : 0;
  let rowH = 0;
  for (const col of cols) if (col.createAt < 0) rowH = Math.max(rowH, col.size.h);
  const headBottom = boxTop + rowH;
  for (const col of cols) {
    col.top = headBottom - col.size.h;
    col.lifeStart = headBottom;
  }

  const xs = cols.map((col) => col.x);
  // Whether a lifeline runs between two x positions, where text would be struck through.
  const crosses = (x0: number, x1: number): boolean => {
    let lo = 0;
    let hi = xs.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (xs[mid] <= x0) lo = mid + 1;
      else hi = mid;
    }
    return lo < xs.length && xs[lo] < x1;
  };
  const backed = (label: Label, cx: number, cy: number, attrs: string): string => {
    if (label.width === 0) return '';
    const l = cx - label.width / 2;
    const back = crosses(l, l + label.width)
      ? `<rect x="${num(l - 3)}" y="${num(cy - label.height / 2 + 2)}" width="${num(label.width + 6)}" height="${num(label.height - 4)}" rx="3" fill="var(--_bg)" stroke="none"/>`
      : '';
    return back + labelSvg(label, cx, cy, attrs, icons);
  };
  const leftEdge = (col: Column, extra = 0): number => (col.activations.length + extra > 0 ? col.x - ACT_W / 2 : col.x);
  const rightEdge = (col: Column, extra = 0): number => {
    const depth = col.activations.length + extra;
    return depth > 0 ? col.x + ACT_W / 2 + (depth - 1) * ACT_STEP : col.x;
  };

  // Shaded blocks and activations close from the inside out. They are written in reverse, so that
  // the inner ones end up on top.
  const rectsOut: string[] = [];
  const activationsOut: string[] = [];
  let framesOut = '';
  let edgesOut = '';
  let labelsOut = '';
  let notesOut = '';
  let actorsOut = '';
  let crossesOut = '';
  const endActivation = (col: Column, end: number): number => {
    const start = col.activations.pop()!;
    const bottom = Math.max(end, start + ACT_MIN);
    const x = col.x - ACT_W / 2 + col.activations.length * ACT_STEP;
    extend(x, x + ACT_W);
    activationsOut.push(
      `<rect class="pele-activation" data-id="${escText(col.id)}" x="${num(x)}" y="${num(start)}" width="${ACT_W}" height="${num(
        bottom - start
      )}" rx="2"/>`
    );
    return bottom;
  };
  // The lifeline of a destroyed participant ends in a cross a little below the message that ends it.
  const destroy = (col: Column, lineY: number): number => {
    const cx = col.x;
    const cy = lineY + 16;
    col.lifeEnd = cy;
    crossesOut += `<path class="pele-destroy" data-id="${escText(col.id)}" d="M${num(cx - 6)},${num(cy - 6)}L${num(cx + 6)},${num(
      cy + 6
    )}M${num(cx + 6)},${num(cy - 6)}L${num(cx - 6)},${num(cy + 6)}"/>`;
    return cy + 6;
  };
  const actorSvg = (col: Column, top: number, footer: boolean): string => {
    const cls = col.actor.properties.get('class');
    return (
      `<g class="pele-node pele-actor pele-actor-${col.kind}${footer ? ' pele-actor-footer' : ''}${
        typeof cls === 'string' ? classNames(cls) : ''
      }" data-id="${escText(col.id)}">` +
      drawActor(col.kind, col.x, top, col.size, col.label, icons) +
      '</g>'
    );
  };
  const badge = (i: number, cx: number, cy: number, w: number): string =>
    `<g class="pele-sequence-number"><rect x="${num(cx - w / 2)}" y="${num(cy - BADGE_H / 2)}" width="${num(w)}" height="${BADGE_H}" rx="${
      BADGE_H / 2
    }" fill="var(--_l)" stroke="none"/><text x="${num(cx)}" y="${num(cy + tiny * 0.35)}" text-anchor="middle" font-size="${tiny}" fill="var(--_bg)" stroke="none">${esc(
      String(numbering.index[i])
    )}</text></g>`;

  let y = headBottom + 6;
  const stack: Frame[] = [];
  for (let i = 0; i < count; i++) {
    const m = messages[i];
    const type = m.type;
    const view = views[i];
    const frame = frames[i];

    if (type === LINETYPE.ACTIVE_START) {
      const col = m.from === undefined ? undefined : colOf.get(m.from);
      if (col !== undefined) cols[col].activations.push(y);
    } else if (type === LINETYPE.ACTIVE_END) {
      const col = m.from === undefined ? undefined : colOf.get(m.from);
      if (col !== undefined && cols[col].activations.length > 0) y = Math.max(y, endActivation(cols[col], y));
    } else if (frame && frame.dividers[0] === i) {
      stack.push(frame);
      if (frame.kind === 'rect') {
        frame.top = y + 8;
        y = frame.top;
      } else {
        frame.top = y + 12;
        y = frame.top + Math.max(TAB_H, frame.title.height + 2);
      }
    } else if (frame) {
      stack.pop();
      const bottom = y + 12;
      const x = num(frame.x0);
      const w = num(frame.x1 - frame.x0);
      if (frame.kind === 'rect') {
        const fill = frame.fill ? resolveStyle([`fill:${frame.fill}`]).shape : '';
        rectsOut.push(`<rect class="pele-rect" x="${x}" y="${num(frame.top)}" width="${w}" height="${num(bottom - frame.top)}"${rounded((fill ? '' : ' fill-opacity="0.5"') + fill)}/>`);
      } else {
        let inner = `<rect x="${x}" y="${num(frame.top)}" width="${w}" height="${num(bottom - frame.top)}" fill="none"${ROUNDED}/>`;
        for (let k = 0; k < frame.dividerY.length; k++) {
          const dy = frame.dividerY[k];
          const label = frame.dividerLabels[k];
          inner +=
            `<path d="M${x},${num(dy)}H${num(frame.x1)}"${DASH}/>` +
            backed(label, frame.x0 + 8 + label.width / 2, dy + 2 + label.height / 2, ' class="pele-frame-label" fill="var(--_m)" stroke="none"');
        }
        inner +=
          `<rect x="${x}" y="${num(frame.top)}" width="${num(frame.tabW)}" height="${TAB_H}" fill="var(--_s)"${ROUNDED}/>` +
          `<text class="pele-frame-kind" x="${num(frame.x0 + frame.tabW / 2)}" y="${num(
            frame.top + TAB_H / 2 + tiny * 0.35
          )}" text-anchor="middle" font-size="${tiny}" font-weight="var(--_hw)" fill="var(--_m)" stroke="none">${frame.kind}</text>` +
          backed(
            frame.title,
            frame.x0 + frame.tabW + 8 + frame.title.width / 2,
            frame.top + Math.max(TAB_H, frame.title.height) / 2,
            ' class="pele-frame-label" fill="var(--_m)" stroke="none"'
          );
        framesOut += `<g class="pele-frame pele-frame-${frame.kind}">${inner}</g>`;
      }
      y = bottom;
    } else if (type === LINETYPE.ALT_ELSE || type === LINETYPE.PAR_AND || type === LINETYPE.CRITICAL_OPTION) {
      const current = stack[stack.length - 1];
      if (current) {
        const label = current.dividerLabels[current.dividerY.length];
        current.dividerY.push(y + 12);
        y += 12 + (label.height > 0 ? label.height : 0);
      }
    } else if (view && view.kind === V.Note) {
      const a = cols[view.a];
      const h = view.label.height + 2 * Math.max(4, notePad - 4);
      const top = y + 10;
      let x = view.x;
      if (m.placement === PLACEMENT.RIGHTOF) x += rightEdge(a) - a.x;
      else if (m.placement === PLACEMENT.LEFTOF) x += leftEdge(a) - a.x;
      extend(x, x + view.w);
      notesOut +=
        `<g class="pele-note" data-id="i${escText(m.id)}">` +
        `<rect x="${num(x)}" y="${num(top)}" width="${num(view.w)}" height="${num(h)}"${ROUNDED}/>` +
        labelSvg(view.label, x + view.w / 2, top + h / 2, ' class="pele-label" stroke="none" fill="var(--_fg)"', icons) +
        '</g>';
      y = top + h;
    } else if (view) {
      const st = STYLES[type!]!;
      const a = cols[view.a];
      const b = cols[view.b];
      const label = view.label;
      const bw = badgeWidth(i);
      // The activation a `+` starts belongs to this message, so the arrow stops at its edge.
      let starting = 0;
      for (let k = i + 1; k < count; k++) {
        const t = messages[k].type;
        if (t === LINETYPE.ACTIVE_START) {
          if (messages[k].from === m.to) starting++;
        } else if (t !== LINETYPE.ACTIVE_END && t !== LINETYPE.CENTRAL_CONNECTION && t !== LINETYPE.CENTRAL_CONNECTION_REVERSE) break;
      }
      const up = st.bottom ? 1 : -1;
      const attrs = st.dotted ? DASH : '';
      const cc = m.centralConnection;
      const circleTo = cc === LINETYPE.CENTRAL_CONNECTION || cc === LINETYPE.CENTRAL_CONNECTION_DUAL;
      const circleFrom = cc === LINETYPE.CENTRAL_CONNECTION_REVERSE || cc === LINETYPE.CENTRAL_CONNECTION_DUAL;
      const circle = (cx: number, cy: number): string =>
        `<circle class="pele-central" cx="${num(cx)}" cy="${num(cy)}" r="${CENTRAL_R}" fill="var(--_l)" stroke="none"/>`;
      const tailAtEnd = st.atStart && !st.atEnd;
      const headTrim = trim(st.head);
      let inner = '';
      let lineY: number;

      if (view.kind === V.Self) {
        const top = y + msgGap + Math.max(0, (label.height - SELF_H) / 2);
        const bottom = top + SELF_H;
        let x0 = circleFrom ? a.x + CENTRAL_R : rightEdge(a);
        let x1 = circleTo ? a.x + CENTRAL_R : rightEdge(a, starting);
        const out = Math.max(x0, x1) + SELF_W + bw / 2;
        if (circleFrom) inner += circle(a.x, top);
        if (circleTo) inner += circle(a.x, bottom);
        if (bw > 0) {
          inner += badge(i, tailAtEnd ? x1 : x0, tailAtEnd ? bottom : top, bw);
          if (tailAtEnd) x1 += bw / 2;
          else x0 += bw / 2;
        }
        // The loop leaves to the right and comes back heading left, which turns a half head over.
        const heads = (st.atStart ? head(st.head, x0, top, -1, up) : '') + (st.atEnd ? head(st.head, x1, bottom, -1, -up) : '');
        const from = num(x0 + (st.atStart ? headTrim : 0));
        const to = num(x1 + (st.atEnd ? headTrim : 0));
        const d = rightAngles
          ? `M${from},${num(top)}H${num(out)}V${num(bottom)}H${to}`
          : `M${from},${num(top)}H${num(out - 6)}A6,6 0 0 1 ${num(out)},${num(top + 6)}V${num(bottom - 6)}A6,6 0 0 1 ${num(out - 6)},${num(
              bottom
            )}H${to}`;
        inner = `<path d="${d}"${attrs}/>` + heads + inner;
        extend(a.x, out + 8 + label.width);
        if (label.width > 0) {
          labelsOut += `<g class="pele-edge-label" data-id="i${escText(m.id)}">${labelSvg(
            label,
            out + 8 + label.width / 2,
            (top + bottom) / 2,
            '',
            icons
          )}</g>`;
        }
        // A label taller than the loop reaches below it, so the next row starts under the label.
        lineY = Math.max(bottom, (top + bottom) / 2 + label.height / 2);
      } else {
        const dir = b.x > a.x ? 1 : -1;
        const creating = b.createAt === i;
        lineY = y + msgGap + Math.max(label.height > 0 ? label.height + 2 : 6, creating ? b.size.h / 2 - msgGap + 6 : 0);
        let x0 = dir > 0 ? rightEdge(a) : leftEdge(a);
        let x1 = dir > 0 ? leftEdge(b, starting) : rightEdge(b, starting);
        if (creating) {
          b.top = lineY - b.size.h / 2;
          b.lifeStart = b.top + b.size.h;
          x1 = b.x - dir * (isFigure(b.kind) ? 18 : b.size.w / 2 + 1);
        }
        if (circleFrom) {
          inner += circle(a.x, lineY);
          x0 = a.x + dir * CENTRAL_R;
        }
        if (circleTo) {
          inner += circle(b.x, lineY);
          x1 = b.x - dir * CENTRAL_R;
        }
        if (bw > 0) {
          // The number sits on the lifeline at the tail of the arrow, past a connection circle if there is one.
          if (tailAtEnd) {
            const cx = circleTo ? x1 - dir * (bw / 2 + 2) : x1;
            inner += badge(i, cx, lineY, bw);
            x1 = cx - (dir * bw) / 2;
          } else {
            const cx = circleFrom ? x0 + dir * (bw / 2 + 2) : x0;
            inner += badge(i, cx, lineY, bw);
            x0 = cx + (dir * bw) / 2;
          }
        }
        const heads =
          (st.atStart ? head(st.head, x0, lineY, -dir, up * dir) : '') + (st.atEnd ? head(st.head, x1, lineY, dir, up * dir) : '');
        const from = x0 + (st.atStart ? dir * headTrim : 0);
        const to = x1 - (st.atEnd ? dir * headTrim : 0);
        inner = `<path d="M${num(from)},${num(lineY)}H${num(to)}"${attrs}/>` + heads + inner;
        if (label.width > 0) {
          const l = Math.min(x0, x1);
          const r = Math.max(x0, x1);
          const cx = align < 0 ? l + msgPad + label.width / 2 : align > 0 ? r - msgPad - label.width / 2 : (l + r) / 2;
          extend(cx - label.width / 2, cx + label.width / 2);
          labelsOut += `<g class="pele-edge-label" data-id="i${escText(m.id)}">${backed(label, cx, lineY - 4 - label.height / 2, '')}</g>`;
        }
        if (creating) y = lineY + b.size.h / 2 - 6;
      }
      edgesOut += `<g class="pele-edge pele-message" data-id="i${escText(m.id)}">${inner}</g>`;
      y = Math.max(y, lineY);
      if (a.destroyAt === i) y = Math.max(y, destroy(a, lineY));
      if (b.destroyAt === i && b !== a) y = Math.max(y, destroy(b, lineY));
    }
  }

  y += 20;
  for (const col of cols) while (col.activations.length > 0) endActivation(col, y);
  let bottom = y;
  if (mirror) {
    let footH = 0;
    for (const col of cols) {
      if (col.lifeEnd >= 0) continue;
      footH = Math.max(footH, col.size.h);
      actorsOut += actorSvg(col, y, true);
    }
    bottom = y + footH;
  }
  let lifelines = '';
  for (const col of cols) {
    actorsOut += actorSvg(col, col.top, false);
    const end = col.lifeEnd >= 0 ? col.lifeEnd : y;
    if (end > col.lifeStart) {
      lifelines += `<path class="pele-lifeline" data-id="${escText(col.id)}" d="M${num(col.x)},${num(col.lifeStart)}V${num(end)}"/>`;
    }
  }

  let boxesOut = '';
  for (const run of runs) {
    const x0 = cols[run.first].x - cols[run.first].size.w / 2 - boxPad - run.grow;
    const x1 = cols[run.last].x + cols[run.last].size.w / 2 + boxPad + run.grow;
    const fill = run.box.fill === 'transparent' ? '' : resolveStyle([`fill:${run.box.fill}`]).shape;
    boxesOut +=
      `<g class="pele-cluster pele-box"${run.box.name ? ` data-id="${escText(run.box.name)}"` : ''}>` +
      `<rect x="${num(x0)}" y="0" width="${num(x1 - x0)}" height="${num(bottom + boxPad)}" fill="var(--_a)" stroke="var(--_b)"${rounded((fill ? '' : ' fill-opacity="0.5"') + fill)}/>` +
      labelSvg(run.title, (x0 + x1) / 2, boxPad / 2 + 2 + run.title.height / 2, ' class="pele-cluster-label" fill="var(--_m)"', icons) +
      '</g>';
  }
  if (runs.length > 0) bottom += boxPad;

  let minY = 0;
  let titleOut = '';
  const room = titleRoom(options);
  const plainTitle = titleLabel(db.title, measurer, size, tight ? room : Infinity);
  const title = tight ? breakLabel(plainTitle, measurer, Math.max(120, room)) : plainTitle;
  if (minX > maxX) extend(0, Math.max(title.width, 40));
  if (title.width > 0) {
    const cx = (minX + maxX) / 2;
    extend(cx - title.width / 2, cx + title.width / 2);
    minY = -title.height - 12;
    titleOut = labelSvg(title, cx, minY + title.height / 2, ' class="pele-title" font-weight="var(--_tw)"', icons);
  }

  const width = Math.ceil(maxX - minX + 2 * pad);
  const height = Math.ceil(bottom - minY + 2 * pad);
  const svg = svgDocument(
    'sequence',
    width,
    height,
    size,
    options,
    db,
    `<g transform="translate(${num(pad - minX)},${num(pad - minY)})">` +
      titleOut +
      (boxesOut ? `<g class="pele-boxes" font-size="${small}">${boxesOut}</g>` : '') +
      (rectsOut.length > 0 ? `<g class="pele-rects" fill="var(--_a)">${rectsOut.reverse().join('')}</g>` : '') +
      (lifelines ? `<g class="pele-lifelines" fill="none" stroke="var(--_b)">${lifelines}</g>` : '') +
      (activationsOut.length > 0
        ? `<g class="pele-activations" fill="var(--_s)" stroke="var(--_b)">${activationsOut.reverse().join('')}</g>`
        : '') +
      (framesOut ? `<g class="pele-frames" font-size="${small}" stroke="var(--_b)">${framesOut}</g>` : '') +
      (edgesOut ? `<g class="pele-edges" fill="none" stroke="var(--_l)" stroke-linecap="round">${edgesOut}</g>` : '') +
      (crossesOut ? `<g class="pele-destroys" fill="none" stroke="var(--_l)" stroke-width="1.5" stroke-linecap="round">${crossesOut}</g>` : '') +
      (labelsOut ? `<g class="pele-edge-labels" font-size="${small}">${labelsOut}</g>` : '') +
      (notesOut ? `<g class="pele-notes" font-size="${small}" fill="var(--_a)" stroke="var(--_b)">${notesOut}</g>` : '') +
      (actorsOut ? `<g class="pele-nodes">${actorsOut}</g>` : '') +
      '</g>'
  );
  return { svg, width, height, links: [] };
}
