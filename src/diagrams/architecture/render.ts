import { tighten, titleRoom } from '../common/fit-width.js';
import type { Config } from '../../preprocess.js';
import { escText, labelSvg, num } from '../../svg/builder.js';
import { edgeLabelSvg, marker, markerTrim } from '../../svg/edges.js';
import { svgDocument } from '../../svg/root.js';
import { ROUNDED } from '../../svg/theme.js';
import { layoutLabel, type Label, type Span } from '../../text/label.js';
import { Style, defaultMeasurer, type TextMeasurer } from '../../text/measurer.js';
import type { IconResolver, RenderOptions, Rendered } from '../../types.js';
import type { ArchitectureModel } from './db.js';
import { builtinIcon } from './icons.js';
import { placeOnGrid, sideIndex } from './layout.js';

const STUB = 12;
const CORNER = 6;
const LABEL_GAP = 4;
const DOT = 3;
const DX = [-1, 1, 0, 0];
const DY = [0, 0, -1, 1];

function setting(config: Config, key: string, fallback: number, min: number, max: number): number {
  const section = config.architecture;
  const value = section !== null && typeof section === 'object' && !Array.isArray(section) ? section[key] : undefined;
  return typeof value === 'number' && Number.isFinite(value) ? Math.min(max, Math.max(min, value)) : fallback;
}

// Maps the grid lines in use to consecutive indexes, so empty rows and columns take no room.
function rank(values: number[]): Map<number, number> {
  const out = new Map<number, number>();
  for (const value of values.sort((a, b) => a - b)) if (!out.has(value)) out.set(value, out.size);
  return out;
}

function iconSlot(name: string, x: number, y: number, side: number, icons: IconResolver | undefined): string {
  return (
    `<svg class="pele-icon" data-icon="${escText(name)}" x="${num(x)}" y="${num(y)}" width="${num(side)}" height="${num(side)}"` +
    ` viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${
      icons?.(name) ?? builtinIcon(name)
    }</svg>`
  );
}

// Cuts a label down to a box, ending what is left with an ellipsis.
function fit(label: Label, maxWidth: number, maxLines: number, measurer: TextMeasurer): Label {
  const cut = label.lines.length > maxLines;
  if (!cut && label.width <= maxWidth) return label;
  const dots = measurer.width('…', label.size, 0);
  const lines: Span[][] = [];
  const widths: number[] = [];
  let widest = 0;
  for (let i = 0; i < Math.min(maxLines, label.lines.length); i++) {
    const line = label.lines[i].map((span) => ({ ...span }));
    let width = label.widths[i];
    if (width > maxWidth || (cut && i === maxLines - 1)) {
      for (;;) {
        const span = line[line.length - 1];
        if (span === undefined) {
          line.push({ text: '…', style: 0, width: dots });
          width = dots;
          break;
        }
        const rest = width - span.width;
        if (span.icon === undefined && rest + dots < maxWidth) {
          let lo = 0;
          let hi = span.text.length;
          while (lo < hi) {
            const mid = (lo + hi + 1) >> 1;
            if (rest + measurer.width(span.text.slice(0, mid), label.size, span.style) + dots <= maxWidth) lo = mid;
            else hi = mid - 1;
          }
          const code = lo > 0 ? span.text.charCodeAt(lo - 1) : 0;
          if (code >= 0xd800 && code <= 0xdbff) lo--;
          span.text = span.text.slice(0, lo).trimEnd() + '…';
          span.width = measurer.width(span.text, label.size, span.style);
          width = rest + span.width;
          break;
        }
        line.pop();
        width = rest;
      }
    }
    lines.push(line);
    widths.push(width);
    widest = Math.max(widest, width);
  }
  return { ...label, lines, widths, width: widest, height: lines.length * label.lineHeight };
}

interface Port {
  x: number;
  y: number;
  dx: number;
  dy: number;
  // The box the route has to stay out of when it cannot leave straight.
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  // How far short of the port an arrowhead stops: the radius of a junction's dot.
  gap: number;
  // Set where a junction is reached through the border of its group: the line carries on to the junction.
  wire: boolean;
}

