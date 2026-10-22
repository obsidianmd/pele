import { cnode, compoundLayout, direction, shiftLayout, type CEdge, type CNode, type Dir } from '../../layout/compound.js';
import type { Config } from '../../preprocess.js';
import { esc, escText, labelSvg, num } from '../../svg/builder.js';
import { clusterTitleX, markCrossings, type Crossings } from '../../svg/cluster.js';
import { edgeLabelSvg, loopPath, marker, markerTrim, routePath, type EdgePath } from '../../svg/edges.js';
import { svgDocument } from '../../svg/root.js';
import { PAD_X, PAD_Y, drawShape, insetRoute, shapeSize } from '../../svg/shapes.js';
import { classNames, resolveStyle, rounded, seriesColor, type ResolvedStyle } from '../../svg/theme.js';
import { layoutLabel, type Label } from '../../text/label.js';
import { Style, defaultMeasurer } from '../../text/measurer.js';
import { decodeEntities } from '../../text/entities.js';
import { linked, linkUrl, relAttr, sanitizeUrl } from '../../util/url.js';
import type { LinkInfo, RenderOptions, Rendered } from '../../types.js';
import { runsAcross, turnToFit } from '../common/fit-width.js';
import { canonicalShape } from '../flowchart/shapes.js';
import { KIND_SLOT } from './colorSlots.js';
import type { AgentflowDb } from './db.js';
import { buildAgentGraph, type AgentGraph, type GraphEdge, type GraphNode } from './graph.js';

// The number of series tokens, which is the palette Mermaid's slot rules are applied to.
export const PALETTE = 8;

const NODE_SEP = 40;
const EDGE_SEP = 16;
const RANK_SEP = 48;
const GROUP_PAD = 20;
const LOOP = 26;
const DOTS = 14;
const COLLAPSED = 'collapsed';
// The side a flow runs toward, with sides numbered clockwise from the top.
const FLOW_END: Record<Dir, number> = { TB: 2, RL: 3, BT: 0, LR: 1 };

const graphs = new WeakMap<AgentflowDb, AgentGraph>();

// Builds the graph once per model. Building it also records the model's shape and containment diagnostics.
export function agentGraph(db: AgentflowDb, config: Config): AgentGraph {
  let graph = graphs.get(db);
  if (graph === undefined) {
    const curve = (config.flowchart as Config | undefined)?.curve;
    graph = buildAgentGraph(db, PALETTE, typeof curve === 'string' ? curve : undefined);
    graphs.set(db, graph);
  }
  return graph;
}

function numberOption(config: Config, key: string, fallback: number): number {
  const value = (config.agentflow as Config | undefined)?.[key];
  return typeof value === 'number' && value > 0 ? Math.min(value, 2000) : fallback;
}

