import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { PeleError, parse, render, supports } from '../../src/index.js';
import { metricsMeasurer } from '../../src/text/measurer.js';
import { random } from '../support/corpus.js';

const options = { measurer: metricsMeasurer };
const docs = JSON.parse(readFileSync('tests/corpus/architecture-docs.json', 'utf8')) as string[];

interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

// Icon squares of the services and junctions, by id.
function nodeBoxes(svg: string): Map<string, Box> {
  const size = Number(/class="pele-node pele-service"[^>]*><rect x="[-\d.]+" width="([\d.]+)"/.exec(svg)?.[1] ?? 48);
  const out = new Map<string, Box>();
  for (const m of svg.matchAll(/class="pele-node pele-(?:service|junction)" data-id="([^"]*)" transform="translate\(([-\d.]+),([-\d.]+)\)"/g)) {
    out.set(m[1], { x: Number(m[2]) - size / 2, y: Number(m[3]), w: size, h: size });
  }
  return out;
}

function clusterBoxes(svg: string): Map<string, Box> {
  const out = new Map<string, Box>();
  for (const m of svg.matchAll(/class="pele-cluster" data-id="([^"]*)"><rect x="([-\d.]+)" y="([-\d.]+)" width="([-\d.]+)" height="([-\d.]+)"/g)) {
    out.set(m[1], { x: Number(m[2]), y: Number(m[3]), w: Number(m[4]), h: Number(m[5]) });
  }
  return out;
}

const inside = (a: Box, b: Box): boolean => a.x >= b.x && a.y >= b.y && a.x + a.w <= b.x + b.w && a.y + a.h <= b.y + b.h;
const apart = (a: Box, b: Box): boolean => a.x + a.w <= b.x || b.x + b.w <= a.x || a.y + a.h <= b.y || b.y + b.h <= a.y;

// Whether an edge's orthogonal path crosses a node's icon square. Paths are polylines, so each
// run is checked against the box; a run is axis-aligned, and anything else only counts when an
// end lands inside the box.
function pathCrosses(svg: string, edgeId: string, box: Box): boolean {
  const d = new RegExp(`class="pele-edge" data-id="${edgeId}"><path d="([^"]*)"`).exec(svg)?.[1];
  if (d === undefined) return false;
  const nums = [...d.matchAll(/-?[\d.]+/g)].map((m) => Number(m[0]));
  const inBox = (x: number, y: number): boolean => x >= box.x && x <= box.x + box.w && y >= box.y && y <= box.y + box.h;
  for (let i = 0; i + 3 < nums.length; i += 2) {
    const [x1, y1, x2, y2] = [nums[i], nums[i + 1], nums[i + 2], nums[i + 3]];
    if (inBox(x1, y1) || inBox(x2, y2)) return true;
    if (x1 === x2 && x1 >= box.x && x1 <= box.x + box.w && Math.max(y1, y2) >= box.y && Math.min(y1, y2) <= box.y + box.h) return true;
    if (y1 === y2 && y1 >= box.y && y1 <= box.y + box.h && Math.max(x1, x2) >= box.x && Math.min(x1, x2) <= box.x + box.w) return true;
  }
  return false;
}

function layout(body: string): Map<string, Box> {
  return nodeBoxes(render('architecture-beta\n' + body, options).svg);
}

