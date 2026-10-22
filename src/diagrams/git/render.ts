import type { Config } from '../../preprocess.js';
import { escText, labelSvg, num } from '../../svg/builder.js';
import { svgDocument } from '../../svg/root.js';
import { ROUNDED, seriesColor } from '../../svg/theme.js';
import { layoutLabel, type Label } from '../../text/label.js';
import { Style, defaultMeasurer } from '../../text/measurer.js';
import type { RenderOptions, Rendered } from '../../types.js';
import { turnToFit } from '../common/fit-width.js';
import { plainLabel } from '../common/fit.js';
import { commitType, type GitCommit, type GitModel } from './db.js';

const DOT = 7;
const STEP = 44;
const LANE = 44;
// Shorter than a step, so a curve between lanes never runs through a commit on a lane it crosses.
const CURVE = 36;
const GAP = 8;
const LABEL_GAP = 20;
const TAIL = 20;
const NOTCH = 7;
const TAG_GAP = 6;
const HALF = Math.SQRT1_2;
const CLASSES = ['normal', 'reverse', 'highlight', 'merge', 'cherry-pick'];

interface View {
  commit: GitCommit;
  index: number;
  lane: number;
  m: number;
  label: Label | undefined;
  tags: Label[];
}

function flag(config: Config, key: string, fallback: boolean): boolean {
  const value = (config.gitGraph as Config | undefined)?.[key];
  return typeof value === 'boolean' ? value : fallback;
}

function tagWidth(tag: Label): number {
  return NOTCH + 4 + tag.width + 6;
}

function symbol(type: number, x: number, y: number, color: string): string {
  const at = `cx="${num(x)}" cy="${num(y)}"`;
  if (type === commitType.HIGHLIGHT) {
    return `<rect x="${num(x - DOT - 1)}" y="${num(y - DOT - 1)}" width="${2 * DOT + 2}" height="${2 * DOT + 2}" rx="2" fill="${color}"/>`;
  }
  if (type === commitType.MERGE) {
    return `<circle ${at} r="${DOT - 1}" fill="var(--_bg)" stroke="${color}" stroke-width="2"/><circle ${at} r="2.5" fill="${color}"/>`;
  }
  const dot = `<circle ${at} r="${DOT}" fill="${color}"/>`;
  if (type === commitType.REVERSE) {
    return (
      dot +
      `<path d="M${num(x - 3)},${num(y - 3)}l6,6M${num(x - 3)},${num(y + 3)}l6,-6" fill="none" stroke="var(--_bg)" stroke-width="1.5" stroke-linecap="round"/>`
    );
  }
  if (type === commitType.CHERRY_PICK) {
    return (
      dot +
      `<path d="M${num(x - 2.6)},${num(y + 1)}L${num(x + 0.8)},${num(y - 4.2)}L${num(x + 2.6)},${num(y + 1)}" fill="none" stroke="var(--_bg)" stroke-linejoin="round"/>` +
      `<circle cx="${num(x - 2.6)}" cy="${num(y + 2.2)}" r="1.8" fill="var(--_bg)"/>` +
      `<circle cx="${num(x + 2.6)}" cy="${num(y + 2.2)}" r="1.8" fill="var(--_bg)"/>`
    );
  }
  return dot;
}

export function renderGit(model: GitModel, config: Config, options: RenderOptions): Rendered {
  if (model.direction !== 'LR') return draw(model, config, options, model.direction);
  return turnToFit(options, (down) => draw(model, config, options, down ? 'TB' : 'LR'));
}

