import { describe, expect, it } from 'vitest';
import { Style, cnode, compoundLayout, routeCrossings, type CEdge, type CNode, type Dir } from '../../src/layout/compound.js';
import { random } from '../support/corpus.js';

const OPTIONS = { nodeSep: 40, edgeSep: 16, rankSep: 48, portSep: 20 };
const DIRS: Dir[] = ['TB', 'BT', 'LR', 'RL'];

function edge(src: number, dst: number, labelW = 0, labelH = 0): CEdge {
  return { src, dst, minlen: 1, labelW, labelH, route: [], labelX: 0, labelY: 0 };
}

// Every other graph lets edges spread along the sides of its nodes.
function randomGraph(seed: number): { nodes: CNode[]; edges: CEdge[]; dir: Dir } {
  const rnd = random(seed);
  const int = (n: number): number => Math.floor(rnd() * n);
  const nodes: CNode[] = [];
  const groups: number[] = [];
  const groupCount = int(5);
  for (let g = 0; g < groupCount; g++) {
    const node = cnode(0, 0, groups.length > 0 && rnd() < 0.4 ? groups[int(groups.length)] : -1);
    node.isGroup = true;
    node.padX = 20;
    node.padTop = 40;
    node.padBottom = 20;
    node.minW = 60;
    node.dir = rnd() < 0.3 ? DIRS[int(4)] : undefined;
    node.seq = 1000 + g;
    if (seed % 2 === 0) node.span = Infinity;
    groups.push(nodes.length);
    nodes.push(node);
  }
  const leaves = 3 + int(30);
  for (let i = 0; i < leaves; i++) {
    const parent = groups.length > 0 && rnd() < 0.5 ? groups[int(groups.length)] : -1;
    const node = cnode(30 + int(120), 30 + int(50), parent);
    node.seq = i;
    if (seed % 2 === 0) node.span = Math.min(node.w, node.h) - 24;
    nodes.push(node);
  }
  const edges: CEdge[] = [];
  const count = int(leaves * 2);
  for (let i = 0; i < count; i++) {
    const labelled = rnd() < 0.3;
    edges.push(edge(int(nodes.length), int(nodes.length), labelled ? 20 + int(60) : 0, labelled ? 24 : 0));
  }
  return { nodes, edges, dir: DIRS[int(4)] };
}

function isAncestor(nodes: CNode[], a: number, b: number): boolean {
  for (let p = nodes[b].parent; p >= 0; p = nodes[p].parent) if (p === a) return true;
  return false;
}

function onBorder(node: CNode, x: number, y: number): boolean {
  const dx = Math.abs(x - node.x);
  const dy = Math.abs(y - node.y);
  const inside = dx <= node.w / 2 + 0.5 && dy <= node.h / 2 + 0.5;
  const edgeX = Math.abs(dx - node.w / 2) <= 0.5;
  const edgeY = Math.abs(dy - node.h / 2) <= 0.5;
  return inside && (edgeX || edgeY);
}

