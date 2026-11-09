// Vents and cable tie bridges: more holes and more plastic, which have to stay out of everything's way.
import { beforeAll, describe, expect, it } from "vitest";
import { makeCylinder, measureVolume, type Shape3D } from "replicad";
import { analyseBinarySTL, isValidSolid } from "../src/checks.js";
import { buildEnclosure, initEngine, planPrint, validateConfig, type BuildPlan } from "../src/index.js";
import { TIE_BRIDGE, ventSlots } from "../src/fixtures.js";
import { addCableTie, addVent, removeCableTie, removeVent, updateCableTie, updateVent } from "../src/app/shapeEdit.js";
import { buildSceneModel, issueSpot } from "../src/app/sceneModel.js";
import { plateNotchFor } from "../src/validate.js";
import { errors, deskSynth } from "./helpers.js";

const box = (overrides: Record<string, unknown> = {}): any => ({
  schemaVersion: 1,
  name: "box",
  enclosure: { width: 200, frontHeight: 40, cornerRadius: 3, surfaces: [{ id: "top", y: 120, z: 40 }] },
  ...overrides,
});
const vent = (more: Record<string, unknown> = {}) => ({ wall: "rear", at: 100, z: 20, width: 40, height: 12, ...more });
const ties = (...cableTies: unknown[]) => box({ plate: { cableTies } });
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
const messages = (config: unknown) => errors(config).map((e) => e.message).join(" ");

describe("a vent", () => {
  it("fits as many slots as it can, centred", () => {
    const slots = ventSlots({ at: 100, width: 40, slotWidth: 2, gap: 2 });
    expect(slots).toHaveLength(10);
    expect((slots[0]! + slots.at(-1)!) / 2).toBeCloseTo(100);
    expect(slots[1]! - slots[0]!).toBeCloseTo(4);
    expect(ventSlots({ at: 100, width: 1, slotWidth: 2, gap: 2 })).toEqual([100]);
    // No wider than it was asked to be.
    expect(slots.at(-1)! + 1 - (slots[0]! - 1)).toBeLessThanOrEqual(40);
  });

  it("becomes wall holes, with their checks", () => {
    const holes = plan(box({ vents: [vent()] })).wallHoles;
    expect(holes).toHaveLength(10);
    expect(holes[0]).toMatchObject({ wall: "rear", z: 20, width: 2, height: 12, path: "vents[0]" });
    expect(messages(box({ vents: [vent({ at: 10 })] }))).toContain("too close to a corner");
    expect(messages(box({ vents: [vent({ z: 36 })] }))).toContain("A slot in a vent");
    // Slots that are too close together for the plastic between them.
    expect(messages(box({ vents: [vent({ gap: 0.5 })] }))).toContain("too close to another hole");
  });

  it("keeps other things out of its way", () => {
    expect(messages(box({ vents: [vent()], wallHoles: [{ wall: "rear", at: 100, z: 20, width: 10, height: 8 }] }))).toContain("too close");
    expect(messages(box({ vents: [vent()], labels: [{ text: "A", wall: "rear", at: 100, z: 20 }] }))).toContain("hole");
    const screws = plan(box({ vents: [vent({ at: 100 })] })).plate!.screws;
    expect(screws.some(([x, y]) => Math.abs(x - 100) < 20 && y > 100)).toBe(false);
  });

  it("has its spot marked if there's a problem", () => {
    const config = box({ vents: [vent({ at: 10 })] });
    const spot = issueSpot({ path: "vents[0]" }, config, buildSceneModel(config)!, { items: [], edges: [] })!;
    expect(spot.min[0]).toBeCloseTo(-10);
    expect(spot.max[1]).toBeCloseTo(121);
  });

  it("is edited in the form, leaving nothing behind", () => {
    const added = addVent(box());
    expect(validateConfig(added).ok).toBe(true);
    expect(updateVent(added, 0, { width: 20.123 }).vents[0].width).toBe(20.12);
    expect(removeVent(added, 0)).toEqual(box());
  });
});

