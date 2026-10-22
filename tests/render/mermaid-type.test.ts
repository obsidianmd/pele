import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { PeleError, detectType, parse, render } from '../../src/index.js';
import { metricsMeasurer } from '../../src/text/measurer.js';

const options = { measurer: metricsMeasurer };
const railroad = JSON.parse(readFileSync('tests/corpus/railroad-docs.json', 'utf8')) as string[];
const railroadWith = (header: string): string => railroad.find((src) => src.startsWith(header + '\n'))!;

const thrown = (run: () => unknown): PeleError => {
  try {
    run();
  } catch (error) {
    if (error instanceof PeleError) return error;
    throw error;
  }
  throw new Error('Expected a PeleError.');
};

// [source, Pele's type, what Mermaid 12.1's detectType() returns]
const CASES: [string, string, string][] = [
  ['graph TD\n  A --> B', 'flowchart', 'flowchart-v2'],
  ['flowchart LR\n  A --> B', 'flowchart', 'flowchart-v2'],
  ['flowchart-elk TD\n  A --> B', 'flowchart', 'flowchart-elk'],
  ['classDiagram\n  class A', 'class', 'classDiagram'],
  ['classDiagram-v2\n  class A', 'class', 'classDiagram'],
  ['stateDiagram\n  [*] --> A', 'state', 'stateDiagram'],
  ['stateDiagram-v2\n  [*] --> A', 'state', 'stateDiagram'],
  [railroadWith('railroad-beta'), 'railroad', 'railroad'],
  [railroadWith('railroad-ebnf-beta'), 'railroad', 'railroadEbnf'],
  [railroadWith('railroad-abnf-beta'), 'railroad', 'railroadAbnf'],
  [railroadWith('railroad-peg-beta'), 'railroad', 'railroadPeg'],
  ['sequenceDiagram\n  A->>B: Hi', 'sequence', 'sequence'],
  ['pie\n  "a": 1', 'pie', 'pie'],
];

describe('mermaidType', () => {
  it.each(CASES)('reports Mermaid’s type beside Pele’s for %j', (src, type, mermaidType) => {
    expect(detectType(src)).toBe(type);
    expect(render(src, options)).toMatchObject({ type, mermaidType });
    const model = parse(src);
    expect(model.mermaidType).toBe(mermaidType);
    expect(render(model, options)).toMatchObject({ type, mermaidType });
  });

  it('finds the type after front matter, directives and comments', () => {
    expect(render('---\ntitle: T\n---\nclassDiagram\n  class A', options).mermaidType).toBe('classDiagram');
    expect(render('%%{init: {"theme": "dark"}}%%\ngraph TD\n  A --> B', options).mermaidType).toBe('flowchart-v2');
    expect(render('%% note\nstateDiagram-v2\n  [*] --> A', options).mermaidType).toBe('stateDiagram');
  });

  it('leaves the SVG named by Pele’s type', () => {
    const { svg } = render('graph TD\n  A --> B', options);
    expect(svg).toContain('class="pele pele-flowchart"');
    expect(svg).toContain('aria-roledescription="flowchart"');
  });

  it('is on errors once the type is known', () => {
    expect(thrown(() => render('flowchart LR\n  A -->', options))).toMatchObject({
      code: 'syntax',
      type: 'flowchart',
      mermaidType: 'flowchart-v2',
    });
    expect(thrown(() => render('classDiagram\n  class A', { ...options, outputLimit: 10 }))).toMatchObject({
      code: 'limit',
      type: 'class',
      mermaidType: 'classDiagram',
    });
    expect(thrown(() => render('not a diagram', options))).toMatchObject({ type: null, mermaidType: null });
    expect(thrown(() => parse('graph TD\n  A', { limit: 5 }))).toMatchObject({ code: 'limit', mermaidType: null });
  });
});
