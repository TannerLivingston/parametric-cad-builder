// Supports: posts from the plate up to just under the top, to hold up a wide stretch of it.
import { beforeAll, describe, expect, it } from "vitest";
import { makeCylinder, measureVolume, type Shape3D } from "replicad";
import { analyseBinarySTL, isValidSolid } from "../src/checks.js";
import { buildEnclosure, initEngine, validateConfig, type BuildPlan } from "../src/index.js";
import { lowestHeight } from "../src/profile.js";
import { roundGap, SUPPORT_GAP } from "../src/plate.js";
import { addSupport, removeSupport, updateSupport } from "../src/app/shapeEdit.js";
import { buildSceneModel, issueSpot } from "../src/app/sceneModel.js";
import { plateNotchFor } from "../src/validate.js";
import { errors, deskSynth } from "./helpers.js";
import { readFileSync } from "node:fs";

const deskSynthV2 = () => JSON.parse(readFileSync("examples/desk-synth-v2.json", "utf8"));

const box = (overrides: Record<string, unknown> = {}): any => ({
  schemaVersion: 1,
  name: "box",
  enclosure: { width: 200, frontHeight: 40, cornerRadius: 3, surfaces: [{ id: "top", y: 120, z: 40 }] },
  ...overrides,
});
const supported = (...supports: unknown[]) => box({ plate: { supports } });
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

