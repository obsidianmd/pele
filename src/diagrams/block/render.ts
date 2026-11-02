import type { Config } from '../../preprocess.js';
import { titleLabel } from '../../svg/title.js';
import { escText, labelSvg, num } from '../../svg/builder.js';
import { ARROW, casingsSvg, edgeCasing, edgeLabelSvg, marker, markerTrim, overFills, type EdgePath, type Fill } from '../../svg/edges.js';
import { inkFill, paints } from '../../svg/ink.js';
import { svgDocument } from '../../svg/root.js';
import { drawShape, shapeFilled, shapeInset, shapeSize } from '../../svg/shapes.js';
import { classNames, resolveStyle, rounded, setsFill, type ResolvedStyle } from '../../svg/theme.js';
import { layoutLabel, type Label } from '../../text/label.js';
import { Style, defaultMeasurer } from '../../text/measurer.js';
import type { RenderOptions, Rendered } from '../../types.js';
import { tighten, titleRoom } from '../common/fit-width.js';
import { OVERHANG, arrowAxis, arrowMask, arrowPoints, arrowSize, drawArrow } from './arrows.js';
import { layout, type Cell } from './layout.js';
import type { Block, BlockModel } from './types.js';

const GAP = 12;
const WRAP = 200;
const CORNER = 8;
const SHAPE_ATTRS = ' fill="var(--_s)" stroke="var(--_b)"';
const LINE_ATTRS = ' stroke="var(--_b)"';
const NO_CLASSES: string[] = [];
const NO_BLOCKS: Block[] = [];
const NO_HEIGHTS: number[] = [];
const NO_GAPS: number[] = [];
const DEFAULT_CLASS = ['default'];
// Checking every edge against every block is quadratic, so large diagrams route without it.
const OBSTACLE_BUDGET = 2_000_000;
const LABEL_GAP = 4;

const SHAPES = new Map([
  ['square', 'rect'],
  ['round', 'rounded'],
  ['circle', 'circle'],
  ['doublecircle', 'dbl-circ'],
  ['diamond', 'diam'],
  ['hexagon', 'hex'],
  ['stadium', 'stadium'],
  ['subroutine', 'fr-rect'],
  ['cylinder', 'cyl'],
  ['rect_left_inv_arrow', 'odd'],
  ['lean_right', 'lean-r'],
  ['lean_left', 'lean-l'],
  ['trapezoid', 'trap-b'],
  ['inv_trapezoid', 'trap-t'],
]);

// Shapes that keep their own size in a larger cell, where the others stretch to fill it.
const FIXED = new Set(['circle', 'dbl-circ', 'diam']);
// Shapes that only widen, because their slants and curves are set by their height.
const WIDE = new Set(['stadium', 'hex', 'odd', 'lean-r', 'lean-l', 'trap-b', 'trap-t']);

const enum Kind {
  Leaf,
  Arrow,
  Composite,
  Space,
}

interface View extends Cell {
  children: View[];
  block: Block;
  kind: Kind;
  index: number;
  shape: string;
  label: Label;
  style: ResolvedStyle;
  mask: number;
  dx: number;
  dy: number;
  // Size as drawn, which for a fixed shape is smaller than its cell.
  bw: number;
  bh: number;
}

interface Box {
  x: number;
  y: number;
  bw: number;
  bh: number;
}

interface Route {
  edge: Block;
  // Two points for a straight line, three for a bend, none for a self-loop.
  points: number[];
  loop: number;
  label: Label;
  lx: number;
  ly: number;
}

function isRound(v: View): boolean {
  return v.kind === Kind.Leaf && (v.shape === 'circle' || v.shape === 'dbl-circ');
}

// Where a vertical line at x meets the outline, below the center (sign 1) or above it (sign -1).
function edgeY(v: View, x: number, sign: number): number {
  const hw = v.bw / 2;
  const hh = v.bh / 2;
  const dx = Math.abs(x - v.x);
  let reach = hh;
  if (isRound(v)) reach = Math.sqrt(Math.max(hw * hw - dx * dx, 0));
  else if (v.kind === Kind.Leaf && v.shape === 'diam') reach = hh * Math.max(1 - dx / hw, 0);
  else if (v.kind === Kind.Leaf) reach = hh - shapeInset(v.shape, v.bw, v.bh, sign > 0 ? 2 : 0);
  else if (v.kind === Kind.Arrow && arrowAxis(v.mask) === 'x') reach = hh - OVERHANG;
  return v.y + sign * reach;
}

// Where a horizontal line at y meets the outline, right of the center (sign 1) or left of it (sign -1).
function edgeX(v: View, y: number, sign: number): number {
  const hw = v.bw / 2;
  const hh = v.bh / 2;
  const dy = Math.abs(y - v.y);
  let reach = hw;
  if (isRound(v)) reach = Math.sqrt(Math.max(hh * hh - dy * dy, 0));
  else if (v.kind === Kind.Leaf && v.shape === 'diam') reach = hw * Math.max(1 - dy / hh, 0);
  else if (v.kind === Kind.Leaf) reach = hw - shapeInset(v.shape, v.bw, v.bh, sign > 0 ? 1 : 3);
  else if (v.kind === Kind.Arrow && arrowAxis(v.mask) === 'y') reach = hw - OVERHANG;
  return v.x + sign * reach;
}

