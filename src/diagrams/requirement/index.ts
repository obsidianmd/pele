import type { Diagram } from '../../types.js';
import { RequirementDb } from './db.js';
import { parseRequirement } from './parser.js';
import { renderRequirement } from './render.js';

export const requirement: Diagram<RequirementDb> = {
  type: 'requirement',
  math: true,
  parse(source, _config, title) {
    const db = new RequirementDb();
    if (title) db.title = title;
    parseRequirement(source, db);
    return db;
  },
  render: renderRequirement,
};
