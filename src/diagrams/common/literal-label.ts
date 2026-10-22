import { esc, labelSvg, num, sharedStyle, spanStyle, textStyle } from '../../svg/builder.js';
import { withHeights, type Label } from '../../text/label.js';
import type { TextMeasurer } from '../../text/measurer.js';

const SPACE = /\s/;

// Literal labels, including filenames and protocol fields, must retain every character but the
// spaces a line breaks at. Long words can break between code points; measurement stays bounded
// by one line of text.
export function literalLabel(text: string, measurer: TextMeasurer, size: number, room: number, style = 0): Label {
  const lines: string[] = [];
  for (const raw of text.split('\n')) {
    const chars = Array.from(raw);
    if (chars.length === 0) lines.push('');
    let from = 0;
    while (from < chars.length) {
      const fits = (length: number): boolean => measurer.width(chars.slice(from, from + length).join(''), size, style) <= room;
      let hi = 1;
      while (hi < chars.length - from && fits(hi)) hi = Math.min(chars.length - from, hi * 2);
      let lo = 1;
      while (lo < hi) {
        const mid = Math.ceil((lo + hi) / 2);
        if (fits(mid)) lo = mid;
        else hi = mid - 1;
      }
      let take = lo;
      const wraps = from + take < chars.length;
      if (wraps && !SPACE.test(chars[from + take])) {
        for (let i = take - 1; i > 0; i--) {
          if (SPACE.test(chars[from + i])) { take = i + 1; break; }
        }
      }
      const line = chars.slice(from, from + take).join('');
      lines.push(wraps ? line.trimEnd() || line : line);
      from += take;
      while (wraps && from < chars.length && SPACE.test(chars[from])) from++;
    }
  }
  if (text === '') lines.length = 0;
  const widths = lines.map(line => measurer.width(line, size, style));
  let width = 0;
  for (const w of widths) width = Math.max(width, w);
  const lineHeight = Math.round(size * 1.5);
  return { lines: lines.map((line, i) => [{ text: line, style, width: widths[i] }]), widths, width, height: lines.length * lineHeight, size, lineHeight };
}

export function breakLabel(label: Label, measurer: TextMeasurer, room: number): Label {
  if (label.width <= room) return label;
  const lines: Label['lines'] = [], widths: number[] = [];
  for (let i = 0; i < label.lines.length; i++) {
    if (label.widths[i] <= room) { lines.push(label.lines[i]); widths.push(label.widths[i]); continue; }
    let current: Label['lines'][number] = [], width = 0;
    const commit = (): void => { lines.push(current); widths.push(width); current = []; width = 0; };
    for (const span of label.lines[i]) {
      if (span.icon !== undefined || span.math) {
        if (current.length && width + span.width > room) commit();
        current.push(span); width += span.width;
        continue;
      }
      for (const char of Array.from(span.text)) {
        let last: Label['lines'][number][number] | undefined = current[current.length - 1];
        const joined = last && last.icon === undefined && last.math === undefined && last.style === span.style;
        const nextWidth = measurer.width(joined ? last!.text + char : char, label.size, span.style);
        let added = nextWidth - (joined ? last!.width : 0);
        if (current.length && width + added > room) { commit(); last = undefined; added = measurer.width(char, label.size, span.style); }
        if (last && last.icon === undefined && last.math === undefined && last.style === span.style) { last.text += char; last.width += added; }
        else current.push({ text: char, style: span.style, width: added });
        width += added;
      }
    }
    if (current.length || !label.lines[i].length) commit();
  }
  let width = 0;
  for (const w of widths) width = Math.max(width, w);
  const broken = { ...label, lines, widths, width, height: lines.length * label.lineHeight };
  return label.heights ? withHeights(broken) : broken;
}

// Writes a label with every line starting at x. A line is anchored at its start and keeps its
// spaces, so that where it begins does not depend on how its text was measured.
export function leftLabelSvg(label: Label, x: number, top: number, attrs: string): string {
  const shared = sharedStyle(label);
  const open = '<text' + textStyle(attrs, shared);
  let body = '';
  for (let i = 0; i < label.lines.length; i++) {
    const spans = label.lines[i];
    const cy = top + (i + 0.5) * label.lineHeight;
    if (spans.some(span => span.icon !== undefined)) {
      const width = label.widths[i];
      body += labelSvg({ ...label, lines: [spans], widths: [width], width, height: label.lineHeight }, x + width / 2, cy, attrs);
      continue;
    }
    let text = '';
    for (const span of spans) {
      const own = spanStyle(span.style & ~shared);
      text += own ? `<tspan${own}>${esc(span.text)}</tspan>` : esc(span.text);
    }
    if (text !== '') body += `${open} x="${num(x)}" y="${num(cy + label.size * 0.35)}" text-anchor="start" xml:space="preserve">${text}</text>`;
  }
  return body;
}
