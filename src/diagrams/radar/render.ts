import type { Config } from '../../preprocess.js';
import { escText, labelSvg, num } from '../../svg/builder.js';
import { svgDocument } from '../../svg/root.js';
import { seriesColor } from '../../svg/theme.js';
import { layoutLabel, type Label } from '../../text/label.js';
import { Style, defaultMeasurer } from '../../text/measurer.js';
import type { RenderOptions, Rendered } from '../../types.js';
import { fitWidth, titleRoom } from '../common/fit-width.js';
import type { RadarModel } from './model.js';

const SWATCH = 12;
const ROW = 26;
const GAP = 24;

interface Point {
  x: number;
  y: number;
}

function option(config: Config, key: string, fallback: number, min: number, max: number): number {
  const value = (config.radar as Config | undefined)?.[key];
  return typeof value === 'number' && value >= min ? Math.min(value, max) : fallback;
}

export function relativeRadius(value: number, min: number, max: number, radius: number): number {
  const clipped = Math.min(Math.max(value, min), max);
  return (radius * (clipped - min)) / (max - min);
}

// A closed Catmull-Rom spline through the points, as cubic Bézier segments.
export function closedRoundCurve(points: Point[], tension: number): string {
  const n = points.length;
  let d = `M${num(points[0].x)},${num(points[0].y)}`;
  for (let i = 0; i < n; i++) {
    const p0 = points[(i - 1 + n) % n];
    const p1 = points[i];
    const p2 = points[(i + 1) % n];
    const p3 = points[(i + 2) % n];
    d +=
      ` C${num(p1.x + (p2.x - p0.x) * tension)},${num(p1.y + (p2.y - p0.y) * tension)}` +
      ` ${num(p2.x - (p3.x - p1.x) * tension)},${num(p2.y - (p3.y - p1.y) * tension)} ${num(p2.x)},${num(p2.y)}`;
  }
  return d + ' Z';
}

function polygon(points: Point[]): string {
  let out = '';
  for (const p of points) out += (out ? ' ' : '') + num(p.x) + ',' + num(p.y);
  return out;
}

export function renderRadar(model: RadarModel, config: Config, options: RenderOptions): Rendered {
  const natural = option(config, 'width', 320, 1, 4000);
  return fitWidth(options, natural, 160, (width, tight) => draw(model, config, options, width, (option(config, 'height', 320, 1, 4000) * width) / natural, tight));
}

