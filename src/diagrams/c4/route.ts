import { num } from '../../svg/builder.js';

// A laid out shape or boundary: top-left corner, size, and the shared shape it is drawn as.
export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
  form: string;
}

export interface Route {
  d: string;
  // Where the markers go: the tip, and the way it points.
  sx: number;
  sy: number;
  sdx: number;
  sdy: number;
  ex: number;
  ey: number;
  edx: number;
  edy: number;
  // The stretch the label may sit on.
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  // The side of that stretch the label is pushed to, as a unit vector; zero centers it on the stretch.
  nx: number;
  ny: number;
  // When set, the label stays over the line and moves that way by at most this much.
  lean: number;
  // The widest the label should be.
  room: number;
  // The corners of the line, as x, y pairs.
  points: number[];
}

const LOOP = 28;
export const LANE = 20;
const LANE_STEP = 7;
const CORNER = 8;
// A wide label on an upright lane leans this far out from it, to the middle of the gap between columns.
const LEAN = 30;
// Label widths that fit the gap between two columns, and where there is room to spare.
export const NARROW = 88;
const WIDE = 160;
// The space a label's background adds to the width of its text.
export const LABEL_PAD = 8;
// The shared person shape: a head of radius 13 centered 14 below the top, over a body that starts 26 below it.
export const HEAD = 26;

// The cap radii drawShape uses for the two cylinders.
export const cylRy = (w: number): number => Math.min(12, Math.max(6, w / 14));
export const queueRx = (h: number): number => Math.min(12, h / 4);

// How far along the segment from (px, py) by (dx, dy) it first meets the rectangle; Infinity when it misses.
function hitRect(x0: number, y0: number, x1: number, y1: number, px: number, py: number, dx: number, dy: number): number {
  let enter = 0;
  let leave = 1;
  if (dx === 0) {
    if (px < x0 || px > x1) return Infinity;
  } else {
    const a = (x0 - px) / dx;
    const b = (x1 - px) / dx;
    enter = Math.max(enter, Math.min(a, b));
    leave = Math.min(leave, Math.max(a, b));
  }
  if (dy === 0) {
    if (py < y0 || py > y1) return Infinity;
  } else {
    const a = (y0 - py) / dy;
    const b = (y1 - py) / dy;
    enter = Math.max(enter, Math.min(a, b));
    leave = Math.min(leave, Math.max(a, b));
  }
  return enter <= leave ? enter : Infinity;
}

function hitEllipse(cx: number, cy: number, rx: number, ry: number, px: number, py: number, dx: number, dy: number): number {
  const ux = dx / rx;
  const uy = dy / ry;
  const vx = (px - cx) / rx;
  const vy = (py - cy) / ry;
  const a = ux * ux + uy * uy;
  const b = 2 * (ux * vx + uy * vy);
  const c = vx * vx + vy * vy - 1;
  const disc = b * b - 4 * a * c;
  if (a === 0 || disc < 0) return Infinity;
  const t = (-b - Math.sqrt(disc)) / (2 * a);
  return t >= 0 && t <= 1 ? t : c <= 0 ? 0 : Infinity;
}

// Where a segment from outside first meets the outline of a shape, as a fraction of the segment.
function hit(box: Box, px: number, py: number, qx: number, qy: number): number {
  const { x, y, w, h } = box;
  const dx = qx - px;
  const dy = qy - py;
  if (box.form === 'person') {
    return Math.min(hitRect(x, y + HEAD, x + w, y + h, px, py, dx, dy), hitEllipse(x + w / 2, y + 14, 13, 13, px, py, dx, dy));
  }
  if (box.form === 'cyl') {
    const ry = cylRy(w);
    return Math.min(
      hitRect(x, y + ry, x + w, y + h - ry, px, py, dx, dy),
      hitEllipse(x + w / 2, y + ry, w / 2, ry, px, py, dx, dy),
      hitEllipse(x + w / 2, y + h - ry, w / 2, ry, px, py, dx, dy)
    );
  }
  if (box.form === 'h-cyl') {
    const rx = queueRx(h);
    return Math.min(
      hitRect(x + rx, y, x + w - rx, y + h, px, py, dx, dy),
      hitEllipse(x + rx, y + h / 2, rx, h / 2, px, py, dx, dy),
      hitEllipse(x + w - rx, y + h / 2, rx, h / 2, px, py, dx, dy)
    );
  }
  return hitRect(x, y, x + w, y + h, px, py, dx, dy);
}

