import { decodeEntities } from './entities.js';
import { Style, type TextMeasurer } from './measurer.js';
import { iconMarkup } from './icons.js';
import { mathActive, typeset } from './math.js';
import type { MathMarkup } from '../types.js';

export interface Span {
  text: string;
  style: number;
  icon?: string;
  math?: MathMarkup;
  width: number;
}

export interface Label {
  lines: Span[][];
  widths: number[];
  width: number;
  height: number;
  size: number;
  lineHeight: number;
  // Present only when math needs extra line height.
  heights?: number[];
}

export const LINE_HEIGHT = 1.5;

const RE_BREAK = /<br\s*\/?>|\\n|\n/gi;
const RE_TAG = /<\/?([a-zA-Z][\w-]*)(?:\s[^<>]*)?\/?>/y;
const RE_ICON = /(fa[bklrs]?):fa-([\w-]+)/g;
const RE_MARKUP = /[<\\\n*_]|fa[bklrs]?:fa-/;
const TAG_STYLES = new Map([
  ['b', Style.Bold],
  ['strong', Style.Bold],
  ['i', Style.Italic],
  ['em', Style.Italic],
  ['sub', Style.Sub],
  ['sup', Style.Sup],
]);
const SHIFT = Style.Sub | Style.Sup;

// Break between any two Chinese or Japanese characters. Hangul is left out: Korean puts spaces between words.
const CJK = '\\u2e80-\\u9fff\\uf900-\\ufaff\\uff00-\\uff60';
const CLOSE = '、。，．：；！？）］｝」』】〕〉》〙〗ー…‥・ゝゞぁぃぅぇぉっゃゅょゎァィゥェォッャュョヮ,.:;!?)\\]}';
const OPEN = '（［｛「『【〔〈《〘〖([{';
const RE_CJK = new RegExp(`[${CJK}]`);
const RE_PIECE = new RegExp(
  `\\s*(?:[${OPEN}]*[${CJK}][${CLOSE}]*|[^\\s${CJK}]+[${CLOSE}]*)\\s*|\\s+`,
  'g'
);

// Unique placeholders protect TeX from markup parsing and keep expressions aligned when tags are removed.
const MARK = 0xe000;
const MAX_MARKS = 0x1900;
const RE_MATH = /\$\$(.+?)\$\$/g;
const RE_MARK = /[\ue000-\uf8ff]/;
const RE_MARKS = /([\ue000-\uf8ff])/;

interface Marks {
  tex: string[];
  math: (MathMarkup | undefined)[];
}

let marks: Marks | undefined;

const EMPTY: Label = { lines: [], widths: [], width: 0, height: 0, size: 0, lineHeight: 0 };

function dedent(text: string): string {
  const lines = text.split('\n');
  let min = Infinity;
  for (const line of lines) {
    if (line.trim() === '') continue;
    const indent = line.length - line.trimStart().length;
    if (indent < min) min = indent;
  }
  if (min === Infinity || min === 0) return text;
  return lines.map((line) => line.slice(Math.min(min, line.length - line.trimStart().length))).join('\n');
}

function plain(span: Span | undefined): span is Span {
  return span !== undefined && span.icon === undefined && span.math === undefined;
}

function pushText(line: Span[], text: string, style: number): void {
  if (text === '') return;
  if (marks !== undefined && RE_MARK.test(text)) {
    const found = marks;
    const parts = text.split(RE_MARKS);
    for (let i = 0; i < parts.length; i++) {
      if (i % 2 === 0) {
        if (parts[i] !== '') pushPlain(line, parts[i], style);
        continue;
      }
      const at = parts[i].charCodeAt(0) - MARK;
      const math = found.math[at];
      if (math) line.push({ text: '', style, math, width: math.width });
      else pushPlain(line, `$$${found.tex[at]}$$`, style);
    }
    return;
  }
  pushPlain(line, text, style);
}

function pushPlain(line: Span[], text: string, style: number): void {
  const decoded = decodeEntities(text);
  const last = line[line.length - 1];
  if (plain(last) && last.style === style) last.text += decoded;
  else line.push({ text: decoded, style, width: 0 });
}

function pushIcons(line: Span[], text: string, style: number): void {
  if (!text.includes(':fa-')) {
    pushText(line, text, style);
    return;
  }
  let last = 0;
  RE_ICON.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = RE_ICON.exec(text)) !== null) {
    const icon = `${m[1]}:fa-${m[2]}`;
    pushText(line, text.slice(last, m.index), style);
    last = m.index + m[0].length;
    if (iconMarkup(icon) !== '') {
      line.push({ text: '', style, icon, width: 0 });
    } else if (text[last] === ' ') {
      // An icon the host does not have leaves no gap, nor the space that set it off from the text.
      last++;
    } else if (last === text.length) {
      const before = line[line.length - 1];
      if (plain(before)) before.text = before.text.trimEnd();
    }
  }
  pushText(line, text.slice(last), style);
}

