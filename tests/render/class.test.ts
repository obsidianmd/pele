import { describe, expect, it } from 'vitest';
import { PeleError, detectType, render, supports } from '../../src/index.js';
import { metricsMeasurer } from '../../src/text/measurer.js';
import { loadCorpus } from '../support/corpus.js';
import { assertWellFormed, elements } from '../support/xml.js';

const corpus = loadCorpus('class', /classDiagram/);
const options = { measurer: metricsMeasurer };
const draw = (body: string, extra: object = {}): string => render('classDiagram\n' + body, { ...options, ...extra }).svg;
const count = (svg: string, needle: string): number => svg.split(needle).length - 1;

function tryRender(src: string): string | undefined {
  try {
    return render(src, options).svg;
  } catch (error) {
    if (error instanceof PeleError) return undefined;
    throw error;
  }
}

function group(svg: string, id: string): string {
  const start = svg.indexOf(`data-id="${id}"`);
  expect(start, `group ${id}`).toBeGreaterThan(-1);
  const from = svg.lastIndexOf('<g', start);
  let depth = 0;
  const re = /<(\/?)g\b/g;
  re.lastIndex = from;
  for (let m = re.exec(svg); m !== null; m = re.exec(svg)) {
    depth += m[1] ? -1 : 1;
    if (depth === 0) return svg.slice(from, m.index);
  }
  return svg.slice(from);
}

function translate(svg: string, id: string): [number, number] {
  const m = /transform="translate\(([-\d.]+),([-\d.]+)\)"/.exec(group(svg, id))!;
  return [Number(m[1]), Number(m[2])];
}

