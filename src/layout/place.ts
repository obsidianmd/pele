import { chosenLayout } from '../layouts.js';
import { compoundLayout, type CEdge, type CNode, type CompoundResult, type Dir } from './compound.js';
import type { LayeredOptions } from './layered.js';

// Places a graph with the layout the diagram asks for, or with Pele's own. This lives apart
// from the registry so that `pele/core` does not bundle the layout code.
export function placeGraph(nodes: CNode[], edges: CEdge[], dir: Dir, opt: LayeredOptions): CompoundResult {
  const own = (): CompoundResult => compoundLayout(nodes, edges, dir, opt);
  const chosen = chosenLayout();
  if (!chosen) return own();
  const { layout, type, config } = chosen;
  return layout(nodes, edges, { type, direction: dir, nodeSpacing: opt.nodeSep, rankSpacing: opt.rankSep, config, fallback: own });
}
