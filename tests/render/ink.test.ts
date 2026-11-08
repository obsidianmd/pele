import { describe, expect, it } from 'vitest';
import { ink } from '../../src/svg/ink.js';
import { resolveStyle } from '../../src/svg/theme.js';

const ON_LIGHT = 'var(--pele-fg-on-light,#1f1f1f)';
const ON_DARK = 'var(--pele-fg-on-dark,#fff)';

function inkFor(...declarations: string[]): string | undefined {
  const style = resolveStyle(declarations);
  return ink(style.shape, style.text);
}

const NAMED: Record<string, string> = {
  aliceblue: 'f0f8ff', antiquewhite: 'faebd7', aqua: '00ffff', aquamarine: '7fffd4', azure: 'f0ffff',
  beige: 'f5f5dc', bisque: 'ffe4c4', black: '000000', blanchedalmond: 'ffebcd', blue: '0000ff', blueviolet: '8a2be2',
  brown: 'a52a2a', burlywood: 'deb887', cadetblue: '5f9ea0', chartreuse: '7fff00', chocolate: 'd2691e',
  coral: 'ff7f50', cornflowerblue: '6495ed', cornsilk: 'fff8dc', crimson: 'dc143c', cyan: '00ffff',
  darkblue: '00008b', darkcyan: '008b8b', darkgoldenrod: 'b8860b', darkgray: 'a9a9a9', darkgreen: '006400',
  darkgrey: 'a9a9a9', darkkhaki: 'bdb76b', darkmagenta: '8b008b', darkolivegreen: '556b2f', darkorange: 'ff8c00',
  darkorchid: '9932cc', darkred: '8b0000', darksalmon: 'e9967a', darkseagreen: '8fbc8f', darkslateblue: '483d8b',
  darkslategray: '2f4f4f', darkslategrey: '2f4f4f', darkturquoise: '00ced1', darkviolet: '9400d3',
  deeppink: 'ff1493', deepskyblue: '00bfff', dimgray: '696969', dimgrey: '696969', dodgerblue: '1e90ff',
  firebrick: 'b22222', floralwhite: 'fffaf0', forestgreen: '228b22', fuchsia: 'ff00ff', gainsboro: 'dcdcdc',
  ghostwhite: 'f8f8ff', gold: 'ffd700', goldenrod: 'daa520', gray: '808080', green: '008000', greenyellow: 'adff2f',
  grey: '808080', honeydew: 'f0fff0', hotpink: 'ff69b4', indianred: 'cd5c5c', indigo: '4b0082', ivory: 'fffff0',
  khaki: 'f0e68c', lavender: 'e6e6fa', lavenderblush: 'fff0f5', lawngreen: '7cfc00', lemonchiffon: 'fffacd',
  lightblue: 'add8e6', lightcoral: 'f08080', lightcyan: 'e0ffff', lightgoldenrodyellow: 'fafad2',
  lightgray: 'd3d3d3', lightgreen: '90ee90', lightgrey: 'd3d3d3', lightpink: 'ffb6c1', lightsalmon: 'ffa07a',
  lightseagreen: '20b2aa', lightskyblue: '87cefa', lightslategray: '778899', lightslategrey: '778899',
  lightsteelblue: 'b0c4de', lightyellow: 'ffffe0', lime: '00ff00', limegreen: '32cd32', linen: 'faf0e6',
  magenta: 'ff00ff', maroon: '800000', mediumaquamarine: '66cdaa', mediumblue: '0000cd', mediumorchid: 'ba55d3',
  mediumpurple: '9370db', mediumseagreen: '3cb371', mediumslateblue: '7b68ee', mediumspringgreen: '00fa9a',
  mediumturquoise: '48d1cc', mediumvioletred: 'c71585', midnightblue: '191970', mintcream: 'f5fffa',
  mistyrose: 'ffe4e1', moccasin: 'ffe4b5', navajowhite: 'ffdead', navy: '000080', oldlace: 'fdf5e6', olive: '808000',
  olivedrab: '6b8e23', orange: 'ffa500', orangered: 'ff4500', orchid: 'da70d6', palegoldenrod: 'eee8aa',
  palegreen: '98fb98', paleturquoise: 'afeeee', palevioletred: 'db7093', papayawhip: 'ffefd5', peachpuff: 'ffdab9',
  peru: 'cd853f', pink: 'ffc0cb', plum: 'dda0dd', powderblue: 'b0e0e6', purple: '800080', rebeccapurple: '663399',
  red: 'ff0000', rosybrown: 'bc8f8f', royalblue: '4169e1', saddlebrown: '8b4513', salmon: 'fa8072',
  sandybrown: 'f4a460', seagreen: '2e8b57', seashell: 'fff5ee', sienna: 'a0522d', silver: 'c0c0c0',
  skyblue: '87ceeb', slateblue: '6a5acd', slategray: '708090', slategrey: '708090', snow: 'fffafa',
  springgreen: '00ff7f', steelblue: '4682b4', tan: 'd2b48c', teal: '008080', thistle: 'd8bfd8', tomato: 'ff6347',
  turquoise: '40e0d0', violet: 'ee82ee', wheat: 'f5deb3', white: 'ffffff', whitesmoke: 'f5f5f5', yellow: 'ffff00',
  yellowgreen: '9acd32',
};

