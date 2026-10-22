import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { PeleError, parse, render, supports, type C4Model } from '../../src/index.js';
import { metricsMeasurer } from '../../src/text/measurer.js';
import { loadCorpus } from '../support/corpus.js';
import { assertInert } from '../support/inert.js';
import { elements } from '../support/xml.js';

const options = { measurer: metricsMeasurer };
const draw = (src: string) => render(src, options);
const count = (svg: string, needle: string): number => svg.split(needle).length - 1;
const model = (src: string): C4Model => parse(src) as C4Model;

// The box of a shape or boundary, read back from the markup. For a person it is the body, without the head.
function box(svg: string, id: string): { x: number; y: number; w: number; h: number } {
  const node = new RegExp(
    `data-id="${id}" transform="translate\\(([-\\d.]+),([-\\d.]+)\\)"><(?:a [^>]*><)?rect x="([-\\d.]+)" y="([-\\d.]+)" width="([\\d.]+)" height="([\\d.]+)"`
  ).exec(svg);
  if (node) {
    return { x: Number(node[1]) + Number(node[3]), y: Number(node[2]) + Number(node[4]), w: Number(node[5]), h: Number(node[6]) };
  }
  const group = new RegExp(`data-id="${id}"><rect x="([-\\d.]+)" y="([-\\d.]+)" width="([\\d.]+)" height="([\\d.]+)"`).exec(svg);
  if (!group) throw new Error(`No box for ${id}`);
  return { x: Number(group[1]), y: Number(group[2]), w: Number(group[3]), h: Number(group[4]) };
}

const labelX = (svg: string, id: string): number =>
  Number(new RegExp(`class="pele-edge-label" data-id="${id}">(?:<title>[^<]*</title>)?<rect x="([-\\d.]+)"`).exec(svg)![1]);
const labelY = (svg: string, id: string): number =>
  Number(new RegExp(`class="pele-edge-label" data-id="${id}">(?:<title>[^<]*</title>)?<rect x="[-\\d.]+" y="([-\\d.]+)"`).exec(svg)![1]);

