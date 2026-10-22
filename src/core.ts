import { detectDiagram, type Detected, type DiagramType, type MermaidType } from './detect.js';
import { PeleError } from './errors.js';
import { decodeEntities } from './text/entities.js';
import { withIcons } from './text/icons.js';
import { withMath } from './text/math.js';
import { encodeEntities, preprocess, type Config } from './preprocess.js';
import type { DiagramModel } from './models.js';
import { mountWith, type MountOptions, type Mounted } from './mount.js';
import type { Diagram, RenderOptions, RenderResult } from './types.js';

export { PeleError } from './errors.js';
export type { PeleErrorCode } from './errors.js';
export type { DiagramType, MermaidType } from './detect.js';
export type { TextMeasurer } from './text/measurer.js';
export type { IconResolver, LinkInfo, MathMarkup, MathResolver, RenderOptions, RenderResult } from './types.js';
export type { Diagram } from './types.js';
export type { MountOptions, Mounted } from './mount.js';
export { forgetTextWidths } from './text/measurer.js';
export { enableZoom } from './zoom.js';
export type { Zoom, ZoomOptions } from './zoom.js';

const diagrams = new Map<DiagramType, Diagram<unknown>>();

// Makes diagram types available to render() and parse(). The full entry point registers every
// type; an app that imports this module picks the ones it needs.
export function register(...list: Diagram<any>[]): void {
  for (const diagram of list) diagrams.set(diagram.type, diagram as Diagram<unknown>);
}

export function registered(type: DiagramType): boolean {
  return diagrams.has(type);
}

// Mermaid's default maxTextSize.
const DEFAULT_LIMIT = 50000;
// Mermaid has no limit on its output. A source within the limit can still describe a drawing
// of many megabytes, which would stall the page it is put into.
const DEFAULT_OUTPUT_LIMIT = 4_000_000;
// Mermaid stops at 500. Pele draws 5,000 edges in tens of milliseconds, and `A & B --> C & D`
// multiplies: without a limit, a few kilobytes of source ask for millions of edges.
const DEFAULT_MAX_EDGES = 5000;

// Deep nesting can exhaust the stack in a few recursive spots. Report it as a limit, not a crash.
function guarded<T>(run: () => T): T {
  try {
    return run();
  } catch (error) {
    if (error instanceof RangeError) throw new PeleError('Diagram is nested too deeply.', 'limit');
    throw error;
  }
}

function tagErrors<T>(found: Detected, run: () => T): T {
  try {
    return run();
  } catch (error) {
    if (error instanceof RangeError) throw new PeleError('Diagram is nested too deeply.', 'limit', found);
    if (error instanceof PeleError) {
      error.type ??= found.type;
      error.mermaidType ??= found.mermaidType;
    }
    throw error;
  }
}

export type ParsedDiagramModel = DiagramModel & { readonly mermaidType: MermaidType };

interface Parsed extends Detected {
  diagram: Diagram<unknown>;
  model: unknown;
  config: Config;
}

const parsedModels = new WeakMap<object, Parsed>();

function parseSource(
  text: string,
  limit: number = DEFAULT_LIMIT,
  maxEdges: number = DEFAULT_MAX_EDGES,
  extra: Config | undefined
): Parsed {
  if (text.length > limit) {
    throw new PeleError(`Diagram source is longer than the limit of ${limit} characters.`, 'limit');
  }
  const pre = preprocess(text);
  const found = detectDiagram(pre.text);
  if (found === null) {
    throw new PeleError('No diagram type detected for the given text.', 'unsupported-diagram');
  }
  const diagram = diagrams.get(found.type);
  if (diagram === undefined) {
    throw new PeleError(`Diagram type "${found.type}" is not supported yet.`, 'unsupported-diagram', found);
  }
  const config = extra ? { ...extra, ...pre.config } : pre.config;
  const source = diagram.keepComments ? pre.withComments : pre.text;
  const model = tagErrors(found, () =>
    diagram.parse(encodeEntities(source) + '\n', config, pre.title, pre.lineOffset, { maxEdges })
  );
  return { ...found, diagram, model, config };
}

function parsedFrom(source: string | DiagramModel, options: ParseOptions): Parsed {
  if (typeof source === 'string') return parseSource(source, options.limit, options.maxEdges, options.config);
  const parsed = parsedModels.get(source);
  if (parsed === undefined) throw new TypeError('render() takes diagram text or a model that parse() returned.');
  return parsed;
}

export function detectType(text: string): DiagramType | null {
  return detectDiagram(preprocess(text).text)?.type ?? null;
}

export function supports(text: string): boolean {
  try {
    const type = detectType(text);
    return type !== null && diagrams.has(type);
  } catch {
    return false;
  }
}

// The options that are read when the text is parsed. A render() that is given a model has
// nothing left to do with them.
export type ParseOptions = Pick<RenderOptions, 'limit' | 'maxEdges' | 'config'>;

export function parse(text: string, options: ParseOptions = {}): ParsedDiagramModel {
  return guarded(() => {
    const parsed = parseSource(text, options.limit, options.maxEdges, options.config);
    const model = parsed.model as ParsedDiagramModel;
    Object.defineProperty(model, 'mermaidType', { value: parsed.mermaidType, enumerable: true });
    parsedModels.set(model, parsed);
    return model;
  });
}

export function render(source: string | DiagramModel, options: RenderOptions = {}): RenderResult {
  return guarded(() => {
    const { type, mermaidType, diagram, model, config } = parsedFrom(source, options);
    const section = config[diagram.section ?? type];
    const fixed = typeof section === 'object' && section !== null && !Array.isArray(section) && section.useMaxWidth === false;
    const responsive = options.responsive ?? !fixed;
    // The host's icon resolver and the ids in `links` see names as the author meant them, with
    // entity codes turned into their characters, as `data-icon` and `data-id` in the SVG do.
    const resolve = options.icons;
    const icons = resolve && ((name: string) => resolve(decodeEntities(name)));
    const rendered = tagErrors({ type, mermaidType }, () =>
      withMath(diagram.math ? options.math : undefined, () =>
        withIcons(icons, () => diagram.render(model, config, { ...options, responsive, icons }))
      )
    );
    const outputLimit = options.outputLimit ?? DEFAULT_OUTPUT_LIMIT;
    if (rendered.svg.length > outputLimit) {
      throw new PeleError(`Diagram output is longer than the limit of ${outputLimit} characters.`, 'limit', {
        type,
        mermaidType,
      });
    }
    for (const link of rendered.links) link.id = decodeEntities(link.id);
    return { type, mermaidType, ...rendered };
  });
}

// Renders into an element and draws again when the element's width calls for it. Text that
// cannot be drawn shows its error in the element.
export function mount(element: HTMLElement, text: string, options: MountOptions = {}): Mounted {
  return mountWith({ parse, render }, element, text, options);
}
