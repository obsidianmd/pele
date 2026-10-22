import type { MathMarkup, MathResolver } from '../types.js';

let resolver: MathResolver | undefined;
let found = new Map<string, MathMarkup | undefined>();

export function withMath<T>(math: MathResolver | undefined, run: () => T): T {
  const outer = resolver;
  const outerFound = found;
  resolver = math;
  found = new Map();
  try {
    return run();
  } finally {
    resolver = outer;
    found = outerFound;
  }
}

export function mathActive(): boolean {
  return resolver !== undefined;
}

function valid(size: number): boolean {
  return Number.isFinite(size) && size > 0;
}

export function typeset(tex: string, size: number): MathMarkup | undefined {
  if (resolver === undefined) return undefined;
  const key = size + '\n' + tex;
  if (found.has(key)) return found.get(key);
  const result = resolver(tex, size) ?? undefined;
  const markup =
    result && valid(result.width) && valid(result.height) && typeof ('svg' in result ? result.svg : result.html) === 'string'
      ? result
      : undefined;
  found.set(key, markup);
  return markup;
}

// Match Mermaid: diagram titles stay plain text.
export function withoutMath<T>(run: () => T): T {
  if (resolver === undefined) return run();
  const outer = resolver;
  resolver = undefined;
  try {
    return run();
  } finally {
    resolver = outer;
  }
}