// Where the line from the center toward (tx, ty) leaves the outline.
function border(v: View, tx: number, ty: number, out: number[]): void {
  const dx = tx - v.x;
  const dy = ty - v.y;
  const hw = v.bw / 2;
  const hh = v.bh / 2;
  let k: number;
  if (isRound(v)) k = hw / (Math.hypot(dx, dy) || 1);
  else if (v.kind === Kind.Leaf && v.shape === 'diam') k = 1 / (Math.abs(dx) / hw + Math.abs(dy) / hh || 1);
  else k = Math.min(dx === 0 ? Infinity : hw / Math.abs(dx), dy === 0 ? Infinity : hh / Math.abs(dy));
  if (k === Infinity) k = 0;
  out.push(v.x + dx * k, v.y + dy * k);
}

// Refines the bounding-box intersection for the nonrectangular outlines in straight mode.
function straightBorder(v: View, tx: number, ty: number, out: number[]): void {
  const point: number[] = [];
  border(v, tx, ty, point);
  const dx = point[0] - v.x;
  const dy = point[1] - v.y;
  const hw = v.bw / 2;
  const hh = v.bh / 2;
  let reach = 1;
  if (v.kind === Kind.Arrow) {
    const p = arrowPoints(v.mask, v.bw, v.bh);
    for (let i = 0, j = p.length - 2; i < p.length; j = i, i += 2) {
      const ax = p[j];
      const ay = p[j + 1];
      const ex = p[i] - ax;
      const ey = p[i + 1] - ay;
      const cross = dx * ey - dy * ex;
      if (cross === 0) continue;
      const k = (ax * ey - ay * ex) / cross;
      const t = (ax * dy - ay * dx) / cross;
      if (k >= 0 && t >= 0 && t <= 1) reach = Math.min(reach, k);
    }
  } else if (v.kind === Kind.Leaf && !isRound(v) && v.shape !== 'diam') {
    const inside = (k: number): boolean => {
      const x = dx * k;
      const y = dy * k;
      const slant = v.bh / 4;
      if (v.shape === 'lean-r') return x >= -hw + slant * (0.5 - y / v.bh) && x <= hw - slant * (0.5 + y / v.bh);
      if (v.shape === 'lean-l') return x >= -hw + slant * (0.5 + y / v.bh) && x <= hw - slant * (0.5 - y / v.bh);
      if (v.shape === 'trap-b' || v.shape === 'trap-t') {
        return Math.abs(x) <= hw - slant * (0.5 + (v.shape === 'trap-t' ? y : -y) / v.bh);
      }
      if (v.shape === 'odd') return x >= -hw + slant * (1 - Math.abs(y) / hh);
      if (v.shape === 'rounded' || v.shape === 'stadium') {
        const r = v.shape === 'stadium' ? hh : Math.min(12, hh);
        return Math.hypot(Math.max(0, Math.abs(x) - hw + r), Math.max(0, Math.abs(y) - hh + r)) <= r;
      }
      return (
        Math.abs(x) <= hw - shapeInset(v.shape, v.bw, v.bh, x < 0 ? 3 : 1, y) &&
        Math.abs(y) <= hh - shapeInset(v.shape, v.bw, v.bh, y < 0 ? 0 : 2, x)
      );
    };
    if (!inside(1)) {
      let lo = 0;
      let hi = 1;
      for (let i = 0; i < 32; i++) {
        const mid = (lo + hi) / 2;
        if (inside(mid)) lo = mid;
        else hi = mid;
      }
      reach = (lo + hi) / 2;
    }
  }
  out.push(v.x + dx * reach, v.y + dy * reach);
}

function straightEdge(s: View, t: View, precise = false): number[] {
  const points: number[] = [];
  // Concentric blocks have no center-to-center direction; join their right boundaries.
  const concentric = s.x === t.x && s.y === t.y;
  const clip = precise ? straightBorder : border;
  clip(s, concentric ? s.x + 1 : t.x, t.y, points);
  clip(t, concentric ? t.x + 1 : s.x, s.y, points);
  return points;
}

function crossesBox(x1: number, y1: number, x2: number, y2: number, v: View): boolean {
  const l = v.x - v.bw / 2 + 1;
  const r = v.x + v.bw / 2 - 1;
  const t = v.y - v.bh / 2 + 1;
  const b = v.y + v.bh / 2 - 1;
  if ((x1 < l && x2 < l) || (x1 > r && x2 > r) || (y1 < t && y2 < t) || (y1 > b && y2 > b)) return false;
  if (x1 === x2 || y1 === y2) return true;
  // The segment is diagonal and its bounding box overlaps: the box is hit unless all four corners are on one side.
  const dx = x2 - x1;
  const dy = y2 - y1;
  const side = (x: number, y: number): number => Math.sign(dx * (y - y1) - dy * (x - x1));
  const first = side(l, t);
  return first === 0 || side(r, t) !== first || side(r, b) !== first || side(l, b) !== first;
}

function hits(points: number[], s: View, t: View, obstacles: View[]): number {
  let count = 0;
  for (const v of obstacles) {
    if (v === s || v === t) continue;
    for (let i = 0; i + 3 < points.length; i += 2) {
      if (crossesBox(points[i], points[i + 1], points[i + 2], points[i + 3], v)) {
        count++;
        break;
      }
    }
  }
  return count;
}

