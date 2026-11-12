// A curved top surface: an arc between its ends, held as a run of short flats.
import { beforeAll, describe, expect, it } from "vitest";
import { buildEnclosure, initEngine, planPrint, validateConfig, type BuildPlan } from "../src/index.js";
import { buildSurfaces, chainHeight, CURVE_FLATNESS, curvePoints } from "../src/profile.js";
import { buildProblems } from "./buildChecks.js";
import { errors } from "./helpers.js";
import { setSurfaceBulge } from "../src/app/shapeEdit.js";
import { withoutCurveCreases } from "../src/app/curveEdges.js";
import { addComponent } from "../src/app/configEdit.js";

// A flat deck, a hood that arcs up and over, and a flat back.
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
    { id: "a", type: "ttp223", surface: "deck", u: 60, v: 40 },
    { id: "c", type: "ec11-dial-19mm", surface: "back", u: 220, v: 30 },
    { id: "e", type: "rp2040-plus", x: 28.9, y: 150 },
  ],
  ...more,
});
function plan(config: unknown): BuildPlan {
  const result = validateConfig(config);
  if (!result.ok) throw new Error(JSON.stringify(result.errors, null, 1));
  return result.plan;
}

describe("a curve's points", () => {
  it("lie on one arc through its ends and its middle, close enough to it", () => {
    const points = curvePoints([0, 0], [100, 0], 10);
    expect(points[0]).toEqual([0, 0]);
    expect(points.at(-1)![0]).toBeCloseTo(100);
    const middle = points[(points.length - 1) / 2]!;
    expect(middle[0]).toBeCloseTo(50);
    expect(middle[1]).toBeCloseTo(10);
    // Radius 130 about (50, -120).
    for (const [y, z] of points) expect(Math.hypot(y - 50, z + 120)).toBeCloseTo(130, 6);
    for (let i = 0; i < points.length - 1; i++) {
      const [a, b] = [points[i]!, points[i + 1]!];
      expect(130 - Math.hypot((a[0] + b[0]) / 2 - 50, (a[1] + b[1]) / 2 + 120)).toBeLessThanOrEqual(CURVE_FLATNESS);
    }
  });

  it("dip below the line for a negative bulge, and follow a sloping one", () => {
    const dipped = curvePoints([0, 0], [100, 0], -10);
    expect(dipped[(dipped.length - 1) / 2]![1]).toBeCloseTo(-10);
    const sloped = curvePoints([0, 0], [30, 40], 5);
    const middle = sloped[(sloped.length - 1) / 2]!;
    // 5 mm off the middle of the line, square to it, on the upper side.
    expect(middle[0]).toBeCloseTo(15 - 4);
    expect(middle[1]).toBeCloseTo(20 + 3);
  });

  it("uses more flats for a tighter curve, up to a limit", () => {
    expect(curvePoints([0, 0], [100, 0], 0.6).length - 1).toBe(4);
    expect(curvePoints([0, 0], [100, 0], 10).length - 1).toBe(16);
    expect(curvePoints([0, 0], [100, 0], 35).length - 1).toBe(32);
  });
});

