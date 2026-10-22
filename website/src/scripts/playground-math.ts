import type { MathMarkup, MathResolver } from 'pele';

type Temml = typeof import('temml').default;

let temml: Temml | undefined;
let loading: Promise<unknown> | undefined;
let probe: HTMLElement | undefined;

// Temml is only downloaded once the source has math, and `loaded` draws the diagram again then.
export function playgroundMath(source: string, loaded: () => void): MathResolver | undefined {
  if (!source.includes('$$')) return undefined;
  if (temml) return typeset;
  // Chrome needs Temml's stylesheet for notation such as \overline.
  loading ??= Promise.all([import('temml'), import('temml/dist/Temml-Local.css')]).then(
    ([module]) => {
      temml = module.default;
      loaded();
    },
    () => {
      loading = undefined;
    }
  );
  return undefined;
}

// Temml writes MathML, which Safari places correctly inside SVG.
function typeset(tex: string, size: number): MathMarkup | null {
  if (!probe) {
    probe = document.createElement('div');
    probe.style.cssText = 'position:absolute;left:-9999px;top:0;visibility:hidden;display:inline-block;white-space:nowrap';
    document.body.append(probe);
  }
  try {
    probe.innerHTML = temml!.renderToString(tex, { displayMode: true, throwOnError: true });
  } catch {
    return null;
  }
  probe.style.fontSize = `${size}px`;
  const expression = probe.querySelector('math');
  if (!expression) return null;
  const { width, height } = expression.getBoundingClientRect();
  return { html: expression.outerHTML, width, height };
}
