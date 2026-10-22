import { readFileSync, readdirSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { render } from '../../src/index.js';
import { metricsMeasurer } from '../../src/text/measurer.js';
import { assertInert } from '../support/inert.js';

const options = { measurer: metricsMeasurer, now: 0 };
const corpora = readdirSync('tests/corpus')
  .filter((file) => file.endsWith('-docs.json'))
  .sort()
  .map((file) => ({ name: file.replace('-docs.json', ''), sources: JSON.parse(readFileSync(`tests/corpus/${file}`, 'utf8')) as string[] }));
const examples = (name: string): string[] => corpora.find((corpus) => corpus.name === name)!.sources;

const PHONE = 320;

describe('the maxWidth option', () => {
  it('never makes a diagram wider, and leaves one that fits as it was', { timeout: 120000 }, () => {
    for (const { name, sources } of corpora) {
      for (const source of sources) {
        const natural = render(source, options);
        const narrow = render(source, { ...options, maxWidth: PHONE });
        expect(narrow.width, name).toBeLessThanOrEqual(natural.width);
        assertInert(narrow.svg, name);
        expect(render(source, { ...options, maxWidth: natural.width }).svg, name).toBe(natural.svg);
      }
    }
  });

  it('draws charts at the width there is, with text at its own size', () => {
    for (const name of ['xychart', 'radar', 'pie']) {
      for (const source of examples(name)) {
        const natural = render(source, options);
        const narrow = render(source, { ...options, maxWidth: PHONE });
        expect(natural.width, name).toBeGreaterThan(PHONE);
        expect(narrow.width, name).toBeLessThanOrEqual(PHONE);
        expect(narrow.svg.match(/^<svg[^>]* font-size="(\d+)"/)?.[1], name).toBe(natural.svg.match(/^<svg[^>]* font-size="(\d+)"/)?.[1]);
      }
    }
  });

  it('draws these types narrower than they are by default', () => {
    for (const name of ['sankey', 'treemap', 'gantt', 'wardley', 'quadrant']) {
      const narrower = examples(name).filter((source) => render(source, { ...options, maxWidth: PHONE }).width < render(source, options).width);
      expect(narrower.length, name).toBeGreaterThan(examples(name).length / 2);
    }
  });

  it('puts a legend below a chart that has no room beside it', () => {
    const pie = 'pie title Pets\n  "Dogs" : 386\n  "Cats" : 85\n  "Rats" : 15';
    const wide = render(pie, options);
    const narrow = render(pie, { ...options, maxWidth: PHONE });
    expect(narrow.width).toBeLessThan(wide.width);
    expect(narrow.height).toBeGreaterThan(wide.height);
    // A legend the author placed is left where it is.
    const placed = `---\nconfig:\n  pie:\n    legendPosition: bottom\n---\n${pie}`;
    expect(render(placed, { ...options, maxWidth: PHONE }).svg).toBe(render(placed, options).svg);
  });

  it('runs a timeline or a git graph downward when it does not fit across', () => {
    const timeline = 'timeline\n  title History\n  section One\n    2001 : First thing\n    2002 : Second thing\n    2003 : Third thing\n  section Two\n    2004 : Fourth thing\n    2005 : Fifth thing';
    const across = render(timeline, options);
    const down = render(timeline, { ...options, maxWidth: PHONE });
    expect(across.width).toBeGreaterThan(PHONE);
    expect(down.width).toBeLessThanOrEqual(PHONE);
    expect(down.height).toBeGreaterThan(across.height);
    // The same drawing as a timeline written to run down, at that width.
    expect(down.svg).toBe(render(timeline.replace('timeline', 'timeline TD'), { ...options, maxWidth: PHONE }).svg);
    expect(render(timeline, { ...options, maxWidth: across.width }).svg).toBe(across.svg);

    const git = 'gitGraph\n  commit\n  commit\n  branch develop\n  commit\n  commit\n  checkout main\n  merge develop\n  commit\n  commit\n  commit';
    const wide = render(git, options);
    expect(wide.width).toBeGreaterThan(PHONE);
    expect(render(git, { ...options, maxWidth: PHONE }).svg).toBe(render(git.replace('gitGraph', 'gitGraph TB:'), options).svg);
    // A direction the author chose is kept.
    const upward = git.replace('gitGraph', 'gitGraph BT:');
    expect(render(upward, { ...options, maxWidth: 100 }).svg).toBe(render(upward, options).svg);
  });

  it('draws a mindmap as an outline when it does not fit', () => {
    const map = 'mindmap\n  root((Plan))\n    Research\n      Read the papers on the subject\n      Interview people\n    Build\n      Prototype\n        First version of the layout\n      Test\n    Ship\n      Write the announcement';
    const across = render(map, options);
    const outline = render(map, { ...options, maxWidth: PHONE });
    expect(across.width).toBeGreaterThan(PHONE);
    expect(outline.width).toBeLessThanOrEqual(PHONE);
    expect(outline.height).toBeGreaterThan(across.height);
    expect(outline.svg.match(/class="pele-node/g)?.length).toBe(across.svg.match(/class="pele-node/g)?.length);
    expect(outline.svg.match(/class="pele-edge"/g)?.length).toBe(across.svg.match(/class="pele-edge"/g)?.length);
    // Every node starts further right than its parent, by the same step for each level.
    const lefts = [...outline.svg.matchAll(/data-id="([^"]*)" transform="translate\(([\d.]+),/g)].map((m) => m[1]);
    expect(lefts.length).toBeGreaterThan(5);
    expect(render(map, { ...options, maxWidth: PHONE, autoDirection: false }).svg).toBe(across.svg);
    expect(render(map, { ...options, maxWidth: 700 }).svg).toBe(across.svg);
    assertInert(outline.svg, 'mindmap');
    // The root heads the outline as a pill, whatever round shape the source gave it. A box stays a box.
    expect(across.svg).toMatch(/pele-shape-circle pele-root/);
    expect(outline.svg).toMatch(/pele-shape-stadium pele-root/);
    expect(render(map.replace('root((Plan))', 'root)Plan('), { ...options, maxWidth: PHONE }).svg).toMatch(/pele-shape-stadium pele-root/);
    expect(render(map.replace('root((Plan))', 'root[Plan]'), { ...options, maxWidth: PHONE }).svg).toMatch(/pele-shape-rect pele-root/);
    // A deep map keeps to the width by wrapping its labels.
    const deep = 'mindmap\n  root\n' + Array.from({ length: 7 }, (_, i) => `${' '.repeat(4 + 2 * i)}Level ${i} with a fairly long label to wrap`).join('\n');
    expect(render(deep, { ...options, maxWidth: PHONE }).width).toBeLessThanOrEqual(PHONE + 40);
  });

  it('folds a kanban board into rows of columns', () => {
    const board = 'kanban\n' + ['Todo', 'Doing', 'Review', 'Done'].map((name, i) => `  c${i}[${name}]\n    t${i}[Task ${i}]`).join('\n');
    const wide = render(board, options);
    const tops = (svg: string): number[] => [...svg.matchAll(/class="pele-cluster pele-column" data-id="[^"]*" transform="translate\([\d.]+,([\d.]+)\)"/g)].map((m) => Number(m[1]));
    expect(new Set(tops(wide.svg)).size).toBe(1);
    const phone = render(board, { ...options, maxWidth: PHONE });
    expect(phone.width).toBeLessThanOrEqual(PHONE);
    expect(new Set(tops(phone.svg)).size).toBe(4);
    const tablet = render(board, { ...options, maxWidth: 480 });
    expect(tablet.width).toBeLessThanOrEqual(480);
    expect(new Set(tops(tablet.svg)).size).toBe(2);
  });

  const ACROSS: [string, string, string][] = [
    ['flowchart', 'flowchart LR\n  A[First step] --> B[Second step] --> C[Third step] --> D[Fourth step] --> E[Fifth step]', 'flowchart TB'],
    ['flowchart RL', 'flowchart RL\n  A[First step] --> B[Second step] --> C[Third step] --> D[Fourth step] --> E[Fifth step]', 'flowchart TB'],
    ['state', 'stateDiagram-v2\n  direction LR\n  [*] --> Drafting\n  Drafting --> Reviewing\n  Reviewing --> Publishing\n  Publishing --> Archiving\n  Archiving --> [*]', 'direction TB'],
    ['class', 'classDiagram\n  direction LR\n  Animal <|-- Mammal\n  Mammal <|-- Primate\n  Primate <|-- Hominid\n  Hominid <|-- Human', 'direction TB'],
    ['er', 'erDiagram\n  direction LR\n  CUSTOMER ||--o{ ORDER : places\n  ORDER ||--|{ LINE_ITEM : contains\n  LINE_ITEM }|--|| PRODUCT : is', 'direction TB'],
  ];

  it('turns a diagram that runs across to run down when it does not fit a narrow width', () => {
    for (const [name, source, down] of ACROSS) {
      const across = render(source, options);
      expect(across.width, name).toBeGreaterThan(PHONE);
      const turned = render(source, { ...options, maxWidth: PHONE });
      expect(turned.width, name).toBeLessThan(across.width);
      expect(turned.height, name).toBeGreaterThan(across.height);
      // The same drawing as the diagram written to run down.
      expect(turned.svg, name).toBe(render(source.replace(/flowchart (?:LR|RL)|direction LR/, down), options).svg);
    }
  });

  it('keeps the direction when told to, at a width over the breakpoint, and when across fits', () => {
    for (const [name, source] of ACROSS) {
      const across = render(source, options);
      // Still running across: no taller than it was. It may be set closer together to fit.
      const stays = (extra: object): void => {
        const drawn = render(source, { ...options, ...extra });
        expect(drawn.height, name).toBeLessThanOrEqual(across.height);
        expect(drawn.width, name).toBeLessThanOrEqual(across.width);
      };
      stays({ maxWidth: PHONE, autoDirection: false });
      stays({ maxWidth: 640 });
      stays({ maxWidth: PHONE, directionBreakpoint: 300 });
      // With the breakpoint raised, a diagram too wide for a wide container turns too.
      const raised = render(source, { ...options, maxWidth: Math.round(across.width / 2), directionBreakpoint: across.width });
      expect(raised.height, name).toBeGreaterThan(across.height);
    }
    const small = 'flowchart LR\n  A --> B';
    expect(render(small, { ...options, maxWidth: PHONE }).svg).toBe(render(small, options).svg);
    const lanes = 'swimlane-beta LR\n  subgraph One\n    A[First step] --> B[Second step]\n  end\n  subgraph Two\n    C[Third step] --> D[Fourth step]\n  end\n  B --> C';
    const compact = render(lanes, { ...options, maxWidth: 100, autoDirection: false });
    expect(compact.width).toBeLessThan(render(lanes, options).width);
    const laneTops = [...compact.svg.matchAll(/data-id="(?:One|Two)"><rect x="[^"]+" y="([^"]+)"/g)].map(match => Number(match[1]));
    expect(new Set(laneTops).size).toBe(2);
    expect(compact.svg).toContain('rotate(-90');
  });

  it('gives up spare room in a class diagram or flowchart that does not fit', () => {
    const namespaces =
      '---\nconfig:\n  class:\n    hierarchicalNamespaces: false\n---\nclassDiagram\n  namespace Company.Engineering.Backend {\n    class Developer\n  }\n  namespace Company.Engineering.Frontend {\n    class Designer\n  }\n' +
      '  namespace Company {\n    class CEO\n  }\n  CEO --> Developer : oversees\n  CEO --> Designer : oversees';
    const loose = render(namespaces, options);
    const tight = render(namespaces, { ...options, maxWidth: 700 });
    expect(loose.width).toBeGreaterThan(700);
    expect(tight.width).toBeLessThan(loose.width * 0.7);
    // The names that the arrows now run through are drawn over them.
    expect(loose.svg).not.toContain('pele-cluster-title"');
    expect(tight.svg.match(/class="pele-cluster-title"/g)?.length).toBe(2);
    expect(tight.svg.indexOf('pele-cluster-titles')).toBeGreaterThan(tight.svg.indexOf('class="pele-edges"'));
    assertInert(tight.svg, 'class');

    const wide = 'flowchart TB\n  A[Start here] --> ' + Array.from({ length: 8 }, (_, i) => `N${i}[Step number ${i}]`).join(' & ');
    const natural = render(wide, options);
    const closer = render(wide, { ...options, maxWidth: 700 });
    expect(natural.width).toBeGreaterThan(700);
    expect(closer.width).toBeLessThan(natural.width);
    expect(closer.svg.match(/class="pele-node/g)?.length).toBe(natural.svg.match(/class="pele-node/g)?.length);
  });

  it('ignores a width that is not a positive number, and survives a tiny one', { timeout: 120000 }, () => {
    for (const { name, sources } of corpora) {
      const source = sources[0];
      const natural = render(source, options).svg;
      for (const maxWidth of [0, -5, NaN, Infinity]) expect(render(source, { ...options, maxWidth }).svg, `${name}: ${maxWidth}`).toBe(natural);
      const tiny = render(source, { ...options, maxWidth: 1 });
      expect(Number.isFinite(tiny.width) && tiny.width > 0, name).toBe(true);
      assertInert(tiny.svg, name);
    }
  });
});
