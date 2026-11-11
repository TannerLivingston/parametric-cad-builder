// Working out what a click in the view landed on.
import { describe, expect, it } from "vitest";
import { buildSurfaces } from "../src/profile.js";
import { spotAt } from "../src/app/pickSpot.js";

const surfaces = buildSurfaces(40, [{ id: "deck", y: 80, z: 40 }, { id: "hood", y: 130, z: 60, bulge: 8 }, { id: "back", y: 190, z: 55 }]);
const shape = { width: 300, surfaces, floorThickness: 3 };
const up = [0, 0, 1] as const;

describe("a click in the view", () => {
  it("on a flat surface gives that surface, with u across and v along it", () => {
    expect(spotAt(shape, [120.04, 30, 40], up)).toEqual({ kind: "surface", surface: "deck", u: 120, v: 30 });
    const back = surfaces.at(-1)!;
    const point = [200, back.y0 + 20 * back.cos, back.z0 + 20 * back.sin] as const;
    expect(spotAt(shape, point, [0, -back.sin, back.cos])).toEqual({ kind: "surface", surface: "back", u: 200, v: 20 });
  });

  it("measures v from the surface's own front edge, whatever is in front of it", () => {
    const three = buildSurfaces(28, [{ id: "deck", y: 90, z: 28 }, { id: "panel", y: 130, z: 54 }, { id: "back", y: 200, z: 44 }]);
    const back = three[2]!;
    const point = [255, back.y0 + 39 * back.cos, back.z0 + 39 * back.sin] as const;
    expect(spotAt({ width: 360, surfaces: three, floorThickness: 3 }, point, [0, -back.sin, back.cos])).toEqual({ kind: "surface", surface: "back", u: 255, v: 39 });
  });

  it("on a curve gives the curve, and how far along all of it", () => {
    const flats = surfaces.filter((s) => s.curveOf === "hood");
    const third = flats[2]!;
    const point = [50, third.y0 + 2 * third.cos, third.z0 + 2 * third.sin] as const;
    const spot = spotAt(shape, point, [0, -third.sin, third.cos])!;
    expect(spot).toMatchObject({ kind: "surface", surface: "hood", u: 50 });
    expect((spot as { v: number }).v).toBeCloseTo(flats[0]!.length + flats[1]!.length + 2, 1);
  });

  it("on a wall gives the wall, how far along it and how high", () => {
    expect(spotAt(shape, [0, 60, 20], [-1, 0, 0])).toEqual({ kind: "wall", wall: "left", at: 60, z: 20 });
    expect(spotAt(shape, [300, 60, 20], [1, 0, 0])).toEqual({ kind: "wall", wall: "right", at: 60, z: 20 });
    expect(spotAt(shape, [140, 190, 25], [0, 1, 0])).toEqual({ kind: "wall", wall: "rear", at: 140, z: 25 });
    // A bowed front wall is out past y = 0, and looks a little to one side.
    expect(spotAt(shape, [60, -5, 12], [-0.2, -0.98, 0])).toEqual({ kind: "wall", wall: "front", at: 60, z: 12 });
    // On a rounded corner, whichever wall the face looks more towards.
    expect(spotAt(shape, [1, 1.2, 12], [-0.8, -0.6, 0])).toMatchObject({ wall: "left" });
  });

  it("inside gives the floor, and from below the underside", () => {
    expect(spotAt(shape, [100, 90, 3], up)).toEqual({ kind: "floor", x: 100, y: 90 });
    expect(spotAt(shape, [100, 90, 0], [0, 0, -1])).toEqual({ kind: "under", x: 100, y: 90 });
  });

  it("on anything else gives nothing", () => {
    // The top of a boss inside, the inner face of a wall, and the edge of a hole in the top.
    expect(spotAt(shape, [100, 90, 20], up)).toBeNull();
    expect(spotAt(shape, [3, 60, 20], [1, 0, 0])).toBeNull();
    expect(spotAt(shape, [120, 30, 39], [1, 0, 0])).toBeNull();
  });
});
