// A rib along the plate's joint, which bolts its pieces together into one rigid plate.
import { beforeAll, describe, expect, it } from "vitest";
import { makeBox, makeCylinder, measureVolume, type Shape3D } from "replicad";
import { buildEnclosure, initEngine, planPrint, validateConfig, type BuildPlan } from "../src/index.js";
import { isValidSolid } from "../src/checks.js";
import { cavitySpan } from "../src/profile.js";
import { layoutPlateRibBolts, PLATE_RIB_BOLT_Z, PLATE_RIB_BOSS, PLATE_RIB_END, PLATE_RIB_FIT, PLATE_RIB_HEIGHT, PLATE_RIB_LEFT, PLATE_RIB_RIGHT, PLATE_RIB_TONGUE, PLATE_RIB_TONGUE_Z } from "../src/plate.js";
import { setPlateJoint } from "../src/app/shapeEdit.js";
import { errors, deskSynth } from "./helpers.js";

const box = (overrides: Record<string, unknown> = {}): any => ({
  schemaVersion: 1,
  name: "box",
  enclosure: { width: 300, frontHeight: 40, cornerRadius: 3, surfaces: [{ id: "top", y: 120, z: 40 }] },
  seams: [{ x: 210 }],
  plate: { seamX: 150, joint: "rib" },
  ...overrides,
});
const withPlate = (plate: Record<string, unknown>, more: Record<string, unknown> = {}) => box({ plate: { seamX: 150, joint: "rib", ...plate }, ...more });
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
const cube = (x: [number, number], y: [number, number], z: [number, number]) => makeBox([x[0], y[0], z[0]], [x[1], y[1], z[1]]) as unknown as Shape3D;
// The Desk Synth with its plate split where the V2's is, and the converter boards moved over for it, as they are there.
function v2Plate() {
  const config = deskSynth();
  config.plate = { ...config.plate, seamX: 176, joint: "rib" };
  for (const part of config.components) if (part.type === "ads7830") part.x = 163.85;
  return config;
}

beforeAll(async () => {
  await initEngine();
}, 60_000);