interface Open {
  style: number;
  // Sub/sup stack; only the innermost tag shifts text.
  shifts: number[];
}

// Splits inline HTML and, for markdown labels, emphasis markers into styled spans.
function inline(line: Span[], source: string, markdown: boolean, base: number, open: Open): void {
  let style = open.style;
  let marked = 0;
  let text = '';
  let i = 0;
  const n = source.length;
  const flush = (): void => {
    pushIcons(line, text, style | (open.shifts[open.shifts.length - 1] ?? 0));
    text = '';
  };
  while (i < n) {
    const ch = source[i];
    if (ch === '<') {
      RE_TAG.lastIndex = i;
      const m = RE_TAG.exec(source);
      if (m && m.index === i) {
        const tag = m[1].toLowerCase();
        const closing = source[i + 1] === '/';
        const bit = TAG_STYLES.get(tag) ?? 0;
        if (bit & SHIFT) {
          flush();
          const at = open.shifts.lastIndexOf(bit);
          if (!closing) open.shifts.push(bit);
          else if (at !== -1) open.shifts.splice(at, 1);
        } else if (bit) {
          flush();
          open.style = closing ? (open.style & ~bit) | (base & bit) : open.style | bit;
          style = closing ? (style & ~bit) | (base & bit) : style | bit;
        }
        i += m[0].length;
        continue;
      }
    } else if (markdown && (ch === '*' || ch === '_')) {
      const double = source[i + 1] === ch;
      const bit = double ? Style.Bold : Style.Italic;
      const len = double ? 2 : 1;
      const open = (marked & bit) === 0;
      const prev = i > 0 ? source[i - 1] : ' ';
      const next = i + len < n ? source[i + len] : ' ';
      const canOpen = open && next.trim() !== '' && source.indexOf(double ? ch + ch : ch, i + len) !== -1;
      const canClose = !open && prev.trim() !== '';
      const wordy = ch === '_' && /\w/.test(prev) && /\w/.test(next);
      if ((canOpen || canClose) && !wordy) {
        flush();
        marked = canOpen ? marked | bit : marked & ~bit;
        style = canOpen ? style | bit : (style & ~bit) | (base & bit);
        i += len;
        continue;
      }
    }
    text += ch;
    i++;
  }
  flush();
}

function measureSpans(line: Span[], measurer: TextMeasurer, size: number): number {
  let total = 0;
  for (const span of line) {
    span.width = span.icon !== undefined ? size * 1.25 : span.math ? span.math.width : measurer.width(span.text, size, span.style);
    total += span.width;
  }
  return total;
}

function wrap(line: Span[], measurer: TextMeasurer, size: number, max: number, out: Span[][], widths: number[]): void {
  let current: Span[] = [];
  let width = 0;
  const commit = (): void => {
    const last = current[current.length - 1];
    if (plain(last)) {
      const trimmed = last.text.trimEnd();
      if (trimmed !== last.text) {
        last.text = trimmed;
        const w = measurer.width(trimmed, size, last.style);
        width += w - last.width;
        last.width = w;
      }
    }
    out.push(current);
    widths.push(width);
    current = [];
    width = 0;
  };
  for (const span of line) {
    if (span.icon !== undefined || span.math) {
      const w = span.math ? span.math.width : size * 1.25;
      if (width > 0 && width + w > max) commit();
      current.push({ ...span, width: w });
      width += w;
      continue;
    }
    for (const piece of span.text.match(RE_PIECE) ?? []) {
      let part = piece;
      if (width > 0 && width + measurer.width(part.trimEnd(), size, span.style) > max) {
        commit();
        part = part.trimStart();
      }
      const last = current[current.length - 1];
      if (plain(last) && last.style === span.style) {
        last.text += part;
        last.width = measurer.width(last.text, size, last.style);
        width = 0;
        for (const s of current) width += s.width;
      } else {
        const w = measurer.width(part, size, span.style);
        current.push({ text: part, style: span.style, width: w });
        width += w;
      }
    }
  }
  if (current.length > 0 || out.length === 0) commit();
}

