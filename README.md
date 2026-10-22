# Pele

Pele renders [Mermaid](https://mermaid.js.org) diagrams to SVG. It is small, synchronous, has no runtime dependencies, and uses CSS variables for colors and fonts.

Pele supports every diagram type built into Mermaid 12.1.0.

Documentation, examples, and a playground are at [pele.run](https://pele.run).

## Install

```sh
npm install pele
```

Or load it [from a CDN](https://pele.run/api#using-a-cdn):

```html
<script src="https://cdn.jsdelivr.net/npm/pele@1/dist/pele.global.js"></script>
<script>
  for (const el of document.querySelectorAll('pre.mermaid')) pele.mount(el, el.textContent);
</script>
```

## Use

```ts
import { render } from 'pele';

const { svg } = render(`flowchart LR
  A[Mermaid text] --> B[SVG]`);

document.querySelector('#diagram').innerHTML = svg;
```

In a browser, `mount()` renders into an element, reads fonts from CSS, and adapts the layout to the container width:

```ts
import { mount } from 'pele';

mount(document.querySelector('#diagram'), text);
```

See the [API](https://pele.run/api) for options and error handling.

The main entry point includes every diagram type. Reduce the initial bundle size by registering individual types or loading them on demand:

```ts
import { register, render } from 'pele/core';
import flowchart from 'pele/diagrams/flowchart';

register(flowchart);
```

```ts
import { renderAsync } from 'pele/lazy';

const { svg } = await renderAsync(text);
```

## Theme

Set CSS variables on the diagram or a parent element to customize colors and fonts:

```css
.pele {
  --pele-bg: #fffcf0;
  --pele-fg: #100f0f;
  --pele-muted: #6f6e69;
  --pele-line: #100f0f;
  --pele-surface: #f2f0e5;
  --pele-surface-alt: #e6e4d9;
  --pele-border: #cecdc3;
  --pele-accent: #205ea6;
  --pele-font: sans-serif;
  --pele-radius: 4px;
}
```

Charts use `--pele-series-1` through `--pele-series-8`. Colors adapt to theme changes without being re-rendered. See [Theming](https://pele.run/theming) for all variables, fonts, and class names.

## Security

Pele escapes diagram text, filters links and styles, and limits source and output size. See [Security](https://pele.run/security) for handling untrusted diagrams, displaying errors, and supplying icons.

## Compatibility

Pele targets Mermaid 12.1.0 syntax, with its own layout and visual style. Its parsers are tested against Mermaid's parser specs and with differential fuzzing.

## Develop

```sh
npm install
npm test
npm run build
npm run bench
```

`npm run bench:mermaid` times Pele and Mermaid.js in headless Chrome on the same diagrams and compares bundle sizes. It needs Node 22 or later. It fetches Mermaid 12.1.0 from unpkg; pass `-- --mermaid <version>` for another release, and set `CHROME` if Chrome is not in `/Applications`.

The documentation site and playground are in `website/` and use Node 24 and pnpm 12. With nvm:

```sh
cd website
nvm use
pnpm install
pnpm dev
```

After installing the website dependencies, run `npm run test:website` from the repository root to check the playground.

See [Contributing](CONTRIBUTING.md) for parser testing.

## License

MIT. The specs under `tests/compat` and the grammar files beside them come from Mermaid, which is also MIT licensed.