// An orthogonal route from one port to another, each left along its side's normal.
function route(s: Port, e: Port): number[] {
  const { x: sx, y: sy, dx: sdx, dy: sdy } = s;
  const { x: ex, y: ey, dx: edx, dy: edy } = e;
  const s1x = sx + sdx * STUB;
  const s1y = sy + sdy * STUB;
  const e1x = ex + edx * STUB;
  const e1y = ey + edy * STUB;
  if (sdx * edx + sdy * edy === 0) {
    const cx = sdx !== 0 ? ex : sx;
    const cy = sdx !== 0 ? sy : ey;
    if ((cx - sx) * sdx + (cy - sy) * sdy > 0 && (cx - ex) * edx + (cy - ey) * edy > 0) return [sx, sy, cx, cy, ex, ey];
    return sdx !== 0 ? [sx, sy, s1x, s1y, s1x, e1y, e1x, e1y, ex, ey] : [sx, sy, s1x, s1y, e1x, s1y, e1x, e1y, ex, ey];
  }
  const sideways = sdx !== 0;
  const offset = sideways ? ey - sy : ex - sx;
  if (sdx === -edx && sdy === -edy) {
    const ahead = (ex - sx) * sdx + (ey - sy) * sdy;
    if (ahead > 0) {
      if (Math.abs(offset) < 0.5) return [sx, sy, ex, ey];
      // Turn midway between the two boxes, which is clear of both titles, when there is such a place.
      if (sideways) {
        const lo = sdx > 0 ? s.x1 : e.x1;
        const hi = sdx > 0 ? e.x0 : s.x0;
        const mx = lo < hi ? (lo + hi) / 2 : (sx + ex) / 2;
        return [sx, sy, mx, sy, mx, ey, ex, ey];
      }
      const lo = sdy > 0 ? s.y1 : e.y1;
      const hi = sdy > 0 ? e.y0 : s.y0;
      const my = lo < hi ? (lo + hi) / 2 : (sy + ey) / 2;
      return [sx, sy, sx, my, ex, my, ex, ey];
    }
  } else if (Math.abs(offset) >= 1) {
    if (sideways) {
      const x = sdx > 0 ? Math.max(sx, ex) + STUB : Math.min(sx, ex) - STUB;
      return [sx, sy, x, sy, x, ey, ex, ey];
    }
    const y = sdy > 0 ? Math.max(sy, ey) + STUB : Math.min(sy, ey) - STUB;
    return [sx, sy, sx, y, ex, y, ex, ey];
  }
  // The straight way is blocked by one of the two nodes: go between them, or around both.
  if (sideways) {
    const lane = s.y1 + STUB <= e.y0 ? (s.y1 + e.y0) / 2 : e.y1 + STUB <= s.y0 ? (e.y1 + s.y0) / 2 : Math.max(s.y1, e.y1) + STUB;
    return [sx, sy, s1x, sy, s1x, lane, e1x, lane, e1x, ey, ex, ey];
  }
  const lane = s.x1 + STUB <= e.x0 ? (s.x1 + e.x0) / 2 : e.x1 + STUB <= s.x0 ? (e.x1 + s.x0) / 2 : Math.max(s.x1, e.x1) + STUB;
  return [sx, sy, sx, s1y, lane, s1y, lane, e1y, ex, e1y, ex, ey];
}

// Drops repeated points and joins runs that continue in a straight line.
function simplify(p: number[]): number[] {
  const out = [p[0], p[1]];
  for (let i = 2; i < p.length; i += 2) {
    const x = p[i];
    const y = p[i + 1];
    const n = out.length;
    const sameX = Math.abs(x - out[n - 2]) < 0.01;
    const sameY = Math.abs(y - out[n - 1]) < 0.01;
    if (sameX && sameY) continue;
    if (n >= 4 && ((sameX && Math.abs(out[n - 4] - out[n - 2]) < 0.01) || (sameY && Math.abs(out[n - 3] - out[n - 1]) < 0.01))) {
      out[n - 2] = x;
      out[n - 1] = y;
    } else {
      out.push(x, y);
    }
  }
  return out;
}

