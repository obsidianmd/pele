import { describe, expect, it } from 'vitest';
import { PeleError, render } from '../../src/index.js';
import { metricsMeasurer } from '../../src/text/measurer.js';
import { loadCorpus, mutator, random } from '../support/corpus.js';
import { PAYLOADS, assertInert } from '../support/inert.js';

const options = { measurer: metricsMeasurer };

function check(src: string, extra: object = {}): boolean {
  let svg: string;
  try {
    svg = render(src, { ...options, ...extra }).svg;
  } catch (error) {
    if (error instanceof PeleError) return false;
    throw new Error(`Unexpected ${(error as Error).name} for ${JSON.stringify(src).slice(0, 200)}: ${(error as Error).message}`);
  }
  assertInert(svg, JSON.stringify(src).slice(0, 160));
  return true;
}

const TEMPLATES: ((p: string) => string)[] = [
  (p) => `stateDiagram-v2\n  ${p} --> b`,
  (p) => `stateDiagram-v2\n  a --> ${p}`,
  (p) => `stateDiagram-v2\n  ${p}`,
  (p) => `stateDiagram-v2\n  a : ${p}`,
  (p) => `stateDiagram-v2\n  a : title\n  a : ${p}\n  a : ${p}`,
  (p) => `stateDiagram-v2\n  a --> b : ${p}`,
  (p) => `stateDiagram-v2\n  a --> a : ${p}`,
  (p) => `stateDiagram-v2\n  state "${p}" as a\n  a --> b`,
  (p) => `stateDiagram-v2\n  state "x" as ${p}\n`,
  (p) => `stateDiagram-v2\n  state "x" as a:${p}\n`,
  (p) => `stateDiagram-v2\n  state ${p} {\n  a --> b\n  }`,
  (p) => `stateDiagram-v2\n  state "${p}" as c {\n  a --> b\n  }\n  c --> c : ${p}`,
  (p) => `stateDiagram-v2\n  state c {\n  a --> b : ${p}\n  --\n  ${p} --> d\n  }\n  c --> a : ${p}`,
  (p) => `stateDiagram-v2\n  state ${p} <<fork>>\n  state ${p} <<join>>\n  [*] --> ${p}`,
  (p) => `stateDiagram-v2\n  state ${p} <<choice>>\n  a --> ${p}`,
  (p) => `stateDiagram-v2\n  state ${p} [[choice]]\n`,
  (p) => `stateDiagram-v2\n  a --> b\n  note right of a : ${p}`,
  (p) => `stateDiagram-v2\n  a --> b\n  note left of a\n  ${p}\n  ${p}\n  end note`,
  (p) => `stateDiagram-v2\n  note right of ${p} : text`,
  (p) => `stateDiagram-v2\n  a --> b\n  note "${p}" as ${p}`,
  (p) => `stateDiagram-v2\n  a:::${p} --> b`,
  (p) => `stateDiagram-v2\n  [*]:::${p} --> b:::${p}`,
  (p) => `stateDiagram-v2\n  a --> b\n  class a ${p}`,
  (p) => `stateDiagram-v2\n  a --> b\n  class a,${p} c`,
  (p) => `stateDiagram-v2\n  a --> b\n  classDef ${p} fill:red\n  class a ${p}`,
  (p) => `stateDiagram-v2\n  a --> b\n  classDef c fill:${p}\n  class a c`,
  (p) => `stateDiagram-v2\n  a --> b\n  classDef c ${p}:red,color:${p},font-family:${p},stroke:${p}\n  class a c`,
  (p) => `stateDiagram-v2\n  state g {\n  a --> b\n  }\n  classDef c fill:${p},stroke:${p},color:${p}\n  class g c`,
  (p) => `stateDiagram-v2\n  a --> b\n  style a fill:${p}`,
  (p) => `stateDiagram-v2\n  a --> b\n  style a ${p}:red`,
  (p) => `stateDiagram-v2\n  a --> b\n  style a,${p} color:${p},stroke:${p},font-size:${p}`,
  (p) => `stateDiagram-v2\n  a --> b\n  click a "${p}" "${p}"\n`,
  (p) => `stateDiagram-v2\n  a --> b\n  click a href "${p}"\n`,
  (p) => `stateDiagram-v2\n  state a {\n  x\n  }\n  click a "${p}" "${p}"\n`,
  (p) => `stateDiagram-v2\n  ${p} --> b\n  click ${p} "https://example.com" "${p}"\n`,
  (p) => `stateDiagram-v2\n  accTitle: ${p}\n  accDescr: ${p}\n  a --> b`,
  (p) => `stateDiagram-v2\n  accDescr {\n ${p}\n }\n  a --> b`,
  (p) => `stateDiagram-v2\n  direction ${p}\n  a --> b`,
  (p) => `stateDiagram-v2\n  direction LR ${p}\n  a --> b`,
  (p) => `stateDiagram-v2\n  scale ${p} width\n  a --> b`,
  (p) => `stateDiagram-v2\n  hide empty description ${p}\n  a --> b`,
  (p) => `stateDiagram-v2\n  %% ${p}\n  a --> b %% ${p}`,
  (p) => `stateDiagram-v2\n  a --> b # ${p}`,
  (p) => `stateDiagram ${p}\n  a --> b`,
  (p) => `---\ntitle: "${p}"\nconfig:\n  state:\n    nodeSpacing: "${p}"\n    wrappingWidth: "${p}"\n---\nstateDiagram-v2\n  a --> b`,
  (p) => `%%{init: {"state": {"rankSpacing": "${p}"}, "themeVariables": {"fontFamily": "${p}"}}}%%\nstateDiagram-v2\n  a --> b`,
];

