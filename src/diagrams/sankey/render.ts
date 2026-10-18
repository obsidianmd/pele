import type { Config } from '../../preprocess.js';
import { esc, escText, labelSvg, num } from '../../svg/builder.js';
import { svgDocument } from '../../svg/root.js';
import { resolveStyle, seriesColor } from '../../svg/theme.js';
import { decodeEntities } from '../../text/entities.js';
import { layoutLabel } from '../../text/label.js';
import { Style, defaultMeasurer } from '../../text/measurer.js';
import type { RenderOptions, Rendered } from '../../types.js';
import { fitWidth, titleRoom } from '../common/fit-width.js';
import type { SankeyModel } from './db.js';
import { layoutSankey, type Alignment } from './layout.js';

const LABEL_GAP = 6;
const VALUE_GAP = 15;

function isRecord(value: unknown): value is Config {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function numberOption(conf: Config, key: string, fallback: number, min: number, max: number): number {
  const value = conf[key];
  return typeof value === 'number' && value >= min ? Math.min(value, max) : fallback;
}

function textOption(conf: Config, key: string): string {
  const value = conf[key];
  return typeof value === 'string' || (typeof value === 'number' && Number.isFinite(value)) ? String(value) : '';
}

// Two decimals, as Mermaid shows values; numbers too large for that are left as they are.
function rounded(value: number): number {
  return Math.abs(value) < 1e15 ? Math.round(value * 100) / 100 : value;
}

// A colour from the configuration, as an inline style that overrides the series colour.
function fillStyle(color: unknown): string {
  return typeof color === 'string' ? resolveStyle([`fill:${color}`]).shape : '';
}

export function renderSankey(model: SankeyModel, config: Config, options: RenderOptions): Rendered {
  const conf = isRecord(config.sankey) ? config.sankey : {};
  return fitWidth(options, numberOption(conf, 'width', 600, 1, 10000), 160, (chartWidth) => draw(model, conf, options, chartWidth));
}

function draw(model: SankeyModel, conf: Config, options: RenderOptions, chartWidth: number): Rendered {
  const size = options.fontSize ?? 16;
  const small = Math.round(size * 0.875);
  const measurer = options.measurer ?? defaultMeasurer(options.fontFamily);
  const pad = options.padding ?? 8;

  const chartHeight = numberOption(conf, 'height', 400, 1, 10000);
  const nodeWidth = Math.min(numberOption(conf, 'nodeWidth', 10, 1, 200), chartWidth);
  const showValues = conf.showValues !== false;
  const prefix = textOption(conf, 'prefix');
  const suffix = textOption(conf, 'suffix');
  const outlined = conf.labelStyle === 'outlined';
  const alignment: Alignment =
    conf.nodeAlignment === 'left' || conf.nodeAlignment === 'right' || conf.nodeAlignment === 'center'
      ? conf.nodeAlignment
      : 'justify';
  const linkColor = typeof conf.linkColor === 'string' ? conf.linkColor : 'gradient';

  const { nodes, links } = layoutSankey(model, {
    width: chartWidth,
    height: chartHeight,
    nodeWidth,
    nodePadding: numberOption(conf, 'nodePadding', 12, 0, 200) + (showValues ? VALUE_GAP : 0),
    labelHeight: small * 1.15,
    alignment,
  });

  const custom = new Map<string, string>();
  if (isRecord(conf.nodeColors)) {
    for (const [id, color] of Object.entries(conf.nodeColors)) {
      const style = fillStyle(color);
      if (style) custom.set(id, style);
    }
  }
  const nodeStyle = (i: number): string => custom.get(model.nodes[i].id) ?? '';

  // Labels sit beside the bars, on the side that faces the middle of the chart.
  let central = 0;
  let most = 0;
  nodes.forEach((node) => {
    if (node.value > most) {
      most = node.value;
      central = node.layer;
    }
  });
  let minX = 0;
  let maxX = chartWidth;
  let minY = 0;
  let maxY = chartHeight;
  let labelsOut = '';
  let nodesOut = '';
  nodes.forEach((node, i) => {
    const id = model.nodes[i].id;
    const name = decodeEntities(id);
    const height = Math.max(node.height, 1);
    nodesOut += `<rect class="pele-sankey-node" data-id="${escText(id)}" x="${num(node.x)}" y="${num(node.y)}" width="${num(
      nodeWidth
    )}" height="${num(height)}" rx="${num(Math.min(2, height / 2))}" fill="${seriesColor(i)}"${nodeStyle(i)}/>`;

    const value = showValues ? `${prefix}${rounded(node.value)}${suffix}` : '';
    const after = outlined ? node.layer >= central : node.x < chartWidth / 2;
    const textWidth = measurer.width(value ? `${name} ${value}` : name, small, 0);
    const x = after ? node.x + nodeWidth + LABEL_GAP : node.x - LABEL_GAP;
    const y = node.y + node.height / 2;
    minX = Math.min(minX, after ? x : x - textWidth);
    maxX = Math.max(maxX, after ? x + textWidth : x);
    minY = Math.min(minY, y - small * 0.75);
    maxY = Math.max(maxY, y + small * 0.75);
    const position = ` x="${num(x)}" y="${num(y + small * 0.35)}" text-anchor="${after ? 'start' : 'end'}"`;
    const text = esc(name) + (value ? ` <tspan class="pele-sankey-value" fill="var(--_m)">${esc(value)}</tspan>` : '');
    labelsOut +=
      `<g class="pele-label" data-id="${escText(id)}">` +
      (outlined
        ? `<text${position} fill="none" stroke="var(--_bg)" stroke-width="3" stroke-linejoin="round">${esc(name)}${
            value ? ' ' + esc(value) : ''
          }</text>`
        : '') +
      `<text${position}>${text}</text></g>`;
  });

  const fixed = linkColor === 'gradient' || linkColor === 'source' || linkColor === 'target' ? '' : fillStyle(linkColor);
  let linksOut = '';
  for (const link of links) {
    // Without definitions there are no gradients, so a gradient link takes its source's colour.
    const end = linkColor === 'target' ? link.target : link.source;
    const half = Math.max(link.thickness, 1) / 2;
    const x0 = nodes[link.source].x + nodeWidth;
    const x1 = nodes[link.target].x;
    const mid = num((x0 + x1) / 2);
    const from = escText(model.nodes[link.source].id);
    const to = escText(model.nodes[link.target].id);
    linksOut +=
      `<path class="pele-sankey-link" data-id="${from}-&gt;${to}" d="M${num(x0)},${num(link.sourceY - half)}C${mid},${num(
        link.sourceY - half
      )} ${mid},${num(link.targetY - half)} ${num(x1)},${num(link.targetY - half)}L${num(x1)},${num(
        link.targetY + half
      )}C${mid},${num(link.targetY + half)} ${mid},${num(link.sourceY + half)} ${num(x0)},${num(
        link.sourceY + half
      )}Z" fill="${seriesColor(end)}"${fixed || nodeStyle(end)}>` +
      `<title>${from} → ${to}: ${escText(prefix)}${rounded(link.value)}${escText(suffix)}</title></path>`;
  }

  const title = layoutLabel(model.title, false, measurer, size, titleRoom(options), Style.Bold);
  const titleHeight = title.height > 0 ? title.height + 12 : 0;
  const inner = Math.max(maxX - minX, title.width);
  const ox = pad - minX + (inner - (maxX - minX)) / 2;
  const oy = pad + titleHeight - minY;
  const width = Math.ceil(inner + 2 * pad);
  const height = Math.ceil(maxY - minY + titleHeight + 2 * pad);

  const svg = svgDocument(
    'sankey',
    width,
    height,
    size,
    options,
    model,
    labelSvg(title, width / 2, pad + title.height / 2, ' class="pele-title" font-weight="var(--_tw)"') +
      `<g transform="translate(${num(ox)},${num(oy)})">` +
      `<g class="pele-sankey-links" fill-opacity="0.4">${linksOut}</g>` +
      `<g class="pele-sankey-nodes">${nodesOut}</g>` +
      `<g class="pele-labels" font-size="${small}">${labelsOut}</g>` +
      '</g>'
  );

  return { svg, width, height, links: [] };
}
