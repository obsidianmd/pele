import { PeleError } from '../../errors.js';
import { safeUrl } from '../../util/url.js';
import { parseYaml, type YamlValue } from '../../util/yaml.js';
import { isValidShape } from './shapes.js';
import type {
  DocItem,
  FlowClassDef,
  FlowEdge,
  FlowNode,
  FlowSubgraph,
  FlowText,
  FlowchartModel,
  LabelType,
  LinkInfo,
} from './types.js';

export interface FlowDbOptions {
  maxEdges?: number;
  inheritDir?: boolean;
  direction?: string;
  warn?: (message: string) => void;
}

function labelType(type: string | undefined): LabelType {
  return type === 'markdown' || type === 'string' || type === 'text' ? type : 'markdown';
}

function unquote(text: string): string {
  return text.startsWith('"') && text.endsWith('"') ? text.substring(1, text.length - 1) : text;
}

function countChar(ch: string, str: string): number {
  let count = 0;
  for (let i = 0; i < str.length; i++) if (str[i] === ch) count++;
  return count;
}

function destructStartLink(raw: string): { type: string; stroke: string; length?: number } {
  let str = raw.trim();
  let type = 'arrow_open';
  switch (str[0]) {
    case '<':
      type = 'arrow_point';
      str = str.slice(1);
      break;
    case 'x':
      type = 'arrow_cross';
      str = str.slice(1);
      break;
    case 'o':
      type = 'arrow_circle';
      str = str.slice(1);
      break;
  }
  let stroke = 'normal';
  if (str.includes('=')) stroke = 'thick';
  if (str.includes('.')) stroke = 'dotted';
  return { type, stroke };
}

function destructEndLink(raw: string): { type: string; stroke: string; length: number } {
  const str = raw.trim();
  let line = str.slice(0, -1);
  let type = 'arrow_open';
  switch (str.slice(-1)) {
    case 'x':
      type = 'arrow_cross';
      if (str.startsWith('x')) {
        type = 'double_' + type;
        line = line.slice(1);
      }
      break;
    case '>':
      type = 'arrow_point';
      if (str.startsWith('<')) {
        type = 'double_' + type;
        line = line.slice(1);
      }
      break;
    case 'o':
      type = 'arrow_circle';
      if (str.startsWith('o')) {
        type = 'double_' + type;
        line = line.slice(1);
      }
      break;
  }
  let stroke = 'normal';
  let length = line.length - 1;
  if (line.startsWith('=')) stroke = 'thick';
  if (line.startsWith('~')) stroke = 'invisible';
  const dots = countChar('.', line);
  if (dots) {
    stroke = 'dotted';
    length = dots;
  }
  return { type, stroke, length };
}

export class FlowDb implements FlowchartModel {
  readonly type = 'flowchart' as const;
  direction: string | undefined;
  nodes = new Map<string, FlowNode>();
  edges: FlowEdge[] = [];
  subgraphs: FlowSubgraph[] = [];
  classes = new Map<string, FlowClassDef>();
  tooltips = new Map<string, string>();
  defaultEdgeStyle: string[] | undefined;
  defaultInterpolate: string | undefined;
  title: string | undefined;
  accTitle: string | undefined;
  accDescr: string | undefined;

  private subgraphLookup = new Map<string, FlowSubgraph>();
  private members = new Set<string>();
  private edgeById = new Map<string, FlowEdge>();
  private pairCount = new Map<string, number>();
  private subCount = 0;
  private options: FlowDbOptions;

  constructor(options: FlowDbOptions = {}) {
    this.options = options;
  }

