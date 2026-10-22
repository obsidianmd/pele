import { setFlagsFromString } from 'node:v8';
import { runInNewContext } from 'node:vm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { PeleError, mount, parse, render, type DiagramModel, type RenderOptions, type RenderResult } from '../src/index.js';
import { mountWith, type Engine } from '../src/mount.js';
import { metricsMeasurer } from '../src/text/measurer.js';

setFlagsFromString('--expose-gc');
const collect = runInNewContext('gc') as () => void;

// Just enough of a browser for mount(): an element with a width, its computed style, and an observer to fire by hand.
interface FakeElement { clientWidth: number; innerHTML: string }
let observers: { fire: () => void; element: FakeElement; connected: boolean }[] = [];
let frames = new Map<number, FrameRequestCallback>();
let nextFrame = 0;
const globals = globalThis as Record<string, unknown>;

const paint = (): void => {
  const pending = [...frames.values()];
  frames.clear();
  for (const callback of pending) callback(0);
};

beforeEach(() => {
  observers = [];
  frames = new Map();
  globals.requestAnimationFrame = (callback: FrameRequestCallback) => { frames.set(++nextFrame, callback); return nextFrame; };
  globals.cancelAnimationFrame = (id: number) => { frames.delete(id); };
  globals.getComputedStyle = () => ({ fontFamily: 'sans-serif', paddingLeft: '10px', paddingRight: '10px', getPropertyValue: () => '' });
  globals.ResizeObserver = class {
    private entry = { fire: () => this.callback(), element: undefined as unknown as FakeElement, connected: false };
    constructor(private callback: () => void) {}
    observe(element: FakeElement) {
      this.entry.element = element;
      this.entry.connected = true;
      observers.push(this.entry);
    }
    disconnect() {
      this.entry.connected = false;
    }
  };
});
afterEach(() => {
  delete globals.getComputedStyle;
  delete globals.ResizeObserver;
  delete globals.requestAnimationFrame;
  delete globals.cancelAnimationFrame;
});

const element = (clientWidth: number): HTMLElement =>
  ({ clientWidth, innerHTML: '', firstElementChild: null, addEventListener() {}, removeEventListener() {} }) as unknown as HTMLElement;
const resize = (target: HTMLElement, clientWidth: number): void => {
  (target as unknown as FakeElement).clientWidth = clientWidth;
  for (const observer of observers) if (observer.connected && observer.element === (target as unknown)) observer.fire();
  paint();
};
const options = { measurer: metricsMeasurer };
const spying = (seen: (o: RenderOptions) => void, parsed?: () => void): Engine => ({
  parse(text, o) {
    parsed?.();
    return parse(text, o);
  },
  render(model: DiagramModel, o) {
    seen(o);
    return render(model, { ...o, measurer: metricsMeasurer });
  },
});
const fontSet = () => {
  let finish = (): void => {};
  const fonts = {
    status: 'loaded',
    ready: Promise.resolve() as Promise<unknown>,
  };
  return {
    fonts,
    loading(): void {
      fonts.status = 'loading';
      fonts.ready = new Promise((resolve) => {
        finish = () => {
          fonts.status = 'loaded';
          resolve(fonts);
        };
      });
    },
    async loaded(): Promise<void> {
      finish();
      for (let i = 0; i < 3; i++) await Promise.resolve();
    },
  };
};
const SANKEY = 'sankey\n\nGrid,Homes,113\nGrid,Industry,342\nGrid,Losses,56\n';
const FLOW = 'flowchart LR\n  A[One] --> B[Two] --> C[Three] --> D[Four] --> E[Five] --> F[Six] --> G[Seven]';