describe('inert state diagram output', () => {
  it('holds for every corpus input', () => {
    for (const src of loadCorpus('state', /stateDiagram/)) check(src);
  }, 120_000);

  it('holds with hostile text in every position', () => {
    let rendered = 0;
    for (const template of TEMPLATES) {
      for (const payload of PAYLOADS) {
        if (check(template(payload))) rendered++;
      }
    }
    expect(rendered).toBeGreaterThan(500);
  }, 120_000);

  it('holds for hostile option values', () => {
    for (const payload of PAYLOADS) {
      expect(check('stateDiagram-v2\n  accTitle: t\n  a --> b', { idPrefix: payload, fontFamily: payload })).toBe(true);
    }
  });

  it('holds for mutated inputs', () => {
    const corpus = loadCorpus('state', /stateDiagram/);
    const fragments = [
      ...PAYLOADS, '"', ':', ':::', '\n', '{', '}', '--', '-->', '[*]', 'state "', '" as ', 'note right of ', 'end note',
      'click a "', 'style a fill:', 'classDef c ', 'class a ', '<<fork>>', '<<choice>>', 'direction LR',
    ];
    const next = mutator(corpus, fragments, random(3));
    const count = Number(process.env.FUZZ ?? 4000);
    for (let i = 0; i < count; i++) {
      const src = next();
      if (src.length <= 4000) check(src);
    }
  }, 600_000);

  it('never emits a script-capable link', () => {
    // The last two spell characters as Mermaid entity codes, which are resolved before the check.
    for (const url of ['javascript:alert(1)', ' JaVaScRiPt:alert(1)', 'data:text/html,x', 'vbscript:x', 'jav#9;ascript:alert(1)', '#106;avascript#colon;alert(1)']) {
      const { svg, links } = render(`stateDiagram-v2\n  a --> b\n  click a "${url}" "t"\n`, options);
      expect(svg).not.toMatch(/<a\b/);
      expect(links).toEqual([]);
    }
  });

  it('never gives an unsafe href to an internal link', () => {
    const { svg } = render('stateDiagram-v2\n state "javascript:alert(1)" as a\n a --> b\n class a internal-link;', options);
    expect(svg).toContain('<a class="internal-link" data-href="javascript:alert(1)">');
    expect(svg).not.toContain(' href="javascript:');
  });

  it('does not pollute prototypes', () => {
    render('stateDiagram-v2\n  __proto__ --> constructor\n  constructor --> toString\n  class __proto__ constructor\n  classDef constructor fill:red', options);
    render('stateDiagram-v2\n  state __proto__ {\n  hasOwnProperty --> valueOf\n  }\n  note right of __proto__ : x\n  style __proto__ fill:red', options);
    render('stateDiagram-v2\n  state "x" as __proto__:polluted\n  click __proto__ "x" "y"\n', options);
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
    expect(Object.keys(Object.prototype)).toEqual([]);
  });
});
