import { cnode, compoundLayout, direction, type CEdge, type CNode, type Dir } from '../../layout/compound.js';
import type { Config } from '../../preprocess.js';
import { esc, escText, labelSvg, num } from '../../svg/builder.js';
import { edgeLabelSvg, marker, markerTrim, routePath, sideReach, type EdgePath } from '../../svg/edges.js';
import { endSide } from '../../svg/shapes.js';
import { svgDocument } from '../../svg/root.js';
import { withTitle } from '../../svg/title.js';
import { classNames, resolveStyle, type ResolvedStyle } from '../../svg/theme.js';
import { decodeEntities } from '../../text/entities.js';
import { layoutLabel, type Label } from '../../text/label.js';
import { Style, defaultMeasurer } from '../../text/measurer.js';
import { linked, safeUrl } from '../../util/url.js';
import type { LinkInfo, RenderOptions, Rendered } from '../../types.js';
import { runsAcross, turnToFit } from '../common/fit-width.js';
import type { StateDb } from './db.js';
import type { StateEdge, StateNode } from './graph.js';

const NODE_SEP = 40;
const EDGE_SEP = 16;
const RANK_SEP = 44;
const GROUP_PAD = 16;
const REGION_PAD = 10;
const PAD_X = 16;
const PAD_Y = 10;
const LOOP = 26;
const FOLD = 8;
const NOTE_WRAP = 320;
const CORNER = 10;
const BAR = 8;
const SURFACE = ' fill="var(--_s)" stroke="var(--_b)"';
const RULE = ' fill="none" stroke="var(--_b)"';
const MERMAID_CLASSES = /(?:^| )statediagram-(?:state|cluster-alt|cluster|note)(?= |$)/g;

const enum K {
  State,
  Described,
  Start,
  End,
  Choice,
  Fork,
  Join,
  Note,
  Composite,
  Region,
  Hidden,
}

const KINDS = new Map<string | undefined, K>([
  ['rectWithTitle', K.Described],
  ['stateStart', K.Start],
  ['stateEnd', K.End],
  ['choice', K.Choice],
  ['fork', K.Fork],
  ['join', K.Join],
  ['note', K.Note],
  ['divider', K.Hidden],
]);

const CLASSES = [
  'pele-node pele-state',
  'pele-node pele-state',
  'pele-node pele-state-start',
  'pele-node pele-state-end',
  'pele-node pele-state-choice',
  'pele-node pele-state-fork',
  'pele-node pele-state-join',
  'pele-note',
  'pele-cluster pele-state-composite',
];

interface View {
  // Absent for the unseen helpers the layout needs.
  node: StateNode | undefined;
  kind: K;
  style: ResolvedStyle | undefined;
  label: Label;
  lines: Label[];
  w: number;
  h: number;
  titleH: number;
}

function vertical(dir: Dir | undefined): boolean {
  return dir === 'TB' || dir === 'BT';
}

function numberOption(config: Config, key: string, fallback: number): number {
  const value = (config.state as Config | undefined)?.[key];
  return typeof value === 'number' && value > 0 ? Math.min(value, 2000) : fallback;
}

// Mermaid keeps the quotes of a click statement's strings and strips them when it draws.
function unquote(text: string): string {
  let from = 0;
  let to = text.length;
  while (from < to && text.charCodeAt(from) === 34) from++;
  while (to > from && text.charCodeAt(to - 1) === 34) to--;
  return text.slice(from, to);
}

function clamp(value: number, min: number, max: number): number {
  return value < min ? min : value > max ? max : value;
}

function rect(x: number, y: number, w: number, h: number, rest: string): string {
  return `<rect x="${num(x)}" y="${num(y)}" width="${num(w)}" height="${num(h)}"${rest}/>`;
}

function group(dir: Dir, padX: number, padTop: number, padBottom: number): CNode {
  const c = cnode(0, 0);
  c.isGroup = true;
  c.dir = dir;
  c.padX = padX;
  c.padTop = padTop;
  c.padBottom = padBottom;
  return c;
}

export function renderState(db: StateDb, config: Config, options: RenderOptions): Rendered {
  if (!runsAcross(db.direction)) return draw(db, config, options, false);
  return turnToFit(options, (down) => draw(db, config, options, down));
}

