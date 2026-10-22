import { syntaxError } from '../../errors.js';
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

// Mermaid's sankeyUtils: strip blanks at both ends of the text, then collapse runs of line
// breaks so that no row is empty. Its first step is a regex that rescans every run of blanks;
// this does the same in one pass.
export function prepareTextForParsing(text: string): string {
  let start = 0;
  let end = text.length;
  while (start < end && isBlank(text.charCodeAt(start))) start++;
  while (end > start && isBlank(text.charCodeAt(end - 1))) end--;
  return text.slice(start, end).replace(RE_LINE_BREAKS, '\n').trim();
}

export function parseSankey(src: string, db: SankeyDb): void {
  const { types, texts, starts } = tokenize(src);
  let i = 0;

  const fail = (expected: string): never => {
    const t = types[i];
    const got = t === T.STUCK ? TOKEN_NAMES[types[i - 1]] : TOKEN_NAMES[t];
    throw syntaxError('sankey', src, starts[i], `Expecting ${expected}, got '${got}'`);
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
      throw syntaxError('sankey', src, start, 'Invalid XML character in node name');
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
    const amount = field();
    const source = db.findOrCreateNode(from);
    const target = db.findOrCreateNode(to);
    db.addLink(source, target, parseFloat(amount.trim()));
    if (types[i] !== T.NEWLINE) break;
    i++;
  }
  if (types[i] === T.EOF) i++;
  if (types[i] !== T.END) fail("'NEWLINE', 'EOF'");
}
