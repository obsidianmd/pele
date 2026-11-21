import { assignColorSlots } from './colorSlots.js';
import type { AgentflowDb } from './db.js';
import { normaliseNodeShapes, resolveShapeAlias } from './shapes.js';
import type { LabelType, Metadata } from './types.js';
import type { YamlValue } from '../../util/yaml.js';

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
  // Palette slot of a container.
  colorIndex?: number;
  // What a node is, which picks its palette slot.
  kind?: string;
  metadata?: Metadata;
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
  animate: YamlValue | undefined;
  animation: YamlValue | undefined;
  curve: string | undefined;
  metadata: Metadata | undefined;
}

export interface AgentGraph {
  nodes: GraphNode[];
  edges: GraphEdge[];
}

// Resolves a parsed agentflow into the nodes and edges that are drawn: flow membership, collapsed
// flows, shapes reduced to the ones agentflow has, class styles and palette slots. Shape and
// containment problems are reported on the model as diagnostics.
export function buildAgentGraph(db: AgentflowDb, paletteLength: number, defaultCurve?: string): AgentGraph {
  const nodes: GraphNode[] = [];
  const edges: GraphEdge[] = [];
  const subgraphs = db.subgraphs;

  const compiled = (classNames: string[]): string[] => {
    let out: string[] = [];
    for (const name of classNames) {
      const def = db.classes.get(name);
      if (def?.styles) out = [...out, ...def.styles].map((s) => s.trim());
      if (def?.textStyles) out = [...out, ...def.textStyles].map((s) => s.trim());
    }
    return out;
  };

  // Everything inside a collapsed flow is hidden, and stands for its outermost collapsed flow.
  // Mermaid walks the whole inside of each collapsed flow, in the order the flows closed, and the
  // last walk to reach a thing wins. A thing has one container, so a later walk can only enter an
  // earlier one through its root: it stops there, and the root's owner is followed afterwards.
  const hidden = new Set<string>();
  const owner = new Map<string, string>();
  const walked = new Set<string>();
  for (const sg of subgraphs) {
    if (sg.metadata?.view !== 'collapsed' || hidden.has(sg.id)) continue;
    const pending = [sg.id];
    while (pending.length > 0) {
      const members = db.subgraph(pending.pop()!)?.nodes;
      if (members === undefined) continue;
      for (const childId of members) {
        if (childId === sg.id || hidden.has(childId)) continue;
        hidden.add(childId);
        owner.set(childId, sg.id);
        if (!walked.has(childId)) pending.push(childId);
      }
    }
    walked.add(sg.id);
  }
  const collapsedInto = new Map<string, string>();
  for (const id of hidden) {
    const path = [id];
    let top = owner.get(id)!;
    while (true) {
      const known = collapsedInto.get(top);
      const up = known ?? owner.get(top);
      if (up === undefined) break;
      if (known === undefined) path.push(top);
      top = up;
      if (known !== undefined) break;
    }
    for (const p of path) collapsedInto.set(p, top);
  }

  const position = new Map<string, number>();
  subgraphs.forEach((sg, i) => position.set(sg.id, i));

  // Two flows can each name the other. The nesting that would close the loop is dropped.
  const parentOf = new Map<string, string>();
  const closesLoop = (childId: string, parentId: string, at: number): boolean => {
    // Only a flow handled earlier in this pass can already be above the parent.
    const childAt = position.get(childId);
    if (childAt === undefined || childAt < at) return false;
    let current: string | undefined = parentId;
    for (let hops = 0; current !== undefined && hops <= subgraphs.length; hops++) {
      if (current === childId) return true;
      current = parentOf.get(current);
    }
    return false;
  };
  for (let i = subgraphs.length - 1; i >= 0; i--) {
    const sg = subgraphs[i];
    if (hidden.has(sg.id)) continue;
    for (const id of sg.nodes) {
      if (closesLoop(id, sg.id, i)) {
        db.emitWarning(
          'CONTAINMENT_VIOLATION',
          `Container "${sg.id}" cannot contain "${id}" because "${id}" already contains it. The nesting that would close the loop is dropped.`,
          { nodeId: id }
        );
        continue;
      }
      parentOf.set(id, sg.id);
    }
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
      shape: collapsed ? 'collapsedGroup' : 'flowGroup',
      dir: sg.dir,
      isGroup: !collapsed,
      metadata: collapsed ? { ...sg.metadata, containerType: sg.type } : sg.metadata,
    };
    nodes.push(node);
    byId.set(sg.id, node);
  }

  for (const vertex of db.nodes.values()) {
    if (hidden.has(vertex.id)) continue;
    const existing = byId.get(vertex.id);
    if (existing) {
      existing.cssStyles = vertex.styles;
      existing.cssCompiledStyles = compiled(vertex.classes);
      existing.cssClasses = vertex.classes.join(' ');
      continue;
    }
    const type = resolveShapeAlias(vertex.type);
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
      tooltip: db.tooltips.get(vertex.id),
      metadata: vertex.metadata,
      isGroup: false,
      shape: type === 'square' || type === undefined ? 'squareRect' : type,
    };
    nodes.push(node);
    byId.set(vertex.id, node);
  }

  db.edges.forEach((raw, index) => {
    const start = collapsedInto.get(raw.start) ?? raw.start;
    const end = collapsedInto.get(raw.end) ?? raw.end;
    // An edge between two things inside one collapsed flow has nothing left to connect.
    if (start === end && raw.start !== raw.end) return;
    const styles = [...(db.defaultEdgeStyle ?? [])];
    if (raw.style) styles.push(...raw.style);
    const arrow =
      raw.type === 'arrow_open' ? 'none' : raw.type === 'arrow_cross' || raw.type === 'arrow_point' ? raw.type : 'arrow_point';
    // Mermaid marks an animated edge edge-animation-fast (animate: true) or
    // edge-animation-<speed> (animation: fast|slow); see flowchart/graph.ts.
    const animation =
      typeof raw.animation === 'string' && raw.animation !== ''
        ? raw.animation
        : raw.animate === true
          ? 'fast'
          : undefined;
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
      classes:
        'edge-thickness-normal edge-pattern-solid flowchart-link' +
        (animation === undefined ? '' : ` edge-animation-${animation}`),
      arrowTypeStart: 'none',
      arrowTypeEnd: arrow,
      cssCompiledStyles: compiled(raw.classes),
      style: styles,
      animate: raw.animate,
      animation: raw.animation,
      curve: raw.interpolate || db.defaultInterpolate || defaultCurve,
      metadata: raw.metadata,
    });
  });

  normaliseNodeShapes(nodes, db);

  // Containers are numbered in the order they were written: a walk of the nesting, parents first.
  // `subgraphs` itself is in the order the blocks closed, with a nested flow before its parent.
  const children = new Map<string, string[]>();
  for (const sg of subgraphs) {
    const parent = parentOf.get(sg.id);
    if (parent === undefined) continue;
    const kids = children.get(parent);
    if (kids) kids.push(sg.id);
    else children.set(parent, [sg.id]);
  }
  const order = new Map<string, number>();
  for (const sg of subgraphs) {
    if (parentOf.get(sg.id) !== undefined) continue;
    const pending = [sg.id];
    while (pending.length > 0) {
      const id = pending.pop()!;
      if (order.has(id)) continue;
      order.set(id, order.size);
      const kids = children.get(id);
      if (kids) for (let i = kids.length - 1; i >= 0; i--) pending.push(kids[i]);
    }
  }

  assignColorSlots(
    nodes,
    (id) => {
      if (db.connectors.has(id)) return 'connector';
      const vertex = db.nodes.get(id);
      return vertex ? db.vertexKind(vertex) : undefined;
    },
    order,
    paletteLength
  );

  return { nodes, edges };
}
