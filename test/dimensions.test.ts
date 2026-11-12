// A selected part's distances to the edges of where it sits, and typing what they should be.
import { describe, expect, it } from "vitest";
import { dimensionsFor, itemAsComponent, placeForDimension } from "../src/app/dimensions.js";

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

  it("measures to the nearest neighbour in its way instead, and moves to make that gap what's typed", () => {
    const withNeighbours: any = {
      ...model,
      components: [
        ...model.components,
        { ...base, id: "n1", mount: "panel", a: 20, b: 30, surface: deck, above: { shape: "rect", hu: 8, hv: 8, height: 5 } },
        { ...base, id: "n2", mount: "panel", a: 60, b: 70, surface: deck, above: { shape: "rect", hu: 5, hv: 5, height: 5 } },
        // Not in its row or column, so not in the way.
        { ...base, id: "far", mount: "panel", a: 200, b: 70, surface: deck, above: { shape: "rect", hu: 5, hv: 5, height: 5 } },
      ],
    };
    const dims = dimensionsFor(withNeighbours, "b");
    expect(dims.map((d) => [d.side, d.to, d.value])).toEqual([
      ["left", "n1", 20],
      ["right", null, 228],
      ["front", null, 20],
      ["back", "n2", 25],
    ]);
    expect(placeForDimension(withNeighbours, "b", "left", 5)).toEqual([45, 30]);
    expect(placeForDimension(withNeighbours, "b", "back", 10)).toEqual([60, 45]);
  });
});

describe("sizes typed onto the view for what's on a list", () => {
  const config: any = {
    enclosure: { width: 300, surfaces: [{ id: "deck", y: 80, z: 40 }] },
    labels: [{ text: "GAIN", surface: "deck", u: 100, v: 20, size: 5 }],
    wallHoles: [{ wall: "rear", at: 60, z: 20, width: 14, height: 8 }],
    seams: [{ x: 150 }],
    plate: { pins: [{ x: 40, y: 50, diameter: 4, height: 4 }] },
  };
  it("stands a hole, a label or a plate item in as a part of its size where it is", () => {
    const hole = itemAsComponent(config, model, "wallHoles[0]")!;
    expect([hole.mount, hole.a, hole.b, hole.inWall?.wall, hole.inWall?.face.hu]).toEqual(["wall", 60, 20, "rear", 7]);
    const pin = itemAsComponent(config, model, "plate.pins[0]")!;
    expect([pin.mount, pin.a, pin.b, pin.floor?.hu]).toEqual(["floor", 40, 50, 2]);
    const label = itemAsComponent(config, model, "labels[0]")!;
    expect([label.mount, label.surface?.id, label.a, label.b]).toEqual(["panel", "deck", 100, 20]);
    // A seam has only the one number, so nothing to measure both ways.
    expect(itemAsComponent(config, model, "seams[0]")).toBeNull();
  });

  it("measures it to the parts around it and the edges, like a part", () => {
    const pin = itemAsComponent(config, model, "plate.pins[0]")!;
    const withPin = { ...model, components: [...model.components, pin] };
    // The board "m" sits to its right, 80 to 120 across and 35 to 65 back.
    const dims = dimensionsFor(withPin, pin.id);
    expect(dims.map((d) => [d.side, d.to, d.value])).toEqual([
      ["left", null, 38],
      ["right", "m", 38],
      ["front", null, 48],
      ["back", null, 98],
    ]);
  });
});
