import { afterEach, describe, expect, it } from 'vitest';
import { render } from '../../src/index.js';
import { canvasMeasurer } from '../../src/text/measurer.js';

const globals = globalThis as Record<string, unknown>;

const page = () => {
  const state = { loaded: false, measured: 0, faces: 1 };
  globals.OffscreenCanvas = class {
    getContext() {
      return {
        font: '',
        measureText: (text: string) => {
          state.measured++;
          return { width: text.length * (state.loaded ? 10 : 8) };
        },
      };
    }
  };
  globals.document = {
    fonts: {
      check: () => state.loaded,
      get size() {
        return state.faces;
      },
    },
  };
  return state;
};

afterEach(() => {
  delete globals.OffscreenCanvas;
  delete globals.document;
});

describe('canvasMeasurer', () => {
  it('keeps widths only once their font has loaded', () => {
    const state = page();
    const measurer = canvasMeasurer('Web')!;
    expect(measurer.width('abc', 16, 0)).toBe(24);
    state.loaded = true;
    expect(measurer.width('abc', 16, 0)).toBe(30);
    const measured = state.measured;
    expect(measurer.width('abc', 16, 0)).toBe(30);
    expect(state.measured).toBe(measured);
  });

  it('measures again once a font is added', () => {
    const state = page();
    // A font that is not in the document is not loading, and the canvas draws with a fallback.
    state.loaded = true;
    const measurer = canvasMeasurer('Web')!;
    measurer.width('abc', 16, 0);
    state.faces++;
    const measured = state.measured;
    measurer.width('abc', 16, 0);
    expect(state.measured).toBe(measured + 1);
  });

  it('keeps widths when the fonts cannot be checked', () => {
    const state = page();
    globals.document = { fonts: { check: () => { throw new SyntaxError('Could not parse'); } } };
    const measurer = canvasMeasurer('Web')!;
    measurer.width('abc', 16, 0);
    measurer.width('abc', 16, 0);
    expect(state.measured).toBe(1);
  });

  it('measures code in the monospace font a diagram is given', () => {
    const fonts = new Set<string>();
    globals.OffscreenCanvas = class {
      getContext() {
        return {
          set font(value: string) {
            fonts.add(value);
          },
          measureText: (text: string) => ({ width: text.length * 8 }),
        };
      }
    };
    render('flowchart LR\n  A["Call <code>render()</code> once"]', { fontFamily: 'Label Sans', fontFamilyMono: 'Code Mono' });
    expect([...fonts].some((font) => font.endsWith('px Code Mono'))).toBe(true);
    expect([...fonts].some((font) => font.endsWith('px monospace'))).toBe(false);
  });
});