// A straight line where the two blocks share a row or a column, otherwise one bend between facing sides.
function routeEdge(s: View, t: View, shift: number, obstacles: View[] | undefined, alternate = false): number[] {
  const sl = s.x - s.bw / 2;
  const sr = s.x + s.bw / 2;
  const st = s.y - s.bh / 2;
  const sb = s.y + s.bh / 2;
  const tl = t.x - t.bw / 2;
  const tr = t.x + t.bw / 2;
  const tt = t.y - t.bh / 2;
  const tb = t.y + t.bh / 2;
  const x1 = Math.max(sl, tl);
  const x2 = Math.min(sr, tr);
  const y1 = Math.max(st, tt);
  const y2 = Math.min(sb, tb);
  const overX = x2 - x1 > 6;
  const overY = y2 - y1 > 6;

  if (overX && overY) {
    // One block is inside the other: join the inner one to the nearest side of the outer one.
    const inner = s.bw * s.bh <= t.bw * t.bh ? s : t;
    const outer = inner === s ? t : s;
    const up = inner.y - inner.bh / 2 - (outer.y - outer.bh / 2);
    const down = outer.y + outer.bh / 2 - (inner.y + inner.bh / 2);
    const left = inner.x - inner.bw / 2 - (outer.x - outer.bw / 2);
    const right = outer.x + outer.bw / 2 - (inner.x + inner.bw / 2);
    const least = Math.min(up, down, left, right);
    let points: number[];
    if (least === down) points = [inner.x, edgeY(inner, inner.x, 1), inner.x, outer.y + outer.bh / 2];
    else if (least === up) points = [inner.x, edgeY(inner, inner.x, -1), inner.x, outer.y - outer.bh / 2];
    else if (least === right) points = [edgeX(inner, inner.y, 1), inner.y, outer.x + outer.bw / 2, inner.y];
    else points = [edgeX(inner, inner.y, -1), inner.y, outer.x - outer.bw / 2, inner.y];
    return inner === s ? points : [points[2], points[3], points[0], points[1]];
  }
  if (overX) {
    const margin = Math.min(6, (x2 - x1) / 2);
    const x = Math.min(Math.max((x1 + x2) / 2 + shift, x1 + margin), x2 - margin);
    const down = t.y > s.y ? 1 : -1;
    return [x, edgeY(s, x, down), x, edgeY(t, x, -down)];
  }
  if (overY) {
    const margin = Math.min(6, (y2 - y1) / 2);
    const y = Math.min(Math.max((y1 + y2) / 2 + shift, y1 + margin), y2 - margin);
    const right = t.x > s.x ? 1 : -1;
    return [edgeX(s, y, right), y, edgeX(t, y, -right), y];
  }

  const right = t.x > s.x ? 1 : -1;
  const down = t.y > s.y ? 1 : -1;
  const across = [edgeX(s, s.y, right), s.y, t.x, s.y, t.x, edgeY(t, t.x, -down)];
  const along = [s.x, edgeY(s, s.x, down), s.x, t.y, edgeX(t, t.y, -right), t.y];
  const wide = (Math.abs(t.x - s.x) >= Math.abs(t.y - s.y)) !== alternate;
  let best = wide ? across : along;
  if (obstacles === undefined) return best;
  let least = hits(best, s, t, obstacles);
  if (least === 0) return best;
  const other = wide ? along : across;
  const count = hits(other, s, t, obstacles);
  if (count < least) {
    best = other;
    least = count;
  }
  if (least === 0) return best;
  const direct = straightEdge(s, t);
  return hits(direct, s, t, obstacles) < least ? direct : best;
}

// A crossing at one point is fine; a shared run makes separate connections look joined.
function sharedRuns(points: number[], routes: number[][] | undefined): number {
  let length = 0;
  for (const other of routes ?? []) {
    for (let i = 0; i + 3 < points.length; i += 2) {
      const vertical = points[i] === points[i + 2];
      const horizontal = points[i + 1] === points[i + 3];
      if (!vertical && !horizontal) continue;
      const axis = vertical ? 1 : 0;
      const across = 1 - axis;
      for (let j = 0; j + 3 < other.length; j += 2) {
        if (Math.abs(points[i + across] - other[j + across]) >= 1 || other[j + across] !== other[j + across + 2]) continue;
        const lo = Math.max(Math.min(points[i + axis], points[i + axis + 2]), Math.min(other[j + axis], other[j + axis + 2]));
        const hi = Math.min(Math.max(points[i + axis], points[i + axis + 2]), Math.max(other[j + axis], other[j + axis + 2]));
        length += Math.max(0, hi - lo);
      }
    }
  }
  return length;
}

function preferredEdges(s: View, t: View, shift: number, edge: Block, minShaft: number, obstacles: View[] | undefined): number[][] {
  const direct = straightEdge(s, t, true);
  // With no obstacle list, routeEdge returns only axis-aligned candidates, never its diagonal fallback.
  const first = routeEdge(s, t, shift, undefined);
  const second = routeEdge(s, t, shift, undefined, true);
  const firstHits = obstacles ? hits(first, s, t, obstacles) : 0;
  const secondHits = obstacles ? hits(second, s, t, obstacles) : 0;
  const directHits = obstacles ? hits(direct, s, t, obstacles) : 0;
  const trim = markerTrim(edge.arrowTypeStart ?? '') + markerTrim(edge.arrowTypeEnd ?? '');
  const short = Math.hypot(direct[2] - direct[0], direct[3] - direct[1]) < trim + minShaft;
  if (!short && directHits <= Math.min(firstHits, secondHits)) return [direct];
  if (secondHits < firstHits) return [second];
  if (firstHits < secondHits) return [first];
  return [first, second];
}

