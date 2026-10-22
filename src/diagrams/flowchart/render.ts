import { cnode, compoundLayout, direction, shiftLayout, type CEdge, type CNode, type CompoundResult, type Dir } from '../../layout/compound.js';
import { titleLabel } from '../../svg/title.js';
import type { LayeredOptions } from '../../layout/layered.js';
import type { Config } from '../../preprocess.js';
import { esc, escText, labelSvg, num } from '../../svg/builder.js';
import { clusterTitleX, markCrossings, struckTitle, titleCrossed, type Crossings } from '../../svg/cluster.js';
import { edgeLabelSvg, loopPath, marker, markerTrim, routePath, sideReach, type EdgePath } from '../../svg/edges.js';
import { svgDocument } from '../../svg/root.js';
import { drawShape, endSide, insetRoute, shapeHasLabel, shapeSize, shapeSpan } from '../../svg/shapes.js';
import { classNames, resolveStyle, rounded, type ResolvedStyle } from '../../svg/theme.js';
import { layoutLabel, type Label } from '../../text/label.js';
import { Style, defaultMeasurer } from '../../text/measurer.js';
import { decodeEntities } from '../../text/entities.js';
import { imageUrl, linked, linkUrl, relAttr, safeUrl, sanitizeUrl } from '../../util/url.js';
import type { IconResolver, LinkInfo, RenderOptions, Rendered } from '../../types.js';
import { runsAcross, tighten, titleRoom, turnToFit } from '../common/fit-width.js';
import type { FlowDb } from './db.js';
import { buildFlowGraph, type FlowGraph, type GraphEdge, type GraphNode } from './graph.js';
import { canonicalShape } from './shapes.js';

const NODE_SEP = 40;
const EDGE_SEP = 16;
const RANK_SEP = 48;
const GROUP_PAD = 20;
const LOOP = 26;
const SHAPE_ATTRS = ' fill="var(--_s)" stroke="var(--_b)"';
const LINE_ATTRS = ' stroke="var(--_b)"';

function numberOption(section: Config, key: string, fallback: number): number {
  const value = section[key];
  return typeof value === 'number' && value > 0 ? Math.min(value, 2000) : fallback;
}

// A diagram type that is a flowchart with a different layout, which may draw its top-level groups itself.
export interface FlowVariant {
  type: string;
  prepare(graph: FlowGraph): void;
  layout(nodes: CNode[], edges: CEdge[], dir: Dir, opt: LayeredOptions, tight: boolean): CompoundResult;
  drawGroup?(c: CNode, label: Label, style: ResolvedStyle, classes: string, id: string, dir: Dir, icons: IconResolver | undefined): string;
}

