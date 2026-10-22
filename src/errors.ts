export type PeleErrorCode = 'unsupported-diagram' | 'syntax' | 'semantic' | 'limit';

export class PeleError extends Error {
  code: PeleErrorCode;
  type: string | null;
  mermaidType: string | null;
  line: number;
  column: number;
  snippet: string;

  constructor(
    message: string,
    code: PeleErrorCode = 'syntax',
    info: { type?: string | null; mermaidType?: string | null; line?: number; column?: number; snippet?: string } = {}
  ) {
    super(message);
    this.name = 'PeleError';
    this.code = code;
    this.type = info.type ?? null;
    this.mermaidType = info.mermaidType ?? null;
    this.line = info.line ?? 0;
    this.column = info.column ?? 0;
    this.snippet = info.snippet ?? '';
  }
}

export function locate(src: string, offset: number): { line: number; column: number; snippet: string } {
  let line = 1;
  let lineStart = 0;
  for (let i = src.indexOf('\n'); i !== -1 && i < offset; i = src.indexOf('\n', i + 1)) {
    line++;
    lineStart = i + 1;
  }
  let lineEnd = src.indexOf('\n', offset);
  if (lineEnd === -1) lineEnd = src.length;
  const column = offset - lineStart + 1;
  const text = src.slice(lineStart, lineEnd);
  return { line, column, snippet: text + '\n' + '-'.repeat(column - 1) + '^' };
}

export function syntaxError(
  type: string,
  src: string,
  offset: number,
  detail: string,
  lexical = false
): PeleError {
  const loc = locate(src, offset);
  const head = lexical
    ? `Lexical error on line ${loc.line}. Unrecognized text.`
    : `Parse error on line ${loc.line}:`;
  const message = lexical ? `${head}\n${loc.snippet}` : `${head}\n${loc.snippet}\n${detail}`;
  return new PeleError(message, 'syntax', { type, ...loc });
}
