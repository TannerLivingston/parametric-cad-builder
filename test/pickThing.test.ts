// Working out what's at a click in the view, as its path in the config.
import { describe, expect, it } from "vitest";
import { thingAt, WALLS_PATH } from "../src/app/pickThing.js";
import { buildSceneModel, issueSpot } from "../src/app/sceneModel.js";

const design = (): any => ({
  schemaVersion: 1,
  name: "box",
  enclosure: { width: 300, frontHeight: 40, surfaces: [{ id: "deck", y: 80, z: 40 }, { id: "panel", y: 150, z: 60 }] },
  seams: [{ x: 150 }],
  wallHoles: [{ wall: "rear", at: 60, z: 20, width: 14, height: 8 }],
  vents: [{ wall: "left", at: 70, z: 22, width: 40, height: 12 }],
  labels: [
    { text: "GAIN", surface: "panel", u: 220, v: 30 },
    { text: "IN", wall: "rear", at: 100, z: 20 },
    { text: "TALL", u: 40, v: 40, rotationDeg: 90 },
  ],
  plate: { supports: [{ x: 90, y: 70 }], feet: [{ x: 20, y: 20 }], weights: [{ x: 200, y: 100, width: 40, depth: 20 }], pins: [{ x: 50, y: 120, diameter: 3.7, height: 4 }] },
  components: [],
});
const on = (surface: string, u: number, v: number) => ({ kind: "surface", surface, u, v }) as const;
const wall = (name: "left" | "right" | "front" | "rear", at: number, z: number) => ({ kind: "wall", wall: name, at, z }) as const;

describe("what's at a click", () => {
  it("is a label where one is, turned or not, on its own surface only", () => {
    expect(thingAt(design(), [on("panel", 222, 31)], false)).toBe("labels[0]");
    expect(thingAt(design(), [on("deck", 222, 31)], false)).toBe("enclosure.surfaces[0]");
    // With no surface given, it's on the first, and turned it's taller than it's wide.
    expect(thingAt(design(), [on("deck", 40, 47)], false)).toBe("labels[2]");
    expect(thingAt(design(), [on("deck", 47, 40)], false)).toBe("enclosure.surfaces[0]");
  });

  it("is a seam along its line, and otherwise the surface", () => {
    expect(thingAt(design(), [on("panel", 151, 10)], false)).toBe("seams[0]");
    expect(thingAt(design(), [on("panel", 160, 10)], false)).toBe("enclosure.surfaces[1]");
    expect(thingAt(design(), [wall("front", 149, 10)], false)).toBe("seams[0]");
  });

  it("is a hole, vent or label in a wall, and otherwise the walls", () => {
    expect(thingAt(design(), [wall("rear", 64, 22)], false)).toBe("wallHoles[0]");
    expect(thingAt(design(), [wall("left", 55, 20)], false)).toBe("vents[0]");
    expect(thingAt(design(), [wall("rear", 100, 20)], false)).toBe("labels[1]");
    expect(thingAt(design(), [wall("right", 64, 22)], false)).toBe(WALLS_PATH);
    // The seam's line doesn't cross a side wall.
    expect(thingAt(design(), [wall("left", 150, 22)], false)).toBe(WALLS_PATH);
  });

  it("is something on the plate from below, or from above only when the inside shows", () => {
    expect(thingAt(design(), [{ kind: "under", x: 22, y: 21 }], false)).toBe("plate.feet[0]");
    expect(thingAt(design(), [{ kind: "under", x: 120, y: 60 }], false)).toBeNull();
    const through = [on("deck", 90, 70), { kind: "floor", x: 91, y: 71 } as const];
    expect(thingAt(design(), through, false)).toBe("enclosure.surfaces[0]");
    expect(thingAt(design(), through, true)).toBe("plate.supports[0]");
    expect(thingAt(design(), [{ kind: "floor", x: 215, y: 105 }], false)).toBe("plate.weights[0]");
    expect(thingAt(design(), [{ kind: "floor", x: 50, y: 121 }], false)).toBe("plate.pins[0]");
  });

  it("passes over a face that's nothing in particular, such as the side of an engraved letter", () => {
    expect(thingAt(design(), [null, on("panel", 222, 31)], false)).toBe("labels[0]");
  });

  it("is nothing on empty space", () => {
    expect(thingAt(design(), [], true)).toBeNull();
    expect(thingAt(design(), [null], true)).toBeNull();
  });
});

describe("where something picked is, to light it up", () => {
  const model = buildSceneModel(design())!;
  const none = { items: [], edges: [] };
  const spot = (path: string) => issueSpot({ path }, design(), model, none)!;

  it("covers a label on its surface, and one on a wall", () => {
    const box = spot("labels[0]");
    expect((box.min[0] + box.max[0]) / 2).toBeCloseTo(220);
    expect(box.max[0] - box.min[0]).toBeGreaterThan(8);
    expect(box.min[1]).toBeGreaterThan(80);
    expect(box.max[2]).toBeGreaterThan(48);
    const rear = spot("labels[1]");
    expect(rear.max[1]).toBeCloseTo(151);
    expect((rear.min[2] + rear.max[2]) / 2).toBeCloseTo(20);
  });

  it("covers a whole surface, across the width", () => {
    const box = spot("enclosure.surfaces[1]");
    expect([box.min[0], box.max[0]]).toEqual([0, 300]);
    expect([box.min[1], box.max[1]]).toEqual([80, 150]);
    expect(issueSpot({ path: WALLS_PATH }, design(), model, none)).toBeNull();
  });
});
