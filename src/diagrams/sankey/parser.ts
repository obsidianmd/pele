import { inputOffset, replacements, syntaxError, type Edit, type PeleError } from '../../errors.js';
import { decodeEntities } from '../../text/entities.js';
import type { SankeyDb } from './db.js';
import { T, TOKEN_NAMES, tokenize } from './lexer.js';

const RE_LINE_BREAKS = /[\n\r]+/g;
const RE_INVALID_XML = /[\x00-\x08\x0b\x0c\x0e-\x1f\ud800-\udfff\ufffe\uffff]/u;

function isBlank(c: number): boolean {
  if (c === 10 || c === 13) return false;
  if (c < 128) return c === 32 || c === 9 || c === 11 || c === 12;
  return (
    c === 0xa0 ||
    c === 0x1680 ||
    (c >= 0x2000 && c <= 0x200a) ||
    c === 0x2028 ||
    c === 0x2029 ||
    c === 0x202f ||
    c === 0x205f ||
    c === 0x3000 ||
    c === 0xfeff
  );
}

function trimRows(text: string, edits: Edit[]): string {
  let end = text.length;
  while (end > 0 && isBlank(text.charCodeAt(end - 1))) end--;
  let out = '';
  let kept = 0;
  let quoted = false;
  for (let i = 0; i < end; ) {
    const c = text.charCodeAt(i);
    if (quoted) {
      if (c === 34) {
        if (text.charCodeAt(i + 1) === 34) i++;
        else quoted = false;
      }
      i++;
    } else if (c === 34) {
      quoted = true;
      i++;
    } else if (isBlank(c)) {
      let j = i + 1;
      while (isBlank(text.charCodeAt(j))) j++;
      const p = text.charCodeAt(i - 1);
      const q = text.charCodeAt(j);
      // Preserve blank first fields, which Mermaid accepts as empty names.
      if (i === 0 || q === 10 || q === 13 || ((p === 10 || p === 13) && q !== 44)) {
        out += text.slice(kept, i);
        edits.push([i, j, 0]);
        kept = j;
      }
      i = j;
    } else {
      i++;
    }
  }
  if (end < text.length) edits.push([end, text.length, 0]);
  return out + text.slice(kept, end);
}

// Unlike Mermaid's sankeyUtils, also trim row edges outside quoted fields.
export function prepareTextForParsing(text: string, steps?: Edit[][]): string {
  const edits: Edit[] = [];
  const rows = trimRows(text, edits);
  const collapsed = rows.replace(RE_LINE_BREAKS, '\n');
  const trimmed = collapsed.trim();
  if (steps !== undefined) {
    const lead = collapsed.length - collapsed.trimStart().length;
    steps.push(
      edits,
      replacements(rows, RE_LINE_BREAKS, 1),
      [[0, lead, 0], [lead + trimmed.length, collapsed.length, 0]]
    );
  }
  return trimmed;
}

// Report errors in `source`, the text before prepareTextForParsing.
export function parseSankey(src: string, db: SankeyDb, source = src): void {
  const { types, texts, starts } = tokenize(src);
  let i = 0;

  const error = (at: number, detail: string): PeleError => {
    const steps: Edit[][] = [];
    if (source !== src) prepareTextForParsing(source, steps);
    // Map EOF before the trimmed trailing blanks.
    const offset = at > 0 && at >= src.length ? inputOffset(steps, src.length - 1) + 1 : inputOffset(steps, at);
    return syntaxError('sankey', source, offset, detail);
  };

  const fail = (expected: string): never => {
    const t = types[i];
    const got = t === T.STUCK ? TOKEN_NAMES[types[i - 1]] : TOKEN_NAMES[t];
    throw error(starts[i], `Expecting ${expected}, got '${got}'`);
  };

  const expect = (type: number, also = ''): void => {
    if (types[i] !== type) fail(`'${TOKEN_NAMES[type]}'${also}`);
    i++;
  };

  const field = (): string => {
    if (types[i] === T.NON_ESCAPED_TEXT) return texts[i++];
    if (types[i] !== T.DQUOTE) fail("'DQUOTE', 'NON_ESCAPED_TEXT'");
    i++;
    if (types[i] !== T.ESCAPED_TEXT) fail("'ESCAPED_TEXT'");
    const text = texts[i++];
    expect(T.DQUOTE);
    return text;
  };

  const name = (): string => {
    const start = starts[i];
    const text = field().trim().replaceAll('""', '"');
    // Entity codes can encode characters excluded by the lexer.
    if (RE_INVALID_XML.test(decodeEntities(text))) {
      throw error(start, 'Invalid XML character in node name');
    }
    return text;
  };

  expect(T.SANKEY);
  expect(T.NEWLINE);
  while (true) {
    const from = name();
    expect(T.COMMA, ", 'NEWLINE', 'EOF'");
    const to = name();
    expect(T.COMMA, ", 'NEWLINE', 'EOF'");
    const start = starts[i];
    // Keep Mermaid's numeric prefixes, but reject non-finite values.
    // Name the refused value: a pasted CSV header row fails here, and the
    // name is what tells the reader which row to drop.
    const raw = field().trim();
    const value = parseFloat(raw);
    if (!Number.isFinite(value)) {
      const shown = raw.length > 32 ? `${raw.slice(0, 32)}...` : raw;
      throw error(start, `Expecting a number, got '${shown}'`);
    }
    const source = db.findOrCreateNode(from);
    const target = db.findOrCreateNode(to);
    db.addLink(source, target, value);
    if (types[i] !== T.NEWLINE) break;
    i++;
  }
  if (types[i] === T.EOF) i++;
  if (types[i] !== T.END) fail("'NEWLINE', 'EOF'");
}
