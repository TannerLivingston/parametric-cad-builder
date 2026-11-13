// Keys on the rear wall at a seam, in place of the rib there, as on the real Desk Synth: a tab from
// the left half over a block on the right half's rear wall, screwed into an insert from the front.
import { beforeAll, describe, expect, it } from "vitest";
import { makeCylinder, measureVolume, type Shape3D } from "replicad";
import { readFileSync } from "node:fs";
import { isValidSolid } from "../src/checks.js";
import { buildEnclosure, initEngine, planPrint, validateConfig, type BuildPlan } from "../src/index.js";
import { KEY_GAP, KEY_HEIGHT, KEY_SCREW, KEY_TAB_END, KEY_THICKNESS, keyReach } from "../src/seamKeys.js";
import { buildProblems } from "./buildChecks.js";
import { errors } from "./helpers.js";

const box = (more: Record<string, unknown> = {}, enclosure: Record<string, unknown> = {}): any => ({
  schemaVersion: 1,
  name: "keyed",
  enclosure: { width: 300, frontHeight: 50, surfaces: [{ id: "top", y: 140, z: 50 }], wall: 5, panelThickness: 5, ...enclosure },
  seams: [{ x: 150, keys: true }],
  components: [],
  ...more,
});
function plan(config: unknown): BuildPlan {
  const result = validateConfig(config);
  if (!result.ok) throw new Error(JSON.stringify(result.errors, null, 1));
  return result.plan;
}
const keyErrors = (config: unknown) => errors(config).filter((e) => e.path === "seams[0].keys").map((e) => e.message).join(" ");
const overlap = (a: Shape3D, b: Shape3D) => {
  try {
    return measureVolume(a.intersect(b));
  } catch (error) {
    if (String(error).includes("deleted")) throw error;
    return 0;
  }
};
const rearWallTab = (p: BuildPlan) => p.seams[0]!.tabs.filter((tab) => tab.surface === null && tab.inward[0] < 0);

beforeAll(async () => {
  await initEngine();
}, 180_000);

describe("keys on the rear wall, planned", () => {
  it("are off unless asked for, and take the rear wall's rib away", () => {
    const plain = plan({ ...box(), seams: [{ x: 150 }] });
    expect(plain.seams[0]!.rearKeys).toEqual([]);
    expect(rearWallTab(plain)).toHaveLength(1);
    const keyed = plan(box());
    expect(rearWallTab(keyed)).toHaveLength(0);
    // The front wall keeps its rib and bolts.
    expect(keyed.seams[0]!.tabs.some((tab) => tab.surface === null && tab.inward[0] > 0)).toBe(true);
    expect(keyed.seams[0]!.bolts.length).toBeLessThan(plain.seams[0]!.bolts.length);
  });

  it("are two on a square rear wall, as far apart as they go, standing off it, within the room round the seam", () => {
    const keys = plan(box()).seams[0]!.rearKeys;
    expect(keys).toHaveLength(2);
    expect(keys[1]!.z - keys[0]!.z).toBeGreaterThan(20);
    for (const key of keys) {
      expect(key.deepest).toBeCloseTo(140 - 5);
      expect(key.face).toBeLessThan(key.deepest - 1.9);
      expect(keyReach(key)).toBeLessThanOrEqual(14);
    }
  });

  it("are one on a low rear wall, and none where the rib's room round the seam is too narrow, which is refused", () => {
    expect(plan(box({}, { surfaces: [{ id: "top", y: 140, z: 30 }], frontHeight: 30 })).seams[0]!.rearKeys).toHaveLength(1);
    expect(keyErrors(box({ seams: [{ x: 150, keys: true, ribWidth: 7, ribHalfThickness: 3.5 }] }))).toContain("no room on the rear wall");
  });

  it("go between the Desk Synth's rear rounds, where the wall behind is flattest", () => {
    const config = JSON.parse(readFileSync("examples/desk-synth.json", "utf8"));
    config.seams = config.seams.map((seam: any) => ({ ...seam, keys: true }));
    const keys = plan(config).seams[0]!.rearKeys;
    expect(keys.length).toBeGreaterThan(0);
    for (const key of keys) expect(keyReach(key)).toBeLessThanOrEqual(14);
  });

  it("are refused on a bowed rear wall, and in one too shallow to drive their screws", () => {
    expect(keyErrors(box({}, { bow: { rear: 4 } }))).toContain("bowed");
    expect(keyErrors(box({}, { surfaces: [{ id: "top", y: 60, z: 50 }] }))).toContain("too shallow");
    expect(keyErrors(box())).toBe("");
  });

  it("make the left piece longer by the tab", () => {
    const keyed = plan(box());
    expect(keyed.printedParts[0]!.size[0]).toBeCloseTo(150 + KEY_TAB_END);
  });
});

