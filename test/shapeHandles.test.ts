// Handles on the shape for what's selected, and what dragging each one does.
import { describe, expect, it } from "vitest";
import { WALLS_PATH } from "../src/app/pickThing.js";
import { handlesFor } from "../src/app/shapeHandles.js";

const design = (): any => ({
  schemaVersion: 1,
  name: "box",
  enclosure: { width: 300, frontHeight: 40, surfaces: [{ id: "deck", y: 80, z: 40 }, { id: "panel", y: 150, z: 60, bulge: 4 }], bow: { rear: 3 } },
  seams: [{ x: 150, lip: 2 }],
  plate: { seamX: 140 },
  components: [],
});
const handle = (path: string, id: string, joints?: number[]) => handlesFor(design(), path, joints).find((h) => h.id === id)!;

describe("handles on the shape", () => {
  it("move a seam or the plate's split along the width, in half millimetres", () => {
    const seam = handle("seams[0]", "seams[0]");
    expect(seam.axis).toEqual([1, 0, 0]);
    expect(seam.at[0]).toBe(150);
    expect(seam.apply(design(), 12.3).seams).toEqual([{ x: 162.5, lip: 2 }]);
    const joints = handlesFor(design(), "plate.seamX", [100, 200]);
    expect(joints.map((h) => h.at[0])).toEqual([100, 200]);
    expect(joints[1]!.apply(design(), -20).plate.seamX).toEqual([100, 180]);
  });

  it("size the walls: width, depth, front height, and a bow", () => {
    expect(handle(WALLS_PATH, "width").apply(design(), 10).enclosure.width).toBe(310);
    expect(handle(WALLS_PATH, "depth").apply(design(), -5).enclosure.surfaces[1].y).toBe(145);
    expect(handle(WALLS_PATH, "frontHeight").apply(design(), 2).enclosure.frontHeight).toBe(42);
    const bow = handle(WALLS_PATH, "bow.rear");
    expect(bow.axis).toEqual([0, 1, 0]);
    expect(bow.apply(design(), 2).enclosure.bow).toEqual({ rear: 5 });
    // Only a bowed wall has one.
    expect(handlesFor(design(), WALLS_PATH).map((h) => h.id)).not.toContain("bow.front");
  });

  it("move a surface's crease back and up, and bend it from its middle", () => {
    expect(handle("enclosure.surfaces[0]", "enclosure.surfaces[0].y").apply(design(), 4).enclosure.surfaces[0]).toEqual({ id: "deck", y: 84, z: 40 });
    expect(handle("enclosure.surfaces[0]", "enclosure.surfaces[0].z").apply(design(), -3).enclosure.surfaces[0]).toEqual({ id: "deck", y: 80, z: 37 });
    // The panel runs back and up, so its bulge goes up and forward, from the arc's middle.
    const bulge = handle("enclosure.surfaces[1]", "enclosure.surfaces[1].bulge");
    expect(bulge.axis[1]).toBeLessThan(0);
    expect(bulge.axis[2]).toBeGreaterThan(0);
    expect(bulge.at[2]).toBeGreaterThan(50);
    expect(bulge.apply(design(), 2).enclosure.surfaces[1].bulge).toBe(6);
    // Flattened right out, it leaves the file.
    expect(bulge.apply(design(), -4).enclosure.surfaces[1]).not.toHaveProperty("bulge");
  });

  it("are none for what has no sizes to drag", () => {
    expect(handlesFor(design(), null)).toEqual([]);
    expect(handlesFor(design(), "labels[0]")).toEqual([]);
    expect(handlesFor(design(), "seams[4]")).toEqual([]);
  });
});

describe("handles on what's on a list", () => {
  const withItems = (): any => ({
    ...design(),
    labels: [{ text: "GAIN", surface: "panel", u: 100, v: 20 }, { text: "IN", wall: "rear", at: 60, z: 20 }, { text: "GO", component: "b" }],
    wallHoles: [{ wall: "left", at: 50, z: 15, width: 10, height: 6 }],
    plate: { seamX: 140, feet: [{ x: 20, y: 20 }], supports: [{ x: 100, y: 60 }] },
  });
  const frame = { surfaces: [{ id: "deck", index: 0, y0: 0, z0: 40, y1: 80, z1: 40, thickness: 3, length: 80, angle: 0, cos: 1, sin: 0 }, { id: "panel", index: 1, y0: 80, z0: 40, y1: 150, z1: 60, thickness: 3, length: 72.8, angle: 0.28, cos: 0.96, sin: 0.27 }], floorThickness: 3 };
  const one = (path: string) => handlesFor(withItems(), path, [], frame)[0]!;

  it("sit on its face and move it across it by its own two numbers, to the half millimetre", () => {
    const label = one("labels[0]");
    expect(label.axis).toEqual([1, 0, 0]);
    expect(label.across).toEqual([0, 0.96, 0.27]);
    expect(label.apply(withItems(), 5.2, -3.1).labels[0]).toMatchObject({ u: 105, v: 17 });
    const wall = one("labels[1]");
    expect(wall.at).toEqual([60, 151, 20]);
    expect(wall.apply(withItems(), 1, 1).labels[1]).toMatchObject({ at: 61, z: 21 });
    const hole = one("wallHoles[0]");
    expect(hole.at).toEqual([-1, 50, 15]);
    expect(hole.axis).toEqual([0, 1, 0]);
    expect(one("plate.supports[0]").at).toEqual([100, 60, 4]);
    // Feet are seen from below.
    expect(one("plate.feet[0]").at).toEqual([20, 20, -1]);
    expect(one("plate.feet[0]").apply(withItems(), 2.4, 0).plate.feet[0]).toEqual({ x: 22.5, y: 20 });
  });

  it("are none for a part's own label, which goes where its part does", () => {
    expect(handlesFor(withItems(), "labels[2]", [], frame)).toEqual([]);
  });
});
