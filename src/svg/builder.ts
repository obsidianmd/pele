import { decodeEntities } from '../text/entities.js';
import { Style } from '../text/measurer.js';
import type { Label } from '../text/label.js';
import type { IconResolver, MathMarkup } from '../types.js';

export type { IconResolver };

const RE_NEEDS_ESC = /[&<>"\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/;
const RE_ESC = /[&<>"]|[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]+/g;
const ESC: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' };

// Escapes text for XML and drops the control characters XML does not allow.
export function esc(text: string): string {
  return RE_NEEDS_ESC.test(text) ? text.replace(RE_ESC, (c) => ESC[c] ?? '') : text;
}

// Escapes text that is only ever read as text: a tooltip, an accessible name, a `data-id`. Entity
// codes are turned into their characters first. A value that was checked before it is written,
// such as a style, a colour or a URL, must go through esc() instead, so that what was checked is
// what is written.
export function escText(text: string): string {
  return esc(decodeEntities(text));
}

// The two decimals of a coordinate, by hundredths. Building the string from integers is much
// faster than converting a double.
const FRACTION: string[] = [];
for (let i = 0; i < 100; i++) FRACTION.push(i === 0 ? '' : i % 10 === 0 ? '.' + i / 10 : '.' + (i < 10 ? '0' + i : i));

export function num(value: number): string {
  const n = Math.round(value * 100);
  if (n === 0) return '0';
  if (n > 0) {
    if (n < 1e11) {
      const q = Math.floor(n / 100);
      return q + FRACTION[n - q * 100];
    }
  } else if (n > -1e11) {
    const m = -n;
    const q = Math.floor(m / 100);
    return '-' + q + FRACTION[m - q * 100];
  }
  return String(n / 100);
}


// Writes a measured label as SVG text centered on (cx, cy).
export function labelSvg(label: Label, cx: number, cy: number, attrs: string, icons?: IconResolver): string {
  const lines = label.lines;
  if (lines.length === 0) return '';
  const lh = label.lineHeight;
  const heights = label.heights;
  const shift = label.size * 0.35;
  let top = cy - label.height / 2;

  const only = lines.length === 1 && lines[0].length === 1 ? lines[0][0] : undefined;
  if (only && only.icon === undefined && only.math === undefined && only.style === 0) {
    return `<text${attrs} x="${num(cx)}" y="${num(top + lh / 2 + shift)}" text-anchor="middle">${esc(only.text)}</text>`;
  }

  const shared = sharedStyle(label);
  const given = attrs;
  let math: MathLook | undefined;
  attrs = textStyle(attrs, shared);
  let body = '';
  let extra = '';
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const h = heights ? heights[i] : lh;
    const mid = top + h / 2;
    const y = mid + shift;
    let placed = false;
    for (const span of line) if (span.icon !== undefined || span.math) placed = true;
    if (placed) {
      let x = cx - label.widths[i] / 2;
      for (const span of line) {
        if (span.math) {
          const box = `x="${num(x)}" y="${num(mid - span.math.height / 2)}" width="${num(span.math.width)}" height="${num(span.math.height)}"`;
          math ??= mathLook(given);
          extra += math.halo === undefined ? mathSvg(span.math, box, label.size, math.attrs) : `<rect ${box} rx="2" fill="${math.halo}"/>`;
        } else if (span.icon !== undefined) {
          const side = label.size * 1.1;
          const inner = icons?.(span.icon) ?? '';
          extra += `<svg class="pele-icon" data-icon="${escText(span.icon)}" x="${num(x)}" y="${num(
            mid - side / 2
          )}" width="${num(side)}" height="${num(side)}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${inner}</svg>`;
        } else if (span.text !== '') {
          body += `<tspan x="${num(x)}" y="${num(y)}" text-anchor="start"${spanStyle(span.style & ~shared)}>${esc(span.text)}</tspan>`;
        }
        x += span.width;
      }
    } else {
      for (let j = 0; j < line.length; j++) {
        const span = line[j];
        const pos = j === 0 ? ` x="${num(cx)}" y="${num(y)}"` : '';
        body += `<tspan${pos}${spanStyle(span.style & ~shared)}>${esc(span.text)}</tspan>`;
      }
      if (line.length === 0) body += `<tspan x="${num(cx)}" y="${num(y)}"> </tspan>`;
    }
    top += h;
  }
  return `<text${attrs} text-anchor="middle" xml:space="preserve">${body}</text>${extra}`;
}

const RE_FILL = / fill="([^"]*)"/;
const RE_STROKE = / stroke="([^"]*)"/;
const RE_STYLE = / style="([^"]*)"/;
const RE_STYLE_FILL = /(?:^|;)\s*fill:([^;]*)/;
const RE_STYLE_OPACITY = /(?:^|;)\s*opacity:([^;]*)/;

// Copy only color and opacity to preserve measured math dimensions.
// Use a solid patch for the cluster title's outline to hide edges behind math.
interface MathLook {
  attrs: string;
  halo?: string;
}

function mathLook(attrs: string): MathLook {
  const style = RE_STYLE.exec(attrs)?.[1] ?? '';
  const fill = (RE_STYLE_FILL.exec(style)?.[1] ?? RE_FILL.exec(attrs)?.[1] ?? '').trim();
  if (fill === 'none') return { attrs: '', halo: RE_STROKE.exec(attrs)?.[1] ?? 'none' };
  const opacity = RE_STYLE_OPACITY.exec(style)?.[1].trim();
  return { attrs: (fill === '' ? '' : ` color="${fill}"`) + (opacity ? ` opacity="${opacity}"` : '') };
}

// Resolver markup is trusted.
function mathSvg(math: MathMarkup, box: string, size: number, attrs: string): string {
  if ('svg' in math) return `<svg class="pele-math" ${box} overflow="visible"${attrs}>${math.svg}</svg>`;
  return (
    `<foreignObject class="pele-math" ${box} overflow="visible"${attrs}>` +
    `<div xmlns="http://www.w3.org/1999/xhtml" style="display:flex;align-items:center;justify-content:center;width:100%;height:100%;font-size:${num(size)}px;line-height:normal;white-space:nowrap">${math.html}</div>` +
    '</foreignObject>'
  );
}

const BOLD = ' font-weight="var(--_w)"';
const ITALIC = ' font-style="italic"';
const MONO = ' font-family="var(--_fm)"';
const SUB = ' baseline-shift="sub" font-size="smaller"';
const SUP = ' baseline-shift="super" font-size="smaller"';

export function spanStyle(style: number): string {
  return (
    (style & Style.Bold ? BOLD : '') +
    (style & Style.Italic ? ITALIC : '') +
    (style & Style.Mono ? MONO : '') +
    (style & Style.Sub ? SUB : style & Style.Sup ? SUP : '')
  );
}

// The emphasis every span of a label has. It is written once, on the text element, where a
// CSS rule for the label reaches it.
export function sharedStyle(label: Label): number {
  let shared = Style.Bold | Style.Italic | Style.Mono;
  let any = false;
  for (const line of label.lines) {
    for (const span of line) {
      if (span.icon !== undefined || span.text === '') continue;
      shared &= span.style;
      any = true;
    }
  }
  return any ? shared : 0;
}

// Adds that emphasis to a text element's attributes, unless they give a weight of their own.
export function textStyle(attrs: string, shared: number): string {
  return (
    attrs +
    (shared & Style.Bold && !attrs.includes(' font-weight="') ? BOLD : '') +
    (shared & Style.Italic && !attrs.includes(' font-style="') ? ITALIC : '') +
    (shared & Style.Mono && !attrs.includes(' font-family="') ? MONO : '')
  );
}
