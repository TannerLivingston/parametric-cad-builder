// Wires: the room each part's wires need where they leave it, the way they take across the floor to
// the board they go to, and cable tie bridges to hold them on the way. It's all a rough guide, since
// wires bend wherever they're put, so what it finds only ever warns, and `wiring.checks` turns it off.
import type { FloorPart, PanelPart, WallPart, WireExit } from "./schema.js";
import { footprintShape, halfExtents, polygonInside, polygonsOverlap, rotateOffset, type Rotation } from "./geometry.js";
import { surfacePoint, type Point2, type Surface } from "./profile.js";

export type Point3 = [number, number, number];

// Room along x, with this outline across it in y and z.
export interface Prism {
  xLow: number;
  xHigh: number;
  section: Point2[];
}

export interface WireRoom {
  componentId: string;
  side: WireExit["side"];
  length: number; // how far it runs straight out
  prism: Prism;
  end: Point3; // the middle of its far end, where the wires can bend
}

export interface WireObstacle extends Prism {
  name: string;
  componentId?: string; // a part's own body, which its room starts from
}

export const WIRE_BUNDLE = 6; // across a bundle of wires, and how high it lies on the floor
export const WIRE_CELL = 2; // the grid the routes are found on
const ROUTE_HEIGHT = WIRE_BUNDLE / 2; // the middle of a bundle, above the floor's top
const SIDES = { left: [-1, 0], right: [1, 0], front: [0, -1], rear: [0, 1] } as const;
type Side = keyof typeof SIDES;

const ordered = (a: number, b: number): Point2 => (a < b ? [a, b] : [b, a]);
const rect = ([y0, y1]: Point2, [z0, z1]: Point2): Point2[] => [[y0, z0], [y1, z0], [y1, z1], [y0, z1]];
const turned = (rotation: Rotation, width: number, height: number): Point2 => (rotation === 90 || rotation === 270 ? [height, width] : [width, height]);

// A side's way out, and the way along its edge, turned with the part.
function sideFrame(side: Side, rotation: Rotation) {
  const out = rotateOffset(SIDES[side], rotation);
  const along = rotateOffset(side === "left" || side === "right" ? [0, 1] : [1, 0], rotation);
  return { out, along };
}

// On a surface, u is along x, v up its slope, and n out of its face.
export function panelWireRooms(id: string, part: PanelPart, surface: Surface, u: number, v: number, rotation: Rotation, thickness: number): WireRoom[] {
  const [hu, hv] = halfExtents(footprintShape(part.below.footprint, u, v, rotation));
  const bottom = -thickness - part.below.depth;
  const prism = ([u0, u1]: Point2, [v0, v1]: Point2, [n0, n1]: Point2): Prism => ({
    xLow: u0,
    xHigh: u1,
    section: [surfacePoint(surface, v0, n0), surfacePoint(surface, v1, n0), surfacePoint(surface, v1, n1), surfacePoint(surface, v0, n1)],
  });
  const point = (pu: number, pv: number, pn: number): Point3 => [pu, ...surfacePoint(surface, pv, pn)];
  return (part.wires ?? []).flatMap((exit): WireRoom[] => {
    const [w, h] = turned(rotation, exit.width, exit.height);
    if (exit.side === "down") {
      const [du, dv] = rotateOffset(exit.at ?? [0, 0], rotation);
      return [{ componentId: id, side: exit.side, length: exit.room, prism: prism([u + du - w / 2, u + du + w / 2], [v + dv - h / 2, v + dv + h / 2], [bottom - exit.room, bottom]), end: point(u + du, v + dv, bottom - exit.room) }];
    }
    if (exit.side === "up" || exit.side === "back") return [];
    const { out, along } = sideFrame(exit.side, rotation);
    const [a, below] = exit.at ?? [0, part.below.depth / 2];
    const cu = u + out[0] * hu + along[0] * a;
    const cv = v + out[1] * hv + along[1] * a;
    const n: Point2 = [-thickness - below - exit.height / 2, -thickness - below + exit.height / 2];
    const across = exit.width / 2;
    const room = out[0] !== 0 ? prism(ordered(cu, cu + out[0] * exit.room), [cv - across, cv + across], n) : prism([cu - across, cu + across], ordered(cv, cv + out[1] * exit.room), n);
    return [{ componentId: id, side: exit.side, length: exit.room, prism: room, end: point(cu + out[0] * exit.room, cv + out[1] * exit.room, -thickness - below) }];
  });
}

