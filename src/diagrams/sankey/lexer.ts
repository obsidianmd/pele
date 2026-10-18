import { isWord } from '../../util/chars.js';

export const enum T {
  END,
  // Not a Jison token: the reference lexer would return the same empty token forever from here.
  STUCK,
  SANKEY,
  NEWLINE,
  COMMA,
  DQUOTE,
  NON_ESCAPED_TEXT,
  ESCAPED_TEXT,
  EOF,
}

export const TOKEN_NAMES: readonly string[] = [
  '$end',
  'STUCK',
  'SANKEY',
  'NEWLINE',
  'COMMA',
  'DQUOTE',
  'NON_ESCAPED_TEXT',
  'ESCAPED_TEXT',
  'EOF',
];

export interface Tokens {
  types: number[];
  texts: string[];
  starts: number[];
}

const enum S {
  INITIAL,
  csv,
  escaped_text,
}

// RFC 4180 TEXTDATA extended to Unicode, excluding controls and invalid XML characters.
function isTextData(c: number): boolean {
  return (
    (c >= 32 && c <= 126 && c !== 34 && c !== 44) ||
    (c >= 0xa0 && c <= 0xd7ff) ||
    (c >= 0xe000 && c <= 0xfffd) ||
    (c >= 0x10000 && c <= 0x10ffff)
  );
}

export function tokenize(src: string): Tokens {
  const n = src.length;
  const types: number[] = [];
  const texts: string[] = [];
  const starts: number[] = [];
  const stack: number[] = [];
  let state: number = S.INITIAL;
  let p = 0;

  const emit = (type: number, s: number, e: number): void => {
    types.push(type);
    texts.push(src.slice(s, e));
    starts.push(s);
    p = e;
  };
  const keyword = (word: string): boolean =>
    src.slice(p, p + word.length).toLowerCase() === word && !isWord(src.charCodeAt(p + word.length));

  while (p < n) {
    const c = src.charCodeAt(p);
    const start = p;
    let q = p;
    if (state === S.escaped_text) {
      if (c === 34 && src.charCodeAt(p + 1) !== 34) {
        if (stack.length > 0) state = stack.pop()!;
        emit(T.DQUOTE, p, p + 1);
        continue;
      }
      while (q < n) {
        const d = src.codePointAt(q)!;
        if (isTextData(d) || d === 44 || d === 13 || d === 10) q += d > 0xffff ? 2 : 1;
        else if (d === 34 && src.charCodeAt(q + 1) === 34) q += 2;
        else break;
      }
      emit(T.ESCAPED_TEXT, p, q);
    } else {
      if (state === S.INITIAL && (c | 32) === 115) {
        const length = keyword('sankey-beta') ? 11 : keyword('sankey') ? 6 : 0;
        if (length > 0) {
          stack.push(state);
          state = S.csv;
          emit(T.SANKEY, p, p + length);
          continue;
        }
      }
      if (c === 10 || (c === 13 && src.charCodeAt(p + 1) === 10)) {
        emit(T.NEWLINE, p, c === 10 ? p + 1 : p + 2);
        continue;
      }
      if (c === 44) {
        emit(T.COMMA, p, p + 1);
        continue;
      }
      if (c === 34) {
        stack.push(state);
        state = S.escaped_text;
        emit(T.DQUOTE, p, p + 1);
        continue;
      }
      while (q < n) {
        const d = src.codePointAt(q)!;
        if (!isTextData(d)) break;
        q += d > 0xffff ? 2 : 1;
      }
      emit(T.NON_ESCAPED_TEXT, p, q);
    }
    // A character outside the CSV alphabet matches as empty text and is never consumed.
    if (q === start) {
      emit(T.STUCK, p, p);
      return { types, texts, starts };
    }
  }

  emit(state === S.escaped_text ? T.ESCAPED_TEXT : T.EOF, n, n);
  emit(T.END, n, n);
  return { types, texts, starts };
}
