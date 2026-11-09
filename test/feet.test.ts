// Rubber feet: a shallow recess under the plate for each, so the stick-on feet all go in the same place.
import { readFileSync } from "node:fs";
import { beforeAll, describe, expect, it } from "vitest";
import { makeCylinder, measureVolume, type Shape3D } from "replicad";
import { isValidSolid } from "../src/checks.js";
import { buildEnclosure, initEngine, orientationsFor, validateConfig, type BuildPlan } from "../src/index.js";
import { FOOT_RECESS } from "../src/plate.js";
import { planPartPrint } from "../src/printing.js";
import { addFoot, feetAtCorners, removeFoot, updateFoot } from "../src/app/shapeEdit.js";
import { buildSceneModel, issueSpot } from "../src/app/sceneModel.js";
import { plateNotchFor } from "../src/validate.js";
import { errors, deskSynth } from "./helpers.js";

const box = (overrides: Record<string, unknown> = {}): any => ({
  schemaVersion: 1,
  name: "box",
  enclosure: { width: 200, frontHeight: 40, cornerRadius: 3, surfaces: [{ id: "top", y: 120, z: 40 }] },
  ...overrides,
});
const footed = (...feet: unknown[]) => box({ plate: { feet } });
function plan(config: unknown): BuildPlan {
  const result = validateConfig(config);
  if (!result.ok) throw new Error(JSON.stringify(result.errors, null, 1));
  return result.plan;
}
const messages = (config: unknown) => errors(config).map((e) => e.message).join(" ");
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

describe("rubber feet", () => {
  it("go where they're asked, 10 mm across unless given", () => {
    expect(plan(footed({ x: 100, y: 60 })).plate!.feet).toEqual([{ x: 100, y: 60, diameter: 10 }]);
    expect(plan(footed({ x: 100, y: 60, diameter: 12 })).plate!.feet[0]!.diameter).toBe(12);
  });

  it("keep off what's cut from under the plate: its edge, joint, notch and countersinks", () => {
    expect(messages(footed({ x: 8, y: 60 }))).toContain("edge of the plate");
    expect(messages(box({ plate: { seamX: 102, feet: [{ x: 100, y: 60 }] } }))).toContain("joint");
    expect(errors(box({ plate: { seamX: 110, feet: [{ x: 100, y: 60 }] } }))).toEqual([]);
    const opening = { xMin: 40, xMax: 160, yEnd: 50, sill: 8, rail: { depth: 14, footHeight: 3, screwX: [30, 170] } };
    const notch = plateNotchFor(box({ opening }) as never)!;
    expect(messages(box({ opening, plate: { feet: [{ x: 100, y: notch.yHigh + 3 }] } }))).toContain("notch");
    const screw = plan(box()).plate!.screws[0]!;
    expect(messages(footed({ x: screw[0] + 6, y: screw[1] + 6 }))).toContain("countersink");
    expect(messages(box({ plate: { feet: [{ x: 100, y: 60 }], countersunkHoles: [{ x: 108, y: 60 }] } }))).toContain("countersink");
    expect(messages(footed({ x: 100, y: 60 }, { x: 109, y: 60 }))).toContain("another foot");
    expect(errors(footed({ x: 100, y: 60 }, { x: 112, y: 60 }))).toEqual([]);
  });

  it("go at the corners in one step, on every example, and on the split plate's two pieces", () => {
    for (const file of ["desk-synth", "desk-synth-v2", "dial-deck"]) {
      const config = JSON.parse(readFileSync(`examples/${file}.json`, "utf8"));
      const placed = plan(feetAtCorners(config));
      expect(placed.plate!.feet, file).toHaveLength(4);
    }
    const split = plan(feetAtCorners(deskSynth())).plate!;
    expect(split.feet.filter((foot) => foot.x < split.joints[0]!)).toHaveLength(2);
  });

  it("are in the hardware and the steps, last", () => {
    const placed = plan(footed({ x: 100, y: 60 }, { x: 130, y: 60, diameter: 12 }));
    expect(placed.hardware).toContainEqual({ name: "Stick-on rubber foot, up to 12 mm across", count: 2 });
    expect(placed.assembly.at(-1)).toContain("rubber foot");
    expect(plan(box()).hardware.map((h) => h.name).join()).not.toContain("rubber");
  });

  it("are edited in the form, and shown where they're wrong", () => {
    const added = addFoot(box());
    expect(added.plate.feet).toEqual([{ x: 100, y: 60 }]);
    expect(updateFoot(added, 0, { diameter: 12 }).plate.feet[0]).toEqual({ x: 100, y: 60, diameter: 12 });
    expect(removeFoot(added, 0).plate).toBeUndefined();
    const config = footed({ x: 100, y: 60 });
    const spot = issueSpot({ path: "plate.feet[0]" }, config, buildSceneModel(config)!, { items: [], edges: [] })!;
    expect((spot.min[0] + spot.max[0]) / 2).toBeCloseTo(100);
  });

  it("are recessed into the plate's underside, shallow enough to print without support", () => {
    const placed = plan(footed({ x: 100, y: 60 }));
    const part = buildEnclosure(placed).parts.find((p) => p.kind === "plate")!;
    expect(isValidSolid(part.shape)).toBe(true);
    // Empty in the recess, solid above it and beside it.
    expect(overlap(part.shape, makeCylinder(4.9, FOOT_RECESS - 0.1, [100, 60, 0.05], [0, 0, 1]) as Shape3D)).toBeLessThan(0.001);
    const above = makeCylinder(4.9, 1, [100, 60, FOOT_RECESS + 0.1], [0, 0, 1]) as Shape3D;
    expect(overlap(part.shape, above) / measureVolume(above)).toBeGreaterThan(0.999);
    const beside = makeCylinder(1, 0.5, [107, 60, 0.1], [0, 0, 1]) as Shape3D;
    expect(overlap(part.shape, beside) / measureVolume(beside)).toBeGreaterThan(0.999);
    const printed = placed.printedParts[part.index]!;
    const report = planPartPrint(printed, part.shape.mesh({ tolerance: 0.1, angularTolerance: 0.3 }), orientationsFor(placed, printed), placed.config.fabrication.buildVolume);
    expect(report.needsSupport).toBe(false);
  }, 60_000);
});