export function crosses(points: number[], x0: number, y0: number, x1: number, y1: number): boolean {
  for (let i = 2; i < points.length; i += 2) {
    const px = points[i - 2];
    const py = points[i - 1];
    if (hitRect(x0, y0, x1, y1, px, py, points[i] - px, points[i + 1] - py) <= 1) return true;
  }
  return false;
}

function contains(outer: Box, inner: Box): boolean {
  return (
    outer.x <= inner.x &&
    outer.y <= inner.y &&
    outer.x + outer.w >= inner.x + inner.w &&
    outer.y + outer.h >= inner.y + inner.h
  );
}

// The straight line from a to b: x, y of its start, then of its end.
function connect(a: Box, b: Box, shift: number): [number, number, number, number] {
  const ax = a.x + a.w / 2;
  const ay = a.y + a.h / 2;
  const bx = b.x + b.w / 2;
  const by = b.y + b.h / 2;
  const down = contains(a, b);
  if (down || contains(b, a)) {
    // One holds the other: a short line from the nearest side of the outer box.
    const outer = down ? a : b;
    const inner = down ? b : a;
    const ix = inner.x + inner.w / 2;
    const iy = inner.y + inner.h / 2;
    const left = inner.x - outer.x;
    const right = outer.x + outer.w - inner.x - inner.w;
    const top = inner.y - outer.y;
    const bottom = outer.y + outer.h - inner.y - inner.h;
    const least = Math.min(left, right, top, bottom);
    const ox = least === left ? outer.x : least === right ? outer.x + outer.w : ix;
    const oy = least === left || least === right ? iy : least === bottom ? outer.y + outer.h : outer.y;
    const t = Math.min(hit(inner, ox, oy, ix, iy), 1);
    const mx = ox + (ix - ox) * t;
    const my = oy + (iy - oy) * t;
    return down ? [ox, oy, mx, my] : [mx, my, ox, oy];
  }

  let px = ax;
  let py = ay;
  let qx = bx;
  let qy = by;
  // Shapes that share a column or a row are joined by an upright or level line through the shared span.
  const x0 = Math.max(a.x, b.x);
  const x1 = Math.min(a.x + a.w, b.x + b.w);
  const y0 = Math.max(a.y, b.y);
  const y1 = Math.min(a.y + a.h, b.y + b.h);
  if (x0 < x1) px = qx = (x0 + x1) / 2;
  else if (y0 < y1) py = qy = (y0 + y1) / 2;
  const len = Math.hypot(qx - px, qy - py) || 1;
  const nx = (-(qy - py) / len) * shift;
  const ny = ((qx - px) / len) * shift;
  let ta = hit(a, qx + nx, qy + ny, px + nx, py + ny);
  let tb = hit(b, px + nx, py + ny, qx + nx, qy + ny);
  if (ta <= 1 && tb <= 1) {
    px += nx;
    py += ny;
    qx += nx;
    qy += ny;
  } else {
    px = ax;
    py = ay;
    qx = bx;
    qy = by;
    ta = Math.min(hit(a, qx, qy, px, py), 1);
    tb = Math.min(hit(b, px, py, qx, qy), 1);
  }
  return [qx + (px - qx) * ta, qy + (py - qy) * ta, px + (qx - px) * tb, py + (qy - py) * tb];
}

// Parallel stretches closer than this read as one line, and a line this close to a boundary's frame
// reads as part of it.
const NEAR = 6;
const FRAME_NEAR = 3;
const PORT_STEP = 12;

// What the routes drawn so far take up, so that the next keeps apart from them: upright stretches
// as x, top, bottom; level ones as y, left, right; and where lines leave or reach each side of a shape.
export class Lanes {
  private readonly upright: number[] = [];
  private readonly level: number[] = [];
  private readonly frames: number[][] = [[], []];
  private readonly taken = new Map<Box, number[]>();
  // Routes that found no lane of their own: a line left straight behind a shape, or a lane that
  // runs along another.
  squeezed = 0;

