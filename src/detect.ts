export type DiagramType =
  | 'flowchart'
  | 'sequence'
  | 'class'
  | 'state'
  | 'er'
  | 'pie'
  | 'gantt'
  | 'gitGraph'
  | 'mindmap'
  | 'timeline'
  | 'journey'
  | 'xychart'
  | 'quadrantChart'
  | 'requirement'
  | 'c4'
  | 'sankey'
  | 'block'
  | 'packet'
  | 'kanban'
  | 'architecture'
  | 'radar'
  | 'treemap'
  | 'info'
  | 'agentflow'
  | 'usecase'
  | 'railroad'
  | 'treeView'
  | 'venn'
  | 'cynefin'
  | 'wardley'
  | 'swimlane'
  | 'ishikawa'
  | 'eventmodeling';

// Mermaid's detectors, in the order Mermaid registers them. The first match wins.
const DETECTORS = [
  ['flowchart', 'flowchart-elk', /^\s*flowchart-elk/],
  ['mindmap', 'mindmap', /^\s*mindmap/],
  ['architecture', 'architecture', /^\s*architecture/],
  ['agentflow', 'agentflow', /^\s*agentflow-beta\b/],
  ['c4', 'c4', /^\s*(?:C4Context|C4Container|C4Component|C4Dynamic|C4Deployment)/],
  ['kanban', 'kanban', /^\s*kanban/],
  ['class', 'classDiagram', /^\s*classDiagram/],
  ['er', 'er', /^\s*erDiagram/],
  ['gantt', 'gantt', /^\s*gantt/],
  ['info', 'info', /^\s*info/],
  ['pie', 'pie', /^\s*pie/],
  ['requirement', 'requirement', /^\s*requirement(Diagram)?/],
  ['sequence', 'sequence', /^\s*sequenceDiagram/],
  ['swimlane', 'swimlane', /^\s*swimlane-beta\b/],
  ['flowchart', 'flowchart-v2', /^\s*(graph|flowchart)/],
  ['timeline', 'timeline', /^\s*timeline/],
  ['gitGraph', 'gitGraph', /^\s*gitGraph/],
  ['state', 'stateDiagram', /^\s*stateDiagram/],
  ['journey', 'journey', /^\s*journey/],
  ['quadrantChart', 'quadrantChart', /^\s*quadrantChart/],
  ['sankey', 'sankey', /^\s*sankey(-beta)?/],
  ['packet', 'packet', /^\s*packet(-beta)?/],
  ['xychart', 'xychart', /^\s*xychart(-beta)?/],
  ['block', 'block', /^\s*block(-beta)?/],
  ['eventmodeling', 'eventmodeling', /^\s*eventmodeling/],
  ['treeView', 'treeView', /^\s*treeView-beta/],
  ['radar', 'radar', /^\s*radar-beta/],
  ['ishikawa', 'ishikawa', /^\s*ishikawa(-beta)?\b/i],
  ['treemap', 'treemap', /^\s*treemap/],
  ['railroad', 'railroad', /^\s*railroad-beta/i],
  ['railroad', 'railroadEbnf', /^\s*railroad-ebnf-beta/i],
  ['railroad', 'railroadAbnf', /^\s*railroad-abnf-beta/i],
  ['railroad', 'railroadPeg', /^\s*railroad-peg-beta/i],
  ['venn', 'venn', /^\s*venn-beta/],
  ['wardley', 'wardley', /^\s*wardley-beta/i],
  ['cynefin', 'cynefin', /^\s*cynefin-beta(?:[\s:]|$)/],
  ['usecase', 'usecase', /^\s*usecase-beta(?:\s|$)/],
] as const satisfies readonly (readonly [DiagramType, string, RegExp])[];

// The diagram type as Mermaid reports it, such as `flowchart-v2` for `graph TD`.
export type MermaidType = (typeof DETECTORS)[number][1];

export interface Detected {
  type: DiagramType;
  mermaidType: MermaidType;
}

export function detectDiagram(cleaned: string): Detected | null {
  for (const [type, mermaidType, re] of DETECTORS) if (re.test(cleaned)) return { type, mermaidType };
  return null;
}

export function detect(cleaned: string): DiagramType | null {
  return detectDiagram(cleaned)?.type ?? null;
}
