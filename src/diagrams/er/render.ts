import { cnode, compoundLayout, direction, shiftLayout, type CEdge, type CNode } from '../../layout/compound.js';
import { titleLabel } from '../../svg/title.js';
import type { Config } from '../../preprocess.js';
import { esc, escText, labelSvg, num, sharedStyle, spanStyle, textStyle, type IconResolver } from '../../svg/builder.js';
import { clusterTitleX, markCrossings, type Crossings } from '../../svg/cluster.js';
import { edgeLabelSvg, routePath } from '../../svg/edges.js';
import { svgDocument } from '../../svg/root.js';
import { ROUNDED, classNames, resolveStyle, rounded, type ResolvedStyle } from '../../svg/theme.js';
import { hasMath, labelLine, layoutLabel, lineMiddle, type Label } from '../../text/label.js';
import { Style, defaultMeasurer } from '../../text/measurer.js';
import { decodeEntities } from '../../text/entities.js';
import { linkUrl, relAttr, sanitizeUrl } from '../../util/url.js';
import type { LinkInfo, RenderOptions, Rendered } from '../../types.js';
import { runsAcross, turnToFit } from '../common/fit-width.js';
import type { ErDb } from './db.js';
import { parseGenericTypes } from '../common/generics.js';
import { buildErGraph, type ErGraphEdge, type ErGraphNode } from './graph.js';
import { MARKER_LENGTH, erMarker } from './markers.js';

const NODE_SEP = 48;
const EDGE_SEP = 20;
const RANK_SEP = 64;
const GROUP_PAD = 20;
const LOOP = 28;
const LOOP_BAND = 38;
const MIN_WIDTH = 96;
const BOX_PAD_X = 18;
const BOX_PAD_Y = 12;
const HEAD_PAD_Y = 9;
const CELL_PAD_X = 12;
const CELL_GAP = 16;
const ROW_PAD = 9;
const COMMENT_WRAP = 260;
const NO_WRAP = 1e6;
const NO_LOOPS: Loop[] = [];
const PORT_GAP = 18;
const PORT_MARGIN = 14;
const BOX_ATTRS = ' fill="var(--_s)" stroke="var(--_b)"';

function numberOption(config: Config, key: string, fallback: number): number {
  const value = (config.er as Config | undefined)?.[key];
  return typeof value === 'number' && value > 0 ? Math.min(value, 2000) : fallback;
}

// Type, name, keys, comment.
type Cells = [Label, Label, Label, Label];

interface Row {
  cells: Cells;
  h: number;
}

interface NodeView {
  node: ErGraphNode;
  style: ResolvedStyle;
  label: Label;
  w: number;
  h: number;
  headH: number;
  rows: Row[];
  // Left edge of each column, measured from the left edge of the box.
  cols: number[];
  rowSize: number;
  keySize: number;
  // Whether self-relationships loop out of the bottom side rather than the right.
  below: boolean;
}

// A relationship from an entity to itself, with the stretch of the side it loops out of.
interface Loop {
  label: Label;
  band: number;
  at: number;
}

// Writes a measured label starting at x, with the baseline of its first line at y.
function textLeft(label: Label, x: number, y: number, attrs: string, icons: IconResolver | undefined): string {
  const lines = label.lines;
  if (lines.length === 0) return '';
  const only = lines.length === 1 && lines[0].length === 1 ? lines[0][0] : undefined;
  if (only && only.icon === undefined && only.math === undefined && only.style === 0) {
    return `<text${attrs} x="${num(x)}" y="${num(y)}">${esc(only.text)}</text>`;
  }
  const shared = sharedStyle(label);
  const shift = label.size * 0.35;
  const top = y - shift - label.lineHeight / 2;
  let body = '';
  let extra = '';
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const middle = top + lineMiddle(label, i);
    if (hasMath(line)) {
      extra += labelSvg(labelLine(label, i), x + label.widths[i] / 2, middle, attrs, icons);
      continue;
    }
    y = middle + shift;
    let hasIcon = false;
    for (const span of line) if (span.icon !== undefined) hasIcon = true;
    let sx = x;
    let placed = false;
    for (const span of line) {
      if (span.icon !== undefined) {
        const side = label.size * 1.1;
        extra += `<svg class="pele-icon" data-icon="${escText(span.icon)}" x="${num(sx)}" y="${num(
          y - label.size * 0.35 - side / 2
        )}" width="${num(side)}" height="${num(side)}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${
          icons?.(span.icon) ?? ''
        }</svg>`;
      } else if (span.text !== '') {
        const pos = hasIcon || !placed ? ` x="${num(sx)}" y="${num(y)}"` : '';
        body += `<tspan${pos}${spanStyle(span.style & ~shared)}>${esc(span.text)}</tspan>`;
        placed = true;
      }
      sx += span.width;
    }
  }
  return `<text${textStyle(attrs, shared)} xml:space="preserve">${body}</text>${extra}`;
}