  free(upright: boolean, at: number, a0: number, a1: number): boolean {
    const lo = Math.min(a0, a1);
    const hi = Math.max(a0, a1);
    const near = (list: number[], gap: number): boolean => {
      for (let i = 0; i < list.length; i += 3) if (Math.abs(list[i] - at) < gap && list[i + 1] < hi && list[i + 2] > lo) return true;
      return false;
    };
    return !near(upright ? this.upright : this.level, NEAR) && !near(this.frames[upright ? 0 : 1], FRAME_NEAR);
  }

  crossings(points: number[]): number {
    let count = 0;
    for (let i = 2; i < points.length; i += 2) {
      const upright = points[i] === points[i - 2];
      const at = upright ? points[i] : points[i + 1];
      const lo = Math.min(upright ? points[i - 1] : points[i - 2], upright ? points[i + 1] : points[i]);
      const hi = Math.max(upright ? points[i - 1] : points[i - 2], upright ? points[i + 1] : points[i]);
      const list = upright ? this.level : this.upright;
      for (let j = 0; j < list.length; j += 3) {
        if (list[j] > lo && list[j] < hi && list[j + 1] < at && list[j + 2] > at) count++;
      }
    }
    return count;
  }

  frame(box: Box): void {
    this.frames[0].push(box.x, box.y, box.y + box.h, box.x + box.w, box.y, box.y + box.h);
    this.frames[1].push(box.y, box.x, box.x + box.w, box.y + box.h, box.x, box.x + box.w);
  }

  take(points: number[]): void {
    for (let i = 2; i < points.length; i += 2) {
      if (points[i] === points[i - 2]) this.upright.push(points[i], Math.min(points[i - 1], points[i + 1]), Math.max(points[i - 1], points[i + 1]));
      else if (points[i + 1] === points[i - 1]) this.level.push(points[i + 1], Math.min(points[i - 2], points[i]), Math.max(points[i - 2], points[i]));
    }
  }

  // Where on one side of a shape (0 left, 1 right, 2 top, 3 bottom) a line can leave or arrive,
  // between lo and hi: the places clear of the lines already there, nearest `want` first.
  ports(box: Box, side: number, want: number, lo: number, hi: number): number[] {
    const used = this.taken.get(box) ?? [];
    const out: number[] = [];
    for (let k = 0; k < 9 && out.length < 4; k++) {
      const at = want + (k & 1 ? 1 : -1) * Math.ceil(k / 2) * PORT_STEP;
      if (at < lo || at > hi) continue;
      let clear = true;
      for (let i = 0; i < used.length; i += 2) if (used[i] === side && Math.abs(used[i + 1] - at) < PORT_STEP) clear = false;
      if (clear) out.push(at);
    }
    return out.length ? out : [want];
  }

  claim(box: Box, side: number, at: number): void {
    const used = this.taken.get(box);
    if (used) used.push(side, at);
    else this.taken.set(box, [side, at]);
  }
}

function path(points: number[], startTrim: number, endTrim: number): string {
  const n = points.length;
  const ux = Math.sign(points[2] - points[0]);
  const uy = Math.sign(points[3] - points[1]);
  let d = `M${num(points[0] + ux * startTrim)},${num(points[1] + uy * startTrim)}`;
  for (let i = 2; i < n - 2; i += 2) {
    const x = points[i];
    const y = points[i + 1];
    const ix = Math.sign(x - points[i - 2]);
    const iy = Math.sign(y - points[i - 1]);
    const ox = Math.sign(points[i + 2] - x);
    const oy = Math.sign(points[i + 3] - y);
    const r = Math.min(
      CORNER,
      Math.abs(x - points[i - 2] + y - points[i - 1]) / 2,
      Math.abs(points[i + 2] - x + points[i + 3] - y) / 2
    );
    d += `${ix ? 'H' + num(x - ix * r) : 'V' + num(y - iy * r)}Q${num(x)},${num(y)} ${num(x + ox * r)},${num(y + oy * r)}`;
  }
  const lx = Math.sign(points[n - 2] - points[n - 4]);
  const ly = Math.sign(points[n - 1] - points[n - 3]);
  return d + (lx ? 'H' + num(points[n - 2] - lx * endTrim) : 'V' + num(points[n - 1] - ly * endTrim));
}

