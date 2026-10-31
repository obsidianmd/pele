import { describe, expect, it } from 'vitest';
import { layered, ledge, lnode } from '../../src/layout/layered.js';

describe('layered', () => {
  it.each([false, true])('avoids a crossing with either branch declaration order (%s)', (reverse) => {
    const nodes = Array.from({ length: 5 }, () => lnode(48, 48));
    const pairs = [[0, 1], [0, 2], [0, 3], [1, 2], [1, 4], [2, 3], [4, 3]];
    if (reverse) [pairs[3], pairs[4]] = [pairs[4], pairs[3]];
    const edges = pairs.map(([a, b], i) => ledge(a, b, 1, i >= 5 ? 15 : 0, i >= 5 ? 21 : 0));
    const { crossings } = layered(nodes, edges, {
      nodeSep: 40,
      edgeSep: 16,
      rankSep: 48,
      portSep: 20,
      orderOnly: true,
    });
    expect(crossings).toBe(0);
  });

  it('orders a flat graph with groups side by side, and counts the crossings of that order', () => {
    const nodes = Array.from({ length: 6 }, () => lnode(40, 40));
    const of = [0, 1, 0, -1, 0, -1];
    const edges = [ledge(0, 4), ledge(1, 4), ledge(2, 5), ledge(3, 4), ledge(3, 5)];
    const { crossings } = layered(nodes, edges, {
      nodeSep: 40,
      edgeSep: 16,
      rankSep: 48,
      portSep: 20,
      groups: { of: Int32Array.from(of), parent: Int32Array.from([-1, -1]) },
      orderOnly: true,
    });
    // Points are (rank, cross-flow position) pairs.
    const pieces: number[][] = [];
    for (const e of edges) for (let k = 2; k < e.points.length; k += 2) pieces.push([e.points[k - 2], e.points[k - 1], e.points[k + 1]]);
    let crossed = 0;
    for (let i = 0; i < pieces.length; i++) {
      for (let j = i + 1; j < pieces.length; j++) {
        const [r, a0, a1] = pieces[i];
        const [s, b0, b1] = pieces[j];
        if (r === s && (a0 - b0) * (a1 - b1) < 0) crossed++;
      }
    }
    expect(crossings).toBe(crossed);
    for (let i = 0; i < nodes.length; i++) {
      for (let j = 0; j < nodes.length; j++) {
        if (of[i] < 0 || of[j] !== of[i] || nodes[i].rank !== nodes[j].rank || nodes[i].x >= nodes[j].x) continue;
        for (let k = 0; k < nodes.length; k++) {
          const between = nodes[k].rank === nodes[i].rank && nodes[k].x > nodes[i].x && nodes[k].x < nodes[j].x;
          expect(between && of[k] !== of[i], `node ${k} between ${i} and ${j}`).toBe(false);
        }
      }
    }
  });
});
