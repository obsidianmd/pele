import { describe, expect, it } from 'vitest';
import { PeleError, parse, render, supports, type GanttModel } from '../../src/index.js';
import { metricsMeasurer } from '../../src/text/measurer.js';
import { loadCorpus } from '../support/corpus.js';
import { elements } from '../support/xml.js';

const NOW = new Date(2014, 0, 16, 12);
const options = { measurer: metricsMeasurer, now: NOW };

const BASIC = `gantt
  title A Gantt Diagram
  dateFormat YYYY-MM-DD
  section Section
  A task :a1, 2014-01-01, 30d
  Another task :after a1, 20d
  section Another
  Task in Another :2014-01-12, 12d
  another task :24d`;

function tasksOf(src: string, now: Date = NOW) {
  return (parse(src) as GanttModel).getTasks(now);
}

function count(svg: string, className: string): number {
  return elements(svg).filter((el) => (el.attrs.get('class') ?? '').split(' ').includes(className)).length;
}

// The x position and width of each task bar, by task id.
function bars(svg: string): Map<string, { x: number; width: number }> {
  const out = new Map<string, { x: number; width: number }>();
  for (const m of svg.matchAll(/<g class="pele-task[^"]*" data-id="([^"]*)">(?:<a [^>]*>)?<rect x="([-\d.]+)" y="[-\d.]+" width="([-\d.]+)"/g)) {
    out.set(m[1], { x: Number(m[2]), width: Number(m[3]) });
  }
  return out;
}

describe('gantt rendering', () => {
  it('draws a bar per task, a band and a label per section, an axis, and the title', () => {
    const { svg, type, width, height } = render(BASIC, options);
    expect(type).toBe('gantt');
    expect(supports(BASIC)).toBe(true);
    expect(count(svg, 'pele-task')).toBe(4);
    expect(count(svg, 'pele-section')).toBe(2);
    expect(count(svg, 'pele-section-label')).toBe(2);
    expect(svg).toContain('>A Gantt Diagram<');
    expect(svg).toContain('>Task in Another<');
    expect(svg).toContain('>2014-01-12<');
    expect(svg).toContain('class="pele-grid"');
    expect(width).toBe(800);
    expect(height).toBeGreaterThan(150);
  });

  it('is deterministic for a given time', () => {
    expect(render(BASIC, options).svg).toBe(render(BASIC, options).svg);
  });

  it('places bars in proportion to their dates', () => {
    const b = bars(render('gantt\n dateFormat YYYY-MM-DD\n A :a, 2024-01-01, 10d\n B :b, 2024-01-06, 5d\n C :c, 2024-01-11, 10d', options).svg);
    const a = b.get('a')!;
    expect(b.get('b')!.x).toBeCloseTo(a.x + a.width / 2, 0);
    expect(b.get('b')!.width).toBeCloseTo(a.width / 2, 0);
    expect(b.get('c')!.x).toBeCloseTo(a.x + a.width, 0);
  });

  it('marks today only when it falls inside the chart, and never when switched off', () => {
    expect(render(BASIC, options).svg).toContain('class="pele-today"');
    expect(render(BASIC, { ...options, now: new Date(2020, 0, 1) }).svg).not.toContain('pele-today');
    expect(render(BASIC.replace('dateFormat', 'todayMarker off\n  dateFormat'), options).svg).not.toContain('pele-today');
  });

  it('draws the today marker over completed tasks', () => {
    const { svg } = render('gantt\n dateFormat YYYY-MM-DD\n Done :done, d, 2014-01-01, 30d', options);
    expect(count(svg, 'pele-today')).toBe(1);
    expect(svg.indexOf('class="pele-today"')).toBeGreaterThan(svg.indexOf('class="pele-task pele-done"'));
  });

  it('moves the today marker with the injected time', () => {
    const at = (now: Date): number => Number(/class="pele-today"><path d="M([\d.]+),/.exec(render(BASIC, { ...options, now }).svg)![1]);
    expect(at(new Date(2014, 0, 20))).toBeGreaterThan(at(new Date(2014, 0, 10)));
  });

  it('applies a todayMarker style, keeping only safe declarations', () => {
    const { svg } = render(BASIC.replace('dateFormat', 'todayMarker stroke-width:5px,stroke:#0f0,opacity:0.5,background:url(x)\n  dateFormat'), options);
    expect(svg).toContain('style="stroke-width:5px;stroke:#0f0;opacity:0.5;"');
    expect(svg).not.toContain('url(');
  });

  it('distinguishes done, active, and critical tasks', () => {
    const { svg } = render(
      'gantt\n dateFormat YYYY-MM-DD\n P :p, 2024-01-01, 9d\n A :active, a, 2024-01-01, 9d\n D :done, d, 2024-01-01, 9d\n C :crit, c, 2024-01-01, 9d\n CD :crit, done, cd, 2024-01-01, 9d\n CA :crit, active, ca, 2024-01-01, 9d',
      options
    );
    const paint = (id: string): string => new RegExp(`data-id="${id}"><rect [^>]*?(fill="[^/]*)/>`).exec(svg)![1];
    const all = ['p', 'a', 'd', 'c', 'cd', 'ca'].map(paint);
    expect(new Set(all).size).toBe(6);
    expect(paint('p')).toBe('fill="var(--_c)" stroke="var(--_c)" style="rx:var(--_r)"');
    expect(paint('a')).toContain('fill-opacity="0.25"');
    expect(paint('d')).toContain('fill="var(--_a)"');
    const red = 'var(--pele-critical,#e45756)';
    expect(paint('c')).toBe(`fill="${red}" stroke="${red}" style="rx:var(--_r)"`);
    expect(paint('cd')).toBe(`fill="var(--_a)" stroke="${red}" style="rx:var(--_r)"`);
    expect(paint('ca')).toBe(`fill="${red}" fill-opacity="0.25" stroke="${red}" style="rx:var(--_r)"`);
    expect(svg).toContain('class="pele-task pele-done pele-crit"');
    expect(svg).toContain('class="pele-task pele-active"');
  });

  it('draws a milestone as a diamond centered on the middle of its span', () => {
    const { svg } = render('gantt\n dateFormat HH:mm\n axisFormat %H:%M\n M : milestone, m1, 17:49, 2m\n Task A : 10m', options);
    expect(svg).toMatch(/class="pele-task pele-milestone" data-id="m1"><path d="M[\d.,]+L[\d.,]+L[\d.,]+L[\d.,]+Z"/);
    expect(count(svg, 'pele-task')).toBe(2);
    expect(svg).toContain('>17:50<');
  });

  it('draws vertical markers as lines with labels and gives them no row', () => {
    const withVert = render('gantt\n dateFormat YYYY-MM-DD\n A :a, 2024-01-01, 9d\n Deadline :vert, v, 2024-01-05, 0d', options);
    const without = render('gantt\n dateFormat YYYY-MM-DD\n A :a, 2024-01-01, 9d', options);
    expect(count(withVert.svg, 'pele-vert')).toBe(1);
    expect(count(withVert.svg, 'pele-task')).toBe(1);
    expect(withVert.svg).toContain('>Deadline<');
    expect(withVert.height - without.height).toBeLessThan(30);
  });

  it('puts a label inside its bar when it fits and beside it when it does not', () => {
    const { svg } = render('gantt\n dateFormat YYYY-MM-DD\n Short :a, 2024-01-01, 30d\n A label far too long for its bar :b, 2024-01-02, 1d', options);
    const b = bars(svg);
    const labelX = (text: string): number => Number(new RegExp(`x="([\\d.]+)" y="[\\d.]+" text-anchor="middle">${text}<`).exec(svg)![1]);
    const a = b.get('a')!;
    expect(labelX('Short')).toBeCloseTo(a.x + a.width / 2, 0);
    expect(labelX('A label far too long for its bar')).toBeGreaterThan(b.get('b')!.x + b.get('b')!.width);
    expect(svg).toMatch(/fill="var\(--_bg\)" x="[\d.]+" y="[\d.]+" text-anchor="middle">Short</);
  });

  it('grows to fit a label that sticks out past the right edge', () => {
    const long = 'A label that is much longer than anything the plot leaves room for on either side of the bar, so the chart has to grow';
    const { svg, width } = render(`gantt\n dateFormat YYYY-MM-DD\n ${long} :a, 2024-01-01, 1d\n B :b, 2024-01-01, 2d`, options);
    expect(width).toBeGreaterThan(800);
    expect(svg).toContain(`viewBox="0 0 ${width} `);
  });

  it('shades excluded days and stretches tasks over them', () => {
    const plain = render('gantt\n dateFormat YYYY-MM-DD\n A :a, 2024-01-05, 3d\n B :b, 2024-01-01, 14d', options);
    const excl = render('gantt\n dateFormat YYYY-MM-DD\n excludes weekends\n A :a, 2024-01-05, 3d\n B :b, 2024-01-01, 2024-01-15', options);
    expect(plain.svg).not.toContain('pele-excluded');
    expect(excl.svg).toContain('class="pele-excluded"');
    expect(excl.svg.match(/<g class="pele-excluded"[^>]*>(.*?)<\/g>/)![1].match(/<rect/g)!.length).toBe(2);
    expect(bars(excl.svg).get('a')!.width).toBeGreaterThan(bars(plain.svg).get('a')!.width * 1.5);
  });

  it('honours axisFormat, tickInterval, weekday, and topAxis', () => {
    const src = (extra: string): string => `gantt\n dateFormat YYYY-MM-DD\n${extra} A :a, 2024-01-01, 30d\n`;
    const weekly = render(src(' tickInterval 1week\n weekday monday\n axisFormat %a %e %b\n'), options).svg;
    expect(weekly).toContain('>Mon  1 Jan<');
    expect(weekly).toContain('>Mon  8 Jan<');
    expect(weekly).not.toContain('>Sun');
    const sundays = render(src(' tickInterval 1week\n axisFormat %a %d\n'), options).svg;
    expect(sundays).toContain('>Sun 07<');
    const plain = render(src(''), options);
    const top = render(src(' topAxis\n'), options);
    expect(top.height).toBeGreaterThan(plain.height);
    expect(top.svg.match(/>2024-01-0\d</g)!.length).toBe(2 * plain.svg.match(/>2024-01-0\d</g)!.length);
    expect(render(src(' tickInterval 1decade\n'), options).svg).toBe(plain.svg);
  });

  it('falls back to automatic ticks when an interval would give too many', () => {
    const { svg } = render('gantt\n dateFormat YYYY-MM-DD\n tickInterval 1second\n A :a, 2024-01-01, 300d\n', options);
    expect(svg.match(/<text [^>]*text-anchor="middle">\d{4}-\d\d-\d\d</g)!.length).toBeLessThan(20);
  });

  it('uses day numbers on the axis for the D date format', () => {
    expect(render('gantt\n dateFormat D\n A :a, 5, 9\n', options).svg).toMatch(/>0[5-9]</);
  });

  it('reads gantt settings from the configuration', () => {
    const src = 'gantt\n dateFormat YYYY-MM-DD\n section S\n A :a, 2024-01-01, 30d\n B :b, 2024-01-10, 30d\n';
    const config = (yaml: string): string => `---\nconfig:\n  gantt:\n${yaml}---\n${src}`;
    const plain = render(src, options);
    expect(render(config('    barHeight: 60\n'), options).height).toBeGreaterThan(plain.height + 60);
    expect(render(config('    barGap: 40\n'), options).height).toBeGreaterThan(plain.height + 60);
    expect(render(config('    useWidth: 1200\n'), options).width).toBe(1200);
    expect(render(config('    topAxis: true\n'), options).height).toBeGreaterThan(plain.height);
    expect(render(config('    topPadding: 120\n'), options).height).toBeGreaterThan(plain.height + 80);
    expect(render(config('    axisFormat: "%d/%m"\n'), options).svg).toContain('>07/01<');
    expect(render(config('    tickInterval: 1week\n    weekday: wednesday\n    axisFormat: "%a"\n'), options).svg).toContain('>Wed<');
    expect(render(config('    fontSize: 20\n'), options).svg).toContain('class="pele-tasks" font-size="20"');
    expect(render(config('    sectionFontSize: 22\n'), options).svg).toContain('class="pele-section-labels" font-size="22"');
    expect(bars(render(config('    leftPadding: 300\n'), options).svg).get('a')!.x).toBeGreaterThan(300);
    expect(render(config('    barHeight: "tall"\n    fontSize: -5\n    useWidth: .inf\n'), options).svg).not.toContain('NaN');
  });

  it('cycles section styles by numberSectionStyles', () => {
    const src = 'gantt\n dateFormat YYYY-MM-DD\n section A\n a :2024-01-01, 3d\n section B\n b :2d\n section C\n c :2d\n';
    const four = render(src, options).svg;
    expect(four).toContain('pele-section-0');
    expect(four).toContain('pele-section-2');
    const two = render(`---\nconfig:\n  gantt:\n    numberSectionStyles: 2\n---\n${src}`, options).svg;
    expect(two).not.toContain('pele-section-2');
    expect(two.match(/pele-section-0/g)!.length).toBe(2);
  });

  it('packs tasks that do not overlap onto one row in compact mode', () => {
    const src = 'gantt\n dateFormat YYYY-MM-DD\n section Section\n A :a1, 2014-01-01, 30d\n B :a2, 2014-01-20, 25d\n C :a3, 2014-02-10, 20d\n';
    const plain = render(src, options);
    const compact = render('---\ndisplayMode: compact\n---\n' + src, options);
    const viaConfig = render('---\nconfig:\n  gantt:\n    displayMode: compact\n---\n' + src, options);
    expect(compact.height).toBeLessThan(plain.height);
    expect(viaConfig.height).toBe(compact.height);
    expect(count(compact.svg, 'pele-task')).toBe(3);
    expect((parse('---\ndisplayMode: compact\n---\n' + src) as GanttModel).displayMode).toBe('compact');
  });

  it('links a task that has an href and never emits a callback', () => {
    const { svg, links } = render(
      'gantt\n dateFormat YYYY-MM-DD\n A :cl1, 2014-01-07, 3d\n B :cl2, after cl1, 3d\n click cl1 href "https://mermaidjs.github.io/"\n click cl2 call printArguments("test1", test3)\n',
      options
    );
    expect(links).toEqual([{ id: 'cl1', href: 'https://mermaidjs.github.io/', internal: false }]);
    expect(svg).toContain('<a href="https://mermaidjs.github.io/" rel="noopener">');
    expect(svg).not.toContain('printArguments');
    expect(svg.match(/pele-clickable/g)!.length).toBe(2);
  });

  it('ignores a link to a task defined after the click statement, as Mermaid does', () => {
    expect(render('gantt\n dateFormat YYYY-MM-DD\n click a href "https://example.com"\n A :a, 2014-01-07, 3d\n', options).links).toEqual([]);
  });

  it('takes the title from front matter unless the chart sets one', () => {
    const src = 'gantt\n dateFormat YYYY-MM-DD\n A :a, 2014-01-07, 3d\n';
    expect(render('---\ntitle: From front matter\n---\n' + src, options).svg).toContain('>From front matter<');
    expect(render('---\ntitle: From front matter\n---\n' + src.replace('gantt\n', 'gantt\n title Own\n'), options).svg).toContain('>Own<');
  });

  it('treats a bare title as no title and keeps a title after a tab', () => {
    const model = parse('gantt\ntitle\nsection Work\nTask :2026-01-01, 1d') as GanttModel;
    expect(model.title).toBeUndefined();
    expect(model.getTasks(NOW).map((task) => [task.task, task.section])).toEqual([['Task ', 'Work']]);
    expect((parse('gantt\ntitle\tPlan\n') as GanttModel).title).toBe('Plan');
  });

  it('writes accessible names', () => {
    const { svg } = render('gantt\n accTitle: Plan\n accDescr: Tasks for Q4\n dateFormat YYYY-MM-DD\n A :a, 2014-01-07, 3d\n', options);
    expect(svg).toContain('<title id="pele-title">Plan</title>');
    expect(svg).toContain('<desc id="pele-desc">Tasks for Q4</desc>');
  });

  it('breaks section names at <br> and keeps task names on one line', () => {
    const { svg } = render('gantt\n dateFormat YYYY-MM-DD\n section One<br>Two\n First<br/>second :a, 2014-01-07, 30d\n', options);
    expect(svg).toMatch(/<tspan[^>]*>One<\/tspan><tspan[^>]*>Two<\/tspan>/);
    expect(svg).toContain('>First second<');
  });

  it('draws icons named in section names', () => {
    const { svg } = render('gantt\n dateFormat YYYY-MM-DD\n section fa:fa-flag Launch\n Done :a, 2014-01-07, 30d\n', {
      ...options,
      icons: (name) => (name === 'fa:fa-flag' ? '<path d="M4 12l5 5L20 6"/>' : null),
    });
    expect(svg).toContain('data-icon="fa:fa-flag"');
    expect(svg).toContain('<path d="M4 12l5 5L20 6"/>');
  });

  it('renders a chart with no tasks, and one with only a title', () => {
    expect(render('gantt', options).svg).toContain('<svg');
    expect(render('gantt\n title Empty\n tickInterval 1week\n weekday monday', options).svg).toContain('>Empty<');
  });

  it('renders zero-length charts and tasks without NaN', () => {
    for (const src of [
      'gantt\n dateFormat YYYY-MM-DD\n M :milestone, m, 2014-01-07, 0d\n',
      'gantt\n dateFormat YYYY-MM-DD\n A :a, 2014-01-07, 0d\n B :b, 2014-01-07, bogus\n',
      'gantt\n dateFormat x\n A :a, 0, 0ms\n',
    ]) {
      const { svg } = render(src, options);
      expect(svg).not.toMatch(/NaN|Infinity|undefined/);
      expect(count(svg, 'pele-task')).toBeGreaterThan(0);
    }
  });

  it('renders every documentation example', () => {
    for (const src of loadCorpus('gantt', /^\s*(---[\s\S]*---\s*)?gantt/)) {
      let svg: string;
      try {
        svg = render(src, options).svg;
      } catch (error) {
        expect(error, src).toBeInstanceOf(PeleError);
        continue;
      }
      expect(svg, src).not.toMatch(/NaN|Infinity|undefined/);
    }
  });
});

describe('gantt scheduling', () => {
  it('starts a task with no start, and nothing before it, today', () => {
    const [task] = tasksOf('gantt\n dateFormat YYYY-MM-DD\n A :3d\n');
    expect(task.startTime).toEqual(new Date(2014, 0, 16));
    expect(task.endTime).toEqual(new Date(2014, 0, 19));
  });

  it('uses the injected time for unknown references and for fields a format leaves out', () => {
    const tasks = tasksOf('gantt\n dateFormat HH:mm\n A :a, 17:49, 2m\n B :b, after nothing, 1h\n', new Date(2031, 4, 6, 9, 30));
    expect(tasks[0].startTime).toEqual(new Date(2031, 4, 6, 17, 49));
    expect(tasks[1].startTime).toEqual(new Date(2031, 4, 6));
  });

  it('gives the same result each time it is asked', () => {
    const model = parse('gantt\n dateFormat YYYY-MM-DD\n B :b, 2024-01-01, 2d\n X :x, after b a, 1d\n A :a, 2024-01-10, 5d\n') as GanttModel;
    const first = model.getTasks(NOW).map((t) => [+t.startTime!, +t.endTime!]);
    expect(model.getTasks(NOW).map((t) => [+t.startTime!, +t.endTime!])).toEqual(first);
    // Mermaid schedules x from b alone here, because a comes later and one pass resolves everything else.
    expect(first[1][0]).toBe(+new Date(2024, 0, 3));
  });

  it('leaves tasks that refer to each other unscheduled and still draws the rest', () => {
    const src = 'gantt\n dateFormat YYYY-MM-DD\n A :a, after b, 1d\n B :b, after a, 1d\n C :c, 2024-01-01, 3d\n';
    const tasks = tasksOf(src);
    expect(tasks[0].startTime).toBeUndefined();
    expect(tasks[2].endTime).toEqual(new Date(2024, 0, 4));
    const { svg } = render(src, options);
    expect(count(svg, 'pele-unscheduled')).toBe(2);
    expect(svg).not.toMatch(/NaN|undefined/);
  });

  it('rejects what Mermaid rejects, with its messages', () => {
    expect(() => render('gantt\n dateFormat YYYYMMDD\n A :id1, 202304, 1d\n', options)).toThrow('Invalid date:202304');
    expect(() => render('gantt\n dateFormat YYYY-MM-DD\n excludes weekends monday tuesday wednesday thursday friday\n A :a, 2019-02-01, 7d\n', options)).toThrow(
      'Failed to find a valid date'
    );
    expect(() => render('gantt\n dateFormat YYYY-MM-DD\n A :a, not a date, 7d\n', options)).toThrow(PeleError);
  });

  it('rejects task data Mermaid crashes on, and accepts topAxis, which Mermaid crashes on', () => {
    expect(() => parse('gantt\n A :crit\n')).toThrow(/needs a duration or an end date/);
    expect(() => parse('gantt\n A :a, 2024-01-01, 3d, extra\n')).toThrow(/too many fields/);
    expect((parse('gantt\n topAxis\n') as GanttModel).topAxis).toBe(true);
  });

  it('reads tags, ids, sections, and settings into the model', () => {
    const model = parse(
      'gantt\n dateFormat DD-MM-YYYY\n axisFormat %d\n tickInterval 1day\n excludes weekends 10-02-2025\n includes 15-02-2025\n weekend friday\n weekday tuesday\n inclusiveEndDates\n todayMarker off\n section S\n A :crit, done, a, 03-02-2025, 2d\n B :milestone, 0d\n V :vert, v, 04-02-2025, 0d\n'
    ) as GanttModel;
    expect(model).toMatchObject({
      type: 'gantt',
      dateFormat: 'DD-MM-YYYY',
      axisFormat: '%d',
      tickInterval: '1day',
      excludes: ['weekends', '10-02-2025'],
      includes: ['15-02-2025'],
      weekend: 'friday',
      weekday: 'tuesday',
      inclusiveEndDates: true,
      todayMarker: 'off',
      sections: ['S'],
    });
    const [a, b, v] = model.getTasks(NOW);
    expect(a).toMatchObject({ id: 'a', task: 'A ', section: 'S', crit: true, done: true, active: false, order: 0 });
    expect(b).toMatchObject({ id: 'task1', milestone: true, order: 1 });
    expect(v).toMatchObject({ id: 'v', vert: true, order: -1 });
  });

  it('keeps a task whose name runs into %%', () => {
    expect(tasksOf('gantt\ndateFormat YYYY-MM-DD\nA%% label : 2026-10-24, 1d').map((task) => task.task)).toEqual(['A%% label ']);
  });

  it('treats ids that are Object.prototype names as ordinary ids', () => {
    const { links } = render('gantt\n dateFormat YYYY-MM-DD\n A :__proto__, 2024-10-01, 3d\n B :constructor, after __proto__, 2d\n click __proto__ href "https://mermaid.js.org/"\n', options);
    expect(links).toEqual([{ id: '__proto__', href: 'https://mermaid.js.org/', internal: false }]);
    expect(tasksOf('gantt\n dateFormat YYYY-MM-DD\n A :__proto__, 2024-10-01, 3d\n B :constructor, after __proto__, 2d\n')[1].startTime).toEqual(new Date(2024, 9, 4));
  });
});
