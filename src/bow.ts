// A front or rear wall that bows outward, seen from above: an arc from corner to corner, furthest
// out at the middle. Everything in it is placed against the square inside, as before, and the engine
// hollows the wall behind its curve, leaving it solid where things are fixed to it.
import type { PathStep, Point2, Profile } from "./profile.js";

export interface Bow {
  front: number; // how far out the middle of the wall is, in mm
  rear: number;
}

export const MIN_BOW = 0.5; // less is as good as straight
export const MAX_BOW = 20; // the furthest out a wall can bow
export const MAX_BOW_OF_WIDTH = 1 / 8; // which keeps the wall under 30 degrees off straight at its ends

export const hasBow = (bow: Bow) => bow.front > 0 || bow.rear > 0;

// How far out a bowed wall is at x.
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

// One wall's edge from its left side to its right, as x and how far out from the straight wall. It
// starts and ends on the side walls, where each corner's round leaves them, and each round runs
// smoothly into the bow. The first step is where it starts.
function edge(width: number, bow: number, radius: number): PathStep[] {
  if (bow <= 0) {
    if (radius <= 0) return [{ to: [0, 0] }, { to: [width, 0] }];
    const k = radius * (1 - Math.SQRT1_2);
    return [{ to: [0, -radius] }, { to: [radius, 0], via: [k, -k] }, { to: [width - radius, 0] }, { to: [width, -radius], via: [width - k, -k] }];
  }
  const big = (width * width / 4 + bow * bow) / (2 * bow);
  const centre: Point2 = [width / 2, bow - big];
  const top: Point2 = [width / 2, bow];
  if (radius <= 0) return [{ to: [0, 0] }, { to: [width, 0], via: top }];
  // A corner's round touches the side wall, and the bow from inside it.
  const out = centre[1] + Math.sqrt((big - radius) * (big - radius) - (width / 2 - radius) * (width / 2 - radius));
  const corner: Point2 = [radius, out];
  const scale = big / (big - radius);
  const touch: Point2 = [centre[0] + (corner[0] - centre[0]) * scale, centre[1] + (corner[1] - centre[1]) * scale];
  const start: Point2 = [0, out];
  const mirror = ([x, y]: Point2): Point2 => [width - x, y];
  return [
    { to: start },
    { to: touch, via: arcMiddle(corner, radius, start, touch) },
    { to: mirror(touch), via: top },
    { to: mirror(start), via: mirror(arcMiddle(corner, radius, start, touch)) },
  ];
}

// The enclosure's outline seen from above, as a closed path in x and y.
export function planOutline(width: number, depth: number, radius: number, bow: Bow): PathStep[] {
  const front = edge(width, bow.front, radius).map(({ to, via }): PathStep => ({ to: [to[0], -to[1]], ...(via && { via: [via[0], -via[1]] }) }));
  // The rear one runs right to left, so each arc's ends swap.
  const rear = edge(width, bow.rear, radius).map(({ to, via }): PathStep => ({ to: [to[0], depth + to[1]], ...(via && { via: [via[0], depth + via[1]] }) }));
  const back: PathStep[] = [];
  for (let i = rear.length - 1; i >= 0; i--) {
    const via = rear[i + 1]?.via;
    back.push({ to: rear[i]!.to, ...(via && { via }) });
  }
  // Each outline starts from its own last point, so the front's first is a line from the rear's last.
  return [...front, ...back];
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