describe('C4 rendering', () => {
  it('draws shapes, boundaries, and relations', () => {
    const { svg, type } = draw(`C4Context
title System Context
Person(user, "User", "Uses the bank")
Enterprise_Boundary(bank, "Bank") {
  System(app, "Banking", "Moves money")
  SystemDb_Ext(ledger, "Ledger")
}
Rel(user, app, "Uses", "HTTPS")
BiRel(app, ledger, "Syncs")`);
    expect(type).toBe('c4');
    expect(supports('C4Context\nPerson(a, "A")')).toBe(true);
    expect(svg).toContain('class="pele pele-c4"');
    expect(count(svg, 'class="pele-node ')).toBe(3);
    expect(count(svg, 'class="pele-cluster ')).toBe(1);
    expect(count(svg, 'class="pele-edge"')).toBe(2);
    expect(count(svg, 'class="pele-edge-label"')).toBe(2);
    expect(count(svg, 'class="pele-marker"')).toBe(3);
    expect(svg).toContain('>System Context<');
    expect(svg).toContain('«person»');
    expect(svg).toContain('«external system db»');
    expect(svg).toContain('>[HTTPS]<');
    expect(svg).toContain('>[ENTERPRISE]<');
    assertInert(svg, 'basic');
  });

  it('accepts all five diagram keywords', () => {
    for (const keyword of ['C4Context', 'C4Container', 'C4Component', 'C4Dynamic', 'C4Deployment']) {
      expect(model(`${keyword}\nPerson(a, "A")`).c4Type).toBe(keyword);
      expect(draw(`${keyword}\nPerson(a, "A")`).svg).toContain('data-id="a"');
    }
  });

  it('gives each kind of element its shape', () => {
    const { svg } = draw(`C4Container
Person(p, "P")
Person_Ext(pe, "PE")
System(s, "S")
SystemDb(sd, "SD")
SystemQueue(sq, "SQ")
Container_Ext(ce, "CE", "Go")
ContainerDb_Ext(cde, "CDE")
ComponentQueue_Ext(cqe, "CQE")`);
    expect(svg).toMatch(/pele-shape-person pele-c4-person" data-id="p"[^>]*><rect[^>]*><circle/);
    expect(svg).toContain('pele-shape-person pele-c4-external_person pele-c4-external" data-id="pe"');
    expect(svg).toContain('pele-shape-rect pele-c4-system" data-id="s"');
    expect(svg).toContain('pele-shape-cyl pele-c4-system_db" data-id="sd"');
    expect(svg).toContain('pele-shape-h-cyl pele-c4-system_queue" data-id="sq"');
    expect(svg).toContain('pele-shape-cyl pele-c4-external_container_db pele-c4-external" data-id="cde"');
    expect(svg).toContain('pele-shape-h-cyl pele-c4-external_component_queue pele-c4-external" data-id="cqe"');
    // External elements are hollow with a dashed border; the rest are filled.
    expect(svg).toMatch(/data-id="ce"[^>]*><rect[^>]*fill="var\(--_bg\)" stroke="var\(--_b\)" stroke-dasharray="4 3"/);
    expect(svg).toMatch(/data-id="s"[^>]*><rect[^>]*fill="var\(--_s\)" stroke="var\(--_b\)" style="rx:var\(--_r\)"\/>/);
  });

  it('takes a shape from $shape, $sprite or $tags, as Mermaid does', () => {
    const { svg } = draw(`C4Context
System(a, "A", $tags="v1, cylinder")
System(b, "B", $sprite="queue")
System(c, "C")
UpdateElementStyle(c, $shape="Person")
System(d, "D", $tags="constructor")`);
    expect(svg).toContain('pele-shape-cyl pele-c4-system" data-id="a"');
    expect(svg).toContain('pele-shape-h-cyl pele-c4-system" data-id="b"');
    expect(svg).toContain('pele-shape-person pele-c4-system" data-id="c"');
    expect(svg).toContain('pele-shape-rect pele-c4-system" data-id="d"');
  });

  it('writes the type, name, technology, and description of a shape', () => {
    const { svg } = draw('C4Container\nContainer(api, "API", "Node.js", "Serves <b>requests</b><br/>all day")');
    expect(svg).toContain('«container»');
    expect(svg).toMatch(/class="pele-label" font-weight="var\(--_hw\)"[^>]*>(<tspan[^>]*>)?API</);
    expect(svg).toContain('>[Node.js]<');
    expect(svg).toContain('font-weight="var(--_w)">requests</tspan>');
    expect(svg).toContain('all day');
    expect(svg).not.toContain('&lt;br');
  });

  it('wraps long text inside a fixed width and widens for a word that cannot wrap', () => {
    const wrapped = draw(`C4Context\nSystem(a, "A", "${'word '.repeat(40)}")`);
    expect(box(wrapped.svg, 'a').w).toBe(216);
    expect(box(wrapped.svg, 'a').h).toBeGreaterThan(150);
    const wide = draw(`C4Context\nSystem(a, "${'W'.repeat(40)}")`);
    expect(box(wide.svg, 'a').w).toBeGreaterThan(400);
  });

  it('lays shapes out in rows of four and boundaries in rows of two by default', () => {
    const { svg } = draw(`C4Context
${[1, 2, 3, 4, 5].map((i) => `System(s${i}, "S${i}")`).join('\n')}
${[1, 2, 3].map((i) => `Boundary(b${i}, "B${i}") {\n System(i${i}, "I${i}")\n}`).join('\n')}`);
    const s = [1, 2, 3, 4, 5].map((i) => box(svg, `s${i}`));
    expect(new Set(s.slice(0, 4).map((b) => b.y)).size).toBe(1);
    expect(s[1].x).toBeGreaterThan(s[0].x + s[0].w);
    expect(s[4].x).toBe(s[0].x);
    expect(s[4].y).toBeGreaterThan(s[0].y + s[0].h);
    const b = [1, 2, 3].map((i) => box(svg, `b${i}`));
    expect(b[0].y).toBeGreaterThan(s[4].y + s[4].h);
    expect(b[1].y).toBe(b[0].y);
    expect(b[1].x).toBeGreaterThan(b[0].x + b[0].w);
    expect(b[2].x).toBe(b[0].x);
    expect(b[2].y).toBeGreaterThan(b[0].y + b[0].h);
  });

  it('follows UpdateLayoutConfig', () => {
    const src = (config: string): string =>
      `C4Context\nSystem(a, "A")\nSystem(b, "B")\nSystem(c, "C")\nBoundary(x, "X") {\n System(d, "D")\n}\nBoundary(y, "Y") {\n System(e, "E")\n}\n${config}`;
    const stacked = draw(src('UpdateLayoutConfig($c4ShapeInRow="1", $c4BoundaryInRow="1")')).svg;
    expect(box(stacked, 'b').x).toBe(box(stacked, 'a').x);
    expect(box(stacked, 'b').y).toBeGreaterThan(box(stacked, 'a').y);
    expect(box(stacked, 'y').x).toBe(box(stacked, 'x').x);
    const positional = draw(src('UpdateLayoutConfig("2", "2")')).svg;
    expect(box(positional, 'b').y).toBe(box(positional, 'a').y);
    expect(box(positional, 'c').y).toBeGreaterThan(box(positional, 'a').y);
    expect(box(positional, 'y').y).toBe(box(positional, 'x').y);
    // Values below one are ignored. The slot decides what a value sets, not its name, as in Mermaid.
    expect(model(src('UpdateLayoutConfig("0", "-3")')).shapeInRow).toBe(4);
    expect(model(src('UpdateLayoutConfig($c4BoundaryInRow="3")')).shapeInRow).toBe(3);
    expect(model(src('UpdateLayoutConfig($c4BoundaryInRow="3")')).boundaryInRow).toBe(2);
  });

  it('nests boundaries and sizes each around what it holds', () => {
    const { svg } = draw(`C4Deployment
Deployment_Node(outer, "Outer", "Linux", "A machine") {
  Node(inner, "Inner") {
    Container(app, "App")
  }
  Node_L(left, "Left") {
    Container(other, "Other")
  }
}`);
    const outer = box(svg, 'outer');
    const inner = box(svg, 'inner');
    const app = box(svg, 'app');
    const inside = (a: typeof outer, b: typeof outer): boolean =>
      a.x > b.x && a.y > b.y && a.x + a.w < b.x + b.w && a.y + a.h < b.y + b.h;
    expect(inside(inner, outer)).toBe(true);
    expect(inside(app, inner)).toBe(true);
    expect(inside(box(svg, 'left'), outer)).toBe(true);
    expect(svg).toContain('>[Linux]<');
    expect(svg).toContain('>A machine<');
    expect(svg).toContain('>[node]<');
    // Deployment nodes have a solid border; other boundaries are dashed.
    expect(svg).toMatch(/class="pele-cluster pele-c4-node" data-id="outer"><rect[^>]*stroke="var\(--_b\)" style="rx:var\(--_r\)"\/>/);
    expect(draw('C4Context\nBoundary(b, "B") {\nSystem(s, "S")\n}').svg).toMatch(
      /class="pele-cluster pele-c4-boundary" data-id="b"><rect[^>]*stroke-dasharray="6 4" style="rx:var\(--_r\)"\/>/
    );
  });

  it('labels each kind of boundary with its type', () => {
    const { svg } = draw(`C4Container
Enterprise_Boundary(e, "E") {
  System_Boundary(s, "S") {
    Container_Boundary(c, "C") {
      Boundary(b, "B") {
        Boundary(t, "T", "custom") {
          System(x, "X")
        }
      }
    }
  }
}`);
    for (const type of ['ENTERPRISE', 'SYSTEM', 'CONTAINER', 'system', 'custom']) expect(svg).toContain(`>[${type}]<`);
  });

  it('draws an arrowhead for each end a relation points at', () => {
    const markers = (rel: string): number => count(draw(`C4Context\nSystem(a, "A")\nSystem(b, "B")\n${rel}`).svg, 'pele-marker');
    for (const name of ['Rel', 'Rel_U', 'Rel_Up', 'Rel_D', 'Rel_Down', 'Rel_L', 'Rel_Left', 'Rel_R', 'Rel_Right']) {
      expect(markers(`${name}(a, b, "x")`)).toBe(1);
    }
    expect(markers('BiRel(a, b, "x")')).toBe(2);
    expect(markers('Rel_Back(a, b, "x")')).toBe(1);
    const forward = draw('C4Context\nSystem(a, "A")\nSystem(b, "B")\nRel(a, b, "x")').svg;
    const back = draw('C4Context\nSystem(a, "A")\nSystem(b, "B")\nRel_Back(a, b, "x")').svg;
    const tip = (svg: string): number => Number(/class="pele-marker" d="M([\d.]+),/.exec(svg)![1]);
    expect(tip(forward)).toBe(box(forward, 'b').x);
    expect(tip(back)).toBe(box(back, 'a').x + box(back, 'a').w);
  });

  it('ignores the index of RelIndex and a relation without a label', () => {
    const m = model('C4Dynamic\nSystem(a, "A")\nSystem(b, "B")\nRelIndex(7, a, b, "x")\nRel(b, "a")');
    expect(m.rels).toHaveLength(1);
    expect(m.rels[0]).toMatchObject({ type: 'rel', from: 'a', to: 'b', label: 'x' });
  });

  it('numbers relations in a dynamic diagram', () => {
    const src = 'System(a, "A")\nSystem(b, "B")\nSystem(c, "C")\nRel(a, b, "first")\nRel(b, c, "second")';
    const dynamic = draw('C4Dynamic\n' + src).svg;
    expect(dynamic).toContain('>1: first<');
    expect(dynamic).toContain('>2: second<');
    expect(draw('C4Context\n' + src).svg).toContain('>first<');
  });

  it('joins neighbours with a straight line between their borders', () => {
    const { svg } = draw('C4Context\nSystem(a, "A")\nSystem(b, "B")\nRel(a, b, "x")');
    const a = box(svg, 'a');
    const b = box(svg, 'b');
    const d = /class="pele-edge" data-id="a-b"><path d="M([\d.]+),([\d.]+)L([\d.]+),([\d.]+)"/.exec(svg)!;
    expect(Number(d[1])).toBe(a.x + a.w);
    expect(Number(d[2])).toBe(a.y + a.h / 2);
    expect(Number(d[3])).toBeCloseTo(b.x - 7, 5);
    expect(Number(d[4])).toBe(Number(d[2]));
  });

  it('fits the label of a line between neighbours in the gap between them', () => {
    for (const args of ['"Sends a fairly long description of the relationship"', '"Makes API calls to", "JSON/HTTPS"']) {
      const { svg } = draw(`C4Context\nSystem(a, "A")\nSystem(b, "B")\nRel(a, b, ${args})`);
      const a = box(svg, 'a');
      const b = box(svg, 'b');
      const label = box(svg, 'a-b');
      expect(b.y).toBe(a.y);
      expect(label.x, args).toBeGreaterThanOrEqual(a.x + a.w);
      expect(label.x + label.w, args).toBeLessThanOrEqual(b.x);
    }
  });

  it('ends a line on the outline of a person, a database, and a queue', () => {
    const { svg } = draw(`C4Context
UpdateLayoutConfig("1", "1")
Person(p, "P")
SystemDb(d, "D")
SystemQueue(q, "Q")
Rel(p, d, "x")
Rel(d, q, "y")`);
    const p = box(svg, 'p');
    const path = /data-id="p-d"><path d="M([\d.]+),([\d.]+)L([\d.]+),([\d.]+)"/.exec(svg)!;
    expect(Number(path[2])).toBe(p.y + p.h);
    // The top of a cylinder is the crown of its lid: one radius above where its side starts.
    const lid = /data-id="d" transform="translate\([\d.]+,([\d.]+)\)"><path d="M[-\d.]+,([-\d.]+)A[\d.]+,([\d.]+) /.exec(svg)!;
    const top = Number(lid[1]) + Number(lid[2]) - Number(lid[3]);
    expect(Number(path[4])).toBeCloseTo(top - 7, 5);
    // A queue is entered through the middle of its rounded end.
    const queue = /data-id="d-q"><path d="M([\d.]+),([\d.]+)L([\d.]+),([\d.]+)"/.exec(svg)!;
    expect(Number(queue[1])).toBe(Number(queue[3]));
    expect(Number(queue[4])).toBeGreaterThan(Number(queue[2]) + 50);
  });

  it('goes around the shapes between two in the same row or column', () => {
    const row = draw('C4Context\nSystem(a, "A")\nSystem(b, "B")\nSystem(c, "C")\nRel(a, c, "over")\nRel(c, a, "under")').svg;
    const a = box(row, 'a');
    const over = /data-id="a-c"><path d="M[\d.]+,([-\d.]+)V([-\d.]+)Q/.exec(row)!;
    expect(Number(over[1])).toBe(a.y);
    expect(Number(over[2])).toBeLessThan(a.y);
    const under = /data-id="c-a"><path d="M[\d.]+,([-\d.]+)V([-\d.]+)Q/.exec(row)!;
    expect(Number(under[2])).toBeGreaterThan(a.y + a.h);
    const column = draw('C4Context\nUpdateLayoutConfig("1", "1")\nSystem(a, "A")\nSystem(b, "B")\nSystem(c, "C")\nRel(a, c, "x")').svg;
    expect(column).toMatch(/data-id="a-c"><path d="M[\d.]+,[\d.]+H[\d.]+Q/);
    // Neighbours need no detour.
    expect(row).not.toMatch(/data-id="a-b"/);
    expect(draw('C4Context\nSystem(a, "A")\nSystem(b, "B")\nRel(a, b, "x")').svg).not.toContain('Q');
  });

  const corners = (svg: string): Map<string, number[]> => {
    const out = new Map<string, number[]>();
    for (const [, id, d] of svg.matchAll(/class="pele-edge" data-id="([^"]+)"[^>]*><path d="([^"]+)"/g)) {
      if (d.includes('C')) continue;
      const points: number[] = [];
      for (const [, op, args] of d.matchAll(/([MLHVQ])([^MLHVQ]+)/g)) {
        const n = args.trim().split(/[\s,]+/).map(Number);
        const [x, y] = points.length ? points.slice(-2) : [0, 0];
        if (op === 'H') points.push(n[0], y);
        else if (op === 'V') points.push(x, n[0]);
        // A rounded corner is read as the corner itself.
        else if (op === 'Q') points.push(n[0], n[1]);
        else points.push(n[n.length - 2], n[n.length - 1]);
      }
      out.set(id, points);
    }
    return out;
  };
  const component = (JSON.parse(readFileSync('tests/corpus/c4-docs.json', 'utf8')) as string[]).find(source => source.includes('Accounts Summary Controller'))!;

  it('keeps every line clear of the shapes it does not join', () => {
    const sources = JSON.parse(readFileSync('tests/corpus/c4-docs.json', 'utf8')) as string[];
    const behind = new Set<string>();
    for (const source of sources) {
      const rels = model(source).rels;
      for (const maxWidth of [undefined, 640, 480, 320]) {
        const { svg } = render(source, { ...options, maxWidth });
        // A cylinder is a path; its box here leaves out the bulge of its caps.
        const shapes = [...svg.matchAll(/class="pele-node[^"]*" data-id="([^"]+)" transform="translate\(([-\d.]+),([-\d.]+)\)">(?:<a [^>]*>)?<(rect|path d="M([-\d.]+),([-\d.]+)([HV])([-\d.]+))/g)].map(match => {
          if (match[4] === 'rect') return [match[1], box(svg, match[1])] as const;
          const [cx, cy, mx, my, end] = [match[2], match[3], match[5], match[6], match[8]].map(Number);
          const w = match[7] === 'H' ? end - mx : -2 * mx, h = match[7] === 'V' ? end - my : -2 * my;
          return [match[1], { x: cx + mx, y: cy + my, w, h }] as const;
        });
        const lines = [...corners(svg)];
        lines.forEach(([id, points], index) => {
          const rel = rels.find(r => `${r.from}-${r.to}` === id) ?? rels[index];
          for (const [name, b] of shapes) {
            if (name === rel.from || name === rel.to) continue;
            for (let i = 2; i < points.length; i += 2) {
              const [x0, y0, x1, y1] = [points[i - 2], points[i - 1], points[i], points[i + 1]];
              for (let t = 0; t <= 1; t += 0.02) {
                const x = x0 + (x1 - x0) * t, y = y0 + (y1 - y0) * t;
                const inside = x > b.x + 1 && x < b.x + b.w - 1 && y > b.y + 1 && y < b.y + b.h - 1;
                if (inside) {
                  behind.add(`${id} behind ${name} at ${maxWidth ?? 'full'} width in ${source.split('\n')[1].trim()}`);
                  break;
                }
              }
            }
          }
        });
      }
    }
    // In the full container diagram no line with two corners goes around Mobile App, so one stays behind it.
    expect([...behind]).toEqual(['backend_api-banking_system behind mobile_app at full width in title Container diagram for Internet Banking System']);
  });

  it('bends a line that would cross behind a shape through the gap between columns, apart from the others there', () => {
    const { svg } = render(component, { ...options, maxWidth: 640 });
    const lines = corners(svg);
    const lane = (id: string): number => {
      const points = lines.get(id)!;
      for (let i = 2; i < points.length; i += 2) expect(points[i] === points[i - 2] || points[i + 1] === points[i - 1], id).toBe(true);
      return points[4];
    };
    const spa = box(svg, 'spa'), accounts = box(svg, 'accounts');
    for (const id of ['spa-accounts', 'ma-sign']) {
      expect(lane(id)).toBeGreaterThan(spa.x + spa.w);
      expect(lane(id)).toBeLessThan(accounts.x);
    }
    expect(Math.abs(lane('spa-accounts') - lane('ma-sign'))).toBeGreaterThanOrEqual(10);
  });

  it('takes a detour along the outside of the drawing when its column is at the edge', () => {
    const { svg } = render(component, { ...options, maxWidth: 640 });
    const lines = corners(svg);
    const spa = box(svg, 'spa'), mbs = box(svg, 'mbs');
    expect(lines.get('spa-sign')![4]).toBeLessThan(spa.x);
    expect(lines.get('mbsfacade-mbs')![4]).toBeGreaterThan(mbs.x + mbs.w);
  });

  it('separates two relations that run opposite ways and puts their labels on either side', () => {
    const { svg } = draw('C4Context\nSystem(a, "A")\nSystem(b, "B")\nRel(a, b, "there")\nRel(b, a, "back")');
    const y = (id: string): number => Number(new RegExp(`data-id="${id}"><path d="M[\\d.]+,([\\d.]+)L`).exec(svg)![1]);
    expect(Math.abs(y('a-b') - y('b-a'))).toBe(14);
    expect(labelY(svg, 'a-b')).toBeGreaterThan(y('a-b'));
    expect(labelY(svg, 'b-a') + 20).toBeLessThan(y('b-a'));
  });

  it('draws a relation from a shape to itself as a loop', () => {
    const { svg } = draw('C4Context\nSystem(a, "A")\nRel(a, a, "again")');
    expect(svg).toMatch(/data-id="a-a"><path d="M[\d.]+,[\d.]+C/);
    expect(labelX(svg, 'a-a')).toBeGreaterThan(box(svg, 'a').x + box(svg, 'a').w);
    assertInert(svg, 'loop');
  });

  it('connects a boundary as an end of a relation', () => {
    const { svg } = draw(`C4Context
System(out, "Out")
Boundary(b, "B") {
  System(in, "In")
}
Rel(out, b, "to boundary")
Rel(b, in, "into")`);
    const b = box(svg, 'b');
    const line = /data-id="out-b"><path d="M[\d.]+,[\d.]+L[\d.]+,([\d.]+)"/.exec(svg)!;
    expect(Number(line[1])).toBeCloseTo(b.y - 7, 5);
    const into = /data-id="b-in"><path d="M([\d.]+),([\d.]+)L/.exec(svg)!;
    expect(Number(into[1])).toBe(b.x);
  });

  it('rejects a relation to something that does not exist, as Mermaid does', () => {
    const attempt = (): unknown => draw('C4Context\nSystem(a, "A")\nRel(a, missing, "x")');
    expect(attempt).toThrow(PeleError);
    expect(attempt).toThrow('C4 rel "a" -> "missing" references an unknown shape or boundary');
    expect(() => draw('C4Context\nSystem(a, "A")\nRel($x="y", a, "x")')).toThrow(PeleError);
  });

  it('applies UpdateElementStyle to shapes and boundaries', () => {
    const { svg } = draw(`C4Context
Person(a, "A", "desc")
Boundary(b, "B") {
  System(c, "C")
}
UpdateElementStyle(a, $fontColor="red", $bgColor="grey", $borderColor="blue")
UpdateElementStyle(b, "#eee", "green", "orange")
UpdateElementStyle(nobody, "red")`);
    expect(svg).toMatch(/data-id="a"[^>]*><rect[^>]*style="fill:grey;stroke:blue;"/);
    expect(svg).toMatch(/data-id="a"[^>]*>.*?<circle[^>]*style="fill:grey;stroke:blue;"/);
    expect(count(svg, 'style="fill:red;"')).toBe(3);
    expect(svg).toMatch(/data-id="b"><rect[^>]*style="rx:var\(--_r\);fill:#eee;stroke:orange;"/);
    expect(svg).toMatch(/class="pele-cluster-label"[^>]*style="fill:green;"/);
  });

  it('applies UpdateRelStyle colours and offsets', () => {
    const base = 'C4Context\nUpdateLayoutConfig("1", "1")\nSystem(a, "A")\nSystem(b, "B")\nRel(a, b, "x")\n';
    const plain = draw(base).svg;
    const styled = draw(base + 'UpdateRelStyle(a, b, $textColor="red", $lineColor="blue", $offsetX="30", $offsetY="-10")').svg;
    expect(styled).toContain('<g class="pele-edge" data-id="a-b" style="stroke:blue;">');
    expect(styled).toMatch(/class="pele-marker"[^>]*fill="blue"/);
    expect(styled).toMatch(/class="pele-edge-label" data-id="a-b"><rect[^>]*><text style="fill:red;"/);
    expect(labelX(styled, 'a-b')).toBe(labelX(plain, 'a-b') + 30);
    expect(labelY(styled, 'a-b')).toBe(labelY(plain, 'a-b') - 10);
    const positional = draw(base + 'UpdateRelStyle(a, b, "red", "blue", "30", "-10")').svg;
    expect(positional).toBe(styled);
    // Named in any order: Mermaid turns colours in the last two places into NaN.
    const swapped = draw(base + 'UpdateRelStyle(a, b, $offsetX="30", $offsetY="-10", $lineColor="blue", $textColor="red")').svg;
    expect(swapped).toBe(styled);
  });

  it('keeps a label on its line when an offset would put it on a shape', () => {
    const base = 'C4Context\nSystem(a, "A")\nSystem(b, "B")\nRel(a, b, "x")\n';
    const plain = draw(base).svg;
    expect(draw(base + 'UpdateRelStyle(a, b, $offsetX="-120")').svg).toBe(plain);
    expect(labelY(draw(base + 'UpdateRelStyle(a, b, $offsetY="-60")').svg, 'a-b')).toBe(labelY(plain, 'a-b') - 60);
    expect(draw(base + 'UpdateRelStyle(a, b, $offsetX="9999999999")').width).toBeLessThan(3000);
    expect(draw(base + 'UpdateRelStyle(a, b, $offsetX="abc", $offsetY="x1")').svg).toBe(plain);
  });

  it('reattaches manually offset labels to their arrows when the component layout compacts', () => {
    const source = (JSON.parse(readFileSync('tests/corpus/c4-docs.json', 'utf8')) as string[])
      .find(source => source.includes('Accounts Summary Controller'))!;
    const withoutOffsets = source.replace(/^\s*UpdateRelStyle\([^\n]+\)\s*$/gm, '');
    const parsed = model(source);
    const before = JSON.stringify(parsed);
    for (const maxWidth of [320, 480, 568]) {
      const compact = render(parsed, { ...options, maxWidth });
      expect(compact.svg).toBe(render(withoutOffsets, { ...options, maxWidth }).svg);
    }
    expect(JSON.stringify(parsed)).toBe(before);
    const { svg } = render(parsed, { ...options, maxWidth: 568 });
    for (const [from, to] of [['sign', 'security'], ['accounts', 'mbsfacade']]) {
      const a = box(svg, from), b = box(svg, to);
      const x = labelX(svg, `${from}-${to}`), y = labelY(svg, `${from}-${to}`);
      expect(x).toBeGreaterThan(a.x);
      expect(x).toBeLessThan(a.x + a.w);
      expect(y).toBeGreaterThan(a.y + a.h);
      expect(y + 20).toBeLessThan(b.y);
    }
    const wide = draw(source);
    expect(render(parsed, { ...options, maxWidth: wide.width }).svg).toBe(wide.svg);
    expect(wide.svg).not.toBe(draw(withoutOffsets).svg);
  });

  it('moves a boundary heading out of the way of a line', () => {
    const { svg } = draw(`C4Context
System(top, "Top")
Boundary(b, "Boundary name") {
  System(in, "In")
  System(other, "Other")
}
Rel(top, in, "x")`);
    const heading = Number(/class="pele-cluster-label".*?x="([\d.]+)"/.exec(svg)![1]);
    const line = Number(/data-id="top-in"><path d="M([\d.]+),/.exec(svg)![1]);
    expect(Math.abs(heading - line)).toBeGreaterThan(20);
    const alone = draw('C4Context\nBoundary(b, "Boundary name") {\n System(in, "In")\n System(other, "Other")\n}').svg;
    expect(Number(/class="pele-cluster-label".*?x="([\d.]+)"/.exec(alone)![1])).toBeLessThan(heading);
  });

  it('wraps a shape, a boundary heading, or a relation label in a link', () => {
    const { svg, links } = draw(`C4Context
System(a, "A", $link="https://example.com/a")
Boundary(b, "B", $link="https://example.com/b") {
  System(c, "C", $link="javascript:alert(1)")
}
Rel(a, c, "x", $link="https://example.com/rel")`);
    expect(svg).toMatch(/data-id="a" transform="[^"]*"><a href="https:\/\/example.com\/a" rel="noopener"><rect/);
    expect(svg).toMatch(/data-id="b"><rect[^>]*><a href="https:\/\/example.com\/b" rel="noopener"><text/);
    expect(svg).toMatch(/class="pele-edge-label" data-id="a-c"><rect[^>]*><a href="https:\/\/example.com\/rel"/);
    expect(svg).not.toContain('javascript');
    expect(links).toEqual([
      { id: 'a-c', href: 'https://example.com/rel', internal: false },
      { id: 'a', href: 'https://example.com/a', internal: false },
      { id: 'b', href: 'https://example.com/b', internal: false },
    ]);
  });

  it('stores sprites, tags, and legend arguments without drawing them', () => {
    const src = 'C4Context\nSystem(a, "A", "d", "sprite", "t1,t2")\nUpdateElementStyle(a, $legendText="L", $legendSprite="S", $shadowing="true")';
    const m = model(src);
    expect(m.shapes[0]).toMatchObject({ sprite: 'sprite', tags: 't1,t2', legendText: 'L', legendSprite: 'S', shadowing: 'true' });
    const { svg } = draw(src);
    expect(svg).not.toContain('sprite');
    expect(svg).not.toContain('t1');
    expect(count(svg, '<image')).toBe(0);
  });

  it('shows the description of a relation as a tooltip', () => {
    expect(draw('C4Context\nSystem(a, "A")\nSystem(b, "B")\nRel(a, b, "x", "t", "why <it> matters")').svg).toContain(
      '<title>why &lt;it&gt; matters</title>'
    );
  });

  it('takes the title from the diagram, then from front matter', () => {
    expect(draw('C4Context\ntitle Own title\nSystem(a, "A")').svg).toContain('class="pele-title" font-weight="var(--_tw)"');
    expect(draw('C4Context\ntitle Own title\nSystem(a, "A")').svg).toContain('Own title');
    expect(draw('---\ntitle: From front matter\n---\nC4Context\nSystem(a, "A")').svg).toContain('From front matter');
    expect(draw('---\ntitle: From front matter\n---\nC4Context\ntitle Own\nSystem(a, "A")').svg).not.toContain('From front matter');
    const wide = draw(`C4Context\ntitle ${'A long title '.repeat(8)}\nSystem(a, "A")`);
    expect(wide.width).toBeGreaterThan(600);
  });

  it('treats accTitle as the title, as the grammar does, and accDescr as the description', () => {
    const { svg } = draw('C4Context\naccTitle: Shown on top\naccDescr: For screen readers\nSystem(a, "A")');
    expect(svg).toContain('Shown on top</t');
    expect(svg).toContain('<desc id="pele-desc">For screen readers</desc>');
    expect(svg).not.toContain('<title');
    expect(model('C4Context\naccDescr {\n  two\n  lines\n}\nSystem(a, "A")').accDescr).toBe('two\nlines');
    expect(model('C4Context\naccDescription one line\nSystem(a, "A")').accDescr).toBe('one line');
  });

  it('applies a named argument wherever it is written', () => {
    const m = model(`C4Container
Person(a, $sprite="users")
Container(b, "B", $descr="described")
Container($tags="t", "Anonymous")
Node(n, "N", "t", "d", $link="https://example.com") {
  Container(c, "C", $unknown="kept", $__proto__="safe")
}
Rel(a, b, $techn="HTTP")`);
    expect(m.shapes[0]).toMatchObject({ alias: 'a', label: '', sprite: 'users' });
    expect(m.shapes[1]).toMatchObject({ label: 'B', descr: 'described' });
    expect(m.shapes[1].techn).toBeUndefined();
    expect(m.shapes[2]).toMatchObject({ alias: '', label: 'Anonymous', tags: 't' });
    expect(m.boundaries[1]).toMatchObject({ type: 't', descr: 'd', link: 'https://example.com', nodeType: 'node' });
    expect(m.shapes[3].extra).toEqual(new Map([['unknown', 'kept'], ['__proto__', 'safe']]));
    expect(m.rels[0]).toMatchObject({ label: '', techn: 'HTTP' });
    expect(({} as Record<string, unknown>).safe).toBeUndefined();
    expect(draw('C4Context\nPerson(a, $sprite="users")\nSystem($link="https://example.com", "B")').svg).toContain('>B<');
  });

  it('merges a repeated alias and keeps the first position', () => {
    const m = model(`C4Context
System(a, "First", "d1")
System(b, "B")
Boundary(x, "X") {
  Person(a, "Second")
}
Rel(a, b, "one", "t")
BiRel(a, b, "two")`);
    expect(m.shapes.map((s) => s.alias)).toEqual(['a', 'b']);
    expect(m.shapes[0]).toMatchObject({ label: 'Second', descr: 'd1', kind: 'person' });
    expect(m.shapes[0].parent?.alias).toBe('x');
    expect(m.rels).toHaveLength(1);
    expect(m.rels[0]).toMatchObject({ type: 'birel', label: 'two', techn: 't' });
  });

  it('draws a boundary named global, which Mermaid swallows', () => {
    const { svg } = draw('C4Context\nBoundary(global, "Everything") {\n System(a, "A")\n}');
    expect(svg).toContain('data-id="global"');
    expect(svg).toContain('data-id="a"');
  });

  it('leaves out a boundary that ends up inside itself', () => {
    const { svg } = draw(`C4Context
System(ok, "OK")
Boundary(a, "A") {
  Boundary(b, "B") {
    Boundary(a, "A again") {
      System(lost, "Lost")
    }
  }
}`);
    expect(svg).toContain('data-id="ok"');
    expect(svg).not.toContain('data-id="lost"');
    expect(svg).not.toContain('data-id="b"');
  });

  it('reports syntax errors the way Jison words them', () => {
    const fail = (src: string): PeleError => {
      try {
        draw(src);
      } catch (error) {
        return error as PeleError;
      }
      throw new Error('Expected an error');
    };
    expect(fail('C4Context\nPerson (a, "A")').message).toMatch(/^Lexical error on line 2\. Unrecognized text\./);
    expect(fail('C4Context\nPerson(a, "A") Person(b, "B")').message).toMatch(/Parse error on line 2:[\s\S]*Expecting 'NEWLINE', 'EOF', got 'PERSON'/);
    expect(fail('C4Context\nBoundary(b, "B")\nSystem(a, "A")').message).toContain("Expecting 'LBRACE', got 'SYSTEM'");
    expect(fail('C4Context\nBoundary(b, "B") {\nSystem(a, "A")').message).toContain("got 'EOF'");
    expect(fail('C4Context\n').code).toBe('syntax');
    // An empty named value has no STR_VALUE token in the grammar.
    expect(fail('C4Context\nPerson(a, "A", $link="")').message).toContain("Expecting 'STR_VALUE'");
    expect(fail('C4Context\nPerson(a, "A"').type).toBe('c4');
  });

  it('reads an unquoted last argument through to the next comma, as Mermaid does', () => {
    const m = model('C4Context\nPerson(a, plain label)\nSystem(b, "B")');
    expect(m.shapes).toHaveLength(1);
    expect(m.shapes[0].label).toBe('plain label)\nSystem(b');
  });

  it('gives the same output every time', () => {
    for (const src of loadCorpus('c4', /C4(?:Context|Container|Component|Dynamic|Deployment)/).slice(0, 20)) {
      let first: string;
      try {
        first = draw(src).svg;
      } catch {
        continue;
      }
      expect(draw(src).svg).toBe(first);
    }
  });

  it('renders every documentation example', () => {
    let rendered = 0;
    for (const src of JSON.parse(readFileSync('tests/corpus/c4-docs.json', 'utf8')) as string[]) {
      const { svg, width, height } = draw(src);
      expect(svg).not.toMatch(/NaN|Infinity|undefined/);
      expect(width).toBeGreaterThan(100);
      expect(height).toBeGreaterThan(50);
      for (const el of elements(svg)) if (el.name === 'text') expect(el.attrs.get('x') ?? '0').toMatch(/^-?[\d.]+$/);
      assertInert(svg, src.slice(0, 60));
      rendered++;
    }
    expect(rendered).toBeGreaterThanOrEqual(5);
  });

  it('scales with the font size option', () => {
    const src = 'C4Context\nSystem(a, "A", "Some description text that wraps over lines")';
    expect(render(src, { ...options, fontSize: 24 }).height).toBeGreaterThan(render(src, options).height);
  });
});
