// How parts sit on the bed, read from real meshes. The Desk Synth is the proof: its Tools/orient.py records
// how the real build was printed, and these have to reach the same answers on their own.
import { beforeAll, describe, expect, it } from "vitest";
import { makeBox, makeCylinder, measureVolume, type Shape3D } from "replicad";
import { analyseBinarySTL, isValidSolid } from "../src/checks.js";
import { buildEnclosure, describeEstimate, initEngine, placedOnBed, printGuide, planPrint, totalEstimate, validateConfig, writeZip, type BuildPlan, type Matrix, type PartPrintReport } from "../src/index.js";
import { analyseOrientation, estimatePrint, faceDown, filamentCost, findLayerGaps, orientationScore, orientationsFor, planPartPrint, weldMesh } from "../src/printing.js";
import { topScrewProblem, topTabExtent } from "../src/top.js";
import { crc32 } from "../src/zip.js";
import { deskSynth } from "./helpers.js";
import { readFileSync } from "node:fs";

function plan(config: unknown): BuildPlan {
  const result = validateConfig(config);
  if (!result.ok) throw new Error(JSON.stringify(result.errors, null, 1));
  return result.plan;
}
const example = (name: string) => JSON.parse(readFileSync(new URL(`../examples/${name}.json`, import.meta.url), "utf8"));
const BED = { x: 256, y: 256, z: 256 };
const IDENTITY: Matrix = [1, 0, 0, 0, 1, 0, 0, 0, 1];
const UPSIDE_DOWN: Matrix = [1, 0, 0, 0, -1, 0, 0, 0, -1];
const option = (matrix: Matrix = IDENTITY) => ({ id: "test", label: "Test", matrix, planned: false });
const mesh = (shape: Shape3D) => shape.mesh({ tolerance: 0.05, angularTolerance: 0.2 });
const box = (from: [number, number, number], to: [number, number, number]) => makeBox(from, to) as unknown as Shape3D;
const parts = (config: unknown) => {
  const built = plan(config);
  const enclosure = buildEnclosure(built);
  return { built, enclosure, reports: planPrint(built, enclosure.parts.map((part) => mesh(part.shape))) };
};

describe("rotating onto the bed", () => {
  const determinant = (m: Matrix) => m[0] * (m[4] * m[8] - m[5] * m[7]) - m[1] * (m[3] * m[8] - m[5] * m[6]) + m[2] * (m[3] * m[7] - m[4] * m[6]);

  it("only turns a part, and never mirrors it", () => {
    const { built } = { built: plan(deskSynth()) };
    for (const part of built.printedParts) {
      for (const { matrix, label } of orientationsFor(built, part)) expect(determinant(matrix), label).toBeCloseTo(1);
    }
  });

  it("puts a sloped surface's outside flat on the bed", () => {
    for (const surface of plan(deskSynth()).profile.surfaces) {
      const m = faceDown(surface);
      // Its outward normal is (0, -sin, cos), which has to end up pointing straight down.
      expect(m[6] * 0 + m[7] * -surface.sin + m[8] * surface.cos).toBeCloseTo(-1);
      // And along the surface stays level.
      expect(m[7] * surface.cos + m[8] * surface.sin).toBeCloseTo(0);
    }
  });

  it("offers each wall, and the part's own surfaces", () => {
    const built = plan(deskSynth());
    const ids = (name: string) => orientationsFor(built, built.printedParts.find((p) => p.name === name)!).map((o) => o.id);
    expect(ids("Panel 1")).toContain("face-panel");
    expect(ids("Panel 1")).not.toContain("face-deck");
    expect(ids("Shell 1")).toEqual(expect.arrayContaining(["left-down", "right-down", "front-down", "rear-down", "as-designed"]));
    expect(ids("Plate 1")).not.toContain("face-deck");
  });
});

