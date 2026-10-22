import { shiftLayout, type CEdge, type CNode, type CompoundResult } from './compound.js';

interface Part {
  nodes: CNode[];
  edges: CEdge[];
  left: number;
  top: number;
  right: number;
  bottom: number;
}

// Moves disconnected parts into rows without changing the layout inside a part.
export function wrapComponents(nodes: CNode[], edges: CEdge[], width: number, gap: number): CompoundResult | undefined {
  const parent = Int32Array.from(nodes, (_, i) => i);
  const root = (i: number): number => {
    while (parent[i] !== i) {
      parent[i] = parent[parent[i]];
      i = parent[i];
    }
    return i;
  };
  const join = (a: number, b: number): void => { parent[root(a)] = root(b); };
  for (let i = 0; i < nodes.length; i++) if (nodes[i].parent >= 0) join(i, nodes[i].parent);
  for (const e of edges) join(e.src, e.dst);

  const parts = new Map<number, Part>();
  const include = (p: Part, x: number, y: number, w = 0, h = 0): void => {
    p.left = Math.min(p.left, x - w / 2);
    p.top = Math.min(p.top, y - h / 2);
    p.right = Math.max(p.right, x + w / 2);
    p.bottom = Math.max(p.bottom, y + h / 2);
  };
  for (let i = 0; i < nodes.length; i++) {
    const id = root(i);
    let part = parts.get(id);
    if (!part) {
      part = { nodes: [], edges: [], left: Infinity, top: Infinity, right: -Infinity, bottom: -Infinity };
      parts.set(id, part);
    }
    const c = nodes[i];
    part.nodes.push(c);
    include(part, c.x, c.y, c.w, c.h);
  }
  if (parts.size < 2) return undefined;
  for (const e of edges) {
    const part = parts.get(root(e.src))!;
    part.edges.push(e);
    for (let i = 0; i < e.route.length; i += 3) include(part, e.route[i], e.route[i + 1]);
    if (e.labelW > 0) include(part, e.labelX, e.labelY, e.labelW, e.labelH);
  }

  let x = 0, y = 0, rowHeight = 0, right = 0, from = Infinity, to = -Infinity;
  const shifts: number[] = [];
  for (const part of parts.values()) {
    const w = part.right - part.left, h = part.bottom - part.top;
    if (x > 0 && x + w > width) {
      y += rowHeight + gap;
      x = 0;
      rowHeight = 0;
    }
    shifts.push(x - part.left, y - part.top);
    from = Math.min(from, part.left);
    to = Math.max(to, part.right);
    right = Math.max(right, x + w);
    rowHeight = Math.max(rowHeight, h);
    x += w + gap;
  }
  if (right >= to - from) return undefined;
  let k = 0;
  for (const part of parts.values()) shiftLayout(part.nodes, part.edges, shifts[k++], shifts[k++]);
  return { width: right, height: y + rowHeight };
}
