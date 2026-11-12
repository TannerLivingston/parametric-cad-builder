// Parts on a curved surface, each on a flat let into it.
import { beforeAll, describe, expect, it } from "vitest";
import { measureVolume } from "replicad";
import { buildEnclosure, cutoutUp, cutoutVolume, initEngine, planPrint, validateConfig, type BuildPlan } from "../src/index.js";
import { chainHeight, findSurface, surfacePoint } from "../src/profile.js";
import { FLAT_MARGIN, FLAT_STEP, partReach } from "../src/flats.js";
import { library } from "../src/library.js";
import { buildSceneModel, curveCoordinates } from "../src/app/sceneModel.js";
import { buildProblems } from "./buildChecks.js";
import { errors } from "./helpers.js";

// A flat deck, a hood that arcs over, and a flat back, with a dial and a button on the hood.
const hooded = (more: Record<string, unknown> = {}, bulge = 8): any => ({
  schemaVersion: 1,
  name: "hooded",
  enclosure: {
    width: 300,
    frontHeight: 40,
    surfaces: [
      { id: "deck", y: 80, z: 40 },
      { id: "hood", y: 130, z: 60, bulge },
      { id: "back", y: 190, z: 55 },
    ],
  },
  seams: [{ x: 150, lip: 2 }],
  components: [
    { id: "dial", type: "ec11-dial-19mm", surface: "hood", u: 220, v: 28 },
    { id: "button", type: "arcade-24mm", surface: "hood", u: 70, v: 28 },
    { id: "e", type: "rp2040-plus", x: 28.9, y: 150 },
  ],
  ...more,
});
function plan(config: unknown): BuildPlan {
  const result = validateConfig(config);
  if (!result.ok) throw new Error(JSON.stringify(result.errors, null, 1));
  return result.plan;
}

describe("a flat let into a curve, planned", () => {
  it("is made for each part on one, just bigger than the part, with the part at its own v", () => {
    const built = plan(hooded());
    expect(built.flats.map((flat) => flat.componentId)).toEqual(["dial", "button"]);
    const flat = built.flats[0]!;
    const [hu, hv] = partReach(library["ec11-dial-19mm"] as any, 0);
    expect([flat.uLow, flat.uHigh]).toEqual([220 - hu - FLAT_MARGIN, 220 + hu + FLAT_MARGIN]);
    expect(flat.vHigh - flat.vLow).toBeCloseTo(2 * (hv + FLAT_MARGIN));
    expect(flat.surface.flatOf).toBe("hood");
    expect(built.cutouts.find((c) => c.componentId === "dial")!.surface).toBe(flat.surface.id);
    // Sunk into a curve that rises: its ends a step under the curve, its middle further.
    expect(flat.rises).toBe(true);
    expect(flat.sink).toBeGreaterThan(FLAT_STEP + 0.5);
    const [y, z] = surfacePoint(flat.surface, 28, 0);
    expect(chainHeight(built.profile.outer, y) - z).toBeGreaterThan(flat.sink * 0.8);
    const [endY, endZ] = [flat.surface.y1, flat.surface.z1];
    expect(chainHeight(built.profile.outer, endY) - endZ).toBeGreaterThan(0.1);
    expect(chainHeight(built.profile.outer, endY) - endZ).toBeLessThan(0.4);
  });

  it("stands proud of a curve that dips", () => {
    const built = plan(hooded({}, -5));
    const flat = built.flats[0]!;
    expect(flat.rises).toBe(false);
    const [y, z] = surfacePoint(flat.surface, 28, 0);
    expect(z - chainHeight(built.profile.outer, y)).toBeGreaterThan(flat.sink * 0.8);
  });

  it("is refused too near the curve's end, a seam or another part, or where it would sink too far", () => {
    const at = (patch: Record<string, unknown>, bulge = 8) => {
      const config = hooded({}, bulge);
      Object.assign(config.components[0], patch);
      return errors(config).map((e) => e.message).join(" ");
    };
    expect(at({ v: 8 })).toMatch(/too near an end of the curve/);
    expect(at({ u: 160 })).toMatch(/too near the seam/);
    expect(at({ u: 95 })).toMatch(/each needs a flat of its own/);
    expect(at({ u: 10 })).toMatch(/too near a wall/);
    expect(at({ type: "arcade-24mm" }, 20)).toMatch(/too big for the curve|slopes/);
  });
});

