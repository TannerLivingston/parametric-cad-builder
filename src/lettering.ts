// A small lettering of its own, for engraving, so that a config gives the same solids everywhere
// with no font file to load. Letters are single lines drawn with a round nib, like an engraving
// machine's, which also means no thin parts for the printer to lose. Each is worked out here as
// plain outlines, so the validator knows exactly how much room a label takes.
//
// No trig functions, for the same reason as the matrices in printing.ts.
type Point = readonly [number, number];
type Line = Point[];

export interface GlyphOutline {
  outers: Point[][]; // counterclockwise
  holes: Point[][]; // what stays inside a letter, like the middle of an O
}

export interface TextOutline {
  glyphs: GlyphOutline[];
  width: number;
  height: number;
}

export const MIN_NIB = 0.6; // what prints reliably from a 0.4 mm nozzle
const NIB_RATIO = 0.14;
const LETTER_GAP = 0.2; // between letters, for a capital 1 high
const WORD_GAP = 0.75;
const EPSILON = 1e-7;

// Unit vectors at 22.5 degree steps, from +x and counterclockwise.
const S = 0.3826834323650898;
const C = 0.9238795325112867;
const D = Math.SQRT1_2;
const ROUND: Point[] = [[1, 0], [C, S], [D, D], [S, C], [0, 1], [-S, C], [-D, D], [-C, S], [-1, 0], [-C, -S], [-D, -D], [-S, -C], [0, -1], [S, -C], [D, -D], [C, -S]];

// Part of an oval. Steps are of 22.5 degrees, from +x and counterclockwise, going either way.
function arc(cx: number, cy: number, rx: number, ry: number, from: number, to: number): Line {
  const step = to >= from ? 1 : -1;
  const points: Line = [];
  for (let i = from; i !== to + step; i += step) {
    const [x, y] = ROUND[((i % 16) + 16) % 16]!;
    points.push([cx + rx * x, cy + ry * y]);
  }
  return points;
}

const oval = (cx: number, cy: number, rx: number, ry: number): Line => arc(cx, cy, rx, ry, 0, 16);