// Builds the path through two or three points, rounding the bend and leaving room for markers.
function trace(p: number[], startTrim: number, endTrim: number): EdgePath {
  const n = p.length;
  const sx = p[0];
  const sy = p[1];
  const ex = p[n - 2];
  const ey = p[n - 1];
  let ax = p[2] - sx;
  let ay = p[3] - sy;
  const first = Math.hypot(ax, ay);
  ax /= first || 1;
  ay /= first || 1;
  let bx = ex - p[n - 4];
  let by = ey - p[n - 3];
  const last = Math.hypot(bx, by);
  bx /= last || 1;
  by /= last || 1;
  if (n === 4 && startTrim + endTrim > first) {
    const scale = first / (startTrim + endTrim);
    startTrim *= scale;
    endTrim *= scale;
  }
  startTrim = Math.min(startTrim, first);
  endTrim = Math.min(endTrim, last);
  let d = `M${num(sx + ax * startTrim)},${num(sy + ay * startTrim)}`;
  if (n === 6) {
    const r = Math.max(0, Math.min(CORNER, first - startTrim, last - endTrim));
    d += `L${num(p[2] - ax * r)},${num(p[3] - ay * r)}Q${num(p[2])},${num(p[3])} ${num(p[2] + bx * r)},${num(p[3] + by * r)}`;
  }
  d += `L${num(ex - bx * endTrim)},${num(ey - by * endTrim)}`;
  return { d, sx, sy, sdx: -ax, sdy: -ay, ex, ey, edx: bx, edy: by };
}

// A self-loop is an arc around the top right corner of the block, or around the matching point on a
// round or diamond outline. Gives the arc's center and radius and the angles where it leaves and returns.
function loopArc(v: View, k: number): [number, number, number, number, number] {
  const hw = v.bw / 2;
  const hh = v.bh / 2;
  const r = Math.max(1, Math.min(10 + 5 * (k - 1), hw, hh));
  if (isRound(v)) {
    const px = v.x + hw * Math.SQRT1_2;
    const py = v.y - hw * Math.SQRT1_2;
    const half = 2 * Math.asin(Math.min(1, r / (2 * hw)));
    const angle = (at: number): number => Math.atan2(v.y - hw * Math.sin(at) - py, v.x + hw * Math.cos(at) - px);
    return [px, py, r, angle(Math.PI / 4 + half), angle(Math.PI / 4 - half)];
  }
  if (v.kind === Kind.Leaf && v.shape === 'diam') {
    const slope = Math.atan2(hh, hw);
    return [v.x + hw / 2, v.y - hh / 2, r, slope + Math.PI, slope];
  }
  return [v.x + hw, v.y - hh, r, Math.PI, Math.PI / 2];
}

function loopPath(v: View, k: number, startTrim: number, endTrim: number): EdgePath {
  const [px, py, r, a1, a2] = loopArc(v, k);
  const from = a1 + startTrim / r;
  const to = a2 - endTrim / r;
  let sweep = (to - from) % (2 * Math.PI);
  if (sweep <= 0) sweep += 2 * Math.PI;
  const x1 = px + r * Math.cos(from);
  const y1 = py + r * Math.sin(from);
  const x2 = px + r * Math.cos(to);
  const y2 = py + r * Math.sin(to);
  const sx = px + r * Math.cos(a1);
  const sy = py + r * Math.sin(a1);
  const ex = px + r * Math.cos(a2);
  const ey = py + r * Math.sin(a2);
  // Each marker lies along the chord it covers, so it follows the curve instead of the tangent at its tip.
  const sl = Math.hypot(sx - x1, sy - y1);
  const el = Math.hypot(ex - x2, ey - y2);
  return {
    d: `M${num(x1)},${num(y1)}A${num(r)},${num(r)} 0 ${sweep > Math.PI ? 1 : 0} 1 ${num(x2)},${num(y2)}`,
    sx,
    sy,
    sdx: sl > 0 ? (sx - x1) / sl : Math.sin(a1),
    sdy: sl > 0 ? (sy - y1) / sl : -Math.cos(a1),
    ex,
    ey,
    edx: el > 0 ? (ex - x2) / el : -Math.sin(a2),
    edy: el > 0 ? (ey - y2) / el : Math.cos(a2),
  };
}

const SPOTS = [0.5, 0.3, 0.7, 0.15, 0.85];

function covers(x: number, y: number, w: number, h: number, s: View, t: View, obstacles: Box[] | undefined): boolean {
  if (obstacles === undefined) return false;
  for (const v of obstacles) {
    if (v !== s && v !== t && Math.abs(x - v.x) < (w + v.bw) / 2 && Math.abs(y - v.y) < (h + v.bh) / 2) return true;
  }
  return false;
}

// Picks the point on a leg where a label of the given size covers no block other than the two it joins.
function labelSpot(p: number[], at: number, w: number, h: number, s: View, t: View, obstacles: View[] | undefined): number {
  if (obstacles === undefined) return 0.5;
  for (const spot of SPOTS) {
    const x = p[at] + (p[at + 2] - p[at]) * spot;
    const y = p[at + 1] + (p[at + 3] - p[at + 1]) * spot;
    if (!covers(x, y, w, h, s, t, obstacles)) return spot;
  }
  return 0.5;
}