  addVertex(
    id: string,
    textObj?: FlowText,
    type?: string,
    style?: string[] | null,
    classes?: string[] | null,
    dir?: string,
    props?: Record<string, string>,
    metadata?: string
  ): void {
    if (!id || id.trim().length === 0) return;

    let doc: Record<string, YamlValue> | undefined;
    if (metadata !== undefined) {
      const yaml = metadata.includes('\n') ? metadata + '\n' : '{\n' + metadata + '\n}';
      let parsed: YamlValue;
      try {
        parsed = parseYaml(yaml);
      } catch (error) {
        throw new PeleError(`Metadata of "${id}" is not valid YAML. ${(error as Error).message}`, 'syntax', {
          type: 'flowchart',
        });
      }
      doc = parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : undefined;
    }

    const subgraph = this.subgraphLookup.get(id);
    if (subgraph && doc) {
      subgraph.metadata = { ...subgraph.metadata, ...doc };
      return;
    }

    const edge = this.edgeById.get(id);
    if (edge) {
      if (doc?.animate !== undefined) edge.animate = doc.animate as boolean;
      if (doc?.animation !== undefined) edge.animation = doc.animation as string;
      if (doc?.curve !== undefined) edge.interpolate = doc.curve as string;
      return;
    }

    let vertex = this.nodes.get(id);
    if (vertex === undefined) {
      if (textObj === undefined && type === undefined && style !== undefined && style !== null) {
        this.options.warn?.(
          `Style applied to unknown node "${id}". This may indicate a typo. The node will be created automatically.`
        );
      }
      vertex = { id, labelType: 'text', styles: [], classes: [] };
      this.nodes.set(id, vertex);
    }

    if (textObj !== undefined) {
      vertex.labelType = textObj.type;
      vertex.text = unquote(textObj.text.trim());
    } else if (vertex.text === undefined) {
      vertex.text = id;
    }
    if (type !== undefined) vertex.type = type;
    if (style !== undefined && style !== null) for (const s of style) vertex.styles.push(s);
    if (classes !== undefined && classes !== null) for (const c of classes) vertex.classes.push(c);
    if (dir !== undefined) vertex.dir = dir;
    if (vertex.props === undefined) vertex.props = props ?? {};
    else if (props !== undefined) Object.assign(vertex.props, props);

    if (doc === undefined) return;

    if (doc.shape) {
      const shape = String(doc.shape);
      if (shape !== shape.toLowerCase() || shape.includes('_')) {
        throw new PeleError(`No such shape: ${shape}. Shape names should be lowercase.`, 'semantic', {
          type: 'flowchart',
        });
      }
      if (!isValidShape(shape)) {
        throw new PeleError(`No such shape: ${shape}.`, 'semantic', { type: 'flowchart' });
      }
      vertex.type = shape;
    }
    const label = typeof doc.label === 'string' ? doc.label : undefined;
    if (doc.label) {
      vertex.text = String(doc.label);
      vertex.labelType = labelType(doc.labelType as string | undefined);
    }
    if (doc.icon) {
      vertex.icon = String(doc.icon);
      if (!label?.trim() && vertex.text === id) vertex.text = '';
    }
    if (doc.form) vertex.form = String(doc.form);
    if (doc.pos) vertex.pos = String(doc.pos);
    if (doc.img) {
      vertex.img = String(doc.img);
      if (!label?.trim() && vertex.text === id) vertex.text = '';
    }
    if (doc.constraint) vertex.constraint = String(doc.constraint);
    if (doc.w) vertex.assetWidth = Number(doc.w);
    if (doc.h) vertex.assetHeight = Number(doc.h);
  }

  addSingleLink(start: string, end: string, type: LinkInfo | undefined, id?: string): void {
    const edge: FlowEdge = {
      start,
      end,
      type: undefined,
      text: '',
      labelType: 'text',
      classes: [],
      isUserDefinedId: false,
      interpolate: this.defaultInterpolate,
    };
    const linkText = type?.text;
    if (linkText !== undefined) {
      edge.text = unquote(linkText.text.trim());
      edge.labelType = labelType(linkText.type);
    }
    if (type !== undefined) {
      edge.type = type.type;
      edge.stroke = type.stroke;
      edge.length = type.length! > 10 ? 10 : type.length;
    }
    const pair = start + '\0' + end;
    const count = this.pairCount.get(pair) ?? 0;
    if (id && !this.edgeById.has(id)) {
      edge.id = id;
      edge.isUserDefinedId = true;
    } else {
      edge.id = `L_${start}_${end}_${count === 0 ? 0 : count + 1}`;
    }

    const max = this.options.maxEdges;
    if (max !== undefined && this.edges.length >= max) {
      throw new PeleError(
        `Edge limit exceeded. ${this.edges.length} edges found, but the limit is ${max}.`,
        'limit',
        { type: 'flowchart' }
      );
    }
    this.edges.push(edge);
    this.pairCount.set(pair, count + 1);
    if (!this.edgeById.has(edge.id!)) this.edgeById.set(edge.id!, edge);
  }

  addLink(starts: string[], ends: string[], linkData: LinkInfo | undefined): void {
    const id = typeof linkData?.id === 'string' ? linkData.id.replace('@', '') : undefined;
    const lastStart = starts[starts.length - 1];
    const firstEnd = ends[0];
    for (const start of starts) {
      for (const end of ends) {
        this.addSingleLink(start, end, linkData, start === lastStart && end === firstEnd ? id : undefined);
      }
    }
  }

  updateLinkInterpolate(positions: (string | number)[], interpolate: string): void {
    for (const pos of positions) {
      if (pos === 'default') this.defaultInterpolate = interpolate;
      else this.edgeAt(pos).interpolate = interpolate;
    }
  }

  updateLink(positions: (string | number)[], style: string[]): void {
    for (const pos of positions) {
      if (pos === 'default') {
        this.defaultEdgeStyle = style;
        continue;
      }
      const edge = this.edgeAt(pos);
      edge.style = style;
      if (style.length > 0 && !style.some((s) => s?.startsWith('fill'))) style.push('fill:none');
    }
  }

  private edgeAt(pos: string | number): FlowEdge {
    const edge = this.edges[Number(pos)];
    if (edge === undefined) {
      throw new PeleError(
        `The index ${pos} for linkStyle is out of bounds. Valid indices for linkStyle are between 0 and ${
          this.edges.length - 1
        }. (Help: Ensure that the index is within the range of existing edges.)`,
        'semantic',
        { type: 'flowchart' }
      );
    }
    return edge;
  }