describe('class diagram rendering', () => {
  it('wraps disconnected class groups at maxWidth while keeping each relationship intact', () => {
    const body = 'classA <|-- classB\nclassC *-- classD\nclassE o-- classF\nclassG <-- classH\nclassI -- classJ\nclassK <.. classL\nclassM <|.. classN\nclassO .. classP';
    for (const dir of ['TB', 'BT', 'LR', 'RL']) {
      const source = `classDiagram\ndirection ${dir}\n${body}`;
      const natural = render(source, { ...options, autoDirection: false });
      for (const maxWidth of [320, 600]) {
        const narrow = render(source, { ...options, maxWidth, autoDirection: false });
        if (natural.width <= maxWidth) {
          expect(narrow.svg).toBe(natural.svg);
          continue;
        }
        expect(narrow.width).toBeLessThanOrEqual(maxWidth);
        expect(narrow.height).toBeGreaterThan(natural.height);
        expect(count(narrow.svg, 'class="pele-node pele-class')).toBe(16);
        expect(count(narrow.svg, 'class="pele-edge pele-relation')).toBe(8);
        for (const [a, b] of [['A', 'B'], ['C', 'D'], ['E', 'F'], ['G', 'H'], ['I', 'J'], ['K', 'L'], ['M', 'N'], ['O', 'P']]) {
          const from = translate(narrow.svg, `class${a}`), to = translate(narrow.svg, `class${b}`);
          const oldFrom = translate(natural.svg, `class${a}`), oldTo = translate(natural.svg, `class${b}`);
          expect(to[0] - from[0]).toBeCloseTo(oldTo[0] - oldFrom[0], 2);
          expect(to[1] - from[1]).toBeCloseTo(oldTo[1] - oldFrom[1], 2);
        }
        expect(() => assertWellFormed(narrow.svg)).not.toThrow();
        expect(render(source, { ...options, maxWidth, autoDirection: false }).svg).toBe(narrow.svg);
      }
      expect(render(source, { ...options, maxWidth: natural.width, autoDirection: false }).svg).toBe(natural.svg);
    }
  });

  it('keeps connected and already fitting class diagrams unchanged', () => {
    for (const body of ['A --> B\nB --> C\nC --> A : uses', 'A --> B\nclass C', 'namespace N {\nclass A\nclass B\n}\nA --> B : calls']) {
      const natural = draw(body);
      for (const maxWidth of [0, -1, NaN, Infinity, 5000]) expect(draw(body, { maxWidth })).toBe(natural);
      if (body.startsWith('A --> B\nB --> C') || body.startsWith('namespace')) expect(draw(body, { maxWidth: 1 })).toBe(natural);
    }
  });

  it('keeps the layout when wrapping would not make it narrower', () => {
    const body = 'note "From Duck till Zebra"\nAnimal <|-- Duck\nAnimal <|-- Fish\nAnimal <|-- Zebra\nAnimal <|-- Cat\nAnimal <|-- Dog';
    expect(draw(body, { maxWidth: 320 })).toBe(draw(body));
  });

  it('moves namespaces, notes, relationship labels and self-links with their class groups', () => {
    const body = Array.from({ length: 4 }, (_, i) => `namespace N${i} {\nclass A${i}\nclass B${i}\n}\nA${i} "one" --> "many" B${i} : uses\nnote for A${i} "check"\nB${i} --> B${i} : retry`).join('\n');
    const natural = draw(body);
    const narrow = draw(body, { maxWidth: 600 });
    expect(narrow).not.toBe(natural);
    expect(Number(/viewBox="0 0 ([\d.]+)/.exec(narrow)![1])).toBeLessThanOrEqual(600);
    for (const token of ['pele-class', 'pele-namespace', 'pele-note', 'pele-cardinality', 'pele-marker']) expect(count(narrow, token)).toBe(count(natural, token));
    expect(narrow).not.toMatch(/NaN|Infinity|undefined/);
    expect(() => assertWellFormed(narrow)).not.toThrow();
  });

  it('renders every corpus input that parses, as well-formed SVG', () => {
    let rendered = 0;
    for (const src of corpus) {
      const svg = tryRender(src);
      if (svg === undefined) continue;
      rendered++;
      const where = JSON.stringify(src).slice(0, 120);
      expect(() => assertWellFormed(svg), where).not.toThrow();
      expect(svg, where).not.toMatch(/<script|<style|<foreignObject|\son\w+=|javascript:/i);
      expect(svg, where).not.toContain('NaN');
      expect(svg, where).not.toContain('undefined');
      expect(tryRender(src), where).toBe(svg);
    }
    expect(rendered).toBeGreaterThan(70);
  });

  it('is detected, supported and typed for both keywords', () => {
    for (const keyword of ['classDiagram', 'classDiagram-v2']) {
      const src = `${keyword}\n  Animal <|-- Duck`;
      expect(detectType(src)).toBe('class');
      expect(supports(src)).toBe(true);
      const result = render(src, options);
      expect(result.type).toBe('class');
      expect(result.svg).toMatch(/^<svg xmlns="http:\/\/www\.w3\.org\/2000\/svg" class="pele pele-class"/);
      expect(result.svg).toContain(`viewBox="0 0 ${result.width} ${result.height}"`);
    }
  });

  it('themes through custom properties, with no style element', () => {
    const svg = draw('class A {\n +x\n}\nA --> B : uses\nnote for A "n"');
    for (const token of ['--pele-bg', '--pele-fg', '--pele-line', '--pele-surface', '--pele-border', '--pele-muted']) {
      expect(svg).toContain(`var(${token},`);
    }
    expect(svg).not.toContain('<style');
    for (const el of elements(svg)) {
      for (const name of ['fill', 'stroke']) {
        const value = el.attrs.get(name);
        if (value !== undefined) expect(value).toMatch(/^(?:none|var\(--_\w+\))$/);
      }
    }
  });

  it('lays out along the declared direction', () => {
    const at = (dir: string): [number, number][] => {
      const svg = draw(`direction ${dir}\nA <|-- B`);
      return [translate(svg, 'A'), translate(svg, 'B')];
    };
    const [tbA, tbB] = at('TB');
    expect(tbB[1]).toBeGreaterThan(tbA[1]);
    const [btA, btB] = at('BT');
    expect(btB[1]).toBeLessThan(btA[1]);
    const [lrA, lrB] = at('LR');
    expect(lrB[0]).toBeGreaterThan(lrA[0]);
    expect(lrB[1]).toBe(lrA[1]);
    const [rlA, rlB] = at('RL');
    expect(rlB[0]).toBeLessThan(rlA[0]);
  });

  it('draws a class as a box with a title, attributes and methods', () => {
    const svg = draw('class Duck {\n  +String beakColor\n  -int age\n  +swim()\n  +quack() bool\n}');
    const duck = group(svg, 'Duck');
    expect(duck).toContain('class="pele-node pele-class"');
    expect(count(duck, '<rect')).toBe(1);
    expect(duck).toMatch(/<text class="pele-label" font-weight="var\(--_hw\)"[^>]*><tspan[^>]*>Duck<\/tspan>/);
    expect(duck).toMatch(/<path class="pele-divider" d="M[-\d.]+,[-\d.]+H[-\d.]+M[-\d.]+,[-\d.]+H[-\d.]+"/);
    const texts = [...duck.matchAll(/<text class="pele-member pele-(attribute|method)"[^>]* y="([-\d.]+)">([^<]*)<\/text>/g)];
    expect(texts.map((m) => [m[1], m[3]])).toEqual([
      ['attribute', '+String beakColor'],
      ['attribute', '-int age'],
      ['method', '+swim()'],
      ['method', '+quack() : bool'],
    ]);
    const ys = texts.map((m) => Number(m[2]));
    expect([...ys].sort((a, b) => a - b)).toEqual(ys);
    const dividers = /d="M[-\d.]+,([-\d.]+)H[-\d.]+M[-\d.]+,([-\d.]+)H/.exec(duck)!;
    expect(Number(dividers[1])).toBeLessThan(ys[0]);
    expect(Number(dividers[2])).toBeGreaterThan(ys[1]);
    expect(Number(dividers[2])).toBeLessThan(ys[2]);
  });

  it('makes the box wide enough for its longest line', () => {
    const narrow = /<rect[^>]* width="([\d.]+)"/.exec(group(draw('class A {\n  +x\n}'), 'A'))!;
    const wide = /<rect[^>]* width="([\d.]+)"/.exec(group(draw('class A {\n  +aVeryLongMethodName(withParameter: SomeType) ReturnType\n}'), 'A'))!;
    expect(Number(wide[1])).toBeGreaterThan(Number(narrow[1]) + 200);
  });

  it('underlines static members and sets abstract ones in italics', () => {
    const svg = draw('class A {\n  +count()$ int\n  +draw()*\n  +String name$\n  +plain\n}');
    expect(svg).toContain('<text class="pele-member pele-method pele-static" style="text-decoration:underline"');
    expect(svg).toContain('<text class="pele-member pele-method pele-abstract" font-style="italic"');
    expect(svg).toContain('<text class="pele-member pele-attribute pele-static" style="text-decoration:underline"');
    expect(svg).toMatch(/<text class="pele-member pele-attribute" x="[-\d.]+" y="[-\d.]+">\+plain</);
    expect(svg).toContain('>+count() : int<');
    expect(svg).toContain('>+draw()<');
  });

  it('writes generics with angle brackets, in titles and members', () => {
    const svg = draw('class Shape~T~ {\n  +List~int~ position\n  +get(List~List~T~~ x) Map~K, V~\n}\nclass Pair~K, V~');
    expect(svg).toContain('>Shape&lt;T&gt;<');
    expect(svg).toContain('>Pair&lt;K, V&gt;<');
    expect(svg).toContain('>+List&lt;int&gt; position<');
    expect(svg).toContain('>+get(List&lt;List&lt;T&gt;&gt; x) : Map&lt;K, V&gt;<');
    expect(svg).toContain('data-id="Shape"');
  });

  it('shows member text as written, without markup', () => {
    const svg = draw('class A {\n  +__init__(self)\n  +op(a *b, c *d)\n  +x <b>bold</b>\n  +amp #38; #lt;tag#gt;\n}');
    expect(svg).toContain('>+__init__(self)<');
    expect(svg).toContain('>+op(a *b, c *d)<');
    expect(svg).toContain('>+x &lt;b&gt;bold&lt;/b&gt;<');
    expect(svg).toContain('>+amp &amp; &lt;tag&gt;<');
  });

  it('shows annotations above the title', () => {
    const svg = draw('class Shape {\n  <<interface>>\n  draw()\n}\nclass Color\n<<enumeration>> Color\nclass S <<Service>>');
    const shape = group(svg, 'Shape');
    const annotation = /<text class="pele-annotation"[^>]* y="([-\d.]+)"[^>]*>«interface»<\/text>/.exec(shape)!;
    const title = /<tspan x="0" y="([-\d.]+)"[^>]*>Shape</.exec(shape)!;
    expect(Number(annotation[1])).toBeLessThan(Number(title[1]));
    expect(group(svg, 'Color')).toContain('«enumeration»');
    expect(group(svg, 'S')).toContain('«Service»');
    expect(shape).not.toContain('&lt;&lt;');
  });

  it('keeps empty compartments unless hideEmptyMembersBox is set', () => {
    const height = (svg: string): number => Number(/<rect[^>]* height="([\d.]+)"/.exec(group(svg, 'A'))![1]);
    const shown = draw('class A');
    const hidden = render('---\nconfig:\n  class:\n    hideEmptyMembersBox: true\n---\nclassDiagram\nclass A\nclass B {\n +x\n}', options).svg;
    expect(group(shown, 'A')).toContain('pele-divider');
    expect(group(hidden, 'A')).not.toContain('pele-divider');
    expect(group(hidden, 'B')).toContain('pele-divider');
    expect(height(hidden)).toBeLessThan(height(shown));
    expect(draw('class A', { config: { class: { hideEmptyMembersBox: true } } })).not.toContain('pele-divider');
  });

  it('uses the label of a class in place of its name', () => {
    const svg = draw('class A["A class with a label"]\nclass `Animal Class!`\nA --> `Animal Class!`');
    expect(group(svg, 'A')).toContain('>A class with a label<');
    expect(svg).toContain('data-id="Animal Class!"');
    expect(svg).toContain('>Animal Class!<');
  });

  it('draws each kind of relation end', () => {
    const markers = (relation: string): string[] => {
      const edge = group(draw(`A ${relation} B`), 'id_A_B_1');
      return [...edge.matchAll(/<(path|circle) class="pele-marker"([^>]*)>/g)].map((m) => m[1] + (/ fill="var\(--_l\)"/.test(m[2]) ? ' filled' : ''));
    };
    expect(markers('--')).toEqual([]);
    expect(markers('..')).toEqual([]);
    expect(markers('<|--')).toEqual(['path']);
    expect(markers('--|>')).toEqual(['path']);
    expect(markers('*--')).toEqual(['path filled']);
    expect(markers('--*')).toEqual(['path filled']);
    expect(markers('o--')).toEqual(['path']);
    expect(markers('-->')).toEqual(['path filled']);
    expect(markers('<--')).toEqual(['path filled']);
    expect(markers('..>')).toEqual(['path filled']);
    expect(markers('..|>')).toEqual(['path']);
    expect(markers('<|--|>')).toEqual(['path', 'path']);
    expect(markers('*--o')).toEqual(['path filled', 'path']);
    expect(markers('<-->')).toEqual(['path filled', 'path filled']);
    expect(markers('()--()')).toEqual(['circle', 'circle']);
  });

  it('gives each marker its own outline: triangle, diamond, arrowhead', () => {
    const corners = (relation: string): number => {
      const d = /<path class="pele-marker" d="([^"]+)"/.exec(group(draw(`A ${relation} B`), 'id_A_B_1'))![1];
      return count(d, 'L') + 1;
    };
    expect(corners('--|>')).toBe(3);
    expect(corners('--*')).toBe(4);
    expect(corners('--o')).toBe(4);
    expect(corners('-->')).toBe(3);
  });

  it('puts the marker at the end the source names, pointing into that class', () => {
    const svg = draw('Animal <|-- Duck');
    const edge = group(svg, 'id_Animal_Duck_1');
    const tip = /<path class="pele-marker" d="M([-\d.]+),([-\d.]+)L/.exec(edge)!;
    const [ax, ay] = translate(svg, 'Animal');
    const [, dy] = translate(svg, 'Duck');
    const half = Number(/<rect[^>]* height="([\d.]+)"/.exec(group(svg, 'Animal'))![1]) / 2;
    expect(Number(tip[1])).toBeCloseTo(ax, 1);
    expect(Number(tip[2])).toBeCloseTo(ay + half, 1);
    expect(dy).toBeGreaterThan(ay);
  });

  it('stops the line at the back of the marker', () => {
    const ends = (relation: string): [number, number] => {
      const svg = draw(`A ${relation} B`);
      const d = /<path d="M[-\d.]+,([-\d.]+)[^"]*?([-\d.]+)"/.exec(group(svg, 'id_A_B_1'))!;
      return [Number(d[1]), Number(d[2])];
    };
    const [plainStart, plainEnd] = ends('--');
    expect(ends('--|>')).toEqual([plainStart, plainEnd - 12]);
    expect(ends('<|--')).toEqual([plainStart + 12, plainEnd]);
    expect(ends('*--o')).toEqual([plainStart + 16, plainEnd - 16]);
    expect(ends('()--()')).toEqual([plainStart + 10, plainEnd - 10]);
  });

  it('dashes the line of a dotted relation only', () => {
    expect(group(draw('A ..> B'), 'id_A_B_1')).toMatch(/<path d="[^"]+" stroke-dasharray="6 4"\/>/);
    expect(group(draw('A --> B'), 'id_A_B_1')).not.toContain('stroke-dasharray');
    expect(group(draw('A ..|> B'), 'id_A_B_1')).not.toMatch(/pele-marker[^>]*stroke-dasharray/);
  });

  it('labels relations and writes the cardinality at each end', () => {
    const svg = draw('Customer "1" --> "0..*" Ticket : buys');
    expect(group(svg, 'id_Customer_Ticket_1')).toContain('pele-relation');
    const label = svg.slice(svg.indexOf('<g class="pele-edge-label"'));
    expect(label).toContain('>buys<');
    const cards = [...svg.matchAll(/<text class="pele-cardinality" x="([-\d.]+)" y="([-\d.]+)" text-anchor="middle">([^<]*)<\/text>/g)];
    expect(cards.map((m) => m[3])).toEqual(['1', '0..*']);
    const [, customerY] = translate(svg, 'Customer');
    const [, ticketY] = translate(svg, 'Ticket');
    const mid = (customerY + ticketY) / 2;
    expect(Number(cards[0][2])).toBeLessThan(mid);
    expect(Number(cards[0][2])).toBeGreaterThan(customerY);
    expect(Number(cards[1][2])).toBeGreaterThan(mid);
    expect(Number(cards[1][2])).toBeLessThan(ticketY);
  });

  it('runs an end with text straight beside the text, which sits on the side the line then bends to', () => {
    const svg = draw('Hub "1" --> "a" A\nHub "2" --> "b" B');
    const cards = [...svg.matchAll(/<text class="pele-cardinality" x="([-\d.]+)" y="([-\d.]+)"[^>]*>([^<]*)</g)];
    const x = (text: string): number => Number(cards.find((m) => m[3] === text)![1]);
    for (const [id, own, far] of [['id_Hub_A_1', '1', 'a'], ['id_Hub_B_2', '2', 'b']]) {
      const d = /<path d="M([-\d.]+),([-\d.]+)L([-\d.]+),([-\d.]+)C[^"]*L([-\d.]+),([-\d.]+)"/.exec(group(svg, id))!.slice(1).map(Number);
      expect(d[2]).toBe(d[0]);
      expect(d[3] - d[1]).toBeGreaterThanOrEqual(20);
      const left = d[4] < d[0];
      expect(x(own) < d[0]).toBe(left);
      expect(x(far) < d[4]).toBe(!left);
    }
  });

  it('spreads the relations that share a side of a class', () => {
    const svg = draw('Hub "1" --> "a" A\nHub "2" --> "b" B\nHub "3" --> "c" C');
    const starts = [1, 2, 3].map((n, i) => Number(/<path d="M([-\d.]+),/.exec(group(svg, `id_Hub_${'ABC'[i]}_${n}`))![1]));
    expect(new Set(starts).size).toBe(3);
    expect([...starts].sort((a, b) => a - b)).toEqual(starts);
    const cards = [...svg.matchAll(/<text class="pele-cardinality" x="([-\d.]+)" y="([-\d.]+)"/g)].map((m) => m[1] + ',' + m[2]);
    expect(new Set(cards).size).toBe(6);
  });

  it('draws a relation from a class to itself as a loop', () => {
    const svg = draw('class Node\nNode "1" --> "0..1" Node : next');
    const edge = group(svg, 'id_Node_Node_1');
    expect(edge).toMatch(/<path d="M[-\d.]+,[-\d.]+C[^"]+"\/>/);
    expect(count(edge, 'pele-marker')).toBe(1);
    expect(svg).toContain('>next<');
    expect(count(svg, 'pele-cardinality"')).toBe(2);
  });

  it('draws a lollipop interface as a ring with its name beside the class', () => {
    const svg = draw('bar ()-- foo\nfoo --() baz');
    expect(group(svg, 'interface0')).toContain('pele-interface');
    expect(group(svg, 'interface0')).toContain('>bar<');
    expect(group(svg, 'interface1')).toContain('>baz<');
    expect(group(svg, 'interface0')).not.toContain('<rect');
    expect(count(group(svg, 'id_interface0_foo_1'), '<circle class="pele-marker"')).toBe(1);
    expect(count(group(svg, 'id_foo_interface1_2'), '<circle class="pele-marker"')).toBe(1);
    expect(count(svg, 'pele-class')).toBe(1 + 1);
  });

  it('draws notes, and joins a note for a class to it with a dotted line', () => {
    const svg = draw('class MyClass\nnote "General<br>note"\nnote for MyClass "About **it**"');
    expect(group(svg, 'note0')).toContain('pele-note');
    expect(group(svg, 'note0')).toMatch(/>General<\/tspan><tspan[^>]*>note</);
    expect(group(svg, 'note1')).toMatch(/<tspan font-weight="var\(--_w\)">it<\/tspan>/);
    const edge = group(svg, 'edgeNote1');
    expect(edge).toContain('pele-note-edge');
    expect(edge).toContain('stroke-dasharray="2 4"');
    expect(edge).not.toContain('pele-marker');
    expect(svg).not.toContain('data-id="edgeNote0"');
    expect(draw('note for Missing "x"')).not.toContain('pele-edge');
  });

  it('draws namespaces as nested groups around their classes', () => {
    const svg = draw('namespace Outer {\n  class A\n  namespace Inner["In here"] {\n    class B\n  }\n}\nclass C\nA --> B\nB --> C');
    const box = (id: string): [number, number, number, number] => {
      const m = /<rect x="([-\d.]+)" y="([-\d.]+)" width="([\d.]+)" height="([\d.]+)"/.exec(group(svg, id))!;
      return [Number(m[1]), Number(m[2]), Number(m[1]) + Number(m[3]), Number(m[2]) + Number(m[4])];
    };
    const inside = (id: string, [x1, y1, x2, y2]: number[]): boolean => {
      const [x, y] = translate(svg, id);
      return x > x1 && x < x2 && y > y1 && y < y2;
    };
    const outer = box('Outer');
    const inner = box('Outer.Inner');
    expect(group(svg, 'Outer')).toContain('pele-cluster pele-namespace');
    expect(group(svg, 'Outer')).toContain('>Outer<');
    expect(group(svg, 'Outer.Inner')).toContain('>In here<');
    expect(inner[0]).toBeGreaterThan(outer[0]);
    expect(inner[1]).toBeGreaterThan(outer[1]);
    expect(inner[2]).toBeLessThan(outer[2]);
    expect(inner[3]).toBeLessThan(outer[3]);
    expect(inside('A', outer)).toBe(true);
    expect(inside('A', inner)).toBe(false);
    expect(inside('B', inner)).toBe(true);
    expect(inside('C', outer)).toBe(false);
    expect(svg.indexOf('pele-clusters')).toBeLessThan(svg.indexOf('pele-nodes'));
  });

  it('makes a namespace of each part of a dotted name, or one flat namespace in compact mode', () => {
    const src = 'namespace Company.Engineering {\n  class Dev\n}';
    const nested = draw(src);
    expect(count(nested, 'pele-namespace')).toBe(2);
    expect(group(nested, 'Company')).toContain('>Company<');
    expect(group(nested, 'Company.Engineering')).toContain('>Engineering<');
    const flat = draw(src, { config: { class: { hierarchicalNamespaces: false } } });
    expect(count(flat, 'pele-namespace')).toBe(1);
    expect(flat).toContain('>Company.Engineering<');
  });

  it('keeps a lollipop interface in the namespace of its class', () => {
    const svg = draw('namespace N {\n  class A\n}\nbar ()-- A');
    const m = /<rect x="([-\d.]+)" y="([-\d.]+)" width="([\d.]+)" height="([\d.]+)"/.exec(group(svg, 'N'))!;
    const [x, y] = translate(svg, 'interface0');
    expect(x).toBeGreaterThan(Number(m[1]));
    expect(x).toBeLessThan(Number(m[1]) + Number(m[3]));
    expect(y).toBeGreaterThan(Number(m[2]));
    expect(y).toBeLessThan(Number(m[2]) + Number(m[4]));
  });

  it('wraps a linked class in an anchor and reports it', () => {
    const { svg, links } = render(
      'classDiagram\nclass A\nclass B\nclass C\nlink A "https://example.com/a" "Tip A"\nclick B href "https://example.com/b" _self\ncallback C "fn" "Tip C"',
      options
    );
    expect(group(svg, 'A')).toMatch(/<a href="https:\/\/example\.com\/a" target="_blank" rel="noopener"><title>Tip A<\/title><rect/);
    expect(group(svg, 'B')).toContain('<a href="https://example.com/b" target="_self" rel="noopener">');
    expect(group(svg, 'C')).not.toContain('<a ');
    expect(group(svg, 'C')).toContain('<title>Tip C</title>');
    expect(group(svg, 'C')).toContain('class="pele-node pele-class clickable"');
    expect(links).toEqual([
      { id: 'A', href: 'https://example.com/a', internal: false },
      { id: 'B', href: 'https://example.com/b', internal: false },
    ]);
  });

  it('applies style, classDef, cssClass and the ::: shorthand', () => {
    const svg = draw(
      'class A\nclass B:::hot\nclass C\nclass D {\n +x$\n}\nclassDef default stroke:#00f\nstyle A fill:#f9f,stroke:#333,stroke-width:4px\nclassDef hot fill:#fdd,color:#900\nclassDef cold fill:#ddf\ncssClass "C,D" cold\nstyle D color:#090'
    );
    expect(group(svg, 'A')).toMatch(/<rect[^>]* style="rx:var\(--_r\);stroke:#333;fill:#f9f;stroke-width:4px;"/);
    expect(group(svg, 'A')).toContain('<path class="pele-divider"');
    expect(group(svg, 'A')).toMatch(/pele-divider"[^>]* style="stroke:#333"/);
    expect(group(svg, 'B')).toContain('class="pele-node pele-class hot"');
    expect(group(svg, 'B')).toMatch(/<rect[^>]* style="rx:var\(--_r\);stroke:#00f;fill:#fdd;"/);
    expect(group(svg, 'B')).toMatch(/<text class="pele-label" font-weight="var\(--_hw\)" style="fill:#900;"/);
    expect(group(svg, 'C')).toContain('class="pele-node pele-class cold"');
    expect(group(svg, 'C')).toMatch(/<rect[^>]* style="rx:var\(--_r\);stroke:#00f;fill:#ddf;"/);
    expect(group(svg, 'D')).toContain('pele-static" style="fill:#090;text-decoration:underline"');
  });

  it('lets the later of a style and a classDef win, as Mermaid does', () => {
    const fill = (body: string): string => /<rect[^>]* style="rx:var\(--_r\);fill:([^;]+);"/.exec(group(draw(body), 'A'))![1];
    expect(fill('class A:::c\nclassDef c fill:#111\nstyle A fill:#222')).toBe('#222');
    expect(fill('class A:::c\nstyle A fill:#222\nclassDef c fill:#111')).toBe('#111');
    expect(fill('classDef c fill:#111\nclass A:::c\nstyle A fill:#222')).toBe('#222');
    expect(fill('classDef c fill:#111\nclass A:::c')).toBe('#111');
  });

  it('carries accessible names', () => {
    const svg = draw('accTitle: The title\naccDescr: The description\nclass A');
    expect(svg).toContain('<title id="pele-title">The title</title>');
    expect(svg).toContain('<desc id="pele-desc">The description</desc>');
  });

  it('gives every drawn thing a class and the id it has in the source', () => {
    const svg = draw('namespace N {\n class A\n}\nA "1" --> "2" B : x\nnote for A "n"\nfoo ()-- B');
    for (const name of ['pele-clusters', 'pele-edges', 'pele-edge-labels', 'pele-cardinalities', 'pele-nodes', 'pele-cluster-label', 'pele-edge-label', 'pele-label']) {
      expect(svg).toContain(name);
    }
    const ids = [...svg.matchAll(/data-id="([^"]*)"/g)].map((m) => m[1]);
    expect(new Set(ids)).toEqual(new Set(['N', 'A', 'B', 'note0', 'interface0', 'edgeNote0', 'id_A_B_1', 'id_interface0_B_2']));
  });

  it('keeps every element inside the picture', () => {
    for (const src of ['direction LR\nA "one" --> "a long cardinality" B', 'A "left" --> "right" A', 'Hub "1" --> "many many" A\nHub --> B', 'direction RL\nA "x" <|-- "y" B\nA "z" --> "w" C']) {
      const result = render('classDiagram\n' + src, options);
      for (const m of result.svg.matchAll(/<text class="pele-cardinality" x="([-\d.]+)" y="([-\d.]+)"/g)) {
        expect(Number(m[1])).toBeGreaterThan(0);
        expect(Number(m[1])).toBeLessThan(result.width);
        expect(Number(m[2])).toBeGreaterThan(0);
        expect(Number(m[2])).toBeLessThan(result.height);
      }
    }
  });
});