function clearOf(points: number[], others: Box[], a: Box, b: Box): boolean {
  for (const other of others) {
    if (other !== a && other !== b && crosses(points, other.x, other.y, other.x + other.w, other.y + other.h)) return false;
  }
  return true;
}

// The route for a line with corners through `points`, from a's outline to b's. `along` is the
// stretch its label sits on.
function bent(points: number[], along: number, startTrim: number, endTrim: number, label: Partial<Route>): Route {
  const n = points.length;
  return {
    d: path(points, startTrim, endTrim),
    sx: points[0],
    sy: points[1],
    sdx: -Math.sign(points[2] - points[0]),
    sdy: -Math.sign(points[3] - points[1]),
    ex: points[n - 2],
    ey: points[n - 1],
    edx: Math.sign(points[n - 2] - points[n - 4]),
    edy: Math.sign(points[n - 1] - points[n - 3]),
    x0: points[along],
    y0: points[along + 1],
    x1: points[along + 2],
    y1: points[along + 3],
    nx: 0,
    ny: 0,
    lean: 0,
    room: WIDE,
    ...label,
    points,
  };
}

function across(lo: number, hi: number): number[] {
  const out: number[] = [];
  const mid = (lo + hi) / 2;
  const step = Math.max(LANE_STEP, (hi - lo) / 4);
  for (let k = 0; k < 9; k++) {
    const at = mid + (k & 1 ? 1 : -1) * Math.ceil(k / 2) * step;
    if (at >= lo + NEAR && at <= hi - NEAR) out.push(at);
  }
  return out;
}

function elbow(a: Box, b: Box, others: Box[], lanes: Lanes, startTrim: number, endTrim: number): Route | undefined {
  const ax = a.x + a.w / 2;
  const ay = a.y + a.h / 2;
  const bx = b.x + b.w / 2;
  const by = b.y + b.h / 2;
  let best: { points: number[]; cost: number; upright: boolean; sides: [number, number] } | undefined;
  const consider = (points: number[], upright: boolean, sides: [number, number]): void => {
    if (!clearOf(points, others, a, b)) return;
    for (let i = 2; i < points.length; i += 2) {
      const up = points[i] === points[i - 2];
      if (!lanes.free(up, up ? points[i] : points[i + 1], up ? points[i - 1] : points[i - 2], up ? points[i + 1] : points[i])) return;
    }
    let cost = lanes.crossings(points) * 1e6;
    for (let i = 2; i < points.length; i += 2) cost += Math.abs(points[i] - points[i - 2]) + Math.abs(points[i + 1] - points[i - 1]);
    if (!best || cost < best.cost) best = { points, cost, upright, sides };
  };
  if (a.x + a.w <= b.x || b.x + b.w <= a.x) {
    const right = bx > ax;
    const down = Math.sign(by - ay);
    const sides: [number, number] = right ? [1, 0] : [0, 1];
    const lanesAcross = across(right ? a.x + a.w : b.x + b.w, right ? b.x : a.x);
    search: for (const y0 of lanes.ports(a, sides[0], ay + (down * a.h) / 4, a.y + 8, a.y + a.h - 8)) {
      for (const y1 of lanes.ports(b, sides[1], by - (down * b.h) / 4, b.y + 8, b.y + b.h - 8)) {
        for (const lane of lanesAcross) {
          const x0 = lane + (ax - lane) * Math.min(hit(a, lane, y0, ax, y0), 1);
          const x1 = lane + (bx - lane) * Math.min(hit(b, lane, y1, bx, y1), 1);
          const before = best;
          consider([x0, y0, lane, y0, lane, y1, x1, y1], true, sides);
          if (best !== before) break search;
        }
      }
    }
  }
  if (a.y + a.h <= b.y || b.y + b.h <= a.y) {
    const below = by > ay;
    const sideways = Math.sign(bx - ax);
    const sides: [number, number] = below ? [3, 2] : [2, 3];
    const lanesAcross = across(below ? a.y + a.h : b.y + b.h, below ? b.y : a.y);
    search: for (const x0 of lanes.ports(a, sides[0], ax + (sideways * a.w) / 4, a.x + 8, a.x + a.w - 8)) {
      for (const x1 of lanes.ports(b, sides[1], bx - (sideways * b.w) / 4, b.x + 8, b.x + b.w - 8)) {
        for (const lane of lanesAcross) {
          const y0 = lane + (ay - lane) * Math.min(hit(a, x0, lane, x0, ay), 1);
          const y1 = lane + (by - lane) * Math.min(hit(b, x1, lane, x1, by), 1);
          const before = best;
          consider([x0, y0, x0, lane, x1, lane, x1, y1], false, sides);
          if (best !== before) break search;
        }
      }
    }
  }
  if (!best) return undefined;
  const { points, upright, sides } = best;
  lanes.take(points);
  lanes.claim(a, sides[0], upright ? points[1] : points[0]);
  lanes.claim(b, sides[1], upright ? points[7] : points[6]);
  // The label sits on the middle stretch, across the gap.
  return bent(points, 2, startTrim, endTrim, { room: upright ? NARROW : WIDE });
}

