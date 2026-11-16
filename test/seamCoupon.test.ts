// The seam coupon in the fit test: a short length of skin either side of a seam with a tongue or
// keys, cut from the real pieces and printed seam up, to try the joint before printing the shell.
import { beforeAll, describe, expect, it } from "vitest";
import { makeCylinder, type Shape3D } from "replicad";
import { analyseBinarySTL, isValidSolid } from "../src/checks.js";
import { boxSolid } from "../src/engine.js";
import { buildEnclosure, buildFitTest, fitTestPieces, initEngine, placedOnBed, planFitTest, type BuildPlan, type FitTestPlan, type FitWallSection } from "../src/index.js";
import { planPartPrint } from "../src/printing.js";
import { KEY_GAP, KEY_HEIGHT, KEY_SCREW, KEY_TAB_END, KEY_THICKNESS } from "../src/seamKeys.js";
import { seamTongueHalf } from "../src/validate.js";
import { overlap, plan, stlBytes } from "./buildChecks.js";
import { deskSynth } from "./helpers.js";

const box = (seam: Record<string, unknown>, more: Record<string, unknown> = {}): any => ({
  schemaVersion: 1,
  name: "coupon",
  enclosure: { width: 300, frontHeight: 50, surfaces: [{ id: "top", y: 140, z: 50 }], wall: 5, panelThickness: 5 },
  seams: [{ x: 150, ...seam }],
  components: [],
  ...more,
});
const IDENTITY = [1, 0, 0, 0, 1, 0, 0, 0, 1] as const;

beforeAll(async () => {
  await initEngine();
}, 180_000);

describe("the seam coupon, planned", () => {
  it("is only for a seam with a tongue or keys", () => {
    expect(planFitTest(plan(box({}))).seamCoupon).toBeNull();
    expect(planFitTest(plan(box({ lip: 2 }))).seamCoupon).toBeNull();
    expect(planFitTest(plan(box({ tongue: 2.5 }))).seamCoupon).not.toBeNull();
    expect(planFitTest(plan(box({ keys: true }))).seamCoupon).not.toBeNull();
  });

  it("comes after the seam joint, in the order it's built", () => {
    expect(fitTestPieces(planFitTest(plan(box({ keys: true }))))).toEqual(["Fit test", "Fit test plug", "Fit test pin", "Wall section", "Seam joint, left", "Seam joint, right", "Seam coupon, left", "Seam coupon, right"]);
  });

  it("is round the lowest key on the rear wall, with its tab and gap, reaching 20-30 mm either side", () => {
    const built = plan(box({ keys: true, tongue: 2.5 }));
    const coupon = planFitTest(built).seamCoupon!;
    expect(coupon).toMatchObject({ on: "rear wall", key: true, tongue: true });
    const [left, right] = coupon.sections;
    const key = built.seams[0]!.rearKeys[0]!;
    expect(left.z[0]).toBeLessThan(key.z - KEY_HEIGHT / 2);
    expect(left.z[1]).toBeGreaterThan(key.z + KEY_HEIGHT / 2);
    expect(left.y[0]).toBeLessThan(key.face - KEY_GAP - KEY_THICKNESS - KEY_GAP);
    expect(left.y[1]).toBeGreaterThan(built.profile.depth);
    for (const reach of [150 - left.x[0], right.x[1] - 150]) {
      expect(reach).toBeGreaterThanOrEqual(20);
      expect(reach).toBeLessThanOrEqual(30);
    }
    expect([left.part, right.part]).toEqual([0, 1]);
  });

  it("is on the top between its tabs for a tongue on its own, since the walls are all rib", () => {
    const built = plan(box({ tongue: 2.5 }));
    const coupon = planFitTest(built).seamCoupon!;
    expect(coupon).toMatchObject({ on: "top", key: false, tongue: true });
    const [{ y }] = coupon.sections;
    for (const tab of built.seams[0]!.tabs) {
      const ys = [tab.start[0], tab.end[0], tab.start[0] + tab.inward[0] * tab.width];
      expect(Math.min(...ys) >= y[1] || Math.max(...ys) <= y[0]).toBe(true);
    }
  });

  it("isn't made for a tongue on its own under top panels, where the seam joint has the tongue", () => {
    const capped = plan(box({ tongue: 2.5 }, { topPanels: [{ surface: "top", splits: [150] }] }));
    expect(planFitTest(capped).seamCoupon).toBeNull();
    expect(planFitTest(capped).seamJoint).not.toBeNull();
  });

  it("adds a row for inserts lying down, and the key's screw, for keys", () => {
    const keyed = planFitTest(plan(box({ keys: true }, { plate: { enabled: false } })));
    expect(keyed.rows.map((row) => row.kind)).toContain("insertSideways");
    expect(keyed.hardware.join()).toContain("M3 x 8 screw");
    const plain = planFitTest(plan(box({}, { plate: { enabled: false } })));
    expect(plain.rows.map((row) => row.kind)).not.toContain("insertSideways");
    expect(plain.hardware.join()).not.toContain("M3 x 8");
  });
});