const GLYPHS: Record<string, { width: number; lines: Line[] }> = {
  A: { width: 0.7, lines: [[[0, 0], [0.35, 1], [0.7, 0]], [[0.1225, 0.35], [0.5775, 0.35]]] },
  B: { width: 0.6, lines: [[[0, 0], [0, 1], [0.32, 1], ...arc(0.32, 0.76, 0.24, 0.24, 4, -4), [0, 0.52]], [[0.32, 0.52], ...arc(0.32, 0.26, 0.28, 0.26, 4, -4), [0, 0]]] },
  C: { width: 0.66, lines: [arc(0.36, 0.5, 0.36, 0.5, 2, 14)] },
  D: { width: 0.64, lines: [[[0, 0], [0, 1], [0.24, 1], ...arc(0.24, 0.5, 0.4, 0.5, 4, -4), [0, 0]]] },
  E: { width: 0.54, lines: [[[0.54, 1], [0, 1], [0, 0], [0.54, 0]], [[0, 0.52], [0.44, 0.52]]] },
  F: { width: 0.52, lines: [[[0.52, 1], [0, 1], [0, 0]], [[0, 0.52], [0.42, 0.52]]] },
  G: { width: 0.7, lines: [[...arc(0.36, 0.5, 0.36, 0.5, 2, 14), [0.7, 0.14], [0.7, 0.44], [0.42, 0.44]]] },
  H: { width: 0.62, lines: [[[0, 0], [0, 1]], [[0.62, 0], [0.62, 1]], [[0, 0.52], [0.62, 0.52]]] },
  I: { width: 0, lines: [[[0, 0], [0, 1]]] },
  J: { width: 0.46, lines: [[[0.46, 1], ...arc(0.23, 0.23, 0.23, 0.23, 0, -8)]] },
  K: { width: 0.6, lines: [[[0, 0], [0, 1]], [[0.56, 1], [0, 0.36]], [[0.21, 0.6], [0.6, 0]]] },
  L: { width: 0.5, lines: [[[0, 1], [0, 0], [0.5, 0]]] },
  M: { width: 0.8, lines: [[[0, 0], [0, 1], [0.4, 0.3], [0.8, 1], [0.8, 0]]] },
  N: { width: 0.64, lines: [[[0, 0], [0, 1], [0.64, 0], [0.64, 1]]] },
  O: { width: 0.72, lines: [oval(0.36, 0.5, 0.36, 0.5)] },
  P: { width: 0.58, lines: [[[0, 0], [0, 1], [0.32, 1], ...arc(0.32, 0.73, 0.26, 0.27, 4, -4), [0, 0.46]]] },
  Q: { width: 0.72, lines: [oval(0.36, 0.5, 0.36, 0.5), [[0.42, 0.24], [0.72, 0]]] },
  R: { width: 0.62, lines: [[[0, 0], [0, 1], [0.32, 1], ...arc(0.32, 0.73, 0.26, 0.27, 4, -4), [0, 0.46]], [[0.32, 0.46], [0.62, 0]]] },
  S: { width: 0.6, lines: [[...arc(0.3, 0.75, 0.27, 0.25, 2, 12), ...arc(0.3, 0.25, 0.3, 0.25, 4, -6)]] },
  T: { width: 0.6, lines: [[[0, 1], [0.6, 1]], [[0.3, 1], [0.3, 0]]] },
  U: { width: 0.62, lines: [[[0, 1], ...arc(0.31, 0.31, 0.31, 0.31, 8, 16), [0.62, 1]]] },
  V: { width: 0.68, lines: [[[0, 1], [0.34, 0], [0.68, 1]]] },
  W: { width: 0.96, lines: [[[0, 1], [0.24, 0], [0.48, 0.7], [0.72, 0], [0.96, 1]]] },
  X: { width: 0.64, lines: [[[0, 0], [0.64, 1]], [[0, 1], [0.64, 0]]] },
  Y: { width: 0.66, lines: [[[0, 1], [0.33, 0.46], [0.66, 1]], [[0.33, 0.46], [0.33, 0]]] },
  Z: { width: 0.6, lines: [[[0, 1], [0.6, 1], [0, 0], [0.6, 0]]] },
  "0": { width: 0.6, lines: [oval(0.3, 0.5, 0.3, 0.5)] },
  "1": { width: 0.26, lines: [[[0, 0.78], [0.26, 1], [0.26, 0]]] },
  "2": { width: 0.58, lines: [[...arc(0.28, 0.72, 0.28, 0.28, 8, -2), [0, 0], [0.58, 0]]] },
  "3": { width: 0.56, lines: [[...arc(0.27, 0.76, 0.26, 0.24, 7, -4), ...arc(0.27, 0.26, 0.29, 0.26, 4, -7)]] },
  "4": { width: 0.62, lines: [[[0.46, 0], [0.46, 1], [0, 0.28], [0.62, 0.28]]] },
  "5": { width: 0.58, lines: [[[0.52, 1], [0.08, 1], [0.04, 0.56], ...arc(0.27, 0.32, 0.31, 0.32, 5, -7)]] },
  "6": { width: 0.6, lines: [[[0.46, 1], [0.05, 0.44]], oval(0.3, 0.3, 0.3, 0.3)] },
  "7": { width: 0.56, lines: [[[0, 1], [0.56, 1], [0.16, 0]]] },
  "8": { width: 0.6, lines: [oval(0.3, 0.76, 0.26, 0.24), oval(0.3, 0.26, 0.3, 0.26)] },
  "9": { width: 0.6, lines: [[[0.14, 0], [0.55, 0.56]], oval(0.3, 0.7, 0.3, 0.3)] },
  ".": { width: 0, lines: [[[0, 0], [0, 0.02]]] },
  ",": { width: 0.08, lines: [[[0.08, 0.04], [0, -0.14]]] },
  ":": { width: 0, lines: [[[0, 0.14], [0, 0.16]], [[0, 0.74], [0, 0.76]]] },
  "-": { width: 0.36, lines: [[[0, 0.48], [0.36, 0.48]]] },
  "+": { width: 0.52, lines: [[[0, 0.48], [0.52, 0.48]], [[0.26, 0.22], [0.26, 0.74]]] },
  "=": { width: 0.5, lines: [[[0, 0.34], [0.5, 0.34]], [[0, 0.62], [0.5, 0.62]]] },
  "/": { width: 0.46, lines: [[[0, 0], [0.46, 1]]] },
  "(": { width: 0.2, lines: [arc(0.5, 0.5, 0.5, 0.56, 6, 10)] },
  ")": { width: 0.2, lines: [arc(-0.3, 0.5, 0.5, 0.56, 2, -2)] },
  "'": { width: 0, lines: [[[0, 0.76], [0, 1]]] },
  "!": { width: 0, lines: [[[0, 0.3], [0, 1]], [[0, 0], [0, 0.02]]] },
  "?": { width: 0.52, lines: [[...arc(0.26, 0.74, 0.26, 0.26, 8, -3), [0.26, 0.3]], [[0.26, 0], [0.26, 0.02]]] },
  "#": { width: 0.78, lines: [[[0.14, 0], [0.24, 1]], [[0.52, 0], [0.62, 1]], [[0, 0.34], [0.76, 0.34]], [[0.02, 0.66], [0.78, 0.66]]] },
  "&": { width: 0.68, lines: [[[0.68, 0], [0.14, 0.66], ...arc(0.28, 0.8, 0.17, 0.2, 8, 0), [0.45, 0.8], [0.08, 0.34], ...arc(0.26, 0.2, 0.26, 0.2, 7, 14), [0.66, 0.34]]] },
};