// Stacks overlapping labels along their shared line, if they fit between its markers and cover no other block or title.
// Returns the extra length needed to fit the labels.
function stackLabels(stack: number[], routes: Route[], legs: number[][], s: View, t: View, obstacles: Box[] | undefined, straight: boolean): number {
  const first = legs[stack[0]];
  if (straight && first[0] !== first[2] && first[1] !== first[3]) {
    // Separate diagonal labels across the line without moving the blocks or bending the edge.
    const length = Math.hypot(t.x - s.x, t.y - s.y);
    const nx = -(t.y - s.y) / length;
    const ny = (t.x - s.x) / length;
    const sizes = stack.map((i) => Math.abs(nx) * (routes[i].label.width + 8) + Math.abs(ny) * routes[i].label.height);
    let at = -sizes.reduce((sum, size) => sum + size + LABEL_GAP, -LABEL_GAP) / 2;
    stack.forEach((i, k) => {
      const offset = at + sizes[k] / 2;
      routes[i].lx += nx * offset;
      routes[i].ly += ny * offset;
      at += sizes[k] + LABEL_GAP;
    });
    return 0;
  }
  const vertical = legs[stack[0]][0] === legs[stack[0]][2];
  let lo = -Infinity;
  let hi = Infinity;
  let need = -LABEL_GAP;
  let crowded = false;
  for (let a = 0; a < stack.length; a++) {
    const leg = legs[stack[a]];
    if (vertical ? leg[0] !== leg[2] : leg[1] !== leg[3]) return 0;
    lo = Math.max(lo, vertical ? Math.min(leg[1], leg[3]) : Math.min(leg[0], leg[2]));
    hi = Math.min(hi, vertical ? Math.max(leg[1], leg[3]) : Math.max(leg[0], leg[2]));
    const p = routes[stack[a]];
    need += (vertical ? p.label.height : p.label.width + 8) + LABEL_GAP;
    for (let b = 0; b < a; b++) {
      const q = routes[stack[b]];
      if (Math.abs(p.lx - q.lx) < (p.label.width + q.label.width) / 2 + 8 && Math.abs(p.ly - q.ly) < (p.label.height + q.label.height) / 2) crowded = true;
    }
  }
  if (!crowded) return 0;
  if (need > hi - lo - 2 * ARROW) return need - (hi - lo - 2 * ARROW);
  const along: number[] = [];
  let next = (lo + hi - need) / 2;
  for (const i of stack) {
    const { label, lx, ly } = routes[i];
    const size = vertical ? label.height : label.width + 8;
    const at = next + size / 2;
    if (covers(vertical ? lx : at, vertical ? at : ly, label.width + 8, label.height, s, t, obstacles)) return 0;
    along.push(at);
    next += size + LABEL_GAP;
  }
  stack.forEach((i, k) => {
    if (vertical) routes[i].ly = along[k];
    else routes[i].lx = along[k];
  });
  return 0;
}

// Widens the gap in the blocks' nearest shared container.
// `base` keeps the gaps as they were when the labels were measured.
function widen(parents: View[], s: View, t: View, vertical: boolean, short: number, base: Map<number[], number[]>): boolean {
  const chain = new Set<View>();
  for (let v: View | undefined = s; v !== undefined; v = parents[v.index]) chain.add(v);
  let tb: View | undefined;
  let box: View | undefined = t;
  while (box !== undefined && !chain.has(box)) {
    tb = box;
    box = parents[box.index];
  }
  if (box === undefined || tb === undefined || box === s) return false;
  let sb = s;
  while (parents[sb.index] !== box) sb = parents[sb.index];
  let at: number;
  if (vertical) {
    if (sb.row === tb.row) return false;
    at = Math.max(sb.row, tb.row) - 1;
    if (box.rowGaps === NO_GAPS) box.rowGaps = [];
  } else {
    const [l, r] = sb.col < tb.col ? [sb, tb] : [tb, sb];
    if (r.col < l.col + l.span) return false;
    at = r.col - 1;
    if (box.colGaps === NO_GAPS) box.colGaps = [];
  }
  const gaps = vertical ? box.rowGaps : box.colGaps;
  if (!base.has(gaps)) base.set(gaps, gaps.slice());
  gaps[at] = Math.max(gaps[at] ?? 0, (base.get(gaps)![at] ?? 0) + short);
  return true;
}

export function renderBlock(model: BlockModel, config: Config, options: RenderOptions): Rendered {
  return tighten(options, (tight) => draw(model, config, options, tight));
}

