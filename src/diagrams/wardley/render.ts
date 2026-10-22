import type { Config } from '../../preprocess.js';
import { esc, escText, labelSvg, num, sharedStyle, spanStyle, textStyle } from '../../svg/builder.js';
import { marker, markerTrim } from '../../svg/edges.js';
import { svgDocument } from '../../svg/root.js';
import { ROUNDED } from '../../svg/theme.js';
import { layoutLabel, type Label } from '../../text/label.js';
import { Style, defaultMeasurer } from '../../text/measurer.js';
import type { RenderOptions, Rendered } from '../../types.js';
import { fitWidth } from '../common/fit-width.js';
import type { WardleyNode } from './builder.js';
import type { WardleyModel } from './model.js';

const DEFAULT_STAGES = ['Genesis', 'Custom Built', 'Product', 'Commodity'];
// Mermaid's canvas has this much room around the plot on every side.
const CANVAS_MARGIN = 48;
const R = 6;
const SQUARE = 10;
const LABEL_OFFSET = 8;
const PIPELINE_PAD = 15;
const FORCE_WIDTH = 60;
const FORCE_HEIGHT = 30;
const FORCE_HEAD = 20;
const ACCENT = 'var(--_c)';
const LINE = 'var(--_l)';

interface Placed {
  x: number;
  y: number;
  node: WardleyNode;
}

function setting(config: Config, key: string, fallback: number, min: number, max: number): number {
  const value = (config['wardley-beta'] as Config | undefined)?.[key];
  return typeof value === 'number' && value >= min && value <= max ? value : fallback;
}

function clamp(value: number, min: number, max: number): number {
  return value < min ? min : value > max ? max : value;
}

// Writes a label with its lines starting at x and its first baseline at y.
function startLabel(label: Label, x: number, y: number, attrs: string): string {
  const shared = sharedStyle(label);
  let body = '';
  let baseline = y;
  for (const line of label.lines) {
    let first = true;
    for (const span of line) {
      if (span.icon !== undefined) continue;
      const style = spanStyle(span.style & ~shared);
      body += `<tspan${first ? ` x="${num(x)}" y="${num(baseline)}"` : ''}${style}>${esc(span.text)}</tspan>`;
      first = false;
    }
    baseline += label.lineHeight;
  }
  return body === '' ? '' : `<text${textStyle(attrs, shared)} xml:space="preserve">${body}</text>`;
}

function dimension(config: Config, given: number | undefined, key: string, fallback: number): number {
  const value = typeof given === 'number' && Number.isFinite(given) ? given : setting(config, key, fallback, 1, 1e6);
  return clamp(value, 200, 10000) - 2 * CANVAS_MARGIN;
}

export function renderWardley(model: WardleyModel, config: Config, options: RenderOptions): Rendered {
  const natural = dimension(config, model.size?.width, 'width', 900);
  return fitWidth(options, natural, 160, (plotW, tight) => draw(model, config, options, plotW, natural, tight));
}