describe("a cable tie bridge", () => {
  const free = { x: 100, y: 60 };

  it("has to stay on the plate and off everything on it", () => {
    expect(errors(ties(free))).toEqual([]);
    expect(messages(ties({ x: 4, y: 60 }))).toContain("edge of the plate");
    expect(messages(ties({ x: 100, y: 118 }))).toContain("edge of the plate");
    const screw = plan(box()).plate!.screws[0]!;
    expect(messages(ties({ x: screw[0] + 2, y: screw[1] + 2 }))).toContain("screws");
    expect(messages(box({ plate: { cableTies: [free], countersunkHoles: [{ x: 104, y: 60 }] } }))).toContain("covers a hole");
    expect(messages(box({ plate: { cableTies: [free], pins: [{ x: 104, y: 60, diameter: 3, height: 3 }] } }))).toContain("hits a pin");
    expect(messages({ ...ties(free), components: [{ id: "a", type: "ads7830", x: 100, y: 60 }] })).toContain('under "a"');
    expect(messages(ties(free, { x: 104, y: 60 }))).toContain("another one");
    // Clear of the board, but on one of the clips that stick out past it.
    const board = { id: "m", type: "rp2040-plus", x: 100, y: 72 };
    const clip = plan(box({ components: [board] })).holderBlocks.filter((block) => block.kind === "clip").sort((a, b) => a.yLow - b.yLow)[0]!;
    expect(messages({ ...ties({ x: (clip.xLow + clip.xHigh) / 2, y: clip.yLow - 2.5 }), components: [board] })).toContain("mount");
  });

  it("can't cross the plate's joint, or be in the rail's notch or the opening's room", () => {
    expect(messages(box({ plate: { seamX: 100, cableTies: [free] } }))).toContain("joint");
    const opening = { xMin: 40, xMax: 160, yEnd: 60, sill: 8, keepOut: [{ xMin: 40, xMax: 160, yMin: 0, yMax: 100, top: 15 }] };
    expect(messages({ ...ties(free), opening })).toContain("room kept");
    const real = deskSynth();
    const notch = plateNotchFor(plan(real).config)!;
    real.plate = { ...real.plate, cableTies: [{ x: notch.xHigh - 8, y: notch.yHigh + 1 }] };
    expect(messages(real)).toMatch(/notch/);
  });

  it("is edited in the form, leaving nothing behind", () => {
    const added = addCableTie(box());
    expect(added.plate.cableTies).toEqual([{ x: 100, y: 60 }]);
    expect(updateCableTie(added, 0, { rotationDeg: 90 }).plate.cableTies[0]).toEqual({ x: 100, y: 60, rotationDeg: 90 });
    expect(removeCableTie(added, 0)).toEqual(box());
  });

  it("has its spot marked if there's a problem", () => {
    const config = ties({ x: 4, y: 60 });
    const spot = issueSpot({ path: "plate.cableTies[0]" }, config, buildSceneModel(config)!, { items: [], edges: [] })!;
    expect(spot.min[1]).toBeCloseTo(54);
  });
});

