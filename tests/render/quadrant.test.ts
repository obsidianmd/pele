import { describe, expect, it } from 'vitest';
import { PeleError, parse, render, supports } from '../../src/index.js';
import { metricsMeasurer } from '../../src/text/measurer.js';
import { elements } from '../support/xml.js';

const options = { measurer: metricsMeasurer };

const CHART = `quadrantChart
  title Reach and engagement
  x-axis Low Reach --> High Reach
  y-axis Low Engagement --> High Engagement
  quadrant-1 Expand
  quadrant-2 Promote
  quadrant-3 Re-evaluate
  quadrant-4 Improve
  Campaign A: [0.25, 0.75]
  Campaign B: [0.75, 0.25]`;

function circles(svg: string): Map<string, string>[] {
  return elements(svg)
    .filter((el) => el.name === 'circle')
    .map((el) => el.attrs);
}

function texts(svg: string): string[] {
  return [...svg.matchAll(/<text[^>]*>(?:<tspan[^>]*>)?([^<]*)/g)].map((m) => m[1]);
}

describe('quadrant chart rendering', () => {
  it('draws the title, four quadrants, axis labels and points', () => {
    const { svg, type, width, height } = render(CHART, options);
    expect(type).toBe('quadrantChart');
    expect(supports('quadrantChart')).toBe(true);
    expect([width, height]).toEqual([500, 500]);
    expect(svg).toContain('class="pele pele-quadrantChart"');
    expect(svg.match(/class="pele-quadrant"/g)?.length).toBe(4);
    for (const text of ['Reach and engagement', 'Low Reach', 'High Reach', 'Low Engagement', 'High Engagement']) {
      expect(texts(svg)).toContain(text);
    }
    for (const text of ['Expand', 'Promote', 'Re-evaluate', 'Improve', 'Campaign A', 'Campaign B']) {
      expect(texts(svg)).toContain(text);
    }
    expect(circles(svg)).toHaveLength(2);
    expect(svg).toContain('var(--pele-series-1,');
  });

  it('places points by their coordinates, x to the right and y upwards', () => {
    const dots = circles(render('quadrantChart\n A: [0, 0]\n B: [1, 1]\n C: [0.5, 0.5]', options).svg);
    const at = (id: string): number[] => {
      const dot = dots.find((d) => d.get('data-id') === id)!;
      return [Number(dot.get('cx')), Number(dot.get('cy'))];
    };
    const [ax, ay] = at('A');
    const [bx, by] = at('B');
    expect(bx).toBeGreaterThan(ax);
    expect(by).toBeLessThan(ay);
    expect(at('C')).toEqual([(ax + bx) / 2, (ay + by) / 2]);
  });

  it('puts quadrant 1 at the top right and goes on anticlockwise', () => {
    const { svg } = render('quadrantChart\n quadrant-1 q1\n quadrant-2 q2\n quadrant-3 q3\n quadrant-4 q4', options);
    const rects = elements(svg).filter((el) => el.name === 'rect');
    const [q1, q2, q3, q4] = rects.map((r) => [Number(r.attrs.get('x')), Number(r.attrs.get('y'))]);
    expect(q1[0]).toBeGreaterThan(q2[0]);
    expect(q1[1]).toBe(q2[1]);
    expect(q3[0]).toBe(q2[0]);
    expect(q3[1]).toBeGreaterThan(q2[1]);
    expect(q4).toEqual([q1[0], q3[1]]);
  });

  it('draws the first point on top, as Mermaid does', () => {
    const dots = circles(render('quadrantChart\n First: [0.5, 0.5]\n Second: [0.5, 0.5]', options).svg);
    expect(dots.map((d) => d.get('data-id'))).toEqual(['Second', 'First']);
  });

  it('moves the x axis labels below the chart once there are points', () => {
    const y = (src: string): number => Number(/<text[^>]* y="([\d.]+)"[^>]*>Left</.exec(render(src, options).svg)![1]);
    expect(y('quadrantChart\n x-axis Left --> Right')).toBeLessThan(100);
    expect(y('quadrantChart\n x-axis Left --> Right\n A: [0.5, 0.5]')).toBeGreaterThan(400);
    expect(y('---\nconfig:\n  quadrantChart:\n    xAxisPosition: bottom\n---\nquadrantChart\n x-axis Left --> Right')).toBeGreaterThan(400);
  });

  it('applies point styles, with direct styles over class styles', () => {
    const { svg } = render(
      `quadrantChart
        A: [0.1, 0.1] radius: 12
        B:::c1: [0.2, 0.2] color: #ff3300, radius: 10
        C:::c2: [0.3, 0.3]
        D: [0.4, 0.4] color: 00f, stroke-width: 3px
        E: [0.5, 0.5] stroke-color: #00ff00
        classDef c1 color: #109060
        classDef c2 color: #908342, radius : 9, stroke-color: #310085, stroke-width: 10px`,
      options
    );
    const dot = (id: string) => circles(svg).find((d) => d.get('data-id') === id)!;
    expect(dot('A').get('r')).toBe('12');
    expect(dot('B').get('r')).toBe('10');
    expect(dot('B').get('style')).toBe('fill:#ff3300;');
    expect(dot('B').get('class')).toBe('pele-point c1');
    expect(dot('C').get('r')).toBe('9');
    expect(dot('C').get('style')).toBe('fill:#908342;stroke:#310085;stroke-width:10px;');
    expect(dot('D').get('style')).toBe('fill:#00f;stroke-width:3px;');
    expect(dot('D').get('stroke')).toContain('--pele-series-1');
    // Mermaid gives a stroke colour no width unless one is set, so it does not show.
    expect(dot('E').get('style')).toBeUndefined();
    expect(dot('E').get('r')).toBe('5');
  });

  it("rejects a style Mermaid rejects, with Mermaid's message", () => {
    expect(() => render('quadrantChart\n A: [0.1, 0.1] radius: big', options)).toThrow(
      'value for radius big is invalid, please use a valid number'
    );
    expect(() => render('quadrantChart\n A: [0.1, 0.1] color: red', options)).toThrow(
      'value for color red is invalid, please use a valid hex code'
    );
    expect(() => render('quadrantChart\n classDef c fill: #fff', options)).toThrow('style named fill is not supported.');
    expect(() => render('quadrantChart\n A: [1.2, 0.4]', options)).toThrow(PeleError);
    expect(() => render('quadrantChart\n A: [0.2, 0.4', options)).toThrow(PeleError);
  });

  it('leaves out a point whose coordinate is not a number from 0 to 1', () => {
    // Mermaid's lexer takes `0x5` and `0,5` as coordinates; they are 5 and not a number.
    const dots = circles(render('quadrantChart\n A: [0x5, 0.5]\n B: [0,5, 0.5]\n C: [0.5, 0.5]', options).svg);
    expect(dots.map((d) => d.get('data-id'))).toEqual(['C']);
  });

  it('honours the size, radius, padding and axis position settings', () => {
    const src = 'quadrantChart\n y-axis Down --> Up\n A: [0.5, 0.5]';
    const config = (body: string): string => `---\nconfig:\n  quadrantChart:\n${body}\n---\n${src}`;
    const plain = render(src, options);
    const sized = render(config('    chartWidth: 400\n    chartHeight: 320'), options);
    expect([sized.width, sized.height]).toEqual([400, 320]);
    expect(circles(render(config('    pointRadius: 9'), options).svg)[0].get('r')).toBe('9');
    const cx = (svg: string): number => Number(circles(svg)[0].get('cx'));
    expect(cx(render(config('    yAxisPosition: right'), options).svg)).toBeLessThan(cx(plain.svg));
    expect(cx(render(config('    yAxisLabelPadding: 40'), options).svg)).toBeGreaterThan(cx(plain.svg));
    expect(render(config('    quadrantPadding: 30'), options).svg).not.toBe(plain.svg);
    expect(render(config('    pointTextPadding: 30'), options).svg).not.toBe(plain.svg);
    expect(render(config('    chartWidth: "wide"\n    pointRadius: -3'), options).svg).toBe(plain.svg);
  });

  it('keeps point labels off each other and inside the chart', () => {
    const { svg } = render('quadrantChart\n One: [0.5, 0]\n Two: [0.5, 0.02]\n Three: [1, 1]\n Four: [0, 0.5]', options);
    const labels = [...svg.matchAll(/<text class="pele-label" x="([\d.]+)" y="([\d.]+)"/g)].map((m) => [+m[1], +m[2]]);
    expect(labels).toHaveLength(4);
    for (const [x, y] of labels) {
      expect(x).toBeGreaterThan(8);
      expect(x).toBeLessThan(492);
      expect(y).toBeGreaterThan(8);
      expect(y).toBeLessThan(492);
    }
    expect(new Set(labels.map(([x, y]) => `${Math.round(x / 20)},${Math.round(y / 10)}`)).size).toBe(4);
  });

  it('keeps a boundary point label below its quadrant title before using a crossing fallback', () => {
    const source = `quadrantChart
      title Q4 candidates by effort and impact
      x-axis Low effort --> High effort
      y-axis Low impact --> High impact
      quadrant-1 Plan carefully
      quadrant-2 Do first
      quadrant-3 Reconsider
      quadrant-4 Quick wins
      Chart gallery editor: [0.72, 0.85]
      First-run onboarding: [0.35, 0.78]
      Shared folders: [0.88, 0.70]
      Export to PDF: [0.30, 0.55]
      Custom themes: [0.45, 0.20]
      Calendar sync: [0.65, 0.30]
      Keyboard shortcut sheet: [0.12, 0.48]`;
    const { svg } = render(source, options);
    const quadrant = /<g class="pele-quadrant" data-id="3">([\s\S]*?)<\/g>/.exec(svg)![1];
    const rect = elements(quadrant).find((el) => el.name === 'rect')!.attrs;
    const title = elements(quadrant).find((el) => el.name === 'text')!.attrs;
    const label = elements(/<text[^>]*>Keyboard shortcut sheet<\/text>/.exec(svg)![0])[0].attrs;
    const halfWidth = metricsMeasurer.width('Keyboard shortcut sheet', 12, 0) / 2;
    expect(Number(label.get('y'))).toBeGreaterThan(Number(title.get('y')) + 12);
    expect(Number(label.get('x')) - halfWidth).toBeGreaterThan(Number(rect.get('x')));
    expect(Number(label.get('x')) + halfWidth).toBeLessThan(Number(rect.get('x')) + Number(rect.get('width')));
    expect(circles(svg)).toHaveLength(7);
  });

  it('keeps a label beside its point when there is room before going below the quadrant title', () => {
    const source = `quadrantChart
      title Q4 candidates by effort and impact
      x-axis Low effort --> High effort
      y-axis Low impact --> High impact
      quadrant-1 Plan carefully
      quadrant-2 Do first
      quadrant-3 Reconsider
      quadrant-4 Quick wins
      Left edge: [0, 0.5]`;
    const { svg } = render(source, { ...options, maxWidth: 320 });
    const title = elements(/<text[^>]*>Reconsider<\/text>/.exec(svg)![0])[0].attrs;
    const label = elements(/<text[^>]*>Left edge<\/text>/.exec(svg)![0])[0].attrs;
    expect(Number(label.get('y'))).toBeLessThan(Number(title.get('y')));
  });

  it('reads markdown strings and line breaks in labels', () => {
    const { svg } = render('quadrantChart\n quadrant-1 "`**Bold** text`"\n "two<br>lines": [0.5, 0.5]', options);
    expect(svg).toContain('<tspan x=');
    expect(svg).toContain('font-weight="var(--_w)">Bold</tspan>');
    expect(svg).toMatch(/>two<\/tspan><tspan[^>]*>lines</);
  });

  it('takes the title from front matter unless the chart sets one', () => {
    expect(render('---\ntitle: From front matter\n---\nquadrantChart\n A: [0.5, 0.5]', options).svg).toContain('From front matter');
    expect(render('---\ntitle: From front matter\n---\nquadrantChart\n title Own', options).svg).toContain('>Own<');
  });

  it('names the chart for assistive technology', () => {
    const { svg } = render('quadrantChart\n accTitle: Priorities\n accDescr: Four boxes\n quadrant-1 Plan', options);
    expect(svg).toContain('<title id="pele-title">Priorities</title>');
    expect(svg).toContain('<desc id="pele-desc">Four boxes</desc>');
  });

  it('exposes the model', () => {
    const model = parse('quadrantChart\n x-axis a --> b\n quadrant-2 "`Do`"\n P:::k: [0.2, 0.8] radius: 3\n classDef k color: #abc');
    expect(model.type).toBe('quadrantChart');
    if (model.type === 'quadrantChart') {
      expect(model.xAxisLeft).toEqual({ text: 'a', type: 'text' });
      expect(model.xAxisRight).toEqual({ text: 'b', type: 'text' });
      expect(model.quadrants[1]).toEqual({ text: 'Do', type: 'markdown' });
      expect(model.points).toEqual([{ x: 0.2, y: 0.8, text: { text: 'P', type: 'text' }, className: 'k', radius: 3 }]);
      expect([...model.classes]).toEqual([['k', { color: '#abc' }]]);
    }
  });

  it('gives the same output for the same input', () => {
    expect(render(CHART, options).svg).toBe(render(CHART, options).svg);
  });
});
