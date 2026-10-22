import { syntaxError } from '../../errors.js';
import type { FlowDb } from './db.js';
import { tokenize } from './lexer.js';
import { T, TOKEN_NAMES } from './tokens.js';
import type { DocItem, FlowText, LabelType, LinkInfo } from './types.js';

const ID = new Uint8Array(T.EOF + 1);
for (const t of [
  T.NUM,
  T.NODE_STRING,
  T.DOWN,
  T.MINUS,
  T.DEFAULT,
  T.COMMA,
  T.COLON,
  T.AMP,
  T.BRKT,
  T.MULT,
  T.UNICODE_TEXT,
]) {
  ID[t] = 1;
}

const ALPHANUM = new Uint8Array(T.EOF + 1);
for (const t of [
  T.NUM,
  T.UNICODE_TEXT,
  T.NODE_STRING,
  T.DIR,
  T.DOWN,
  T.MINUS,
  T.COMMA,
  T.COLON,
  T.AMP,
  T.BRKT,
  T.MULT,
]) {
  ALPHANUM[t] = 1;
}

const NO_TAGS = new Uint8Array(T.EOF + 1);
for (const t of [
  T.NUM,
  T.NODE_STRING,
  T.SPACE,
  T.MINUS,
  T.AMP,
  T.UNICODE_TEXT,
  T.COLON,
  T.MULT,
  T.BRKT,
  T.STYLE,
  T.LINKSTYLE,
  T.CLASSDEF,
  T.CLASS,
  T.CLICK,
  T.GRAPH,
  T.DIR,
  T.subgraph,
  T.end,
  T.DOWN,
  T.UP,
  T.START_LINK,
]) {
  NO_TAGS[t] = 1;
}

const STYLE_PART = new Uint8Array(T.EOF + 1);
for (const t of [T.NUM, T.NODE_STRING, T.COLON, T.SPACE, T.BRKT, T.STYLE]) STYLE_PART[t] = 1;

interface Frame {
  id: FlowText | undefined;
  title: FlowText | undefined;
  list: DocItem[];
  collect: boolean;
}

const TEXT_TOKENS = "'UNICODE_TEXT', 'TEXT', 'TAGSTART'";
const NO_ITEMS: string[] = [];

// Mermaid trims whitespace between a closing brace and the end of its line before parsing.
const RE_BRACE_TRAIL = /}\s*\n/g;

