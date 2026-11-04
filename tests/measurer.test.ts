import { describe, expect, it } from 'vitest';
import { metricsMeasurer, Style } from '../src/text/measurer.js';

describe('metricsMeasurer emoji', () => {
  it('measures common emoji at about the width color emoji fonts draw them', () => {
    // #124: ✅ measured 0.58em and 🚀 1em without a canvas, so boxes
    // around emoji came out too tight and text ran past the edges.
    for (const text of ['✅', '🚀', '⚠️', '⏳']) {
      expect(metricsMeasurer.width(text, 16, 0)).toBeCloseTo(16 * 1.29);
    }
  });

  it('does not count the variation selector after an emoji', () => {
    expect(metricsMeasurer.width('⚠️', 16, 0)).toBe(metricsMeasurer.width('⚠', 16, 0));
  });

  it('leaves wide scripts and the mono grid unchanged', () => {
    expect(metricsMeasurer.width('中', 16, 0)).toBe(16);
    expect(metricsMeasurer.width('✅', 16, Style.Mono)).toBe(16 * 1.2);
  });
});
