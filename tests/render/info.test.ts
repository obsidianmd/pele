import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { parse, render, supports } from '../../src/index.js';
import { metricsMeasurer } from '../../src/text/measurer.js';

const options = { measurer: metricsMeasurer };
const { version } = JSON.parse(readFileSync('package.json', 'utf8')) as { version: string };

describe('info rendering', () => {
  it("draws Pele's version", () => {
    const { svg, type, width, height } = render('info', options);
    expect(type).toBe('info');
    expect(supports('info showInfo')).toBe(true);
    expect(svg).toContain(`>Pele v${version}<`);
    expect(svg).toContain('class="pele-version"');
    expect(width).toBeLessThan(200);
    expect(height).toBeLessThan(60);
  });

  it('draws the same with and without showInfo', () => {
    expect(render('info\nshowInfo\n', options).svg).toBe(render('info', options).svg);
  });

  it('draws a title from the diagram or the front matter', () => {
    const titled = render('---\ntitle: From front matter\n---\ninfo', options);
    expect(titled.svg).toContain('>From front matter<');
    expect(titled.height).toBeGreaterThan(render('info', options).height);
    const own = render('---\ntitle: From front matter\n---\ninfo\ntitle Own', options).svg;
    expect(own).toContain('>Own<');
    expect(own).not.toContain('From front matter');
  });

  it('writes accessible names and exposes the model', () => {
    const src = 'info showInfo\naccTitle: Name\naccDescr: Text';
    const { svg } = render(src, options);
    expect(svg).toContain('<title id="pele-title">Name</title>');
    expect(svg).toContain('<desc id="pele-desc">Text</desc>');
    expect(parse(src)).toEqual({ type: 'info', mermaidType: 'info', title: undefined, accTitle: 'Name', accDescr: 'Text' });
  });

  it('rejects anything else after the keyword', () => {
    expect(() => render('info unsupported', options)).toThrow(/Lexical error on line 1/);
    expect(() => render('info\ntitle a\nshowInfo', options)).toThrow(/Parse error on line 3/);
  });
});