describe("keys on the rear wall, built", () => {
  let built: BuildPlan;
  let left: Shape3D;
  let right: Shape3D;
  beforeAll(() => {
    built = plan(box({ seams: [{ x: 150, keys: true, tongue: 2.5 }] }));
    const shells = buildEnclosure(built).parts.filter((part) => part.kind === "shell");
    [left, right] = [shells[0]!.shape, shells[1]!.shape];
  }, 180_000);

  it("is a tab of the left half's over a block of the right half's, apart, with a screw hole through both", () => {
    expect(isValidSolid(left)).toBe(true);
    expect(isValidSolid(right)).toBe(true);
    const probe = (x: number, y: number, z: number) => makeCylinder(0.2, 0.4, [x, y, z], [0, 0, 1]) as Shape3D;
    for (const key of built.seams[0]!.rearKeys) {
      const tabY = key.face - KEY_GAP - KEY_THICKNESS / 2;
      // The tab, past the seam, beside the screw.
      expect(overlap(left, probe(150 + KEY_SCREW + 3.5, tabY, key.z))).toBeGreaterThan(0.03);
      expect(overlap(right, probe(150 + KEY_SCREW + 3.5, tabY, key.z))).toBeLessThan(0.001);
      // The block behind it.
      expect(overlap(right, probe(150 + 1, key.face + 1, key.z + KEY_HEIGHT / 2 - 1))).toBeGreaterThan(0.03);
      // And the left half's own block, this side of the seam.
      expect(overlap(left, probe(150 - 1, key.face + 1, key.z + KEY_HEIGHT / 2 - 1))).toBeGreaterThan(0.03);
      // The screw's way through: clear in the tab and the block.
      expect(overlap(left, probe(150 + KEY_SCREW, tabY, key.z - 0.2))).toBeLessThan(0.001);
      expect(overlap(right, probe(150 + KEY_SCREW, key.face + 2, key.z - 0.2))).toBeLessThan(0.001);
    }
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

  it("prints a piece between two keyed seams standing on its end, and the right one, without support", async () => {
    const three = plan(box({ seams: [{ x: 160, keys: true }, { x: 320, keys: true }] }, { width: 480 }));
    const enclosure = buildEnclosure(three);
    expect(await buildProblems(three, enclosure)).toEqual([]);
    const reports = planPrint(three, enclosure.parts.map((part) => part.shape.mesh({ tolerance: 0.1, angularTolerance: 0.3 })));
    // The left one has a little that needs support at this width with or without keys, away from them.
    for (const part of three.printedParts.filter((p) => p.kind === "shell").slice(1)) {
      expect(reports[part.index]!.needsSupport, `${part.name}: ${reports[part.index]!.notes.join(" ")}`).toBe(false);
    }
  }, 300_000);
});

describe("keys on the rear wall, in the form", () => {
  it("are set on their own, and leave the file when turned off, keeping the rest", async () => {
    const { updateSeam } = await import("../src/app/shapeEdit.js");
    const plain = { ...box(), seams: [{ x: 150, tongue: 2.5 }] };
    const set = updateSeam(plain, 0, { keys: true });
    expect(set.seams[0]).toEqual({ x: 150, tongue: 2.5, keys: true });
    expect(updateSeam(set, 0, { keys: false }).seams[0]).toEqual({ x: 150, tongue: 2.5 });
    expect(updateSeam(set, 0, { x: 160 }).seams[0]).toEqual({ x: 160, tongue: 2.5, keys: true });
  });
});