describe('compound layout', () => {
  it('keeps random graphs well formed', () => {
    for (let seed = 1; seed <= 300; seed++) {
      const { nodes, edges, dir } = randomGraph(seed);
      const size = compoundLayout(nodes, edges, dir, OPTIONS);
      const where = `seed ${seed}`;

      expect(Number.isFinite(size.width) && Number.isFinite(size.height), where).toBe(true);
      nodes.forEach((node, i) => {
        expect(Number.isFinite(node.x) && Number.isFinite(node.y), `${where} node ${i}`).toBe(true);
        expect(node.x - node.w / 2, `${where} node ${i} left`).toBeGreaterThanOrEqual(-0.5);
        expect(node.y - node.h / 2, `${where} node ${i} top`).toBeGreaterThanOrEqual(-0.5);
        expect(node.x + node.w / 2, `${where} node ${i} right`).toBeLessThanOrEqual(size.width + 0.5);
        expect(node.y + node.h / 2, `${where} node ${i} bottom`).toBeLessThanOrEqual(size.height + 0.5);
        if (node.parent >= 0) {
          const parent = nodes[node.parent];
          expect(Math.abs(node.x - parent.x) + node.w / 2, `${where} node ${i} in parent`).toBeLessThanOrEqual(parent.w / 2 + 0.5);
          expect(Math.abs(node.y - parent.y) + node.h / 2, `${where} node ${i} in parent`).toBeLessThanOrEqual(parent.h / 2 + 0.5);
        }
      });

      for (let a = 0; a < nodes.length; a++) {
        for (let b = a + 1; b < nodes.length; b++) {
          if (nodes[a].parent !== nodes[b].parent) continue;
          const overlapX = (nodes[a].w + nodes[b].w) / 2 - Math.abs(nodes[a].x - nodes[b].x);
          const overlapY = (nodes[a].h + nodes[b].h) / 2 - Math.abs(nodes[a].y - nodes[b].y);
          expect(overlapX > 0.5 && overlapY > 0.5, `${where} nodes ${a} and ${b} overlap`).toBe(false);
        }
      }

      edges.forEach((e, i) => {
        if (e.src === e.dst) return;
        expect(e.route.length % 3, `${where} edge ${i}`).toBe(0);
        expect(e.route.length, `${where} edge ${i} has a route`).toBeGreaterThanOrEqual(6);
        for (const value of e.route) expect(Number.isFinite(value), `${where} edge ${i}`).toBe(true);
        if (isAncestor(nodes, e.src, e.dst) || isAncestor(nodes, e.dst, e.src)) return;
        const last = e.route.length - 3;
        expect(onBorder(nodes[e.src], e.route[0], e.route[1]), `${where} edge ${i} starts on its source`).toBe(true);
        expect(onBorder(nodes[e.dst], e.route[last], e.route[last + 1]), `${where} edge ${i} ends on its target`).toBe(true);
      });
    }
  });

  it('is deterministic', () => {
    for (let seed = 1; seed <= 40; seed++) {
      const first = randomGraph(seed);
      const second = randomGraph(seed);
      compoundLayout(first.nodes, first.edges, first.dir, OPTIONS);
      compoundLayout(second.nodes, second.edges, second.dir, OPTIONS);
      expect(second.nodes.map((n) => [n.x, n.y, n.w, n.h])).toEqual(first.nodes.map((n) => [n.x, n.y, n.w, n.h]));
      expect(second.edges.map((e) => e.route)).toEqual(first.edges.map((e) => e.route));
    }
  });

  it('runs ranks along the requested direction', () => {
    for (const dir of DIRS) {
      const nodes = [cnode(60, 40), cnode(60, 40), cnode(60, 40)];
      nodes.forEach((node, i) => (node.seq = i));
      compoundLayout(nodes, [edge(0, 1), edge(1, 2)], dir, OPTIONS);
      const axis = dir === 'TB' || dir === 'BT' ? 'y' : 'x';
      const sign = dir === 'TB' || dir === 'LR' ? 1 : -1;
      expect(sign * (nodes[1][axis] - nodes[0][axis])).toBeGreaterThan(40);
      expect(sign * (nodes[2][axis] - nodes[1][axis])).toBeGreaterThan(40);
    }
  });

  it('keeps a long edge straight through the ranks it skips', () => {
    const nodes = [cnode(60, 40), cnode(60, 40), cnode(60, 40)];
    nodes.forEach((node, i) => (node.seq = i));
    const edges = [edge(0, 1), edge(1, 2), edge(0, 2)];
    compoundLayout(nodes, edges, 'TB', OPTIONS);
    const route = edges[2].route;
    const xs = new Set<number>();
    for (let i = 3; i < route.length - 3; i += 3) xs.add(Math.round(route[i]));
    expect(xs.size).toBe(1);
  });

  it('runs an edge that skips ranks in line with one of its ends, so that it turns once, at the other', () => {
    // A chain of eight, with edges that skip ranks down it and back up.
    const nodes = Array.from({ length: 8 }, () => cnode(80, 40));
    nodes.forEach((node, i) => {
      node.seq = i;
      node.span = 56;
    });
    const edges = [edge(0, 1), edge(1, 2), edge(2, 3), edge(3, 4), edge(4, 5), edge(5, 6), edge(6, 7), edge(0, 3), edge(0, 7), edge(1, 5), edge(2, 6), edge(6, 1), edge(7, 0)];
    compoundLayout(nodes, edges, 'TB', OPTIONS);
    // How many times the route changes its place across the flow.
    const turns = (route: number[]): number => {
      let count = 0;
      for (let i = 3; i < route.length; i += 3) if (Math.abs(route[i] - route[i - 3]) > 0.01) count++;
      return count;
    };
    for (const e of edges.slice(7)) expect(turns(e.route), `${e.src} to ${e.dst}`).toBe(1);
    // The edge from the second node down and the one back up to it both meet it in line.
    const down = edges[9].route;
    const up = edges[11].route;
    expect(down[3]).toBeCloseTo(down[0], 5);
    expect(up[up.length - 6]).toBeCloseTo(up[up.length - 3], 5);
  });

  it('keeps the edges on one side of a node at its middle unless the node has a span', () => {
    const nodes = [cnode(120, 40), cnode(60, 40), cnode(60, 40), cnode(60, 40)];
    nodes.forEach((node, i) => (node.seq = i));
    const edges = [edge(0, 1), edge(0, 2), edge(0, 3)];
    compoundLayout(nodes, edges, 'TB', OPTIONS);
    for (const e of edges) expect(e.route[0]).toBeCloseTo(nodes[0].x, 5);
  });

  it('spreads the edges on one side of a node in the order of the nodes they lead to', () => {
    for (const dir of DIRS) {
      const nodes = [cnode(120, 120), cnode(60, 60), cnode(60, 60), cnode(60, 60)];
      nodes.forEach((node, i) => (node.seq = i));
      nodes[0].span = 96;
      const edges = [edge(0, 1), edge(0, 2), edge(0, 3)];
      compoundLayout(nodes, edges, dir, OPTIONS);
      const across = dir === 'TB' || dir === 'BT' ? 0 : 1;
      const starts = edges.map((e) => e.route[across] - (across === 0 ? nodes[0].x : nodes[0].y));
      const targets = edges.map((e) => (across === 0 ? nodes[e.dst].x : nodes[e.dst].y));
      const byStart = [0, 1, 2].sort((a, b) => starts[a] - starts[b]);
      const byTarget = [0, 1, 2].sort((a, b) => targets[a] - targets[b]);
      expect(byStart, dir).toEqual(byTarget);
      // None of the three can run straight, so they stay around the middle, a pitch apart.
      expect(starts[byStart[0]], dir).toBeCloseTo(-16, 5);
      expect(starts[byStart[1]], dir).toBeCloseTo(0, 5);
      expect(starts[byStart[2]], dir).toBeCloseTo(16, 5);
      for (const e of edges) expect(onBorder(nodes[0], e.route[0], e.route[1]), dir).toBe(true);
    }
  });

  it('keeps an edge that arrives apart from one that leaves on the same side', () => {
    const nodes = [cnode(60, 40), cnode(60, 40)];
    nodes.forEach((node, i) => {
      node.seq = i;
      node.span = 36;
    });
    const edges = [edge(0, 1), edge(1, 0)];
    compoundLayout(nodes, edges, 'TB', OPTIONS);
    const [down, up] = edges.map((e) => e.route);
    expect(Math.abs(down[down.length - 3] - up[0])).toBeCloseTo(16, 5);
    expect(Math.abs(down[0] - up[up.length - 3])).toBeCloseTo(16, 5);
  });

  it('shares a place among edges that run the same way when there is no room for one each', () => {
    const nodes: CNode[] = [];
    for (let i = 0; i <= 12; i++) nodes.push(cnode(60, 40));
    nodes.forEach((node, i) => {
      node.seq = i;
      node.span = 36;
    });
    const edges: CEdge[] = [];
    for (let i = 0; i < 12; i++) edges.push(edge(i, 12));
    // One edge the other way on the same side, which keeps a place of its own.
    edges.push(edge(12, 0));
    compoundLayout(nodes, edges, 'TB', OPTIONS);
    const into = edges.slice(0, 12).map((e) => e.route[e.route.length - 3]);
    expect(new Set(into.map((x) => Math.round(x * 100))).size).toBeLessThanOrEqual(2);
    const back = edges[12].route;
    expect(back[1]).toBeCloseTo(nodes[12].y - 20, 5);
    for (const x of into) expect(Math.abs(x - back[0])).toBeGreaterThanOrEqual(8);
  });

  it('stands a rank that only sends edges on one line, and hangs a rank that only receives them from one', () => {
    const lay = (span: number): CNode[] => {
      const nodes = [cnode(60, 40), cnode(60, 120), cnode(60, 30), cnode(60, 90)];
      nodes.forEach((node, i) => {
        node.seq = i;
        node.span = span;
      });
      compoundLayout(nodes, [edge(0, 2), edge(1, 2), edge(0, 3), edge(1, 3)], 'TB', OPTIONS);
      return nodes;
    };
    const spread = lay(36);
    expect(spread[0].y + 20).toBeCloseTo(spread[1].y + 60, 5);
    expect(spread[2].y - 15).toBeCloseTo(spread[3].y - 45, 5);
    // Without spreading, as in the diagram types that do not use it yet, each rank is centered.
    const plain = lay(0);
    expect(plain[0].y).toBeCloseTo(plain[1].y, 5);
    expect(plain[2].y).toBeCloseTo(plain[3].y, 5);
  });

  // A node above a row of `children`, with an edge to each. With a `span`, the edges spread along the nodes' sides.
  const fan = (children: number, span = 0): { nodes: CNode[]; edges: CEdge[]; gap: number } => {
    const nodes = [cnode(100, 40)];
    const edges: CEdge[] = [];
    for (let i = 1; i <= children; i++) {
      nodes.push(cnode(100, 40));
      edges.push(edge(0, i));
    }
    nodes.forEach((node, i) => {
      node.seq = i;
      node.span = span;
    });
    compoundLayout(nodes, edges, 'TB', OPTIONS);
    return { nodes, edges, gap: nodes[1].y - nodes[0].y - 40 };
  };

  it('gives the gap between two ranks more room when edges that meet at the middle of their nodes run far across it', () => {
    expect(fan(3).gap).toBeCloseTo(OPTIONS.rankSep, 5);
    // Seven children reach 420 across from the middle, and the gap is an eighth of that.
    expect(fan(7).gap).toBeCloseTo(420 / 8, 5);
    expect(fan(40).gap).toBeCloseTo(3 * OPTIONS.rankSep, 5);
  });

  it('turns edges that run far across side by side at levels of their own, in a gap that grows to hold them', () => {
    // With three children nothing runs far, and each edge is one curve across the usual gap.
    const few = fan(3, 76);
    expect(few.gap).toBeCloseTo(OPTIONS.rankSep, 5);
    for (const e of few.edges) expect(e.route).toHaveLength(6);
    // With seven, the three on each side run down, across and down again.
    const { nodes, edges, gap } = fan(7, 76);
    const level = (e: CEdge): number => {
      expect(e.route).toHaveLength(12);
      expect(e.route[3]).toBeCloseTo(e.route[0], 5);
      expect(e.route[7]).toBeCloseTo(e.route[4], 5);
      expect(e.route[9]).toBeCloseTo(e.route[6], 5);
      return e.route[4];
    };
    // The edge that runs furthest turns first, and each of the others 12 further down.
    expect(level(edges[1]) - level(edges[0])).toBeCloseTo(12, 5);
    expect(level(edges[2]) - level(edges[1])).toBeCloseTo(12, 5);
    for (let i = 0; i < 3; i++) expect(level(edges[6 - i])).toBeCloseTo(level(edges[i]), 5);
    // The one in the middle runs straight down.
    expect(edges[3].route).toHaveLength(6);
    expect(edges[3].route[3]).toBeCloseTo(edges[3].route[0], 5);
    // The levels keep 28 from the ranks above and below.
    expect(level(edges[0]) - nodes[0].y - 20).toBeCloseTo(28, 5);
    expect(gap).toBeCloseTo(2 * 28 + 2 * 12, 5);
  });

  it('draws the edges of a gap as plain curves, in a taller gap, where they cross each other more than they run alongside', () => {
    // Four nodes above four, each with an edge to every one below.
    const nodes = Array.from({ length: 8 }, () => cnode(80, 40));
    nodes.forEach((node, i) => {
      node.seq = i;
      node.span = 56;
    });
    const edges: CEdge[] = [];
    for (let i = 0; i < 4; i++) for (let j = 4; j < 8; j++) edges.push(edge(i, j));
    compoundLayout(nodes, edges, 'TB', OPTIONS);
    // No edge turns onto a level: each runs from one point to the other.
    for (const e of edges) expect(e.route).toHaveLength(6);
    // The gap is half as tall as the widest edge runs across, and no more than three times the usual.
    const widest = Math.max(...edges.map((e) => Math.abs(e.route[0] - e.route[3])));
    expect(widest).toBeGreaterThan(6 * OPTIONS.rankSep);
    expect(nodes[4].y - nodes[0].y - 40).toBeCloseTo(3 * OPTIONS.rankSep, 5);
  });

  it('sets a rank of labels half an arrowhead nearer the tails of its edges, and holds a bend beside them for half their height', () => {
    const lay = (headRoom: number): CEdge[] => {
      const nodes = [cnode(60, 40), cnode(60, 40)];
      nodes.forEach((node, i) => {
        node.seq = i;
        node.span = 36;
      });
      const edges = [edge(0, 1, 40, 20), edge(0, 1, 50, 20), edge(0, 1)];
      compoundLayout(nodes, edges, 'TB', { ...OPTIONS, headRoom });
      return edges;
    };
    // Without arrowheads the labels are midway between the two nodes.
    const plain = lay(0);
    expect(plain[0].labelY).toBeCloseTo((40 + 108) / 2, 5);
    // With them, the labels are midway between the node above and the backs of the arrowheads.
    const [first, second, bare] = lay(8);
    expect(first.labelY).toBeCloseTo((40 + 108 - 8) / 2, 5);
    expect(second.labelY).toBeCloseTo(first.labelY, 5);
    // A labelled edge runs straight for the height of its label, and the bare one for half of that.
    expect(first.route[7] - first.route[4]).toBeCloseTo(20, 5);
    expect(bare.route[7] - bare.route[4]).toBeCloseTo(10, 5);
    expect((bare.route[4] + bare.route[7]) / 2).toBeCloseTo(first.labelY, 5);
  });

  it('turns an edge that runs far across at a level of its own where a shorter one would run close beside it', () => {
    // A node above a row of three, and an edge back up to it from below the row.
    const nodes = [cnode(80, 40), cnode(80, 40), cnode(80, 40), cnode(80, 40), cnode(80, 40)];
    nodes.forEach((node, i) => {
      node.seq = i;
      node.span = 56;
    });
    const edges = [edge(0, 1), edge(0, 2), edge(0, 3), edge(1, 4), edge(2, 4), edge(3, 4), edge(4, 0)];
    compoundLayout(nodes, edges, 'TB', OPTIONS);
    // The edge back up passes the row on one side, then runs across to the top node and up into it.
    const back = edges[6].route;
    const n = back.length;
    const level = back[n - 5];
    expect(back[n - 8]).toBeCloseTo(level, 5);
    expect(back[n - 6]).toBeCloseTo(back[n - 3], 5);
    expect(Math.abs(back[n - 9] - back[n - 6])).toBeGreaterThan(2 * OPTIONS.rankSep);
    // The edge down to the node on that side leaves next to where it arrives. It runs straight
    // down as far as that level and curves below it.
    const down = edges[2].route;
    expect(Math.abs(down[0] - back[n - 3])).toBeLessThan(20);
    expect(down).toHaveLength(9);
    expect(down[3]).toBeCloseTo(down[0], 5);
    expect(down[4]).toBeGreaterThan(level - 0.01);
  });

  it('moves an end along its side to let its edge run straight, and no closer to its neighbour than a pitch', () => {
    // A wide node above four narrow ones.
    const nodes = [cnode(400, 40), cnode(40, 40), cnode(40, 40), cnode(40, 40), cnode(40, 40)];
    nodes.forEach((node, i) => {
      node.seq = i;
      node.span = node.w - 24;
    });
    const edges = [edge(0, 1), edge(0, 2), edge(0, 3), edge(0, 4)];
    compoundLayout(nodes, edges, 'TB', OPTIONS);
    // Each child is under the wide node, so each edge runs straight down to it.
    for (const e of edges) expect(e.route[0]).toBeCloseTo(e.route[e.route.length - 3], 5);
    const twoWay = [cnode(200, 40), cnode(40, 40)];
    twoWay.forEach((node, i) => {
      node.seq = i;
      node.span = node.w - 24;
    });
    const pair = [edge(0, 1), edge(1, 0)];
    compoundLayout(twoWay, pair, 'TB', OPTIONS);
    expect(Math.abs(pair[0].route[0] - pair[1].route[pair[1].route.length - 3])).toBeCloseTo(16, 5);
  });

  it('moves the edges that leave side by side closer together before it lets them share a place', () => {
    const nodes = [cnode(60, 40)];
    const edges: CEdge[] = [];
    for (let i = 1; i <= 7; i++) {
      nodes.push(cnode(60, 40));
      edges.push(edge(0, i));
    }
    nodes.forEach((node, i) => (node.seq = i));
    nodes[0].span = 36;
    compoundLayout(nodes, edges, 'TB', OPTIONS);
    const starts = edges.map((e) => e.route[0]).sort((a, b) => a - b);
    // Six gaps of half a pitch each across the 36 there is.
    for (let i = 1; i < starts.length; i++) expect(starts[i] - starts[i - 1]).toBeCloseTo(6, 5);
  });

  it('draws an edge as one curve across a rank that only a twin of another edge put there', () => {
    const lay = (twin: boolean): CEdge[] => {
      const nodes = [cnode(60, 40), cnode(60, 40), cnode(60, 40), cnode(60, 40)];
      nodes.forEach((node, i) => {
        node.seq = i;
        node.span = 36;
      });
      const edges = [edge(0, 1), edge(0, 2), edge(0, 3)];
      if (twin) edges.push(edge(0, 3));
      compoundLayout(nodes, edges, 'TB', OPTIONS);
      return edges;
    };
    const plain = lay(false);
    const twinned = lay(true);
    // The twins make every edge take a rank in the middle, but none of them needs a bend there.
    for (const e of twinned.slice(0, 2)) expect(e.route).toHaveLength(6);
    expect(twinned[0].route[1]).toBeCloseTo(plain[0].route[1], 5);
    // The gap is tall enough for the twins to turn at two levels, 12 apart and 28 from the ranks.
    expect(twinned[0].route[4]).toBeCloseTo(plain[0].route[4] + 2 * 28 + 12 - OPTIONS.rankSep, 5);
    // The twins leave and arrive at places of their own.
    const [one, other] = [twinned[2].route, twinned[3].route];
    expect(Math.abs(one[0] - other[0])).toBeGreaterThanOrEqual(8);
    expect(Math.abs(one[one.length - 3] - other[other.length - 3])).toBeGreaterThanOrEqual(8);
    // They would run close beside each other, so one turns straight away and the other further down.
    const turnsAt = (route: number[]): number => (Math.abs(route[3] - route[0]) < 0.01 ? route[4] : route[1]);
    expect(Math.abs(turnsAt(one) - turnsAt(other))).toBeGreaterThanOrEqual(10);
  });

  it('keeps twin edges apart where their ends cannot be', () => {
    const nodes = [cnode(60, 40), cnode(60, 40)];
    nodes.forEach((node, i) => (node.seq = i));
    const edges = [edge(0, 1), edge(0, 1)];
    compoundLayout(nodes, edges, 'TB', OPTIONS);
    const [a, b] = edges.map((e) => e.route);
    expect(a).toHaveLength(9);
    expect(b).toHaveLength(9);
    expect(a[0]).toBeCloseTo(b[0], 5);
    expect(Math.abs(a[3] - b[3])).toBeCloseTo(OPTIONS.edgeSep, 5);
  });

  it('routes edges at right angles on tracks, where no two can be taken for each other', () => {
    for (let seed = 1; seed <= 120; seed++) {
      const rnd = random(seed * 7919);
      const int = (n: number): number => Math.floor(rnd() * n);
      const nodes: CNode[] = [];
      const count = 3 + int(14);
      for (let i = 0; i < count; i++) {
        const node = cnode(40 + int(120), 30 + int(60));
        node.seq = i;
        node.span = node.w - 24;
        nodes.push(node);
      }
      const edges: CEdge[] = [];
      for (let i = 0, wanted = int(count * 2.5); i < wanted; i++) {
        const src = int(count);
        const dst = int(count);
        if (src !== dst) edges.push(edge(src, dst, rnd() < 0.2 ? 30 + int(40) : 0, 20));
      }
      compoundLayout(nodes, edges, 'TB', { ...OPTIONS, tracks: true });
      const where = `seed ${seed}`;
      // Every run across, with the x where the edge comes down to it and where it goes down from it.
      const runs: { y: number; lo: number; hi: number; from: number; to: number }[] = [];
      edges.forEach((e, ei) => {
        const r = e.route;
        expect(onBorder(nodes[e.src], r[0], r[1]), `${where} edge ${ei} starts on its source`).toBe(true);
        expect(onBorder(nodes[e.dst], r[r.length - 3], r[r.length - 2]), `${where} edge ${ei} ends on its target`).toBe(true);
        for (let k = 3; k < r.length; k += 3) {
          // Two ends less than half a unit out of line are joined directly.
          const across = Math.abs(r[k + 1] - r[k - 2]) < 0.01;
          const down = Math.abs(r[k] - r[k - 3]) < 0.5;
          expect(across || down, `${where} edge ${ei} turns at right angles`).toBe(true);
          if (!across || down) continue;
          // The route runs upwards when the edge does, so the higher end is the one it comes down to.
          const before = k >= 6 ? r[k - 5] : r[k - 2];
          const fromFirst = before < r[k - 2] - 0.01 || (k + 4 < r.length && r[k + 4] > r[k + 1] + 0.01);
          runs.push({
            y: r[k + 1],
            lo: Math.min(r[k], r[k - 3]),
            hi: Math.max(r[k], r[k - 3]),
            from: fromFirst ? r[k - 3] : r[k],
            to: fromFirst ? r[k] : r[k - 3],
          });
        }
      });
      for (let a = 0; a < runs.length; a++) {
        for (let b = a + 1; b < runs.length; b++) {
          if (Math.abs(runs[a].y - runs[b].y) > 0.01) continue;
          const overlap = runs[a].lo < runs[b].hi - 0.5 && runs[b].lo < runs[a].hi - 0.5;
          const mates = Math.abs(runs[a].from - runs[b].from) < 0.5 || Math.abs(runs[a].to - runs[b].to) < 0.5;
          expect(overlap && !mates, `${where} runs ${a} and ${b} lie on one track`).toBe(false);
        }
      }
      // No run across passes through a node.
      for (const run of runs) {
        for (const node of nodes) {
          const inside = Math.abs(run.y - node.y) < node.h / 2 - 0.5 && run.lo < node.x + node.w / 2 - 0.5 && run.hi > node.x - node.w / 2 + 0.5;
          expect(inside, `${where} a run crosses a node`).toBe(false);
        }
      }
    }
  });

  it('nests the tracks of a fan so that its edges do not cross', () => {
    const nodes = [cnode(120, 40), cnode(60, 40), cnode(60, 40), cnode(60, 40), cnode(60, 40)];
    nodes.forEach((node, i) => (node.seq = i));
    nodes[0].span = 96;
    const edges = [edge(0, 1), edge(0, 2), edge(0, 3), edge(0, 4)];
    compoundLayout(nodes, edges, 'TB', { ...OPTIONS, tracks: true });
    const acrossY = (e: CEdge): number => e.route[4];
    const left = edges.filter((e) => nodes[e.dst].x < nodes[0].x).sort((a, b) => nodes[a.dst].x - nodes[b.dst].x);
    const right = edges.filter((e) => nodes[e.dst].x > nodes[0].x).sort((a, b) => nodes[b.dst].x - nodes[a.dst].x);
    // The edge that reaches furthest turns first, so the nearer ones pass under it.
    for (const side of [left, right]) for (let i = 1; i < side.length; i++) expect(acrossY(side[i - 1])).toBeLessThan(acrossY(side[i]));
  });

  it('counts where routes cross, but not where edges that meet at one node fan out from it', () => {
    const nodes = [cnode(40, 40), cnode(40, 40), cnode(40, 40), cnode(40, 40)];
    nodes.forEach((node, i) => {
      node.x = 100 * (i % 2);
      node.y = 200 * Math.floor(i / 2);
    });
    const crossed = [edge(0, 3), edge(1, 2)];
    crossed[0].route = [0, 20, 0, 100, 180, 0];
    crossed[1].route = [100, 20, 0, 0, 180, 0];
    expect(routeCrossings(nodes, crossed)).toBe(1);
    const fan = [edge(0, 2), edge(0, 3)];
    fan[0].route = [10, 20, 0, 0, 180, 0];
    fan[1].route = [-10, 20, 0, 100, 180, 0];
    expect(routeCrossings(nodes, fan)).toBe(0);
  });

  function group(seq: number): CNode {
    const node = cnode(0, 0);
    node.isGroup = true;
    node.padX = 20;
    node.padTop = 40;
    node.padBottom = 20;
    node.span = Infinity;
    node.seq = seq;
    return node;
  }

  // Issue #3: two chains in separate groups feed a store in a third group.
  function fanIn(): { nodes: CNode[]; edges: CEdge[] } {
    const nodes = [group(100), group(101), group(102), cnode(80, 60, 2)];
    const edges: CEdge[] = [];
    for (const g of [0, 1]) {
      for (let i = 0; i < 5; i++) {
        const v = nodes.length;
        nodes.push(cnode(40, 40, g));
        nodes[v].seq = v;
        if (i > 0) edges.push(edge(v - 1, v));
        edges.push(edge(v, 3));
      }
    }
    return { nodes, edges };
  }

  it('does not count edges that join one straight run into the node they meet at as crossing', () => {
    const nodes = [cnode(40, 40), cnode(40, 40), cnode(40, 40)];
    nodes[1].x = 100;
    nodes[2].x = 50;
    nodes[2].y = 300;
    const edges = [edge(0, 2), edge(1, 2)];
    edges[0].route = [0, 20, 0, 0, 200, 0, 50, 200, 0, 50, 280, 0];
    edges[1].route = [100, 20, 0, 100, 150, 0, 50, 150, 0, 50, 280, 0];
    expect(routeCrossings(nodes, edges)).toBe(0);
    const { nodes: fan, edges: into } = fanIn();
    compoundLayout(fan, into, 'TB', { ...OPTIONS, tracks: true });
    expect(routeCrossings(fan, into)).toBe(0);
  });

  it('counts crossings where the drawing has them, round its corners or at its steps', () => {
    const nodes = [cnode(40, 40), cnode(40, 40), cnode(40, 40), cnode(40, 40)];
    nodes[0].y = -20;
    nodes[1].x = 120;
    nodes[1].y = 100;
    nodes[2].x = 5;
    nodes[2].y = 170;
    nodes[3].x = 5;
    nodes[3].y = 40;
    // Rounding the corner clears the other edge.
    const corner = [edge(0, 1), edge(2, 3)];
    corner[0].route = [0, 0, 0, 0, 100, 0, 100, 100, 1];
    corner[1].route = [5, 150, 0, 5, 60, 0];
    expect(routeCrossings(nodes, corner, Style.Curved)).toBe(0);
    expect(routeCrossings(nodes, corner, Style.Stepped)).toBe(1);
    expect(routeCrossings(nodes, corner, Style.Linear)).toBe(1);
    const { nodes: fan, edges: into } = fanIn();
    compoundLayout(fan, into, 'TB', OPTIONS);
    expect(routeCrossings(fan, into, Style.Curved)).toBeLessThanOrEqual(4);
  });

  it('orders the ports on the far side of a group by where their edges go, so that a fan into one node does not cross between groups', () => {
    for (const dir of ['TB', 'LR'] as Dir[]) {
      const nodes = [group(100), group(101), group(102), cnode(80, 40, 2)];
      const edges: CEdge[] = [];
      for (const g of [0, 1]) {
        for (let i = 0; i < 5; i++) {
          const v = nodes.length;
          nodes.push(cnode(100, 40, g));
          if (i > 0) edges.push(edge(v - 1, v));
          edges.push(edge(v, 3));
        }
      }
      nodes.forEach((node, i) => {
        if (node.isGroup) return;
        node.seq = i;
        node.span = 72;
      });
      compoundLayout(nodes, edges, dir, OPTIONS);
      const across = dir === 'TB' ? 0 : 1;
      const at = (e: CEdge, g: number): number => {
        for (let k = 0; k < e.route.length; k += 3) if (onBorder(nodes[g], e.route[k], e.route[k + 1])) return e.route[k + across];
        return NaN;
      };
      const fan = edges.filter((e) => e.dst === 3);
      const leave = fan.map((e) => at(e, nodes[e.src].parent));
      const enter = fan.map((e) => at(e, 2));
      for (let i = 0; i < fan.length; i++) {
        expect(Number.isNaN(leave[i]) || Number.isNaN(enter[i]), `${dir} edge ${i}`).toBe(false);
        for (let j = i + 1; j < fan.length; j++) expect(Math.sign(leave[i] - leave[j]), `${dir} edges ${i} and ${j}`).toBe(Math.sign(enter[i] - enter[j]));
      }
    }
  });

  it('orders the nodes of a row of groups as one drawing, so that the edges between them do not cross', () => {
    const nodes = [group(100), group(101), group(102)];
    const stage = (g: number): number[] =>
      [0, 1, 2, 3, 4].map(() => {
        nodes.push(cnode(80, 40, g));
        nodes[nodes.length - 1].seq = nodes.length;
        return nodes.length - 1;
      });
    const [a, b, c] = [stage(0), stage(1), stage(2)];
    const edges: CEdge[] = [];
    [4, 2, 0, 3, 1].forEach((j, i) => edges.push(edge(a[i], b[j])));
    [1, 3, 0, 4, 2].forEach((j, i) => edges.push(edge(b[i], c[j])));
    compoundLayout(nodes, edges, 'LR', OPTIONS);
    expect(routeCrossings(nodes, edges)).toBe(0);
  });

  it('survives groups that contain each other', () => {
    const a = cnode(0, 0, 1);
    const b = cnode(0, 0, 0);
    a.isGroup = b.isGroup = true;
    const leaf = cnode(40, 40, 0);
    const nodes = [a, b, leaf, cnode(40, 40)];
    const edges = [edge(2, 3)];
    const size = compoundLayout(nodes, edges, 'TB', OPTIONS);
    expect(Number.isFinite(size.width)).toBe(true);
    expect(edges[0].route.length).toBeGreaterThanOrEqual(6);
  });
});
