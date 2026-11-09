// A part's own STEP file, shown in the design: read it, and place it where it's asked to go.
import { beforeAll, describe, expect, it } from "vitest";
import { importSTEP, makeBox, type Shape3D } from "replicad";
import { initEngine } from "../src/index.js";
import { placePoint, referenceTransform, startingPlace, type Bounds, type ReferencePlace } from "../src/reference.js";

// 10 wide, 20 deep and 30 tall, off to one side, as a part's own file often is.
const bounds: Bounds = { min: [100, 200, 300], max: [110, 220, 330] };
const corners = [0, 1, 2, 3, 4, 5, 6, 7].map((i) => [i & 1 ? 110 : 100, i & 2 ? 220 : 200, i & 4 ? 330 : 300]);
function placed(place: ReferencePlace) {
  const transform = referenceTransform(bounds, place);
  const points = corners.map((corner) => placePoint(corner, bounds, transform));
  const low = [0, 1, 2].map((axis) => Math.min(...points.map((p) => p[axis]!)));
  const high = [0, 1, 2].map((axis) => Math.max(...points.map((p) => p[axis]!)));
  return { transform, low, high };
}

beforeAll(async () => {
  await initEngine();
}, 60_000);

describe("a reference model", () => {
  const at: ReferencePlace = { x: 50, y: 60, z: 3, turn: 0, tip: 0 };

  it("stands the middle of its bottom where it's put", () => {
    const { low, high, transform } = placed(at);
    expect((low[0]! + high[0]!) / 2).toBeCloseTo(50);
    expect((low[1]! + high[1]!) / 2).toBeCloseTo(60);
    expect(low[2]).toBeCloseTo(3);
    expect(transform.size).toEqual([10, 20, 30]);
  });

  it("turns about the vertical, and tips over about x, still standing on the same spot", () => {
    for (const turn of [90, 180, 270] as const) {
      const { low, high, transform } = placed({ ...at, turn });
      expect(low[2]).toBeCloseTo(3);
      expect((low[0]! + high[0]!) / 2).toBeCloseTo(50);
      expect(transform.size).toEqual(turn === 180 ? [10, 20, 30] : [20, 10, 30]);
    }
    const tipped = placed({ ...at, tip: 90 });
    expect(tipped.transform.size).toEqual([10, 30, 20]);
    expect(tipped.low[2]).toBeCloseTo(3);
    // Tipping a quarter turn about x takes its top towards the front.
    const top = placePoint([105, 210, 330], bounds, tipped.transform);
    expect(top[1]).toBeCloseTo(60 - 15);
  });

  it("starts in the middle of the enclosure, on its floor", () => {
    expect(startingPlace(351.4, 196.5, 3)).toEqual({ x: 175.7, y: 98.3, z: 3, turn: 0, tip: 0 });
  });

  it("reads a STEP file into a shape with its size", async () => {
    const box = makeBox([0, 0, 0], [12, 34, 5]) as unknown as Shape3D;
    const shape = (await importSTEP(box.blobSTEP())) as Shape3D;
    const [min, max] = shape.boundingBox.bounds;
    expect(max.map((value, axis) => value - min[axis]!).map((value) => Math.round(value * 1000) / 1000)).toEqual([12, 34, 5]);
    expect(shape.mesh({ tolerance: 0.1, angularTolerance: 0.3 }).triangles.length).toBeGreaterThan(0);
  });
});