describe("as printed", () => {
  beforeAll(() => initEngine(), 60_000);
  const sound = async (shape: Shape3D) => {
    expect(isValidSolid(shape)).toBe(true);
    const stl = analyseBinarySTL(new Uint8Array(await shape.blobSTL({ binary: true, tolerance: 0.05, angularTolerance: 0.2 }).arrayBuffer()));
    expect(stl.watertight).toBe(true);
    expect(shape.solids).toHaveLength(1);
  };

  it("cuts every slot of a vent through the wall, and leaves plastic between them", async () => {
    const built = plan(box({ vents: [vent()] }));
    const shape = buildEnclosure(built).parts[0]!.shape;
    await sound(shape);
    for (const hole of built.wallHoles) {
      expect(overlap(shape, makeCylinder(0.8, 4, [hole.at, 116.5, 20], [0, 1, 0]))).toBeLessThan(0.001);
      expect(overlap(shape, makeCylinder(0.4, 2, [hole.at + 2, 117.5, 20], [0, 1, 0]))).toBeGreaterThan(0.1);
    }
  }, 60_000);

  it("cuts a vent on each kind of wall, including on a seamed shell", async () => {
    for (const wall of ["front", "left", "right"]) await sound(buildEnclosure(plan(box({ vents: [vent({ wall, at: wall === "front" ? 100 : 60 })] }))).parts[0]!.shape);
    const { parts } = buildEnclosure(plan(box({ seams: [{ x: 100 }], vents: [vent({ at: 50 })] })));
    await sound(parts[0]!.shape);
  }, 120_000);

  const bridge = (rotationDeg: 0 | 90) => {
    const built = plan(ties({ x: 100, y: 60, rotationDeg }));
    return { built, plate: buildEnclosure(built).parts.find((part) => part.kind === "plate")!.shape };
  };

  it("makes a bridge with a slot under it, the way the tie runs", async () => {
    const { plate } = bridge(0);
    await sound(plate);
    const { floorThickness: floor } = plan(box()).config.enclosure;
    const { slotHeight, height } = TIE_BRIDGE;
    // A stick through the slot, front to back, is clear, and the roof over it is there.
    expect(overlap(plate, makeCylinder(0.5, 10, [100, 55, floor + slotHeight / 2], [0, 1, 0]))).toBeLessThan(0.001);
    expect(overlap(plate, makeCylinder(0.5, 0.5, [100, 60, floor + slotHeight + 0.5]))).toBeGreaterThan(0.1);
    // It's pointed, so there's plastic where a flat roof would have left a gap.
    expect(overlap(plate, makeCylinder(0.15, 0.1, [100 + 2, 60, floor + slotHeight - 0.5]))).toBeGreaterThan(0.001);
    expect(overlap(plate, makeCylinder(0.15, 0.1, [100, 60, floor + slotHeight - 0.5]))).toBeLessThan(0.0001);
    // Legs either side, and nothing above it.
    expect(overlap(plate, makeCylinder(0.5, 2, [100 + 3.5, 60, floor + 0.2]))).toBeGreaterThan(0.1);
    expect(overlap(plate, makeCylinder(0.5, 2, [100, 60, floor + height + 0.1]))).toBeLessThan(0.001);
    // The other way, a stick across it hits a leg.
    expect(overlap(plate, makeCylinder(0.5, 12, [94, 60, floor + slotHeight / 2], [1, 0, 0]))).toBeGreaterThan(0.1);
  }, 60_000);

  it("turns it the other way", async () => {
    const { plate } = bridge(90);
    await sound(plate);
    const { floorThickness: floor } = plan(box()).config.enclosure;
    expect(overlap(plate, makeCylinder(0.5, 12, [94, 60, floor + TIE_BRIDGE.slotHeight / 2], [1, 0, 0]))).toBeLessThan(0.001);
    expect(overlap(plate, makeCylinder(0.5, 2, [100, 60 + 3.5, floor + 0.2]))).toBeGreaterThan(0.1);
  }, 60_000);

  it("prints a bridge without support, and counts its height", () => {
    const { built } = bridge(0);
    const { parts } = buildEnclosure(built);
    const reports = planPrint(built, parts.map((part) => part.shape.mesh({ tolerance: 0.1, angularTolerance: 0.3 })));
    const plate = reports.find((report) => report.name === "Plate")!;
    expect(plate.needsSupport).toBe(false);
    expect(built.printedParts.find((part) => part.kind === "plate")!.size[2]).toBeCloseTo(built.config.enclosure.floorThickness + TIE_BRIDGE.height);
  }, 60_000);
});
