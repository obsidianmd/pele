import { describe, expect, it } from 'vitest';
import { render } from '../../src/index.js';
import { esc, escText } from '../../src/svg/builder.js';
import { metricsMeasurer } from '../../src/text/measurer.js';
import { assertWellFormed } from '../support/xml.js';

const options = { measurer: metricsMeasurer };

// Astral-plane characters are surrogate pairs in UTF-16. On affected
// JavaScriptCore builds a `u`-flagged [\ud800-\udfff] class matches the low
// surrogate inside a valid pair, so the lone-surrogate strip added for #72
// corrupted emoji into lone surrogates (#148). These tests pin the intended
// behaviour; they only differ from the old code on such an engine, because
// V8 implements `u` classes per spec.
describe('esc() astral-plane characters (#148)', () => {
  it('keeps emoji, CJK ext-B and musical symbols intact', () => {
    for (const text of ['📝', '💻', '🔀', '📡', '👩', '👨', '😀', '𠀀', '𝄞']) {
      expect(esc(text)).toBe(text);
    }
    expect(esc('A 📝 B 💻')).toBe('A 📝 B 💻');
  });

  it('keeps a ZWJ emoji sequence intact', () => {
    expect(esc('👨‍👩‍👧‍👦')).toBe('👨‍👩‍👧‍👦');
  });

  it('still strips lone surrogates, including beside a dropped character', () => {
    for (const text of ['a\ud800b', 'a\udc00b', 'a\udfffb', '\ud800', '\udc00']) {
      expect(esc(text), JSON.stringify(text)).not.toContain('\ud800');
      expect(esc(text), JSON.stringify(text)).not.toContain('\udc00');
    }
    // A lone high surrogate followed by another dropped character is matched
    // as one run by the strip class; it must still be dropped, not kept as a
    // two-unit "pair".
    expect(esc('a\ud800\x01b')).toBe('ab');
    expect(esc('a\ud800\ud800b')).toBe('ab');
    expect(esc('a\ud800\ufffeb')).toBe('ab');
    expect(esc('a\udc00\x01b')).toBe('ab');
  });

  it('still escapes markup and drops other invalid XML characters', () => {
    expect(esc('a&b<c>d"e')).toBe('a&amp;b&lt;c&gt;d&quot;e');
    expect(esc('a\x01b\x7fc\ufffed\uffffe')).toBe('abcde');
    expect(esc('📝&')).toBe('📝&amp;');
    expect(esc('📝\udc00')).toBe('📝');
  });

  it('keeps astral characters through escText()', () => {
    expect(escText('📝')).toBe('📝');
    expect(escText('&#128221;')).toBe('📝');
    expect(escText('a &amp; 📝')).toBe('a &amp; 📝');
  });

  it('emits the issue repro label intact in a flowchart', () => {
    const { svg } = render('flowchart LR\nA["📝"]-->B', options);
    assertWellFormed(svg);
    expect(svg).toContain('>📝</text>');
    expect(svg).not.toMatch(/�/);
  });

  it('emits a multi-emoji label intact', () => {
    const { svg } = render('flowchart LR\nA["📝 💻 🔀"]-->B', options);
    assertWellFormed(svg);
    expect(svg).toContain('📝 💻 🔀');
  });
});
