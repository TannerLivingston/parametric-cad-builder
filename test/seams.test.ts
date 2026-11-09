// More than one seam: a shell in three pieces, and a plate split to match.
import { beforeAll, describe, expect, it } from "vitest";
import { buildEnclosure, initEngine, orientationsFor, planPrint, validateConfig, type BuildPlan } from "../src/index.js";
import { isValidSolid } from "../src/checks.js";
import { SEAM_DRIVER_ROOM } from "../src/plate.js";
import { errors } from "./helpers.js";
import { addSeam, removeSeam, setPlateSplit, setSeam, updateSeam } from "../src/app/shapeEdit.js";

// Too wide for two pieces on a 256 mm bed.
const wide = (more: Record<string, unknown> = {}): any => ({
  schemaVersion: 1,
  name: "wide",
  enclosure: { width: 560, frontHeight: 45, surfaces: [{ id: "top", y: 150, z: 45 }] },
  // Out of order on purpose.
  seams: [{ x: 373, lip: 3 }, { x: 186, lip: 3 }],
  components: [
    { id: "mcu", type: "rp2040-plus", x: 28.9, y: 100 },
    // In a top panel, since a round hole in the shell's own skin needs a little support on its side.
    { id: "b", type: "arcade-24mm", surface: "top", u: 280, v: 75 },
  ],
  topPanels: [{ surface: "top", splits: [210, 400] }],
  ...more,
});
function plan(config: unknown): BuildPlan {
  const result = validateConfig(config);
  if (!result.ok) throw new Error(JSON.stringify(result.errors, null, 1));
  return result.plan;
}
const seamErrors = (config: unknown) => errors(config).filter((e) => e.code === "SEAM_INVALID").map((e) => e.message).join(" ");

