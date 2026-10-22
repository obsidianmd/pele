import { describe, expect, it } from 'vitest';
import { PeleError, detectType, parse, render, supports, type SequenceModel } from '../../src/index.js';
import { metricsMeasurer } from '../../src/text/measurer.js';
import { loadCorpus } from '../support/corpus.js';
import { assertInert } from '../support/inert.js';
import { LINETYPE, PLACEMENT } from '../support/sequence-constants.js';
import { elements } from '../support/xml.js';

const corpus = loadCorpus('sequence', /sequenceDiagram/i);
const options = { measurer: metricsMeasurer };

function tryRender(src: string): string | undefined {
  try {
    return render(src, options).svg;
  } catch (error) {
    if (error instanceof PeleError) return undefined;
    throw error;
  }
}

function svgOf(src: string, extra: object = {}): string {
  return render(src, { ...options, ...extra }).svg;
}

function model(src: string): SequenceModel {
  const parsed = parse(src);
  if (parsed.type !== 'sequence') throw new Error('not a sequence diagram');
  return parsed;
}

function count(svg: string, needle: string): number {
  return svg.split(needle).length - 1;
}

function lifelines(svg: string): Map<string, number> {
  const out = new Map<string, number>();
  for (const m of svg.matchAll(/<path class="pele-lifeline" data-id="([^"]*)" d="M(-?[\d.]+),/g)) out.set(m[1], Number(m[2]));
  return out;
}

