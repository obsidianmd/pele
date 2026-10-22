import type { Config } from '../../preprocess.js';
import { esc, escText, labelSvg, num } from '../../svg/builder.js';
import { svgDocument } from '../../svg/root.js';
import { ROUNDED, classNames } from '../../svg/theme.js';
import { decodeEntities } from '../../text/entities.js';
import { literalLabel, leftLabelSvg } from '../common/literal-label.js';
import { layoutLabel, type Label } from '../../text/label.js';
import { Style, defaultMeasurer } from '../../text/measurer.js';
import type { RenderOptions, Rendered } from '../../types.js';
import { tighten, titleRoom } from '../common/fit-width.js';
import { BUILTIN_PACK, GLYPHS, getNodeIcon, iconConfig } from './icons.js';
import type { TreeNode, TreeViewModel } from './model.js';

const ICON_GAP = 6;
const DESC_GAP = 16;
const GUIDE_INSET = 7;
const ELBOW = 4;
const HIGHLIGHT_OVERHANG = 4;

function setting(config: Config, key: string, fallback: number, min: number, max: number): number {
  const value = (config.treeView as Config | undefined)?.[key];
  return typeof value === 'number' && value >= min && value <= max ? value : fallback;
}

// Mermaid's layout options, with Pele's defaults.
export function treeSettings(config: Config): { paddingX: number; paddingY: number; rowIndent: number; lineThickness: number } {
  return {
    paddingX: setting(config, 'paddingX', 5, 0, 100),
    paddingY: setting(config, 'paddingY', 2, 0, 100),
    rowIndent: setting(config, 'rowIndent', 15, 0, 400),
    lineThickness: setting(config, 'lineThickness', 1, 0.25, 12),
  };
}

interface Row {
  node: TreeNode;
  x: number;
  cy: number;
  icon: string | undefined;
  text: string;
  labelX: number;
  highlighted: boolean;
  label?: Label;
  description?: Label;
  top: number;
  height: number;
}

export function renderTreeView(model: TreeViewModel, config: Config, options: RenderOptions): Rendered {
  return tighten(options, (tight) => draw(model, config, options, tight));
}

