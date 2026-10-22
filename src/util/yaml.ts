// A small YAML reader covering what Mermaid feeds to js-yaml with the JSON schema:
// block and flow collections, quoted and plain scalars, and block scalars.

export type YamlValue = null | boolean | number | string | YamlValue[] | { [key: string]: YamlValue };

// Thrown when a quoted scalar or flow collection runs past the text read so far.
// Not an Error, so that throwing it does not capture a stack trace.
class Incomplete {
  constructor(readonly message: string) {}
}

const MAX_DEPTH = 64;

function assign(target: { [key: string]: YamlValue }, key: string, value: YamlValue): void {
  if (key === '__proto__') {
    Object.defineProperty(target, key, { value, enumerable: true, writable: true, configurable: true });
  } else {
    target[key] = value;
  }
}

class Reader {
  lines: string[];
  i = 0;

  constructor(src: string) {
    this.lines = (src.includes('\r') ? src.replace(/\r\n?/g, '\n') : src).split('\n');
  }

  skipBlank(): void {
    while (this.i < this.lines.length) {
      const t = this.lines[this.i].trim();
      if (t !== '' && t[0] !== '#' && t !== '---') break;
      this.i++;
    }
  }

  indent(): number {
    const line = this.lines[this.i];
    let k = 0;
    while (k < line.length && line[k] === ' ') k++;
    if (line[k] === '\t') throw new Error('YAML: tabs are not allowed for indentation');
    return k;
  }
}

const RE_INT = /^[-+]?(?:0|[1-9][0-9]*)$/;
const RE_HEX = /^[-+]?0x[0-9a-fA-F]+$/;
const RE_OCT = /^[-+]?0o[0-7]+$/;
const RE_BIN = /^[-+]?0b[01]+$/;
const RE_FLOAT = /^[-+]?(?:[0-9][0-9]*(?:\.[0-9]*)?|\.[0-9]+)(?:[eE][-+]?[0-9]+)?$/;
const RE_KEY_START = /[\s#:,[\]{}&*!|>'"%@`]/;

function isBlank(ch: string | undefined): boolean {
  return ch === ' ' || ch === '\t' || ch === '\n' || ch === '\r';
}

// Splits `key: rest` at the start of a line. Returns the raw key and the offset where the value starts.
function splitKey(line: string): { key: string; length: number } | null {
  const first = line[0];
  let end: number;
  let colon: number;
  if (first === '"' || first === "'") {
    let i = 1;
    while (true) {
      if (i >= line.length) return null;
      const c = line[i];
      if (first === '"' && c === '\\') {
        i += 2;
      } else if (c === first) {
        if (first === '"' || line[i + 1] !== "'") break;
        i += 2;
      } else {
        i++;
      }
    }
    end = i + 1;
    colon = end;
    while (isBlank(line[colon])) colon++;
    if (line[colon] !== ':') return null;
  } else {
    if (first === undefined || RE_KEY_START.test(first)) return null;
    if (first === '-' && (line.length < 2 || isBlank(line[1]) || line[1] === ':' || line[1] === '#')) return null;
    colon = 1;
    while (colon < line.length && line[colon] !== ':' && line[colon] !== '#') colon++;
    if (line[colon] !== ':') return null;
    end = colon;
    while (isBlank(line[end - 1])) end--;
  }
  let length = colon + 1;
  if (length < line.length && !isBlank(line[length])) return null;
  while (isBlank(line[length])) length++;
  return { key: line.slice(0, end), length };
}

function scalar(raw: string): YamlValue {
  const s = raw.trim();
  if (s === '' || s === '~' || s === 'null' || s === 'Null' || s === 'NULL') return null;
  if (s === 'true' || s === 'True' || s === 'TRUE') return true;
  if (s === 'false' || s === 'False' || s === 'FALSE') return false;
  const c = s[0];
  if (c !== '-' && c !== '+' && c !== '.' && (c < '0' || c > '9')) return s;
  if (RE_INT.test(s) || RE_FLOAT.test(s)) return Number(s);
  if (RE_HEX.test(s) || RE_OCT.test(s) || RE_BIN.test(s)) {
    const neg = s[0] === '-';
    const v = Number(neg || s[0] === '+' ? s.slice(1) : s);
    return neg ? -v : v;
  }
  if (/^[-+]?\.(?:inf|Inf|INF)$/.test(s)) return s[0] === '-' ? -Infinity : Infinity;
  if (/^\.(?:nan|NaN|NAN)$/.test(s)) return NaN;
  return s;
}

const ESCAPES: Record<string, string> = {
  '0': '\0',
  a: '\x07',
  b: '\b',
  t: '\t',
  n: '\n',
  v: '\v',
  f: '\f',
  r: '\r',
  e: '\x1b',
  ' ': ' ',
  '"': '"',
  '/': '/',
  '\\': '\\',
  N: '\x85',
  _: '\xa0',
  L: '\u2028',
  P: '\u2029',
};

// Folds the line breaks of a scalar: blanks around a break go, one break becomes a space, and
// each further break stays. The lines are trimmed by hand, because a pattern for blanks before
// a line break rescans a long run of blanks from every one of them.
function fold(text: string): string {
  if (!text.includes('\n')) return text;
  const lines = text.split('\n');
  const last = lines.length - 1;
  for (let i = 0; i <= last; i++) {
    const line = lines[i];
    let from = 0;
    let to = line.length;
    if (i > 0) while (from < to && (line.charCodeAt(from) === 32 || line.charCodeAt(from) === 9)) from++;
    if (i < last) while (to > from && (line.charCodeAt(to - 1) === 32 || line.charCodeAt(to - 1) === 9)) to--;
    lines[i] = line.slice(from, to);
  }
  return lines.join('\n').replace(/\n+/g, (m) => (m.length === 1 ? ' ' : '\n'.repeat(m.length - 1)));
}

function unquoteDouble(body: string): string {
  if (!body.includes('\\')) return fold(body);
  let out = '';
  const s = fold(body.replace(/\\\n[ \t]*/g, ''));
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (ch !== '\\') {
      out += ch;
      continue;
    }
    const e = s[++i];
    if (e === 'x' || e === 'u' || e === 'U') {
      const len = e === 'x' ? 2 : e === 'u' ? 4 : 8;
      out += String.fromCodePoint(parseInt(s.slice(i + 1, i + 1 + len), 16));
      i += len;
    } else if (e in ESCAPES) {
      out += ESCAPES[e];
    } else {
      throw new Error('YAML: unknown escape sequence');
    }
  }
  return out;
}

