import type { Config } from '../../preprocess.js';
import { escText, labelSvg, num } from '../../svg/builder.js';
import { svgDocument } from '../../svg/root.js';
import { seriesColor } from '../../svg/theme.js';
import { layoutLabel, type Label } from '../../text/label.js';
import { Style, defaultMeasurer } from '../../text/measurer.js';
import type { RenderOptions, Rendered } from '../../types.js';
import { fitWidth, titleRoom } from '../common/fit-width.js';
import type { PieModel } from './model.js';

const RADIUS = 120;
const SWATCH = 12;
const ROW = 26;
const GAP = 32;
const OUTSIDE = 28;

function option(config: Config, key: string): unknown {
  return (config.pie as Config | undefined)?.[key];
}

function point(angle: number, radius: number): string {
  return `${num(Math.sin(angle) * radius)},${num(-Math.cos(angle) * radius)}`;
}

function slice(start: number, end: number, outer: number, inner: number): string {
  if (end - start >= Math.PI * 2 - 1e-9) {
    const ring = (r: number, sweep: number): string =>
      `M0,${num(-r)}A${num(r)},${num(r)} 0 1 ${sweep} 0,${num(r)}A${num(r)},${num(r)} 0 1 ${sweep} 0,${num(-r)}Z`;
    return ring(outer, 1) + (inner > 0 ? ring(inner, 0) : '');
  }
  const large = end - start > Math.PI ? 1 : 0;
  if (inner <= 0) {
    return `M0,0L${point(start, outer)}A${num(outer)},${num(outer)} 0 ${large} 1 ${point(end, outer)}Z`;
  }
  return (
    `M${point(start, outer)}A${num(outer)},${num(outer)} 0 ${large} 1 ${point(end, outer)}` +
    `L${point(end, inner)}A${num(inner)},${num(inner)} 0 ${large} 0 ${point(start, inner)}Z`
  );
}

export function renderPie(model: PieModel, config: Config, options: RenderOptions): Rendered {
  return fitWidth(options, RADIUS * 2, 140, (diameter, tight) => draw(model, config, options, diameter / 2, tight));
}

