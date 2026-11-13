// A wall that bows outward, seen from above: an arc from corner to corner, furthest out at the
// middle. Everything in it is placed against the square inside, as before, and the engine hollows the
// wall behind its curve, leaving it solid where things are fixed to it. A front or rear bow carries
// the top out along its slope; a left or right one carries the side profile out as it is.
import type { PathStep, Point2, Profile } from "./profile.js";

export interface Bow {
  front: number; // how far out the middle of the wall is, in mm
  rear: number;
  left: number;
  right: number;
}

export const MIN_BOW = 0.5; // less is as good as straight
export const MAX_BOW = 20; // the furthest out a wall can bow
export const MAX_BOW_OF_WIDTH = 1 / 8; // of the wall's length, which keeps it under 30 degrees off straight at its ends

export const hasBow = (bow: Bow) => bow.front > 0 || bow.rear > 0 || bow.left > 0 || bow.right > 0;
export const hasSideBow = (bow: Pick<Bow, "left" | "right">) => bow.left > 0 || bow.right > 0;

// How far out a bowed wall is at x along it, for a wall `width` long.
export function bowAt(width: number, bow: number, x: number): number {
  if (bow <= 0) return 0;
  const radius = (width * width / 4 + bow * bow) / (2 * bow);
  const across = x - width / 2;
  return Math.max(0, bow - radius + Math.sqrt(Math.max(radius * radius - across * across, 0)));
}

// The point on a circle halfway between two others on it, without trig: see buildSurfaces.
function arcMiddle(center: Point2, radius: number, a: Point2, b: Point2): Point2 {
  const dx = (a[0] + b[0]) / 2 - center[0];
  const dy = (a[1] + b[1]) / 2 - center[1];
  const length = Math.sqrt(dx * dx + dy * dy);
  return [center[0] + (dx / length) * radius, center[1] + (dy / length) * radius];
}

// A wall seen from above: straight, along a line with its outward normal, or bowed, an arc of a
// circle whose middle is `apex`.
type Wall =
  | { kind: "line"; normal: Point2; offset: number } // the points p with normal . p = offset
  | { kind: "arc"; centre: Point2; radius: number; apex: Point2 };

function wallOf(from: Point2, to: Point2, normal: Point2, bow: number): Wall {
  if (bow <= 0) return { kind: "line", normal, offset: normal[0] * from[0] + normal[1] * from[1] };
  const half = Math.hypot(to[0] - from[0], to[1] - from[1]) / 2;
  const radius = (half * half + bow * bow) / (2 * bow);
  const middle: Point2 = [(from[0] + to[0]) / 2, (from[1] + to[1]) / 2];
  const apex: Point2 = [middle[0] + normal[0] * bow, middle[1] + normal[1] * bow];
  return { kind: "arc", centre: [apex[0] - normal[0] * radius, apex[1] - normal[1] * radius], radius, apex };
}

// The same wall moved in by `by`.
function inset(wall: Wall, by: number): Wall {
  return wall.kind === "line" ? { ...wall, offset: wall.offset - by } : { ...wall, radius: wall.radius - by };
}

const nearest = (points: Point2[], to: Point2) => points.reduce((best, p) => (Math.hypot(p[0] - to[0], p[1] - to[1]) < Math.hypot(best[0] - to[0], best[1] - to[1]) ? p : best));

// Where two walls meet, nearest the corner they'd make if straight.
function meet(a: Wall, b: Wall, corner: Point2): Point2 {
  if (a.kind === "line" && b.kind === "line") {
    const det = a.normal[0] * b.normal[1] - a.normal[1] * b.normal[0];
    return [(a.offset * b.normal[1] - b.offset * a.normal[1]) / det, (a.normal[0] * b.offset - b.normal[0] * a.offset) / det];
  }
  if (a.kind === "arc" && b.kind === "arc") {
    const [dx, dy] = [b.centre[0] - a.centre[0], b.centre[1] - a.centre[1]];
    const d = Math.hypot(dx, dy);
    const along = (a.radius * a.radius - b.radius * b.radius + d * d) / (2 * d);
    const h = Math.sqrt(Math.max(a.radius * a.radius - along * along, 0));
    const base: Point2 = [a.centre[0] + (dx / d) * along, a.centre[1] + (dy / d) * along];
    return nearest([[base[0] - (dy / d) * h, base[1] + (dx / d) * h], [base[0] + (dy / d) * h, base[1] - (dx / d) * h]], corner);
  }
  const [line, arc] = (a.kind === "line" ? [a, b] : [b, a]) as [Extract<Wall, { kind: "line" }>, Extract<Wall, { kind: "arc" }>];
  const [nx, ny] = line.normal;
  const distance = line.offset - (nx * arc.centre[0] + ny * arc.centre[1]);
  const foot: Point2 = [arc.centre[0] + nx * distance, arc.centre[1] + ny * distance];
  const h = Math.sqrt(Math.max(arc.radius * arc.radius - distance * distance, 0));
  return nearest([[foot[0] - ny * h, foot[1] + nx * h], [foot[0] + ny * h, foot[1] - nx * h]], corner);
}

