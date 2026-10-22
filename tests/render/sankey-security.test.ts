import { describe, expect, it } from 'vitest';
import { PeleError, render } from '../../src/index.js';
import { SankeyDb } from '../../src/diagrams/sankey/db.js';
import { renderSankey } from '../../src/diagrams/sankey/render.js';
import type { Config } from '../../src/preprocess.js';
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

const BODY = 'a,b,2\nb,c,1\n';
const quoted = (p: string): string => `"${p.replaceAll('"', '""')}"`;
const json = (p: string): string => JSON.stringify(p);

const TEMPLATES: ((p: string) => string)[] = [
  (p) => `sankey\n${p},b,1\n`,
  (p) => `sankey\na,${p},1\n`,
  (p) => `sankey\na,b,${p}\n`,
  (p) => `sankey\n${quoted(p)},b,1\n${BODY}`,
  (p) => `sankey\na,${quoted(p)},1\n${quoted(p)},c,2\n`,
  (p) => `sankey\na,b,${quoted(p)}\n`,
  (p) => `sankey-beta\n"${p}","${p}2",1\n`,
  (p) => `sankey ${p}\n${BODY}`,
  (p) => `sankey\n%% ${p}\n${BODY}`,
  (p) => `---\ntitle: ${json(p)}\n---\nsankey\n${BODY}`,
  (p) => `---\nconfig:\n  sankey:\n    prefix: ${json(p)}\n    suffix: ${json(p)}\n---\nsankey\n${BODY}`,
  (p) => `---\nconfig:\n  sankey:\n    linkColor: ${json(p)}\n---\nsankey\n${BODY}`,
  (p) => `---\nconfig:\n  sankey:\n    nodeColors:\n      a: ${json(p)}\n      ${json(p)}: red\n---\nsankey\n${BODY}`,
  (p) => `---\nconfig:\n  sankey:\n    nodeAlignment: ${json(p)}\n    labelStyle: ${json(p)}\n    showValues: ${json(p)}\n---\nsankey\n${BODY}`,
  (p) => `---\nconfig:\n  sankey:\n    width: ${json(p)}\n    height: ${json(p)}\n    nodeWidth: ${json(p)}\n    nodePadding: ${json(p)}\n---\nsankey\n${BODY}`,
  (p) => `---\nconfig:\n  sankey: ${json(p)}\n---\nsankey\n${BODY}`,
  (p) => `%%{init: {"sankey": {"prefix": ${json(p)}, "linkColor": ${json(p)}, "nodeColors": {"a": ${json(p)}}}, "themeVariables": {"fontFamily": ${json(p)}}}}%%\nsankey\n${BODY}`,
];

describe('inert sankey output', () => {
  const corpus = loadCorpus('sankey', /sankey/i);

  it('holds for every corpus input', () => {
    for (const src of corpus) check(src);
  }, 120_000);

  it('holds with hostile text in every position', () => {
    let rendered = 0;
    for (const template of TEMPLATES) {
      for (const payload of PAYLOADS) {
        if (check(template(payload))) rendered++;
      }
    }
    expect(rendered).toBeGreaterThan(450);
  }, 120_000);

  it('escapes what it shows', () => {
    const { svg } = render('sankey\n<script>alert(1)</script>,"<img src=x onerror=alert(1)>",1\n', options);
    expect(svg).not.toContain('<script');
    expect(svg).not.toContain('<img');
    expect(svg).toContain('data-id="&lt;script&gt;alert(1)&lt;/script&gt;"');
  });

  it('escapes markup in Unicode node names', () => {
    const from = '<script>Доход 🏠</script>';
    const to = '収入" onload="alert(1)';
    const src = `sankey\n${quoted(from)},${quoted(to)},1\n`;
    expect(check(src)).toBe(true);
    const { svg } = render(src, options);
    expect(svg).toContain('data-id="&lt;script&gt;Доход 🏠&lt;/script&gt;"');
    expect(svg).toContain('data-id="収入&quot; onload=&quot;alert(1)"');
  });

  it('holds for hostile option values and configuration given by the host', () => {
    for (const payload of PAYLOADS) {
      const sankey = {
        prefix: payload,
        suffix: payload,
        linkColor: payload,
        nodeAlignment: payload,
        labelStyle: payload,
        nodeColors: { a: payload, b: `red;${payload}` },
        width: payload,
        height: payload,
      };
      expect(check(`sankey\n${BODY}`, { idPrefix: payload, fontFamily: payload, config: { sankey } })).toBe(true);
    }
  }, 120_000);

  it('holds for extreme numbers in the configuration', () => {
    for (const value of [0, -1, 1e-9, 1e9, Infinity, -Infinity, NaN]) {
      const sankey = { width: value, height: value, nodeWidth: value, nodePadding: value };
      expect(check(`sankey\n${BODY}`, { config: { sankey } as unknown as Config })).toBe(true);
      expect(check(`sankey\n${BODY}`, { fontSize: value === 0 ? 1 : Math.abs(value) > 1e6 ? 16 : Math.abs(value) || 16, padding: Number.isFinite(value) ? Math.abs(value) % 100 : 8 })).toBe(true);
    }
  });

  it('holds for a model filled in directly, which the grammar would not allow', () => {
    for (const payload of PAYLOADS) {
      const db = new SankeyDb();
      db.title = payload;
      db.accTitle = payload;
      db.accDescr = payload;
      const a = db.findOrCreateNode(payload);
      const b = db.findOrCreateNode(`${payload}é\n\t`);
      const c = db.findOrCreateNode('');
      db.addLink(a, b, 1);
      db.addLink(b, c, NaN);
      db.addLink(a, c, Infinity);
      db.addLink(a, c, -1);
      assertInert(renderSankey(db, { sankey: { prefix: payload, linkColor: payload } }, options).svg, JSON.stringify(payload));
    }
    assertInert(renderSankey(new SankeyDb(), {}, options).svg, 'empty model');
  });

  it('holds for mutated inputs', () => {
    const next = mutator(corpus, [...PAYLOADS, '"', '""', ',', '\n', 'a,b,1', '1e308', '-1', 'NaN', 'sankey\n', 'linkColor: ', 'prefix: '], random(3));
    const count = Number(process.env.FUZZ ?? 3000);
    let rendered = 0;
    for (let i = 0; i < count; i++) {
      const src = next();
      if (src.length <= 4000 && check(src)) rendered++;
    }
    expect(rendered).toBeGreaterThan(count / 8);
  }, 600_000);

  it('does not pollute prototypes', () => {
    render('---\nconfig:\n  sankey:\n    nodeColors:\n      __proto__: red\n      constructor: blue\n---\nsankey\n__proto__,constructor,1\nconstructor,toString,2\nhasOwnProperty,__proto__,3\n', options);
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
    expect(Object.keys(Object.prototype)).toEqual([]);
  });
});
