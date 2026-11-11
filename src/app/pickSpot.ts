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
const SHALLOW = 1; // how far into the skin a cut face can be, such as the side of an engraved letter
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
  // short flats, and v runs along all of them. `cut` is for a face cut a little way into the skin,
  // such as the side of an engraved letter or the edge of a hole, which looks some other way.
  const onSurface = (cut: boolean): Spot | null => {
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
      const onIt = cut ? off <= 0.05 && off >= -SHALLOW && along >= 0 && along <= s.length : Math.abs(off) <= NEAR && -ny * s.sin + nz * s.cos > FACING;
      if (within && onIt) return { kind: "surface", surface: s.curveOf ?? s.id, u: tidy(x), v: tidy(passed + Math.min(Math.max(along, 0), s.length)) };
      passed += s.length;
    }
    return null;
  };
  const surface = onSurface(false);
  if (surface) return surface;

  const walls: { wall: "left" | "right" | "front" | "rear"; facing: number; in: number; at: number }[] = [
    { wall: "left", facing: -nx, in: x, at: y },
    { wall: "right", facing: nx, in: width - x, at: y },
    { wall: "front", facing: -ny, in: y, at: x },
    { wall: "rear", facing: ny, in: depth - y, at: x },
  ];
  const wall = walls.filter((w) => w.in <= NEAR && w.facing > FACING).sort((a, b) => b.facing - a.facing)[0];
  if (wall) return { kind: "wall", wall: wall.wall, at: tidy(wall.at), z: tidy(z) };
  // Cut a little way into the top, or into a wall, in that order.
  const cutIn = onSurface(true) ?? walls.filter((w) => w.in <= SHALLOW && w.in >= -0.05 && z > NEAR).sort((a, b) => a.in - b.in)[0];
  if (!cutIn) return null;
  return "kind" in cutIn ? cutIn : { kind: "wall", wall: cutIn.wall, at: tidy(cutIn.at), z: tidy(z) };
}

