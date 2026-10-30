import { describe, expect, it } from 'vitest';
import { tickStep, tickValue, ticksBetween } from '../../src/diagrams/xychart/ticks.js';
import { PeleError, parse, render, supports } from '../../src/index.js';
import { metricsMeasurer } from '../../src/text/measurer.js';
import { elements, type XmlElement } from '../support/xml.js';

const options = { measurer: metricsMeasurer };

const CHART = `xychart
  title "Sales Revenue"
  x-axis "Month" [jan, feb, mar]
  y-axis "Revenue (in $)" 4000 --> 10000
  bar "2024" [5000, 6000, 7500]
  line "2025" [5500, 7000, 9000]`;

const configured = (body: string, chart: string): string => `---\nconfig:\n  xyChart:\n${body}\n---\n${chart}`;

function tags(svg: string, name: string): XmlElement[] {
  return elements(svg).filter((el) => el.name === name);
}

function texts(svg: string): string[] {
  return [...svg.matchAll(/<text[^>]*>(?:<tspan[^>]*>)?([^<]*)/g)].map((m) => m[1]);
}

function ticks(lo: number, hi: number, count: number): number[] {
  return ticksBetween(lo, hi, tickStep(hi - lo, count));
}

describe('tick selection', () => {
  it('steps by 1, 2 or 5 times a power of ten', () => {
    expect(ticks(0, 100, 10)).toEqual([0, 10, 20, 30, 40, 50, 60, 70, 80, 90, 100]);
    expect(ticks(0, 100, 4)).toEqual([0, 20, 40, 60, 80, 100]);
    expect(ticks(4000, 11000, 7)).toEqual([4000, 5000, 6000, 7000, 8000, 9000, 10000, 11000]);
    expect(ticks(0, 198.2, 8)).toEqual([0, 20, 40, 60, 80, 100, 120, 140, 160, 180]);
    expect(ticks(-6, 8, 7)).toEqual([-6, -4, -2, 0, 2, 4, 6, 8]);
    expect(ticks(3, 7, 2)).toEqual([4, 6]);
  });

  it('gives exact decimals', () => {
    expect(ticks(0, 1, 10)).toEqual([0, 0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 1]);
    expect(ticks(0.3, 0.7, 4)).toEqual([0.3, 0.4, 0.5, 0.6, 0.7]);
    expect(ticks(-0.34, 2.4, 6)).toEqual([0, 0.5, 1, 1.5, 2]);
    expect(ticks(0, 0.0005, 5).map(String)).toEqual(['0', '0.0001', '0.0002', '0.0003', '0.0004', '0.0005']);
  });

  it('copes with huge and tiny ranges', () => {
    expect(ticks(0, 1e300, 5)).toEqual([0, 2e299, 4e299, 6e299, 8e299, 1e300]);
    expect(ticks(0, 1e-12, 2).length).toBeGreaterThan(1);
    expect(ticks(1e15, 1e15 + 10, 5).length).toBeGreaterThan(1);
    expect(tickValue(tickStep(1, 10), 3)).toBe(0.3);
  });
});

