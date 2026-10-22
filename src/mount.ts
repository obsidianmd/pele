import type { DiagramModel } from './models.js';
import { forgetTextWidths } from './text/measurer.js';
import type { RenderOptions, RenderResult } from './types.js';
import { room, windowOf } from './window.js';
import { zoomWith, type Zoom, type ZoomOptions } from './zoom.js';

export interface MountOptions extends RenderOptions {
  // Called after the diagram is put in the element, and again each time it is drawn anew.
  onRender?: (result: RenderResult) => void;
  // Whether the diagram can be enlarged and moved about in its box. By default, 'auto', one
  // that was shrunk to fit can be. `true` lets any diagram be, and `false` none. Options for
  // the zoom can be given in place of these.
  zoom?: boolean | 'auto' | ZoomOptions;
  // Turns the drawing's markup into what the element is given, such as a host's HTML sanitizer.
  // It should give back the drawing, an <svg>, or a fragment that starts with it. Without it the
  // markup is set as the element's HTML.
  sanitize?: (svg: string) => Node;
  // Called when the diagram cannot be drawn: its text cannot be parsed or drawn, or a drawing
  // that a change of width or fonts called for fails. The element shows the error.
  onError?: (error: unknown) => void;
}

export interface Mounted {
  // What is drawn in the element, or undefined if nothing could be drawn yet.
  readonly result: RenderResult | undefined;
  // The text last given, whether or not it could be drawn.
  readonly source: string;
  // Why that text could not be drawn, or undefined if it was.
  readonly error: unknown;
  // The diagram's zoom, unless the `zoom` option is false.
  readonly zoom: Zoom | undefined;
  // Draws other text, or the same text with other options, in the same element. Text that
  // cannot be drawn leaves the last drawing, dimmed, with the error over its bottom edge. A
  // hidden element is drawn when it is shown. If `onRender` throws, the new drawing is already
  // in place and stays, and the error is thrown.
  update(text: string, options?: MountOptions): void;
  // Draws again if what the drawing depends on has changed since it was drawn: the element's
  // width or its fonts. An element that is hidden or out of the document is left until it is
  // shown. For after a change of theme or font, and after the element is put back in a document
  // or moved to another window.
  refresh(): void;
  // Stops watching the element. What it shows stays.
  destroy(): void;
}

export interface Engine {
  parse(text: string, options: RenderOptions): DiagramModel;
  render(model: DiagramModel, options: RenderOptions): RenderResult;
}

interface Fonts {
  family?: string;
  mono?: string;
}

// The fonts CSS gives the diagram. A variable may be set on the drawing itself, which the
// element that holds it does not inherit, so a drawing that is there is the one asked.
function fontsFor(style: CSSStyleDeclaration, drawing: HTMLElement | null): Fonts {
  const own = drawing ? windowOf(drawing).getComputedStyle(drawing) : style;
  return {
    family: own.getPropertyValue('--pele-font').trim() || style.fontFamily || undefined,
    mono: own.getPropertyValue('--pele-font-mono').trim() || undefined,
  };
}

// The fonts a diagram is drawn with: those of the element's document, which its CSS names, and
// those of the script's, which measures with its canvas.
function fontSets(element: HTMLElement): FontFaceSet[] {
  const sets = new Set([element.ownerDocument?.fonts, (globalThis as { document?: Document }).document?.fonts]);
  return [...sets].filter((fonts): fonts is FontFaceSet => fonts !== undefined);
}

// Fonts that are still loading, as one promise for each set however many diagrams wait on it.
// Widths measured before they load are those of a fallback, so they are forgotten once then.
const settling = new WeakMap<FontFaceSet, Promise<void>>();

function settled(fonts: FontFaceSet): Promise<void> {
  let done = settling.get(fonts);
  if (!done) {
    done = fonts.ready.then(() => {
      settling.delete(fonts);
      forgetTextWidths();
    });
    settling.set(fonts, done);
  }
  return done;
}

