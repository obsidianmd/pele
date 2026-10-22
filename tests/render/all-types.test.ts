import { readFileSync, readdirSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { PeleError, detectType, parse, render } from '../../src/index.js';
import { all } from '../../src/diagrams/registry.js';
import { metricsMeasurer } from '../../src/text/measurer.js';
import { PAYLOADS, assertInert } from '../support/inert.js';

// A gantt chart marks the present, so the time is given: two drawings a moment apart could differ.
const options = { measurer: metricsMeasurer, now: Date.UTC(2026, 0, 15, 12) };

const corpora = readdirSync('tests/corpus')
  .filter((file) => file.endsWith('-docs.json'))
  .sort()
  .map((file) => ({ name: file.replace('-docs.json', ''), sources: JSON.parse(readFileSync(`tests/corpus/${file}`, 'utf8')) as string[] }));

const where = (name: string, src: string): string => `${name}: ${JSON.stringify(src).slice(0, 120)}`;

describe('every diagram type', () => {
  it.each(['C4Context', 'C4Container', 'C4Component', 'C4Dynamic', 'C4Deployment'])(
    'renders other diagram types with %s in their labels',
    (keyword) => {
      const sources = [
        ['flowchart', `flowchart LR\n  a[Web app] --> b[${keyword} view]`],
        ['sequence', `sequenceDiagram\n  Alice->>Bob: ${keyword} view`],
      ];
      for (const [type, source] of sources) {
        const result = render(source, options);
        expect(detectType(source)).toBe(type);
        expect(result.type).toBe(type);
        expect(result.svg).toContain(keyword);
        expect(result.width).toBeGreaterThan(0);
        expect(result.height).toBeGreaterThan(0);
      }
    }
  );

  it('has documentation examples', () => {
    const drawn = new Set<string>();
    for (const { sources } of corpora) for (const src of sources) drawn.add(render(src, options).type);
    expect([...drawn].sort()).toEqual(all.map((d) => d.type).sort());
  });

  it("draws all of Mermaid's documentation examples", { timeout: 120000 }, () => {
    let count = 0;
    for (const { name, sources } of corpora) {
      for (const src of sources) {
        const at = where(name, src);
        const { svg, width, height, type } = render(src, options);
        assertInert(svg, at);
        expect(svg, at).not.toMatch(/NaN|Infinity|undefined/);
        expect(svg.startsWith(`<svg xmlns="http://www.w3.org/2000/svg" class="pele pele-${type}"`), at).toBe(true);
        // An example that asks Mermaid for a fixed size gets one.
        const fit = /useMaxWidth: false/.test(src) ? '' : 'max-width:100%;height:auto;';
        expect(svg, at).toContain(`viewBox="0 0 ${width} ${height}" width="${width}" height="${height}" style="${fit}--_bg:`);
        expect(Number.isInteger(width) && Number.isInteger(height) && width >= 0 && height >= 0, at).toBe(true);
        expect(render(src, { ...options, responsive: false }).svg, at).not.toContain('max-width');
        expect(render(src, options).svg, at).toBe(svg);
        count++;
      }
    }
    expect(count).toBeGreaterThan(500);
  });

  it('draws a model that parse() returned as it draws the text, however often and at any width', { timeout: 120000 }, () => {
    for (const { name, sources } of corpora) {
      for (const src of sources) {
        const at = where(name, src);
        const model = parse(src);
        for (const maxWidth of [undefined, 320, 500, undefined]) {
          expect(render(model, { ...options, maxWidth }).svg, at).toBe(render(src, { ...options, maxWidth }).svg);
        }
      }
    }
  });

  it('reads the limits and the configuration when the text is parsed', () => {
    const src = 'flowchart LR\n  A --> B --> C';
    expect(() => parse(src, { maxEdges: 1 })).toThrow(PeleError);
    expect(() => parse(src, { limit: 5 })).toThrow(PeleError);
    expect(render(parse(src), { ...options, maxEdges: 1, limit: 5 }).type).toBe('flowchart');
    const config = { flowchart: { useMaxWidth: false } };
    expect(render(parse(src, { config }), options).svg).toBe(render(src, { ...options, config }).svg);
    expect(render(parse(src, { config }), options).svg).not.toBe(render(src, options).svg);
  });

  it('refuses a model that parse() did not return', () => {
    expect(() => render({ ...parse('flowchart LR\n  A --> B') }, options)).toThrow(TypeError);
  });

  it('draws a title given in front matter', () => {
    // Types whose documentation examples all carry a title of their own.
    const plain: Record<string, string> = {
      c4: 'C4Context\n  Person(a, "A")',
      cynefin: 'cynefin-beta\n  complex\n    "x"',
      journey: 'journey\n  section S\n    Task: 5: Me',
      packet: 'packet\n  0-15: "Source"',
      pie: 'pie\n  "a": 1\n  "b": 2',
      quadrant: 'quadrantChart\n  x-axis Low --> High\n  y-axis Low --> High\n  A: [0.3, 0.6]',
      radar: 'radar-beta\n  axis a, b, c\n  curve x{1,2,3}',
      timeline: 'timeline\n  2001 : a',
      wardley: 'wardley-beta\n  component A [0.5, 0.5]',
      xychart: 'xychart\n  x-axis [a, b]\n  bar [1, 2]',
    };
    const drawn = new Set<string>();
    for (const { name, sources } of corpora) {
      const src = plain[name] ?? sources.find((s) => !s.startsWith('---') && !/^\s*title\b/m.test(s));
      expect(src, name).toBeDefined();
      const { svg, type } = render(`---\ntitle: Zebra crossing\n---\n${src}`, options);
      expect(svg, name).toContain('Zebra crossing');
      assertInert(svg, name);
      drawn.add(type);
    }
    expect(drawn.size).toBe(all.length);
  });

  it('honours useMaxWidth under the section name Mermaid uses for the type', () => {
    const fixed = (src: string): boolean => !render(src, options).svg.includes('max-width');
    expect(fixed('---\nconfig:\n  xyChart:\n    useMaxWidth: false\n---\nxychart\n  x-axis [a, b]\n  bar [1, 2]')).toBe(true);
    expect(fixed('---\nconfig:\n  wardley-beta:\n    useMaxWidth: false\n---\nwardley-beta\n  component A [0.5, 0.5]')).toBe(true);
    expect(fixed('---\nconfig:\n  pie:\n    useMaxWidth: false\n---\npie\n  "a": 1')).toBe(true);
    expect(fixed('---\nconfig:\n  flowchart:\n    useMaxWidth: false\n---\npie\n  "a": 1')).toBe(false);
  });

  it('only gives ids that start with the prefix, so two diagrams on a page do not clash', () => {
    for (const { name, sources } of corpora) {
      for (const src of sources) {
        const { svg } = render(src, { ...options, idPrefix: 'one' });
        for (const m of svg.matchAll(/ id="([^"]*)"/g)) expect(m[1].startsWith('one'), `${where(name, src)}: id ${m[1]}`).toBe(true);
        for (const m of svg.matchAll(/url\(#([^)]*)\)|href="#([^"]*)"/g)) {
          expect((m[1] ?? m[2]).startsWith('one'), `${where(name, src)}: reference ${m[0]}`).toBe(true);
        }
      }
    }
  });

  it('reads entity codes in a link before checking it, so they cannot hide a scheme', () => {
    const links: [string, string][] = [
      ['flowchart', 'flowchart LR\n  A --> B\n  click A "URL"'],
      ['flowchart image', 'flowchart LR\n  A@{ img: "URL" }'],
      ['agentflow', 'agentflow-beta\n  A --> B\n  click A "URL"'],
      ['class', 'classDiagram\n  class A\n  click A href "URL"'],
      ['state', 'stateDiagram-v2\n  A --> B\n  click A href "URL"'],
      ['gantt', 'gantt\n  dateFormat YYYY-MM-DD\n  Task :a, 2024-01-01, 1d\n  click a href "URL"'],
      ['c4', 'C4Context\n  Person(a, "A", $link="URL")'],
    ];
    for (const [name, template] of links) {
      for (const hidden of ['#106;avascript:alert(1)', '&#106;avascript:alert(1)', 'java#9;script:alert(1)', '#32;javascript:alert(1)']) {
        const { svg } = render(template.replace('URL', hidden), options);
        const hrefs = (svg.match(/href="[^"]*"/g) ?? []).join(' ');
        expect(hrefs, `${name}: ${hidden}`).not.toMatch(/href="[^"#]*script/i);
        assertInert(svg, `${name}: ${hidden}`);
      }
      // C4 keeps the text of a link as written, so a code stays a harmless part of the address.
      const { svg } = render(template.replace('URL', 'https://example.com/a#35;b'), options);
      expect(svg, name).toContain(name === 'c4' ? 'href="https://example.com/a#35;b"' : 'href="https://example.com/a#b"');
    }
  });

  const LINKS: [string, string][] = [
    ['flowchart', 'flowchart LR\n  A --> B\n  click A "URL"'],
    ['flowchart image', 'flowchart LR\n  A@{ img: "URL" }'],
    ['flowchart note', 'flowchart LR\n  A["URL"]:::internal-link'],
    ['agentflow', 'agentflow-beta\n  A --> B\n  click A "URL"'],
    ['agentflow note', 'agentflow-beta\n  A["URL"]:::internal-link --> B'],
    ['class', 'classDiagram\n  class A\n  click A href "URL"'],
    ['state', 'stateDiagram-v2\n  A --> B\n  click A href "URL"'],
    ['gantt', 'gantt\n  dateFormat YYYY-MM-DD\n  Task :a, 2024-01-01, 1d\n  click a href "URL"'],
    ['kanban', "---\nconfig:\n  kanban:\n    ticketBaseUrl: 'URL'\n---\nkanban\n  todo\n    a[Card]@{ ticket: T1 }"],
    ['c4', 'C4Context\n  Person(a, "A", $link="URL")'],
    ['er', 'erDiagram\n  A["URL"]:::internal-link'],
  ];
  const hrefs = (svg: string): string[] => (svg.match(/ href="[^"]*"/g) ?? []).map((m) => m.slice(7, -1));

  it('only follows web, mail and phone links, and only loads web images', () => {
    const blocked = [
      'file:///etc/passwd',
      'FILE:///etc/passwd',
      'fi%6ce:///etc/passwd',
      'file#58;///etc/passwd',
      '//evil.example/share',
      '%2F%2Fevil.example/share',
      '\\\\\\\\evil.example\\\\share',
      'smb://evil.example/share',
      'obsidian://open?vault=x',
      'ms-msdt:/id',
      'vscode://x/y',
      'intent://x',
      'ftp://example.com/x',
      'blob:https://example.com/x',
    ];
    for (const [name, template] of LINKS) {
      for (const url of blocked) {
        // An ER name cannot hold a percent sign or a backslash.
        if (name === 'er' && /[%\\]/.test(url)) continue;
        const { svg, links } = render(template.replace('URL', () => url), options);
        // Kanban and C4 do not read entity codes in an address, which leaves a relative one.
        const left = name === 'kanban' || name === 'c4' ? /^file#58;.*$/ : /^$/;
        for (const href of hrefs(svg)) expect(href, `${name}: ${url}`).toMatch(left);
        for (const link of links) if (!link.internal) expect(link.href, `${name}: ${url}`).toMatch(left);
        expect(svg, `${name}: ${url}`).not.toContain('about:blank');
        assertInert(svg, `${name}: ${url}`);
      }
      const allowed = name.endsWith('note') || name === 'er' ? ['Note name', 'folder/Note#Heading'] : ['https://example.com/a', 'http://example.com/a', './a/b.html', '/a/b', 'a.html'];
      if (name === 'flowchart' || name === 'class') allowed.push('mailto:a@example.com', 'tel:+15550100');
      for (const url of allowed) {
        const { svg } = render(template.replace('URL', () => url), options);
        expect(hrefs(svg), `${name}: ${url}`).toEqual([url]);
      }
    }
  });

  it('lets the host allow more schemes', () => {
    for (const [name, template] of LINKS) {
      const image = name.endsWith('image');
      const url = 'obsidian://open?vault=x';
      const src = template.replace('URL', () => url);
      expect(hrefs(render(src, { ...options, [image ? 'imageSchemes' : 'linkSchemes']: ['obsidian'] }).svg), name).toEqual([url]);
      expect(hrefs(render(src, { ...options, [image ? 'linkSchemes' : 'imageSchemes']: ['obsidian'] }).svg), name).not.toContain(url);
      // Naming the schemes replaces the defaults.
      const web = template.replace('URL', 'https://example.com/a');
      expect(hrefs(render(web, { ...options, linkSchemes: [], imageSchemes: [] }).svg), name).not.toContain('https://example.com/a');
    }
    for (const scheme of ['javascript', 'data', 'vbscript']) {
      const { svg } = render(`flowchart LR\n  A --> B\n  click A "${scheme}:alert(1)"`, { ...options, linkSchemes: [scheme] });
      expect(hrefs(svg), scheme).toEqual([]);
    }
  });

  it('draws no link and no image for a host that wants none, whatever the address', () => {
    for (const [name, template] of LINKS) {
      for (const url of ['https://example.com/a', './a/b.html', 'a.png', 'Note name']) {
        const src = template.replace('URL', url);
        const drawn = render(src, options);
        const { svg, links } = render(src, { ...options, links: false, images: false });
        expect(svg, `${name}: ${url}`).not.toMatch(/<a\b|<image\b| href=/);
        expect(links, `${name}: ${url}`).toEqual([]);
        expect([render(src, { ...options, links: false }).width, render(src, { ...options, links: false }).height], `${name}: ${url}`).toEqual([drawn.width, drawn.height]);
      }
    }
  });

  it('writes the rel the host sets on every link', () => {
    const rels = (svg: string): (string | undefined)[] => (svg.match(/<a [^>]*>/g) ?? []).map((a) => / rel="([^"]*)"/.exec(a)?.[1]);
    for (const [name, template] of LINKS) {
      if (name.endsWith('image')) continue;
      const src = template.replace('URL', 'https://example.com/a');
      expect(rels(render(src, options).svg), name).toEqual(['noopener']);
      expect(rels(render(src, { ...options, linkRel: 'noopener nofollow' }).svg), name).toEqual(['noopener nofollow']);
      expect(rels(render(src, { ...options, linkRel: '' }).svg), name).toEqual([undefined]);
      const { svg } = render(src, { ...options, linkRel: 'a"><script>' });
      expect(svg, name).toContain(' rel="a&quot;&gt;&lt;script&gt;"');
      assertInert(svg, name);
    }
  });

  it('stops at the output limit', () => {
    const src = 'flowchart LR\n' + Array.from({ length: 200 }, (_, i) => `  n${i} --> n${i + 1}`).join('\n');
    const { svg } = render(src, options);
    expect(() => render(src, { ...options, outputLimit: svg.length })).not.toThrow();
    let error: unknown;
    try {
      render(src, { ...options, outputLimit: svg.length - 1 });
    } catch (e) {
      error = e;
    }
    expect(error).toBeInstanceOf(PeleError);
    expect((error as PeleError).code).toBe('limit');
    expect((error as PeleError).type).toBe('flowchart');
    expect(() => render('mindmap\nroot\n' + ' a\n'.repeat(16000), options)).toThrow(/output is longer than the limit/);
  });

  it('turns entity codes into characters wherever text is read as text', { timeout: 300000 }, () => {
    // A value that is checked before it is written (a style, a colour, a URL) keeps a code as it is.
    const checked = new Set(['style', 'fill', 'stroke', 'href']);
    let rendered = 0;
    for (const { name, sources } of corpora) {
      for (const src of sources) {
        const variants = [
          src.replace(/"([^"\n]*)"/g, (_, t: string) => `"${t}#35;"`),
          src.replace(/\[([^\]\n[]*)\]/g, (_, t: string) => `[${t}#35;]`),
          src.replace(/(: *)([^\n:]+)$/gm, (_, a: string, t: string) => `${a}${t}#35;`),
          src.replace(/^(\s*)([A-Za-z][\w ]*)$/gm, (_, a: string, t: string) => `${a}${t}#35;`),
          src.replace(/\b([A-Za-z]\w+)\b(?=\s*(-->|--|->|:|\(|\[|\{))/g, (_, t: string) => `${t}#35;`),
        ];
        for (const variant of variants) {
          if (variant === src) continue;
          let result: ReturnType<typeof render>;
          try {
            result = render(variant, options);
          } catch (error) {
            if (error instanceof PeleError) continue;
            throw error;
          }
          rendered++;
          const at = where(name, variant);
          for (const m of result.svg.matchAll(/>[^<]*(?:\ufb02\u00b0|\u00b6\u00df)[^<]*</g)) expect.fail(`${at}: text ${m[0].slice(0, 60)}`);
          for (const m of result.svg.matchAll(/ ([\w:-]+)="[^"]*(?:\ufb02\u00b0|\u00b6\u00df)[^"]*"/g)) {
            expect(checked.has(m[1]), `${at}: attribute ${m[0].slice(0, 60)}`).toBe(true);
          }
          for (const link of result.links) expect(link.id, at).not.toMatch(/\ufb02\u00b0|\u00b6\u00df/);
          assertInert(result.svg, at);
        }
      }
    }
    expect(rendered).toBeGreaterThan(600);
  });

  it('shows an entity code the same way in a label, a tooltip, an id and an accessible name', () => {
    const flow = render('flowchart LR\n  accTitle: Issue #35; list\n  A["Issue #35; fixed"]\n  click A "https://example.com" "Issue #35; fixed"', options);
    expect(flow.svg).toContain('>Issue # fixed<');
    expect(flow.svg).toContain('<title>Issue # fixed</title>');
    expect(flow.svg).toContain('>Issue # list</title>');
    const pie = render('pie\n  "Issue #35;": 1\n  "A #amp; B": 2', options);
    expect(pie.svg).toContain('data-id="Issue #"');
    expect(pie.svg).toContain('data-id="A &amp; B"');
    const quoted = render('pie\n  "#34; onload=#34;alert(1)": 1', options);
    expect(quoted.svg).toContain('data-id="&quot; onload=&quot;alert(1)"');
    assertInert(quoted.svg, 'quoted id');
  });

  it('leaves room for an icon only when the host has it', () => {
    const cases: [string, string, string][] = [
      ['flowchart', 'flowchart LR\n  A[fa:fa-car Car] --> B[Stop fa:fa-ban]', 'flowchart LR\n  A[Car] --> B[Stop]'],
      ['mindmap', 'mindmap\n  root\n    Read\n    ::icon(fa fa-book)\n    Write', 'mindmap\n  root\n    Read\n    Write'],
      ['kanban', 'kanban\n  todo[Todo]\n    a[Call]@{ icon: phone }', 'kanban\n  todo[Todo]\n    a[Call]'],
    ];
    for (const [name, withIcon, without] of cases) {
      const plain = render(withIcon, options);
      expect(plain.svg, name).not.toContain('pele-icon');
      expect(plain.svg, name).toBe(render(without, options).svg);
      expect(render(withIcon, { ...options, icons: () => null }).svg, name).toBe(plain.svg);
      expect(render(withIcon, { ...options, icons: () => '' }).svg, name).toBe(plain.svg);
      const drawn = render(withIcon, { ...options, icons: () => '<path d="M1,1H9"/>' });
      expect(drawn.svg, name).toMatch(/<svg class="pele-icon" data-icon="[^"]+"[^>]*><path d="M1,1H9"\/><\/svg>/);
      expect(drawn.width, name).toBeGreaterThanOrEqual(plain.width);
      // It is drawn in the diagram's text color, not in whatever color the page gives the container.
      expect(drawn.svg, name).toMatch(/^<svg[^>]* style="[^"]*color:var\(--_fg\);/);
      expect(drawn.svg, name).toMatch(/<svg class="pele-icon"[^>]* stroke="currentColor"/);
      assertInert(drawn.svg.replace(/<svg class="pele-icon"[^>]*>.*?<\/svg>/g, ''), name);
    }
  });

  it('gives the icon resolver and the returned links the names as written', () => {
    const asked: string[] = [];
    const icons = (icon: string): string => {
      asked.push(icon);
      return '';
    };
    const { svg, links } = render('flowchart LR\n  A@{ icon: "fa:user#35;", label: "x" }\n  B --> A\n  click A "https://example.com"', { ...options, icons });
    expect(asked).toContain('fa:user#');
    expect(svg).toContain('data-icon="fa:user#"');
    expect(links.map((link) => link.id)).toEqual(['A']);
    expect(svg).not.toMatch(/\ufb02\u00b0|\u00b6\u00df/);
  });

  it('survives hostile values for every config key a renderer reads', { timeout: 300000 }, () => {
    const values: unknown[] = [1e308, -1e308, 1e9, -1, 0, 0.5, NaN, Infinity, '"><script>alert(1)</script>', 'url(javascript:alert(1))', true, null, [], { a: 1 }, '__proto__'];
    const literals = (dir: string): string[] => {
      const found: string[] = [];
      for (const file of readdirSync(dir)) {
        if (!file.endsWith('.ts')) continue;
        for (const m of readFileSync(`${dir}/${file}`, 'utf8').matchAll(/'([a-z][A-Za-z]{2,30})'/g)) found.push(m[1]);
      }
      return found;
    };
    const folders = readdirSync('src/diagrams').filter((f) => f !== 'common' && !f.endsWith('.ts'));
    for (const { name, sources } of corpora) {
      const type = render(sources[0], options).type;
      const diagram = all.find((d) => d.type === type)!;
      const folder = folders.find((f) => readFileSync(`src/diagrams/${f}/index.ts`, 'utf8').includes(`type: '${type}'`))!;
      const keys = new Set([...literals(`src/diagrams/${folder}`), ...literals('src/diagrams/flowchart')]);
      for (const value of values) {
        const section = Object.fromEntries([...keys].map((key) => [key, value]));
        const config = { ...section, [diagram.section ?? type]: section, flowchart: section, themeVariables: section };
        for (const src of sources.slice(0, 2)) {
          const at = `${where(name, src)} with ${JSON.stringify(value)}`;
          let svg: string;
          const started = performance.now();
          try {
            const result = render(src, { ...options, config: config as never });
            svg = result.svg;
            expect(Number.isFinite(result.width) && Number.isFinite(result.height), at).toBe(true);
          } catch (error) {
            expect(error, at).toBeInstanceOf(PeleError);
            continue;
          }
          expect(performance.now() - started, at).toBeLessThan(3000);
          expect(svg, at).not.toMatch(/NaN|Infinity|undefined/);
          assertInert(svg, at);
        }
      }
    }
  });

  it('treats names that are object keys as ordinary names', { timeout: 300000 }, () => {
    let rendered = 0;
    for (const { name, sources } of corpora) {
      for (const src of sources.slice(0, 6)) {
        const body = src.slice(src.indexOf('\n') + 1);
        const counts = new Map<string, number>();
        for (const m of body.matchAll(/\b[A-Za-z][A-Za-z0-9]{0,20}\b/g)) counts.set(m[0], (counts.get(m[0]) ?? 0) + 1);
        const words = [...counts].filter(([, n]) => n >= 2).sort((a, b) => b[1] - a[1]).slice(0, 4);
        for (const [word] of words) {
          for (const key of ['__proto__', 'constructor', 'toString', 'hasOwnProperty', 'valueOf']) {
            const variant = src.replace(new RegExp(`\\b${word}\\b`, 'g'), key);
            let svg: string;
            try {
              svg = render(variant, options).svg;
            } catch (error) {
              if (error instanceof PeleError) continue;
              throw new Error(`${where(name, variant)}: ${(error as Error).name}: ${(error as Error).message}`);
            }
            assertInert(svg, where(name, variant));
            expect(svg, where(name, variant)).not.toMatch(/NaN|Infinity|undefined|\[object |function /);
            rendered++;
          }
        }
      }
    }
    expect(rendered).toBeGreaterThan(500);
  });

  it('stays inert with hostile text in place of every quoted string and bracketed label', { timeout: 600000 }, () => {
    let rendered = 0;
    const payloads = PAYLOADS.filter((_, index) => index % 3 === 0);
    for (const { name, sources } of corpora) {
      for (const src of sources.slice(0, 12)) {
        for (const payload of payloads) {
          const variants = [
            src.replace(/"[^"\n]*"/g, () => `"${payload}"`),
            src.replace(/\[[^\]\n[]*\]/g, () => `[${payload}]`),
            src.replace(/: *[^\n:]+$/gm, () => `: ${payload}`),
          ];
          for (const variant of variants) {
            if (variant === src) continue;
            let svg: string;
            try {
              svg = render(variant, options).svg;
            } catch (error) {
              if (error instanceof PeleError) continue;
              throw new Error(`${where(name, variant)}: ${(error as Error).name}: ${(error as Error).message}`);
            }
            assertInert(svg, where(name, variant));
            expect(svg, where(name, variant)).not.toMatch(/NaN|Infinity/);
            rendered++;
          }
        }
      }
    }
    expect(rendered).toBeGreaterThan(2000);
  });
});
