import type { YamlValue } from '../../util/yaml.js';
import type { FlowDb } from './db.js';
import type { FlowNode, FlowchartModel, LabelType } from './types.js';

export interface GraphNode {
  id: string;
  label: string | undefined;
  labelType: LabelType;
  shape: string;
  isGroup: boolean;
  parentId: string | undefined;
  cssStyles: string[];
  cssCompiledStyles: string[];
  cssClasses: string;
  dir: string | undefined;
  link?: string;
  linkTarget?: string;
  tooltip?: string;
  icon?: string;
  pos?: string;
  img?: string;
  assetWidth?: number;
  assetHeight?: number;
  constraint?: string;
  colorIndex?: number;
  metadata?: Record<string, YamlValue>;
}

export interface GraphEdge {
  id: string;
  isUserDefinedId: boolean;
  start: string;
  end: string;
  type: string;
  label: string;
  labelType: LabelType;
  thickness: string | undefined;
  pattern: string | undefined;
  minlen: number | undefined;
  arrowTypeStart: string;
  arrowTypeEnd: string;
  cssCompiledStyles: string[];
  style: string[];
  classes: string;
  animate: boolean | undefined;
  animation: string | undefined;
  curve: string | undefined;
}

export interface FlowGraph {
  nodes: GraphNode[];
  edges: GraphEdge[];
}

function shapeOf(vertex: FlowNode): string {
  if (vertex.img) return 'imageSquare';
  if (vertex.icon) {
    if (vertex.form === 'circle') return 'iconCircle';
    if (vertex.form === 'square') return 'iconSquare';
    if (vertex.form === 'rounded') return 'iconRounded';
    return 'icon';
  }
  switch (vertex.type) {
    case 'square':
    case undefined:
      return 'squareRect';
    case 'round':
      return 'roundedRect';
    default:
      return vertex.type;
  }
}

function arrows(type: string | undefined): [string, string] {
  switch (type) {
    case 'arrow_point':
    case 'arrow_circle':
    case 'arrow_cross':
      return ['none', type];
    case 'double_arrow_point':
    case 'double_arrow_circle':
    case 'double_arrow_cross': {
      const single = type.replace('double_', '');
      return [single, single];
    }
  }
  return ['none', 'arrow_point'];
}

