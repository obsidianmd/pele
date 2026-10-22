import { layoutLabel, type Label } from '../text/label.js';
import { withoutMath } from '../text/math.js';
import { Style, type TextMeasurer } from '../text/measurer.js';
import { labelSvg, num } from './builder.js';

// Mermaid draws diagram titles as text, whatever they hold.
export function titleLabel(title: string | undefined, measurer: TextMeasurer, size: number, maxWidth: number): Label {
  return withoutMath(() => layoutLabel(title, false, measurer, size, maxWidth, Style.Bold));
}

export interface Titled {
  width: number;
  height: number;
  content: string;
}

// Puts a diagram title above content that was laid out without one.
export function withTitle(
  title: string | undefined,
  measurer: TextMeasurer,
  size: number,
  pad: number,
  width: number,
  height: number,
  content: string
): Titled {
  const label = titleLabel(title, measurer, size, 4000);
  if (label.height === 0) return { width, height, content };
  const shift = label.height + 12;
  const full = Math.max(width, Math.ceil(label.width + 2 * pad));
  return {
    width: full,
    height: Math.ceil(height + shift),
    content:
      labelSvg(label, full / 2, pad + label.height / 2, ' class="pele-title" font-weight="var(--_tw)"') +
      `<g transform="translate(${num((full - width) / 2)},${num(shift)})">${content}</g>`,
  };
}