// A point of the shell, where it ends up in a coupon piece.
function inCoupon(section: FitWallSection, shell: Shape3D, probe: Shape3D): Shape3D {
  const turned = placedOnBed(shell.intersect(boxSolid(section.x, section.y, section.z)), section.matrix, [0, 0, 0]);
  const [[x, y, z]] = turned.boundingBox.bounds;
  return placedOnBed(placedOnBed(probe, section.matrix, [0, 0, 0]), [...IDENTITY], [-x, -y, -z]);
}

describe("the seam coupon, built", () => {
  const build = (config: unknown) => {
    const built = plan(config);
    const small = planFitTest(built);
    const shells = buildEnclosure(built).parts.map((part) => part.shape);
    const all = buildFitTest(small, shells);
    expect(all.map((part) => part.name)).toEqual(fitTestPieces(small));
    const [left, right] = all.slice(-2).map((part) => part.shape);
    return { built, small, shells, left: left!, right: right! };
  };
  const sound = async (shape: Shape3D, name: string) => {
    expect(isValidSolid(shape)).toBe(true);
    expect(shape.solids).toHaveLength(1);
    expect(analyseBinarySTL(await stlBytes(shape, 0.05)).watertight).toBe(true);
    expect(shape.boundingBox.bounds[0][2]).toBeCloseTo(0);
    // As exported, the way it lies, with nothing in mid-air or overhanging too far.
    const report = planPartPrint({ index: 0, name }, shape.mesh({ tolerance: 0.05, angularTolerance: 0.2 }), [{ id: "exported", label: "As exported", matrix: [...IDENTITY], planned: true }], { x: 256, y: 256, z: 256 });
    expect(report.needsSupport, `${name}: ${report.notes.join(" ")}`).toBe(false);
  };
  const probe = (x: number, y: number, z: number) => makeCylinder(0.2, 0.4, [x, y, z - 0.2], [0, 0, 1]) as Shape3D;

  describe("with keys and a tongue", () => {
    let result: ReturnType<typeof build>;
    beforeAll(() => {
      result = build(box({ keys: true, tongue: 2.5 }));
    }, 180_000);
    const at = (half: 0 | 1, x: number, y: number, z: number) => {
      const section = (result.small as FitTestPlan).seamCoupon!.sections[half];
      return overlap(half === 0 ? result.left : result.right, inCoupon(section, result.shells[section.part]!, probe(x, y, z)));
    };

    it("comes out sound, each half needing no support as it prints, seam up", async () => {
      await sound(result.left, "left");
      await sound(result.right, "right");
      // The left half's tab stands up past the seam, and the right half ends at it.
      const reach = 150 - result.small.seamCoupon!.sections[0].x[0];
      expect(result.left.boundingBox.bounds[1][2]).toBeCloseTo(reach + KEY_TAB_END);
      expect(result.right.boundingBox.bounds[1][2]).toBeCloseTo(reach);
    }, 120_000);

    it("has both halves of the key: the tab with its screw hole, and the block with its insert hole", () => {
      const key = (result.built as BuildPlan).seams[0]!.rearKeys[0]!;
      const tabY = key.face - KEY_GAP - KEY_THICKNESS / 2;
      expect(at(0, 150 + KEY_SCREW + 3.5, tabY, key.z)).toBeGreaterThan(0.03);
      expect(at(0, 150 + KEY_SCREW, tabY, key.z)).toBeLessThan(0.001);
      expect(at(1, 150 + 1, key.face + 1, key.z + KEY_HEIGHT / 2 - 1)).toBeGreaterThan(0.03);
      expect(at(1, 150 + KEY_SCREW, key.face + 2, key.z)).toBeLessThan(0.001);
    });

    it("has both halves of the tongue: the tongue past the seam, and its groove", () => {
      const { depth } = (result.built as BuildPlan).profile;
      const key = (result.built as BuildPlan).seams[0]!.rearKeys[0]!;
      const middle = depth - 5 / 2;
      const z = key.z + KEY_HEIGHT / 2 + 2;
      expect(at(0, 150 + 1, middle, z)).toBeGreaterThan(0.03);
      expect(at(1, 150 + 1, middle, z)).toBeLessThan(0.001);
      expect(at(1, 150 + 1, depth - 0.5, z)).toBeGreaterThan(0.03);
    });
  });

  it("comes out sound for a tongue on its own, on the top, the left half's tongue past its seam", async () => {
    const { small, left, right } = build(box({ tongue: 2.5 }));
    await sound(left, "left");
    await sound(right, "right");
    const reach = 150 - small.seamCoupon!.sections[0].x[0];
    expect(left.boundingBox.bounds[1][2]).toBeCloseTo(reach + 2.5 + seamTongueHalf(5), 1);
    expect(right.boundingBox.bounds[1][2]).toBeCloseTo(reach);
  }, 120_000);

  it("comes out sound on the Desk Synth with keys", async () => {
    const config = deskSynth();
    config.seams = config.seams.map((seam: Record<string, unknown>) => ({ ...seam, keys: true }));
    const { left, right } = build(config);
    await sound(left, "left");
    await sound(right, "right");
  }, 180_000);
});