function pathData(p: number[], startTrim: number, endTrim: number): string {
  const n = p.length / 2;
  const xs = new Array<number>(n);
  const ys = new Array<number>(n);
  for (let i = 0; i < n; i++) {
    xs[i] = p[i * 2];
    ys[i] = p[i * 2 + 1];
  }
  const trim = (at: number, toward: number, amount: number): void => {
    const len = Math.hypot(xs[toward] - xs[at], ys[toward] - ys[at]);
    const t = Math.min(amount, Math.max(0, len - 1));
    if (len > 0 && t > 0) {
      xs[at] += ((xs[toward] - xs[at]) / len) * t;
      ys[at] += ((ys[toward] - ys[at]) / len) * t;
    }
  };
  trim(0, 1, startTrim);
  trim(n - 1, n - 2, endTrim);
  let d = `M${num(xs[0])},${num(ys[0])}`;
  for (let i = 1; i < n - 1; i++) {
    const before = Math.hypot(xs[i] - xs[i - 1], ys[i] - ys[i - 1]);
    const after = Math.hypot(xs[i + 1] - xs[i], ys[i + 1] - ys[i]);
    const r = Math.min(CORNER, before / 2, after / 2);
    if (r < 0.5) {
      d += `L${num(xs[i])},${num(ys[i])}`;
      continue;
    }
    const inX = xs[i] - ((xs[i] - xs[i - 1]) / before) * r;
    const inY = ys[i] - ((ys[i] - ys[i - 1]) / before) * r;
    const outX = xs[i] + ((xs[i + 1] - xs[i]) / after) * r;
    const outY = ys[i] + ((ys[i + 1] - ys[i]) / after) * r;
    d += `L${num(inX)},${num(inY)}Q${num(xs[i])},${num(ys[i])} ${num(outX)},${num(outY)}`;
  }
  return d + `L${num(xs[n - 1])},${num(ys[n - 1])}`;
}

export function renderArchitecture(model: ArchitectureModel, config: Config, options: RenderOptions): Rendered {
  return tighten(options, (tight) => draw(model, config, options, tight));
}