export function floorWireRooms(id: string, part: FloorPart, x: number, y: number, rotation: Rotation, floor: number): WireRoom[] {
  const [hx, hy] = halfExtents(footprintShape(part.footprint, x, y, rotation));
  const top = floor + part.height;
  return (part.wires ?? []).flatMap((exit): WireRoom[] => {
    const [w, h] = turned(rotation, exit.width, exit.height);
    if (exit.side === "up") {
      const [dx, dy] = rotateOffset(exit.at ?? [0, 0], rotation);
      const cx = x + dx;
      const cy = y + dy;
      return [{ componentId: id, side: exit.side, length: exit.room, prism: { xLow: cx - w / 2, xHigh: cx + w / 2, section: rect([cy - h / 2, cy + h / 2], [top, top + exit.room]) }, end: [cx, cy, top + exit.room] }];
    }
    if (exit.side === "down" || exit.side === "back") return [];
    const { out, along } = sideFrame(exit.side, rotation);
    const [a, up] = exit.at ?? [0, part.height / 2];
    const cx = x + out[0] * hx + along[0] * a;
    const cy = y + out[1] * hy + along[1] * a;
    const z: Point2 = [floor + up - exit.height / 2, floor + up + exit.height / 2];
    const across = exit.width / 2;
    const prism: Prism = out[0] !== 0
      ? { xLow: Math.min(cx, cx + out[0] * exit.room), xHigh: Math.max(cx, cx + out[0] * exit.room), section: rect([cy - across, cy + across], z) }
      : { xLow: cx - across, xHigh: cx + across, section: rect(ordered(cy, cy + out[1] * exit.room), z) };
    return [{ componentId: id, side: exit.side, length: exit.room, prism, end: [cx + out[0] * exit.room, cy + out[1] * exit.room, floor + up] }];
  });
}

// A part in a wall: its wires leave the inner end of its body, further in.
export function wallWireRooms(id: string, part: WallPart, wall: Side, at: number, z: number, rotation: Rotation, sizes: { wall: number; width: number; depth: number }): WireRoom[] {
  const body = part.body.depth;
  return (part.wires ?? []).flatMap((exit): WireRoom[] => {
    if (exit.side !== "back") return [];
    const [w, h] = turned(rotation, exit.width, exit.height);
    const [da, dz] = rotateOffset(exit.at ?? [0, 0], rotation);
    const along = at + da;
    const zs: Point2 = [z + dz - h / 2, z + dz + h / 2];
    const inner = { left: sizes.wall + body, right: sizes.width - sizes.wall - body, front: sizes.wall + body, rear: sizes.depth - sizes.wall - body }[wall];
    const reach = wall === "left" || wall === "front" ? exit.room : -exit.room;
    if (wall === "left" || wall === "right") {
      return [{ componentId: id, side: exit.side, length: exit.room, prism: { xLow: Math.min(inner, inner + reach), xHigh: Math.max(inner, inner + reach), section: rect([along - w / 2, along + w / 2], zs) }, end: [inner + reach, along, z + dz] }];
    }
    return [{ componentId: id, side: exit.side, length: exit.room, prism: { xLow: along - w / 2, xHigh: along + w / 2, section: rect(ordered(inner, inner + reach), zs) }, end: [along, inner + reach, z + dz] }];
  });
}

// Pulled in a little, so that only touching doesn't count.
function shrunk(prism: Prism, by = 0.2): Prism {
  const cy = prism.section.reduce((sum, [y]) => sum + y, 0) / prism.section.length;
  const cz = prism.section.reduce((sum, [, z]) => sum + z, 0) / prism.section.length;
  const toward = ([y, z]: Point2): Point2 => {
    const dy = cy - y;
    const dz = cz - z;
    const length = Math.hypot(dy, dz) || 1;
    const step = Math.min(by, length / 2);
    return [y + (dy / length) * step, z + (dz / length) * step];
  };
  return { xLow: prism.xLow + by, xHigh: prism.xHigh - by, section: prism.section.map(toward) };
}

