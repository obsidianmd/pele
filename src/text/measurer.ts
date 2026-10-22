import { BOLD, REGULAR } from './metrics.js';

export const enum Style {
  Bold = 1,
  Italic = 2,
  Mono = 4,
  Sub = 8,
  Sup = 16,
}

// Approximate divisor for CSS font-size="smaller".
const SMALLER = 1.2;

export interface TextMeasurer {
  width(text: string, size: number, style: number): number;
}

function unpack(packed: string): Uint16Array {
  const out = new Uint16Array(95);
  for (let i = 0; i < 95; i++) out[i] = parseInt(packed.substr(i * 2, 2), 36);
  return out;
}

let regular: Uint16Array | undefined;
let bold: Uint16Array | undefined;

function isWide(c: number): boolean {
  return (
    (c >= 0x1100 && c <= 0x115f) ||
    (c >= 0x2e80 && c <= 0xa4cf) ||
    (c >= 0xac00 && c <= 0xd7a3) ||
    (c >= 0xf900 && c <= 0xfaff) ||
    (c >= 0xfe30 && c <= 0xfe4f) ||
    (c >= 0xff00 && c <= 0xff60) ||
    (c >= 0xffe0 && c <= 0xffe6) ||
    (c >= 0xd800 && c <= 0xdbff)
  );
}

function isZeroWidth(c: number): boolean {
  return (
    (c >= 0x300 && c <= 0x36f) ||
    (c >= 0x200b && c <= 0x200f) ||
    (c >= 0xdc00 && c <= 0xdfff) ||
    (c >= 0xfe00 && c <= 0xfe0f) ||
    c === 0xfeff
  );
}

// Estimates widths from a table of Arial advances. Used where no canvas is available.
export const metricsMeasurer: TextMeasurer = {
  width(text, size, style) {
    const mono = (style & Style.Mono) !== 0;
    const eff = style & (Style.Sub | Style.Sup) ? size / SMALLER : size;
    const table = style & Style.Bold ? (bold ??= unpack(BOLD)) : (regular ??= unpack(REGULAR));
    let units = 0;
    for (let i = 0; i < text.length; i++) {
      const c = text.charCodeAt(i);
      if (c < 32) continue;
      if (c < 127) units += mono ? 600 : table[c - 32];
      else if (isZeroWidth(c)) continue;
      else if (isWide(c)) units += mono ? 1200 : 1000;
      else units += mono ? 600 : 580;
    }
    return (units * eff) / 1000;
  },
};

interface Context2D {
  font: string;
  measureText(text: string): { width: number };
}

function context(): Context2D | null {
  const g = globalThis as {
    OffscreenCanvas?: new (w: number, h: number) => { getContext(type: '2d'): Context2D | null };
    document?: { createElement(tag: 'canvas'): { getContext(type: '2d'): Context2D | null } };
  };
  try {
    if (g.OffscreenCanvas) return new g.OffscreenCanvas(1, 1).getContext('2d');
    if (g.document) return g.document.createElement('canvas').getContext('2d');
  } catch {
    return null;
  }
  return null;
}

const MAX_CACHED = 20000;

function canvasFonts(): FontFaceSet | undefined {
  const g = globalThis as { document?: { fonts?: FontFaceSet }; fonts?: FontFaceSet };
  return g.document?.fonts ?? g.fonts;
}

// Whether the canvas has the font the text is in, rather than a fallback while it loads. A width
// measured with a fallback is not kept. One whose font cannot be checked is.
function hasFont(fonts: FontFaceSet | undefined, font: string, text: string): boolean {
  try {
    return fonts?.check(font, text) ?? true;
  } catch {
    return true;
  }
}

export function canvasMeasurer(fontFamily: string, monoFamily = 'monospace'): TextMeasurer | null {
  const ctx = context();
  if (!ctx) return null;
  const caches = new Map<string, Map<string, number>>();
  let currentFont = '';
  // A font that was not in the document was measured with a fallback, though it counts as loaded.
  let faces = canvasFonts()?.size;
  return {
    width(text, size, style) {
      const fonts = canvasFonts();
      if (fonts?.size !== faces) {
        faces = fonts?.size;
        caches.clear();
      }
      const eff = style & (Style.Sub | Style.Sup) ? size / SMALLER : size;
      const font =
        (style & Style.Italic ? 'italic ' : '') +
        (style & Style.Bold ? 'bold ' : '') +
        eff +
        'px ' +
        (style & Style.Mono ? monoFamily : fontFamily);
      let cache = caches.get(font);
      if (!cache) caches.set(font, (cache = new Map()));
      let w = cache.get(text);
      if (w === undefined) {
        if (font !== currentFont) ctx.font = currentFont = font;
        w = ctx.measureText(text).width;
        if (hasFont(fonts, font, text)) {
          if (cache.size >= MAX_CACHED) cache.clear();
          cache.set(text, w);
        }
      }
      return w;
    },
  };
}

const shared = new Map<string, TextMeasurer>();

export function defaultMeasurer(fontFamily = 'sans-serif', monoFamily = 'monospace'): TextMeasurer {
  const key = fontFamily + '\n' + monoFamily;
  let m = shared.get(key);
  if (!m) {
    m = canvasMeasurer(fontFamily, monoFamily) ?? metricsMeasurer;
    shared.set(key, m);
  }
  return m;
}

// Widths measured before a font finished loading are those of its fallback.
export function forgetTextWidths(): void {
  shared.clear();
}