function skip(s: string, pos: number, commas: boolean): number {
  while (pos < s.length) {
    const c = s[pos];
    if (c === ' ' || c === '\n' || c === '\t' || c === '\r' || (commas && c === ',')) {
      pos++;
    } else if (c === '#' && (pos === 0 || /\s/.test(s[pos - 1]))) {
      const nl = s.indexOf('\n', pos);
      pos = nl === -1 ? s.length : nl;
    } else {
      break;
    }
  }
  return pos;
}

// Entries of a flow collection are separated by exactly one comma, as js-yaml requires.
function entryStart(ch: string, separated: boolean): void {
  if (!separated) throw new Error('YAML: missed comma between flow collection entries');
  if (ch === ',') throw new Error("YAML: expected the node content, but found ','");
}

// Parses a flow value starting at s[pos]; returns the value and the index after it.
function flow(s: string, pos: number, stops: string, depth = 0): [YamlValue, number] {
  if (depth > MAX_DEPTH) throw new Error('YAML: nesting is too deep');
  pos = skip(s, pos, false);
  const ch = s[pos];
  if (ch === '{') {
    const out: { [key: string]: YamlValue } = {};
    pos++;
    let separated = true;
    while (true) {
      pos = skip(s, pos, false);
      if (pos >= s.length) throw new Incomplete('YAML: unexpected end of the stream within a flow collection');
      if (s[pos] === '}') return [out, pos + 1];
      entryStart(s[pos], separated);
      let key: YamlValue;
      [key, pos] = flow(s, pos, ':,}', depth + 1);
      pos = skip(s, pos, false);
      let value: YamlValue = null;
      if (s[pos] === ':') [value, pos] = flow(s, pos + 1, ',}', depth + 1);
      assign(out, String(key), value);
      pos = skip(s, pos, false);
      separated = s[pos] === ',';
      if (separated) pos++;
    }
  }
  if (ch === '[') {
    const out: YamlValue[] = [];
    pos++;
    let separated = true;
    while (true) {
      pos = skip(s, pos, false);
      if (pos >= s.length) throw new Incomplete('YAML: unexpected end of the stream within a flow collection');
      if (s[pos] === ']') return [out, pos + 1];
      entryStart(s[pos], separated);
      let value: YamlValue;
      [value, pos] = flow(s, pos, ',]', depth + 1);
      out.push(value);
      pos = skip(s, pos, false);
      separated = s[pos] === ',';
      if (separated) pos++;
    }
  }
  if (ch === '"') {
    let end = pos + 1;
    while (end < s.length && s[end] !== '"') end += s[end] === '\\' ? 2 : 1;
    if (end >= s.length) throw new Incomplete('YAML: unexpected end of the stream within a double quoted scalar');
    return [unquoteDouble(s.slice(pos + 1, end)), end + 1];
  }
  if (ch === "'") {
    let end = pos + 1;
    while (end < s.length) {
      if (s[end] === "'") {
        if (s[end + 1] !== "'") break;
        end++;
      }
      end++;
    }
    if (end >= s.length) throw new Incomplete('YAML: unexpected end of the stream within a single quoted scalar');
    return [fold(s.slice(pos + 1, end)).replace(/''/g, "'"), end + 1];
  }
  let end = pos;
  while (end < s.length) {
    const c = s[end];
    if (stops.includes(c) && (c !== ':' || end + 1 >= s.length || /[\s,[\]{}]/.test(s[end + 1]))) break;
    if (c === '#' && end > pos && /\s/.test(s[end - 1])) {
      const nl = s.indexOf('\n', end);
      return [scalar(fold(s.slice(pos, end).trim())), nl === -1 ? s.length : nl];
    }
    end++;
  }
  return [scalar(fold(s.slice(pos, end).trim())), end];
}