describe("choosing how the Desk Synth prints", () => {
  beforeAll(() => initEngine(), 60_000);
  let reports: PartPrintReport[];
  let built: BuildPlan;
  let shapes: Shape3D[];
  beforeAll(() => {
    const made = parts(deskSynth());
    reports = made.reports;
    built = made.built;
    shapes = made.enclosure.parts.map((part) => part.shape);
  }, 120_000);
  const of = (name: string) => reports.find((r) => r.name === name)!;
  const overlap = (a: Shape3D, b: Shape3D) => {
    try {
      return measureVolume(a.intersect(b));
    } catch (error) {
      if (String(error).includes("deleted")) throw error;
      return 0;
    }
  };

  // From Tools/orient.py, which is how the real parts were printed.
  it.each([
    ["Shell 1", "left-down"],
    ["Shell 2", "right-down"],
    ["Deck 1", "face-deck"],
    ["Deck 2", "face-deck"],
    ["Panel 1", "face-panel"],
    ["Panel 2", "face-panel"],
    ["Plate 1", "as-designed"],
    ["Plate 2", "as-designed"],
  ])("prints %s the way the real one was", (name, id) => expect(of(name).best.id).toBe(id));

  it("gets there on the mesh alone, without the design's preference", () => {
    for (const name of ["Shell 1", "Shell 2", "Deck 1", "Deck 2", "Panel 1", "Panel 2", "Plate 1", "Plate 2"]) {
      const part = built.printedParts.find((p) => p.name === name)!;
      const unpreferred = orientationsFor(built, part).map((o) => ({ ...o, planned: false }));
      const report = planPartPrint(part, mesh(shapes[part.index]!), unpreferred, BED);
      expect(report.best.id, name).toBe(of(name).best.id);
    }
  }, 60_000);

  it("lays a shell on its side, within the bed, far better than upright", () => {
    const { reports: all, best } = of("Shell 1");
    const upright = all.find((r) => r.id === "as-designed")!;
    expect(best.size[2]).toBeLessThanOrEqual(256);
    expect(best.supportArea).toBeLessThan(upright.supportArea + 1);
    expect(best.steepArea).toBeLessThan(upright.steepArea);
  });

  it("needs no support for any part", () => {
    // ElegooSlicer put 10.1 m and 7.3 m under the shells before their seam bolts' head bores were
    // teardrops and Panel 1's rear tab had its fin, and nothing under the top pieces or plates. It
    // hasn't been run since.
    for (const report of reports) expect(report.needsSupport, report.name).toBe(false);
  });

  it("points each seam bolt's head bore up its tab's slope, as a teardrop", () => {
    // Where the slicer's support went, at about 3 m a bolt, when the bores were round.
    const seam = built.seams[0]!;
    const shell = shapes[built.printedParts.find((p) => p.name === "Shell 1")!.index]!;
    const far = seam.x - seam.ribHalfThickness;
    for (const [y, z] of seam.bolts) {
      const tab = seam.tabs.reduce((best, tab) => (Math.abs(tab.start[0] - y) + Math.abs(tab.start[1] - z) < Math.abs(best.start[0] - y) + Math.abs(best.start[1] - z) ? tab : best));
      const [iy, iz] = tab.inward;
      const along = 3.9 / Math.hypot(iy, iz);
      // Just past the round bore, up the slope: empty. The same distance down it: solid.
      const probe = (sign: number) => makeCylinder(0.15, 1, [far - 1.5, y + sign * iy * along, z + sign * iz * along], [1, 0, 0]);
      expect(overlap(shell, probe(1)), `${y}, ${z}`).toBeLessThan(0.001);
      expect(overlap(shell, probe(-1)), `${y}, ${z}`).toBeGreaterThan(0.05);
    }
  });

  it("carries a seam tab's slopes out to a rounded rear wall, so their feet don't hang short of it", () => {
    // The tab's drawn along a line, and the Desk Synth's rear wall bulges up to 2.5 mm past it.
    for (const name of ["Shell 1", "Shell 2"]) expect(of(name).gaps.filter((gap) => gap.max[1] > 186), name).toEqual([]);
  });

  it("prints the rail base down without supports, its screws countersunk", () => {
    expect(of("Front rail").needsSupport).toBe(false);
    expect(built.hardware).toContainEqual({ name: "M3 x 8 flat-head screw, for the rail", count: 2 });
  });

  it("says why in a note", () => {
    expect(of("Shell 1").notes.join()).not.toContain("supports");
    expect(of("Shell 1").resolved.join()).toContain("on its side");
    expect(of("Deck 1").resolved.join()).toContain("face");
    expect(of("Deck 1").notes).toEqual([]);
  });

  it("places each on the bed: flat, centred and whole", async () => {
    for (const report of reports) {
      const placed = placedOnBed(shapes[report.index]!, report.best.matrix, report.best.offset);
      expect(isValidSolid(placed), report.name).toBe(true);
      expect(measureVolume(placed)).toBeCloseTo(measureVolume(shapes[report.index]!), 1);
      const [[x0, y0, z0], [x1, y1, z1]] = placed.boundingBox.bounds;
      expect(z0, report.name).toBeCloseTo(0, 1);
      expect((x0 + x1) / 2, report.name).toBeCloseTo(128, 0);
      expect((y0 + y1) / 2, report.name).toBeCloseTo(128, 0);
      expect(x0).toBeGreaterThanOrEqual(0);
      expect(x1).toBeLessThanOrEqual(256);
      expect(y1).toBeLessThanOrEqual(256);
      expect(z1).toBeLessThanOrEqual(256);
      const stl = analyseBinarySTL(new Uint8Array(await placed.blobSTL({ binary: true, tolerance: 0.05, angularTolerance: 0.2 }).arrayBuffer()));
      expect(stl.watertight, report.name).toBe(true);
    }
  }, 60_000);

  it("writes a guide", () => {
    const guide = printGuide(built, reports);
    expect(guide).toContain("256 x 256 x 256");
    expect(guide).toContain("Shell 1: left wall on the bed");
    expect(guide).toContain("Deck 1: the deck surface on the bed");
    expect(guide).toContain("Bolt the shell halves");
    expect(guide).toContain("Print the fit test first");
  });
});