function draw(model: BlockModel, config: Config, options: RenderOptions, tight: boolean): Rendered {
  const size = options.fontSize ?? 16;
  const edgeSize = Math.round(size * 0.875);
  const measurer = options.measurer ?? defaultMeasurer(options.fontFamily, options.fontFamilyMono);
  const pad = options.padding ?? 8;
  const icons = options.icons;
  const routing = options.block?.edgeRouting;
  const straight = routing === 'straight' || routing === 'prefer-straight';
  const configured = (config.block as Config | undefined)?.padding;
  const gap = Math.min(typeof configured === 'number' && configured >= 0 ? Math.min(configured, 200) : GAP, tight ? 6 : Infinity);
  const wrap = tight ? 80 : WRAP;

  const styleOf = (block: Block): ResolvedStyle => {
    const declarations: string[] = [];
    // A style list is split on commas only, so one entry can still hold several declarations.
    const add = (styles: string[]): void => {
      for (const style of styles) for (const part of style.split(';')) declarations.push(part);
    };
    for (const name of block.classes && block.classes.length > 0 ? block.classes : DEFAULT_CLASS) {
      const def = model.classes.get(name);
      if (def) add(def.styles);
    }
    if (block.styles) add(block.styles);
    return resolveStyle(declarations);
  };

  const view = (block: Block, index: number): View => {
    const type = block.type;
    const style = type === 'space' ? resolveStyle(NO_CLASSES) : styleOf(block);
    const textStyle = (style.bold ? Style.Bold : 0) | (style.italic ? Style.Italic : 0);
    const fontSize = style.fontSize ?? size;
    let kind = Kind.Leaf;
    let shape = '';
    let label: Label;
    let nw = 0;
    let nh = 0;
    let head = 0;
    let mask = 0;
    let dx = 0;
    let dy = 0;
    if (type === 'space') {
      kind = Kind.Space;
      label = layoutLabel(undefined, false, measurer, fontSize, wrap);
    } else if (type === 'composite') {
      kind = Kind.Composite;
      label = layoutLabel(block.label, false, measurer, fontSize, tight ? titleRoom(options) : 4000, textStyle);
      head = label.height > 0 ? label.height + 4 : 0;
      nw = label.width + 2 * gap;
      nh = head + 2 * gap;
    } else if (type === 'block_arrow') {
      kind = Kind.Arrow;
      label = layoutLabel(block.label, false, measurer, fontSize, wrap, textStyle);
      let blank = true;
      for (const line of label.lines) for (const part of line) if (part.icon !== undefined || part.text.trim() !== '') blank = false;
      mask = arrowMask(block.directions);
      const s = blank ? arrowSize(mask, 0, 0) : arrowSize(mask, label.width, label.height);
      nw = s.w;
      nh = s.h;
      dx = s.dx;
      dy = s.dy;
    } else {
      shape = SHAPES.get(type ?? '') ?? 'rect';
      label = layoutLabel(block.label, false, measurer, fontSize, wrap, textStyle);
      const s = shapeSize(shape, label.width, label.height);
      nw = s.w;
      // A cylinder's caps deepen as it widens, so it is sized for the deepest ones.
      nh = shape === 'cyl' ? Math.max(s.h, label.height + 40) : s.h;
      dy = s.dy;
    }
    // One literal with every field, so that all views share a shape and stay fast to read.
    return {
      children: [],
      columns: kind === Kind.Composite ? (block.columns ?? -1) : -1,
      span: kind === Kind.Space ? 1 : (block.widthInColumns ?? 1),
      space: kind === Kind.Space,
      head,
      nw,
      nh,
      col: 0,
      row: 0,
      cols: 0,
      heights: NO_HEIGHTS,
      rowGaps: NO_GAPS,
      colGaps: NO_GAPS,
      x: 0,
      y: 0,
      w: 0,
      h: 0,
      block,
      kind,
      index,
      shape,
      label,
      style,
      mask,
      dx,
      dy,
      bw: 0,
      bh: 0,
    };
  };

  const root = view(model.root, 0);
  root.nw = 0;
  root.nh = 0;
  const order = [root];
  const parents: View[] = [];
  const byId = new Map<string, View>();
  for (let i = 0; i < order.length; i++) {
    const parent = order[i];
    if (parent.kind !== Kind.Composite) continue;
    for (const child of parent.block.children ?? NO_BLOCKS) {
      const v = view(child, order.length);
      parent.children.push(v);
      parents[v.index] = parent;
      order.push(v);
      if (v.kind !== Kind.Space) byId.set(child.id, v);
    }
  }

  const obstacles: View[] = [];
  const titles: Box[] = [];
  // Layout keeps the widest a container has been, so each run starts from the widths it needs.
  const widths = order.map((v) => v.nw);
  const place = (): { width: number; height: number } => {
    for (const v of order) v.nw = widths[v.index];
    const content = layout(root, gap);
    obstacles.length = 0;
    titles.length = 0;
    for (const v of order) {
      if (v.kind === Kind.Leaf && FIXED.has(v.shape)) {
        v.bw = v.nw;
        v.bh = v.nh;
      } else if (v.kind === Kind.Arrow) {
        v.bw = v.span > 1 ? v.w : v.nw;
        v.bh = v.nh;
      } else {
        v.bw = v.w;
        v.bh = v.kind === Kind.Leaf && WIDE.has(v.shape) ? v.nh : v.h;
      }
      if (v.kind === Kind.Leaf && v.shape === 'cyl') v.dy = Math.min(12, Math.max(6, v.bw / 14)) / 2;
      if (v.kind === Kind.Leaf || v.kind === Kind.Arrow) obstacles.push(v);
      else if (v.head > 0) titles.push({ x: v.x, y: v.y - v.h / 2 + (v.head + gap) / 2 + 2, bw: v.label.width, bh: v.label.height });
    }
    return content;
  };
  let content = place();

  // Edges between the same two blocks are spread apart instead of drawn on top of each other.
  const pairs = new Map<number, number>();
  const labelled = new Set<number>();
  const ends: [View, View][] = [];
  const drawn: Block[] = [];
  for (const edge of model.edges) {
    const s = byId.get(edge.start ?? '');
    const t = byId.get(edge.end ?? '');
    if (s === undefined || t === undefined) continue;
    const key = Math.min(s.index, t.index) * order.length + Math.max(s.index, t.index);
    pairs.set(key, (pairs.get(key) ?? 0) + 1);
    if (edge.label) labelled.add(key);
    ends.push([s, t]);
    drawn.push(edge);
  }
  const check = drawn.length * obstacles.length <= OBSTACLE_BUDGET ? obstacles : undefined;
  const checkRoutes = drawn.length * drawn.length <= OBSTACLE_BUDGET;
  const routes: Route[] = [];
  const stacks = new Map<number, number[]>();
  const legs: number[][] = [];
  const route = (): void => {
    const seen = new Map<number, number>();
    routes.length = 0;
    stacks.clear();
    const candidates: number[][][] = [];
    const occupied: number[][] = [];
    if (routing === 'prefer-straight') {
      // Reserve fixed routes first, including straight arrows declared after a bend.
      for (let i = 0; i < drawn.length; i++) {
        const [s, t] = ends[i];
        if (s === t) continue;
        const key = Math.min(s.index, t.index) * order.length + Math.max(s.index, t.index);
        const total = pairs.get(key) ?? 1;
        const k = seen.get(key) ?? 0;
        seen.set(key, k + 1);
        const step = labelled.has(key) ? Math.round(edgeSize * 1.5) + 2 : 14;
        const shift = (k - (total - 1) / 2) * step;
        const choices = preferredEdges(s, t, shift, drawn[i], Math.max(12, size), check);
        candidates[i] = choices;
        if (checkRoutes && choices.length === 1) occupied.push(choices[0]);
      }
      seen.clear();
    }
    for (let i = 0; i < drawn.length; i++) {
      const [s, t] = ends[i];
      const key = Math.min(s.index, t.index) * order.length + Math.max(s.index, t.index);
      const total = pairs.get(key) ?? 1;
      const k = seen.get(key) ?? 0;
      seen.set(key, k + 1);
      const label = layoutLabel(drawn[i].label, false, measurer, edgeSize, WRAP);
      let points: number[];
      let lx: number;
      let ly: number;
      if (s === t) {
        const [px, py, r] = loopArc(s, k + 1);
        points = [];
        lx = px + r + 6 + label.width / 2;
        ly = py - r / 2;
      } else {
        const step = labelled.has(key) ? Math.round(edgeSize * 1.5) + 2 : 14;
        const shift = (k - (total - 1) / 2) * step;
        if (routing === 'prefer-straight') {
          const choices = candidates[i];
          points = choices[0];
          if (checkRoutes && choices.length > 1) {
            if (sharedRuns(choices[1], occupied) < sharedRuns(points, occupied)) points = choices[1];
            occupied.push(points);
          }
        } else {
          points = straight ? straightEdge(s, t, true) : routeEdge(s, t, shift, check);
        }
        const n = points.length;
        // The label goes on the longer leg.
        const firstLeg = Math.abs(points[2] - points[0]) + Math.abs(points[3] - points[1]);
        const lastLeg = Math.abs(points[n - 2] - points[n - 4]) + Math.abs(points[n - 1] - points[n - 3]);
        const at = n === 6 && lastLeg > firstLeg ? 2 : 0;
        const spot = label.width > 0 ? labelSpot(points, at, label.width + 8, label.height, s, t, check) : 0.5;
        lx = points[at] + (points[at + 2] - points[at]) * spot;
        ly = points[at + 1] + (points[at + 3] - points[at + 1]) * spot;
        if (label.width > 0 && total > 1) {
          legs[i] = points.slice(at, at + 4);
          const stack = stacks.get(key);
          if (stack) stack.push(i);
          else stacks.set(key, [i]);
        }
      }
      routes.push({ edge: drawn[i], points, loop: s === t ? k + 1 : 0, label, lx, ly });
    }
  };

  const settle = (grow: boolean): boolean => {
    route();
    const blocked = check && [...check, ...titles];
    const base = new Map<number[], number[]>();
    let grown = false;
    for (const stack of stacks.values()) {
      if (stack.length < 2) continue;
      const [s, t] = ends[stack[0]];
      const short = stackLabels(stack, routes, legs, s, t, blocked, straight);
      const vertical = legs[stack[0]][0] === legs[stack[0]][2];
      // Keep columns narrow to fit the host in tight layouts.
      if (grow && short > 0 && (vertical || !tight) && widen(parents, s, t, vertical, Math.ceil(short), base)) grown = true;
    }
    return grown;
  };
  const overlap = (): number => {
    let area = 0;
    for (let i = 0; i < routes.length; i++) {
      const p = routes[i];
      for (let j = i + 1; j < routes.length; j++) {
        const q = routes[j];
        const pw = (p.label.width + 8) / 2;
        const qw = (q.label.width + 8) / 2;
        const w = Math.min(p.lx + pw, q.lx + qw) - Math.max(p.lx - pw, q.lx - qw);
        const h = Math.min(p.ly + p.label.height / 2, q.ly + q.label.height / 2) - Math.max(p.ly - p.label.height / 2, q.ly - q.label.height / 2);
        if (p.label.width > 0 && q.label.width > 0 && w > 0 && h > 0) area += w * h;
      }
    }
    return area;
  };
  let minX = 0;
  let minY = 0;
  let maxX = 0;
  let maxY = 0;
  const grow = (x: number, y: number, w: number, h: number): void => {
    if (x - w / 2 < minX) minX = x - w / 2;
    if (x + w / 2 > maxX) maxX = x + w / 2;
    if (y - h / 2 < minY) minY = y - h / 2;
    if (y + h / 2 > maxY) maxY = y + h / 2;
  };
  // Finds the drawing's extent and gives its width.
  const bound = (): number => {
    minX = 0;
    minY = 0;
    maxX = content.width;
    maxY = content.height;
    for (let i = 0; i < routes.length; i++) {
      const route = routes[i];
      if (route.loop > 0) {
        const [px, py, r] = loopArc(ends[i][0], route.loop);
        grow(px, py, 2 * r + 2, 2 * r + 2);
      }
      if (route.label.width > 0) grow(route.lx, route.ly, route.label.width + 8, route.label.height);
    }
    return maxX - minX;
  };
  if (settle(!straight && drawn.length * drawn.length <= OBSTACLE_BUDGET)) {
    const before = overlap();
    const narrow = bound();
    // A container stretched by its row gives some of a new gap back, so the gap may take a few rounds.
    let grown = true;
    for (let round = 0; round < 3 && grown; round++) {
      content = place();
      grown = settle(round < 2);
    }
    // The drawing only grows if that leaves less of the labels covering each other, and within maxWidth.
    const wide = bound();
    const room = options.maxWidth !== undefined && options.maxWidth > 0 ? options.maxWidth : Infinity;
    if (overlap() > before - 1 || (wide > narrow && Math.ceil(wide + 2 * pad) > room)) {
      for (const v of order) {
        v.rowGaps = NO_GAPS;
        v.colGaps = NO_GAPS;
      }
      content = place();
      settle(false);
    }
  }

  bound();

  const title = titleLabel(model.title, measurer, size, tight ? titleRoom(options) : 4000);
  const titleHeight = title.height > 0 ? title.height + 12 : 0;
  const inner = Math.max(maxX - minX, title.width);
  const ox = pad - minX + (inner - (maxX - minX)) / 2;
  const oy = pad + titleHeight - minY;
  for (const v of order) {
    v.x += ox;
    v.y += oy;
  }
  const width = Math.ceil(inner + 2 * pad);
  const height = Math.ceil(maxY - minY + titleHeight + 2 * pad);

  let clusters = '';
  let nodes = '';
  const fills: Fill[] = [];
  for (let i = 1; i < order.length; i++) {
    const v = order[i];
    if (v.kind === Kind.Space) continue;
    const classes = classNames((v.block.classes ?? NO_CLASSES).join(' '));
    const id = escText(v.block.id);
    if (v.kind === Kind.Composite) {
      const top = v.y - v.h / 2;
      if (paints(v.style.shape)) fills.push({ box: [v.x - v.w / 2, top, v.x + v.w / 2, top + v.h], shape: v.style.shape });
      clusters +=
        `<g class="pele-cluster${classes}" data-id="${id}">` +
        `<rect x="${num(v.x - v.w / 2)}" y="${num(top)}" width="${num(v.w)}" height="${num(v.h)}" fill="var(--_a)"${setsFill(v.style.shape) ? '' : ' fill-opacity="0.5"'} stroke="var(--_b)"${rounded(v.style.shape)}/>` +
        labelSvg(v.label, v.x, top + (v.head + gap) / 2 + 2, ` class="pele-cluster-label"${inkFill(v.style, 'var(--_m)')}${v.style.text}`, icons) +
        '</g>';
      continue;
    }
    const arrow = v.kind === Kind.Arrow;
    let label = v.label;
    // Reuse a wider cell without changing the node size or the routes computed from it.
    if (
      v.span > 1 &&
      v.label.width > 0 &&
      v.label.lines.length > 1 &&
      v.bw > v.nw &&
      (arrow || !FIXED.has(v.shape))
    ) {
      const textStyle = (v.style.bold ? Style.Bold : 0) | (v.style.italic ? Style.Italic : 0);
      const room = v.label.width + (v.bw - v.nw);
      label = layoutLabel(v.block.label, false, measurer, v.label.size, room, textStyle);
    }
    nodes +=
      `<g class="pele-node pele-shape-${arrow ? 'block-arrow' : v.shape}${classes}" data-id="${id}" transform="translate(${num(v.x)},${num(v.y)})">` +
      (arrow
        ? drawArrow(v.mask, v.bw, v.bh, SHAPE_ATTRS + v.style.shape)
        : drawShape(v.shape, v.bw, v.bh, SHAPE_ATTRS + v.style.shape, LINE_ATTRS + v.style.line)) +
      labelSvg(label, v.dx, v.dy, ` class="pele-label"${arrow || shapeFilled(v.shape) ? inkFill(v.style) : ''}${v.style.text}`, icons) +
      '</g>';
  }

  let casings = '';
  let edges = '';
  let labels = '';
  for (let i = 0; i < routes.length; i++) {
    const { edge, points, loop, label } = routes[i];
    const startType = edge.arrowTypeStart ?? '';
    const endType = edge.arrowTypeEnd ?? '';
    let path: EdgePath;
    if (loop > 0) {
      path = loopPath(ends[i][0], loop, markerTrim(startType), markerTrim(endType));
    } else {
      for (let k = 0; k < points.length; k += 2) {
        points[k] += ox;
        points[k + 1] += oy;
      }
      path = trace(points, markerTrim(startType), markerTrim(endType));
    }
    const over = overFills(path.d, [path.sx, path.sy, path.ex, path.ey], fills);
    if (over === '') casings += edgeCasing(path, startType, endType, '', edge.thickness === 'thick');
    const id = escText(edge.id);
    edges +=
      `<g class="pele-edge" data-id="${id}"${over ? ` stroke="${over}"` : ''}>` +
      `<path d="${path.d}"${edge.thickness === 'thick' ? ' stroke-width="2.5"' : ''}${edge.pattern === 'dotted' ? ' stroke-dasharray="3 4"' : ''}/>` +
      marker(startType, path.sx, path.sy, path.sdx, path.sdy, over || 'var(--_l)') +
      marker(endType, path.ex, path.ey, path.edx, path.edy, over || 'var(--_l)') +
      '</g>';
    if (label.width > 0) {
      const x = routes[i].lx + ox;
      const y = routes[i].ly + oy;
      labels += edgeLabelSvg(edge.id, label, x, y, '', icons);
    }
  }

  const svg = svgDocument(
    'block',
    width,
    height,
    size,
    options,
    model,
    labelSvg(title, width / 2, pad + title.height / 2, ' class="pele-title" font-weight="var(--_tw)"') +
      (clusters ? `<g class="pele-clusters">${clusters}</g>` : '') +
      casingsSvg(casings) +
      (edges ? `<g class="pele-edges" fill="none" stroke="var(--_l)" stroke-linecap="round">${edges}</g>` : '') +
      `<g class="pele-nodes">${nodes}</g>` +
      (labels ? `<g class="pele-edge-labels" font-size="${edgeSize}">${labels}</g>` : '')
  );

  return { svg, width, height, links: [] };
}