export function layoutLabel(
  raw: string | undefined,
  markdown: boolean,
  measurer: TextMeasurer,
  size: number,
  maxWidth: number,
  base = 0
): Label {
  if (raw === undefined || raw === '') return EMPTY;
  const lineHeight = Math.round(size * LINE_HEIGHT);

  if (mathActive() && raw.includes('$$') && !RE_MARK.test(raw)) {
    const found: Marks = { tex: [], math: [] };
    const marked = raw.replace(RE_MATH, (match: string, tex: string) => {
      if (found.tex.length === MAX_MARKS) return match;
      found.tex.push(tex);
      return String.fromCharCode(MARK + found.tex.length - 1);
    });
    if (found.tex.length > 0) {
      for (const tex of found.tex) found.math.push(typeset(decodeEntities(tex), size));
      return layoutMarkup(marked, markdown, measurer, size, maxWidth, base, lineHeight, found);
    }
  }

  if (!RE_MARKUP.test(raw) && !raw.includes('&') && !raw.includes('ﬂ')) {
    const text = raw.trim();
    const width = measurer.width(text, size, base);
    if (width <= maxWidth || !(text.includes(' ') || RE_CJK.test(text))) {
      return {
        lines: [[{ text, style: base, width }]],
        widths: [width],
        width,
        height: lineHeight,
        size,
        lineHeight,
      };
    }
    const lines: Span[][] = [];
    const widths: number[] = [];
    wrap([{ text, style: base, width }], measurer, size, maxWidth, lines, widths);
    let widest = 0;
    for (const w of widths) if (w > widest) widest = w;
    return { lines, widths, width: widest, height: lines.length * lineHeight, size, lineHeight };
  }
  return layoutMarkup(raw, markdown, measurer, size, maxWidth, base, lineHeight);
}

function layoutMarkup(
  raw: string,
  markdown: boolean,
  measurer: TextMeasurer,
  size: number,
  maxWidth: number,
  base: number,
  lineHeight: number,
  found?: Marks
): Label {
  const outer = marks;
  marks = found;
  try {
    const label = layoutLines(raw, markdown, measurer, size, maxWidth, base, lineHeight);
    return found ? withHeights(label) : label;
  } finally {
    marks = outer;
  }
}

function layoutLines(
  raw: string,
  markdown: boolean,
  measurer: TextMeasurer,
  size: number,
  maxWidth: number,
  base: number,
  lineHeight: number
): Label {
  const source = markdown ? dedent(raw.replace(/\r\n?/g, '\n')).trim() : raw.trim();
  const lines: Span[][] = [];
  const widths: number[] = [];
  let width = 0;
  // HTML tags can span explicit breaks; Markdown emphasis stays local to each line.
  const open: Open = { style: base, shifts: [] };
  for (const part of source.split(RE_BREAK)) {
    const line: Span[] = [];
    inline(line, part.trim(), markdown, base, open);
    const w = measureSpans(line, measurer, size);
    if (w > maxWidth) {
      wrap(line, measurer, size, maxWidth, lines, widths);
    } else {
      lines.push(line);
      widths.push(w);
    }
  }
  for (const w of widths) if (w > width) width = w;
  return { lines, widths, width, height: lines.length * lineHeight, size, lineHeight };
}

export function withHeights(label: Label): Label {
  let heights: number[] | undefined;
  for (let i = 0; i < label.lines.length; i++) {
    let h = label.lineHeight;
    for (const span of label.lines[i]) if (span.math) h = Math.max(h, Math.ceil(span.math.height + label.size / 4));
    if (h !== label.lineHeight && heights === undefined) heights = label.lines.map(() => label.lineHeight);
    if (heights) heights[i] = h;
  }
  if (heights === undefined) {
    return label.heights === undefined ? label : { ...label, heights: undefined, height: label.lines.length * label.lineHeight };
  }
  let height = 0;
  for (const h of heights) height += h;
  return { ...label, heights, height };
}

export function hasMath(line: Span[]): boolean {
  for (const span of line) if (span.math) return true;
  return false;
}

export function lineMiddle(label: Label, i: number): number {
  const heights = label.heights;
  if (!heights) return (i + 0.5) * label.lineHeight;
  let top = 0;
  for (let k = 0; k < i; k++) top += heights[k];
  return top + heights[i] / 2;
}

export function labelLine(label: Label, i: number): Label {
  const width = label.widths[i];
  const height = label.heights ? label.heights[i] : label.lineHeight;
  const line: Label = { lines: [label.lines[i]], widths: [width], width, height, size: label.size, lineHeight: label.lineHeight };
  if (height !== label.lineHeight) line.heights = [height];
  return line;
}