describe("reading a mesh", () => {
  beforeAll(() => initEngine(), 60_000);
  const report = (shape: Shape3D, matrix: Matrix = IDENTITY, bed = BED) => analyseOrientation(weldMesh(mesh(shape)), option(matrix), bed);

  it("finds nothing wrong with a block", () => {
    const r = report(box([0, 0, 0], [30, 30, 30]));
    expect(r.steepArea + r.supportArea + r.bridgeArea + r.islands).toBe(0);
    expect(r.bedArea).toBeCloseTo(900);
  });

  it("measures what's on the bed, and centres it", () => {
    const r = report(box([10, 20, 30], [40, 40, 50]));
    expect(r.size).toEqual([30, 20, 20].map((v) => expect.closeTo(v, 5)));
    expect(r.offset).toEqual([128 - 25, 128 - 30, -30].map((v) => expect.closeTo(v, 5)));
  });

  it("calls a wide shelf a roof that needs support", () => {
    const shelf = box([0, 0, 0], [10, 40, 30]).fuse(box([9, 0, 25], [40, 40, 30]));
    const r = report(shelf);
    expect(r.supportArea).toBeCloseTo(30 * 40, -1);
    expect(r.patches[0]!.kind).toBe("support");
  });

  it("calls a narrow one a bridge", () => {
    const shelf = box([0, 0, 0], [40, 40, 5]).fuse(box([0, 0, 5], [10, 40, 30])).fuse(box([18, 0, 5], [40, 40, 30])).fuse(box([0, 0, 25], [40, 40, 30]));
    const r = report(shelf);
    expect(r.supportArea).toBe(0);
    expect(r.bridgeArea).toBeCloseTo(8 * 40, -1);
  });

  it("lets a 45 degree slope through, and flags anything past it", () => {
    // A point down from a triangle: how steep its sides are comes from its height against its spread.
    // Held off the bed by a scrap below, because a face that touches the bed is resting on it.
    const pointDown = (spread: number) => weldMesh({ vertices: [0, 0, 10, spread, 0, 10, 0, spread, 10, 0, 0, 0, 90, 90, -5, 95, 90, -5, 90, 95, -5], triangles: [0, 1, 2, 0, 3, 1, 1, 3, 2, 2, 3, 0, 4, 5, 6] });
    expect(analyseOrientation(pointDown(10), option(), BED).steepArea).toBe(0);
    const flatter = analyseOrientation(pointDown(30), option(), BED);
    expect(flatter.steepArea).toBeGreaterThan(0);
    expect(flatter.supportArea).toBe(0);
  });

  it("counts what's all down at the bed as resting on it", () => {
    // A slope down in the first layers, which squashes onto the bed.
    const shallow = weldMesh({ vertices: [0, 0, 0.2, 30, 0, 0.2, 0, 30, 0.2, 0, 0, 0, 30, 0, 0, 0, 30, 0, 0, 0, 20, 30, 0, 20, 0, 30, 20], triangles: [3, 5, 1, 3, 2, 5, 3, 1, 2] });
    expect(analyseOrientation(shallow, option(), BED).steepArea).toBe(0);
  });

  it("doesn't let one corner on the bed hide a wide face tilting away from it", () => {
    // Two big triangles, rising 8 mm over 100 mm, so a corner of each is on the bed.
    const tilted = weldMesh({ vertices: [0, 0, 0, 0, 100, 8, 100, 100, 8, 100, 0, 0, 0, 0, 30, 100, 0, 30, 100, 100, 30, 0, 100, 30], triangles: [0, 1, 2, 0, 2, 3, 4, 5, 6, 4, 6, 7] });
    const report = analyseOrientation(tilted, option(), BED);
    expect(report.supportArea).toBeGreaterThan(9000);
  });

  it("finds a region that starts in mid-air", () => {
    // A block with another hanging off it by a thin neck, whose underside is lower than anything near it.
    const hanging = box([0, 0, 0], [20, 20, 20]).fuse(box([20, 8, 18], [26, 12, 20])).fuse(box([26, 0, 5], [46, 20, 20]));
    expect(report(hanging).islands).toBeGreaterThan(0);
    expect(report(box([0, 0, 0], [20, 20, 20])).islands).toBe(0);
  });

  it("doesn't count the floor of a blind hole as mid-air", () => {
    const pocket = box([0, 0, 0], [30, 30, 20]).cut(box([10, 10, 5], [20, 20, 25]));
    expect(report(pocket).islands).toBe(0);
  });

  it("scores each thing that matters, in the right direction", () => {
    const base = { fits: true, supportArea: 0, islands: 0, steepArea: 0, bridgeArea: 0, height: 10, bedArea: 1000, planned: false };
    const score = (change: Partial<typeof base>) => orientationScore({ ...base, ...change });
    expect(score({ fits: false })).toBeGreaterThan(score({ supportArea: 100000 }));
    expect(score({ supportArea: 100 })).toBeGreaterThan(score({ steepArea: 100 }));
    expect(score({ steepArea: 100 })).toBeGreaterThan(score({ bridgeArea: 100 }));
    expect(score({ bridgeArea: 100 })).toBeGreaterThan(score({}));
    expect(score({ islands: 1 })).toBeGreaterThan(score({ height: 100 }));
    expect(score({ height: 100 })).toBeGreaterThan(score({}));
    expect(score({ bedArea: 50 })).toBeGreaterThan(score({ islands: 1 }));
    expect(score({ planned: true })).toBeLessThan(score({}));
  });

  it("knows what fits", () => {
    expect(report(box([0, 0, 0], [300, 20, 20])).fits).toBe(false);
    expect(report(box([0, 0, 0], [200, 20, 20])).fits).toBe(true);
    expect(report(box([0, 0, 0], [200, 100, 20]), IDENTITY, { x: 100, y: 200, z: 256 }).fits).toBe(true);
    expect(report(box([0, 0, 0], [20, 20, 300])).fits).toBe(false);
  });

  it("stands a part on end if that's the only way it fits", () => {
    const long = box([0, 0, 0], [300, 20, 20]);
    const options = [option(), { id: "end", label: "On end", matrix: [0, 0, -1, 0, 1, 0, 1, 0, 0] as Matrix, planned: false }];
    const tall = { x: 256, y: 256, z: 400 };
    expect(planPartPrint({ index: 0, name: "Bar" }, mesh(long), options, tall).best.id).toBe("end");
  });

  it("says when it can't print at all", () => {
    const huge = box([0, 0, 0], [300, 300, 300]);
    const report = planPartPrint({ index: 0, name: "Block" }, mesh(huge), [option()], BED);
    expect(report.problems.join()).toContain("doesn't fit");
  });

  it("warns about little on the bed", () => {
    const small = box([0, 0, 0], [5, 5, 10]);
    expect(planPartPrint({ index: 0, name: "Peg" }, mesh(small), [option()], BED).notes.join()).toContain("brim");
    expect(planPartPrint({ index: 0, name: "Slab" }, mesh(box([0, 0, 0], [50, 50, 5])), [option()], BED).notes).toEqual([]);
  });

  it("warns about tall and narrow", () => {
    const tower = box([0, 0, 0], [20, 20, 120]);
    expect(planPartPrint({ index: 0, name: "Tower" }, mesh(tower), [option()], BED).notes.join()).toContain("tall for its footing");
  });

  describe("a layer at a time", () => {
    const gaps = (shape: Shape3D, matrix: Matrix = IDENTITY) => findLayerGaps(weldMesh(mesh(shape)), { matrix });

    it("finds nothing under a plain block", () => expect(gaps(box([0, 0, 0], [20, 20, 20]))).toEqual([]));

    it("finds a shelf, where it is, and how high, and says to turn on supports", () => {
      const shelf = box([0, 0, 0], [10, 20, 30]).fuse(box([9, 0, 20], [30, 20, 30]));
      expect(planPartPrint({ index: 0, name: "Shelf" }, mesh(shelf), [option()], BED).notes.join()).toContain("turn on supports");
      const [gap] = gaps(shelf);
      expect(gap!.fromZ).toBeCloseTo(20, 0);
      expect(gap!.area).toBeGreaterThan(300);
      expect(gap!.max[0]).toBeGreaterThan(28);
      expect(gap!.min[0]).toBeLessThan(13);
    });

    it("reports where it is on the part as designed, however it's turned", () => {
      // Fine as it stands, but turned over, its wide slab has nothing under it.
      const slab = box([0, 0, 0], [40, 20, 5]).fuse(box([0, 0, 5], [20, 20, 15]));
      expect(gaps(slab)).toEqual([]);
      const [turned] = gaps(slab, UPSIDE_DOWN);
      expect(turned!.min[2]).toBeCloseTo(5, 0);
      expect(turned!.max[0]).toBeGreaterThan(38);
      expect(turned!.min[0]).toBeLessThan(23);
    });

    it("lets a roof bridge between two walls, if it's short enough, but not hang from one", () => {
      // Two posts 3 mm apart, then 10 or 14, joined over the top: a bridge, then too long for one.
      const arch = (span: number) => box([0, 0, 0], [3, 10, 10]).fuse(box([3 + span, 0, 0], [6 + span, 10, 10])).fuse(box([0, 0, 10], [6 + span, 10, 12]));
      expect(gaps(arch(10))).toEqual([]);
      expect(gaps(arch(14))[0]!.area).toBeGreaterThan(50);
      // A hole's flat roof is held all round, but a ledge from one wall isn't, however short.
      expect(gaps(box([0, 0, 0], [20, 20, 12]).cut(box([5, 5, -1], [15, 15, 8])))).toEqual([]);
      expect(gaps(box([0, 0, 0], [3, 10, 12]).fuse(box([3, 0, 8], [9, 10, 12])))[0]!.area).toBeGreaterThan(20);
    });

    it("lets a gentle slope go up without a gap", () => {
      // A stack of steps 0.4 mm out per 0.2 mm layer is what a layer can reach.
      let stair = box([0, 0, 0], [10, 20, 0.4]);
      for (let i = 1; i < 12; i++) stair = stair.fuse(box([0, 0, i * 0.4], [10 + i * 0.4, 20, (i + 1) * 0.4]));
      expect(gaps(stair)).toEqual([]);
    });
  });
});

