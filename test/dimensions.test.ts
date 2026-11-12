// A selected part's distances to the edges of where it sits, and typing what they should be.
import { describe, expect, it } from "vitest";
import { dimensionsFor, placeForDimension } from "../src/app/dimensions.js";

const deck = { id: "deck", index: 0, y0: 0, z0: 40, y1: 80, z1: 40, thickness: 3, length: 80, angle: 0, cos: 1, sin: 0 };
const base = { printedPart: 0, onTopPanel: false, below: null, surface: null, floor: null, above: null, inWall: null };
const model: any = {
  width: 300,
  surfaces: [deck, { ...deck, id: "back", y0: 80, y1: 150, z0: 40, z1: 60, length: 72.8 }],
  floorThickness: 3,
  components: [
    { ...base, id: "b", mount: "panel", a: 60, b: 30, surface: deck, above: { shape: "rect", hu: 12, hv: 10, height: 5 } },
    { ...base, id: "m", mount: "floor", a: 100, b: 50, floor: { shape: "rect", hu: 20, hv: 15, height: 5 } },
    { ...base, id: "j", mount: "wall", a: 200, b: 15, inWall: { wall: "rear", face: { shape: "rect", hu: 5, hv: 5 }, body: {}, depth: 10 } },
  ],
};

describe("sizes typed onto the view", () => {
  it("measures from the part's edges to its surface's ends and edges", () => {
    const dims = dimensionsFor(model, "b");
    expect(dims.map((d) => [d.side, d.value])).toEqual([["left", 48], ["right", 228], ["front", 20], ["back", 40]]);
    // Each shows halfway across its gap, just above the surface.
    expect(dims[0]!.at).toEqual([24, 30, 41]);
    expect(dims[3]!.at).toEqual([60, 60, 41]);
  });

  it("measures a board on the floor to the walls, and a jack to its wall's ends, the bottom and the top", () => {
    expect(dimensionsFor(model, "m").map((d) => d.value)).toEqual([80, 180, 35, 85]);
    expect(dimensionsFor(model, "j").map((d) => d.value)).toEqual([195, 95, 10, 40]);
  });

  it("moves the part so that a side's distance is what's typed, keeping the other way as it is", () => {
    expect(placeForDimension(model, "b", "left", 10)).toEqual([22, 30]);
    expect(placeForDimension(model, "b", "right", 10)).toEqual([278, 30]);
    expect(placeForDimension(model, "b", "front", 5)).toEqual([60, 15]);
    expect(placeForDimension(model, "b", "back", 5)).toEqual([60, 65]);
    expect(placeForDimension(model, "nothing", "left", 5)).toBeNull();
  });
});
