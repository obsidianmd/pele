import type { Config } from '../../preprocess.js';
import { escText, labelSvg, num } from '../../svg/builder.js';
import { marker, markerTrim } from '../../svg/edges.js';
import { svgDocument } from '../../svg/root.js';
import { ROUNDED, seriesColor } from '../../svg/theme.js';
import { layoutLabel, type Label } from '../../text/label.js';
import { Style, defaultMeasurer } from '../../text/measurer.js';
import type { RenderOptions, Rendered } from '../../types.js';
import { FOLD, HORIZON, backward, cliff, curvePath, ellipsePath, forward, resolveSeed, wave } from './boundaries.js';
import type { CynefinModel, DomainName } from './model.js';

// [domain, column, row, series color]
const QUADRANTS: readonly (readonly [DomainName, number, number, number])[] = [
  ['complex', 0, 0, 0],
  ['complicated', 1, 0, 1],
  ['chaotic', 0, 1, 3],
  ['clear', 1, 1, 2],
];
const CONFUSION_COLOR = 4;

// [name, decision model, kind of practice]
const META = new Map<DomainName, readonly [string, string, string]>([
  ['complex', ['Complex', 'Probe → Sense → Respond', 'Emergent Practices']],
  ['complicated', ['Complicated', 'Sense → Analyse → Respond', 'Good Practices']],
  ['clear', ['Clear', 'Sense → Categorise → Respond', 'Best Practices']],
  ['chaotic', ['Chaotic', 'Act → Sense → Respond', 'Novel Practices']],
  ['confusion', ['Confusion', '', 'Disorder']],
]);

const MAX_CONFUSION_ITEMS = 3;
const ITEM_MAX_WIDTH = 200;
const ITEM_PAD_X = 10;
const ITEM_PAD_Y = 4;
const ITEM_GAP = 6;
const HEAD_GAP = 10;
const MARGIN = 20;
const CLEARANCE = 10;

interface Badge {
  text: string;
  label: Label;
  w: number;
  h: number;
  overflow: boolean;
}

interface Block {
  name: DomainName;
  title: Label;
  subtitles: Label[];
  badges: Badge[];
  w: number;
  h: number;
  cx: number;
  cy: number;
}

function setting(config: Config, key: string, fallback: number, min: number, max: number): number {
  const value = (config.cynefin as Config | undefined)?.[key];
  return typeof value === 'number' && value >= min && value <= max ? value : fallback;
}

