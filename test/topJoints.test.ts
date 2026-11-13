// Where a top panel splits: a tongue on one piece and a groove in the next keep their faces flush.
import { beforeAll, describe, expect, it } from "vitest";
import { drawRectangle, measureVolume, Plane, type Shape3D } from "replicad";
import { buildEnclosure, initEngine, planPrint, validateConfig, type BuildPlan } from "../src/index.js";
import { isValidSolid } from "../src/checks.js";
import { surfacePoint, type Surface } from "../src/profile.js";
import { GROOVE_DEPTH, TONGUE_FIT, TONGUE_INSET } from "../src/top.js";
import { deckAndPanel, errors, deskSynth } from "./helpers.js";

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
// A small block in the panel: `a` across the split, `depth` in from its face, and `v` along it.
function block(surface: Surface, x: number, [a0, a1]: [number, number], [d0, d1]: [number, number], [v0, v1]: [number, number]): Shape3D {
  const [y, z] = surfacePoint(surface, v0, 0);
  const plane = new Plane([x, y, z], [1, 0, 0], [0, surface.cos, surface.sin]);
  return drawRectangle(a1 - a0, d1 - d0).translate((a0 + a1) / 2, (d0 + d1) / 2).sketchOnPlane(plane).extrude(v1 - v0) as Shape3D;
}

beforeAll(async () => {
  await initEngine();
}, 180_000);

