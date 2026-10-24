import { isDigit, isHex, isSpace, isWord } from '../../util/chars.js';

export const enum T {
  END,
  ERROR,
  EOF,
  NEWLINE,
  VENN,
  TITLE,
  SET,
  UNION,
  TEXT,
  INDENT_TEXT,
  STYLE,
  BRACKET_LABEL,
  NUMERIC,
  HEXCOLOR,
  RGBCOLOR,
  RGBACOLOR,
  IDENTIFIER,
  STRING,
  COMMA,
  COLON,
}

export const TOKEN_NAMES = [
  '$end',
  'INVALID',
  'EOF',
  'NEWLINE',
  'VENN',
  'TITLE',
  'SET',
  'UNION',
  'TEXT',
  'INDENT_TEXT',
  'STYLE',
  'BRACKET_LABEL',
  'NUMERIC',
  'HEXCOLOR',
  'RGBCOLOR',
  'RGBACOLOR',
  'IDENTIFIER',
  'STRING',
  'COMMA',
  'COLON',
];

// The part of the model the lexer talks to: an indented `text` line is a different token after a
// set or union than anywhere else, and the parser is what knows which came before.
export interface IndentHost {
  getIndentMode(): boolean;
  setIndentMode(enabled: boolean): void;
}

const KEYWORDS: [string, number][] = [
  ['venn-beta', T.VENN],
  ['set', T.SET],
  ['union', T.UNION],
  ['text', T.TEXT],
  ['style', T.STYLE],
];


// Reads tokens one at a time, as Mermaid's Jison lexer for venn diagrams does: every rule
// ignores case, the first rule that matches wins, and a keyword must end at a word boundary.
export class VennLexer {
  // The text and position of the token `next` returned last.
  text = '';
  start = 0;
  private at = 0;
  private lineStart = false;
  private ended = false;

  constructor(
    private readonly src: string,
    private readonly host: IndentHost
  ) {}

  private word(at: number, word: string): boolean {
    const src = this.src;
    for (let k = 0; k < word.length; k++) {
      const c = src.charCodeAt(at + k);
      const w = word.charCodeAt(k);
      if (c !== w && (c + 32 !== w || c < 65 || c > 90)) return false;
    }
    return true;
  }

  private keyword(at: number, word: string): boolean {
    return this.word(at, word) && !isWord(this.src.charCodeAt(at + word.length));
  }

  // The end of `rgb(1, 2, 3)` or `rgba(1, 2, 3, 0.5)` whose parenthesis opens at `at`, or -1.
  private color(at: number, parts: number): number {
    const src = this.src;
    let i = at + 1;
    for (let part = 0; part < parts; part++) {
      while (isSpace(src.charCodeAt(i))) i++;
      const from = i;
      while (isDigit(src.charCodeAt(i)) || src.charCodeAt(i) === 46) i++;
      if (i === from) return -1;
      while (isSpace(src.charCodeAt(i))) i++;
      if (src.charCodeAt(i) !== (part === parts - 1 ? 41 : 44)) return -1;
      i++;
    }
    return i;
  }

  private lineEnd(from: number): number {
    const end = this.src.indexOf('\n', from);
    return end === -1 ? this.src.length : end;
  }