// Tells a diagram that fonts it was drawn while waiting for have loaded. The wait holds it weakly,
// as it does the element, so that one the page drops while fonts load can be collected.
const onFontsLoaded = new WeakMap<Mounted, () => void>();

function afterFonts(loading: FontFaceSet[], diagram: WeakRef<Mounted>): void {
  void Promise.all(loading.map(settled)).then(() => {
    const handle = diagram.deref();
    if (handle) onFontsLoaded.get(handle)?.();
  });
}

const mounts = new WeakMap<HTMLElement, Mounted>();
let mounted = 0;
// Another copy of Pele on the page counts its own diagrams.
const copy = Math.random().toString(36).slice(2, 7);

// An error over a drawing takes no room: it is pulled up over the drawing's bottom edge by its own
// height. One with no drawing above it is shown whole, in the monospace its caret lines up in.
const OVER_STYLE =
  'position:relative;height:1.3em;margin-top:-1.3em;line-height:1.3;font-size:0.8em;' +
  'color:var(--pele-error,#e45756);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;';
const ALONE_STYLE =
  'margin:0;font-size:0.8em;font-family:var(--pele-font-mono,monospace);' +
  'color:var(--pele-error,#e45756);white-space:pre-wrap;';

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

// A parse error's first line says where it is, and its last line what is wrong.
function summary(message: string): string {
  const lines = message.split('\n').filter((line) => line.trim() !== '');
  return lines.length > 1 ? `${lines[0]} ${lines[lines.length - 1]}` : (lines[0] ?? '');
}

