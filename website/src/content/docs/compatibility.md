---
title: Compatibility
description: Compare syntax, layout, and features with Mermaid.
---

Pele supports Mermaid syntax with its own layout engine and visual style.

## Diagram types

Pele supports every diagram type built into Mermaid 12.1.0. Browse the [examples](/examples).

| Type | Keywords |
| --- | --- |
| Flowchart | `graph`, `flowchart` |
| Swimlane | `swimlane-beta` |
| Sequence | `sequenceDiagram` |
| Class | `classDiagram` |
| State | `stateDiagram`, `stateDiagram-v2` |
| Entity relationship | `erDiagram` |
| Gantt | `gantt` |
| Git graph | `gitGraph` |
| Pie | `pie` |
| Mindmap | `mindmap` |
| Kanban | `kanban` |
| Timeline | `timeline` |
| User journey | `journey` |
| Quadrant chart | `quadrantChart` |
| XY chart | `xychart`, `xychart-beta` |
| Requirement | `requirementDiagram` |
| Sankey | `sankey`, `sankey-beta` |
| Architecture | `architecture-beta` |
| C4 | `C4Context`, `C4Container`, `C4Component`, `C4Dynamic`, `C4Deployment` |
| Block | `block`, `block-beta` |
| Agentflow | `agentflow-beta` |
| Railroad | `railroad-beta`, `railroad-ebnf-beta`, `railroad-abnf-beta`, `railroad-peg-beta` |
| Tree view | `treeView-beta` |
| Cynefin | `cynefin-beta` |
| Wardley map | `wardley-beta` |
| Event modeling | `eventmodeling` |
| Use case | `usecase-beta` |
| Venn | `venn-beta` |
| Ishikawa | `ishikawa`, `ishikawa-beta` |
| Packet | `packet`, `packet-beta` |
| Radar | `radar-beta` |
| Treemap | `treemap`, `treemap-beta` |
| Info | `info` |

ZenUML and other external Mermaid plugins are not supported. Use [`supports()`](/api#supports) to check whether a diagram type is available.

## Syntax

Pele supports frontmatter, `%%{init}%%` directives, comments, and accessibility titles and descriptions. Configuration support varies by diagram type.

## Differences from Mermaid

### Layout and appearance

Pele uses its own layout. Node positions, spacing, and edge paths differ from Mermaid.

Set colors with [CSS variables](/theming). Mermaid themes and `themeVariables` colors do not apply.

### Sizing

Diagrams scale down to fit narrower containers. Pass [`maxWidth`](/api#narrow-screens) to let the layout adapt. For example, a wide flowchart may switch to a vertical layout.

Set `responsive: false` for a fixed pixel size.

### Subgraphs

A flowchart subgraph keeps its own `direction` even when it links to nodes outside the subgraph.

### Limits

Pele limits source length, SVG output size, and edges in flowcharts and agentflow. See [Security](/security#limits) for defaults and options.

### Labels

Labels use SVG text with support for line breaks, bold, and italic. Arbitrary HTML labels are not supported.

Sankey node names also accept Unicode text, including accented letters, non-Latin scripts, and emoji, in quoted and unquoted CSV fields. This extends Mermaid 12.1.0's ASCII-only Sankey grammar. CSV commas, quotes, and line breaks keep their usual meaning.

### Interaction

`click` statements that open a link are supported. JavaScript callbacks are ignored.

See [Security](/security#links-and-images) to configure allowed links and images.

### Icons

Pass an [`icons`](/api#renderoptions) resolver to supply custom icons such as `fa:fa-car`. Architecture and tree view also have built-in symbols.

### Math

Mermaid 12.1 uses KaTeX to typeset `$$...$$` in labels. Pass a [`math`](/api#math) resolver to typeset the same labels in Pele with KaTeX, Temml, MathJax, or another typesetter. If you don't pass a resolver, labels show the TeX source.

## Reporting differences

If Pele rejects or misreads Mermaid 12.1.0 syntax, compare the diagram in the [Playground](/playground) and [report the difference](https://github.com/obsidianmd/pele/issues).
