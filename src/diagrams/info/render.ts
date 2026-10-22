// A named import, so the bundler keeps the version string and drops the rest of the file.
import { version } from '../../../package.json';
import type { Config } from '../../preprocess.js';
import { labelSvg } from '../../svg/builder.js';
import { svgDocument } from '../../svg/root.js';
import { layoutLabel } from '../../text/label.js';
import { Style, defaultMeasurer } from '../../text/measurer.js';
import type { RenderOptions, Rendered } from '../../types.js';
import type { InfoModel } from './model.js';

export function renderInfo(model: InfoModel, _config: Config, options: RenderOptions): Rendered {
  const size = options.fontSize ?? 16;
  const measurer = options.measurer ?? defaultMeasurer(options.fontFamily, options.fontFamilyMono);
  const pad = options.padding ?? 8;

  const title = layoutLabel(model.title, false, measurer, size, 4000, Style.Bold);
  const titleHeight = title.height > 0 ? title.height + 8 : 0;
  const text = layoutLabel(`Pele v${version}`, false, measurer, size, 4000);

  const width = Math.ceil(Math.max(title.width, text.width) + 2 * pad);
  const height = Math.ceil(titleHeight + text.height + 2 * pad);
  const content =
    labelSvg(title, width / 2, pad + title.height / 2, ' class="pele-title" font-weight="var(--_tw)"') +
    labelSvg(text, width / 2, pad + titleHeight + text.height / 2, ' class="pele-version" fill="var(--_m)"');

  return { svg: svgDocument('info', width, height, size, options, model, content), width, height, links: [] };
}
