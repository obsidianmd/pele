import type { Config } from '../../preprocess.js';
import type { Diagram } from '../../types.js';
import { FlowDb } from './db.js';
import { parseFlowchart } from './parser.js';
import { renderFlowchart } from './render.js';

export const flowchart: Diagram<FlowDb> = {
  type: 'flowchart',
  math: true,
  parse(source, config, title, _lineOffset, limits) {
    const flow = (config.flowchart ?? {}) as Config;
    const db = new FlowDb({ inheritDir: flow.inheritDir === true, maxEdges: limits.maxEdges });
    if (title) db.title = title;
    parseFlowchart(source, db);
    return db;
  },
  render: renderFlowchart,
};
