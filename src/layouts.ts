import type { DiagramType } from './detect.js';
import type { CEdge, CNode, Dir } from './layout/compound.js';
import type { Config } from './preprocess.js';

// Pele sets a node's size, `parent` and group padding. The layout sets its center in `x` and
// `y`, and a group's `w` and `h`.
export type LayoutNode = CNode;

// Pele sets an edge's ends and label size. The layout sets its route and its label's center.
export type LayoutEdge = CEdge;

export interface LayoutContext {
  type: DiagramType;
  direction: Dir;
  nodeSpacing: number;
  rankSpacing: number;
  config: Readonly<Config>;
  // Places the diagram with Pele's own layout.
  fallback(): { width: number; height: number };
}

// Returns the size of the box that holds the nodes, routes and labels.
export type Layout = (nodes: LayoutNode[], edges: LayoutEdge[], context: LayoutContext) => { width: number; height: number };

const layouts = new Map<string, Layout>();

// A diagram whose config sets `layout` to `name` uses this layout, as in Mermaid.
export function registerLayout(name: string, layout: Layout): void {
  layouts.set(name, layout);
}

export interface Chosen {
  layout: Layout;
  type: DiagramType;
  config: Config;
}

// The layout that the diagram being rendered asks for, if it is registered.
let chosen: Chosen | undefined;

export function withLayout<T>(type: DiagramType, config: Config, run: () => T): T {
  const outer = chosen;
  const layout = typeof config.layout === 'string' ? layouts.get(config.layout) : undefined;
  chosen = layout && { layout, type, config };
  try {
    return run();
  } finally {
    chosen = outer;
  }
}

export const chosenLayout = (): Chosen | undefined => chosen;
