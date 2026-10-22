import { describe, expect, it } from 'vitest';
import { PeleError, detectType, parse, render, supports } from '../../src/index.js';
import type { StateModel } from '../../src/index.js';
import { metricsMeasurer } from '../../src/text/measurer.js';
import { loadCorpus } from '../support/corpus.js';
import { assertWellFormed, elements } from '../support/xml.js';

const corpus = loadCorpus('state', /stateDiagram/);
const options = { measurer: metricsMeasurer };

// Path data as the renderer writes it: each command with exactly the numbers it takes.
const PAIR = '-?[\\d.]+,-?[\\d.]+';
const PATH = new RegExp(`^(?:[ML]${PAIR}|[HV]-?[\\d.]+|C${PAIR} ${PAIR} ${PAIR}|Z)+$`);

function tryRender(src: string): string | undefined {
  try {
    return render(src, options).svg;
  } catch (error) {
    if (error instanceof PeleError) return undefined;
    throw error;
  }
}

function draw(body: string): string {
  return render('stateDiagram-v2\n' + body, options).svg;
}

function model(body: string): StateModel {
  return parse('stateDiagram-v2\n' + body) as StateModel;
}

function count(svg: string, needle: string): number {
  return svg.split(needle).length - 1;
}

// The translate() of the group that carries a data-id.
function place(svg: string, id: string): { x: number; y: number } {
  const m = new RegExp(`data-id="${id}" transform="translate\\(([-\\d.]+),([-\\d.]+)\\)"`).exec(svg);
  if (!m) throw new Error(`No node ${id}`);
  return { x: Number(m[1]), y: Number(m[2]) };
}

function rectOf(svg: string, id: string): { w: number; h: number } {
  const at = svg.indexOf(`data-id="${id}"`);
  const m = /<rect x="[-\d.]+" y="[-\d.]+" width="([\d.]+)" height="([\d.]+)"/.exec(svg.slice(at));
  if (!m) throw new Error(`No rect in ${id}`);
  return { w: Number(m[1]), h: Number(m[2]) };
}

