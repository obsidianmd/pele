import { describe, expect, it } from 'vitest';
import { render } from '../../src/index.js';
import { layoutLabel } from '../../src/text/label.js';
import { metricsMeasurer } from '../../src/text/measurer.js';

const lines = (raw: string, max: number): string[] =>
  layoutLabel(raw, false, metricsMeasurer, 16, max).lines.map(line => line.map(span => span.text).join(''));

const ZWSP = '\u200b';
const SHY = '\u00ad';

describe('break hints', () => {
  it('breaks at zero-width spaces instead of keeping the token whole', () => {
    const out = lines(`RRCConnection${ZWSP}Reconfiguration${ZWSP}Complete`, 140);
    expect(out.map(line => line.replace(ZWSP, ''))).toEqual(['RRCConnection', 'Reconfiguration', 'Complete']);
  });

  it('shows a soft hyphen as a hyphen only where the line breaks', () => {
    const source = `RRCConnection${SHY}Reconfiguration${SHY}Complete`;
    expect(lines(source, 140)).toEqual(['RRCConnection-', 'Reconfiguration-', 'Complete']);
    for (const width of layoutLabel(source, false, metricsMeasurer, 16, 140).widths) expect(width).toBeLessThanOrEqual(140);
    expect(lines(`Re${SHY}con${SHY}fig`, 200)).toEqual([`Re${SHY}con${SHY}fig`]);
  });

  it('keeps a soft-hyphenated word on the line when the rest of it fits there', () => {
    expect(lines(`a uni${SHY}t test`, 39.2)).toEqual([`a uni${SHY}t`, 'test']);
  });

  it('keeps every line within the width when a word has several soft hyphens', () => {
    const label = layoutLabel(`a uni${SHY}t${SHY}ed`, false, metricsMeasurer, 16, 39.2);
    for (const width of label.widths) expect(width).toBeLessThanOrEqual(39.2);
  });

  it('keeps a line within the width when a soft-hyphenated word goes on in bold', () => {
    const label = layoutLabel(`a uni${SHY}<b>t</b> test`, false, metricsMeasurer, 16, 39.2);
    for (const width of label.widths) expect(width).toBeLessThanOrEqual(39.2);
  });

  it('wraps many pieces without width in linear time', () => {
    for (const hint of [SHY, ZWSP]) {
      const start = performance.now();
      layoutLabel('a'.repeat(22) + `\u0300${hint}`.repeat(24000) + 'i xx', false, metricsMeasurer, 16, 200);
      expect(performance.now() - start).toBeLessThan(1000);
    }
  });

  it('breaks at a space after a soft hyphen without showing the hyphen', () => {
    const label = layoutLabel(`a uni${SHY} t test`, false, metricsMeasurer, 16, 39.2);
    for (const width of label.widths) expect(width).toBeLessThanOrEqual(39.2);
    expect(lines(`a uni${SHY} t test`, 39.2).join(' ')).not.toContain('-');
  });

  it('shows no hyphen where a line breaks at a space in the next styled span', () => {
    expect(lines(`ab${SHY}<i> cd</i>`, 25)).toEqual([`ab${SHY}`, 'cd']);
  });

  it('reads &shy; as a soft hyphen', () => {
    expect(lines('RRCConnection&shy;Reconfiguration&shy;Complete', 140)).toEqual(['RRCConnection-', 'Reconfiguration-', 'Complete']);
  });

  it('gives soft hyphens no width when they do not break', () => {
    expect(metricsMeasurer.width(`ab${SHY}c`, 16, 0)).toBe(metricsMeasurer.width('abc', 16, 0));
  });

  it('splits a hinted sequence message at the hints on a narrow screen', () => {
    const source = `sequenceDiagram\n  participant UE\n  participant gNB\n  participant AMF\n  gNB->>UE: RRCConnection${ZWSP}Reconfiguration${ZWSP}Complete\n  UE->>gNB: ok`;
    const svg = render(source, { maxWidth: 360, measurer: metricsMeasurer }).svg;
    const label = [...svg.matchAll(/<tspan\b[^>]*>([^<]*)<\/tspan>/g)].map(m => m[1].replace(ZWSP, ''));
    expect(label).toEqual(['RRCConnection', 'Reconfiguration', 'Complete']);
  });
});