const glyphOf = (char: string) => GLYPHS[char.toUpperCase()];

// What a label can't say, for telling the user.
export function unsupportedCharacters(text: string): string[] {
  return [...new Set([...text].filter((char) => char !== " " && !glyphOf(char)))];
}

export function nibFor(size: number): number {
  return Math.max(MIN_NIB, size * NIB_RATIO);
}

interface Graph {
  points: Point[];
  neighbours: number[][];
}

// Lines that cross or touch become one graph, so that an outline can be walked around them.
function graphOf(lines: Line[]): Graph {
  const segments = lines.flatMap((line) => line.slice(1).map((point, i): [Point, Point] => [line[i]!, point])).filter(([a, b]) => Math.hypot(a[0] - b[0], a[1] - b[1]) > EPSILON);
  const splits = segments.map((): number[] => [0, 1]);
  segments.forEach(([a, b], i) => {
    for (let j = i + 1; j < segments.length; j++) {
      const [c, d] = segments[j]!;
      const ux = b[0] - a[0];
      const uy = b[1] - a[1];
      const vx = d[0] - c[0];
      const vy = d[1] - c[1];
      const cross = ux * vy - uy * vx;
      if (Math.abs(cross) < EPSILON) continue;
      const t = ((c[0] - a[0]) * vy - (c[1] - a[1]) * vx) / cross;
      const u = ((c[0] - a[0]) * uy - (c[1] - a[1]) * ux) / cross;
      if (t > -EPSILON && t < 1 + EPSILON && u > -EPSILON && u < 1 + EPSILON) {
        splits[i]!.push(t);
        splits[j]!.push(u);
      }
    }
  });
  const points: Point[] = [];
  const neighbours: number[][] = [];
  const ids = new Map<string, number>();
  const idOf = (x: number, y: number) => {
    const key = `${Math.round(x * 1e5)},${Math.round(y * 1e5)}`;
    let id = ids.get(key);
    if (id === undefined) {
      id = points.length;
      ids.set(key, id);
      points.push([x, y]);
      neighbours.push([]);
    }
    return id;
  };
  segments.forEach(([a, b], i) => {
    const along = [...splits[i]!].sort((p, q) => p - q);
    along.slice(1).forEach((to, k) => {
      const from = along[k]!;
      const p = idOf(a[0] + (b[0] - a[0]) * from, a[1] + (b[1] - a[1]) * from);
      const q = idOf(a[0] + (b[0] - a[0]) * to, a[1] + (b[1] - a[1]) * to);
      if (p === q || neighbours[p]!.includes(q)) return;
      neighbours[p]!.push(q);
      neighbours[q]!.push(p);
    });
  });
  return { points, neighbours };
}

