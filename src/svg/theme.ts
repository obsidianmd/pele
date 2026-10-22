import { esc } from './builder.js';

// Private aliases set once on the root element, so each use is short and the public
// --pele-* tokens keep their fallbacks. The text color is set as well: an icon is drawn in
// currentColor, which would otherwise be whatever color the page gives the diagram's container.
export const ROOT_STYLE =
  '--_bg:var(--pele-bg,#fff);--_fg:var(--pele-fg,#1f1f1f);--_m:var(--pele-muted,#6e6e6e);' +
  '--_l:var(--pele-line,#1f1f1f);--_s:var(--pele-surface,#f3f3f3);--_a:var(--pele-surface-alt,#e6e6e6);' +
  '--_b:var(--pele-border,#8a8a8a);--_c:var(--pele-accent,#5b7bd5);color:var(--_fg)';

export const FONT_MONO = 'var(--_fm)';
export const RADIUS = 'var(--pele-radius,4px)';

// Use CSS for rx variables to support older browsers. Put the default first so
// diagram styles can override it.
export const ROUNDED = ' style="rx:var(--_r)"';

export function rounded(attrs: string): string {
  const at = attrs.indexOf(' style="');
  return at < 0 ? attrs + ROUNDED : `${attrs.slice(0, at + 8)}rx:var(--_r);${attrs.slice(at + 8)}`;
}
// The color of what a diagram marks as critical. It is not one of the series colors, as a theme
// may put those in any order.
export const CRITICAL = 'var(--pele-critical,#e45756)';

// A list of font names, quoted or not, and nothing that could end the declaration it is put in.
const FAMILY = String.raw`(?:"[^"'\\\n<>{}();:@]*"|'[^"'\\\n<>{}();:@]*'|[\p{L}\p{N}_-][\p{L}\p{N}_ .-]*)`;
const RE_FAMILIES = new RegExp(String.raw`^\s*${FAMILY}(?:\s*,\s*${FAMILY})*\s*$`, 'u');

function families(list: string | undefined, generic: string): string {
  return list && RE_FAMILIES.test(list) ? list : generic;
}

// The fonts the labels were measured in are the ones they are drawn in, unless the page names
// others. The rest of what text inherits is pinned, as none of it was measured.
export function fontStyle(size: number, family: string | undefined, mono: string | undefined): string {
  return (
    `;--_fm:var(--pele-font-mono,${families(mono, 'monospace')});font:${size}px sans-serif;` +
    'letter-spacing:normal;word-spacing:normal;text-transform:none;direction:ltr;' +
    `font-family:var(--pele-font,${families(family, 'sans-serif')})`
  );
}

const SHAPE_PROPS = new Set([
  'fill',
  'fill-opacity',
  'stroke',
  'stroke-width',
  'stroke-dasharray',
  'stroke-dashoffset',
  'stroke-linecap',
  'stroke-linejoin',
  'stroke-opacity',
  'opacity',
  'rx',
  'ry',
]);

const TEXT_PROPS = new Set([
  'color',
  'font-size',
  'font-family',
  'font-weight',
  'font-style',
  'text-decoration',
  'letter-spacing',
  'word-spacing',
  'opacity',
]);

const RE_UNSAFE = /url\s*\(|expression\s*\(|javascript:|[<>{};\\]|@import|image-set|\/\*/i;

export interface ResolvedStyle {
  shape: string;
  line: string;
  text: string;
  stroke: string | undefined;
  bold: boolean;
  italic: boolean;
  fontSize: number | undefined;
}

const NONE: ResolvedStyle = {
  shape: '',
  line: '',
  text: '',
  stroke: undefined,
  bold: false,
  italic: false,
  fontSize: undefined,
};

// Splits Mermaid style declarations into what applies to a shape and what applies to its text.
export function resolveStyle(declarations: string[]): ResolvedStyle {
  if (declarations.length === 0) return NONE;
  const shape = new Map<string, string>();
  const text = new Map<string, string>();
  for (const decl of declarations) {
    const at = decl.indexOf(':');
    if (at <= 0) continue;
    const prop = decl.slice(0, at).trim().toLowerCase();
    const value = decl
      .slice(at + 1)
      .replace(/!important/gi, '')
      .trim();
    if (value === '' || RE_UNSAFE.test(value)) continue;
    if (SHAPE_PROPS.has(prop)) shape.set(prop, value);
    if (TEXT_PROPS.has(prop)) text.set(prop === 'color' ? 'fill' : prop, value);
  }
  if (shape.size === 0 && text.size === 0) return NONE;
  let shapeCss = '';
  let lineCss = '';
  for (const [prop, value] of shape) {
    shapeCss += `${prop}:${value};`;
    if (prop !== 'fill' && prop !== 'fill-opacity') lineCss += `${prop}:${value};`;
  }
  let textCss = '';
  for (const [prop, value] of text) textCss += `${prop}:${value};`;
  const weight = text.get('font-weight');
  const size = text.get('font-size');
  const px = size && /^[\d.]+(px)?$/.test(size) ? parseFloat(size) : undefined;
  return {
    shape: shapeCss ? ` style="${esc(shapeCss)}"` : '',
    line: lineCss ? ` style="${esc(lineCss)}"` : '',
    text: textCss ? ` style="${esc(textCss)}"` : '',
    stroke: shape.get('stroke'),
    bold: weight === 'bold' || weight === 'bolder' || Number(weight) >= 600,
    italic: text.get('font-style') === 'italic',
    fontSize: px !== undefined && px > 0 && px <= 200 ? px : undefined,
  };
}

const RE_CLASS = /[^\w-]+/g;

export function classNames(raw: string): string {
  const cleaned = raw.replace(RE_CLASS, ' ').trim();
  return cleaned === '' ? '' : ' ' + cleaned;
}

const SERIES = ['#4c78a8', '#f58518', '#54a24b', '#e45756', '#72b7b2', '#eeca3b', '#b279a2', '#9d755d'];

// Color for the nth data series in a chart, cycling through eight tokens.
export function seriesColor(index: number): string {
  const k = ((index % 8) + 8) % 8;
  return `var(--pele-series-${k + 1},${SERIES[k]})`;
}
