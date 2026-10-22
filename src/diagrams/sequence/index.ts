import type { Config } from '../../preprocess.js';
import type { Diagram } from '../../types.js';
import { SeqDb } from './db.js';
import { parseSequence } from './parser.js';
import { renderSequence } from './render.js';

export const sequence: Diagram<SeqDb> = {
  type: 'sequence',
  math: true,
  parse(source, config, title) {
    const seq = (config.sequence ?? {}) as Config;
    const db = new SeqDb({
      wrap: typeof config.wrap === 'boolean' ? config.wrap : undefined,
      sequenceWrap: seq.wrap === true,
    });
    if (title) db.setDiagramTitle(title);
    parseSequence(source, db);
    return db;
  },
  render: renderSequence,
};