describe('sequence rendering', () => {
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
    expect(rendered).toBeGreaterThan(150);
  });

  it('reports size and type', () => {
    const result = render('sequenceDiagram\n  Alice->>Bob: Hello', options);
    expect(result.type).toBe('sequence');
    expect(result.width).toBeGreaterThan(100);
    expect(result.height).toBeGreaterThan(100);
    expect(result.links).toEqual([]);
    expect(result.svg).toContain(`viewBox="0 0 ${result.width} ${result.height}"`);
    expect(result.svg).toMatch(/^<svg xmlns="http:\/\/www\.w3\.org\/2000\/svg" class="pele pele-sequence"/);
  });

  it('is detected, supported, and parsed to a sequence model', () => {
    expect(detectType('sequenceDiagram\n A->>B: hi')).toBe('sequence');
    expect(supports('sequenceDiagram\n A->>B: hi')).toBe(true);
    const m = model('sequenceDiagram\n participant A as Alice\n A->>B: hi');
    expect([...m.actors.keys()]).toEqual(['A', 'B']);
    expect(m.actors.get('A')?.description).toBe('Alice');
    expect(m.messages).toHaveLength(1);
    expect(m.messages[0]).toMatchObject({ from: 'A', to: 'B', message: 'hi', type: LINETYPE.SOLID });
  });

  it('renders an empty diagram and a lone participant', () => {
    expect(render('sequenceDiagram', options).width).toBeGreaterThan(0);
    const { svg } = render('sequenceDiagram\n participant Solo', options);
    expect(count(svg, 'class="pele-node pele-actor')).toBe(2);
  });

  it('themes through custom properties with fallbacks and no style element', () => {
    const svg = svgOf('sequenceDiagram\n  Alice->>+Bob: Hi\n  Note over Alice: n\n  Bob-->>-Alice: Yo');
    for (const token of ['--pele-bg', '--pele-fg', '--pele-line', '--pele-surface', '--pele-border', '--pele-font']) {
      expect(svg).toContain(`var(${token},`);
    }
    expect(svg).not.toContain('<style');
    expect(svg).not.toContain('<marker');
    expect(svg).not.toContain('<defs');
  });

  it('mirrors participants at the bottom unless told not to', () => {
    const src = 'sequenceDiagram\n  Alice->>Bob: Hi';
    const mirrored = render(src, options);
    const single = render(src, { ...options, config: { sequence: { mirrorActors: false } } });
    expect(count(mirrored.svg, 'class="pele-node pele-actor')).toBe(4);
    expect(count(mirrored.svg, 'pele-actor-footer')).toBe(2);
    expect(count(single.svg, 'class="pele-node pele-actor')).toBe(2);
    expect(single.height).toBeLessThan(mirrored.height);
    const directive = svgOf(`%%{init: {"sequence": {"mirrorActors": false}}}%%\n${src}`);
    expect(count(directive, 'pele-actor-footer')).toBe(0);
  });

  it('keeps participants in order of appearance and spaces them by their text', () => {
    const short = lifelines(svgOf('sequenceDiagram\n  A->>B: hi\n  B->>C: hi'));
    const long = lifelines(svgOf('sequenceDiagram\n  A->>B: a considerably longer message than before\n  B->>C: hi'));
    expect([...short.keys()]).toEqual(['A', 'B', 'C']);
    expect(short.get('A')!).toBeLessThan(short.get('B')!);
    expect(short.get('B')!).toBeLessThan(short.get('C')!);
    expect(long.get('B')! - long.get('A')!).toBeGreaterThan(short.get('B')! - short.get('A')! + 100);
    expect(long.get('C')! - long.get('B')!).toBeCloseTo(short.get('C')! - short.get('B')!, 1);
  });

  it('shares the width a long message needs among the gaps it crosses', () => {
    const x = lifelines(svgOf('sequenceDiagram\n  participant A\n  participant B\n  participant C\n  A->>C: a message that is far too long for two default gaps to hold'));
    expect(x.get('B')! - x.get('A')!).toBeCloseTo(x.get('C')! - x.get('B')!, 1);
    expect(x.get('C')! - x.get('A')!).toBeGreaterThan(360);
  });

  it('widens a participant to its label and honors actorMargin', () => {
    const tight = lifelines(svgOf('sequenceDiagram\n  participant A\n  participant B'));
    const wide = lifelines(svgOf('sequenceDiagram\n  participant A\n  participant B', { config: { sequence: { actorMargin: 200 } } }));
    expect(wide.get('B')! - wide.get('A')!).toBe(tight.get('B')! - tight.get('A')! + 160);
    const labelled = lifelines(svgOf('sequenceDiagram\n  participant A as A participant with a long description\n  participant B'));
    expect(labelled.get('B')! - labelled.get('A')!).toBeGreaterThan(tight.get('B')! - tight.get('A')! + 80);
  });

  it('draws each arrow type with its line and heads', () => {
    const one = (arrow: string): string => svgOf(`sequenceDiagram\n  A${arrow}B: x`).match(/<g class="pele-edge pele-message"[^>]*>(.*?)<\/g>/)![1];
    expect(one('->')).not.toContain('pele-marker');
    expect(one('->')).not.toContain('stroke-dasharray');
    expect(one('-->')).toContain('stroke-dasharray');
    expect(count(one('->>'), 'pele-marker')).toBe(1);
    expect(one('-->>')).toContain('stroke-dasharray');
    expect(count(one('<<->>'), 'pele-marker')).toBe(2);
    expect(count(one('<<-->>'), 'pele-marker')).toBe(2);
    expect(one('-x')).toMatch(/pele-marker" d="M[^"]*M/);
    expect(one('-)')).toContain('stroke-linejoin="round"');
    expect(one('-)')).not.toContain('fill="var(--_l)"');
    for (const half of ['-|\\', '-|/', '-\\\\', '-//', '/|-', '\\|-', '//-', '\\\\-']) {
      expect(count(one(half), 'pele-marker'), half).toBe(1);
      expect(one(half.replace('-', '--')), half).toContain('stroke-dasharray');
    }
  });

  it('puts a half head above or below the line as its name says', () => {
    const head = (arrow: string): number[] => {
      const d = svgOf(`sequenceDiagram\n  A${arrow}B: x`).match(/pele-marker" d="([^"]*)"/)![1];
      return [...d.matchAll(/,(-?[\d.]+)/g)].map((m) => Number(m[1]));
    };
    const top = head('-|\\');
    const bottom = head('-|/');
    expect(Math.min(...top)).toBeLessThan(top[0]);
    expect(Math.max(...top)).toBe(top[0]);
    expect(Math.max(...bottom)).toBeGreaterThan(bottom[0]);
    expect(Math.min(...bottom)).toBe(bottom[0]);
  });

  it('runs a message between the lifelines of its participants, in order from the top', () => {
    const svg = svgOf('sequenceDiagram\n  A->>B: one\n  B-->>A: two');
    const x = lifelines(svg);
    const paths = [...svg.matchAll(/<g class="pele-edge pele-message" data-id="i(\d+)"><path d="M(-?[\d.]+),(-?[\d.]+)H(-?[\d.]+)"/g)];
    expect(paths.map((p) => p[1])).toEqual(['0', '1']);
    expect(Number(paths[0][2])).toBe(x.get('A'));
    expect(Number(paths[0][4])).toBeLessThan(x.get('B')!);
    expect(Number(paths[0][4])).toBeGreaterThan(x.get('B')! - 10);
    expect(Number(paths[1][2])).toBe(x.get('B'));
    expect(Number(paths[1][3])).toBeGreaterThan(Number(paths[0][3]));
  });

  it('loops a message to self back to its own lifeline', () => {
    const svg = svgOf('sequenceDiagram\n  A->>A: think\n  A->>B: tell');
    const x = lifelines(svg);
    const d = svg.match(/data-id="i0"><path d="([^"]*)"/)![1];
    expect(d).toMatch(/^M[\d.]+,[\d.]+H[\d.]+A6,6/);
    expect(Number(d.match(/^M([\d.]+)/)![1])).toBe(x.get('A'));
    const square = svgOf('sequenceDiagram\n  A->>A: think', { config: { sequence: { rightAngles: true } } });
    expect(square.match(/data-id="i0"><path d="([^"]*)"/)![1]).not.toContain('A6,6');
  });

  it('starts the next row below a message to self whose label is taller than its loop', () => {
    const baselines = (svg: string, id: string): number[] => {
      const label = svg.match(new RegExp(`<g class="pele-edge-label" data-id="${id}">(.*?)</g>`))![1];
      return [...label.matchAll(/ y="([\d.]+)"/g)].map((m) => Number(m[1]));
    };
    const step = (svg: string): number => {
      const self = baselines(svg, 'i0');
      return baselines(svg, 'i1')[0] - self[self.length - 1];
    };
    const broken = svgOf('sequenceDiagram\n  A->>A: one<br/>two<br/>three\n  A->>B: next');
    const own = baselines(broken, 'i0');
    expect(own).toHaveLength(3);
    expect(step(broken)).toBeGreaterThanOrEqual(own[1] - own[0]);
    const long = 'a message to self long enough to wrap onto several lines';
    const wrapped = svgOf(`sequenceDiagram\n  A->>A: ${long}\n  A->>B: next`, { maxWidth: 200 });
    expect(baselines(wrapped, 'i0').length).toBeGreaterThan(1);
    expect(step(wrapped)).toBeGreaterThanOrEqual(own[1] - own[0]);
  });

  it('draws activations, nested ones offset, and ends arrows at their edges', () => {
    const svg = svgOf('sequenceDiagram\n  A->>+B: one\n  A->>+B: two\n  B-->>-A: three\n  B-->>-A: four');
    const x = lifelines(svg);
    const rects = [...svg.matchAll(/<rect class="pele-activation" data-id="B" x="(-?[\d.]+)" y="(-?[\d.]+)" width="10" height="([\d.]+)"/g)];
    expect(rects).toHaveLength(2);
    const xs = rects.map((r) => Number(r[1])).sort((p, q) => p - q);
    expect(xs[0]).toBe(x.get('B')! - 5);
    expect(xs[1]).toBe(x.get('B')! - 1);
    const outer = rects.find((r) => Number(r[1]) === xs[0])!;
    const inner = rects.find((r) => Number(r[1]) === xs[1])!;
    expect(Number(outer[3])).toBeGreaterThan(Number(inner[3]));
    expect(svg.indexOf(outer[0])).toBeLessThan(svg.indexOf(inner[0]));
    const first = svg.match(/data-id="i0"><path d="M[\d.]+,[\d.]+H([\d.]+)"/)![1];
    expect(Number(first)).toBe(x.get('B')! - 5 - 7);
  });

  it('accepts explicit activate and deactivate, and keeps an unclosed activation to the end', () => {
    const closed = svgOf('sequenceDiagram\n  A->>B: go\n  activate B\n  B-->>A: done\n  deactivate B');
    expect(count(closed, 'pele-activation"')).toBe(1);
    const open = svgOf('sequenceDiagram\n  activate A\n  A->>B: go');
    expect(count(open, 'pele-activation"')).toBe(1);
  });

  it('rejects deactivating a participant that is not active', () => {
    expect(() => render('sequenceDiagram\n  A->>B: go\n  deactivate B', options)).toThrow(/inactivate an inactive participant \(B\)/);
    expect(() => render('sequenceDiagram\n  A->>-B: go', options)).toThrow(PeleError);
  });

  it('places notes left of, right of, and over participants', () => {
    const svg = svgOf('sequenceDiagram\n  participant A\n  participant B\n  Note left of A: L\n  Note right of B: R\n  Note over A: O\n  Note over A,B: AB');
    const x = lifelines(svg);
    const notes = [...svg.matchAll(/<g class="pele-note" data-id="i(\d+)"><rect x="(-?[\d.]+)" y="(-?[\d.]+)" width="([\d.]+)"/g)].map((m) => ({
      left: Number(m[2]),
      right: Number(m[2]) + Number(m[4]),
      top: Number(m[3]),
    }));
    expect(notes).toHaveLength(4);
    expect(notes[0].right).toBeLessThan(x.get('A')!);
    expect(notes[1].left).toBeGreaterThan(x.get('B')!);
    expect((notes[2].left + notes[2].right) / 2).toBeCloseTo(x.get('A')!, 1);
    expect(notes[3].left).toBeLessThan(x.get('A')!);
    expect(notes[3].right).toBeGreaterThan(x.get('B')!);
    for (let i = 1; i < notes.length; i++) expect(notes[i].top).toBeGreaterThan(notes[i - 1].top);
    const m = model('sequenceDiagram\n  Note over A,B: AB\n  Note left of A: L');
    expect(m.notes.map((n) => n.placement)).toEqual([PLACEMENT.OVER, PLACEMENT.LEFTOF]);
    expect(m.notes[0].actor).toEqual(['A', 'B']);
  });

  it('frames loop, alt, opt, par, critical, and break blocks with their titles and sections', () => {
    const svg = svgOf(
      'sequenceDiagram\n  loop Every minute\n  A->>B: a\n  end\n  alt ok\n  A->>B: b\n  else bad\n  A->>B: c\n  else\n  A->>B: d\n  end\n' +
        '  opt maybe\n  A->>B: e\n  end\n  par one\n  A->>B: f\n  and two\n  A->>B: g\n  end\n  par_over three\n  A->>B: h\n  end\n' +
        '  critical must\n  A->>B: i\n  option fail\n  A->>B: j\n  end\n  break stop\n  A->>B: k\n  end'
    );
    for (const kind of ['loop', 'alt', 'opt', 'par', 'critical', 'break']) {
      expect(svg, kind).toContain(`class="pele-frame pele-frame-${kind}"`);
      expect(svg, kind).toContain(`>${kind}</text>`);
    }
    expect(count(svg, 'class="pele-frame pele-frame-par"')).toBe(2);
    for (const title of ['[Every minute]', '[ok]', '[bad]', '[maybe]', '[one]', '[two]', '[three]', '[must]', '[fail]', '[stop]']) {
      expect(svg, title).toContain(`>${title}</text>`);
    }
    const alt = svg.match(/<g class="pele-frame pele-frame-alt">(.*?)<\/g>/)![1];
    expect(count(alt, 'stroke-dasharray')).toBe(2);
  });

  it('nests blocks inside one another', () => {
    const svg = svgOf('sequenceDiagram\n  loop outer\n  alt inner\n  A->>B: x\n  end\n  end');
    const box = (kind: string): number[] =>
      svg.match(new RegExp(`pele-frame-${kind}"><rect x="(-?[\\d.]+)" y="(-?[\\d.]+)" width="([\\d.]+)" height="([\\d.]+)"`))!.slice(1).map(Number);
    const outer = box('loop');
    const inner = box('alt');
    expect(inner[0]).toBeGreaterThan(outer[0]);
    expect(inner[1]).toBeGreaterThan(outer[1]);
    expect(inner[0] + inner[2]).toBeLessThan(outer[0] + outer[2]);
    expect(inner[1] + inner[3]).toBeLessThan(outer[1] + outer[3]);
  });

  it('shades rect blocks with the given color, the inner one on top', () => {
    const svg = svgOf('sequenceDiagram\n  rect rgb(191, 223, 255)\n  A->>B: x\n  rect rgba(0, 0, 255, .1)\n  B->>A: y\n  end\n  end\n  rect\n  A->>B: z\n  end');
    const rects = [...svg.matchAll(/<rect class="pele-rect"[^>]*>/g)].map((m) => m[0]);
    expect(rects).toHaveLength(3);
    expect(rects.some((r) => r.includes('style="rx:var(--_r);fill:rgb(191, 223, 255);"'))).toBe(true);
    expect(rects.some((r) => r.includes('style="rx:var(--_r);fill:rgba(0, 0, 255, .1);"'))).toBe(true);
    expect(rects.filter((r) => !r.includes('fill:')).length).toBe(1);
    expect(svg.indexOf('rgb(191, 223, 255)')).toBeLessThan(svg.indexOf('rgba(0, 0, 255, .1)'));
    expect(svg.indexOf('class="pele-rects"')).toBeLessThan(svg.indexOf('class="pele-lifelines"'));
  });

  it('groups participants in boxes, with color and title', () => {
    const src = 'sequenceDiagram\n  box Aqua Group One\n  participant A\n  participant B\n  end\n  box Group Two\n  participant C\n  end\n  box rgb(1, 2, 3)\n  participant D\n  end\n  A->>D: x';
    const m = model(src);
    expect(m.boxes.map((b) => [b.name, b.fill, b.actorKeys])).toEqual([
      ['Group One', 'Aqua', ['A', 'B']],
      ['Group Two', 'transparent', ['C']],
      [undefined, 'rgb(1, 2, 3)', ['D']],
    ]);
    const svg = svgOf(src);
    expect(count(svg, 'class="pele-cluster pele-box"')).toBe(3);
    expect(svg).toContain('style="rx:var(--_r);fill:Aqua;"');
    expect(svg).toContain('>Group One</text>');
    expect(svg).toContain('>Group Two</text>');
    const x = lifelines(svg);
    const plain = lifelines(svgOf('sequenceDiagram\n  participant A\n  participant B\n  participant C\n  participant D\n  A->>D: x'));
    expect(x.get('C')! - x.get('B')!).toBeGreaterThan(plain.get('C')! - plain.get('B')!);
    expect(x.get('B')! - x.get('A')!).toBe(plain.get('B')! - plain.get('A')!);
  });

  it('reads box colors as Mermaid does, treating an unknown first word as part of the title', () => {
    const fill = (line: string): [string | undefined, string] => {
      const b = model(`sequenceDiagram\n  box ${line}\n  participant A\n  end`).boxes[0];
      return [b.name, b.fill];
    };
    expect(fill('green Team')).toEqual(['Team', 'green']);
    expect(fill('Team green')).toEqual(['Team green', 'transparent']);
    expect(fill('rgb(34, 56, 0) Group1')).toEqual(['Group1', 'rgb(34, 56, 0)']);
    expect(fill('hsl(120deg 50% 50% / 0.5) H')).toEqual(['H', 'hsl(120deg 50% 50% / 0.5)']);
    expect(fill('rgb(1, 2) Bad')).toEqual(['rgb(1, 2) Bad', 'transparent']);
    expect(fill('transparent Aqua')).toEqual(['Aqua', 'transparent']);
    expect(fill('GrayText Disabled')).toEqual(['Disabled', 'GrayText']);
    expect(fill('wrap: Wrapped title')).toEqual(['Wrapped title', 'transparent']);
  });

  it('refuses a participant declared in two boxes', () => {
    expect(() => render('sequenceDiagram\n  box One\n  participant A\n  end\n  box Two\n  participant A\n  end', options)).toThrow(
      /should only be defined in one Box/
    );
  });

  it('numbers messages with autonumber, its start and step, and the config switch', () => {
    const numbers = (svg: string): string[] => [...svg.matchAll(/<g class="pele-sequence-number">.*?<text[^>]*>([^<]*)<\/text>/g)].map((m) => m[1]);
    const src = 'sequenceDiagram\n  A->>B: one\n  B-->>A: two\n  A->>A: three';
    expect(numbers(svgOf(src))).toEqual([]);
    expect(numbers(svgOf(src.replace('\n', '\n  autonumber\n')))).toEqual(['1', '2', '3']);
    expect(numbers(svgOf(src.replace('\n', '\n  autonumber 10 5\n')))).toEqual(['10', '15', '20']);
    expect(numbers(svgOf(src.replace('\n', '\n  autonumber 10.01 .01\n')))).toEqual(['10.01', '10.02', '10.03']);
    expect(numbers(svgOf(src, { config: { sequence: { showSequenceNumbers: true } } }))).toEqual(['1', '2', '3']);
    expect(numbers(svgOf('sequenceDiagram\n  autonumber\n  A->>B: one\n  autonumber off\n  B-->>A: two\n  autonumber\n  A->>B: three'))).toEqual(['1', '3']);
    expect(() => render('sequenceDiagram\n  autonumber 10.001\n  A->>B: one', options)).toThrow(PeleError);
  });

  it('draws each participant kind, with figures above their labels', () => {
    const kinds = ['actor', 'boundary', 'control', 'entity', 'database', 'collections', 'queue'];
    let src = 'sequenceDiagram\n  participant P\n  actor A\n';
    for (const kind of kinds.slice(1)) src += `  participant ${kind}@{ "type": "${kind}" }\n`;
    const m = model(src);
    expect([...m.actors.values()].map((a) => a.type)).toEqual(['participant', ...kinds]);
    const svg = svgOf(src, { config: { sequence: { mirrorActors: false } } });
    for (const kind of ['participant', ...kinds]) expect(count(svg, `pele-actor-${kind}"`), kind).toBe(1);
    expect(svgOf('sequenceDiagram\n  participant X@{ "type": "nonsense" }')).toContain('pele-actor-participant"');
  });

  it('takes aliases from `as` and from the config object, `as` first', () => {
    const m = model(
      'sequenceDiagram\n  participant A as Alice\n  participant B@{ "alias": "Bob" }\n  participant C@{ "alias": "Inner" } as Outer\n  actor D\n  participant E@{ type: database, alias: "Store" }'
    );
    expect([...m.actors.values()].map((a) => a.description)).toEqual(['Alice', 'Bob', 'Outer', 'D', 'Store']);
    expect(m.actors.get('E')?.type).toBe('database');
  });

  it('rejects a config object that is not valid YAML', () => {
    expect(() => render('sequenceDiagram\n  participant C@{ "type" "control" }\n  C->>C: x', options)).toThrow(PeleError);
    expect(() => render('sequenceDiagram\n  participant C@{ "type: "control" }', options)).toThrow(PeleError);
  });

  it('creates a participant at its first message and ends a destroyed one with a cross', () => {
    const src = 'sequenceDiagram\n  A->>B: hi\n  create participant C\n  A->>C: make\n  destroy C\n  A-xC: end\n  B->>A: bye';
    const m = model(src);
    expect(m.createdActors.get('C')).toBe(1);
    expect(m.destroyedActors.get('C')).toBe(2);
    const svg = svgOf(src);
    const top = (id: string): number => Number(svg.match(new RegExp(`pele-actor-participant" data-id="${id}"><rect x="[-\\d.]+" y="([-\\d.]+)"`))![1]);
    expect(top('C')).toBeGreaterThan(top('A') + 40);
    expect(count(svg, 'class="pele-destroy" data-id="C"')).toBe(1);
    expect(count(svg, 'pele-actor-footer" data-id="C"')).toBe(0);
    expect(count(svg, 'pele-actor-footer" data-id="A"')).toBe(1);
    const life = svg.match(/pele-lifeline" data-id="C" d="M[\d.]+,([\d.]+)V([\d.]+)"/)!;
    expect(Number(life[1])).toBeGreaterThan(top('C'));
    const lifeA = svg.match(/pele-lifeline" data-id="A" d="M[\d.]+,([\d.]+)V([\d.]+)"/)!;
    expect(Number(life[2])).toBeLessThan(Number(lifeA[2]));
  });

  it('enforces the rules of create and destroy', () => {
    expect(() => render('sequenceDiagram\n  A->>B: hi\n  create participant A\n  B->>A: x', options)).toThrow(/same id/);
    expect(() => render('sequenceDiagram\n  create participant C\n  A->>B: x', options)).toThrow(/created participant C/);
    expect(() => render('sequenceDiagram\n  A->>B: hi\n  destroy B\n  A->>C: x', options)).toThrow(/destroyed participant B/);
  });

  it('marks central connections with a circle on the lifeline', () => {
    const svg = svgOf('sequenceDiagram\n  A->>()B: to\n  A()->>B: from\n  A()->>()B: both');
    const circles = [...svg.matchAll(/data-id="i(\d+)">(.*?)<\/g>/g)].filter((m) => m[2].includes('pele-central')).map((m) => [m[1], count(m[2], 'pele-central')]);
    expect(circles).toEqual([
      ['0', 1],
      ['2', 1],
      ['4', 2],
    ]);
    const m = model('sequenceDiagram\n  A->>()B: to\n  A()->>B: from\n  A()->>()B: both');
    expect(m.messages.filter((x) => x.message !== '').map((x) => x.centralConnection)).toEqual([
      LINETYPE.CENTRAL_CONNECTION,
      LINETYPE.CENTRAL_CONNECTION_REVERSE,
      LINETYPE.CENTRAL_CONNECTION_DUAL,
    ]);
  });

  it('breaks lines at <br> and wraps only when asked', () => {
    const lines = (svg: string, id: number): number => {
      const g = svg.match(new RegExp(`<g class="pele-edge-label" data-id="i${id}">(.*?)</g>`))![1];
      return Math.max(1, count(g, '<tspan x='));
    };
    const long = 'a message long enough that it would be wrapped if wrapping were switched on for it';
    const svg = svgOf(`sequenceDiagram\n  A->>B: one<br/>two<br>three\n  A->>B: ${long}\n  A->>B: nowrap: ${long}`);
    expect(lines(svg, 0)).toBe(3);
    expect(lines(svg, 1)).toBe(1);
    expect(lines(svg, 2)).toBe(1);
    expect(lines(svgOf(`sequenceDiagram\n  A->>B: wrap: ${long}`), 0)).toBeGreaterThan(2);
    // A wrapped message uses the room that other messages have made between its participants.
    expect(lines(svgOf(`sequenceDiagram\n  A->>B: ${long}\n  A->>B: wrap: ${long}`), 1)).toBe(1);
    const all = svgOf(`sequenceDiagram\n  A->>B: ${long}`, { config: { sequence: { wrap: true } } });
    expect(lines(all, 0)).toBeGreaterThan(1);
    expect(lines(svgOf(`sequenceDiagram\n  A->>B: nowrap: ${long}`, { config: { sequence: { wrap: true } } }), 0)).toBe(1);
    const directive = svgOf(`%%{wrap}%%\nsequenceDiagram\n  A->>B: ${long}`);
    expect(lines(directive, 0)).toBeGreaterThan(1);
  });

  it('records the wrap of every message, from prefixes, the directive, and the config', () => {
    const wraps = (src: string): boolean[] => model(src).messages.map((m) => m.wrap);
    expect(wraps('sequenceDiagram\n  A->>B: x\n  A->>B: wrap: x\n  A->>B: nowrap: x\n  Note left of A: wrap: n')).toEqual([false, true, false, true]);
    expect(wraps('%%{wrap}%%\nsequenceDiagram\n  A->>B: x\n  Note left of A: n\n  A->>B: nowrap: x')).toEqual([true, true, false]);
    expect(wraps('%%{init: {"sequence": {"wrap": true}}}%%\nsequenceDiagram\n  A->>B: x')).toEqual([true]);
    expect(model('sequenceDiagram\n  participant A as wrap: Alice\n  A->>B: wrap: text').actors.get('A')).toMatchObject({ description: 'Alice', wrap: true });
  });

  it('decodes entity codes and escapes text', () => {
    const svg = svgOf('sequenceDiagram\n  A->>B: I #9829; you #lt;3 & <more>\n  Note over A: a "quoted" note');
    expect(svg).toContain('I ♥ you &lt;3 &amp; ');
    expect(svg).toContain('a &quot;quoted&quot; note');
  });

  it('stores participant links, properties, and details without drawing anything interactive', () => {
    const src =
      'sequenceDiagram\n  participant A\n  participant B\n  links A: {"Repo": "https://example.com/repo", "Docs": "https://example.com/docs"}\n' +
      '  link A: Tests @ https://example.com/?a=1&b=2@x\n  properties B: {"class": "external svc", "icon": "@clock"}\n  details B: some-element\n  A->>B: hi';
    const m = model(src);
    expect([...m.actors.get('A')!.links]).toEqual([
      ['Repo', 'https://example.com/repo'],
      ['Docs', 'https://example.com/docs'],
      ['Tests', 'https://example.com/?a=1&b=2@x'],
    ]);
    expect([...m.actors.get('B')!.properties]).toEqual([
      ['class', 'external svc'],
      ['icon', '@clock'],
    ]);
    expect(m.actors.get('B')!.details).toBe('some-element');
    const svg = svgOf(src);
    expect(svg).not.toContain('<a');
    expect(svg).not.toContain('example.com');
    expect(svg).toContain('pele-actor-participant external svc" data-id="B"');
  });

  it('ignores menu statements whose text is not valid JSON', () => {
    const m = model('sequenceDiagram\n  participant A\n  links A: not json\n  properties A: {"a": }');
    expect(m.actors.get('A')!.links.size).toBe(0);
    expect(m.actors.get('A')!.properties.size).toBe(0);
  });

  it('titles the diagram from a statement or from front matter', () => {
    expect(model('sequenceDiagram\n  title My title\n  A->>B: x').title).toBe('My title');
    expect(model('sequenceDiagram\n  title: Legacy title\n  A->>B: x').title).toBe('Legacy title');
    expect(model('---\ntitle: From front matter\n---\nsequenceDiagram\n  A->>B: x').title).toBe('From front matter');
    const svg = svgOf('sequenceDiagram\n  title My title\n  A->>B: x');
    expect(svg).toMatch(/<text class="pele-title" font-weight="var\(--_tw\)"[^>]*><tspan[^>]*>My title<\/tspan><\/text>/);
    expect(render('sequenceDiagram\n  title My title\n  A->>B: x', options).height).toBeGreaterThan(render('sequenceDiagram\n  A->>B: x', options).height);
  });

  it('writes accessible title and description', () => {
    const svg = svgOf('sequenceDiagram\n  accTitle: A title\n  accDescr: A description\n  A->>B: x');
    expect(svg).toContain('<title id="pele-title">A title</title>');
    expect(svg).toContain('<desc id="pele-desc">A description</desc>');
    const multi = model('sequenceDiagram\n  accDescr {\n    Two\n    lines\n  }\n  A->>B: x');
    expect(multi.accDescr).toBe('Two\nlines');
  });

  it('hides participants no message mentions when asked', () => {
    const src = 'sequenceDiagram\n  participant A\n  participant Unused\n  participant B\n  A->>B: x';
    expect([...lifelines(svgOf(src)).keys()]).toEqual(['A', 'Unused', 'B']);
    expect([...lifelines(svgOf(src, { config: { sequence: { hideUnusedParticipants: true } } })).keys()]).toEqual(['A', 'B']);
  });

  it('spaces messages by messageMargin', () => {
    const src = 'sequenceDiagram\n  A->>B: one\n  A->>B: two\n  A->>B: three';
    const base = render(src, options).height;
    const loose = render(src, { ...options, config: { sequence: { messageMargin: 75 } } }).height;
    expect(loose).toBe(base + 3 * 40);
  });

  it('aligns message text as messageAlign says', () => {
    const src = 'sequenceDiagram\n  A->>B: a message that sets the width\n  A->>B: hi';
    const textX = (svg: string): number => Number(svg.match(/data-id="i1"><text x="([\d.]+)"/)![1]);
    const center = textX(svgOf(src));
    expect(textX(svgOf(src, { config: { sequence: { messageAlign: 'left' } } }))).toBeLessThan(center - 50);
    expect(textX(svgOf(src, { config: { sequence: { messageAlign: 'right' } } }))).toBeGreaterThan(center + 50);
  });

  it('keeps every drawn coordinate inside the reported size', () => {
    for (const src of corpus) {
      let result;
      try {
        result = render(src, options);
      } catch {
        continue;
      }
      const shift = result.svg.match(/<g transform="translate\((-?[\d.]+),(-?[\d.]+)\)">/)!;
      const dx = Number(shift[1]);
      const dy = Number(shift[2]);
      for (const el of elements(result.svg)) {
        if (el.name !== 'rect' || !el.attrs.has('width') || el.attrs.get('width') === '100%') continue;
        const x = Number(el.attrs.get('x')) + dx;
        const y = Number(el.attrs.get('y')) + dy;
        const where = JSON.stringify(src).slice(0, 80);
        expect(x, where).toBeGreaterThanOrEqual(0);
        expect(y, where).toBeGreaterThanOrEqual(0);
        expect(x + Number(el.attrs.get('width')), where).toBeLessThanOrEqual(result.width);
        expect(y + Number(el.attrs.get('height')), where).toBeLessThanOrEqual(result.height);
      }
    }
  });

  it('shrinks to its container unless told not to', () => {
    expect(svgOf('sequenceDiagram\n  A->>B: x')).toContain('max-width:100%;height:auto;');
    expect(svgOf('sequenceDiagram\n  A->>B: x', { responsive: false })).not.toContain('max-width');
  });

  it('treats keywords without regard to case and keeps names as written', () => {
    const m = model('sequenceDiagram\n  PARTICIPANT Alice AS A\n  Alice->>BOB: hi\n  NOTE OVER Alice: n\n  LOOP x\n  Alice->>Alice: y\n  END');
    expect([...m.actors.keys()]).toEqual(['Alice', 'BOB']);
    expect(m.actors.get('Alice')?.description).toBe('A');
    expect(m.messages.map((x) => x.type)).toEqual([LINETYPE.SOLID, LINETYPE.NOTE, LINETYPE.LOOP_START, LINETYPE.SOLID, LINETYPE.LOOP_END]);
  });

  it('throws structured errors', () => {
    const error = (() => {
      try {
        render('sequenceDiagram\n  Alice->>Bob\n', options);
      } catch (e) {
        return e as PeleError;
      }
    })();
    expect(error).toBeInstanceOf(PeleError);
    expect(error?.code).toBe('syntax');
    expect(error?.line).toBe(2);
    expect(error?.message).toMatch(/Expecting 'TXT', got 'NEWLINE'/);
    expect(() => render('sequenceDiagram\n  participant\n', options)).toThrow(/Lexical error on line 2/);
    expect(() => render('sequenceDiagram\n  loop x\n  A->>B: y', options)).toThrow(PeleError);
  });
});
