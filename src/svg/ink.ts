// Named colors that #fff contrasts with more than #1f1f1f does, and the rest.
const DARK = new Set(
  'black blue blueviolet brown crimson darkblue darkcyan darkgreen darkmagenta darkolivegreen darkorchid darkred darkslateblue darkslategray darkviolet dimgray firebrick forestgreen green indigo maroon mediumblue mediumslateblue mediumvioletred midnightblue navy olive purple rebeccapurple royalblue saddlebrown seagreen sienna slateblue steelblue teal'.split(' ')
);
const LIGHT = new Set(
  'aliceblue antiquewhite aqua aquamarine azure beige bisque blanchedalmond burlywood cadetblue chartreuse chocolate coral cornflowerblue cornsilk cyan darkgoldenrod darkgray darkkhaki darkorange darksalmon darkseagreen darkturquoise deeppink deepskyblue dodgerblue floralwhite fuchsia gainsboro ghostwhite gold goldenrod gray greenyellow honeydew hotpink indianred ivory khaki lavender lavenderblush lawngreen lemonchiffon lightblue lightcoral lightcyan lightgoldenrodyellow lightgray lightgreen lightpink lightsalmon lightseagreen lightskyblue lightslategray lightsteelblue lightyellow lime limegreen linen magenta mediumaquamarine mediumorchid mediumpurple mediumseagreen mediumspringgreen mediumturquoise mintcream mistyrose moccasin navajowhite oldlace olivedrab orange orangered orchid palegoldenrod palegreen paleturquoise palevioletred papayawhip peachpuff peru pink plum powderblue red rosybrown salmon sandybrown seashell silver skyblue slategray snow springgreen tan thistle tomato turquoise violet wheat white whitesmoke yellow yellowgreen'.split(' ')
);

export const ON_LIGHT = 'var(--pele-fg-on-light,#1f1f1f)';
export const ON_DARK = 'var(--pele-fg-on-dark,#fff)';

const RE_FILL = /[";]fill:([^;"]*)/;
const RE_OPACITIES = /[";](?:fill-)?opacity:([^;"]*)/g;
const RE_HEX = /^#(?:[\da-f]{3,4}|[\da-f]{6}|[\da-f]{8})$/i;
const RE_VAR_FALLBACK = /^var\(\s*--[\w-]+\s*,\s*(.+)\)$/;
const RE_FUNCTION = /^(rgba?|hsla?)\(([^()]*)\)$/i;
const RE_NUMBER = /^[+-]?(?:\d+(?:\.\d+)?|\.\d+)(?:e[+-]?\d+)?(%|deg|grad|rad|turn)?$/i;

const linear = (c: number): number => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
const luminance = (r: number, g: number, b: number): number => 0.2126 * linear(r) + 0.7152 * linear(g) + 0.0722 * linear(b);
const clamp = (n: number): number => Math.min(Math.max(n, 0), 1);

// Luminance where #1f1f1f and #fff have equal contrast.
const EVEN = Math.sqrt(1.05 * (luminance(31 / 255, 31 / 255, 31 / 255) + 0.05)) - 0.05;

function amount(raw: string, full: number): number {
  const m = RE_NUMBER.exec(raw);
  if (!m || (m[1] && m[1] !== '%')) return NaN;
  return clamp(parseFloat(raw) / (m[1] ? 100 : full));
}

function hue(raw: string): number {
  const m = RE_NUMBER.exec(raw);
  if (!m || m[1] === '%') return NaN;
  const unit = m[1]?.toLowerCase();
  const n = parseFloat(raw);
  return unit === 'turn' ? n * 360 : unit === 'rad' ? (n * 180) / Math.PI : unit === 'grad' ? n * 0.9 : n;
}

// The comma syntax takes no `none`, rgb() channels all or none in %, and hsl() saturation and lightness in %.
function args(body: string, hsl: boolean): string[] | undefined {
  const legacy = body.includes(',');
  const [main, alpha, extra] = legacy ? [body] : body.split('/');
  if (extra !== undefined) return undefined;
  const list = main.trim().split(legacy ? /\s*,\s*/ : /\s+/);
  if (legacy ? list.length < 3 || list.length > 4 : list.length !== 3) return undefined;
  if (alpha !== undefined) list.push(alpha.trim());
  if (!legacy) return list.map((c) => (c === 'none' ? '0' : c));
  const percent = list.slice(hsl ? 1 : 0, 3).filter((c) => c.endsWith('%')).length;
  return percent === (hsl ? 2 : 3) || (!hsl && percent === 0) ? list : undefined;
}