describe("a part's label on a curve", () => {
  it("makes the flat bigger on its side, and is engraved on the flat", () => {
    const plain = plan(hooded()).flats[0]!;
    const built = plan(hooded({ labels: [{ text: "VOL", component: "dial", side: "above", size: 4 }] }));
    const flat = built.flats[0]!;
    expect(flat.vLow).toBeCloseTo(plain.vLow);
    expect(flat.vHigh - plain.vHigh).toBeCloseTo(1.5 + 4, 1);
    const label = built.labels[0]!;
    expect(label.on).toMatchObject({ kind: "surface", surface: flat.surface.id });
    if (label.on.kind !== "surface") throw new Error("not on a surface");
    expect(label.on.v + label.up / 2).toBeLessThanOrEqual(flat.vHigh - 1.9);
    expect(label.on.v - label.up / 2).toBeGreaterThan(28);
    // A wide one, beside it, widens the flat that way only.
    const wide = plan(hooded({ labels: [{ text: "VOLUME", component: "dial", side: "left", size: 4 }] })).flats[0]!;
    expect(wide.uHigh).toBeCloseTo(plain.uHigh);
    expect(plain.uLow - wide.uLow).toBeGreaterThan(15);
  });
});

describe("dragging over a curve", () => {
  it("finds where a ray meets it, as u and how far along it", () => {
    const { surfaces } = plan(hooded()).profile;
    const flats = surfaces.filter((s) => s.curveOf === "hood");
    // Straight down onto the middle of the third short flat.
    const third = flats[2]!;
    const before = flats[0]!.length + flats[1]!.length;
    const [y, z] = surfacePoint(third, third.length / 2, 0);
    const on = curveCoordinates(surfaces, "hood", [120, y, z + 50], [0, 0, -1])!;
    expect(on.u).toBeCloseTo(120);
    expect(on.v).toBeCloseTo(before + third.length / 2);
    // Past its front end, it carries on along the first one.
    const first = flats[0]!;
    const [fy, fz] = surfacePoint(first, -5, 0);
    expect(curveCoordinates(surfaces, "hood", [10, fy, fz + 30], [0, 0, -1])!.v).toBeCloseTo(-5);
    expect(curveCoordinates(surfaces, "deck", [10, 40, 90], [0, 0, -1])).toBeNull();
  });

  it("shows a part on a curve on its own flat, and says which curve", () => {
    const model = buildSceneModel(hooded())!;
    const dial = model.components.find((c) => c.id === "dial")!;
    expect(dial.curve).toBe("hood");
    expect(dial.surface).toEqual(plan(hooded()).flats[0]!.surface);
  });
});

describe("a flat let into a curve, built", () => {
  beforeAll(async () => {
    await initEngine();
  });

  it("builds sound halves, each hole through a skin as thick as the surface's, with no support", async () => {
    const built = plan(hooded());
    const enclosure = buildEnclosure(built);
    expect(await buildProblems(built, enclosure)).toEqual([]);
    const reports = planPrint(built, enclosure.parts.map((part) => part.shape.mesh({ tolerance: 0.1, angularTolerance: 0.3 })));
    for (const part of built.printedParts.filter((p) => p.kind === "shell")) {
      expect(reports[part.index]!.needsSupport, `${part.name}: ${reports[part.index]!.notes.join(" ")}`).toBe(false);
    }
  }, 240_000);

  it("builds with a label engraved on the flat", async () => {
    const built = plan(hooded({ labels: [{ text: "VOL", component: "dial", side: "above", size: 4 }] }));
    // Sound, with a little more taken out of the dial's half than its hole alone: the letters.
    const enclosure = buildEnclosure(built);
    expect(await buildProblems(built, enclosure)).toEqual([]);
    const part = enclosure.parts.find((p) => p.index === built.labels[0]!.printedPart)!;
    const hole = built.cutouts.filter((c) => c.printedPart === part.index).reduce((sum, c) => sum + cutoutVolume(c, findSurface(built.profile, c.surface)!.thickness, cutoutUp(built, c)), 0);
    const letters = measureVolume(part.blank) - measureVolume(part.cut) - hole;
    expect(letters).toBeGreaterThan(3);
    expect(letters).toBeLessThan(15);
  }, 240_000);

  it("builds on a curve that dips", async () => {
    const built = plan(hooded({}, -5));
    expect(await buildProblems(built, buildEnclosure(built))).toEqual([]);
  }, 240_000);
});