describe("a split in a top panel", () => {
  const buildPlan = plan(deskSynth());
  const pieces = (name: string) => buildPlan.topPieces.find((p) => p.name === name)!;

  it("gets a tongue on the left piece and a groove in the right, short of either end", () => {
    const left = pieces("Panel 1");
    const right = pieces("Panel 2");
    expect(left.tongue).toMatchObject({ x: left.xMax, root: 1.2 });
    expect(right.groove).toMatchObject({ x: right.xMin });
    expect(left.groove).toBeNull();
    expect(right.tongue).toBeNull();
    const surface = buildPlan.profile.surfaces.find((s) => s.id === "panel")!;
    expect(left.tongue!.vFrom).toBe(TONGUE_INSET);
    expect(left.tongue!.vTo).toBeCloseTo(surface.length - TONGUE_INSET);
  });

  it("leaves pieces either side of the opening alone, since they don't meet", () => {
    for (const name of ["Deck 1", "Deck 2"]) expect(pieces(name)).toMatchObject({ tongue: null, groove: null });
  });

  it("fits the tongue into the groove, with skin left either side of it", () => {
    const { parts } = buildEnclosure(buildPlan);
    const shape = (name: string) => parts.find((p) => p.name === name)!.shape;
    const left = shape("Panel 1");
    const right = shape("Panel 2");
    expect(isValidSolid(left) && isValidSolid(right)).toBe(true);
    expect(overlap(left, right)).toBeLessThan(0.001);
    const joint = pieces("Panel 1").tongue!;
    const surface = buildPlan.profile.surfaces.find((s) => s.id === "panel")!;
    const t = buildPlan.config.enclosure.panelThickness;
    // Clear of the opening, which takes the front of the panel here.
    const along: [number, number] = [30, joint.vTo - 2];
    // The tongue, just past the split, is on the left piece.
    const tongue = block(surface, joint.x, [0.1, 0.4], [joint.face + 0.1, joint.face + 0.5], along);
    expect(overlap(left, tongue) / measureVolume(tongue)).toBeGreaterThan(0.999);
    // The right piece keeps its face and its inside, either side of the groove.
    const face = block(surface, joint.x, [0.1, 1], [0.05, joint.face - 0.2], along);
    const inside = block(surface, joint.x, [0.1, 1], [joint.face + joint.root + 0.2, t - 0.05], along);
    expect(overlap(right, face) / measureVolume(face)).toBeGreaterThan(0.999);
    expect(overlap(right, inside) / measureVolume(inside)).toBeGreaterThan(0.999);
    // There's room for it to go in, under its flat side.
    const gap = block(surface, joint.x, [0.1, 0.5], [joint.face - TONGUE_FIT + 0.03, joint.face - 0.03], along);
    expect(overlap(left, gap) + overlap(right, gap)).toBeLessThan(0.001);
    // Nothing of the tongue is left in the opening.
    const opening = buildPlan.config.opening!;
    const front = (opening.yEnd - surface.y0) / surface.cos - 1;
    expect(overlap(left, block(surface, joint.x, [0.05, 1.1], [joint.face + 0.05, joint.face + 1.1], [joint.vFrom, front]))).toBeLessThan(0.001);
    // And past the groove, it's whole.
    const beyond = block(surface, joint.x, [GROOVE_DEPTH + 0.05, GROOVE_DEPTH + 1], [0.05, t - 0.05], along);
    expect(overlap(right, beyond) / measureVolume(beyond)).toBeGreaterThan(0.999);
  }, 120_000);

  it("keeps the groove clear of a screw's boss beside it", () => {
    const config = deckAndPanel({ topPanels: [{ surface: "panel", splits: [100], fasteners: { add: [{ wall: "rear", at: 104.5 }] } }] });
    const near = plan(config);
    expect(near.topScrews.some((screw) => screw.x === 104.5)).toBe(true);
    const { parts } = buildEnclosure(near);
    const right = parts.find((p) => p.name === "Panel 2")!.shape;
    const surface = near.profile.surfaces.find((s) => s.id === "panel")!;
    const joint = near.topPieces[1]!.groove!;
    // Where the boss is, from y 116, up to the groove's end.
    const groove = block(surface, joint.x, [0.4, 0.8], [joint.face + 0.1, joint.face + 0.4], [(116 - surface.y0) / surface.cos, joint.vTo]);
    expect(overlap(right, groove)).toBeLessThan(0.001);
  }, 120_000);

  it("prints face down with no supports, either side", () => {
    const { parts } = buildEnclosure(buildPlan);
    const reports = planPrint(buildPlan, parts.map((p) => p.shape.mesh({ tolerance: 0.1, angularTolerance: 0.3 })));
    for (const name of ["Panel 1", "Panel 2"]) expect(reports.find((r) => r.name === name)!.needsSupport).toBe(false);
  }, 120_000);

  it("is left flat when asked", () => {
    const config = deskSynth();
    config.topPanels = config.topPanels.map((panel: any) => ({ ...panel, joint: "flat" }));
    for (const piece of plan(config).topPieces) expect(piece).toMatchObject({ tongue: null, groove: null });
  });

  it("needs a thick enough panel, or a flat joint", () => {
    const thin = deskSynth();
    thin.enclosure.panelThickness = 2;
    const problem = errors(thin).find((e) => e.code === "TOP_PANEL_INVALID");
    expect(problem?.message).toContain('"flat"');
    thin.topPanels = thin.topPanels.map((panel: any) => ({ ...panel, joint: "flat" }));
    expect(errors(thin).filter((e) => e.code === "TOP_PANEL_INVALID")).toEqual([]);
  });

  it("keeps cutouts back from the groove", () => {
    const config = deskSynth();
    const x = pieces("Panel 2").xMin;
    // An encoder's 7.4 mm hole, as close as a plain edge allows, but not past the groove.
    config.components.push({ id: "near", type: "ec11-dial-19mm", surface: "panel", u: x + 3.7 + 1.3, v: 22 });
    expect(errors(config).some((e) => e.code === "CUTOUT_CROSSES_SEAM" && e.message.includes("near"))).toBe(true);
    config.topPanels = config.topPanels.map((panel: any) => ({ ...panel, joint: "flat" }));
    expect(errors(config).some((e) => e.code === "CUTOUT_CROSSES_SEAM" && e.message.includes("near"))).toBe(false);
  });
});