// A direction's place around a circle, from 0 to 4, without an angle.
function bearing(x: number, y: number): number {
  const p = x / (Math.abs(x) + Math.abs(y));
  return y >= 0 ? 1 - p : 3 + p;
}

const unit = (a: Point, b: Point): Point => {
  const length = Math.hypot(b[0] - a[0], b[1] - a[1]);
  return [(b[0] - a[0]) / length, (b[1] - a[1]) / length];
};

// Walks around a graph at half the nib's width, with the ink on the left, so that outsides come
// out counterclockwise and the insides of letters clockwise.
function walkOutlines({ points, neighbours }: Graph, r: number): Point[][] {
  const around = neighbours.map((list, id) => [...list].sort((p, q) => {
    const a = unit(points[id]!, points[p]!);
    const b = unit(points[id]!, points[q]!);
    return bearing(a[0], a[1]) - bearing(b[0], b[1]);
  }));
  const seen = new Set<string>();
  const loops: Point[][] = [];
  neighbours.forEach((list, start) => {
    for (const first of list) {
      if (seen.has(`${start}>${first}`)) continue;
      const loop: Point[] = [];
      let from = start;
      let to = first;
      while (!seen.has(`${from}>${to}`)) {
        seen.add(`${from}>${to}`);
        const list = around[to]!;
        const next = list[(list.indexOf(from) + 1) % list.length]!;
        const v = points[to]!;
        const d1 = unit(points[from]!, v);
        const d2 = unit(v, points[next]!);
        const n1: Point = [d1[1], -d1[0]];
        const n2: Point = [d2[1], -d2[0]];
        const add = (x: number, y: number) => loop.push([v[0] + r * x, v[1] + r * y]);
        const turn = d1[0] * d2[1] - d1[1] * d2[0];
        const straight = d1[0] * d2[0] + d1[1] * d2[1];
        if (next === from) {
          add(n1[0], n1[1]);
          add(n1[0] * D + d1[0] * D, n1[1] * D + d1[1] * D);
          add(d1[0], d1[1]);
          add(-n1[0] * D + d1[0] * D, -n1[1] * D + d1[1] * D);
          add(-n1[0], -n1[1]);
        } else if (turn > 0 && straight < 0.5) {
          // A sharp corner on the outside, which is rounded off rather than left as a spike.
          const mx = n1[0] + n2[0];
          const my = n1[1] + n2[1];
          const middle = Math.hypot(mx, my);
          add(n1[0], n1[1]);
          if (middle > EPSILON) add(mx / middle, my / middle);
          add(n2[0], n2[1]);
        } else {
          const scale = 1 + n1[0] * n2[0] + n1[1] * n2[1];
          add((n1[0] + n2[0]) / scale, (n1[1] + n2[1]) / scale);
        }
        from = to;
        to = next;
      }
      loops.push(loop);
    }
  });
  return loops;
}

// Where one edge of an outline crosses another, as happens inside a tight corner.
function crossing(a: Point, b: Point, c: Point, d: Point): Point | null {
  const ux = b[0] - a[0];
  const uy = b[1] - a[1];
  const vx = d[0] - c[0];
  const vy = d[1] - c[1];
  const cross = ux * vy - uy * vx;
  if (Math.abs(cross) < 1e-12) return null;
  const t = ((c[0] - a[0]) * vy - (c[1] - a[1]) * vx) / cross;
  const u = ((c[0] - a[0]) * uy - (c[1] - a[1]) * ux) / cross;
  return t > 1e-9 && t < 1 - 1e-9 && u > 1e-9 && u < 1 - 1e-9 ? [a[0] + ux * t, a[1] + uy * t] : null;
}

