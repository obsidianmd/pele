import { describe, expect, it } from 'vitest';
import { PeleError, detectType, parse, render, supports } from '../../src/index.js';
import { metricsMeasurer } from '../../src/text/measurer.js';
import { loadCorpus } from '../support/corpus.js';
import { assertInert } from '../support/inert.js';
import { elements } from '../support/xml.js';

const options = { measurer: metricsMeasurer };
const corpus = loadCorpus('block', /block/);

function tryRender(src: string): string | undefined {
  try {
    return render(src, options).svg;
  } catch (error) {
    if (error instanceof PeleError) return undefined;
    throw error;
  }
}

interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

// Center of every drawn block and box of every composite, by id.
function boxes(svg: string): Map<string, Box> {
  const out = new Map<string, Box>();
  for (const m of svg.matchAll(/class="pele-node[^"]*" data-id="([^"]*)" transform="translate\(([-\d.]+),([-\d.]+)\)"><(\w+)([^>]*)>/g)) {
    const width = /width="([\d.]+)"/.exec(m[5]);
    const height = /height="([\d.]+)"/.exec(m[5]);
    out.set(m[1], { x: Number(m[2]), y: Number(m[3]), w: Number(width?.[1] ?? 0), h: Number(height?.[1] ?? 0) });
  }
  for (const m of svg.matchAll(/class="pele-cluster[^"]*" data-id="([^"]*)"><rect x="([-\d.]+)" y="([-\d.]+)" width="([\d.]+)" height="([\d.]+)"/g)) {
    const w = Number(m[4]);
    const h = Number(m[5]);
    out.set(m[1], { x: Number(m[2]) + w / 2, y: Number(m[3]) + h / 2, w, h });
  }
  return out;
}

function layoutOf(src: string): Map<string, Box> {
  return boxes(render(src, options).svg);
}

function paths(svg: string): string[] {
  return [...svg.matchAll(/class="pele-edge" data-id="[^"]*"><path d="([^"]*)"/g)].map((m) => m[1]);
}

function labelBoxes(svg: string): Box[] {
  return [...svg.matchAll(/class="pele-edge-label" data-id="[^"]*"><rect x="([-\d.]+)" y="([-\d.]+)" width="([\d.]+)" height="([\d.]+)"/g)].map((m) => {
    const [x, y, w, h] = m.slice(1).map(Number);
    return { x: x + w / 2, y: y + h / 2, w, h };
  });
}

function nodeLabel(svg: string, id: string): string[] {
  const at = svg.indexOf(`data-id="${id}"`);
  const body = svg.slice(svg.lastIndexOf('<g class="pele-node', at), svg.indexOf('</g>', at));
  const inner = /<text class="pele-label"[^>]*>([\s\S]*?)<\/text>/.exec(body)?.[1] ?? '';
  const lines = [...inner.matchAll(/<tspan(?:\s[^>]*)?>([\s\S]*?)<\/tspan>/g)].map((m) => m[1]);
  return lines.length > 0 ? lines : inner === '' ? [] : [inner];
}

function expectSeparateLabels(src: string, count: number): void {
  const result = render(src, options);
  const model = parse(src);
  if (model.type !== 'block') throw new Error('not a block model');
  const el = elements(result.svg);
  const labels = el.flatMap((element, index) => {
    if (element.attrs.get('class') !== 'pele-edge-label') return [];
    const rect = el[index + 1];
    expect(rect.name).toBe('rect');
    const w = Number(rect.attrs.get('width'));
    const h = Number(rect.attrs.get('height'));
    return [{
      id: element.attrs.get('data-id'),
      x: Number(rect.attrs.get('x')) + w / 2,
      y: Number(rect.attrs.get('y')) + h / 2,
      w,
      h,
    }];
  });
  expect(labels).toHaveLength(count);
  expect(labels.map((label) => label.id)).toEqual(model.edges.filter((edge) => edge.label).map((edge) => edge.id));
  expect(paths(result.svg)).toHaveLength(model.edges.length);
  for (let i = 0; i < labels.length; i++) {
    const a = labels[i];
    expect(a.w).toBeGreaterThan(0);
    expect(a.h).toBeGreaterThan(0);
    expect(a.x - a.w / 2).toBeGreaterThanOrEqual(0);
    expect(a.y - a.h / 2).toBeGreaterThanOrEqual(0);
    expect(a.x + a.w / 2).toBeLessThanOrEqual(result.width);
    expect(a.y + a.h / 2).toBeLessThanOrEqual(result.height);
    for (const b of labels.slice(i + 1)) {
      const overlapX = (a.w + b.w) / 2 - Math.abs(a.x - b.x);
      const overlapY = (a.h + b.h) / 2 - Math.abs(a.y - b.y);
      expect(Math.min(overlapX, overlapY), `${a.id} overlaps ${b.id}`).toBeLessThanOrEqual(0.01);
    }
    // Labels paint last, so a label's center must belong to that label alone.
    const hits = labels.filter((b) => Math.abs(a.x - b.x) < b.w / 2 && Math.abs(a.y - b.y) < b.h / 2);
    expect(hits.map((b) => b.id)).toEqual([a.id]);
  }
  expect(render(src, options).svg).toBe(result.svg);
}

describe('block rendering', () => {
  it('renders every corpus input that parses, as well-formed and inert SVG', () => {
    let rendered = 0;
    for (const src of corpus) {
      const svg = tryRender(src);
      if (svg === undefined) continue;
      rendered++;
      const where = JSON.stringify(src).slice(0, 120);
      assertInert(svg, where);
      expect(svg, where).not.toContain('NaN');
      expect(svg, where).not.toContain('undefined');
      expect(svg, where).not.toContain('Infinity');
      expect(tryRender(src), where).toBe(svg);
    }
    expect(rendered).toBeGreaterThan(60);
  });

  it('reports size and type for both keywords', () => {
    const result = render('block\n  a b c', options);
    expect(result.type).toBe('block');
    expect(result.svg).toContain(`viewBox="0 0 ${result.width} ${result.height}"`);
    expect(result.svg).toMatch(/^<svg xmlns="http:\/\/www\.w3\.org\/2000\/svg" class="pele pele-block"/);
    expect(result.links).toEqual([]);
    expect(render('block-beta\n  a b c', options).svg).toBe(result.svg);
    expect(detectType('block-beta\n a')).toBe('block');
    expect(supports('block\n a')).toBe(true);
  });

  it('puts blocks on one row without a column count', () => {
    const at = layoutOf('block\n  a b c');
    expect(at.get('a')!.y).toBe(at.get('b')!.y);
    expect(at.get('b')!.y).toBe(at.get('c')!.y);
    expect(at.get('b')!.x - at.get('a')!.x).toBe(at.get('c')!.x - at.get('b')!.x);
  });

  it('wraps to a new row after the column count', () => {
    const at = layoutOf('block\n  columns 3\n  a b c d');
    expect(at.get('d')!.x).toBe(at.get('a')!.x);
    expect(at.get('d')!.y).toBeGreaterThan(at.get('a')!.y);
    const stacked = layoutOf('block\n  columns 1\n  a b');
    expect(stacked.get('a')!.x).toBe(stacked.get('b')!.x);
  });

  it('makes every column as wide as the widest block and every row as tall as the tallest', () => {
    const at = layoutOf('block\n  columns 2\n  a["A much longer label"] b\n  c["two<br>lines"] d');
    const sizes = ['a', 'b', 'c', 'd'].map((id) => at.get(id)!);
    for (const box of sizes) {
      expect(box.w).toBe(sizes[0].w);
      expect(box.h).toBe(sizes[0].h);
    }
    expect(sizes[0].h).toBeGreaterThan(layoutOf('block\n a').get('a')!.h);
  });

  it('spans columns, with the gap between them included', () => {
    const at = layoutOf('block\n  columns 3\n  a["A label"] b:2 c:2 d');
    const a = at.get('a')!;
    const b = at.get('b')!;
    const d = at.get('d')!;
    expect(b.w).toBe(2 * a.w + 12);
    expect(at.get('c')!.x).toBeCloseTo(a.x + (a.w + 12) / 2, 1);
    expect(d.x).toBeCloseTo(a.x + 2 * (a.w + 12), 1);
    expect(d.y).toBe(at.get('c')!.y);
  });

  it('uses the wider cell to wrap a spanning block label', () => {
    const text = 'Something long long long long long long';
    const { svg } = render(`block\n  1["Something"]\n  2["${text}"]:2\n  3["${text}"]:5\n  4["${text}"]:2\n  5["Something"]`, options);
    expect(nodeLabel(svg, '3')).toEqual([text]);
    expect(nodeLabel(svg, '2')).toHaveLength(2);
  });

  it('keeps fixed shapes and explicit line breaks when a block spans columns', () => {
    const text = 'Something long long long long long long';
    const fixed = render(`block\n  a(("${text}")) c{"${text}"} d["${text}"]:5`, options);
    expect(nodeLabel(fixed.svg, 'a')).toHaveLength(2);
    expect(nodeLabel(fixed.svg, 'c')).toHaveLength(2);
    expect(nodeLabel(fixed.svg, 'd')).toEqual([text]);

    const broken = render(`block\n  a["${text}<br>tail"]:5 b c d e`, options);
    expect(nodeLabel(broken.svg, 'a')).toEqual(['Something long long long long long', 'long', 'tail']);
  });

  it('stops a block that is wider than the rest of its row at the last column', () => {
    const at = layoutOf('block\n  columns 3\n  a b:3 c');
    const a = at.get('a')!;
    expect(at.get('b')!.w).toBe(2 * a.w + 12);
    expect(at.get('c')!.x).toBe(a.x);
    expect(at.get('c')!.y).toBeGreaterThan(a.y);
    const every = layoutOf('block\n  a:0 b');
    expect(every.get('a')!.w).toBe(every.get('b')!.w);
  });

  it('leaves room for space blocks', () => {
    const at = layoutOf('block\n  columns 3\n  a space b\n  c d e');
    expect(at.get('b')!.x).toBe(at.get('e')!.x);
    expect(at.get('d')!.x).toBe((at.get('a')!.x + at.get('b')!.x) / 2);
    const wide = layoutOf('block\n  ida space:3 idb idc');
    const step = wide.get('idc')!.x - wide.get('idb')!.x;
    expect(wide.get('idb')!.x - wide.get('ida')!.x).toBeCloseTo(4 * step, 1);
    expect(render('block\n  a space b', options).svg.match(/class="pele-node /g)?.length).toBe(2);
  });

  it('sizes a composite from its children and lets it use its own columns', () => {
    const at = layoutOf('block\n  columns 1\n  top\n  block:group\n    columns 2\n    a b c d\n  end');
    const group = at.get('group')!;
    for (const id of ['a', 'b', 'c', 'd']) {
      const box = at.get(id)!;
      expect(box.x - box.w / 2).toBeGreaterThanOrEqual(group.x - group.w / 2 + 12);
      expect(box.x + box.w / 2).toBeLessThanOrEqual(group.x + group.w / 2 - 12);
      expect(box.y - box.h / 2).toBeGreaterThanOrEqual(group.y - group.h / 2 + 12);
      expect(box.y + box.h / 2).toBeLessThanOrEqual(group.y + group.h / 2 - 12);
    }
    expect(at.get('c')!.x).toBe(at.get('a')!.x);
    expect(at.get('top')!.w).toBe(group.w);
  });

  it('stretches the children of a composite that spans a wider cell', () => {
    const at = layoutOf('block\n  columns 3\n  a["A wide block label here"]:3\n  block:g:2\n    x y\n  end\n  z');
    const g = at.get('g')!;
    const x = at.get('x')!;
    expect(g.w).toBeCloseTo((2 * (at.get('a')!.w - 24)) / 3 + 12, 5);
    expect(2 * x.w + 3 * 12).toBeCloseTo(g.w, 5);
  });

  it('makes rows with a plain block as tall as the tallest block, and rows of composites as tall as they need', () => {
    const at = layoutOf(
      'block\n  columns 3\n  a:3\n  block:group1:2\n    columns 2\n    h i j k\n  end\n  g\n  block:group2:3\n    l m n o p q r\n  end'
    );
    const plain = layoutOf('block\n  l').get('l')!.h;
    expect(at.get('group1')!.h).toBe(2 * plain + 3 * 12);
    expect(at.get('a')!.h).toBe(at.get('group1')!.h);
    expect(at.get('g')!.h).toBe(at.get('group1')!.h);
    expect(at.get('group2')!.h).toBe(plain + 2 * 12);
    expect(at.get('l')!.h).toBe(plain);
    expect(at.get('group2')!.w).toBe(at.get('a')!.w);
  });

  it('draws a composite title above its children', () => {
    const { svg } = render('block\n  block:g["Group title"]\n    a b\n  end', options);
    const at = boxes(svg);
    expect(svg).toContain('class="pele-cluster-label"');
    expect(svg).toContain('>Group title<');
    const titleY = Number(/class="pele-cluster-label"[^>]* y="([\d.]+)"/.exec(svg)![1]);
    expect(titleY).toBeLessThan(at.get('a')!.y - at.get('a')!.h / 2);
    const plain = layoutOf('block\n  block:g\n    a b\n  end');
    expect(at.get('g')!.h).toBeGreaterThan(plain.get('g')!.h);
  });

  it('honours block.padding', () => {
    const tight = render('---\nconfig:\n  block:\n    padding: 2\n---\nblock\n  a b c', options);
    const loose = render('---\nconfig:\n  block:\n    padding: 40\n---\nblock\n  a b c', options);
    expect(loose.width - tight.width).toBe(2 * 38);
  });

  it('draws each bracket shape', () => {
    const shapes: [string, string][] = [
      ['a', 'rect'], ['a["x"]', 'rect'], ['a("x")', 'rounded'], ['a(["x"])', 'stadium'], ['a[["x"]]', 'fr-rect'],
      ['a[("x")]', 'cyl'], ['a(("x"))', 'circle'], ['a((("x")))', 'dbl-circ'], ['a>"x"]', 'odd'], ['a{"x"}', 'diam'],
      ['a{{"x"}}', 'hex'], ['a[/"x"/]', 'lean-r'], ['a[\\"x"\\]', 'lean-l'], ['a[/"x"\\]', 'trap-b'],
      ['a[\\"x"/]', 'trap-t'], ['a<["x"]>(right)', 'block-arrow'], ['a("x"]', 'rect'],
    ];
    for (const [source, shape] of shapes) {
      expect(render(`block\n  ${source}`, options).svg, source).toContain(`class="pele-node pele-shape-${shape}"`);
    }
  });

  it('keeps circles and diamonds at their own size in a larger cell', () => {
    const { svg } = render('block\n  columns 1\n  a(("x"))\n  b["A much wider block than the circle"]', options);
    const r = Number(/<circle r="([\d.]+)"/.exec(svg)![1]);
    expect(r * 2).toBeLessThan(boxes(svg).get('b')!.w / 2);
  });

  it('draws block arrows for every direction', () => {
    const points = (dirs: string): number => {
      const { svg } = render(`block\n  a<["Label"]>(${dirs})`, options);
      return /<polygon points="([^"]*)"/.exec(svg)![1].split(' ').length;
    };
    for (const dir of ['right', 'left', 'up', 'down']) expect(points(dir), dir).toBe(7);
    expect(points('x')).toBe(10);
    expect(points('y')).toBe(10);
    expect(points('x, down')).toBe(13);
    expect(points('x, y')).toBe(16);
    expect(points('up, up')).toBe(7);
    expect(points(' up ')).toBe(7);
    const labelled = render('block\n  a<["Label"]>(right)', options);
    const blank = render('block\n  a<["&nbsp;&nbsp;&nbsp;"]>(right)', options);
    expect(blank.height).toBeLessThan(labelled.height);
    expect(render('block\n  a<["x"]>(right)', options).svg).not.toBe(render('block\n  a<["x"]>(left)', options).svg);
  });

  it('joins blocks in one row or column with a straight line between their borders', () => {
    const row = render('block\n  a space b\n  a --> b', options).svg;
    const at = boxes(row);
    const [d] = paths(row);
    const m = /^M([\d.]+),([\d.]+)L([\d.]+),([\d.]+)$/.exec(d)!;
    expect(Number(m[1])).toBe(at.get('a')!.x + at.get('a')!.w / 2);
    expect(Number(m[2])).toBe(at.get('a')!.y);
    expect(Number(m[4])).toBe(Number(m[2]));
    expect(Number(m[3])).toBeLessThan(at.get('b')!.x - at.get('b')!.w / 2);
    const column = paths(render('block\n  columns 1\n  a space b\n  b --> a', options).svg)[0];
    const v = /^M([\d.]+),([\d.]+)L([\d.]+),([\d.]+)$/.exec(column)!;
    expect(v[1]).toBe(v[3]);
    expect(Number(v[4])).toBeLessThan(Number(v[2]));
  });

  it('bends once between blocks that share neither, when the corner is free', () => {
    const { svg } = render('block\n  columns 3\n  a space:2\n  space:3\n  space:2 b\n  a --> b', options);
    expect(paths(svg)[0]).toMatch(/^M[\d.,]+L[\d.,]+Q[\d., ]+L[\d.,]+$/);
  });

  it('preserves the default SVG with explicit orthogonal routing', () => {
    for (const src of corpus) {
      const svg = tryRender(src);
      if (svg !== undefined) expect(render(src, { ...options, block: { edgeRouting: 'orthogonal' } }).svg).toBe(svg);
    }
  });

  it('routes straight edges between rectangle boundaries in every direction', () => {
    const grid = 'block-beta\n  columns 3\n  a space b\n  space:3\n  c space d\n';
    for (const [from, to] of [['a', 'b'], ['b', 'a'], ['a', 'c'], ['c', 'a'], ['a', 'd'], ['d', 'a'], ['b', 'c'], ['c', 'b']]) {
      const source = `${grid}  ${from} --- ${to}`;
      const { svg } = render(source, { ...options, block: { edgeRouting: 'straight' } });
      const [path] = paths(svg);
      expect(path).toMatch(/^M[-\d.,]+L[-\d.,]+$/);
      const [sx, sy, tx, ty] = path.match(/-?\d+(?:\.\d+)?/g)!.map(Number);
      const at = boxes(svg);
      const s = at.get(from)!;
      const t = at.get(to)!;
      for (const [x, y, box] of [[sx, sy, s], [tx, ty, t]] as const) {
        expect(Math.max(Math.abs(x - box.x) / (box.w / 2), Math.abs(y - box.y) / (box.h / 2))).toBeCloseTo(1, 2);
        expect(((x - s.x) * (t.y - s.y) - (y - s.y) * (t.x - s.x)) / Math.hypot(t.x - s.x, t.y - s.y)).toBeCloseTo(0, 1);
      }
      expect(at).toEqual(boxes(render(grid, options).svg));
      expect(render(source, { ...options, block: { edgeRouting: 'straight' } }).svg).toBe(svg);
    }
  });

  it('uses a direct diagonal even when the original bend is clear or blocks obstruct it', () => {
    for (const middle of ['space:3', 'space obstacle space']) {
      const source = `block\n  columns 3\n  a space:2\n  ${middle}\n  space:2 b\n  a --> b`;
      const { svg } = render(source, { ...options, block: { edgeRouting: 'straight' } });
      expect(paths(svg)[0]).toMatch(/^M[\d.,]+L[\d.,]+$/);
      const [sx, sy, tx, ty] = paths(svg)[0].match(/[\d.]+/g)!.map(Number);
      expect(sx).not.toBe(tx);
      expect(sy).not.toBe(ty);
    }
  });

  it('prefers direct connections when they are long enough and cross no more blocks', () => {
    const source = 'block\n  columns 3\n  a space:2\n  space:3\n  space:2 b\n  a --> b';
    const preferred = render(source, { ...options, block: { edgeRouting: 'prefer-straight' } });
    expect(paths(preferred.svg)).toEqual(paths(render(source, { ...options, block: { edgeRouting: 'straight' } }).svg));
    expect(paths(render(source, options).svg)[0]).toContain('Q');
    expect(boxes(preferred.svg)).toEqual(layoutOf(source));
  });

  it('uses a bend for short diagonals in every direction', () => {
    const grid = 'block\n  columns 2\n  a b\n  c d\n';
    for (const [from, to] of [['a', 'd'], ['d', 'a'], ['b', 'c'], ['c', 'b']]) {
      const source = `${grid}  ${from} --> ${to}`;
      const preferred = render(source, { ...options, block: { edgeRouting: 'prefer-straight' } });
      expect(paths(preferred.svg)[0]).toContain('Q');
      expect(paths(render(source, options).svg)[0]).not.toContain('Q');
      expect(boxes(preferred.svg)).toEqual(layoutOf(grid));
    }
  });

  it('accounts for arrowheads at both ends when checking direct shaft length', () => {
    const grid = 'block\n  columns 2\n  a space\n  space b\n';
    const preferred = { ...options, config: { block: { padding: 18 } }, block: { edgeRouting: 'prefer-straight' as const } };
    expect(paths(render(`${grid}  a --> b`, preferred).svg)[0]).not.toContain('Q');
    expect(paths(render(`${grid}  a <--> b`, preferred).svg)[0]).toContain('Q');
  });

  it('uses a bend when the direct line crosses more blocks', () => {
    const source = 'block\n  columns 3\n  a space:2\n  space middle space\n  space:2 b\n  a --> b';
    const preferred = render(source, { ...options, block: { edgeRouting: 'prefer-straight' } });
    expect(paths(preferred.svg)[0]).toContain('Q');
    expect(paths(render(source, { ...options, block: { edgeRouting: 'straight' } }).svg)[0]).not.toContain('Q');
    expect(boxes(preferred.svg)).toEqual(layoutOf(source));
  });

  it('keeps a direct line when both bends cross more blocks', () => {
    const source = 'block\n  columns 3\n  a space top\n  space:3\n  bottom space b\n  a --> b';
    expect(paths(render(source, { ...options, block: { edgeRouting: 'prefer-straight' } }).svg)[0]).not.toContain('Q');
  });

  it('chooses an equally clear bend that shares less line with an earlier arrow', () => {
    const grid = 'block\n  columns 3\n  a space:2\n  space middle space\n  space:2 b\n';
    const source = `${grid}  a --> middle\n  a --> b`;
    const preferred = { ...options, block: { edgeRouting: 'prefer-straight' as const } };
    const together = paths(render(source, preferred).svg);
    const alone = paths(render(`${grid}  a --> b`, preferred).svg)[0];
    expect(together.every((path) => path.includes('Q'))).toBe(true);
    expect(together[1]).not.toBe(alone);
    const starts = together.map((path) => path.match(/-?[\d.]+/g)!.slice(0, 2).map(Number));
    expect(starts[0]).not.toEqual(starts[1]);
    expect(render(source, preferred).svg).toBe(render(source, preferred).svg);
  });

  it('allows a simple arrow crossing without changing the preferred bend', () => {
    const grid = 'block\n  columns 6\n  a space:5\n  space:3 p space q\n  space:2 middle space:3\n  space:6\n  space:4 b space\n';
    const preferred = { ...options, block: { edgeRouting: 'prefer-straight' as const } };
    const alone = paths(render(`${grid}  a --> b`, preferred).svg)[0];
    const together = paths(render(`${grid}  p --> q\n  a --> b`, preferred).svg);
    expect(alone).toContain('Q');
    expect(together[1]).toBe(alone);
  });

  it('prioritizes fewer block crossings over avoiding a shared run', () => {
    const grid = 'block\n  columns 3\n  a space top\n  space middle space\n  space:2 b\n';
    const preferred = { ...options, block: { edgeRouting: 'prefer-straight' as const } };
    const alone = paths(render(`${grid}  a --> b`, preferred).svg)[0];
    const together = paths(render(`${grid}  middle --> a\n  a --> b`, preferred).svg);
    expect(alone).toContain('Q');
    expect(together[1]).toBe(alone);
  });

  it('routes bends around straight arrows declared later in the source', () => {
    const grid = `block
  columns 3
  space
  block:TP["Threat Perceptions"]
    columns 1
    PS(["Perceived susceptibility"])
    PV(["Perceived severity"])
  end
  SE(["Self efficacy"])
  block:MF["Modifying Factors"]
    columns 1
    D(["Demographic"])
    P(["Psychosocial"])
  end
  space
  AL(["Action Likelihood"])
  space
  block:LA["Likelihood of action"]
    columns 1
    PB(["Perceived benefits"])
    PC(["Perceived costs/barriers"])
  end
  CA(["Cues to action"])
`;
    const edges = ['MF --> TP', 'MF --> LA', 'MF --> AL', 'TP --> AL', 'LA --> AL', 'SE --> AL', 'CA --> AL'];
    const preferred = { ...options, block: { edgeRouting: 'prefer-straight' as const } };
    for (const statements of [edges, [...edges].reverse()]) {
      const source = grid + statements.join('\n');
      const { svg } = render(source, preferred);
      const path = paths(svg)[statements.indexOf('MF --> TP')];
      expect(path).toContain('Q');
      const [x, y] = path.match(/-?[\d.]+/g)!.slice(0, 2).map(Number);
      const mf = boxes(svg).get('MF')!;
      expect(x).toBeCloseTo(mf.x, 1);
      expect(y).toBeCloseTo(mf.y - mf.h / 2, 1);
      expect(paths(svg)[statements.indexOf('MF --> AL')]).toMatch(/^M[\d.,]+L[\d.,]+$/);
      expect(boxes(svg)).toEqual(layoutOf(grid));
    }
  });

  it('clips direct connections to circle and diamond outlines', () => {
    for (const shape of ['a(("A"))', 'a{"A"}']) {
      const { svg } = render(`block\n  columns 3\n  ${shape} space:2\n  space:3\n  space:2 b\n  b --> a`, { ...options, block: { edgeRouting: 'straight' } });
      const node = elements(svg);
      const i = node.findIndex((el) => el.attrs.get('data-id') === 'a');
      const [, x, y] = /translate\(([\d.]+),([\d.]+)\)/.exec(node[i].attrs.get('transform')!)!.map(Number);
      const tip = [...svg.matchAll(/class="pele-marker" d="M([\d.]+),([\d.]+)/g)][0];
      const dx = Number(tip[1]) - x;
      const dy = Number(tip[2]) - y;
      if (shape.includes('((')) {
        expect(Math.hypot(dx, dy)).toBeCloseTo(Number(node[i + 1].attrs.get('r')), 1);
      } else {
        const points = node[i + 1].attrs.get('points')!.match(/-?[\d.]+/g)!.map(Number);
        expect(Math.abs(dx / points[2]) + Math.abs(dy / points[5])).toBeCloseTo(1, 2);
      }
    }
  });

  it('orients both arrowheads along a direct line in every direction', () => {
    const grid = 'block\n  columns 3\n  a space b\n  space:3\n  c space d\n';
    for (const [from, to] of [['a', 'b'], ['b', 'a'], ['a', 'c'], ['c', 'a'], ['a', 'd'], ['d', 'a'], ['b', 'c'], ['c', 'b']]) {
      const { svg } = render(`${grid}  ${from} <--> ${to}`, { ...options, block: { edgeRouting: 'straight' } });
      const tips = [...svg.matchAll(/class="pele-marker" d="([^"]+)"/g)].map((m) => m[1].match(/-?[\d.]+/g)!.map(Number));
      expect(tips).toHaveLength(2);
      const at = boxes(svg);
      const s = at.get(from)!;
      const t = at.get(to)!;
      const dx = t.x - s.x;
      const dy = t.y - s.y;
      tips.forEach(([x, y, ax, ay, bx, by], i) => {
        const ux = x - (ax + bx) / 2;
        const uy = y - (ay + by) / 2;
        expect((ux * dx + uy * dy) * (i === 0 ? -1 : 1)).toBeGreaterThan(0);
        expect((ux * dy - uy * dx) / Math.hypot(dx, dy)).toBeCloseTo(0, 1);
      });
    }
  });

  it('clips straight edges to slanted block and block-arrow polygons', () => {
    const shapes = ['a{{"A"}}', 'a>"A"]', 'a[/"A"/]', 'a[\\"A"\\]', 'a[/"A"\\]', 'a[\\"A"/]',
      ...['right', 'left', 'up', 'down', 'x', 'y', 'x,y'].map((dir) => `a<["A"]>(${dir})`)];
    for (const shape of shapes) {
      const source = `block\n  columns 3\n  nw n ne\n  w ${shape} e\n  sw s se\n`;
      for (const target of ['nw', 'n', 'ne', 'w', 'e', 'sw', 's', 'se']) {
        const { svg } = render(`${source}  a --- ${target}`, { ...options, block: { edgeRouting: 'straight' } });
        const nodes = elements(svg);
        const i = nodes.findIndex((el) => el.attrs.get('data-id') === 'a');
        const [, cx, cy] = /translate\(([\d.]+),([\d.]+)\)/.exec(nodes[i].attrs.get('transform')!)!.map(Number);
        const polygon = nodes[i + 1].attrs.get('points')!.match(/-?[\d.]+/g)!.map(Number);
        const [sx, sy] = paths(svg)[0].match(/-?[\d.]+/g)!.map(Number);
        const x = sx - cx;
        const y = sy - cy;
        let distance = Infinity;
        for (let a = 0, b = polygon.length - 2; a < polygon.length; b = a, a += 2) {
          const dx = polygon[a] - polygon[b];
          const dy = polygon[a + 1] - polygon[b + 1];
          const t = Math.max(0, Math.min(1, ((x - polygon[b]) * dx + (y - polygon[b + 1]) * dy) / (dx * dx + dy * dy)));
          distance = Math.min(distance, Math.hypot(x - polygon[b] - t * dx, y - polygon[b + 1] - t * dy));
        }
        expect(distance, `${shape} toward ${target}`).toBeLessThan(0.03);
      }
    }
  });

  it('keeps unrelated diagram types unchanged', () => {
    const source = 'flowchart LR\n  a --> b';
    expect(render(source, { ...options, block: { edgeRouting: 'straight' } })).toEqual(render(source, options));
  });

  it('places a straight-edge label on the line and separates opposite diagonal labels', () => {
    const grid = 'block\n  columns 3\n  a space:2\n  space:3\n  space:2 b\n';
    const straight = { ...options, block: { edgeRouting: 'straight' as const } };
    const single = render(`${grid}  a -- "direct" --> b`, straight).svg;
    const [label] = labelBoxes(single);
    const at = boxes(single);
    const a = at.get('a')!;
    const b = at.get('b')!;
    expect(((label.x - a.x) * (b.y - a.y) - (label.y - a.y) * (b.x - a.x)) / Math.hypot(b.x - a.x, b.y - a.y)).toBeCloseTo(0, 1);
    const both = render(`${grid}  a -- "forward" --> b\n  b -- "reverse" --> a`, straight).svg;
    const [first, second] = labelBoxes(both);
    expect(Math.abs(first.x - second.x) >= (first.w + second.w) / 2 || Math.abs(first.y - second.y) >= (first.h + second.h) / 2).toBe(true);
    expect(boxes(both)).toEqual(boxes(render(grid, options).svg));
  });

  it('retains marker styles, labels, self-loops and nested connections in straight mode', () => {
    const source = 'block\n  columns 3\n  a space b\n  space:3\n  c space d\n  a --o d\n  b --x c\n  a == "thick" ==> b\n  c -. "dotted" .-> d\n  a --> a';
    const { svg } = render(source, { ...options, block: { edgeRouting: 'straight' } });
    expect(paths(svg).slice(0, 4).every((d) => /^M[\d.,]+L[\d.,]+$/.test(d))).toBe(true);
    expect(paths(svg)[4]).toContain('A');
    expect(svg).toContain('<circle class="pele-marker"');
    expect(svg).toMatch(/class="pele-marker" d="M[^"Z]+M/);
    expect(svg).toContain('stroke-width="2.5"');
    expect(svg).toContain('stroke-dasharray="3 4"');
    expect(labelBoxes(svg)).toHaveLength(2);
    const nested = render('block\n  block:g\n    a\n  end\n  a --> g\n  g --> a', { ...options, block: { edgeRouting: 'straight' } }).svg;
    expect(nested).not.toMatch(/NaN|Infinity/);
    expect(paths(nested)).toHaveLength(2);
    assertInert(svg, 'straight block routing');
  });

  it('goes straight across when a block sits on each corner', () => {
    const { svg } = render('block\n  columns 2\n  a b\n  c d\n  a --> d', options);
    expect(paths(svg)[0]).toMatch(/^M[\d.,]+L[\d.,]+$/);
  });

  it('draws arrowheads, line styles and labels', () => {
    const { svg } = render(
      'block\n  columns 3\n  a space b\n  c space d\n  a --> b\n  c --o d\n  a --x c\n  b <--> d\n  a == "thick" ==> b\n  c -. "dotted" .-> d\n  b --- d',
      options
    );
    expect(svg.match(/class="pele-edge"/g)?.length).toBe(7);
    expect(svg.match(/<path class="pele-marker" d="M[^"]*Z"/g)?.length).toBe(5);
    expect(svg.match(/<path class="pele-marker" d="M[^"Z]*"/g)?.length).toBe(1);
    expect(svg.match(/<circle class="pele-marker"/g)?.length).toBe(1);
    expect(svg).toContain('stroke-width="2.5"');
    expect(svg).toContain('stroke-dasharray="3 4"');
    expect(svg).toContain('>thick<');
    expect(svg).toContain('>dotted<');
    expect(svg.match(/class="pele-edge-label"/g)?.length).toBe(2);
  });

  it('spreads edges between the same two blocks', () => {
    const [first, second] = paths(render('block\n  a space b\n  a --> b\n  b --> a', options).svg);
    const y = (d: string): string => /^M[\d.]+,([\d.]+)/.exec(d)![1];
    expect(y(first)).not.toBe(y(second));
  });

  it('separates labels on opposite vertical edges', () => {
    expectSeparateLabels(
      'block\n  columns 1\n  a["Upper layer"]\n  space:3\n  b["Lower layer"]\n  a -- "12 production conforming" --> b\n  b -- "12 production deviation" --> a',
      2
    );
  });

  it('separates labels on opposite horizontal edges', () => {
    expectSeparateLabels(
      'block\n  a["Left layer"] space:3 b["Right layer"]\n  a -- "12 production<br>conforming" --> b\n  b -- "12 production<br>deviation" --> a',
      2
    );
  });

  it('keeps disjoint labels on their original straight parallel routes', () => {
    const src = 'block\n  a space:3 b\n  a -- "forward" --> b\n  b -- "reverse" --> a';
    expectSeparateLabels(src, 2);
    for (const path of paths(render(src, options).svg)) {
      expect(path).toMatch(/^M[\d.,]+L[\d.,]+$/);
    }
  });

  it('separates wide labels when narrow endpoints clamp the parallel routes', () => {
    expectSeparateLabels(
      'block\n  columns 1\n  a["A"]\n  space\n  b["B"]\n  a -- "144 production conforming" --> b\n  b -- "144 production deviation" --> a',
      2
    );
  });

  it('keeps every label for several edges between the same blocks', () => {
    expectSeparateLabels(
      'block\n  columns 1\n  a["A"]\n  space:2\n  b["B"]\n  a -- "7 production policy" --> b\n  a -- "7 test policy" --> b\n  a -- "7 production exception" --> b\n  b -- "7 production deviation" --> a',
      4
    );
  });

  it('keeps parallel edges straight while it stacks their labels', () => {
    const src = 'block\n  columns 3\n  l a r\n  space:3\n  m b n\n  a -- "production conforming" --> b\n  b -- "production deviation" --> a';
    expectSeparateLabels(src, 2);
    for (const path of paths(render(src, options).svg)) expect(path).toMatch(/^M[\d.,]+L[\d.,]+$/);
  });

  it('leaves parallel labels in place when stacking them would cover another block', () => {
    const expectClear = (src: string, ids: string[]): void => {
      const { svg } = render(src, options);
      const all = boxes(svg);
      for (const id of ids) {
        const b = all.get(id)!;
        for (const l of labelBoxes(svg)) expect(Math.abs(l.x - b.x) >= (l.w + b.w) / 2 || Math.abs(l.y - b.y) >= (l.h + b.h) / 2).toBe(true);
      }
    };
    expectClear('block\n  columns 1\n  a\n  space\n  c["Middle"]\n  space\n  b\n  a -- "forward label" --> b\n  a -- "second label" --> b', ['c']);
    expectClear('block\n  columns 1\n  a c d e b\n  a -- "one<br>two<br>three<br>four" --> b\n  a -- "one<br>two<br>three<br>four" --> b', ['c', 'e']);
  });

  it('leaves parallel labels in place when stacking them would cover a composite title', () => {
    const { svg } = render('block\n  columns 1\n  b\n  space\n  block:g["Group"]\n    x\n  end\n  a\n  a -- "a long label" --> b\n  a -- "a long label" --> b\n  a -- "a long label" --> b', options);
    const [, x, baseline] = /class="pele-cluster-label"[^>]* x="([\d.]+)" y="([\d.]+)"/.exec(svg)!.map(Number);
    for (const l of labelBoxes(svg)) expect(Math.abs(l.x - x) >= l.w / 2 || Math.abs(l.y - (baseline - 6)) >= l.h / 2).toBe(true);
  });

  it('keeps stacked labels clear of arrowheads', () => {
    const { svg } = render('block\n  columns 1\n  a\n  space\n  b\n  a -- "first label" --> b\n  a -- "second label" --> b\n  b -- "third label" --> a', options);
    const tips = [...svg.matchAll(/class="pele-marker" d="([^"]*)"/g)].flatMap((m) => [...m[1].matchAll(/(-?[\d.]+),(-?[\d.]+)/g)].map((p) => [Number(p[1]), Number(p[2])]));
    expect(tips.length).toBeGreaterThan(0);
    for (const l of labelBoxes(svg)) {
      for (const [x, y] of tips) expect(Math.abs(x - l.x) >= l.w / 2 || Math.abs(y - l.y) >= l.h / 2).toBe(true);
    }
  });

  it('widens the gap between blocks whose parallel labels do not fit between them', () => {
    const rows = 'block\n  columns 1\n  a\n  b\n  a -- "conforming" --> b\n  b -- "deviation" --> a';
    expectSeparateLabels(rows, 2);
    const near = layoutOf('block\n  columns 1\n  a\n  b\n  a --> b\n  b --> a');
    const far = layoutOf(rows);
    expect(far.get('b')!.y - far.get('a')!.y).toBeGreaterThan(near.get('b')!.y - near.get('a')!.y);
    expectSeparateLabels('block\n  a["Service"] space b["Database"]\n  a -- "read" --> b\n  a -- "write rows" --> b\n  b -- "notify" --> a', 3);
    expectSeparateLabels('block\n  columns 1\n  a\n  space\n  b\n  a -- "one" --> b\n  a -- "two" --> b\n  a -- "three" --> b\n  a -- "four" --> b\n  a -- "five" --> b', 5);
    expectSeparateLabels('block\n  columns 1\n  block:up["Up"]\n    a b\n  end\n  c\n  up -- "hi there" --> c\n  c -- "back again" --> up', 2);
    for (const path of paths(render(rows, options).svg)) expect(path).toMatch(/^M[\d.,]+L[\d.,]+$/);
    // The row is stretched by its neighbor, so the first gap it gets falls short.
    expectSeparateLabels('block\n  columns 2\n  block:g\n    columns 1\n    a{"a"} b\n  end\n  q["Q<br>Q<br>Q<br>Q<br>Q<br>Q"]\n  a -- "long label" --> b\n  a -- "long label" --> b', 2);
  });

  it('keeps the gap between blocks when widening it leaves labels overlapping', () => {
    const src = 'block\n  columns 3\n  t1 t2 t3\n  a space b\n  b1 b2 b3\n  a -- "line one<br>line two<br>line three" --> b\n  b -- "back one<br>back two<br>back three" --> a';
    expect(render(src, options).width).toBe(render(src.replace(/ -- "[^"]*" --> /g, ' --> '), options).width);
  });

  it('does not widen columns past maxWidth', () => {
    const src = 'block\n  a["Service"] space b["Database"]\n  a -- "read" --> b\n  a -- "write rows" --> b\n  b -- "notify" --> a';
    for (const maxWidth of [380, 397.5]) expect(render(src, { ...options, maxWidth }).width).toBeLessThanOrEqual(maxWidth);
  });

  it('stacks parallel labels without widening the drawing past maxWidth', () => {
    const src = 'block\n  columns 1\n  a\n  space:2\n  b\n  a -- "a fairly long forward label" --> b\n  b -- "a fairly long backward label" --> a';
    expectSeparateLabels(src, 2);
    expect(render(src, { ...options, maxWidth: 240 }).width).toBeLessThanOrEqual(240);
  });

  it('draws a self-loop as an arc', () => {
    const { svg } = render('block\n  a\n  a -- "again" --> a', options);
    expect(paths(svg)[0]).toMatch(/^M[\d.,]+A10,10 0 1 1 [\d.,]+$/);
    expect(svg).toContain('>again<');
    assertInert(svg, 'self-loop');
  });

  it('joins a block to a composite that holds it', () => {
    const { svg } = render('block\n  block:g\n    a b\n  end\n  a --> g\n  g --> b', options);
    expect(paths(svg).length).toBe(2);
    expect(svg).not.toContain('NaN');
  });

  it('keeps every link of a statement with several', () => {
    const model = parse('block\n  a --> b --> c -- "x" --> d');
    expect(model.type).toBe('block');
    if (model.type !== 'block') return;
    expect(model.blocks.map((b) => b.id)).toEqual(['a', 'b', 'c', 'd']);
    expect(model.edges.map((e) => [e.start, e.end, e.label])).toEqual([['a', 'b', ''], ['b', 'c', ''], ['c', 'd', 'x']]);
    expect(model.edges.map((e) => e.id)).toEqual(['1-a-b', '1-b-c', '1-c-d']);
  });

  it('applies styles and classes, also when they come before the block', () => {
    const { svg } = render(
      'block\n  classDef hot fill:#f96,stroke:#333,color:#400;\n  class a hot\n  style b fill:red;stroke:blue,stroke-width:2px\n  a b c\n  class b, c hot',
      options
    );
    const el = elements(svg);
    const group = (id: string) => el.find((e) => e.attrs.get('data-id') === id)!;
    expect(group('a').attrs.get('class')).toBe('pele-node pele-shape-rect hot');
    expect(group('c').attrs.get('class')).toBe('pele-node pele-shape-rect hot');
    expect(svg).toContain('style="rx:var(--_r);fill:#f96;stroke:#333;"');
    expect(svg).toContain('style="rx:var(--_r);fill:red;stroke:blue;stroke-width:2px;"');
    expect(svg).toContain('style="fill:#400;"');
    expect(boxes(svg).size).toBe(3);
  });

  it('gives blocks without a class the default class', () => {
    const { svg } = render('block\n  a b\n  classDef default stroke:#f00\n  classDef other fill:#0f0\n  class b other', options);
    expect(svg.match(/stroke:#f00/g)?.length).toBe(1);
  });

  it('styles a composite', () => {
    const { svg } = render('block\n  block:g\n    a\n  end\n  style g fill:#fee,stroke:#f00', options);
    expect(svg).toMatch(/class="pele-cluster" data-id="g"><rect [^>]*style="rx:var\(--_r\);fill:#fee;stroke:#f00;"/);
  });

  it('draws a composite fill the author sets at full opacity', () => {
    const { svg } = render('block\n  block:g\n    a\n  end\n  block:h\n    b\n  end\n  style g fill:#fee', options);
    expect(svg).toMatch(/data-id="g"><rect [^>]*fill="var\(--_a\)" stroke=/);
    expect(svg).toMatch(/data-id="h"><rect [^>]*fill-opacity="0.5"/);
  });

  it('picks a contrasting label color on fills a style sets', () => {
    const { svg } = render(
      'block\n  block:g["Group"]\n    a["Light"]\n  end\n  b["Dark"] c["Own"] d["Plain"]\n  e<["Go"]>(right)\n  style g fill:#FFF9C4\n  style a fill:#BBDEFB\n  style b fill:#1f3a5f\n  style c fill:#1f3a5f,color:#eee\n  style e fill:black',
      options
    );
    expect(svg).toMatch(/data-id="g">.*?<text class="pele-cluster-label" fill="var\(--pele-fg-on-light,#1f1f1f\)"[^>]*>Group</);
    expect(svg).toMatch(/data-id="a"[^>]*>.*?<text class="pele-label" fill="var\(--pele-fg-on-light,#1f1f1f\)"[^>]*>Light</);
    expect(svg).toMatch(/data-id="b"[^>]*>.*?<text class="pele-label" fill="var\(--pele-fg-on-dark,#fff\)"[^>]*>Dark</);
    expect(svg).toMatch(/data-id="c"[^>]*>.*?<text class="pele-label" style="fill:#eee;"[^>]*>Own</);
    expect(svg).toMatch(/data-id="d"[^>]*>.*?<text class="pele-label" x=[^>]*>Plain</);
    expect(svg).toMatch(/data-id="e"[^>]*>.*?<text class="pele-label" fill="var\(--pele-fg-on-dark,#fff\)"[^>]*>Go</);
  });

  it('cases edges that cross a composite fill a style sets and inks those inside it', () => {
    const src = 'block\n  block:g\n    a b\n  end\n  c\n  a --> b\n  b --> c\n  c --> c\n  style g fill:#BBDEFB';
    const { svg } = render(src, options);
    const casings = /<g class="pele-casings"[^>]*>(.*?)<\/g>/.exec(svg)![1];
    const edges = [...svg.matchAll(/<g class="pele-edge" data-id="[^"]+"([^>]*)><path d="([^"]+)"/g)].map((m) => [m[1], m[2]]);
    expect(edges).toHaveLength(3);
    expect(edges.map(([, d]) => casings.includes(`<path d="${d}"/>`))).toEqual([false, true, false]);
    expect(edges.map(([attrs]) => attrs)).toEqual([' stroke="var(--pele-fg-on-light,#1f1f1f)"', '', '']);
    expect(render(src.replace('\n  style g fill:#BBDEFB', ''), options).svg).not.toMatch(/pele-casings|--pele-fg-on/);
    // The second loop on a reaches out past the composite, so it is cased.
    const loops = render('block\n  block:g\n    a\n  end\n  a --> a\n  a --> a\n  style g fill:white', options).svg;
    expect(loops).toMatch(/data-id="1-a-a" stroke="var\(--pele-fg-on-light,#1f1f1f\)"/);
    expect(loops).toMatch(/<g class="pele-edge" data-id="2-a-a"><path d="([^"]+)"/);
    expect(/<g class="pele-casings"[^>]*>(.*?)<\/g>/.exec(loops)![1]).toContain(`<path d="${/data-id="2-a-a"><path d="([^"]+)"/.exec(loops)![1]}"/>`);
  });

  it('draws the front matter title', () => {
    const plain = render('block\n  a', options);
    const titled = render('---\ntitle: Systems\n---\nblock\n  a', options);
    expect(titled.svg).toContain('class="pele-title" font-weight="var(--_tw)"');
    expect(titled.svg).toContain('>Systems<');
    expect(titled.height).toBeGreaterThan(plain.height);
  });

  it('escapes label text and decodes entities', () => {
    const { svg } = render('block\n  a["<b>bold</b> & #quot;q#quot; #9829;"]\n  b["<img src=x onerror=alert(1)>"]', options);
    expect(svg).not.toContain('<img');
    expect(svg).toContain('&quot;q&quot; ♥');
    expect(svg).toContain('font-weight="var(--_w)"');
  });

  it('uses the id as the label and merges later statements into the first', () => {
    const model = parse('block\n  a b\n  a["Named"]\n  b(("x")) --> a');
    if (model.type !== 'block') throw new Error('not a block model');
    expect(model.blocks.map((b) => [b.id, b.label, b.type])).toEqual([['a', 'Named', 'square'], ['b', 'x', 'circle']]);
  });

  it('lets a block be called root', () => {
    const model = parse('block\n  root leaf\n  root --> leaf');
    if (model.type !== 'block') throw new Error('not a block model');
    expect(model.blocks.map((b) => b.id)).toEqual(['root', 'leaf']);
    expect(layoutOf('block\n  root leaf').size).toBe(2);
  });

  it('rejects a column count of zero the way Mermaid does', () => {
    expect(() => render('block\n  columns 0\n  a b', options)).toThrow('Columns must be an integer !== 0.');
    expect(() => render('block\n  columns 0\n  a b', options)).toThrow(PeleError);
    expect(render('block\n  columns auto\n  a b', options).svg).toBe(render('block\n  a b', options).svg);
  });

  it('rejects what the grammar rejects', () => {
    for (const src of ['block', 'block\n', 'block\n  a - b', 'block\n  a[label]', 'block\n  block\n  a', 'block\n  a\n  end', 'block\n  default', 'block\n  accTitle: t\n  a']) {
      expect(() => parse(src), src).toThrow(PeleError);
    }
    expect(() => parse('block\n  a - b')).toThrow(/Lexical error on line 2/);
    expect(() => parse('block\n  a\n  end')).toThrow(/Parse error on line 3:[\s\S]*got 'end'/);
  });

  it('renders deep nesting without running out of stack', () => {
    const src = 'block\n' + 'block\n'.repeat(3000) + 'a\n' + 'end\n'.repeat(3000);
    const { svg } = render(src, { ...options, limit: Infinity });
    expect(svg.match(/class="pele-cluster"/g)?.length).toBe(3000);
  });

  it('gives generated ids that do not change between runs', () => {
    const model = parse('block\n  a space:2\n  block\n    b\n  end');
    if (model.type !== 'block') throw new Error('not a block model');
    expect(model.blocks.map((b) => b.id)).toEqual(['a', 'id-1-0', 'id-1-1', 'id-2']);
  });
});