describe("a curved surface, planned", () => {
  it("becomes short flats that end exactly where it does, each named for it", () => {
    const surfaces = buildSurfaces(40, hooded().enclosure.surfaces);
    const flats = surfaces.filter((s) => s.curveOf === "hood");
    expect(flats.length).toBeGreaterThanOrEqual(4);
    expect(flats[0]!.id).toBe("hood curve 1");
    expect([flats[0]!.y0, flats[0]!.z0]).toEqual([80, 40]);
    expect([flats.at(-1)!.y1, flats.at(-1)!.z1]).toEqual([130, 60]);
    expect(surfaces.map((s) => s.index)).toEqual(surfaces.map((_, i) => i));
    expect(surfaces.at(-1)!.id).toBe("back");
  });

  it("raises the outside and the inside over it", () => {
    const built = plan(hooded());
    const flat = plan(hooded({}, 0));
    expect(chainHeight(built.profile.outer, 105) - chainHeight(flat.profile.outer, 105)).toBeGreaterThan(7);
    expect(chainHeight(built.profile.inner, 105) - chainHeight(flat.profile.inner, 105)).toBeGreaterThan(7);
    expect(chainHeight(built.profile.outer, 40)).toBeCloseTo(40);
  });

  it("letters on a flat of its own let into it, but can't be a top panel", () => {
    const label = hooded({ labels: [{ text: "HI", surface: "hood", u: 80, v: 20 }] });
    expect(errors(label)).toEqual([]);
    const built = plan(label);
    const flat = built.flats.find((f) => f.componentId === "labels[0]")!;
    expect(flat.curve).toBe("hood");
    expect(built.labels[0]!.on).toMatchObject({ kind: "surface", surface: flat.surface.id, u: 80, v: 20 });
    // Refused as a part would be, near the seam or the curve's end, or too close to a part's flat.
    expect(errors(hooded({ labels: [{ text: "HI", surface: "hood", u: 150, v: 20 }] })).map((e) => e.message).join()).toMatch(/seam/);
    expect(errors(hooded({ labels: [{ text: "HI", surface: "hood", u: 80, v: 1 }] })).map((e) => e.message).join()).toMatch(/end of the curve/);
    const panel = hooded({ topPanels: [{ surface: "hood" }] });
    expect(errors(panel).map((e) => e.code)).toContain("TOP_PANEL_INVALID");
  });

  it("is refused when it's nearly flat, more than its length allows, or too steep", () => {
    expect(errors(hooded({}, 0.2)).map((e) => e.path)).toEqual(["enclosure.surfaces[1].bulge"]);
    expect(errors(hooded({}, 30)).map((e) => e.path)).toEqual(["enclosure.surfaces[1].bulge"]);
    const steep = errors(hooded({}, 20));
    expect(steep.map((e) => e.path)).toEqual(["enclosure.surfaces[1]"]);
    expect(steep[0]!.message).toMatch(/"hood" slopes at .* along its curve/);
  });

  it("can meet its neighbour smoothly, which two flat surfaces can't", () => {
    // Level at its rear end, where it meets a level back.
    const smooth = hooded();
    smooth.enclosure.surfaces = [{ id: "hood", y: 100, z: 60, bulge: 6.34 }, { id: "back", y: 190, z: 60 }];
    smooth.components = [{ id: "c", type: "ec11-dial-19mm", surface: "back", u: 220, v: 40 }, { id: "e", type: "rp2040-plus", x: 28.9, y: 150 }];
    expect(errors(smooth)).toEqual([]);
  });
});

