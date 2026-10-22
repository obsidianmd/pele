import { windowOf } from './window.js';

export interface ZoomOptions {
  // Whether a drawing that fits its element can be enlarged as well. By default only one that
  // was shrunk to fit can be.
  always?: boolean;
  // The most a drawing is enlarged, as a multiple of its natural size. 3 by default.
  maxScale?: number;
  // Whether buttons to enlarge and reduce are shown over a drawing that can be enlarged, and
  // one to reset it while it is. They are by default.
  controls?: boolean;
  // What the buttons are called, for a page that is not in English.
  labels?: { zoomIn?: string; zoomOut?: string; reset?: string };
}

export interface Zoom {
  // How large the drawing is shown: 1 is its natural size.
  readonly scale: number;
  // The scale at which all of it shows, which is where it rests.
  readonly fit: number;
  zoomBy(factor: number): void;
  zoomTo(scale: number): void;
  reset(): void;
  // Starts over with the drawing the element holds now.
  refresh(): void;
  destroy(): void;
}

export interface Frame {
  // The part of the drawing its box shows.
  x: number;
  y: number;
  width: number;
  height: number;
}

// The part of a drawing that shows in a box at a scale. Enlarging a drawing never changes the
// size of anything around it: the box shows less of the drawing, larger.
export function frame(
  natural: { width: number; height: number },
  box: { width: number; height: number },
  scale: number,
  x: number,
  y: number
): Frame {
  const width = box.width / scale;
  const height = box.height / scale;
  // A drawing larger than the view stops at its own edges. A smaller one stays whole inside it.
  const within = (at: number, view: number, whole: number): number =>
    view >= whole ? Math.min(Math.max(at, whole - view), 0) : Math.min(Math.max(at, 0), whole - view);
  return { x: within(x, width, natural.width), y: within(y, height, natural.height), width, height };
}

const STEP = 1.25;
const PAN = 48;

// The class `pele` lets a page's rule for `.pele` give the buttons the diagram's colors, and the
// variables let it move them: they sit over the diagram, where a page may have things of its own.
const BAR_STYLE =
  '--_bg:var(--pele-bg,#fff);--_fg:var(--pele-fg,#1f1f1f);--_b:var(--pele-border,#8a8a8a);' +
  'position:absolute;top:var(--pele-zoom-top,8px);right:var(--pele-zoom-right,8px);' +
  'bottom:var(--pele-zoom-bottom,auto);left:var(--pele-zoom-left,auto);display:flex;flex-direction:column;gap:2px;padding:2px;' +
  'width:auto;max-width:none;border:1px solid var(--_b);border-radius:var(--pele-radius,4px);background:var(--_bg);color:var(--_fg);line-height:0';
const BUTTON_STYLE =
  'appearance:none;display:grid;place-items:center;width:24px;height:24px;margin:0;padding:0;border:0;' +
  'border-radius:calc(var(--pele-radius,4px) - 1px);background:transparent;color:inherit;font:inherit;cursor:pointer';
const ICONS = {
  zoomIn: 'M5 12h14M12 5v14',
  zoomOut: 'M5 12h14',
  // Lucide's rotate-ccw. Its license is in the LICENSE file.
  reset: 'M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8M3 3v5h5',
};
const LABELS = { zoomIn: 'Zoom in', zoomOut: 'Zoom out', reset: 'Reset zoom' };

// Lets the drawing in an element be enlarged and moved about inside its own box: by pinching,
// by the wheel with Ctrl or ⌘ held, by dragging, by a double click, and from the keyboard.
export function enableZoom(element: HTMLElement, options: ZoomOptions = {}): Zoom {
  return zoomWith(element, options, true);
}

