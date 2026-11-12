// Where a part would be refused, for shading while it's dragged.
import { describe, expect, it } from "vitest";
import { buildSceneModel } from "../src/app/sceneModel.js";
import { reachCells, refusedSquares } from "../src/app/reach.js";
import { validateConfig } from "../src/validate.js";

const config: any = {
  schemaVersion: 1,
  name: "box",
  enclosure: { width: 120, frontHeight: 40, surfaces: [{ id: "deck", y: 60, z: 40 }] },
  components: [
    { id: "a", type: "arcade-24mm", surface: "deck", u: 30, v: 30 },
    { id: "b", type: "arcade-24mm", surface: "deck", u: 90, v: 30 },
  ],
};

describe("where a part can go", () => {
  const result = validateConfig(config);
  if (!result.ok) throw new Error("the test design should be valid");
  const model = buildSceneModel(config)!;
  const cells = [...reachCells(config, model, "b", 10)];

  it("checks a grid over its surface, refusing the edges and where it would hit its neighbour", () => {
    expect(cells.length).toBe(12 * 6);
    const at = (a: number, b: number) => cells.find((c) => c.a === a && c.b === b)!.ok;
    expect(at(85, 25)).toBe(true);
    expect(at(25, 25)).toBe(false); // on top of a
    expect(at(5, 25)).toBe(false); // off the left end
    expect(at(65, 35)).toBe(true);
  });

  it("gives a square for each refused spot, on the surface", () => {
    const squares = refusedSquares(model, "b", cells, 10);
    expect(squares.length).toBe(cells.filter((c) => !c.ok).length);
    const [p0, , p2] = squares[0]!;
    expect(p2[0] - p0[0]).toBe(10);
    expect(p0[2]).toBe(41);
  });
});
