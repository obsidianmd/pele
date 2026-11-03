import type { CEdge, CNode, CompoundResult, Dir } from './compound.js';
import { ledge, lnode, orient, rank, type LEdge, type LNode, type LayeredOptions } from './layered.js';

// Layout for swimlanes. Every top-level group is a lane: a band that runs the length of the
// diagram along the flow. Ranks are shared by all lanes, so a step sits level with the steps
// that happen at the same time in other lanes, and each node stays inside its own lane.

const LANE_HEAD = 34;
const LANE_PAD = 24;
const SWEEPS = 8;
const MAX_DUMMIES = 20000;
const MAX_HOPS = 10000;
const ROUTE_BUDGET = 2000000;
// Parallel lines closer than this are drawn as one.
const NEAR = 4;
const ROUNDS = 3;
const RELAY = 8;
const TURN = 20;
// The room a lane keeps beside a handoff along its margin, and how much of it is between the
// handoff and the lane's items.
const MARGIN = 20;
const LEG = 14;
const CLOSE = 3;

export function laneLayout(nodes: CNode[], edges: CEdge[], dir: Dir, opt: LayeredOptions, lanePad = LANE_PAD): CompoundResult {
  const n = nodes.length;
  if (n === 0) return { width: 0, height: 0 };
  const sideways = dir === 'LR' || dir === 'RL';
  const flipped = dir === 'BT' || dir === 'RL';

  // Lanes in the order they were written. The graph lists groups last-declared first.
  const lanes: number[] = [];
  for (let i = n - 1; i >= 0; i--) if (nodes[i].parent < 0 && nodes[i].isGroup) lanes.push(i);
  const laneCount = Math.max(1, lanes.length);
  const laneSlot = new Int32Array(n).fill(-1);
  lanes.forEach((id, k) => (laneSlot[id] = k));
  const hasChild = new Uint8Array(n);
  for (let i = 0; i < n; i++) if (nodes[i].parent >= 0) hasChild[nodes[i].parent] = 1;
  // Room a lane keeps around its items, so that the groups drawn around them stay inside it.
  const lanePads = new Float64Array(laneCount).fill(lanePad);
  let endPad = lanePad;
  const laneOf = (i: number): number => {
    let t = i;
    let room = lanePad;
    for (let hops = 0; nodes[t].parent >= 0 && hops < MAX_HOPS; hops++) {
      t = nodes[t].parent;
      if (laneSlot[t] < 0) room += Math.max(nodes[t].padX, nodes[t].padTop, nodes[t].padBottom);
    }
    const lane = Math.max(0, laneSlot[t]);
    if (room > lanePads[lane]) lanePads[lane] = room;
    if (room > endPad) endPad = room;
    return lane;
  };

  // What gets ranked and placed: nodes, and groups that are empty and so act as nodes.
  const itemOf = new Int32Array(n).fill(-1);
  const real: number[] = [];
  for (let i = 0; i < n; i++) {
    if (laneSlot[i] >= 0) continue;
    if (!nodes[i].isGroup || !hasChild[i]) {
      itemOf[i] = real.length;
      real.push(i);
    }
  }
  const along = (c: CNode): number => (sideways ? c.w : c.h);
  // Lanes keep a node's room past its far side on both sides of it, so that it stays centered.
  const cross = (c: CNode): number => (sideways ? c.h : c.w) + 2 * c.after;

  const lnodes: LNode[] = real.map((i) => lnode(cross(nodes[i]), along(nodes[i])));
  const ledges: LEdge[] = [];
  const edgeOf: number[] = [];
  let step = 1;
  {
    const seen = new Set<number>();
    for (let ei = 0; ei < edges.length; ei++) {
      const e = edges[ei];
      const a = itemOf[e.src];
      const b = itemOf[e.dst];
      if (a < 0 || b < 0 || a === b) continue;
      const key = Math.min(a, b) * real.length + Math.max(a, b);
      if (e.labelW > 0 || seen.has(key)) step = 2;
      seen.add(key);
      ledges.push(ledge(a, b, e.minlen, sideways ? e.labelH : e.labelW, sideways ? e.labelW : e.labelH));
      edgeOf.push(ei);
    }
  }
  orient(lnodes, ledges);
  rank(lnodes, ledges, step);

  const m = ledges.length;
  const itemLane = Int32Array.from(real, laneOf);
  // Lays the ranked items out and routes the relations. A plain relation is a handoff that takes
  // a simple route of its own, and so keeps no room through the ranks it passes.
  const place = (plain: Uint8Array, margins: Uint8Array): { width: number; height: number; routed: Uint8Array; margins: Uint8Array; work: number } => {
    const pad = lanePads.map((room, lane) => (margins[lane] ? Math.max(room, MARGIN) : room));
    const used = new Uint8Array(laneCount);
    // Items: the real ones, then a dummy for every rank an edge passes through.
    let dummies = 0;
    const span = new Int32Array(m);
    for (let k = 0; k < m; k++) {
      span[k] = Math.abs(lnodes[ledges[k].head].rank - lnodes[ledges[k].tail].rank);
      if (!plain[k]) dummies += span[k] - 1;
    }
    const direct = dummies > MAX_DUMMIES;
    const total = real.length + (direct ? 0 : dummies);
    const RANK = new Int32Array(total);
    const LANE = new Int32Array(total);
    const SIZE = new Float64Array(total);
    const DEPTH = new Float64Array(total);
    const DUMMY = new Uint8Array(total);
    let maxRank = 0;
    for (let k = 0; k < real.length; k++) {
      RANK[k] = lnodes[k].rank;
      LANE[k] = itemLane[k];
      SIZE[k] = lnodes[k].w;
      DEPTH[k] = lnodes[k].h;
      if (RANK[k] > maxRank) maxRank = RANK[k];
    }
    const firstDummy = new Int32Array(m).fill(-1);
    const labelItem = new Int32Array(m).fill(-1);
    const links: number[] = [];
    {
      let next = real.length;
      for (let k = 0; k < m; k++) {
        const e = ledges[k];
        const a = e.reversed ? e.head : e.tail;
        const b = e.reversed ? e.tail : e.head;
        if (direct || span[k] < 2 || plain[k]) {
          links.push(a, b);
          continue;
        }
        const ra = RANK[a];
        const rb = RANK[b];
        let labelRank = -1;
        if (e.labelW > 0) {
          labelRank = ra + ((rb - ra) >> 1);
          if (step === 2 && (labelRank & 1) === 0) labelRank--;
        }
        firstDummy[k] = next;
        let prev = a;
        for (let r = ra + 1; r < rb; r++) {
          const d = next++;
          RANK[d] = r;
          // The edge crosses from its first lane to its last one evenly along the way.
          LANE[d] = LANE[a] + Math.round(((LANE[b] - LANE[a]) * (r - ra)) / (rb - ra));
          DUMMY[d] = 1;
          if (r === labelRank) {
            SIZE[d] = e.labelW;
            DEPTH[d] = e.labelH;
            labelItem[k] = d;
          }
          links.push(prev, d);
          prev = d;
        }
        links.push(prev, b);
      }
    }

    const upStart = new Int32Array(total + 1);
    const downStart = new Int32Array(total + 1);
    for (let k = 0; k < links.length; k += 2) {
      downStart[links[k] + 1]++;
      upStart[links[k + 1] + 1]++;
    }
    for (let i = 0; i < total; i++) {
      upStart[i + 1] += upStart[i];
      downStart[i + 1] += downStart[i];
    }
    const up = new Int32Array(links.length / 2);
    const down = new Int32Array(links.length / 2);
    {
      const uf = upStart.slice(0, total);
      const df = downStart.slice(0, total);
      for (let k = 0; k < links.length; k += 2) {
        down[df[links[k]]++] = links[k + 1];
        up[uf[links[k + 1]]++] = links[k];
      }
    }

    // Order within each rank: by lane first, then by where the item's neighbours sit.
    const rows: number[][] = [];
    for (let r = 0; r <= maxRank; r++) rows.push([]);
    for (let i = 0; i < total; i++) rows[RANK[i]].push(i);
    const pos = new Float64Array(total);
    const key = new Float64Array(total);
    const settle = (row: number[]): void => {
      row.sort((a, b) => LANE[a] - LANE[b] || key[a] - key[b] || a - b);
      for (let k = 0; k < row.length; k++) pos[row[k]] = k;
    };
    for (const row of rows) {
      for (let k = 0; k < row.length; k++) key[row[k]] = k;
      settle(row);
    }
    for (let sweep = 0; sweep < SWEEPS && maxRank > 0; sweep++) {
      const downward = (sweep & 1) === 0;
      for (let s = 1; s <= maxRank; s++) {
        const row = rows[downward ? s : maxRank - s];
        const start = downward ? upStart : downStart;
        const list = downward ? up : down;
        for (const i of row) {
          let sum = 0;
          const count = start[i + 1] - start[i];
          for (let k = start[i]; k < start[i + 1]; k++) sum += pos[list[k]];
          key[i] = count > 0 ? sum / count : pos[i];
        }
        settle(row);
      }
    }

    // The items of one rank that share a lane sit side by side as a run.
    const gap = (a: number, b: number): number => (DUMMY[a] || DUMMY[b] ? opt.edgeSep : opt.nodeSep);
    const eachRun = (row: number[], visit: (row: number[], from: number, to: number) => void): void => {
      let from = 0;
      while (from < row.length) {
        let to = from;
        while (to + 1 < row.length && LANE[row[to + 1]] === LANE[row[from]]) to++;
        visit(row, from, to);
        from = to + 1;
      }
    };
    const runSize = (row: number[], from: number, to: number): number => {
      let size = SIZE[row[from]];
      for (let k = from; k < to; k++) size += gap(row[k], row[k + 1]) + SIZE[row[k + 1]];
      return size;
    };

    // Lane breadth: enough for its fullest rank, and for its title.
    const breadth = new Float64Array(laneCount);
    let head = lanes.length > 0 ? LANE_HEAD : 0;
    for (let k = 0; k < lanes.length; k++) {
      const lane = nodes[lanes[k]];
      breadth[k] = Math.max(0, lane.minW - 2 * pad[k]);
      if (lane.padTop > head) head = lane.padTop;
    }
    for (const row of rows) {
      eachRun(row, (_, from, to) => {
        const size = runSize(row, from, to);
        if (size > breadth[LANE[row[from]]]) breadth[LANE[row[from]]] = size;
      });
    }
    const laneStart = new Float64Array(laneCount + 1);
    for (let k = 0; k < laneCount; k++) laneStart[k + 1] = laneStart[k] + breadth[k] + 2 * pad[k];

    // Across the flow: each lane's items start centered, then line up with their neighbours in
    // the same lane as far as the lane and the items beside them allow.
    const C = new Float64Array(total);
    const want = new Float64Array(total);
    const center = (row: number[], from: number, to: number): void => {
      const lane = LANE[row[from]];
      let at = (laneStart[lane] + pad[lane] + (laneStart[lane + 1] - pad[lane]) - runSize(row, from, to)) / 2;
      for (let k = from; k <= to; k++) {
        C[row[k]] = at + SIZE[row[k]] / 2;
        if (k < to) at += SIZE[row[k]] + gap(row[k], row[k + 1]);
      }
    };
    const align = (row: number[], from: number, to: number): void => {
      const lane = LANE[row[from]];
      let floor = laneStart[lane] + pad[lane];
      for (let k = from; k <= to; k++) {
        const i = row[k];
        C[i] = Math.max(want[i], floor + SIZE[i] / 2);
        if (k < to) floor = C[i] + SIZE[i] / 2 + gap(i, row[k + 1]);
      }
      let ceil = laneStart[lane + 1] - pad[lane];
      for (let k = to; k >= from; k--) {
        const i = row[k];
        C[i] = Math.min(C[i], ceil - SIZE[i] / 2);
        if (k > from) ceil = C[i] - SIZE[i] / 2 - gap(row[k - 1], i);
      }
    };
    for (const row of rows) eachRun(row, center);
    for (let pass = 0; pass < 4 && maxRank > 0; pass++) {
      const downward = (pass & 1) === 0;
      for (let s = 1; s <= maxRank; s++) {
        const row = rows[downward ? s : maxRank - s];
        const start = downward ? upStart : downStart;
        const list = downward ? up : down;
        for (const i of row) {
          let sum = 0;
          let count = 0;
          for (let k = start[i]; k < start[i + 1]; k++) {
            if (LANE[list[k]] !== LANE[i]) continue;
            sum += C[list[k]];
            count++;
          }
          want[i] = count > 0 ? sum / count : C[i];
        }
        eachRun(row, align);
      }
    }

    // Along the flow: one band per rank, after the lane titles.
    const bandStart = new Float64Array(maxRank + 1);
    const bandEnd = new Float64Array(maxRank + 1);
    // The room after a rank is for the relations that turn there or are only as long as they
    // were asked to be. Where just plain handoffs and straight lines pass, the ranks close up,
    // as far as the label of a handoff between them leaves it a line to sit on.
    const sep = new Float64Array(maxRank + 1).fill(opt.rankSep / step);
    if (plain.some((on) => on === 1)) {
      const full = opt.rankSep / step;
      sep.fill(full / CLOSE);
      for (let k = 0; k < m; k++) {
        const e = ledges[k];
        const a = e.reversed ? e.head : e.tail;
        const b = e.reversed ? e.tail : e.head;
        if (plain[k]) {
          if (e.labelH <= 0 || span[k] > step) continue;
          const room = Math.min(full, (e.labelH + 2 * TURN - Math.min(DEPTH[a], DEPTH[b]) / 2) / span[k]);
          for (let r = RANK[a]; r < RANK[b]; r++) if (room > sep[r]) sep[r] = room;
          continue;
        }
        const d0 = firstDummy[k];
        if (d0 < 0 || span[k] <= step * e.minlen) {
          for (let r = RANK[a]; r < RANK[b]; r++) sep[r] = full;
          continue;
        }
        for (let d = d0 - 1; d < d0 + span[k] - 1; d++) {
          const u = d < d0 ? a : d;
          const v = d + 1 < d0 + span[k] - 1 ? d + 1 : b;
          if (LANE[u] !== LANE[v] || Math.abs(C[u] - C[v]) >= 0.5) sep[RANK[u]] = full;
        }
      }
    }
    let at = head + endPad;
    for (let r = 0; r <= maxRank; r++) {
      let depth = 0;
      for (const i of rows[r]) if (DEPTH[i] > depth) depth = DEPTH[i];
      bandStart[r] = at;
      bandEnd[r] = at + depth;
      at += depth + (r === maxRank ? 0 : sep[r]);
    }
    const length = at + endPad;
    const breadthTotal = laneStart[laneCount];
    const flip = (a: number): number => (flipped ? head + length - a : a);
    const px = (c: number, a: number): number => (sideways ? flip(a) : c);
    const py = (c: number, a: number): number => (sideways ? c : flip(a));
    const axis = sideways ? 1 : 0;

    for (let k = 0; k < real.length; k++) {
      const node = nodes[real[k]];
      const a = (bandStart[RANK[k]] + bandEnd[RANK[k]]) / 2;
      node.x = px(C[k], a);
      node.y = py(C[k], a);
    }
    for (let k = 0; k < lanes.length; k++) {
      const lane = nodes[lanes[k]];
      const c = (laneStart[k] + laneStart[k + 1]) / 2;
      const size = laneStart[k + 1] - laneStart[k];
      lane.x = sideways ? length / 2 : c;
      lane.y = sideways ? c : length / 2;
      lane.w = sideways ? length : size;
      lane.h = sideways ? size : length;
      lane.padTop = head;
    }

    // Groups inside a lane are drawn around their members, deepest first.
    const depthOf = new Int32Array(n);
    const inner: number[] = [];
    for (let i = 0; i < n; i++) {
      if (!nodes[i].isGroup || laneSlot[i] >= 0 || itemOf[i] >= 0) continue;
      let d = 0;
      for (let p = nodes[i].parent; p >= 0 && d < MAX_HOPS; p = nodes[p].parent) d++;
      depthOf[i] = d;
      inner.push(i);
    }
    inner.sort((a, b) => depthOf[b] - depthOf[a] || a - b);
    const box = new Float64Array(n * 4);
    for (let i = 0; i < n; i++) {
      box[i * 4] = Infinity;
      box[i * 4 + 1] = Infinity;
      box[i * 4 + 2] = -Infinity;
      box[i * 4 + 3] = -Infinity;
    }
    const grow = (g: number, c: CNode): void => {
      const hw = c.w / 2 + (sideways ? 0 : c.after);
      const hh = c.h / 2 + (sideways ? c.after : 0);
      if (c.x - hw < box[g * 4]) box[g * 4] = c.x - hw;
      if (c.y - hh < box[g * 4 + 1]) box[g * 4 + 1] = c.y - hh;
      if (c.x + hw > box[g * 4 + 2]) box[g * 4 + 2] = c.x + hw;
      if (c.y + hh > box[g * 4 + 3]) box[g * 4 + 3] = c.y + hh;
    };
    for (const i of real) if (nodes[i].parent >= 0 && laneSlot[nodes[i].parent] < 0) grow(nodes[i].parent, nodes[i]);
    for (const g of inner) {
      const c = nodes[g];
      if (box[g * 4] === Infinity) continue;
      const w = Math.max(box[g * 4 + 2] - box[g * 4] + 2 * c.padX, c.minW);
      c.x = (box[g * 4] + box[g * 4 + 2]) / 2;
      c.w = w;
      c.y = (box[g * 4 + 1] - c.padTop + box[g * 4 + 3] + c.padBottom) / 2;
      c.h = box[g * 4 + 3] - box[g * 4 + 1] + c.padTop + c.padBottom;
      if (c.parent >= 0 && laneSlot[c.parent] < 0) grow(c.parent, c);
    }

    for (const e of edges) e.route = [];
    for (let k = 0; k < m; k++) {
      const e = ledges[k];
      const out = edges[edgeOf[k]];
      const a = e.reversed ? e.head : e.tail;
      const b = e.reversed ? e.tail : e.head;
      const pts: number[] = [C[a], bandEnd[RANK[a]] - (bandEnd[RANK[a]] - bandStart[RANK[a]] - DEPTH[a]) / 2];
      const d0 = firstDummy[k];
      if (d0 >= 0) {
        for (let d = d0; d < d0 + span[k] - 1; d++) {
          pts.push(C[d], bandStart[RANK[d]]);
          if (bandEnd[RANK[d]] > bandStart[RANK[d]]) pts.push(C[d], bandEnd[RANK[d]]);
        }
      }
      pts.push(C[b], bandStart[RANK[b]] + (bandEnd[RANK[b]] - bandStart[RANK[b]] - DEPTH[b]) / 2);
      const route: number[] = [];
      for (let p = 0; p < pts.length; p += 2) route.push(px(pts[p], pts[p + 1]), py(pts[p], pts[p + 1]), axis);
      if (e.reversed) {
        for (let i = 0, j = route.length - 3; i < j; i += 3, j -= 3) {
          for (let t = 0; t < 2; t++) {
            const keep = route[i + t];
            route[i + t] = route[j + t];
            route[j + t] = keep;
          }
        }
      }
      out.route = route;
      const label = labelItem[k];
      if (label >= 0) {
        const mid = (bandStart[RANK[label]] + bandEnd[RANK[label]]) / 2;
        out.labelX = px(C[label], mid);
        out.labelY = py(C[label], mid);
      } else {
        out.labelX = (route[0] + route[route.length - 3]) / 2;
        out.labelY = (route[1] + route[route.length - 2]) / 2;
      }
    }

    // An edge that starts or ends at a lane or a group runs straight to its border.
    for (const e of edges) {
      if (e.route.length > 0 || e.src === e.dst) continue;
      const a = nodes[e.src];
      const b = nodes[e.dst];
      const [ax, ay] = border(a, b);
      const [bx, by] = border(b, a);
      const flat = Math.abs(bx - ax) > Math.abs(by - ay) ? 1 : 0;
      e.route = [ax, ay, flat, bx, by, flat];
      e.labelX = (ax + bx) / 2;
      e.labelY = (ay + by) / 2;
    }

    // A handoff can leave towards the other lane, then arrive along the flow (or vice versa).
    // In particular, a decision's return branch must not leave through its incoming side and
    // retrace the path past the preceding step. Try the two single-corner routes, keeping the
    // ranked route when a node or another label blocks them.
    const routed = new Uint8Array(m);
    const routePoints = edges.reduce((count, edge) => count + edge.route.length / 3, 0);
    const work = m * (real.length + edges.length + routePoints);
    if (work <= ROUTE_BUDGET) {
      const amid = (i: number): number => (bandStart[RANK[i]] + bandEnd[RANK[i]]) / 2;
      const labels = edges.map(e => [sideways ? e.labelY : e.labelX, flip(sideways ? e.labelX : e.labelY)]);
      const overlaps = (c0: number, a0: number, c1: number, a1: number, lc: number, la: number, cw: number, ah: number): boolean =>
        c1 > lc - cw / 2 && c0 < lc + cw / 2 && a1 > la - ah / 2 && a0 < la + ah / 2;
      const clear = (c0: number, a0: number, c1: number, a1: number, src: number, dst: number, ei: number): boolean => {
        for (let i = 0; i < real.length; i++) {
          if (i !== src && i !== dst && overlaps(c0, a0, c1, a1, C[i], amid(i), SIZE[i] + 8, DEPTH[i] + 8)) return false;
        }
        for (let i = 0; i < edges.length; i++) {
          const e = edges[i];
          // A step's own loop keeps its label inside the step's box, and has no place here.
          if (i !== ei && e.labelW > 0 && e.src !== e.dst && overlaps(c0, a0, c1, a1, labels[i][0], labels[i][1], sideways ? e.labelH : e.labelW, sideways ? e.labelW : e.labelH)) return false;
        }
        return true;
      };
      // How many other relations have a stretch inside a box. A stretch's whole box counts,
      // including its curve.
      const crossings = (x0: number, y0: number, x1: number, y1: number, ei: number): number => {
        let count = 0;
        for (let i = 0; i < edges.length; i++) {
          if (i === ei) continue;
          const route = edges[i].route;
          for (let j = 3; j < route.length; j += 3) {
            if (Math.max(route[j - 3], route[j]) > x0 && Math.min(route[j - 3], route[j]) < x1 &&
              Math.max(route[j - 2], route[j + 1]) > y0 && Math.min(route[j - 2], route[j + 1]) < y1) { count++; break; }
          }
        }
        return count;
      };
      const meets = (x: number, y: number, ei: number): number => {
        let count = 0;
        for (let i = 0; i < edges.length; i++) {
          const route = edges[i].route;
          if (i === ei || route.length === 0) continue;
          const last = route.length - 3;
          if ((Math.abs(route[0] - x) < 1 && Math.abs(route[1] - y) < 1) || (Math.abs(route[last] - x) < 1 && Math.abs(route[last + 1] - y) < 1)) count++;
        }
        return count;
      };
      // Two relations drawn along one line read as a single path. Those that leave the same step
      // or arrive at the same step may share a trunk; any other pair must not.
      const retraces = (x0: number, y0: number, x1: number, y1: number, ei: number): boolean => {
        const upright = Math.abs(x1 - x0) < 0.5;
        const lo = upright ? Math.min(y0, y1) : Math.min(x0, x1), hi = upright ? Math.max(y0, y1) : Math.max(x0, x1);
        const line = upright ? x0 : y0;
        for (let i = 0; i < edges.length; i++) {
          const other = edges[i];
          if (i === ei || other.src === edges[ei].src || other.dst === edges[ei].dst) continue;
          const route = other.route;
          for (let j = 3; j < route.length; j += 3) {
            const u0 = route[j - 3 + (upright ? 0 : 1)], u1 = route[j + (upright ? 0 : 1)];
            if (Math.abs(u0 - line) >= NEAR || Math.abs(u1 - line) >= NEAR) continue;
            const v0 = route[j - 3 + (upright ? 1 : 0)], v1 = route[j + (upright ? 1 : 0)];
            if (Math.min(hi, Math.max(v0, v1)) - Math.max(lo, Math.min(v0, v1)) > 1) return true;
          }
        }
        return false;
      };
      for (let k = 0; k < m; k++) {
        const e = ledges[k], ei = edgeOf[k], out = edges[ei];
        const a = e.tail, b = e.head;
        if (LANE[a] === LANE[b] || Math.abs(C[b] - C[a]) < 1) continue;
        const ac = C[a], bc = C[b], aa = amid(a), ba = amid(b);
        const dc = Math.sign(bc - ac), da = Math.sign(ba - aa);
        const attempt = (pts: number[], margin: number): boolean => {
          for (let p = 2; p < pts.length; p += 2) {
            if (!clear(Math.min(pts[p - 2], pts[p]) - margin, Math.min(pts[p - 1], pts[p + 1]) - margin,
              Math.max(pts[p - 2], pts[p]) + margin, Math.max(pts[p - 1], pts[p + 1]) + margin, a, b, ei)) return false;
            if (retraces(px(pts[p - 2], pts[p - 1]), py(pts[p - 2], pts[p - 1]), px(pts[p], pts[p + 1]), py(pts[p], pts[p + 1]), ei)) return false;
          }
          let lc = 0, la = 0, longest = -1;
          if (out.labelW > 0) {
            const cw = e.labelW, ah = e.labelH;
            for (let p = 2; p < pts.length; p += 2) {
              const cc = (pts[p - 2] + pts[p]) / 2, ca = (pts[p - 1] + pts[p + 1]) / 2;
              const across = Math.abs(pts[p] - pts[p - 2]), along = Math.abs(pts[p + 1] - pts[p - 1]);
              const run = across + along;
              if (run <= longest || (across > 0 ? across < cw + 8 : along < ah + 8)) continue;
              if (cc - cw / 2 < 0 || cc + cw / 2 > breadthTotal || ca - ah / 2 < 0 || ca + ah / 2 > length) continue;
              // Include the ends here: the label must clear both shapes it connects.
              if (!clear(cc - cw / 2, ca - ah / 2, cc + cw / 2, ca + ah / 2, -1, -1, ei)) continue;
              // A label moved onto a handoff must not cover a return path that keeps its
              // ranked route. A segment's whole box is kept clear, including its curve.
              const lx = px(cc, ca), ly = py(cc, ca);
              if (crossings(lx - out.labelW / 2, ly - out.labelH / 2, lx + out.labelW / 2, ly + out.labelH / 2, ei) > 0) continue;
              lc = cc; la = ca; longest = run;
            }
            if (longest < 0) return false;
          }
          // A point short of each corner and one past it keep the turn close to the corner, so
          // that the line stays under its label and the handoff takes little room.
          const way = [pts[0], pts[1]];
          for (let p = 2; p < pts.length; p += 2) {
            const dx = pts[p] - pts[p - 2], dy = pts[p + 1] - pts[p - 1];
            const run = Math.abs(dx) + Math.abs(dy);
            const first = p > 2 ? TURN : 0, last = p + 2 < pts.length ? TURN : 0;
            if (run > first + last + 1) {
              if (first) way.push(pts[p - 2] + (dx / run) * first, pts[p - 1] + (dy / run) * first);
              if (last) way.push(pts[p] - (dx / run) * last, pts[p + 1] - (dy / run) * last);
            }
            way.push(pts[p], pts[p + 1]);
          }
          out.route = [];
          for (let p = 0; p < way.length; p += 2) {
            const crosswise = p === 0 ? way[0] !== way[2] : way[p] !== way[p - 2];
            out.route.push(px(way[p], way[p + 1]), py(way[p], way[p + 1]), crosswise ? 1 - axis : axis);
          }
          if (out.labelW > 0) {
            out.labelX = px(lc, la); out.labelY = py(lc, la);
            labels[ei] = [lc, la];
          }
          routed[k] = 1;
          return true;
        };
        if (attempt([ac + dc * SIZE[a] / 2, aa, bc, aa, bc, ba - da * DEPTH[b] / 2], 2)) continue;
        if (attempt([ac, aa + da * DEPTH[a] / 2, ac, ba, bc - dc * SIZE[b] / 2, ba], 2)) continue;
        // With both corners blocked, as for a return past the steps between, the handoff goes
        // around: out to the margin of a lane, along it, and back in level with its end. It
        // takes the margin that crosses the fewest other relations and shares the fewest ends
        // with them, then the shortest way.
        if (work > ROUTE_BUDGET / RELAY) continue;
        const around: { pts: number[]; cost: number; lane: number }[] = [];
        for (const lane of LANE[a] < LANE[b] ? [LANE[b], LANE[a]] : [LANE[a], LANE[b]]) {
          // A lane that keeps no margin yet has less room there, and the handoff stays inside it.
          const inset = Math.max(pad[lane] - LEG, Math.min(pad[lane] / 2, MARGIN - LEG));
          for (const ch of [laneStart[lane] + inset, laneStart[lane + 1] - inset]) {
            if (Math.abs(ch - ac) < SIZE[a] / 2 + 4 || Math.abs(ch - bc) < SIZE[b] / 2 + 4) continue;
            const pts = [ac + Math.sign(ch - ac) * SIZE[a] / 2, aa, ch, aa, ch, ba, bc + Math.sign(ch - bc) * SIZE[b] / 2, ba];
            let cost = (meets(px(pts[0], pts[1]), py(pts[0], pts[1]), ei) + meets(px(pts[6], pts[7]), py(pts[6], pts[7]), ei)) * 1e6;
            for (let p = 2; p < pts.length; p += 2) {
              const x0 = px(pts[p - 2], pts[p - 1]), y0 = py(pts[p - 2], pts[p - 1]), x1 = px(pts[p], pts[p + 1]), y1 = py(pts[p], pts[p + 1]);
              cost += crossings(Math.min(x0, x1), Math.min(y0, y1), Math.max(x0, x1), Math.max(y0, y1), ei) * 1e6 + Math.abs(x1 - x0) + Math.abs(y1 - y0);
            }
            around.push({ pts, cost, lane });
          }
        }
        around.sort((p, q) => p.cost - q.cost);
        for (const way of around) {
          if (!attempt(way.pts, 1)) continue;
          used[way.lane] = 1;
          break;
        }
      }
    }

    return { width: sideways ? length : breadthTotal, height: sideways ? breadthTotal : length, routed, margins: used, work };
  };

  let plain: Uint8Array = new Uint8Array(m);
  let margins: Uint8Array = new Uint8Array(laneCount);
  let placed = place(plain, margins);
  // A handoff that was given a simple route needs no room kept for it through the ranks it
  // passes, so the lanes are laid out again without it. A handoff that then loses its route
  // goes back to the ranked one. Routing is most of the work, so a large graph is laid out once.
  for (let round = 0; round < ROUNDS && placed.work <= ROUTE_BUDGET / RELAY; round++) {
    const next = round === 0 ? placed.routed : plain.map((on, k) => on & placed.routed[k]);
    if (next.every((on, k) => on === plain[k]) && placed.margins.every((on, k) => on === margins[k])) break;
    plain = next;
    margins = placed.margins;
    placed = place(plain, margins);
  }
  if (plain.some((on, k) => on && !placed.routed[k])) placed = place(new Uint8Array(m), new Uint8Array(laneCount));
  return { width: placed.width, height: placed.height };
}

// The point where the line from one box's center to another's leaves the first box. When the
// other center is inside the box, the point is on the nearest side instead.
function border(from: CNode, to: CNode): [number, number] {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const hw = Math.max(from.w / 2, 0.5);
  const hh = Math.max(from.h / 2, 0.5);
  if (Math.abs(dx) < hw && Math.abs(dy) < hh) {
    const toSide = hw - Math.abs(dx);
    const toEnd = hh - Math.abs(dy);
    return toSide < toEnd ? [from.x + (dx < 0 ? -hw : hw), to.y] : [to.x, from.y + (dy < 0 ? -hh : hh)];
  }
  const scale = Math.min(dx !== 0 ? hw / Math.abs(dx) : Infinity, dy !== 0 ? hh / Math.abs(dy) : Infinity);
  return [from.x + dx * scale, from.y + dy * scale];
}