export function prismsOverlap(a: Prism, b: Prism): boolean {
  return a.xLow < b.xHigh && a.xHigh > b.xLow && polygonsOverlap(a.section, b.section);
}

// What's in the way of a part's wires, or null if nothing is.
export function wireRoomProblem(room: WireRoom, inside: { xMin: number; xMax: number; cavity: Point2[] }, obstacles: WireObstacle[]): string | null {
  if (room.length === 0) return null;
  const prism = shrunk(room.prism);
  if (prism.xLow < inside.xMin || prism.xHigh > inside.xMax || !polygonInside(prism.section, inside.cavity)) return "the shell";
  const hit = obstacles.find((obstacle) => obstacle.componentId !== room.componentId && prismsOverlap(prism, obstacle));
  return hit ? hit.name : null;
}

// Something on or near the floor, as seen from above, that wires along it have to go round.
export interface FloorBlock {
  xLow: number;
  xHigh: number;
  yLow: number;
  yHigh: number;
  componentId?: string;
}

// Where an obstacle meets the layer of floor that wires lie in, from above, or null if it stands clear of it.
export function floorBlock(obstacle: WireObstacle, floor: number): FloorBlock | null {
  const top = floor + WIRE_BUNDLE;
  // The outline cut to the layer, by clipping it to below the layer's top, then above the floor.
  const clip = (polygon: Point2[], keep: (z: number) => boolean, at: number): Point2[] => {
    const out: Point2[] = [];
    polygon.forEach((point, i) => {
      const next = polygon[(i + 1) % polygon.length]!;
      const [y0, z0] = point;
      const [y1, z1] = next;
      if (keep(z0)) out.push(point);
      if (keep(z0) !== keep(z1)) out.push([y0 + ((at - z0) / (z1 - z0)) * (y1 - y0), at]);
    });
    return out;
  };
  const layer = clip(clip(obstacle.section, (z) => z <= top, top), (z) => z >= floor, floor);
  if (layer.length < 3) return null;
  const ys = layer.map(([y]) => y);
  return { xLow: obstacle.xLow, xHigh: obstacle.xHigh, yLow: Math.min(...ys), yHigh: Math.max(...ys), ...(obstacle.componentId ? { componentId: obstacle.componentId } : {}) };
}

export interface WireRoute {
  from: string;
  to: string;
  points: Point2[]; // across the floor, from below where the wires leave to beside the board
  length: number; // all of it, down to the floor and up to the board too
  tight: boolean; // only fits with less than a bundle's room
  seams: number[]; // the xs of seams it crosses
}

export interface RouteArea {
  xMin: number;
  xMax: number;
  yMin: number;
  yMax: number;
  floor: number;
}