describe("what follows the way it prints", () => {
  beforeAll(() => initEngine(), 60_000);
  const capped = (more: Record<string, unknown> = {}) => ({
    schemaVersion: 1,
    name: "box",
    enclosure: { width: 200, frontHeight: 40, surfaces: [{ id: "top", y: 120, z: 40 }] },
    topPanels: [{ surface: "top" }],
    ...more,
  });
  const seamed = () => capped({ seams: [{ x: 100 }] });
  const overlap = (a: Shape3D, b: Shape3D) => {
    try {
      return measureVolume(a.intersect(b));
    } catch (error) {
      if (String(error).includes("deleted")) throw error;
      return 0;
    }
  };

  it("won't take a rail longer than the bed", () => {
    const wide = (xMax: number) => ({
      schemaVersion: 1,
      name: "wide",
      enclosure: { width: 400, frontHeight: 60, surfaces: [{ id: "top", y: 140, z: 60 }] },
      seams: [{ x: 70 }],
      fabrication: { buildVolume: { x: 256, y: 256, z: 400 } },
      opening: { xMin: 80, xMax, yEnd: 60, sill: 12, rail: { depth: 14, screwX: [72, xMax + 8] } },
    });
    const problem = (config: unknown) => { const r = validateConfig(config); return r.ok ? undefined : r.errors.find((e) => e.path === "opening.rail.screwX"); };
    expect(problem(wide(368))?.code).toBe("PART_TOO_LARGE");
    expect(problem(wide(300))).toBeUndefined();
  });

  it("lays only seamed shells on their sides", () => {
    expect(plan(seamed()).shellOnSide).toBe(true);
    expect(plan(capped()).shellOnSide).toBe(false);
    expect(plan(capped({ enclosure: { width: 200, frontHeight: 40, surfaces: [{ id: "top", y: 120, z: 40 }], rounds: { frontBottom: 10 } } })).shellOnSide).toBe(false);
  });

  it("only spreads a tab along its wall if it prints on its side", () => {
    const screw = { x: 50, y: 8, wall: "front" as const, postBottom: 30 };
    expect(topTabExtent(screw, 3, 200, 117, true).spread).toBeGreaterThan(0);
    expect(topTabExtent(screw, 3, 200, 117, false).spread).toBe(0);
  });

  it("gives an upright shell's tabs gussets, and leaves the screw's way clear", () => {
    const built = plan(capped());
    const shell = buildEnclosure(built).parts[0]!.shape;
    for (const screw of built.topScrews) {
      const under = screw.postBottom - 0.2 - 3;
      // Solid under the tab near the wall, and clear under the screw.
      const nearWall = { left: [3.5, screw.y], right: [196.5, screw.y], front: [screw.x, 3.5], rear: [screw.x, 116.5] }[screw.wall] as [number, number];
      expect(overlap(shell, makeCylinder(0.3, 2, [nearWall[0], nearWall[1], under - 2.5])), screw.wall).toBeGreaterThan(0.1);
      expect(overlap(shell, makeCylinder(2.9, under + 4, [screw.x, screw.y, -5])), screw.wall).toBeLessThan(0.05);
    }
  }, 60_000);

  it("adds no gussets to a shell on its side", () => {
    const built = plan(seamed());
    const shell = buildEnclosure(built).parts[0]!.shape;
    const screw = built.topScrews.find((s) => s.wall === "left")!;
    const under = screw.postBottom - 0.2 - 3;
    expect(overlap(shell, makeCylinder(0.3, 2, [screw.x - 2.5, screw.y, under - 3]))).toBeLessThan(0.01);
  }, 60_000);

  describe("a gusset", () => {
    const { profile } = plan(capped());
    const screw = { x: 7.3, y: 60, wall: "left" as const, postBottom: 28 };
    const sizes = { wall: 3, width: 200, depth: 120, cornerRadius: 6, floorThickness: 3, rearWallY: 117, seamXs: [], onSide: false };
    const none = { cutouts: [], bodies: [], floorParts: [], blockedBoxes: [], seamTabs: [], minWeb: 1.2, partClearance: 1 };
    const check = (obstacles: Record<string, unknown>, changed = sizes) => topScrewProblem(profile, { ...none, ...obstacles }, "top", screw, changed, { u: screw.x, v: screw.y });
    // Under the tab's end, past the screw's path, and low enough to clear the tab itself.
    const beside = { xLow: 4, xHigh: 6, section: [[64.5, 18], [65.5, 18], [65.5, 22], [64.5, 22]] as [number, number][] };

    it("is clear with nothing there", () => expect(check({})).toBeNull());
    it("keeps off the body of a part", () => expect(check({ bodies: [beside] })).toContain("gusset"));
    it("doesn't matter on a shell on its side, which has none", () => expect(check({ bodies: [beside] }, { ...sizes, onSide: true })).toBeNull());
    it("keeps out of reserved room below its tab", () => {
      const room = { xLow: 0, xHigh: 5, yLow: 55, yHigh: 65, zTop: 20 };
      expect(check({ blockedBoxes: [room] })).toContain("opening holds");
      expect(check({ blockedBoxes: [room] }, { ...sizes, onSide: true })).toBeNull();
    });
  });

  it("keeps a plate boss from only just touching a gusset", () => {
    // From a design where one landed exactly tangent to a gusset's end, leaving an edge shared by four faces.
    const design = { schemaVersion: 1, name: "tangent", enclosure: { width: 60, frontHeight: 30, surfaces: [{ id: "top", y: 50, z: 25 }, { id: "surface-2", y: 90, z: 25 }, { id: "surface-3", y: 130, z: 15 }], wall: 1.6, floorThickness: 1.6, cornerRadius: 3, panelThickness: 4 }, topPanels: [{ surface: "top" }, { surface: "surface-2" }, { surface: "surface-3" }], opening: { xMin: 18, xMax: 36, yEnd: 45.5, sill: 20 }, components: [{ id: "d", type: "ec11-dial-30mm", surface: "top", u: 8, v: 12 }] };
    const built = plan(design);
    for (const [x, y] of built.plate!.screws) {
      for (const screw of built.topScrews.filter((s) => s.wall === "left" || s.wall === "right")) {
        const dy = Math.max(screw.y - 6 - y, y - screw.y - 6, 0);
        const near = screw.wall === "left" ? x < 30 : x > 30;
        if (near && dy > 0) expect(Math.abs(dy - 4)).toBeGreaterThanOrEqual(0.3);
      }
    }
    return Promise.all(buildEnclosure(built).parts.map(async (part) => {
      const stl = analyseBinarySTL(new Uint8Array(await part.shape.blobSTL({ binary: true, tolerance: 0.1, angularTolerance: 0.3 }).arrayBuffer()));
      expect(stl.watertight, part.name).toBe(true);
    }));
  }, 60_000);

  it("makes closed parts from an upright shell with gussets", async () => {
    for (const part of buildEnclosure(plan(capped())).parts) {
      const stl = analyseBinarySTL(new Uint8Array(await part.shape.blobSTL({ binary: true, tolerance: 0.1, angularTolerance: 0.3 }).arrayBuffer()));
      expect(isValidSolid(part.shape), part.name).toBe(true);
      expect(stl.watertight, part.name).toBe(true);
    }
  }, 60_000);

  it("has fewer gaps on the Dial deck's shell than it would without them", () => {
    const { reports } = parts(example("dial-deck"));
    expect(reports[0]!.best.id).toBe("as-designed");
    // 732 mm² without them, and the bosses over the plate are what's left.
    expect(reports[0]!.gapArea).toBeLessThan(400);
    expect(reports[0]!.resolved.join()).toContain("gussets");
  }, 60_000);

  it("picks an integral top's face over a roof", () => {
    const plain = { schemaVersion: 1, name: "plain", enclosure: { width: 150, frontHeight: 30, surfaces: [{ id: "top", y: 100, z: 30 }] } };
    const { reports } = parts(plain);
    expect(reports[0]!.best.id).not.toBe("as-designed");
    expect(reports[0]!.best.supportArea).toBe(0);
    expect(reports[0]!.resolved).toEqual([]);
  }, 60_000);

  it("drops what's been shaped in if another way wins", () => {
    const part = { index: 0, name: "Block" };
    const shape = box([0, 0, 0], [30, 30, 30]);
    const planned = planPartPrint(part, mesh(shape), [{ ...option(), planned: true }], BED, ["Shaped"]);
    expect(planned.resolved).toEqual(["Shaped"]);
    const not = planPartPrint(part, mesh(shape), [option(UPSIDE_DOWN)], BED, ["Shaped"]);
    expect(not.resolved).toEqual([]);
  });
});