describe('state diagram rendering', () => {
  it('renders every corpus input that parses, as well-formed SVG, the same way each time', () => {
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
      expect(svg, where).not.toContain('Infinity');
      for (const el of elements(svg)) {
        const d = el.attrs.get('d');
        if (d !== undefined) expect(d, where).toMatch(PATH);
      }
      expect(tryRender(src), where).toBe(svg);
    }
    expect(rendered).toBeGreaterThan(80);
  }, 120_000);

  it('detects both keywords and reports size and type', () => {
    expect(detectType('stateDiagram\n a --> b')).toBe('state');
    expect(detectType('stateDiagram-v2\n a --> b')).toBe('state');
    expect(supports('stateDiagram-v2\n a --> b')).toBe(true);
    const result = render('stateDiagram-v2\n a --> b', options);
    expect(result.type).toBe('state');
    expect(result.svg).toMatch(/^<svg xmlns="http:\/\/www\.w3\.org\/2000\/svg" class="pele pele-state"/);
    expect(result.svg).toContain(`viewBox="0 0 ${result.width} ${result.height}"`);
    expect(result.height).toBeGreaterThan(result.width);
  });

  it('themes through custom properties and uses only the shared tokens', () => {
    const svg = draw('[*] --> a\n state a {\n x --> y : go\n }\n note right of a : n\n a --> [*]');
    expect(svg).not.toContain('<style');
    for (const el of elements(svg)) {
      for (const name of ['fill', 'stroke']) {
        const value = el.attrs.get(name);
        if (value !== undefined && el.name !== 'svg') expect(value).toMatch(/^(?:none|var\(--_(?:bg|fg|m|l|s|a|b|c)\))$/);
      }
    }
  });

  it('lays out along the declared direction', () => {
    const tall = render('stateDiagram-v2\n a --> b\n b --> c', options);
    const wide = render('stateDiagram-v2\n direction LR\n a --> b\n b --> c', options);
    expect(tall.height).toBeGreaterThan(tall.width);
    expect(wide.width).toBeGreaterThan(wide.height);
    const up = draw('direction BT\n a --> b');
    expect(place(up, 'a').y).toBeGreaterThan(place(up, 'b').y);
    const leftward = draw('direction RL\n a --> b');
    expect(place(leftward, 'a').x).toBeGreaterThan(place(leftward, 'b').x);
  });

  it('draws a state with its id, its description, or a title over description lines', () => {
    expect(draw('s1')).toContain('>s1</text>');
    const described = draw('state "A long name" as s1\n s2 : Other');
    expect(described).toContain('>A long name</text>');
    expect(described).toContain('>Other</text>');
    expect(described).not.toContain('>s1</text>');
    const lines = draw('s1 : Title\n s1 : first\n s1 : second');
    expect(lines).toContain('>Title</text>');
    expect(count(lines, 'class="pele-state-description"')).toBe(2);
    expect(rectOf(lines, 's1').h).toBeGreaterThan(rectOf(draw('s1 : Title'), 's1').h + 30);
  });

  it('draws [*] as a start dot or an end ring, separately in each composite', () => {
    const svg = draw('[*] --> a\n a --> [*]\n state a {\n [*] --> b\n b --> [*]\n }');
    expect(count(svg, 'pele-state-start')).toBe(2);
    expect(count(svg, 'pele-state-end')).toBe(2);
    for (const id of ['root_start', 'root_end', 'a_start', 'a_end']) expect(svg).toContain(`data-id="${id}"`);
    expect(count(svg, 'class="pele-edge pele-transition"')).toBe(4);
  });

  it('keeps a transition that arrives apart from one that leaves on the same side of a state', () => {
    const { svg } = render('stateDiagram-v2\n  Still --> Moving\n  Moving --> Still', options);
    const tips = [...svg.matchAll(/class="pele-marker" d="M([-\d.]+),([-\d.]+)L/g)].map((m) => [Number(m[1]), Number(m[2])]);
    const starts = [...svg.matchAll(/<g class="pele-edge pele-transition"[^>]*><path d="M([-\d.]+),([-\d.]+)/g)].map((m) => [Number(m[1]), Number(m[2])]);
    expect(tips).toHaveLength(2);
    expect(starts).toHaveLength(2);
    for (const [x, y] of tips) {
      const beside = starts.find((start) => Math.abs(start[1] - y) < 1);
      expect(beside).toBeDefined();
      expect(Math.abs(beside![0] - x)).toBeGreaterThanOrEqual(12);
    }
  });

  it('draws a choice as a diamond and fork and join as bars across the flow', () => {
    const body = 'state c <<choice>>\n state f <<fork>>\n state j <<join>>\n [*] --> f\n f --> x\n f --> y\n x --> j\n y --> j\n j --> c\n c --> p : yes\n c --> q : no';
    const down = draw(body);
    expect(down).toMatch(/pele-state-choice" data-id="c"[^>]*><polygon/);
    expect(down).not.toContain('>c</text>');
    expect(rectOf(down, 'f').w).toBeGreaterThan(rectOf(down, 'f').h * 4);
    expect(down).toContain('pele-state-join" data-id="j"');
    const across = draw('direction LR\n' + body);
    expect(rectOf(across, 'f').h).toBeGreaterThan(rectOf(across, 'f').w * 4);
    expect(draw('state f [[fork]]\n f --> x')).toContain('pele-state-fork');
  });

  it('draws a composite as a titled cluster around its states, to any depth', () => {
    const svg = draw('[*] --> A\n state A {\n state B {\n state "Deep name" as C {\n x --> y\n }\n }\n }');
    expect(count(svg, 'pele-state-composite')).toBe(3);
    expect(svg).toContain('class="pele-cluster-label"');
    expect(svg).toContain('>Deep name</text>');
    const a = rectOf(svg, 'A');
    const b = rectOf(svg, 'B');
    const c = rectOf(svg, 'C');
    expect(a.w).toBeGreaterThan(b.w);
    expect(b.w).toBeGreaterThan(c.w);
    expect(a.h).toBeGreaterThan(b.h);
    expect(svg.indexOf('data-id="A"')).toBeLessThan(svg.indexOf('data-id="B"'));
  });

  it('gives each composite its own direction', () => {
    const svg = draw('state A {\n direction LR\n a1 --> a2\n }\n state B {\n b1 --> b2\n }\n A --> B');
    expect(place(svg, 'a1').y).toBe(place(svg, 'a2').y);
    expect(place(svg, 'a1').x).toBeLessThan(place(svg, 'a2').x);
    expect(place(svg, 'b1').x).toBe(place(svg, 'b2').x);
    // As in Mermaid, a composite does not take the direction of what surrounds it.
    const around = draw('direction LR\n state A {\n a1 --> a2\n }\n A --> z');
    expect(place(around, 'a1').x).toBe(place(around, 'a2').x);
    expect(place(around, 'a1').y).toBeLessThan(place(around, 'a2').y);
    expect(place(around, 'z').y).toBeGreaterThan(place(around, 'a1').y);
    expect(place(around, 'z').y).toBeLessThan(place(around, 'a2').y);
  });

  it('splits a composite into regions with a dashed divider between them', () => {
    const body = 'state A {\n [*] --> a1\n --\n [*] --> b1\n --\n [*] --> c1\n }';
    const svg = draw(body);
    expect(count(svg, 'class="pele-divider"')).toBe(2);
    expect(svg).toContain('stroke-dasharray="4 4"');
    expect(count(svg, 'pele-state-start')).toBe(3);
    expect(place(svg, 'a1').x).toBeLessThan(place(svg, 'b1').x);
    expect(place(svg, 'b1').x).toBeLessThan(place(svg, 'c1').x);
    expect(svg).toMatch(/class="pele-divider" d="M[\d.]+,[\d.]+V/);
    // A transition from one region to the next puts them in a stack, divided the other way.
    const stacked = draw('state A {\n a1\n --\n b1\n }\n a1 --> b1');
    expect(stacked).toMatch(/class="pele-divider" d="M[\d.]+,[\d.]+H/);
    expect(place(stacked, 'a1').y).toBeLessThan(place(stacked, 'b1').y);
    // Mermaid fails to draw a composite whose last statement is a divider.
    const trailing = draw('state A {\n x\n --\n y\n --\n }');
    expect(count(trailing, 'class="pele-divider"')).toBe(1);
    expect(place(trailing, 'x').x).toBeLessThan(place(trailing, 'y').x);
  });

  it('draws notes beside their state, joined by a dashed line', () => {
    const svg = draw('a --> b\n note right of a : on the right\n note left of b\n first line\n second line\n end note');
    expect(count(svg, 'class="pele-note"')).toBe(2);
    expect(count(svg, 'pele-note-edge')).toBe(2);
    expect(svg).toContain('>on the right</text>');
    expect(svg).toContain('>first line</tspan>');
    expect(svg).toContain('>second line</tspan>');
    expect(place(svg, 'a----note-1').x).toBeGreaterThan(place(svg, 'a').x);
    expect(place(svg, 'a----note-1').y).toBe(place(svg, 'a').y);
    expect(place(svg, 'b----note-2').x).toBeLessThan(place(svg, 'b').x);
    expect(place(svg, 'a').x).toBe(place(svg, 'b').x);
    const across = draw('direction LR\n a --> b\n note right of a : below\n note left of b : above');
    expect(place(across, 'a----note-1').y).toBeGreaterThan(place(across, 'a').y);
    expect(place(across, 'b----note-2').y).toBeLessThan(place(across, 'b').y);
    const onComposite = draw('state A {\n x --> y\n }\n note right of A : about A');
    expect(onComposite).toContain('>about A</text>');
    expect(count(onComposite, 'pele-note-edge')).toBe(1);
  });

  it('labels transitions, including those to self and across composite borders', () => {
    const svg = draw('state A {\n in1 --> in2 : inner\n in2 --> in2 : again\n }\n out --> in1 : cross\n A --> A : whole\n A --> in1 : enter\n in2 --> A : leave');
    for (const text of ['inner', 'again', 'cross', 'whole', 'enter', 'leave']) expect(svg).toContain(`>${text}</text>`);
    expect(count(svg, 'class="pele-edge-label"')).toBe(6);
    expect(count(svg, 'class="pele-edge pele-transition"')).toBe(6);
    expect(count(svg, 'class="pele-marker"')).toBe(6);
    expect(svg).not.toContain('NaN');
  });

  it('uses the configured curve for transitions, including those across composite borders', () => {
    for (const dir of ['TB', 'LR']) {
      const body = `direction ${dir}\n state A {\n a --> b\n a --> c\n }\n out --> a\n A --> out`;
      const smooth = draw(body);
      expect(smooth).toMatch(/<g class="pele-edge pele-transition"[^>]*><path d="[^"]*C/);
      for (const curve of ['linear', 'step', 'stepBefore', 'stepAfter']) {
        const svg = render(`---\nconfig:\n  flowchart:\n    curve: ${curve}\n---\nstateDiagram-v2\n${body}`, options).svg;
        expect(svg).not.toBe(smooth);
        expect(() => assertWellFormed(svg)).not.toThrow();
        expect(svg).not.toMatch(/NaN|Infinity|undefined/);
        const paths = [...svg.matchAll(/<g class="pele-edge pele-transition"[^>]*><path d="([^"]+)"/g)].map((m) => m[1]);
        expect(paths).toHaveLength(4);
        if (curve !== 'linear') expect(paths.some((d) => d.includes('Q'))).toBe(true);
        for (const d of paths) expect(d).toMatch(curve === 'linear'
          ? /^M[-\d.]+,[-\d.]+(?:L[-\d.]+,[-\d.]+)+$/
          : /^M[-\d.]+,[-\d.]+(?:L[-\d.]+,[-\d.]+|Q[-\d.]+,[-\d.]+ [-\d.]+,[-\d.]+)+$/);
        const tips = [...svg.matchAll(/class="pele-marker" d="M([-\d.]+),([-\d.]+)L/g)].map((m) => [Number(m[1]), Number(m[2])]);
        expect(tips).toHaveLength(4);
        // Each path stops just behind its arrowhead, including at composite borders.
        for (let i = 0; i < paths.length; i++) {
          const end = /([-\d.]+),([-\d.]+)$/.exec(paths[i])!;
          expect(Math.hypot(tips[i][0] - Number(end[1]), tips[i][1] - Number(end[2]))).toBeCloseTo(7, 1);
        }
      }
    }
  });

  it('keeps stepped arrowheads pointing into their states along the flow', () => {
    for (const dir of ['TB', 'LR']) {
      for (const curve of ['step', 'stepBefore', 'stepAfter']) {
        const src = `---\nconfig:\n  flowchart:\n    curve: ${curve}\n---\nstateDiagram-v2\n direction ${dir}\n A --> B\n A --> C\n A --> D\n B --> E\n C --> E\n D --> E\n E --> F : Yes\n E --> A : No`;
        const svg = render(src, options).svg;
        const markers = [...svg.matchAll(/class="pele-marker" d="M[-\d.]+,[-\d.]+L([-\d.]+),([-\d.]+)L([-\d.]+),([-\d.]+)Z"/g)];
        expect(markers).toHaveLength(8);
        // The two back corners are level, or on the same vertical for left-to-right flow.
        for (const m of markers) expect(Number(m[dir === 'TB' ? 2 : 1])).toBeCloseTo(Number(m[dir === 'TB' ? 4 : 3]), 5);
      }
    }
  });

  it('ignores a state curve setting, which Mermaid does not have', () => {
    const body = 'a --> b\n a --> c\n b --> d\n c --> d';
    const svg = render(`---\nconfig:\n  state:\n    curve: step\n---\nstateDiagram-v2\n${body}`, options).svg;
    expect(svg).toBe(draw(body));
  });

  it('keeps the default curve for absent, unknown and non-string settings', () => {
    const body = 'a --> b\n a --> c\n b --> d\n c --> d';
    for (const curve of ['basis', 'unknown', 'stepUnknown', '42', 'true', 'null', '{}']) {
      const svg = render(`---\nconfig:\n  flowchart:\n    curve: ${curve}\n---\nstateDiagram-v2\n${body}`, options).svg;
      expect(svg).toBe(draw(body));
    }
  });

  it('keeps self-transitions curved for every curve setting', () => {
    const body = 'a --> a : again';
    for (const curve of ['linear', 'basis', 'step', 'stepBefore', 'stepAfter']) {
      const svg = render(`---\nconfig:\n  flowchart:\n    curve: ${curve}\n---\nstateDiagram-v2\n${body}`, options).svg;
      expect(svg).toBe(draw(body));
      expect(count(svg, 'class="pele-marker"')).toBe(1);
    }
  });

  it('keeps the labels of several self-transitions apart', () => {
    const labelY = (svg: string, text: string): number => Number(new RegExp(`y="([\\d.]+)" text-anchor="middle">${text}<`).exec(svg)![1]);
    const down = draw('a --> a : one\n a --> a : two\n a --> b');
    expect(labelY(down, 'two') - labelY(down, 'one')).toBeGreaterThanOrEqual(20);
    const across = draw('direction LR\n a --> a : one\n a --> a : two\n a --> b');
    expect(labelY(across, 'two') - labelY(across, 'one')).toBeGreaterThanOrEqual(20);
    expect(labelY(across, 'one')).toBeGreaterThan(place(across, 'a').y + 22);
  });

  it('starts the flow at the initial state even when other states are declared first', () => {
    const svg = draw('state c <<choice>>\n [*] --> a\n a --> c\n c --> b\n b --> a');
    expect(place(svg, 'root_start').y).toBeLessThan(place(svg, 'a').y);
    expect(place(svg, 'a').y).toBeLessThan(place(svg, 'c').y);
    expect(place(svg, 'c').y).toBeLessThan(place(svg, 'b').y);
  });

  it('applies classDef, class, ::: and style to states', () => {
    const svg = draw(
      'classDef hot fill:#f00,color:white,font-weight:bold\n classDef cool stroke:#00f\n a:::cool --> b\n class b hot\n style c fill:#0f0,stroke-width:4px\n b --> c\n state G {\n g1\n }\n class G cool'
    );
    expect(svg).toMatch(/class="pele-node pele-state cool" data-id="a"[^>]*><rect[^>]* style="stroke:#00f;"/);
    expect(svg).toMatch(/class="pele-node pele-state hot" data-id="b"[^>]*><rect[^>]* style="fill:#f00;"/);
    expect(svg).toMatch(/data-id="b"[^>]*><rect[^>]*\/><text class="pele-label" style="fill:white;font-weight:bold;"/);
    expect(svg).toMatch(/data-id="c"[^>]*><rect[^>]* style="fill:#0f0;stroke-width:4px;"/);
    expect(svg).toMatch(/class="pele-cluster pele-state-composite cool" data-id="G"><rect[^>]* style="stroke:#00f;"/);
  });

  it('turns click statements into links, with the URL sanitized', () => {
    const result = render(
      'stateDiagram-v2\n a --> b\n b --> c\n click a "https://example.com/x" "Go there"\n click b href "https://example.org"\n click c "javascript:alert(1)" "no"\n',
      options
    );
    expect(result.svg).toContain('<a href="https://example.com/x" target="_blank" rel="noopener"><title>Go there</title>');
    expect(result.svg).toContain('<a href="https://example.org/" target="_blank" rel="noopener">');
    expect(result.svg.match(/<a\b/g)).toHaveLength(2);
    expect(result.svg).toContain('<title>no</title>');
    expect(result.links).toEqual([
      { id: 'a', href: 'https://example.com/x', internal: false },
      { id: 'b', href: 'https://example.org/', internal: false },
    ]);
  });

  it('writes the accessible title and description', () => {
    const svg = draw('accTitle: The title\n accDescr: The description\n a --> b');
    expect(svg).toContain('<title id="pele-title">The title</title>');
    expect(svg).toContain('<desc id="pele-desc">The description</desc>');
    expect(draw('accDescr {\n several\n lines\n }\n a --> b')).toContain('<desc id="pele-desc">several\nlines</desc>');
  });

  it('accepts the statements that change nothing: hide empty description, scale, comments', () => {
    const plain = draw('a --> b');
    expect(draw('hide empty description\n scale 350 width\n a --> b')).toBe(plain);
    expect(draw('%% a comment\n a --> b %% trailing')).toBe(plain);
  });

  it('reads labels as markdown with entities and line breaks', () => {
    const svg = draw('a : **bold** and *italic*\n a --> b : one<br>two\n b : x #35; y');
    expect(svg).toContain('font-weight="var(--_w)">bold</tspan>');
    expect(svg).toContain('font-style="italic">italic</tspan>');
    expect(svg).toContain('>one</tspan>');
    expect(svg).toContain('>x # y</text>');
  });

  it('keeps Mermaid quirks that change what is drawn', () => {
    // A bare `state name` declares nothing in Mermaid's grammar.
    expect(draw('state lonely\n a --> b')).not.toContain('lonely');
    // A stereotype given after the state's first use is ignored.
    expect(draw('a --> c\n state c <<choice>>')).toContain('>c</text>');
    // A note's text loses its first character when no space precedes the colon.
    expect(model('note right of a:text').states.get('a')?.note?.text).toBe('ext');
    // A state belongs to the last composite that mentions it.
    const moved = model('state A {\n a1\n }\n state B {\n b1 --> a1\n }') as StateModel & { graph: { nodes: { id: string; parentId?: string }[] } };
    expect(moved.graph.nodes.find((node) => node.id === 'a1')?.parentId).toBe('B');
  });

  it('rejects what Mermaid rejects', () => {
    expect(() => draw('state two words {\n a\n }')).toThrow('Error: State name must be a single word.');
    expect(() => draw('state A {\n x\n }\n A : one\n A : two')).toThrow('Group nodes can only have label.');
    expect(() => draw('a --> b --> c')).toThrow(PeleError);
    expect(() => draw('classDef default fill:red')).toThrow(PeleError);
    expect(() => draw('state A {\n x --> y')).toThrow(/Parse error on line/);
    expect(() => draw('scale 350\n a --> b')).toThrow(/Lexical error on line 2/);
  });

  it('exposes the parsed model', () => {
    const parsed = model('direction LR\n [*] --> a\n a --> b : go\n classDef c fill:red\n class a c\n click a "https://example.com" "tip"\n');
    expect(parsed.type).toBe('state');
    expect(parsed.direction).toBe('LR');
    expect([...parsed.states.keys()]).toEqual(['root_start', 'a', 'b']);
    expect(parsed.relations).toEqual([
      { id1: 'root_start', id2: 'a', relationTitle: '' },
      { id1: 'a', id2: 'b', relationTitle: 'go' },
    ]);
    expect(parsed.states.get('a')?.classes).toEqual(['c']);
    expect(parsed.classes.get('c')?.styles).toEqual(['fill:red']);
    expect(parsed.links.get('a')).toEqual({ url: '"https://example.com"', tooltip: '"tip"' });
  });
});