// The way across the floor from a part's wires to a board, round what's on the floor, on a grid,
// shortest first. It tries with a bundle's room either side, then with less, and gives up after that.
export function routeWire(area: RouteArea, blocks: FloorBlock[], from: { id: string; end: Point3 }, to: { id: string; box: FloorBlock; top: number }, seams: number[]): WireRoute | null {
  const nx = Math.max(1, Math.floor((area.xMax - area.xMin) / WIRE_CELL) + 1);
  const ny = Math.max(1, Math.floor((area.yMax - area.yMin) / WIRE_CELL) + 1);
  const xAt = (i: number) => area.xMin + i * WIRE_CELL;
  const yAt = (j: number) => area.yMin + j * WIRE_CELL;
  const cellOf = (x: number, y: number): [number, number] => [Math.min(nx - 1, Math.max(0, Math.round((x - area.xMin) / WIRE_CELL))), Math.min(ny - 1, Math.max(0, Math.round((y - area.yMin) / WIRE_CELL)))];
  const near = (box: FloorBlock, x: number, y: number, by: number) => x > box.xLow - by && x < box.xHigh + by && y > box.yLow - by && y < box.yHigh + by;
  const others = blocks.filter((block) => block.componentId !== to.id && block.componentId !== from.id);

  for (const [room, tight] of [[WIRE_BUNDLE / 2, false], [0.5, true]] as const) {
    // Each box painted onto the cells whose middles are inside it, grown by `by`.
    const paint = (grid: Uint8Array, box: FloorBlock, by: number) => {
      const i0 = Math.max(0, Math.floor((box.xLow - by - area.xMin) / WIRE_CELL));
      const i1 = Math.min(nx - 1, Math.ceil((box.xHigh + by - area.xMin) / WIRE_CELL));
      const j0 = Math.max(0, Math.floor((box.yLow - by - area.yMin) / WIRE_CELL));
      const j1 = Math.min(ny - 1, Math.ceil((box.yHigh + by - area.yMin) / WIRE_CELL));
      for (let j = j0; j <= j1; j++) {
        for (let i = i0; i <= i1; i++) if (near(box, xAt(i), yAt(j), by)) grid[j * nx + i] = 1;
      }
    };
    const blocked = new Uint8Array(nx * ny);
    const goal = new Uint8Array(nx * ny);
    for (const block of others) paint(blocked, block, room);
    paint(goal, to.box, WIRE_CELL);
    // It starts below where the wires leave, or the nearest spot clear of things, if that isn't.
    const [si, sj] = cellOf(from.end[0], from.end[1]);
    let start = sj * nx + si;
    if (blocked[start]) {
      let best = -1;
      let bestDistance = Infinity;
      for (let k = 0; k < nx * ny; k++) {
        if (blocked[k]) continue;
        const distance = Math.hypot((k % nx) - si, Math.floor(k / nx) - sj);
        if (distance < bestDistance) {
          bestDistance = distance;
          best = k;
        }
      }
      if (best < 0) continue;
      start = best;
    }
    const path = shortestPath(nx, ny, blocked, goal, start, to.box, xAt, yAt);
    if (!path) continue;
    const points = simplified(path.map((k): Point2 => [xAt(k % nx), yAt(Math.floor(k / nx))]));
    points.unshift([from.end[0], from.end[1]]);
    let across = 0;
    for (let k = 1; k < points.length; k++) across += Math.hypot(points[k]![0] - points[k - 1]![0], points[k]![1] - points[k - 1]![1]);
    const lying = area.floor + ROUTE_HEIGHT;
    const length = Math.abs(from.end[2] - lying) + across + Math.max(0, to.top - lying);
    const crossed = seams.filter((x) => points.some((p, k) => k > 0 && (points[k - 1]![0] - x) * (p[0] - x) < 0));
    return { from: from.id, to: to.id, points, length, tight, seams: crossed };
  }
  return null;
}