// Mermaid reads `~` pairs as angle brackets. They are written as entities so the label parser
// does not take `<int>` for a tag.
function cellText(raw: string): string {
  const converted = parseGenericTypes(raw);
  return converted === raw ? raw : converted.replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

export function renderEr(db: ErDb, config: Config, options: RenderOptions): Rendered {
  if (!runsAcross(db.direction)) return draw(db, config, options, false);
  return turnToFit(options, (down) => draw(db, config, options, down));
}

// `turned` draws a diagram that runs across as one that runs down.
function draw(db: ErDb, config: Config, options: RenderOptions, turned: boolean): Rendered {
  const graph = buildErGraph(db);
  const size = options.fontSize ?? 16;
  const smallSize = Math.round(size * 0.875);
  const measurer = options.measurer ?? defaultMeasurer(options.fontFamily, options.fontFamilyMono);
  const pad = options.padding ?? 8;
  const icons = options.icons;

  const index = new Map<string, number>();
  const views: NodeView[] = [];
  const cnodes: CNode[] = [];
  graph.nodes.forEach((node, i) => index.set(node.id, i));

  const cedges: CEdge[] = [];
  const edgeLabels: Label[] = [];
  const drawn: ErGraphEdge[] = [];
  const loops = new Map<number, Loop[]>();
  const loopOf: (Loop | undefined)[] = [];
  for (const edge of graph.edges) {
    const src = index.get(edge.start);
    const dst = index.get(edge.end);
    if (src === undefined || dst === undefined) continue;
    const label = layoutLabel(edge.label, true, measurer, smallSize, 200);
    let loop: Loop | undefined;
    if (src === dst) {
      loop = { label, band: 0, at: 0 };
      const list = loops.get(src);
      if (list) list.push(loop);
      else loops.set(src, [loop]);
    }
    loopOf.push(loop);
    drawn.push(edge);
    edgeLabels.push(label);
    cedges.push({
      src,
      dst,
      minlen: 1,
      labelW: label.width > 0 ? label.width + 12 : 0,
      labelH: label.height > 0 ? label.height + 4 : 0,
      route: [],
      labelX: 0,
      labelY: 0,
    });
  }

  // The direction of the level a node is laid out in: its nearest subgraph that sets one, or the diagram's.
  const horizontal = (i: number): boolean => {
    let at = i;
    // Subgraphs can name each other as members, so the walk up is bounded.
    for (let steps = 0; steps < graph.nodes.length; steps++) {
      const parent = graph.nodes[at].parentId;
      const up = parent === undefined ? undefined : index.get(parent);
      if (up === undefined) break;
      const dir = graph.nodes[up].dir;
      if (dir) return dir === 'LR' || dir === 'RL';
      at = up;
    }
    return db.direction === 'LR' || db.direction === 'RL';
  };

  for (let i = 0; i < graph.nodes.length; i++) {
    const node = graph.nodes[i];
    const style = resolveStyle(
      node.cssStyles.length > 0 ? node.cssCompiledStyles.concat(node.cssStyles) : node.cssCompiledStyles
    );
    const base = (style.bold ? Style.Bold : 0) | (style.italic ? Style.Italic : 0);
    const nameSize = style.fontSize ?? size;
    const rowSize = style.fontSize ?? smallSize;
    const keySize = style.fontSize ?? Math.round(size * 0.75);
    const label = node.isGroup
      ? layoutLabel(node.label, true, measurer, nameSize, 4000, base)
      : layoutLabel(node.alias || node.label, true, measurer, nameSize, 240, base);
    const own = loops.get(i) ?? NO_LOOPS;
    // Loops leave by a side the layout keeps free of other edges: the right when ranks run down,
    // the bottom when they run across.
    const below = own.length > 0 && !node.isGroup && horizontal(i);
    const view: NodeView = { node, style, label, w: 0, h: 0, headH: 0, rows: [], cols: [], rowSize, keySize, below };
    let reach = 0;
    let bands = 0;
    for (const loop of own) {
      loop.band = Math.max(LOOP_BAND, below ? loop.label.width + 12 : loop.label.height + 6);
      bands += loop.band;
      reach = Math.max(reach, below ? loop.label.height : loop.label.width);
    }
    const minW = Math.max(MIN_WIDTH, below ? bands + 8 : 0);
    let c: CNode;
    if (node.isGroup) {
      c = cnode(0, 0);
      c.isGroup = true;
      c.dir = node.dir ? direction(node.dir) : undefined;
      c.padX = GROUP_PAD;
      c.padTop = view.label.height > 0 ? view.label.height + 16 : GROUP_PAD;
      c.padBottom = GROUP_PAD;
      c.minW = Math.max(view.label.width + 2 * GROUP_PAD - 12, MIN_WIDTH);
    } else {
      const nameH = Math.max(label.height, Math.round(nameSize * 1.5));
      if (node.attributes.length === 0) {
        view.w = Math.max(label.width + 2 * BOX_PAD_X, minW);
        view.h = Math.max(nameH + 2 * BOX_PAD_Y, below ? 0 : bands + 8);
      } else {
        const rowLine = Math.round(rowSize * 1.5);
        const widths = [0, 0, 0, 0];
        for (const attribute of node.attributes) {
          const cells: Cells = [
            layoutLabel(cellText(attribute.type), true, measurer, rowSize, NO_WRAP, base),
            layoutLabel(cellText(attribute.name), true, measurer, rowSize, NO_WRAP, base),
            layoutLabel(attribute.keys.join(', '), false, measurer, keySize, NO_WRAP, base),
            layoutLabel(cellText(attribute.comment), true, measurer, rowSize, COMMENT_WRAP, base),
          ];
          let h = rowLine;
          for (let k = 0; k < 4; k++) {
            if (cells[k].width > widths[k]) widths[k] = cells[k].width;
            if (cells[k].height > h) h = cells[k].height;
          }
          view.rows.push({ cells, h: h + ROW_PAD });
          view.h += h + ROW_PAD;
        }
        let columns = 0;
        let inner = 0;
        for (const w of widths) {
          if (w === 0) continue;
          inner += w + (columns > 0 ? CELL_GAP : 0);
          columns++;
        }
        view.w = Math.max(inner + 2 * CELL_PAD_X, label.width + 2 * BOX_PAD_X, minW);
        // A box wider than its table shares the spare width between the columns.
        const spare = columns > 0 ? (view.w - inner - 2 * CELL_PAD_X) / columns : 0;
        let x = CELL_PAD_X;
        for (const w of widths) {
          view.cols.push(x);
          if (w > 0) x += w + spare + CELL_GAP;
        }
        view.headH = nameH + 2 * HEAD_PAD_Y;
        view.h += view.headH;
      }
      // The layout keeps a node centered in its box, so room for loops is added on both sides.
      const room = own.length > 0 ? 2 * (MARKER_LENGTH + LOOP * 0.75 + 10 + reach) : 0;
      c = below ? cnode(view.w, view.h + room) : cnode(view.w + room, view.h);
    }
    c.seq = views.length;
    views.push(view);
    cnodes.push(c);
  }
  graph.nodes.forEach((node, i) => {
    cnodes[i].parent = node.parentId !== undefined ? (index.get(node.parentId) ?? -1) : -1;
  });

  const layout = compoundLayout(cnodes, cedges, turned ? 'TB' : direction(db.direction), {
    nodeSep: numberOption(config, 'nodeSpacing', NODE_SEP),
    edgeSep: EDGE_SEP,
    rankSep: numberOption(config, 'rankSpacing', RANK_SEP),
    portSep: 24,
  });

  spreadEnds(cedges, cnodes, views);

  // A subgraph gets its size from the layout, so its loops hang outside it and may widen the diagram.
  let layoutWidth = layout.width;
  for (const [i, own] of loops) {
    const c = cnodes[i];
    if (!c.isGroup) continue;
    let reach = 0;
    for (const loop of own) reach = Math.max(reach, loop.label.width);
    layoutWidth = Math.max(layoutWidth, c.x + c.w / 2 + MARKER_LENGTH + LOOP * 0.75 + 10 + reach);
  }

  const title = titleLabel(db.title, measurer, size, 4000);
  const titleHeight = title.height > 0 ? title.height + 12 : 0;
  const inner = Math.max(layoutWidth, title.width);
  const ox = pad + (inner - layoutWidth) / 2;
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
  let nodesOut = '';
  for (let i = 0; i < views.length; i++) {
    const view = views[i];
    const c = cnodes[i];
    const node = view.node;
    const classes = classNames(node.cssClasses.replace(/^default\s?/, ''));
    if (c.isGroup) {
      view.w = c.w;
      view.h = c.h;
      const x = c.x - c.w / 2;
      const y = c.y - c.h / 2;
      const titleX = clusterTitleX(c, view.label.width, crossings, GROUP_PAD);
      clusters +=
        `<g class="pele-cluster${classes}" data-id="${escText(node.id)}">` +
        `<rect x="${num(x)}" y="${num(y)}" width="${num(c.w)}" height="${num(c.h)}" fill="var(--_a)" fill-opacity="0.5" stroke="var(--_b)"${rounded(view.style.shape)}/>` +
        labelSvg(view.label, titleX, y + 8 + view.label.height / 2, ` class="pele-cluster-label" fill="var(--_m)"${view.style.text}`, icons) +
        '</g>';
      continue;
    }

    const w = view.w;
    const h = view.h;
    const x0 = -w / 2;
    const y0 = -h / 2;
    const text = view.style.text;
    const shape = `x="${num(x0)}" y="${num(y0)}" width="${num(w)}" height="${num(h)}"`;
    let name = labelSvg(view.label, 0, view.rows.length > 0 ? y0 + view.headH / 2 : 0, ` class="pele-label"${text}`, icons);
    const display = decodeEntities(node.alias || node.label);
    if (/ internal-link(?: |$)/.test(classes + ' ') && name !== '' && options.links !== false) {
      // The name ends up in an href, so it gets the same check as a URL.
      const safe = linkUrl(sanitizeUrl(display), options) !== undefined;
      const target = esc(display);
      name = `<a class="internal-link"${safe ? ` href="${target}"${relAttr(options)}` : ''} data-href="${target}">${name}</a>`;
      links.push({ id: node.label, href: display, internal: true });
    }

    let body: string;
    if (view.rows.length === 0) {
      body = `<rect ${shape}${rounded(BOX_ATTRS + view.style.shape)}/>` + name;
    } else {
      const rowLine = Math.round(view.rowSize * 1.5);
      const lineColor = view.style.stroke ? esc(view.style.stroke) : 'var(--_b)';
      let stripes = '';
      let cells = '';
      let y = y0 + view.headH;
      for (let r = 0; r < view.rows.length; r++) {
        const row = view.rows[r];
        if (r % 2 === 0) {
          const span = `x="${num(x0)}" width="${num(w)}"`;
          if (r === view.rows.length - 1) {
            // The last row follows the box's rounded bottom corners: a rounded rect, squared off on top.
            stripes +=
              `<rect ${span} y="${num(y)}" height="${num(row.h)}"${ROUNDED}/>` +
              `<rect ${span} y="${num(y)}" height="${num(row.h / 2)}"/>`;
          } else {
            stripes += `<rect ${span} y="${num(y)}" height="${num(row.h)}"/>`;
          }
        }
        const baseline = y + ROW_PAD / 2 + rowLine / 2 + view.rowSize * 0.35;
        const [type, attribute, keys, comment] = row.cells;
        cells +=
          textLeft(type, x0 + view.cols[0], baseline, ` class="pele-er-type" fill="var(--_m)"${text}`, icons) +
          textLeft(attribute, x0 + view.cols[1], baseline, ` class="pele-er-name"${text}`, icons) +
          textLeft(keys, x0 + view.cols[2], baseline, ` class="pele-er-keys" font-size="${view.keySize}" fill="var(--_m)"${text}`, icons) +
          textLeft(comment, x0 + view.cols[3], baseline, ` class="pele-er-comment" fill="var(--_m)"${text}`, icons);
        y += row.h;
      }
      const dividerY = num(y0 + view.headH);
      body =
        `<rect ${shape}${rounded(BOX_ATTRS + view.style.shape)}/>` +
        // Over a fill the diagram chose, the shading is a tint of that fill. The opacity is on the
        // group because the two parts of the last row overlap.
        `<g class="pele-er-stripes" fill="var(--_bg)"${view.style.shape.includes('fill:') ? ' opacity="0.6"' : ''}>${stripes}</g>` +
        `<path class="pele-er-divider" d="M${num(x0)},${dividerY}H${num(x0 + w)}" stroke="${lineColor}"/>` +
        `<rect ${shape} fill="none" stroke="var(--_b)"${rounded(view.style.line)}/>` +
        name +
        `<g class="pele-er-attributes" font-size="${view.rowSize}">${cells}</g>`;
    }
    nodesOut += `<g class="pele-node pele-entity${classes}" data-id="${escText(node.label)}" transform="translate(${num(
      c.x
    )},${num(c.y)})">${body}</g>`;
  }

  // Self-relationships share the side they loop out of, squeezed together if it is too short for them.
  for (const [i, own] of loops) {
    const view = views[i];
    let total = 0;
    for (const loop of own) total += loop.band;
    const scale = Math.min(1, Math.max((view.below ? view.w : view.h) - 8, 0) / total);
    let at = (-total * scale) / 2;
    for (const loop of own) {
      loop.band *= scale;
      loop.at = at + loop.band / 2;
      at += loop.band;
    }
  }

  let edgesOut = '';
  let labelsOut = '';
  for (let i = 0; i < cedges.length; i++) {
    const ce = cedges[i];
    const edge = drawn[i];
    const label = edgeLabels[i];
    let d: string;
    let start: string;
    let end: string;
    const loop = loopOf[i];
    if (loop) {
      const c = cnodes[ce.src];
      const view = views[ce.src];
      const spread = Math.max(Math.min(loop.band / 2 - 6, 13), 1);
      const far = MARKER_LENGTH + LOOP * 0.75 + 6;
      if (view.below) {
        const x = c.x + loop.at;
        const y = c.y + view.h / 2;
        const turn = num(y + MARKER_LENGTH);
        const out = num(y + MARKER_LENGTH + LOOP);
        d = `M${num(x - spread)},${num(y)}V${turn}C${num(x - spread)},${out} ${num(x + spread)},${out} ${num(x + spread)},${turn}V${num(y)}`;
        start = erMarker(edge.arrowTypeStart, x - spread, y, 0, -1);
        end = erMarker(edge.arrowTypeEnd, x + spread, y, 0, -1);
        ce.labelX = x;
        ce.labelY = y + far + label.height / 2;
      } else {
        const x = c.x + view.w / 2;
        const y = c.y + loop.at;
        const turn = num(x + MARKER_LENGTH);
        const out = num(x + MARKER_LENGTH + LOOP);
        d = `M${num(x)},${num(y - spread)}H${turn}C${out},${num(y - spread)} ${out},${num(y + spread)} ${turn},${num(y + spread)}H${num(x)}`;
        start = erMarker(edge.arrowTypeStart, x, y - spread, -1, 0);
        end = erMarker(edge.arrowTypeEnd, x, y + spread, -1, 0);
        ce.labelX = x + far + label.width / 2;
        ce.labelY = y;
      }
    } else {
      const route = straighten(ce.route);
      if (route.length < 6) continue;
      inset(route, 0, views[ce.src], cnodes[ce.src]);
      inset(route, route.length - 3, views[ce.dst], cnodes[ce.dst]);
      // A curve stops short of each box so that the marker sits on a straight run of line.
      const dx = Math.abs(route[route.length - 3] - route[0]);
      const dy = Math.abs(route[route.length - 2] - route[1]);
      const direct = route.length === 6 && (dx < 0.01 || dy < 0.01 || Math.hypot(dx, dy) <= 3 * MARKER_LENGTH);
      const stub = direct ? 0 : MARKER_LENGTH;
      const path = routePath(route, undefined, stub, stub);
      d = stub > 0 ? `M${num(path.sx)},${num(path.sy)}L${path.d.slice(1)}L${num(path.ex)},${num(path.ey)}` : path.d;
      start = erMarker(edge.arrowTypeStart, path.sx, path.sy, path.sdx, path.sdy);
      end = erMarker(edge.arrowTypeEnd, path.ex, path.ey, path.edx, path.edy);
    }
    const dashed = edge.pattern === 'dashed';
    edgesOut +=
      `<g class="pele-edge pele-er-${dashed ? 'non-identifying' : 'identifying'}" data-id="${escText(edge.id)}">` +
      `<path d="${d}"${dashed ? ' stroke-dasharray="4 3"' : ''}/>` +
      start +
      end +
      '</g>';
    if (label.width > 0) {
      const x = ce.labelX;
      const y = ce.labelY;
      labelsOut += edgeLabelSvg(edge.id, label, x, y, '', icons);
    }
  }

  const svg = svgDocument(
    'er',
    width,
    height,
    size,
    options,
    db,
    labelSvg(title, width / 2, pad + title.height / 2, ' class="pele-title" font-weight="var(--_tw)"') +
      (clusters ? `<g class="pele-clusters">${clusters}</g>` : '') +
      (edgesOut ? `<g class="pele-edges" fill="none" stroke="var(--_l)" stroke-linecap="round">${edgesOut}</g>` : '') +
      (labelsOut ? `<g class="pele-edge-labels" font-size="${smallSize}">${labelsOut}</g>` : '') +
      `<g class="pele-nodes">${nodesOut}</g>`
  );

  return { svg, width, height, links };
}

function straighten(route: number[]): number[] {
  const out = route.slice(0, 3);
  for (let k = 3; k < route.length; k += 3) {
    const prev = out.length - 3;
    const flat = (axis: number): boolean =>
      Math.abs(out[prev + axis] - route[k + axis]) < 0.01 && Math.abs(route[k + axis] - route[k + 3 + axis]) < 0.01;
    if (k + 3 < route.length && (flat(0) || flat(1))) continue;
    out.push(route[k], route[k + 1], route[k + 2]);
  }
  return out;
}

interface End {
  route: number[];
  at: number;
  toward: number;
}

// The layout brings every edge that ends on one side of a box to the middle of that side, where
// their markers would cover each other. This spaces them along the side, in the order they fan out.
function spreadEnds(cedges: CEdge[], cnodes: CNode[], views: NodeView[]): void {
  const sides = new Map<number, End[]>();
  const add = (node: number, route: number[], at: number, next: number): void => {
    const c = cnodes[node];
    const dx = route[at] - c.x;
    const dy = route[at + 1] - c.y;
    let side: number;
    if (Math.abs(Math.abs(dy) - c.h / 2) < 0.5) side = dy < 0 ? 0 : 2;
    else if (Math.abs(Math.abs(dx) - c.w / 2) < 0.5) side = dx < 0 ? 3 : 1;
    else return;
    const key = node * 4 + side;
    const end = { route, at, toward: route[next + (side & 1 ? 1 : 0)] };
    const list = sides.get(key);
    if (list) list.push(end);
    else sides.set(key, [end]);
  };
  for (const e of cedges) {
    const last = e.route.length - 3;
    if (e.src === e.dst || last < 3) continue;
    add(e.src, e.route, 0, 3);
    add(e.dst, e.route, last, last - 3);
  }
  for (const [key, ends] of sides) {
    if (ends.length < 2) continue;
    const node = key >> 2;
    const vertical = (key & 1) === 1;
    const box = cnodes[node].isGroup ? cnodes[node] : views[node];
    const length = vertical ? box.h : box.w;
    const step = Math.max(Math.min(PORT_GAP, (length - 2 * PORT_MARGIN) / (ends.length - 1)), 0);
    const center = vertical ? cnodes[node].y : cnodes[node].x;
    ends.sort((a, b) => a.toward - b.toward);
    for (let i = 0; i < ends.length; i++) {
      ends[i].route[ends[i].at + (vertical ? 1 : 0)] = center + (i - (ends.length - 1) / 2) * step;
    }
  }
}

// An entity with a self-relationship is laid out larger than it is drawn; this moves a route end
// from the side of that larger box onto the entity's own side.
function inset(route: number[], at: number, view: NodeView, c: CNode): void {
  if (c.isGroup) return;
  const dx = route[at] - c.x;
  const dy = route[at + 1] - c.y;
  if (c.w !== view.w && Math.abs(Math.abs(dx) - c.w / 2) < 0.5) route[at] -= (Math.sign(dx) * (c.w - view.w)) / 2;
  if (c.h !== view.h && Math.abs(Math.abs(dy) - c.h / 2) < 0.5) route[at + 1] -= (Math.sign(dy) * (c.h - view.h)) / 2;
}