// A hex color or one of CSS's named colors.
export function plainColor(raw: string): boolean {
  const value = raw.trim().toLowerCase();
  const name = value.replace('grey', 'gray');
  return RE_HEX.test(value) || DARK.has(name) || LIGHT.has(name) || value === 'transparent' || value === 'currentcolor';
}

// Luminance and alpha; named colors use 0 or 1 to preserve the contrast choice.
function color(raw: string): [number, number] | undefined {
  const value = raw.trim().toLowerCase();
  const name = value.replace('grey', 'gray');
  if (DARK.has(name)) return [0, 1];
  if (LIGHT.has(name)) return [1, 1];
  // A var() with a concrete fallback decides on the fallback: it is the color that renders
  // when the page leaves the token alone. A var() without one stays unknown.
  const fallback = RE_VAR_FALLBACK.exec(value);
  if (fallback) return color(fallback[1]);
  if (RE_HEX.test(value)) {
    const digits = value.length < 6 ? value.slice(1).replace(/./g, '$&$&') : value.slice(1);
    const n = (i: number): number => parseInt(digits.slice(2 * i, 2 * i + 2), 16) / 255;
    return [luminance(n(0), n(1), n(2)), digits.length === 8 ? n(3) : 1];
  }
  const fn = RE_FUNCTION.exec(value);
  const hsl = fn?.[1].startsWith('hsl') ?? false;
  const list = fn && args(fn[2], hsl);
  if (!list) return undefined;
  const alpha = list.length === 4 ? amount(list[3], 1) : 1;
  let rgb: number[];
  if (!hsl) {
    rgb = list.slice(0, 3).map((c) => amount(c, 255));
  } else {
    const h = (((hue(list[0]) % 360) + 360) % 360) / 30;
    const s = amount(list[1], 100);
    const l = amount(list[2], 100);
    const a = s * Math.min(l, 1 - l);
    rgb = [0, 8, 4].map((k) => {
      const t = (k + h) % 12;
      return l - a * Math.max(-1, Math.min(t - 3, 9 - t, 1));
    });
  }
  const lum = luminance(rgb[0], rgb[1], rgb[2]);
  return Number.isNaN(lum + alpha) ? undefined : [lum, alpha];
}

// How opaque a style's fill-opacity and opacity leave its fill, or NaN when either isn't a plain number.
function opacity(shape: string): number {
  let product = 1;
  for (const [, value] of shape.matchAll(RE_OPACITIES)) product *= amount(value.trim(), 1);
  return product;
}

const known = new Map<string, string | undefined>();

// Styles come from resolveStyle(). Fills below half opacity depend on an unknown background.
export function ink(shape: string, text = ''): string | undefined {
  const key = `${shape}\0${text}`;
  if (known.has(key)) return known.get(key);
  if (known.size > 1000) known.clear();
  const result = pick(shape, text);
  known.set(key, result);
  return result;
}

function pick(shape: string, text: string): string | undefined {
  const fill = RE_FILL.exec(shape);
  const found = fill && !RE_FILL.test(text) ? color(fill[1]) : undefined;
  if (!found) return undefined;
  // An opacity that isn't a plain number, such as calc() or var(), may still be low.
  if (!(found[1] * opacity(shape) >= 0.5)) return undefined;
  return found[0] > EVEN ? ON_LIGHT : ON_DARK;
}

// Unknown fill colors and opacities are treated as opaque.
export function paints(shape: string): boolean {
  const fill = RE_FILL.exec(shape)?.[1].trim().toLowerCase();
  if (!fill || fill === 'none' || fill === 'transparent') return false;
  const scale = opacity(shape);
  return (color(fill)?.[1] ?? 1) * (Number.isNaN(scale) ? 1 : scale) > 0;
}

export function inkFill(style: { shape: string; text: string }, fallback?: string): string {
  const color = ink(style.shape, style.text) ?? fallback;
  return color ? ` fill="${color}"` : '';
}