// `tight` is set when the chart does not fit the width it has with its legend beside it.
function draw(model: RadarModel, config: Config, options: RenderOptions, width: number, height: number, tight: boolean): Rendered {
  const size = options.fontSize ?? 16;
  const small = Math.round(size * 0.875);
  const measurer = options.measurer ?? defaultMeasurer(options.fontFamily, options.fontFamilyMono);
  const pad = options.padding ?? 8;

  const axisScale = option(config, 'axisScaleFactor', 1, 0, 10);
  const labelFactor = option(config, 'axisLabelFactor', 1.05, 0, 10);
  const tension = option(config, 'curveTension', 0.17, 0, 1);
  const radius = Math.min(width, height) / 2;

  const { axes, curves } = model;
  const { ticks, graticule, min } = model.options;
  const count = axes.length;
  const unit: Point[] = axes.map((_, i) => {
    const angle = (2 * Math.PI * i) / count - Math.PI / 2;
    return { x: Math.cos(angle), y: Math.sin(angle) };
  });

  let max = model.options.max;
  if (max === null) {
    max = -Infinity;
    for (const curve of curves) for (const value of curve.entries) if (value > max) max = value;
  }

  // The chart is drawn around the origin. Margins reserve space; labels and the legend widen it.
  let x0 = -width / 2 - option(config, 'marginLeft', 16, 0, 2000);
  let x1 = width / 2 + option(config, 'marginRight', 16, 0, 2000);
  let y0 = -height / 2 - option(config, 'marginTop', 16, 0, 2000);
  let y1 = height / 2 + option(config, 'marginBottom', 16, 0, 2000);

  let grid = '';
  for (let i = 0; i < ticks; i++) {
    const r = Math.min(radius, (radius * (i + 1)) / ticks);
    if (graticule === 'circle') grid += `<circle r="${num(r)}"/>`;
    else grid += `<polygon points="${polygon(unit.map((u) => ({ x: u.x * r, y: u.y * r })))}"/>`;
  }

  let spokes = '';
  let labels = '';
  unit.forEach((u, i) => {
    const reach = radius * axisScale;
    spokes += `M0,0L${num(u.x * reach)},${num(u.y * reach)}`;
    const label = layoutLabel(axes[i].label, false, measurer, small, 4000);
    const at = radius * labelFactor + 6;
    // Each label hangs off its axis on the side away from the center.
    const cx = u.x * at + (u.x > 0.01 ? label.width / 2 : u.x < -0.01 ? -label.width / 2 : 0);
    const cy = u.y * at + (u.y > 0.01 ? label.height / 2 : u.y < -0.01 ? -label.height / 2 : 0);
    labels += `<g class="pele-axis-label" data-id="${escText(axes[i].name)}">${labelSvg(label, cx, cy, '')}</g>`;
    x0 = Math.min(x0, cx - label.width / 2);
    x1 = Math.max(x1, cx + label.width / 2);
    y0 = Math.min(y0, cy - label.height / 2);
    y1 = Math.max(y1, cy + label.height / 2);
  });

  let shapes = '';
  curves.forEach((curve, index) => {
    // Mermaid leaves out a curve that does not have a value for every axis.
    if (curve.entries.length !== count) return;
    const points = curve.entries.map((value, i) => {
      const r = relativeRadius(value, min, max, radius);
      const safe = Number.isFinite(r) ? r : 0;
      return { x: unit[i].x * safe, y: unit[i].y * safe };
    });
    const color = seriesColor(index);
    const attrs = ` class="pele-curve" data-id="${escText(curve.name)}" fill="${color}" stroke="${color}"`;
    shapes +=
      graticule === 'circle'
        ? `<path${attrs} d="${closedRoundCurve(points, tension)}"/>`
        : `<polygon${attrs} points="${polygon(points)}"/>`;
  });

  const legend: Label[] = model.options.showLegend
    ? curves.map((curve) => layoutLabel(curve.label, false, measurer, small, 4000))
    : [];
  let legendWidth = 0;
  for (const label of legend) legendWidth = Math.max(legendWidth, label.width);
  const legendHeight = legend.length * ROW;
  const legendX = tight ? -(SWATCH + 8 + legendWidth) / 2 : x1 + GAP;
  const legendTop = tight ? y1 + GAP / 2 : -legendHeight / 2;
  if (legend.length > 0 && tight) {
    x0 = Math.min(x0, legendX);
    x1 = Math.max(x1, -legendX);
    y1 = legendTop + legendHeight;
  } else if (legend.length > 0) {
    x1 = legendX + SWATCH + 8 + legendWidth;
    y0 = Math.min(y0, -legendHeight / 2);
    y1 = Math.max(y1, legendHeight / 2);
  }
  let legendOut = '';
  legend.forEach((label, index) => {
    const y = legendTop + index * ROW + ROW / 2;
    const color = seriesColor(index);
    legendOut +=
      `<g class="pele-legend-item" data-id="${escText(curves[index].name)}">` +
      `<rect x="${num(legendX)}" y="${num(y - SWATCH / 2)}" width="${SWATCH}" height="${SWATCH}" rx="2" fill="${color}" fill-opacity="0.4" stroke="${color}"/>` +
      labelSvg(label, legendX + SWATCH + 8 + label.width / 2, y, '') +
      '</g>';
  });

  const title = layoutLabel(model.title, false, measurer, size, titleRoom(options), Style.Bold);
  const titleHeight = title.height > 0 ? title.height + 8 : 0;
  const bodyWidth = Math.max(x1 - x0, title.width);
  const totalWidth = Math.ceil(bodyWidth + 2 * pad);
  const totalHeight = Math.ceil(y1 - y0 + titleHeight + 2 * pad);
  const origin = `translate(${num(pad + (bodyWidth - (x1 - x0)) / 2 - x0)},${num(pad + titleHeight - y0)})`;

  const content =
    labelSvg(title, totalWidth / 2, pad + title.height / 2, ' class="pele-title" font-weight="var(--_tw)"') +
    `<g transform="${origin}">` +
    (grid ? `<g class="pele-graticule" fill="none" stroke="var(--_a)">${grid}</g>` : '') +
    (spokes ? `<path class="pele-axes" d="${spokes}" fill="none" stroke="var(--_b)"/>` : '') +
    (shapes ? `<g class="pele-curves" fill-opacity="0.2" stroke-width="1.5" stroke-linejoin="round">${shapes}</g>` : '') +
    (labels ? `<g class="pele-axis-labels" font-size="${small}">${labels}</g>` : '') +
    (legendOut ? `<g class="pele-legend" font-size="${small}">${legendOut}</g>` : '') +
    '</g>';

  return {
    svg: svgDocument('radar', totalWidth, totalHeight, size, options, model, content),
    width: totalWidth,
    height: totalHeight,
    links: [],
  };
}
