import { PeleError } from '../../errors.js';
import type { Config } from '../../preprocess.js';
import { esc, escText, labelSvg, num } from '../../svg/builder.js';
import { svgDocument } from '../../svg/root.js';
import { seriesColor } from '../../svg/theme.js';
import { layoutLabel, type Label } from '../../text/label.js';
import { Style, defaultMeasurer } from '../../text/measurer.js';
import type { RenderOptions, Rendered } from '../../types.js';
import { capWidth } from '../common/fit-width.js';
import type { XyChartModel } from './db.js';
import { tickIndex, tickStep, tickValue, ticksBetween } from './ticks.js';

const TICK = 4;
const SWATCH = 12;
const ROW = 26;
const LEGEND_GAP = 24;
const LIMIT = 1e300;

interface Mark {
  at: number;
  label: Label;
}

function record(value: unknown): Config {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Config) : {};
}

function on(config: Config, key: string, fallback = true): boolean {
  const value = config[key];
  return typeof value === 'boolean' ? value : fallback;
}

function dimension(value: unknown, fallback: number): number {
  return typeof value === 'number' && value > 0 ? Math.round(Math.min(Math.max(value, 100), 4000)) : fallback;
}

function legendPosition(chart: Config): 'right' | 'left' | 'top' | 'bottom' {
  const value = chart.legendPosition;
  return value === 'left' || value === 'top' || value === 'bottom' ? value : 'right';
}

interface LegendRow {
  items: { index: number; label: Label }[];
  width: number;
  height: number;
}

// Lay legend items out in centered rows across the available width, for a
// legend above or below the plot. Items keep their swatch and label together.
function legendRows(legend: { index: number; label: Label }[], maxWidth: number): LegendRow[] {
  const rows: LegendRow[] = [];
  let row: LegendRow = { items: [], width: 0, height: 0 };
  for (const item of legend) {
    const itemWidth = SWATCH + 8 + item.label.width;
    const height = Math.max(ROW, item.label.height + 6);
    if (row.items.length > 0 && row.width + 16 + itemWidth > maxWidth) {
      rows.push(row);
      row = { items: [], width: 0, height: 0 };
    }
    row.items.push(item);
    row.width += (row.items.length > 1 ? 16 : 0) + itemWidth;
    row.height = Math.max(row.height, height);
  }
  if (row.items.length > 0) rows.push(row);
  return rows;
}

function finite(value: number | undefined): number | undefined {
  return typeof value === 'number' && isFinite(value) ? Math.min(Math.max(value, -LIMIT), LIMIT) : undefined;
}

function widest(marks: Mark[]): number {
  let width = 0;
  for (const mark of marks) width = Math.max(width, mark.label.width);
  return width;
}

// Writes a label with its left edge, center or right edge at x. A plain one-line label keeps
// its place when the text is wider or narrower than measured.
function aligned(label: Label, x: number, y: number, anchor: 'start' | 'middle' | 'end'): string {
  const line = label.lines.length === 1 ? label.lines[0] : undefined;
  if (line && line.length === 1 && line[0].icon === undefined && line[0].style === 0) {
    return `<text x="${num(x)}" y="${num(y + label.size * 0.35)}" text-anchor="${anchor}">${esc(line[0].text)}</text>`;
  }
  return labelSvg(label, x + (anchor === 'start' ? label.width / 2 : anchor === 'end' ? -label.width / 2 : 0), y, '');
}

