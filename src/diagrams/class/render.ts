import { cnode, compoundLayout, direction, type CEdge, type CNode } from '../../layout/compound.js';
import type { Config } from '../../preprocess.js';
import { esc, escText, labelSvg, num } from '../../svg/builder.js';
import { clusterTitleX, markCrossings, struckTitle, titleCrossed, type Crossings } from '../../svg/cluster.js';
import { edgeLabelSvg, routePath, type EdgePath } from '../../svg/edges.js';
import { svgDocument } from '../../svg/root.js';
import { endSide } from '../../svg/shapes.js';
import { withTitle } from '../../svg/title.js';
import { ROUNDED, classNames, resolveStyle, rounded, type ResolvedStyle } from '../../svg/theme.js';
import { decodeEntities } from '../../text/entities.js';
import { hasMath, layoutLabel, type Label } from '../../text/label.js';
import { Style, defaultMeasurer, type TextMeasurer } from '../../text/measurer.js';
import type { LinkInfo, RenderOptions, Rendered } from '../../types.js';
import { runsAcross, tighten, turnToFit } from '../common/fit-width.js';
import { linked } from '../../util/url.js';
import type { ClassDb } from './db.js';
import { buildClassGraph, type GraphEdge, type GraphNode } from './graph.js';
import { classMarker, classMarkerTrim } from './markers.js';
import { parseGenericTypes } from '../common/generics.js';
import type { ClassMember } from './members.js';
import type { ClassNode } from './types.js';

const NODE_SEP = 40;
const EDGE_SEP = 16;
const RANK_SEP = 56;
const GROUP_PAD = 20;
const LOOP = 26;
const PAD_X = 12;
const TITLE_PAD = 8;
const SECTION_PAD = 6;
const EMPTY_SECTION = 10;
const MIN_WIDTH = 64;
const FOLD = 8;
const LINE = 'var(--_l)';
const TARGETS = new Set(['_self', '_blank', '_parent', '_top']);

function numberOption(config: Config, key: string, fallback: number): number {
  const value = config[key];
  return typeof value === 'number' && value > 0 ? Math.min(value, 2000) : fallback;
}

interface Line {
  text: string;
  width: number;
  classifier: string;
}

interface View {
  node: GraphNode;
  style: ResolvedStyle;
  label: Label;
  w: number;
  h: number;
  loops: number;
  annotations: (string | Label)[];
  attributes: Line[];
  methods: Line[];
  titleH: number;
  attributesH: number;
  fontSize: number;
}

interface End {
  route: number[];
  at: number;
  toward: number;
  order: number;
  room: number;
  side: number;
  // Whether the text of this end goes on the right of, or below, its line.
  after: boolean;
}

const NO_LINES: Line[] = [];
const NO_TEXT: string[] = [];

function memberLine(member: ClassMember, measurer: TextMeasurer, size: number): Line {
  const text = decodeEntities(member.getDisplayDetails().displayText).trim();
  return { text, width: measurer.width(text, size, member.classifier === '*' ? Style.Italic : 0), classifier: member.classifier };
}

export function renderClass(db: ClassDb, config: Config, options: RenderOptions): Rendered {
  const fitted = (down: boolean): Rendered => tighten(options, (tight) => draw(db, config, options, down, tight));
  return runsAcross(db.direction) ? turnToFit(options, fitted) : fitted(false);
}