// `turned` draws a diagram that runs across as one that runs down.
function draw(db: StateDb, config: Config, options: RenderOptions, turned: boolean): Rendered {
  const graph = db.graph;
  // State diagrams follow the flowchart curve.
  const curve = (config.flowchart as Config | undefined)?.curve;
  const size = options.fontSize ?? 16;
  const small = Math.round(size * 0.875);
  const measurer = options.measurer ?? defaultMeasurer(options.fontFamily, options.fontFamilyMono);
  const wrapWidth = numberOption(config, 'wrappingWidth', 200);
  const pad = options.padding ?? 8;
  const icons = options.icons;
  const rootDir = turned ? 'TB' : direction(db.direction);
  const noLabel = layoutLabel(undefined, false, measurer, size, 0);
  const text = (raw: string | undefined, fontSize: number, wrap: number, style = 0): Label =>
    layoutLabel(raw, true, measurer, fontSize, wrap, style);

  const index = new Map<string, number>();
  const views: View[] = [];
  const cnodes: CNode[] = [];
  const add = (node: StateNode | undefined, kind: K, c: CNode | undefined): number => {
    views.push({ node, kind, style: undefined, label: noLabel, lines: [], w: 0, h: 0, titleH: 0 });
    if (c) cnodes.push(c);
    return views.length - 1;
  };
  for (const node of graph.nodes) {
    if (node.shape === 'noteGroup') continue;
    const kind = node.isGroup ? (node.shape === 'divider' ? K.Region : K.Composite) : (KINDS.get(node.shape) ?? K.State);
    index.set(node.id, add(node, kind, undefined));
  }
  const states = views.length;

  const logical: number[] = [];
  for (let i = 0; i < states; i++) {
    const parentId = views[i].node!.parentId;
    const parent = parentId === undefined ? undefined : index.get(parentId);
    logical.push(parent !== undefined && parent !== i && views[parent].node!.isGroup ? parent : -1);
  }
  // Composites that are redeclared inside each other form a ring with no way in from the root.
  // One member of each ring moves to the root, which leaves a tree.
  {
    const kids: number[][] = [];
    for (let i = 0; i < states; i++) kids.push([]);
    const queue: number[] = [];
    const placed = new Uint8Array(states);
    for (let i = 0; i < states; i++) {
      if (logical[i] === -1) {
        placed[i] = 1;
        queue.push(i);
      } else {
        kids[logical[i]].push(i);
      }
    }
    let done = 0;
    const settle = (): void => {
      for (; done < queue.length; done++) {
        for (const kid of kids[queue[done]]) {
          if (placed[kid]) continue;
          placed[kid] = 1;
          queue.push(kid);
        }
      }
    };
    settle();
    const seen = new Int32Array(states).fill(-1);
    for (let i = 0; i < states; i++) {
      if (placed[i]) continue;
      let ring = i;
      while (seen[ring] !== i) {
        seen[ring] = i;
        ring = logical[ring];
      }
      logical[ring] = -1;
      placed[ring] = 1;
      queue.push(ring);
      settle();
    }
  }
  const owners = new Int32Array(states).fill(-1);
  for (let i = 0; i < states; i++) {
    const noteFor = views[i].node!.noteFor;
    const owner = noteFor === undefined ? undefined : index.get(noteFor);
    if (owner === undefined) continue;
    owners[i] = owner;
    logical[i] = logical[owner];
  }

  // As in Mermaid, a composite that sets no direction runs top to bottom whatever surrounds it.
  const innerDir = (composite: number): Dir => direction(views[composite].node!.dir);
  // Whether the flow around a state runs top to bottom or bottom to top.
  const across = (i: number): boolean => vertical(logical[i] === -1 ? rootDir : innerDir(logical[i]));

  const degree = new Int32Array(states);
  const noted = new Uint8Array(states);
  // When each state first takes part in a transition. Layout follows this order rather than
  // the order of declaration, so a state declared up front does not become the top of the flow.
  const appear: number[] = new Array(states).fill(Infinity);
  let appeared = 0;
  const counts = new Int32Array(2 * states);
  for (const edge of graph.edges) {
    const src = index.get(edge.start);
    const dst = index.get(edge.end);
    if (src === undefined || dst === undefined) continue;
    if (edge.pattern === 'dashed') {
      noted[views[src].kind === K.Note ? dst : src] = 1;
      continue;
    }
    degree[src] = Math.max(degree[src], ++counts[2 * src]);
    degree[dst] = Math.max(degree[dst], ++counts[2 * dst + 1]);
    if (appear[src] === Infinity) appear[src] = appeared++;
    if (appear[dst] === Infinity) appear[dst] = appeared++;
  }

  for (let i = 0; i < states; i++) {
    const view = views[i];
    const node = view.node!;
    const style = resolveStyle(node.cssStyles.length > 0 ? node.cssCompiledStyles.concat(node.cssStyles) : node.cssCompiledStyles);
    const textStyle = (style.bold ? Style.Bold : 0) | (style.italic ? Style.Italic : 0);
    const fontSize = style.fontSize ?? size;
    view.style = style;
    let c: CNode | undefined;
    switch (view.kind) {
      case K.Composite:
        view.label = text(node.label, fontSize, 4000, textStyle);
        view.titleH = view.label.height > 0 ? view.label.height + 12 : 0;
        c = group(innerDir(i), GROUP_PAD, view.titleH + GROUP_PAD, GROUP_PAD);
        c.minW = view.label.width + 2 * GROUP_PAD;
        break;
      case K.Region:
        c = group(innerDir(i), REGION_PAD, REGION_PAD, REGION_PAD);
        break;
      case K.Start:
        view.w = view.h = 14;
        break;
      case K.End:
        view.w = view.h = 18;
        break;
      case K.Choice:
        view.w = view.h = 30;
        break;
      case K.Fork:
      case K.Join: {
        const length = clamp(40 * degree[i] + 16, 72, 320);
        view.w = across(i) ? length : BAR;
        view.h = across(i) ? BAR : length;
        break;
      }
      case K.Hidden:
        break;
      case K.Note:
        view.label = text(node.label, small, Math.max(wrapWidth, NOTE_WRAP));
        view.w = view.label.width + 24;
        view.h = view.label.height + 16;
        break;
      default: {
        view.label = text(node.label, fontSize, wrapWidth, textStyle);
        let width = view.label.width;
        let height = view.label.height + 2 * PAD_Y;
        if (view.kind === K.Described) {
          height += 14;
          for (const line of node.description) {
            const label = text(line === '' ? ' ' : line, small, wrapWidth, textStyle);
            view.lines.push(label);
            if (label.width > width) width = label.width;
            height += label.height;
          }
        }
        view.w = Math.max(width + 2 * PAD_X, 56);
        view.h = height;
      }
    }
    c ??= cnode(view.w, view.h);
    // The transitions on one side of a state's box spread along it, clear of its corners.
    if (view.kind === K.State || view.kind === K.Described) c.span = (across(i) ? view.w : view.h) - 24;
    cnodes.push(c);
  }

  const cedges: CEdge[] = [];
  const edgeLabels: Label[] = [];
  const drawn: StateEdge[] = [];
  // The transitions each state makes to itself: how many, their widest label, and their labels' height.
  const loopCount = new Int32Array(states);
  const loopWidth = new Float64Array(states);
  const loopHeight = new Float64Array(states);
  // A transition between a composite and a state inside it runs between that state and a point
  // just inside the composite, and is then drawn on to the composite's border.
  const anchors = new Map<number, number>();
  const encloses = (composite: number, item: number): boolean => {
    if (!cnodes[composite].isGroup) return false;
    for (let p = logical[item]; p !== -1; p = logical[p]) if (p === composite) return true;
    return false;
  };
  const anchor = (composite: number, first: boolean): number => {
    anchors.set(cedges.length, composite);
    appear.push(first ? -1 : Infinity);
    return add(undefined, K.Hidden, cnode(0, 0, composite));
  };
  for (const edge of graph.edges) {
    let src = index.get(edge.start);
    let dst = index.get(edge.end);
    if (src === undefined || dst === undefined) continue;
    const label = text(edge.label, small, wrapWidth);
    const labelW = label.width > 0 ? label.width + 12 : 0;
    if (src === dst) {
      loopCount[src]++;
      loopWidth[src] = Math.max(loopWidth[src], labelW);
      loopHeight[src] += label.height;
    } else if (encloses(src, dst)) {
      src = anchor(src, true);
    } else if (encloses(dst, src)) {
      dst = anchor(dst, false);
    }
    drawn.push(edge);
    edgeLabels.push(label);
    cedges.push({ src, dst, minlen: 1, labelW, labelH: label.height > 0 ? label.height + 4 : 0, route: [], labelX: 0, labelY: 0 });
  }

  // A state with notes, or a composite with self-transitions, sits in an unseen group of its
  // own: the notes go beside the state, across the flow, without disturbing its transitions.
  for (let i = 0; i < states; i++) {
    if (owners[i] !== -1) continue;
    const item = cnodes[i];
    // Loops hang off the right, or below when the flow is horizontal, with their labels beyond them.
    let room = 0;
    if (loopCount[i] > 0) {
      const reach = LOOP + (loopCount[i] - 1) * 8;
      room = across(i) ? reach + loopWidth[i] : reach * 0.75 + 4 + loopHeight[i];
      if (!item.isGroup) {
        if (across(i)) {
          item.w += 2 * room;
          item.h = Math.max(item.h, loopHeight[i]);
        } else {
          item.h += 2 * room;
          item.w = Math.max(item.w, loopWidth[i]);
        }
        room = 0;
      }
    }
    if (!noted[i] && room === 0) {
      item.parent = logical[i];
      continue;
    }
    const c = across(i) ? group('LR', room, 0, 0) : group('TB', 0, room, room);
    c.parent = logical[i];
    appear.push(appear[i]);
    cnodes[i].parent = add(undefined, K.Hidden, c);
  }
  for (let i = 0; i < states; i++) if (owners[i] !== -1) cnodes[i].parent = cnodes[owners[i]].parent;

  {
    // Numbers the tree so that, at every level, initial states come first and the rest follow
    // in the order the transitions introduce them.
    const members: number[][] = [];
    for (let i = 0; i < cnodes.length; i++) members.push([]);
    const top: number[] = [];
    for (let i = 0; i < cnodes.length; i++) {
      const p = cnodes[i].parent;
      if (p >= 0) members[p].push(i);
      else top.push(i);
    }
    const initial = (i: number): number => (views[i].kind === K.Start ? 0 : 1);
    const byFlow = (a: number, b: number): number =>
      initial(a) - initial(b) || (appear[a] === appear[b] ? 0 : appear[a] < appear[b] ? -1 : 1) || a - b;
    let seq = 0;
    const pending = top.sort(byFlow).reverse();
    while (pending.length > 0) {
      const i = pending.pop()!;
      cnodes[i].seq = seq++;
      const inside = members[i].sort(byFlow);
      for (let k = inside.length - 1; k >= 0; k--) pending.push(inside[k]);
    }
  }

  const layout = compoundLayout(cnodes, cedges, rootDir, {
    nodeSep: numberOption(config, 'nodeSpacing', NODE_SEP),
    edgeSep: EDGE_SEP,
    rankSep: numberOption(config, 'rankSpacing', RANK_SEP),
    portSep: 20,
    tracks: curve === 'step' || curve === 'stepBefore' || curve === 'stepAfter',
    straight: curve === 'linear',
    headRoom: markerTrim('arrow_point'),
  });

  const width = Math.ceil(layout.width + 2 * pad);
  const height = Math.ceil(layout.height + 2 * pad);
  const links: LinkInfo[] = [];

  // Route points by rounded y, to find the edges that cross a composite's title bar.
  const crossings = new Map<number, number[]>();
  for (const e of cedges) {
    const route = e.route;
    for (let k = 3; k < route.length - 3; k += 3) {
      const key = Math.round(route[k + 1]);
      const list = crossings.get(key);
      if (list) list.push(route[k]);
      else crossings.set(key, [route[k]]);
    }
  }

  const children: number[][] = [];
  for (let i = 0; i < cnodes.length; i++) children.push([]);
  const order: number[] = [];
  for (let i = 0; i < cnodes.length; i++) {
    const p = cnodes[i].parent;
    if (p >= 0) children[p].push(i);
    else order.push(i);
  }
  const roots = order.slice();
  for (let q = 0; q < order.length; q++) for (const child of children[order[q]]) order.push(child);

  let clusters = '';
  let dividers = '';
  let nodesOut = '';
  let notesOut = '';
  // Draws the dashed lines between the regions among a composite's members.
  const divide = (items: number[], left: number, top: number, right: number, bottom: number): void => {
    const regions = items.filter((i) => views[i].kind === K.Region);
    if (regions.length < 2) return;
    const lo = (i: number, x: boolean): number => (x ? cnodes[i].x - cnodes[i].w / 2 : cnodes[i].y - cnodes[i].h / 2);
    const hi = (i: number, x: boolean): number => (x ? cnodes[i].x + cnodes[i].w / 2 : cnodes[i].y + cnodes[i].h / 2);
    for (const x of [true, false]) {
      const sorted = regions.slice().sort((a, b) => lo(a, x) - lo(b, x) || a - b);
      let apart = true;
      for (let k = 1; k < sorted.length; k++) if (hi(sorted[k - 1], x) > lo(sorted[k], x) + 0.5) apart = false;
      if (!apart) continue;
      for (let k = 1; k < sorted.length; k++) {
        const at = num((hi(sorted[k - 1], x) + lo(sorted[k], x)) / 2 + pad);
        dividers += `<path class="pele-divider" d="M${x ? `${at},${num(top)}V${num(bottom)}` : `${num(left)},${at}H${num(right)}`}"/>`;
      }
      return;
    }
    // Regions that sit neither side by side nor in a stack each get an outline.
    for (const i of regions) {
      const c = cnodes[i];
      dividers += rect(c.x - c.w / 2 + pad, c.y - c.h / 2 + pad, c.w, c.h, ` class="pele-divider" rx="${CORNER}"`);
    }
  };
  divide(roots, pad / 2, pad / 2, width - pad / 2, height - pad / 2);

  for (const i of order) {
    const view = views[i];
    const node = view.node;
    const style = view.style;
    if (node === undefined || style === undefined || view.kind >= K.Region) continue;
    const c = cnodes[i];
    const x = c.x + pad;
    const y = c.y + pad;
    const w = view.w;
    const h = view.h;
    const labelAttrs = ` class="pele-label"${style.text}`;
    let body: string;

    switch (view.kind) {
      case K.Composite: {
        const left = x - c.w / 2;
        const top = y - c.h / 2;
        body = rect(left, top, c.w, c.h, ` rx="${CORNER}" fill="var(--_a)" fill-opacity="0.5" stroke="var(--_b)"${style.shape}`);
        if (view.titleH > 0) {
          body +=
            `<path d="M${num(left)},${num(top + view.titleH)}H${num(left + c.w)}"${RULE}${style.line}/>` +
            labelSvg(
              view.label,
              titleX(c, view.label.width, crossings) + pad,
              top + view.titleH / 2,
              ` class="pele-cluster-label"${style.text}`,
              icons
            );
        }
        divide(children[i], left, top + view.titleH, left + c.w, top + c.h);
        break;
      }
      case K.Start:
        body = `<circle r="7" fill="var(--_l)"${style.shape}/>`;
        break;
      case K.End:
        body = `<circle r="8.5" fill="var(--_bg)" stroke="var(--_l)"${style.line}/><circle r="5" fill="var(--_l)"${style.shape}/>`;
        break;
      case K.Choice:
        body = `<polygon points="0,${num(-h / 2)} ${num(w / 2)},0 0,${num(h / 2)} ${num(-w / 2)},0"${SURFACE}${style.shape}/>`;
        break;
      case K.Fork:
      case K.Join:
        body = rect(-w / 2, -h / 2, w, h, ` rx="2" fill="var(--_l)"${style.shape}`);
        break;
      case K.Note: {
        const r = num(w / 2);
        const b = num(h / 2);
        const fold = num(w / 2 - FOLD);
        const corner = num(FOLD - h / 2);
        body =
          `<path d="M-${r},-${b}H${fold}L${r},${corner}V${b}H-${r}Z" fill="var(--_bg)" stroke="var(--_b)"/>` +
          `<path d="M${fold},-${b}V${corner}H${r}"${RULE}/>` +
          labelSvg(view.label, 0, 0, ` class="pele-label" font-size="${small}" fill="var(--_m)"`, icons);
        break;
      }
      default: {
        body = rect(-w / 2, -h / 2, w, h, ` rx="${num(Math.min(CORNER, h / 2))}"${SURFACE}${style.shape}`);
        if (view.kind === K.State) {
          body += labelSvg(view.label, 0, 0, labelAttrs, icons);
          break;
        }
        let at = PAD_Y - h / 2 + view.label.height;
        body += `<path d="M${num(-w / 2)},${num(at + 6)}H${num(w / 2)}"${RULE}${style.line}/>` + labelSvg(view.label, 0, at - view.label.height / 2, labelAttrs, icons);
        at += 14;
        for (const line of view.lines) {
          body += labelSvg(line, 0, at + line.height / 2, ` class="pele-state-description" font-size="${small}"${style.text}`, icons);
          at += line.height;
        }
      }
    }

    const link = db.links.get(node.id);
    if (link) {
      // Entity codes are resolved first, so the URL is checked in the form a browser would follow.
      const tooltip = decodeEntities(unquote(link.tooltip));
      if (tooltip) body = `<title>${esc(tooltip)}</title>` + body;
      body = linked(body, safeUrl(unquote(link.url)), node.id, links, options, ' target="_blank"');
    }
    const open = `<g class="${CLASSES[view.kind]}${classNames(node.cssClasses.replace(MERMAID_CLASSES, ''))}" data-id="${escText(node.id)}"`;
    if (view.kind === K.Composite) clusters += `${open}>${body}</g>`;
    else if (view.kind === K.Note) notesOut += `${open} transform="translate(${num(x)},${num(y)})">${body}</g>`;
    else nodesOut += `${open} transform="translate(${num(x)},${num(y)})">${body}</g>`;
  }

  // Moves a route end from the layout box onto the drawn shape, and spreads the ends along a bar.
  const attach = (route: number[], at: number, i: number): void => {
    const c = cnodes[i];
    if (c.isGroup) return;
    const view = views[i];
    const bar = view.kind === K.Fork || view.kind === K.Join;
    const other = at === 0 ? 3 : at - 3;
    // 0 is the x axis and 1 the y axis; the end sits on a side that faces along `axis`.
    for (const axis of [1, 0]) {
      const extent = axis ? c.h : c.w;
      const drawnExtent = axis ? view.h : view.w;
      const breadth = axis ? view.w : view.h;
      const center = (axis ? c.y : c.x) + pad;
      const cross = (axis ? c.x : c.y) + pad;
      const delta = route[at + axis] - center;
      if (Math.abs(Math.abs(delta) - extent / 2) >= 0.5) continue;
      route[at + axis] -= (Math.sign(delta) * (extent - drawnExtent)) / 2;
      if (bar && breadth > drawnExtent) {
        route[at + 1 - axis] = clamp(route[other + 1 - axis], cross - breadth / 2 + 6, cross + breadth / 2 - 6);
      }
      return;
    }
  };

  const reach = sideReach();
  for (let i = 0; i < cedges.length; i++) {
    const ce = cedges[i];
    if (ce.src === ce.dst || ce.route.length < 6 || drawn[i].pattern === 'dashed') continue;
    reach.add(ce.dst, endSide(ce.route, ce.route.length - 3, cnodes[ce.dst]), 'arrow_point');
  }

  let edgesOut = '';
  let labelsOut = '';
  const loopSeen = new Int32Array(states);
  const loopText = new Float64Array(states);
  for (let i = 0; i < cedges.length; i++) {
    const ce = cedges[i];
    const edge = drawn[i];
    const label = edgeLabels[i];
    const note = edge.pattern === 'dashed';
    const endType = note ? 'none' : 'arrow_point';
    let path: EdgePath;
    if (ce.src === ce.dst) {
      const a = cnodes[ce.src];
      const view = views[ce.src];
      const k = loopSeen[ce.src]++;
      // The loop hangs off a side the flow does not use: the right, or below when the flow is horizontal.
      const side = across(ce.src);
      const w = a.isGroup ? a.w : view.w;
      const h = a.isGroup ? a.h : view.h;
      const out = (side ? w : h) / 2;
      const spread = Math.max(Math.min((side ? h : w) / 2 - 4, 8 + k * 6), 2);
      const reach = LOOP + k * 8;
      const trim = markerTrim(endType) / (Math.hypot(reach, spread) || 1);
      // Offsets are given for a loop on the right and turned a quarter for one below.
      const px = (dx: number, dy: number): number => a.x + pad + (side ? out + dx : -dy);
      const py = (dx: number, dy: number): number => a.y + pad + (side ? dy : out + dx);
      const at = (dx: number, dy: number): string => `${num(px(dx, dy))},${num(py(dx, dy))}`;
      path = {
        d: `M${at(0, -spread)}C${at(reach, -2 * spread)} ${at(reach, 2 * spread)} ${at(reach * trim, spread + spread * trim)}`,
        sx: 0,
        sy: 0,
        sdx: 0,
        sdy: 0,
        ex: px(0, spread),
        ey: py(0, spread),
        edx: px(-reach, -spread) - px(0, 0),
        edy: py(-reach, -spread) - py(0, 0),
      };
      const len = Math.hypot(path.edx, path.edy) || 1;
      path.edx /= len;
      path.edy /= len;
      // Labels stack beyond the outermost loop, in the order of their transitions.
      const furthest = LOOP + (loopCount[ce.src] - 1) * 8;
      const below = loopText[ce.src] + label.height / 2;
      loopText[ce.src] += label.height;
      ce.labelX = side ? a.x + out + furthest + 4 + ce.labelW / 2 : a.x;
      ce.labelY = side ? a.y - loopHeight[ce.src] / 2 + below : a.y + out + furthest * 0.75 + 4 + below;
    } else {
      let route = ce.route.slice();
      const leaves = reach.of(ce.src, endSide(route, 0, cnodes[ce.src]));
      const arrives = reach.of(ce.dst, endSide(route, route.length - 3, cnodes[ce.dst]));
      for (let k = 0; k < route.length; k += 3) {
        route[k] += pad;
        route[k + 1] += pad;
      }
      attach(route, 0, ce.src);
      attach(route, route.length - 3, ce.dst);
      const composite = anchors.get(i);
      if (composite !== undefined && route.length >= 6) {
        const g = cnodes[composite];
        const inward = views[ce.src].kind === K.Hidden;
        const at = inward ? 0 : route.length - 3;
        const near = (g.dir === 'TB' || g.dir === 'LR') === inward;
        const point = vertical(g.dir)
          ? [route[at], g.y + pad + (near ? views[composite].titleH - g.h / 2 : g.h / 2), 0]
          : [g.x + pad + (near ? -g.w / 2 : g.w / 2), route[at + 1], 1];
        route = inward ? point.concat(route) : route.concat(point);
      }
      path = routePath(route, typeof curve === 'string' ? curve : undefined, 0, markerTrim(endType), leaves, arrives);
    }
    edgesOut +=
      `<g class="pele-edge ${note ? 'pele-note-edge" stroke="var(--_b)" stroke-dasharray="3 4' : 'pele-transition'}" data-id="${escText(edge.id)}">` +
      `<path d="${path.d}"/>` +
      marker(endType, path.ex, path.ey, path.edx, path.edy, 'var(--_l)') +
      '</g>';
    if (label.width > 0) {
      const x = ce.labelX + pad;
      const y = ce.labelY + pad;
      labelsOut += edgeLabelSvg(edge.id, label, x, y, '', icons);
    }
  }

  const titled = withTitle(
    db.title,
    measurer,
    size,
    pad,
    width,
    height,
    (clusters ? `<g class="pele-clusters">${clusters}</g>` : '') +
      (dividers ? `<g class="pele-dividers" stroke-dasharray="4 4"${RULE}>${dividers}</g>` : '') +
      (edgesOut ? `<g class="pele-edges" fill="none" stroke="var(--_l)" stroke-linecap="round">${edgesOut}</g>` : '') +
      (labelsOut ? `<g class="pele-edge-labels" font-size="${small}">${labelsOut}</g>` : '') +
      `<g class="pele-nodes">${nodesOut}${notesOut}</g>`
  );
  const svg = svgDocument('state', titled.width, titled.height, size, options, db, titled.content);

  return { svg, width: titled.width, height: titled.height, links };
}

// Picks where a composite's title sits in its title bar so that edges entering from above do not cross it.
function titleX(c: CNode, width: number, crossings: Map<number, number[]>): number {
  const xs = crossings.get(Math.round(c.y - c.h / 2));
  if (xs === undefined || width === 0) return c.x;
  const left = c.x - c.w / 2;
  const half = width / 2;
  let best = c.x;
  let bestGap = -1;
  for (const x of [c.x, left + GROUP_PAD + half, left + c.w - GROUP_PAD - half]) {
    let gap = Infinity;
    for (const cx of xs) if (cx > left && cx < left + c.w) gap = Math.min(gap, Math.abs(cx - x) - half);
    if (gap >= 6) return x;
    if (gap > bestGap + 0.5) {
      bestGap = gap;
      best = x;
    }
  }
  return best;
}