export function renderXyChart(model: XyChartModel, config: Config, options: RenderOptions): Rendered {
  if (model.plots.length === 0) {
    throw new PeleError('No Plot to render, please provide a plot with some data', 'semantic', { type: 'xychart' });
  }
  const chart = record(config.xyChart);
  const size = options.fontSize ?? 16;
  const small = Math.round(size * 0.875);
  const tiny = Math.round(size * 0.75);
  const measurer = options.measurer ?? defaultMeasurer(options.fontFamily, options.fontFamilyMono);
  const pad = options.padding ?? 8;
  const natural = dimension(chart.width, 700);
  const width = capWidth(options, natural, 240);
  // A narrower chart is not as much shorter, so that the plot keeps room for its marks.
  const height = Math.round(dimension(chart.height, 500) * Math.max(0.6, width / natural));
  const horizontal = (model.orientation ?? chart.chartOrientation) === 'horizontal';
  // The value of a bar is always written past its end, which is what showDataLabelOutsideBar asks
  // for in Mermaid. Inside, whether it fits changes from bar to bar and with the width of the chart.
  const showValues = on(chart, 'showDataLabel', false);
  const x = model.xAxis;
  const plots = model.plots;
  const text = (raw: string | undefined, fontSize: number, max: number): Label =>
    layoutLabel(raw, false, measurer, fontSize, max);
  const lineHeight = text('0', small, 4000).height;
  const tinyHeight = text('0', tiny, 4000).height;

  const title = layoutLabel(on(chart, 'showTitle') ? model.title : undefined, false, measurer, size, width - 2 * pad, Style.Bold);
  const titleSpace = title.height > 0 ? title.height + 12 : 0;

  const legend: { index: number; label: Label }[] = [];
  let legendWidth = 0;
  if (on(chart, 'showLegend')) {
    plots.forEach((plot, index) => {
      if (plot.title === '') return;
      const label = text(plot.title, small, width * 0.3);
      legend.push({ index, label });
      legendWidth = Math.max(legendWidth, label.width + SWATCH + 8);
    });
  }
  const position = legendPosition(chart);
  const horizontalLegend = position === 'top' || position === 'bottom';
  // A side legend takes room from the plot width; a top or bottom legend takes
  // room from the plot height instead, as rows across the full inner width.
  const legendSpace = !horizontalLegend && legend.length > 0 ? legendWidth + LEGEND_GAP : 0;
  const rows = horizontalLegend ? legendRows(legend, width - 2 * pad) : [];
  const legendBlockHeight = rows.reduce((sum, row) => sum + row.height, 0);
  const legendBottomReserve = position === 'bottom' ? legendBlockHeight + LEGEND_GAP : 0;

  // The value range: as written, or taken from the data, where bars stand on zero and the
  // range grows to whole steps.
  const bars = plots.filter((plot) => plot.type === 'bar').length;
  let lo = finite(model.yAxis.min) ?? Infinity;
  let hi = finite(model.yAxis.max) ?? -Infinity;
  const exact = model.hasSetYAxis && isFinite(lo) && isFinite(hi) && lo !== hi;
  if (!exact) {
    lo = Infinity;
    hi = -Infinity;
    for (const plot of plots) {
      for (const [, raw] of plot.data) {
        const value = finite(raw);
        if (value === undefined) continue;
        if (value < lo) lo = value;
        if (value > hi) hi = value;
      }
    }
    if (lo > hi) lo = hi = 0;
    if (bars > 0) {
      lo = Math.min(lo, 0);
      hi = Math.max(hi, 0);
    }
    if (lo === hi) {
      if (lo === 0) hi = 1;
      else {
        lo -= Math.abs(lo) / 2;
        hi += Math.abs(hi) / 2;
      }
    }
  }

  const valueMarks = (length: number, spacing: number): Mark[] => {
    const step = tickStep(Math.abs(hi - lo), Math.max(2, Math.min(10, Math.floor(length / spacing))));
    if (!exact) {
      lo = tickValue(step, Math.floor(tickIndex(step, lo) + 1e-9));
      hi = tickValue(step, Math.ceil(tickIndex(step, hi) - 1e-9));
    }
    return ticksBetween(Math.min(lo, hi), Math.max(lo, hi), step).map((value) => ({
      at: (value - lo) / (hi - lo),
      label: text(String(value), small, 4000),
    }));
  };

  // Places along the category axis are fractions of its length. Categories and bars sit in the
  // middle of equal slots; the points of a line on a numeric axis run from end to end.
  let count = 1;
  if (x.type === 'band') count = Math.max(x.categories.length, 1);
  else for (const plot of plots) count = Math.max(count, plot.data.length);
  const slot = 1 / count;
  const inset = x.type === 'band' || bars > 0 ? slot / 2 : 0;
  const x0 = finite(x.type === 'linear' ? x.min : undefined);
  const x1 = finite(x.type === 'linear' ? x.max : undefined);
  const ranged = x0 !== undefined && x1 !== undefined && x0 !== x1;
  const place = (i: number, n: number): number =>
    x.type === 'band' ? (i + 0.5) * slot : inset + (n > 1 ? i / (n - 1) : ranged ? 0 : 0.5) * (1 - 2 * inset);

  const categoryConf = record(chart.xAxis);
  const valueConf = record(chart.yAxis);
  const leftConf = horizontal ? categoryConf : valueConf;
  const bottomConf = horizontal ? valueConf : categoryConf;
  const leftTitle = text(on(leftConf, 'showTitle') ? (horizontal ? x.title : model.yAxis.title) : undefined, small, height * 0.8);
  const bottomTitle = text(on(bottomConf, 'showTitle') ? (horizontal ? model.yAxis.title : x.title) : undefined, small, width * 0.8);
  const leftTick = on(leftConf, 'showTick') ? TICK : 0;
  const bottomTick = on(bottomConf, 'showTick') ? TICK : 0;
  const leftLabels = on(leftConf, 'showLabel');
  const bottomLabels = on(bottomConf, 'showLabel');

  const wrapAt = horizontal ? width * 0.3 : Math.max(48, (width - 2 * pad - 64 - legendSpace) * slot - 8);
  const categories =
    x.type === 'band' && on(categoryConf, 'showLabel') ? x.categories.map((category) => text(category, small, wrapAt)) : [];
  let categoryWidth = 0;
  let categoryHeight = 0;
  for (const label of categories) {
    categoryWidth = Math.max(categoryWidth, label.width);
    categoryHeight = Math.max(categoryHeight, label.height);
  }

  // The labelled places of the category axis. Labels that would run into each other are thinned out.
  const categoryMarks = (length: number): Mark[] => {
    const marks: Mark[] = [];
    if (x.type === 'band') {
      const need = categories.length === 0 ? 8 : horizontal ? categoryHeight : categoryWidth + 12;
      const every = Math.max(1, Math.ceil(need / (length * slot)));
      for (let i = 0; i < x.categories.length; i += every) {
        marks.push({ at: (i + 0.5) * slot, label: categories[i] ?? text(undefined, small, 0) });
      }
    } else if (ranged) {
      const step = tickStep(Math.abs(x1 - x0), Math.max(2, Math.min(10, Math.floor(length / (horizontal ? 32 : 80)))));
      for (const value of ticksBetween(Math.min(x0, x1), Math.max(x0, x1), step)) {
        marks.push({ at: inset + ((value - x0) / (x1 - x0)) * (1 - 2 * inset), label: text(String(value), small, 4000) });
      }
    } else if (x0 !== undefined) {
      marks.push({ at: 0.5, label: text(String(x0), small, 4000) });
    }
    return marks;
  };

  // Room past the end of the value axis for what is written beside a point or a bar.
  let pointLabelWidth = 0;
  let valueWidth = 0;
  for (const plot of plots) {
    for (const label of plot.pointLabels ?? []) pointLabelWidth = Math.max(pointLabelWidth, measurer.width(label, tiny, 0));
    if (showValues && horizontal && plot.type === 'bar') {
      for (const [, value] of plot.data) valueWidth = Math.max(valueWidth, measurer.width(String(finite(value) ?? ''), tiny, 0));
    }
  }

  const bottomLabelHeight = !bottomLabels ? 0 : horizontal || x.type !== 'band' ? lineHeight : categoryHeight;
  const bottomSpace =
    bottomTick + (bottomLabelHeight > 0 ? bottomLabelHeight + 4 : 0) + (bottomTitle.height > 0 ? bottomTitle.height + 4 : 0) + legendBottomReserve;
  const headroom = horizontal ? 0 : pointLabelWidth > 0 || showValues ? tinyHeight + 4 : leftLabels ? lineHeight / 2 : 0;
  const top = pad + titleSpace + headroom + (position === 'top' ? legendBlockHeight + LEGEND_GAP : 0);
  const plotHeight = Math.max(1, height - pad - bottomSpace - top);
  const bottom = top + plotHeight;

  const leftMarks = horizontal ? categoryMarks(plotHeight) : valueMarks(plotHeight, 56);
  const leftLabelWidth = leftLabels ? widest(leftMarks) : 0;
  const left =
    pad + (position === 'left' ? legendSpace : 0) + (leftTitle.height > 0 ? leftTitle.height + 6 : 0) + (leftLabelWidth > 0 ? leftLabelWidth + 6 : 0) + leftTick;
  const beside = Math.max(pointLabelWidth > 0 ? pointLabelWidth + 12 : 0, valueWidth > 0 ? valueWidth + 8 : 0);
  const reach = horizontal ? Math.min(width * 0.25, beside) : 0;
  let plotWidth = Math.max(1, width - pad - left - (position === 'right' ? legendSpace : 0) - reach);
  const bottomMarks = horizontal ? valueMarks(plotWidth, 80) : categoryMarks(plotWidth);
  if (bottomLabels && legendSpace + reach === 0) {
    let over = 0;
    for (const mark of bottomMarks) over = Math.max(over, mark.at * plotWidth + mark.label.width / 2 - plotWidth);
    plotWidth = Math.max(1, plotWidth - over);
  }
  const right = left + plotWidth;

  const px = (c: number, v: number): number => (horizontal ? left + v * plotWidth : left + c * plotWidth);
  const py = (c: number, v: number): number => (horizontal ? top + c * plotHeight : bottom - v * plotHeight);
  const scale = (value: number): number => (value - lo) / (hi - lo);
  const clamp = (v: number): number => Math.min(Math.max(v, 0), 1);

  // A line across the plot at a place on the value axis.
  const rule = (v: number): string =>
    horizontal ? `M${num(px(0, v))},${num(top)}V${num(bottom)}` : `M${num(left)},${num(py(0, v))}H${num(right)}`;

  let grid = '';
  for (const mark of horizontal ? bottomMarks : leftMarks) grid += rule(mark.at);

  let axis = '';
  let labels = '';
  if (on(leftConf, 'showAxisLine')) axis += `M${num(left)},${num(top)}V${num(bottom)}`;
  if (on(bottomConf, 'showAxisLine')) axis += `M${num(left)},${num(bottom)}H${num(right)}`;
  for (const mark of leftMarks) {
    const y = horizontal ? top + mark.at * plotHeight : bottom - mark.at * plotHeight;
    if (leftTick) axis += `M${num(left)},${num(y)}h${-leftTick}`;
    if (leftLabels) labels += aligned(mark.label, left - leftTick - 6, y, 'end');
  }
  for (const mark of bottomMarks) {
    const at = left + mark.at * plotWidth;
    if (bottomTick) axis += `M${num(at)},${num(bottom)}v${bottomTick}`;
    if (bottomLabels) labels += aligned(mark.label, at, bottom + bottomTick + 4 + mark.label.height / 2, 'middle');
  }

  const span = (horizontal ? plotHeight : plotWidth) * slot;
  const group = span * 0.7;
  const thickness = group / Math.max(bars, 1);
  const gap = bars > 1 ? Math.min(2, thickness * 0.2) : 0;
  const base = clamp(scale(0));
  // Bars that go both ways get a line to stand on.
  if (bars > 0 && base > 0 && base < 1) axis += rule(base);
  // Lines are drawn over the bars wherever they were declared, as a bar would hide part of one
  // under it. A series keeps the color of its place in the source.
  let series = '';
  let lines = '';
  let outside = '';
  let pointLabels = '';
  let bar = 0;
  plots.forEach((plot, index) => {
    const color = seriesColor(index);
    const id = plot.title ? ` data-id="${escText(plot.title)}"` : '';
    // A series declared before the categories can hold more values than there are categories.
    const n = x.type === 'band' ? Math.min(plot.data.length, count) : plot.data.length;
    if (plot.type === 'bar') {
      const offset = (bar++ - (bars - 1) / 2) * thickness - (thickness - gap) / 2;
      let rects = '';
      for (let i = 0; i < n; i++) {
        const value = finite(plot.data[i][1]);
        if (value === undefined) continue;
        const c = place(i, n);
        const v = clamp(scale(value));
        const from = Math.min(base, v);
        const to = Math.max(base, v);
        const bx = horizontal ? px(c, from) : px(c, 0) + offset;
        const by = horizontal ? py(c, 0) + offset : py(c, to);
        const bw = horizontal ? (to - from) * plotWidth : thickness - gap;
        const bh = horizontal ? thickness - gap : (to - from) * plotHeight;
        rects += `<rect x="${num(bx)}" y="${num(by)}" width="${num(bw)}" height="${num(bh)}"/>`;
        if (!showValues) continue;
        const label = String(value);
        const w = measurer.width(label, tiny, 0);
        // Towards the end of the bar: 1 when it runs up or right from the baseline, -1 the other way.
        const out = v >= base ? 1 : -1;
        let tx = bx + bw / 2;
        let ty = by + bh / 2;
        let anchor = 'middle';
        if (horizontal) {
          if (bh < tiny) continue;
          tx = (out > 0 ? bx + bw : bx) + out * 6;
          anchor = out > 0 ? 'start' : 'end';
        } else {
          if (w + 2 > span / bars) continue;
          ty = (out > 0 ? by : by + bh) - out * (tinyHeight / 2 + 2);
        }
        outside += `<text x="${num(tx)}" y="${num(ty + tiny * 0.35)}" text-anchor="${anchor}">${label}</text>`;
      }
      series += `<g class="pele-series pele-bars"${id} fill="${color}">${rects}</g>`;
      return;
    }

    // A line is cut where it leaves the value range, so it stays inside the plot.
    let d = '';
    let dots = '';
    let pen = false;
    let pc = 0;
    let pv = NaN;
    for (let i = 0; i < n; i++) {
      const value = finite(plot.data[i][1]);
      if (value === undefined) {
        pv = NaN;
        continue;
      }
      const c = place(i, n);
      const v = scale(value);
      const visible = v >= 0 && v <= 1;
      if (pv !== pv) {
        if (visible) d += `M${num(px(c, v))},${num(py(c, v))}`;
        pen = visible;
      } else {
        const dv = v - pv;
        let t0 = 0;
        let t1 = 1;
        if (dv !== 0) {
          const a = -pv / dv;
          const b = (1 - pv) / dv;
          t0 = Math.max(t0, Math.min(a, b));
          t1 = Math.min(t1, Math.max(a, b));
        } else if (!visible) {
          t0 = 2;
        }
        if (t0 <= t1) {
          const c0 = pc + (c - pc) * t0;
          const v0 = pv + dv * t0;
          const c1 = pc + (c - pc) * t1;
          const v1 = pv + dv * t1;
          if (!pen || t0 > 0) d += `M${num(px(c0, v0))},${num(py(c0, v0))}`;
          d += `L${num(px(c1, v1))},${num(py(c1, v1))}`;
        }
        pen = visible;
      }
      pc = c;
      pv = v;
      if (!visible) continue;
      const cx = px(c, v);
      const cy = py(c, v);
      if (span >= 12) dots += `<circle cx="${num(cx)}" cy="${num(cy)}" r="3"/>`;
      const label = text(plot.pointLabels?.[i], tiny, 4000);
      if (label.height > 0) {
        const half = label.width / 2;
        pointLabels += horizontal
          ? aligned(label, cx + 10, cy, 'start')
          : aligned(label, Math.max(Math.min(cx, right - half), left + half), cy - 6 - label.height / 2, 'middle');
      }
    }
    lines +=
      `<g class="pele-series pele-line"${id} fill="${color}">` +
      (d ? `<path d="${d}" fill="none" stroke="${color}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>` : '') +
      dots +
      '</g>';
  });

  let titles = '';
  if (leftTitle.height > 0) {
    titles += `<g transform="translate(${num(pad + leftTitle.height / 2)},${num(top + plotHeight / 2)}) rotate(-90)">${labelSvg(leftTitle, 0, 0, '')}</g>`;
  }
  titles += labelSvg(bottomTitle, left + plotWidth / 2, height - pad - legendBottomReserve - bottomTitle.height / 2, '');

  // One legend item: a swatch at (x, y) with its label to the right.
  const legendItem = (index: number, label: Label, x: number, y: number): string => {
    const color = seriesColor(index);
    return (
      `<g class="pele-legend-item" data-id="${escText(plots[index].title)}">` +
      (plots[index].type === 'bar'
        ? `<rect x="${num(x)}" y="${num(y - SWATCH / 2)}" width="${SWATCH}" height="${SWATCH}" rx="2" fill="${color}"/>`
        : `<path d="M${num(x)},${num(y)}h${SWATCH}" stroke="${color}" stroke-width="2" stroke-linecap="round"/>`) +
      labelSvg(label, x + SWATCH + 8 + label.width / 2, y, '') +
      '</g>'
    );
  };

  let legendOut = '';
  if (horizontalLegend) {
    // Centered rows: above the plot for 'top', below the axis title for 'bottom'.
    let ry = position === 'top' ? pad + titleSpace : height - pad - legendBlockHeight;
    for (const row of rows) {
      let rx = (width - row.width) / 2;
      const y = ry + row.height / 2;
      for (const { index, label } of row.items) {
        legendOut += legendItem(index, label, rx, y);
        rx += SWATCH + 8 + label.width + 16;
      }
      ry += row.height;
    }
  } else {
    let legendHeight = 0;
    for (const item of legend) legendHeight += Math.max(ROW, item.label.height + 6);
    let ly = top + Math.max(0, (plotHeight - legendHeight) / 2);
    const lx = position === 'left' ? pad : right + reach + LEGEND_GAP;
    for (const { index, label } of legend) {
      const row = Math.max(ROW, label.height + 6);
      if (ly + row > height) break;
      legendOut += legendItem(index, label, lx, ly + row / 2);
      ly += row;
    }
  }

  const content =
    labelSvg(title, width / 2, pad + title.height / 2, ' class="pele-title" font-weight="var(--_tw)"') +
    (grid ? `<path class="pele-grid" d="${grid}" stroke="var(--_a)"/>` : '') +
    `<g class="pele-plot">${series}${lines}</g>` +
    (axis ? `<path class="pele-axis" d="${axis}" fill="none" stroke="var(--_b)"/>` : '') +
    (labels ? `<g class="pele-axis-labels" font-size="${small}" fill="var(--_m)">${labels}</g>` : '') +
    (titles ? `<g class="pele-axis-titles" font-size="${small}">${titles}</g>` : '') +
    (outside ? `<g class="pele-data-labels" font-size="${tiny}">${outside}</g>` : '') +
    (pointLabels ? `<g class="pele-point-labels" font-size="${tiny}">${pointLabels}</g>` : '') +
    (legendOut ? `<g class="pele-legend" font-size="${small}">${legendOut}</g>` : '');

  return {
    svg: svgDocument('xychart', width, height, size, options, model, content),
    width,
    height,
    links: [],
  };
}
