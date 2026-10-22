import { describe, expect, it } from 'vitest';
import { render } from '../../src/index.js';
import { layoutLabel } from '../../src/text/label.js';
import { metricsMeasurer } from '../../src/text/measurer.js';

const lines = (raw: string, max: number): string[] =>
  layoutLabel(raw, false, metricsMeasurer, 16, max).lines.map(line => line.map(span => span.text).join(''));

const JA = '在庫引当の結果を基幹システムへ連携し、出荷指示を倉庫管理システムに送信して完了を確認する';

describe('CJK label wrapping', () => {
  it('wraps Japanese text that has no spaces and keeps every character', () => {
    const out = lines(JA, 200);
    expect(out.length).toBeGreaterThan(1);
    expect(out.join('')).toBe(JA);
    for (const width of layoutLabel(JA, false, metricsMeasurer, 16, 200).widths) expect(width).toBeLessThanOrEqual(200);
  });

  it('does not start a line with closing punctuation or end one with an opening bracket', () => {
    for (let max = 40; max <= 240; max += 8) {
      const out = lines(`「${JA}」（確認済み）。`, max);
      expect(out.join('')).toBe(`「${JA}」（確認済み）。`);
      for (const line of out) {
        expect(line).not.toMatch(/^[、。，．）」』】]/);
        expect(line).not.toMatch(/[「『（【]$/);
      }
    }
  });

  it('wraps mixed Latin and Japanese text without splitting Latin words', () => {
    const out = lines('AWS Lambda から呼び出されるバッチ処理の完了通知を送信する', 160);
    expect(out.length).toBeGreaterThan(1);
    expect(out.join('').replace(/\s/g, '')).toBe('AWSLambdaから呼び出されるバッチ処理の完了通知を送信する');
    expect(out.join('|')).toContain('Lambda');
  });

  it('keeps English and Korean wrapping on word boundaries', () => {
    expect(lines('one two three four five six', 80)).toEqual(['one two', 'three four', 'five six']);
    const ko = lines('안녕하세요 반갑습니다 여러분 모두', 90);
    expect(ko.every(line => !/\s$/.test(line))).toBe(true);
    for (const word of ['안녕하세요', '반갑습니다', '여러분', '모두']) expect(ko.some(line => line.includes(word))).toBe(true);
  });

  it('keeps a short Japanese label on one line and a long unbroken Latin word whole', () => {
    expect(lines('在庫確認', 200)).toEqual(['在庫確認']);
    expect(lines('Supercalifragilisticexpialidocious', 60)).toEqual(['Supercalifragilisticexpialidocious']);
  });

  it('makes a long Japanese flowchart label narrower than the unwrapped text', () => {
    const label = '在庫引当の結果を基幹システムへ連携し出荷指示を倉庫管理システムに送信する';
    const width = (svg: string): number => Number(/viewBox="[-\d.]+ [-\d.]+ ([\d.]+)/.exec(svg)![1]);
    const wrapped = render(`flowchart TD\n  A[${label}] --> B[完了]`, { measurer: metricsMeasurer }).svg;
    expect(width(wrapped)).toBeLessThan(metricsMeasurer.width(label, 16, 0));
  });
});