export function renderCynefin(model: CynefinModel, config: Config, options: RenderOptions): Rendered {
  const size = options.fontSize ?? 16;
  const small = Math.round(size * 0.8125);
  const itemSize = Math.round(size * 0.875);
  const measurer = options.measurer ?? defaultMeasurer(options.fontFamily, options.fontFamilyMono);
  const pad = options.padding ?? 8;
  const icons = options.icons;
  const showDescriptions = (config.cynefin as Config | undefined)?.showDomainDescriptions !== false;
  const amplitude = setting(config, 'boundaryAmplitude', 8, 0, 50);
  const seed = resolveSeed(setting(config, 'seed', 0, -1e15, 1e15), options.idPrefix ?? 'pele');
  const itemLine = Math.round(itemSize * 1.5);

  const badge = (text: string, overflow: boolean): Badge => {
    const label = layoutLabel(text, false, measurer, itemSize, ITEM_MAX_WIDTH);
    return { text, label, w: label.width + 2 * ITEM_PAD_X, h: Math.max(label.height, itemLine) + 2 * ITEM_PAD_Y, overflow };
  };

  const block = (name: DomainName): Block => {
    const meta = META.get(name)!;
    const title = layoutLabel(meta[0], false, measurer, size, 4000, Style.Bold);
    const subtitles: Label[] = [];
    if (showDescriptions) {
      for (const text of [meta[1], meta[2]]) if (text) subtitles.push(layoutLabel(text, false, measurer, small, 4000, Style.Italic));
    }
    const items = model.domains.get(name)?.items ?? [];
    const shown = name === 'confusion' && items.length > MAX_CONFUSION_ITEMS ? MAX_CONFUSION_ITEMS : items.length;
    const badges: Badge[] = [];
    for (let i = 0; i < shown; i++) badges.push(badge(items[i].label, false));
    if (shown < items.length) badges.push(badge(`+${items.length - shown} more`, true));
    let w = title.width;
    let h = title.height;
    for (const s of subtitles) {
      w = Math.max(w, s.width);
      h += s.height;
    }
    if (badges.length > 0) h += HEAD_GAP - ITEM_GAP;
    for (const b of badges) {
      w = Math.max(w, b.w);
      h += ITEM_GAP + b.h;
    }
    return { name, title, subtitles, badges, w, h, cx: 0, cy: 0 };
  };

  const quadrants = QUADRANTS.map(([name]) => block(name));
  const confusion = block('confusion');
  const rx = Math.max(88, confusion.w * 0.71 + 8);
  const ry = Math.max(64, confusion.h * 0.71 + 6);

  let quadW = setting(config, 'width', 640, 100, 10000) / 2;
  let quadH = setting(config, 'height', 440, 100, 10000) / 2;
  for (const b of quadrants) {
    quadW = Math.max(quadW, b.w + 2 * MARGIN);
    quadH = Math.max(quadH, b.h + 2 * MARGIN);
  }
  // A block sits in the middle of its quadrant, so its inner corner must stay clear of the ellipse.
  for (const b of quadrants) {
    const dx = (quadW - b.w) / 2;
    const dy = (quadH - b.h) / 2;
    if ((dx / (rx + CLEARANCE)) ** 2 + (dy / (ry + CLEARANCE)) ** 2 >= 1) continue;
    const wider = b.w + 2 * (rx + CLEARANCE);
    const taller = b.h + 2 * (ry + CLEARANCE);
    if (wider * quadH <= quadW * taller) quadW = Math.max(quadW, wider);
    else quadH = Math.max(quadH, taller);
  }

  const title = layoutLabel(model.title, false, measurer, size, 4000, Style.Bold);
  const titleHeight = title.height > 0 ? title.height + 12 : 0;
  const width = 2 * quadW;
  const height = 2 * quadH;
  const x0 = pad;
  const y0 = pad + titleHeight;
  const cx = x0 + quadW;
  const cy = y0 + quadH;
  const right = x0 + width;
  const bottom = y0 + height;

  const fold = wave(y0, cy, cx, seed, amplitude, { ...FOLD, segments: 4, pinEnd: true });
  const west = wave(x0, cx, cy, seed + 100, amplitude, { ...HORIZON, segments: 4, pinEnd: true });
  const east = wave(cx, right, cy, seed + 200, amplitude, { ...HORIZON, segments: 4, pinStart: true });
  const drop = cliff(cx, cy, bottom, width * 0.03);
  const at = (curve: number[], end: boolean): string =>
    end ? `${num(curve[curve.length - 2])},${num(curve[curve.length - 1])}` : `${num(curve[0])},${num(curve[1])}`;

  const regions = new Map<DomainName, string>([
    ['complex', `M${num(x0)},${num(y0)}L${at(fold, false)}${forward(fold)}${backward(west)}Z`],
    ['complicated', `M${at(fold, false)}L${num(right)},${num(y0)}L${at(east, true)}${backward(east)}${backward(fold)}Z`],
    ['chaotic', `M${at(west, false)}${forward(west)}${forward(drop)}L${num(x0)},${num(bottom)}Z`],
    ['clear', `M${at(east, false)}${forward(east)}L${num(right)},${num(bottom)}L${at(drop, true)}${backward(drop)}Z`],
  ]);

  let fills = '';
  for (const [name, , , color] of QUADRANTS) {
    fills += `<path class="pele-cynefin-region" data-id="${name}" d="${regions.get(name)!}" fill="${seriesColor(color)}" fill-opacity="0.14"/>`;
  }
  const boundaries =
    `<g class="pele-cynefin-boundaries" fill="none" stroke="var(--_b)" stroke-dasharray="6 3">` +
    `<path d="${curvePath(fold)}"/><path d="${curvePath(west)}"/><path d="${curvePath(east)}"/>` +
    `<path class="pele-cynefin-cliff" d="${curvePath(drop)}" stroke="var(--_l)" stroke-width="2" stroke-dasharray="none" stroke-linecap="round"/></g>`;
  const oval = ellipsePath(cx, cy, rx, ry);
  const ellipse =
    `<path d="${oval}" fill="var(--_bg)"/>` +
    `<path class="pele-cynefin-region" data-id="confusion" d="${oval}" fill="${seriesColor(
      CONFUSION_COLOR
    )}" fill-opacity="0.18" stroke="var(--_b)" stroke-dasharray="4 2"/>`;

  const drawBlock = (b: Block): string => {
    let y = b.cy - b.h / 2;
    let out = labelSvg(b.title, b.cx, y + b.title.height / 2, ' class="pele-label" font-weight="var(--_hw)"');
    y += b.title.height;
    for (const s of b.subtitles) {
      out += labelSvg(s, b.cx, y + s.height / 2, ` class="pele-cynefin-subtitle" font-size="${small}" font-style="italic" fill="var(--_m)"`);
      y += s.height;
    }
    y += HEAD_GAP - ITEM_GAP;
    for (const item of b.badges) {
      y += ITEM_GAP;
      out +=
        `<g class="pele-node${item.overflow ? ' pele-cynefin-overflow' : ''}"${item.overflow ? '' : ` data-id="${escText(item.text)}"`}>` +
        `<rect x="${num(b.cx - item.w / 2)}" y="${num(y)}" width="${num(item.w)}" height="${num(
          item.h
        )}" fill="var(--_bg)" stroke="var(--_b)"${item.overflow ? ' stroke-dasharray="3 2"' : ''}${ROUNDED}/>` +
        labelSvg(item.label, b.cx, y + item.h / 2, ` class="pele-label" font-size="${itemSize}"${item.overflow ? ' fill="var(--_m)"' : ''}`, icons) +
        '</g>';
      y += item.h;
    }
    return `<g class="pele-cynefin-domain" data-id="${b.name}">${out}</g>`;
  };

  const blocks = new Map<DomainName, Block>();
  let domains = '';
  QUADRANTS.forEach(([name, col, row], index) => {
    const b = quadrants[index];
    b.cx = x0 + quadW * (col + 0.5);
    b.cy = y0 + quadH * (row + 0.5);
    blocks.set(name, b);
    domains += drawBlock(b);
  });
  confusion.cx = cx;
  confusion.cy = cy;
  blocks.set('confusion', confusion);
  domains += drawBlock(confusion);

  const inside = (b: Block, x: number, y: number): boolean =>
    b === confusion
      ? ((x - cx) / (rx + 4)) ** 2 + ((y - cy) / (ry + 4)) ** 2 <= 1
      : Math.abs(x - b.cx) <= b.w / 2 + 8 && Math.abs(y - b.cy) <= b.h / 2 + 8;

  let edges = '';
  const seen = new Map<string, number>();
  for (const transition of model.transitions) {
    const from = blocks.get(transition.from);
    const to = blocks.get(transition.to);
    if (!from || !to || from === to) continue;
    const key = transition.from < transition.to ? `${transition.from} ${transition.to}` : `${transition.to} ${transition.from}`;
    const repeat = seen.get(key) ?? 0;
    seen.set(key, repeat + 1);

    const dx = to.cx - from.cx;
    const dy = to.cy - from.cy;
    const len = Math.hypot(dx, dy) || 1;
    const mx = (from.cx + to.cx) / 2;
    const my = (from.cy + to.cy) / 2;
    // Curves bow away from the middle of the diagram, which keeps them off the ellipse.
    const outward = -dy * (mx - cx) + dx * (my - cy) >= 0 ? 1 : -1;
    const nx = (-dy / len) * outward;
    const ny = (dx / len) * outward;
    // A diagonal runs through the middle, so it bows far enough to pass the ellipse.
    const diagonal = from !== confusion && to !== confusion && Math.abs(dx) > 1 && Math.abs(dy) > 1;
    const bow = (diagonal ? 2 * (Math.hypot(rx * nx, ry * ny) + 16) : len * 0.15) + repeat * 56;
    const px = mx + nx * bow;
    const py = my + ny * bow;
    const point = (t: number): [number, number] => {
      const u = 1 - t;
      return [u * u * from.cx + 2 * u * t * px + t * t * to.cx, u * u * from.cy + 2 * u * t * py + t * t * to.cy];
    };
    const crossing = (b: Block, lo: number, hi: number, leaving: boolean): number => {
      for (let i = 0; i < 16; i++) {
        const mid = (lo + hi) / 2;
        if (inside(b, ...point(mid)) === leaving) lo = mid;
        else hi = mid;
      }
      return (lo + hi) / 2;
    };
    const STEPS = 48;
    let i = 1;
    while (i <= STEPS && inside(from, ...point(i / STEPS))) i++;
    if (i > STEPS) continue;
    const t0 = crossing(from, (i - 1) / STEPS, i / STEPS, true);
    while (i <= STEPS && !inside(to, ...point(i / STEPS))) i++;
    const t1 = i > STEPS ? 1 : crossing(to, (i - 1) / STEPS, i / STEPS, false);

    const [sx, sy] = point(t0);
    let [ex, ey] = point(t1);
    const blossom = (a: number, b: number, c: number): number => (1 - t0) * (1 - t1) * a + ((1 - t0) * t1 + t0 * (1 - t1)) * b + t0 * t1 * c;
    const qx = blossom(from.cx, px, to.cx);
    const qy = blossom(from.cy, py, to.cy);
    const el = Math.hypot(ex - qx, ey - qy) || 1;
    const ux = (ex - qx) / el;
    const uy = (ey - qy) / el;
    const head = marker('arrow_point', ex, ey, ux, uy, 'var(--_l)');
    ex -= ux * markerTrim('arrow_point');
    ey -= uy * markerTrim('arrow_point');

    let text = '';
    if (transition.label) {
      const label = layoutLabel(transition.label, false, measurer, small, ITEM_MAX_WIDTH);
      const [lx, ly] = point((t0 + t1) / 2);
      const away = (Math.abs(nx) * label.width) / 2 + (Math.abs(ny) * label.height) / 2 + 6;
      const half = label.width / 2 + 4;
      const tx = Math.min(Math.max(lx + nx * away, x0 + half), Math.max(right - half, x0 + half));
      text = labelSvg(label, tx, ly + ny * away, ` class="pele-edge-label" font-size="${small}"`, icons);
    }
    edges +=
      `<g class="pele-edge" data-id="${transition.from}-${transition.to}">` +
      `<path d="M${num(sx)},${num(sy)}Q${num(qx)},${num(qy)} ${num(ex)},${num(ey)}" fill="none" stroke="var(--_l)"/>` +
      head +
      text +
      '</g>';
  }

  const totalWidth = Math.ceil(Math.max(width, title.width) + 2 * pad);
  const totalHeight = Math.ceil(height + titleHeight + 2 * pad);
  const content =
    labelSvg(title, x0 + width / 2, pad + title.height / 2, ' class="pele-title" font-weight="var(--_tw)"') +
    `<g class="pele-cynefin-regions">${fills}</g>` +
    boundaries +
    ellipse +
    domains +
    (edges ? `<g class="pele-edges">${edges}</g>` : '');

  return {
    svg: svgDocument('cynefin', totalWidth, totalHeight, size, options, model, content),
    width: totalWidth,
    height: totalHeight,
    links: [],
  };
}
