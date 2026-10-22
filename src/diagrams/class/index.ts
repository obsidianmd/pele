import type { Diagram } from '../../types.js';
import { ClassDb } from './db.js';
import { parseClassDiagram } from './parser.js';
import { renderClass } from './render.js';

export const classDiagram: Diagram<ClassDb> = {
  type: 'class',
  math: true,
  parse(source, _config, title) {
    const db = new ClassDb();
    if (title) db.title = title;
    parseClassDiagram(source, db);
    return db;
  },
  render: renderClass,
};