function draw(model: WardleyModel, config: Config, options: RenderOptions, plotW: number, naturalW: number, tight: boolean): Rendered {
  const size = options.fontSize ?? 16;
  const small = Math.round(size * 0.8125);
  const tiny = Math.round(size * 0.6875);
  const measurer = options.measurer ?? defaultMeasurer(options.fontFamily, options.fontFamilyMono);
  const pad = options.padding ?? 8;

  // A narrower map is not as much shorter, so that components keep some room between them.
  const plotH = dimension(config, model.size?.height, 'height', 600) * Math.max(0.75, plotW / naturalW);
  const showGrid = (config['wardley-beta'] as Config | undefined)?.showGrid === true;

  let minX = 0;
  let minY = 0;
  let maxX = plotW;
  let maxY = plotH;
  const grow = (x0: number, y0: number, x1: number, y1: number): void => {
    if (x0 < minX) minX = x0;
    if (y0 < minY) minY = y0;
    if (x1 > maxX) maxX = x1;
    if (y1 > maxY) maxY = y1;
  };
  const centered = (label: Label, cx: number, cy: number, attrs: string): string => {
    grow(cx - label.width / 2, cy - label.height / 2, cx + label.width / 2, cy + label.height / 2);
    return labelSvg(label, cx, cy, attrs, options.icons);
  };
  const starting = (label: Label, x: number, y: number, attrs: string): string => {
    grow(x, y - label.size, x + label.width, y - label.size + label.height + 4);
    return startLabel(label, x, y, attrs);
  };
  const text = (raw: string, fontSize: number, maxWidth = tight ? Math.max(64, Math.min(120, plotW / 2)) : 4000, style = 0): Label => layoutLabel(raw, false, measurer, fontSize, maxWidth, style);
  const projectX = (value: number): number => (value / 100) * plotW;
  const projectY = (value: number): number => plotH - (value / 100) * plotH;

  const stages = model.axes.stages && model.axes.stages.length > 0 ? model.axes.stages : DEFAULT_STAGES;
  const boundaries = model.axes.stageBoundaries;
  const custom = boundaries !== undefined && boundaries.length === stages.length;
  let frame = '';
  let stageLabels = '';
  let stageBottom = plotH;
  let previous = 0;
  stages.forEach((stage, index) => {
    const start = custom ? previous : index / stages.length;
    const end = custom ? clamp(boundaries[index], 0, 1) : (index + 1) / stages.length;
    previous = end;
    if (index > 0) {
      frame += `<path class="pele-wardley-stage" d="M${num(start * plotW)},0V${num(plotH)}" stroke="var(--_b)" stroke-dasharray="4 4"/>`;
    }
    const label = text(stage, small, Math.max(48, Math.abs(end - start) * plotW - 12));
    stageLabels += centered(label, ((start + end) / 2) * plotW, plotH + 8 + label.height / 2, ` class="pele-wardley-stage-label" font-size="${small}" fill="var(--_m)"`);
    stageBottom = Math.max(stageBottom, plotH + 8 + label.height);
  });
  if (showGrid) {
    for (let i = 1; i < 4; i++) {
      frame +=
        `<path class="pele-wardley-grid" d="M${num((plotW * i) / 4)},0V${num(plotH)}M0,${num((plotH * i) / 4)}H${num(plotW)}" stroke="var(--_b)" stroke-dasharray="2 6"/>`;
    }
  }
  frame += `<path class="pele-wardley-axis" d="M0,0V${num(plotH)}H${num(plotW)}" stroke="${LINE}"/>`;
  const xTitle = text(model.axes.xLabel ?? 'Evolution', small);
  const yTitle = text(model.axes.yLabel ?? 'Visibility', small);
  const axisAttrs = ` class="pele-wardley-axis-label" font-size="${small}" font-weight="var(--_hw)"`;
  const axisLabels =
    centered(xTitle, plotW / 2, stageBottom + 6 + xTitle.height / 2, axisAttrs) +
    labelSvg(yTitle, -16, plotH / 2, `${axisAttrs} transform="rotate(-90 -16 ${num(plotH / 2)})"`);
  grow(-16 - yTitle.height / 2, 0, 0, 0);
  const legendTop = stageBottom + 6 + xTitle.height + 10;

  const positions = new Map<string, Placed>();
  for (const node of model.nodes) positions.set(node.id, { x: projectX(node.x!), y: projectY(node.y!), node });

  // Pipelines: a box around the components, with the parent as a square on its top edge.
  let pipelines = '';
  const members = new Map<string, Set<string>>();
  for (const pipeline of model.pipelines) {
    members.set(pipeline.nodeId, new Set(pipeline.componentIds));
    const parts: Placed[] = [];
    for (const id of pipeline.componentIds) {
      const part = positions.get(id);
      if (part) parts.push(part);
    }
    if (parts.length === 0) continue;
    parts.sort((a, b) => a.x - b.x);
    const left = parts[0].x;
    const right = parts[parts.length - 1].x;
    const y = parts[0].y;
    const top = y - 2 * R;
    const parent = positions.get(pipeline.nodeId);
    if (parent) {
      parent.x = (left + right) / 2;
      parent.y = top - SQUARE / 6;
    }
    grow(left - PIPELINE_PAD, top, right + PIPELINE_PAD, top + 4 * R);
    pipelines +=
      `<g class="pele-wardley-pipeline" data-id="${escText(pipeline.nodeId)}">` +
      `<rect x="${num(left - PIPELINE_PAD)}" y="${num(top)}" width="${num(right - left + 2 * PIPELINE_PAD)}" height="${num(
        4 * R
      )}" fill="var(--_s)" stroke="var(--_b)"${ROUNDED}/>` +
      (parts.length > 1 ? `<path d="M${num(left)},${num(y)}H${num(right)}" stroke="${LINE}" stroke-dasharray="4 4"/>` : '') +
      '</g>';
  }

  // How far from a node's center a line to it stops.
  const anchorLabels = new Map<WardleyNode, Label>();
  const reach = (at: Placed, ux: number, uy: number): number => {
    const node = at.node;
    if (node.className === 'anchor') {
      let label = anchorLabels.get(node);
      if (!label) anchorLabels.set(node, (label = text(node.label, small, tight ? Math.max(64, plotW / 2) : 4000, Style.Bold)));
      return 1 / Math.hypot(ux / (label.width / 2 + 5), uy / (small * 0.8));
    }
    if (node.isPipelineParent) return SQUARE / Math.SQRT2;
    return node.sourceStrategy ? 2 * R : R;
  };

  // Quadrants around a node that a link runs through: 1 up and right, 2 down and right, 4 up and left, 8 down and left.
  const taken = new Map<Placed, number>();
  const occupy = (at: Placed, ux: number, uy: number): void => {
    if (Math.abs(ux) < 0.25 || Math.abs(uy) < 0.25) return;
    taken.set(at, (taken.get(at) ?? 0) | (ux > 0 ? (uy < 0 ? 1 : 2) : uy < 0 ? 4 : 8));
  };

  let links = '';
  for (const link of model.links) {
    const from = positions.get(link.source);
    const to = positions.get(link.target);
    if (!from || !to || from === to) continue;
    // A pipeline component belongs to its parent already.
    if (members.get(link.target)?.has(link.source)) continue;
    const dx = to.x - from.x;
    const dy = to.y - from.y;
    const distance = Math.hypot(dx, dy);
    if (distance < 0.01) continue;
    const ux = dx / distance;
    const uy = dy / distance;
    const start = reach(from, ux, uy);
    const end = reach(to, ux, uy);
    if (start + end >= distance) continue;
    occupy(from, ux, uy);
    occupy(to, -ux, -uy);
    let x1 = from.x + ux * start;
    let y1 = from.y + uy * start;
    let x2 = to.x - ux * end;
    let y2 = to.y - uy * end;
    let heads = '';
    if (link.flow === 'forward' || link.flow === 'bidirectional') {
      heads += marker('arrow_point', x2, y2, ux, uy, LINE);
      x2 -= ux * markerTrim('arrow_point');
      y2 -= uy * markerTrim('arrow_point');
    }
    if (link.flow === 'backward' || link.flow === 'bidirectional') {
      heads += marker('arrow_point', x1, y1, -ux, -uy, LINE);
      x1 += ux * markerTrim('arrow_point');
      y1 += uy * markerTrim('arrow_point');
    }
    let caption = '';
    if (link.label) {
      const label = text(link.label, tiny + 1, 200);
      // Beside the middle of the line, on its upper side.
      const side = ux >= 0 ? 1 : -1;
      const px = uy * side;
      const py = -ux * side;
      const away = 5 + (Math.abs(px) * label.width) / 2 + (Math.abs(py) * label.height) / 2;
      caption = centered(label, (from.x + to.x) / 2 + px * away, (from.y + to.y) / 2 + py * away, ` class="pele-edge-label" font-size="${tiny + 1}" fill="var(--_m)"`);
    }
    links +=
      `<g class="pele-edge${link.dashed ? ' pele-wardley-dashed' : ''}" data-id="${escText(link.source)}-${escText(link.target)}">` +
      `<path d="M${num(x1)},${num(y1)}L${num(x2)},${num(y2)}" stroke="${LINE}"${link.dashed ? ' stroke-dasharray="6 6"' : ''}/>` +
      heads +
      caption +
      '</g>';
  }

  // Evolution: a dashed arrow to where the component is heading, drawn as an open circle.
  let trends = '';
  for (const trend of model.trends) {
    const origin = positions.get(trend.nodeId);
    if (!origin) continue;
    const tx = projectX(trend.targetX);
    const ty = projectY(trend.targetY);
    const dx = tx - origin.x;
    const dy = ty - origin.y;
    const distance = Math.hypot(dx, dy);
    let arrow = '';
    const start = distance > 0 ? reach(origin, dx / distance, dy / distance) : 0;
    if (distance > start + R + 4) {
      const ux = dx / distance;
      const uy = dy / distance;
      const ex = tx - ux * (R + 2);
      const ey = ty - uy * (R + 2);
      arrow =
        `<path d="M${num(origin.x + ux * start)},${num(origin.y + uy * start)}L${num(ex - ux * markerTrim('arrow_point'))},${num(
          ey - uy * markerTrim('arrow_point')
        )}" stroke="${ACCENT}" stroke-dasharray="4 4"/>` + marker('arrow_point', ex, ey, ux, uy, ACCENT);
    }
    grow(tx - R, ty - R, tx + R, ty + R);
    trends +=
      `<g class="pele-wardley-trend" data-id="${escText(trend.nodeId)}">${arrow}` +
      `<circle cx="${num(tx)}" cy="${num(ty)}" r="${R}" fill="var(--_bg)" stroke="${ACCENT}"/></g>`;
  }

  let nodes = '';
  const tri = 1.2 * R;
  const dot = 0.7 * R;
  for (const at of positions.values()) {
    const node = at.node;
    const { x, y } = at;
    const anchor = node.className === 'anchor';
    const strategy = node.sourceStrategy;
    let shape = '';
    if (strategy) {
      const fill = strategy === 'outsource' ? 'var(--_m)' : strategy === 'buy' ? 'var(--_a)' : strategy === 'build' ? 'var(--_s)' : 'var(--_bg)';
      shape += `<circle class="pele-wardley-${strategy}" cx="${num(x)}" cy="${num(y)}" r="${2 * R}" fill="${fill}" stroke="${LINE}"/>`;
    }
    if (strategy === 'market') {
      const bx = tri * Math.cos(Math.PI / 6);
      const by = y + tri * Math.sin(Math.PI / 6);
      shape += `<path d="M${num(x)},${num(y - tri)}L${num(x - bx)},${num(by)}H${num(x + bx)}Z" fill="none" stroke="${LINE}"/>`;
      for (const [cx, cy] of [[x, y - tri], [x - bx, by], [x + bx, by]]) {
        shape += `<circle cx="${num(cx)}" cy="${num(cy)}" r="${num(dot)}" fill="var(--_bg)" stroke="${LINE}"/>`;
      }
    } else if (node.isPipelineParent) {
      shape += `<rect x="${num(x - SQUARE / 2)}" y="${num(y - SQUARE / 2)}" width="${SQUARE}" height="${SQUARE}" fill="var(--_bg)" stroke="${LINE}"/>`;
    } else if (!anchor) {
      shape += `<circle cx="${num(x)}" cy="${num(y)}" r="${R}" fill="var(--_bg)" stroke="${LINE}"/>`;
    }
    if (node.inertia === true) {
      const offset = (node.isPipelineParent ? SQUARE / 2 : R) + 10 + (strategy ? R + 4 : 0);
      shape += `<rect class="pele-wardley-inertia" x="${num(x + offset)}" y="${num(y - R)}" width="4" height="${2 * R}" fill="${LINE}"/>`;
    }
    const ox = node.labelOffsetX === undefined ? undefined : clamp(node.labelOffsetX, -5000, 5000);
    const oy = node.labelOffsetY === undefined ? undefined : clamp(node.labelOffsetY, -5000, 5000);
    let caption: string;
    if (anchor) {
      const label = anchorLabels.get(node) ?? text(node.label, small, tight ? Math.max(64, plotW / 2) : 4000, Style.Bold);
      caption = centered(label, x + (ox ?? 0), y + (oy ?? -3), ` class="pele-label" font-size="${small}" font-weight="var(--_hw)"`);
    } else {
      const label = text(node.label, small);
      const attrs = ` class="pele-label" font-size="${small}"`;
      const lift = LABEL_OFFSET + (strategy ? 10 : 0);
      if (ox !== undefined || oy !== undefined) {
        caption = starting(label, x + (ox ?? lift), y + (oy ?? -lift), attrs);
      } else if (node.inPipeline) {
        caption = centered(label, x, y + 2 * R + 4 + label.height / 2, attrs);
      } else {
        // The label goes up and to the right unless a link leaves that way; then the next free corner.
        const busy = taken.get(at) ?? 0;
        const corner = (busy & 1) === 0 ? 1 : (busy & 2) === 0 ? 2 : (busy & 4) === 0 ? 4 : (busy & 8) === 0 ? 8 : 1;
        const right = corner === 1 || corner === 2;
        const up = corner === 1 || corner === 4;
        caption = starting(label, right ? x + lift : x - lift - label.width, up ? y - lift : y + lift + small * 0.75, attrs);
      }
    }
    grow(x - 2 * R, y - 2 * R, x + 2 * R + 20, y + 2 * R);
    nodes += `<g class="pele-node pele-wardley-${anchor ? 'anchor' : node.isPipelineParent ? 'pipeline-parent' : node.inPipeline ? 'pipeline-component' : 'component'}" data-id="${escText(
      node.id
    )}">${shape}${caption}</g>`;
  }

  let annotations = '';
  for (const annotation of model.annotations) {
    const label = text(String(annotation.number), tiny, 4000, Style.Bold);
    let marks = '';
    for (const coordinate of annotation.coordinates) {
      const x = projectX(coordinate.x);
      const y = projectY(coordinate.y);
      const r = Math.max(10, label.width / 2 + 4);
      grow(x - r, y - r, x + r, y + r);
      marks += `<circle cx="${num(x)}" cy="${num(y)}" r="${num(r)}" fill="var(--_bg)" stroke="${LINE}"/>` + labelSvg(label, x, y, ` font-size="${tiny}" font-weight="var(--_hw)"`);
    }
    annotations += `<g class="pele-wardley-annotation" data-id="${escText(String(annotation.number))}">${marks}</g>`;
  }
  const listed = model.annotations.filter((a) => a.text).sort((a, b) => a.number - b.number);
  if (listed.length > 0) {
    const lines = listed.map((a) => text(`${a.number}. ${a.text!}`, small, tight ? Math.max(80, plotW - 20) : 320));
    let width = 0;
    let height = 0;
    for (const line of lines) {
      width = Math.max(width, line.width);
      height += line.height;
    }
    width += 20;
    height += 14;
    // Without a position the list goes under the map, where it covers nothing.
    const box = model.annotationsBox;
    const bx = box ? clamp(projectX(box.x), 0, Math.max(0, plotW - width)) : 0;
    const by = box ? clamp(projectY(box.y), 0, Math.max(0, plotH - height)) : legendTop;
    grow(bx, by, bx + width, by + height);
    let rows = '';
    let y = by + 7;
    for (const line of lines) {
      rows += startLabel(line, bx + 10, y + line.lineHeight / 2 + small * 0.35, ` font-size="${small}"`);
      y += line.height;
    }
    annotations +=
      `<g class="pele-wardley-annotations"><rect x="${num(bx)}" y="${num(by)}" width="${num(width)}" height="${num(
        height
      )}" fill="var(--_bg)" stroke="var(--_b)"${ROUNDED}/>${rows}</g>`;
  }

  let notes = '';
  for (const note of model.notes) {
    notes += starting(text(note.text, small, Math.min(360, plotW * 0.6), Style.Bold), projectX(note.x), projectY(note.y), ` class="pele-wardley-note" font-size="${small}" font-weight="var(--_hw)"`);
  }

  // Accelerators point right, deaccelerators left.
  let forces = '';
  const force = (name: string, px: number, py: number, forward: boolean): void => {
    const x = projectX(px);
    const y = projectY(py);
    const half = FORCE_HEIGHT / 2;
    const tip = forward ? x + FORCE_WIDTH : x;
    const tail = forward ? x : x + FORCE_WIDTH;
    const neck = forward ? x + FORCE_WIDTH - FORCE_HEAD : x + FORCE_HEAD;
    const d =
      `M${num(tail)},${num(y - half)}H${num(neck)}V${num(y - half - 8)}L${num(tip)},${num(y)}L${num(neck)},${num(y + half + 8)}V${num(y + half)}H${num(tail)}Z`;
    grow(x, y - half - 8, x + FORCE_WIDTH, y + half + 8);
    forces +=
      `<g class="pele-wardley-${forward ? 'accelerator' : 'deaccelerator'}" data-id="${escText(name)}">` +
      `<path d="${d}" fill="var(--_s)" stroke="${LINE}"/>` +
      centered(text(name, tiny + 1, 160, Style.Bold), x + FORCE_WIDTH / 2, y + half + 8 + 12, ` font-size="${tiny + 1}" font-weight="var(--_hw)"`) +
      '</g>';
  };
  for (const a of model.accelerators) force(a.name, a.x, a.y, true);
  for (const d of model.deaccelerators) force(d.name, d.x, d.y, false);

  const title = layoutLabel(model.title, false, measurer, size, tight ? Math.max(80, plotW) : 4000, Style.Bold);
  const titleHeight = title.height > 0 ? title.height + 12 : 0;
  const left = Math.min(minX, plotW / 2 - title.width / 2);
  const right = Math.max(maxX, plotW / 2 + title.width / 2);
  const tx = pad - left;
  const ty = pad + titleHeight - minY;
  const totalWidth = Math.ceil(right - left + 2 * pad);
  const totalHeight = Math.ceil(maxY - minY + titleHeight + 2 * pad);
  const content =
    labelSvg(title, tx + plotW / 2, pad + title.height / 2, ' class="pele-title" font-weight="var(--_tw)"') +
    `<g transform="translate(${num(tx)},${num(ty)})">` +
    `<g class="pele-wardley-frame" fill="none">${frame}</g>` +
    stageLabels +
    axisLabels +
    pipelines +
    (links ? `<g class="pele-edges" fill="none">${links}</g>` : '') +
    (trends ? `<g class="pele-wardley-trends" fill="none">${trends}</g>` : '') +
    nodes +
    annotations +
    notes +
    forces +
    '</g>';

  return {
    svg: svgDocument('wardley', totalWidth, totalHeight, size, options, model, content),
    width: totalWidth,
    height: totalHeight,
    links: [],
  };
}