// Routes a relation from a to b. `shift` moves the line sideways when another runs the opposite way.
// `others` are the shapes to steer clear of; undefined skips that check. `lanes` holds what the
// routes before it take up, so that this one keeps apart from them.
export function route(
  a: Box,
  b: Box,
  shift: number,
  others: Box[] | undefined,
  lanes: Lanes,
  startTrim: number,
  endTrim: number
): Route {
  if (a === b) {
    const spread = Math.min(a.h / 2 - 4, 10);
    const len = Math.hypot(LOOP, spread);
    const x = a.x + a.w;
    const cy = a.y + a.h / 2;
    const ux = LOOP / len;
    const uy = spread / len;
    return {
      d:
        `M${num(x + ux * startTrim)},${num(cy - spread - uy * startTrim)}C${num(x + LOOP)},${num(cy - spread * 2)} ` +
        `${num(x + LOOP)},${num(cy + spread * 2)} ${num(x + ux * endTrim)},${num(cy + spread + uy * endTrim)}`,
      sx: x,
      sy: cy - spread,
      sdx: -ux,
      sdy: uy,
      ex: x,
      ey: cy + spread,
      edx: -ux,
      edy: -uy,
      x0: x + LOOP + 4,
      y0: cy,
      x1: x + LOOP + 4,
      y1: cy,
      nx: 1,
      ny: 0,
      lean: 0,
      room: 64,
      points: [],
    };
  }

  const [sx, sy, ex, ey] = connect(a, b, shift);
  const upright = sx === ex;
  let blocked = false;
  if (others && !contains(a, b) && !contains(b, a)) {
    for (const other of others) {
      if (other !== a && other !== b && hitRect(other.x, other.y, other.x + other.w, other.y + other.h, sx, sy, ex - sx, ey - sy) <= 1) blocked = true;
    }
  }
  if (others && blocked && !upright && sy !== ey) {
    const around = elbow(a, b, others, lanes, startTrim, endTrim);
    if (around) return around;
    lanes.squeezed++;
  }
  if (others && blocked && (upright || sy === ey)) {
    const laneOn = (forward: boolean): number => {
      let lane = forward ? -Infinity : Infinity;
      const widen = (box: Box): void => {
        const edge = upright ? box.x : box.y;
        lane = forward ? Math.max(lane, edge + (upright ? box.w : box.h)) : Math.min(lane, edge);
      };
      widen(a);
      widen(b);
      for (const other of others) {
        if (other !== a && other !== b && hitRect(other.x, other.y, other.x + other.w, other.y + other.h, sx, sy, ex - sx, ey - sy) <= 1) widen(other);
      }
      return lane;
    };
    const lo = upright ? Math.min(a.y, b.y) : Math.min(a.x, b.x);
    const hi = upright ? Math.max(a.y + a.h, b.y + b.h) : Math.max(a.x + a.w, b.x + b.w);
    const outside = (forward: boolean, lane: number): boolean => {
      for (const other of others) {
        if (other === a || other === b) continue;
        const near = upright ? other.y < hi && other.y + other.h > lo : other.x < hi && other.x + other.w > lo;
        const start = upright ? other.x : other.y;
        const end = start + (upright ? other.w : other.h);
        if (near && (forward ? end > lane : start < lane)) return false;
      }
      return true;
    };
    const ax = a.x + a.w / 2;
    const ay = a.y + a.h / 2;
    const bx = b.x + b.w / 2;
    const by = b.y + b.h / 2;
    const towards = upright ? Math.sign(by - ay) : Math.sign(bx - ax);
    // The route on one side: each end leaves its shape a quarter of the way from the middle towards
    // the other, clear of the straight lines that meet the middle of that side and of other routes
    // there. The lane runs a little further out for each route already along that gap, and never
    // behind a shape. `step` is how many lanes out it went; 5 when none was free.
    const along = (forward: boolean): { points: number[]; side: number; p0: number; p1: number; step: number } => {
      const lane = laneOn(forward);
      const sign = forward ? 1 : -1;
      const side = upright ? (forward ? 1 : 0) : forward ? 3 : 2;
      const p0 = upright
        ? lanes.ports(a, side, ay + (towards * a.h) / 4, a.y + 8, a.y + a.h - 8)[0]
        : lanes.ports(a, side, ax + (towards * a.w) / 4, a.x + 8, a.x + a.w - 8)[0];
      const p1 = upright
        ? lanes.ports(b, side, by - (towards * b.h) / 4, b.y + 8, b.y + b.h - 8)[0]
        : lanes.ports(b, side, bx - (towards * b.w) / 4, b.x + 8, b.x + b.w - 8)[0];
      const pointsAt = (at: number): number[] => {
        if (upright) {
          const x0 = at + (ax - at) * Math.min(hit(a, at, p0, ax, p0), 1);
          const x1 = at + (bx - at) * Math.min(hit(b, at, p1, bx, p1), 1);
          return [x0, p0, at, p0, at, p1, x1, p1];
        }
        const y0 = at + (ay - at) * Math.min(hit(a, p0, at, p0, ay), 1);
        const y1 = at + (by - at) * Math.min(hit(b, p1, at, p1, by), 1);
        return [p0, y0, p0, at, p1, at, p1, y1];
      };
      let points = pointsAt(lane + sign * LANE);
      for (let k = 0; k <= 4; k++) {
        const at = lane + sign * (LANE + k * LANE_STEP);
        const tried = pointsAt(at);
        if (!clearOf(tried, others, a, b)) continue;
        points = tried;
        if (lanes.free(upright, at, p0, p1)) return { points, side, p0, p1, step: k };
      }
      return { points, side, p0, p1, step: 5 };
    };
    // A detour takes the outside of the drawing when only one side is outside, leaving the gaps
    // between columns and rows to the relations that cross them. Otherwise it takes the side where
    // it crosses fewer lines, then the one where it runs nearer its shapes, so that detours spread
    // over both sides.
    const natural = upright ? ey > sy : ex < sx;
    const out = outside(natural, laneOn(natural));
    const back = outside(!natural, laneOn(!natural));
    const first = along(natural);
    const other = out === back ? along(!natural) : undefined;
    const cost = (way: { points: number[]; step: number }): number => lanes.crossings(way.points) * 8 + way.step;
    const forward = back && !out ? !natural : other && cost(other) < cost(first) ? !natural : natural;
    const { points, side, p0, p1, step } = forward === natural ? first : (other ?? along(!natural));
    const sign = forward ? 1 : -1;
    if (step > 4) lanes.squeezed++;
    lanes.take(points);
    lanes.claim(a, side, p0);
    lanes.claim(b, side, p1);
    return bent(points, 2, startTrim, endTrim, upright ? { nx: sign, lean: LEAN, room: NARROW } : { room: WIDE });
  }

  const len = Math.hypot(ex - sx, ey - sy) || 1;
  const dx = (ex - sx) / len;
  const dy = (ey - sy) / len;
  if (upright || sy === ey) lanes.take([sx, sy, ex, ey]);
  return {
    d: `M${num(sx + dx * startTrim)},${num(sy + dy * startTrim)}L${num(ex - dx * endTrim)},${num(ey - dy * endTrim)}`,
    sx,
    sy,
    sdx: -dx,
    sdy: -dy,
    ex,
    ey,
    edx: dx,
    edy: dy,
    x0: sx,
    y0: sy,
    x1: ex,
    y1: ey,
    nx: shift ? -dy : 0,
    ny: shift ? dx : 0,
    lean: 0,
    room: Math.abs(dx) > Math.abs(dy) ? NARROW : WIDE,
    points: [sx, sy, ex, ey],
  };
}