function draw(model: TreeViewModel, config: Config, options: RenderOptions, tight: boolean): Rendered {
  const size = options.fontSize ?? 16;
  const measurer = options.measurer ?? defaultMeasurer(options.fontFamily);
  const pad = options.padding ?? 8;
  const icons = iconConfig(config);

  const { paddingX, paddingY, rowIndent, lineThickness } = treeSettings(config);
  let maxDepth = 0;
  const depths: [TreeNode, number][] = model.root.children.map(node => [node, 0]);
  for (let i = 0; tight && i < depths.length; i++) {
    const [node, depth] = depths[i];
    maxDepth = Math.max(maxDepth, depth);
    for (const child of node.children) depths.push([child, depth + 1]);
  }
  const step = tight ? Math.min(rowIndent + paddingX, Math.max(2, ((options.maxWidth ?? 320) - 120) / Math.max(1, maxDepth))) : rowIndent + paddingX;
  const rowHeight = Math.round(size * 1.5) + 2 * paddingY;
  const iconSize = size;

  const title = layoutLabel(model.title, false, measurer, size, tight ? titleRoom(options) : 4000, Style.Bold);
  const titleHeight = title.height > 0 ? title.height + 12 : 0;

  // Siblings line up: when one entry of a folder has an icon, the others leave room for one.
  const hasIcon = (list: TreeNode[]): boolean => list.some((child) => getNodeIcon(child, icons) !== undefined);
  const rows: Row[] = [];
  const rowOf = new Map<TreeNode, Row>();
  const pending: [TreeNode, number, boolean][] = [];
  const push = (list: TreeNode[], depth: number): void => {
    const slot = hasIcon(list);
    for (let i = list.length - 1; i >= 0; i--) pending.push([list[i], depth, slot]);
  };
  push(model.root.children, 0);
  let labelRight = 0;
  let anyHighlight = false;
  let rowsHeight = 0;
  while (pending.length > 0) {
    const [node, depth, slot] = pending.pop()!;
    const x = depth * step;
    const text = decodeEntities(node.name);
    const labelX = x + (slot ? iconSize + ICON_GAP : 0);
    const room = Math.max(40, (options.maxWidth ?? 320) - 2 * pad - 2 * HIGHLIGHT_OVERHANG - labelX);
    const label = tight ? literalLabel(text, measurer, size, room, node.nodeType === 'directory' ? Style.Bold : 0) : undefined;
    const description = tight && node.description ? literalLabel(decodeEntities(node.description), measurer, size, room, Style.Italic) : undefined;
    const width = label ? label.width : measurer.width(text, size, node.nodeType === 'directory' ? Style.Bold : 0);
    if (labelX + width > labelRight) labelRight = labelX + width;
    const highlighted = node.cssClass !== undefined && node.cssClass.split(/\s+/).includes('highlight');
    if (highlighted) anyHighlight = true;
    const height = tight ? Math.max(rowHeight, (label?.height ?? 0) + (description?.height ?? 0) + 2 * paddingY) : rowHeight;
    const cy = rowsHeight + (tight ? paddingY + Math.max(iconSize, label?.height ?? 0) / 2 : height / 2);
    const row: Row = { node, x, cy, icon: getNodeIcon(node, icons), text, labelX, highlighted, label, description, top: rowsHeight, height };
    rowsHeight += height;
    rows.push(row);
    rowOf.set(node, row);
    push(node.children, depth + 1);
  }

  const descX = labelRight + DESC_GAP;
  let width = labelRight;
  for (const row of rows) {
    const description = row.node.description;
    if (!description) continue;
    const w = row.description ? row.description.width : measurer.width(decodeEntities(description), size, Style.Italic);
    width = Math.max(width, (tight ? row.labelX : descX) + w);
  }
  width = Math.max(width, title.width);
  const inset = pad + (anyHighlight ? HIGHLIGHT_OVERHANG : 0);
  const top = pad + titleHeight;
  const totalWidth = Math.ceil(width + 2 * inset);
  const totalHeight = Math.ceil(top + rowsHeight + pad);

  let guides = '';
  for (const row of rows) {
    const children = row.node.children;
    if (children.length === 0) continue;
    const gx = inset + row.x + GUIDE_INSET;
    const tick = Math.max(gx, inset + row.x + step - paddingX);
    const last = top + rowOf.get(children[children.length - 1])!.cy;
    const r = Math.min(ELBOW, tick - gx);
    let d = `M${num(gx)},${num(top + row.top + row.height - 2)}V${num(last - r)}`;
    if (r > 0) d += `Q${num(gx)},${num(last)} ${num(gx + r)},${num(last)}H${num(tick)}`;
    for (let i = 0; i < children.length - 1 && tick > gx; i++) {
      d += `M${num(gx)},${num(top + rowOf.get(children[i])!.cy)}H${num(tick)}`;
    }
    guides += `<path d="${d}"/>`;
  }

  const baseline = size * 0.35;
  let body = '';
  for (const row of rows) {
    const node = row.node;
    const cy = top + row.cy;
    const directory = node.nodeType === 'directory';
    let inner = '';
    if (row.highlighted) {
      const x = inset + row.x - HIGHLIGHT_OVERHANG;
      inner += `<rect class="pele-tree-highlight" x="${num(x)}" y="${num(top + row.top + 1)}" width="${num(
        totalWidth - inset + HIGHLIGHT_OVERHANG - x
      )}" height="${num(row.height - 2)}" fill="var(--_c)" fill-opacity="0.14"${ROUNDED}/>`;
    }
    if (row.icon !== undefined) {
      const name = row.icon.startsWith(BUILTIN_PACK + ':') ? row.icon.slice(BUILTIN_PACK.length + 1) : '';
      const glyph = GLYPHS.get(name) ?? GLYPHS.get(directory ? 'folder' : 'file')!;
      const drawn = options.icons?.(row.icon) ?? `<path d="${glyph}" stroke="var(--_m)" stroke-width="1.5"/>`;
      inner += `<svg class="pele-icon" data-icon="${escText(row.icon)}" x="${num(inset + row.x)}" y="${num(
        cy - iconSize / 2
      )}" width="${num(iconSize)}" height="${num(
        iconSize
      )}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${drawn}</svg>`;
    }
    if (row.label) {
      inner += leftLabelSvg(row.label, inset + row.labelX, top + row.top + paddingY, ` class="pele-label"${directory ? ' font-weight="var(--_hw)"' : ''}`);
    } else if (row.text !== '') {
      inner += `<text class="pele-label" x="${num(inset + row.labelX)}" y="${num(cy + baseline)}"${
        directory ? ' font-weight="var(--_hw)"' : ''
      } xml:space="preserve">${esc(row.text)}</text>`;
    }
    if (row.description) {
      inner += leftLabelSvg(row.description, inset + row.labelX, top + row.top + paddingY + (row.label?.height ?? 0), ' class="pele-tree-description" font-style="italic" fill="var(--_m)"');
    } else if (node.description) {
      inner += `<text class="pele-tree-description" x="${num(inset + descX)}" y="${num(
        cy + baseline
      )}" font-style="italic" fill="var(--_m)" xml:space="preserve">${esc(decodeEntities(node.description))}</text>`;
    }
    body += `<g class="pele-node pele-tree-${directory ? 'dir' : 'file'}${classNames(node.cssClass ?? '')}" data-id="${escText(
      node.name
    )}">${inner}</g>`;
  }

  const content =
    labelSvg(title, totalWidth / 2, pad + title.height / 2, ' class="pele-title" font-weight="var(--_tw)"') +
    (guides ? `<g class="pele-tree-guides" fill="none" stroke="var(--_b)" stroke-width="${num(lineThickness)}">${guides}</g>` : '') +
    body;

  return {
    svg: svgDocument('treeView', totalWidth, totalHeight, size, options, model, content),
    width: totalWidth,
    height: totalHeight,
    links: [],
  };
}