describe('mount', () => {
  it('draws a chart for the room the element has, and again when that changes', () => {
    const own = { ...options, idPrefix: 'own' };
    const natural = render(SANKEY, own);
    const el = element(1000);
    const drawn: RenderResult[] = [];
    const handle = mount(el, SANKEY, { ...own, onRender: (result) => drawn.push(result) });
    expect(el.innerHTML).toBe(natural.svg);
    expect(handle.result.width).toBe(natural.width);

    resize(el, 420);
    expect(handle.result.width).toBe(400);
    expect(el.innerHTML).toBe(render(SANKEY, { ...own, maxWidth: 400 }).svg);

    resize(el, 340);
    expect(handle.result.width).toBe(320);
    resize(el, 1000);
    expect(el.innerHTML).toBe(natural.svg);
    expect(drawn.map((result) => result.width)).toEqual([natural.width, 400, 320, natural.width]);
  });

  it('draws for a change of size in the next frame, once however many changes it sees', () => {
    const el = element(1000);
    let count = 0;
    const handle = mount(el, SANKEY, { ...options, onRender: () => count++ });
    (el as unknown as FakeElement).clientWidth = 420;
    observers[0].fire();
    observers[0].fire();
    expect(count).toBe(1);
    paint();
    expect(count).toBe(2);
    expect(handle.result.width).toBe(400);

    (el as unknown as FakeElement).clientWidth = 340;
    observers[0].fire();
    handle.destroy();
    paint();
    expect(count).toBe(2);
  });

  it('draws for a change of size at once in a window without frames', () => {
    delete globals.requestAnimationFrame;
    const el = element(1000);
    const handle = mount(el, SANKEY, options);
    (el as unknown as FakeElement).clientWidth = 420;
    observers[0].fire();
    expect(handle.result.width).toBe(400);
  });

  it('leaves the drawing alone while the element has no width, as when it is hidden', () => {
    const el = element(420);
    let count = 0;
    const handle = mount(el, SANKEY, { ...options, onRender: () => count++ });
    resize(el, 0);
    expect(handle.result.width).toBe(400);
    resize(el, 420);
    expect(count).toBe(1);
    resize(el, 340);
    expect(handle.result.width).toBe(320);
  });

  it('starts narrow in a narrow element', () => {
    const el = element(340);
    expect(mount(el, SANKEY, options).result.width).toBe(320);
  });

  it('draws once when the diagram cannot use the room differently', () => {
    const el = element(1000);
    let count = 0;
    const handle = mount(el, FLOW.replace('LR', 'TB'), { ...options, onRender: () => count++ });
    const natural = el.innerHTML;
    resize(el, 300);
    resize(el, 30);
    resize(el, 900);
    expect(count).toBe(1);
    expect(el.innerHTML).toBe(natural);
    expect(handle.result.type).toBe('flowchart');
  });

  it('turns a flowchart that runs across when the element gets narrow, and back', () => {
    const el = element(1000);
    const handle = mount(el, FLOW, options);
    const across = handle.result;
    resize(el, 700);
    expect(handle.result.height).toBeLessThanOrEqual(across.height);
    resize(el, 340);
    expect(handle.result.height).toBeGreaterThan(across.height);
    expect(handle.result.width).toBeLessThan(across.width);
    resize(el, 1000);
    expect(handle.result.svg).toBe(across.svg);
  });

  it('does not chase an element that takes the width of its drawing', () => {
    const el = element(340);
    let count = 0;
    const handle = mount(el, SANKEY, { ...options, onRender: () => count++ });
    resize(el, handle.result.width + 20);
    resize(el, handle.result.width + 20);
    expect(count).toBe(1);
  });

  it('waits for an element that has no width yet', () => {
    const el = element(0);
    const handle = mount(el, SANKEY, options);
    expect(handle.result.width).toBe(render(SANKEY, options).width);
    resize(el, 340);
    expect(handle.result.width).toBe(320);
  });

  it('measures with the font of the element unless one is given', () => {
    const seen: string[] = [];
    globals.getComputedStyle = () => ({ fontFamily: 'Inter', paddingLeft: '0px', paddingRight: '0px', getPropertyValue: () => '' });
    const spy = spying((o) => seen.push(o.fontFamily ?? ''));
    mountWith(spy, element(500), FLOW);
    mountWith(spy, element(500), FLOW, { fontFamily: 'Georgia' });
    expect([...new Set(seen)]).toEqual(['Inter', 'Georgia']);
  });

  // An element whose drawing, once it has one, can be given variables of its own.
  interface Styled { fontFamily: string; vars?: Record<string, string> }
  const styled = (container: Styled, drawing?: Styled) => {
    const child = {};
    const set = fontSet();
    const el = {
      clientWidth: 500,
      html: '',
      firstElementChild: null as object | null,
      get innerHTML() {
        return this.html;
      },
      set innerHTML(value: string) {
        this.html = value;
        this.firstElementChild = drawing ? child : null;
      },
      addEventListener() {},
      removeEventListener() {},
      ownerDocument: { fonts: set.fonts },
    };
    globals.getComputedStyle = (target: unknown) => {
      const style = target === child && drawing ? drawing : container;
      return { fontFamily: style.fontFamily, paddingLeft: '0px', paddingRight: '0px', getPropertyValue: (name: string) => style.vars?.[name] ?? '' };
    };
    const seen: string[] = [];
    const spy = spying((o) => seen.push(`${o.fontFamily}|${o.fontFamilyMono}`));
    return { el: el as unknown as HTMLElement, seen, spy, fonts: set };
  };

  it('takes its fonts from the variables where they are set', () => {
    const { el, seen, spy } = styled({ fontFamily: 'Georgia', vars: { '--pele-font': ' Inter, sans-serif ', '--pele-font-mono': 'Menlo' } });
    mountWith(spy, el, FLOW);
    expect([...new Set(seen)]).toEqual(['Inter, sans-serif|Menlo']);
    expect(el.innerHTML).toContain('font-family:var(--pele-font,Inter, sans-serif)');
    expect(el.innerHTML).toContain('--_fm:var(--pele-font-mono,Menlo)');
  });

  it('finds a variable that is set on the drawing and not on the element', () => {
    const { el, seen, spy } = styled({ fontFamily: 'Georgia' }, { fontFamily: 'Inter', vars: { '--pele-font': 'Inter' } });
    let renders = 0;
    const handle = mountWith(spy, el, FLOW, { onRender: () => renders++ });
    // Drawn for the element's font first, as nothing better is known, then for the one found.
    expect([...new Set(seen)]).toEqual(['Georgia|undefined', 'Inter|undefined']);
    expect(el.innerHTML).toContain('font-family:var(--pele-font,Inter)');
    expect(renders).toBe(1);
    seen.length = 0;
    handle.update(FLOW);
    expect([...new Set(seen)]).toEqual(['Inter|undefined']);
  });

  it('measures again once fonts that were loading have loaded, and leaves the element alone if nothing moved', async () => {
    const { el, seen, spy, fonts } = styled({ fontFamily: 'Georgia' });
    fonts.loading();
    let renders = 0;
    const handle = mountWith(spy, el, FLOW, { onRender: () => renders++ });
    const drawn = seen.length;
    await fonts.loaded();
    expect(seen.length).toBeGreaterThan(drawn);
    expect(renders).toBe(1);
    let after = seen.length;
    fonts.loading();
    await fonts.loaded();
    handle.refresh();
    expect(seen.length).toBe(after);
    fonts.loading();
    handle.refresh();
    after = seen.length;
    handle.destroy();
    await fonts.loaded();
    expect(seen.length).toBe(after);
  });

  it('draws again with the page\'s fonts once an element mounted outside the document is in it', () => {
    const { el, seen, spy } = styled({ fontFamily: '' });
    const outside = el as unknown as { isConnected: boolean; clientWidth: number };
    outside.isConnected = false;
    outside.clientWidth = 0;
    let renders = 0;
    mountWith(spy, el, FLOW, { onRender: () => renders++ });
    expect([...new Set(seen)]).toEqual(['undefined|undefined']);
    // Put in the document: it has a font and a width now, and the observer reports its size.
    globals.getComputedStyle = () => ({ fontFamily: 'Georgia', paddingLeft: '0px', paddingRight: '0px', getPropertyValue: () => '' });
    outside.isConnected = true;
    outside.clientWidth = 500;
    seen.length = 0;
    resize(el, 500);
    expect([...new Set(seen)]).toEqual(['Georgia|undefined']);
    expect(el.innerHTML).toContain('font-family:var(--pele-font,Georgia)');
    expect(renders).toBe(2);
  });

  it('makes a zoom for the diagram unless told not to', () => {
    expect(mount(element(500), FLOW, options).zoom).toBeDefined();
    expect(mount(element(500), FLOW, { ...options, zoom: true }).zoom).toBeDefined();
    expect(mount(element(500), FLOW, { ...options, zoom: { controls: false, labels: { zoomIn: 'Agrandir' } } }).zoom).toBeDefined();
    const handle = mount(element(500), FLOW, { ...options, zoom: false });
    expect(handle.zoom).toBeUndefined();
    handle.update(FLOW, options);
    expect(handle.zoom).toBeDefined();
    // Nothing has been shrunk here, so there is nothing to enlarge.
    expect(handle.zoom!.fit).toBe(1);
    expect(handle.zoom!.scale).toBe(1);
  });

  it('keeps to a width the host sets', () => {
    const el = element(1000);
    const handle = mount(el, SANKEY, { ...options, maxWidth: 320 });
    expect(handle.result.width).toBe(320);
    resize(el, 600);
    expect(handle.result.width).toBe(320);
  });

  it('updates, reports errors as render does, and stops when destroyed', () => {
    const el = element(340);
    const errors: unknown[] = [];
    const handle = mount(el, SANKEY, { ...options, onError: (error) => errors.push(error) });
    handle.update(FLOW);
    expect(handle.result?.type).toBe('flowchart');
    expect(handle.result?.mermaidType).toBe('flowchart-v2');
    expect(el.innerHTML).toBe(render(FLOW, { ...options, maxWidth: 320 }).svg);
    handle.update('flowchart LR\n  A -->');
    expect(handle.error).toBeInstanceOf(PeleError);
    expect((handle.error as PeleError).mermaidType).toBe('flowchart-v2');
    expect(errors).toEqual([handle.error]);
    expect(handle.source).toBe('flowchart LR\n  A -->');
    expect(handle.result?.type).toBe('flowchart');
    expect(el.innerHTML).toBe(render(FLOW, { ...options, maxWidth: 320 }).svg);
    const nothing = mount(element(300), 'not a diagram', options);
    expect(nothing.result).toBeUndefined();
    expect(nothing.error).toBeInstanceOf(PeleError);

    handle.update(SANKEY);
    handle.destroy();
    const before = el.innerHTML;
    resize(el, 1000);
    expect(el.innerHTML).toBe(before);
  });

  it('works where there is nothing to watch with', () => {
    delete globals.ResizeObserver;
    const el = element(340);
    const handle = mount(el, SANKEY, options);
    expect(handle.result.width).toBe(320);
    handle.destroy();
  });

  const page = () => {
    const set = fontSet();
    const ownerDocument = { fonts: set.fonts };
    const make = (clientWidth: number) =>
      ({ clientWidth, innerHTML: '', firstElementChild: null, isConnected: true, ownerDocument, addEventListener() {}, removeEventListener() {} }) as unknown as HTMLElement;
    return { element: make, fonts: set };
  };
  const connect = (target: HTMLElement, connected: boolean): void => {
    (target as unknown as { isConnected: boolean }).isConnected = connected;
  };

  it('draws every diagram that was measured while fonts were loading again once they have loaded', async () => {
    const doc = page();
    doc.fonts.loading();
    let draws = 0;
    const spy = spying(() => draws++);
    const handles = [1, 2, 3].map(() => mountWith(spy, doc.element(500), FLOW));
    handles[0].destroy();
    draws = 0;
    await doc.fonts.loaded();
    const each = draws / 2;
    expect(each).toBeGreaterThan(0);
    expect(Number.isInteger(each)).toBe(true);
  });

  it('does not keep an element that the page has dropped', async () => {
    // The observer of these tests keeps what it observes. A browser's does not.
    delete globals.ResizeObserver;
    const doc = page();
    const dropped: WeakRef<HTMLElement>[] = [];
    const drop = (stop = false): void => {
      for (let i = 0; i < 20; i++) {
        const el = doc.element(500);
        const handle = mount(el, FLOW, options);
        if (stop) handle.destroy();
        dropped.push(new WeakRef(el));
      }
    };
    drop();
    doc.fonts.loading();
    drop();
    drop(true);
    const settle = async (): Promise<void> => {
      for (let i = 0; i < 12; i++) {
        await new Promise((resolve) => setTimeout(resolve, 0));
        collect();
      }
    };
    await settle();
    expect(dropped.filter((ref) => ref.deref() !== undefined).length).toBe(0);
    await doc.fonts.loaded();
  });

  it('leaves a diagram that is out of the document alone when a font loads, and draws it when it is back', async () => {
    const doc = page();
    const el = doc.element(500);
    doc.fonts.loading();
    let draws = 0;
    mountWith(spying(() => draws++), el, FLOW);
    connect(el, false);
    draws = 0;
    await doc.fonts.loaded();
    expect(draws).toBe(0);
    connect(el, true);
    resize(el, 500);
    expect(draws).toBeGreaterThan(0);
  });

  it('draws text that was given while out of the document again when it is back, with the fonts there', () => {
    const { el, seen, spy } = styled({ fontFamily: 'Georgia' });
    const handle = mountWith(spy, el, FLOW);
    connect(el, false);
    globals.getComputedStyle = () => ({ fontFamily: '', paddingLeft: '0px', paddingRight: '0px', getPropertyValue: () => '' });
    seen.length = 0;
    handle.update(FLOW.replace('Seven', 'Eight'));
    expect([...new Set(seen)]).toEqual(['undefined|undefined']);
    expect(el.innerHTML).toContain('Eight');
    globals.getComputedStyle = () => ({ fontFamily: 'Georgia', paddingLeft: '0px', paddingRight: '0px', getPropertyValue: () => '' });
    connect(el, true);
    seen.length = 0;
    resize(el, 500);
    expect([...new Set(seen)]).toEqual(['Georgia|undefined']);
    expect(el.innerHTML).toContain('Eight');
  });

  // Just enough of a document for the error: elements to make, add and take away.
  const shown = () => {
    interface Node { name: string; style: Record<string, string>; attributes: Record<string, string>; className: string; textContent: string; title: string; parentNode: unknown; remove(): void; setAttribute(k: string, v: string): void; removeAttribute(k: string): void }
    const children: Node[] = [];
    const make = (name: string): Node => ({
      name,
      style: {},
      attributes: {},
      className: '',
      textContent: '',
      title: '',
      parentNode: null,
      remove() {
        const at = children.indexOf(this);
        if (at >= 0) children.splice(at, 1);
        this.parentNode = null;
      },
      setAttribute(k, v) {
        this.attributes[k] = v;
      },
      removeAttribute(k) {
        delete this.attributes[k];
      },
    });
    const el = {
      clientWidth: 1000,
      children,
      ownerDocument: { createElement: make },
      get firstElementChild() {
        return children[0] ?? null;
      },
      append(node: Node) {
        node.remove();
        children.push(node);
        node.parentNode = el;
      },
      replaceChildren(...nodes: Node[]) {
        for (const node of children) node.parentNode = null;
        children.splice(0, children.length, ...nodes);
        for (const node of nodes) node.parentNode = el;
      },
      addEventListener() {},
      removeEventListener() {},
    };
    const sanitize = (svg: string) => Object.assign(make('svg'), { textContent: svg }) as unknown as globalThis.Node;
    return { el: el as unknown as HTMLElement, children, sanitize };
  };

  it('shows the error over the last drawing, dimmed, until the text can be drawn', () => {
    const { el, children, sanitize } = shown();
    const handle = mount(el, FLOW, { ...options, sanitize });
    expect(children.map((node) => node.name)).toEqual(['svg']);
    handle.update('flowchart LR\n  A -->');
    expect(children.map((node) => node.name)).toEqual(['svg', 'div']);
    const [drawing, error] = children;
    expect(drawing.style.opacity).toBe('0.4');
    expect(error.className).toBe('pele pele-error');
    expect(error.textContent).toBe("Parse error on line 3: Expecting 'NODE_STRING', got 'EOF'");
    expect(error.title).toBe((handle.error as Error).message);
    expect(error.attributes.style).toContain('margin-top:-1.3em');
    // A drawing for another width keeps it.
    resize(el, 300);
    expect(children.map((node) => node.name)).toEqual(['svg', 'div']);
    expect(children[0]).not.toBe(drawing);
    expect(children[0].style.opacity).toBe('0.4');
    handle.update(SANKEY);
    expect(children.map((node) => node.name)).toEqual(['svg']);
    expect(children[0].style.opacity).toBe('');
  });

  it('shows the whole error in place of a diagram that could not be drawn at all', () => {
    const { el, children, sanitize } = shown();
    const errors: unknown[] = [];
    const handle = mount(el, 'sequenceDiagram\n  A->>', { ...options, sanitize, onError: (error) => errors.push(error) });
    expect(handle.result).toBeUndefined();
    expect(errors).toEqual([handle.error]);
    expect(children.map((node) => node.name)).toEqual(['div']);
    expect(children[0].textContent).toBe((handle.error as Error).message);
    expect(children[0].attributes.style).toContain('white-space:pre-wrap');
    resize(el, 300);
    expect(errors.length).toBe(1);
    handle.update(SANKEY);
    expect(children.map((node) => node.name)).toEqual(['svg']);
    expect(handle.result?.type).toBe('sankey');
  });

  it('keeps the error of text that could not be drawn while hidden, at any width', () => {
    const el = element(1000);
    const handle = mount(el, SANKEY, options);
    const before = el.innerHTML;
    resize(el, 0);
    handle.update('sankey\n\nA,B,10\nB,A,10\n');
    resize(el, 1000);
    expect(handle.error).toBeInstanceOf(PeleError);
    resize(el, 1100);
    expect(handle.error).toBeInstanceOf(PeleError);
    expect(el.innerHTML).toBe(before);
    handle.update(FLOW);
    expect(handle.error).toBeUndefined();
  });

  it('takes the options given with text that cannot be drawn', () => {
    const el = element(1000);
    const first: unknown[] = [];
    const second: unknown[] = [];
    const handle = mount(el, SANKEY, { ...options, zoom: false, onError: (error) => first.push(error) });
    handle.update('flowchart LR\n  A -->', { ...options, zoom: true, onError: (error) => second.push(error) });
    expect(first).toEqual([]);
    expect(second.length).toBe(1);
    expect(handle.zoom).toBeDefined();
    handle.update('sankey\n\nA,B,10\nB,A,10\n', { ...options, zoom: false, onError: (error) => second.push(error) });
    expect(second.length).toBe(2);
    expect(handle.zoom).toBeUndefined();
  });

  it('gives each diagram its own ids', () => {
    const text = 'flowchart LR\n  accTitle: Steps\n  A --> B';
    const first = mount(element(500), text, options).result!.svg;
    const second = mount(element(500), text, options).result!.svg;
    const ids = (svg: string) => [...svg.matchAll(/ id="([^"]+)"/g)].map((m) => m[1]);
    expect(ids(first).length).toBeGreaterThan(0);
    expect(ids(first).filter((id) => ids(second).includes(id))).toEqual([]);
    expect(mount(element(500), text, { ...options, idPrefix: 'own' }).result!.svg).toContain('id="own-title"');
  });

  it('keeps the text it had when other text cannot be drawn', () => {
    const own = { ...options, idPrefix: 'own' };
    const el = element(1000);
    const handle = mount(el, SANKEY, own);
    handle.update('flowchart LR\n  A -->');
    resize(el, 340);
    expect(handle.result?.width).toBe(320);
    expect(el.innerHTML).toBe(render(SANKEY, { ...own, maxWidth: 320 }).svg);
    // The error stays with its text, however often that text is given.
    handle.update('flowchart LR\n  A -->');
    expect(handle.error).toBeInstanceOf(PeleError);
    handle.update(SANKEY);
    expect(handle.error).toBeUndefined();
  });

  it('lets the new drawing stand when it is the host\'s onRender that throws', () => {
    const el = element(1000);
    let fail = false;
    const handle = mount(el, SANKEY, {
      ...options,
      onRender: () => {
        if (fail) throw new Error('host');
      },
    });
    fail = true;
    expect(() => handle.update(FLOW)).toThrow('host');
    fail = false;
    expect(handle.result.type).toBe('flowchart');
    expect(el.innerHTML).toBe(handle.result.svg);
    handle.refresh();
    expect(handle.result.type).toBe('flowchart');
    resize(el, 340);
    expect(handle.result.type).toBe('flowchart');
    expect(el.innerHTML).toBe(handle.result.svg);
  });

  it('measures with the fonts of the window an element was moved to when refreshed, and observes it from there', () => {
    const makeWindow = (fontFamily: string) => {
      const view = {
        getComputedStyle: () => ({ fontFamily, paddingLeft: '0px', paddingRight: '0px', getPropertyValue: () => '' }),
        ResizeObserver: globals.ResizeObserver,
        requestAnimationFrame: globals.requestAnimationFrame,
        cancelAnimationFrame: globals.cancelAnimationFrame,
      };
      return { defaultView: view, fonts: fontSet().fonts };
    };
    const first = makeWindow('Georgia');
    const second = makeWindow('Inter');
    const el = { clientWidth: 500, innerHTML: '', firstElementChild: null, isConnected: true, ownerDocument: first, addEventListener() {}, removeEventListener() {} };
    const seen: string[] = [];
    mountWith(spying((o) => seen.push(o.fontFamily ?? '')), el as unknown as HTMLElement, FLOW);
    expect([...new Set(seen)]).toEqual(['Georgia']);
    expect(observers.map((observer) => observer.connected)).toEqual([true]);
    el.ownerDocument = second;
    seen.length = 0;
    observers[0].fire();
    paint();
    expect([...new Set(seen)]).toEqual(['Inter']);
    expect(observers.map((observer) => observer.connected)).toEqual([false, true]);
  });

  it('parses the text once, however often it is drawn', () => {
    let parses = 0;
    let draws = 0;
    const el = element(1000);
    const handle = mountWith(spying(() => draws++, () => parses++), el, SANKEY);
    resize(el, 420);
    resize(el, 340);
    handle.update(SANKEY);
    expect(draws).toBeGreaterThan(4);
    expect(parses).toBe(1);
    handle.update(SANKEY, { maxEdges: 10 });
    handle.update(FLOW);
    expect(parses).toBe(3);
  });

  it('draws again on refresh only when the width or the fonts have changed', () => {
    const el = element(1000);
    const seen: string[] = [];
    const handle = mountWith(spying((o) => seen.push(o.fontFamily ?? '')), el, SANKEY);
    expect(observers.length).toBe(1);
    seen.length = 0;
    handle.refresh();
    expect(seen).toEqual([]);

    (el as unknown as { clientWidth: number }).clientWidth = 340;
    handle.refresh();
    expect(handle.result.width).toBe(320);

    globals.getComputedStyle = () => ({ fontFamily: 'Inter', paddingLeft: '0px', paddingRight: '0px', getPropertyValue: () => '' });
    seen.length = 0;
    handle.refresh();
    expect([...new Set(seen)]).toEqual(['Inter']);
    seen.length = 0;
    handle.refresh();
    expect(seen).toEqual([]);
  });

  it('leaves a hidden diagram alone, and draws what it missed when it is shown', () => {
    const el = element(500);
    const seen: string[] = [];
    const handle = mountWith(spying((o) => seen.push(o.fontFamily ?? '')), el, SANKEY);
    resize(el, 0);
    globals.getComputedStyle = () => ({ fontFamily: 'Inter', paddingLeft: '0px', paddingRight: '0px', getPropertyValue: () => '' });
    seen.length = 0;
    handle.refresh();
    handle.update(FLOW);
    expect(seen).toEqual([]);
    expect(handle.result.type).toBe('sankey');
    handle.update('flowchart LR\n  A -->');
    expect(handle.error).toBeInstanceOf(PeleError);
    resize(el, 500);
    expect([...new Set(seen)]).toEqual(['Inter']);
    expect(handle.result.type).toBe('flowchart');
    expect(el.innerHTML).toBe(handle.result.svg);
  });

  it('draws a hidden diagram anew when it is shown after the fonts it was drawn with have loaded', async () => {
    const doc = page();
    const el = doc.element(500);
    const seen: string[] = [];
    doc.fonts.loading();
    mountWith(spying((o) => seen.push(o.fontFamily ?? '')), el, FLOW);
    resize(el, 0);
    seen.length = 0;
    await doc.fonts.loaded();
    resize(el, 0);
    expect(seen).toEqual([]);
    resize(el, 500);
    expect(seen.length).toBeGreaterThan(0);
    seen.length = 0;
    resize(el, 500);
    expect(seen).toEqual([]);
  });

  it('reports a drawing that was put off and then fails, and keeps what was shown', () => {
    const el = element(500);
    const errors: unknown[] = [];
    const handle = mount(el, SANKEY, { ...options, onError: (error) => errors.push(error) });
    const before = el.innerHTML;
    resize(el, 0);
    // It parses, but a Sankey diagram cannot be drawn with a loop in it.
    const circular = 'sankey\n\nA,B,10\nB,A,10\n';
    expect(() => render(circular, options)).toThrow();
    handle.update(circular);
    expect(errors).toEqual([]);
    resize(el, 500);
    expect(errors.length).toBe(1);
    expect(el.innerHTML).toBe(before);
    expect(handle.result.type).toBe('sankey');
    resize(el, 500);
    expect(errors.length).toBe(1);
  });

  it('puts in the element what a host makes of the markup', () => {
    const made: string[] = [];
    const children: unknown[] = [];
    const el = { ...element(500), replaceChildren: (...nodes: unknown[]) => children.splice(0, children.length, ...nodes) } as unknown as HTMLElement;
    const handle = mount(el, SANKEY, {
      ...options,
      sanitize: (svg) => {
        made.push(svg);
        return { node: made.length } as unknown as Node;
      },
    });
    expect(made).toEqual([handle.result.svg]);
    expect(children).toEqual([{ node: 1 }]);
    expect(el.innerHTML).toBe('');
    resize(el, 340);
    expect(made[1]).toBe(handle.result.svg);
    expect(children).toEqual([{ node: 2 }]);
  });

  it('keeps the first drawing, and reports it, when the host fails on the one for the drawing\'s fonts', () => {
    // The drawing sets --pele-font, so it is drawn a second time, which the sanitizer refuses.
    const child = {};
    let made = 0;
    const el = {
      ...element(500),
      firstElementChild: null as object | null,
      put: '',
      replaceChildren(node: { svg: string }) {
        this.put = node.svg;
        this.firstElementChild = child;
      },
    };
    globals.getComputedStyle = (target: unknown) => ({
      fontFamily: target === child ? 'Inter' : 'Georgia',
      paddingLeft: '0px',
      paddingRight: '0px',
      getPropertyValue: (name: string) => (target === child && name === '--pele-font' ? 'Inter' : ''),
    });
    const reported: RenderResult[] = [];
    const handle = mount(el as unknown as HTMLElement, FLOW, {
      ...options,
      onRender: (result) => reported.push(result),
      sanitize: (svg) => {
        if (++made > 1) throw new Error('sanitizer');
        return { svg } as unknown as Node;
      },
    });
    expect(made).toBe(2);
    expect(handle.result.svg).toBe(el.put);
    expect(reported.map((result) => result.svg)).toEqual([el.put]);
  });

  it('stops the diagram an element had when another is mounted in it', async () => {
    const doc = page();
    const el = doc.element(500);
    doc.fonts.loading();
    let first = 0;
    let second = 0;
    mountWith(spying(() => first++), el, FLOW);
    mountWith(spying(() => second++), el, SANKEY);
    first = 0;
    await doc.fonts.loaded();
    resize(el, 340);
    expect(first).toBe(0);
    expect(second).toBeGreaterThan(0);
  });
});
