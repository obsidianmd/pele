import type { Config } from '../../preprocess.js';
import { esc, escText, labelSvg, num } from '../../svg/builder.js';
import { svgDocument } from '../../svg/root.js';
import { CRITICAL, ROUNDED, resolveStyle } from '../../svg/theme.js';
import { layoutLabel, type Label } from '../../text/label.js';
import { Style, defaultMeasurer, type TextMeasurer } from '../../text/measurer.js';
import type { LinkInfo, RenderOptions, Rendered } from '../../types.js';
import { capWidth } from '../common/fit-width.js';
import { linked } from '../../util/url.js';
import { autoTicks, intervalTicks, timeFormat } from './axis.js';
import { add, addDays } from './dates.js';
import { clock, type GanttDb } from './db.js';
import type { GanttTask } from './types.js';

const WIDTH = 800;
const MIN_PLOT = 240;
const LABEL_GAP = 8;
const RE_BREAK = /<br\s*\/?>/gi;

function setting(config: Config, key: string, min: number, max: number): number | undefined {
  const value = (config.gantt as Config | undefined)?.[key];
  return typeof value === 'number' && Number.isFinite(value) ? Math.min(max, Math.max(min, value)) : undefined;
}

function text(config: Config, key: string): string | undefined {
  const value = (config.gantt as Config | undefined)?.[key];
  return typeof value === 'string' ? value : undefined;
}

function flag(config: Config, key: string): boolean {
  return (config.gantt as Config | undefined)?.[key] === true;
}

// A task label sits on one row, so only its first line is kept.
function oneLine(raw: string, measurer: TextMeasurer, size: number): Label {
  const label = layoutLabel(raw.replace(RE_BREAK, ' '), false, measurer, size, 4000);
  if (label.lines.length <= 1) return label;
  return { ...label, lines: [label.lines[0]], widths: [label.widths[0]], width: label.widths[0], height: label.lineHeight };
}

// Whether scheduling gave the task a start and an end. One that waits on a task that never resolves has neither.
function scheduled(task: GanttTask): boolean {
  return Number.isFinite(+task.startTime!) && Number.isFinite(+task.endTime!);
}

// Mermaid's compact mode: within a section, a task goes on the first row that is free when it starts.
function packRows(tasks: GanttTask[], offset: number, rowOf: Map<GanttTask, number>): number {
  const sorted = tasks.filter(scheduled).sort((a, b) => +a.startTime! - +b.startTime! || a.order - b.order);
  const free: number[] = [];
  for (const task of sorted) {
    const start = +task.startTime!;
    let row = 0;
    while (row < free.length && start < free[row]) row++;
    free[row] = +task.endTime!;
    rowOf.set(task, offset + row);
  }
  let rows = free.length;
  for (const task of tasks) if (!rowOf.has(task)) rowOf.set(task, offset + rows++);
  return Math.max(rows, 1);
}

interface Bar {
  task: GanttTask;
  label: Label;
  row: number;
  x0: number;
  x1: number;
  labelX: number;
  inside: boolean;
}

