import type { Diagram } from '../../types.js';
import { MindmapDb, type MindmapModel } from './db.js';
import { parseMindmap } from './parser.js';
import { renderMindmap } from './render.js';

export const mindmap: Diagram<MindmapModel> = {
  type: 'mindmap',
  math: true,
  parse(source, _config, title) {
    const db = new MindmapDb();
    db.title = title;
    parseMindmap(source, db);
    return db;
  },
  render: renderMindmap,
};
