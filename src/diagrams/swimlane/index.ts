import type { CNode, Dir } from '../../layout/compound.js';
import { laneLayout } from '../../layout/lanes.js';
import { labelSvg, num } from '../../svg/builder.js';
import type { ResolvedStyle } from '../../svg/theme.js';
import type { Label } from '../../text/label.js';
import type { Diagram, IconResolver } from '../../types.js';
import type { FlowDb } from '../flowchart/db.js';
import type { FlowGraph } from '../flowchart/graph.js';
import { flowchart } from '../flowchart/index.js';
import { renderFlowchart, type FlowVariant } from '../flowchart/render.js';
import type { FlowchartModel } from '../flowchart/types.js';

export type SwimlaneModel = FlowchartModel;

const DEFAULT_LANE = '__swimlane_default__';

// Nodes outside every lane share one unnamed lane, as in Mermaid. Lanes all run the same way,
// so a `direction` inside a subgraph has no effect.
function prepare(graph: FlowGraph): void {
  let loose = false;
  for (const node of graph.nodes) {
    if (node.isGroup) node.dir = undefined;
    else if (node.parentId === undefined) loose = true;
  }
  if (!loose) return;
  for (const node of graph.nodes) if (!node.isGroup && node.parentId === undefined) node.parentId = DEFAULT_LANE;
  graph.nodes.push({
    id: DEFAULT_LANE,
    label: undefined,
    labelType: 'text',
    shape: 'rect',
    isGroup: true,
    parentId: undefined,
    cssStyles: [],
    cssCompiledStyles: [],
    cssClasses: '',
    dir: undefined,
  });
}

// A lane: an outline the length of the diagram, with its title in a band at the start.
function drawLane(c: CNode, label: Label, style: ResolvedStyle, classes: string, id: string, dir: Dir, icons: IconResolver | undefined): string {
  const left = c.x - c.w / 2;
  const top = c.y - c.h / 2;
  const sideways = dir === 'LR' || dir === 'RL';
  const cx = sideways ? left + c.padTop / 2 : c.x;
  const cy = sideways ? c.y : top + c.padTop / 2;
  const text = labelSvg(label, cx, cy, ` class="pele-cluster-label" fill="var(--_m)"${style.text}`, icons);
  return (
    `<g class="pele-cluster pele-lane${classes}" data-id="${id}">` +
    `<rect x="${num(left)}" y="${num(top)}" width="${num(c.w)}" height="${num(c.h)}" fill="none" stroke="var(--_b)"/>` +
    `<rect x="${num(left)}" y="${num(top)}" width="${num(sideways ? c.padTop : c.w)}" height="${num(
      sideways ? c.h : c.padTop
    )}" fill="var(--_a)" stroke="var(--_b)"${style.shape}/>` +
    (sideways && text ? `<g transform="rotate(-90 ${num(cx)} ${num(cy)})">${text}</g>` : text) +
    '</g>'
  );
}

const variant: FlowVariant = {
  type: 'swimlane', prepare,
  layout: (nodes, edges, dir, options, tight) => laneLayout(nodes, edges, dir, options, tight ? 12 : undefined),
  drawGroup: drawLane,
};

// A swimlane diagram is a flowchart whose top-level subgraphs are lanes: same syntax, same model.
export const swimlane: Diagram<FlowDb> = {
  type: 'swimlane',
  math: true,
  parse: flowchart.parse,
  render: (db, config, options) => renderFlowchart(db, config, options, variant),
};
