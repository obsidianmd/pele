import type { Diagram } from '../../types.js';
import { KanbanDb, type KanbanModel } from './db.js';
import { parseKanban } from './parser.js';
import { renderKanban } from './render.js';

export const kanban: Diagram<KanbanModel> = {
  type: 'kanban',
  math: true,
  parse(source, _config, title) {
    const db = new KanbanDb();
    db.title = title;
    parseKanban(source, db);
    return db;
  },
  render: renderKanban,
};