function stripComment(s: string): string {
  let quote = '';
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (quote) {
      if (c === '\\' && quote === '"') i++;
      else if (c === quote) quote = '';
    } else if (c === '"' || c === "'") {
      quote = c;
    } else if (c === '#' && (i === 0 || s[i - 1] === ' ' || s[i - 1] === '\t')) {
      return s.slice(0, i);
    }
  }
  return s;
}

function blockScalar(r: Reader, header: string, parentIndent: number): string {
  const folded = header[0] === '>';
  const chomp = header.includes('-') ? '-' : header.includes('+') ? '+' : '';
  const explicit = /[1-9]/.exec(header);
  let indent = explicit ? parentIndent + Number(explicit[0]) : -1;
  const out: string[] = [];
  while (r.i < r.lines.length) {
    const line = r.lines[r.i];
    if (line.trim() === '') {
      out.push('');
      r.i++;
      continue;
    }
    const k = line.length - line.trimStart().length;
    if (indent === -1) {
      if (k <= parentIndent) break;
      indent = k;
    }
    if (k < indent) break;
    out.push(line.slice(indent));
    r.i++;
  }
  let trailing = 0;
  while (out.length > 0 && out[out.length - 1] === '') {
    out.pop();
    trailing++;
  }
  let text: string;
  if (folded) {
    text = '';
    for (let i = 0; i < out.length; i++) {
      const cur = out[i];
      if (i > 0) {
        const prev = out[i - 1];
        if (cur === '') text += '\n';
        else if (prev !== '') text += /^[ \t]/.test(prev) || /^[ \t]/.test(cur) ? '\n' : ' ';
      }
      text += cur;
    }
  } else {
    text = out.join('\n');
  }
  if (out.length === 0) return chomp === '+' ? '\n'.repeat(trailing) : '';
  if (chomp === '-') return text;
  if (chomp === '+') return text + '\n'.repeat(trailing + 1);
  return text + '\n';
}