describe("a shell in three pieces", () => {
  it("has its seams in order, and each piece fits the bed", () => {
    const built = plan(wide());
    expect(built.seams.map((seam) => seam.x)).toEqual([186, 373]);
    const shells = built.printedParts.filter((part) => part.kind === "shell");
    expect(shells.map((part) => part.name)).toEqual(["Shell 1", "Shell 2", "Shell 3"]);
    for (const part of shells) expect(part.size[0]).toBeLessThanOrEqual(256);
    // The middle piece carries the second seam's lip, with its sloped end, and the last nothing past its end.
    expect(shells[1]!.size[0]).toBeCloseTo(373 - 186 + 3 + 1.5);
    expect(shells[2]!.size[0]).toBeCloseTo(560 - 373);
  });

  it("prints the first and middle pieces on their left end, and the last on its right wall", () => {
    const built = plan(wide());
    const planned = built.printedParts.filter((part) => part.kind === "shell").map((part) => orientationsFor(built, part).find((o) => o.planned)!.id);
    expect(planned).toEqual(["left-down", "left-down", "right-down"]);
  });

  it("splits the plate once for each piece it needs, each joint off a seam", () => {
    const built = plan(wide());
    expect(built.plate!.joints).toHaveLength(2);
    built.plate!.joints.forEach((joint, i) => expect(Math.abs(joint - built.seams[i]!.x)).toBeGreaterThanOrEqual(15));
    const plates = built.printedParts.filter((part) => part.kind === "plate");
    expect(plates).toHaveLength(3);
    for (const part of plates) expect(part.size[0]).toBeLessThanOrEqual(256);
    // Two seams on a plate that only needs two pieces split it once.
    const narrower = plan(wide({ enclosure: { width: 420, frontHeight: 45, surfaces: [{ id: "top", y: 150, z: 45 }] }, seams: [{ x: 140 }, { x: 280 }], components: [], topPanels: [] }));
    expect(narrower.plate!.joints).toHaveLength(1);
  });

  it("can list its own plate joints, with a rib along each", () => {
    const built = plan(wide({ plate: { seamX: [330, 150], joint: "rib" } }));
    expect(built.plate!.joints).toEqual([150, 330]);
    expect(built.plate!.ribs.map((rib) => rib.x)).toEqual([150, 330]);
    expect(built.hardware).toContainEqual({ name: "M3 x 10 flat-head screw, for the plate's joint", count: built.plate!.ribs.reduce((sum, rib) => sum + rib.bolts.length, 0) });
    expect(built.steps.map((step) => step.text)).toContain("Bolt the plate's pieces together through the ribs along their joints, from the right, before anything goes on the plate.");
  });

  it("counts every seam's bolts, and says to bolt the pieces together left to right", () => {
    const built = plan(wide());
    const bolts = built.seams.reduce((sum, seam) => sum + seam.bolts.length, 0);
    expect(built.hardware).toContainEqual({ name: "M3 brass heat-set insert, for the seam", count: bolts });
    expect(built.steps[1]!.text).toMatch(/^Bolt the shell's pieces together first, left to right/);
  });

  it("refuses two seams in the same place, or too close for a driver to reach the right one's bolts", () => {
    expect(seamErrors(wide({ seams: [{ x: 186 }, { x: 186 }] }))).toContain("There's already a seam at x = 186");
    const close = 186 + 5 + 9 + SEAM_DRIVER_ROOM;
    expect(seamErrors(wide({ seams: [{ x: 186 }, { x: close }] }))).toContain("between it and the seam at x = 186");
    expect(seamErrors(wide({ seams: [{ x: 186 }, { x: close + 5 + 1 }] }))).toBe("");
  });
});

describe("a shell in three pieces, built", () => {
  let built: BuildPlan;
  let parts: ReturnType<typeof buildEnclosure>["parts"];
  beforeAll(async () => {
    await initEngine();
    built = plan(wide({ plate: { joint: "rib" } }));
    parts = buildEnclosure(built).parts;
  }, 240_000);

  it("makes each piece a solid of its own", () => {
    expect(parts.filter((part) => part.kind === "shell")).toHaveLength(3);
    expect(parts.filter((part) => part.kind === "plate")).toHaveLength(3);
    for (const part of parts) expect(isValidSolid(part.shape), part.name).toBe(true);
  });

  it("needs no support for any shell piece, the middle one standing on its lipped end", () => {
    const meshes = parts.map((part) => part.shape.mesh({ tolerance: 0.1, angularTolerance: 0.3 }));
    const reports = planPrint(built, meshes);
    for (const part of built.printedParts.filter((p) => p.kind === "shell" || p.kind === "plate")) {
      expect(reports[part.index]!.needsSupport, `${part.name}: ${reports[part.index]!.notes.join(" ")}`).toBe(false);
    }
  }, 240_000);
});

describe("seams in the form", () => {
  const box = (): any => ({ schemaVersion: 1, name: "f", enclosure: { width: 600, frontHeight: 40, surfaces: [{ id: "top", y: 150, z: 40 }] } });

  it("adds each new seam in the middle of the widest piece, and keeps the rest when one goes", () => {
    const one = setSeam(box(), 300);
    const two = addSeam(one);
    expect(two.seams).toEqual([{ x: 300 }, { x: 150 }]);
    expect(addSeam(two).seams.at(-1)).toEqual({ x: 450 });
    expect(removeSeam(two, 0).seams).toEqual([{ x: 150 }]);
    // The last one going joins the shell.
    expect(removeSeam(removeSeam(two, 0), 0)).not.toHaveProperty("seams");
  });

  it("moves a seam and sets its lip on its own, leaving the lip out at 0", () => {
    const two = addSeam(setSeam(box(), 300));
    const lipped = updateSeam(two, 1, { lip: 2 });
    expect(lipped.seams).toEqual([{ x: 300 }, { x: 150, lip: 2 }]);
    expect(updateSeam(lipped, 1, { x: 160 }).seams[1]).toEqual({ x: 160, lip: 2 });
    expect(updateSeam(lipped, 1, { lip: 0 }).seams[1]).toEqual({ x: 150 });
  });

  it("keeps one plate joint as a number, and several in order", () => {
    expect(setPlateSplit(box(), [200]).plate).toEqual({ seamX: 200 });
    expect(setPlateSplit(box(), [400, 200]).plate).toEqual({ seamX: [200, 400] });
    expect(setPlateSplit(setPlateSplit(box(), [200]), null)).not.toHaveProperty("plate");
  });
});
