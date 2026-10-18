import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { prepareTextForParsing } from '../../src/diagrams/sankey/parser.js';
import { cleanupComments } from '../../src/preprocess.js';
import { decodeEntities } from '../../src/text/entities.js';
import { loadCorpus, mutator, random } from '../support/corpus.js';
import { oracleParse, oracleTokens, peleParse, peleTokens } from '../support/sankey-oracle.js';

// Compares Pele's sankey lexer and parser with the parser Mermaid generates from sankey.jison:
// the same tokens and model calls for ASCII inputs. Pele additionally rejects decoded names
// forbidden in XML. Unicode names are a Pele extension, covered by the rendering tests.
// Set FUZZ to raise the number of mutated inputs.

const FRAGMENTS = [
  ' ', '  ', '\n', '\n\n', '\r\n', '\r', '\t', ',', ',,', '"', '""', '"""', '","', '"a,b"', '"a ""b"" c"', '"\n"', 'a', 'b',
  'A b', '1', '0', '-1', '1.5', '.5', '1e3', '1e', 'NaN', 'Infinity', 'x1', '10%', 'sankey', 'sankey-beta', 'sankey\n',
  'SANKEY', 'sankey-', 'sankeyx', 'sankey-betax', "'", '&', '/', '-', ';', '#', '%', '%%', '~', '\x7f', '\x1f',
  '__proto__', 'constructor', 'a,b,1', '\na,b,1', 'a,b,1\n', '"a","b","1"', ' a , b , 1 ',
];

// Mermaid's own reference implementation of the text preparation step.
const reference = (text: string): string =>
  text.replaceAll(/^[^\S\n\r]+|[^\S\n\r]+$/g, '').replaceAll(/([\n\r])+/g, '\n').trim();

const energy = readFileSync('tests/compat/sankey/upstream/energy.csv', 'utf8');
const raw = [
  ...loadCorpus('sankey', /sankey/i),
  cleanupComments('sankey-beta\n\n ' + energy),
  cleanupComments('sankey\n\n ' + energy),
  'sankey\na,b,1\nb,c,2\n"c ""d""","e,f",3.5\n',
  'sankey-beta\n\n  a , b , 10  \n\n"x",y,"7"\n',
  'SANKEY\na,b,abc\na,a,1',
];
const corpus = [...new Set([...raw, ...raw.map(reference)])];

function compare(src: string): void {
  expect(peleTokens(src), `tokens of ${JSON.stringify(src)}`).toEqual(oracleTokens(src));
  const expected = oracleParse(src);
  const actual = peleParse(src);
  const invalidName = expected.calls.some(([method, name]) =>
    method === 'findOrCreateNode' && typeof name === 'string' && [...decodeEntities(name)].some((char) => {
      const c = char.codePointAt(0)!;
      return c !== 9 && c !== 10 && c !== 13 && (c < 32 || (c >= 0xd800 && c <= 0xdfff) || c === 0xfffe || c === 0xffff);
    })
  );
  expect(actual.ok, `acceptance of ${JSON.stringify(src)}`).toBe(expected.ok && !invalidName);
  if (expected.ok && !invalidName) expect(actual.calls, `model calls of ${JSON.stringify(src)}`).toEqual(expected.calls);
  expect(prepareTextForParsing(src), `preparation of ${JSON.stringify(src)}`).toBe(reference(src));
}

describe('sankey parser against the Mermaid grammar', () => {
  it('has a corpus to work from', () => {
    expect(corpus.length).toBeGreaterThan(20);
  });

  it('agrees on every spec and documentation input', () => {
    for (const src of corpus) compare(src);
    expect(corpus.filter((src) => oracleParse(src).ok).length).toBeGreaterThan(10);
  });

  it('rejects XML-invalid entity names while keeping the reference tokens', () => {
    for (const entity of ['&#1;', '&#65534;', '&#65535;', '&#xFFFE;', '&#xFFFF;']) {
      compare(`sankey\na${entity},b,1\n`);
    }
  });

  it('agrees on mutated inputs', () => {
    const count = Number(process.env.FUZZ ?? 5000);
    const next = mutator(corpus, FRAGMENTS, random(Number(process.env.SEED ?? 7)));
    for (let i = 0; i < count; i++) {
      const src = next();
      if (src.length > 4000) continue;
      compare(src);
      // Half the time, also in the form Mermaid hands to the parser.
      if (i % 2 === 0) compare(reference(src));
    }
  }, 600_000);

  it('agrees on inputs assembled from fragments', () => {
    const count = Number(process.env.FUZZ ?? 5000) / 2;
    const rnd = random(Number(process.env.SEED ?? 7) + 1);
    for (let i = 0; i < count; i++) {
      let src = rnd() < 0.7 ? 'sankey\n' : '';
      for (let k = 1 + Math.floor(rnd() * 14); k > 0; k--) src += FRAGMENTS[Math.floor(rnd() * FRAGMENTS.length)];
      compare(src);
    }
  }, 600_000);
});
