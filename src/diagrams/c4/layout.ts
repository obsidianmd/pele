import { ARROW } from '../../svg/edges.js';
import { layoutLabel, type Label } from '../../text/label.js';
import { Style, type TextMeasurer } from '../../text/measurer.js';
import type { C4Db } from './db.js';
import { HEAD, LABEL_PAD, LANE, NARROW, type Box } from './route.js';
import type { C4Boundary, C4Element, C4Shape } from './types.js';

const SHAPE_W = 216;
const SHAPE_MIN_H = 64;
const PAD_X = 14;
const PAD_Y = 12;
// Room between two columns for the label of a line across them, clear of an arrowhead on either side,
// with an arrowhead's length to spare for a word a little wider than the label room.
const GAP_X = NARROW + LABEL_PAD + 3 * ARROW;
const GAP_Y = 88;
// Room for a relation to run along the inside of a boundary.
export const GROUP_PAD = LANE + 8;
const GROUP_GAP = 48;
// Where a boundary's heading starts, from its top-left corner.
export const HEAD_LEFT = 16;
export const HEAD_TOP = 10;

// Shape keywords Mermaid accepts in $shape, $sprite or $tags, as names of the shared shapes.
const FORMS = new Map([
  ['person', 'person'],
  ['box', 'rect'],
  ['rounded', 'rect'],
  ['component', 'rect'],
  ['cylinder', 'cyl'],
  ['database', 'cyl'],
  ['db', 'cyl'],
  ['queue', 'h-cyl'],
  ['pipe', 'h-cyl'],
]);

export interface Node extends Box {
  shape: C4Shape;
  // Type, name, technology, description.
  labels: Label[];
  textH: number;
}

export interface Group extends Box {
  boundary: C4Boundary;
  kids: Group[];
  nodes: Node[];
  // Name, type, description.
  labels: Label[];
  head: number;
  headW: number;
  headX: number;
}

export interface Layout {
  // The boundaries that are drawn, parents before children. The first is the unnamed top level.
  order: Group[];
  boxes: Map<C4Element, Box>;
}

function formOf(shape: C4Shape): string {
  const explicit = FORMS.get((shape.shape ?? '').toLowerCase()) ?? FORMS.get((shape.sprite ?? '').toLowerCase());
  if (explicit) return explicit;
  if (shape.tags) {
    for (const tag of shape.tags.split(',')) {
      const form = FORMS.get(tag.trim().toLowerCase());
      if (form) return form;
    }
  }
  const kind = shape.kind;
  return kind.endsWith('person') ? 'person' : kind.endsWith('_db') ? 'cyl' : kind.endsWith('_queue') ? 'h-cyl' : 'rect';
}

function measure(shape: C4Shape, measurer: TextMeasurer, size: number, small: number, width = SHAPE_W): Node {
  const form = formOf(shape);
  const capW = form === 'h-cyl' ? 36 : 0;
  const capH = form === 'person' ? HEAD : form === 'cyl' ? 24 : 0;
  const inner = width - 2 * PAD_X - capW;
  const labels = [
    layoutLabel('«' + shape.kind.replace(/_/g, ' ') + '»', false, measurer, small - 1, inner),
    layoutLabel(shape.label, false, measurer, size, inner, Style.Bold),
    layoutLabel(shape.techn ? `[${shape.techn}]` : undefined, false, measurer, small, inner),
    layoutLabel(shape.descr, false, measurer, small, inner),
  ];
  let tw = 0;
  let textH = labels[3].height > 0 ? 4 : 0;
  for (const label of labels) {
    tw = Math.max(tw, label.width);
    textH += label.height;
  }
  return {
    shape,
    form,
    labels,
    textH,
    x: 0,
    y: 0,
    w: Math.max(width, tw + 2 * PAD_X + capW),
    h: Math.max(SHAPE_MIN_H, textH + 2 * PAD_Y + capH),
  };
}

// Places boxes left to right in rows of `perRow`, from (0, 0), and returns the width and height the rows take.
// Shapes are stretched to the height of their row; boundaries keep their own.
function rows(boxes: Box[], perRow: number, gapX: number, gapY: number, stretch: boolean): [number, number] {
  let width = 0;
  let y = 0;
  for (let from = 0; from < boxes.length; from += perRow) {
    const to = Math.min(boxes.length, from + perRow);
    let x = 0;
    let rowH = 0;
    for (let i = from; i < to; i++) rowH = Math.max(rowH, boxes[i].h);
    for (let i = from; i < to; i++) {
      const box = boxes[i];
      box.x = x;
      box.y = y;
      if (stretch) box.h = rowH;
      x += box.w + gapX;
    }
    width = Math.max(width, x - gapX);
    y += rowH + gapY;
  }
  return [width, boxes.length > 0 ? y - gapY : 0];
}

