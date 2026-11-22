import { readFileSync, readdirSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { PeleError, detectType, parse, render, supports, type AgentflowModel } from '../../src/index.js';
import { metricsMeasurer } from '../../src/text/measurer.js';
import { loadCorpus } from '../support/corpus.js';
import { assertWellFormed } from '../support/xml.js';

const fixtures = readdirSync('tests/compat/agentflow/upstream')
  .filter((name) => name.endsWith('.mmd'))
  .map((name) => readFileSync(`tests/compat/agentflow/upstream/${name}`, 'utf8'));
const corpus = [...new Set([...loadCorpus('agentflow', /agentflow-beta/), ...fixtures])];
const options = { measurer: metricsMeasurer };

function tryRender(src: string): string | undefined {
  try {
    return render(src, options).svg;
  } catch (error) {
    if (error instanceof PeleError) return undefined;
    throw error;
  }
}

const svgOf = (src: string): string => render(src, options).svg;
const count = (svg: string, needle: string): number => svg.split(needle).length - 1;
const modelOf = (src: string): AgentflowModel => parse(src) as AgentflowModel;
const series = (n: number): string => `var(--pele-series-${n},`;

// The group drawn for a node, with its class list and position.
function node(svg: string, id: string): { classes: string; x: number; y: number; body: string } {
  const m = new RegExp(
    `<g class="(pele-node[^"]*)" data-id="${id}" transform="translate\\(([-\\d.]+),([-\\d.]+)\\)">(.*?)</g>`
  ).exec(svg);
  if (!m) throw new Error(`no node ${id}`);
  return { classes: m[1], x: Number(m[2]), y: Number(m[3]), body: m[4] };
}

// The frame drawn for an open flow.
function frame(svg: string, id: string): { x: number; y: number; w: number; h: number; rect: string } {
  const m = new RegExp(
    `<g class="pele-cluster pele-flow[^"]*" data-id="${id}">(<rect x="([-\\d.]+)" y="([-\\d.]+)" width="([\\d.]+)" height="([\\d.]+)"[^>]*/>)`
  ).exec(svg);
  if (!m) throw new Error(`no flow ${id}`);
  return { x: Number(m[2]), y: Number(m[3]), w: Number(m[4]), h: Number(m[5]), rect: m[1] };
}

function edges(svg: string): { classes: string; id: string; body: string }[] {
  return [...svg.matchAll(/<g class="(pele-edge [^"]*)" data-id="([^"]*)"[^>]*>(.*?)<\/g>/g)].map((m) => ({
    classes: m[1],
    id: m[2],
    body: m[3],
  }));
}

const inside = (n: { x: number; y: number }, f: { x: number; y: number; w: number; h: number }): boolean =>
  n.x > f.x && n.x < f.x + f.w && n.y > f.y && n.y < f.y + f.h;

describe('agentflow rendering', () => {
  it('renders every corpus input that parses, as well-formed SVG', () => {
    let rendered = 0;
    for (const src of corpus) {
      const svg = tryRender(src);
      if (svg === undefined) continue;
      rendered++;
      const where = JSON.stringify(src).slice(0, 120);
      expect(() => assertWellFormed(svg), where).not.toThrow();
      expect(svg, where).not.toMatch(/<script|<style|<foreignObject|<defs|<marker|\son\w+=|javascript:/i);
      expect(svg, where).not.toContain('NaN');
      expect(svg, where).not.toContain('undefined');
      expect(tryRender(src), where).toBe(svg);
    }
    expect(rendered).toBeGreaterThan(150);
  });

  it('is detected, supported and typed', () => {
    const src = 'agentflow-beta TB\n  a["A"] --> b["B"]';
    expect(detectType(src)).toBe('agentflow');
    expect(supports(src)).toBe(true);
    const result = render(src, options);
    expect(result.type).toBe('agentflow');
    expect(result.svg).toMatch(/^<svg xmlns="http:\/\/www\.w3\.org\/2000\/svg" class="pele pele-agentflow"/);
    expect(result.svg).toContain(`viewBox="0 0 ${result.width} ${result.height}"`);
    const model = parse(src);
    expect(model.type).toBe('agentflow');
    if (model.type === 'agentflow') expect([...model.nodes.keys()]).toEqual(['a', 'b']);
  });

  it('lays out along the declared direction', () => {
    const tall = render('agentflow-beta TB\n  a --> b --> c', options);
    const wide = render('agentflow-beta LR\n  a --> b --> c', options);
    expect(tall.height).toBeGreaterThan(tall.width);
    expect(wide.width).toBeGreaterThan(wide.height);
    const up = svgOf('agentflow-beta BT\n  a --> b');
    expect(node(up, 'a').y).toBeGreaterThan(node(up, 'b').y);
    const back = svgOf('agentflow-beta RL\n  a --> b');
    expect(node(back, 'a').x).toBeGreaterThan(node(back, 'b').x);
    const none = svgOf('agentflow-beta\n  a --> b');
    expect(node(none, 'b').y).toBeGreaterThan(node(none, 'a').y);
  });

  it('draws each of the six shapes, and a connector, in the color of its kind', () => {
    const svg = svgOf(
      'agentflow-beta LR\n  t["T"]@{ shape: task }\n  o["O"]@{ shape: tool }\n  i["I"]@{ shape: input }\n  d["D"]@{ shape: decision }\n  r["R"]@{ shape: refdoc }\n  c["C"]@{ shape: action }\n  connector k["K"]\n  plain'
    );
    const expected: [string, string, string, number][] = [
      ['o', 'fr-rect', 'tool', 1],
      ['t', 'rounded', 'task', 2],
      ['plain', 'rounded', 'task', 2],
      ['d', 'diam', 'decision', 3],
      ['i', 'lean-r', 'input', 4],
      ['r', 'lin-doc', 'refdoc', 5],
      ['k', 'rounded', 'connector', 6],
      ['c', 'hex', 'action', 7],
    ];
    for (const [id, shape, kind, slot] of expected) {
      const n = node(svg, id);
      expect(n.classes, id).toBe(`pele-node pele-shape-${shape} pele-kind-${kind}`);
      expect(n.body, id).toContain(`fill="${series(slot)}`);
      expect(n.body, id).toContain(`stroke="${series(slot)}`);
      expect(n.body, id).toContain('fill-opacity="0.14"');
    }
    expect(node(svg, 'd').body).toContain('<polygon');
    expect(node(svg, 'o').body).toMatch(/<rect[^>]*\/><path/);
  });

  it('writes the bracket shapes agentflow removed as plain tasks and reports them', () => {
    const src = 'agentflow-beta TB\n  a((circle)) --> b([stadium]) --> c[(db)] --> d>odd] --> e(round)';
    const svg = svgOf(src);
    for (const id of ['a', 'b', 'c', 'd', 'e']) expect(node(svg, id).classes).toBe('pele-node pele-shape-rounded pele-kind-task');
    const model = modelOf(src);
    expect(model.diagnostics.map((d) => [d.id, d.severity, d.nodeId])).toEqual([
      ['SHAPE_REMOVED', 'error', 'a'],
      ['SHAPE_REMOVED', 'error', 'b'],
      ['SHAPE_REMOVED', 'error', 'c'],
      ['SHAPE_REMOVED', 'error', 'd'],
    ]);
    expect(model.diagnostics[0].message).toBe('shape "circle" was removed in v0.8.1, using "roundedRect"');
    expect(model.diagnostics[0].position).toMatchObject({ startLine: 2, startColumn: 2, endLine: 2 });
  });

  it('warns about a shape outside the catalogue and still draws the node', () => {
    const src = 'agentflow-beta TB\n  a["A"]\n  a@{ shape: "triangle" }\n  a --> b';
    const model = modelOf(src);
    expect(model.diagnostics).toEqual([
      {
        id: 'SHAPE_UNSUPPORTED',
        severity: 'warning',
        message: 'shape "triangle" is not supported, using "roundedRect"',
        nodeId: 'a',
        position: { startLine: 2, startColumn: 2, endLine: 2, endColumn: 8, startIndex: 0, endIndex: 0 },
      },
    ]);
    expect(node(svgOf(src), 'a').classes).toContain('pele-shape-rounded');
    // Rendering the same model again does not report it twice.
    render(src, options);
    expect(modelOf(src).diagnostics).toHaveLength(1);
  });

  it('draws the three edge kinds differently', () => {
    const svg = svgOf('agentflow-beta TB\n  a --> b\n  a --x c\n  a -.- d\n  a -- "why" --> e');
    const all = edges(svg);
    expect(all.map((e) => e.classes)).toEqual([
      'pele-edge pele-edge-sequence',
      'pele-edge pele-edge-failure',
      'pele-edge pele-edge-reference',
      'pele-edge pele-edge-sequence',
    ]);
    // An arrowhead, a cross, and a dotted line with nothing on its end.
    expect(all[0].body).toMatch(/<path d="[^"]+"\/><path class="pele-marker" d="[^"]+Z" fill=/);
    expect(all[1].body).toMatch(/<path d="[^"]+"\/><path class="pele-marker" d="M[^Z"]+"\/>$/);
    expect(all[2].body).toMatch(/^<path d="[^"]+" stroke-dasharray="3 4"\/>$/);
    expect(svg).toContain('<g class="pele-edge-label" data-id="L_a_e_0">');
    expect(svg).toContain('>why</text>');
  });

  it('fans an edge out over every pair that an ampersand names', () => {
    const svg = svgOf('agentflow-beta TB\n  a & b --> c & d');
    expect(edges(svg).map((e) => e.id)).toEqual(['L_a_c_0', 'L_a_d_0', 'L_b_c_0', 'L_b_d_0']);
  });

  it('draws a self-loop beside its node', () => {
    const svg = svgOf('agentflow-beta TB\n  a["Alpha"]\n  a --> a');
    const all = edges(svg);
    expect(all).toHaveLength(1);
    expect(all[0].body).toMatch(/<path d="M[-\d.]+,[-\d.]+C/);
  });

  it('leaves no empty band above a row whose self-loop label hangs below it (#119)', () => {
    const tall = render(
      'agentflow-beta LR\n  a["Alpha"]\n  a -- "line one<br/>line two<br/>line three<br/>line four" --> a\n  a --> b["Beta"]',
      options,
    );
    const plain = render('agentflow-beta LR\n  a["Alpha"]\n  a --> b["Beta"]', options);
    // The loop and its label hang below the node, so the row sits at the top exactly
    // where it sits without the loop.
    expect(node(tall.svg, 'a').y).toBeCloseTo(node(plain.svg, 'a').y, 0);
    expect(node(tall.svg, 'b').y).toBeCloseTo(node(tall.svg, 'a').y, 0);
    expect(tall.height).toBeLessThan(plain.height + 140);
    expect(tall.height).toBeGreaterThan(plain.height + 50);
    const label = [...tall.svg.matchAll(/<g class="pele-edge-label"[^>]*><rect x="[\d.]+" y="([\d.]+)" width="[\d.]+" height="([\d.]+)"/g)][0];
    expect(Number(label[1]) + Number(label[2])).toBeLessThanOrEqual(tall.height - 4);
  });

  it('frames a flow around its members, with its title', () => {
    const svg = svgOf('agentflow-beta TB\n  flow team["Content Team"]\n    a["A"] --> b["B"]\n  end\n  c["C"]\n  b --> c');
    const team = frame(svg, 'team');
    expect(inside(node(svg, 'a'), team)).toBe(true);
    expect(inside(node(svg, 'b'), team)).toBe(true);
    expect(inside(node(svg, 'c'), team)).toBe(false);
    expect(svg).toMatch(/<text class="pele-cluster-label"[^>]*>Content Team<\/text>/);
    expect(team.rect).toContain(`stroke="${series(8)}`);
    expect(team.rect).toContain('fill-opacity="0.06"');
  });

  it('nests flows, and gives a flow without a bracketed title no title', () => {
    const svg = svgOf('agentflow-beta TB\n  flow outer["Outer"]\n    flow inner\n      a --> b\n    end\n    c\n  end');
    const outer = frame(svg, 'outer');
    const inner = frame(svg, 'inner');
    expect(inner.x).toBeGreaterThan(outer.x);
    expect(inner.y).toBeGreaterThan(outer.y);
    expect(inner.x + inner.w).toBeLessThan(outer.x + outer.w);
    expect(inner.y + inner.h).toBeLessThan(outer.y + outer.h);
    expect(inside(node(svg, 'a'), inner)).toBe(true);
    expect(inside(node(svg, 'c'), inner)).toBe(false);
    expect(inside(node(svg, 'c'), outer)).toBe(true);
    expect(count(svg, 'class="pele-cluster-label"')).toBe(1);
  });

  it('lays a flow out in its own direction', () => {
    const svg = svgOf('agentflow-beta TB\n  flow f["F"]\n    direction LR\n    a --> b\n  end\n  f --> c');
    expect(node(svg, 'b').x).toBeGreaterThan(node(svg, 'a').x);
    expect(Math.abs(node(svg, 'a').y - node(svg, 'b').y)).toBeLessThan(1);
    expect(node(svg, 'c').y).toBeGreaterThan(node(svg, 'b').y);
  });

  it("ignores a flow's direction when its nodes link outside it", () => {
    const flows = 'agentflow-beta LR\nflow S\n direction TB\n s1\n s2\nend\nflow P\n direction TB\n p1\n p2\nend\n';
    const links = 's1 --> p2\ns2 --> p1\n';
    expect(svgOf(flows + links)).toBe(svgOf(flows.replace(/ direction TB\n/g, '') + links));
  });

  it('keeps a global node out of the flows that mention it', () => {
    const src = 'agentflow-beta TB\n  global\n    corpus["Shared"]@{ shape: refdoc }\n  end\n  flow one["One"]\n    a -.- corpus\n  end\n  flow two["Two"]\n    b -.- corpus\n  end';
    const svg = svgOf(src);
    const corpusNode = node(svg, 'corpus');
    expect(inside(corpusNode, frame(svg, 'one'))).toBe(false);
    expect(inside(corpusNode, frame(svg, 'two'))).toBe(false);
    expect(count(svg, 'pele-cluster pele-flow')).toBe(2);
    expect(modelOf(src).subgraphs.map((s) => s.nodes)).toEqual([['a'], ['b']]);
  });

  it('folds a collapsed flow into one node and reconnects its edges', () => {
    const src = 'agentflow-beta TB\n  in["In"] --> v\n  flow p["Processing"]\n    v["Validate"] --> e["Enrich"]\n  end\n  p@{ view: "collapsed" }\n  e --> out["Out"]';
    const svg = svgOf(src);
    const p = node(svg, 'p');
    expect(p.classes).toBe('pele-node pele-shape-collapsed');
    expect(p.body).toContain('>Processing</text>');
    expect(p.body).toContain('class="pele-collapsed-mark"');
    expect(p.body).toContain(`stroke="${series(8)}`);
    expect(svg).not.toContain('data-id="v"');
    expect(svg).not.toContain('pele-cluster');
    // The edge inside the flow is gone; the two that crossed its border end at the node.
    expect(edges(svg).map((e) => e.id)).toEqual(['L_in_v_0', 'L_e_out_0']);
    expect(node(svg, 'p').y).toBeGreaterThan(node(svg, 'in').y);
    expect(node(svg, 'out').y).toBeGreaterThan(node(svg, 'p').y);
  });

  it('numbers containers in the order they were written', () => {
    // With Mermaid's twelve colors the three would differ; with eight series tokens and seven
    // kinds there is one slot left for containers, which every one of them takes.
    const svg = svgOf('agentflow-beta TB\n  flow one\n    flow two\n      a\n    end\n  end\n  flow three\n    b\n  end\n  three@{ view: collapsed }');
    expect(frame(svg, 'one').rect).toContain(`stroke="${series(8)}`);
    expect(frame(svg, 'two').rect).toContain(`stroke="${series(8)}`);
    expect(node(svg, 'three').body).toContain(`stroke="${series(8)}`);
  });

  it('draws a container that two flows fight over once, and reports the dropped nesting', () => {
    const src = 'agentflow-beta TB\n  flow A["Flow A"]\n    a1 --> B\n  end\n  flow B["Flow B"]\n    b1 --> A\n  end';
    const svg = svgOf(src);
    expect(count(svg, 'data-id="A"')).toBe(1);
    expect(count(svg, 'data-id="B"')).toBe(1);
    const diagnostics = modelOf(src).diagnostics;
    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0]).toMatchObject({ id: 'CONTAINMENT_VIOLATION', severity: 'warning', nodeId: 'B' });
    expect(diagnostics[0].message).toBe(
      'Container "A" cannot contain "B" because "B" already contains it. The nesting that would close the loop is dropped.'
    );
  });

  it('runs an edge between a node and its own flow to the border of the flow', () => {
    const ends = (d: string): number[] => d.match(/-?\d+(?:\.\d+)?/g)!.map(Number);
    const svg = svgOf('agentflow-beta TB\n  flow f["My Flow"]\n    a["Task A"] --> b["Task B"]\n    b --> f\n    f --> a\n  end');
    const f = frame(svg, 'f');
    const [out, back] = edges(svg).slice(1).map((e) => ends(/<path d="([^"]+)"/.exec(e.body)![1]));
    // Out of the last task, down to the bottom border; in from the top border to the first task.
    expect(out[0]).toBe(node(svg, 'b').x);
    expect(out[1]).toBe(node(svg, 'b').y + 24);
    expect(out[3]).toBeGreaterThan(out[1]);
    expect(out[3]).toBeLessThan(f.y + f.h);
    expect(back[1]).toBe(f.y);
    expect(back[3]).toBeLessThan(node(svg, 'a').y - 24);
    // Sideways when another node stands in the way.
    const blocked = svgOf('agentflow-beta TB\n  flow f["My Flow"]\n    a["Task A"] --> b["Task B"]\n    a --> f\n  end');
    const side = ends(/<path d="([^"]+)"/.exec(edges(blocked)[1].body)![1]);
    expect(side[1]).toBe(node(blocked, 'a').y);
    expect(side[3]).toBe(side[1]);
    expect(side[2]).toBeLessThan(side[0]);
  });

  it('draws a front matter title above the diagram', () => {
    const plain = render('agentflow-beta TB\n  a --> b', options);
    const titled = render('---\ntitle: Release pipeline\n---\nagentflow-beta TB\n  a --> b', options);
    expect(titled.svg).toMatch(/<text class="pele-title" font-weight="var\(--_tw\)"[^>]*>(?:<tspan[^>]*>)?Release pipeline</);
    expect(titled.height).toBeGreaterThan(plain.height);
  });

  it('writes the accessible title and description', () => {
    const svg = svgOf('agentflow-beta TB\n  accTitle: Review flow\n  accDescr: How a change is reviewed\n  a --> b');
    expect(svg).toContain('<title id="pele-title">Review flow</title>');
    expect(svg).toContain('<desc id="pele-desc">How a change is reviewed</desc>');
  });

  it('applies classes, styles and link styles', () => {
    const svg = svgOf(
      'agentflow-beta TB\n  classDef hot fill:#fdd,stroke:#c00,color:#900\n  a["A"]:::hot --> b["B"]\n  style b stroke-width:3px\n  linkStyle 0 stroke:#0a0'
    );
    const a = node(svg, 'a');
    expect(a.classes).toBe('pele-node pele-shape-rounded pele-kind-task hot');
    expect(a.body).toContain('style="fill:#fdd;stroke:#c00;"');
    // A fill the author chose is not washed out.
    expect(a.body).not.toContain('fill-opacity');
    expect(a.body).toContain('style="fill:#900;"');
    expect(node(svg, 'b').body).toContain('fill-opacity="0.14"');
    expect(node(svg, 'b').body).toContain('style="stroke-width:3px;"');
    expect(svg).toMatch(/<g class="pele-edge pele-edge-sequence" data-id="L_a_b_0" style="stroke:#0a0;">/);
  });

  it('picks a contrasting label color on fills a style sets', () => {
    const svg = svgOf(
      'agentflow-beta TB\n  flow f["Flow"]\n    a["A"] --> b["B"]\n  end\n  flow p["Packed"]\n    c["C"]\n  end\n  p@{ view: "collapsed" }\n  b --> d["D"]\n  style f fill:#FFF9C4\n  style a fill:#1f3a5f\n  style b fill:#1f3a5f,color:#eee\n  style p fill:navy'
    );
    expect(svg).toMatch(/data-id="f">.*?<text class="pele-cluster-label" fill="var\(--pele-fg-on-light,#1f1f1f\)"/);
    expect(node(svg, 'a').body).toContain('<text class="pele-label" fill="var(--pele-fg-on-dark,#fff)"');
    expect(node(svg, 'b').body).not.toContain('--pele-fg-on');
    expect(node(svg, 'p').body).toContain('<text class="pele-label" fill="var(--pele-fg-on-dark,#fff)"');
    expect(node(svg, 'd').body).not.toContain('--pele-fg-on');
  });

  it('cases edges that cross a flow fill a style sets and inks those inside it', () => {
    const src = 'agentflow-beta TB\n  flow f["Flow"]\n    a["A"] --> b["B"]\n  end\n  b --> c["C"]\n  c --> d["D"]\n  style f fill:#FFF9C4';
    const svg = svgOf(src);
    const casings = /<g class="pele-casings"[^>]*>(.*?)<\/g>/.exec(svg)![1];
    const edges = [...svg.matchAll(/class="pele-edge [^"]*" data-id="[^"]+"([^>]*)><path d="([^"]+)"/g)].map((m) => [m[1], m[2]]);
    expect(edges).toHaveLength(3);
    expect(edges.map(([, d]) => casings.includes(`<path d="${d}"/>`))).toEqual([false, true, false]);
    expect(edges.map(([attrs]) => attrs)).toEqual([' stroke="var(--pele-fg-on-light,#1f1f1f)"', '', '']);
    expect(svgOf(src.replace('\n  style f fill:#FFF9C4', ''))).not.toMatch(/pele-casings|stroke="var\(--pele-fg-on/);
    // An edge from a flow to a node inside it starts on the flow's border and stays on its fill.
    const held = svgOf('agentflow-beta TB\n  flow f[Flow]\n    a[A]\n  end\n  f --> a\n  style f fill:white');
    expect(held).toMatch(/data-id="L_f_a_0" stroke="var\(--pele-fg-on-light,#1f1f1f\)"/);
    expect(held).not.toContain('pele-casings');
  });

  it('links a clicked node and never writes a callback', () => {
    const { svg, links } = render(
      'agentflow-beta TB\n  a --> b\n  click a href "https://example.com/x" "Open it" _blank\n  click b call doIt()',
      options
    );
    expect(node(svg, 'a').body).toMatch(/^<a href="https:\/\/example\.com\/x" target="_blank" rel="noopener"><title>Open it<\/title>/);
    expect(links).toEqual([{ id: 'a', href: 'https://example.com/x', internal: false }]);
    expect(node(svg, 'b').classes).toContain('clickable');
    expect(svg).not.toContain('doIt');
  });

  it('wraps long labels and honors spacing options', () => {
    const long = svgOf('agentflow-beta TB\n  a["A fairly long label that has to wrap over several lines to fit"]');
    expect(count(node(long, 'a').body, '<tspan')).toBeGreaterThan(1);
    const src = 'agentflow-beta TB\n  a --> b';
    const wide = '---\nconfig:\n  agentflow:\n    rankSpacing: 150\n---\n' + src;
    expect(render(wide, options).height).toBeGreaterThan(render(src, options).height + 80);
  });

  it('gives nodes with short labels a common width, except a decision', () => {
    const width = (svg: string, id: string): number => Number(/<rect[^>]* width="([\d.]+)"/.exec(node(svg, id).body)![1]);
    const src = 'agentflow-beta TB\n  a["A"] --> b["Beta"]@{ shape: tool }\n  b --> d{"ok?"}';
    const svg = svgOf(src);
    expect(width(svg, 'a')).toBe(156);
    expect(width(svg, 'b')).toBeGreaterThan(156);
    expect(width(svg, 'b')).toBeLessThan(180);
    const points = /points="([^"]+)"/.exec(node(svg, 'd').body)![1].split(/[ ,]/).map(Number);
    expect(Math.max(...points.filter((_, i) => i % 2 === 0)) * 2).toBeLessThan(156);
    const narrow = svgOf('---\nconfig:\n  agentflow:\n    minNodeWidth: 10\n---\n' + src);
    expect(width(narrow, 'a')).toBeLessThan(60);
  });

  it('reads metadata without drawing it', () => {
    const src = 'agentflow-beta TB\n  a["A"]@{ shape: tool, params: "city :: String", retry: 2 }\n  a e1@--> b\n  e1@{ instruction: "hand off" }';
    const svg = svgOf(src);
    expect(svg).not.toContain('String');
    expect(svg).not.toContain('hand off');
    const model = modelOf(src);
    expect(model.nodes.get('a')?.metadata).toEqual({ shape: 'subroutine', params: 'city :: String', retry: 2 });
    expect(model.edges[0].metadata).toEqual({ instruction: 'hand off' });
    expect(model.semanticModel().vertices[0]).toEqual({
      id: 'a',
      label: 'A',
      shape: 'subroutine',
      vertexKind: 'tool',
      metadata: { params: 'city :: String', retry: 2 },
    });
  });

  it('skips an edge to the id Mermaid reserves and creates no node for', () => {
    const svg = svgOf('agentflow-beta TB\n  connectors["Mine"] --> b');
    expect(svg).not.toContain('data-id="connectors"');
    expect(edges(svg)).toHaveLength(0);
    expect(node(svg, 'b').classes).toContain('pele-kind-task');
  });

  it('reports positions in the lines of the original source', () => {
    // Front matter fills lines 1 to 5 and a comment line 7, so `alpha` is on line 8.
    const src = '---\nconfig:\n  agentflow:\n    nodeSpacing: 40\n---\nagentflow-beta TB\n  %% a comment that occupies a line\n  alpha["Alpha"]\n  beta["Beta"]\n  alpha --> beta';
    const model = modelOf(src);
    const alpha = model.mappings.find((m) => m.id === 'alpha');
    expect(alpha).toEqual({
      id: 'alpha',
      type: 'vertex',
      position: { startLine: 8, startColumn: 2, endLine: 8, endColumn: 16, startIndex: 0, endIndex: 0 },
    });
    expect(model.mappings.find((m) => m.type === 'edge')?.position).toMatchObject({ startLine: 10, endLine: 10 });
    expect(render(src, options).svg).toContain('data-id="alpha"');
    expect(() => render('---\ntitle: T\n---\nagentflow-beta TB\n  a@{ shape: rounded }  \n  b -.-> c', options)).toThrow(
      expect.objectContaining({ line: 6, column: 8 })
    );
    const metadata = '%%{init:\n{}\n}%%\nagentflow-beta\na["#35;"] --> b@{shape: ';
    expect(() => parse(metadata + 'bad}')).toThrow(expect.objectContaining({ code: 'semantic', line: 5, column: 16 }));
    expect(() => parse(metadata + '[bad}')).toThrow(expect.objectContaining({ code: 'syntax', line: 5, column: 16, message: expect.stringMatching(/\(5:16\)$/) }));
  });

  it('maps a flow from its keyword to its end, and a metadata block as an attachment', () => {
    const model = modelOf('agentflow-beta TB\n  flow f["F"]\n    a["A"]\n  end\n  f@{ view: collapsed }\n  connector k["K"]');
    expect(model.mappings.map((m) => [m.id, m.type, m.position.startLine, m.position.endLine])).toEqual([
      ['a', 'vertex', 3, 3],
      ['f', 'subgraph', 2, 4],
      ['f', 'attachment', 5, 5],
      // A connector's span runs through the line break that ends it, as in Mermaid.
      ['k', 'connector', 6, 7],
    ]);
  });

  it('reads comments wherever Mermaid does', () => {
    const src = '%% before the keyword\nagentflow-beta TB %% after the direction\n  a[Plain %% not part of the label\nlabel] --> b %% after a statement\n  %% a line of its own\n  b --> c';
    const model = modelOf(src);
    expect(model.nodes.get('a')?.text).toBe('Plain \nlabel');
    expect(model.edges).toHaveLength(2);
    expect(svgOf(src)).not.toContain('not part');
  });

  it('rejects what the grammar rejects, with the line', () => {
    const fails = (src: string): PeleError => {
      try {
        render(src, options);
      } catch (error) {
        expect(error).toBeInstanceOf(PeleError);
        return error as PeleError;
      }
      throw new Error('expected a failure');
    };
    const open = fails('agentflow-beta TB\n  flow orphan["Orphan"]\n    a --> b');
    expect(fails('agentflow-beta TB\n  flow f["F"]\n    a --> b\n\n%% trailing\n')).toMatchObject({ line: 3, column: 12 });
    expect(open.code).toBe('syntax');
    expect(open.message).toMatch(/^Parse error on line \d+:/);
    expect(open.message).toContain("Expecting 'end', got '$end'");
    // Jison drops the lone percent sign from Mermaid's label pattern.
    expect(fails('agentflow-beta TB\n  a[50% off]').message).toMatch(/^Lexical error on line 2/);
    expect(fails('agentflow-beta TB\n  a ==> b').message).toMatch(/^Lexical error on line 2/);
    expect(fails('agentflow-beta TB\n  a -.-> b').message).toMatch(/^Parse error on line 2/);
    expect(fails('agentflow-beta TB\n  subgraph s\n  a\n  end').message).toMatch(/^Parse error on line 2/);
    expect(fails('agentflow-beta TB\n  a@{ label: a^b }').message).toMatch(/^Lexical error on line 2/);
  });

  it('rejects an unknown shape and unreadable metadata, pointing at the block', () => {
    const fails = (src: string): PeleError => {
      try {
        parse(src);
      } catch (error) {
        return error as PeleError;
      }
      throw new Error('expected a failure');
    };
    const shape = fails('---\ntitle: T\n---\nagentflow-beta TB\n  a["A"]@{ shape: Rounded }');
    expect(shape).toBeInstanceOf(PeleError);
    expect(shape.code).toBe('semantic');
    expect(shape.message).toBe('No such shape: Rounded. Shape names should be lowercase.');
    expect([shape.line, shape.column]).toEqual([5, 9]);
    expect(fails('agentflow-beta TB\n  a@{ shape: nope }').message).toBe('No such shape: nope.');
    expect(fails('agentflow-beta TB\n  a@{ shape: 123 }').message).toBe('No such shape: 123.');

    const yaml = fails('agentflow-beta TB\n  b["B"]\n  a["A"]@{\n\tshape: rounded\n  }');
    expect(yaml).toBeInstanceOf(PeleError);
    expect(yaml.code).toBe('syntax');
    expect(yaml.message).toMatch(/^Metadata of "a" is not valid YAML\. .* \(3:9\)$/);
    expect([yaml.line, yaml.column]).toEqual([3, 9]);
  });

  it('accepts trailing commas in a multi-line metadata block', () => {
    const model = modelOf('agentflow-beta TB\n  connector gh["GitHub"]@{\n    protocol: "mcp",\n    tools: ["read",\n      "write"],\n  }');
    expect(model.connectors.get('gh')?.metadata).toEqual({ protocol: 'mcp', tools: ['read', 'write'] });
  });

  it('strips prototype-shaped keys from metadata at every depth', () => {
    const model = modelOf('agentflow-beta TB\n  a@{\n    __proto__:\n      polluted: true\n    params:\n      - constructor: x\n        name: first\n    kept: 1\n  }');
    expect(JSON.stringify(model.nodes.get('a')?.metadata)).toBe('{"params":[{"name":"first"}],"kept":1}');
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
  });
});