describe("a curved surface, built", () => {
  beforeAll(async () => {
    await initEngine();
  });

  it("builds a sound shell in two halves with a lip", async () => {
    const built = plan(hooded());
    expect(await buildProblems(built, buildEnclosure(built))).toEqual([]);
  }, 120_000);

  it("needs no support, and offers only flat surfaces to print on", () => {
    const built = plan(hooded());
    const { parts } = buildEnclosure(built);
    const reports = planPrint(built, parts.map((part) => part.shape.mesh({ tolerance: 0.1, angularTolerance: 0.3 })));
    for (const part of built.printedParts.filter((p) => p.kind === "shell" || p.kind === "plate")) {
      expect(reports[part.index]!.needsSupport, `${part.name}: ${reports[part.index]!.notes.join(" ")}`).toBe(false);
      expect(reports[part.index]!.reports.map((o) => o.label).join()).not.toMatch(/curve/);
    }
  }, 240_000);

  it("builds a top that's one curve from front to rear", async () => {
    const dome = hooded({ seams: [], components: [] });
    dome.enclosure = { width: 180, frontHeight: 30, surfaces: [{ id: "dome", y: 120, z: 30, bulge: 15 }] };
    expect(errors({ ...dome, enclosure: { ...dome.enclosure, rounds: { rearTop: 10 } } }).map((e) => e.path)).toEqual(["enclosure.rounds.rearTop"]);
    const built = plan(dome);
    expect(await buildProblems(built, buildEnclosure(built))).toEqual([]);
  }, 120_000);

  it("leaves the joins between its flats out of the view's edges, and nothing else", () => {
    const built = plan(hooded());
    const { parts } = buildEnclosure(built);
    const flats = built.profile.surfaces.filter((s) => s.curveOf).length;
    for (const part of parts.filter((p) => p.kind === "shell")) {
      const all = Float32Array.from(part.shape.meshEdges({ tolerance: 0.1, angularTolerance: 0.3 }).lines);
      const shown = withoutCurveCreases(all, built.profile.surfaces);
      // At each join, one edge outside and one underneath at least.
      expect((all.length - shown.length) / 6).toBeGreaterThanOrEqual(2 * (flats - 1));
      // What's left has none running across the width over the curve, between its ends.
      let over = 0;
      for (let i = 0; i < shown.length; i += 6) {
        const [y0, z0, y1, z1] = [shown[i + 1]!, shown[i + 2]!, shown[i + 4]!, shown[i + 5]!];
        if (Math.abs(y1 - y0) < 1e-4 && Math.abs(z1 - z0) < 1e-4 && y0 > 82 && y0 < 128 && z0 > 43 && Math.abs(shown[i + 3]! - shown[i]!) > 20) over++;
      }
      expect(over).toBe(0);
    }
    const flat = plan(hooded({}, 0));
    const edges = Float32Array.from([0, 80, 40, 150, 80, 40]);
    expect(withoutCurveCreases(edges, flat.profile.surfaces)).toBe(edges);
  }, 120_000);

  it("is one true arc on the outside, not its flats, so the STEP file has the curve itself", () => {
    const dome = hooded({ seams: [], components: [] });
    dome.enclosure = { width: 180, frontHeight: 30, surfaces: [{ id: "dome", y: 120, z: 30, bulge: 15 }] };
    const built = plan(dome);
    const shell = buildEnclosure(built).parts.find((p) => p.kind === "shell")!;
    // Round faces that run across the width, from front to back: not corners or holes.
    const round = shell.shape.faces.filter((face) => {
      if (face.geomType !== "CYLINDRE") return false;
      const [[, y0], [, y1]] = face.boundingBox.bounds;
      return y1 - y0 > 100;
    });
    // The outside over the curve is one face; the inside follows its flats.
    expect(round).toHaveLength(1);
    const box = round[0]!.boundingBox.bounds;
    expect(box[0][1]).toBeCloseTo(0, 0);
    expect(box[1][1]).toBeCloseTo(120, 0);
    expect(box[1][2]).toBeCloseTo(45, 1);
    expect(shell.shape.blobSTEP().size).toBeGreaterThan(0);
  }, 120_000);

  it("builds lettering on a curve, on its flat", async () => {
    const built = plan(hooded({ labels: [{ text: "HOOD", surface: "hood", u: 80, v: 25 }] }));
    expect(await buildProblems(built, buildEnclosure(built))).toEqual([]);
  }, 120_000);

  it("builds dipping in, in one piece", async () => {
    const built = plan(hooded({ seams: [], enclosure: { ...hooded().enclosure, width: 200 }, components: [] }, -5));
    expect(await buildProblems(built, buildEnclosure(built))).toEqual([]);
  }, 120_000);
});

describe("a curved surface, in the form", () => {
  it("is set for one surface, and leaves the file when cleared or set to 0", () => {
    const set = setSurfaceBulge(hooded({}, 0), "deck", 4);
    expect(set.enclosure.surfaces[0]).toEqual({ id: "deck", y: 80, z: 40, bulge: 4 });
    expect(setSurfaceBulge(set, "deck", 0).enclosure.surfaces[0]).toEqual({ id: "deck", y: 80, z: 40 });
    expect(setSurfaceBulge(set, "deck", undefined).enclosure.surfaces[0]).toEqual({ id: "deck", y: 80, z: 40 });
  });

  it("puts a new part on a flat surface first, even when the curve is asked for", () => {
    const { config, id } = addComponent(hooded(), "ttp223", "hood");
    expect(["deck", "back"]).toContain(config.components.find((c: any) => c.id === id).surface);
  });
});
