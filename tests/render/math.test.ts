import { describe, expect, it } from 'vitest';
import { render, type MathMarkup } from '../../src/index.js';
import { metricsMeasurer } from '../../src/text/measurer.js';
import { assertWellFormed } from '../support/xml.js';

const options = { measurer: metricsMeasurer };

function recorder(markup: (tex: string, size: number) => MathMarkup | null = (tex) => ({ svg: `<path d="M0,0H${tex.length}"/>`, width: 30, height: 18 })) {
  const asked: [string, number][] = [];
  const math = (tex: string, size: number): MathMarkup | null => {
    asked.push([tex, size]);
    return markup(tex, size);
  };
  return { asked, math };
}

const boxes = (svg: string): string[] => svg.match(/<(?:svg|foreignObject) class="pele-math"[^>]*>/g) ?? [];

describe('math in labels', () => {
  it('leaves $$ as text without a resolver', () => {
    const { svg } = render('flowchart LR\n  A["$$x^2$$"]', options);
    expect(svg).toContain('$$x^2$$');
    expect(svg).not.toContain('pele-math');
  });

  it('draws the same as without a resolver when the resolver has nothing', () => {
    const src = 'flowchart LR\n  A["$$x^2$$ and text"] -->|"$$y$$"| B';
    const plain = render(src, options).svg;
    expect(render(src, { ...options, math: () => null }).svg).toBe(plain);
    expect(render(src, { ...options, math: () => ({ svg: '', width: NaN, height: 10 }) }).svg).toBe(plain);
    expect(render(src, { ...options, math: () => ({ svg: '', width: 10, height: -1 }) }).svg).toBe(plain);
  });

  it('gives the resolver the TeX as written and the label font size', () => {
    const { asked, math } = recorder();
    render('flowchart LR\n  A["$$a \\neq b_1 < c * d$$"] -->|"$$e^#35;$$"| B', { ...options, math });
    expect(asked).toEqual([
      ['a \\neq b_1 < c * d', 16],
      ['e^#', 14],
    ]);
  });

  it('asks once for an expression used again at the same size', () => {
    const { asked, math } = recorder();
    render('flowchart LR\n  A["$$x$$"] --> B["$$x$$"] --> C["$$x$$"]', { ...options, math });
    expect(asked).toEqual([['x', 16]]);
  });

  it('draws SVG markup in a box of the size the resolver gives', () => {
    const { math } = recorder(() => ({ svg: '<path d="M1,1H9"/>', width: 40, height: 50 }));
    const drawn = render('flowchart LR\n  A["$$\\frac{a}{b}$$"]', { ...options, math });
    const plain = render('flowchart LR\n  A["x"]', options);
    expect(boxes(drawn.svg)).toEqual(['<svg class="pele-math" x="-20" y="-25" width="40" height="50" overflow="visible">']);
    expect(drawn.svg).toContain('overflow="visible"><path d="M1,1H9"/></svg>');
    expect(drawn.svg).not.toContain('$$');
    expect(drawn.height).toBeGreaterThan(plain.height + 25);
    assertWellFormed(drawn.svg);
  });

  it('draws HTML markup in a foreignObject at the label font size', () => {
    const { math } = recorder(() => ({ html: '<span class="katex">x<br></span>', width: 20, height: 18 }));
    const { svg } = render('flowchart LR\n  A["$$x$$"]', { ...options, math });
    expect(boxes(svg)).toEqual(['<foreignObject class="pele-math" x="-10" y="-9" width="20" height="18" overflow="visible">']);
    expect(svg).toMatch(/<div xmlns="http:\/\/www.w3.org\/1999\/xhtml" style="[^"]*font-size:16px;[^"]*"><span class="katex">x<br><\/span><\/div><\/foreignObject>/);
  });

  it('sets math on the line among the text around it', () => {
    const { math } = recorder(() => ({ svg: '', width: 30, height: 40 }));
    const { svg } = render('flowchart LR\n  A["Total $$x$$ items<br/>last line"]', { ...options, math });
    const total = /<tspan x="([-\d.]+)" y="([-\d.]+)" text-anchor="start">Total <\/tspan>/.exec(svg)!;
    const items = /<tspan x="([-\d.]+)" y="([-\d.]+)" text-anchor="start"> items<\/tspan>/.exec(svg)!;
    const box = /<svg class="pele-math" x="([-\d.]+)" y="([-\d.]+)" width="30" height="40"/.exec(svg)!;
    const last = /<tspan x="0" y="([-\d.]+)">last line<\/tspan>/.exec(svg)!;
    expect(Number(items[1]) - Number(box[1])).toBe(30);
    expect(total[2]).toBe(items[2]);
    const middle = Number(box[2]) + 20;
    expect(Math.abs(Number(total[2]) - 16 * 0.35 - middle)).toBeLessThan(0.02);
    expect(Number(last[1])).toBeGreaterThan(Number(box[2]) + 40);
  });

  it('keeps an expression whole when a label wraps', () => {
    const { math } = recorder((tex) => ({ svg: '', width: tex.length * 10, height: 18 }));
    const { svg } = render('flowchart TD\n  A["some words before $$aaaaaaaaaaaaaaaaaaaaaaaaaaaaaa$$ and after it"]', {
      ...options,
      math,
      config: { flowchart: { wrappingWidth: 120 } },
    });
    expect(boxes(svg)).toHaveLength(1);
    expect(boxes(svg)[0]).toContain('width="300"');
  });

  it('draws math in sequence messages, participants and notes', () => {
    const { asked, math } = recorder();
    const { svg } = render('sequenceDiagram\n  participant A as $$\\alpha$$\n  A->>B: Solve $$x^2$$\n  Note over A: $$\\int x$$', { ...options, math });
    expect(asked.map(([tex]) => tex).sort()).toEqual(['\\alpha', '\\int x', 'x^2']);
    expect(svg).not.toContain('$$');
    assertWellFormed(svg);
  });

  it('draws math in swimlanes', () => {
    const { asked, math } = recorder();
    render('swimlane-beta LR\n  subgraph L["$$\\lambda$$"]\n    A["$$a$$"]\n  end', { ...options, math });
    expect(asked.map(([tex]) => tex).sort()).toEqual(['\\lambda', 'a']);
  });

  it('leaves other diagram types alone', () => {
    const { asked, math } = recorder();
    const src = 'pie\n  "$$x$$" : 3';
    expect(render(src, { ...options, math }).svg).toBe(render(src, options).svg);
    render('timeline\n  2020 : $$x$$', { ...options, math });
    render('gantt\n  section S\n    $$x$$ :a1, 2024-01-01, 3d', { ...options, math });
    expect(asked).toEqual([]);
  });

  it('colors math as the label text', () => {
    const { math } = recorder();
    const { svg } = render('flowchart LR\n  A["$$x$$"]\n  classDef red color:#c00\n  class A red', { ...options, math });
    expect(boxes(svg)[0]).toContain(' color="#c00"');
  });

  it('colors math in a styled lane as its title', () => {
    const { math } = recorder();
    const { svg } = render('swimlane-beta LR\n  subgraph L["$$x$$"]\n    A\n  end\n  style L color:#c00', { ...options, math });
    expect(boxes(svg)[0]).toContain(' color="#c00"');
  });

  it('draws a cluster title once, not again in its outline', () => {
    const { math } = recorder();
    const { svg } = render('flowchart LR\n  subgraph S["$$x$$"]\n    A\n  end', { ...options, math });
    expect(boxes(svg)).toHaveLength(1);
    expect(boxes(svg)[0]).toContain(' color="var(--_m)"');
  });

  it('matches each expression lazily, within one line', () => {
    const { asked, math } = recorder();
    render('flowchart LR\n  A["$$a$$ and $$b$$<br/>$$c<br/>d$$"]', { ...options, math });
    expect(asked.map(([tex]) => tex)).toEqual(['a', 'b', 'c<br/>d']);
  });

  it('keeps each expression in its place when a tag drops another', () => {
    const { math } = recorder((tex) => ({ svg: `<g id="${tex}"/>`, width: 10, height: 18 }));
    const { svg } = render('flowchart LR\n  A["<span title=$$a$$>hello</span> $$b$$ $$c$$"]', { ...options, math });
    expect(svg).not.toContain('<g id="a"/>');
    const b = /<svg class="pele-math" x="([-\d.]+)"[^>]*><g id="b"\/>/.exec(svg)!;
    const c = /<svg class="pele-math" x="([-\d.]+)"[^>]*><g id="c"\/>/.exec(svg)!;
    expect(Number(c[1])).toBeGreaterThan(Number(b[1]));
  });

  it('shows unresolved expressions as TeX among resolved ones in markdown', () => {
    const { math } = recorder((tex) => (tex === 'b' ? null : { svg: '', width: 10, height: 18 }));
    const { svg } = render('flowchart LR\n  A["`**bold** $$a_1$$ and $$b$$ *c*`"]', { ...options, math });
    expect(boxes(svg)).toHaveLength(1);
    expect(svg).toContain('$$b$$');
    expect(svg).toContain('font-weight="var(--_w)"');
    expect(svg).toContain('font-style="italic"');
  });

  it('gives math the label opacity, but not styles that would change its size', () => {
    const { math } = recorder();
    const { svg } = render('flowchart LR\n  A["Hide $$x$$"]\n  style A opacity:0,letter-spacing:6px,word-spacing:4px', { ...options, math });
    expect(boxes(svg)[0]).toContain(' opacity="0"');
    expect(boxes(svg)[0]).not.toContain('spacing');
  });

  it('draws a patch behind math in a cluster title an edge runs through', () => {
    const { math } = recorder(() => ({ svg: '<g id="title"/>', width: 200, height: 18 }));
    const { svg } = render('flowchart TD\n  X --> A\n  subgraph S["$$x$$"]\n    A\n  end', { ...options, math });
    const title = /<g class="pele-cluster-title"[^>]*>(.*?)<\/g><\/g>|<g class="pele-cluster-title"[^>]*>.*?(?=<g class="pele-node|$)/.exec(svg)?.[0] ?? '';
    expect(title).toMatch(/<rect x="[-\d.]+" y="[-\d.]+" width="200" height="18" rx="2" fill="color-mix\(/);
    expect(svg.match(/<g id="title"\/>/g)).toHaveLength(1);
  });

  it('is not confused by a render inside the resolver', () => {
    const icons = (name: string): string => `<path data-name="${name}"/>`;
    const math = (tex: string): MathMarkup => {
      render('flowchart LR\n  B["fa:fa-star <b></b> $$y$$"]', { ...options, icons });
      return { svg: `<g id="${tex}"/>`, width: 10, height: 18 };
    };
    const { svg } = render('flowchart LR\n  A["$$x$$ fa:fa-car"]', { ...options, icons, math });
    expect(svg.match(/data-icon="fa:fa-car"/g)).toHaveLength(1);
    expect(svg).not.toContain('fa-star');
    expect(svg).toContain('<g id="x"/>');
  });

  it('recovers when the resolver throws', () => {
    const src = 'flowchart LR\n  A["$$x$$"]';
    expect(() => render(src, { ...options, math: () => { throw new Error('no'); } })).toThrow('no');
    expect(render('flowchart LR\n  A["<b></b>"]', options).svg).toContain('');
    expect(boxes(render(src, { ...options, math: recorder().math }).svg)).toHaveLength(1);
  });

  it('makes room for tall math in a sequence message that breaks', () => {
    const tall = recorder(() => ({ svg: '', width: 40, height: 60 }));
    const short = recorder(() => ({ svg: '', width: 40, height: 10 }));
    const src = 'sequenceDiagram\n  A->>B: averyveryverylongwordthatmustbreak $$x$$ more\n  B->>A: ok';
    const narrow = { ...options, maxWidth: 220 };
    expect(render(src, { ...narrow, math: tall.math }).height - render(src, { ...narrow, math: short.math }).height).toBeGreaterThanOrEqual(40);
  });
});

const COVERAGE: [string, string, string[]][] = [
  [
    'state',
    'stateDiagram-v2\n  state "$$a$$" as s1\n  s1 : $$b$$\n  [*] --> s1 : $$c$$\n  note right of s1 : $$d$$\n  state "$$e$$" as C {\n    x --> y\n  }',
    ['a', 'b', 'c', 'd', 'e'],
  ],
  ['class', 'classDiagram\n  class A {\n    <<$$a$$>>\n  }\n  note for A "$$b$$"\n  A "$$c$$" --> "1" B : $$d$$\n  class C["$$e$$"]', ['a', 'b', 'c', 'd', 'e']],
  ['er', 'erDiagram\n  p["$$a$$"] {\n    string name "$$b$$"\n  }\n  p ||--o{ q : "$$c$$"', ['a', 'b', 'c']],
  ['mindmap', 'mindmap\n  root(("$$a$$"))\n    $$b$$', ['a', 'b']],
  ['kanban', 'kanban\n  todo["$$a$$"]\n    t1["$$b$$"]', ['a', 'b']],
  ['block', 'block-beta\n  a["$$a$$"] b["$$b$$"]\n  a -- "$$c$$" --> b', ['a', 'b', 'c']],
  [
    'requirement',
    'requirementDiagram\n  requirement "$$a$$" {\n    id: "$$b$$"\n    text: "$$c$$"\n  }\n  element e1 {\n    type: "$$d$$"\n    docref: "$$e$$"\n  }',
    ['a', 'b', 'c', 'd', 'e'],
  ],
  ['usecase', 'usecase-beta\n  actor C("$$a$$")\n  systemBoundary "$$b$$"\n    U("$$c$$")\n  end\n  C --> U', ['a', 'b', 'c']],
];

describe('math in other diagram types', () => {
  for (const [type, src, expected] of COVERAGE) {
    it(`typesets the labels Mermaid typesets in ${type} diagrams`, () => {
      const { asked, math } = recorder();
      const { svg } = render(src, { ...options, math });
      expect([...new Set(asked.map(([tex]) => tex))].sort()).toEqual(expected);
      // Ignore attributes: IDs retain the TeX source.
      expect(svg.replace(/"[^"]*"/g, '""')).not.toContain('$$');
      assertWellFormed(svg);
    });
  }

  it('leaves class members as text, as Mermaid does', () => {
    const { asked, math } = recorder();
    const { svg } = render('classDiagram\n  class A {\n    +$$m$$ int\n  }\n  A : $$n$$ text', { ...options, math });
    expect(asked).toEqual([]);
    expect(svg).toContain('$$m$$ int');
    expect(svg).toContain('$$n$$ text');
  });

  it('leaves titles as text, as Mermaid does', () => {
    for (const body of ['flowchart LR\n  A', 'sequenceDiagram\n  A->>B: hi', 'stateDiagram-v2\n  [*] --> s1', 'erDiagram\n  A ||--o{ B : has', 'kanban\n  todo[Todo]', 'mindmap\n  root']) {
      const { asked, math } = recorder();
      const { svg } = render(`---\ntitle: $$t$$\n---\n${body}`, { ...options, math });
      expect(asked, body).toEqual([]);
      expect(svg, body).toContain('$$t$$');
    }
  });

  const TALL: [string, string][] = [
    ['er', 'erDiagram\n  p {\n    string name "$$t$$<br/>after"\n  }'],
    ['mindmap', 'mindmap\n  root\n    child["$$t$$<br/>after"]'],
    ['kanban', 'kanban\n  todo[Todo]\n    t1["$$t$$<br/>after"]'],
    ['requirement', 'requirementDiagram\n  requirement r1 {\n    id: 1\n    text: "$$t$$<br/>after"\n  }'],
    ['usecase', 'usecase-beta\n  actor C("C")\n  U("`$$t$$\nafter`")\n  C --> U'],
    ['state', 'stateDiagram-v2\n  s1 : $$t$$<br/>after'],
    ['class', 'classDiagram\n  class A\n  note for A "$$t$$<br/>after"'],
  ];
  for (const [type, src] of TALL) {
    it(`puts the line after tall math below it in ${type} diagrams`, () => {
      const { math } = recorder(() => ({ svg: '', width: 30, height: 60 }));
      const { svg } = render(src, { ...options, math });
      const box = /<svg class="pele-math" x="[-\d.]+" y="([-\d.]+)" width="30" height="60"/.exec(svg);
      const after = /y="([-\d.]+)"[^>]*>after</.exec(svg);
      expect(box, type).not.toBeNull();
      expect(after, type).not.toBeNull();
      expect(Number(after![1]), type).toBeGreaterThan(Number(box![1]) + 60);
    });
  }

  const spans = (svg: string): [number, number, number, number][] =>
    [...svg.matchAll(/<svg class="pele-math" x="([-\d.]+)" y="([-\d.]+)" width="([\d.]+)" height="([\d.]+)"/g)].map(
      (m) => [Number(m[1]), Number(m[2]), Number(m[3]), Number(m[4])]
    );

  it('makes room between classes for tall cardinalities at both ends of an edge', () => {
    const { math } = recorder(() => ({ svg: '', width: 20, height: 40 }));
    const { svg } = render('classDiagram\n  A "$$x$$" --> "$$y$$" B', { ...options, math });
    const [first, second] = spans(svg).sort((a, b) => a[1] - b[1]);
    expect(first[1] + first[3]).toBeLessThanOrEqual(second[1]);
  });

  it('gives a JSON row in a use case diagram the height of its key', () => {
    const { math } = recorder(() => ({ svg: '', width: 20, height: 40 }));
    const { svg } = render('usecase-beta\n  json Payload@{"$$x$$":1,"other":2}', { ...options, math });
    const [key] = spans(svg);
    const other = /y="([-\d.]+)"[^>]*>other</.exec(svg)!;
    expect(Number(other[1]) - 14 * 0.35 - 14 * 0.75).toBeGreaterThanOrEqual(key[1] + key[3]);
  });

  it('widens kanban columns to hold math that cannot wrap', () => {
    const { math } = recorder(() => ({ svg: '', width: 300, height: 30 }));
    const { svg } = render('kanban\n  todo[Todo]\n    a["$$x$$"]\n  done[Done]\n    b[Other]', { ...options, math });
    const card = /<rect width="([\d.]+)" height="[\d.]+" fill="var\(--_bg\)"/.exec(svg)!;
    const [box] = spans(svg);
    expect(box[0] + box[2]).toBeLessThanOrEqual(Number(card[1]));
    expect(render('kanban\n  todo[Todo]\n    a[plain]', options).svg).toContain('<rect width="184"');
    const narrow = render('kanban\n  todo[Todo]\n    a["$$x$$"]\n  done[Done]\n    b[Other]', { ...options, math, maxWidth: 240 }).svg;
    const narrowCard = /<rect width="([\d.]+)" height="[\d.]+" fill="var\(--_bg\)"/.exec(narrow)!;
    expect(spans(narrow)[0][0] + spans(narrow)[0][2]).toBeLessThanOrEqual(Number(narrowCard[1]));
  });
});