function inlineValue(r: Reader, rest: string, indent: number): YamlValue {
  const first = rest[0];
  if (first === '|' || first === '>') {
    if (/^[|>][-+0-9]*\s*(?:#.*)?$/.test(rest)) return blockScalar(r, rest, indent);
  }
  if (first === '{' || first === '[' || first === '"' || first === "'") {
    // The value may continue on later lines. Read them in growing batches until it closes.
    const start = r.i;
    let text = rest;
    let taken = 0;
    let batch = 1;
    while (true) {
      try {
        const [value, end] = flow(text, 0, '');
        let used = 0;
        for (let k = text.indexOf('\n'); k !== -1 && k < end; k = text.indexOf('\n', k + 1)) used++;
        const lineEnd = text.indexOf('\n', end);
        if (stripComment(text.slice(end, lineEnd === -1 ? text.length : lineEnd)).trim() !== '') {
          throw new Error('YAML: unexpected content after a value');
        }
        r.i = start + used;
        return value;
      } catch (err) {
        if (!(err instanceof Incomplete)) throw err;
        if (start + taken >= r.lines.length) throw new Error(err.message);
        const more = r.lines.slice(start + taken, start + taken + batch);
        text += '\n' + more.join('\n');
        taken += more.length;
        batch *= 2;
      }
    }
  }
  let text = stripComment(rest).trim();
  while (r.i < r.lines.length) {
    const line = r.lines[r.i];
    if (line.trim() === '') {
      let j = r.i;
      while (j < r.lines.length && r.lines[j].trim() === '') j++;
      if (j >= r.lines.length || r.lines[j].length - r.lines[j].trimStart().length <= indent) break;
      text += '\n'.repeat(j - r.i);
      r.i = j;
      continue;
    }
    if (line.length - line.trimStart().length <= indent) break;
    const more = stripComment(line).trim();
    text += (text.endsWith('\n') ? '' : ' ') + more;
    r.i++;
  }
  return scalar(text);
}

function block(r: Reader, minIndent: number, depth = 0): YamlValue {
  if (depth > MAX_DEPTH) throw new Error('YAML: nesting is too deep');
  r.skipBlank();
  if (r.i >= r.lines.length) return null;
  const indent = r.indent();
  if (indent < minIndent) return null;
  const line = r.lines[r.i].slice(indent);

  if (line === '-' || line.startsWith('- ')) {
    const out: YamlValue[] = [];
    while (r.i < r.lines.length) {
      r.skipBlank();
      if (r.i >= r.lines.length || r.indent() !== indent) break;
      const cur = r.lines[r.i].slice(indent);
      if (cur !== '-' && !cur.startsWith('- ')) break;
      const rest = cur.slice(1);
      const pad = rest.length - rest.trimStart().length + 1;
      const body = stripComment(rest).trim();
      if (body === '') {
        r.i++;
        out.push(block(r, indent + 1, depth + 1));
      } else if (splitKey(body) !== null) {
        r.lines[r.i] = ' '.repeat(indent + pad) + rest.trimStart();
        out.push(block(r, indent + pad, depth + 1));
      } else {
        r.i++;
        out.push(inlineValue(r, rest.trim(), indent));
      }
    }
    return out;
  }

  if (splitKey(line) === null) {
    r.i++;
    return inlineValue(r, line.trim(), indent - 1);
  }

  const out: { [key: string]: YamlValue } = {};
  while (r.i < r.lines.length) {
    r.skipBlank();
    if (r.i >= r.lines.length) break;
    const k = r.indent();
    if (k < indent) break;
    if (k > indent) throw new Error('YAML: bad indentation of a mapping entry');
    const cur = r.lines[r.i].slice(indent);
    const km = splitKey(cur);
    if (!km) throw new Error('YAML: can not read a block mapping entry');
    const key = String(flow(km.key, 0, '')[0]);
    const rest = cur.slice(km.length);
    r.i++;
    if (stripComment(rest).trim() === '') {
      r.skipBlank();
      if (r.i < r.lines.length) {
        const next = r.indent();
        const nextLine = r.lines[r.i].slice(next);
        const seq = nextLine === '-' || nextLine.startsWith('- ');
        assign(out, key, next > indent || (seq && next === indent) ? block(r, seq ? indent : indent + 1, depth + 1) : null);
      } else {
        assign(out, key, null);
      }
    } else {
      assign(out, key, inlineValue(r, rest.trim(), indent));
    }
  }
  return out;
}

export function parseYaml(src: string): YamlValue {
  const trimmed = src.trim();
  if (trimmed[0] === '{' || trimmed[0] === '[') {
    try {
      const [value, end] = flow(trimmed, 0, '');
      if (skip(trimmed, end, false) === trimmed.length) return value;
    } catch (err) {
      if (err instanceof Incomplete) throw new Error(err.message);
      throw err;
    }
  }
  const r = new Reader(src);
  const value = block(r, 0);
  r.skipBlank();
  if (r.i < r.lines.length && r.lines[r.i].trim() !== '...') {
    throw new Error('YAML: end of the stream or a document separator is expected');
  }
  return value;
}