describe("a support", () => {
  const free = { x: 100, y: 60 };

  it("reaches to just under the lowest part of the top above it", () => {
    const flat = plan(supported(free));
    const [support] = flat.plate!.supports;
    expect(support).toMatchObject({ x: 100, y: 60, diameter: 8 });
    expect(support!.top).toBeCloseTo(lowestHeight(flat.profile.inner, 56, 64) - SUPPORT_GAP);
    // Under a slope, its top is level, so only its low side comes close.
    const sloped = box({ enclosure: { width: 200, frontHeight: 30, surfaces: [{ id: "top", y: 120, z: 50 }] }, plate: { supports: [free] } });
    const tilted = plan(sloped);
    expect(tilted.plate!.supports[0]!.top).toBeCloseTo(lowestHeight(tilted.profile.inner, 56, 64) - SUPPORT_GAP);
    expect(tilted.plate!.supports[0]!.top).toBeLessThan(lowestHeight(tilted.profile.inner, 60, 60) - SUPPORT_GAP - 0.5);
  });

  it("is built on the plate, standing clear of the shell", () => {
    const config = supported(free);
    const buildPlan = plan(config);
    const { parts } = buildEnclosure(buildPlan);
    const plate = parts.find((p) => p.name.startsWith("Plate"))!.shape;
    const shell = parts.find((p) => p.name.startsWith("Shell"))!.shape;
    const top = buildPlan.plate!.supports[0]!.top;
    const floor = buildPlan.config.enclosure.floorThickness;
    const inside = makeCylinder(3.9, top - floor - 0.2, [100, 60, floor + 0.1], [0, 0, 1]) as Shape3D;
    expect(overlap(plate, inside) / measureVolume(inside)).toBeGreaterThan(0.999);
    expect(overlap(plate, makeCylinder(4.2, 1, [100, 60, top + 0.01], [0, 0, 1]) as Shape3D)).toBe(0);
    expect(overlap(plate, shell)).toBeLessThan(0.001);
    expect(isValidSolid(plate)).toBe(true);
    // The plate piece is as tall as its support.
    expect(buildPlan.printedParts.find((p) => p.kind === "plate")!.size[2]).toBeCloseTo(top);
  });

  it("needs some room under the top", () => {
    const low = { schemaVersion: 1, name: "low", enclosure: { width: 200, frontHeight: 8, surfaces: [{ id: "top", y: 120, z: 8 }] }, plate: { supports: [free] } };
    expect(messages(low)).toContain("no room under the top");
  });

  it("takes its diameter from the config", () => {
    expect(plan(supported({ ...free, diameter: 12 })).plate!.supports[0]!.diameter).toBe(12);
  });

  it("has to stay on the plate, off its joint and out of the rail's notch", () => {
    expect(errors(supported(free))).toEqual([]);
    expect(messages(supported({ x: 9, y: 60 }))).toContain("edge of the plate");
    expect(messages(supported({ x: 100, y: 112 }))).toContain("edge of the plate");
    expect(messages(box({ plate: { seamX: 102, supports: [free] } }))).toContain("joint");
    expect(errors(box({ plate: { seamX: 110, supports: [free] } }))).toEqual([]);
    const opening = { xMin: 40, xMax: 160, yEnd: 50, sill: 8, rail: { depth: 20, screwX: [30, 170] } };
    const notch = plateNotchFor(box({ opening }))!;
    expect(messages(box({ opening, plate: { supports: [{ x: 100, y: notch.yHigh + 2 }] } }))).toContain("notch");
  });

  it("keeps off the seam rib, boards and everything else on the plate", () => {
    const seamed = box({ enclosure: { width: 300, frontHeight: 40, cornerRadius: 3, surfaces: [{ id: "top", y: 120, z: 40 }] }, seams: [{ x: 150 }], plate: { supports: [{ x: 155, y: 60 }] } });
    expect(messages(seamed)).toContain("seam rib");
    expect(messages({ ...supported(free), components: [{ id: "a", type: "ads7830", x: 110, y: 60 }] })).toContain("board");
    // Off a board's corner, it only has to clear the corner itself.
    expect(errors({ ...supported(free), components: [{ id: "a", type: "ads7830", x: 100 - 4 - 8.85, y: 60 - 4 - 21.25 }] })).toEqual([]);
    const screw = plan(box()).plate!.screws[0]!;
    // A screw's boss is round, so a support can sit closer on a diagonal than straight beside it.
    expect(messages(supported({ x: screw[0] + 6, y: screw[1] + 6 }))).toContain("another fixing");
    expect(errors(supported({ x: screw[0] + 7, y: screw[1] + 7 }))).toEqual([]);
    expect(messages(box({ plate: { supports: [free], countersunkHoles: [{ x: 108, y: 60 }] } }))).toContain("another fixing");
    expect(messages(box({ plate: { supports: [free], pins: [{ x: 106, y: 60, diameter: 3, height: 3 }] } }))).toContain("another fixing");
    expect(messages(box({ plate: { supports: [free], cableTies: [{ x: 109, y: 60 }] } }))).toContain("another fixing");
    expect(messages(supported(free, { x: 108, y: 60 }))).toContain("another support");
    expect(errors(supported(free, { x: 110, y: 60 }))).toEqual([]);
  });

  it("keeps clear of what's under the top", () => {
    const under = (component: object) => ({ ...supported(free), components: [component] });
    // A dial whose window is beside it, but whose body below the top reaches over it.
    expect(messages(under({ id: "d", type: "ec11-dial-19mm", surface: "top", u: 110, v: 60 }))).toContain("body of a part");
    expect(messages(under({ id: "d", type: "ec11-dial-19mm", surface: "top", u: 106, v: 60 }))).toContain("cutout");
    expect(errors(under({ id: "d", type: "ec11-dial-19mm", surface: "top", u: 116, v: 60 }))).toEqual([]);
  });

  it("fits between round buttons, as the Desk Synth V2's do, but not between square parts the same size", () => {
    const grid = (type: string) => [[85, 45], [115, 45], [85, 75], [115, 75]].map(([u, v], i) => ({ id: `b${i}`, type, surface: "top", u, v }));
    expect(errors({ ...supported(free), components: grid("arcade-24mm") })).toEqual([]);
    const square = { name: "square", source: "estimated", mount: "panel", cutouts: [{ kind: "rect", width: 24.24, height: 24.24 }], above: { footprint: { shape: "rect", width: 26.4, height: 26.4 }, height: 4.6 }, below: { footprint: { shape: "rect", width: 23.2, height: 23.2 }, depth: 22 } };
    expect(messages({ ...supported(free), customParts: { square }, components: grid("square") })).toContain("can't go there");
    // The real V2, with its three between the buttons.
    expect(errors(deskSynthV2())).toEqual([]);
  });

  it("allows for a round body leaning back under a sloping top", () => {
    // The button's hole is round, and well clear, but its body runs down the slope towards the support.
    const sloped = { schemaVersion: 1, name: "s", enclosure: { width: 200, frontHeight: 30, cornerRadius: 3, surfaces: [{ id: "top", y: 120, z: 80 }] }, components: [{ id: "b", type: "arcade-24mm", surface: "top", u: 100, v: 60 }] };
    expect(messages({ ...sloped, plate: { supports: [{ x: 100, y: 76 }] } })).toContain("body of a part");
    expect(errors({ ...sloped, plate: { supports: [{ x: 100, y: 82 }] } })).toEqual([]);
    expect(roundGap({ x: 0, yLow: 10, yHigh: 20, r: 5 }, 0, 30)).toBe(5);
    expect(roundGap({ x: 0, yLow: 10, yHigh: 20, r: 5 }, 3, 24)).toBe(0);
    expect(roundGap({ x: 0, yLow: 10, yHigh: 20, r: 5 }, 8, 15)).toBe(3);
  });

  it("stays out of an opening, and the room kept for what it holds", () => {
    const opening = { xMin: 40, xMax: 160, yEnd: 50, sill: 8 };
    expect(messages(box({ opening, plate: { supports: [{ x: 100, y: 40 }] } }))).toContain("in the opening");
    const kept = { ...opening, keepOut: [{ xMin: 40, xMax: 160, yMin: 0, yMax: 80, top: 15 }] };
    expect(messages(box({ opening: kept, plate: { supports: [{ x: 100, y: 75 }] } }))).toContain("contents");
  });

  it("keeps out of a top screw's way", () => {
    const real = deskSynth();
    const buildPlan = plan(real);
    const screw = buildPlan.topScrews.find((s) => s.wall === "rear")!;
    real.plate = { ...real.plate, supports: [{ x: screw.x, y: screw.y - 12 }] };
    expect(messages(real)).toContain("top screw");
  });

  it("is edited in the form, leaving nothing behind", () => {
    const added = addSupport(box());
    expect(added.plate.supports).toEqual([{ x: 100, y: 60 }]);
    expect(updateSupport(added, 0, { diameter: 10 }).plate.supports[0]).toEqual({ x: 100, y: 60, diameter: 10 });
    expect(removeSupport(added, 0)).toEqual(box());
  });

  it("has its spot marked if there's a problem", () => {
    const config = supported({ x: 9, y: 60 });
    const spot = issueSpot({ path: "plate.supports[0]" }, config, buildSceneModel(config)!, { items: [], edges: [] })!;
    expect(spot.min[0]).toBeCloseTo(4);
  });

  it("prints as part of a watertight plate", async () => {
    const { parts } = buildEnclosure(plan(supported(free, { x: 140, y: 80 })));
    const plate = parts.find((p) => p.name.startsWith("Plate"))!.shape;
    const stl = new Uint8Array(await plate.blobSTL({ binary: true }).arrayBuffer());
    expect(analyseBinarySTL(stl).watertight).toBe(true);
  });
});
