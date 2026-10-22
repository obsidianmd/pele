# Pele

Pele renders Mermaid text to SVG for Obsidian, themed with CSS custom properties.

## Conventions

- Comment only non-obvious decisions, intentional differences from Mermaid, and preserved quirks. Keep comments brief.
- Use a short imperative commit subject; add a body only when needed.
- No library runtime dependencies. Dev and website dependencies are allowed.
- Strict TypeScript, ESM. Rendering must be synchronous, without DOM access.
- Identical inputs and text measurer must produce identical SVG.

## Layout

- `src/diagrams/<type>/`: parser, model, layout, renderer.
- `tests/compat/<type>/`: ported Mermaid specs and model adapters. Record skipped cases in the adjacent `SKIPPED.md`.
- `tests/render/`, `tests/layout/`: snapshots and invariants.
- `website/`: docs, examples, and Pele/Mermaid playground.

## Validation

- Library code changes: run `npm run typecheck`, `npm test`, and `npm run build`.
- Website changes: install website dependencies and run `npm run test:website`. These tests are excluded from `npm test`.
- Website setup: Node 24, pnpm 12; see [README.md](README.md#develop). Other commands are in `package.json`.