// A* over the grid, eight ways, never cutting a blocked corner. Ties go to the cell found first, so
// the same design always takes the same way.
function shortestPath(nx: number, ny: number, blocked: Uint8Array, goal: Uint8Array, start: number, target: FloorBlock, xAt: (i: number) => number, yAt: (j: number) => number): number[] | null {
  const cost = new Float64Array(nx * ny).fill(Infinity);
  const came = new Int32Array(nx * ny).fill(-1);
  const done = new Uint8Array(nx * ny);
  const tx = (target.xLow + target.xHigh) / 2;
  const ty = (target.yLow + target.yHigh) / 2;
  const guess = (k: number) => {
    const dx = Math.max(0, Math.abs(xAt(k % nx) - tx) - (target.xHigh - target.xLow) / 2) / WIRE_CELL;
    const dy = Math.max(0, Math.abs(yAt(Math.floor(k / nx)) - ty) - (target.yHigh - target.yLow) / 2) / WIRE_CELL;
    return Math.max(dx, dy) + (Math.SQRT2 - 1) * Math.min(dx, dy);
  };
  const heap: [number, number, number][] = []; // estimate, order found, cell
  let found = 0;
  const push = (item: [number, number, number]) => {
    heap.push(item);
    let i = heap.length - 1;
    while (i > 0) {
      const parent = (i - 1) >> 1;
      if (before(heap[parent]!, heap[i]!)) break;
      [heap[parent], heap[i]] = [heap[i]!, heap[parent]!];
      i = parent;
    }
  };
  const before = (a: [number, number, number], b: [number, number, number]) => a[0] < b[0] || (a[0] === b[0] && a[1] < b[1]);
  const pop = () => {
    const top = heap[0]!;
    const last = heap.pop()!;
    if (heap.length) {
      heap[0] = last;
      let i = 0;
      for (;;) {
        const l = 2 * i + 1;
        const r = l + 1;
        let m = i;
        if (l < heap.length && before(heap[l]!, heap[m]!)) m = l;
        if (r < heap.length && before(heap[r]!, heap[m]!)) m = r;
        if (m === i) break;
        [heap[m], heap[i]] = [heap[i]!, heap[m]!];
        i = m;
      }
    }
    return top;
  };
  cost[start] = 0;
  push([guess(start), found++, start]);
  while (heap.length) {
    const [, , k] = pop();
    if (done[k]) continue;
    done[k] = 1;
    if (goal[k]) {
      const path = [k];
      while (came[path[0]!]! >= 0) path.unshift(came[path[0]!]!);
      return path;
    }
    const i = k % nx;
    const j = Math.floor(k / nx);
    for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]] as const) {
      const ni = i + di;
      const nj = j + dj;
      if (ni < 0 || nj < 0 || ni >= nx || nj >= ny) continue;
      const n = nj * nx + ni;
      if (blocked[n] || done[n]) continue;
      if (di !== 0 && dj !== 0 && (blocked[j * nx + ni] || blocked[nj * nx + i])) continue;
      const next = cost[k]! + (di !== 0 && dj !== 0 ? Math.SQRT2 : 1);
      if (next < cost[n]!) {
        cost[n] = next;
        came[n] = k;
        push([next + guess(n), found++, n]);
      }
    }
  }
  return null;
}

// Only the corners.
function simplified(points: Point2[]): Point2[] {
  if (points.length < 3) return points;
  const out = [points[0]!];
  for (let k = 1; k < points.length - 1; k++) {
    const [ax, ay] = out[out.length - 1]!;
    const [bx, by] = points[k]!;
    const [cx, cy] = points[k + 1]!;
    if (Math.abs((bx - ax) * (cy - by) - (by - ay) * (cx - bx)) > 1e-9) out.push(points[k]!);
  }
  out.push(points[points.length - 1]!);
  return out;
}

export const TIE_SPACING = 60; // along a route, between cable tie bridges
const TIE_MERGE = 15; // one bridge does for routes this close together

// Where cable tie bridges could hold the routes down: every so far along each, turned so the tie
// wraps round the wires, and shared where routes run together.
export function cableTieSpots(routes: WireRoute[]): { x: number; y: number; rotationDeg: 0 | 90 }[] {
  const spots: { x: number; y: number; rotationDeg: 0 | 90 }[] = [];
  for (const route of routes) {
    let travelled = 0;
    let next = TIE_SPACING / 2;
    for (let k = 1; k < route.points.length; k++) {
      const [ax, ay] = route.points[k - 1]!;
      const [bx, by] = route.points[k]!;
      const length = Math.hypot(bx - ax, by - ay);
      while (next <= travelled + length) {
        const t = (next - travelled) / length;
        const x = Math.round((ax + t * (bx - ax)) * 10) / 10;
        const y = Math.round((ay + t * (by - ay)) * 10) / 10;
        // A bridge's slot runs along y at 0 degrees, so its tie wraps wires running along x.
        const rotationDeg = Math.abs(bx - ax) >= Math.abs(by - ay) ? 0 : 90;
        if (!spots.some((spot) => Math.hypot(spot.x - x, spot.y - y) < TIE_MERGE)) spots.push({ x, y, rotationDeg });
        next += TIE_SPACING;
      }
      travelled += length;
    }
  }
  return spots;
}
