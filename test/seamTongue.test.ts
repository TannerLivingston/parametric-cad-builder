// A tongue along the seam: the middle third of the left half's skin reaches past it, into a groove
// in the right half, as on the real Desk Synth.
import { beforeAll, describe, expect, it } from "vitest";
import { makeCylinder, measureVolume, type Shape3D } from "replicad";
import { isValidSolid } from "../src/checks.js";
import { buildEnclosure, initEngine, planPrint, validateConfig, type BuildPlan } from "../src/index.js";
import { seamTongueHalf } from "../src/validate.js";
import { buildProblems } from "./buildChecks.js";
import { errors } from "./helpers.js";

const box = (tongue: number, more: Record<string, unknown> = {}): any => ({
  schemaVersion: 1,
  name: "tongued",
  enclosure: { width: 300, frontHeight: 50, surfaces: [{ id: "top", y: 140, z: 50 }], wall: 5, panelThickness: 5 },
  seams: [{ x: 150, tongue }],
  components: [],
  ...more,
});
function plan(config: unknown): BuildPlan {
  const result = validateConfig(config);
  if (!result.ok) throw new Error(JSON.stringify(result.errors, null, 1));
  return result.plan;
}
const tongueErrors = (config: unknown) => errors(config).filter((e) => e.path === "seams[0].tongue").map((e) => e.message).join(" ");
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
}, 180_000);

describe("a seam's tongue, planned", () => {
  it("is off unless asked for, and makes the left half that much longer, ending in a point", () => {
    expect(plan(box(0)).seams[0]!.tongue).toBe(0);
    expect(plan(box(8)).printedParts[0]!.size[0]).toBeCloseTo(150 + 8 + seamTongueHalf(5));
    // A third of the skin, in its middle.
    expect(seamTongueHalf(6)).toBeCloseTo(1);
  });

  it("is refused too short, past the room round the seam, with a lip, or in a skin too thin for its groove", () => {
    expect(tongueErrors(box(0.5))).toContain("too short");
    expect(tongueErrors(box(20))).toContain("Make it shorter");
    expect(tongueErrors(box(2.5, { seams: [{ x: 150, tongue: 2.5, lip: 2 }] }))).toContain("not both");
    const thin = box(2.5);
    thin.enclosure = { ...thin.enclosure, wall: 3, panelThickness: 3 };
    expect(tongueErrors(thin)).toContain("Make the walls and panel at least");
    expect(tongueErrors(box(2.5, { enclosure: { ...box(0).enclosure, bow: { front: 4 } } }))).toContain("bowed");
    expect(tongueErrors(box(2.5))).toBe("");
  });
});

describe("a seam's tongue, built", () => {
  const tongue = 2.5;
  let built: BuildPlan;
  let left: Shape3D;
  let right: Shape3D;
  beforeAll(() => {
    built = plan(box(tongue));
    const shells = buildEnclosure(built).parts.filter((part) => part.kind === "shell");
    [left, right] = [shells[0]!.shape, shells[1]!.shape];
  }, 180_000);

  it("is the middle of the skin past the seam, in a groove in the right half, clear of it", () => {
    expect(isValidSolid(left)).toBe(true);
    expect(isValidSolid(right)).toBe(true);
    // In the front wall, half way up: the middle of its 5 mm belongs to the left half just past the seam,
    // and its outer and inner fifths to the right.
    const probe = (y: number) => makeCylinder(0.2, 1, [151, y, 25], [1, 0, 0]) as Shape3D;
    expect(overlap(left, probe(2.5))).toBeGreaterThan(0.05);
    expect(overlap(right, probe(2.5))).toBeLessThan(0.001);
    for (const y of [0.4, 4.6]) {
      expect(overlap(right, probe(y))).toBeGreaterThan(0.05);
      expect(overlap(left, probe(y))).toBeLessThan(0.001);
    }
    // And round under the top the same way.
    const under = (z: number) => makeCylinder(0.2, 1, [151, 70, z], [1, 0, 0]) as Shape3D;
    expect(overlap(left, under(47.5))).toBeGreaterThan(0.05);
    expect(overlap(right, under(47.5))).toBeLessThan(0.001);
    expect(overlap(left, right)).toBeLessThan(0.001);
  });

  it("builds sound, and neither half needs support", async () => {
    const enclosure = buildEnclosure(built);
    expect(await buildProblems(built, enclosure)).toEqual([]);
    const reports = planPrint(built, enclosure.parts.map((part) => part.shape.mesh({ tolerance: 0.1, angularTolerance: 0.3 })));
    for (const part of built.printedParts.filter((p) => p.kind === "shell")) {
      expect(reports[part.index]!.needsSupport, `${part.name}: ${reports[part.index]!.notes.join(" ")}`).toBe(false);
    }
  }, 240_000);

  it("prints a piece between two seams standing on its grooved end, without support", async () => {
    const three = plan(box(2.5, { enclosure: { ...box(0).enclosure, width: 480 }, seams: [{ x: 160, tongue: 2.5 }, { x: 320, tongue: 2.5 }] }));
    const enclosure = buildEnclosure(three);
    expect(await buildProblems(three, enclosure)).toEqual([]);
    const reports = planPrint(three, enclosure.parts.map((part) => part.shape.mesh({ tolerance: 0.1, angularTolerance: 0.3 })));
    // The piece between the seams, which stands on its grooved end. The end pieces are as they'd be without it.
    const middle = three.printedParts.filter((p) => p.kind === "shell")[1]!;
    expect(reports[middle.index]!.needsSupport, `${middle.name}: ${reports[middle.index]!.notes.join(" ")}`).toBe(false);
    expect(reports[middle.index]!.reports[0]!.label).toMatch(/Left wall/);
  }, 300_000);
});

describe("a seam's tongue, in the form", () => {
  it("is set on its own, and leaves the file at 0, keeping the lip as it is", async () => {
    const { updateSeam } = await import("../src/app/shapeEdit.js");
    const set = updateSeam(box(0), 0, { tongue: 2.5 });
    expect(set.seams[0]).toEqual({ x: 150, tongue: 2.5 });
    expect(updateSeam(set, 0, { tongue: 0 }).seams[0]).toEqual({ x: 150 });
    expect(updateSeam({ ...box(0), seams: [{ x: 150, lip: 2 }] }, 0, { x: 160 }).seams[0]).toEqual({ x: 160, lip: 2 });
  });
});
