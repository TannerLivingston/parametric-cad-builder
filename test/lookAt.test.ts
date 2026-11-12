// Which way the view turns to look at what's selected.
import { describe, expect, it } from "vitest";
import { facingFor } from "../src/app/lookAt.js";

const config: any = {
  enclosure: { surfaces: [{ id: "deck", y: 80, z: 40 }, { id: "panel", y: 150, z: 60 }] },
  labels: [{ text: "A", surface: "panel", u: 1, v: 1 }, { text: "B", wall: "left", at: 1, z: 1 }, { text: "C", component: "b" }],
  wallHoles: [{ wall: "rear", at: 50, z: 10, width: 10, height: 6 }],
  components: [{ id: "b", surface: "deck" }, { id: "j", wall: "front" }, { id: "m", x: 10, y: 10 }],
};
const model: any = {
  surfaces: [{ id: "deck", sin: 0, cos: 1 }, { id: "panel", sin: 0.6, cos: 0.8 }],
  components: [
    { id: "b", mount: "panel", surface: { sin: 0, cos: 1 }, inWall: null },
    { id: "j", mount: "wall", surface: null, inWall: { wall: "front" } },
    { id: "m", mount: "floor", surface: null, inWall: null },
  ],
};

describe("looking at what's selected", () => {
  it("faces a part square on, from above its surface, outside its wall, or above the floor", () => {
    expect(facingFor(config, model, "components[0]")).toEqual([0, -0, 1]);
    expect(facingFor(config, model, "components[1]")).toEqual([0, -1, 0]);
    expect(facingFor(config, model, "components[2]")).toEqual([0, 0, 1]);
  });
  it("faces a label or hole from outside where it is, and a surface from above its slope", () => {
    expect(facingFor(config, model, "labels[0]")).toEqual([0, -0.6, 0.8]);
    expect(facingFor(config, model, "labels[1]")).toEqual([-1, 0, 0]);
    expect(facingFor(config, model, "labels[2]")).toBeUndefined();
    expect(facingFor(config, model, "wallHoles[0]")).toEqual([0, 1, 0]);
    expect(facingFor(config, model, "enclosure.surfaces[1]")).toEqual([0, -0.6, 0.8]);
  });
  it("looks at the plate from above, and what's under it from below", () => {
    expect(facingFor(config, model, "plate.supports[0]")).toEqual([0, 0, 1]);
    expect(facingFor(config, model, "plate.feet[0]")).toEqual([0, 0, -1]);
    expect(facingFor(config, model, "plate.seamX")).toEqual([0, 0, -1]);
  });
});