// `turned` draws a diagram that runs across as one that runs down. `tight` gives up the room
// that keeps a namespace's name clear of an edge coming in beside it.
function draw(db: ClassDb, config: Config, options: RenderOptions, turned: boolean, tight: boolean): Rendered {
  const conf = (config.class ?? {}) as Config;
  const graph = buildClassGraph(db, conf.hierarchicalNamespaces !== false);
  const hideEmpty = conf.hideEmptyMembersBox === true;
  const size = options.fontSize ?? 16;
  const small = Math.round(size * 0.875);
  const tiny = Math.round(size * 0.8);
  const tinyHeight = Math.round(tiny * 1.4);
  const measurer = options.measurer ?? defaultMeasurer(options.fontFamily);
  const pad = options.padding ?? 8;
  // Keep annotations and cardinalities literal unless math is typeset.
  const mathText = (raw: string, fontSize: number): Label | undefined => {
    if (!raw.includes('$$')) return undefined;
    const label = layoutLabel(raw, false, measurer, fontSize, 4000);
    return label.lines.some(hasMath) ? label : undefined;
  };
  const cardWidth = (raw: string): number => (raw ? (mathText(raw, tiny)?.width ?? measurer.width(decodeEntities(raw), tiny, 0)) : 0);
  const rootDir = turned ? 'TB' : direction(db.direction);

  // A class may carry the declarations of many classDefs many times over. Each distinct declaration
  // is checked once, and only the last value of each property that has an effect is resolved.
  const effect = new Map<string, string>();
  const fromDefs = new Map<string, [string, string][]>();
  const kept = new Map<string, string>();
  const keep = (decl: string): void => {
    let prop = effect.get(decl);
    if (prop === undefined) {
      const one = resolveStyle([decl]);
      prop = one.shape === '' && one.text === '' ? '' : decl.slice(0, decl.indexOf(':')).trim().toLowerCase();
      effect.set(decl, prop);
    }
    if (prop !== '') kept.set(prop, decl);
  };
  const classStyle = (cls: ClassNode): ResolvedStyle => {
    kept.clear();
    let base = fromDefs.get(cls.cssClasses);
    if (base === undefined) {
      for (const name of cls.cssClasses.split(' ')) {
        const def = db.styleClasses.get(name);
        if (def) for (const s of def.styles) for (const part of s.split(',')) keep(part);
      }
      base = [...kept];
      fromDefs.set(cls.cssClasses, base);
    } else {
      for (const [prop, decl] of base) kept.set(prop, decl);
    }
    for (const s of cls.styles) keep(s);
    return resolveStyle(kept.size === 0 ? NO_TEXT : [...kept.values()]);
  };

  const children = new Int32Array(graph.nodes.length);
  for (const node of graph.nodes) if (node.parent >= 0) children[node.parent]++;

  // Namespaces that an edge may cross into are made wide enough for the title to sit beside it.
  const crossed = new Uint8Array(graph.nodes.length);
  for (const edge of graph.edges) {
    if (edge.source < 0 || edge.target < 0) continue;
    const a = graph.nodes[edge.source].parent;
    const b = graph.nodes[edge.target].parent;
    if (a === b) continue;
    for (let g = a; g >= 0 && crossed[g] === 0; g = graph.nodes[g].parent) crossed[g] = 1;
    for (let g = b; g >= 0 && crossed[g] === 0; g = graph.nodes[g].parent) crossed[g] = 1;
  }

  const views: View[] = [];
  const cnodes: CNode[] = [];
  graph.nodes.forEach((node, i) => {
    let view: View;
    let c: CNode;
    if (node.isGroup) {
      const label = layoutLabel(node.label, false, measurer, size, 4000);
      view = base(node, label, 0, 0, size);
      if (children[i] > 0) {
        c = cnode(0, 0);
        c.isGroup = true;
        c.padX = GROUP_PAD;
        c.padTop = label.height > 0 ? label.height + 16 : GROUP_PAD;
        c.padBottom = GROUP_PAD;
        c.minW = label.width + 2 * GROUP_PAD - 12 + (crossed[i] === 1 && !tight ? Math.min(label.width + 24, 240) : 0);
      } else {
        view.w = Math.max(label.width + 2 * GROUP_PAD, 80);
        view.h = label.height + 2 * GROUP_PAD;
        c = cnode(view.w, view.h);
      }
    } else if (node.classNode) {
      view = classView(node, node.classNode);
      c = cnode(view.w, view.h);
    } else if (node.shape === 'note') {
      const label = layoutLabel(node.label, true, measurer, small, 260);
      view = base(node, label, Math.max(label.width + 2 * PAD_X, 40), label.height + 2 * TITLE_PAD, small);
      c = cnode(view.w, view.h);
    } else {
      const label = layoutLabel(node.label, false, measurer, small, 200);
      view = base(node, label, Math.max(label.width, 12) + 4, Math.max(label.height, 12), small);
      c = cnode(view.w, view.h);
    }
    c.parent = node.parent;
    c.seq = i;
    views.push(view);
    cnodes.push(c);
  });

  function base(node: GraphNode, label: Label, w: number, h: number, fontSize: number): View {
    return {
      node,
      style: resolveStyle(NO_TEXT),
      label,
      w,
      h,
      loops: 0,
      annotations: NO_TEXT,
      attributes: NO_LINES,
      methods: NO_LINES,
      titleH: 0,
      attributesH: 0,
      fontSize,
    };
  }

  function classView(node: GraphNode, cls: ClassNode): View {
    const style = classStyle(cls);
    const fontSize = style.fontSize ?? size;
    const memberSize = Math.round(fontSize * 0.875);
    const lineHeight = Math.round(memberSize * 1.5);
    // The generic type is escaped so that `<T>` is not read as a tag.
    const generic = cls.type ? '&lt;' + parseGenericTypes(cls.type).replace(/</g, '&lt;').replace(/>/g, '&gt;') + '&gt;' : '';
    const label = layoutLabel(cls.label + generic, false, measurer, fontSize, 4000, Style.Bold | (style.italic ? Style.Italic : 0));
    const annotations = cls.annotations.length > 0 ? cls.annotations.map((a) => mathText(`«${a.trim()}»`, tiny) ?? `«${decodeEntities(a).trim()}»`) : NO_TEXT;
    const attributes = cls.members.length > 0 ? cls.members.map((m) => memberLine(m, measurer, memberSize)) : NO_LINES;
    const methods = cls.methods.length > 0 ? cls.methods.map((m) => memberLine(m, measurer, memberSize)) : NO_LINES;
    let inner = label.width;
    let annotationsH = 0;
    for (const a of annotations) {
      inner = Math.max(inner, typeof a === 'string' ? measurer.width(a, tiny, 0) : a.width);
      annotationsH += typeof a === 'string' ? tinyHeight : Math.max(tinyHeight, a.height);
    }
    for (const line of attributes) inner = Math.max(inner, line.width);
    for (const line of methods) inner = Math.max(inner, line.width);
    const sections = !(hideEmpty && attributes.length === 0 && methods.length === 0);
    const section = (count: number): number => (!sections ? 0 : count > 0 ? 2 * SECTION_PAD + count * lineHeight : EMPTY_SECTION);
    const titleH = 2 * TITLE_PAD + annotationsH + Math.max(label.height, Math.round(fontSize * 1.5));
    const attributesH = section(attributes.length);
    return {
      node,
      style,
      label,
      w: Math.max(inner + 2 * PAD_X, MIN_WIDTH),
      h: titleH + attributesH + section(methods.length),
      loops: 0,
      annotations,
      attributes,
      methods,
      titleH,
      attributesH,
      fontSize,
    };
  }

  const cedges: CEdge[] = [];
  const drawn: GraphEdge[] = [];
  const edgeLabels: Label[] = [];
  const startRoom: number[] = [];
  const endRoom: number[] = [];
  // Edges leave one side of a class and arrive at the other, so a class with many of them
  // is widened until they, and the text at their ends, fit side by side.
  const crowd = new Float64Array(views.length * 4);
  const meet = (item: number, slot: number, room: number): void => {
    crowd[item * 4 + slot]++;
    if (room > crowd[item * 4 + slot + 1]) crowd[item * 4 + slot + 1] = room;
  };
  for (const edge of graph.edges) {
    if (edge.source < 0 || edge.target < 0) continue;
    const label = layoutLabel(edge.label, true, measurer, small, 200);
    const startW = cardWidth(edge.startLabelRight);
    const endW = cardWidth(edge.endLabelLeft);
    if (edge.source === edge.target) {
      views[edge.source].loops++;
      cnodes[edge.source].w += 2 * (LOOP + (label.width > 0 ? label.width + 12 : 0));
    } else {
      meet(edge.source, 0, startW);
      meet(edge.target, 2, endW);
    }
    startRoom.push(startW);
    endRoom.push(endW);
    drawn.push(edge);
    edgeLabels.push(label);
    cedges.push({
      src: edge.source,
      dst: edge.target,
      minlen: 1,
      labelW: label.width > 0 ? label.width + 12 : 0,
      labelH: label.height > 0 ? label.height + 4 : 0,
      route: [],
      labelX: 0,
      labelY: 0,
    });
  }

  if (rootDir === 'TB' || rootDir === 'BT') {
    for (let i = 0; i < views.length; i++) {
      if (!views[i].node.classNode) continue;
      let need = 0;
      for (let slot = 0; slot < 4; slot += 2) {
        const count = crowd[i * 4 + slot];
        const room = crowd[i * 4 + slot + 1];
        if (count > 1) need = Math.max(need, (count - 1) * (room > 0 ? room + 24 : 14) + 24);
      }
      need = Math.min(need, 480);
      if (need > views[i].w) {
        cnodes[i].w += need - views[i].w;
        views[i].w = need;
      }
    }
  }

  let lettered = false;
  for (let i = 0; i < drawn.length && !lettered; i++) lettered = startRoom[i] > 0 || endRoom[i] > 0;
  // Cardinalities at both ends of a vertical edge need room for their height between the ranks.
  let tallCards = 0;
  if (rootDir === 'TB' || rootDir === 'BT') {
    const cardHeight = (raw: string): number => (raw ? Math.max(tinyHeight, mathText(raw, tiny)?.height ?? 0) : 0);
    for (const edge of drawn) tallCards = Math.max(tallCards, cardHeight(edge.startLabelRight) + cardHeight(edge.endLabelLeft) - 2 * tinyHeight);
  }
  const layout = compoundLayout(cnodes, cedges, rootDir, {
    nodeSep: numberOption(conf, 'nodeSpacing', NODE_SEP),
    edgeSep: EDGE_SEP,
    rankSep: numberOption(conf, 'rankSpacing', lettered ? RANK_SEP + 16 : RANK_SEP) + tallCards,
    portSep: 20,
    apart: true,
  });

  // Every edge reaches the middle of a side. Where several share a side they are spread along it,
  // in the order of where they come from. An end with text runs straight for the length of the text,
  // which sits beside it on the side the line then bends toward, away from the neighbors that bend
  // the other way. Neighbors are set apart far enough for the text between them.
  const sides = new Map<number, End[]>();
  const cards: { text: string; math: Label | undefined; x: number; y: number }[] = [];
  const attach = (ce: CEdge, at: number, item: number, room: number, order: number): End | undefined => {
    const route = ce.route;
    const c = cnodes[item];
    const side = endSide(route, at, c);
    if (side < 0) return undefined;
    const slack = (c.w - views[item].w) / 2;
    if (side === 1) route[at] -= slack;
    else if (side === 3) route[at] += slack;
    const across = side & 1;
    const toward = route[(at === 0 ? 3 : at - 3) + across];
    const bend = toward - route[at + across];
    const end: End = { route, at, toward, order, room, side, after: across ? bend > 0 : bend >= 0 };
    const key = item * 4 + side;
    const list = sides.get(key);
    if (list) list.push(end);
    else sides.set(key, [end]);
    return end;
  };
  const starts: (End | undefined)[] = [];
  const ends: (End | undefined)[] = [];
  for (let i = 0; i < cedges.length; i++) {
    const ce = cedges[i];
    const routed = ce.src !== ce.dst && ce.route.length >= 6;
    starts.push(routed ? attach(ce, 0, ce.src, startRoom[i], i) : undefined);
    ends.push(routed ? attach(ce, ce.route.length - 3, ce.dst, endRoom[i], i) : undefined);
  }
  // Whether a point lies on the border of one of the namespaces around a class.
  const onBorder = (item: number, x: number, y: number): boolean => {
    for (let g = cnodes[item].parent, hops = 0; g >= 0 && hops < 10000; g = cnodes[g].parent, hops++) {
      const c = cnodes[g];
      const dx = Math.abs(x - c.x);
      const dy = Math.abs(y - c.y);
      if ((Math.abs(dy - c.h / 2) < 0.5 && dx <= c.w / 2 + 0.5) || (Math.abs(dx - c.w / 2) < 0.5 && dy <= c.h / 2 + 0.5)) return true;
    }
    return false;
  };
  const gaps: number[] = [];
  for (const [key, list] of sides) {
    if (list.length < 2) continue;
    const item = key >> 2;
    const across = key & 1;
    const length = across ? views[item].h : views[item].w;
    list.sort((a, b) => a.toward - b.toward || a.order - b.order);
    let total = 0;
    for (let j = 0; j + 1 < list.length; j++) {
      const a = list[j];
      const b = list[j + 1];
      let gap = across ? 20 : 24;
      if (a.room > 0 && a.after) gap += across ? tinyHeight + 6 : a.room;
      if (b.room > 0 && !b.after) gap += across ? tinyHeight + 6 : b.room;
      gaps[j] = gap;
      total += gap;
    }
    const scale = Math.min(1, (length - 24) / total);
    if (scale <= 0) continue;
    let at = (across ? cnodes[item].y : cnodes[item].x) - (total * scale) / 2;
    for (let j = 0; j < list.length; j++) {
      const { route, at: end } = list[j];
      // An edge that crosses the border of the class's namespace close by runs straight to it:
      // the point where it crosses moves into line with its end.
      const step = end === 0 ? 3 : -3;
      const first = end + step;
      let border = -1;
      for (let k = first; k >= 0 && k < route.length && Math.abs(route[k + across] - route[first + across]) < 0.5; k += step) {
        if (onBorder(item, route[k], route[k + 1])) {
          border = k;
          break;
        }
      }
      if (border >= 0 && Math.abs(route[first + across] - at) <= 24) for (let k = first; k !== border + step; k += step) route[k + across] = at;
      route[end + across] = at;
      at += gaps[j] * scale;
    }
  }

  const straighten = (route: number[], end: End | undefined, room: number, first: boolean): void => {
    if (end === undefined || room <= 0) return;
    const across = end.side & 1;
    const at = first ? 0 : route.length - 3;
    const along = at + 1 - across;
    const reach = Math.abs(route[(first ? 3 : at - 3) + 1 - across] - route[along]);
    const length = Math.min(across ? room + 10 : tinyHeight + 6, reach * 0.35);
    if (length < 4) return;
    const point = [route[at], route[at + 1], route[at + 2]];
    point[1 - across] += (end.side === 0 || end.side === 3 ? -1 : 1) * length;
    route.splice(first ? 3 : at, 0, point[0], point[1], point[2]);
  };
  for (let i = 0; i < cedges.length; i++) {
    straighten(cedges[i].route, starts[i], startRoom[i], true);
    straighten(cedges[i].route, ends[i], endRoom[i], false);
  }

  let minX = 0;
  let minY = 0;
  let maxX = layout.width;
  let maxY = layout.height;
  const card = (raw: string, width: number, x: number, y: number, side: number, after: boolean): void => {
    if (!raw) return;
    const math = mathText(raw, tiny);
    const h = math ? Math.max(tinyHeight, math.height) : tinyHeight;
    let cx = x;
    let cy = y;
    if (side & 1) {
      cx += (side === 3 ? -1 : 1) * (5 + width / 2);
      cy += (after ? 1 : -1) * (7 + h / 2);
    } else {
      cx += (after ? 1 : -1) * (9 + width / 2);
      cy += (side === 0 ? -1 : 1) * (3 + h / 2);
    }
    cards.push({ text: decodeEntities(raw), math, x: cx, y: cy });
    minX = Math.min(minX, cx - width / 2);
    maxX = Math.max(maxX, cx + width / 2);
    minY = Math.min(minY, cy - h / 2);
    maxY = Math.max(maxY, cy + h / 2);
  };
  const loopSeen = new Map<number, number>();
  const loopAt = new Int32Array(cedges.length);
  for (let i = 0; i < cedges.length; i++) {
    const ce = cedges[i];
    const edge = drawn[i];
    const route = ce.route;
    if (ce.src === ce.dst) {
      const k = loopSeen.get(ce.src) ?? 0;
      loopSeen.set(ce.src, k + 1);
      loopAt[i] = k;
      const c = cnodes[ce.src];
      const view = views[ce.src];
      const x = c.x + view.w / 2;
      const spread = Math.min(view.h / 2 - 4, 8 + k * 6);
      card(edge.startLabelRight, startRoom[i], x, c.y - spread, 1, false);
      card(edge.endLabelLeft, endRoom[i], x, c.y + spread, 1, true);
    } else if (route.length >= 6) {
      const last = route.length - 3;
      const from = starts[i];
      const to = ends[i];
      card(edge.startLabelRight, startRoom[i], route[0], route[1], from ? from.side : 2, from ? from.after : true);
      card(edge.endLabelLeft, endRoom[i], route[last], route[last + 1], to ? to.side : 0, to ? to.after : true);
    }
  }

  const ox = pad - minX;
  const oy = pad - minY;
  const width = Math.ceil(maxX - minX + 2 * pad);
  const height = Math.ceil(maxY - minY + 2 * pad);
  const links: LinkInfo[] = [];

  const crossings: Crossings = new Map();
  if (graph.nodes.length > 0 && graph.nodes[0].isGroup) {
    for (const e of cedges) markCrossings(crossings, e.route);
  }

  let clusters = '';
  let struckTitles = '';
  let nodesOut = '';
  for (let i = 0; i < views.length; i++) {
    const view = views[i];
    const c = cnodes[i];
    const node = view.node;
    const x = c.x + ox;
    const y = c.y + oy;
    const id = escText(node.id);
    const w = c.isGroup ? c.w : view.w;
    const h = c.isGroup ? c.h : view.h;
    if (node.isGroup) {
      const titleX = c.isGroup ? clusterTitleX(c, view.label.width, crossings, GROUP_PAD) : c.x;
      const titleY = y - h / 2 + 8 + view.label.height / 2;
      const titleAttrs = ' class="pele-cluster-label" fill="var(--_m)"';
      const struck = c.isGroup && titleCrossed(c, view.label.width, titleX, crossings);
      if (struck) struckTitles += struckTitle(view.label, titleX + ox, titleY, titleAttrs, id, graph.nodes, i);
      clusters +=
        `<g class="pele-cluster pele-namespace" data-id="${id}">` +
        `<rect x="${num(x - w / 2)}" y="${num(y - h / 2)}" width="${num(w)}" height="${num(h)}" fill="var(--_a)" fill-opacity="0.5" stroke="var(--_b)"${ROUNDED}/>` +
        (struck ? '' : labelSvg(view.label, titleX + ox, titleY, titleAttrs)) +
        '</g>';
      continue;
    }
    const at = ` transform="translate(${num(x)},${num(y)})"`;
    if (node.classNode) {
      nodesOut += classSvg(view, node.classNode, id, at);
    } else if (node.shape === 'note') {
      const r = w / 2;
      const t = -h / 2;
      nodesOut +=
        `<g class="pele-node pele-note" data-id="${id}"${at}>` +
        `<path d="M${num(-r)},${num(t)}H${num(r - FOLD)}L${num(r)},${num(t + FOLD)}V${num(-t)}H${num(-r)}Z" fill="var(--_a)" stroke="var(--_b)" stroke-linejoin="round"/>` +
        `<path d="M${num(r - FOLD)},${num(t)}V${num(t + FOLD)}H${num(r)}" fill="none" stroke="var(--_b)" stroke-linejoin="round"/>` +
        labelSvg(view.label, 0, 0, ` class="pele-label" font-size="${small}"`, options.icons) +
        '</g>';
    } else {
      nodesOut +=
        `<g class="pele-node pele-interface" data-id="${id}"${at}>` +
        labelSvg(view.label, 0, 0, ` class="pele-label" font-size="${small}"`, options.icons) +
        '</g>';
    }
  }

  function classSvg(view: View, cls: ClassNode, id: string, at: string): string {
    const { w, h, style } = view;
    const left = -w / 2;
    const top = -h / 2;
    const memberSize = Math.round(view.fontSize * 0.875);
    const lineHeight = Math.round(memberSize * 1.5);
    let body = `<rect x="${num(left)}" y="${num(top)}" width="${num(w)}" height="${num(h)}" fill="var(--_s)" stroke="var(--_b)"${rounded(style.shape)}/>`;
    const first = top + view.titleH;
    const second = first + view.attributesH;
    if (h > view.titleH) {
      const stroke = style.stroke ? ` style="stroke:${esc(style.stroke)}"` : '';
      body += `<path class="pele-divider" d="M${num(left)},${num(first)}H${num(-left)}M${num(left)},${num(second)}H${num(-left)}" fill="none" stroke="var(--_b)"${stroke}/>`;
    }
    let y = top + TITLE_PAD;
    for (const annotation of view.annotations) {
      if (typeof annotation === 'string') {
        body += `<text class="pele-annotation" x="0" y="${num(y + tinyHeight / 2 + tiny * 0.35)}" text-anchor="middle" font-size="${tiny}" fill="var(--_m)">${esc(annotation)}</text>`;
        y += tinyHeight;
      } else {
        const h = Math.max(tinyHeight, annotation.height);
        body += labelSvg(annotation, 0, y + h / 2, ` class="pele-annotation" font-size="${tiny}" fill="var(--_m)"`, options.icons);
        y += h;
      }
    }
    const titleSize = view.fontSize === size ? '' : ` font-size="${num(view.fontSize)}"`;
    body += labelSvg(view.label, 0, (y + first - TITLE_PAD) / 2, ` class="pele-label"${titleSize} font-weight="var(--_hw)"${style.text}`, options.icons);
    const lines = (list: Line[], kind: string, from: number): string => {
      let out = '';
      let baseline = from + SECTION_PAD + lineHeight / 2 + memberSize * 0.35;
      for (const line of list) {
        const mark =
          line.classifier === '$'
            ? ` pele-static"${style.text ? style.text.slice(0, -1) + 'text-decoration:underline"' : ' style="text-decoration:underline"'}`
            : line.classifier === '*'
              ? ` pele-abstract" font-style="italic"${style.text}`
              : `"${style.text}`;
        out += `<text class="pele-member pele-${kind}${mark} x="${num(left + PAD_X)}" y="${num(baseline)}">${esc(line.text)}</text>`;
        baseline += lineHeight;
      }
      return out;
    };
    if (view.attributes.length > 0 || view.methods.length > 0) {
      body += `<g class="pele-members" font-size="${memberSize}">${lines(view.attributes, 'attribute', first)}${lines(view.methods, 'method', second)}</g>`;
    }
    if (cls.tooltip) body = `<title>${escText(cls.tooltip)}</title>` + body;
    if (cls.link) body = linked(body, cls.link, cls.id, links, options, cls.linkTarget && TARGETS.has(cls.linkTarget) ? ` target="${cls.linkTarget}"` : '');
    return `<g class="pele-node pele-class${classNames(cls.cssClasses.replace(/^default\s?/, ''))}" data-id="${id}"${at}>${body}</g>`;
  }

  let edgesOut = '';
  let labelsOut = '';
  for (let i = 0; i < cedges.length; i++) {
    const ce = cedges[i];
    const edge = drawn[i];
    const label = edgeLabels[i];
    const startType = edge.arrowTypeStart;
    const endType = edge.arrowTypeEnd;
    const startTrim = classMarkerTrim(startType);
    const endTrim = classMarkerTrim(endType);
    let path: EdgePath;
    if (ce.src === ce.dst) {
      const c = cnodes[ce.src];
      const view = views[ce.src];
      const k = loopAt[i];
      const x = c.x + ox + view.w / 2;
      const y = c.y + oy;
      const spread = Math.min(view.h / 2 - 4, 8 + k * 6);
      const reach = LOOP + k * 8;
      path = {
        d: `M${num(x + startTrim)},${num(y - spread)}C${num(x + reach + startTrim)},${num(y - spread)} ${num(
          x + reach + endTrim
        )},${num(y + spread)} ${num(x + endTrim)},${num(y + spread)}`,
        sx: x,
        sy: y - spread,
        sdx: -1,
        sdy: 0,
        ex: x,
        ey: y + spread,
        edx: -1,
        edy: 0,
      };
      ce.labelX = c.x + view.w / 2 + reach + 4 + ce.labelW / 2;
      ce.labelY = c.y;
    } else {
      const route = ce.route;
      for (let k = 0; k < route.length; k += 3) {
        route[k] += ox;
        route[k + 1] += oy;
      }
      path = routePath(route, undefined, startTrim, endTrim);
    }
    const attrs = edge.pattern === 'dashed' ? ' stroke-dasharray="6 4"' : edge.pattern === 'dotted' ? ' stroke-dasharray="2 4"' : '';
    edgesOut +=
      `<g class="pele-edge${edge.pattern === 'dotted' ? ' pele-note-edge' : ' pele-relation'}" data-id="${escText(edge.id)}">` +
      `<path d="${path.d}"${attrs}/>` +
      classMarker(startType, path.sx, path.sy, path.sdx, path.sdy, LINE) +
      classMarker(endType, path.ex, path.ey, path.edx, path.edy, LINE) +
      '</g>';
    if (label.width > 0) {
      const x = ce.labelX + ox;
      const y = ce.labelY + oy;
      labelsOut += edgeLabelSvg(edge.id, label, x, y, '', options.icons);
    }
  }

  let cardsOut = '';
  for (const item of cards) {
    cardsOut += item.math
      ? labelSvg(item.math, item.x + ox, item.y + oy, ' class="pele-cardinality"', options.icons)
      : `<text class="pele-cardinality" x="${num(item.x + ox)}" y="${num(item.y + oy + tiny * 0.35)}" text-anchor="middle">${esc(item.text)}</text>`;
  }

  const titled = withTitle(
    db.title,
    measurer,
    size,
    pad,
    width,
    height,
    (clusters ? `<g class="pele-clusters">${clusters}</g>` : '') +
      (edgesOut ? `<g class="pele-edges" fill="none" stroke="${LINE}" stroke-linecap="round">${edgesOut}</g>` : '') +
      (struckTitles ? `<g class="pele-cluster-titles">${struckTitles}</g>` : '') +
      (labelsOut ? `<g class="pele-edge-labels" font-size="${small}">${labelsOut}</g>` : '') +
      (cardsOut ? `<g class="pele-cardinalities" font-size="${tiny}" fill="var(--_m)">${cardsOut}</g>` : '') +
      `<g class="pele-nodes">${nodesOut}</g>`
  );
  const svg = svgDocument('class', titled.width, titled.height, size, options, db, titled.content);

  return { svg, width: titled.width, height: titled.height, links };
}