function assetSize(value: number | undefined, fallback: number): number {
  return value !== undefined && value > 0 && value <= 4000 ? value : fallback;
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

export function renderFlowchart(db: FlowDb, config: Config, options: RenderOptions, variant?: FlowVariant): Rendered {
  const fitted = (down: boolean): Rendered => tighten(options, (tight) => draw(db, config, options, variant, down, tight));
  return runsAcross(db.direction) ? turnToFit(options, fitted) : fitted(false);
}

// `turned` draws a flowchart that runs across as one that runs down. `tight` sets nodes closer together.
function draw(db: FlowDb, config: Config, options: RenderOptions, variant: FlowVariant | undefined, turned: boolean, tight: boolean): Rendered {
  const groupPad = tight ? 12 : GROUP_PAD;
  const own = variant ? config[variant.type] : undefined;
  const flow = (typeof own === 'object' && own !== null && !Array.isArray(own) ? own : (config.flowchart ?? {})) as Config;
  const graph = buildFlowGraph(db, typeof flow.curve === 'string' ? flow.curve : undefined);
  variant?.prepare(graph);
  const size = options.fontSize ?? 16;
  const edgeSize = Math.round(size * 0.875);
  const measurer = options.measurer ?? defaultMeasurer(options.fontFamily);
  const wrapWidth = Math.min(numberOption(flow, 'wrappingWidth', 200), variant && tight ? 100 : Infinity);
  const pad = options.padding ?? 8;
  const icons = options.icons;

  const index = new Map<string, number>();
  const views: NodeView[] = [];
  const cnodes: CNode[] = [];
  graph.nodes.forEach((node, i) => index.set(node.id, i));

  for (const node of graph.nodes) {
    const style = resolveStyle(
      node.cssStyles.length > 0 ? node.cssCompiledStyles.concat(node.cssStyles) : node.cssCompiledStyles
    );
    const textStyle = (style.bold ? Style.Bold : 0) | (style.italic ? Style.Italic : 0);
    const markdown = node.labelType === 'markdown';
    const fontSize = style.fontSize ?? size;
    let view: NodeView;
    let c: CNode;
    if (node.isGroup) {
      const label = layoutLabel(node.label, markdown, measurer, fontSize, variant && tight ? Math.max(80, titleRoom(options) / 2) : 4000, textStyle);
      view = { node, style, label, shape: 'group', w: 0, h: 0, dy: 0, loops: 0 };
      c = cnode(0, 0);
      c.isGroup = true;
      c.dir = node.dir ? direction(node.dir) : undefined;
      c.padX = groupPad;
      c.padTop = label.height > 0 ? label.height + 16 : GROUP_PAD;
      c.padBottom = groupPad;
      c.minW = label.width + 2 * groupPad - 12;
    } else {
      const shape = canonicalShape(node.shape);
      const text = node.img || node.icon || shapeHasLabel(shape) ? node.label : undefined;
      const label = layoutLabel(text, markdown, measurer, fontSize, wrapWidth, textStyle);
      let w: number;
      let h: number;
      let dy = 0;
      if (node.img || node.icon) {
        const box = node.img ? 80 : 48;
        const aw = assetSize(node.assetWidth, box);
        const ah = assetSize(node.assetHeight, box);
        w = Math.max(aw, label.width + 8);
        h = ah + (label.height > 0 ? label.height + 6 : 0);
        dy = node.pos === 't' ? -ah / 2 : ah / 2;
        if (label.height === 0) dy = 0;
      } else {
        const s = shapeSize(shape, label.width, label.height);
        w = s.w;
        h = s.h;
        dy = s.dy;
      }
      view = { node, style, label, shape, w, h, dy, loops: 0 };
      c = cnode(w, h);
    }
    c.seq = views.length;
    views.push(view);
    cnodes.push(c);
  }
  graph.nodes.forEach((node, i) => {
    cnodes[i].parent = node.parentId !== undefined ? (index.get(node.parentId) ?? -1) : -1;
  });

  const rootDir = turned ? 'TB' : direction(db.direction);
  const flowsSideways = (i: number): boolean => {
    let dir: Dir | undefined;
    for (let p = cnodes[i].parent, hops = 0; p >= 0 && dir === undefined && hops < 10000; p = cnodes[p].parent, hops++) {
      dir = cnodes[p].dir;
    }
    dir ??= rootDir;
    return dir === 'LR' || dir === 'RL';
  };
  // The edges on one side of a node spread along it; a picture or an icon keeps them at its middle.
  views.forEach((view, i) => {
    if (view.node.isGroup) cnodes[i].span = Infinity;
    else if (!view.node.img && !view.node.icon) cnodes[i].span = shapeSpan(view.shape, view.w, view.h, flowsSideways(i));
  });

  const cedges: CEdge[] = [];
  const edgeLabels: Label[] = [];
  const drawn: GraphEdge[] = [];
  for (const edge of graph.edges) {
    const src = index.get(edge.start);
    const dst = index.get(edge.end);
    if (src === undefined || dst === undefined) continue;
    const label = layoutLabel(edge.label, edge.labelType === 'markdown', measurer, edgeSize, wrapWidth);
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

  const layoutOptions: LayeredOptions = {
    nodeSep: numberOption(flow, 'nodeSpacing', NODE_SEP) * (tight ? 0.5 : 1),
    edgeSep: EDGE_SEP,
    rankSep: numberOption(flow, 'rankSpacing', RANK_SEP) * (tight ? 0.75 : 1),
    portSep: 20,
    tracks: typeof flow.curve === 'string' && /^step/.test(flow.curve),
    straight: flow.curve === 'linear',
    headRoom: markerTrim('arrow_point'),
  };
  const layout = variant
    ? variant.layout(cnodes, cedges, rootDir, layoutOptions, tight)
    : compoundLayout(cnodes, cedges, rootDir, layoutOptions);

  const title = titleLabel(db.title, measurer, size, tight ? titleRoom(options) : 4000);
  const titleHeight = title.height > 0 ? title.height + 12 : 0;
  const inner = Math.max(layout.width, title.width);
  const ox = pad + (inner - layout.width) / 2;
  const oy = pad + titleHeight;
  shiftLayout(cnodes, cedges, ox, oy);
  const width = Math.ceil(inner + 2 * pad);
  const height = Math.ceil(layout.height + titleHeight + 2 * pad);
  const links: LinkInfo[] = [];

  const crossings: Crossings = new Map();
  let anyGroup = false;
  for (const c of cnodes) if (c.isGroup) anyGroup = true;
  if (anyGroup) {
    for (const e of cedges) markCrossings(crossings, e.route);
  }

  let clusters = '';
  let struckTitles = '';
  let nodesOut = '';
  for (let i = 0; i < views.length; i++) {
    const view = views[i];
    const c = cnodes[i];
    const node = view.node;
    const x = c.x;
    const y = c.y;
    const classes = classNames(node.cssClasses.replace(/^default\s?/, ''));
    const id = escText(node.id);
    if (c.isGroup && variant?.drawGroup && c.parent < 0) {
      clusters += variant.drawGroup(c, view.label, view.style, classes, id, rootDir, icons);
      continue;
    }
    if (c.isGroup) {
      const titleX = clusterTitleX(c, view.label.width, crossings, groupPad);
      const titleY = y - c.h / 2 + 8 + view.label.height / 2;
      const titleAttrs = ` class="pele-cluster-label" fill="var(--_m)"${view.style.text}`;
      const struck = titleCrossed(c, view.label.width, titleX, crossings);
      if (struck) struckTitles += struckTitle(view.label, titleX, titleY, titleAttrs, id, cnodes, i, icons);
      clusters +=
        `<g class="pele-cluster${classes}" data-id="${id}">` +
        `<rect x="${num(x - c.w / 2)}" y="${num(y - c.h / 2)}" width="${num(c.w)}" height="${num(c.h)}" fill="var(--_a)" fill-opacity="0.5" stroke="var(--_b)"${rounded(view.style.shape)}/>` +
        (struck ? '' : labelSvg(view.label, titleX, titleY, titleAttrs, icons)) +
        '</g>';
      continue;
    }

    const w = view.w;
    const h = view.h;
    let inner: string;
    if (node.img) {
      const aw = assetSize(node.assetWidth, 80);
      const ah = assetSize(node.assetHeight, 80);
      const top = view.label.height > 0 ? (node.pos === 't' ? h / 2 - ah : -h / 2) : -ah / 2;
      const src = imageUrl(safeUrl(node.img), options);
      inner =
        src === undefined
          ? ''
          : `<image href="${esc(src)}" x="${num(-aw / 2)}" y="${num(top)}" width="${num(aw)}" height="${num(ah)}" preserveAspectRatio="${
              node.constraint === 'on' ? 'xMidYMid meet' : 'none'
            }"/>`;
    } else if (node.icon) {
      const box = assetSize(node.assetHeight, 48);
      const top = view.label.height > 0 ? (node.pos === 't' ? h / 2 - box : -h / 2) : -box / 2;
      const frame =
        node.shape === 'icon'
          ? ''
          : node.shape === 'iconCircle'
            ? `<circle cy="${num(top + box / 2)}" r="${num(box / 2)}"${SHAPE_ATTRS}${view.style.shape}/>`
            : `<rect x="${num(-box / 2)}" y="${num(top)}" width="${num(box)}" height="${num(box)}" rx="${
                node.shape === 'iconRounded' ? 8 : 0
              }"${SHAPE_ATTRS}${view.style.shape}/>`;
      const glyph = box * 0.6;
      inner =
        frame +
        `<svg class="pele-icon" data-icon="${escText(node.icon)}" x="${num(-glyph / 2)}" y="${num(
          top + (box - glyph) / 2
        )}" width="${num(glyph)}" height="${num(glyph)}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${
          icons?.(node.icon) ?? ''
        }</svg>`;
    } else {
      inner = drawShape(view.shape, w, h, SHAPE_ATTRS + view.style.shape, LINE_ATTRS + view.style.line);
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
    let body = inner + text;
    if (node.tooltip) body = `<title>${escText(node.tooltip)}</title>` + body;
    if (node.link) body = linked(body, node.link, node.id, links, options, node.linkTarget ? ` target="${esc(node.linkTarget)}"` : '');
    nodesOut += `<g class="pele-node pele-shape-${view.shape}${classes}" data-id="${id}" transform="translate(${num(
      x
    )},${num(y)})">${body}</g>`;
  }

  const reach = sideReach();
  for (let i = 0; i < cedges.length; i++) {
    const ce = cedges[i];
    if (ce.src === ce.dst || drawn[i].thickness === 'invisible' || ce.route.length < 6) continue;
    reach.add(ce.src, endSide(ce.route, 0, cnodes[ce.src]), drawn[i].arrowTypeStart);
    reach.add(ce.dst, endSide(ce.route, ce.route.length - 3, cnodes[ce.dst]), drawn[i].arrowTypeEnd);
  }

  let edgesOut = '';
  let labelsOut = '';
  const loopSeen = new Map<number, number>();
  for (let i = 0; i < cedges.length; i++) {
    const ce = cedges[i];
    const edge = drawn[i];
    const label = edgeLabels[i];
    const style = edge.style.length > 0 || edge.cssCompiledStyles.length > 0 ? resolveStyle(edge.cssCompiledStyles.concat(edge.style)) : undefined;
    if (edge.thickness !== 'invisible') {
      const startType = edge.arrowTypeStart;
      const endType = edge.arrowTypeEnd;
      let path: EdgePath;
      if (ce.src === ce.dst) {
        const view = views[ce.src];
        const k = loopSeen.get(ce.src) ?? 0;
        loopSeen.set(ce.src, k + 1);
        path = loopPath(cnodes[ce.src], view.w, view.h, k, flowsSideways(ce.src), LOOP, markerTrim(endType), ce);
      } else {
        const route = ce.route.slice();
        const leaves = reach.of(ce.src, endSide(route, 0, cnodes[ce.src]));
        const arrives = reach.of(ce.dst, endSide(route, route.length - 3, cnodes[ce.dst]));
        insetRoute(route, 0, views[ce.src], cnodes[ce.src]);
        insetRoute(route, route.length - 3, views[ce.dst], cnodes[ce.dst]);
        path = routePath(route, edge.curve, markerTrim(startType), markerTrim(endType), leaves, arrives);
      }
      const color = style?.stroke && edge.thickness !== 'invisible' ? esc(style.stroke) : 'var(--_l)';
      let attrs = '';
      if (edge.thickness === 'thick') attrs += ' stroke-width="2.5"';
      else if (edge.thickness === 'dotted') attrs += ' stroke-dasharray="3 4"';
      const classes = classNames(edge.classes.replace(/edge-thickness-normal|edge-pattern-solid|flowchart-link/g, ''));
      edgesOut +=
        `<g class="pele-edge${classes}" data-id="${escText(edge.id)}"${style?.line ?? ''}>` +
        `<path d="${path.d}"${attrs}/>` +
        marker(startType, path.sx, path.sy, path.sdx, path.sdy, color) +
        marker(endType, path.ex, path.ey, path.edx, path.edy, color) +
        '</g>';
    }
    if (label.width > 0) {
      const x = ce.labelX;
      const y = ce.labelY;
      labelsOut += edgeLabelSvg(edge.id, label, x, y, style?.text ?? '', icons);
    }
  }

  const svg = svgDocument(
    variant?.type ?? 'flowchart',
    width,
    height,
    size,
    options,
    db,
    labelSvg(title, width / 2, pad + title.height / 2, ' class="pele-title" font-weight="var(--_tw)"') +
      (clusters ? `<g class="pele-clusters">${clusters}</g>` : '') +
      (edgesOut ? `<g class="pele-edges" fill="none" stroke="var(--_l)" stroke-linecap="round">${edgesOut}</g>` : '') +
      (struckTitles ? `<g class="pele-cluster-titles">${struckTitles}</g>` : '') +
      (labelsOut ? `<g class="pele-edge-labels" font-size="${edgeSize}">${labelsOut}</g>` : '') +
      `<g class="pele-nodes">${nodesOut}</g>`
  );

  return { svg, width, height, links };
}