// Puts a diagram in an element and keeps it fitted to the element's width. The element should
// be one whose width does not depend on what it holds, such as a block.
export function mountWith(engine: Engine, element: HTMLElement, text: string, options: MountOptions = {}): Mounted {
  mounts.get(element)?.destroy();

  let source = text;
  let settings = options;
  let model: DiagramModel | undefined;
  // The model of what is shown, drawn again for a change of width or fonts while the text last
  // given cannot be drawn.
  let drawnModel: DiagramModel | undefined;
  // Whether the model is that of the text last given, with the options given with it.
  let current = false;
  let error: unknown;
  let natural: RenderResult;
  let shown: RenderResult | undefined;
  // Ids in one drawing must not be those of another in the same page.
  const idPrefix = `pele-${copy}-${++mounted}`;
  let fonts: Fonts = {};
  // Whether the width there is can change how this diagram is drawn. Not known until asked.
  let adapts: boolean | undefined;
  let drawnFor = -1;
  let stale = false;
  let waiting = false;
  let destroyed = false;

  const fit = (style: CSSStyleDeclaration, fresh: boolean): RenderResult => {
    const { onRender, onError, sanitize, ...rest } = settings;
    const base: RenderOptions = {
      ...rest,
      idPrefix: rest.idPrefix ?? idPrefix,
      fontFamily: rest.fontFamily ?? fonts.family,
      fontFamilyMono: rest.fontFamilyMono ?? fonts.mono,
      maxWidth: undefined,
    };
    if (fresh) {
      natural = engine.render(model!, base);
      adapts = undefined;
    }
    const available = settings.maxWidth ?? room(element, style);
    drawnFor = available;
    if (available > 0 && available < natural.width) {
      // Drawn for no room at all, a diagram that the width can change comes out differently.
      adapts ??= engine.render(model!, { ...base, maxWidth: 1 }).svg !== natural.svg;
      if (adapts) return engine.render(model!, { ...base, maxWidth: available });
    }
    return natural;
  };

  const put = (svg: string): void => {
    if (settings.sanitize) element.replaceChildren(settings.sanitize(svg));
    else element.innerHTML = svg;
  };

  // Shows the error, if there is one, over the drawing or in its place. The drawing is dimmed.
  let errorElement: HTMLElement | undefined;
  const mark = (): void => {
    const drawing = shown ? (element.firstElementChild as HTMLElement | null) : null;
    if (drawing?.style) drawing.style.opacity = error === undefined ? '' : '0.4';
    if (error === undefined) {
      errorElement?.remove();
      errorElement = undefined;
      return;
    }
    const doc = element.ownerDocument;
    if (!doc) return;
    errorElement ??= doc.createElement('div');
    errorElement.className = 'pele pele-error';
    const message = messageOf(error);
    if (drawing) {
      errorElement.textContent = summary(message);
      errorElement.title = message;
      errorElement.setAttribute('style', OVER_STYLE);
      if (errorElement.parentNode !== element) element.append(errorElement);
    } else {
      errorElement.textContent = message;
      errorElement.removeAttribute('title');
      errorElement.setAttribute('style', ALONE_STYLE);
      element.replaceChildren(errorElement);
    }
  };
  const fail = (failure: unknown): void => {
    error = failure;
    mark();
    settings.onError?.(failure);
  };

  const awaitFonts = (): void => {
    if (waiting || destroyed) return;
    const loading = fontSets(element).filter((fonts) => fonts.status === 'loading');
    if (loading.length === 0) return;
    waiting = true;
    afterFonts(loading, new WeakRef(handle));
  };
  const fontsLoaded = (): void => {
    waiting = false;
    stale = true;
    refresh();
  };

  // A quiet draw leaves the element alone when it would show the same thing.
  const draw = (fresh: boolean, quiet = !fresh): void => {
    const style = windowOf(element).getComputedStyle(element);
    const drawing = (element.firstElementChild as HTMLElement | null) ?? null;
    const before = { fonts, natural, adapts, drawnFor, stale };
    let next: RenderResult;
    try {
      if (fresh) {
        fonts = fontsFor(style, drawing);
        stale = element.isConnected === false;
      }
      next = fit(style, fresh);
      if (quiet && next.svg === shown?.svg) {
        if (fresh) drawnModel = model;
        if (current && error !== undefined) {
          error = undefined;
          mark();
        }
        return;
      }
      put(next.svg);
    } catch (failure) {
      // The element is as it was, and so is what it was drawn for.
      ({ fonts, natural, adapts, drawnFor, stale } = before);
      throw failure;
    }
    if (fresh) drawnModel = model;
    if (fresh && !drawing && element.firstElementChild) {
      const seen = fontsFor(style, element.firstElementChild as HTMLElement);
      if (seen.family !== fonts.family || seen.mono !== fonts.mono) {
        const first = { fonts, natural, adapts, drawnFor };
        fonts = seen;
        try {
          const second = fit(style, true);
          put(second.svg);
          next = second;
        } catch {
          // What was drawn for the element's own font is in the element, and stays, whether the
          // drawing or the host's sanitizer failed.
          ({ fonts, natural, adapts, drawnFor } = first);
        }
      }
    }
    // From here the drawing is the one shown. Nothing above throws once the element has changed.
    shown = next;
    if (current) error = undefined;
    mark();
    zoomer?.refresh();
    awaitFonts();
    settings.onRender?.(next);
  };

  // Made after the first drawing, and again when the option changes.
  let zoomer: ReturnType<typeof zoomWith> | undefined;
  let zooming: MountOptions['zoom'] = false;
  const zoom = (): void => {
    const wanted = settings.zoom ?? 'auto';
    if (wanted === zooming) return;
    zoomer?.destroy();
    zooming = wanted;
    // The diagram's observer tells the zoom when the element's size changes.
    zoomer = wanted === false ? undefined : zoomWith(element, typeof wanted === 'object' ? wanted : { always: wanted === true }, false);
  };

  const hidden = (): boolean => element.isConnected === false || !(element.clientWidth > 0);
  // One out of the document is drawn as a guess, so that it shows the text when it is put back
  // before the observer can see it, at the size it had. A hidden one in the document waits.
  const waits = (): boolean => element.isConnected !== false && !(element.clientWidth > 0);

  const refresh = (): void => {
    if (destroyed) return;
    watch();
    if (!model || hidden()) return;
    const style = windowOf(element).getComputedStyle(element);
    const now = fontsFor(style, (element.firstElementChild as HTMLElement | null) ?? null);
    try {
      if (stale || now.family !== fonts.family || now.mono !== fonts.mono) {
        draw(true, true);
      } else if (adapts !== false && settings.maxWidth === undefined) {
        const available = room(element, style);
        // An element that wraps the drawing follows its width, which is not a change of room.
        if (available !== drawnFor && available !== shown?.width) draw(false);
      }
    } catch (failure) {
      // What is shown stays, and is not drawn again until something else changes. A drawing of
      // text since replaced keeps the error of the text that replaced it.
      stale = false;
      if (current) error = failure;
      // Text given while the element was hidden could not be drawn. What is shown is drawn again
      // for a change of width or fonts, and the error stays until other text is given.
      if (model !== drawnModel) {
        model = drawnModel;
        current = false;
      }
      mark();
      settings.onError?.(failure);
    }
    zoomer?.resized();
    awaitFonts();
  };

  // Observed from the window the element is in now, which changes if a host moves it to another:
  // an observer reports only on its own window's frames.
  let view: typeof globalThis | undefined;
  let observer: ResizeObserver | undefined;
  let frame: number | undefined;
  const cancelFrame = (): void => {
    if (frame !== undefined) view?.cancelAnimationFrame(frame);
    frame = undefined;
  };
  const watch = (): void => {
    const next = windowOf(element);
    if (next === view) return;
    observer?.disconnect();
    cancelFrame();
    view = next;
    observer = next.ResizeObserver ? new next.ResizeObserver(() => {
      if (frame !== undefined) return;
      if (!next.requestAnimationFrame) return refresh();
      frame = next.requestAnimationFrame(() => {
        frame = undefined;
        refresh();
      });
    }) : undefined;
    observer?.observe(element);
  };

  const handle: Mounted = {
    get result() {
      return shown;
    },
    get source() {
      return source;
    },
    get error() {
      return error;
    },
    get zoom() {
      return zoomer;
    },
    update(next, nextOptions = settings) {
      const reparse =
        !current ||
        next !== source ||
        nextOptions.limit !== settings.limit ||
        nextOptions.maxEdges !== settings.maxEdges ||
        nextOptions.config !== settings.config;
      // The options stand whether or not the text can be drawn.
      source = next;
      settings = nextOptions;
      let nextModel = model;
      if (reparse) {
        try {
          nextModel = engine.parse(next, nextOptions);
        } catch (failure) {
          // The last text that could be parsed is drawn for a change of width or fonts, or once
          // a hidden element is shown.
          current = false;
          fail(failure);
          zoom();
          return;
        }
      }
      const was = shown;
      model = nextModel;
      current = true;
      if (waits()) {
        stale = true;
        zoom();
        return;
      }
      try {
        draw(true);
      } catch (failure) {
        // If the element has the new drawing, it was the host's onRender that threw, and the
        // update stands. Otherwise the element is as it was.
        if (shown !== was) {
          zoom();
          throw failure;
        }
        model = drawnModel;
        current = false;
        fail(failure);
      }
      zoom();
    },
    refresh,
    destroy() {
      destroyed = true;
      observer?.disconnect();
      observer = undefined;
      cancelFrame();
      view = undefined;
      zoomer?.destroy();
      onFontsLoaded.delete(handle);
      if (mounts.get(element) === handle) mounts.delete(element);
    },
  };
  onFontsLoaded.set(handle, fontsLoaded);
  try {
    model = engine.parse(text, options);
    current = true;
    draw(true);
  } catch (failure) {
    // A drawing in place means the host's onRender threw.
    if (shown) throw failure;
    model = drawnModel;
    current = false;
    fail(failure);
  }
  zoom();
  watch();
  mounts.set(element, handle);
  return handle;
}
