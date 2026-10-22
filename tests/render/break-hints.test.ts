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
