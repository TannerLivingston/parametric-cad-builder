// Parts on a curved surface, each on a flat let into it.
import { beforeAll, describe, expect, it } from "vitest";
import { buildEnclosure, initEngine, planPrint, validateConfig, type BuildPlan } from "../src/index.js";
import { chainHeight, surfacePoint } from "../src/profile.js";
import { FLAT_MARGIN, FLAT_STEP, partReach } from "../src/flats.js";
import { library } from "../src/library.js";
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
    const label = hooded({ labels: [{ text: "VOL", component: "dial" }] });
    expect(errors(label).map((e) => e.message).join()).toMatch(/on a curve/);
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

  it("builds on a curve that dips", async () => {
    const built = plan(hooded({}, -5));
    expect(await buildProblems(built, buildEnclosure(built))).toEqual([]);
  }, 240_000);
});
