import { describe, expect, it } from 'vitest';
import { PeleError, parse, render, supports } from '../../src/index.js';
import { metricsMeasurer } from '../../src/text/measurer.js';
import { loadCorpus } from '../support/corpus.js';
import { assertWellFormed } from '../support/xml.js';

const options = { measurer: metricsMeasurer };
const corpus = loadCorpus('sankey', /sankey/i);

const BASIC = 'sankey\na,b,5\na,c,3\nb,d,4\nc,d,1.239\n';

function configured(sankey: string, body = BASIC): string {
  return `---\nconfig:\n  sankey:\n${sankey
    .split('\n')
    .map((line) => '    ' + line)
    .join('\n')}\n---\n${body}`;
}

function count(svg: string, pattern: RegExp): number {
  return svg.match(pattern)?.length ?? 0;
}

function attr(svg: string, id: string, name: string): string {
  return new RegExp(`class="pele-sankey-node" data-id="${id}"[^>]* ${name}="([^"]*)"`).exec(svg)![1];
}

describe('sankey rendering', () => {
  it('renders every documentation example as well-formed SVG', () => {
    let rendered = 0;
    for (const src of corpus) {
      let svg: string;
      try {
        svg = render(src, options).svg;
      } catch (error) {
        expect(error).toBeInstanceOf(PeleError);
        continue;
      }
      rendered++;
      const where = JSON.stringify(src).slice(0, 120);
      expect(() => assertWellFormed(svg), where).not.toThrow();
      expect(svg, where).not.toContain('NaN');
      expect(svg, where).not.toContain('undefined');
      expect(svg, where).not.toContain('Infinity');
      expect(render(src, options).svg, where).toBe(svg);
    }
    expect(rendered).toBeGreaterThanOrEqual(8);
  });

  it('draws a bar and a label per node and a band per link', () => {
    const { svg, type } = render(BASIC, options);
    expect(type).toBe('sankey');
    expect(supports('sankey\na,b,1')).toBe(true);
    expect(supports('sankey-beta\na,b,1')).toBe(true);
    expect(svg).toMatch(/^<svg xmlns="http:\/\/www\.w3\.org\/2000\/svg" class="pele pele-sankey"/);
    expect(count(svg, /class="pele-sankey-node"/g)).toBe(4);
    expect(count(svg, /class="pele-sankey-link"/g)).toBe(4);
    expect(count(svg, /class="pele-label"/g)).toBe(4);
    expect(svg).toContain('data-id="a-&gt;b"');
    expect(svg).toContain('<title>a → b: 5</title>');
  });

  it('colors bars by series, in the order nodes first appear', () => {
    const { svg } = render(BASIC, options);
    expect(attr(svg, 'a', 'fill')).toBe('var(--pele-series-1,#4c78a8)');
    expect(attr(svg, 'b', 'fill')).toBe('var(--pele-series-2,#f58518)');
    expect(attr(svg, 'd', 'fill')).toBe('var(--pele-series-4,#e45756)');
  });

  it('has the default size of 600 by 400 plus padding', () => {
    const { width, height } = render(BASIC, options);
    expect(width).toBe(616);
    expect(height).toBe(416);
  });

  it('honours width and height', () => {
    const { width, height, svg } = render(configured('width: 300\nheight: 150'), options);
    expect(width).toBe(316);
    expect(height).toBe(166);
    expect(Number(attr(svg, 'd', 'x'))).toBe(290);
  });

  it('shows values with two decimals, a prefix and a suffix, unless showValues is off', () => {
    const shown = render(BASIC, options).svg;
    expect(shown).toContain('>a <tspan class="pele-sankey-value" fill="var(--_m)">8</tspan><');
    expect(shown).toContain('>5.24</tspan>');
    const money = render(configured('prefix: "$"\nsuffix: " M"'), options).svg;
    expect(money).toContain('>$8 M</tspan>');
    expect(money).toContain('<title>a → b: $5 M</title>');
    const hidden = render(configured('showValues: false'), options).svg;
    expect(hidden).not.toContain('pele-sankey-value');
    expect(hidden).toContain('>a</text>');
  });

  it('gives nodes more room when values are shown, as Mermaid does', () => {
    const body = 'sankey\na,b,1\na,c,1\na,d,1\n';
    const gap = (svg: string): number => Number(attr(svg, 'c', 'y')) - Number(attr(svg, 'b', 'y')) - Number(attr(svg, 'b', 'height'));
    expect(gap(render(body, options).svg)).toBeCloseTo(27, 1);
    expect(gap(render(configured('showValues: false', body), options).svg)).toBeGreaterThanOrEqual(12);
    expect(gap(render(configured('showValues: false\nnodePadding: 40', body), options).svg)).toBeCloseTo(40, 1);
  });

  it('honours nodeAlignment', () => {
    const body = 'sankey\na,b,4\nb,c,3\nc,d,3\nx,d,2\na,y,1\n';
    const x = (alignment: string, id: string): number => Number(attr(render(configured(`nodeAlignment: ${alignment}`, body), options).svg, id, 'x'));
    expect(x('justify', 'y')).toBe(590);
    expect(x('left', 'y')).toBeCloseTo(590 / 3, 1);
    expect(x('left', 'x')).toBe(0);
    expect(x('right', 'x')).toBeCloseTo((590 * 2) / 3, 1);
    expect(x('center', 'x')).toBeCloseTo((590 * 2) / 3, 1);
    expect(x('center', 'y')).toBeCloseTo(590 / 3, 1);
    expect(x('nonsense', 'y')).toBe(590);
  });

  it('honours linkColor', () => {
    const link = (svg: string): string => /class="pele-sankey-link" data-id="a-&gt;b"[^>]*/.exec(svg)![0];
    // Without an idPrefix, gradient links take their source's colour.
    expect(link(render(BASIC, options).svg)).toContain('fill="var(--pele-series-1,#4c78a8)"');
    expect(link(render(configured('linkColor: gradient'), options).svg)).toContain('fill="var(--pele-series-1,#4c78a8)"');
    expect(link(render(configured('linkColor: source'), options).svg)).toContain('fill="var(--pele-series-1,#4c78a8)"');
    expect(link(render(configured('linkColor: target'), options).svg)).toContain('fill="var(--pele-series-2,#f58518)"');
    expect(link(render(configured('linkColor: "#a1a1a1"'), options).svg)).toContain('style="fill:#a1a1a1;"');
    expect(link(render(configured('linkColor: "url(#x)"'), options).svg)).not.toContain('style=');
    expect(render(BASIC, options).svg).not.toMatch(/<defs|<linearGradient|url\(/);
    expect(render(BASIC, options).svg).toContain('class="pele-sankey-links" fill-opacity="0.4"');
  });

  it('fills links with gradients when there is an idPrefix', () => {
    const { svg } = render(BASIC, { ...options, idPrefix: 'p1' });
    assertWellFormed(svg);
    expect(count(svg, /<linearGradient /g)).toBe(4);
    const ab = /class="pele-sankey-link" data-id="a-&gt;b"[^>]* fill="url\(#(p1-sankey-[a-z0-9]+)\) var\(--pele-series-1,#4c78a8\)"/.exec(svg)!;
    expect(svg).toMatch(
      new RegExp(`<linearGradient id="${ab[1]}" gradientUnits="userSpaceOnUse" x1="[\\d.]+" x2="[\\d.]+"><stop offset="0" stop-color="var\\(--pele-series-1,#4c78a8\\)"/><stop offset="1" stop-color="var\\(--pele-series-2,#f58518\\)"/></linearGradient>`)
    );
    expect(render(BASIC, { ...options, idPrefix: 'p1' }).svg).toBe(svg);
    const ids = (text: string): string[] => [...text.matchAll(/<linearGradient id="([^"]+)"/g)].map((m) => m[1]);
    const other = render('sankey\nx,y,2\n', { ...options, idPrefix: 'p1' }).svg;
    expect(ids(other).filter((id) => ids(svg).includes(id))).toEqual([]);
    for (const color of ['source', 'target', '"#a1a1a1"']) {
      expect(render(configured(`linkColor: ${color}`), { ...options, idPrefix: 'p1' }).svg).not.toMatch(/<defs|url\(/);
    }
  });

  it('takes gradient colours from nodeColors', () => {
    const { svg } = render(configured('nodeColors:\n  a: "#123456"\n  b: "url(#x)"'), { ...options, idPrefix: 'p_1' });
    assertWellFormed(svg);
    expect(svg).toContain('<stop offset="0" stop-color="#123456"/><stop offset="1" stop-color="var(--pele-series-2,#f58518)"/>');
    expect(svg).toMatch(/data-id="a-&gt;b"[^>]* fill="url\(#p_1-sankey-[a-z0-9]+\) #123456"/);
    expect(svg).not.toContain('url(#x)');
  });

  it('keeps escaped nodeColors whole in gradients', () => {
    const { svg } = render(configured(`nodeColors:\n  a: 'red&blue'\n  b: 'x"y'`), { ...options, idPrefix: 'p1' });
    assertWellFormed(svg);
    expect(svg).toContain('<stop offset="0" stop-color="red&amp;blue"/><stop offset="1" stop-color="x&quot;y"/>');
    expect(svg).toMatch(/data-id="a-&gt;b"[^>]* fill="url\(#p1-sankey-[a-z0-9]+\) red&amp;blue"/);
  });

  it('keeps links flat when the idPrefix could not appear in a url()', () => {
    for (const idPrefix of ['p"1', 'p)1', 'p 1', '']) {
      const { svg } = render(BASIC, { ...options, idPrefix });
      expect(svg, idPrefix).not.toMatch(/<defs|url\(/);
      expect(svg, idPrefix).toMatch(/data-id="a-&gt;b"[^>]* fill="var\(--pele-series-1,#4c78a8\)"/);
    }
  });

  it('honours nodeWidth, nodeColors and labelStyle', () => {
    expect(attr(render(configured('nodeWidth: 24'), options).svg, 'a', 'width')).toBe('24');
    const colored = render(configured('linkColor: source\nnodeColors:\n  a: "#123456"\n  d: "url(#x)"\n  __proto__: red'), options).svg;
    expect(colored).toMatch(/class="pele-sankey-node" data-id="a"[^>]*style="fill:#123456;"/);
    expect(colored).toMatch(/class="pele-sankey-link" data-id="a-&gt;b"[^>]*style="fill:#123456;"/);
    expect(colored).not.toContain('url(');
    const legacy = render(BASIC, options).svg;
    const outlined = render(configured('labelStyle: outlined'), options);
    expect(legacy).toMatch(/data-id="d"><text[^>]*text-anchor="end"/);
    expect(outlined.svg).toMatch(/data-id="d"><text[^>]*text-anchor="start"[^>]*stroke="var\(--_bg\)"/);
    expect(outlined.width).toBeGreaterThan(616);
  });

  it('puts each label on the side of its bar that faces the middle', () => {
    const { svg } = render(BASIC, options);
    expect(svg).toMatch(/data-id="a"><text[^>]*text-anchor="start"/);
    expect(svg).toMatch(/data-id="d"><text[^>]*text-anchor="end"/);
  });

  it('keeps adjacent-column labels clear without moving the bars', () => {
    const source = `sankey-beta
Visitors,Signed up,3200
Visitors,Bounced,9800
Signed up,Opened a folder,2100
Signed up,Never returned,1100
Opened a folder,Ran Agency,1450
Opened a folder,Write-only,650
Ran Agency,Upgraded to Pro,380
Ran Agency,Stayed free,1070
Upgraded to Pro,Upgraded to Team,96
Upgraded to Pro,Stayed on Pro,284`;
    for (const fontSize of [14, 16]) {
      const { svg } = render(source, { ...options, fontSize, maxWidth: 664 });
      const bounds = (id: string, value: number): [number, number, number] => {
        const label = new RegExp(`data-id="${id}"><text x="([\\d.]+)" y="([\\d.]+)" text-anchor="([^"]+)"`).exec(svg)!;
        const width = metricsMeasurer.width(`${id} ${value}`, Math.round(fontSize * 0.875), 0);
        const left = Number(label[1]) - (label[3] === 'end' ? width : 0);
        return [left, left + width, Number(label[2])];
      };
      const a = bounds('Opened a folder', 2100);
      const b = bounds('Ran Agency', 1450);
      expect(a[1] <= b[0] || b[1] <= a[0] || Math.abs(a[2] - b[2]) >= Math.round(fontSize * 0.875) * 1.5).toBe(true);
      expect(svg).toContain('>1450</tspan>');
      const hidden = render(configured('showValues: false', source), { ...options, fontSize }).svg;
      expect([...svg.matchAll(/class="pele-sankey-node"[^>]* x="([^"]+)"/g)].map((m) => m[1])).toEqual(
        [...hidden.matchAll(/class="pele-sankey-node"[^>]* x="([^"]+)"/g)].map((m) => m[1])
      );
    }
  });

  it('keeps a moved label beside its own bar', () => {
    const { svg } = render(configured('showValues: false', 'sankey\nA,B,1\nC,D,200\nE,F,1\nF,G,600\nG,D,200\nB,D,1\n'), options);
    const label = Number(/data-id="E"><text x="[\d.]+" y="([\d.]+)"/.exec(svg)![1]) - Math.round(16 * 0.875) * 0.35;
    const bar = (id: string): [number, number] => {
      const m = new RegExp(`class="pele-sankey-node" data-id="${id}" x="[^"]+" y="([^"]+)" width="[^"]+" height="([^"]+)"`).exec(svg)!;
      return [Number(m[1]), Number(m[1]) + Number(m[2])];
    };
    const gap = ([top, bottom]: [number, number]): number => Math.max(0, top - label, label - bottom);
    expect(gap(bar('E'))).toBeLessThan(gap(bar('C')));
  });

  it('shrinks labels in narrow or crowded charts, down to 10px', () => {
    const labelSize = (svg: string): number => Number(/class="pele-labels" font-size="(\d+)"/.exec(svg)![1]);
    const fan = (n: number): string => 'sankey\n' + Array.from({ length: n }, (_, i) => `s${i},t,1\n`).join('');
    expect(labelSize(render(BASIC, options).svg)).toBe(14);
    expect(labelSize(render(fan(20), options).svg)).toBe(11);
    expect(labelSize(render(fan(60), options).svg)).toBe(10);
    const narrow = labelSize(render(BASIC, { ...options, maxWidth: 320 }).svg);
    expect(narrow).toBeLessThan(14);
    expect(narrow).toBeGreaterThanOrEqual(10);
    expect(labelSize(render(fan(20), { ...options, fontSize: 32 }).svg)).toBe(20);
  });

  it('grows the picture to hold labels that reach outside the chart', () => {
    const { width, svg } = render(configured('labelStyle: outlined', 'sankey\nA,Somewhere with a very long name indeed,1\n'), options);
    expect(width).toBeGreaterThan(800);
    expect(svg).toContain(`viewBox="0 0 ${width} `);
  });

  it('keeps quoted fields, escaped quotes and odd characters as node names', () => {
    const model = parse('sankey\n"Heating, ""homes""",Agricultural \'waste\',1\n  Lighting & appliances - commercial  , Over generation / exports ,2\n');
    expect(model.type).toBe('sankey');
    if (model.type === 'sankey') {
      expect(model.nodes.map((node) => node.id)).toEqual(['Heating, "homes"', "Agricultural 'waste'", 'Lighting & appliances - commercial', 'Over generation / exports']);
      expect(model.links.map((link) => [link.source.id, link.target.id, link.value])).toEqual([
        ['Heating, "homes"', "Agricultural 'waste'", 1],
        ['Lighting & appliances - commercial', 'Over generation / exports', 2],
      ]);
    }
    const { svg } = render('sankey\n"Heating, ""homes""",Lighting & appliances,1\n', options);
    expect(svg).toContain('>Heating, &quot;homes&quot; <tspan');
    expect(svg).toContain('>Lighting &amp; appliances <tspan');
  });

  for (const keyword of ['sankey', 'sankey-beta']) {
    for (const [from, to] of [
      ['Доход', 'Расходы'],
      ['Café', 'München'],
      ['収入', '支出'],
      ['☀️', '🏠'],
      ['Cafe\u0301', 'Cafe\u0300'],
    ]) {
      for (const quoted of [false, true]) {
        it(`keeps Unicode names ${from}, ${to} with ${keyword}, quoted=${quoted}`, () => {
          const field = (name: string): string => quoted ? `"${name}"` : name;
          const src = `${keyword}\n${field(from)},${field(to)},100\n`;
          const model = parse(src);
          expect(model.type).toBe('sankey');
          if (model.type === 'sankey') {
            expect(model.nodes.map((node) => node.id)).toEqual([from, to]);
            expect(model.links.map((link) => [link.source.id, link.target.id, link.value])).toEqual([[from, to, 100]]);
          }
          const { svg } = render(src, options);
          assertWellFormed(svg);
          expect(svg).toContain(`data-id="${from}"`);
          expect(svg).toContain(`data-id="${to}"`);
          expect(svg).toContain(`>${from} <tspan`);
          expect(svg).toContain(`>${to} <tspan`);
        });
      }
    }

    it(`keeps CSV escaping and node identity with Unicode names in ${keyword}`, () => {
      const src = `${keyword}\n"Доход, ""чистый""",Café,2\nCafé,収入,1\n`;
      const model = parse(src);
      expect(model.type).toBe('sankey');
      if (model.type === 'sankey') {
        expect(model.nodes.map((node) => node.id)).toEqual(['Доход, "чистый"', 'Café', '収入']);
        expect(model.links[0].target).toBe(model.links[1].source);
      }
      const { svg } = render(src, options);
      assertWellFormed(svg);
      expect(svg).toContain('>Доход, &quot;чистый&quot; <tspan');
    });

    it(`decodes entity codes in Unicode names in ${keyword}`, () => {
      const src = `${keyword}\n"Доход #35; #amp; #34;чистый#34;",Расходы,1\n`;
      for (const labelStyle of ['normal', 'outlined']) {
        const { svg } = render(configured(`labelStyle: ${labelStyle}`, src), options);
        assertWellFormed(svg);
        expect(svg).toContain('>Доход # &amp; &quot;чистый&quot; <tspan');
        expect(svg).toContain('data-id="Доход # &amp; &quot;чистый&quot;"');
        expect(svg).toContain('<title>Доход # &amp; &quot;чистый&quot; → Расходы: 1</title>');
        expect(svg).not.toMatch(/ﬂ°|¶ß/);
      }
    });

    it(`rejects malformed CSV containing Unicode names in ${keyword}`, () => {
      for (const row of ['Доход,Расходы', 'Доход,Расходы,1,2', '"Доход,Расходы,1', '"Доход"x,Расходы,1', 'Доход,,1']) {
        expect(() => parse(`${keyword}\n${row}\n`), row).toThrow(PeleError);
      }
    });

    it(`rejects control characters and invalid Unicode in names in ${keyword}`, () => {
      for (const c of ['\x00', '\x01', '\t', '\x1f', '\x7f', '\x80', '\x9f', '\ud800', '\udfff', '\ufffe', '\uffff']) {
        for (const name of [`a${c}b`, `"a${c}b"`]) {
          expect(() => parse(`${keyword}\n${name},c,1\n`), JSON.stringify(name)).toThrow(PeleError);
        }
      }
    });

    it(`rejects entity codes for invalid XML characters in ${keyword}`, () => {
      for (const entity of ['#65534;', '#65535;', '&#65534;', '&#65535;', '#1;']) {
        for (const name of [`a${entity}`, `"a${entity}"`]) {
          for (const row of [`${name},b,1`, `b,${name},1`]) {
            const src = `${keyword}\n${row}\n`;
            expect(() => parse(src), src).toThrow(/Invalid XML character in node name/);
            for (const labelStyle of ['normal', 'outlined']) {
              expect(() => render(configured(`labelStyle: ${labelStyle}`, src), options), src).toThrow(PeleError);
            }
          }
        }
      }
    });

    it(`shows a double-encoded entity code as text in ${keyword}`, () => {
      for (const name of ['a#amp;#35;xFFFE;', '"a#amp;#35;xFFFE;"']) {
        const { svg } = render(`${keyword}\n${name},b,1\n`, options);
        assertWellFormed(svg);
        expect(svg).toContain('>a&amp;#xFFFE; <tspan');
      }
    });

    it(`keeps hexadecimal HTML entity output XML-safe in ${keyword}`, () => {
      for (const entity of ['&#xFFFE;', '&#xFFFF;', '&#x01;']) {
        const src = `${keyword}\nДоход ${entity},Расходы,1\n`;
        for (const labelStyle of ['normal', 'outlined']) {
          const { svg } = render(configured(`labelStyle: ${labelStyle}`, src), options);
          assertWellFormed(svg);
          expect(svg).not.toMatch(/[\x00-\x08\x0b\x0c\x0e-\x1f\ud800-\udfff\ufffe\uffff]/u);
        }
      }
    });
  }

  it('accepts comments, blank lines and both keywords', () => {
    const a = render('sankey-beta\n\n%% source,target,value\na,b,1\n\n\nb,c,2\n', options).svg;
    const b = render('sankey\na,b,1\nb,c,2', options).svg;
    expect(a).toBe(b);
  });

  it('draws the front matter title', () => {
    const plain = render(BASIC, options);
    const titled = render(`---\ntitle: Energy flows\n---\n${BASIC}`, options);
    expect(titled.svg).toContain('class="pele-title"');
    expect(titled.svg).toContain('>Energy flows<');
    expect(titled.height).toBeGreaterThan(plain.height);
  });

  it('rejects circular links at render time, as d3-sankey fails on them', () => {
    expect(() => render('sankey\na,b,1\nb,c,1\nc,a,1\n', options)).toThrow(/circular links.*"[abc]" is part of one/);
    expect(() => render('sankey\na,a,1\n', options)).toThrow(PeleError);
    expect(parse('sankey\na,b,1\nb,a,1\n').type).toBe('sankey');
  });

  it('rejects what Mermaid rejects', () => {
    for (const src of ['sankey\n', 'sankey\na,b\n', 'sankey\na,b,1,2\n', 'sankey\na,,1\n', 'sankey\n"",b,1\n', 'sankey\na,b,1\n   \nc,d,2\n', 'sankey x\na,b,1\n']) {
      expect(() => render(src, options), src).toThrow(PeleError);
    }
    expect(() => render('sankey\na,b\n', options)).toThrow(/Expecting 'COMMA', 'NEWLINE', 'EOF', got 'EOF'|Expecting 'COMMA'/);
  });

  it('draws values that are not usable numbers as empty flows', () => {
    const { svg } = render('sankey\na,b,abc\na,c,-3\nb,d,0\nc,d,2\n', options);
    expect(svg).not.toContain('NaN');
    expect(count(svg, /class="pele-sankey-link"/g)).toBe(4);
    expect(svg).toContain('<title>a → b: 0</title>');
  });
});
