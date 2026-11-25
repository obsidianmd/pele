import { describe, expect, it } from 'vitest';
import { registerLayout, render, type Layout, type LayoutContext } from '../../src/index.js';

const FLOW = 'flowchart LR\n  A[One] -->|go| B[Two]\n  B --> C[Three]\n';
const using = (layout: string, source = FLOW, extra = ''): string => `---\nconfig:\n  layout: ${layout}\n${extra}---\n${source}`;

// Nodes in a row 100 apart. Each edge leaves the bottom of its source, turns at a point below,
// and enters the bottom of its target, every leg on the given axis.
const row =
  (axis: number): Layout =>
  (nodes, edges) => {
    nodes.forEach((c, i) => {
      c.x = 50 + 100 * i;
      c.y = 40;
    });
    for (const e of edges) {
      const a = nodes[e.src];
      const b = nodes[e.dst];
      e.route = [a.x, a.y + a.h / 2, axis, (a.x + b.x) / 2, 90, axis, b.x, b.y + b.h / 2, axis];
      e.labelX = (a.x + b.x) / 2;
      e.labelY = 100;
    }
    return { width: 100 * nodes.length, height: 120 };
  };

const paths = (svg: string): string[] => [...svg.matchAll(/<g class="pele-edge[^"]*"[^>]*><path d="([^"]+)"/g)].map((m) => m[1]);

describe('registerLayout', () => {
  it('leaves diagrams that name no registered layout to Pele', () => {
    expect(render(using('dagre')).svg).toBe(render(FLOW).svg);
  });

  it('draws what Pele draws when the layout calls fallback()', () => {
    registerLayout('fallback', (_nodes, _edges, context) => context.fallback());
    expect(render(using('fallback')).svg).toBe(render(FLOW).svg);
  });

  it('draws nodes, edges and labels where the layout puts them', () => {
    let seen: LayoutContext | undefined;
    const place = row(1);
    registerLayout('row', (nodes, edges, context) => {
      seen = context;
      return place(nodes, edges, context);
    });
    const { svg, width, height } = render(using('row', FLOW, '  flowchart:\n    nodeSpacing: 30\n  row:\n    gap: 7\n'));
    // Pele pads the layout's box by 8.
    expect([width, height]).toEqual([316, 136]);
    expect(svg).toContain('data-id="A" transform="translate(58,48)"');
    expect(svg).toContain('data-id="C" transform="translate(258,48)"');
    expect(svg).toMatch(/<text x="108" y="112.9" text-anchor="middle">go<\/text>/);
    expect(seen).toMatchObject({ type: 'flowchart', direction: 'LR', nodeSpacing: 30, config: { row: { gap: 7 } } });
  });

  it('draws legs on axis 2 as straight lines', () => {
    registerLayout('curved', row(0));
    registerLayout('straight', row(2));
    const state = 'stateDiagram-v2\n  A --> B\n';
    for (const source of [FLOW, state]) {
      expect(paths(render(using('curved', source)).svg).every((d) => d.includes('C'))).toBe(true);
      const straight = paths(render(using('straight', source)).svg);
      expect(straight.length).toBeGreaterThan(0);
      for (const d of straight) {
        // The corner at y = 98 stays sharp.
        expect(d).toMatch(/^M[\d.,]+L[\d.]+,98(L[\d.,]+)+$/);
      }
    }
  });

  it('places every diagram that uses the graph layout', () => {
    const types: string[] = [];
    const place = row(1);
    registerLayout('recorder', (nodes, edges, context) => {
      types.push(context.type);
      return place(nodes, edges, context);
    });
    const sources = [
      'flowchart LR\n  A --> B',
      'stateDiagram-v2\n  A --> B',
      'classDiagram\n  A --> B',
      'erDiagram\n  A ||--o{ B : has',
      'requirementDiagram\n  requirement A {\n    id: 1\n  }\n  element B {\n    type: x\n  }\n  B - satisfies -> A',
      'usecase-beta\n  actor A\n  A --> B',
      'agentflow-beta LR\n  a["A"] --> b["B"]',
    ];
    for (const source of sources) expect(render(using('recorder', source + '\n')).svg).toContain('translate(58,48)');
    expect(types).toEqual(['flowchart', 'state', 'class', 'er', 'requirement', 'usecase', 'agentflow']);
    const lanes = 'swimlane-beta LR\n  subgraph L1\n    A --> B\n  end\n';
    expect(render(using('recorder', lanes)).svg).toBe(render(lanes).svg);
  });
});
