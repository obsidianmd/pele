import type { Config } from '../../preprocess.js';
import { esc, labelSvg, num } from '../../svg/builder.js';
import { svgDocument } from '../../svg/root.js';
import { ROUNDED } from '../../svg/theme.js';
import { decodeEntities } from '../../text/entities.js';
import { layoutLabel } from '../../text/label.js';
import { Style, defaultMeasurer } from '../../text/measurer.js';
import type { RenderOptions, Rendered } from '../../types.js';
import { turnToFit, titleRoom } from '../common/fit-width.js';
import { literalLabel } from '../common/literal-label.js';
import type { PacketBlock } from './model.js';
import { fitText, type Fitted } from '../common/fit-text.js';
import { packetOption, type PacketModel } from './model.js';

export function renderPacket(model: PacketModel, config: Config, options: RenderOptions): Rendered {
  return turnToFit(options, (down) => draw(model, config, options, down));
}

function draw(model: PacketModel, config: Config, options: RenderOptions, down: boolean): Rendered {
  const size = options.fontSize ?? 16;
  const labelSize = Math.round(size * 0.875);
  const bitSize = Math.round(size * 0.625);
  const measurer = options.measurer ?? defaultMeasurer(options.fontFamily);
  const pad = options.padding ?? 8;

  const packet = (config.packet ?? {}) as Config;
  const rowHeight = packetOption(config, 'rowHeight', 32, 1, 400);
  let bitWidth = packetOption(config, 'bitWidth', 32, 1, 400);
  const paddingX = packetOption(config, 'paddingX', 5, 0, 400);
  const paddingY = packetOption(config, 'paddingY', 5, 0, 400);
  const showBits = packet.showBits !== false;
  const descending = packet.bitOrder === 'descending';
  let bitsPerRow = model.bitsPerRow;
  let rows = model.rows;
  if (down) {
    const count = Math.max(1, Math.floor(((options.maxWidth ?? 320) - 2 * pad) / Math.min(bitWidth, 18)));
    // A byte is the shortest row. Below that every label is one character to a line, and a long
    // packet is a row to a bit.
    bitsPerRow = Math.min(bitsPerRow, Math.max(8, 2 ** Math.floor(Math.log2(count))));
    const lastRow = model.rows[model.rows.length - 1];
    const last = lastRow?.[lastRow.length - 1]?.end ?? 0;
    if (Math.ceil((last + 1) / bitsPerRow) > 10000) bitsPerRow = model.bitsPerRow;
    bitWidth = Math.min(bitWidth, Math.max(18, ((options.maxWidth ?? 320) - 2 * pad) / bitsPerRow));
    // The model has split each field at its own rows. Its pieces are joined again first, so that
    // a field is only split where one of the new rows ends. A piece counts one bit short.
    const piece = (block: PacketBlock): boolean => block.bits === block.end - block.start;
    const whole: PacketBlock[] = [];
    for (const row of model.rows) for (const block of row) {
      const prev = whole[whole.length - 1];
      if (prev && piece(prev) && piece(block) && prev.label === block.label && block.start === prev.end + 1 && block.start % model.bitsPerRow === 0) {
        prev.end = block.end;
        prev.bits = prev.end - prev.start;
      } else whole.push({ ...block });
    }
    rows = [];
    for (const block of whole) {
      for (let start = block.start; start <= block.end;) {
        const end = Math.min(block.end, (Math.floor(start / bitsPerRow) + 1) * bitsPerRow - 1);
        const index = Math.floor(start / bitsPerRow);
        const target = rows[index] ?? (rows[index] = []);
        target.push({ ...block, start, end });
        start = end + 1;
      }
    }
  }
  const labels = new Map<PacketBlock, ReturnType<typeof literalLabel>>();
  if (down) for (const row of rows) for (const block of row) {
    const room = Math.max(1, (block.end - block.start + 1) * bitWidth - Math.min(paddingX, bitWidth - 1) - 6);
    const label = literalLabel(decodeEntities(block.label).trim(), measurer, labelSize, room);
    labels.set(block, label);
  }
  // Bit numbers sit above each row and need room of their own.
  const numbers = showBits ? bitSize + 4 : 0;
  const rowHeights = rows.map(row => {
    let height = rowHeight;
    if (down) for (const block of row) height = Math.max(height, labels.get(block)!.height + 10);
    return height;
  });
  const tops: number[] = [];
  let rowsHeight = 0;
  for (const height of rowHeights) { tops.push(rowsHeight); rowsHeight += numbers + height + paddingY; }
  if (rows.length) rowsHeight -= paddingY;

  const gap = Math.min(paddingX, bitWidth - 1);
  const width = rows.length > 0 ? bitsPerRow * bitWidth - gap : 0;
  const title = layoutLabel(model.title, false, measurer, size, down ? titleRoom(options) : 4000, Style.Bold);
  const titleHeight = title.height > 0 ? title.height + (rowsHeight > 0 ? 12 : 0) : 0;

  // The pieces of a field split across rows share its label, so each width is fitted once.
  const fits = new Map<string, Map<number, Fitted | undefined>>();
  const fit = (label: string, max: number): Fitted | undefined => {
    let byWidth = fits.get(label);
    if (!byWidth) fits.set(label, (byWidth = new Map()));
    if (!byWidth.has(max)) {
      byWidth.set(max, fitText(decodeEntities(label).trim(), max, labelSize, Math.round(size * 0.5), measurer));
    }
    return byWidth.get(max);
  };

  const left = pad + Math.max(0, (title.width - width) / 2);
  let fields = '';
  let bits = '';
  rows.forEach((row, index) => {
    const y = pad + tops[index] + numbers;
    const rowHeight = rowHeights[index];
    for (const block of row) {
      const count = block.end - block.start + 1;
      const first = block.start % bitsPerRow;
      const x = left + (descending ? bitsPerRow - first - count : first) * bitWidth;
      const w = count * bitWidth - gap;
      const text = down ? undefined : fit(block.label, w - 6);
      fields +=
        `<g class="pele-node" data-id="${block.start}-${block.end}">` +
        `<rect x="${num(x)}" y="${num(y)}" width="${num(w)}" height="${num(rowHeight)}" fill="var(--_s)" stroke="var(--_b)"${ROUNDED}/>` +
        (down ? labelSvg(labels.get(block)!, x + w / 2, y + rowHeight / 2, '') : text && text.size <= rowHeight
          ? `<text x="${num(x + w / 2)}" y="${num(y + rowHeight / 2 + text.size * 0.35)}"${
              text.size === labelSize ? '' : ` font-size="${num(text.size)}"`
            }>${esc(text.text)}</text>`
          : '') +
        '</g>';
      if (!showBits) continue;
      const leading = descending ? block.end : block.start;
      const trailing = descending ? block.start : block.end;
      if (count === 1) {
        bits += `<text x="${num(x + w / 2)}" y="${num(y - 4)}" text-anchor="middle">${leading}</text>`;
      } else {
        bits +=
          `<text x="${num(x)}" y="${num(y - 4)}">${leading}</text>` +
          `<text x="${num(x + w)}" y="${num(y - 4)}" text-anchor="end">${trailing}</text>`;
      }
    }
  });

  const totalWidth = Math.ceil(Math.max(width, title.width) + 2 * pad);
  const totalHeight = Math.ceil(rowsHeight + titleHeight + 2 * pad);
  const content =
    (fields ? `<g class="pele-packet-fields" font-size="${labelSize}" text-anchor="middle">${fields}</g>` : '') +
    (bits ? `<g class="pele-packet-bits" font-size="${bitSize}" fill="var(--_m)">${bits}</g>` : '') +
    // Mermaid puts a packet's title under it.
    labelSvg(title, totalWidth / 2, totalHeight - pad - title.height / 2, ' class="pele-title" font-weight="var(--_tw)"');

  return {
    svg: svgDocument('packet', totalWidth, totalHeight, size, options, model, content),
    width: totalWidth,
    height: totalHeight,
    links: [],
  };
}
