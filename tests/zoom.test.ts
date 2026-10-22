import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { enableZoom, frame } from '../src/zoom.js';

// A drawing 1200 by 300, shrunk to fit a box 400 wide.
const natural = { width: 1200, height: 300 };
const box = { width: 400, height: 100 };

describe('zoom frame', () => {
  it('shows the whole drawing at the scale that fits', () => {
    expect(frame(natural, box, 400 / 1200, 0, 0)).toEqual({ x: 0, y: 0, width: 1200, height: 300 });
  });

  it('shows less of the drawing, in the same proportions, as the scale grows', () => {
    for (const scale of [0.5, 1, 2, 3]) {
      const shown = frame(natural, box, scale, 0, 0);
      expect(shown.width, String(scale)).toBeCloseTo(400 / scale);
      expect(shown.height, String(scale)).toBeCloseTo(100 / scale);
      expect(shown.width / shown.height, String(scale)).toBeCloseTo(4);
    }
  });

  it('keeps the view inside the drawing', () => {
    const before = frame(natural, box, 1, -50, -50);
    expect([before.x, before.y]).toEqual([0, 0]);
    const past = frame(natural, box, 1, 5000, 5000);
    expect([past.x, past.y]).toEqual([1200 - 400, 300 - 100]);
    const inside = frame(natural, box, 2, 300, 120);
    expect([inside.x, inside.y]).toEqual([300, 120]);
  });

  it('keeps a drawing that is smaller than the view whole inside it', () => {
    // A panel larger than the drawing at this scale, as in a playground of a fixed height.
    const small = { width: 100, height: 50 };
    const panel = { width: 400, height: 300 };
    const shown = frame(small, panel, 2, 30, 10);
    expect([shown.width, shown.height]).toEqual([200, 150]);
    // It cannot be pushed out of view on either side.
    expect(shown.x).toBe(0);
    expect(shown.y).toBe(0);
    const pulled = frame(small, panel, 2, -500, -500);
    expect([pulled.x, pulled.y]).toEqual([100 - 200, 50 - 150]);
    // Where it rests inside the panel is kept: a point between the two ends is left alone.
    const resting = frame(small, panel, 2, -40, -60);
    expect([resting.x, resting.y]).toEqual([-40, -60]);
  });
});

const drawingIn = (shown: number) => {
  const listening = new Map<string, number>();
  const handlers = new Map<string, (event: unknown) => void>();
  const attributes: Record<string, string> = { width: '1200', height: '300' };
  const svg = {
    localName: 'svg',
    style: {},
    getAttribute: (name: string) => attributes[name] ?? null,
    setAttribute: (name: string, value: string) => (attributes[name] = value),
    removeAttribute: (name: string) => delete attributes[name],
    getBoundingClientRect: () => ({ left: 0, top: 0, width: shown, height: shown / 4 }),
    matches: (_selector: string): boolean => false,
  };
  const count = (type: string, by: number) => listening.set(type, (listening.get(type) ?? 0) + by);
  const element = {
    firstElementChild: svg,
    clientWidth: shown,
    clientHeight: shown / 4,
    style: {},
    addEventListener: (type: string, handler: (event: unknown) => void) => {
      count(type, 1);
      handlers.set(type, handler);
    },
    removeEventListener: (type: string) => count(type, -1),
  };
  return {
    element: element as unknown as HTMLElement,
    svg,
    listening: (type: string) => listening.get(type) ?? 0,
    fire: (type: string, event: unknown) => handlers.get(type)?.(event),
    show: (width: number) => {
      shown = width;
      element.clientWidth = width;
      element.clientHeight = width / 4;
    },
  };
};

