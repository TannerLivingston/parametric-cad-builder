// Round holes in the skin of a shell piece printed on its side: their top would be a roof starting in
// mid-air, so they get a teardrop's point towards the top of the print.
import { beforeAll, describe, expect, it } from "vitest";
import { makeCylinder, measureVolume, type Shape3D } from "replicad";
import { buildEnclosure, initEngine, planPrint, validateConfig, type BuildPlan } from "../src/index.js";

// Two halves, with holes in the shell's own top: an arcade button with its keyway, and a dial, on
// each side of the seam.
const halves = (topPanels: unknown[] = []): any => ({
  schemaVersion: 1,
  name: "halves",
  enclosure: { width: 300, frontHeight: 45, surfaces: [{ id: "top", y: 150, z: 45 }] },
  seams: [{ x: 150 }],
  topPanels,
  components: [
    { id: "b1", type: "arcade-24mm", surface: "top", u: 60, v: 75 },
    { id: "d1", type: "ec11-dial-19mm", surface: "top", u: 100, v: 40 },
    { id: "b2", type: "arcade-24mm", surface: "top", u: 240, v: 75 },
    { id: "d2", type: "ec11-dial-19mm", surface: "top", u: 200, v: 110 },
  ],
});
function plan(config: unknown): BuildPlan {
  const result = validateConfig(config);
  if (!result.ok) throw new Error(JSON.stringify(result.errors, null, 1));
  return result.plan;
}
const overlap = (a: Shape3D, b: Shape3D) => {
  try {
    return measureVolume(a.intersect(b));
  } catch (error) {
    if (String(error).includes("deleted")) throw error;
    return 0;
  }
};

describe("round holes in a shell printed on its side, planned", () => {
  // A touch pad's pocket just clear of the button's round hole and body, but inside the 17.1 mm its
  // point reaches.
  const beside = (offset: number, topPanels: unknown[] = []) => {
    const config = halves(topPanels);
    config.components = [config.components[0], { id: "t", type: "ttp223", surface: "top", u: 60 + offset, v: 75 }];
    return validateConfig(config);
  };
  const tooClose = (result: ReturnType<typeof validateConfig>) => !result.ok && result.errors.some((e) => e.code === "CUTOUTS_TOO_CLOSE");

  it("keep other cutouts clear of the point, but not of the round side", () => {
    expect(tooClose(beside(22))).toBe(true);
    expect(beside(-22).ok).toBe(true);
    // In a top panel there's no point.
    expect(beside(22, [{ surface: "top", splits: [150] }]).ok).toBe(true);
  });
});

describe("round holes in a shell printed on its side", () => {
  let built: BuildPlan;
  let parts: ReturnType<typeof buildEnclosure>["parts"];
  beforeAll(async () => {
    await initEngine();
    built = plan(halves());
    parts = buildEnclosure(built).parts;
  }, 240_000);

  it("point towards the top of the print: right on the left half, left on the right one", () => {
    const [left, right] = parts.filter((part) => part.kind === "shell").map((part) => part.shape);
    // Just past the 12.12 mm radius of the arcade button's hole, through the 3 mm top at z 42 to 45.
    const across = (x: number) => makeCylinder(0.3, 5, [x, 75, 41.5], [0, 0, 1]) as Shape3D;
    expect(overlap(left!, across(60 + 13.5))).toBeLessThan(0.001);
    expect(overlap(left!, across(60 - 13.5))).toBeGreaterThan(0.5);
    expect(overlap(right!, across(240 - 13.5))).toBeLessThan(0.001);
    expect(overlap(right!, across(240 + 13.5))).toBeGreaterThan(0.5);
  });

  it("leave both halves needing no support, keyways and all", () => {
    const reports = planPrint(built, parts.map((part) => part.shape.mesh({ tolerance: 0.1, angularTolerance: 0.3 })));
    for (const part of built.printedParts.filter((p) => p.kind === "shell")) {
      const report = reports[part.index]!;
      expect(report.needsSupport, `${part.name}: ${report.notes.join(" ")}`).toBe(false);
      expect(report.best.islands, part.name).toBe(0);
    }
  }, 240_000);

  it("stay round in a top panel, which prints face down", () => {
    const panelled = plan(halves([{ surface: "top", splits: [150] }]));
    const top = buildEnclosure(panelled).parts.find((part) => part.kind === "top")!;
    expect(overlap(top.shape, makeCylinder(0.3, 5, [60 + 13.5, 75, 41.5], [0, 0, 1]) as Shape3D)).toBeGreaterThan(0.5);
  }, 240_000);
});
