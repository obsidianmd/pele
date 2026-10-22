import { describe, expect, it } from 'vitest';
import { PeleError, detectType, parse, render, supports } from '../../src/index.js';
import { resolveStyle } from '../../src/svg/theme.js';
import { metricsMeasurer } from '../../src/text/measurer.js';
import { loadCorpus } from '../support/corpus.js';
import { assertWellFormed } from '../support/xml.js';

const corpus = loadCorpus('flowchart', /graph|flowchart/);
const options = { measurer: metricsMeasurer };

function tryRender(src: string): string | undefined {
  try {
    return render(src, options).svg;
  } catch (error) {
    if (error instanceof PeleError) return undefined;
    throw error;
  }
}

describe('flowchart rendering', () => {
  it('renders every corpus input that parses, as well-formed and inert SVG', () => {
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
    expect(rendered).toBeGreaterThan(300);
  });

  it('reports size and type', () => {
    const result = render('flowchart LR\n  A --> B', options);
    expect(result.type).toBe('flowchart');
    expect(result.width).toBeGreaterThan(100);
    expect(result.height).toBeGreaterThan(30);
    expect(result.svg).toContain(`viewBox="0 0 ${result.width} ${result.height}"`);
    expect(result.svg).toMatch(/^<svg xmlns="http:\/\/www\.w3\.org\/2000\/svg" class="pele pele-flowchart"/);
  });

  it('lays out along the declared direction', () => {
    const tall = render('flowchart TD\n  A --> B --> C', options);
    const wide = render('flowchart LR\n  A --> B --> C', options);
    expect(tall.height).toBeGreaterThan(tall.width);
    expect(wide.width).toBeGreaterThan(wide.height);
  });

  it('themes through custom properties with fallbacks and no style element', () => {
    const { svg } = render('flowchart TD\n  A --> B', options);
    for (const token of ['--pele-bg', '--pele-fg', '--pele-line', '--pele-surface', '--pele-border', '--pele-font']) {
      expect(svg).toContain(`var(${token},`);
    }
    expect(svg).not.toContain('<style');
  });

  it('escapes label text', () => {
    const { svg } = render('flowchart TD\n  A["<img src=x onerror=alert(1)> & more"]', options);
    expect(svg).not.toContain('<img');
    expect(svg).toContain('&amp; more');
    assertWellFormed(svg);
  });

  it('decodes entity codes and line breaks in labels', () => {
    const { svg } = render('flowchart TD\n  A["a #quot;b#quot; #35; #9829;<br/>second line"]', options);
    expect(svg).toContain('a &quot;b&quot; # ♥');
    expect(svg).toContain('second line');
    expect(svg.match(/<tspan/g)?.length).toBe(2);
  });

  it('decodes HTML5 aliases such as lcub and verbar in labels', () => {
    const { svg } = render('flowchart LR\n  A["GET /plans/&lcub;id&rcub;"] --> B["items#lsqb;0#rsqb; #verbar; none"]', options);
    expect(svg).toContain('GET /plans/{id}');
    expect(svg).toContain('items[0] | none');
  });

  it('decodes each entity code once', () => {
    const { svg } = render('flowchart LR\n  A["x #amp;lt; y #38;gt; z"]', options);
    expect(svg).toContain('x &amp;lt; y &amp;gt; z');
  });

  it('wraps long labels', () => {
    const short = render('flowchart TD\n  A[one two]', options);
    const long = render('flowchart TD\n  A[one two three four five six seven eight nine ten eleven twelve]', options);
    expect(long.height).toBeGreaterThan(short.height);
    expect(long.width).toBeLessThan(300);
  });

  it('renders markdown emphasis', () => {
    const { svg } = render('flowchart TD\n  A["`This **is** _Markdown_`"]', options);
    expect(svg).toContain('<tspan font-weight="var(--_w)">is</tspan>');
    expect(svg).toContain('<tspan font-style="italic">Markdown</tspan>');
  });

  it('draws <code> spans in labels with the monospace font', () => {
    const { svg } = render('flowchart TD\n  A["Call <code>render()</code> once"]', options);
    expect(svg).toMatch(/<tspan[^>]* font-family="var\(--_fm\)">render\(\)<\/tspan>/);
    expect(svg).not.toMatch(/font-family="var\(--_fm\)">Call /);
  });

  it('writes the monospace family once when a whole label is code', () => {
    const { svg } = render('flowchart TD\n  A["<code>render()</code>"]', options);
    expect(svg).toMatch(/<text[^>]* font-family="var\(--_fm\)"/);
    expect(svg.match(/font-family="var\(--_fm\)"/g)?.length).toBe(1);
  });

  it('closes markdown emphasis in a label that is already bold', () => {
    const { svg } = render('flowchart TD\n  A["`one **two** three`"]\n  style A font-weight:bold', options);
    expect(svg).not.toContain('**');
    expect(svg).toContain('two');
  });

  it.each(['b', 'strong', 'i', 'em'])('keeps <%s> formatting across explicit line breaks', (tag) => {
    for (const br of ['<br/>', '<br>', '<BR />', '\\n', '\n']) {
      const source = `flowchart LR\n  A["<${tag}>First${br}Second</${tag}> plain${br}Third"]`;
      const reopened = `flowchart LR\n  A["<${tag}>First</${tag}>${br}<${tag}>Second</${tag}> plain${br}Third"]`;
      expect(render(source, options).svg, `${tag} across ${JSON.stringify(br)}`).toBe(render(reopened, options).svg);
    }
  });

  it('keeps nested HTML formatting across breaks without changing other labels or the base style', () => {
    const source = 'flowchart LR\n  A["<b><i>First<br/><br/>Second</i> bold</b> plain"] --> B[plain]';
    const reopened = 'flowchart LR\n  A["<b><i>First</i></b><br/><br/><b><i>Second</i> bold</b> plain"] --> B[plain]';
    for (const suffix of ['', '\n  style A font-weight:bold']) {
      expect(render(source + suffix, options).svg).toBe(render(reopened + suffix, options).svg);
    }
    expect(render('flowchart LR\n A["<b>First<br/>Second"] --> B[plain]', options).svg).toBe(
      render('flowchart LR\n A["<b>First</b><br/><b>Second</b>"] --> B[plain]', options).svg
    );
  });

  it('applies style, classDef and linkStyle', () => {
    const { svg } = render(
      'flowchart TD\n  A --> B\n  style A fill:#f9f,stroke:#333,stroke-width:4px,color:#fff\n  classDef warn fill:#ff0\n  class B warn\n  linkStyle 0 stroke:#f00,stroke-width:3px',
      options
    );
    expect(svg).toContain('style="rx:var(--_r);fill:#f9f;stroke:#333;stroke-width:4px;"');
    expect(svg).toContain('style="fill:#fff;"');
    expect(svg).toMatch(/class="pele-node pele-shape-rect warn" data-id="B"/);
    expect(svg).toContain('style="stroke:#f00;stroke-width:3px;"');
    expect(svg).toContain('fill="#f00"');
  });

  it('drops style values that could load resources or break out of the attribute', () => {
    expect(resolveStyle(['fill:url(http://example.com/x.png)', 'stroke:red']).shape).toBe(' style="stroke:red;"');
    expect(resolveStyle(['fill:red;background:blue', 'color:expression(alert(1))']).shape).toBe('');
    expect(resolveStyle(['position:fixed', 'fill:"><script>']).shape).toBe('');
  });

  it('links nodes and neutralizes script URLs', () => {
    const result = render(
      'flowchart TD\n  A --> B --> C\n  click A "https://example.com" "A tooltip" _blank\n  click B "javascript:alert(1)"\n  click C call doSomething()',
      options
    );
    expect(result.svg).toContain('<a href="https://example.com/" target="_blank" rel="noopener">');
    expect(result.svg).toContain('<title>A tooltip</title>');
    expect(result.svg.match(/<a\b/g)).toHaveLength(1);
    expect(result.svg).not.toContain('about:blank');
    expect(result.svg).not.toContain('doSomething');
    expect(result.links).toEqual([{ id: 'A', href: 'https://example.com/', internal: false }]);
  });

  it('turns internal-link nodes into Obsidian links', () => {
    const result = render('flowchart TD\n  A[My note] --> B\n  class A internal-link;', options);
    expect(result.svg).toContain('<a class="internal-link" href="My note" rel="noopener" data-href="My note">');
    expect(result.links).toEqual([{ id: 'A', href: 'My note', internal: true }]);
  });

  it('draws subgraphs as clusters behind their members', () => {
    const { svg } = render('flowchart TD\n  subgraph one [First group]\n    A --> B\n  end\n  B --> C', options);
    expect(svg).toMatch(/<g class="pele-cluster" data-id="one">/);
    expect(svg).toContain('First group');
    expect(svg.indexOf('pele-clusters')).toBeLessThan(svg.indexOf('pele-nodes'));
  });

  it('gives edges arrowheads without marker definitions', () => {
    const { svg } = render('flowchart LR\n  A --> B\n  B --- C\n  C --x D\n  D o--o E\n  E <--> F', options);
    expect(svg).not.toContain('<marker');
    expect(svg).not.toContain('<defs');
    expect(svg.match(/class="pele-marker"/g)?.length).toBe(6);
  });

  it('keeps an arrowhead apart from the edge that leaves beside it', () => {
    const { svg } = render('flowchart TD\n  A --> B\n  B --> A', options);
    const tips = [...svg.matchAll(/class="pele-marker" d="M([-\d.]+),([-\d.]+)L/g)].map((m) => [Number(m[1]), Number(m[2])]);
    const starts = [...svg.matchAll(/<g class="pele-edge"[^>]*><path d="M([-\d.]+),([-\d.]+)/g)].map((m) => [Number(m[1]), Number(m[2])]);
    expect(tips).toHaveLength(2);
    expect(starts).toHaveLength(2);
    // Each node has one edge arriving and one leaving on the side that faces the other node.
    for (const [x, y] of tips) {
      const beside = starts.find((start) => Math.abs(start[1] - y) < 1);
      expect(beside).toBeDefined();
      expect(Math.abs(beside![0] - x)).toBeGreaterThanOrEqual(12);
    }
  });

  it('ends the edges that spread along a diamond or a circle on its outline', () => {
    for (const dir of ['TD', 'LR']) {
      const { svg } = render(`flowchart ${dir}\n  D{Decide} --> A\n  D --> B\n  D --> C\n  A & B & C --> E((End))`, options);
      const at = (id: string): number[] => svg.match(new RegExp(`data-id="${id}" transform="translate\\(([-\\d.]+),([-\\d.]+)\\)"`))!.slice(1).map(Number);
      const [dx, dy] = at('D');
      const [w, h] = svg.match(/<polygon points="0,-([\d.]+) ([\d.]+),0/)!.slice(1).map((v) => Number(v) * 2).reverse();
      const [ex, ey] = at('E');
      const r = Number(svg.match(/data-id="E"[^>]*><circle r="([\d.]+)"/)![1]);
      const starts = [...svg.matchAll(/<g class="pele-edge"[^>]*><path d="M([-\d.]+),([-\d.]+)/g)].map((m) => [Number(m[1]), Number(m[2])]);
      const tips = [...svg.matchAll(/class="pele-marker" d="M([-\d.]+),([-\d.]+)L/g)].map((m) => [Number(m[1]), Number(m[2])]);
      const fromDiamond = starts.slice(0, 3);
      expect(new Set(fromDiamond.map((p) => p.join())).size, dir).toBe(3);
      for (const [x, y] of fromDiamond) expect(Math.abs(x - dx) / (w / 2) + Math.abs(y - dy) / (h / 2), dir).toBeCloseTo(1, 1);
      const intoCircle = tips.slice(3);
      expect(new Set(intoCircle.map((p) => p.join())).size, dir).toBe(3);
      for (const [x, y] of intoCircle) expect(Math.hypot(x - ex, y - ey), dir).toBeCloseTo(r, 0);
    }
  });

  it('routes a stepped flowchart at right angles, clear of its nodes', () => {
    const source = '---\nconfig:\n  flowchart:\n    curve: step\n---\nflowchart TD\n  A[Start] --> B[Parse]\n  A --> C[Measure]\n  A --> D[Theme]\n  B --> E[Fits]\n  C --> E\n  D --> E\n  E -->|Yes| F[Draw]\n  E -->|No| A';
    const { svg } = render(source, options);
    const boxes = [...svg.matchAll(/class="pele-node[^"]*" data-id="\w+" transform="translate\(([-\d.]+),([-\d.]+)\)"><rect x="([-\d.]+)" y="([-\d.]+)"/g)].map((m) => ({
      x: Number(m[1]),
      y: Number(m[2]),
      w: -2 * Number(m[3]),
      h: -2 * Number(m[4]),
    }));
    expect(boxes).toHaveLength(6);
    const paths = [...svg.matchAll(/<g class="pele-edge"[^>]*><path d="([^"]+)"/g)].map((m) => m[1]);
    expect(paths).toHaveLength(8);
    for (const d of paths) {
      // Straight runs and rounded corners only.
      expect(d).toMatch(/^M[-\d.]+,[-\d.]+(?:L[-\d.]+,[-\d.]+|Q[-\d.]+,[-\d.]+ [-\d.]+,[-\d.]+)+$/);
      const points = [...d.matchAll(/([-\d.]+),([-\d.]+)/g)].map((m) => [Number(m[1]), Number(m[2])]);
      for (const [x, y] of points.slice(1, -1)) {
        for (const box of boxes) expect(Math.abs(x - box.x) < box.w / 2 - 1 && Math.abs(y - box.y) < box.h / 2 - 1, d).toBe(false);
      }
    }
    // Arrowheads point straight along the flow: the two back corners are level.
    for (const m of svg.matchAll(/class="pele-marker" d="M[-\d.]+,[-\d.]+L[-\d.]+,([-\d.]+)L[-\d.]+,([-\d.]+)Z"/g)) expect(Number(m[1])).toBeCloseTo(Number(m[2]), 5);
  });

  it('keeps nodes in the order they are written, where the mirror image would cross no less', () => {
    const { svg } = render('flowchart TD\n  A[Christmas] -->|Get money| B(Go shopping)\n  B --> C{Let me think}\n  C -->|One| D[Laptop]\n  C -->|Two| E[iPhone]\n  C -->|Three| F[Car]\n  D --> B\n  E --> A', options);
    const x = (id: string): number => Number(svg.match(new RegExp(`data-id="${id}" transform="translate\\(([-\\d.]+),`))![1]);
    // The car goes between the two that have a way back up, and the laptop, written first, goes on the left.
    expect(x('D')).toBeLessThan(x('F'));
    expect(x('F')).toBeLessThan(x('E'));
  });

  it('brings a lone edge to the tip of a diamond, and not to wherever it would run straight', () => {
    const { svg } = render('flowchart TD\n  A[A node wide enough to reach over the diamond] --> B[Left]\n  A --> C{Decide}\n  B --> D[End]\n  C --> D', options);
    const tipX = Number(svg.match(/data-id="C" transform="translate\(([-\d.]+),/)![1]);
    const arrow = svg.match(/data-id="L_A_C_0"><path [^>]*\/><path class="pele-marker" d="M([-\d.]+),/)!;
    expect(Number(arrow[1])).toBeCloseTo(tipX, 1);
  });

  it('turns an edge in the whole height between two ranks when it passes clear of the labels between them', () => {
    const { svg } = render('flowchart TD\n  A[Christmas] -->|Get money| B(Go shopping)\n  B --> C{Let me think}\n  C -->|One| D[Laptop]\n  C -->|Two| E[iPhone]\n  C -->|Three| F[Car]\n  D --> B\n  E --> A', options);
    const back = svg.match(/data-id="L_E_A_0"><path d="([^"]+)"/)![1];
    const y = (id: string): number => Number(svg.match(new RegExp(`data-id="${id}" transform="translate\\([-\\d.]+,([-\\d.]+)\\)`))![1]);
    // The last curve of the edge back to the top starts below the label's rank, not beside the label.
    const curves = [...back.matchAll(/([-\d.]+),([-\d.]+)C[-\d.]+,[-\d.]+ [-\d.]+,[-\d.]+ [-\d.]+,([-\d.]+)/g)];
    const last = curves[curves.length - 1];
    expect(Number(last[2])).toBeGreaterThan((y('A') + y('B')) / 2 + 10);
  });

  it('keeps the branches of a decision in the order they are written when no order crosses less', () => {
    const { svg } = render('flowchart TD\n  A{Which way?} -->|The first and longest of the answers| B\n  A -->|Second| C\n  A -->|A third answer| D\n  A -->|Fourth| E\n  B -->|Back| A', options);
    const xs = ['B', 'C', 'D', 'E'].map((id) => Number(svg.match(new RegExp(`data-id="${id}" transform="translate\\(([-\\d.]+),`))![1]));
    expect(xs).toEqual([...xs].sort((a, b) => a - b));
  });

  it('labels an edge that passes a row of nodes level with that row', () => {
    const { svg } = render('flowchart TD\n  A[Start] --> B[Parse]\n  A --> C[Measure]\n  B --> E{Fits?}\n  C --> E\n  E -->|Yes| F[Draw]\n  E -->|No| A', options);
    const y = (id: string): number => Number(svg.match(new RegExp(`data-id="${id}" transform="translate\\([-\\d.]+,([-\\d.]+)\\)`))![1]);
    const label = (id: string): number => {
      const rect = svg.match(new RegExp(`class="pele-edge-label" data-id="${id}"><rect x="[-\\d.]+" y="([-\\d.]+)" width="[-\\d.]+" height="([-\\d.]+)"`))!;
      return Number(rect[1]) + Number(rect[2]) / 2;
    };
    // The edge back up to the start passes the row in the middle, and its label sits in that row.
    expect(label('L_E_A_0')).toBeCloseTo(y('B'), 1);
    // The label of an edge from one row to the next sits between the two.
    expect(label('L_E_F_0')).toBeGreaterThan(y('E'));
    expect(label('L_E_F_0')).toBeLessThan(y('F'));
  });

  it('keeps invisible links out of the drawing but in the layout', () => {
    const linked = render('flowchart LR\n  A ~~~ B', options);
    const apart = render('flowchart LR\n  A\n  B', options);
    expect(linked.svg).not.toContain('pele-edge"');
    expect(linked.width).toBeGreaterThan(apart.width - 1);
    expect(linked.height).toBeLessThan(apart.height);
  });

  it('writes accessible title and description', () => {
    const { svg } = render('flowchart TD\n  accTitle: A title\n  accDescr: A description\n  A --> B', {
      ...options,
      idPrefix: 'd1',
    });
    expect(svg).toContain('<title id="d1-title">A title</title>');
    expect(svg).toContain('<desc id="d1-desc">A description</desc>');
    expect(svg).toContain('aria-labelledby="d1-title"');
  });

  it('shrinks to its container unless told not to', () => {
    const source = 'flowchart TD\n  A --> B';
    const { svg, width, height } = render(source, options);
    expect(svg).toContain(`width="${width}" height="${height}" style="max-width:100%;height:auto;`);
    expect(render(source, { ...options, responsive: false }).svg).not.toContain('max-width');
    const fixed = '---\nconfig:\n  flowchart:\n    useMaxWidth: false\n---\n' + source;
    expect(render(fixed, options).svg).not.toContain('max-width');
    expect(render(fixed, { ...options, responsive: true }).svg).toContain('max-width:100%');
  });

  it('reads front matter and init directives', () => {
    const plain = render('flowchart TD\n  A --> B', options);
    const spaced = render('---\nconfig:\n  flowchart:\n    rankSpacing: 200\n---\nflowchart TD\n  A --> B', options);
    const directive = render('%%{init: {"flowchart": {"rankSpacing": 200}}}%%\nflowchart TD\n  A --> B', options);
    expect(spaced.height).toBeGreaterThan(plain.height + 100);
    expect(directive.height).toBe(spaced.height);
  });

  it('ignores comments', () => {
    const { svg } = render('flowchart TD\n  %% a comment\n  A --> B\n', options);
    expect(svg).not.toContain('comment');
  });
});

describe('public api', () => {
  it('detects diagram types', () => {
    expect(detectType('flowchart TD\n A')).toBe('flowchart');
    expect(detectType('  graph LR\n A')).toBe('flowchart');
    expect(detectType('%% comment\nsequenceDiagram\n A->>B: hi')).toBe('sequence');
    expect(detectType('---\ntitle: x\n---\nclassDiagram\n class A')).toBe('class');
    expect(detectType('hello')).toBe(null);
  });

  it('says what it can render', () => {
    expect(supports('flowchart TD\n A')).toBe(true);
    expect(supports('sequenceDiagram\n A->>B: hi')).toBe(true);
    expect(supports('nothing')).toBe(false);
  });

  it('throws structured errors', () => {
    const unsupported = (() => {
      try {
        render('zenuml\n A->B: hi');
      } catch (error) {
        return error as PeleError;
      }
    })();
    expect(unsupported).toBeInstanceOf(PeleError);
    expect(unsupported?.code).toBe('unsupported-diagram');
    expect(unsupported?.type).toBe(null);

    const syntax = (() => {
      try {
        render('flowchart TD\n  A --> B\n  C --> --> D\n  E');
      } catch (error) {
        return error as PeleError;
      }
    })();
    expect(syntax?.code).toBe('syntax');
    expect(syntax?.type).toBe('flowchart');
    expect(syntax?.line).toBe(3);
    expect(syntax?.message).toContain('Parse error on line 3');

    expect(() => render('flowchart TD\n  A --> B', { limit: 5 })).toThrow(/limit/);
  });

  it('parses without rendering', () => {
    const model = parse('flowchart LR\n  A[Start] --> B{Choice}');
    expect(model.type).toBe('flowchart');
    expect(model.direction).toBe('LR');
    expect([...model.nodes.keys()]).toEqual(['A', 'B']);
    expect(model.nodes.get('B')?.type).toBe('diamond');
    expect(model.edges[0]).toMatchObject({ start: 'A', end: 'B', type: 'arrow_point' });
  });

  it('renders <sub> and <sup> in labels with baseline shift and smaller text', () => {
    const { svg } = render('flowchart LR\n  A["H<sub>2</sub>O"] --> B["x<sup>2</sup>"]', options);
    expect(svg).toContain('baseline-shift="sub"');
    expect(svg).toContain('baseline-shift="super"');
    expect(svg).toMatch(/<tspan[^>]*baseline-shift="sub"[^>]*>2<\/tspan>/);
    expect(svg).toMatch(/<tspan[^>]*baseline-shift="super"[^>]*>2<\/tspan>/);
    expect(svg).not.toContain('<sub>');
    expect(svg).not.toContain('<sup>');
    expect(() => assertWellFormed(svg)).not.toThrow();
  });

  it('nesting sub/sup inside other emphasis keeps each style on its own span', () => {
    const { svg } = render('flowchart LR\n  A["<b>H<sub>2</sub>O</b>"]', options);
    expect(svg).toMatch(/<text[^>]*font-weight="var\(--_w\)"/);
    expect(svg).toMatch(/<tspan[^>]*baseline-shift="sub"[^>]*>2<\/tspan>/);
    expect(() => assertWellFormed(svg)).not.toThrow();
  });

  it('shifts text inside both <sup> and <sub> by the inner tag', () => {
    const { svg } = render('flowchart LR\n  A["x<sup>a<sub>b</sub>c</sup>"]', options);
    expect(svg).toContain('<tspan baseline-shift="super" font-size="smaller">a</tspan>');
    expect(svg).toContain('<tspan baseline-shift="sub" font-size="smaller">b</tspan>');
    expect(svg).toContain('<tspan baseline-shift="super" font-size="smaller">c</tspan>');
    expect(() => assertWellFormed(svg)).not.toThrow();
  });

  it('restores the outer <sup> when a nested <sup> closes', () => {
    const { svg } = render('flowchart LR\n  A["<sup>a<sub>b<sup>c</sup>d</sub>e</sup>"]', options);
    expect(svg).toContain('<tspan baseline-shift="sub" font-size="smaller">d</tspan><tspan baseline-shift="super" font-size="smaller">e</tspan>');
  });

  it('keeps the inner of <sup> and <sub> across a line break', () => {
    const { svg } = render('flowchart LR\n  A["<sup>a<sub>b<br/>c</sub>d</sup>"]', options);
    expect(svg).toMatch(/<tspan x="0" y="[\d.-]+" baseline-shift="sub" font-size="smaller">c<\/tspan><tspan baseline-shift="super" font-size="smaller">d<\/tspan>/);
  });

  it('shifts a label that is all subscript on its tspan', () => {
    const { svg } = render('stateDiagram-v2\n  s1\n  note right of s1 : <sub>2</sub>', options);
    expect(svg).toMatch(/<text[^>]* font-size="14"[^>]*><tspan[^>]* baseline-shift="sub" font-size="smaller">2<\/tspan><\/text>/);
    expect(() => assertWellFormed(svg)).not.toThrow();
  });
});
