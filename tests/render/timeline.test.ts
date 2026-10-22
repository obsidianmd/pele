import { describe, expect, it } from 'vitest';
import { PeleError, parse, render, supports } from '../../src/index.js';
import { metricsMeasurer } from '../../src/text/measurer.js';
import { elements } from '../support/xml.js';

const options = { measurer: metricsMeasurer };
const count = (svg: string, cls: string): number => svg.split(`class="${cls}"`).length - 1;
const texts = (svg: string): string[] => [...svg.matchAll(/>([^<>]+)</g)].map((m) => m[1]);

const SOCIAL = 'timeline\n  title History of Social Media\n  2002 : LinkedIn\n  2004 : Facebook : Google\n  2005 : YouTube\n';

describe('timeline rendering', () => {
  it('draws a title, a period per time period, and its events beneath', () => {
    const { svg, type, links } = render(SOCIAL, options);
    expect(type).toBe('timeline');
    expect(supports(SOCIAL)).toBe(true);
    expect(links).toEqual([]);
    expect(svg).toContain('class="pele pele-timeline"');
    expect(svg).toContain('>History of Social Media<');
    expect(count(svg, 'pele-node pele-period')).toBe(3);
    expect(count(svg, 'pele-node pele-event')).toBe(4);
    expect(count(svg, 'pele-dot')).toBe(3);
    expect(count(svg, 'pele-axis')).toBe(1);
    expect(count(svg, 'pele-marker')).toBe(1);
    expect(texts(svg)).toEqual(['History of Social Media', '2002', 'LinkedIn', '2004', 'Facebook', 'Google', '2005', 'YouTube']);
    expect(svg).toContain('data-id="2004"');
  });

  it('places periods left to right and events below their period', () => {
    const { svg } = render(SOCIAL, options);
    const rects = elements(svg).filter((el) => el.name === 'rect');
    const x = rects.map((el) => Number(el.attrs.get('x')));
    const y = rects.map((el) => Number(el.attrs.get('y')));
    // 2002, LinkedIn, 2004, Facebook, Google, 2005, YouTube
    expect(x[0]).toBe(x[1]);
    expect(x[2]).toBeGreaterThan(x[0]);
    expect(x[3]).toBe(x[2]);
    expect(x[4]).toBe(x[2]);
    expect(x[5]).toBeGreaterThan(x[2]);
    expect(y[2]).toBe(y[0]);
    expect(y[1]).toBeGreaterThan(y[0]);
    expect(y[4]).toBeGreaterThan(y[3]);
  });

  it('gives each period its own series color, or one color with disableMulticolor', () => {
    const multi = render(SOCIAL, options).svg;
    expect(multi).toContain('var(--pele-series-1,');
    expect(multi).toContain('var(--pele-series-2,');
    expect(multi).toContain('var(--pele-series-3,');
    const single = render('---\nconfig:\n  timeline:\n    disableMulticolor: true\n---\n' + SOCIAL, options).svg;
    expect(single).toContain('var(--pele-series-1,');
    expect(single).not.toContain('var(--pele-series-2,');
    const directive = render('%%{init: {"timeline": {"disableMulticolor": true}}}%%\n' + SOCIAL, options).svg;
    expect(directive).toBe(render(SOCIAL, { ...options, config: { timeline: { disableMulticolor: true } } }).svg);
    expect(directive).not.toContain('var(--pele-series-2,');
  });

  it('colors by section and draws a header over each section', () => {
    const { svg } = render('timeline\n  section One\n    A : a\n    B : b\n  section Two\n    C : c\n', options);
    expect(count(svg, 'pele-cluster pele-section')).toBe(2);
    expect(svg).toContain('data-id="One"');
    expect(svg).toContain('>One<');
    expect(svg).not.toContain('var(--pele-series-3,');
    const rects = elements(svg).filter((el) => el.name === 'rect');
    const header = rects[0];
    const [a, , b] = rects.slice(1);
    expect(Number(header.attrs.get('x'))).toBe(Number(a.attrs.get('x')));
    expect(Number(header.attrs.get('width'))).toBe(
      Number(b.attrs.get('x')) + Number(b.attrs.get('width')) - Number(a.attrs.get('x'))
    );
    expect(a.attrs.get('fill')).toBe(header.attrs.get('fill'));
    expect(b.attrs.get('fill')).toBe(header.attrs.get('fill'));
  });

  it('keeps periods that come before the first section, and gives each section its own periods', () => {
    const { svg } = render('timeline\n  Early : e\n  section Same\n    A\n  section Empty\n  section Same\n    B\n', options);
    expect(count(svg, 'pele-node pele-period')).toBe(3);
    expect(count(svg, 'pele-cluster pele-section')).toBe(3);
    expect(svg).toContain('fill="var(--_m)"');
    expect(svg.indexOf('>Early<')).toBeLessThan(svg.indexOf('>Same<'));
  });

  it('runs top to bottom with TD', () => {
    const lr = render(SOCIAL, options);
    const td = render(SOCIAL.replace('timeline', 'timeline TD'), options);
    expect(render(SOCIAL.replace('timeline', 'timeline LR'), options).svg).toBe(lr.svg);
    expect(td.height).toBeGreaterThan(lr.height);
    expect(td.width).toBeLessThan(lr.width);
    expect(count(td.svg, 'pele-node pele-period')).toBe(3);
    expect(count(td.svg, 'pele-node pele-event')).toBe(4);
    const rects = elements(td.svg).filter((el) => el.name === 'rect');
    expect(Number(rects[2].attrs.get('y'))).toBeGreaterThan(Number(rects[0].attrs.get('y')));
    expect(Number(rects[1].attrs.get('x'))).toBeGreaterThan(Number(rects[0].attrs.get('x')));
  });

  it('runs the line from a period to its first event straight, TD, whichever box is taller', () => {
    const source = 'timeline TD\n  2002 : LinkedIn\n  2004 : Facebook : Google\n  2005<br>and on<br>and on : YouTube\n  2006 : first<br>second<br>third<br>fourth\n';
    const { svg } = render(source, options);
    const box = (rect: string): { top: number; bottom: number; middle: number } => {
      const [, y, h] = rect.match(/ y="([\d.]+)" width="[\d.]+" height="([\d.]+)"/) ?? [];
      return { top: Number(y), bottom: Number(y) + Number(h), middle: Number(y) + Number(h) / 2 };
    };
    const rows = svg.split('<g class="pele-node pele-period"').slice(1);
    expect(rows).toHaveLength(4);
    let above = 0;
    for (const row of rows) {
      const boxes = (row.match(/<rect [^>]+>/g) ?? []).map(box);
      const [period, event] = boxes;
      expect(event.middle).toBe(period.middle);
      const path = row.match(/class="pele-edge" d="([^"]+)"/)?.[1] ?? '';
      const stubs = [...path.matchAll(/M[\d.]+,([\d.]+)H/g)].slice(0, 2).map((m) => Number(m[1]));
      expect(stubs).toEqual([period.middle, period.middle]);
      expect(Math.min(...boxes.map((b) => b.top))).toBeGreaterThan(above);
      above = Math.max(...boxes.map((b) => b.bottom));
    }
  });

  it('breaks lines at <br> and wraps long text to the column', () => {
    const one = render('timeline\n  2001 : first second\n', options);
    const two = render('timeline\n  2001 : first<br>second\n', options);
    expect(two.height).toBeGreaterThan(one.height);
    expect(two.width).toBe(one.width);
    expect(texts(two.svg)).toEqual(['2001', 'first', 'second']);
    expect(texts(render('timeline\n  2001 : a<br/>b<br />c\n', options).svg)).toEqual(['2001', 'a', 'b', 'c']);
    const long = render('timeline\n  2001 : ' + 'several words that go on '.repeat(6) + '\n', options);
    expect(long.width).toBe(one.width);
    expect(texts(long.svg).length).toBeGreaterThan(6);
    for (const line of texts(long.svg)) expect(metricsMeasurer.width(line, 14, 0)).toBeLessThanOrEqual(152);
  });

  it('widens columns for a long word, then cuts it', () => {
    const base = render('timeline\n  2001 : short\n', options);
    const word = 'Supercalifragilisticexpiali';
    expect(metricsMeasurer.width(word, 14, 0)).toBeGreaterThan(152);
    expect(metricsMeasurer.width(word, 14, 0)).toBeLessThan(216);
    const wider = render(`timeline\n  2001 : ${word}\n`, options);
    const cut = render('timeline\n  2001 : ' + 'x'.repeat(300) + '\n', options);
    expect(wider.width).toBeGreaterThan(base.width);
    expect(texts(wider.svg)).toEqual(['2001', word]);
    expect(cut.width).toBeLessThanOrEqual(base.width + 64);
    expect(texts(cut.svg).slice(1).join('')).toBe('x'.repeat(300));
    const rect = elements(cut.svg).filter((el) => el.name === 'rect')[1];
    for (const line of texts(cut.svg).slice(1)) {
      expect(metricsMeasurer.width(line, 14, 0)).toBeLessThanOrEqual(Number(rect.attrs.get('width')) - 24);
    }
  });

  it('decodes entities and shows tags, links and icon names as written', () => {
    const { svg } = render('timeline\n  2001 : #35;1 &amp; <b>bold</b> [link](http://example.com) fa:fa-check a<T>\n', options);
    expect(texts(svg).slice(1).join(' ')).toBe('#1 &amp; &lt;b&gt;bold&lt;/b&gt; [link](http://example.com) fa:fa-check a&lt;T&gt;');
    expect(svg).not.toContain('<a');
    expect(svg).not.toContain('pele-icon');
  });

  it('takes the title from front matter unless the diagram sets one', () => {
    expect(render('---\ntitle: From front matter\n---\ntimeline\n  2001\n', options).svg).toContain('>From front matter<');
    const own = render('---\ntitle: From front matter\n---\ntimeline\n  title Own\n  2001\n', options).svg;
    expect(own).toContain('>Own<');
    expect(own).not.toContain('From front matter');
  });

  it('writes accessible names', () => {
    const { svg } = render('timeline\n  accTitle: Short name\n  accDescr {\n    A longer\n    description\n  }\n  2001\n', options);
    expect(svg).toContain('<title id="pele-title">Short name</title>');
    expect(svg).toContain('<desc id="pele-desc">A longer\ndescription</desc>');
  });

  it('draws an empty timeline, a lone title, and sections without periods', () => {
    for (const src of ['timeline', 'timeline TD', 'timeline\n  title Only', 'timeline\n  section S', 'timeline TD\n  section S\n  section T']) {
      const { svg, width, height } = render(src, options);
      expect(svg).not.toMatch(/NaN|Infinity|undefined/);
      expect(width).toBeGreaterThan(0);
      expect(height).toBeGreaterThan(0);
      expect(count(svg, 'pele-axis')).toBe(0);
    }
  });

  it('rejects what Mermaid rejects', () => {
    expect(() => render('timeline\n  : orphan event\n', options)).toThrow(PeleError);
    expect(() => render('timeline\n  2001 :no space\n', options)).toThrow(/Expecting .* got 'INVALID'/);
    expect(() => render('timeline\n  Timeline of things : x\n', options)).toThrow(/got 'timeline'/);
    expect(() => render('timeline\n  accDescr {\n  never closed\n', options)).toThrow(PeleError);
  });

  it('attaches an event after a section header to the last period, as Mermaid does', () => {
    const model = parse('timeline\n  2001 : a\n  section S\n  : b\n');
    expect(model.type).toBe('timeline');
    if (model.type === 'timeline') expect(model.periods[0].events).toEqual(['a', 'b']);
  });

  it('exposes the model', () => {
    const model = parse('timeline TD\n  title T\n  First\n  section S\n    2001 : a : b\n    2002\n');
    expect(model.type).toBe('timeline');
    if (model.type === 'timeline') {
      expect(model.title).toBe('T');
      expect(model.direction).toBe('TD');
      expect(model.sections).toEqual(['S']);
      expect(model.periods).toEqual([
        { text: 'First', events: [], section: '', sectionIndex: -1 },
        { text: '2001 ', events: ['a ', 'b'], section: 'S', sectionIndex: 0 },
        { text: '2002', events: [], section: 'S', sectionIndex: 0 },
      ]);
    }
  });

  it('is deterministic', () => {
    expect(render(SOCIAL, options).svg).toBe(render(SOCIAL, options).svg);
  });
});