export function renderGantt(model: GanttDb, config: Config, options: RenderOptions): Rendered {
  const size = options.fontSize ?? 16;
  const measurer = options.measurer ?? defaultMeasurer(options.fontFamily);
  const pad = options.padding ?? 8;
  const now = clock(options.now);

  const labelSize = setting(config, 'fontSize', 4, 72) ?? Math.round(size * 0.8125);
  const sectionSize = setting(config, 'sectionFontSize', 4, 72) ?? labelSize;
  const tickSize = Math.round(size * 0.75);
  const barHeight = setting(config, 'barHeight', 4, 400) ?? Math.round(labelSize * 1.85);
  const barGap = setting(config, 'barGap', 0, 400) ?? Math.round(barHeight / 4);
  const rowHeight = barHeight + barGap;
  const sectionStyles = Math.round(setting(config, 'numberSectionStyles', 1, 1000) ?? 4);
  const compact = model.displayMode === 'compact';
  const topAxis = model.topAxis || flag(config, 'topAxis');

  const tasks = model.getTasks(now);
  const rowTasks = tasks.filter((task) => !task.vert);
  const verts = tasks.filter((task) => task.vert && scheduled(task));

  const categories = new Map<string, number>();
  for (const task of rowTasks) if (!categories.has(task.section)) categories.set(task.section, categories.size);

  const rowOf = new Map<GanttTask, number>();
  const rowSection: string[] = [];
  if (compact) {
    const groups = new Map<string, GanttTask[]>();
    for (const task of rowTasks) {
      const group = groups.get(task.section);
      if (group) group.push(task);
      else groups.set(task.section, [task]);
    }
    for (const [section, group] of groups) {
      const rows = packRows(group, rowSection.length, rowOf);
      for (let i = 0; i < rows; i++) rowSection.push(section);
    }
  } else {
    for (const task of rowTasks) {
      rowOf.set(task, rowSection.length);
      rowSection.push(task.section);
    }
  }
  const rowCount = rowSection.length;

  let start = Infinity;
  let stop = -Infinity;
  for (const task of tasks) {
    if (!scheduled(task)) continue;
    start = Math.min(start, +task.startTime!);
    stop = Math.max(stop, +task.endTime!);
  }
  const hasPlot = start <= stop;

  const title = layoutLabel(model.title, false, measurer, size, 4000, Style.Bold);
  const titleHeight = title.height > 0 ? title.height + 16 : 0;

  if (!hasPlot) {
    const width = Math.ceil(Math.max(title.width, 1) + 2 * pad);
    const height = Math.ceil(Math.max(title.height, 1) + 2 * pad);
    const content = labelSvg(title, width / 2, pad + title.height / 2, ' class="pele-title" font-weight="var(--_tw)"');
    return { svg: svgDocument('gantt', width, height, size, options, model, content), width, height, links: [] };
  }

  const sectionLabels = new Map<string, Label>();
  let sectionWidth = 0;
  for (const section of categories.keys()) {
    const label = layoutLabel(section, false, measurer, sectionSize, 180);
    sectionLabels.set(section, label);
    sectionWidth = Math.max(sectionWidth, label.width);
  }

  const axisFormat =
    model.axisFormat || (model.dateFormat === 'D' ? '%d' : (text(config, 'axisFormat') ?? '%Y-%m-%d'));
  const tickLabel = (t: number): string => timeFormat(axisFormat, new Date(t));
  const sampleWidth = Math.max(measurer.width(tickLabel(start), tickSize, 0), measurer.width(tickLabel(stop), tickSize, 0));

  const left = pad + (setting(config, 'leftPadding', 0, 2000) ?? Math.max(sectionWidth > 0 ? sectionWidth + 24 : 0, sampleWidth / 2));
  const rightPadding = setting(config, 'rightPadding', 0, 2000) ?? Math.max(16, sampleWidth / 2);
  const target = capWidth(options, setting(config, 'useWidth', 100, 20000) ?? WIDTH, 280);
  const plotWidth = Math.max(MIN_PLOT, target - left - rightPadding - pad);
  const right = left + plotWidth;
  const scale = stop > start ? plotWidth / (stop - start) : 0;
  const x = (t: number): number => (scale === 0 ? left + plotWidth / 2 : left + (t - start) * scale);

  const tickHeight = Math.round(tickSize * 1.75);
  const topPadding = setting(config, 'topPadding', 0, 2000);
  const gridStart = setting(config, 'gridLineStartPadding', 0, 2000);
  const headHeight = pad + titleHeight + (topAxis ? tickHeight : 0);
  const plotTop = Math.max(headHeight, topPadding ?? 0);
  // Mermaid starts its grid lines above the first row by the difference between these two settings.
  // Here that only uses room a larger `topPadding` leaves free.
  const gridLead =
    topPadding !== undefined && gridStart !== undefined
      ? Math.max(0, Math.min(topPadding - gridStart, plotTop - headHeight))
      : 0;
  const plotHeight = Math.max(rowCount, 1) * rowHeight;
  const plotBottom = plotTop + plotHeight;

  // Bars and where their labels go: inside when they fit, otherwise beside the bar on the side with room.
  const bars: Bar[] = [];
  let extent = right + rightPadding;
  for (const task of rowTasks) {
    const label = oneLine(task.task, measurer, labelSize);
    const row = rowOf.get(task)!;
    if (!scheduled(task)) {
      const labelX = left + LABEL_GAP + label.width / 2;
      extent = Math.max(extent, labelX + label.width / 2);
      bars.push({ task, label, row, x0: NaN, x1: NaN, labelX, inside: false });
      continue;
    }
    let x0 = x(+task.startTime!);
    let x1 = Math.max(x(+(task.renderEndTime ?? task.endTime!)), x0 + (task.milestone ? 0 : 2));
    if (task.milestone) {
      const mid = x0 + (x(+task.endTime!) - x0) / 2;
      x0 = mid - barHeight / 2;
      x1 = mid + barHeight / 2;
    }
    const inside = !task.milestone && label.width + 2 * LABEL_GAP <= x1 - x0;
    let labelX = (x0 + x1) / 2;
    if (!inside) {
      const fitsRight = x1 + LABEL_GAP + label.width <= right + rightPadding;
      const fitsLeft = x0 - LABEL_GAP - label.width >= left;
      labelX = fitsRight || !fitsLeft ? x1 + LABEL_GAP + label.width / 2 : x0 - LABEL_GAP - label.width / 2;
      extent = Math.max(extent, labelX + label.width / 2);
    }
    bars.push({ task, label, row, x0, x1, labelX, inside });
  }

  const interval = model.tickInterval || text(config, 'tickInterval') || '';
  const weekday = model.weekday ?? text(config, 'weekday') ?? 'sunday';
  const count = Math.max(2, Math.min(10, Math.floor(plotWidth / (sampleWidth + 24))));
  const ticks = intervalTicks(interval, weekday, start, stop, Math.ceil(plotWidth / 3)) ?? autoTicks(start, stop, count);

  let grid = '';
  let axisBottom = '';
  let axisTop = '';
  let lastRight = -Infinity;
  let lastLabel = '';
  const bottomY = plotBottom + tickHeight / 2 + 2;
  const topY = plotTop - gridLead - tickHeight / 2 - 2;
  for (const t of ticks) {
    const tx = x(t);
    grid += `M${num(tx)},${num(plotTop - gridLead)}V${num(plotBottom)}`;
    const label = tickLabel(t);
    const width = measurer.width(label, tickSize, 0);
    // A label is skipped when it would run into the one before it or only repeat it; its grid line stays.
    if (tx - width / 2 < lastRight + 8 || label === lastLabel) continue;
    lastRight = tx + width / 2;
    lastLabel = label;
    extent = Math.max(extent, lastRight);
    const body = `text-anchor="middle">${esc(label)}</text>`;
    axisBottom += `<text x="${num(tx)}" y="${num(bottomY + tickSize * 0.35)}" ${body}`;
    if (topAxis) axisTop += `<text x="${num(tx)}" y="${num(topY + tickSize * 0.35)}" ${body}`;
  }

  // Vertical markers take no row. Their labels go under the axis, on as many lines as it takes to keep them apart.
  let vertLines = '';
  let vertLabels = '';
  const vertEnds: number[] = [];
  const vertTop = plotBottom + tickHeight + 4;
  const vertLine = Math.round(labelSize * 1.5);
  for (const task of [...verts].sort((a, b) => +a.startTime! - +b.startTime!)) {
    const vx = x(+task.startTime!);
    const label = oneLine(task.task, measurer, labelSize);
    const cx = Math.max(pad + label.width / 2, vx);
    let line = 0;
    while (line < vertEnds.length && cx - label.width / 2 < vertEnds[line] + 8) line++;
    vertEnds[line] = cx + label.width / 2;
    extent = Math.max(extent, vertEnds[line]);
    vertLines += `<path class="pele-vert" data-id="${escText(task.id)}" d="M${num(vx)},${num(plotTop - gridLead)}V${num(plotBottom)}"/>`;
    vertLabels += labelSvg(label, cx, vertTop + line * vertLine + vertLine / 2, ` class="pele-vert-label" data-id="${escText(task.id)}"`);
  }

  const width = Math.ceil(Math.max(extent, pad + title.width) + pad);
  const height = Math.ceil(plotBottom + tickHeight + (vertEnds.length > 0 ? 4 + vertEnds.length * vertLine : 0) + pad);

  // Section bands, one per run of rows that share a section, shaded on alternate sections.
  let bands = '';
  let sectionOut = '';
  for (let row = 0; row < rowCount; ) {
    const section = rowSection[row];
    let end = row + 1;
    while (end < rowCount && rowSection[end] === section) end++;
    const index = categories.get(section)! % sectionStyles;
    const y = plotTop + row * rowHeight;
    const h = (end - row) * rowHeight;
    if (categories.size > 1 || section !== '') {
      bands += `<rect class="pele-section pele-section-${index}" x="0" y="${num(y)}" width="${width}" height="${num(h)}" fill="${
        index % 2 === 0 ? 'var(--_s)' : 'none'
      }"/>`;
    }
    const label = sectionLabels.get(section)!;
    sectionOut += labelSvg(label, pad + 8 + label.width / 2, y + h / 2, ` class="pele-section-label" data-id="${escText(section)}"`, options.icons);
    row = end;
  }

  // Excluded days, as Mermaid marks them: a day at a time from the first task's start, and not at all
  // when the chart spans more than five years.
  let excluded = '';
  if ((model.excludes.length > 0 || model.includes.length > 0) && +add(new Date(start), 6, 'y') > stop) {
    let from: Date | undefined;
    let to: Date | undefined;
    const flush = (): void => {
      if (!from || !to) return;
      const dayStart = new Date(from);
      dayStart.setHours(0, 0, 0, 0);
      const dayEnd = new Date(to);
      dayEnd.setHours(23, 59, 59, 999);
      const ex0 = Math.max(left, x(+dayStart));
      const ex1 = Math.min(right, x(+dayEnd));
      if (ex1 > ex0) {
        excluded += `<rect x="${num(ex0)}" y="${num(plotTop)}" width="${num(ex1 - ex0)}" height="${num(plotHeight)}"/>`;
      }
      from = to = undefined;
    };
    for (let day = new Date(start); +day <= stop; day = addDays(day, 1)) {
      if (model.isInvalidDate(day)) {
        from ??= day;
        to = day;
      } else {
        flush();
      }
    }
    flush();
  }

  const links: LinkInfo[] = [];
  let tasksOut = '';
  for (const bar of bars) {
    const task = bar.task;
    const cy = plotTop + bar.row * rowHeight + rowHeight / 2;
    const state = task.active ? 'active' : task.done ? 'done' : '';
    let classes = 'pele-task';
    if (state) classes += ' pele-' + state;
    if (task.crit) classes += ' pele-crit';
    if (task.milestone) classes += ' pele-milestone';
    if (task.classes.includes('clickable')) classes += ' pele-clickable';

    let shape = '';
    let textFill = '';
    if (Number.isNaN(bar.x0)) {
      classes += ' pele-unscheduled';
      textFill = ' fill="var(--_m)"';
    } else {
      // A critical task takes the critical color in place of the accent. Done, it keeps the fill
      // of finished work and only its border is in that color.
      const color = task.crit ? CRITICAL : 'var(--_c)';
      const paint =
        state === 'done' ? 'fill="var(--_a)"' : state === 'active' ? `fill="${color}" fill-opacity="0.25"` : `fill="${color}"`;
      const stroke = `stroke="${state === 'done' && !task.crit ? 'var(--_b)' : color}"`;
      if (task.milestone) {
        const cx = (bar.x0 + bar.x1) / 2;
        const r = barHeight / 2;
        shape = `<path d="M${num(cx)},${num(cy - r)}L${num(cx + r)},${num(cy)}L${num(cx)},${num(cy + r)}L${num(cx - r)},${num(cy)}Z" ${paint} ${stroke} stroke-linejoin="round"/>`;
      } else {
        shape = `<rect x="${num(bar.x0)}" y="${num(cy - barHeight / 2)}" width="${num(bar.x1 - bar.x0)}" height="${num(barHeight)}" ${paint} ${stroke}${ROUNDED}/>`;
      }
      if (bar.inside) textFill = state === '' ? ' fill="var(--_bg)"' : '';
      else if (state === 'done') textFill = ' fill="var(--_m)"';
    }

    let body = shape + labelSvg(bar.label, bar.labelX, cy, ` class="pele-label"${textFill}`);
    const url = model.links.get(task.id);
    if (url !== undefined) body = linked(body, url, task.id, links, options);
    tasksOut += `<g class="${classes}" data-id="${escText(task.id)}">${body}</g>`;
  }

  let today = '';
  if (model.todayMarker !== 'off' && now >= start && now <= stop && stop > start) {
    const tx = x(now);
    const top = plotTop - gridLead;
    const style = model.todayMarker ? resolveStyle(model.todayMarker.split(',')).line : '';
    today =
      `<g class="pele-today"><path d="M${num(tx)},${num(top)}V${num(plotBottom)}" fill="none" stroke="var(--_c)" stroke-width="2"${style}/>` +
      (style ? '' : `<path d="M${num(tx - 4)},${num(top - 5)}H${num(tx + 4)}L${num(tx)},${num(top + 1)}Z" fill="var(--_c)"/>`) +
      '</g>';
  }

  const axisLine = `M${num(left)},${num(plotBottom)}H${num(right)}` + (topAxis ? `M${num(left)},${num(plotTop - gridLead)}H${num(right)}` : '');
  const content =
    labelSvg(title, width / 2, pad + title.height / 2, ' class="pele-title" font-weight="var(--_tw)"') +
    (bands ? `<g class="pele-sections">${bands}</g>` : '') +
    (excluded ? `<g class="pele-excluded" fill="var(--_a)">${excluded}</g>` : '') +
    `<g class="pele-grid" fill="none"><path d="${grid}" stroke="var(--_b)" stroke-dasharray="1 3"/><path d="${axisLine}" stroke="var(--_b)"/></g>` +
    (vertLines ? `<g class="pele-verts" fill="none" stroke="var(--_l)" stroke-width="1.5" stroke-dasharray="4 3">${vertLines}</g>` : '') +
    today +
    `<g class="pele-tasks" font-size="${num(labelSize)}">${tasksOut}</g>` +
    `<g class="pele-section-labels" font-size="${num(sectionSize)}">${sectionOut}</g>` +
    `<g class="pele-axis" font-size="${tickSize}" fill="var(--_m)">${axisBottom}${axisTop}</g>` +
    (vertLabels ? `<g class="pele-vert-labels" font-size="${num(labelSize)}">${vertLabels}</g>` : '');

  return { svg: svgDocument('gantt', width, height, size, options, model, content), width, height, links };
}
