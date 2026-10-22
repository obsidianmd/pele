---
title: Security
description: Render and display untrusted diagrams.
---

Pele escapes diagram text, filters links and styles, and limits source and output size. Your app controls icon and math markup, navigation, and how errors are displayed.

## What the SVG contains

Pele renders diagram source as SVG shapes, text, links, and images. It does not turn diagram source into scripts, event handlers, or HTML labels. JavaScript callbacks in `click` statements are ignored.

Pele filters diagram styles. Your app is responsible for any icon or math markup it supplies. See [App responsibilities](#app-responsibilities).

## Links and images

Pele allows relative URLs and the following URL schemes by default:

| Used for | Schemes |
| --- | --- |
| Links | `http`, `https`, `mailto`, `tel` |
| Images | `http`, `https` |

Other URL schemes and network paths such as `//host/share` are blocked by default.

Use `linkSchemes` or `imageSchemes` to replace the defaults. For example, to allow Obsidian links:

```ts
render(source, { linkSchemes: ['http', 'https', 'mailto', 'obsidian'] });
```

`javascript:`, `data:`, and `vbscript:` are always blocked.

Images can make network requests when displayed. To disable all links and images:

```ts
render(source, { links: false, images: false });
```

URL links have `rel="noopener"` by default. The [`linkRel`](/api#renderoptions) option replaces it:

```ts
render(source, { linkRel: 'noopener nofollow' });
```

## Limits

| Limit | Default | Option |
| --- | --- | --- |
| Length of the source | 50,000 characters | [`limit`](/api#renderoptions) |
| Length of the SVG | 4,000,000 characters | [`outputLimit`](/api#renderoptions) |
| Edges in a flowchart or agentflow | 5,000 | [`maxEdges`](/api#renderoptions) |

Pele rejects diagrams that exceed these limits.

For a time limit, render in a worker that your app can terminate.

## App responsibilities

Display errors with `textContent`. Error messages can contain text from the diagram:

```ts
import { PeleError, render } from 'pele';

try {
  element.innerHTML = render(source).svg;
} catch (error) {
  if (!(error instanceof PeleError)) throw error;
  element.textContent = error.message;
}
```

Supply icons from a set you trust. Pele inserts the markup returned by [`icons`](/api#renderoptions) without filtering. Return nothing for unknown names, and do not insert names into the markup itself.

Pele inserts the markup returned by [`math`](/api#math) without filtering. This markup comes from diagram text, so keep KaTeX's default `trust: false` or load MathJax's `ui/safe` extension. Sanitizers such as DOMPurify remove the `<foreignObject>` that contains HTML math, so if you pass `sanitize` to `mount()`, use a typesetter that produces SVG.

Handle internal links as note names. When an entry in [`links`](/api#renderresult) has `internal: true`, its `href` contains the note name. This value has not been filtered as a URL. Apply your app's navigation policy when opening links.

Keep control of the render options. Do not let diagram authors supply `options` or `options.config` directly.

To use your app's SVG sanitizer, pass a `sanitize` function to [`mount()`](/api#mount). It runs before each SVG is inserted.

## Reporting a vulnerability

Report a security problem privately through [GitHub](https://github.com/obsidianmd/pele/security/advisories/new), not in a public issue.