describe('zoom', () => {
  const globals = globalThis as Record<string, unknown>;
  beforeEach(() => {
    globals.getComputedStyle = () => ({ position: 'relative', getPropertyValue: () => '0px' });
  });
  afterEach(() => {
    delete globals.getComputedStyle;
    delete globals.Node;
  });

  it('takes the wheel only while the drawing can be enlarged', () => {
    const fits = drawingIn(1200);
    enableZoom(fits.element, { controls: false });
    expect(fits.listening('wheel')).toBe(0);
    expect(fits.listening('gesturestart')).toBe(0);
    expect(fits.listening('pointerdown')).toBe(1);

    const shrunk = drawingIn(400);
    const zoom = enableZoom(shrunk.element, { controls: false });
    expect(shrunk.listening('wheel')).toBe(1);
    expect(shrunk.listening('gesturestart')).toBe(1);
    shrunk.show(1200);
    zoom.refresh();
    expect(shrunk.listening('wheel')).toBe(0);
    shrunk.show(400);
    zoom.refresh();
    expect(shrunk.listening('wheel')).toBe(1);
    zoom.destroy();
    expect(shrunk.listening('wheel')).toBe(0);
    expect(shrunk.listening('pointerdown')).toBe(0);
  });

  it('rings a drawing focused from the keyboard, and keeps the ring where :focus-visible is not known', () => {
    const shrunk = drawingIn(400);
    enableZoom(shrunk.element, { controls: false });
    const style = shrunk.svg.style as { outline?: string };
    shrunk.fire('focusin', { target: shrunk.svg });
    expect(style.outline).toBe('none');
    shrunk.svg.matches = () => true;
    shrunk.fire('focusin', { target: shrunk.svg });
    expect(style.outline).toBe('');
    shrunk.svg.style = {};
    shrunk.svg.matches = () => {
      throw new SyntaxError("':focus-visible' is not a valid selector");
    };
    expect(() => shrunk.fire('focusin', { target: shrunk.svg })).not.toThrow();
    expect((shrunk.svg.style as { outline?: string }).outline).toBe('');
  });

  const pinch = (drawing: ReturnType<typeof drawingIn>) => {
    drawing.fire('pointerdown', { pointerId: 1, pointerType: 'touch', clientX: 100, clientY: 50 });
    drawing.fire('pointerdown', { pointerId: 2, pointerType: 'touch', clientX: 140, clientY: 50 });
    drawing.fire('pointermove', { pointerId: 2, clientX: 220, clientY: 50 });
    drawing.fire('pointerup', { pointerId: 1 });
    drawing.fire('pointerup', { pointerId: 2 });
  };
  const tap = (drawing: ReturnType<typeof drawingIn>, target: unknown) => {
    drawing.fire('pointerdown', { pointerId: 3, pointerType: 'touch', target });
    drawing.fire('pointerup', { pointerId: 3 });
  };
  const click = (drawing: ReturnType<typeof drawingIn>, target: { listeners?: Map<string, () => void> }, detail = 1) => {
    const event = { target, detail, defaultPrevented: false, stopped: false, preventDefault: () => (event.defaultPrevented = true), stopPropagation: () => (event.stopped = true) };
    drawing.fire('click', event);
    if (!event.stopped) target.listeners?.get('click')?.();
    return event;
  };

  it('lets the first tap or key after a pinch work a button', () => {
    class Node {
      style: Record<string, string> = {};
      listeners = new Map<string, () => void>();
      children: Node[] = [];
      setAttribute() {}
      addEventListener(type: string, listener: () => void) {
        this.listeners.set(type, listener);
      }
      append(child: Node) {
        this.children.push(child);
      }
      contains(other: unknown): boolean {
        return other === this || this.children.some((child) => child.contains(other));
      }
    }
    globals.Node = Node;
    const shrunk = drawingIn(400);
    let bar = new Node();
    Object.assign(shrunk.element, { ownerDocument: { createElement: () => new Node() }, append: (child: Node) => (bar = child) });
    const zoom = enableZoom(shrunk.element);
    const reset = bar.children[2];

    pinch(shrunk);
    expect(zoom.scale).toBeGreaterThan(zoom.fit);
    tap(shrunk, reset);
    click(shrunk, reset);
    expect(zoom.scale).toBe(zoom.fit);

    pinch(shrunk);
    click(shrunk, reset, 0);
    expect(zoom.scale).toBe(zoom.fit);
  });

  it('stops the click that ends a drag over the drawing, and no click after it', () => {
    const shrunk = drawingIn(400);
    const zoom = enableZoom(shrunk.element, { controls: false });
    const link = {};
    zoom.zoomTo(1);
    shrunk.fire('pointerdown', { pointerId: 1, pointerType: 'mouse', button: 0, clientX: 100, clientY: 50 });
    shrunk.fire('pointermove', { pointerId: 1, clientX: 130, clientY: 50 });
    shrunk.fire('pointerup', { pointerId: 1 });
    const dragged = click(shrunk, link);
    expect([dragged.defaultPrevented, dragged.stopped]).toEqual([true, true]);

    shrunk.fire('pointerdown', { pointerId: 2, pointerType: 'touch', clientX: 100, clientY: 50 });
    shrunk.fire('pointermove', { pointerId: 2, clientX: 130, clientY: 50 });
    shrunk.fire('pointerup', { pointerId: 2 });
    tap(shrunk, link);
    expect(click(shrunk, link).defaultPrevented).toBe(false);
  });
});
