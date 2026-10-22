import { cnode, compoundLayout, direction, type CEdge, type CNode } from '../../layout/compound.js';
import { titleLabel } from '../../svg/title.js';
import type { Config } from '../../preprocess.js';
import { esc, escText, labelSvg, num, sharedStyle, spanStyle, textStyle } from '../../svg/builder.js';
import { edgeLabelSvg, routePath, type EdgePath } from '../../svg/edges.js';
import { svgDocument } from '../../svg/root.js';
import { classNames, resolveStyle, rounded, type ResolvedStyle } from '../../svg/theme.js';
import { hasMath, labelLine, layoutLabel, lineMiddle, type Label } from '../../text/label.js';
import { Style, defaultMeasurer, type TextMeasurer } from '../../text/measurer.js';
import type { RenderOptions, Rendered } from '../../types.js';
import { runsAcross, turnToFit } from '../common/fit-width.js';
import { buildRequirementGraph, type GraphEdge, type GraphNode } from './graph.js';
import type { RequirementModel } from './types.js';

const NODE_SEP = 40;
const EDGE_SEP = 16;
const RANK_SEP = 56;
const PAD_X = 14;
const PAD_Y = 10;
const ROW_GAP = 2;
const COLUMN_GAP = 12;
const MIN_WIDTH = 120;
const NAME_WRAP = 280;
const VALUE_WRAP = 240;
const LOOP = 26;
const CONTAINS_RADIUS = 6;
const ARROW_LENGTH = 9;
const ARROW_HALF = 4.5;
const END_STEP = 28;
const END_MARGIN = 14;

interface Row {
  key: Label;
  value: Label;
  height: number;
}

interface NodeView {
  node: GraphNode;
  style: ResolvedStyle;
  kind: Label;
  name: Label;
  rows: Row[];
  keyWidth: number;
  headHeight: number;
  w: number;
  h: number;
}

// Adds bold or italic to a whole label after its markdown is read, since emphasis markers only
// toggle styles the label does not start with.
function restyle(label: Label, bits: number, measurer: TextMeasurer): Label {
  if (bits === 0 || label.lines.length === 0) return label;
  let width = 0;
  const widths: number[] = [];
  const lines = label.lines.map((line) => {
    let total = 0;
    const spans = line.map((span) => {
      const style = span.style | bits;
      const w = span.icon !== undefined || span.math ? span.width : measurer.width(span.text, label.size, style);
      total += w;
      return { ...span, style, width: w };
    });
    widths.push(total);
    if (total > width) width = total;
    return spans;
  });
  return { ...label, lines, widths, width };
}

// Writes a measured label with its lines starting at x, the first line's box starting at top.
function startText(label: Label, x: number, top: number, attrs: string): string {
  const shared = sharedStyle(label);
  let body = '';
  let math = '';
  for (let i = 0; i < label.lines.length; i++) {
    const line = label.lines[i];
    const middle = top + lineMiddle(label, i);
    if (hasMath(line)) {
      math += labelSvg(labelLine(label, i), x + label.widths[i] / 2, middle, attrs);
      continue;
    }
    const y = middle + label.size * 0.35;
    let first = true;
    for (const span of line) {
      if (span.icon !== undefined || span.text === '') continue;
      body += `<tspan${first ? ` x="${num(x)}" y="${num(y)}"` : ''}${spanStyle(span.style & ~shared)}>${esc(span.text)}</tspan>`;
      first = false;
    }
  }
  return (body === '' ? '' : `<text${textStyle(attrs, shared)} text-anchor="start" xml:space="preserve">${body}</text>`) + math;
}

// The containment mark: a circled plus whose rim touches (x, y), where (dx, dy) points at the node.
function containsMarker(x: number, y: number, dx: number, dy: number): string {
  const r = CONTAINS_RADIUS;
  const cx = x - dx * r;
  const cy = y - dy * r;
  return (
    `<circle class="pele-marker" cx="${num(cx)}" cy="${num(cy)}" r="${r}"/>` +
    `<path class="pele-marker" d="M${num(cx - dx * r)},${num(cy - dy * r)}L${num(cx + dx * r)},${num(cy + dy * r)}M${num(
      cx + dy * r
    )},${num(cy - dx * r)}L${num(cx - dy * r)},${num(cy + dx * r)}"/>`
  );
}