// Resolves a parsed flowchart into the nodes and edges that are actually drawn:
// group membership, collapsed subgraphs, class styles and edge defaults.
export function buildFlowGraph(model: FlowchartModel & Pick<FlowDb, 'subgraph'>, defaultCurve?: string): FlowGraph {
  const nodes: GraphNode[] = [];
  const edges: GraphEdge[] = [];
  const subgraphs = model.subgraphs;

  const compiled = (classNames: string[]): string[] => {
    const out: string[] = [];
    for (const name of classNames) {
      const def = model.classes.get(name);
      if (def === undefined) continue;
      for (const s of def.styles) out.push(s.trim());
      for (const s of def.textStyles) out.push(s.trim());
    }
    return out;
  };

  const subgraphParent = new Map<string, string>();
  for (const sg of subgraphs) {
    for (const childId of sg.nodes) if (model.subgraph(childId)) subgraphParent.set(childId, sg.id);
  }

  const declarationIndex = new Map<string, number>();
  const childrenOf = new Map<string, string[]>();
  for (const sg of subgraphs) {
    const parent = subgraphParent.get(sg.id);
    if (parent === undefined) continue;
    const kids = childrenOf.get(parent);
    if (kids) kids.push(sg.id);
    else childrenOf.set(parent, [sg.id]);
  }
  let nextIndex = 0;
  for (const sg of subgraphs) {
    if (subgraphParent.has(sg.id)) continue;
    const pending = [sg.id];
    while (pending.length > 0) {
      const id = pending.pop()!;
      if (declarationIndex.has(id)) continue;
      declarationIndex.set(id, nextIndex++);
      const kids = childrenOf.get(id);
      if (kids) for (let i = kids.length - 1; i >= 0; i--) pending.push(kids[i]);
    }
  }

  const isCollapsed = (id: string): boolean => model.subgraph(id)?.metadata?.view === 'collapsed';
  let anyCollapsed = false;
  for (const sg of subgraphs) if (sg.metadata?.view === 'collapsed') anyCollapsed = true;
  // The outermost collapsed subgraph around each subgraph, resolved once per chain of parents.
  const outermost = new Map<string, string | undefined>();
  const outermostCollapsed = (id: string): string | undefined => {
    const chain: string[] = [];
    const seen = new Set<string>();
    let current: string | undefined = id;
    while (current !== undefined && !outermost.has(current) && !seen.has(current)) {
      seen.add(current);
      chain.push(current);
      current = subgraphParent.get(current);
    }
    let result = current !== undefined ? outermost.get(current) : undefined;
    for (let i = chain.length - 1; i >= 0; i--) {
      if (result === undefined && isCollapsed(chain[i])) result = chain[i];
      outermost.set(chain[i], result);
    }
    return result;
  };

  const hidden = new Set<string>();
  const collapsedInto = new Map<string, string>();
  for (const sg of anyCollapsed ? subgraphs : []) {
    const ancestor = outermostCollapsed(sg.id);
    if (ancestor === undefined) continue;
    if (sg.id !== ancestor) {
      hidden.add(sg.id);
      collapsedInto.set(sg.id, ancestor);
    }
    for (const childId of sg.nodes) {
      if (childId === ancestor) continue;
      hidden.add(childId);
      collapsedInto.set(childId, ancestor);
    }
  }

  const parentOf = new Map<string, string>();
  const groups = new Set<string>();
  for (let i = subgraphs.length - 1; i >= 0; i--) {
    const sg = subgraphs[i];
    if (hidden.has(sg.id)) continue;
    if (sg.nodes.length > 0) groups.add(sg.id);
    for (const id of sg.nodes) parentOf.set(id, sg.id);
  }

  const byId = new Map<string, GraphNode>();
  for (let i = subgraphs.length - 1; i >= 0; i--) {
    const sg = subgraphs[i];
    if (hidden.has(sg.id)) continue;
    const collapsed = sg.metadata?.view === 'collapsed';
    const node: GraphNode = {
      id: sg.id,
      label: sg.title,
      labelType: sg.labelType,
      parentId: parentOf.get(sg.id),
      cssStyles: [],
      cssCompiledStyles: compiled(sg.classes),
      cssClasses: sg.classes.join(' '),
      shape: collapsed ? 'collapsedGroup' : 'rect',
      dir: sg.dir,
      isGroup: !collapsed,
      colorIndex: declarationIndex.get(sg.id),
    };
    if (!collapsed) node.metadata = sg.metadata;
    nodes.push(node);
    byId.set(sg.id, node);
  }

  for (const vertex of model.nodes.values()) {
    if (hidden.has(vertex.id)) continue;
    const existing = byId.get(vertex.id);
    if (existing) {
      existing.cssStyles = vertex.styles;
      existing.cssCompiledStyles = compiled(vertex.classes);
      existing.cssClasses = vertex.classes.join(' ');
      continue;
    }
    const isGroup = groups.has(vertex.id);
    const node: GraphNode = {
      id: vertex.id,
      label: vertex.text,
      labelType: vertex.labelType,
      parentId: parentOf.get(vertex.id),
      cssStyles: vertex.styles,
      cssCompiledStyles: compiled(['default', 'node', ...vertex.classes]),
      cssClasses: 'default ' + vertex.classes.join(' '),
      dir: vertex.dir,
      link: vertex.link,
      linkTarget: vertex.linkTarget,
      tooltip: model.tooltips.get(vertex.id),
      icon: vertex.icon,
      pos: vertex.pos,
      img: vertex.img,
      assetWidth: vertex.assetWidth,
      assetHeight: vertex.assetHeight,
      constraint: vertex.constraint,
      isGroup,
      shape: isGroup ? 'rect' : shapeOf(vertex),
    };
    nodes.push(node);
  }

  model.edges.forEach((raw, index) => {
    const start = collapsedInto.get(raw.start) ?? raw.start;
    const end = collapsedInto.get(raw.end) ?? raw.end;
    if (start === end && (collapsedInto.has(raw.start) || collapsedInto.has(raw.end))) return;

    const [arrowStart, arrowEnd] = arrows(raw.type);
    const styles = [...(model.defaultEdgeStyle ?? [])];
    if (raw.style) styles.push(...raw.style);
    const plain = raw.stroke === 'invisible' || raw.type === 'arrow_open';
    edges.push({
      id: raw.id || `L_${start}_${end}_${index}`,
      isUserDefinedId: raw.isUserDefinedId,
      start,
      end,
      type: raw.type ?? 'normal',
      label: raw.text,
      labelType: raw.labelType,
      thickness: raw.stroke,
      pattern: raw.stroke,
      minlen: raw.length,
      classes: raw.stroke === 'invisible' ? '' : 'edge-thickness-normal edge-pattern-solid flowchart-link',
      arrowTypeStart: plain ? 'none' : arrowStart,
      arrowTypeEnd: plain ? 'none' : arrowEnd,
      cssCompiledStyles: compiled(raw.classes),
      style: styles,
      animate: raw.animate,
      animation: raw.animation,
      curve: raw.interpolate || model.defaultInterpolate || defaultCurve,
    });
  });

  return { nodes, edges };
}