describe("the zip", () => {
  const read = (zip: Uint8Array) => {
    const view = new DataView(zip.buffer, zip.byteOffset, zip.byteLength);
    const end = zip.length - 22;
    expect(view.getUint32(end, true)).toBe(0x06054b50);
    const count = view.getUint16(end + 10, true);
    let at = view.getUint32(end + 16, true);
    const files: { name: string; bytes: Uint8Array; crc: number }[] = [];
    for (let i = 0; i < count; i++) {
      expect(view.getUint32(at, true)).toBe(0x02014b50);
      const size = view.getUint32(at + 24, true);
      const nameLength = view.getUint16(at + 28, true);
      const local = view.getUint32(at + 42, true);
      const name = new TextDecoder().decode(zip.subarray(at + 46, at + 46 + nameLength));
      expect(view.getUint32(local, true)).toBe(0x04034b50);
      const start = local + 30 + view.getUint16(local + 26, true);
      files.push({ name, bytes: zip.subarray(start, start + size), crc: view.getUint32(at + 16, true) });
      at += 46 + nameLength;
    }
    return files;
  };

  it("holds what went in", () => {
    const a = new TextEncoder().encode("hello");
    const b = new Uint8Array([1, 2, 3, 250, 251]);
    const files = read(writeZip([{ name: "a.txt", bytes: a }, { name: "deck-1.stl", bytes: b }]));
    expect(files.map((f) => f.name)).toEqual(["a.txt", "deck-1.stl"]);
    expect([...files[0]!.bytes]).toEqual([...a]);
    expect([...files[1]!.bytes]).toEqual([...b]);
    expect(files[0]!.crc).toBe(crc32(a));
  });

  it("uses the standard checksum", () => {
    expect(crc32(new TextEncoder().encode("123456789"))).toBe(0xcbf43926);
  });

  it("comes out the same each time", () => {
    const files = [{ name: "a", bytes: new Uint8Array([1]) }];
    expect([...writeZip(files)]).toEqual([...writeZip(files)]);
  });
});

