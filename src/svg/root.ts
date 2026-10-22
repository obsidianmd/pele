import type { RenderOptions } from '../types.js';
import { esc, escText } from './builder.js';
import { RADIUS, ROOT_STYLE, fontStyle } from './theme.js';

// The weights of bold text, each set only in a diagram that has such text.
const WEIGHTS = [
  ['tw', 'title'],
  ['hw', 'heading'],
  ['w', 'bold'],
];

const RE_USED = /var\(--_(r|tw|hw|w)\)/g;

export interface Accessible {
  accTitle?: string;
  accDescr?: string;
}

export function svgDocument(
  type: string,
  width: number,
  height: number,
  fontSize: number,
  options: RenderOptions,
  acc: Accessible,
  content: string
): string {
  const prefix = esc(options.idPrefix ?? 'pele');
  let head = '';
  let aria = '';
  if (acc.accTitle) {
    head += `<title id="${prefix}-title">${escText(acc.accTitle)}</title>`;
    aria += ` aria-labelledby="${prefix}-title"`;
  }
  if (acc.accDescr) {
    head += `<desc id="${prefix}-desc">${escText(acc.accDescr)}</desc>`;
    aria += ` aria-describedby="${prefix}-desc"`;
  }
  const fit = options.responsive === false ? '' : 'max-width:100%;height:auto;';
  const used = new Set<string>();
  for (const [, name] of content.matchAll(RE_USED)) {
    used.add(name);
    if (used.size === 4) break;
  }
  let weights = used.has('r') ? `;--_r:${RADIUS}` : '';
  for (const [alias, name] of WEIGHTS) {
    if (used.has(alias)) weights += `;--_${alias}:var(--pele-${name}-weight,bold)`;
  }
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" class="pele pele-${type}" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}" style="${fit}${ROOT_STYLE}${weights}${esc(fontStyle(fontSize, options.fontFamily, options.fontFamilyMono))}" fill="var(--_fg)" role="graphics-document document" aria-roledescription="${type}"${aria}>` +
    head +
    content +
    '</svg>'
  );
}
