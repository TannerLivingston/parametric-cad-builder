// Printed key caps, on key switches' cross stems.
import { beforeAll, describe, expect, it } from "vitest";
import { makeCylinder, measureVolume, type Shape3D } from "replicad";
import { isValidSolid } from "../src/checks.js";
import { buildEnclosure, initEngine, orientationsFor, validateConfig, type BuildPlan } from "../src/index.js";
import { CAP_CLEARANCE, CAP_COLLAR } from "../src/knob.js";
import { planPartPrint, resolvedFor } from "../src/printing.js";
import { setCap } from "../src/app/configEdit.js";
import { errors } from "./helpers.js";

// A flat top at z = 40, so a cap's axis is straight up.
const box = (components: unknown[]): any => ({
  schemaVersion: 1,
  name: "c",
  enclosure: { width: 120, frontHeight: 40, cornerRadius: 3, surfaces: [{ id: "top", y: 90, z: 40 }] },
  components,
});
const key = (cap: object | undefined, more: Record<string, unknown> = {}) => ({ id: "k", type: "mx-switch", surface: "top", u: 60, v: 45, ...(cap && { cap }), ...more });
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

describe("a key cap", () => {
  it("rests on its stem, with its top clear of the switch pressed all the way down", () => {
    const [cap] = plan(box([key({})])).knobs;
    // The stem's tip is 11.6 mm up, its cross 3.6 tall, its housing 6.6, and it travels 4.
    expect(cap).toMatchObject({ name: "Cap for k", u: 60, v: 45, underside: expect.closeTo(8), height: expect.closeTo(11.1 + 2.4 - 8) });
    expect(cap!.key).toMatchObject({ width: 15, depth: 15, thickness: 2.4, topUnderside: expect.closeTo(6.6 + 4 + CAP_CLEARANCE), socketTop: expect.closeTo(11.6 + CAP_CLEARANCE) });
    // The knob fit loosens the socket.
    expect(cap!.key!.cross).toEqual([expect.closeTo(4.1), expect.closeTo(1.3)]);
  });

  it("turns with its switch, is a printed part of its own, and goes on last", () => {
    const built = plan(box([key({ width: 20, depth: 15, color: "#c03030" }, { rotationDeg: 90 })]));
    const part = built.printedParts.at(-1)!;
    expect(part).toMatchObject({ kind: "knob", name: "Cap for k", color: "#c03030", size: [15, 20, expect.closeTo(5.5)] });
    expect(built.steps.at(-1)).toEqual({ text: "Push the key caps onto their switches' stems, last.", parts: [part.index] });
  });

  it("is refused on a part with no stem, too small for its collar, or too thin over the stem", () => {
    expect(messages(box([{ id: "b", type: "arcade-24mm", surface: "top", u: 60, v: 45, cap: {} }]))).toContain("no stem");
    expect(messages(box([key({ width: CAP_COLLAR })]))).toContain("round its collar");
    expect(messages(box([key({ thickness: 1 })]))).toContain("over the stem's tip");
  });

  it("stands in for its switch when it's wider, for keeping fingers' room", () => {
    const pair = (width: number) => box([key({ width }), { id: "j", type: "mx-switch", surface: "top", u: 60 + 19.05, v: 45 }]);
    const ergonomics = (config: unknown) => validateConfig(config).warnings.filter((w) => w.code === "ERGONOMICS");
    expect(ergonomics(pair(15))).toEqual([]);
    expect(ergonomics(pair(19))).toHaveLength(1);
  });

  it("has a socket for the cross up into its collar, under a solid top, and prints top down without support", () => {
    const built = plan(box([key({})]));
    const part = buildEnclosure(built).parts.at(-1)!;
    expect(isValidSolid(part.shape)).toBe(true);
    const z = (above: number) => 40 + above;
    // Down the middle of the socket is empty, along an arm too, but not between the arms.
    expect(overlap(part.shape, makeCylinder(0.3, 3, [60, 45, z(8.5)], [0, 0, 1]) as Shape3D)).toBeLessThan(0.001);
    expect(overlap(part.shape, makeCylinder(0.3, 3, [61.6, 45, z(8.5)], [0, 0, 1]) as Shape3D)).toBeLessThan(0.001);
    expect(overlap(part.shape, makeCylinder(0.3, 3, [61.6, 46.6, z(8.5)], [0, 0, 1]) as Shape3D)).toBeGreaterThan(0.5);
    // Solid over the stem's tip, and out to the cap's edge.
    expect(overlap(part.shape, makeCylinder(0.3, 0.5, [60, 45, z(12.8)], [0, 0, 1]) as Shape3D)).toBeGreaterThan(0.1);
    expect(overlap(part.shape, makeCylinder(0.3, 1, [66.5, 51.5, z(11.5)], [0, 0, 1]) as Shape3D)).toBeGreaterThan(0.2);
    const printed = built.printedParts[part.index]!;
    const report = planPartPrint(printed, part.shape.mesh({ tolerance: 0.05, angularTolerance: 0.2 }), orientationsFor(built, printed), built.config.fabrication.buildVolume);
    expect(report.best.label).toBe("Its top on the bed");
    expect(report.needsSupport).toBe(false);
    expect(resolvedFor(built, printed).join()).toContain("socket for its stem opens upwards");
  }, 60_000);

  it("is put on and taken off in the form", () => {
    const on = setCap(box([key(undefined)]), "k", {});
    expect(on.components[0].cap).toEqual({});
    expect(setCap(on, "k", { width: 18 }).components[0].cap).toEqual({ width: 18 });
    expect(setCap(on, "k", null).components[0]).not.toHaveProperty("cap");
  });
});
