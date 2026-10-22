import type { Config } from '../../preprocess.js';
import { escText, labelSvg, num } from '../../svg/builder.js';
import { svgDocument } from '../../svg/root.js';
import { resolveStyle, seriesColor, type ResolvedStyle } from '../../svg/theme.js';
import { layoutLabel, type Label } from '../../text/label.js';
import { Style, defaultMeasurer } from '../../text/measurer.js';
import type { RenderOptions, Rendered } from '../../types.js';
import { normalizeText } from './db.js';
import { findSpot, layoutCircles, regionPath, type Circle, type Spot } from './layout.js';
import type { VennModel, VennSubset } from './types.js';

const RADIUS = 100;
const MAX_GROWTH = 1.6;
const NO_STYLE = resolveStyle([]);

interface Region {
  sets: string[];
  inside: number[];
  spot: Spot;
  // What is written in the region: its label first, then its texts. The id is that of a text.
  lines: { id: string | undefined; raw: string; size: number; base: number; label: Label }[];
  style: ResolvedStyle;
}

// One key for a list of set ids. Ids may hold any character, so they are not simply joined.
function keyOf(ids: string[]): string {
  return ids.length === 1 ? ids[0] : JSON.stringify(ids);
}

export function renderVenn(model: VennModel, _config: Config, options: RenderOptions): Rendered {
  const size = options.fontSize ?? 16;
  const small = Math.round(size * 0.875);
  const tiny = Math.round(size * 0.8125);
  const measurer = options.measurer ?? defaultMeasurer(options.fontFamily, options.fontFamilyMono);
  const pad = options.padding ?? 8;

  const circles = layoutCircles(model.subsets);
  const index = new Map<string, number>();
  circles.forEach((c, i) => index.set(c.id, i));

  // Styles for the same targets add up, later declarations winning.
  const styles = new Map<string, Map<string, string>>();
  for (const { targets, styles: declared } of model.styles) {
    const key = keyOf(targets);
    let merged = styles.get(key);
    if (!merged) styles.set(key, (merged = new Map()));
    for (const [property, value] of declared) merged.set(property, value);
  }
  const styleOf = (key: string): ResolvedStyle => {
    const declared = styles.get(key);
    if (!declared) return NO_STYLE;
    const list: string[] = [];
    for (const [property, value] of declared) list.push(`${property}:${value}`);
    return resolveStyle(list);
  };

  // Circles that touch each circle; only those can cut into a region of it.
  const neighbors: number[][] = circles.map(() => []);
  for (let a = 0; a < circles.length; a++) {
    for (let b = a + 1; b < circles.length; b++) {
      if (Math.hypot(circles[a].x - circles[b].x, circles[a].y - circles[b].y) < circles[a].r + circles[b].r) {
        neighbors[a].push(b);
        neighbors[b].push(a);
      }
    }
  }

  // One region for each set and each stated overlap; a later statement about the same sets replaces an earlier one.
  const stated = new Map<string, VennSubset>();
  for (const subset of model.subsets) stated.set(keyOf(subset.sets), subset);
  const regions = new Map<string, Region>();
  for (const [key, subset] of stated) {
    const sets = [...new Set(subset.sets)];
    const inside = sets.map((id) => index.get(id)!);
    const within = new Set(inside);
    let smallest = inside[0];
    for (const i of inside) if (circles[i].r < circles[smallest].r) smallest = i;
    const style = styleOf(key);
    const text = subset.label ?? (subset.sets.length === 1 ? subset.sets[0] : undefined);
    const base = (style.bold ? Style.Bold : 0) | (style.italic ? Style.Italic : 0);
    let spot = findSpot(circles, inside, neighbors[smallest].filter((i) => !within.has(i)));
    // A region that other circles cover, or all but cover, is written across them instead.
    if (spot.margin < circles[smallest].r * 0.2) spot = findSpot(circles, inside, []);
    const region: Region = { sets, inside, spot, lines: [], style };
    if (text) {
      const fontSize = sets.length === 1 ? size : small;
      region.lines.push({ id: undefined, raw: text, size: fontSize, base, label: layoutLabel(text, false, measurer, fontSize, 4000, base) });
    }
    regions.set(key, region);
  }
  for (const node of model.textNodes) {
    const raw = node.label ?? node.id;
    regions.get(keyOf(node.sets))?.lines.push({ id: node.id, raw, size: tiny, base: 0, label: layoutLabel(raw, false, measurer, tiny, 4000) });
  }

  // Lengths so far are in units of the layout. The scale gives the largest circle a set radius,
  // and grows, within limits, until every region holds what is written in it.
  let largest = 0;
  for (const c of circles) if (c.r > largest) largest = c.r;
  let scale = largest > 0 ? RADIUS / largest : 1;
  let growth = 1;
  for (const region of regions.values()) {
    if (region.spot.margin <= 0) continue;
    let width = 0;
    let height = 0;
    for (const line of region.lines) {
      width = Math.max(width, line.label.width);
      height += line.label.height;
    }
    const need = Math.hypot(width, height) / 2 + 4;
    growth = Math.max(growth, Math.min(need / (region.spot.margin * scale), MAX_GROWTH));
  }
  scale *= growth;

  // What is still too wide for its region is wrapped to it.
  for (const region of regions.values()) {
    const room = Math.max(region.spot.margin * scale * 1.8, 72);
    for (const line of region.lines) {
      if (line.label.width > room) line.label = layoutLabel(line.raw, false, measurer, line.size, room, line.base);
    }
  }

  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const c of circles) {
    minX = Math.min(minX, (c.x - c.r) * scale);
    minY = Math.min(minY, (c.y - c.r) * scale);
    maxX = Math.max(maxX, (c.x + c.r) * scale);
    maxY = Math.max(maxY, (c.y + c.r) * scale);
  }
  for (const region of regions.values()) {
    let wide = 0;
    let tall = 0;
    for (const line of region.lines) {
      wide = Math.max(wide, line.label.width);
      tall += line.label.height;
    }
    minX = Math.min(minX, region.spot.x * scale - wide / 2);
    maxX = Math.max(maxX, region.spot.x * scale + wide / 2);
    minY = Math.min(minY, region.spot.y * scale - tall / 2);
    maxY = Math.max(maxY, region.spot.y * scale + tall / 2);
  }
  if (circles.length === 0) minX = minY = maxX = maxY = 0;

  const title = layoutLabel(model.title && normalizeText(model.title), false, measurer, size, 4000, Style.Bold);
  const titleHeight = title.height > 0 ? title.height + 12 : 0;
  const inner = Math.max(maxX - minX, title.width);
  const ox = pad + (inner - (maxX - minX)) / 2 - minX;
  const oy = pad + titleHeight - minY;
  const width = Math.ceil(inner + 2 * pad);
  const height = Math.ceil(maxY - minY + titleHeight + 2 * pad);
  const placed: Circle[] = circles.map((c) => ({ id: c.id, x: c.x * scale + ox, y: c.y * scale + oy, r: c.r * scale }));

  let sets = '';
  placed.forEach((c, i) => {
    const color = seriesColor(i);
    const style = regions.get(c.id)?.style ?? NO_STYLE;
    sets += `<circle class="pele-venn-set" data-id="${escText(c.id)}" cx="${num(c.x)}" cy="${num(c.y)}" r="${num(c.r)}" fill="${color}" fill-opacity="0.2" stroke="${color}"${style.shape}/>`;
  });

  let overlaps = '';
  let labels = '';
  for (const region of regions.values()) {
    const id = escText(region.sets.join('|'));
    // An overlap is only drawn when a style gives it a look of its own; otherwise the circles show it.
    if (region.sets.length > 1 && region.style.shape !== '') {
      const d = regionPath(region.inside.map((i) => placed[i]), num);
      if (d !== '') overlaps += `<path class="pele-venn-overlap" data-id="${id}" d="${d}" fill="none"${region.style.shape}/>`;
    }
    let total = 0;
    for (const line of region.lines) total += line.label.height;
    if (total === 0) continue;
    const x = region.spot.x * scale + ox;
    let y = region.spot.y * scale + oy - total / 2;
    let content = '';
    for (const line of region.lines) {
      const attrs =
        line.id === undefined
          ? ` class="pele-label"${line.size === size ? '' : ` font-size="${line.size}"`}${region.style.text}`
          : ` class="pele-venn-text" data-id="${escText(line.id)}" font-size="${tiny}" fill="var(--_m)"${styleOf(line.id).text}`;
      content += labelSvg(line.label, x, y + line.label.height / 2, attrs);
      y += line.label.height;
    }
    labels += `<g class="pele-venn-region" data-id="${id}">${content}</g>`;
  }

  const svg = svgDocument(
    'venn',
    width,
    height,
    size,
    options,
    {},
    labelSvg(title, width / 2, pad + title.height / 2, ' class="pele-title" font-weight="var(--_tw)"') +
      `<g class="pele-venn-sets">${sets}</g>` +
      (overlaps ? `<g class="pele-venn-overlaps">${overlaps}</g>` : '') +
      (labels ? `<g class="pele-venn-labels">${labels}</g>` : '')
  );
  return { svg, width, height, links: [] };
}