describe('architecture rendering', () => {
  it('draws every service, group, and edge of the documentation example', () => {
    const { svg, type, width, height } = render(docs[0], options);
    expect(type).toBe('architecture');
    expect(supports(docs[0])).toBe(true);
    expect(svg.match(/class="pele-node pele-service"/g)?.length).toBe(4);
    expect(svg.match(/class="pele-cluster"/g)?.length).toBe(1);
    expect(svg.match(/class="pele-edge"/g)?.length).toBe(3);
    expect(svg).toContain('>Database<');
    expect(svg).toContain('data-icon="database"');
    expect(width).toBeGreaterThan(100);
    expect(height).toBeGreaterThan(100);
  });

  it('renders every documentation example', () => {
    for (const src of docs) expect(render(src, options).svg).toContain('<svg');
  });

  it('places a node on the side its edge names', () => {
    const facing = layout('service a\nservice b\nservice c\nservice d\nservice e\na:R -- L:b\na:L -- R:c\na:T -- B:d\na:B -- T:e');
    const a = facing.get('a')!;
    expect(facing.get('b')!.x).toBeGreaterThan(a.x);
    expect(facing.get('b')!.y).toBe(a.y);
    expect(facing.get('c')!.x).toBeLessThan(a.x);
    expect(facing.get('c')!.y).toBe(a.y);
    expect(facing.get('d')!.y).toBeLessThan(a.y);
    expect(facing.get('d')!.x).toBe(a.x);
    expect(facing.get('e')!.y).toBeGreaterThan(a.y);
    expect(facing.get('e')!.x).toBe(a.x);
  });

  it('places a node diagonally when the sides are perpendicular', () => {
    const bent = layout('service a\nservice b\nservice c\na:R -- T:b\na:T -- R:c');
    const a = bent.get('a')!;
    expect(bent.get('b')!.x).toBeGreaterThan(a.x);
    expect(bent.get('b')!.y).toBeGreaterThan(a.y);
    expect(bent.get('c')!.x).toBeLessThan(a.x);
    expect(bent.get('c')!.y).toBeLessThan(a.y);
    const reversed = layout('service a\nservice b\nb:T -- R:a');
    expect(reversed.get('b')!.x).toBeGreaterThan(reversed.get('a')!.x);
    expect(reversed.get('b')!.y).toBeGreaterThan(reversed.get('a')!.y);
  });

  it('gives every node its own cell when edges ask for the same one', () => {
    const boxes = [...layout('service hub\n' + Array.from({ length: 9 }, (_, i) => `service n${i}\nhub:R -- L:n${i}`).join('\n')).values()];
    for (let i = 0; i < boxes.length; i++) for (let j = i + 1; j < boxes.length; j++) expect(apart(boxes[i], boxes[j])).toBe(true);
    const hub = boxes[0];
    for (const box of boxes.slice(1)) expect(box.x).toBeGreaterThan(hub.x);
  });

  it('keeps unconnected parts apart', () => {
    const boxes = [...layout('service a\nservice b\nservice c\nservice d\nservice e\njunction j\na:R -- L:b').values()];
    for (let i = 0; i < boxes.length; i++) for (let j = i + 1; j < boxes.length; j++) expect(apart(boxes[i], boxes[j])).toBe(true);
  });

  it('draws a group around its members and nothing else', () => {
    const src =
      'architecture-beta\ngroup fe[Frontend]\ngroup be[Backend]\ngroup inner[Inner] in be\nservice web in fe\nservice gw in be\n' +
      'service auth in inner\nservice out\nservice mid\nweb:R -- L:mid\nmid:R -- L:gw\ngw:B -- T:auth\nauth:R -- L:out\nweb:B -- T:out';
    const { svg } = render(src, options);
    const nodes = nodeBoxes(svg);
    const clusters = clusterBoxes(svg);
    const fe = clusters.get('fe')!;
    const be = clusters.get('be')!;
    const inner = clusters.get('inner')!;
    expect(inside(nodes.get('web')!, fe)).toBe(true);
    expect(inside(nodes.get('gw')!, be)).toBe(true);
    expect(inside(nodes.get('auth')!, inner)).toBe(true);
    expect(inside(inner, be)).toBe(true);
    expect(apart(fe, be)).toBe(true);
    expect(inside(nodes.get('gw')!, inner)).toBe(false);
    for (const id of ['out', 'mid']) for (const box of [fe, be, inner]) expect(apart(nodes.get(id)!, box)).toBe(true);
  });

  it('keeps random diagrams free of overlaps, with every group around exactly its members', () => {
    const rnd = random(11);
    const pick = (n: number): number => Math.floor(rnd() * n);
    const sides = ['L', 'R', 'T', 'B'];
    for (let round = 0; round < 300; round++) {
      const groupCount = pick(6);
      const nodeCount = 1 + pick(14);
      const groupParent: number[] = [];
      const nodeParent: number[] = [];
      let src = 'architecture-beta\n';
      for (let g = 0; g < groupCount; g++) {
        groupParent.push(g > 0 && rnd() < 0.5 ? pick(g) : -1);
        src += `group g${g}${rnd() < 0.5 ? '[Group title]' : ''}${groupParent[g] >= 0 ? ` in g${groupParent[g]}` : ''}\n`;
      }
      for (let i = 0; i < nodeCount; i++) {
        nodeParent.push(groupCount > 0 && rnd() < 0.7 ? pick(groupCount) : -1);
        const where = nodeParent[i] >= 0 ? ` in g${nodeParent[i]}` : '';
        src += rnd() < 0.15 ? `junction n${i}${where}\n` : `service n${i}${rnd() < 0.5 ? '[Name]' : ''}${where}\n`;
      }
      for (let k = pick(nodeCount * 2); k > 0; k--) {
        src += `n${pick(nodeCount)}:${sides[pick(4)]} -${rnd() < 0.2 ? '[label]-' : '-'}${rnd() < 0.5 ? '>' : ''} ${sides[pick(4)]}:n${pick(nodeCount)}\n`;
      }
      if (nodeCount > 2 && rnd() < 0.3) src += `align ${rnd() < 0.5 ? 'row' : 'column'} n0 n1 n2\n`;

      const { svg } = render(src, options);
      const nodes = nodeBoxes(svg);
      const clusters = clusterBoxes(svg);
      expect(nodes.size, src).toBe(nodeCount);
      expect(clusters.size, src).toBe(groupCount);
      const within = (g: number, ancestor: number): boolean => {
        for (let p = g; p >= 0; p = groupParent[p]) if (p === ancestor) return true;
        return false;
      };
      for (let i = 0; i < nodeCount; i++) {
        const box = nodes.get(`n${i}`)!;
        for (let j = i + 1; j < nodeCount; j++) expect(apart(box, nodes.get(`n${j}`)!), src).toBe(true);
        for (let g = 0; g < groupCount; g++) {
          const member = within(nodeParent[i], g);
          expect(member ? inside(box, clusters.get(`g${g}`)!) : apart(box, clusters.get(`g${g}`)!), `n${i} and g${g} in ${src}`).toBe(true);
        }
      }
      for (let g = 0; g < groupCount; g++) {
        for (let k = 0; k < groupCount; k++) {
          if (g === k) continue;
          const a = clusters.get(`g${g}`)!;
          const b = clusters.get(`g${k}`)!;
          if (within(g, k)) expect(inside(a, b), `g${g} in g${k} in ${src}`).toBe(true);
          else if (!within(k, g)) expect(apart(a, b), `g${g} and g${k} in ${src}`).toBe(true);
        }
      }
    }
  });

  it('follows align directives ahead of edges', () => {
    const row = layout('service a\nservice b\nservice c\nservice p\na:B -- T:p\nb:B -- T:p\nc:B -- T:p\nalign row a b c');
    expect(row.get('a')!.y).toBe(row.get('b')!.y);
    expect(row.get('b')!.y).toBe(row.get('c')!.y);
    expect(row.get('a')!.x).toBeLessThan(row.get('b')!.x);
    expect(row.get('b')!.x).toBeLessThan(row.get('c')!.x);
    const column = layout('service a\nservice b\nservice c\nalign column c a b');
    expect(column.get('c')!.x).toBe(column.get('a')!.x);
    expect(column.get('c')!.y).toBeLessThan(column.get('a')!.y);
    expect(column.get('a')!.y).toBeLessThan(column.get('b')!.y);
  });

  it('draws arrowheads only where the edge has them', () => {
    const count = (edge: string): number =>
      render(`architecture-beta\nservice a\nservice b\n${edge}`, options).svg.match(/class="pele-marker"/g)?.length ?? 0;
    expect(count('a:R -- L:b')).toBe(0);
    expect(count('a:R --> L:b')).toBe(1);
    expect(count('a:R <-- L:b')).toBe(1);
    expect(count('a:R <--> L:b')).toBe(2);
  });

  it('draws straight, bent, and looping edges as orthogonal paths', () => {
    const path = (body: string): string => /class="pele-edge"[^>]*><path d="([^"]*)"/.exec(render('architecture-beta\n' + body, options).svg)![1];
    expect(path('service a\nservice b\na:R -- L:b')).toMatch(/^M[-\d.]+,[-\d.]+L[-\d.]+,[-\d.]+$/);
    expect(path('service a\nservice b\na:R -- T:b').match(/Q/g)?.length).toBe(1);
    expect(path('service a\nservice b\na:R -- R:b').match(/Q/g)?.length).toBe(2);
    expect(path('service a\na:R -- L:a').match(/Q/g)?.length).toBe(4);
  });

  it('draws edge labels, junctions, and titles', () => {
    const { svg } = render(
      'architecture-beta\ntitle Platform\nservice a[Alpha]\nservice b[Beta]\njunction j\na:R -[calls]- L:j\nj:R --> L:b',
      options
    );
    expect(svg).toContain('class="pele-edge-label"');
    expect(svg).toContain('>calls<');
    expect(svg.match(/class="pele-node pele-junction"/g)?.length).toBe(1);
    expect(svg).toContain('>Platform<');
    expect(render('---\ntitle: From front matter\n---\narchitecture-beta\nservice a', options).svg).toContain('From front matter');
    expect(render('---\ntitle: From front matter\n---\narchitecture-beta\ntitle Own\nservice a', options).svg).toContain('>Own<');
  });

  it('starts a group edge at the border of the group', () => {
    const src = 'architecture-beta\ngroup one\ngroup two\nservice a in one\nservice b in two\na{group}:B --> T:b{group}';
    const { svg } = render(src, options);
    const clusters = clusterBoxes(svg);
    const one = clusters.get('one')!;
    const two = clusters.get('two')!;
    const [, y0, y1] = /class="pele-edge"[^>]*><path d="M[-\d.]+,([-\d.]+)L[-\d.]+,([-\d.]+)"/.exec(svg)!;
    expect(Number(y0)).toBeCloseTo(one.y + one.h, 1);
    expect(Number(y1)).toBeCloseTo(two.y - 7, 1);
  });

  it('carries a group edge on to a junction inside the group', () => {
    const src = 'architecture-beta\ngroup one\ngroup two\njunction a in one\njunction b in two\na{group}:R --> L:b{group}';
    const { svg } = render(src, options);
    const nodes = nodeBoxes(svg);
    const [, x0, x1] = /class="pele-edge"[^>]*><path d="M([-\d.]+),[-\d.]+L([-\d.]+),[-\d.]+"/.exec(svg)!;
    expect(Number(x0)).toBeCloseTo(nodes.get('a')!.x + 24, 1);
    expect(Number(x1)).toBeCloseTo(nodes.get('b')!.x + 24, 1);
    expect(svg.match(/class="pele-marker"/g)?.length).toBe(1);
  });

  it('fills icon slots from the resolver, then from the built-in outlines', () => {
    const src = 'architecture-beta\ngroup g(cloud)[G]\nservice a(database)[A] in g\nservice b(logos:aws-lambda)[B] in g\nservice c "S3"[C]\nservice d';
    const plain = render(src, options).svg;
    expect(plain.match(/class="pele-icon"/g)?.length).toBe(3);
    expect(plain).toMatch(/data-icon="database"[^>]*><path /);
    expect(plain).toMatch(/data-icon="logos:aws-lambda"[^>]*><\/svg>/);
    expect(plain).toContain('>S3<');
    const resolved = render(src, { ...options, icons: (name) => (name === 'logos:aws-lambda' ? '<circle r="4"/>' : null) }).svg;
    expect(resolved).toMatch(/data-icon="logos:aws-lambda"[^>]*><circle r="4"\/><\/svg>/);
    expect(resolved).toMatch(/data-icon="database"[^>]*><path /);
  });

  it('honours iconSize, fontSize, and padding', () => {
    const body = 'architecture-beta\ngroup g[G]\nservice a[A] in g\nservice b[B] in g\na:R -- L:b';
    const config = (text: string): string => `---\nconfig:\n  architecture:\n    ${text}\n---\n${body}`;
    const plain = render(body, options);
    const big = render(config('iconSize: 96'), options);
    expect(big.width).toBeGreaterThan(plain.width);
    expect(big.svg).toContain('width="96" height="96"');
    expect(render(config('padding: 60'), options).width).toBe(plain.width + 80);
    expect(render(config('fontSize: 24'), options).svg).toContain('font:24px sans-serif;');
    expect(render(config('iconSize: -5'), options).svg).not.toContain('NaN');
  });

  it('is deterministic', () => {
    for (const src of docs) expect(render(src, options).svg).toBe(render(src, options).svg);
  });

  it('rejects what Mermaid rejects, with its messages', () => {
    const fails = (body: string, message: RegExp | string): void => {
      expect(() => render('architecture-beta\n' + body, options)).toThrow(message);
      expect(() => render('architecture-beta\n' + body, options)).toThrow(PeleError);
    };
    fails('service a\nservice a', 'The service id [a] is already in use by another node');
    fails('group a\njunction a', 'The junction id [a] is already in use by another group');
    fails('service a in g', "The service [a]'s parent does not exist. Please make sure the parent is created before this service");
    fails('group g in g', 'The group [g] cannot be placed within itself');
    fails('service a\nservice b in a', "The service [b]'s parent is not a group");
    fails('service a\na:R -- L:b', 'The right-hand id [b] does not yet exist. Please create the service/group before declaring an edge to it.');
    fails('group g\nservice a in g\nservice b in g\na{group}:R -- L:b', 'is modified to traverse the group boundary');
    fails('service a\nservice b\nalign row a b c', 'align row references [c], which is not a service or junction');
    fails('service a\nservice b\nalign column a a', 'align column lists [a] more than once');
  });

  it('rejects an edge that names a group, where Mermaid fails with a TypeError', () => {
    expect(() => render('architecture-beta\ngroup g\nservice a\na:R -- L:g', options)).toThrow('The right-hand id [g] is a group');
  });

  it('reads the header and ids the way Mermaid 12.1 does', () => {
    expect(() => render('architecture\nservice a', options)).toThrow(PeleError);
    // Mermaid lexes a leading L, R, T or B as an edge direction, so such ids do not parse.
    expect(() => render('architecture-beta\nservice Lambda', options)).toThrow(PeleError);
    expect(render('architecture-beta\nservice lambda', options).svg).toContain('data-id="lambda"');
  });

  it('reads ids that start with title', () => {
    const model = parse('architecture-beta\ngroup titles(cloud)[G]\nservice title-db(database)[DB] in titles\nservice title_2 in titles\ntitle-db:R -- L:title_2');
    expect(model.type).toBe('architecture');
    if (model.type === 'architecture') {
      expect(model.title).toBeUndefined();
      expect([...model.groups.keys()]).toEqual(['titles']);
      expect([...model.nodes.keys()]).toEqual(['title-db', 'title_2']);
      expect(model.edges.map((e) => [e.lhsId, e.rhsId])).toEqual([['title-db', 'title_2']]);
    }
  });

  it('exposes the model', () => {
    const model = parse('architecture-beta\ntitle T\ngroup g(cloud)[G]\nservice a(server)[A] in g\njunction j\na:R -[x]-> L:j\nalign row a j');
    expect(model.type).toBe('architecture');
    if (model.type === 'architecture') {
      expect(model.title).toBe('T');
      expect([...model.groups.values()]).toEqual([{ id: 'g', icon: 'cloud', title: 'G', in: undefined }]);
      expect([...model.nodes.keys()]).toEqual(['a', 'j']);
      expect(model.edges).toEqual([
        { lhsId: 'a', lhsDir: 'R', lhsInto: false, lhsGroup: false, rhsId: 'j', rhsDir: 'L', rhsInto: true, rhsGroup: false, title: 'x' },
      ]);
      expect(model.layoutHints).toEqual([{ direction: 'row', members: ['a', 'j'] }]);
    }
  });

  it('draws an empty diagram and an empty group', () => {
    expect(render('architecture-beta', options).svg).toContain('<svg');
    const { svg } = render('architecture-beta\ngroup g[Nothing here]\ngroup h in g', options);
    const clusters = clusterBoxes(svg);
    expect(inside(clusters.get('h')!, clusters.get('g')!)).toBe(true);
  });

  it('keeps an unconnected service off the edge between two others (#138)', () => {
    const src =
      'architecture-beta\n' +
      'group app(cloud)[Playground]\n' +
      'service page(server)[Web page] in app\n' +
      'service Item1(server)[New item] in app\n' +
      'service store(disk)[localStorage]\n' +
      'service api(internet)[Claude API]\n' +
      'page:R -- L:api\n' +
      'page:B -- T:store';
    const { svg } = render(src, options);
    const nodes = nodeBoxes(svg);
    const item = nodes.get('Item1')!;
    expect(pathCrosses(svg, 'page-api', item)).toBe(false);
    expect(pathCrosses(svg, 'page-store', item)).toBe(false);
    for (const id of ['page', 'store', 'api']) expect(apart(item, nodes.get(id)!)).toBe(true);
  });

  it('moves an unconnected service off a vertical edge leaving its group (#138)', () => {
    const src =
      'architecture-beta\n' +
      'group g\n' +
      'service a in g\n' +
      'service b in g\n' +
      'service d in g\n' +
      'service u in g\n' +
      'service c\n' +
      'a:R -- L:b\n' +
      'b:R -- L:d\n' +
      'a:B -- T:c';
    const { svg } = render(src, options);
    const nodes = nodeBoxes(svg);
    const u = nodes.get('u')!;
    expect(pathCrosses(svg, 'a-b', u)).toBe(false);
    expect(pathCrosses(svg, 'b-d', u)).toBe(false);
    expect(pathCrosses(svg, 'a-c', u)).toBe(false);
    for (const id of ['a', 'b', 'd', 'c']) expect(apart(u, nodes.get(id)!)).toBe(true);
  });
});
