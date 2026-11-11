// What the keys do to something selected in the view.
import { describe, expect, it } from "vitest";
import { validateConfig } from "../src/validate.js";
import { errorCount } from "../src/app/configEdit.js";
import { arrayPitch, arrayThing, duplicateComponent, duplicateThing, nudgeThing, removeThing, rotateThing } from "../src/app/thingKeys.js";

const design = (): any => ({
  schemaVersion: 1,
  name: "box",
  enclosure: { width: 300, frontHeight: 40, surfaces: [{ id: "deck", y: 80, z: 40 }, { id: "panel", y: 150, z: 60 }] },
  seams: [{ x: 150 }],
  wallHoles: [{ wall: "rear", at: 60, z: 20, width: 14, height: 8 }],
  labels: [
    { text: "GAIN", surface: "panel", u: 220, v: 30 },
    { text: "IN", wall: "rear", at: 100, z: 20 },
    { text: "GO", component: "button-1" },
  ],
  plate: { feet: [{ x: 20, y: 20 }], weights: [{ x: 200, y: 100, width: 40, depth: 20 }] },
  components: [{ id: "button-1", type: "arcade-24mm", surface: "deck", u: 60, v: 40, knob: undefined }],
});

describe("keys on something selected", () => {
  it("nudge it along its own two numbers", () => {
    expect(nudgeThing(design(), "labels[0]", 1, -0.1)!.labels[0]).toMatchObject({ u: 221, v: 29.9 });
    expect(nudgeThing(design(), "labels[1]", -1, 1)!.labels[1]).toMatchObject({ at: 99, z: 21 });
    expect(nudgeThing(design(), "wallHoles[0]", 1, 0)!.wallHoles[0]).toMatchObject({ at: 61, z: 20 });
    expect(nudgeThing(design(), "plate.feet[0]", 0, 1)!.plate.feet[0]).toEqual({ x: 20, y: 21 });
    // A seam moves only across, and a part's own label goes where its part does.
    expect(nudgeThing(design(), "seams[0]", 1, 0)!.seams[0]).toEqual({ x: 151 });
    expect(nudgeThing(design(), "seams[0]", 0, 1)).toBeNull();
    expect(nudgeThing(design(), "labels[2]", 1, 0)).toBeNull();
    expect(nudgeThing(design(), "enclosure.surfaces[0]", 1, 0)).toBeNull();
  });

  it("turn only what has a turn", () => {
    expect(rotateThing(design(), "labels[0]")!.labels[0].rotationDeg).toBe(90);
    const twice = rotateThing(rotateThing(design(), "plate.weights[0]")!, "plate.weights[0]")!;
    expect(twice.plate.weights[0].rotationDeg).toBe(180);
    expect(rotateThing(design(), "wallHoles[0]")).toBeNull();
    expect(rotateThing(design(), "labels[2]")).toBeNull();
  });

  it("delete it, and an emptied list leaves the file", () => {
    const next = removeThing(design(), "wallHoles[0]")!;
    expect(next).not.toHaveProperty("wallHoles");
    expect(removeThing(design(), "labels[1]")!.labels.map((l: any) => l.text)).toEqual(["GAIN", "GO"]);
    expect(removeThing(design(), "plate.feet[0]")!.plate.feet).toEqual([]);
    expect(removeThing(design(), "enclosure.wall")).toBeNull();
    expect(removeThing(design(), "labels[9]")).toBeNull();
    // Paths that name a list in the wrong place are nothing.
    expect(removeThing(design(), "plate.labels[0]")).toBeNull();
    expect(removeThing(design(), "feet[0]")).toBeNull();
  });

  it("copy it beside the original without adding a problem", () => {
    const start = design();
    const copy = duplicateThing(start, "wallHoles[0]")!;
    expect(copy.path).toBe("wallHoles[1]");
    expect(copy.config.wallHoles[1]).toMatchObject({ wall: "rear", z: 20, width: 14 });
    expect(Math.abs(copy.config.wallHoles[1].at - 60)).toBeGreaterThanOrEqual(14);
    expect(errorCount(copy.config)).toBeLessThanOrEqual(errorCount(start));
    expect(duplicateThing(start, "plate.feet[0]")!.path).toBe("plate.feet[1]");
    // Clear of the original even where the validator wouldn't mind, as for pins.
    const pinned = { ...start, plate: { pins: [{ x: 100, y: 100, diameter: 3.7, height: 4 }] } };
    expect(duplicateThing(pinned, "plate.pins[0]")!.config.plate.pins[1]).toMatchObject({ x: 105.7, y: 100 });
    const label = duplicateThing(start, "labels[0]")!.config.labels[3];
    expect(label.u - 220).toBeGreaterThan(10);
    expect(duplicateThing(start, "seams[0]")).toBeNull();
  });

  it("copy a part with its labels and the next free id", () => {
    const start = design();
    expect(validateConfig(start).ok).toBe(true);
    const copy = duplicateComponent(start, "button-1")!;
    expect(copy.id).toBe("button-2");
    const made = copy.config.components.find((c: any) => c.id === copy.id);
    expect(made).toMatchObject({ type: "arcade-24mm", surface: "deck", v: 40 });
    expect(made.u).not.toBe(60);
    expect(copy.config.labels.filter((l: any) => l.text === "GO").map((l: any) => l.component)).toEqual(["button-1", copy.id]);
    expect(validateConfig(copy.config).ok).toBe(true);
    expect(duplicateComponent(start, "nothing")).toBeNull();
  });
});

describe("arrays from the menu", () => {
  it("start from the least spacing that adds no problem", () => {
    const pinned = { ...design(), plate: { pins: [{ x: 100, y: 100, diameter: 3.7, height: 4 }] } };
    expect(arrayPitch(pinned, { path: "plate.pins[0]" })).toEqual({ along: 5.7, across: 5.7 });
    // A part's is the validator's to find, and clears the original.
    const part = arrayPitch(design(), { part: "button-1" })!;
    expect(part.along).toBeGreaterThan(24);
    expect(errorCount(arrayThing(design(), { part: "button-1" }, { columns: 2, rows: 1, stepAlong: part.along, stepAcross: 0 })!)).toBe(errorCount(design()));
    expect(arrayPitch(design(), { path: "seams[0]" })).toBeNull();
    expect(arrayPitch(design(), { part: "nothing" })).toBeNull();
  });

  it("make rows of copies of a part or anything on a list", () => {
    const made = arrayThing(design(), { path: "wallHoles[0]" }, { columns: 3, rows: 2, stepAlong: 20, stepAcross: 12 })!;
    expect(made.wallHoles.map((h: any) => [h.at, h.z])).toEqual([[60, 20], [80, 20], [100, 20], [60, 32], [80, 32], [100, 32]]);
    const parts = arrayThing(design(), { part: "button-1" }, { columns: 2, rows: 2, stepAlong: 30, stepAcross: 30 })!;
    expect(parts.components.map((c: any) => [c.id, c.u, c.v])).toEqual([["button-1", 60, 40], ["button-2", 90, 40], ["button-3", 60, 70], ["button-4", 90, 70]]);
    expect(arrayThing(design(), { path: "wallHoles[0]" }, { columns: 1, rows: 1, stepAlong: 20, stepAcross: 12 })).toBeNull();
    expect(arrayThing(design(), { path: "seams[0]" }, { columns: 3, rows: 1, stepAlong: 20, stepAcross: 0 })).toBeNull();
  });
});
