import type { Config } from '../../preprocess.js';
import { esc, escText, labelSvg, num } from '../../svg/builder.js';
import { svgDocument } from '../../svg/root.js';
import { classNames, resolveStyle, rounded, seriesColor } from '../../svg/theme.js';
import { decodeEntities } from '../../text/entities.js';
import { layoutLabel } from '../../text/label.js';
import { Style, defaultMeasurer } from '../../text/measurer.js';
import type { RenderOptions, Rendered } from '../../types.js';
import { capWidth, titleRoom } from '../common/fit-width.js';
import { fitText } from '../common/fit-text.js';
import { formatter } from './format.js';
import { layoutTreemap } from './layout.js';
import type { TreemapModel } from './model.js';

const HEADER = 28;
const SIDE = 6;
const LINE = 1.25;

function option(config: Config, key: string, fallback: number, min: number, max: number): number {
  const value = (config.treemap as Config | undefined)?.[key];
  return typeof value === 'number' && value >= min ? Math.min(value, max) : fallback;
}

export function renderTreemap(model: TreemapModel, config: Config, options: RenderOptions): Rendered {
  const size = options.fontSize ?? 16;
  const small = Math.round(size * 0.875);
  const tiny = Math.round(size * 0.75);
  const least = Math.round(size * 0.5625);
  const measurer = options.measurer ?? defaultMeasurer(options.fontFamily);
  const treemap = (config.treemap ?? {}) as Config;
  const pad = options.padding ?? option(config, 'diagramPadding', 8, 0, 2000);

  // Mermaid sizes the diagram as ten times `nodeWidth` by ten times `nodeHeight`.
  const width = Math.round(capWidth(options, option(config, 'nodeWidth', 64, 1, 400) * 10, 200, 2 * pad));
  const height = Math.round(option(config, 'nodeHeight', 40, 1, 400) * 10);
  const showValues = treemap.showValues !== false;
  const format = formatter(typeof treemap.valueFormat === 'string' ? treemap.valueFormat : ',');
  const boxes = layoutTreemap(model.roots, width, height, {
    gap: option(config, 'padding', 4, 0, 200),
    header: HEADER,
    side: SIDE,
  });

  const title = layoutLabel(model.title, false, measurer, size, titleRoom(options), Style.Bold);
  const titleHeight = title.height > 0 ? title.height + 8 : 0;
  const left = pad + Math.max(0, (title.width - width) / 2);
  const top = pad + titleHeight;

  let sections = '';
  let leaves = '';
  for (const b of boxes) {
    const node = b.node;
    const style = resolveStyle(node.cssCompiledStyles ?? []);
    const color = seriesColor(b.series);
    const x = left + b.x;
    const y = top + b.y;
    const name = decodeEntities(node.name).trim();
    const value = showValues ? format(b.value) : '';
    const group = `data-id="${escText(node.name)}">`;
    const rect = `<rect x="${num(x)}" y="${num(y)}" width="${num(b.w)}" height="${num(b.h)}" fill="${color}"`;

    if (node.children !== undefined) {
      let text = '';
      if (b.h >= HEADER) {
        const room = b.w - 2 * SIDE - 4;
        const valueWidth = value ? measurer.width(value, tiny, 0) : 0;
        const withValue = valueWidth > 0 && room - valueWidth - 12 >= 3 * small;
        const label = fitText(name, withValue ? room - valueWidth - 12 : room, small, small, measurer, Style.Bold);
        const baseline = y + HEADER / 2 + 1;
        if (label) {
          text += `<text x="${num(x + SIDE + 2)}" y="${num(baseline + small * 0.35)}" font-weight="var(--_hw)"${style.text}>${esc(label.text)}</text>`;
        }
        if (withValue) {
          text += `<text class="pele-value" x="${num(x + b.w - SIDE - 2)}" y="${num(baseline + tiny * 0.35)}" font-size="${tiny}" text-anchor="end" fill="var(--_m)"${style.text}>${esc(value)}</text>`;
        }
      }
      // A section is a tint of its color, unless a class gives it a fill of its own.
      const tint = /[";]fill:/.test(style.shape) ? '' : ' fill-opacity="0.12"';
      sections +=
        `<g class="pele-node pele-section${classNames(node.classSelector ?? '')}" ${group}` +
        `${rect}${rounded(`${tint} stroke="${color}"${style.shape}`)}/>${text}</g>`;
      continue;
    }

    let text = '';
    const room = b.w - 8;
    const tallest = Math.min(size, Math.floor((b.h - 4) / LINE));
    const label = tallest >= least ? fitText(name, room, tallest, least, measurer) : undefined;
    if (label) {
      const cx = num(x + b.w / 2);
      const cy = y + b.h / 2;
      const valueSize = Math.max(least, Math.round(label.size * 0.8));
      const lines = (label.size + valueSize) * LINE;
      if (value && lines <= b.h - 4 && measurer.width(value, valueSize, 0) <= room) {
        const first = cy - lines / 2 + (label.size * LINE) / 2;
        const second = cy + lines / 2 - (valueSize * LINE) / 2;
        text =
          `<text x="${cx}" y="${num(first + label.size * 0.35)}" font-size="${num(label.size)}"${style.text}>${esc(label.text)}</text>` +
          `<text class="pele-value" x="${cx}" y="${num(second + valueSize * 0.35)}" font-size="${num(valueSize)}"${style.text}>${esc(value)}</text>`;
      } else {
        text = `<text x="${cx}" y="${num(cy + label.size * 0.35)}" font-size="${num(label.size)}"${style.text}>${esc(label.text)}</text>`;
      }
    }
    leaves += `<g class="pele-node pele-leaf${classNames(node.classSelector ?? '')}" ${group}${rect}${rounded(style.shape)}/>${text}</g>`;
  }

  const totalWidth = Math.ceil(Math.max(width, title.width) + 2 * pad);
  const totalHeight = Math.ceil(height + titleHeight + 2 * pad);
  const content =
    labelSvg(title, totalWidth / 2, pad + title.height / 2, ' class="pele-title" font-weight="var(--_tw)"') +
    (sections ? `<g class="pele-sections" font-size="${small}">${sections}</g>` : '') +
    (leaves ? `<g class="pele-leaves" text-anchor="middle" fill="var(--_bg)">${leaves}</g>` : '');

  return {
    svg: svgDocument('treemap', totalWidth, totalHeight, size, options, model, content),
    width: totalWidth,
    height: totalHeight,
    links: [],
  };
}