const loopArea = (loop: Point[]) => loop.reduce((sum, [x, y], i) => {
  const [nx, ny] = loop[(i + 1) % loop.length]!;
  return sum + x * ny - nx * y;
}, 0) / 2;

// Cuts off the little loops that walking makes where a corner is tighter than the nib, and leaves
// the longer way around each time.
function untangled(loop: Point[]): Point[] {
  let points = loop;
  for (let changed = true; changed; ) {
    changed = false;
    const n = points.length;
    search: for (let i = 0; i < n; i++) {
      for (let j = i + 2; j < n; j++) {
        if (i === 0 && j === n - 1) continue;
        const at = crossing(points[i]!, points[(i + 1) % n]!, points[j]!, points[(j + 1) % n]!);
        if (!at) continue;
        const inner = points.slice(i + 1, j + 1);
        const outer = [...points.slice(j + 1), ...points.slice(0, i + 1)];
        const keep = Math.abs(loopArea([at, ...inner])) > Math.abs(loopArea([at, ...outer])) ? inner : outer;
        points = [at, ...keep];
        changed = true;
        break search;
      }
    }
  }
  return points.filter((point, i) => {
    const next = points[(i + 1) % points.length]!;
    return Math.hypot(point[0] - next[0], point[1] - next[1]) > 1e-4;
  });
}

const cache = new Map<string, GlyphOutline>();

// A letter's outlines, with its capital height in `height` and its lines drawn with a nib `nib` wide.
function glyphOutline(char: string, height: number, nib: number): GlyphOutline {
  const key = `${char}|${height}|${nib}`;
  const known = cache.get(key);
  if (known) return known;
  const glyph = glyphOf(char)!;
  const lines = glyph.lines.map((line) => line.map(([x, y]): Point => [x * height, y * height]));
  const loops = walkOutlines(graphOf(lines), nib / 2).map(untangled).filter((loop) => Math.abs(loopArea(loop)) > (nib * nib) / 16);
  const outline = { outers: loops.filter((loop) => loopArea(loop) > 0), holes: loops.filter((loop) => loopArea(loop) < 0) };
  cache.set(key, outline);
  return outline;
}

// A line of text, centred on the origin. `size` is how tall a capital comes out.
export function textOutline(text: string, size: number): TextOutline {
  const nib = nibFor(size);
  const height = size - nib;
  const placed: GlyphOutline[] = [];
  let pen = 0;
  const chars = [...text.trim()];
  chars.forEach((char, i) => {
    if (char === " ") {
      pen += WORD_GAP * height;
      return;
    }
    const glyph = glyphOf(char)!;
    const { outers, holes } = glyphOutline(char, height, nib);
    const moved = (loop: Point[]) => loop.map(([x, y]): Point => [x + pen, y]);
    placed.push({ outers: outers.map(moved), holes: holes.map(moved) });
    pen += glyph.width * height;
    if (chars[i + 1] !== " " && i + 1 < chars.length) pen += LETTER_GAP * height + nib;
    else if (i + 1 < chars.length) pen += nib;
  });
  const all = placed.flatMap((glyph) => glyph.outers.flat());
  const xs = all.map((p) => p[0]);
  const ys = all.map((p) => p[1]);
  const [xLow, xHigh, yLow, yHigh] = all.length ? [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)] : [0, 0, 0, 0];
  const cx = (xLow + xHigh) / 2;
  // Centred on the capital's height, so that a comma doesn't move the line.
  const cy = height / 2;
  const centred = (loop: Point[]) => loop.map(([x, y]): Point => [x - cx, y - cy]);
  return {
    glyphs: placed.map((glyph) => ({ outers: glyph.outers.map(centred), holes: glyph.holes.map(centred) })),
    width: xHigh - xLow,
    height: Math.max(size, yHigh - yLow),
  };
}