const RE_FILL = /[";]fill:/;

// A palette color as an outline with a light wash of the same color inside.
// A fill the author set replaces the wash and stays opaque.
function tint(slot: number, wash: string, style: ResolvedStyle): string {
  const color = seriesColor(slot);
  return ` fill="${color}"${RE_FILL.test(style.shape) ? '' : ` fill-opacity="${wash}"`} stroke="${color}"`;
}

interface NodeView {
  node: GraphNode;
  style: ResolvedStyle;
  label: Label;
  shape: string;
  w: number;
  h: number;
  dy: number;
  loops: number;
}

export function renderAgentflow(db: AgentflowDb, config: Config, options: RenderOptions): Rendered {
  if (!runsAcross(db.direction)) return draw(db, config, options, false);
  return turnToFit(options, (down) => draw(db, config, options, down));
}

// `turned` draws a diagram that runs across as one that runs down.
function draw(db: AgentflowDb, config: Config, options: RenderOptions, turned: boolean): Rendered {
  const graph = agentGraph(db, config);
  const size = options.fontSize ?? 16;
  const edgeSize = Math.round(size * 0.875);
  const measurer = options.measurer ?? defaultMeasurer(options.fontFamily);
  const wrapWidth = numberOption(config, 'wrappingWidth', 120);
  const minWidth = numberOption(config, 'minNodeWidth', 120);
  const pad = options.padding ?? 8;
  const icons = options.icons;

  const index = new Map<string, number>();
  const views: NodeView[] = [];
  const cnodes: CNode[] = [];
  graph.nodes.forEach((node, i) => index.set(node.id, i));

  for (const node of graph.nodes) {
    const styles = node.cssStyles.length > 0 ? node.cssCompiledStyles.concat(node.cssStyles) : node.cssCompiledStyles;
    const style = resolveStyle(styles);
    const textStyle = (style.bold ? Style.Bold : 0) | (style.italic ? Style.Italic : 0);
    const markdown = node.labelType === 'markdown';
    const fontSize = style.fontSize ?? size;
    let view: NodeView;
    let c: CNode;
    if (node.isGroup) {
      const label = layoutLabel(node.label, markdown, measurer, fontSize, 4000, textStyle);
      view = { node, style, label, shape: 'group', w: 0, h: 0, dy: 0, loops: 0 };
      c = cnode(0, 0);
      c.isGroup = true;
      c.dir = node.dir ? direction(node.dir) : undefined;
      c.padX = GROUP_PAD;
      c.padTop = label.height > 0 ? label.height + 16 : GROUP_PAD;
      c.padBottom = GROUP_PAD;
      c.minW = label.width + 2 * GROUP_PAD - 12;
    } else if (node.shape === 'collapsedGroup') {
      const label = layoutLabel(node.label, markdown, measurer, fontSize, wrapWidth, textStyle);
      const w = Math.max(label.width, minWidth) + 2 * PAD_X;
      const h = label.height + 2 * PAD_Y + DOTS;
      view = { node, style, label, shape: COLLAPSED, w, h, dy: -DOTS / 2, loops: 0 };
      c = cnode(w, h);
    } else {
      const shape = canonicalShape(node.shape);
      const label = layoutLabel(node.label, markdown, measurer, fontSize, wrapWidth, textStyle);
      // A diamond grows twice as fast as its label, so it keeps the label's own width.
      const s = shapeSize(shape, shape === 'diam' ? label.width : Math.max(label.width, minWidth), label.height);
      view = { node, style, label, shape, w: s.w, h: s.h, dy: s.dy, loops: 0 };
      c = cnode(s.w, s.h);
    }
    c.seq = views.length;
    views.push(view);
    cnodes.push(c);
  }
  graph.nodes.forEach((node, i) => {
    cnodes[i].parent = node.parentId !== undefined ? (index.get(node.parentId) ?? -1) : -1;
  });

  const rootDir = turned ? 'TB' : direction(db.direction);
  // The direction of the level a node sits in.
  const flowOf = (i: number): Dir => {
    let dir: Dir | undefined;
    for (let p = cnodes[i].parent, hops = 0; p >= 0 && dir === undefined && hops < 10000; p = cnodes[p].parent, hops++) {
      dir = cnodes[p].dir;
    }
    return dir ?? rootDir;
  };
  const flowsSideways = (i: number): boolean => {
    const dir = flowOf(i);
    return dir === 'LR' || dir === 'RL';
  };

  const depth = new Int32Array(cnodes.length).fill(-1);
  for (let i = 0; i < cnodes.length; i++) {
    const chain: number[] = [];
    let j = i;
    while (j >= 0 && depth[j] < 0 && chain.length <= cnodes.length) {
      chain.push(j);
      j = cnodes[j].parent;
    }
    let d = j >= 0 ? depth[j] + 1 : 0;
    for (let k = chain.length - 1; k >= 0; k--) depth[chain[k]] = d++;
  }
  const contains = (group: number, i: number): boolean => {
    let j = i;
    for (let d = depth[i]; d > depth[group]; d--) j = cnodes[j].parent;
    return j === group && i !== group;
  };

  const cedges: CEdge[] = [];
  const edgeLabels: Label[] = [];
  const drawn: GraphEdge[] = [];
  // Edges between a node and a container around it. The layout has no place for them, so they
  // are drawn afterwards, between the node and the container's border.
  const held: { edge: GraphEdge; label: Label; src: number; dst: number }[] = [];
  for (const edge of graph.edges) {
    const src = index.get(edge.start);
    const dst = index.get(edge.end);
    if (src === undefined || dst === undefined) continue;
    const label = layoutLabel(edge.label, edge.labelType === 'markdown', measurer, edgeSize, wrapWidth);
    if (contains(src, dst) || contains(dst, src)) {
      held.push({ edge, label, src, dst });
      continue;
    }
    if (src === dst) {
      // A self-loop sits beside the node, across the flow, and the node's box grows to hold it.
      views[src].loops++;
      if (flowsSideways(src)) cnodes[src].h += 2 * (LOOP + (label.height > 0 ? label.height + 8 : 0));
      else cnodes[src].w += 2 * (LOOP + (label.width > 0 ? label.width + 12 : 0));
    }
    drawn.push(edge);
    edgeLabels.push(label);
    cedges.push({
      src,
      dst,
      minlen: edge.minlen ?? 1,
      labelW: label.width > 0 ? label.width + 12 : 0,
      labelH: label.height > 0 ? label.height + 4 : 0,
      route: [],
      labelX: 0,
      labelY: 0,
    });
  }

  const layout = compoundLayout(cnodes, cedges, rootDir, {
    nodeSep: numberOption(config, 'nodeSpacing', NODE_SEP),
    edgeSep: EDGE_SEP,
    rankSep: numberOption(config, 'rankSpacing', RANK_SEP),
    portSep: 20,
  });

  const title = layoutLabel(db.title, false, measurer, size, 4000, Style.Bold);
  const titleHeight = title.height > 0 ? title.height + 12 : 0;
  const inner = Math.max(layout.width, title.width);
  const ox = pad + (inner - layout.width) / 2;
  const oy = pad + titleHeight;
  shiftLayout(cnodes, cedges, ox, oy);
  const width = Math.ceil(inner + 2 * pad);
  const height = Math.ceil(layout.height + titleHeight + 2 * pad);
  const links: LinkInfo[] = [];

  // An edge between a node and a container around it runs straight between the node and the
  // container's border: out along the flow, or in against it. If another node is in the way it
  // takes a side instead, and failing that the far end.
  const heldPaths: EdgePath[] = [];
  const heldLabels: number[] = [];
  const heldRoutes: number[][] = [];
  const careful = held.length * cnodes.length < 2e6;
  for (const { edge, src, dst } of held) {
    const out = contains(dst, src);
    const outer = out ? dst : src;
    const i = out ? src : dst;
    const g = cnodes[outer];
    const n = cnodes[i];
    const end = FLOW_END[g.dir ?? flowOf(outer)];
    const first = out ? end : (end + 2) & 3;
    const toward = (side: number): number[] => {
      const upright = (side & 1) === 0;
      const sign = side === 0 || side === 3 ? -1 : 1;
      const nx = upright ? n.x : n.x + (sign * n.w) / 2;
      const ny = upright ? n.y + (sign * n.h) / 2 : n.y;
      const bx = upright ? n.x : g.x + (sign * g.w) / 2;
      const by = upright ? g.y + (sign * g.h) / 2 : n.y;
      const axis = upright ? 0 : 1;
      return out ? [nx, ny, axis, bx, by, axis] : [bx, by, axis, nx, ny, axis];
    };
    const blocked = (r: number[]): boolean => {
      for (let k = 0; k < cnodes.length; k++) {
        const c = cnodes[k];
        if (
          k !== i &&
          !c.isGroup &&
          c.x + c.w / 2 > Math.min(r[0], r[3]) - 1 &&
          c.x - c.w / 2 < Math.max(r[0], r[3]) + 1 &&
          c.y + c.h / 2 > Math.min(r[1], r[4]) - 1 &&
          c.y - c.h / 2 < Math.max(r[1], r[4]) + 1
        ) {
          return true;
        }
      }
      return false;
    };
    let route = toward(first);
    if (careful && blocked(route)) {
      for (const side of [(first + 1) & 3, (first + 3) & 3, (first + 2) & 3]) {
        const other = toward(side);
        if (!blocked(other)) {
          route = other;
          break;
        }
      }
    }
    heldRoutes.push(route);
    heldLabels.push((route[0] + route[3]) / 2, (route[1] + route[4]) / 2);
    const drawnRoute = route.slice();
    insetRoute(drawnRoute, out ? 0 : 3, views[i], n);
    heldPaths.push(routePath(drawnRoute, 'linear', 0, markerTrim(edge.arrowTypeEnd)));
  }

  const crossings: Crossings = new Map();
  let anyGroup = false;
  for (const c of cnodes) if (c.isGroup) anyGroup = true;
  if (anyGroup) {
    for (const e of cedges) markCrossings(crossings, e.route);
    for (const route of heldRoutes) markCrossings(crossings, route);
  }

  let clusters = '';
  let nodesOut = '';
  for (let i = 0; i < views.length; i++) {
    const view = views[i];
    const c = cnodes[i];
    const node = view.node;
    const x = c.x;
    const y = c.y;
    const classes = classNames(node.cssClasses.replace(/^default\s?/, ''));
    const id = escText(node.id);
    if (c.isGroup) {
      const titleX = clusterTitleX(c, view.label.width, crossings, GROUP_PAD);
      clusters +=
        `<g class="pele-cluster pele-flow${classes}" data-id="${id}">` +
        `<rect x="${num(x - c.w / 2)}" y="${num(y - c.h / 2)}" width="${num(c.w)}" height="${num(c.h)}"${rounded(
          tint(node.colorIndex ?? KIND_SLOT.size, '0.06', view.style) + view.style.shape
        )}/>` +
        labelSvg(view.label, titleX, y - c.h / 2 + 8 + view.label.height / 2, ` class="pele-cluster-label" fill="var(--_m)"${view.style.text}`, icons) +
        '</g>';
      continue;
    }

    const w = view.w;
    const h = view.h;
    let kind = '';
    let shape: string;
    if (view.shape === COLLAPSED) {
      const color = seriesColor(node.colorIndex ?? KIND_SLOT.size);
      const line = h / 2 - DOTS - 2;
      const dots = line + (DOTS + 2) / 2;
      shape =
        `<rect x="${num(-w / 2)}" y="${num(-h / 2)}" width="${num(w)}" height="${num(h)}"${rounded(
          tint(node.colorIndex ?? KIND_SLOT.size, '0.06', view.style) + view.style.shape
        )}/>` +
        `<path d="M${num(-w / 2 + 10)},${num(line)}H${num(w / 2 - 10)}" fill="none" stroke="${color}" stroke-dasharray="3 3"${view.style.line}/>` +
        `<path class="pele-collapsed-mark" d="${dot(-9, dots)}${dot(0, dots)}${dot(9, dots)}" fill="${color}" stroke="none"/>`;
    } else {
      const slot = KIND_SLOT.get(node.kind ?? 'task') ?? 1;
      kind = ` pele-kind-${node.kind ?? 'task'}`;
      shape = drawShape(
        view.shape,
        w,
        h,
        tint(slot, '0.14', view.style) + view.style.shape,
        ` stroke="${seriesColor(slot)}"` + view.style.line
      );
    }

    let text = labelSvg(view.label, 0, view.dy, ` class="pele-label"${view.style.text}`, icons);
    const internal = / internal-link(?: |$)/.test(classes + ' ');
    if (internal && node.label && options.links !== false) {
      // The label is a note name, but it still ends up in an href, so it gets the same check as a URL.
      const name = decodeEntities(node.label);
      const safe = linkUrl(sanitizeUrl(name), options) !== undefined;
      const target = esc(name);
      text = `<a class="internal-link"${safe ? ` href="${target}"${relAttr(options)}` : ''} data-href="${target}">${text}</a>`;
      links.push({ id: node.id, href: name, internal: true });
    }
    let body = shape + text;
    if (node.tooltip) body = `<title>${escText(node.tooltip)}</title>` + body;
    if (node.link) body = linked(body, node.link, node.id, links, options, node.linkTarget ? ` target="${esc(node.linkTarget)}"` : '');
    nodesOut += `<g class="pele-node pele-shape-${view.shape}${kind}${classes}" data-id="${id}" transform="translate(${num(
      x
    )},${num(y)})">${body}</g>`;
  }

  let edgesOut = '';
  let labelsOut = '';
  const put = (edge: GraphEdge, label: Label, path: EdgePath, x: number, y: number): void => {
    const style =
      edge.style.length > 0 || edge.cssCompiledStyles.length > 0
        ? resolveStyle(edge.cssCompiledStyles.concat(edge.style))
        : undefined;
    const endType = edge.arrowTypeEnd;
    const color = style?.stroke ? esc(style.stroke) : 'var(--_l)';
    const kind = edge.thickness === 'dotted' ? 'reference' : endType === 'arrow_cross' ? 'failure' : 'sequence';
    const classes = classNames(edge.classes.replace(/edge-thickness-normal|edge-pattern-solid|flowchart-link/g, ''));
    edgesOut +=
      `<g class="pele-edge pele-edge-${kind}${classes}" data-id="${escText(edge.id)}"${style?.line ?? ''}>` +
      `<path d="${path.d}"${edge.thickness === 'dotted' ? ' stroke-dasharray="3 4"' : ''}/>` +
      marker(endType, path.ex, path.ey, path.edx, path.edy, color) +
      '</g>';
    if (label.width > 0) {
      labelsOut += edgeLabelSvg(edge.id, label, x, y, style?.text ?? '', icons);
    }
  };

  const loopSeen = new Map<number, number>();
  for (let i = 0; i < cedges.length; i++) {
    const ce = cedges[i];
    const edge = drawn[i];
    const label = edgeLabels[i];
    const endType = edge.arrowTypeEnd;
    let path: EdgePath;
    if (ce.src === ce.dst) {
      const view = views[ce.src];
      const k = loopSeen.get(ce.src) ?? 0;
      loopSeen.set(ce.src, k + 1);
      path = loopPath(cnodes[ce.src], view.w, view.h, k, flowsSideways(ce.src), LOOP, markerTrim(endType), ce);
    } else {
      const route = ce.route.slice();
      insetRoute(route, 0, views[ce.src], cnodes[ce.src]);
      insetRoute(route, route.length - 3, views[ce.dst], cnodes[ce.dst]);
      path = routePath(route, edge.curve, 0, markerTrim(endType));
    }
    put(edge, label, path, ce.labelX, ce.labelY);
  }
  held.forEach((h, i) => put(h.edge, h.label, heldPaths[i], heldLabels[2 * i], heldLabels[2 * i + 1]));

  const svg = svgDocument(
    'agentflow',
    width,
    height,
    size,
    options,
    db,
    labelSvg(title, width / 2, pad + title.height / 2, ' class="pele-title" font-weight="var(--_tw)"') +
      (clusters ? `<g class="pele-clusters">${clusters}</g>` : '') +
      (edgesOut ? `<g class="pele-edges" fill="none" stroke="var(--_l)" stroke-linecap="round">${edgesOut}</g>` : '') +
      (labelsOut ? `<g class="pele-edge-labels" font-size="${edgeSize}">${labelsOut}</g>` : '') +
      `<g class="pele-nodes">${nodesOut}</g>`
  );

  return { svg, width, height, links };
}

function dot(x: number, y: number): string {
  return `M${num(x - 1.75)},${num(y)}a1.75,1.75 0 1 0 3.5,0a1.75,1.75 0 1 0 -3.5,0Z`;
}
