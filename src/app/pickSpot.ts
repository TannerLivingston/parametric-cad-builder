// What a click in the view landed on, in the terms the design is written in: a spot on a top
// surface, a wall, the floor inside or the underside. It's what lets something be put where it's
// clicked, with its surface or wall filled in from the click.
import type { Surface } from "../profile.js";

export type Spot =
  | { kind: "surface"; surface: string; u: number; v: number }
  | { kind: "wall"; wall: "left" | "right" | "front" | "rear"; at: number; z: number }
  | { kind: "floor"; x: number; y: number }
  | { kind: "under"; x: number; y: number };

export interface SpotShape {
  width: number;
  surfaces: Surface[];
  floorThickness: number;
}

const NEAR = 1.5; // how far off a face a click can be and still count as on it
const FACING = 0.6; // how squarely the clicked face has to look the way that face does
const tidy = (value: number) => Math.round(value * 10) / 10;

// `point` is on the design as built, with any separation of its parts taken off, and `normal` is
// the way the clicked face looks. A bowed wall is clicked out past where its straight one would be.
export function spotAt(shape: SpotShape, point: readonly [number, number, number], normal: readonly [number, number, number]): Spot | null {
  const [x, y, z] = point;
  const [nx, ny, nz] = normal;
  const { width, surfaces, floorThickness } = shape;
  const depth = surfaces.at(-1)?.y1 ?? 0;
  if (nz < -FACING && z <= NEAR) return { kind: "under", x: tidy(x), y: tidy(y) };
  if (nz > FACING && Math.abs(z - floorThickness) <= NEAR && x > 0 && x < width && y > 0 && y < depth) return { kind: "floor", x: tidy(x), y: tidy(y) };

  // The surface it's on, if the face looks the way that surface does. A curve is found by its
  // short flats, and v runs along all of them.
  let passed = 0;
  let curve: string | undefined;
  for (const s of surfaces) {
    if (!s.curveOf || s.curveOf !== curve) passed = 0;
    curve = s.curveOf;
    const along = (y - s.y0) * s.cos + (z - s.z0) * s.sin;
    const off = -(y - s.y0) * s.sin + (z - s.z0) * s.cos;
    const first = s.index === 0;
    const last = s.index === surfaces.length - 1;
    const within = (first || along >= -NEAR) && (last || along <= s.length + NEAR);
    if (within && Math.abs(off) <= NEAR && -ny * s.sin + nz * s.cos > FACING) {
      const v = Math.min(Math.max(along, 0), s.length);
      return { kind: "surface", surface: s.curveOf ?? s.id, u: tidy(x), v: tidy(passed + v) };
    }
    passed += s.length;
  }

  const walls: { wall: "left" | "right" | "front" | "rear"; facing: number; near: boolean; at: number }[] = [
    { wall: "left", facing: -nx, near: x <= NEAR, at: y },
    { wall: "right", facing: nx, near: x >= width - NEAR, at: y },
    { wall: "front", facing: -ny, near: y <= NEAR, at: x },
    { wall: "rear", facing: ny, near: y >= depth - NEAR, at: x },
  ];
  const wall = walls.filter((w) => w.near && w.facing > FACING).sort((a, b) => b.facing - a.facing)[0];
  return wall ? { kind: "wall", wall: wall.wall, at: tidy(wall.at), z: tidy(z) } : null;
}