  next(): number {
    const src = this.src;
    const n = src.length;
    for (;;) {
      let i = this.at;
      this.start = i;
      this.text = '';
      if (i >= n) {
        if (this.ended) return T.END;
        this.ended = true;
        return T.EOF;
      }
      const c = src.charCodeAt(i);
      // A comment runs to the end of the line. It also takes the character before it along,
      // whatever that is: a line break, or the last letter of a word.
      if (
        (c === 37 && src.charCodeAt(i + 1) === 37 && src.charCodeAt(i + 2) !== 123) ||
        (c !== 125 && src.charCodeAt(i + 1) === 37 && src.charCodeAt(i + 2) === 37)
      ) {
        this.at = this.lineEnd(i + 2);
        continue;
      }
      if (this.lineStart) {
        if (c === 32 || c === 9) {
          let j = i + 1;
          while (src.charCodeAt(j) === 32 || src.charCodeAt(j) === 9) j++;
          this.at = j;
          if (this.keyword(j, 'text') && this.host.getIndentMode()) {
            // The word `text` itself is dropped; the indentation stands for it.
            this.at = j + 4;
            this.lineStart = false;
            this.text = src.slice(i, j);
            return T.INDENT_TEXT;
          }
          continue;
        }
        if (c !== 10 && c !== 13) {
          this.host.setIndentMode(false);
          this.lineStart = false;
        }
      }
      if (c === 10 || c === 13) {
        i++;
        while (src.charCodeAt(i) === 10 || src.charCodeAt(i) === 13) i++;
        this.lineStart = true;
        return this.token(T.NEWLINE, i);
      }
      if (c === 37 && src.charCodeAt(i + 1) === 37) {
        this.at = this.lineEnd(i);
        continue;
      }
      if (c === 32 || c === 9) {
        i++;
        while (src.charCodeAt(i) === 32 || src.charCodeAt(i) === 9) i++;
        this.at = i;
        continue;
      }

      if (((c | 32) >= 97 && (c | 32) <= 122) || c === 95) {
        const sep = src.charCodeAt(i + 5);
        if (this.word(i, 'title') && isSpace(sep) && sep !== 10 && sep !== 13) {
          let end = i + 6;
          while (end < n) {
            const ch = src.charCodeAt(end);
            if (ch === 35 || ch === 10 || ch === 59) break;
            end++;
          }
          if (end > i + 6) return this.token(T.TITLE, end);
        }
        for (const [word, type] of KEYWORDS) if (this.keyword(i, word)) return this.token(type, i + word.length);
        if (this.word(i, 'rgb')) {
          const alpha = (src.charCodeAt(i + 3) | 32) === 97;
          const open = i + (alpha ? 4 : 3);
          const end = src.charCodeAt(open) === 40 ? this.color(open, alpha ? 4 : 3) : -1;
          if (end !== -1) return this.token(alpha ? T.RGBACOLOR : T.RGBCOLOR, end);
        }
        i++;
        while (isWord(src.charCodeAt(i)) || src.charCodeAt(i) === 45) i++;
        return this.token(T.IDENTIFIER, i);
      }
      if (c === 91) {
        if (src.charCodeAt(i + 1) === 34) {
          const quote = src.indexOf('"', i + 2);
          if (quote === -1 || src.charCodeAt(quote + 1) !== 93) return T.ERROR;
          this.at = quote + 2;
          this.text = src.slice(i + 2, quote);
          return T.BRACKET_LABEL;
        }
        let end = i + 1;
        while (end < n && src.charCodeAt(end) !== 93 && src.charCodeAt(end) !== 34) end++;
        if (end === i + 1 || src.charCodeAt(end) !== 93) return T.ERROR;
        this.at = end + 1;
        this.text = src.slice(i + 1, end).trim();
        return T.BRACKET_LABEL;
      }
      if (isDigit(c) || c === 46 || c === 43 || c === 45) {
        if (c === 43 || c === 45) i++;
        const from = i;
        while (isDigit(src.charCodeAt(i))) i++;
        if (i > from) {
          if (src.charCodeAt(i) === 46 && isDigit(src.charCodeAt(i + 1))) {
            i += 2;
            while (isDigit(src.charCodeAt(i))) i++;
          }
        } else if (src.charCodeAt(i) === 46 && isDigit(src.charCodeAt(i + 1))) {
          i += 2;
          while (isDigit(src.charCodeAt(i))) i++;
        } else return T.ERROR;
        return this.token(T.NUMERIC, i);
      }
      if (c === 35) {
        let end = i + 1;
        while (end < i + 9 && isHex(src.charCodeAt(end))) end++;
        return end >= i + 4 ? this.token(T.HEXCOLOR, end) : T.ERROR;
      }
      if (c === 34) {
        const quote = src.indexOf('"', i + 1);
        return quote === -1 ? T.ERROR : this.token(T.STRING, quote + 1);
      }
      if (c === 44) return this.token(T.COMMA, i + 1);
      if (c === 58) return this.token(T.COLON, i + 1);
      return T.ERROR;
    }
  }

  private token(type: number, end: number): number {
    this.text = this.src.slice(this.at, end);
    this.at = end;
    return type;
  }
}