// `tight` is set when the chart does not fit the width it has with its legend beside it.
function draw(model: PieModel, config: Config, options: RenderOptions, radius: number, tight: boolean): Rendered {
  const size = options.fontSize ?? 16;
  const small = Math.round(size * 0.875);
  const measurer = options.measurer ?? defaultMeasurer(options.fontFamily, options.fontFamilyMono);
  const pad = options.padding ?? 8;

  const position = option(config, 'textPosition');
  const textPosition = typeof position === 'number' && position >= 0 && position <= 1 ? position : 0.75;
  const hole = option(config, 'donutHole');
  const inner = typeof hole === 'number' && hole > 0 && hole <= 0.9 ? hole * radius : 0;
  const placed = String(option(config, 'legendPosition') ?? 'right');
  const legendPosition = tight && (placed === 'left' || placed === 'right') ? 'bottom' : placed;

  const entries = [...model.sections];
  let sum = 0;
  for (const [, value] of entries) sum += value;

  const legend: Label[] = entries.map(([label, value]) =>
    layoutLabel(model.showData ? `${label} [${value}]` : label, false, measurer, small, 4000)
  );
  let legendWidth = 0;
  for (const label of legend) legendWidth = Math.max(legendWidth, label.width);
  legendWidth += legend.length > 0 ? SWATCH + 8 : 0;
  const legendHeight = legend.length * ROW;

  const title = layoutLabel(model.title, false, measurer, size, titleRoom(options), Style.Bold);
  const titleHeight = title.height > 0 ? title.height + 16 : 0;

  // A slice too thin for its percentage gets the label outside the rim, which needs a margin.
  const shares = entries.map(([, value]) => {
    const share = sum > 0 ? value / sum : 0;
    return share * 100 >= 1 && (share * 100).toFixed(0) !== '0' ? share : 0;
  });
  const narrow = shares.map((share) => {
    if (share === 0 || share >= 0.5) return false;
    const chord = 2 * radius * textPosition * Math.sin(share * Math.PI);
    return chord < measurer.width((share * 100).toFixed(0) + '%', small, 0) + 6;
  });
  const margin = narrow.includes(true) ? OUTSIDE : 0;

  const side = legendPosition === 'left' || legendPosition === 'right' || legendPosition === 'center' ? legendPosition : '';
  const stacked = legendPosition === 'top' || legendPosition === 'bottom';
  const diameter = (radius + margin) * 2;
  let width = diameter;
  let height = diameter;
  if (side === 'left' || side === 'right') {
    width += legendWidth > 0 ? GAP + legendWidth : 0;
    height = Math.max(height, legendHeight);
  } else if (stacked) {
    width = Math.max(width, legendWidth);
    height += legendHeight > 0 ? 20 + legendHeight : 0;
  }
  width = Math.max(width, title.width);

  const cx = pad + (side === 'left' ? legendWidth + GAP + diameter / 2 : side === 'right' ? diameter / 2 : width / 2);
  const bodyTop = pad + titleHeight;
  const cy = bodyTop + (legendPosition === 'top' ? legendHeight + 20 + diameter / 2 : stacked ? diameter / 2 : height / 2);

  let slices = '';
  let labels = '';
  let outside = '';
  let angle = 0;
  const rim = radius + OUTSIDE / 2;
  const placedOutside: { x: number; y: number; width: number }[] = [];
  const clear = (x: number, y: number, width: number): boolean =>
    placedOutside.every((other) => Math.abs(x - other.x) >= (width + other.width) / 2 + 2 || Math.abs(y - other.y) >= small + 2);
  entries.forEach(([label], index) => {
    const share = shares[index];
    if (share === 0) return;
    const end = angle + share * Math.PI * 2;
    slices += `<path class="pele-slice" data-id="${escText(label)}" d="${slice(angle, end, radius, inner)}" fill="${seriesColor(index)}"/>`;
    const mid = (angle + end) / 2;
    const text = (share * 100).toFixed(0) + '%';
    if (narrow[index]) {
      const width = measurer.width(text, small, 0);
      let at = mid;
      for (let step = 0; step < 360 && !clear(Math.sin(at) * rim, -Math.cos(at) * rim, width); step++) at += 2 / rim;
      const x = Math.sin(at) * rim;
      const y = -Math.cos(at) * rim;
      placedOutside.push({ x, y, width });
      outside += `<text x="${num(x)}" y="${num(y + small * 0.35)}">${text}</text>`;
    } else {
      const r = radius * textPosition;
      labels += `<text x="${num(Math.sin(mid) * r)}" y="${num(-Math.cos(mid) * r + small * 0.35)}">${text}</text>`;
    }
    angle = end;
  });
  if (slices === '') {
    slices = `<circle class="pele-slice" r="${radius}" fill="none" stroke="var(--_b)"/>`;
  }

  let legendOut = '';
  let lx: number;
  let ly: number;
  if (side === 'right') {
    lx = cx + diameter / 2 + GAP;
    ly = bodyTop + (height - legendHeight) / 2;
  } else if (side === 'left') {
    lx = pad;
    ly = bodyTop + (height - legendHeight) / 2;
  } else if (side === 'center') {
    lx = cx - legendWidth / 2;
    ly = cy - legendHeight / 2;
  } else {
    lx = pad + (width - legendWidth) / 2;
    ly = legendPosition === 'top' ? bodyTop : bodyTop + diameter + 20;
  }
  legend.forEach((label, index) => {
    const y = ly + index * ROW + ROW / 2;
    legendOut +=
      `<g class="pele-legend-item" data-id="${escText(entries[index][0])}">` +
      `<rect x="${num(lx)}" y="${num(y - SWATCH / 2)}" width="${SWATCH}" height="${SWATCH}" rx="2" fill="${seriesColor(index)}"/>` +
      labelSvg(label, lx + SWATCH + 8 + label.width / 2, y, '') +
      '</g>';
  });

  const totalWidth = Math.ceil(width + 2 * pad);
  const totalHeight = Math.ceil(height + titleHeight + 2 * pad);
  const content =
    labelSvg(title, totalWidth / 2, pad + title.height / 2, ' class="pele-title" font-weight="var(--_tw)"') +
    `<g class="pele-slices" transform="translate(${num(cx)},${num(cy)})" stroke="var(--_bg)" stroke-width="1" stroke-linejoin="round">${slices}</g>` +
    (labels
      ? `<g class="pele-slice-labels" transform="translate(${num(cx)},${num(cy)})" font-size="${small}" text-anchor="middle" fill="var(--_bg)">${labels}</g>`
      : '') +
    (outside
      ? `<g class="pele-slice-labels" transform="translate(${num(cx)},${num(cy)})" font-size="${small}" text-anchor="middle">${outside}</g>`
      : '') +
    (legendOut ? `<g class="pele-legend" font-size="${small}">${legendOut}</g>` : '');

  return {
    svg: svgDocument('pie', totalWidth, totalHeight, size, options, model, content),
    width: totalWidth,
    height: totalHeight,
    links: [],
  };
}