// Where a round centred at `centre` touches a wall.
function touch(wall: Wall, centre: Point2, round: number): Point2 {
  if (wall.kind === "arc") {
    const [dx, dy] = [centre[0] - wall.centre[0], centre[1] - wall.centre[1]];
    const scale = wall.radius / Math.hypot(dx, dy);
    return [wall.centre[0] + dx * scale, wall.centre[1] + dy * scale];
  }
  // Square to an axis, so a straight wall's point is exactly on it.
  const [nx, ny] = wall.normal;
  // And never -0, which is the same place but not the same number.
  return nx === 0 ? [centre[0], wall.offset / ny + 0] : ny === 0 ? [wall.offset / nx + 0, centre[1]] : [centre[0] + nx * round, centre[1] + ny * round];
}

// The enclosure's outline seen from above, as a closed path in x and y: the left wall up to the
// front, the front left to right, the right wall, the rear right to left, and back down the left.
// Each corner's round runs smoothly into the walls either side, bowed or not. Each outline starts
// from its own last point, so the first step is the left wall.
export function planOutline(width: number, depth: number, radius: number, bow: Partial<Bow>): PathStep[] {
  const corners: Point2[] = [[0, 0], [width, 0], [width, depth], [0, depth]];
  const walls = [
    wallOf(corners[0]!, corners[1]!, [0, -1], bow.front ?? 0),
    wallOf(corners[1]!, corners[2]!, [1, 0], bow.right ?? 0),
    wallOf(corners[2]!, corners[3]!, [0, 1], bow.rear ?? 0),
    wallOf(corners[3]!, corners[0]!, [-1, 0], bow.left ?? 0),
  ];
  // Corner i is where wall i - 1 ends and wall i starts.
  const rounds = corners.map((corner, i) => {
    const before = walls[(i + 3) % 4]!;
    const after = walls[i]!;
    const centre = meet(inset(before, radius), inset(after, radius), corner);
    return { centre, end: touch(before, centre, radius), start: touch(after, centre, radius) };
  });
  const along = (wall: Wall, to: Point2): PathStep => (wall.kind === "arc" ? { to, via: wall.apex } : { to });
  const path: PathStep[] = [along(walls[3]!, rounds[0]!.end)];
  for (let i = 0; i < 4; i++) {
    const round = rounds[i]!;
    if (radius > 0) path.push({ to: round.start, via: arcMiddle(round.centre, radius, round.end, round.start) });
    if (i < 3) path.push(along(walls[i]!, rounds[i + 1]!.end));
  }
  return path;
}

// How much higher the top is at a bowed wall's furthest point than at the straight wall, where the
// first or last surface carries on along its slope.
export function bowRise(profile: Profile, bow: Bow): { front: number; rear: number } {
  const first = profile.surfaces[0]!;
  const last = profile.surfaces.at(-1)!;
  return { front: (-bow.front * first.sin) / first.cos, rear: (bow.rear * last.sin) / last.cos };
}

// The side profile's outline, carried out to the furthest point of each bowed wall.
export function bowedOuterPath(profile: Profile, bow: Bow): PathStep[] {
  const rise = bowRise(profile, bow);
  const moved = ([y, z]: Point2): Point2 => {
    if (bow.front > 0 && y === 0) return [-bow.front, z > 0 ? z + rise.front : z];
    if (bow.rear > 0 && y === profile.depth) return [profile.depth + bow.rear, z > 0 ? z + rise.rear : z];
    return [y, z];
  };
  return profile.outerPath.map(({ to, via }): PathStep => ({ to: moved(to), ...(via && { via }) }));
}