describe("the plate's rib", () => {
  it("runs between the walls inside any bottom round, with bolts along it", () => {
    const buildPlan = plan(box());
    const rib = buildPlan.plate!.ribs[0]!;
    const floor = buildPlan.config.enclosure.floorThickness;
    const [front, rear] = cavitySpan(buildPlan.profile.cavity, floor, floor + PLATE_RIB_HEIGHT);
    expect(rib.x).toBe(150);
    expect(rib.yLow).toBeGreaterThanOrEqual(front + 1 - 1e-9);
    expect(rib.yHigh).toBeLessThanOrEqual(rear - 1 + 1e-9);
    expect(rib.bolts.length).toBeGreaterThanOrEqual(2);
    expect(rib.bolts[0]).toBeCloseTo(rib.yLow + PLATE_RIB_END);
    expect(rib.bolts.at(-1)).toBeCloseTo(rib.yHigh - PLATE_RIB_END);
    // A bottom round narrows it.
    const rounded = plan(box({ enclosure: { width: 300, frontHeight: 40, cornerRadius: 3, surfaces: [{ id: "top", y: 120, z: 40 }], rounds: { frontBottom: 15 } } }));
    expect(rounded.plate!.ribs[0]!.yLow).toBeGreaterThan(rib.yLow + 2);
  });

  it("is only there when asked for, and where the plate splits", () => {
    expect(plan(box({ plate: { seamX: 150 } })).plate!.ribs).toEqual([]);
    expect(plan(box({ enclosure: { width: 240, frontHeight: 40, cornerRadius: 3, surfaces: [{ id: "top", y: 120, z: 40 }] }, seams: [], plate: { joint: "rib" } })).plate!.ribs).toEqual([]);
  });

  it("stops short of the shell's bosses beside the joint, and of a seam rib round the walls", () => {
    // A plate screw beside the joint, whose boss on the shell comes down to the plate.
    const buildPlan = plan(withPlate({ fasteners: { add: [{ x: 146, y: 6.55 }] } }, { seams: [{ x: 250 }] }));
    expect(buildPlan.plate!.screws).toContainEqual([146, 6.55]);
    expect(buildPlan.plate!.ribs[0]!.yLow).toBeGreaterThanOrEqual(6.55 + 4.5);
    const seamed = plan(box({ seams: [{ x: 158 }] }));
    const seam = seamed.seams[0]!;
    const floor = seamed.config.enclosure.floorThickness;
    const [front] = cavitySpan(seamed.profile.cavity, floor, floor + PLATE_RIB_HEIGHT);
    expect(seamed.plate!.ribs[0]!.yLow).toBeGreaterThanOrEqual(front + seam.ribWidth + 1 - 1e-9);
  });

  it("keeps out of the rail's notch", () => {
    const opening = { xMin: 100, xMax: 200, yEnd: 50, sill: 8, rail: { depth: 20, screwX: [90, 210] } };
    const buildPlan = plan(box({ opening }));
    expect(buildPlan.plate!.ribs[0]!.yLow).toBeGreaterThan(20);
  });

  it("refuses anything standing where it goes", () => {
    expect(errors(box())).toEqual([]);
    expect(messages(withPlate({}, { components: [{ id: "a", type: "ads7830", x: 150, y: 60 }] }))).toMatch(/rib .* runs into "a"/);
    expect(messages(withPlate({ cableTies: [{ x: 150, y: 60 }] }))).toContain("runs into a cable tie bridge");
    expect(messages(withPlate({ pins: [{ x: 151, y: 60, diameter: 3, height: 3 }] }))).toContain("runs into a pin");
    expect(messages(withPlate({ countersunkHoles: [{ x: 151, y: 60 }] }))).toContain("runs into a hole in the plate");
    expect(messages(withPlate({ supports: [{ x: 156, y: 60 }] }))).toContain("runs into a support");
  });

  it("refuses a board's mount, even with the board itself clear", () => {
    // Turned, so its clips stick out towards the rib, past the board.
    const board = { id: "m", type: "rp2040-plus", x: 150 - PLATE_RIB_LEFT - 0.25 - 10.5, y: 60, rotationDeg: 90 };
    expect(messages(box({ components: [board] }))).toContain('runs into the mount for "m"');
  });

  it("never puts two bolts together, when both have to move", () => {
    const blocked = (yLow: number, yHigh: number) => ({ xLow: 140, xHigh: 149, yLow, yHigh, top: 5, name: "something", fixed: false });
    const bolts = layoutPlateRibBolts({ x: 150, yLow: 4, yHigh: 116 }, [blocked(20, 53), blocked(66, 100)]);
    bolts.slice(1).forEach((y, i) => expect(y - bolts[i]!).toBeGreaterThanOrEqual(10));
  });

  it("moves a bolt off a board beside its boss, or the driver's way, and says so if none fit", () => {
    const plain = plan(box()).plate!.ribs[0]!.bolts;
    // A board left of the rib, beside a bolt's boss.
    const beside = { id: "a", type: "ads7830", x: 150 - PLATE_RIB_LEFT - 0.3 - 17.7 / 2 - 1, y: plain[1]! };
    const moved = plan(box({ components: [beside] })).plate!.ribs[0]!.bolts;
    expect(moved.every((y) => Math.abs(y - beside.y) > 21.25 + 4)).toBe(true);
    // A pin where the driver goes, right of a head.
    const pin = { x: 150 + PLATE_RIB_RIGHT + 10, y: plain[1]!, diameter: 3, height: 8 };
    expect(plan(withPlate({ pins: [pin] })).plate!.ribs[0]!.bolts.every((y) => Math.abs(y - pin.y) > 4)).toBe(true);
    // Boards both sides, all the way along.
    const wall = (id: string, y: number) => ({ id, type: "ads7830", x: 150 - PLATE_RIB_LEFT - 0.3 - 17.7 / 2 - 1, y });
    expect(messages(box({ components: [wall("a", 30), wall("b", 74), wall("c", 118)] }))).toMatch(/no room for two bolts, because its boss runs into "[abc]"/);
  });

  it("builds into both pieces, which fit together", () => {
    const buildPlan = plan(box());
    const rib = buildPlan.plate!.ribs[0]!;
    const floor = buildPlan.config.enclosure.floorThickness;
    const { parts } = buildEnclosure(buildPlan);
    const [left, right] = parts.filter((p) => p.kind === "plate").map((p) => p.shape) as [Shape3D, Shape3D];
    expect(isValidSolid(left) && isValidSolid(right)).toBe(true);
    expect(overlap(left, right)).toBeLessThan(0.001);
    const y = rib.bolts[0]!;
    const z = floor + PLATE_RIB_BOLT_Z;
    const inside = (shape: Shape3D, solid: Shape3D) => overlap(shape, solid) / measureVolume(solid);
    const middle = (rib.yLow + rib.yHigh) / 2;
    // Both halves of the wall, to its full height.
    expect(inside(left, cube([150 - PLATE_RIB_LEFT + 0.1, 149.9], [middle, middle + 1], [floor + 3.5, floor + PLATE_RIB_HEIGHT - 0.1]))).toBeGreaterThan(0.999);
    expect(inside(right, cube([150.1, 150 + PLATE_RIB_RIGHT - 0.1], [middle, middle + 1], [floor + 3.5, floor + PLATE_RIB_HEIGHT - 0.1]))).toBeGreaterThan(0.999);
    // A boss with its insert hole, and the block under it.
    expect(inside(left, cube([150 - PLATE_RIB_BOSS + 0.1, 150 - PLATE_RIB_LEFT], [y + 2.2, y + 3.5], [z - 1, z + 1]))).toBeGreaterThan(0.999);
    expect(inside(left, cube([150 - PLATE_RIB_BOSS + 0.1, 150 - PLATE_RIB_LEFT], [y - 3.5, y + 3.5], [floor + 0.1, z - 4]))).toBeGreaterThan(0.999);
    expect(overlap(left, makeCylinder(1.8, 5.5, [150 - 5.6, y, z], [1, 0, 0]) as Shape3D)).toBeLessThan(0.001);
    // The bolt's way through the right half, and its countersink.
    expect(overlap(right, makeCylinder(1.5, PLATE_RIB_RIGHT, [150, y, z], [1, 0, 0]) as Shape3D)).toBeLessThan(0.001);
    expect(overlap(right, makeCylinder(2.7, 0.2, [150 + PLATE_RIB_RIGHT - 0.4, y, z], [1, 0, 0]) as Shape3D)).toBeLessThan(0.001);
    // The tongue on the right half, with room around it in the groove.
    const tongueZ = floor + PLATE_RIB_TONGUE_Z;
    expect(inside(right, cube([150 - PLATE_RIB_TONGUE / 2 + 0.05, 149.95], [middle, middle + 1], [tongueZ - 0.2, tongueZ + 0.2]))).toBeGreaterThan(0.999);
    const pastTip = cube([150 - PLATE_RIB_TONGUE - PLATE_RIB_FIT + 0.03, 150 - PLATE_RIB_TONGUE - 0.03], [middle, middle + 1], [tongueZ - 0.05, tongueZ + 0.05]);
    expect(overlap(left, pastTip) + overlap(right, pastTip)).toBeLessThan(0.001);
  }, 120_000);

  it("prints both pieces standing up with no supports, and counts in their size", async () => {
    const buildPlan = plan(box());
    const { parts } = buildEnclosure(buildPlan);
    const reports = planPrint(buildPlan, parts.map((p) => p.shape.mesh({ tolerance: 0.1, angularTolerance: 0.3 })));
    for (const report of reports.filter((r) => r.name.startsWith("Plate"))) expect(report.needsSupport).toBe(false);
    const sizes = buildPlan.printedParts.filter((p) => p.kind === "plate").map((p) => p.size);
    for (const size of sizes) expect(size[2]).toBeCloseTo(buildPlan.config.enclosure.floorThickness + PLATE_RIB_HEIGHT);
    expect(sizes[1]![0]).toBeCloseTo(buildPlan.printedParts.find((p) => p.name === "Plate 2")!.xMax - 150 + PLATE_RIB_TONGUE);
  }, 120_000);

  it("adds its bolts to the hardware, and bolting it to the steps", () => {
    const buildPlan = plan(box());
    const count = buildPlan.plate!.ribs[0]!.bolts.length;
    expect(buildPlan.hardware).toEqual(expect.arrayContaining([{ name: "M3 x 10 flat-head screw, for the plate's joint", count }, { name: "M3 brass heat-set insert, for the plate's joint", count }]));
    const steps = buildPlan.assembly;
    const bolting = steps.findIndex((step) => step.includes("through the rib"));
    expect(bolting).toBeGreaterThan(0);
    expect(bolting).toBeLessThan(steps.findIndex((step) => step.startsWith("Screw on the plate")));
  });

  it("fits the Desk Synth split where the V2's is", () => {
    const rib = plan(v2Plate()).plate!.ribs[0]!;
    expect(rib.x).toBe(176);
    expect(rib.bolts.length).toBeGreaterThanOrEqual(2);
  });

  it("is chosen in the form, and a flat joint leaves the file", () => {
    const config = box({ plate: { seamX: 150 } });
    expect(setPlateJoint(config, "rib").plate).toEqual({ seamX: 150, joint: "rib" });
    expect(setPlateJoint(setPlateJoint(config, "rib"), "flat").plate).toEqual({ seamX: 150 });
  });
});
