import type { Diagram } from '../../types.js';
import { StateDb } from './db.js';
import { parseState } from './parser.js';
import { renderState } from './render.js';

export const state: Diagram<StateDb> = {
  type: 'state',
  math: true,
  parse(source, _config, title) {
    const db = new StateDb();
    if (title) db.title = title;
    parseState(source, db);
    return db;
  },
  render: renderState,
};
