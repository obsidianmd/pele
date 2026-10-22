import type { Diagram } from '../../types.js';
import { ErDb } from './db.js';
import { parseEr } from './parser.js';
import { renderEr } from './render.js';

export const er: Diagram<ErDb> = {
  type: 'er',
  math: true,
  parse(source, _config, title) {
    const db = new ErDb();
    if (title) db.title = title;
    parseEr(source, db);
    return db;
  },
  render: renderEr,
};