describe("estimating a print", () => {
  beforeAll(() => initEngine(), 60_000);
  // What ElegooSlicer says for the Desk Synth on the Centauri Carbon 2 profile at 0.20 mm with Rapid PETG.
  // These parts weren't used to fit the estimate.
  const SLICED: Record<string, { grams: number; hours: number }> = {
    "Shell 1": { grams: 129.15, hours: 10.34 },
    "Shell 2": { grams: 99.36, hours: 7.48 },
    "Deck 1": { grams: 28.02, hours: 1.59 },
    "Deck 2": { grams: 4.26, hours: 0.29 },
    "Panel 1": { grams: 22.04, hours: 1.3 },
    "Panel 2": { grams: 13.01, hours: 0.76 },
    "Plate 1": { grams: 53.03, hours: 2.19 },
    "Plate 2": { grams: 77.51, hours: 2.98 },
    "Front rail": { grams: 9.05, hours: 0.61 },
  };

  it("comes close to the slicer for the Desk Synth as a whole, and on filament for each part", () => {
    const { reports } = parts(deskSynth());
    expect(reports.map((r) => r.name).sort()).toEqual(Object.keys(SLICED).sort());
    const total = totalEstimate(reports);
    expect(Math.abs(total.grams - 435.4) / 435.4).toBeLessThan(0.05);
    expect(Math.abs(total.hours - 27.5) / 27.5).toBeLessThan(0.08);
    for (const report of reports) {
      const { grams, hours } = SLICED[report.name]!;
      expect(Math.abs(report.estimate.grams - grams) / grams, report.name).toBeLessThan(0.2);
      expect(Math.abs(report.estimate.hours - hours) / hours, report.name).toBeLessThan(0.4);
    }
  }, 120_000);

  it("reads the mesh's size, and takes longer for a shell", () => {
    const plain = estimatePrint(weldMesh(mesh(box([0, 0, 0], [100, 100, 10]))), false);
    // Area 24000 mm² and volume 100000 mm³.
    expect(plain.grams).toBeCloseTo(0.000971 * 24000 + 0.000254 * 100000, 3);
    const twice = estimatePrint(weldMesh(mesh(box([0, 0, 0], [100, 100, 20]))), false);
    expect(twice.grams).toBeGreaterThan(plain.grams);
    expect(estimatePrint(weldMesh(mesh(box([0, 0, 0], [100, 100, 10]))), true).hours).toBeCloseTo(plain.grams * 0.0839, 5);
    expect(plain.hours).toBeCloseTo(plain.grams * 0.0415, 5);
  });

  it("doesn't care which way the mesh runs", () => {
    const flipped = mesh(box([0, 0, 0], [100, 100, 10]));
    const reversed = { ...flipped, triangles: [...flipped.triangles].reverse() };
    expect(estimatePrint(weldMesh(reversed), false).grams).toBeCloseTo(estimatePrint(weldMesh(flipped), false).grams, 5);
  });

  it("rounds for what it is", () => {
    expect(describeEstimate({ grams: 0.2, hours: 0.01 })).toBe("about 5 min and 1 g");
    expect(describeEstimate({ grams: 42.6, hours: 0.62 })).toBe("about 35 min and 43 g");
    expect(describeEstimate({ grams: 133, hours: 3.3 })).toBe("about 3.5 h and 135 g");
    expect(describeEstimate({ grams: 437, hours: 27.6 })).toBe("about 28 h and 435 g");
  });

  it("adds up, and costs what the filament does", () => {
    expect(totalEstimate([{ estimate: { grams: 10, hours: 1 } }, { estimate: { grams: 20, hours: 2 } }])).toEqual({ grams: 30, hours: 3 });
    expect(filamentCost(500, 20)).toBe(10);
  });

  it("is in the guide, for each part and in all", () => {
    const { built, reports } = parts(example("dial-deck"));
    const guide = printGuide(built, reports);
    expect(guide).toContain(`All together, ${describeEstimate(totalEstimate(reports))}`);
    expect(guide).toMatch(/Roughly (about )?\d/);
    expect(guide).not.toContain("Roughly about");
  }, 60_000);
});