export function parseFlowchart(source: string, db: FlowDb): void {
  const src = source.includes('}') ? source.replace(RE_BRACE_TRAIL, '}\n') : source;
  const { types, texts, starts } = tokenize(src);
  let i = 0;
  let pendingData: string | undefined;

  const fail = (expected: string): never => {
    const t = types[i];
    if (t === T.ERROR) throw syntaxError('flowchart', src, starts[i], '', true);
    throw syntaxError('flowchart', src, starts[i], `Expecting ${expected}, got '${TOKEN_NAMES[t]}'`);
  };

  const expect = (type: number, also = ''): string => {
    if (types[i] !== type) fail(`'${TOKEN_NAMES[type]}'${also ? ', ' + also : ''}`);
    return texts[i++];
  };

  const separator = (): void => {
    const t = types[i];
    if (t !== T.NEWLINE && t !== T.SEMI && t !== T.EOF) fail("'SEMI', 'NEWLINE', 'EOF'");
    i++;
  };

  const idString = (): string => {
    if (ID[types[i]] === 0) fail("'NODE_STRING'");
    let s = texts[i++];
    while (ID[types[i]] === 1) s += texts[i++];
    return s;
  };

  const alphaNum = (): string => {
    if (ALPHANUM[types[i]] === 0) fail("'NODE_STRING'");
    let s = texts[i++];
    while (ALPHANUM[types[i]] === 1) s += texts[i++];
    return s;
  };

  const text = (): FlowText => {
    const t = types[i];
    let type: LabelType;
    if (t === T.STR) type = 'string';
    else if (t === T.MD_STR) type = 'markdown';
    else if (t === T.TEXT || t === T.TAGSTART || t === T.TAGEND || t === T.UNICODE_TEXT) type = 'text';
    else return fail(`${TEXT_TOKENS}, 'TAGEND', 'STR', 'MD_STR'`);
    let s = texts[i++];
    while (true) {
      const n = types[i];
      if (n !== T.TEXT && n !== T.TAGSTART && n !== T.TAGEND && n !== T.UNICODE_TEXT) break;
      s += texts[i++];
    }
    return { text: s, type };
  };

  const closed = (type: number): void => {
    expect(type, TEXT_TOKENS);
  };

  const edgeText = (): FlowText => {
    const t = types[i];
    let type: LabelType;
    if (t === T.STR) type = 'string';
    else if (t === T.MD_STR) type = 'markdown';
    else if (t === T.EDGE_TEXT || t === T.UNICODE_TEXT) type = 'text';
    else return fail("'EDGE_TEXT', 'STR', 'MD_STR'");
    let s = texts[i++];
    while (types[i] === T.EDGE_TEXT || types[i] === T.UNICODE_TEXT) s += texts[i++];
    return { text: s, type };
  };

  const textNoTags = (): FlowText => {
    const t = types[i];
    let type: LabelType;
    if (t === T.STR) type = 'text';
    else if (t === T.MD_STR) type = 'markdown';
    else if (NO_TAGS[t] === 1) type = 'text';
    else return fail("'NODE_STRING', 'STR', 'MD_STR'");
    let s = texts[i++];
    while (NO_TAGS[types[i]] === 1) s += texts[i++];
    return { text: s, type };
  };

  const shapeData = (): string => {
    let s = texts[i++];
    while (types[i] === T.SHAPE_DATA) s += texts[i++];
    return s;
  };

  const vertex = (): string => {
    const id = idString();
    let label: FlowText;
    switch (types[i]) {
      case T.SQS:
        i++;
        label = text();
        closed(T.SQE);
        db.addVertex(id, label, 'square');
        break;
      case T.DOUBLECIRCLESTART:
        i++;
        label = text();
        closed(T.DOUBLECIRCLEEND);
        db.addVertex(id, label, 'doublecircle');
        break;
      case T.PS:
        i++;
        if (types[i] === T.PS) {
          i++;
          label = text();
          closed(T.PE);
          expect(T.PE);
          db.addVertex(id, label, 'circle');
        } else {
          label = text();
          closed(T.PE);
          db.addVertex(id, label, 'round');
        }
        break;
      case T.ELLIPSE_START:
        i++;
        label = text();
        closed(T.ELLIPSE_END);
        db.addVertex(id, label, 'ellipse');
        break;
      case T.STADIUMSTART:
        i++;
        label = text();
        closed(T.STADIUMEND);
        db.addVertex(id, label, 'stadium');
        break;
      case T.SUBROUTINESTART:
        i++;
        label = text();
        closed(T.SUBROUTINEEND);
        db.addVertex(id, label, 'subroutine');
        break;
      case T.VERTEX_WITH_PROPS_START: {
        i++;
        const field = expect(T.NODE_STRING);
        expect(T.COLON);
        const value = expect(T.NODE_STRING);
        expect(T.PIPE);
        label = text();
        closed(T.SQE);
        db.addVertex(id, label, 'rect', undefined, undefined, undefined, { [field]: value });
        break;
      }
      case T.CYLINDERSTART:
        i++;
        label = text();
        closed(T.CYLINDEREND);
        db.addVertex(id, label, 'cylinder');
        break;
      case T.DIAMOND_START:
        i++;
        if (types[i] === T.DIAMOND_START) {
          i++;
          label = text();
          closed(T.DIAMOND_STOP);
          expect(T.DIAMOND_STOP);
          db.addVertex(id, label, 'hexagon');
        } else {
          label = text();
          closed(T.DIAMOND_STOP);
          db.addVertex(id, label, 'diamond');
        }
        break;
      case T.TAGEND:
        i++;
        label = text();
        closed(T.SQE);
        db.addVertex(id, label, 'odd');
        break;
      case T.TRAPSTART:
        i++;
        label = text();
        if (types[i] === T.INVTRAPEND) {
          i++;
          db.addVertex(id, label, 'lean_right');
        } else {
          closed(T.TRAPEND);
          db.addVertex(id, label, 'trapezoid');
        }
        break;
      case T.INVTRAPSTART:
        i++;
        label = text();
        if (types[i] === T.TRAPEND) {
          i++;
          db.addVertex(id, label, 'lean_left');
        } else {
          closed(T.INVTRAPEND);
          db.addVertex(id, label, 'inv_trapezoid');
        }
        break;
      default:
        db.addVertex(id);
    }
    return id;
  };

  const styledVertex = (): string => {
    const id = vertex();
    if (types[i] === T.STYLE_SEPARATOR) {
      i++;
      db.setClass(id, idString());
    }
    return id;
  };

  const node = (): string[] => {
    const ids = [styledVertex()];
    pendingData = undefined;
    while (true) {
      const data = types[i] === T.SHAPE_DATA ? shapeData() : undefined;
      if (types[i] !== T.SPACE) {
        pendingData = data;
        return ids;
      }
      do i++;
      while (types[i] === T.SPACE);
      if (types[i] !== T.AMP) {
        if (data !== undefined) fail("'AMP'");
        return ids;
      }
      i++;
      if (types[i] !== T.SPACE) fail("'SPACE'");
      do i++;
      while (types[i] === T.SPACE);
      const next = styledVertex();
      if (data !== undefined) {
        db.addVertex(ids[ids.length - 1], undefined, undefined, undefined, undefined, undefined, undefined, data);
      }
      ids.push(next);
    }
  };

  const link = (): LinkInfo => {
    let id: string | undefined;
    if (types[i] === T.LINK_ID) id = texts[i++];
    if (types[i] === T.LINK) {
      const info: LinkInfo = db.destructLink(texts[i++]);
      if (id !== undefined) info.id = id;
      if (types[i] === T.PIPE) {
        i++;
        info.text = text();
        closed(T.PIPE);
        if (types[i] === T.SPACE) i++;
      }
      return info;
    }
    if (types[i] === T.START_LINK) {
      const start = texts[i++];
      const label = edgeText();
      const end = expect(T.LINK, "'EDGE_TEXT'");
      const info: LinkInfo = db.destructLink(end, start);
      info.text = label;
      if (id !== undefined) info.id = id;
      return info;
    }
    return fail("'LINK', 'START_LINK'");
  };

  const vertexStatement = (collect: boolean): string[] => {
    let stmt = node();
    if (pendingData !== undefined) {
      db.addVertex(stmt[stmt.length - 1], undefined, undefined, undefined, undefined, undefined, undefined, pendingData);
    }
    let nodes = stmt;
    while (true) {
      const t = types[i];
      if (t !== T.LINK && t !== T.START_LINK && t !== T.LINK_ID) return nodes;
      const info = link();
      const next = node();
      if (pendingData !== undefined) {
        db.addVertex(next[next.length - 1], undefined, undefined, undefined, undefined, undefined, undefined, pendingData);
      }
      db.addLink(stmt, next, info);
      if (collect) nodes = next.concat(nodes);
      stmt = next;
    }
  };

  const style = (): string => {
    if (STYLE_PART[types[i]] === 0) fail("'NODE_STRING', 'NUM', 'COLON', 'BRKT'");
    let s = texts[i++];
    while (STYLE_PART[types[i]] === 1) s += texts[i++];
    return s;
  };

  const stylesOpt = (): string[] => {
    const out = [style()];
    while (types[i] === T.COMMA) {
      i++;
      out.push(style());
    }
    return out;
  };

  const linkStyleStatement = (): void => {
    i++;
    expect(T.SPACE);
    let positions: string[];
    if (types[i] === T.DEFAULT) {
      positions = [texts[i++]];
    } else {
      positions = [expect(T.NUM, "'DEFAULT'")];
      while (types[i] === T.COMMA) {
        i++;
        positions.push(expect(T.NUM));
      }
    }
    expect(T.SPACE);
    if (types[i] !== T.INTERPOLATE) {
      db.updateLink(positions, stylesOpt());
      return;
    }
    i++;
    expect(T.SPACE);
    const interpolate = alphaNum();
    if (types[i] === T.SPACE) {
      i++;
      const styles = stylesOpt();
      db.updateLinkInterpolate(positions, interpolate);
      db.updateLink(positions, styles);
    } else {
      db.updateLinkInterpolate(positions, interpolate);
    }
  };

  const linkTail = (id: string, url: string): void => {
    if (types[i] !== T.SPACE) {
      db.setLink(id, url);
      return;
    }
    i++;
    if (types[i] === T.LINK_TARGET) {
      db.setLink(id, url, texts[i++]);
      return;
    }
    const tooltip = expect(T.STR, "'LINK_TARGET'");
    if (types[i] === T.SPACE) {
      i++;
      db.setLink(id, url, expect(T.LINK_TARGET));
    } else {
      db.setLink(id, url);
    }
    db.setTooltip(id, tooltip);
  };

  const clickStatement = (): void => {
    const id = texts[i++];
    switch (types[i]) {
      case T.CALLBACKNAME: {
        const name = texts[i++];
        const hasArgs = types[i] === T.CALLBACKARGS;
        const args = hasArgs ? texts[i++] : undefined;
        let tooltip: string | undefined;
        if (types[i] === T.SPACE) {
          i++;
          tooltip = expect(T.STR);
        }
        if (hasArgs) db.setClickEvent(id, name, args);
        else db.setClickEvent(id, name);
        if (tooltip !== undefined) db.setTooltip(id, tooltip);
        return;
      }
      case T.HREF:
        i++;
        linkTail(id, expect(T.STR));
        return;
      case T.STR:
        linkTail(id, texts[i++]);
        return;
      default: {
        const name = alphaNum();
        if (types[i] === T.SPACE) {
          i++;
          const tooltip = expect(T.STR);
          db.setClickEvent(id, name);
          db.setTooltip(id, tooltip);
        } else {
          db.setClickEvent(id, name);
        }
      }
    }
  };

  const subgraphHeader = (): Frame => {
    i++;
    let t = types[i];
    if (t === T.NEWLINE || t === T.SEMI || t === T.EOF) {
      i++;
      return { id: undefined, title: undefined, list: [], collect: false };
    }
    expect(T.SPACE, "'SEMI', 'NEWLINE', 'EOF'");
    const id = textNoTags();
    let title = id;
    if (types[i] === T.SQS) {
      i++;
      title = text();
      closed(T.SQE);
    }
    t = types[i];
    if (t !== T.NEWLINE && t !== T.SEMI && t !== T.EOF) fail("'SEMI', 'NEWLINE', 'EOF', 'SQS'");
    i++;
    return { id, title, list: [], collect: false };
  };

  const statement = (collect: boolean): DocItem => {
    const t = types[i];
    switch (t) {
      case T.STYLE: {
        i++;
        expect(T.SPACE);
        const id = idString();
        expect(T.SPACE);
        db.addVertex(id, undefined, undefined, stylesOpt());
        separator();
        return NO_ITEMS;
      }
      case T.LINKSTYLE:
        linkStyleStatement();
        separator();
        return NO_ITEMS;
      case T.CLASSDEF: {
        i++;
        expect(T.SPACE);
        const id = idString();
        expect(T.SPACE);
        db.addClass(id, stylesOpt());
        separator();
        return NO_ITEMS;
      }
      case T.CLASS: {
        i++;
        expect(T.SPACE);
        const ids = idString();
        expect(T.SPACE);
        db.setClass(ids, idString());
        separator();
        return NO_ITEMS;
      }
      case T.CLICK:
        clickStatement();
        separator();
        return NO_ITEMS;
      case T.direction_tb:
      case T.direction_bt:
      case T.direction_rl:
      case T.direction_lr:
      case T.direction_td:
        i++;
        return { stmt: 'dir', value: DIRECTIONS[t - T.direction_tb] };
      case T.acc_title: {
        i++;
        const value = expect(T.acc_title_value).trim();
        db.setAccTitle(value);
        return value;
      }
      case T.acc_descr: {
        i++;
        const value = expect(T.acc_descr_value).trim();
        db.setAccDescription(value);
        return value;
      }
      case T.acc_descr_multiline_value: {
        const value = texts[i++].trim();
        db.setAccDescription(value);
        return value;
      }
      default: {
        if (ID[t] === 0) fail(STATEMENT_START);
        const nodes = vertexStatement(collect);
        separator();
        return nodes;
      }
    }
  };

  // Subgraphs nest without recursion: each open one keeps the list and collect flag of its parent.
  const document = (): void => {
    const open: Frame[] = [];
    let list: DocItem[] = [];
    let collect = false;
    while (true) {
      const t = types[i];
      if (t === T.END) break;
      if (t === T.end) {
        const frame = open.pop();
        if (frame === undefined) break;
        i++;
        const id = db.addSubGraph(frame.id, list, frame.title);
        list = frame.list;
        collect = frame.collect;
        if (collect) list.push(id);
      } else if (t === T.SEMI || t === T.NEWLINE || t === T.SPACE || t === T.EOF) {
        if (collect) list.push(texts[i]);
        i++;
      } else if (t === T.subgraph) {
        const frame = subgraphHeader();
        frame.list = list;
        frame.collect = collect;
        open.push(frame);
        list = [];
        collect = true;
      } else {
        const item = statement(collect);
        if (collect && (!Array.isArray(item) || item.length > 0)) list.push(item);
      }
    }
    if (open.length > 0) fail("'end'");
  };

  while (types[i] === T.SPACE || types[i] === T.NEWLINE) i++;
  expect(T.GRAPH, "'SPACE', 'NEWLINE'");
  if (types[i] === T.NODIR) {
    i++;
    db.setDirection('TB');
  } else {
    const dir = expect(T.DIR, "'NODIR'");
    let t = types[i];
    if (t === T.SPACE) {
      do i++;
      while (types[i] === T.SPACE);
      t = types[i];
      if (t !== T.NEWLINE) fail("'NEWLINE', 'SPACE'");
    } else if (t !== T.SEMI && t !== T.NEWLINE) {
      fail("'SEMI', 'NEWLINE', 'SPACE'");
    }
    i++;
    db.setDirection(dir);
  }
  document();
  if (types[i] !== T.END) fail(STATEMENT_START);
}

const DIRECTIONS = ['TB', 'BT', 'RL', 'LR', 'TD'];
const STATEMENT_START =
  "'SEMI', 'NEWLINE', 'SPACE', 'EOF', 'subgraph', 'acc_title', 'acc_descr', 'acc_descr_multiline_value', 'STYLE', 'LINKSTYLE', 'CLASSDEF', 'CLASS', 'CLICK', 'NODE_STRING'";
