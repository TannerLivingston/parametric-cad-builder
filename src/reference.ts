// A part's own model, from its STEP file, shown in the design as a guide to measure and line
// things up against. It's never printed, checked or saved with the design.

export type QuarterTurn = 0 | 90 | 180 | 270;

export interface ReferencePlace {
  x: number; // where the middle of its bottom goes
  y: number;
  z: number;
  turn: QuarterTurn; // about the vertical
  tip: QuarterTurn; // about x, first, for a model drawn with another axis up
}

export interface Bounds {
  min: [number, number, number];
  max: [number, number, number];
}

// Row by row, and a move after: a point p goes to matrix · (p - its middle) + offset.
export interface ReferenceTransform {
  matrix: number[];
  offset: [number, number, number];
  size: [number, number, number]; // once turned
}

// Exact, so a turn never leaves a model a hair off square.
const COS: Record<QuarterTurn, number> = { 0: 1, 90: 0, 180: -1, 270: 0 };
const SIN: Record<QuarterTurn, number> = { 0: 0, 90: 1, 180: 0, 270: -1 };

const multiply = (a: number[], b: number[]) =>
  [0, 1, 2].flatMap((row) => [0, 1, 2].map((col) => a[row * 3]! * b[col]! + a[row * 3 + 1]! * b[3 + col]! + a[row * 3 + 2]! * b[6 + col]!));

export function referenceTransform(bounds: Bounds, place: ReferencePlace): ReferenceTransform {
  const [c, s] = [COS[place.tip], SIN[place.tip]];
  const tip = [1, 0, 0, 0, c, -s, 0, s, c];
  const [ct, st] = [COS[place.turn], SIN[place.turn]];
  const turn = [ct, -st, 0, st, ct, 0, 0, 0, 1];
  const matrix = multiply(turn, tip);
  const half = [0, 1, 2].map((axis) => (bounds.max[axis]! - bounds.min[axis]!) / 2);
  // A turned box's half size, along each axis.
  const turned = [0, 1, 2].map((row) => [0, 1, 2].reduce((sum, col) => sum + Math.abs(matrix[row * 3 + col]!) * half[col]!, 0));
  return {
    matrix,
    offset: [place.x, place.y, place.z + turned[2]!],
    size: turned.map((h) => 2 * h) as [number, number, number],
  };
}

export function referenceMiddle(bounds: Bounds): [number, number, number] {
  return [0, 1, 2].map((axis) => (bounds.min[axis]! + bounds.max[axis]!) / 2) as [number, number, number];
}

// To begin with, in the middle of the enclosure, standing on its floor.
export function startingPlace(width: number, depth: number, floor: number): ReferencePlace {
  const tidy = (value: number) => Math.round(value * 10) / 10;
  return { x: tidy(width / 2), y: tidy(depth / 2), z: floor, turn: 0, tip: 0 };
}

// Where a point of the model ends up.
export function placePoint(point: readonly number[], bounds: Bounds, transform: ReferenceTransform): [number, number, number] {
  const middle = referenceMiddle(bounds);
  const p = [0, 1, 2].map((axis) => point[axis]! - middle[axis]!);
  return [0, 1, 2].map((row) => transform.matrix[row * 3]! * p[0]! + transform.matrix[row * 3 + 1]! * p[1]! + transform.matrix[row * 3 + 2]! * p[2]! + transform.offset[row]!) as [number, number, number];
}
