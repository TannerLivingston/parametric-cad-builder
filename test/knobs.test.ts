// Printed knobs, on a part's shafts.
import { beforeAll, describe, expect, it } from "vitest";
import { makeCylinder, measureVolume, type Shape3D } from "replicad";
import { isValidSolid } from "../src/checks.js";
import { buildEnclosure, buildFitTest, initEngine, orientationsFor, planFitTest, validateConfig, type BuildPlan } from "../src/index.js";
import { KNOB_LIFT, KNOB_MIN_GRIP } from "../src/knob.js";
import { planPartPrint } from "../src/printing.js";
import { applyFit } from "../src/app/fitEdit.js";
import { setKnob } from "../src/app/configEdit.js";
import { errors } from "./helpers.js";

// A flat top at z = 40, so a knob's axis is straight up.
const box = (components: unknown[], more: Record<string, unknown> = {}): any => ({
  schemaVersion: 1,
  name: "k",
  enclosure: { width: 120, frontHeight: 40, cornerRadius: 3, surfaces: [{ id: "top", y: 90, z: 40 }] },
  components,
  ...more,
});
const encoder = (knob: object | undefined, more: Record<string, unknown> = {}) => ({ id: "enc", type: "ec11-encoder", surface: "top", u: 60, v: 45, ...(knob && { knob }), ...more });
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

describe("a knob", () => {
  it("sits on its shaft as low as the nut allows, with a D hole a push fit on it", () => {
    const [knob] = plan(box([encoder({})])).knobs;
    expect(knob).toMatchObject({ name: "Knob for enc", u: 60, v: 45, diameter: 14, height: 16, toward: [0, 1], color: "#1b1c1f" });
    // A 20 mm shaft reaches 17 mm above a 3 mm panel, so a 16 mm knob rides 0.1 mm above the nut's room.
    expect(knob!.underside).toBeCloseTo(3.1);
    expect(knob!.hole).toEqual({ diameter: 6.1, flat: 4.6, depth: expect.closeTo(14.4, 6) });
    // A shorter one rides further up, and one too short is refused.
    expect(plan(box([encoder({ height: 10 })])).knobs[0]!.underside).toBeCloseTo(9.1);
    expect(messages(box([encoder({ height: 7 })]))).toContain("too short");
  });

  it("turns with its part, and is a printed part of its own, put on last", () => {
    const placed = plan(box([encoder({ diameter: 20, color: "#c03030" }, { rotationDeg: 90 })]));
    expect(placed.knobs[0]!.toward).toEqual([-1, 0]);
    const part = placed.printedParts.at(-1)!;
    expect(part).toMatchObject({ kind: "knob", name: "Knob for enc", color: "#c03030", size: [20, 20, 16] });
    expect(placed.steps.at(-1)!.parts).toEqual([part.index]);
  });

  it("is refused on a part without a shaft, too narrow for its shaft, or on a shaft too short", () => {
    expect(messages(box([{ id: "b", type: "arcade-24mm", surface: "top", u: 60, v: 45, knob: {} }]))).toContain("no shaft");
    expect(messages(box([encoder({ diameter: 8 })]))).toContain("needs at least 9.2 mm");
    const stubby = { s: { name: "s", source: "estimated", mount: "panel", cutouts: [{ kind: "circle", diameter: 7 }], shafts: [{ at: [0, 0], diameter: 6, length: 3 + KNOB_LIFT + KNOB_MIN_GRIP - 1 }], above: { footprint: { shape: "circle", diameter: 10 }, height: 10 }, below: { footprint: { shape: "circle", diameter: 10 }, depth: 10 } } };
    expect(messages(box([{ id: "s", type: "s", surface: "top", u: 60, v: 45, knob: {} }], { customParts: stubby }))).toContain("only have 5 mm");
  });

  it("keeps fingers' room from its neighbours, as wide as it is", () => {
    const pair = (diameter: number) => box([encoder({ diameter }), { id: "b", type: "arcade-24mm", surface: "top", u: 60 + 27, v: 45 }]);
    const ergonomics = (config: unknown) => validateConfig(config).warnings.filter((w) => w.code === "ERGONOMICS");
    expect(ergonomics(pair(14))).toEqual([]);
    expect(ergonomics(pair(24))).toHaveLength(1);
  });

  it("is fluted round its side, with a D hole up into it, and prints top down without support", () => {
    const placed = plan(box([encoder({})]));
    const part = buildEnclosure(placed).parts.at(-1)!;
    expect(part.kind).toBe("knob");
    expect(isValidSolid(part.shape)).toBe(true);
    const z = 40 + placed.knobs[0]!.underside;
    // The hole, and the flat on its +y side, 1.55 mm from the middle with the fit.
    expect(overlap(part.shape, makeCylinder(0.5, 10, [60, 45 - 1.5, z + 1], [0, 0, 1]) as Shape3D)).toBeLessThan(0.001);
    expect(overlap(part.shape, makeCylinder(0.3, 10, [60, 45 + 2.2, z + 1], [0, 0, 1]) as Shape3D)).toBeGreaterThan(0.1);
    // Solid above the hole, below the pointer.
    expect(overlap(part.shape, makeCylinder(0.5, 0.8, [60, 45 - 2, z + 14.6], [0, 0, 1]) as Shape3D)).toBeGreaterThan(0.6);
    const printed = placed.printedParts[part.index]!;
    const report = planPartPrint(printed, part.shape.mesh({ tolerance: 0.05, angularTolerance: 0.2 }), orientationsFor(placed, printed), placed.config.fabrication.buildVolume);
    expect(report.best.label).toBe("Its top on the bed");
    expect(report.needsSupport).toBe(false);
  }, 60_000);

  it("has its hole tried in the fit test, which sets the fit", () => {
    const test = planFitTest(plan(box([encoder({})])));
    const row = test.rows.find((r) => r.kind === "knob")!;
    expect(row.steps.map((step) => step.size)).toEqual([5.9, 6, 6.1, 6.2, 6.3]);
    expect(buildFitTest(test).every((p) => isValidSolid(p.shape))).toBe(true);
    expect(applyFit(box([]), row, 0.2).fabrication.fit).toEqual({ knobHole: 0.2 });
    expect(applyFit(box([]), row, 0.1)).not.toHaveProperty("fabrication");
    expect(planFitTest(plan(box([encoder(undefined)]))).rows.some((r) => r.kind === "knob")).toBe(false);
  }, 120_000);

  it("is put on and taken off in the form", () => {
    const on = setKnob(box([encoder(undefined)]), "enc", {});
    expect(on.components[0].knob).toEqual({});
    expect(setKnob(on, "enc", { diameter: 18 }).components[0].knob).toEqual({ diameter: 18 });
    expect(setKnob(on, "enc", null).components[0]).not.toHaveProperty("knob");
  });
});
