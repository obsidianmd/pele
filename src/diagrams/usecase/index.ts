import type { Diagram } from '../../types.js';
import { parseUsecase } from './parser.js';
import { renderUsecase } from './render.js';
import type { UsecaseModel } from './types.js';

export const usecase: Diagram<UsecaseModel> = {
  type: 'usecase',
  math: true,
  parse: (source, _config, title) => parseUsecase(source, title),
  render: renderUsecase,
};