// An open arrowhead with its tip at (x, y), pointing along (dx, dy).
function arrowMarker(x: number, y: number, dx: number, dy: number): string {
  const bx = x - dx * ARROW_LENGTH;
  const by = y - dy * ARROW_LENGTH;
  return `<path class="pele-marker" d="M${num(bx - dy * ARROW_HALF)},${num(by + dx * ARROW_HALF)}L${num(x)},${num(y)}L${num(
    bx + dy * ARROW_HALF
  )},${num(by - dx * ARROW_HALF)}" stroke-linejoin="round"/>`;
}

// The layout attaches every edge to the middle of a node's side. Ends that share a side are
// spread along it, in the order of where they head, so their markers do not sit on each other.
function spreadEnds(cnodes: CNode[], cedges: CEdge[], views: NodeView[]): void {
  const sides = new Map<number, { route: number[]; at: number; toward: number }[]>();
  for (const edge of cedges) {
    const route = edge.route;
    if (edge.src === edge.dst || route.length < 6) continue;
    for (const at of [0, route.length - 3]) {
      const node = at === 0 ? edge.src : edge.dst;
      const c = cnodes[node];
      const dx = route[at] - c.x;
      const dy = route[at + 1] - c.y;
      const next = at === 0 ? 3 : at - 3;
      let side: number;
      if (Math.abs(Math.abs(dy) - c.h / 2) < 0.5) side = dy < 0 ? 0 : 2;
      else if (Math.abs(Math.abs(dx) - c.w / 2) < 0.5) side = dx < 0 ? 3 : 1;
      else continue;
      const key = node * 4 + side;
      const end = { route, at, toward: route[side % 2 === 0 ? next : next + 1] };
      const list = sides.get(key);
      if (list) list.push(end);
      else sides.set(key, [end]);
    }
  }
  for (const [key, list] of sides) {
    if (list.length < 2) continue;
    const node = key >> 2;
    const vertical = key % 2 === 1;
    const span = (vertical ? views[node].h : views[node].w) - 2 * END_MARGIN;
    const step = Math.max(0, Math.min(END_STEP, span / (list.length - 1)));
    list.sort((a, b) => a.toward - b.toward);
    for (let j = 0; j < list.length; j++) {
      const offset = (j - (list.length - 1) / 2) * step;
      if (vertical) list[j].route[list[j].at + 1] = cnodes[node].y + offset;
      else list[j].route[list[j].at] = cnodes[node].x + offset;
    }
  }
}

export function renderRequirement(model: RequirementModel, _config: Config, options: RenderOptions): Rendered {
  if (!runsAcross(model.direction)) return draw(model, _config, options, false);
  return turnToFit(options, (down) => draw(model, _config, options, down));
}