describe('label ink', () => {
  it('reads hex fills', () => {
    expect(inkFor('fill:#fff')).toBe(ON_LIGHT);
    expect(inkFor('fill:#BBDEFB')).toBe(ON_LIGHT);
    expect(inkFor('fill:#000')).toBe(ON_DARK);
    expect(inkFor('fill:#1F3A5F')).toBe(ON_DARK);
    expect(inkFor('fill:#000c')).toBe(ON_DARK);
    expect(inkFor('fill:#ffffff80')).toBe(ON_LIGHT);
  });

  it('picks the ink with the higher contrast near the middle', () => {
    expect(inkFor('fill:#f00')).toBe(ON_LIGHT);
    expect(inkFor('fill:#808000')).toBe(ON_DARK);
  });

  it('reads rgb() in comma and space syntax', () => {
    expect(inkFor('fill:rgb(191, 223, 255)')).toBe(ON_LIGHT);
    expect(inkFor('fill:rgba(0,0,0,0.6)')).toBe(ON_DARK);
    expect(inkFor('fill:RGB(100%, 100%, 100%)')).toBe(ON_LIGHT);
    expect(inkFor('fill:rgb(0% 0% 0% / .9)')).toBe(ON_DARK);
    expect(inkFor('fill:rgba(255 255 255 / 75%)')).toBe(ON_LIGHT);
    expect(inkFor('fill:rgb(none 0 0)')).toBe(ON_DARK);
  });

  it('reads hsl()', () => {
    expect(inkFor('fill:hsl(210, 100%, 87%)')).toBe(ON_LIGHT);
    expect(inkFor('fill:hsl(0 0% 10%)')).toBe(ON_DARK);
    expect(inkFor('fill:hsla(120deg, 50%, 20%, 0.8)')).toBe(ON_DARK);
    expect(inkFor('fill:hsl(0.5turn 100% 90%)')).toBe(ON_LIGHT);
    expect(inkFor('fill:hsl(-120, 100%, 30%)')).toBe(ON_DARK);
    expect(inkFor('fill:hsl(0 0 95)')).toBe(ON_LIGHT);
    expect(inkFor('fill:hsl(none 0% 0%)')).toBe(ON_DARK);
  });

  it('reads all 148 named colors, in any case', () => {
    expect(Object.keys(NAMED)).toHaveLength(148);
    for (const [name, hex] of Object.entries(NAMED)) {
      const expected = inkFor(`fill:#${hex}`);
      expect(inkFor(`fill:${name}`), name).toBe(expected);
      expect(inkFor(`fill:${name.toUpperCase()}`), name).toBe(expected);
    }
  });

  it('reads a var() fallback', () => {
    expect(inkFor('fill:var(--pele-series-6,#eeca3b)')).toBe(ON_LIGHT);
    expect(inkFor('fill:var(--pele-accent,#5b7bd5)')).toBe(ON_LIGHT);
    expect(inkFor('fill:var(--pele-critical,#e45756)')).toBe(ON_LIGHT);
    expect(inkFor('fill:var(--x,var(--y,#fff))')).toBe(ON_LIGHT);
    expect(inkFor('fill:var(--x,red)')).toBe(ON_LIGHT);
    expect(inkFor('fill:var(--x,url(a))')).toBeUndefined();
  });

  it('leaves labels alone on fills it cannot read', () => {
    for (const fill of ['var(--x)', 'currentColor', 'none', 'transparent', 'blu', '#ggg', '#12345', 'rgb(1,2)', 'rgb(1, 2 3)', 'rgb(1 2 3 / 4 / 5)', 'rgb(1, 2, 3 / 1)', 'rgb(1 2 3 4)', 'hsl(10%, 50%, 50%)', 'rgb(10deg, 2, 3)', 'rgb(0%,0,0)', 'hsl(0,0,0)', 'rgb(0. 0 0)', 'rgb(none,0,0)']) {
      expect(inkFor(`fill:${fill}`), fill).toBeUndefined();
    }
    expect(inkFor('stroke:#000')).toBeUndefined();
  });

  it('leaves labels alone on fills under half opaque', () => {
    expect(inkFor('fill:#0007')).toBeUndefined();
    expect(inkFor('fill:#0000007f')).toBeUndefined();
    expect(inkFor('fill:rgb(191 223 255 / 40%)')).toBeUndefined();
    expect(inkFor('fill:#000', 'fill-opacity:0.4')).toBeUndefined();
    expect(inkFor('fill:#000', 'fill-opacity:60%')).toBe(ON_DARK);
    expect(inkFor('fill:#0009', 'fill-opacity:0.8')).toBeUndefined();
    expect(inkFor('fill:#000', 'fill-opacity:calc(0.1)')).toBeUndefined();
    expect(inkFor('fill:#000', 'fill-opacity:var(--fade)')).toBeUndefined();
    expect(inkFor('fill:#000', 'opacity:0.4')).toBeUndefined();
    expect(inkFor('fill:#000', 'opacity:0.8', 'fill-opacity:0.6')).toBeUndefined();
    expect(inkFor('fill:#000', 'opacity:0.8')).toBe(ON_DARK);
  });

  it('leaves a color the style sets', () => {
    expect(inkFor('fill:#fff', 'color:#fff')).toBeUndefined();
    expect(inkFor('fill:white')).toBe(ON_LIGHT);
  });
});
