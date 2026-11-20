import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { parse, render } from '../../src/index.js';
import { metricsMeasurer } from '../../src/text/measurer.js';
import { literalLabel, breakLabel } from '../../src/diagrams/common/literal-label.js';
import { layoutLabel } from '../../src/text/label.js';
import { assertInert } from '../support/inert.js';
import { elements } from '../support/xml.js';

const options = { measurer: metricsMeasurer, now: 0 };
const phone = { ...options, maxWidth: 320 };
const sources = (name: string): string[] => JSON.parse(readFileSync(`tests/corpus/${name}-docs.json`, 'utf8'));
const texts = (svg: string): string[] => [...svg.matchAll(/<text\b[^>]*>([\s\S]*?)<\/text>/g)].map(match => match[1].replace(/<[^>]+>/g, '').replace(/\s/g, ''));

const TREE = 'treeView-beta\n  project/\n    very_long_filename_that_must_wrap_without_losing_any_characters.ts :::highlight ## A description that should move below its filename on a phone\n    source/\n      app.ts\n';

describe('mobile diagram layouts', () => {
  it('compacts every newly supported type while retaining its model and desktop drawing', () => {
    for (const name of ['sequence', 'railroad', 'journey', 'packet', 'c4', 'architecture', 'eventmodeling', 'swimlane', 'block', 'ishikawa']) {
      const source = sources(name).sort((a, b) => render(b, options).width - render(a, options).width)[0];
      const model = parse(source), before = JSON.stringify(model);
      const wide = render(model, options);
      const narrow = render(model, phone);
      expect(narrow.width, name).toBeLessThan(wide.width);
      expect(JSON.stringify(model), name).toBe(before);
      expect(render(model, { ...options, maxWidth: wide.width }).svg, name).toBe(wide.svg);
      expect(render(model, options).svg, name).toBe(wide.svg);
      expect(narrow.svg.match(/font:(\d+)px/)?.[1], name).toBe(wide.svg.match(/font:(\d+)px/)?.[1]);
      assertInert(narrow.svg, name);
    }
  });

  it('keeps participants, messages, notes and numbering readable in a four-party sequence', () => {
    const source = sources('sequence')[1];
    const wide = render(source, options), narrow = render(source, phone);
    expect(narrow.width).toBeLessThanOrEqual(320);
    expect(narrow.height).toBeGreaterThan(wide.height);
    const labels = texts(narrow.svg);
    for (const label of texts(wide.svg)) expect(labels).toContain(label);
    expect(narrow.svg.match(/class="pele-activation"/g)?.length).toBe(wide.svg.match(/class="pele-activation"/g)?.length);
  });

  it('wraps nested railroad sequences without losing grammar elements or overlapping boxes', () => {
    const source = sources('railroad')[8];
    const wide = render(source, options), narrow = render(source, phone);
    expect(narrow.width).toBeLessThanOrEqual(320);
    expect(narrow.height).toBeGreaterThan(wide.height);
    expect(texts(narrow.svg)).toEqual(texts(wide.svg));
    const boxes = elements(narrow.svg).filter(el => el.name === 'rect').map(el => ({ x: Number(el.attrs.get('x')), y: Number(el.attrs.get('y')), w: Number(el.attrs.get('width')), h: Number(el.attrs.get('height')) }));
    for (let i = 0; i < boxes.length; i++) {
      const a = boxes[i];
      expect(a.x >= 0 && a.y >= 0 && a.x + a.w <= narrow.width && a.y + a.h <= narrow.height).toBe(true);
      for (const b of boxes.slice(i + 1)) expect(a.x + a.w <= b.x || b.x + b.w <= a.x || a.y + a.h <= b.y || b.y + b.h <= a.y).toBe(true);
    }
    expect(narrow.svg.match(/pele-start/g)?.length).toBe(wide.svg.match(/pele-start/g)?.length);
    expect(narrow.svg.match(/pele-end/g)?.length).toBe(wide.svg.match(/pele-end/g)?.length);
  });

  it('preserves every bit and field when packet rows split, including descending numbering', () => {
    for (const bitOrder of ['ascending', 'descending']) {
      const source = `---\nconfig:\n  packet:\n    bitOrder: ${bitOrder}\n---\npacket\n0-31: "Header"\n32-39: "Flags"\n40-127: "Payload"`;
      const narrow = render(source, phone);
      const ranges = [...narrow.svg.matchAll(/class="pele-node" data-id="(\d+)-(\d+)"/g)].map(match => [Number(match[1]), Number(match[2])]);
      let next = 0;
      for (const [from, to] of ranges) { expect(from).toBe(next); next = to + 1; }
      expect(next).toBe(128);
      expect(narrow.width).toBeLessThanOrEqual(320);
      for (const name of ['Header', 'Flags', 'Payload']) expect(texts(narrow.svg)).toContain(name);
      expect(narrow.svg).not.toContain('…');
      expect(render(source, { ...phone, autoDirection: false }).svg).toBe(render(source, options).svg);
    }
  });

  it('uses taller rows only where packet labels need them', () => {
    const narrow = render(sources('packet')[0], phone);
    const heights = elements(narrow.svg).filter(el => el.name === 'rect').map(el => Number(el.attrs.get('height')));
    expect(new Set(heights).size).toBeGreaterThan(1);
    for (const label of ['URG', 'ACK', 'PSH', 'RST', 'SYN', 'FIN']) expect(texts(narrow.svg)).toContain(label);
    expect(narrow.height).toBeLessThan(1200);
  });

  it('keeps journey order, section headings, scores and actors in the vertical drawing', () => {
    const source = 'journey\n  title Delivery\n  section Prepare\n    Read requirements: 3: Alice, Bob\n    Make a plan: 4: Alice\n  section Finish\n    Review the result: 5: Bob';
    const narrow = render(source, phone);
    expect(narrow.width).toBeLessThanOrEqual(320);
    const labels = texts(narrow.svg);
    for (const value of ['Delivery', 'Prepare', 'Finish', 'Readrequirements', 'Makeaplan', 'Reviewtheresult', 'Alice', 'Bob', '3', '4', '5']) expect(labels).toContain(value);
    const steps = [...narrow.svg.matchAll(/class="pele-node pele-journey-step" data-id="(\d+)"/g)].map(match => Number(match[1]));
    expect(steps).toEqual([0, 1, 2]);
  });

  it('keeps event frames, lanes, data, reset markers, explicit relations and specifications', () => {
    for (const source of sources('eventmodeling')) {
      const model = parse(source);
      if (model.type !== 'eventmodeling') throw new Error('fixture type');
      const narrow = render(model, phone);
      expect(narrow.width).toBeLessThanOrEqual(320);
      const labels = texts(narrow.svg);
      for (const box of model.boxes) {
        expect(narrow.svg).toContain(`data-id="${box.id}"`);
        expect(labels).toContain(box.lane.label.replace(/\s/g, ''));
      }
      const wide = render(model, options);
      expect(narrow.svg.match(/class="pele-edge"/g)?.length ?? 0).toBe(wide.svg.match(/class="pele-edge"/g)?.length ?? 0);
      expect(narrow.svg.match(/pele-em-reset/g)?.length ?? 0).toBe(wide.svg.match(/pele-em-reset/g)?.length ?? 0);
      expect(narrow.svg.match(/class="pele-em-specification"/g)?.length ?? 0).toBe(model.specifications.length);
      expect(narrow.svg.match(/class="pele-em-note"/g)?.length ?? 0).toBe(model.notes.length);
    }
  });

  it('wraps filenames and moves descriptions underneath without changing the hierarchy', () => {
    const wide = render(TREE, options), narrow = render(TREE, phone);
    expect(narrow.width).toBeLessThanOrEqual(320);
    expect(narrow.height).toBeGreaterThan(wide.height);
    expect(texts(narrow.svg).join('')).toBe(texts(wide.svg).join(''));
    expect(narrow.svg.match(/class="pele-node/g)?.length).toBe(wide.svg.match(/class="pele-node/g)?.length);
    expect(narrow.svg.match(/<path/g)?.length).toBe(wide.svg.match(/<path/g)?.length);
    const file = narrow.svg.slice(narrow.svg.indexOf('data-id="very_long_filename_that_must_wrap_without_losing_any_characters.ts"'));
    const filenameY = Number(file.match(/<text class="pele-label"[\s\S]*?y="([\d.]+)"/)![1]);
    const descriptionY = Number(file.match(/<text class="pele-tree-description"[\s\S]*?y="([\d.]+)"/)![1]);
    expect(descriptionY).toBeGreaterThan(filenameY);
    assertInert(narrow.svg);
  });

  it('retains every category and nested cause in the narrow Ishikawa tree', () => {
    const source = sources('ishikawa')[0];
    const model = parse(source);
    if (model.type !== 'ishikawa') throw new Error('fixture type');
    const narrow = render(model, phone);
    expect(narrow.width).toBeLessThanOrEqual(320);
    const labels = texts(narrow.svg);
    const pending = model.root ? [model.root] : [];
    let count = 0;
    for (let i = 0; i < pending.length; i++) { count++; expect(labels).toContain(pending[i].text.replace(/\s/g, '')); pending.push(...pending[i].children); }
    expect(narrow.svg.match(/class="pele-edge"/g)?.length).toBe(count - 1);
    expect(render(source, { ...phone, autoDirection: false }).svg).toBe(render(source, options).svg);
  });

  it('fits quadrant and Wardley examples to phone widths without shrinking the root font', () => {
    for (const name of ['quadrant', 'wardley']) {
      for (const source of sources(name)) {
        const narrow = render(source, phone);
        expect(narrow.width, name).toBeLessThanOrEqual(322);
        expect(narrow.svg).toContain('font:16px');
      }
    }
  });

  it('keeps a packet row at a byte or more, however little room there is', () => {
    const source = 'packet-beta\n0-15: "Source Port"\n16-31: "Destination Port"\n32-4095: "Payload (variable length)"\n';
    // mount() draws at one pixel to learn whether a diagram adapts.
    const least = render(source, { ...options, maxWidth: 1 });
    expect(least.svg.match(/class="pele-node"/g)?.length).toBe(4096 / 8);
    expect(least.width).toBeLessThan(render(source, options).width);
  });

  it('gives the parts of a folded railroad sequence the room its rows have', () => {
    const source = 'railroad-ebnf-beta\nexpr = "start" ( "one" "two" "three" "four" "five" "six" "seven" | "eight" "nine" "ten" "eleven" "twelve" "thirteen" ) "finish" "really" "done" "now" ;\n';
    const wide = render(source, options), narrow = render(source, phone);
    expect(narrow.width).toBeLessThanOrEqual(320);
    expect(texts(narrow.svg)).toEqual(texts(wide.svg));
  });

  it('reads entities and line breaks in the vertical Ishikawa and journey as in the wide ones', () => {
    const causes = 'ishikawa-beta\n  Late &amp; over #35;budget<br/>delivery\n  People\n    Too few<br/>reviewers &lt;3\n';
    const wide = render(causes, options), narrow = render(causes, { ...options, maxWidth: 200 });
    expect(narrow.svg).not.toBe(wide.svg);
    expect(texts(narrow.svg).sort()).toEqual(texts(wide.svg).sort());
    for (const part of ['head', 'category']) {
      const id = new RegExp(`pele-ishikawa-${part}" data-id="([^"]+)"`);
      expect(narrow.svg.match(id)?.[1], part).toBe(wide.svg.match(id)![1]);
    }
    const day = 'journey\n  section Work\n    Make tea: 5: Me #35;1, Cat<br/>two\n    Go upstairs: 3: Me #35;1\n    Go downstairs: 3: Me #35;1\n    Sleep now: 3: Me #35;1\n';
    const steps = texts(render(day, { ...options, maxWidth: 200 }).svg);
    expect(steps).toContain('Me#1');
    expect(steps).toContain('Cattwo');
  });

  it('draws vertical event relations whole and on rails of their own', () => {
    const source = 'eventmodeling\n\ntf 01 ui CartUI\ntf 02 cmd AddItem\ntf 03 evt ItemAdded ->> 01\ntf 04 rmo CartView ->> 02\ntf 05 evt CartCleared ->> 03 ->> 02\n';
    const narrow = render(source, phone);
    expect(narrow.width).toBeLessThanOrEqual(320);
    const rails = new Map<string, number>();
    for (const [, id, rail] of narrow.svg.matchAll(/class="pele-edge" data-id="([^"]+)"><path d="M[\d.]+,[\d.]+H([\d.]+)V/g)) rails.set(id, Number(rail));
    expect(rails.size).toBe(4);
    expect(rails.get('02-05')).toBe(rails.get('03-05'));
    expect(new Set(rails.values()).size).toBe(3);
  });

  it('wraps a long lane heading to leave the arrow from the card above room beside it', () => {
    const source = 'eventmodeling\n\ntf 01 ui CartUI\ntf 02 cmd CustomerAccountManagement.AddItem\ntf 03 evt ItemAdded\n';
    const narrow = render(source, phone);
    expect(narrow.width).toBeLessThanOrEqual(320);
    const arrow = Number(narrow.svg.match(/data-id="01-02"><path d="M([\d.]+),/)![1]);
    const lane = narrow.svg.slice(narrow.svg.indexOf('data-id="C/RM: CustomerAccountManagement"'), narrow.svg.indexOf('data-id="02"'));
    const lines = [...lane.matchAll(/<text\b[^>]*>([\s\S]*?)<\/text>/g)].map(match => match[1].replace(/<[^>]+>/g, ''));
    expect(lines).toEqual(['C/RM:', 'CustomerAccountManagement']);
    expect(lane).not.toContain('<rect');
    const left = 8 + 12;
    for (const line of lines) expect(arrow).toBeGreaterThan(left + metricsMeasurer.width(line, 14, 1));
    expect(arrow).toBeLessThan(narrow.width - 8 - 24);
  });

  it('gives every overlapping event relation a rail, growing wider when they run out of room', () => {
    const frame = (i: number): string => String(i).padStart(2, '0');
    let source = 'eventmodeling\n\n';
    for (let i = 1; i <= 7; i++) source += `tf ${frame(i)} evt Source${i}\n`;
    for (let i = 8; i <= 14; i++) source += `tf ${frame(i)} rmo Target${i} ->> ${frame(i - 7)}\n`;
    for (const maxWidth of [320, 200]) {
      const narrow = render(source, { ...options, maxWidth });
      const rails = [...narrow.svg.matchAll(/class="pele-edge" data-id="[^"]+"><path d="M[\d.]+,[\d.]+H([\d.]+)V/g)].map(match => Number(match[1]));
      expect(rails.length).toBe(7);
      expect(new Set(rails).size).toBe(7);
      expect(Math.max(...rails)).toBeLessThan(narrow.width - 8);
      if (maxWidth === 320) expect(narrow.width).toBeLessThanOrEqual(320);
    }
  });

  it('splits a packet field only where a narrow row ends, whatever the rows were set to', () => {
    const source = '---\nconfig:\n  packet:\n    bitsPerRow: 20\n---\npacket\n0-39: "Long field"\n40-59: "Next"\n';
    const narrow = render(source, phone);
    const ranges = [...narrow.svg.matchAll(/class="pele-node" data-id="([\d-]+)"/g)].map(match => match[1]);
    expect(ranges).toEqual(['0-15', '16-31', '32-39', '40-47', '48-59']);
    expect(narrow.width).toBeLessThanOrEqual(320);
  });

  it('reads journey text and scores in the vertical drawing as the wide one does', () => {
    const day = (score: string): string => `journey\n  title My <b>day</b>\n  section Go <i>to</i> work\n    Make <u>tea</u>: ${score}: Me\n    Walk: 3: Me\n    Sit: 3: Me\n    Sleep: 3: Me\n`;
    const wide = render(day('4'), options), narrow = render(day('4'), { ...options, maxWidth: 200 });
    expect(narrow.svg).not.toBe(wide.svg);
    for (const label of ['My&lt;b&gt;day&lt;/b&gt;', 'Go&lt;i&gt;to&lt;/i&gt;work', 'Make&lt;u&gt;tea&lt;/u&gt;']) {
      expect(texts(wide.svg)).toContain(label);
      expect(texts(narrow.svg)).toContain(label);
    }
    const scores = (score: string): string[] => [...render(day(score), { ...options, maxWidth: 200 }).svg.matchAll(/<text class="pele-journey-score"[^>]*>([^<]*)</g)].map(match => match[1]);
    expect(scores('4')).toEqual(['4', '3', '3', '3']);
    expect(scores('abc')).toEqual(['3', '3', '3']);
    expect(scores('1e21')).toEqual(['5', '3', '3', '3']);
    expect(scores('3.14159')).toEqual(['3.14', '3', '3', '3']);
  });

  it('wraps a long title to the width a narrow flowchart or swimlane has', () => {
    const title = '---\ntitle: Order handling from the first enquiry to the final delivery and invoice\n---\n';
    const lanes = 'swimlane-beta LR\n  subgraph Sales\n    A[Enquiry] --> B[Quote]\n  end\n  subgraph Ops\n    C[Deliver] --> D[Invoice]\n  end\n  B --> C\n';
    for (const source of [lanes, 'flowchart TB\n  A --> B\n']) {
      const wide = render(title + source, options);
      expect(wide.width).toBeGreaterThan(500);
      expect(render(title + source, { ...options, maxWidth: wide.width }).svg).toBe(wide.svg);
      const narrow = render(title + source, phone);
      expect(narrow.width).toBeLessThanOrEqual(320);
      expect(texts(narrow.svg).join('')).toContain('Orderhandlingfromthefirstenquirytothefinaldeliveryandinvoice');
    }
  });

  it('starts every line of a wrapped filename at one place and keeps its spaces', () => {
    const narrow = render('treeView-beta\n  "my  file  with   spaces.txt"\n  "another_really_long_file_name  with  spaces_in_it.txt"\n', { ...options, maxWidth: 200 });
    const lines = [...narrow.svg.matchAll(/<text class="pele-label"([^>]*)>([^<]*)<\/text>/g)];
    // The first line is the root `/` row, one indent left of the files.
    expect(lines[0][2]).toBe('/');
    const files = lines.slice(1);
    expect(files.map(match => match[2])).toEqual(['my  file  with', 'spaces.txt', 'another_really_long_f', 'ile_name  with', 'spaces_in_it.txt']);
    for (const [, attrs] of files) {
      expect(attrs).toContain(' text-anchor="start" xml:space="preserve"');
      expect(attrs.match(/ x="([\d.]+)"/)?.[1]).toBe(files[0][1].match(/ x="([\d.]+)"/)![1]);
    }
  });

  it('ends a vertical event model or Ishikawa at its last card', () => {
    const pad = 8;
    const frames = 'eventmodeling\n\ntf 01 ui CartUI\ntf 02 cmd AddItem\ntf 03 evt ItemAdded\n';
    for (const source of [frames, frames + 'note 02 {\n Checked first\n}\n', 'ishikawa-beta\n  Late delivery\n  People\n    Too few reviewers\n      No time set aside\n  Process\n']) {
      const narrow = render(source, { ...options, maxWidth: 200 });
      expect(narrow.svg).not.toBe(render(source, options).svg);
      const rects = elements(narrow.svg).filter(el => el.name === 'rect').map(el => Number(el.attrs.get('y')) + Number(el.attrs.get('height')));
      expect(narrow.height, source).toBe(Math.ceil(Math.max(...rects) + pad));
    }
  });

  it('preserves literal text, Unicode and styled spans through long-word wrapping', () => {
    const raw = '<literal>& emoji 🐈 中文 ' + 'filename_'.repeat(40);
    const label = literalLabel(raw, metricsMeasurer, 16, 100);
    const lines = label.lines.flat().map(span => span.text);
    expect(lines.join('').replace(/\s/g, '')).toBe(raw.replace(/\s/g, ''));
    for (const line of lines) expect(line).toBe(line.trim());
    expect(lines[0]).toBe('<literal>&');
    expect(label.width).toBeLessThanOrEqual(100);
    const styled = layoutLabel('<b>Supercalifragilisticexpialidocious</b>', false, metricsMeasurer, 16, 400);
    const wrapped = breakLabel(styled, metricsMeasurer, 80);
    expect(wrapped.lines.flat().map(span => span.text).join('')).toBe('Supercalifragilisticexpialidocious');
    expect(wrapped.lines.flat().every(span => span.style === 1)).toBe(true);
    expect(wrapped.width).toBeLessThanOrEqual(80);
  });
});