function draw(model: GitModel, config: Config, options: RenderOptions, direction: GitModel['direction']): Rendered {
  const size = options.fontSize ?? 16;
  const small = Math.round(size * 0.75);
  const measurer = options.measurer ?? defaultMeasurer(options.fontFamily);
  const pad = options.padding ?? 8;

  const showBranches = flag(config, 'showBranches', true);
  const showCommitLabel = flag(config, 'showCommitLabel', true);
  const rotate = flag(config, 'rotateCommitLabel', true);
  const parallel = flag(config, 'parallelCommits', false);
  const vertical = direction !== 'LR';
  const flip = direction === 'BT';

  const laneOf = new Map<string, number>();
  model.lanes.forEach((name, index) => laneOf.set(name, index));
  const laneCount = model.lanes.length;
  const medium = Math.round(size * 0.875);
  // Mermaid writes branch names, tags, and commit ids as plain text, so tags in them show as written.
  const names = model.lanes.map((name) => plainLabel(showBranches ? name : '', measurer, medium, 4000));

  const views: View[] = [];
  const byId = new Map<string, View>();
  for (const commit of [...model.commits.values()].sort((a, b) => a.seq - b.seq)) {
    const labelled =
      showCommitLabel &&
      commit.type !== commitType.CHERRY_PICK &&
      (commit.type !== commitType.MERGE || commit.customId === true);
    const tags: Label[] = [];
    for (const tag of commit.tags) {
      const label = plainLabel(tag, measurer, small, 4000);
      if (label.lines.length > 0) tags.push(label);
    }
    const view: View = {
      commit,
      index: views.length,
      lane: laneOf.get(commit.branch) ?? 0,
      m: 0,
      label: labelled ? plainLabel(commit.id, measurer, small, 4000) : undefined,
      tags,
    };
    views.push(view);
    byId.set(commit.id, view);
  }

  // Room each commit needs: along the main axis on either side, and across it towards the
  // previous lane (`lo`) and the next one (`hi`). Tags sit on one side of a lane and ids on the other.
  const half = new Float64Array(views.length);
  const tagHalf = new Float64Array(views.length);
  const lo = new Float64Array(laneCount).fill(DOT);
  const hi = new Float64Array(laneCount).fill(DOT);
  views.forEach((view, k) => {
    const { label, tags } = view;
    let tagsMain = 0;
    let tagsCross = 0;
    for (const tag of tags) {
      const w = tagWidth(tag);
      if (vertical) {
        tagsMain = Math.max(tagsMain, tag.height);
        tagsCross += w + 4;
      } else {
        tagsMain = Math.max(tagsMain, w);
        tagsCross += tag.height + 3;
      }
    }
    let labelMain = 0;
    let labelCross = 0;
    if (label !== undefined && label.lines.length > 0) {
      if (rotate) {
        labelCross = 3 + HALF * (label.width + label.height);
      } else {
        labelMain = vertical ? label.height : label.width;
        labelCross = 6 + (vertical ? label.width : label.height);
      }
    }
    half[k] = Math.max(DOT, tagsMain / 2, labelMain / 2);
    tagHalf[k] = tagsMain / 2;
    const tagSide = DOT + (tags.length > 0 ? TAG_GAP + tagsCross : 0);
    const labelSide = DOT + labelCross;
    const lane = view.lane;
    lo[lane] = Math.max(lo[lane], vertical ? labelSide : tagSide);
    hi[lane] = Math.max(hi[lane], vertical ? tagSide : labelSide);
  });

  // In a left-to-right graph the tags stand over their commit. A connector that comes down from
  // a lane above joins the commit's lane this far before the commit, clear of the tags, and the
  // commit is placed far enough along to leave room for that.
  const lead = new Float64Array(views.length);
  if (!vertical) {
    views.forEach((view, k) => {
      if (tagHalf[k] === 0) return;
      for (const id of view.commit.parents) {
        const parent = byId.get(id);
        if (parent !== undefined && parent.lane < view.lane) lead[k] = tagHalf[k] + 4;
      }
    });
  }
  const space = (p: number, k: number): number =>
    Math.max(STEP, half[p] + half[k] + GAP, lead[k] > 0 ? half[p] + CURVE + lead[k] : 0);

  views.forEach((view, k) => {
    if (!parallel) {
      view.m = k === 0 ? 0 : views[k - 1].m + space(k - 1, k);
      return;
    }
    // Mermaid's `parallelCommits`: a commit sits one step after its furthest parent, so branches
    // that grow side by side share positions instead of taking turns.
    let m = 0;
    for (const id of view.commit.parents) {
      const parent = byId.get(id);
      if (parent === undefined || parent.index >= k) continue;
      m = Math.max(m, parent.m + space(parent.index, k));
    }
    view.m = m;
  });
  let end = 0;
  for (const view of views) end = Math.max(end, view.m);

  const cross = new Float64Array(laneCount);
  for (let i = 0; i < laneCount; i++) {
    const name = names[i];
    const reach = name.lines.length === 0 ? 0 : vertical ? name.width / 2 + 8 : name.height / 2 + 2;
    lo[i] = Math.max(lo[i], reach);
    hi[i] = Math.max(hi[i], reach);
    if (i > 0) cross[i] = cross[i - 1] + Math.max(LANE, hi[i - 1] + lo[i] + GAP);
  }

  const px = (m: number, c: number): number => (vertical ? c : m);
  const py = (m: number, c: number): number => (vertical ? (flip ? -m : m) : c);
  const point = (m: number, c: number): string => `${num(px(m, c))},${num(py(m, c))}`;

  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  const grow = (x0: number, y0: number, x1: number, y1: number): void => {
    if (x0 < minX) minX = x0;
    if (y0 < minY) minY = y0;
    if (x1 > maxX) maxX = x1;
    if (y1 > maxY) maxY = y1;
  };

  let branches = '';
  if (showBranches) {
    for (let i = 0; i < laneCount; i++) {
      const name = names[i];
      const color = seriesColor(i);
      const c = cross[i];
      const w = name.width + 16;
      const h = name.height + 4;
      const from = name.lines.length === 0 ? -LABEL_GAP : -LABEL_GAP - (vertical ? h : w);
      const cx = px(from + (vertical ? h : w) / 2, c);
      const cy = py(from + (vertical ? h : w) / 2, c);
      grow(px(-LABEL_GAP, c), py(-LABEL_GAP, c), px(-LABEL_GAP, c), py(-LABEL_GAP, c));
      grow(px(end + TAIL, c), py(end + TAIL, c), px(end + TAIL, c), py(end + TAIL, c));
      branches +=
        `<g class="pele-branch" data-id="${escText(model.lanes[i])}">` +
        `<path class="pele-lane" d="M${point(-LABEL_GAP, c)}L${point(end + TAIL, c)}" stroke="${color}" stroke-dasharray="2 4"/>`;
      if (name.lines.length > 0) {
        grow(cx - w / 2, cy - h / 2, cx + w / 2, cy + h / 2);
        branches +=
          `<rect x="${num(cx - w / 2)}" y="${num(cy - h / 2)}" width="${num(w)}" height="${num(h)}" fill="${color}"${ROUNDED}/>` +
          labelSvg(name, cx, cy, ' class="pele-label" fill="var(--_bg)"');
      }
      branches += '</g>';
    }
  }

  // Positions of the commits on each lane, to tell whether a connector may run along it.
  const taken: number[][] = Array.from({ length: laneCount }, () => []);
  for (const view of views) taken[view.lane].push(view.m);
  if (parallel) for (const list of taken) list.sort((a, b) => a - b);
  const busy = (lane: number, from: number, to: number): boolean => {
    const list = taken[lane];
    let low = 0;
    let high = list.length;
    while (low < high) {
      const mid = (low + high) >> 1;
      if (list[mid] <= from) low = mid + 1;
      else high = mid;
    }
    return low < list.length && list[low] < to;
  };

  let curves = '';
  let lines = '';
  for (const view of views) {
    const { commit } = view;
    const c2 = cross[view.lane];
    const m2 = view.m;
    for (let j = 0; j < commit.parents.length; j++) {
      const parent = byId.get(commit.parents[j]);
      if (parent === undefined || parent === view) continue;
      const c1 = cross[parent.lane];
      const m1 = parent.m;
      if (parent.lane === view.lane) {
        lines += `<path class="pele-edge" d="M${point(m1, c1)}L${point(m2, c2)}" stroke="${seriesColor(view.lane)}"/>`;
        continue;
      }
      const merged = j > 0 && commit.type === commitType.MERGE;
      const picked = j > 0 && !merged;
      let d = `M${point(m1, c1)}`;
      if (m2 <= m1) {
        const mid = (m1 + m2) / 2;
        d += `C${point(mid, c1)} ${point(mid, c2)} ${point(m2, c2)}`;
      } else if (!merged && !busy(view.lane, m1, m2)) {
        // Leaves the parent at once and runs along the child's lane.
        const s = Math.min(CURVE, m2 - m1);
        d += `C${point(m1 + s / 2, c1)} ${point(m1 + s / 2, c2)} ${point(m1 + s, c2)}L${point(m2, c2)}`;
      } else {
        // Turns in just before the child, or before its tags when it comes from their side.
        const to = parent.lane < view.lane && m2 - lead[view.index] > m1 ? m2 - lead[view.index] : m2;
        let s = Math.min(CURVE, to - m1);
        let along = c1;
        if (!merged || busy(parent.lane, m1, m2)) {
          // Neither lane is free to run along. Between two lanes, past the ids of one and before
          // the tags of the next, a strip stays empty, and the connector takes that.
          along = c1 > c2 ? c2 + hi[view.lane] + GAP / 2 : c2 - lo[view.lane] - GAP / 2;
          s = Math.min(CURVE, (to - m1) / 2);
          d += `C${point(m1 + s / 2, c1)} ${point(m1 + s / 2, along)} ${point(m1 + s, along)}`;
        }
        d += `L${point(to - s, along)}C${point(to - s / 2, along)} ${point(to - s / 2, c2)} ${point(to, c2)}`;
        if (to < m2) d += `L${point(m2, c2)}`;
      }
      curves +=
        `<path class="pele-edge${merged ? ' pele-edge-merge' : picked ? ' pele-edge-cherry-pick' : ''}" d="${d}" ` +
        `stroke="${seriesColor(merged ? parent.lane : view.lane)}"${picked ? ' stroke-dasharray="4 3"' : ''}/>`;
    }
  }

  let commits = '';
  for (const view of views) {
    const { commit, label, tags } = view;
    const x = px(view.m, cross[view.lane]);
    const y = py(view.m, cross[view.lane]);
    const type = commit.customType ?? commit.type;
    grow(x - DOT - 1, y - DOT - 1, x + DOT + 1, y + DOT + 1);
    // Merges and cherry-picks carry a message Mermaid makes up; only a written one is worth showing.
    const written = commit.type < commitType.MERGE && commit.message !== '';
    let body = written ? `<title>${escText(commit.message)}</title>` : '';
    body += symbol(type, x, y, seriesColor(view.lane));

    if (label !== undefined && label.lines.length > 0) {
      const w = label.width;
      const h = label.height;
      const back = (cx: number, cy: number): string =>
        `<rect x="${num(cx - w / 2 - 2)}" y="${num(cy - h / 2 + 2)}" width="${num(w + 4)}" height="${num(h - 4)}" rx="3" fill="var(--_bg)"/>`;
      if (rotate) {
        // The text ends beside the commit and trails back the way the history came.
        const k = (HALF * h) / 2;
        const ax = vertical ? x - DOT - 3 - k : x + 3;
        const ay = vertical ? y : y + DOT + 3 + k;
        const reach = HALF * w + k;
        grow(ax - reach, flip ? ay - reach : ay - k, ax + k, flip ? ay + k : ay + reach);
        body +=
          `<g class="pele-commit-label" transform="rotate(${flip ? 45 : -45} ${num(ax)} ${num(ay)})">` +
          back(ax - w / 2, ay) +
          labelSvg(label, ax - w / 2, ay, '') +
          '</g>';
      } else {
        const cx = vertical ? x - DOT - 6 - w / 2 : x;
        const cy = vertical ? y : y + DOT + 6 + h / 2;
        grow(cx - w / 2, cy - h / 2, cx + w / 2, cy + h / 2);
        body += `<g class="pele-commit-label">${back(cx, cy)}${labelSvg(label, cx, cy, '')}</g>`;
      }
    }

    // Beside the lane the tags form a row; above it they stack, the first one furthest out.
    let offset = DOT + TAG_GAP;
    for (let t = vertical ? 0 : tags.length - 1; t >= 0 && t < tags.length; t += vertical ? 1 : -1) {
      const tag = tags[t];
      const w = tagWidth(tag);
      const h = tag.height;
      const left = vertical ? x + offset : x - w / 2;
      const cy = vertical ? y : y - offset - h / 2;
      offset += vertical ? w + 4 : h + 3;
      grow(left, cy - h / 2, left + w, cy + h / 2);
      body +=
        '<g class="pele-tag">' +
        `<path d="M${num(left)},${num(cy)}L${num(left + NOTCH)},${num(cy - h / 2)}H${num(left + w)}V${num(cy + h / 2)}H${num(left + NOTCH)}Z" fill="var(--_s)" stroke="var(--_b)" stroke-linejoin="round"/>` +
        `<circle cx="${num(left + NOTCH)}" cy="${num(cy)}" r="1.5" fill="var(--_b)"/>` +
        labelSvg(tag, left + NOTCH + 4 + tag.width / 2, cy, ' fill="var(--_fg)"') +
        '</g>';
    }

    const merge = commit.type === commitType.MERGE && type !== commitType.MERGE ? ' pele-commit-merge' : '';
    commits += `<g class="pele-commit pele-commit-${CLASSES[type] ?? CLASSES[0]}${merge}" data-id="${escText(commit.id)}">${body}</g>`;
  }

  if (minX > maxX) grow(0, 0, 0, 0);
  const title = layoutLabel(model.title, false, measurer, size, 4000, Style.Bold);
  const titleHeight = title.height > 0 ? title.height + 16 : 0;
  const inner = Math.max(maxX - minX, title.width);
  const width = Math.ceil(inner + 2 * pad);
  const height = Math.ceil(maxY - minY + titleHeight + 2 * pad);
  const dx = pad - minX + (inner - (maxX - minX)) / 2;
  const dy = pad + titleHeight - minY;

  const content =
    labelSvg(title, width / 2, pad + title.height / 2, ' class="pele-title" font-weight="var(--_tw)"') +
    `<g transform="translate(${num(dx)},${num(dy)})">` +
    (branches ? `<g class="pele-branches" fill="none" font-size="${medium}">${branches}</g>` : '') +
    (curves || lines ? `<g class="pele-edges" fill="none" stroke-width="2" stroke-linecap="round">${curves}${lines}</g>` : '') +
    (commits ? `<g class="pele-commits" font-size="${small}" fill="var(--_m)">${commits}</g>` : '') +
    '</g>';

  return {
    svg: svgDocument('gitGraph', width, height, size, options, model, content),
    width,
    height,
    links: [],
  };
}