export function zoomWith(element: HTMLElement, options: ZoomOptions, observe: boolean): Zoom & { resized(): void } {
  let svg: SVGSVGElement | null = null;
  let natural = { width: 0, height: 0 };
  let rest = { width: 0, height: 0 };
  // The box an enlarged drawing is shown in: the room its element already has, padding and
  // all, where that is more than the drawing takes at rest, as in a panel of a fixed height.
  let box = { width: 0, height: 0 };
  let roomy = false;
  let bleed = '';
  let restStyle = { width: '', height: '', maxWidth: '', margin: '', display: '' };
  // The scale shown, or 0 while the drawing rests at the size that fits.
  let scale = 0;
  let x = 0;
  let y = 0;
  let watched = 0;

  const view = (): typeof globalThis => windowOf(element);
  const fit = (): number => (natural.width > 0 && rest.width > 0 ? rest.width / natural.width : 1);
  const most = (): number => Math.max(fit(), options.maxScale ?? 3);
  const zoomable = (): boolean => svg !== null && natural.width > 0 && (options.always === true || fit() < 0.999);

  const measure = (): void => {
    if (!svg || scale !== 0) return;
    const at = svg.getBoundingClientRect();
    rest = { width: at.width, height: at.height };
    box = { width: Math.max(rest.width, element.clientWidth), height: Math.max(rest.height, element.clientHeight) };
    roomy = box.width > rest.width + 1 || box.height > rest.height + 1;
    if (!roomy) box = rest;
    // Padding keeps a drawing at rest off the element's edges. An enlarged one is a view, which
    // reaches them: margins of the opposite size carry it over the padding.
    const style = view().getComputedStyle(element);
    bleed = ['Top', 'Right', 'Bottom', 'Left']
      .map((side) => `${-(parseFloat(style.getPropertyValue(`padding-${side.toLowerCase()}`)) || 0)}px`)
      .join(' ');
  };

  let bar: HTMLElement | undefined;
  const buttons: Partial<Record<keyof typeof ICONS, HTMLButtonElement>> = {};
  let positioned = false;

  const offer = (): void => {
    if (options.controls === false) return;
    const can = zoomable();
    if (!bar) {
      if (!can) return;
      const doc = element.ownerDocument;
      bar = doc.createElement('div');
      bar.className = 'pele pele-zoom';
      bar.setAttribute('style', BAR_STYLE);
      const act = { zoomIn: () => show((scale || fit()) * STEP * STEP), zoomOut: () => show((scale || fit()) / (STEP * STEP)), reset: () => settle() };
      for (const name of ['zoomIn', 'zoomOut', 'reset'] as const) {
        const button = doc.createElement('button');
        const label = options.labels?.[name] ?? LABELS[name];
        button.type = 'button';
        button.className = `pele-zoom-${name === 'zoomIn' ? 'in' : name === 'zoomOut' ? 'out' : 'reset'}`;
        button.setAttribute('style', BUTTON_STYLE);
        button.setAttribute('aria-label', label);
        button.title = label;
        button.innerHTML = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="${ICONS[name]}"/></svg>`;
        button.addEventListener('click', act[name]);
        buttons[name] = button;
        bar.append(button);
      }
    }
    // The buttons are placed against the element, which has to be what they are measured from.
    if (can && !positioned && view().getComputedStyle(element).position === 'static') {
      element.style.position = 'relative';
      positioned = true;
    }
    if (can && bar.parentNode !== element) element.append(bar);
    bar.hidden = !can;
    bar.style.display = can ? 'flex' : 'none';
    const dim = (button: HTMLButtonElement | undefined, off: boolean): void => {
      if (!button) return;
      button.disabled = off;
      button.style.opacity = off ? '0.35' : '';
      button.style.cursor = off ? 'default' : 'pointer';
    };
    dim(buttons.zoomIn, (scale || fit()) >= most() * 0.999);
    dim(buttons.zoomOut, scale === 0);
    if (buttons.reset) buttons.reset.style.display = scale === 0 ? 'none' : 'grid';
  };
  const ours = (event: Event): boolean => bar !== undefined && event.target instanceof view().Node && bar.contains(event.target as Node);

  const settle = (): void => {
    if (!svg) return;
    scale = 0;
    svg.setAttribute('viewBox', `0 0 ${natural.width} ${natural.height}`);
    svg.style.width = restStyle.width;
    svg.style.height = restStyle.height;
    svg.style.maxWidth = restStyle.maxWidth;
    svg.style.margin = restStyle.margin;
    svg.style.display = restStyle.display;
    svg.style.cursor = '';
    svg.style.userSelect = '';
    measure();
    // One finger still scrolls the page. Two are left to the drawing.
    svg.style.touchAction = zoomable() ? 'pan-y' : '';
    if (zoomable()) svg.setAttribute('tabindex', '0');
    else svg.removeAttribute('tabindex');
    take(zoomable());
    offer();
  };

  // Shows the drawing at a scale, keeping the point under (clientX, clientY) where it is.
  const show = (next: number, clientX?: number, clientY?: number): void => {
    if (!svg) return;
    if (scale === 0) measure();
    if (!zoomable()) return;
    const from = scale || fit();
    const to = Math.min(Math.max(next, fit()), most());
    if (to <= fit() * 1.001) {
      settle();
      return;
    }
    const before = svg.getBoundingClientRect();
    const atX = clientX ?? before.left + before.width / 2;
    const atY = clientY ?? before.top + before.height / 2;
    const pointX = (scale ? x : 0) + (atX - before.left) / from;
    const pointY = (scale ? y : 0) + (atY - before.top) / from;
    scale = to;
    let after = before;
    if (roomy) {
      svg.style.maxWidth = 'none';
      svg.style.margin = bleed;
      // An inline drawing sits on a line of text, with room under it for descenders. That room
      // is part of the box, so left in place it would make the element taller.
      svg.style.display = 'block';
      svg.style.width = `${box.width}px`;
      svg.style.height = `${box.height}px`;
      after = svg.getBoundingClientRect();
    }
    place(pointX - (atX - after.left) / scale, pointY - (atY - after.top) / scale);
    svg.style.cursor = 'grab';
    svg.style.userSelect = 'none';
    svg.style.touchAction = 'none';
    offer();
  };

  const place = (toX: number, toY: number): void => {
    if (!svg) return;
    const shown = frame(natural, box, scale, toX, toY);
    x = shown.x;
    y = shown.y;
    svg.setAttribute('viewBox', `${x} ${y} ${shown.width} ${shown.height}`);
  };

  const move = (dx: number, dy: number): void => {
    if (scale !== 0) place(x - dx / scale, y - dy / scale);
  };

  const resized = (): void => {
    watch();
    const size = element.clientWidth + element.clientHeight;
    if (size === watched) return;
    watched = size;
    settle();
  };
  let observer: ResizeObserver | undefined;
  let observed: typeof globalThis | undefined;
  const watch = (): void => {
    if (!observe) return;
    const next = view();
    if (next === observed) return;
    observer?.disconnect();
    observed = next;
    observer = next.ResizeObserver ? new next.ResizeObserver(resized) : undefined;
    observer?.observe(element);
  };

  const refresh = (): void => {
    watch();
    const first = element.firstElementChild;
    svg = first && first.localName === 'svg' ? (first as SVGSVGElement) : null;
    scale = 0;
    if (!svg) {
      bar?.remove();
      take(false);
      return;
    }
    natural = { width: Number(svg.getAttribute('width')) || 0, height: Number(svg.getAttribute('height')) || 0 };
    restStyle = { width: svg.style.width, height: svg.style.height, maxWidth: svg.style.maxWidth, margin: svg.style.margin, display: svg.style.display };
    settle();
  };

  const pointers = new Map<number, { x: number; y: number }>();
  let dragged = false;
  let travelled = 0;
  let pinch = 0;

  const spread = (): { distance: number; x: number; y: number } => {
    const [a, b] = [...pointers.values()];
    return { distance: Math.hypot(a.x - b.x, a.y - b.y), x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
  };

  const onPointerDown = (event: PointerEvent): void => {
    // A pinch, or a touch drag too long for a tap, ends without a click, so the last drag ends
    // when the next press begins.
    dragged = false;
    if (!zoomable() || ours(event) || (event.pointerType === 'mouse' && event.button !== 0)) return;
    pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
    travelled = 0;
    if (pointers.size === 2) pinch = spread().distance;
    if (pointers.size === 2 || scale !== 0) {
      element.setPointerCapture?.(event.pointerId);
      if (svg) svg.style.cursor = 'grabbing';
    }
  };

  const onPointerMove = (event: PointerEvent): void => {
    const last = pointers.get(event.pointerId);
    if (!last) return;
    if (pointers.size === 2) {
      const before = spread();
      pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
      const now = spread();
      if (pinch > 0 && now.distance > 0) show((scale || fit()) * (now.distance / before.distance), now.x, now.y);
      move(now.x - before.x, now.y - before.y);
      dragged = true;
      return;
    }
    pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
    if (scale === 0) return;
    travelled += Math.abs(event.clientX - last.x) + Math.abs(event.clientY - last.y);
    if (travelled > 4) dragged = true;
    move(event.clientX - last.x, event.clientY - last.y);
  };

  const onPointerUp = (event: PointerEvent): void => {
    if (!pointers.delete(event.pointerId)) return;
    pinch = 0;
    if (pointers.size === 0 && svg && scale !== 0) svg.style.cursor = 'grab';
  };

  // A drag that ends over a link is not a click on it. A click from the keyboard, of `detail` 0,
  // ends no drag.
  const onClick = (event: MouseEvent): void => {
    if (!dragged || event.detail === 0) return;
    dragged = false;
    event.preventDefault();
    event.stopPropagation();
  };

  const onWheel = (event: WheelEvent): void => {
    // Without the key, the wheel is the page's. With it, the browser would zoom the whole page.
    if (!(event.ctrlKey || event.metaKey) || !zoomable()) return;
    event.preventDefault();
    if (scale === 0) measure();
    // A notch of a mouse wheel is a hundred or more. A pinch on a trackpad sends many small ones.
    const turn = Math.min(Math.max(-event.deltaY, -24), 24);
    show((scale || fit()) * 2 ** (turn * 0.02), event.clientX, event.clientY);
  };

  const onDoubleClick = (event: MouseEvent): void => {
    if (!zoomable() || ours(event)) return;
    event.preventDefault();
    if (scale !== 0) settle();
    else show(Math.max(1, fit() * 2), event.clientX, event.clientY);
  };

  const onKeyDown = (event: KeyboardEvent): void => {
    if (!zoomable() || ours(event) || event.ctrlKey || event.metaKey || event.altKey) return;
    const key = event.key;
    if (key === '+' || key === '=') show((scale || fit()) * STEP);
    else if (key === '-') show((scale || fit()) / STEP);
    else if (scale === 0) return;
    else if (key === '0' || key === 'Escape') settle();
    else if (key === 'ArrowLeft') move(PAN, 0);
    else if (key === 'ArrowRight') move(-PAN, 0);
    else if (key === 'ArrowUp') move(0, PAN);
    else if (key === 'ArrowDown') move(0, -PAN);
    else return;
    event.preventDefault();
  };

  // Browsers ring a focused SVG after a click too, where an HTML element is only ringed when
  // the focus came from the keyboard. The drawing is treated as HTML is. Safari before 15.4 does
  // not know :focus-visible and throws, and there the ring stays.
  const onFocus = (event: Event): void => {
    if (!svg || event.target !== svg) return;
    let visible = true;
    try {
      visible = svg.matches(':focus-visible');
    } catch {
    }
    svg.style.outline = visible ? '' : 'none';
  };

  // Safari on a Mac reports a trackpad pinch this way and no other.
  let gesture = 0;
  const onGestureStart = (event: Event): void => {
    if (!zoomable()) return;
    event.preventDefault();
    if (scale === 0) measure();
    gesture = scale || fit();
  };
  const onGestureChange = (event: Event): void => {
    if (gesture === 0) return;
    event.preventDefault();
    const { scale: by, clientX, clientY } = event as Event & { scale: number; clientX: number; clientY: number };
    show(gesture * by, clientX, clientY);
  };
  const onGestureEnd = (): void => {
    gesture = 0;
  };

  const listeners: [string, EventListener, AddEventListenerOptions?][] = [
    ['pointerdown', onPointerDown as EventListener],
    ['pointermove', onPointerMove as EventListener],
    ['pointerup', onPointerUp as EventListener],
    ['pointercancel', onPointerUp as EventListener],
    ['click', onClick as EventListener, { capture: true }],
    ['dblclick', onDoubleClick as EventListener],
    ['keydown', onKeyDown as EventListener],
    ['focusin', onFocus],
  ];
  for (const [type, listener, how] of listeners) element.addEventListener(type, listener, how);
  // Taken only while the drawing can be enlarged. A wheel listener that may stop the wheel makes
  // the browser wait for the page's script before it scrolls, so a drawing that fits adds none.
  const gestures: [string, EventListener, AddEventListenerOptions][] = [
    ['wheel', onWheel as EventListener, { passive: false }],
    ['gesturestart', onGestureStart, { passive: false }],
    ['gesturechange', onGestureChange, { passive: false }],
    ['gestureend', onGestureEnd, { passive: false }],
  ];
  let taking = false;
  function take(on: boolean): void {
    if (on === taking) return;
    taking = on;
    for (const [type, listener, how] of gestures) {
      if (on) element.addEventListener(type, listener, how);
      else element.removeEventListener(type, listener, how);
    }
    if (!on) gesture = 0;
  }

  watched = element.clientWidth + element.clientHeight;
  refresh();

  return {
    get scale() {
      return scale || fit();
    },
    get fit() {
      return fit();
    },
    zoomBy(factor) {
      show((scale || fit()) * factor);
    },
    zoomTo(next) {
      show(next);
    },
    reset: settle,
    refresh,
    resized,
    destroy() {
      settle();
      if (svg) {
        svg.style.touchAction = '';
        svg.removeAttribute('tabindex');
      }
      bar?.remove();
      if (positioned) element.style.position = '';
      observer?.disconnect();
      take(false);
      for (const [type, listener, how] of listeners) element.removeEventListener(type, listener, how);
    },
  };
}
