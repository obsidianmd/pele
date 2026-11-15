import type { RenderOptions, Rendered } from '../../types.js';

// Draws a chart whose plot can be any width so that the whole diagram fits the width the host
// has. What surrounds the plot (labels, a legend) is only known once it is drawn, so the plot
// gives up the overflow and is drawn again. `narrow` tells the chart that it did not fit at
// its own width, for a chart that then arranges itself differently.
export function fitWidth(
  options: RenderOptions,
  natural: number,
  least: number,
  draw: (plot: number, narrow: boolean) => Rendered
): Rendered {
  let result = draw(natural, false);
  const available = options.maxWidth;
  if (available === undefined || !(available > 0) || result.width <= available) return result;
  const floor = Math.min(least, natural);
  let plot = natural;
  result = draw(plot, true);
  for (let round = 0; round < 3 && result.width > available && plot > floor; round++) {
    plot = Math.max(floor, plot - (result.width - available));
    result = draw(plot, true);
  }
  return result;
}

// The width a title may take before it wraps.
export function titleRoom(options: RenderOptions): number {
  const available = options.maxWidth;
  return available !== undefined && available > 0 ? Math.max(80, available - 2 * (options.padding ?? 8)) : 4000;
}

// For a chart that is drawn to a set width: its own, or the host's when that is smaller.
// `around` is what the chart adds outside that width.
export function capWidth(options: RenderOptions, natural: number, least: number, around = 0): number {
  const available = options.maxWidth;
  if (available === undefined || !(available > 0)) return natural;
  return Math.max(Math.min(least, natural), Math.min(natural, available - around));
}

// For a chart whose plot can be any width: the width the host has when that is wider than
// its own, its own when the host has less room than that, and never below `least`. A width
// that is not a positive finite number is no width at all.
export function fillWidth(options: RenderOptions, natural: number, least: number): number {
  const available = options.maxWidth;
  if (available !== undefined && Number.isFinite(available) && available > natural) return available;
  return capWidth(options, natural, least);
}

const BREAKPOINT = 640;

// For a diagram that can run across or down: draws it across, and down instead when the host
// allows it, the width it has is under the breakpoint, across does not fit, and down is narrower.
export function turnToFit(options: RenderOptions, draw: (down: boolean) => Rendered): Rendered {
  const across = draw(false);
  const available = options.maxWidth;
  if (options.autoDirection === false || available === undefined || !(available > 0) || across.width <= available) return across;
  const breakpoint = options.directionBreakpoint;
  if (available >= (breakpoint !== undefined && breakpoint > 0 ? breakpoint : BREAKPOINT)) return across;
  const down = draw(true);
  return down.width < across.width ? down : across;
}

export function runsAcross(direction: string | undefined): boolean {
  return direction === 'LR' || direction === 'RL';
}

// Draws a diagram with room to spare, and tightly instead when that does not fit the width the
// host has and tight is narrower.
export function tighten(options: RenderOptions, draw: (tight: boolean) => Rendered): Rendered {
  const loose = draw(false);
  const available = options.maxWidth;
  if (available === undefined || !(available > 0) || loose.width <= available) return loose;
  const tight = draw(true);
  return tight.width < loose.width ? tight : loose;
}