  addClass(ids: string, styles: string[]): void {
    const style = styles.join().replace(/\\,/g, '§§§').replace(/,/g, ';').replace(/§§§/g, ',').split(';');
    for (const id of ids.split(',')) {
      let classNode = this.classes.get(id);
      if (classNode === undefined) {
        classNode = { id, styles: [], textStyles: [] };
        this.classes.set(id, classNode);
      }
      for (const s of style) {
        if (s.includes('color')) classNode.textStyles.push(s.replace('fill', 'bgFill'));
        classNode.styles.push(s);
      }
    }
  }

  setDirection(dir: string): void {
    let d = dir.trim();
    if (d.includes('<')) d = 'RL';
    if (d.includes('^')) d = 'BT';
    if (d.includes('>')) d = 'LR';
    if (d.includes('v')) d = 'TB';
    if (d === 'TD') d = 'TB';
    this.direction = d;
  }

  setClass(ids: string, className: string): void {
    for (const id of ids.split(',')) {
      this.nodes.get(id)?.classes.push(className);
      this.edgeById.get(id)?.classes.push(className);
      this.subgraphLookup.get(id)?.classes.push(className);
    }
  }

  setTooltip(ids: string, tooltip: string | undefined): void {
    if (tooltip === undefined) return;
    for (const id of ids.split(',')) this.tooltips.set(id, tooltip);
  }

  setLink(ids: string, link: string, target?: string): void {
    const url = link.trim();
    for (const id of ids.split(',')) {
      const vertex = this.nodes.get(id);
      if (vertex !== undefined) {
        vertex.link = url ? safeUrl(url) : undefined;
        vertex.linkTarget = target;
      }
    }
    this.setClass(ids, 'clickable');
  }

  // Callbacks are never executed; the node is only marked clickable, as in Mermaid's strict mode.
  setClickEvent(ids: string, _functionName?: string, _functionArgs?: string): void {
    this.setClass(ids, 'clickable');
  }

  setAccTitle(text: string): void {
    this.accTitle = text.replace(/^\s+/g, '');
  }

  setAccDescription(text: string): void {
    this.accDescr = text.replace(/\n\s+/g, '\n');
  }

  addSubGraph(
    idText: { text: string } | undefined,
    list: DocItem[],
    titleText: { text: string; type?: string } | undefined
  ): string {
    let id: string | undefined = idText?.text.trim();
    let title = titleText?.text ?? '';
    if (idText !== undefined && idText === titleText && /\s/.test(title)) id = undefined;

    const seen = new Set<string>();
    const nodeList: string[] = [];
    let dir: string | undefined;
    for (const entry of list) {
      if (typeof entry === 'string') {
        if (entry.trim() !== '' && !seen.has(entry)) {
          seen.add(entry);
          nodeList.push(entry);
        }
      } else if (Array.isArray(entry)) {
        for (const item of entry) {
          if (item.trim() !== '' && !seen.has(item)) {
            seen.add(item);
            nodeList.push(item);
          }
        }
      } else {
        dir = entry.value;
      }
    }
    dir ??= this.options.inheritDir ? (this.direction ?? this.options.direction) : undefined;

    id ??= 'subGraph' + this.subCount;
    title = title || '';
    this.subCount++;

    const subgraph: FlowSubgraph = {
      id,
      nodes: nodeList,
      title: title.trim(),
      classes: [],
      dir,
      labelType: labelType(titleText?.type),
    };
    // A node belongs to the first subgraph that lists it, and a subgraph never contains itself.
    const members = this.members;
    subgraph.nodes = nodeList.filter((nodeId) => !members.has(nodeId) && nodeId !== id);
    for (const nodeId of subgraph.nodes) members.add(nodeId);

    const existing = this.subgraphLookup.get(id);
    if (existing) for (const nodeId of subgraph.nodes) existing.nodes.push(nodeId);
    else this.subgraphs.push(subgraph);
    this.subgraphLookup.set(id, existing ?? subgraph);
    return id;
  }

  exists(all: FlowSubgraph[], id: string): boolean {
    for (const sg of all) if (sg.nodes.includes(id)) return true;
    return false;
  }

  makeUniq(sg: FlowSubgraph, all: FlowSubgraph[]): { nodes: string[] } {
    const taken = new Set<string>();
    for (const other of all) for (const id of other.nodes) taken.add(id);
    return { nodes: sg.nodes.filter((id) => !taken.has(id)) };
  }

  destructLink(end: string, start?: string): { type: string; stroke: string; length?: number } {
    const info = destructEndLink(end);
    if (!start) return info;
    const startInfo = destructStartLink(start);
    if (startInfo.stroke !== info.stroke) return { type: 'INVALID', stroke: 'INVALID' };
    if (startInfo.type === 'arrow_open') {
      startInfo.type = info.type;
    } else {
      if (startInfo.type !== info.type) return { type: 'INVALID', stroke: 'INVALID' };
      startInfo.type = 'double_' + startInfo.type;
    }
    if (startInfo.type === 'double_arrow') startInfo.type = 'double_arrow_point';
    startInfo.length = info.length;
    return startInfo;
  }

  subgraph(id: string): FlowSubgraph | undefined {
    return this.subgraphLookup.get(id);
  }
}