function draw(model: ArchitectureModel, config: Config, options: RenderOptions, tight: boolean): Rendered {
  const iconSize = setting(config, 'iconSize', 48, 8, 512);
  const size = setting(config, 'fontSize', options.fontSize ?? 16, 4, 128);
  const groupPad = Math.min(setting(config, 'padding', 20, 0, 256), tight ? 12 : Infinity);
  const small = Math.round(size * 0.875);
  const measurer = options.measurer ?? defaultMeasurer(options.fontFamily, options.fontFamilyMono);
  const pad = options.padding ?? 8;
  const icons = options.icons;
  const half = iconSize / 2;

  const nodes = [...model.nodes.values()];
  const groups = [...model.groups.values()];
  const N = nodes.length;
  const G = groups.length;
  const grid = placeOnGrid(nodes, groups, model.edges, model.layoutHints);
  const index = new Map<string, number>();
  nodes.forEach((node, i) => index.set(node.id, i));

  // A service is its icon square with the title beneath; a junction takes the same room.
  const labels = new Array<Label>(N);
  const boxW = new Float64Array(N);
  const boxH = new Float64Array(N);
  const wrap = tight ? Math.max(iconSize, 64) : Math.max(iconSize * 2.25, 96);
  for (let i = 0; i < N; i++) {
    const node = nodes[i];
    const label = layoutLabel(node.type === 'service' ? node.title : undefined, true, measurer, size, wrap);
    labels[i] = label;
    boxW[i] = Math.max(iconSize, 2 * Math.ceil(label.width / 2));
    boxH[i] = iconSize + (label.height > 0 ? LABEL_GAP + label.height : 0);
  }

  const colValues: number[] = [];
  const rowValues: number[] = [];
  for (let i = 0; i < N; i++) {
    colValues.push(grid.col[i]);
    rowValues.push(grid.row[i]);
  }
  for (let g = 0; g < G; g++) {
    if (!grid.groupEmpty[g]) continue;
    colValues.push(grid.groupCol[g]);
    rowValues.push(grid.groupRow[g]);
  }
  const colOf = rank(colValues);
  const rowOf = rank(rowValues);
  const C = colOf.size;
  const R = rowOf.size;
  const colW = new Float64Array(C);
  const rowH = new Float64Array(R);
  const gap = tight ? Math.max(24, 2 * STUB) : Math.max(40, Math.round(iconSize * 0.75));
  const gapX = new Float64Array(C).fill(gap);
  const gapY = new Float64Array(R).fill(gap);
  const nodeCol = new Int32Array(N);
  const nodeRow = new Int32Array(N);
  for (let i = 0; i < N; i++) {
    const c = (nodeCol[i] = colOf.get(grid.col[i])!);
    const r = (nodeRow[i] = rowOf.get(grid.row[i])!);
    colW[c] = Math.max(colW[c], boxW[i]);
    rowH[r] = Math.max(rowH[r], boxH[i]);
  }
  for (let g = 0; g < G; g++) {
    if (!grid.groupEmpty[g]) continue;
    const c = colOf.get(grid.groupCol[g])!;
    const r = rowOf.get(grid.groupRow[g])!;
    colW[c] = Math.max(colW[c], iconSize);
    rowH[r] = Math.max(rowH[r], half);
  }

  // An edge label needs the gap its edge crosses to be wide enough to hold it.
  const E = model.edges.length;
  const edgeLabels = new Array<Label>(E);
  const ends = new Int32Array(E * 2);
  for (let k = 0; k < E; k++) {
    const edge = model.edges[k];
    const a = (ends[k * 2] = index.get(edge.lhsId) ?? -1);
    const b = (ends[k * 2 + 1] = index.get(edge.rhsId) ?? -1);
    const label = layoutLabel(edge.title, true, measurer, small, 160);
    edgeLabels[k] = label;
    if (label.width === 0 || a < 0 || b < 0) continue;
    if (nodeCol[a] !== nodeCol[b]) {
      const c = Math.min(nodeCol[a], nodeCol[b]);
      gapX[c] = Math.max(gapX[c], Math.ceil(label.width) + 28);
    } else {
      colW[nodeCol[a]] = Math.max(colW[nodeCol[a]], 2 * Math.ceil(label.width / 2) + 8);
      if (nodeRow[a] !== nodeRow[b]) {
        const r = Math.min(nodeRow[a], nodeRow[b]);
        gapY[r] = Math.max(gapY[r], Math.ceil(label.height) + 24);
      }
    }
  }

  // Room around each group, kept on the rows and columns at its edges. A group that shares an
  // edge with a group inside it stands that much further out. Children come after their parents,
  // so walking backwards settles every group before the one that holds it.
  const groupLabels = new Array<Label>(G);
  const c0 = new Int32Array(G);
  const c1 = new Int32Array(G);
  const r0 = new Int32Array(G);
  const r1 = new Int32Array(G);
  const insL = new Float64Array(G);
  const insR = new Float64Array(G);
  const insT = new Float64Array(G);
  const insB = new Float64Array(G);
  const headW = new Float64Array(G);
  const headH = new Float64Array(G);
  const colL = new Float64Array(C);
  const colR = new Float64Array(C);
  const rowT = new Float64Array(R);
  const rowB = new Float64Array(R);
  const badge = Math.round(size * 1.25);
  for (let g = 0; g < G; g++) {
    c0[g] = colOf.get(grid.groupCol[g])!;
    c1[g] = colOf.get(grid.groupCol[g] + grid.groupCols[g] - 1)!;
    r0[g] = rowOf.get(grid.groupRow[g])!;
    r1[g] = rowOf.get(grid.groupRow[g] + grid.groupRows[g] - 1)!;
    const label = layoutLabel(groups[g].title, true, measurer, size, tight ? Math.max(80, titleRoom(options) / 2) : 320);
    groupLabels[g] = label;
    const icon = groups[g].icon ? badge : 0;
    headW[g] = label.width + icon + (label.width > 0 && icon > 0 ? 6 : 0);
    headH[g] = Math.max(label.height, icon);
  }
  for (let g = G - 1; g >= 0; g--) {
    const left = groupPad + insL[g];
    let right = groupPad + insR[g];
    const top = (headH[g] > 0 ? Math.max(groupPad, headH[g] + 12) : groupPad) + insT[g];
    const bottom = groupPad + insB[g];
    if (headW[g] > 0) {
      let inner = left + right;
      for (let c = c0[g]; c <= c1[g]; c++) inner += colW[c] + (c < c1[g] ? colR[c] + gapX[c] + colL[c + 1] : 0);
      if (headW[g] + 20 > inner) right += Math.ceil(headW[g] + 20 - inner);
    }
    insL[g] = left;
    insR[g] = right;
    insT[g] = top;
    insB[g] = bottom;
    colL[c0[g]] = Math.max(colL[c0[g]], left);
    colR[c1[g]] = Math.max(colR[c1[g]], right);
    rowT[r0[g]] = Math.max(rowT[r0[g]], top);
    rowB[r1[g]] = Math.max(rowB[r1[g]], bottom);
    const p = grid.groupParent[g];
    if (p < 0) continue;
    if (c0[p] === c0[g]) insL[p] = Math.max(insL[p], left);
    if (c1[p] === c1[g]) insR[p] = Math.max(insR[p], right);
    if (r0[p] === r0[g]) insT[p] = Math.max(insT[p], top);
    if (r1[p] === r1[g]) insB[p] = Math.max(insB[p], bottom);
  }

  const X = new Float64Array(C);
  const Y = new Float64Array(R);
  let innerW = 0;
  for (let c = 0; c < C; c++) {
    X[c] = innerW + colL[c];
    innerW = X[c] + colW[c] + colR[c] + (c < C - 1 ? gapX[c] : 0);
  }
  let innerH = 0;
  for (let r = 0; r < R; r++) {
    Y[r] = innerH + rowT[r];
    innerH = Y[r] + rowH[r] + rowB[r] + (r < R - 1 ? gapY[r] : 0);
  }
  // What is drawn, which an edge that has to go around a node can push past the grid.
  let minX = 0;
  let minY = 0;
  let maxX = innerW;
  let maxY = innerH;

  const left = (g: number): number => X[c0[g]] - insL[g];
  const right = (g: number): number => X[c1[g]] + colW[c1[g]] + insR[g];
  const top = (g: number): number => Y[r0[g]] - insT[g];
  const bottom = (g: number): number => Y[r1[g]] + rowH[r1[g]] + insB[g];
  const centerX = (i: number): number => X[nodeCol[i]] + colW[nodeCol[i]] / 2;

  const port = (i: number, side: number, viaGroup: boolean | undefined): Port => {
    const dx = DX[side];
    const dy = DY[side];
    const cx = centerX(i);
    const y = Y[nodeRow[i]];
    const p: Port = { x: cx, y: y + half, dx, dy, x0: cx - boxW[i] / 2, y0: y, x1: cx + boxW[i] / 2, y1: y + boxH[i], gap: 0, wire: false };
    if (nodes[i].type === 'junction') {
      p.x0 = p.x1 = cx;
      p.y0 = p.y1 = p.y;
      p.gap = DOT;
    } else if (dx !== 0) {
      p.x = cx + dx * half;
    } else {
      p.y = dy < 0 ? y : y + boxH[i] + (labels[i].height > 0 ? 2 : 0);
    }
    const g = viaGroup ? grid.nodeParent[i] : -1;
    if (g >= 0) {
      p.x0 = left(g);
      p.x1 = right(g);
      p.y0 = top(g);
      p.y1 = bottom(g);
      p.gap = 0;
      p.wire = nodes[i].type === 'junction';
      if (dx !== 0) p.x = dx < 0 ? p.x0 : p.x1;
      else p.y = dy < 0 ? p.y0 : p.y1;
    }
    return p;
  };

  let edgesOut = '';
  let labelsOut = '';
  // Vertical runs of the edges, to keep group titles out from under them.
  const runs: number[] = [];
  const trimLength = markerTrim('arrow_point');
  for (let k = 0; k < E; k++) {
    const edge = model.edges[k];
    const a = ends[k * 2];
    const b = ends[k * 2 + 1];
    if (a < 0 || b < 0) continue;
    const s = port(a, sideIndex(edge.lhsDir), edge.lhsGroup);
    const e = port(b, sideIndex(edge.rhsDir), edge.rhsGroup);
    if (s.x === e.x && s.y === e.y && s.dx === e.dx) {
      // An edge from a side back to the same side: part the two ends so it shows as a loop.
      s.x -= 8 * Math.abs(s.dy);
      s.y -= 8 * Math.abs(s.dx);
      e.x += 8 * Math.abs(s.dy);
      e.y += 8 * Math.abs(s.dx);
    }
    const routed = route(s, e);
    if (s.wire) routed.unshift(centerX(a), Y[nodeRow[a]] + half);
    if (e.wire) routed.push(centerX(b), Y[nodeRow[b]] + half);
    const points = simplify(routed);
    if (points.length < 4) continue;
    const id = escText(`${edge.lhsId}-${edge.rhsId}`);
    edgesOut +=
      `<g class="pele-edge" data-id="${id}">` +
      `<path d="${pathData(points, edge.lhsInto && !s.wire ? trimLength + s.gap : 0, edge.rhsInto && !e.wire ? trimLength + e.gap : 0)}"/>` +
      (edge.lhsInto ? marker('arrow_point', s.x + s.dx * s.gap, s.y + s.dy * s.gap, -s.dx, -s.dy, 'var(--_l)') : '') +
      (edge.rhsInto ? marker('arrow_point', e.x + e.dx * e.gap, e.y + e.dy * e.gap, -e.dx, -e.dy, 'var(--_l)') : '') +
      '</g>';
    let best = -1;
    let bestLength = -1;
    let flat = -1;
    let flatLength = -1;
    const label = edgeLabels[k];
    for (let i = 0; i < points.length; i += 2) {
      minX = Math.min(minX, points[i] - 4);
      maxX = Math.max(maxX, points[i] + 4);
      minY = Math.min(minY, points[i + 1] - 4);
      maxY = Math.max(maxY, points[i + 1] + 4);
    }
    for (let i = 0; i + 3 < points.length; i += 2) {
      const horizontal = Math.abs(points[i + 1] - points[i + 3]) < 0.01;
      const length = Math.abs(points[i] - points[i + 2]) + Math.abs(points[i + 1] - points[i + 3]);
      if (!horizontal) runs.push(points[i], Math.min(points[i + 1], points[i + 3]), Math.max(points[i + 1], points[i + 3]));
      if (length > bestLength) {
        best = i;
        bestLength = length;
      }
      if (horizontal && length > flatLength) {
        flat = i;
        flatLength = length;
      }
    }
    if (label.width > 0) {
      const at = flatLength >= label.width + 8 ? flat : best;
      let x = (points[at] + points[at + 2]) / 2;
      let y = (points[at + 1] + points[at + 3]) / 2;
      const w = label.width + 8;
      const upright = Math.abs(points[at] - points[at + 2]) < 0.01;
      // On a short run next to a node the label would land on the node, so it moves off to the side.
      for (const p of [s, e]) {
        if (x + w / 2 <= p.x0 || x - w / 2 >= p.x1 || y + label.height / 2 <= p.y0 || y - label.height / 2 >= p.y1) continue;
        if (upright) x = x >= (p.x0 + p.x1) / 2 ? p.x1 + w / 2 + 4 : p.x0 - w / 2 - 4;
        else y = y >= (p.y0 + p.y1) / 2 ? p.y1 + label.height / 2 + 4 : p.y0 - label.height / 2 - 4;
      }
      minX = Math.min(minX, x - w / 2);
      maxX = Math.max(maxX, x + w / 2);
      minY = Math.min(minY, y - label.height / 2);
      maxY = Math.max(maxY, y + label.height / 2);
      labelsOut += edgeLabelSvg(`${edge.lhsId}-${edge.rhsId}`, label, x, y, '', icons);
    }
  }

  let clusters = '';
  for (let g = 0; g < G; g++) {
    const group = groups[g];
    const x = left(g);
    const y = top(g);
    const w = right(g) - x;
    const label = groupLabels[g];
    let head = '';
    if (headW[g] > 0) {
      // The title starts at the left, or after the edges that come down through that corner.
      const band = y + headH[g] + 12;
      const crossings: number[] = [];
      for (let i = 0; i < runs.length; i += 3) {
        if (runs[i + 1] < band && runs[i + 2] > y && runs[i] > x && runs[i] < x + w) crossings.push(runs[i]);
      }
      crossings.sort((a, b) => a - b);
      crossings.push(x + w - 4);
      let start = x + 10;
      for (const crossing of crossings) {
        if (crossing - 6 - start >= headW[g]) break;
        start = Math.max(start, crossing + 6);
      }
      if (start + headW[g] > x + w - 4) start = x + 10;
      const cy = y + 6 + headH[g] / 2;
      let textX = start;
      if (group.icon) {
        head += iconSlot(group.icon, start, cy - badge / 2, badge, icons);
        textX += badge + 6;
      }
      head += labelSvg(label, textX + label.width / 2, cy, ' class="pele-cluster-label" fill="var(--_m)"', icons);
    }
    clusters +=
      `<g class="pele-cluster" data-id="${escText(group.id)}">` +
      `<rect x="${num(x)}" y="${num(y)}" width="${num(w)}" height="${num(bottom(g) - y)}" fill="var(--_a)" fill-opacity="0.5" stroke="var(--_b)"${ROUNDED}/>` +
      head +
      '</g>';
  }

  let nodesOut = '';
  const glyph = iconSize * 0.5;
  const textSize = Math.max(6, Math.round(size * 0.75));
  for (let i = 0; i < N; i++) {
    const node = nodes[i];
    const at = `data-id="${escText(node.id)}" transform="translate(${num(centerX(i))},${num(Y[nodeRow[i]])})"`;
    if (node.type === 'junction') {
      nodesOut += `<g class="pele-node pele-junction" ${at}><circle cy="${num(half)}" r="${DOT}" fill="var(--_l)"/></g>`;
      continue;
    }
    let inner = '';
    if (node.icon) {
      inner = iconSlot(node.icon, -glyph / 2, (iconSize - glyph) / 2, glyph, icons);
    } else if (node.iconText) {
      const text = layoutLabel(node.iconText, false, measurer, textSize, iconSize - 8);
      const lines = Math.max(1, Math.floor((iconSize - 4) / (text.lineHeight || 1)));
      inner = labelSvg(fit(text, iconSize - 8, lines, measurer), 0, half, ` class="pele-icon-text" font-size="${textSize}"`, icons);
    }
    nodesOut +=
      `<g class="pele-node pele-service" ${at}>` +
      `<rect x="${num(-half)}" width="${num(iconSize)}" height="${num(iconSize)}" fill="var(--_s)" stroke="var(--_b)"${ROUNDED}/>` +
      inner +
      labelSvg(labels[i], 0, iconSize + LABEL_GAP + labels[i].height / 2, ' class="pele-label"', icons) +
      '</g>';
  }

  const title = layoutLabel(model.title, false, measurer, size, tight ? titleRoom(options) : 4000, Style.Bold);
  const titleHeight = title.height > 0 ? title.height + 12 : 0;
  const width = Math.ceil(Math.max(maxX - minX, title.width) + 2 * pad);
  const height = Math.ceil(maxY - minY + titleHeight + 2 * pad);
  const ox = Math.round((width - (maxX - minX)) / 2 - minX);
  const oy = Math.round(pad + titleHeight - minY);
  const body =
    (clusters ? `<g class="pele-clusters">${clusters}</g>` : '') +
    (edgesOut ? `<g class="pele-edges" fill="none" stroke="var(--_l)" stroke-linecap="round" stroke-linejoin="round">${edgesOut}</g>` : '') +
    (labelsOut ? `<g class="pele-edge-labels" font-size="${small}">${labelsOut}</g>` : '') +
    (nodesOut ? `<g class="pele-nodes">${nodesOut}</g>` : '');
  const svg = svgDocument(
    'architecture',
    width,
    height,
    size,
    options,
    model,
    labelSvg(title, width / 2, pad + title.height / 2, ' class="pele-title" font-weight="var(--_tw)"') +
      (body ? `<g transform="translate(${ox},${oy})">${body}</g>` : '')
  );
  return { svg, width, height, links: [] };
}