// Mermaid's grid: in each boundary, its shapes in rows of c4ShapeInRow, then the boundaries inside it
// in rows of c4BoundaryInRow, each sized around its own content.
export function layoutC4(db: C4Db, measurer: TextMeasurer, size: number, small: number, room: number | undefined, gap: number): Layout {
  const groupPad = room === undefined ? GROUP_PAD : 12;
  const groups = new Map<C4Boundary, Group>();
  for (const boundary of db.boundaries) {
    const labelRoom = room === undefined ? 4000 : Math.max(80, room - 2 * HEAD_LEFT - 2 * GROUP_PAD * 2);
    const labels = boundary.parent
      ? [
          layoutLabel(boundary.label, false, measurer, size, labelRoom, Style.Bold),
          layoutLabel(boundary.type ? `[${boundary.type}]` : undefined, false, measurer, small, labelRoom),
          layoutLabel(boundary.descr, false, measurer, small, labelRoom),
        ]
      : [];
    let head = 0;
    let headW = 0;
    for (const label of labels) {
      head += label.height;
      headW = Math.max(headW, label.width);
    }
    groups.set(boundary, {
      boundary,
      kids: [],
      nodes: [],
      labels,
      head: head > 0 ? head + HEAD_TOP + 6 + LANE : groupPad,
      headW,
      headX: HEAD_LEFT,
      x: 0,
      y: 0,
      w: 0,
      h: 0,
      form: 'rect',
    });
  }
  const root = groups.get(db.boundaries[0])!;
  for (const group of groups.values()) {
    const parent = group.boundary.parent;
    if (parent) groups.get(parent)?.kids.push(group);
  }
  // A boundary that ends up inside itself is not reachable from the top, as in Mermaid.
  const order: Group[] = [root];
  const depths = new Map<C4Boundary, number>([[root.boundary, 0]]);
  for (let i = 0; i < order.length; i++) {
    for (const kid of order[i].kids) {
      depths.set(kid.boundary, depths.get(order[i].boundary)! + 1);
      order.push(kid);
    }
  }
  for (const shape of db.shapes) {
    if (shape.parent) {
      const depth = depths.get(shape.parent) ?? 0;
      const nodeWidth = room === undefined ? SHAPE_W : Math.max(100, Math.min(SHAPE_W, room - 2 * depth * groupPad - 32));
      groups.get(shape.parent)?.nodes.push(measure(shape, measurer, size, small, nodeWidth));
    }
  }

  const perRow = Math.max(1, db.shapeInRow);
  const groupsPerRow = Math.max(1, db.boundaryInRow);
  const kidsTop = new Map<Group, number>();
  for (let i = order.length - 1; i >= 0; i--) {
    const group = order[i];
    const gapX = room === undefined ? GAP_X : gap;
    const count = (boxes: Box[], limit: number, gap: number): number => {
      if (room === undefined) return limit;
      let widest = 1;
      for (const box of boxes) widest = Math.max(widest, box.w);
      return Math.max(1, Math.min(limit, Math.floor((room + gap - 2 * groupPad) / (widest + gap))));
    };
    const [gridW, gridH] = rows(group.nodes, count(group.nodes, perRow, gapX), gapX, GAP_Y, true);
    const [kidsW, kidsH] = rows(group.kids, count(group.kids, groupsPerRow, GROUP_GAP), GROUP_GAP, GROUP_GAP, false);
    const between = gridH > 0 && kidsH > 0 ? GROUP_GAP : 0;
    const frame = group === root ? 0 : groupPad;
    kidsTop.set(group, gridH + between);
    group.w = Math.max(gridW, kidsW, group.headW + 2 * HEAD_LEFT - 2 * frame) + 2 * frame;
    group.h = (frame && group.head) + gridH + between + kidsH + frame;
  }

  const boxes = new Map<C4Element, Box>();
  for (const group of order) {
    const left = group.x + (group === root ? 0 : groupPad);
    const top = group.y + (group === root ? 0 : group.head);
    for (const node of group.nodes) {
      node.x += left;
      node.y += top;
      boxes.set(node.shape, node);
    }
    for (const kid of group.kids) {
      kid.x += left;
      kid.y += top + kidsTop.get(group)!;
    }
    if (group !== root) boxes.set(group.boundary, group);
  }
  return { order, boxes };
}
