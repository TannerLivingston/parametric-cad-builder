// Weight pockets: walled pockets on the plate to glue weights into, so that the enclosure doesn't slide.
import { beforeAll, describe, expect, it } from "vitest";
import { makeBox, measureVolume, type Shape3D } from "replicad";
import { isValidSolid } from "../src/checks.js";
import { buildEnclosure, initEngine, orientationsFor, validateConfig, type BuildPlan } from "../src/index.js";
import { WEIGHT_WALL } from "../src/plate.js";
import { planPartPrint } from "../src/printing.js";
import { addWeight, removeWeight, updateWeight } from "../src/app/shapeEdit.js";
import { buildSceneModel, issueSpot } from "../src/app/sceneModel.js";
import { errors } from "./helpers.js";

const box = (overrides: Record<string, unknown> = {}): any => ({
  schemaVersion: 1,
  name: "box",
  enclosure: { width: 200, frontHeight: 40, cornerRadius: 3, surfaces: [{ id: "top", y: 120, z: 40 }] },
  ...overrides,
});
const pocket = { x: 100, y: 60, width: 40, depth: 20 };
const weighted = (...weights: unknown[]) => box({ plate: { weights } });
function plan(config: unknown): BuildPlan {
  const result = validateConfig(config);
  if (!result.ok) throw new Error(JSON.stringify(result.errors, null, 1));
  return result.plan;
}
const messages = (config: unknown) => errors(config).map((e) => e.message).join(" ");
const cube = (x: [number, number], y: [number, number], z: [number, number]) => makeBox([x[0], y[0], z[0]], [x[1], y[1], z[1]]) as unknown as Shape3D;
const overlap = (a: Shape3D, b: Shape3D) => {
  try {
    return measureVolume(a.intersect(b));
  } catch (error) {
    if (String(error).includes("deleted")) throw error;
    return 0;
  }
};

beforeAll(async () => {
  await initEngine();
}, 60_000);

describe("a weight pocket", () => {
  it("goes where it's asked, 6 mm tall unless given", () => {
    expect(plan(weighted(pocket)).plate!.weights).toEqual([{ ...pocket, height: 6 }]);
  });

  it("stays under the top, on the plate, and clear of what else stands there", () => {
    expect(messages(weighted({ ...pocket, height: 36 }))).toContain("too tall");
    expect(errors(weighted({ ...pocket, height: 30 }))).toEqual([]);
    expect(messages(weighted({ ...pocket, x: 25 }))).toContain("edge of the plate");
    expect(messages({ ...weighted(pocket), components: [{ id: "a", type: "ads7830", x: 130, y: 60 }] })).toContain("board");
    expect(messages(weighted(pocket, { ...pocket, x: 143 }))).toContain("another weight pocket");
    expect(errors(weighted(pocket, { ...pocket, x: 146 }))).toEqual([]);
    expect(messages(box({ plate: { weights: [pocket], countersunkHoles: [{ x: 124, y: 60 }] } }))).toContain("another fixing");
    const opening = { xMin: 40, xMax: 160, yEnd: 50, sill: 8, keepOut: [{ xMin: 40, xMax: 160, yMin: 0, yMax: 80, top: 15 }] };
    expect(messages(box({ opening, plate: { weights: [{ ...pocket, y: 70 }] } }))).toContain("contents");
  });

  it("can sit under a top screw's tab if it's low enough, since the plate goes on last", () => {
    const capped = box({ topPanels: [{ surface: "top" }] });
    const screw = plan(capped).topScrews.find((s) => s.wall === "front")!;
    const under = (height: number) => ({ ...capped, plate: { weights: [{ x: screw.x, y: screw.y + 9, width: 16, depth: 10, height }] } });
    expect(errors(under(4))).toEqual([]);
    expect(messages(under(30))).toContain("top screw");
  });

  it("keeps supports off it", () => {
    expect(messages(box({ plate: { weights: [pocket], supports: [{ x: 100, y: 75 }] } }))).toContain("another fixing");
    expect(errors(box({ plate: { weights: [pocket], supports: [{ x: 100, y: 80 }] } }))).toEqual([]);
  });

  it("asks for a weight of each size, before the plate goes on, and makes the plate that much taller", () => {
    const placed = plan(weighted(pocket, { ...pocket, x: 146 }, { ...pocket, y: 90, height: 10 }));
    expect(placed.hardware).toContainEqual({ name: "Weight to glue into a 40 mm x 20 mm pocket, up to 6 mm tall, such as steel", count: 2 });
    expect(placed.hardware).toContainEqual({ name: "Weight to glue into a 40 mm x 20 mm pocket, up to 10 mm tall, such as steel", count: 1 });
    const steps = placed.assembly;
    expect(steps.findIndex((step) => step.includes("weights"))).toBeLessThan(steps.findIndex((step) => step.includes("Screw on the plate")));
    const plate = placed.printedParts.find((part) => part.kind === "plate")!;
    expect(plate.size[2]).toBeCloseTo(placed.config.enclosure.floorThickness + 10);
  });

  it("is edited in the form, and shown where it's wrong", () => {
    const added = addWeight(box());
    expect(added.plate.weights).toEqual([{ x: 100, y: 60, width: 40, depth: 20 }]);
    expect(updateWeight(added, 0, { height: 8 }).plate.weights[0].height).toBe(8);
    expect(removeWeight(added, 0).plate).toBeUndefined();
    const config = weighted(pocket);
    const spot = issueSpot({ path: "plate.weights[0]" }, config, buildSceneModel(config)!, { items: [], edges: [] })!;
    expect((spot.min[0] + spot.max[0]) / 2).toBeCloseTo(100);
  });

  it("is built as walls round an empty pocket, and prints without support", () => {
    const placed = plan(weighted(pocket));
    const part = buildEnclosure(placed).parts.find((p) => p.kind === "plate")!;
    expect(isValidSolid(part.shape)).toBe(true);
    const floor = placed.config.enclosure.floorThickness;
    const inside = cube([81, 119], [51, 69], [floor + 0.1, floor + 5.9]);
    expect(overlap(part.shape, inside)).toBeLessThan(0.001);
    const wall = cube([80 - WEIGHT_WALL + 0.1, 79.9], [51, 69], [floor + 0.1, floor + 5.9]);
    expect(overlap(part.shape, wall) / measureVolume(wall)).toBeGreaterThan(0.999);
    const printed = placed.printedParts[part.index]!;
    const report = planPartPrint(printed, part.shape.mesh({ tolerance: 0.1, angularTolerance: 0.3 }), orientationsFor(placed, printed), placed.config.fabrication.buildVolume);
    expect(report.needsSupport).toBe(false);
  }, 60_000);
});
