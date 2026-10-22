import type { Config } from '../../preprocess.js';
import { escText, labelSvg, num } from '../../svg/builder.js';
import { svgDocument } from '../../svg/root.js';
import { ROUNDED, classNames, resolveStyle, seriesColor } from '../../svg/theme.js';
import { layoutLabel, type Label } from '../../text/label.js';
import { Style, defaultMeasurer } from '../../text/measurer.js';
import type { RenderOptions, Rendered } from '../../types.js';
import { capWidth } from '../common/fit-width.js';
import type { QuadrantModel, QuadrantText } from './db.js';

const GAP = 4;
const CAREFUL = 300;

interface Dot {
  cx: number;
  cy: number;
  reach: number;
  text: Label;
}

function setting(config: Config, key: string): unknown {
  return (config.quadrantChart as Config | undefined)?.[key];
}

function length(config: Config, key: string, fallback: number, max: number): number {
  const value = setting(config, key);
  return typeof value === 'number' && value >= 0 ? Math.min(value, max) : fallback;
}

function hex(color: string): string {
  return color.startsWith('#') ? color : '#' + color;
}

export function renderQuadrant(model: QuadrantModel, config: Config, options: RenderOptions): Rendered {
  const size = options.fontSize ?? 16;
  const axisSize = Math.round(size * 0.875);
  const pointSize = Math.round(size * 0.75);
  const measurer = options.measurer ?? defaultMeasurer(options.fontFamily);
  const natural = Math.round(Math.max(100, length(config, 'chartWidth', 500, 4000)));
  const width = Math.round(capWidth(options, natural, 280));
  const height = Math.round((Math.max(100, length(config, 'chartHeight', 500, 4000)) * width) / natural);
  const outer = length(config, 'quadrantPadding', options.padding ?? 8, 200);
  const xPad = length(config, 'xAxisLabelPadding', 5, 200);
  const yPad = length(config, 'yAxisLabelPadding', 5, 200);
  const hasPoints = model.points.length > 0;

  const label = (text: QuadrantText | undefined, fontSize: number, max: number): Label =>
    layoutLabel(text?.text, text?.type === 'markdown', measurer, fontSize, Math.max(max, 40));

  const title = layoutLabel(model.title, false, measurer, size, Math.max(width - 2 * outer, 40), Style.Bold);
  const titlePad = length(config, 'titlePadding', 10, 200);
  const titleSpace = title.height > 0 ? title.height + titlePad : 0;

  const hasX = !!(model.xAxisLeft?.text || model.xAxisRight?.text);
  const hasY = !!(model.yAxisBottom?.text || model.yAxisTop?.text);
  // Mermaid moves the x axis labels below the chart as soon as there are points.
  const xBelow = hasPoints || setting(config, 'xAxisPosition') === 'bottom';
  const yRight = setting(config, 'yAxisPosition') === 'right';

  const side = width - 2 * outer;
  const xLeft = label(model.xAxisLeft, axisSize, model.xAxisRight ? side / 2 - 16 : side);
  const xRight = label(model.xAxisRight, axisSize, side / 2 - 16);
  const xHeight = Math.max(xLeft.height, xRight.height);
  const xSpace = hasX ? xHeight + xPad : 0;
  const tall = height - 2 * outer - titleSpace - xSpace;
  const yBottom = label(model.yAxisBottom, axisSize, model.yAxisTop ? tall / 2 - 16 : tall);
  const yTop = label(model.yAxisTop, axisSize, tall / 2 - 16);
  const yHeight = Math.max(yBottom.height, yTop.height);
  const ySpace = hasY ? yHeight + yPad : 0;

  const left = outer + (yRight ? 0 : ySpace);
  const top = outer + titleSpace + (xBelow ? 0 : xSpace);
  const w = Math.max(0, side - ySpace);
  const h = Math.max(0, tall);
  const tileW = Math.max(0, (w - GAP) / 2);
  const tileH = Math.max(0, (h - GAP) / 2);

  // Boxes a point label keeps clear of: the gaps between quadrants, quadrant labels, points,
  // and the labels placed before it.
  const taken = [left + tileW, top, left + w - tileW, top + h, left, top + tileH, left + w, top + h - tileH];
  const isClear = (from: number, x0: number, y0: number, x1: number, y1: number): boolean => {
    for (let k = from; k < taken.length; k += 4) {
      if (x0 < taken[k + 2] && x1 > taken[k] && y0 < taken[k + 3] && y1 > taken[k + 1]) return false;
    }
    return true;
  };

  const textTop = length(config, 'quadrantTextTopPadding', 5, 200);
  let quadrants = '';
  for (let k = 0; k < 4; k++) {
    const x = k === 0 || k === 3 ? left + w - tileW : left;
    const y = k < 2 ? top : top + h - tileH;
    const text = label(model.quadrants[k], size, tileW - 16);
    const cx = x + tileW / 2;
    const cy = hasPoints ? y + textTop + text.height / 2 : y + tileH / 2;
    taken.push(cx - text.width / 2, cy - text.height / 2, cx + text.width / 2, cy + text.height / 2);
    quadrants +=
      `<g class="pele-quadrant" data-id="${k + 1}">` +
      `<rect x="${num(x)}" y="${num(y)}" width="${num(tileW)}" height="${num(tileH)}"${ROUNDED}/>` +
      labelSvg(text, cx, cy, ' class="pele-label" fill="var(--_fg)" stroke="none"') +
      '</g>';
  }

  let axes = '';
  if (hasX) {
    const y = xBelow ? top + h + xPad + xHeight / 2 : top - xPad - xHeight / 2;
    axes +=
      labelSvg(xLeft, xRight.height > 0 ? left + w / 4 : left + xLeft.width / 2, y, '') +
      labelSvg(xRight, left + (w * 3) / 4, y, '');
  }
  if (hasY) {
    const x = yRight ? left + w + yPad + yHeight / 2 : left - yPad - yHeight / 2;
    const turned = (text: Label, y: number): string =>
      text.height > 0 ? `<g transform="translate(${num(x)},${num(y)}) rotate(-90)">${labelSvg(text, 0, 0, '')}</g>` : '';
    axes +=
      turned(yBottom, yTop.height > 0 ? top + (h * 3) / 4 : top + h - yBottom.width / 2) + turned(yTop, top + h / 4);
  }

  const radius = length(config, 'pointRadius', 5, 200);
  const textPad = length(config, 'pointTextPadding', 5, 200);
  const fill = seriesColor(0);
  const dots: Dot[] = [];
  const circles: string[] = [];
  for (const point of model.points) {
    if (!(point.x >= 0 && point.x <= 1 && point.y >= 0 && point.y <= 1)) continue;
    const shared = model.classes.get(point.className);
    const r = Math.min(point.radius ?? shared?.radius ?? radius, 2000);
    const color = point.color ?? shared?.color;
    const strokeColor = point.strokeColor ?? shared?.strokeColor;
    const strokeWidth = point.strokeWidth ?? shared?.strokeWidth;
    const styles: string[] = [];
    if (color) styles.push('fill:' + hex(color));
    if (strokeWidth) {
      if (strokeColor) styles.push('stroke:' + hex(strokeColor));
      styles.push('stroke-width:' + strokeWidth);
    }
    const cx = left + point.x * w;
    const cy = top + (1 - point.y) * h;
    dots.push({
      cx,
      cy,
      reach: r + (strokeWidth ? Math.min(parseInt(strokeWidth), 400) / 2 : 0),
      text: label(point.text, pointSize, 200),
    });
    circles.push(
      `<circle class="pele-point${classNames(point.className)}" data-id="${escText(point.text.text)}" cx="${num(cx)}" cy="${num(cy)}" r="${num(r)}"${
        strokeWidth && !strokeColor ? ` stroke="${fill}"` : ''
      }${resolveStyle(styles).shape}/>`
    );
  }

  // A label goes below its point, or above, right or left of it when that is the first place
  // that is inside the chart and free. A second round lets it cross the gaps between quadrants.
  // Large charts skip the search for a free place.
  const careful = dots.length <= CAREFUL;
  if (careful) for (const { cx, cy, reach } of dots) taken.push(cx - reach, cy - reach, cx + reach, cy + reach);
  let labels = '';
  for (const { cx, cy, reach, text } of dots) {
    const halfW = text.width / 2;
    const halfH = text.size * 0.6 + (text.height - text.lineHeight) / 2;
    const away = reach + textPad;
    const spots = [cx, cy + away + halfH, cx, cy - away - halfH, cx + away + halfW, cy, cx - away - halfW, cy];
    let tx = cx;
    let ty = spots[1];
    let found = false;
    for (let k = 0; k < 16; k += 2) {
      const spot = k % 8;
      const x = spot < 4 && text.width < w ? Math.min(Math.max(spots[spot], left + halfW), left + w - halfW) : spots[spot];
      const y = spots[spot + 1];
      if (x - halfW < left || x + halfW > left + w || y - halfH < top || y + halfH > top + h) continue;
      const free = !careful || isClear(k < 8 ? 0 : 8, x - halfW, y - halfH, x + halfW, y + halfH);
      if (!found || free) {
        tx = x;
        ty = y;
        found = true;
      }
      if (free) break;
    }
    if (careful) taken.push(tx - halfW, ty - halfH, tx + halfW, ty + halfH);
    labels += labelSvg(text, tx, ty, ' class="pele-label"');
  }

  // Mermaid puts each new point under the ones before it.
  const content =
    labelSvg(title, width / 2, titlePad / 2 + title.height / 2, ' class="pele-title" font-weight="var(--_tw)"') +
    `<g class="pele-quadrants" fill="var(--_s)" stroke="var(--_b)">${quadrants}</g>` +
    (axes ? `<g class="pele-axis-labels" font-size="${axisSize}" fill="var(--_m)">${axes}</g>` : '') +
    (dots.length > 0
      ? `<g class="pele-points" fill="${fill}">${circles.reverse().join('')}</g>` +
        `<g class="pele-point-labels" font-size="${pointSize}">${labels}</g>`
      : '');

  return {
    svg: svgDocument('quadrantChart', width, height, size, options, model, content),
    width,
    height,
    links: [],
  };
}
