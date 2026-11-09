// 2D shapes on a surface or the floor, and polygon tests in the world's YZ plane.
import type { Point2 } from "./profile.js";
import type { Footprint } from "./schema.js";

export type Shape =
  | { kind: "circle"; cx: number; cy: number; r: number }
  | { kind: "rect"; cx: number; cy: number; w: number; h: number };

export type Rotation = 0 | 90 | 180 | 270;

export function rotateOffset([x, y]: readonly [number, number], rotation: Rotation): [number, number] {
  if (rotation === 90) return [-y, x];
  if (rotation === 180) return [-x, -y];
  if (rotation === 270) return [y, -x];
  return [x, y];
}

export function footprintShape(footprint: Footprint, cx: number, cy: number, rotation: Rotation): Shape {
  if (footprint.shape === "circle") return { kind: "circle", cx, cy, r: footprint.diameter / 2 };
  const quarterTurned = rotation === 90 || rotation === 270;
  return {
    kind: "rect",
    cx,
    cy,
    w: quarterTurned ? footprint.height : footprint.width,
    h: quarterTurned ? footprint.width : footprint.height,
  };
}

export function halfExtents(shape: Shape): [number, number] {
  return shape.kind === "circle" ? [shape.r, shape.r] : [shape.w / 2, shape.h / 2];
}

// Clear distance between two shapes, negative when they overlap. Rounded corners
// count as square, which errs towards reporting a smaller gap.
export function gap(a: Shape, b: Shape): number {
  if (a.kind === "circle" && b.kind === "circle") {
    return Math.hypot(a.cx - b.cx, a.cy - b.cy) - a.r - b.r;
  }
  if (a.kind === "rect" && b.kind === "rect") {
    return boxDistance(Math.abs(a.cx - b.cx) - (a.w + b.w) / 2, Math.abs(a.cy - b.cy) - (a.h + b.h) / 2);
  }
  const [circle, rect] = a.kind === "circle" ? [a, b as Extract<Shape, { kind: "rect" }>] : [b as Extract<Shape, { kind: "circle" }>, a];
  return boxDistance(Math.abs(circle.cx - rect.cx) - rect.w / 2, Math.abs(circle.cy - rect.cy) - rect.h / 2) - circle.r;
}

function boxDistance(dx: number, dy: number): number {
  return dx <= 0 && dy <= 0 ? Math.max(dx, dy) : Math.hypot(Math.max(dx, 0), Math.max(dy, 0));
}

// Whether two convex polygons overlap, by the separating axis test.
export function polygonsOverlap(a: Point2[], b: Point2[]): boolean {
  for (const polygon of [a, b]) {
    for (let i = 0; i < polygon.length; i++) {
      const [x1, y1] = polygon[i]!;
      const [x2, y2] = polygon[(i + 1) % polygon.length]!;
      const axis: Point2 = [y2 - y1, x1 - x2];
      const [minA, maxA] = project(a, axis);
      const [minB, maxB] = project(b, axis);
      if (maxA <= minB || maxB <= minA) return false;
    }
  }
  return true;
}

function project(polygon: Point2[], [ax, ay]: Point2): Point2 {
  const values = polygon.map(([x, y]) => x * ax + y * ay);
  return [Math.min(...values), Math.max(...values)];
}

export function pointInPolygon([x, y]: Point2, polygon: Point2[]): boolean {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const [xi, yi] = polygon[i]!;
    const [xj, yj] = polygon[j]!;
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

function segmentsCross([a, b]: [Point2, Point2], [c, d]: [Point2, Point2]): boolean {
  const side = (p: Point2, q: Point2, r: Point2) => (q[0] - p[0]) * (r[1] - p[1]) - (q[1] - p[1]) * (r[0] - p[0]);
  return side(a, b, c) * side(a, b, d) < 0 && side(c, d, a) * side(c, d, b) < 0;
}

function edges(chain: Point2[], closed: boolean): [Point2, Point2][] {
  const out: [Point2, Point2][] = [];
  for (let i = 0; i < chain.length - (closed ? 0 : 1); i++) out.push([chain[i]!, chain[(i + 1) % chain.length]!]);
  return out;
}

// Whether a closed polygon crosses an open chain of line segments.
export function polygonCrossesChain(polygon: Point2[], chain: Point2[]): boolean {
  const chainEdges = edges(chain, false);
  return edges(polygon, true).some((e) => chainEdges.some((c) => segmentsCross(e, c)));
}

// Whether a polygon sits wholly inside another, which may be concave.
export function polygonInside(polygon: Point2[], container: Point2[]): boolean {
  return polygon.every((p) => pointInPolygon(p, container)) && !polygonCrossesChain(polygon, [...container, container[0]!]);
}