describe('XY chart rendering', () => {
  it('draws the title, axes, grid, a bar series, a line series and a legend', () => {
    const { svg, type, width, height } = render(CHART, options);
    expect(type).toBe('xychart');
    expect(supports('xychart-beta\nline [1]')).toBe(true);
    expect([width, height]).toEqual([700, 500]);
    expect(svg).toContain('class="pele pele-xychart"');
    expect(svg).toContain('class="pele-grid"');
    expect(svg).toContain('class="pele-axis"');
    const bars = /<g class="pele-series pele-bars" data-id="2024" fill="([^"]+)">(.*?)<\/g>/.exec(svg)!;
    expect(bars[1]).toContain('--pele-series-1');
    expect(bars[2].match(/<rect/g)?.length).toBe(3);
    const line = /<g class="pele-series pele-line" data-id="2025" fill="([^"]+)">(.*?)<\/g>/.exec(svg)!;
    expect(line[1]).toContain('--pele-series-2');
    expect(line[2]).toMatch(/<path d="M[\d.]+,[\d.]+L[\d.]+,[\d.]+L[\d.]+,[\d.]+" fill="none"/);
    expect(line[2].match(/<circle/g)?.length).toBe(3);
    for (const text of ['Sales Revenue', 'Month', 'Revenue (in $)', 'jan', 'feb', 'mar', '4000', '7000', '10000', '2024', '2025']) {
      expect(texts(svg)).toContain(text);
    }
    expect(svg.match(/class="pele-legend-item"/g)?.length).toBe(2);
  });

  it('draws lines over bars, and colors each series by its place in the source', () => {
    const { svg } = render('xychart\n line [1, 2]\n bar [2, 1]\n line [3, 3]\n bar [1, 1]', options);
    expect([...svg.matchAll(/class="pele-series pele-(\w+)" fill="var\(--pele-series-(\d)/g)].map((m) => m[1] + m[2])).toEqual([
      'bars2',
      'bars4',
      'line1',
      'line3',
    ]);
  });

  it('scales bars to the range and sets them side by side', () => {
    const { svg } = render('xychart\n x-axis [a, b]\n y-axis 0 --> 100\n bar [50, 100]\n bar [25, 75]', options);
    const rects = tags(svg, 'rect').map((r) => ['x', 'y', 'width', 'height'].map((k) => Number(r.attrs.get(k))));
    expect(rects).toHaveLength(4);
    const [a1, b1, a2, b2] = rects;
    expect(b1[3]).toBeCloseTo(a1[3] * 2, 1);
    expect(a2[3]).toBeCloseTo(a1[3] / 2, 1);
    expect(b2[3]).toBeCloseTo(a1[3] * 1.5, 1);
    expect(a1[1] + a1[3]).toBeCloseTo(b2[1] + b2[3], 1);
    expect(a2[0]).toBeGreaterThanOrEqual(a1[0] + a1[2]);
    expect(b1[0]).toBeGreaterThan(a2[0] + a2[2]);
  });

  it('stands bars on zero when the range comes from the data', () => {
    const heights = (src: string): number[] => tags(render(src, options).svg, 'rect').map((r) => Number(r.attrs.get('height')));
    const [low, high] = heights('xychart\n bar [5000, 10000]');
    expect(high).toBeCloseTo(low * 2, 1);
    // Mermaid starts the axis at the smallest value, which leaves that bar with no height.
    expect(low).toBeGreaterThan(100);
    const mixed = tags(render('xychart\n bar [4, -4]', options).svg, 'rect').map((r) => Number(r.attrs.get('y')));
    expect(mixed[1]).toBeGreaterThan(mixed[0]);
  });

  it('keeps an explicit range as written and cuts what falls outside it', () => {
    const { svg } = render('xychart\n x-axis [a, b, c]\n y-axis 10 --> 20\n bar [5, 15, 40]\n line [0, 15, 30]', options);
    expect(texts(svg)).toContain('10');
    expect(texts(svg)).toContain('20');
    expect(texts(svg)).not.toContain('0');
    expect(texts(svg)).not.toContain('40');
    const [under, inside, over] = tags(svg, 'rect').map((r) => Number(r.attrs.get('height')));
    expect(under).toBe(0);
    expect(over).toBeCloseTo(inside * 2, 1);
    const top = Number(tags(svg, 'rect')[2].attrs.get('y'));
    const ys = [.../[ML][\d.]+,([\d.]+)/g[Symbol.matchAll](/class="pele-series pele-line"[^>]*><path d="([^"]+)"/.exec(svg)![1])].map((m) => +m[1]);
    for (const y of ys) expect(y).toBeGreaterThanOrEqual(top);
    expect(tags(svg, 'circle')).toHaveLength(1);
  });

  it('spreads values over a numeric x axis', () => {
    const { svg } = render('xychart\n x-axis "t" 0 --> 10\n line [1, 2, 3]', options);
    const xs = tags(svg, 'circle').map((c) => Number(c.attrs.get('cx')));
    expect(xs[1] - xs[0]).toBeCloseTo(xs[2] - xs[1], 1);
    for (const tick of ['0', '5', '10']) expect(texts(svg)).toContain(tick);
    const auto = render('xychart\n line [5, 6, 7, 8]', options).svg;
    for (const tick of ['1', '2', '3', '4']) expect(texts(auto)).toContain(tick);
  });

  it('falls back to the data range when written y bounds clamp to the same value', () => {
    const big = (e: number): string => '1' + '0'.repeat(e);
    for (const range of [`${big(301)} --> ${big(302)}`, `-${big(302)} --> -${big(301)}`]) {
      expect(render(`xychart\n x-axis [a, b]\n y-axis ${range}\n bar [3, 4]`, options).svg, range).not.toContain('NaN');
    }
  });

  it('leaves out values beyond the categories and categories without a value', () => {
    expect(tags(render('xychart\n x-axis [a, b]\n bar [1, 2, 3, 4]', options).svg, 'rect')).toHaveLength(2);
    const short = render('xychart\n x-axis [a, b, c, d]\n bar [1, 2]\n line [1, 2]', options).svg;
    expect(tags(short, 'rect')).toHaveLength(2);
    expect(tags(short, 'circle')).toHaveLength(2);
    expect(short).not.toContain('NaN');
    const late = render('xychart\n line [1, 2, 3, 4, 5, 6]\n x-axis [a, b]', options);
    const xs = tags(late.svg, 'circle').map((c) => Number(c.attrs.get('cx')));
    expect(xs).toHaveLength(2);
    expect(Math.max(...xs)).toBeLessThan(late.width);
  });

  it('turns the chart on its side for the horizontal orientation', () => {
    const src = 'x-axis [a, b]\n y-axis 0 --> 10\n bar [5, 10]';
    const boxes = (chart: string): number[][] =>
      tags(render(chart, options).svg, 'rect').map((r) => ['x', 'y', 'width', 'height'].map((k) => Number(r.attrs.get(k))));
    const [a, b] = boxes('xychart\n ' + src);
    expect(b[3]).toBeCloseTo(a[3] * 2, 1);
    expect(b[2]).toBe(a[2]);
    expect(b[0]).toBeGreaterThan(a[0]);
    const [c, d] = boxes('xychart horizontal\n ' + src);
    expect(d[2]).toBeCloseTo(c[2] * 2, 1);
    expect(d[3]).toBe(c[3]);
    expect(d[0]).toBe(c[0]);
    expect(d[1]).toBeGreaterThan(c[1]);
    const fromConfig = render(configured('    chartOrientation: horizontal', 'xychart\n ' + src), options).svg;
    expect(fromConfig).toBe(render('xychart horizontal\n ' + src, options).svg);
    const overridden = render(configured('    chartOrientation: horizontal', 'xychart vertical\n ' + src), options).svg;
    expect(overridden).toBe(render('xychart\n ' + src, options).svg);
  });

  it('labels the points of a line', () => {
    const { svg } = render('xychart\n x-axis [Q1, Q2, Q3]\n line [25 "Launch", 45, 72 "Target"]\n bar [1 "ignored", 2, 3]', options);
    const labels = /<g class="pele-point-labels"[^>]*>(.*?)<\/g>/.exec(svg)![1];
    expect(texts(labels)).toEqual(['Launch', 'Target']);
    expect(svg).not.toContain('ignored');
  });

  it('honours the size and the show settings', () => {
    const plain = render(CHART, options).svg;
    const sized = render(configured('    width: 900\n    height: 400', CHART), options);
    expect([sized.width, sized.height]).toEqual([900, 400]);
    expect(render(configured('    showTitle: false', CHART), options).svg).not.toContain('Sales Revenue');
    expect(render(configured('    showLegend: false', CHART), options).svg).not.toContain('pele-legend');
    const noX = render(configured('    xAxis:\n      showLabel: false\n      showTitle: false', CHART), options).svg;
    expect(texts(noX)).not.toContain('jan');
    expect(texts(noX)).not.toContain('Month');
    expect(texts(noX)).toContain('7000');
    const noY = render(configured('    yAxis:\n      showLabel: false\n      showTitle: false', CHART), options).svg;
    expect(texts(noY)).not.toContain('7000');
    expect(texts(noY)).not.toContain('Revenue (in $)');
    expect(texts(noY)).toContain('jan');
    const axis = (svg: string): string => /class="pele-axis" d="([^"]*)"/.exec(svg)?.[1] ?? '';
    const marks = (body: string): string => axis(render(configured(body, CHART), options).svg);
    expect(marks('    xAxis:\n      showTick: false').length).toBeLessThan(axis(plain).length);
    expect(marks('    yAxis:\n      showTick: false').length).toBeLessThan(axis(plain).length);
    expect(marks('    xAxis:\n      showAxisLine: false')).not.toMatch(/H/);
    expect(marks('    yAxis:\n      showAxisLine: false')).not.toMatch(/V/);
    const bare = '    xAxis:\n      showTick: false\n      showAxisLine: false\n    yAxis:\n      showTick: false\n      showAxisLine: false';
    expect(render(configured(bare, CHART), options).svg).not.toContain('pele-axis"');
    expect(render(configured('    width: wide\n    showTitle: 3', CHART), options).svg).toBe(plain);
  });

  it('places the legend beside, above or below the plot', () => {
    // The first legend item is the bar series, so its swatch is a <rect>; the
    // plot's first bar is the first <rect> inside the bars group.
    const legendX = (svg: string): number => Number(/class="pele-legend-item"[^>]*>.*?<rect x="([\d.]+)"/.exec(svg)?.[1]);
    const legendY = (svg: string): number => Number(/class="pele-legend-item"[^>]*>.*?<rect x="[\d.]+" y="([\d.-]+)"/.exec(svg)?.[1]);
    const firstBar = (svg: string): [number, number] => {
      const m = /class="pele-series pele-bars"[^>]*>(.*?)<\/g>/.exec(svg)!;
      const r = /<rect x="([\d.]+)" y="([\d.]+)" width="([\d.]+)" height="([\d.]+)"/.exec(m[1])!;
      return [Number(r[1]), Number(r[2])];
    };
    const positioned = (pos: string): string => render(configured(`    legendPosition: ${pos}`, CHART), options).svg;
    const plain = render(CHART, options).svg;
    const [barX, barY] = firstBar(plain);

    // Default (right): the legend sits past the plot's left edge.
    expect(legendX(plain)).toBeGreaterThan(barX);
    // Left: the legend sits left of the plot, and the plot shifts right.
    const left = positioned('left');
    expect(legendX(left)).toBeLessThan(barX);
    expect(firstBar(left)[0]).toBeGreaterThan(barX);
    // Top: the legend sits above the plot.
    const top = positioned('top');
    expect(legendY(top)).toBeLessThan(barY);
    // Bottom: the legend sits below the plot, past the default legend's height.
    const bottom = positioned('bottom');
    expect(legendY(bottom)).toBeGreaterThan(legendY(plain));
    // An unknown position falls back to the default on the right.
    expect(legendX(positioned('sideways'))).toBeCloseTo(legendX(plain), 6);
  });

  it('writes the value of each bar with showDataLabel', () => {
    const chart = 'xychart\n x-axis [a, b, c]\n y-axis 0 --> 30\n bar [12, 2, 25]\n bar [7, 30, 1]';
    expect(render(chart, options).svg).not.toContain('pele-data-labels');
    const { svg } = render(configured('    showDataLabel: true', chart), options);
    const groups = [...svg.matchAll(/<g class="pele-data-labels"[^>]*>(.*?)<\/g>/g)];
    // Each series shows its own values; Mermaid repeats those of the first series.
    expect(groups.flatMap((g) => texts(g[1])).sort()).toEqual(['1', '12', '2', '25', '30', '7']);
    // They are written past the end of the bars in the text color, whichever way Mermaid's setting is.
    expect(svg).not.toContain('fill="var(--_bg)"');
    for (const outside of ['true', 'false']) {
      expect(render(configured(`    showDataLabel: true\n    showDataLabelOutsideBar: ${outside}`, chart), options).svg).toBe(svg);
    }
  });

  it('thins out category labels that would run into each other', () => {
    const many = Array.from({ length: 200 }, (_, i) => `category${i}`);
    const { svg } = render(`xychart\n x-axis [${many.join(', ')}]\n bar [${many.map((_, i) => i).join(', ')}]`, options);
    const shown = texts(svg).filter((t) => t.startsWith('category'));
    expect(shown.length).toBeGreaterThan(3);
    expect(shown.length).toBeLessThan(15);
    expect(tags(svg, 'rect')).toHaveLength(200);
  });

  it('refuses a chart with no series, as Mermaid does', () => {
    expect(() => render('xychart\n title "Empty"', options)).toThrow('No Plot to render, please provide a plot with some data');
    expect(() => render('xychart\n line [1, 2', options)).toThrow(PeleError);
    expect(() => render('xychart\n x-axis [é]\n line [1]', options)).toThrow(PeleError);
  });

  it('takes the title from front matter unless the chart sets one', () => {
    expect(render('---\ntitle: From front matter\n---\nxychart\n line [1, 2]', options).svg).toContain('From front matter');
    expect(render('---\ntitle: From front matter\n---\nxychart\n title Own\n line [1, 2]', options).svg).toContain('>Own<');
  });

  it('names the chart for assistive technology', () => {
    const { svg } = render('xychart\n accTitle: Sales\n accDescr: By month\n line [1, 2]', options);
    expect(svg).toContain('<title id="pele-title">Sales</title>');
    expect(svg).toContain('<desc id="pele-desc">By month</desc>');
  });

  it('exposes the model', () => {
    const model = parse('xychart horizontal\n title "T"\n x-axis "x" [a, b]\n y-axis "y" 0 --> 5\n bar "s" [1, 2, 3]\n line [2 "p", 1]');
    expect(model.type).toBe('xychart');
    if (model.type === 'xychart') {
      expect(model.title).toBe('T');
      expect(model.orientation).toBe('horizontal');
      expect(model.xAxis).toEqual({ type: 'band', title: 'x', categories: ['a', 'b'] });
      expect(model.yAxis).toEqual({ type: 'linear', title: 'y', min: 0, max: 5 });
      expect(model.plots).toEqual([
        { type: 'bar', title: 's', data: [['a', 1], ['b', 2]] },
        { type: 'line', title: '', data: [['a', 2], ['b', 1]], pointLabels: ['p', ''] },
      ]);
    }
  });

  it('keeps the character before a comment', () => {
    const model = parse('xychart-beta\nx-axis [a, b]\nbar [1,2]%% note');
    expect(model.type === 'xychart' && model.plots).toEqual([{ type: 'bar', title: '', data: [['a', 1], ['b', 2]] }]);
    expect(() => parse('xychart-beta\ntitle Sales:%% note\nbar [1,2]')).toThrow(PeleError);
  });

  it('gives the same output for the same input', () => {
    expect(render(CHART, options).svg).toBe(render(CHART, options).svg);
  });
});