// `turned` draws a diagram that runs across as one that runs down.
function draw(model: RequirementModel, _config: Config, options: RenderOptions, turned: boolean): Rendered {
  const graph = buildRequirementGraph(model);
  const size = options.fontSize ?? 16;
  const small = Math.round(size * 0.875);
  const measurer = options.measurer ?? defaultMeasurer(options.fontFamily, options.fontFamilyMono);
  const pad = options.padding ?? 8;

  const index = new Map<string, number>();
  const views: NodeView[] = [];
  const cnodes: CNode[] = [];
  for (const node of graph.nodes) {
    const style = resolveStyle(node.cssStyles);
    const base = (style.bold ? Style.Bold : 0) | (style.italic ? Style.Italic : 0);
    const nameSize = style.fontSize ?? size;
    const bodySize = style.fontSize ?? small;
    const requirement = node.requirement;
    const element = node.element;
    const kind = restyle(layoutLabel(`«${requirement ? requirement.type : 'Element'}»`, false, measurer, bodySize, 4000), base, measurer);
    const name = restyle(layoutLabel(node.id, true, measurer, nameSize, NAME_WRAP), base | Style.Bold, measurer);
    const fields: [string, string][] = requirement
      ? [
          ['ID', requirement.requirementId],
          ['Text', requirement.text],
          ['Risk', requirement.risk],
          ['Verification', requirement.verifyMethod],
        ]
      : [
          ['Type', element!.type],
          ['Doc Ref', element!.docRef],
        ];
    const rows: Row[] = [];
    let keyWidth = 0;
    let valueWidth = 0;
    let bodyHeight = 0;
    for (const [label, text] of fields) {
      if (!text) continue;
      const key = restyle(layoutLabel(label, false, measurer, bodySize, 4000), base, measurer);
      const value = restyle(layoutLabel(text, true, measurer, bodySize, VALUE_WRAP), base, measurer);
      const height = Math.max(key.height, value.height);
      rows.push({ key, value, height });
      keyWidth = Math.max(keyWidth, key.width);
      valueWidth = Math.max(valueWidth, value.width);
      bodyHeight += height + ROW_GAP;
    }
    if (rows.length > 0) bodyHeight += 2 * PAD_Y - ROW_GAP;
    const headHeight = 2 * PAD_Y + kind.height + name.height;
    const w = Math.max(
      MIN_WIDTH,
      Math.max(kind.width, name.width) + 2 * PAD_X,
      rows.length > 0 ? keyWidth + COLUMN_GAP + valueWidth + 2 * PAD_X : 0
    );
    // A requirement and an element may share a name; relationships then go to the requirement.
    if (!index.has(node.id)) index.set(node.id, views.length);
    const c = cnode(w, headHeight + bodyHeight);
    c.seq = views.length;
    views.push({ node, style, kind, name, rows, keyWidth, headHeight, w, h: headHeight + bodyHeight });
    cnodes.push(c);
  }

  const rootDir = turned ? 'TB' : direction(graph.direction);
  const sideways = rootDir === 'LR' || rootDir === 'RL';
  const cedges: CEdge[] = [];
  const edgeLabels: Label[] = [];
  const drawn: GraphEdge[] = [];
  for (const edge of graph.edges) {
    const src = edge.start === undefined ? undefined : index.get(edge.start);
    const dst = edge.end === undefined ? undefined : index.get(edge.end);
    if (src === undefined || dst === undefined) continue;
    const label = layoutLabel(`«${edge.type}»`, false, measurer, small, 4000);
    if (src === dst) {
      // A self-loop sits beside the node, across the flow, and the node's box grows to hold it.
      if (sideways) cnodes[src].h += 2 * (LOOP + label.height + 8);
      else cnodes[src].w += 2 * (LOOP + label.width + 12);
    }
    drawn.push(edge);
    edgeLabels.push(label);
    cedges.push({
      src,
      dst,
      minlen: 1,
      labelW: label.width + 12,
      labelH: label.height + 4,
      route: [],
      labelX: 0,
      labelY: 0,
    });
  }

  const layout = compoundLayout(cnodes, cedges, rootDir, {
    nodeSep: NODE_SEP,
    edgeSep: EDGE_SEP,
    rankSep: RANK_SEP,
    portSep: 20,
  });

  spreadEnds(cnodes, cedges, views);

  const title = titleLabel(model.title, measurer, size, 4000);
  const titleHeight = title.height > 0 ? title.height + 12 : 0;
  const inner = Math.max(layout.width, title.width);
  const ox = pad + (inner - layout.width) / 2;
  const oy = pad + titleHeight;
  const width = Math.ceil(inner + 2 * pad);
  const height = Math.ceil(layout.height + titleHeight + 2 * pad);

  let nodesOut = '';
  for (let i = 0; i < views.length; i++) {
    const view = views[i];
    const { w, h, style } = view;
    const left = -w / 2;
    const top = -h / 2;
    let body =
      `<rect x="${num(left)}" y="${num(top)}" width="${num(w)}" height="${num(h)}" fill="var(--_s)" stroke="var(--_b)"${rounded(style.shape)}/>` +
      labelSvg(
        view.kind,
        0,
        top + PAD_Y + view.kind.height / 2,
        ` class="pele-stereotype" font-size="${view.kind.size}" fill="var(--_m)"${style.text}`
      ) +
      labelSvg(
        view.name,
        0,
        top + PAD_Y + view.kind.height + view.name.height / 2,
        ` class="pele-label" font-size="${view.name.size}" font-weight="var(--_hw)"${style.text}`
      );
    if (view.rows.length > 0) {
      const divider = top + view.headHeight;
      body += `<path class="pele-divider" d="M${num(left)},${num(divider)}H${num(-left)}" stroke="var(--_b)"${style.line}/>`;
      let y = divider + PAD_Y;
      let rows = '';
      for (const row of view.rows) {
        rows +=
          startText(row.key, left + PAD_X, y, ` class="pele-field" fill="var(--_m)"${style.text}`) +
          startText(row.value, left + PAD_X + view.keyWidth + COLUMN_GAP, y, ` class="pele-value"${style.text}`);
        y += row.height + ROW_GAP;
      }
      body += `<g class="pele-fields" font-size="${view.rows[0].key.size}">${rows}</g>`;
    }
    nodesOut += `<g class="pele-node ${view.node.requirement ? 'pele-requirement' : 'pele-element'}${classNames(
      view.node.cssClasses.replace(/^default\s?/, '')
    )}" data-id="${escText(view.node.id)}" transform="translate(${num(cnodes[i].x + ox)},${num(cnodes[i].y + oy)})">${body}</g>`;
  }

  let edgesOut = '';
  let labelsOut = '';
  const loopSeen = new Map<number, number>();
  for (let i = 0; i < cedges.length; i++) {
    const ce = cedges[i];
    const edge = drawn[i];
    const label = edgeLabels[i];
    const startTrim = edge.contains ? 2 * CONTAINS_RADIUS : 0;
    let path: EdgePath;
    let labelX = ce.labelX + ox;
    let labelY = ce.labelY + oy;
    if (ce.src === ce.dst) {
      const view = views[ce.src];
      const cx = cnodes[ce.src].x + ox;
      const cy = cnodes[ce.src].y + oy;
      const k = loopSeen.get(ce.src) ?? 0;
      loopSeen.set(ce.src, k + 1);
      const half = (sideways ? view.w : view.h) / 2;
      const spread = Math.min(half - 4, 12 + k * 6);
      const reach = LOOP + k * 8;
      // Local frame: `out` points away from the node, `along` runs along its side.
      const at = (out: number, along: number): string =>
        sideways ? `${num(cx + along)},${num(cy + view.h / 2 + out)}` : `${num(cx + view.w / 2 + out)},${num(cy + along)}`;
      // A cubic whose control points are this far out peaks at `reach`.
      const pull = reach / 0.75;
      path = {
        d: `M${at(startTrim, -spread)}C${at(pull, -spread)} ${at(pull, spread)} ${at(0, spread)}`,
        sx: sideways ? cx - spread : cx + view.w / 2,
        sy: sideways ? cy + view.h / 2 : cy - spread,
        sdx: sideways ? 0 : -1,
        sdy: sideways ? -1 : 0,
        ex: sideways ? cx + spread : cx + view.w / 2,
        ey: sideways ? cy + view.h / 2 : cy + spread,
        edx: sideways ? 0 : -1,
        edy: sideways ? -1 : 0,
      };
      if (sideways) {
        labelX = cx;
        labelY = cy + view.h / 2 + reach + 4 + ce.labelH / 2;
      } else {
        labelX = cx + view.w / 2 + reach + 4 + ce.labelW / 2;
        labelY = cy;
      }
    } else {
      const route = ce.route.slice();
      for (let k = 0; k < route.length; k += 3) {
        route[k] += ox;
        route[k + 1] += oy;
      }
      path = routePath(route, undefined, startTrim, 0);
    }
    edgesOut +=
      `<g class="pele-edge pele-relationship-${edge.contains ? 'contains' : 'arrow'}" data-id="${escText(edge.id)}">` +
      `<path d="${path.d}"${edge.contains ? '' : ' stroke-dasharray="5 4"'}/>` +
      (edge.contains
        ? containsMarker(path.sx, path.sy, path.sdx, path.sdy)
        : arrowMarker(path.ex, path.ey, path.edx, path.edy)) +
      '</g>';
    labelsOut += edgeLabelSvg(edge.id, label, labelX, labelY, '');
  }

  const svg = svgDocument(
    'requirement',
    width,
    height,
    size,
    options,
    model,
    labelSvg(title, width / 2, pad + title.height / 2, ' class="pele-title" font-weight="var(--_tw)"') +
      (edgesOut ? `<g class="pele-edges" fill="none" stroke="var(--_l)" stroke-linecap="round">${edgesOut}</g>` : '') +
      (labelsOut ? `<g class="pele-edge-labels" font-size="${small}" fill="var(--_m)">${labelsOut}</g>` : '') +
      `<g class="pele-nodes">${nodesOut}</g>`
  );

  return { svg, width, height, links: [] };
}
