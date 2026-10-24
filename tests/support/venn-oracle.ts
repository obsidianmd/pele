import { resolve } from 'node:path';
import type { VennDb } from '../../src/diagrams/venn/db.js';
import { T, TOKEN_NAMES, VennLexer, type IndentHost } from '../../src/diagrams/venn/lexer.js';
import { parseVenn } from '../../src/diagrams/venn/parser.js';
import { createOracle, recordingYy, type Outcome, type Pair } from './oracle.js';

export const oracle = createOracle(resolve('tests/compat/venn/upstream/venn.jison'));

// The lexer asks the model whether an indented `text` belongs to the set before it. With `indent`
// given the answer is fixed, to compare the lexers alone; without it the recorder answers the way
// Mermaid's DB does, from the statements the parser has reported.
function recorder(indent?: boolean) {
  let mode = false;
  let current: unknown;
  return recordingYy(oracle.methods, {
    getIndentMode: () => indent ?? mode,
    setIndentMode: ((enabled: boolean) => {
      mode = enabled;
    }) as never,
    addSubsetData: ((ids: string[]) => {
      current = ids;
    }) as never,
    getCurrentSets: () => current,
  });
}

export function oracleTokens(src: string, indent: boolean): Pair[] {
  return oracle.tokens(src, recorder(indent).yy);
}

export function peleTokens(src: string, indent: boolean): Pair[] {
  const lexer = new VennLexer(src, recorder(indent).yy as unknown as IndentHost);
  const out: Pair[] = [];
  for (let i = 0; i < 1e6; i++) {
    const type = lexer.next();
    out.push([TOKEN_NAMES[type], type === T.ERROR ? '' : lexer.text]);
    if (type === T.END || type === T.ERROR) break;
  }
  return out;
}

export function oracleParse(src: string): Outcome {
  const { yy, calls } = recorder();
  const result = oracle.parse(src, yy);
  return { ok: result.ok, calls, error: result.error };
}

export function peleParse(src: string): Outcome {
  const { yy, calls } = recorder();
  try {
    parseVenn(src, yy as unknown as VennDb);
    return { ok: true, calls };
  } catch (e) {
    return { ok: false, calls, error: String((e as Error).message) };
  }
}

// Remove Mermaid's preceding-character comment rule. Keep the marker-only rules.
{
  const rules = (oracle.parser.lexer as unknown as { rules: RegExp[] }).rules;
  const comments = rules.filter((rule) => rule.source === String.raw`^(?:[^\}]%%[^\n]*)`);
  if (comments.length !== 1) throw new Error('Expected one Venn preceding-character comment rule');
  rules[rules.indexOf(comments[0])] = /(?!)/;
}
