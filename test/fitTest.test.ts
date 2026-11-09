// The fit test has to cut what the enclosure cuts, and what it shows has to reach the enclosure.
import { beforeAll, describe, expect, it } from "vitest";
import { compoundShapes, makeCylinder, measureVolume, type Shape3D } from "replicad";
import { analyseBinarySTL, isValidSolid } from "../src/checks.js";
import { buildEnclosure, buildFitTest, buildWallSection, initEngine, planFitTest, validateConfig, type BuildPlan, type FitRow, type FitTestPlan } from "../src/index.js";
import { partHoleBounds, FIT_HOLE_PAD, FIT_MARGIN, FIT_PIP_BAND, FIT_SECTION_SIZE, SECTION_REACH, FIT_WALL_FRONT, FIT_WALL_HEIGHT, fitStepSize, fitTestPieces } from "../src/fitTest.js";
import { BARB_REACH, CLIP_GAP } from "../src/fixtures.js";
import { PIN_DIAMETER, SHORT_BOSS_HEIGHT } from "../src/plate.js";
import { boxSolid as boxOf } from "../src/engine.js";
import { applyFit, setFitTestParts } from "../src/app/fitEdit.js";
import { planKeys, partsToRecut } from "../src/app/planDiff.js";
import { library } from "../src/library.js";
import type { PanelPart } from "../src/schema.js";
import { errors, deskSynth } from "./helpers.js";

function plan(config: unknown): BuildPlan {
  const result = validateConfig(config);
  if (!result.ok) throw new Error(JSON.stringify(result.errors, null, 1));
  return result.plan;
}

const box = (overrides: Record<string, unknown> = {}): any => ({
  schemaVersion: 1,
  name: "box",
  enclosure: { width: 200, frontHeight: 40, surfaces: [{ id: "top", y: 120, z: 40 }] },
  ...overrides,
});
const capped = (overrides: Record<string, unknown> = {}) => box({ topPanels: [{ surface: "top" }], ...overrides });
const seamed = (overrides: Record<string, unknown> = {}) => box({ seams: [{ x: 100 }], ...overrides });
const fit = (values: Record<string, unknown>, config: any = box()) => ({ ...config, fabrication: { fit: values } });
const rowsOf = (config: unknown) => planFitTest(plan(config)).rows;
const kinds = (config: unknown) => rowsOf(config).map((row) => row.kind);
const overlap = (a: Shape3D, b: Shape3D) => {
  try {
    return measureVolume(a.intersect(b));
  } catch (error) {
    if (String(error).includes("deleted")) throw error;
    return 0;
  }
};
const boxSolidAt = (x: number, y: number, z: number) => makeCylinder(0.5, 0.1, [x, y, z], [0, 0, 1]);
const cylinder = (r: number, h: number, at: [number, number, number], along: [number, number, number] = [0, 0, 1]) => makeCylinder(r, h, at, along);

describe("fit settings", () => {
  it("change nothing until they're set", () => {
    const explicit = deskSynth();
    explicit.fabrication.fit = { insertHole: 4, insertHoleSideways: 4, screwHole: 3.4, clipGap: 0.2, partHoles: {} };
    const unset = deskSynth();
    unset.fabrication.fit = {};
    const a = plan(unset);
    const b = plan(explicit);
    expect(b.cutouts).toEqual(a.cutouts);
    expect(b.plate).toEqual(a.plate);
    expect(b.topScrews).toEqual(a.topScrews);
    expect(b.holderBlocks).toEqual(a.holderBlocks);
  });

  it("resize a part's holes, for the validator too", () => {
    const part = (config: unknown) => plan(config).cutouts[0]!;
    const one = { components: [{ id: "a", type: "arcade-24mm", surface: "top", u: 100, v: 60 }] };
    expect(part(box(one)).diameter).toBeCloseTo(24.24);
    expect(part(fit({ partHoles: { "arcade-24mm": 0.3 } }, box(one))).diameter).toBeCloseTo(24.54);
    expect(part(fit({ partHoles: { "ec11-dial-19mm": 0.3 } }, box(one))).diameter).toBeCloseTo(24.24);
    // These two have 0.2 mm too little plastic between them once their holes grow.
    const close = { components: [{ id: "a", type: "arcade-24mm", surface: "top", u: 60, v: 60 }, { id: "b", type: "arcade-24mm", surface: "top", u: 60 + 24.24 + 1.3, v: 60 }] };
    expect(errors(box(close)).map((e) => e.code)).not.toContain("CUTOUTS_TOO_CLOSE");
    expect(errors(fit({ partHoles: { "arcade-24mm": 0.2 } }, box(close))).map((e) => e.code)).toContain("CUTOUTS_TOO_CLOSE");
  });

  it("resize a rectangular hole and its recess", () => {
    const one = { components: [{ id: "d", type: "oled-242-ssd1309", surface: "top", u: 100, v: 60 }] };
    const before = plan(box(one)).cutouts[0]!;
    const after = plan(fit({ partHoles: { "oled-242-ssd1309": 0.2 } }, box(one))).cutouts[0]!;
    expect(after.width).toBeCloseTo(before.width! + 0.2);
    expect(after.height).toBeCloseTo(before.height! + 0.2);
    expect(after.recess!.width).toBeCloseTo(before.recess!.width + 0.2);
  });

  it("move the clips", () => {
    const one = { components: [{ id: "m", type: "rp2040-plus", x: 100, y: 60 }] };
    const clip = (config: unknown) => plan(config).holderBlocks.find((b) => b.kind === "clip" && b.inward?.[1] === 1)!;
    expect(clip(box(one)).yHigh).toBeCloseTo(clip(fit({ clipGap: 0.3 }, box(one))).yHigh + 0.1);
  });

  it("won't take a clip gap the barbs can't reach past", () => {
    const one = { components: [{ id: "m", type: "rp2040-plus", x: 100, y: 60 }] };
    const problem = errors(fit({ clipGap: BARB_REACH }, box(one))).find((e) => e.path === "fabrication.fit.clipGap");
    expect(problem?.code).toBe("BOARD_HOLDER_INVALID");
    expect(errors(fit({ clipGap: BARB_REACH - 0.01 }, box(one)))).toEqual([]);
    expect(errors(fit({ clipGap: BARB_REACH }))).toEqual([]);
  });

  it("rebuild the shell when they change", () => {
    const keys = (config: unknown) => planKeys(plan(config));
    expect(partsToRecut(keys(box()), keys(fit({ insertHole: 4.1 })))).toBeNull();
    expect(partsToRecut(keys(box()), keys(box()))).toEqual([]);
  });

  it("resize a wall hole, and a board's port", () => {
    const planned = (config: unknown) => plan(config).wallHoles[0]!;
    const hole = { wall: "rear", at: 100, z: 20, width: 12, height: 8 };
    expect(planned(box({ wallHoles: [{ ...hole, fitChange: 0.2 }] }))).toMatchObject({ width: 12.2, height: 8.2 });
    const one = { components: [{ id: "m", type: "rp2040-plus", x: 29, y: 60 }] };
    expect(planned(box(one))).toMatchObject({ width: 14, height: 8.5 });
    expect(planned(fit({ partHoles: { "rp2040-plus": 0.2 } }, box(one)))).toMatchObject({ width: 14.2, height: 8.7 });
  });

  it("won't take a wall hole with nothing left of it", () => {
    const hole = { wall: "rear", at: 100, z: 20, width: 1, height: 8, fitChange: -1 };
    expect(errors(box({ wallHoles: [hole] })).map((e) => e.code)).toContain("WALL_HOLE_INVALID");
  });

  describe("reach the geometry", () => {
    beforeAll(() => initEngine(), 60_000);
    const parts = (config: unknown) => buildEnclosure(plan(config)).parts;
    // Whether a hole here is at least this wide, going by what's left of the part inside it.
    const clearAt = (shape: Shape3D, diameter: number, x: number, y: number, z: number, height: number) => overlap(shape, cylinder(diameter / 2 - 0.02, height, [x, y, z])) < 0.001;

    it("cuts top posts and an upright shell's bosses with insertHole", () => {
      const config = fit({ insertHole: 4.4, insertHoleSideways: 3.6 }, capped());
      const built = plan(config);
      const [shell, top] = parts(config);
      const screw = built.topScrews[0]!;
      expect(clearAt(top!.shape, 4.4, screw.x, screw.y, screw.postBottom + 0.1, 5)).toBe(true);
      const [x, y] = built.plate!.screws[0]!;
      expect(clearAt(shell!.shape, 4.4, x, y, built.config.enclosure.floorThickness + 0.1, 5)).toBe(true);
    }, 60_000);

    it("cuts a seamed shell's bosses with insertHoleSideways, because they lie down to print", () => {
      const config = fit({ insertHole: 3.6, insertHoleSideways: 4.4 }, seamed());
      const built = plan(config);
      const [x, y] = built.plate!.screws[0]!;
      const all = parts(config);
      const floor = built.config.enclosure.floorThickness;
      expect(all.slice(0, 2).every((p) => clearAt(p.shape, 4.4, x, y, floor + 0.1, 5))).toBe(true);
    }, 60_000);

    it("cuts seam inserts upright with insertHole, and its bolts with screwHole", () => {
      const config = fit({ insertHole: 4.4, insertHoleSideways: 3.6, screwHole: 3.8 }, seamed());
      const built = plan(config);
      const seam = built.seams[0]!;
      const [left, right] = parts(config);
      for (const [y, z] of seam.bolts) {
        expect(overlap(right!.shape, cylinder(2.18, 5, [seam.x + 0.1, y, z], [1, 0, 0]))).toBeLessThan(0.001);
        expect(overlap(left!.shape, cylinder(1.88, 2, [seam.x - 2.5, y, z], [1, 0, 0]))).toBeLessThan(0.001);
      }
    }, 60_000);

    it("cuts the seam's socket with pinSocket, and leaves the pin alone", () => {
      const config = fit({ pinSocket: 4.8 }, seamed());
      const seam = plan(config).seams[0]!;
      const [y, z] = seam.pins[0]!;
      const [left, right] = parts(config);
      expect(overlap(right!.shape, cylinder(2.38, 2, [seam.x + 0.5, y, z], [1, 0, 0]))).toBeLessThan(0.001);
      expect(overlap(left!.shape, cylinder(2.02, 1, [seam.x + 0.5, y, z], [1, 0, 0]))).toBeLessThan(Math.PI * 2.02 ** 2 - 0.1);
      expect(overlap(left!.shape, cylinder(1.98, 1, [seam.x + 0.5, y, z], [1, 0, 0]))).toBeCloseTo(Math.PI * 1.98 ** 2, 1);
    }, 60_000);

    it("cuts a wall hole at its fitted size", () => {
      const hole = { wall: "rear", at: 100, z: 20, width: 12, height: 8 };
      const depth = 120;
      const y = depth - 5;
      const at = (config: unknown) => overlap(parts(config)[0]!.shape, cylinder(0.1, 8, [100 + 6.1, y, 20], [0, 1, 0]));
      expect(at(box({ wallHoles: [hole] }))).toBeGreaterThan(0.01);
      expect(at(box({ wallHoles: [{ ...hole, fitChange: 0.6 }] }))).toBeLessThan(0.001);
    }, 60_000);

    it("cuts top screw tabs with screwHole", () => {
      const config = fit({ screwHole: 3.8 }, capped());
      const screw = plan(config).topScrews[0]!;
      const shell = parts(config)[0]!;
      expect(clearAt(shell.shape, 3.8, screw.x, screw.y, screw.postBottom - 2.5, 2)).toBe(true);
      expect(clearAt(shell.shape, 4.4, screw.x, screw.y, screw.postBottom - 2.5, 2)).toBe(false);
    }, 60_000);

    it("cuts the rail's screw holes with screwHole", () => {
      const volume = (config: unknown) => measureVolume(parts(config).find((p) => p.kind === "rail")!.shape);
      const config = deskSynth();
      const before = volume(config);
      config.fabrication.fit = { screwHole: 3.8 };
      // Two holes, each about π(1.9² - 1.7²) x its depth wider.
      expect(volume(config)).toBeLessThan(before - 1);
    }, 60_000);

    it("cuts screw holes in the plate with screwHole", () => {
      const config = fit({ screwHole: 3.8 });
      const built = plan(config);
      const plate = parts(config).at(-1)!;
      const [x, y] = built.plate!.screws[0]!;
      const floor = built.config.enclosure.floorThickness;
      expect(clearAt(plate.shape, 3.8, x, y, floor - 0.5, 0.4)).toBe(true);
      expect(clearAt(plate.shape, 4.2, x, y, floor - 0.5, 0.4)).toBe(false);
    }, 60_000);
  });
});

describe("planning a fit test", () => {
  it("tests what the Desk Synth has", () => {
    const rows = rowsOf(deskSynth());
    expect(rows.map((row) => row.kind)).toEqual(["insert", "insertSideways", "screw", "plate", "seamPin", "clip", "part", "part", "part", "part", "wallHole", "part"]);
    expect(rows.map((row) => row.number)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
  });

  it("only tests lying-down inserts in a seamed shell with a plate", () => {
    expect(kinds(box())).not.toContain("insertSideways");
    expect(kinds(seamed())).toContain("insertSideways");
    expect(kinds(seamed({ plate: { enabled: false } }))).not.toContain("insertSideways");
  });

  it("leaves out what the design doesn't have", () => {
    expect(kinds(box({ plate: { enabled: false } }))).toEqual([]);
    expect(planFitTest(plan(box({ plate: { enabled: false } }))).coupons).toBe(0);
    expect(kinds(capped({ plate: { enabled: false } }))).toEqual(["insert", "screw"]);
    expect(kinds(box())).toEqual(["insert", "screw", "plate"]);
    expect(planFitTest(plan(box({ plate: { enabled: false } }))).plug).toBeNull();
    expect(planFitTest(plan(box())).plug).not.toBeNull();
    expect(planFitTest(plan(box({ plate: { enabled: false } }))).wallSection).toBeNull();
    expect(planFitTest(plan(box())).wallSection).not.toBeNull();
  });

  it("lists its pieces in the order they're built", () => {
    expect(fitTestPieces(planFitTest(plan(box())))).toEqual(["Fit test", "Fit test plug", "Wall section"]);
    expect(fitTestPieces(planFitTest(plan(seamed())))).toEqual(["Fit test", "Fit test plug", "Fit test pin", "Wall section", "Seam joint, left", "Seam joint, right"]);
  });

  it("only tests a seam's pin if there's a seam", () => {
    expect(kinds(box())).not.toContain("seamPin");
    expect(planFitTest(plan(box())).pin).toBeNull();
    const [row] = rowsOf(seamed()).filter((r) => r.kind === "seamPin");
    expect(row!.steps.map((s) => s.value)).toEqual([4.1, 4.2, 4.3, 4.4, 4.5]);
    expect(planFitTest(plan(seamed())).pin).toMatchObject({ diameter: PIN_DIAMETER, length: plan(seamed()).seams[0]!.pinLength });
  });

  it("never offers a socket the pin won't go in", () => {
    const [row] = rowsOf(fit({ pinSocket: 4 }, seamed())).filter((r) => r.kind === "seamPin");
    expect(row!.steps.every((s) => s.value >= PIN_DIAMETER)).toBe(true);
  });

  describe("wall holes", () => {
    const hole = (more: Record<string, unknown> = {}) => ({ wall: "rear", at: 100, z: 20, width: 12, height: 8, ...more });
    const wallRows = (config: unknown) => rowsOf(config).filter((row) => row.kind === "wallHole");

    it("gives identical holes one row, and different ones their own", () => {
      const rows = wallRows(box({ wallHoles: [hole(), hole({ at: 150 }), hole({ at: 50, width: 10 })] }));
      expect(rows.map((row) => row.parts)).toEqual([["0", "1"], ["2"]]);
    });

    it("prints them as the wall they're in does", () => {
      const printed = (config: unknown) => wallRows(config)[0]!.wallHole!.printed;
      expect(printed(box({ wallHoles: [hole()] }))).toBe("standing");
      expect(printed(box({ wallHoles: [hole({ wall: "left", at: 60 })] }))).toBe("standing");
      expect(printed(seamed({ wallHoles: [hole({ at: 50 })] }))).toBe("sideways");
      expect(printed(seamed({ wallHoles: [hole({ wall: "left", at: 60 })] }))).toBe("flat");
    });

    it("uses the real wall's thickness", () => {
      const config = box({ wallHoles: [hole()] });
      config.enclosure.wall = 4;
      expect(wallRows(config)[0]!.wallHole!.wall).toBe(4);
    });

    it("leaves out a hole too big to fit anything closely", () => {
      expect(wallRows(box({ wallHoles: [hole({ width: 60, height: 20 })] }))).toEqual([]);
    });

    it("tests a board's port, for that part", () => {
      const config = box({ components: [{ id: "m", type: "rp2040-plus", x: 29, y: 60 }] });
      const [row] = wallRows(config);
      expect(row!.parts).toEqual(["rp2040-plus"]);
      expect(row!.setting).toBe("partHoles");
      expect(row!.steps.map((step) => fitStepSize(row!, step))).toEqual(["13.8 x 8.3 mm", "14 x 8.5 mm", "14.2 x 8.7 mm"]);
      // Keeps its sizes once one is picked.
      const after = wallRows(fit({ partHoles: { "rp2040-plus": 0.2 } }, config))[0]!;
      expect(after.current).toBe(0.2);
      expect(after.steps).toEqual(row!.steps);
    });

    it("keeps its sizes when one is picked", () => {
      const [before] = wallRows(box({ wallHoles: [hole()] }));
      const [after] = wallRows(box({ wallHoles: [hole({ fitChange: 0.2 })] }));
      expect(after!.steps).toEqual(before!.steps);
      expect(after!.current).toBe(0.2);
    });

    it("skips a size that its corners wouldn't fit", () => {
      const [row] = wallRows(box({ wallHoles: [hole({ height: 4, cornerRadius: 1.95 })] }));
      expect(row!.steps.map((s) => s.value)).toEqual([0, 0.2]);
    });
  });

  it("only tests clips on a board that has them", () => {
    expect(kinds(box({ components: [{ id: "a", type: "ads7830", x: 100, y: 60 }] }))).not.toContain("clip");
    const [row] = rowsOf(box({ components: [{ id: "m", type: "rp2040-plus", x: 100, y: 60 }] })).filter((r) => r.kind === "clip");
    expect(row!.steps.map((s) => s.value)).toEqual([CLIP_GAP - 0.1, CLIP_GAP, CLIP_GAP + 0.1].map((v) => expect.closeTo(v, 5)));
  });

  it("never offers a clip gap the barbs can't reach past", () => {
    const one = { components: [{ id: "m", type: "rp2040-plus", x: 100, y: 60 }] };
    const [row] = rowsOf(fit({ clipGap: 0.45 }, box(one))).filter((r) => r.kind === "clip");
    expect(row!.steps.every((s) => s.value < BARB_REACH)).toBe(true);
  });

  it("gives one row to parts with the same holes", () => {
    const rows = rowsOf(deskSynth()).filter((row) => row.parts.includes("ec11-dial-19mm"));
    expect(rows).toHaveLength(1);
    expect(rows[0]!.parts).toEqual(["ec11-dial-19mm", "ec11-dial-30mm"]);
  });

  it("gives a round hole a range of sizes, and anything else one, to check its pattern", () => {
    const rows = rowsOf(deskSynth());
    const arcade = rows.find((row) => row.parts.includes("arcade-24mm"))!;
    expect(arcade.steps.map((s) => s.size)).toEqual([24.09, 24.24, 24.39]);
    expect(arcade.steps.map((s) => s.value)).toEqual([-0.15, 0, 0.15]);
    const board = rows.find((row) => row.parts.includes("encoder-board-5752"))!;
    expect(board.steps).toEqual([{ pips: 0, value: 0, size: 0 }]);
  });

  it("keeps a row's sizes when one is picked, so a print already made can still be read", () => {
    const sizes = (config: unknown) => rowsOf(config).find((row) => row.kind === "insert")!.steps;
    expect(sizes(box()).map((s) => s.value)).toEqual([3.8, 3.9, 4, 4.1, 4.2]);
    expect(sizes(fit({ insertHole: 4.1 }))).toEqual(sizes(box()));
    expect(sizes(fit({ insertHole: 4.2 }))).toEqual(sizes(box()));
  });

  it("moves a row's sizes for a setting past them, to test further", () => {
    const sizes = (config: unknown) => rowsOf(config).find((row) => row.kind === "insert")!.steps.map((s) => s.value);
    expect(sizes(fit({ insertHole: 4.5 }))).toEqual([4.3, 4.4, 4.5, 4.6, 4.7]);
  });

  it("puts fixings on their own first piece", () => {
    const rows = rowsOf(deskSynth());
    expect(rows.filter((row) => row.coupon === 0).map((row) => row.kind)).toEqual(["insert", "insertSideways", "screw", "plate", "seamPin"]);
  });

  it("starts another piece when the bed runs out", () => {
    const config = box({
      enclosure: { width: 140, frontHeight: 40, surfaces: [{ id: "top", y: 100, z: 40 }] },
      fabrication: { buildVolume: { x: 150, y: 110, z: 150 } },
      components: [
        { id: "a", type: "arcade-24mm", surface: "top", u: 30, v: 25 },
        { id: "b", type: "oled-242-ssd1309", surface: "top", u: 90, v: 60 },
        { id: "c", type: "ec11-dial-19mm", surface: "top", u: 30, v: 70 },
        { id: "d", type: "latch-button", surface: "top", u: 120, v: 20 },
      ],
    });
    const test = planFitTest(plan(config));
    // Fixings, then parts that come to more than the bed's depth.
    expect(test.coupons).toBeGreaterThan(2);
    for (let c = 0; c < test.coupons; c++) {
      const rows = test.rows.filter((row) => row.coupon === c);
      expect(rows.length).toBeGreaterThan(0);
      expect(rows.at(-1)!.y + rows.at(-1)!.depth).toBeLessThanOrEqual(100);
      rows.slice(1).forEach((row, i) => expect(row.y).toBeCloseTo(rows[i]!.y + rows[i]!.depth));
    }
  });

  it("makes the same plan every time", () => {
    expect(JSON.stringify(planFitTest(plan(deskSynth())))).toBe(JSON.stringify(planFitTest(plan(deskSynth()))));
  });
});

describe("writing back what fits", () => {
  const row = (setting: FitRow["setting"], parts: string[] = []) => ({ setting, parts });

  it("sets each kind of setting", () => {
    expect(applyFit(box(), row("insertHole"), 4.1).fabrication.fit).toEqual({ insertHole: 4.1 });
    expect(applyFit(box(), row("insertHoleSideways"), 4.2).fabrication.fit).toEqual({ insertHoleSideways: 4.2 });
    expect(applyFit(box(), row("screwHole"), 3.5).fabrication.fit).toEqual({ screwHole: 3.5 });
    expect(applyFit(box(), row("clipGap"), 0.1).fabrication.fit).toEqual({ clipGap: 0.1 });
    expect(applyFit(box(), row("pinSocket"), 4.4).fabrication.fit).toEqual({ pinSocket: 4.4 });
    expect(applyFit(box(), row("plateClearance"), 0.35).plate).toEqual({ clearance: 0.35 });
    expect(applyFit(box(), row("partHoles", ["a", "b"]), 0.15).fabrication.fit.partHoles).toEqual({ a: 0.15, b: 0.15 });
  });

  it("leaves nothing in the file once it's back to the default", () => {
    for (const [setting, value, usual] of [["insertHole", 4.1, 4], ["screwHole", 3.5, 3.4], ["clipGap", 0.1, 0.2], ["pinSocket", 4.4, 4.3], ["plateClearance", 0.35, 0.25]] as const) {
      expect(applyFit(applyFit(box(), row(setting), value), row(setting), usual)).toEqual(box());
    }
    expect(applyFit(applyFit(box(), row("partHoles", ["a"]), 0.15), row("partHoles", ["a"]), 0)).toEqual(box());
  });

  it("writes a wall hole's change on the holes it's for", () => {
    const holes = [{ wall: "rear", at: 50, z: 20, width: 12, height: 8 }, { wall: "rear", at: 100, z: 20, width: 12, height: 8 }, { wall: "rear", at: 150, z: 20, width: 12, height: 8 }];
    const set = applyFit(box({ wallHoles: holes }), row("wallHole", ["0", "2"]), 0.2);
    expect(set.wallHoles.map((h: any) => h.fitChange)).toEqual([0.2, undefined, 0.2]);
    expect(applyFit(set, row("wallHole", ["0", "2"]), 0)).toEqual(box({ wallHoles: holes }));
  });

  it("keeps the other settings", () => {
    const config = { ...box(), fabrication: { material: "PETG-GF", fit: { screwHole: 3.5 } }, plate: { screwSpacing: 90 } };
    expect(applyFit(config, row("insertHole"), 4.1).fabrication).toEqual({ material: "PETG-GF", fit: { screwHole: 3.5, insertHole: 4.1 } });
    expect(applyFit(config, row("plateClearance"), 0.35).plate).toEqual({ screwSpacing: 90, clearance: 0.35 });
  });

  it("is accepted by the validator", () => {
    expect(validateConfig(applyFit(deskSynth(), row("insertHole"), 4.1)).ok).toBe(true);
  });
});

describe("building a fit test", () => {
  let test: FitTestPlan;
  let shapes: Shape3D[];
  beforeAll(async () => {
    await initEngine();
    test = planFitTest(plan(deskSynth()));
    shapes = buildFitTest(test).map((part) => part.shape);
  }, 120_000);

  const rowOf = (kind: string, part?: string) => test.rows.find((row) => row.kind === kind && (!part || row.parts.includes(part)))!;
  const shapeOf = (row: FitRow) => shapes[row.coupon]!;
  const cellX = (row: FitRow, i: number) => FIT_MARGIN + row.pitch * (i + 0.5);
  const cellY = (row: FitRow) => row.y + (row.depth - FIT_PIP_BAND) / 2;

  it("makes closed, valid pieces that sit flat and fit the bed", async () => {
    expect(shapes).toHaveLength(test.coupons + 2);
    for (const shape of shapes) {
      expect(isValidSolid(shape)).toBe(true);
      const stl = analyseBinarySTL(new Uint8Array(await shape.blobSTL({ binary: true, tolerance: 0.05, angularTolerance: 0.2 }).arrayBuffer()));
      expect(stl.watertight).toBe(true);
      const [[, , zMin], [xMax, yMax]] = shape.boundingBox.bounds;
      expect(zMin).toBeCloseTo(0);
      expect(xMax).toBeLessThanOrEqual(256);
      expect(yMax).toBeLessThanOrEqual(256);
    }
  });

  it("holds together as one piece", () => {
    for (const shape of shapes) expect([...shape.solids ?? [shape]].length).toBe(1);
  });

  it("cuts each insert hole at its size, in a real boss", () => {
    const row = rowOf("insert");
    const top = row.thickness + SHORT_BOSS_HEIGHT;
    row.steps.forEach((step, i) => {
      const x = cellX(row, i);
      const y = cellY(row);
      expect(overlap(shapeOf(row), cylinder(step.size / 2 - 0.02, 5, [x, y, top - 5.5]))).toBeLessThan(0.001);
      expect(overlap(shapeOf(row), cylinder(step.size / 2 + 0.02, 5, [x, y, top - 5.5]))).toBeGreaterThan(0.001);
      // A floor under it, and a boss around it.
      expect(overlap(shapeOf(row), cylinder(1, 0.5, [x, y, top - 7]))).toBeGreaterThan(0.1);
      expect(overlap(shapeOf(row), cylinder(0.3, 2, [x + step.size / 2 + 0.6, y, top - 3]))).toBeGreaterThan(0.1);
    });
  });

  it("cuts lying-down insert holes at their size, with a point on top", () => {
    const row = rowOf("insertSideways");
    const z = row.thickness + FIT_WALL_HEIGHT / 2 - 0.5;
    const front = row.y + FIT_WALL_FRONT;
    row.steps.forEach((step, i) => {
      const x = cellX(row, i);
      const r = step.size / 2;
      expect(overlap(shapeOf(row), cylinder(r - 0.02, 5, [x, front + 0.1, z], [0, 1, 0]))).toBeLessThan(0.001);
      expect(overlap(shapeOf(row), cylinder(r + 0.05, 5, [x, front + 0.1, z], [0, 1, 0]))).toBeGreaterThan(0.001);
      // The teardrop's tip is open just above the circle, and it doesn't run through the wall.
      expect(overlap(shapeOf(row), cylinder(0.1, 3, [x, front + 0.1, z + r + 0.3], [0, 1, 0]))).toBeLessThan(0.001);
      expect(overlap(shapeOf(row), cylinder(0.5, 1, [x, front + 7.5, z], [0, 1, 0]))).toBeGreaterThan(0.1);
    });
  });

  it("cuts screw holes through, at their size, with a countersink on the bed side", () => {
    const row = rowOf("screw");
    row.steps.forEach((step, i) => {
      const x = cellX(row, i);
      const y = cellY(row);
      expect(overlap(shapeOf(row), cylinder(step.size / 2 - 0.02, row.thickness - 1.7, [x, y, 1.7]))).toBeLessThan(0.001);
      expect(overlap(shapeOf(row), cylinder(step.size / 2 + 0.05, 0.5, [x, y, row.thickness - 0.6]))).toBeGreaterThan(0.001);
      expect(overlap(shapeOf(row), cylinder(3.1, 0.02, [x, y, 0]))).toBeLessThan(0.001);
    });
  });

  it("cuts plate windows that leave its clearance around the plug", () => {
    const row = rowOf("plate");
    row.steps.forEach((step, i) => {
      const x = cellX(row, i);
      const y = cellY(row);
      const edge = 10 + step.size;
      expect(overlap(shapeOf(row), cylinder(0.04, 2, [x + edge - 0.06, y, 0.5]))).toBeLessThan(0.001);
      expect(overlap(shapeOf(row), cylinder(0.04, 2, [x + edge + 0.06, y, 0.5]))).toBeGreaterThan(0.001);
    });
    const [, [plugX, plugY, plugZ]] = shapes[test.coupons]!.boundingBox.bounds;
    expect([plugX, plugY, plugZ]).toEqual([20, 10, test.floorThickness]);
  });

  it("cuts seam sockets at their size, deep enough for the pin", () => {
    const row = rowOf("seamPin");
    const depth = row.socketDepth!;
    const top = row.thickness + Math.max(depth + 1 - row.thickness, 1);
    row.steps.forEach((step, i) => {
      const x = cellX(row, i);
      const y = cellY(row);
      expect(overlap(shapeOf(row), cylinder(step.size / 2 - 0.02, depth - 0.1, [x, y, top - depth + 0.05]))).toBeLessThan(0.001);
      expect(overlap(shapeOf(row), cylinder(step.size / 2 + 0.05, depth - 0.1, [x, y, top - depth + 0.05]))).toBeGreaterThan(0.001);
      expect(overlap(shapeOf(row), cylinder(1, 0.5, [x, y, top - depth - 0.6]))).toBeCloseTo(Math.PI * 0.5, 1);
    });
  });

  it("makes a loose pin, at the real seam's size", () => {
    const pin = shapes.at(-1)!;
    const { diameter, length, thickness, width } = test.pin!;
    const middle = width / 2;
    expect(overlap(pin, cylinder(diameter / 2 - 0.02, length - 0.1, [middle, middle, thickness + 0.05]))).toBeCloseTo(Math.PI * (diameter / 2 - 0.02) ** 2 * (length - 0.1), 1);
    expect(pin.boundingBox.bounds[1][2]).toBeCloseTo(thickness + length);
    // And no wider.
    expect(overlap(pin, cylinder(0.05, length - 0.1, [middle + diameter / 2 + 0.1, middle, thickness + 0.05]))).toBeLessThan(0.0001);
  });

  describe("wall holes", () => {
    const hole = (more: Record<string, unknown> = {}) => ({ wall: "rear", at: 100, z: 20, width: 12, height: 8, cornerRadius: 1, ...more });
    const built = (config: unknown) => {
      const small = planFitTest(plan(config));
      const row = small.rows.find((r) => r.kind === "wallHole")!;
      return { row, shape: buildFitTest(small)[row.coupon]!.shape };
    };

    it("cuts one across a standing wall, as wide along the bed as it is, at the wall's thickness", () => {
      const { row, shape } = built(box({ wallHoles: [hole()] }));
      expect(isValidSolid(shape)).toBe(true);
      const front = row.y + FIT_WALL_FRONT;
      const z = row.thickness + FIT_HOLE_PAD + (8 + 0.2) / 2;
      row.steps.forEach((step, i) => {
        const x = cellX(row, i);
        const half = (12 + step.value) / 2;
        const across = (dx: number, dz: number) => overlap(shape, cylinder(0.03, 3, [x + dx, front, z + dz], [0, 1, 0]));
        expect(across(half - 0.1, 0)).toBeLessThan(0.0001);
        expect(across(half + 0.1, 0)).toBeGreaterThan(0.001);
        const up = (8 + step.value) / 2;
        expect(across(0, up - 0.1)).toBeLessThan(0.0001);
        expect(across(0, up + 0.1)).toBeGreaterThan(0.001);
      });
      // No more wall than the real one.
      const x = cellX(row, 0);
      expect(overlap(shape, cylinder(0.03, 0.5, [x + 7, front + 3 - 0.6, z], [0, 1, 0]))).toBeGreaterThan(0);
      expect(overlap(shape, cylinder(0.03, 0.5, [x + 7, front + 3 + 0.1, z], [0, 1, 0]))).toBeLessThan(0.0001);
    }, 60_000);

    it("cuts a front or rear hole on its side when the shell prints that way", () => {
      const { row, shape } = built(seamed({ wallHoles: [hole({ at: 50 })] }));
      const front = row.y + FIT_WALL_FRONT;
      const z = row.thickness + FIT_HOLE_PAD + (12 + 0.2) / 2;
      const x = cellX(row, 1);
      const at = (dx: number, dz: number) => overlap(shape, cylinder(0.03, 3, [x + dx, front, z + dz], [0, 1, 0]));
      // Its 12 mm width goes up, and its 8 mm height along the bed.
      expect(at(3.9, 0)).toBeLessThan(0.0001);
      expect(at(4.1, 0)).toBeGreaterThan(0.001);
      expect(at(0, 5.9)).toBeLessThan(0.0001);
      expect(at(0, 6.1)).toBeGreaterThan(0.001);
    }, 60_000);

    it("cuts a left or right hole through a flat wall, on the bed", () => {
      const { row, shape } = built(seamed({ wallHoles: [hole({ wall: "left", at: 60 })] }));
      expect(row.thickness).toBe(3);
      const x = cellX(row, 1);
      const y = cellY(row);
      expect(overlap(shape, cylinder(1, 3.2, [x, y, -0.1]))).toBeLessThan(0.001);
      expect(overlap(shape, cylinder(0.05, 3, [x + 6.1, y, 0]))).toBeGreaterThan(0.001);
      expect(overlap(shape, cylinder(0.05, 3, [x, y + 4.1, 0]))).toBeGreaterThan(0.001);
    }, 60_000);
  });

  describe("the wall section", () => {
    const section = (config: unknown) => {
      const built = plan(config);
      const small = planFitTest(built);
      const all = buildFitTest(small, buildEnclosure(built).parts.map((p) => p.shape));
      expect(all.map((p) => p.name)).toEqual(fitTestPieces(small));
      return { built, small, shape: all.find((p) => p.name === "Wall section")!.shape, all };
    };
    const checks = async (shape: Shape3D) => {
      expect(isValidSolid(shape)).toBe(true);
      expect(shape.solids).toHaveLength(1);
      const stl = analyseBinarySTL(new Uint8Array(await shape.blobSTL({ binary: true, tolerance: 0.05, angularTolerance: 0.2 }).arrayBuffer()));
      expect(stl.watertight).toBe(true);
      expect(shape.boundingBox.bounds[0][2]).toBeCloseTo(0);
    };

    it("is a corner of an upright shell, standing on its base", async () => {
      const { shape } = section(box());
      await checks(shape);
      const [[x0, y0], [x1, y1, z1]] = shape.boundingBox.bounds;
      expect(x0).toBeCloseTo(0);
      expect(y0).toBeCloseTo(0);
      expect(x1).toBeCloseTo(FIT_SECTION_SIZE);
      expect(y1).toBeCloseTo(FIT_SECTION_SIZE);
      // The enclosure is 40 high.
      expect(z1).toBeCloseTo(40);
    }, 60_000);

    it("lies on its left wall if the shell does", async () => {
      const { shape } = section(seamed());
      await checks(shape);
      const [, [, , height]] = shape.boundingBox.bounds;
      expect(height).toBeCloseTo(FIT_SECTION_SIZE);
      // The left wall is on the bed, as a whole 3 mm layer of it.
      expect(overlap(shape, boxSolidAt(5, 5, 0.1))).toBeGreaterThan(0);
    }, 60_000);

    it("holds together on the Desk Synth, with its rounds", async () => {
      const { shape } = section(deskSynth());
      await checks(shape);
    }, 120_000);

    it("keeps only the corner, if cutting it leaves a bit on its own", () => {
      const small = planFitTest(plan(box())).wallSection!;
      const [xLow] = small.x;
      const [yLow] = small.y;
      const [zLow] = small.z;
      const corner = boxOf([xLow + 1, xLow + 11], [yLow + 1, yLow + 11], [zLow + 1, zLow + 11]);
      const bit = boxOf([xLow + 15, xLow + 17], [yLow + 15, yLow + 17], [zLow + 1, zLow + 3]);
      const shape = buildWallSection(small, compoundShapes([bit, corner]) as Shape3D);
      expect(measureVolume(shape)).toBeCloseTo(1000);
    }, 60_000);

    describe("the seam joint", () => {
      const joint = (config: unknown) => {
        const { built, small, all } = section(config);
        const [left, right] = small.seamJoint!;
        return { built, left: left!, right: right!, leftShape: all.at(-2)!.shape, rightShape: all.at(-1)!.shape };
      };

      it("is only for a design with a seam", () => {
        expect(planFitTest(plan(box())).seamJoint).toBeNull();
      });

      it("takes in a whole tab, with its bolts and pin", () => {
        const built = plan(seamed());
        const [left] = planFitTest(built).seamJoint!;
        const inBox = ([y, z]: readonly [number, number]) => y > left!.y[0] && y < left!.y[1] && z > left!.z[0] && z < left!.z[1];
        expect(built.seams[0]!.bolts.filter(inBox).length).toBeGreaterThan(0);
        expect(built.seams[0]!.pins.filter(inBox).length).toBeGreaterThan(0);
      });

      it("comes out sound, each half as it prints, with the seam up", async () => {
        const config = seamed();
        const { built, leftShape, rightShape } = joint(config);
        await checks(leftShape);
        await checks(rightShape);
        const { pinLength } = built.seams[0]!;
        // The left half's pin stands up past the seam, and the right has nothing past it.
        expect(leftShape.boundingBox.bounds[1][2]).toBeCloseTo(SECTION_REACH + pinLength);
        expect(rightShape.boundingBox.bounds[1][2]).toBeCloseTo(SECTION_REACH);
      }, 60_000);

      it("holds together on the Desk Synth", async () => {
        const { leftShape, rightShape } = joint(deskSynth());
        await checks(leftShape);
        await checks(rightShape);
      }, 120_000);
    });

    it("isn't made without the shell", () => {
      const small = planFitTest(plan(box()));
      expect(buildFitTest(small).map((p) => p.name)).toEqual(["Fit test", "Fit test plug"]);
    }, 60_000);
  });

  it("makes a real pair of clips, at each gap", () => {
    const row = rowOf("clip", "rp2040-plus");
    const edge = 21 / 2;
    row.steps.forEach((step, i) => {
      const x = cellX(row, i);
      const y = cellY(row);
      // Nothing in the gap, then the clip, at both edges of the board.
      for (const side of [-1, 1]) {
        const gapY = y + side * (edge + step.size / 2);
        expect(overlap(shapeOf(row), cylinder(step.size / 2 - 0.02, 3, [x, gapY, row.thickness + 2]))).toBeLessThan(0.001);
        const clipY = y + side * (edge + step.size + 0.8);
        expect(overlap(shapeOf(row), cylinder(0.3, 3, [x, clipY, row.thickness + 2]))).toBeGreaterThan(0.1);
      }
      // And the pad the board rests on.
      expect(overlap(shapeOf(row), cylinder(0.3, 3, [x, y, row.thickness + 2]))).toBeGreaterThan(0.1);
    });
  });

  it("cuts a part's hole at each size, face down, with its keyway", () => {
    const row = rowOf("part", "arcade-24mm");
    // Room for the largest hole and its keyway, with the usual plastic all around, and the dots behind.
    expect(row.depth).toBeCloseTo(25.12 + 0.15 + 2 * FIT_HOLE_PAD + FIT_PIP_BAND);
    expect(row.pitch).toBeCloseTo(24.24 + 0.15 + 2 * FIT_HOLE_PAD);
    row.steps.forEach((step, i) => {
      const x = cellX(row, i);
      // The row is centred on the hole and its keyway together. The keyway points at the bed's
      // front, because the part's rear does, face down.
      const y = cellY(row) + (13 - 12.12) / 2;
      const r = step.size / 2;
      const clear = (dx: number, dy: number, radius = 0.1) => overlap(shapeOf(row), cylinder(radius, row.thickness - 0.5, [x + dx, y + dy, 0.1])) < 0.0001;
      expect(clear(0, -(12.9 + step.value / 2))).toBe(true);
      expect(clear(0, -(13.2 + step.value / 2))).toBe(false);
      expect(clear(4, -(12.8 + step.value / 2), 0.05)).toBe(true);
      expect(clear(5, -(12.5 + step.value / 2), 0.05)).toBe(false);
      // And none on the other side.
      expect(clear(0, r + 0.2)).toBe(false);
      expect(overlap(shapeOf(row), cylinder(step.size / 2 - 0.02, row.thickness - 0.5, [x, y, 0.1]))).toBeLessThan(0.001);
      expect(overlap(shapeOf(row), cylinder(0.2, row.thickness - 0.5, [x + step.size / 2 + 0.4, y, 0.1]))).toBeGreaterThan(0.01);
    });
  });

  it("repeats a part's whole pattern, spacing included", () => {
    const row = rowOf("part", "encoder-board-5752");
    const x = cellX(row, 0);
    const y = cellY(row);
    for (const offset of [-28.55, -9.55, 9.55, 28.55]) {
      expect(overlap(shapeOf(row), cylinder(3.68, row.thickness - 0.5, [x + offset, y, 0.1]))).toBeLessThan(0.001);
    }
    expect(overlap(shapeOf(row), cylinder(1, 1, [x, y, 1]))).toBeGreaterThan(0.1);
  });

  it("builds a screen's posts upwards, because the panel prints face down", () => {
    const row = rowOf("part", "oled-242-ssd1309");
    const x = cellX(row, 0);
    const y = cellY(row);
    const shape = shapeOf(row);
    // The posts stand up from the inside of the panel, with holes from their tips, as in the real panel.
    for (const [px, pv] of [[-32.95, -21.8], [32.95, -21.8], [-32.95, 21.8], [32.95, 21.8]] as const) {
      const py = y - pv;
      expect(overlap(shape, cylinder(1.8, 0.2, [x + px, py, 3.3]))).toBeGreaterThan(0.1);
      expect(overlap(shape, cylinder(0.75, 1, [x + px, py, 3]))).toBeLessThan(0.001);
      // It stops short of the face.
      expect(overlap(shape, cylinder(0.5, 0.5, [x + px, py, 0.5]))).toBeGreaterThan(0.1);
    }
    const clear = (dx: number, dv: number, z: number) => overlap(shape, cylinder(0.05, 0.1, [x + dx, y - dv, z])) < 0.0001;
    // The window goes through, and its skin is on the bed.
    expect(overlap(shape, cylinder(5, 3, [x, y - 2.7, 0.1]))).toBeLessThan(0.001);
    expect(overlap(shape, cylinder(0.5, 1, [x + 31, y, 0.1]))).toBeGreaterThan(0.1);
    // The recess, behind the skin.
    expect(clear(31.5, 0, 2)).toBe(true);
    expect(clear(31.7, 0, 2)).toBe(false);
    expect(clear(25, 20.4, 2)).toBe(true);
    expect(clear(25, 20.6, 2)).toBe(false);
    // Its notch at the front, for the ribbon, and only so wide.
    expect(clear(0, -19.1, 2)).toBe(true);
    expect(clear(19.4, -20.1, 2)).toBe(true);
    expect(clear(19.6, -20.1, 2)).toBe(false);
    expect(clear(0, -20.3, 2)).toBe(false);
    // And not through the skin.
    expect(clear(0, -20.1, 1)).toBe(false);
  });

  it("cuts the 0.96 inch OLED, face down, with the PCB resting on the back of the panel", () => {
    const row = rowOf("part", "oled-ssd1306");
    expect(row.number).toBe(12);
    const bounds = partHoleBounds(row.part as PanelPart);
    const x = cellX(row, 0) - (bounds.xLow + bounds.xHigh) / 2;
    const y = cellY(row) + (bounds.yLow + bounds.yHigh) / 2;
    const shape = shapeOf(row);
    const clear = (du: number, dv: number, z: number) => overlap(shape, cylinder(0.05, 0.1, [x + du, y - dv, z])) < 0.0001;
    // The window goes through, around the lit area, which is above the middle of the board.
    expect(clear(0, 2.1, 0.2)).toBe(true);
    expect(clear(11.9, 2.1, 0.2)).toBe(true);
    expect(clear(12.1, 2.1, 0.2)).toBe(false);
    expect(clear(0, 8.5, 0.2)).toBe(true);
    expect(clear(0, 8.7, 0.2)).toBe(false);
    expect(clear(0, -4.3, 0.2)).toBe(true);
    expect(clear(0, -4.5, 0.2)).toBe(false);
    // The recess for the glass, 1.5 mm deep behind the skin.
    expect(clear(13.5, 0, 2)).toBe(true);
    expect(clear(13.8, 0, 2)).toBe(false);
    expect(clear(13.5, 0, 1.3)).toBe(false);
    expect(clear(10, 9.8, 2)).toBe(true);
    expect(clear(10, 10.1, 2)).toBe(false);
    // Room for the ribbon at the front, and only so wide.
    expect(clear(7.5, -14.2, 2)).toBe(true);
    expect(clear(7.7, -14.2, 2)).toBe(false);
    expect(clear(0, -14.3, 2)).toBe(true);
    expect(clear(0, -14.5, 2)).toBe(false);
    // Room for the header's solder tails at the rear, and only so wide.
    expect(clear(5.1, 13.6, 2)).toBe(true);
    expect(clear(5.2, 13.6, 2)).toBe(false);
    expect(clear(0, 13.8, 2)).toBe(false);
    // The screw holes go in from the back, and stop short of the face.
    for (const [du, dv] of [[-11.65, -11.9], [11.65, -11.9], [-11.65, 11.9], [11.65, 11.9]] as const) {
      expect(clear(du, dv, 2.9)).toBe(true);
      expect(clear(du, dv, 1)).toBe(true);
      expect(clear(du, dv, 0.6)).toBe(false);
      expect(clear(du + 0.9, dv, 2)).toBe(false);
    }
  });

  it("numbers the sizes and rows with dots", () => {
    const dotsAt = (row: FitRow, x: number, y: number, r: number) => overlap(shapeOf(row), cylinder(r, 0.2, [x, y, row.thickness - 0.3])) < 0.001;
    const row = rowOf("screw");
    const band = row.y + row.depth - FIT_PIP_BAND / 2;
    // Two dots on the second size, side by side, and none between them.
    const x = cellX(row, 1);
    expect(dotsAt(row, x - 1.2, band, 0.5)).toBe(true);
    expect(dotsAt(row, x + 1.2, band, 0.5)).toBe(true);
    expect(dotsAt(row, x, band, 0.2)).toBe(false);
    // Row three has three dots, in a column.
    for (const dy of [-3.2, 0, 3.2]) expect(dotsAt(row, FIT_MARGIN / 2, cellY(row) + dy, 0.7)).toBe(true);
    expect(dotsAt(row, FIT_MARGIN / 2, cellY(row) + 1.6, 0.2)).toBe(false);
  });

  it("gives a small design a small print", () => {
    const small = planFitTest(plan(box()));
    const [piece] = buildFitTest(small);
    expect(isValidSolid(piece!.shape)).toBe(true);
    expect(small.coupons).toBe(1);
  });
});

describe("trying a part the design doesn't use", () => {
  const trying = (ids: string[], config: any = box()) => ({ ...config, fabrication: { ...config.fabrication, fitTestParts: ids } });
  const wide = { components: [{ id: "b", type: "arcade-24mm", surface: "top", u: 60, v: 60 }], wallHoles: [{ wall: "rear", at: 100, z: 20, width: 14, height: 8.5 }] };

  it("goes after the design's own rows, so a print already made keeps its numbers", () => {
    const before = rowsOf(box(wide));
    const after = rowsOf(trying(["oled-ssd1306", "rp2040-plus"], box(wide)));
    expect(after.slice(0, before.length).map(({ number, y, coupon, title }) => ({ number, y, coupon, title }))).toEqual(before.map(({ number, y, coupon, title }) => ({ number, y, coupon, title })));
    expect(after.slice(before.length).map((row) => row.kind)).toEqual(["clip", "part"]);
  });

  it("doesn't test a part twice", () => {
    const rows = rowsOf(trying(["arcade-24mm", "oled-ssd1306", "oled-ssd1306"], box(wide))).filter((row) => row.parts.includes("arcade-24mm") || row.parts.includes("oled-ssd1306"));
    expect(rows.map((row) => row.parts)).toEqual([["arcade-24mm"], ["oled-ssd1306"]]);
  });

  it("shares a row with a part in the design that has the same holes", () => {
    const same = { ...library["arcade-24mm"]!, name: "Same holes" };
    const rows = rowsOf(trying(["same"], box({ ...wide, customParts: { same } }))).filter((row) => row.parts.includes("same"));
    expect(rows.map((row) => row.parts)).toEqual([["arcade-24mm", "same"]]);
  });

  it("asks for what the row needs", () => {
    expect(planFitTest(plan(trying(["oled-ssd1306"]))).hardware.join(" ")).toContain(library["oled-ssd1306"]!.name);
  });

  it("refuses what can't be tried, and says where", () => {
    const unknown = errors(trying(["nope"]));
    expect(unknown.map((e) => [e.code, e.path])).toEqual([["UNKNOWN_PART", "fabrication.fitTestParts[0]"]]);
    expect(errors(trying(["midi-din-5"])).map((e) => e.code)).toEqual(["FIT_TEST_PART_INVALID"]); // goes through a wall
    expect(errors(trying(["pi-zero"])).map((e) => e.code)).toEqual(["FIT_TEST_PART_INVALID"]); // no clips
  });

  it("holds it to the same rules as a part in the design", () => {
    const thick = box({ enclosure: { ...box().enclosure, panelThickness: 4 } });
    expect(errors(trying(["oled-ssd1306"], thick)).map((e) => e.code)).toEqual(["PANEL_THICKNESS_UNSUITABLE"]);
    const bare = { name: "bare", source: "estimated", mount: "panel", above: { footprint: { shape: "circle", diameter: 5 }, height: 1 }, below: { footprint: { shape: "circle", diameter: 5 }, depth: 1 } };
    const customParts = {
      pocket: { ...bare, cutouts: [{ kind: "pocket", width: 5, height: 5, skin: 0.1 }] },
      hole: { ...bare, cutouts: [{ kind: "rect", width: 8, height: 8, recess: { width: 10, height: 10, skin: 5 } }] },
      window: { ...bare, cutouts: [{ kind: "rect", width: 12, height: 8, recess: { width: 10, height: 10, skin: 1 } }] },
      screw: { ...bare, cutouts: [{ kind: "circle", diameter: 5 }], posts: [{ at: [6, 6], diameter: 4, reach: 3, holeDiameter: 1.6, holeDepth: 2.9 }] },
      stub: { ...bare, cutouts: [{ kind: "circle", diameter: 5 }], posts: [{ at: [6, 6], diameter: 4, reach: 0.5, holeDiameter: 1.6, holeDepth: 0.1 }] },
    };
    const codes = (id: string) => errors(trying([id], box({ customParts }))).map((e) => e.code);
    expect(codes("pocket")).toEqual(["SKIN_INVALID"]);
    expect(codes("hole")).toEqual(["SKIN_INVALID"]);
    expect(codes("window")).toEqual(["GEOMETRY_IMPOSSIBLE"]);
    expect(codes("screw")).toEqual(["SKIN_INVALID"]);
    expect(codes("stub")).toEqual(["SKIN_INVALID", "GEOMETRY_IMPOSSIBLE"]);
  });

  it("is added and removed in the config, with nothing left behind", () => {
    const added = setFitTestParts({ name: "x" }, ["oled-ssd1306"]);
    expect(added).toEqual({ name: "x", fabrication: { fitTestParts: ["oled-ssd1306"] } });
    expect(setFitTestParts(added, [])).toEqual({ name: "x" });
    expect(setFitTestParts({ fabrication: { material: "PETG", fitTestParts: ["a"] } }, [])).toEqual({ fabrication: { material: "PETG" } });
  });

  it("doesn't change the enclosure", () => {
    const before = plan(box(wide));
    const after = plan(trying(["oled-ssd1306"], box(wide)));
    expect(partsToRecut(planKeys(before), planKeys(after))).toEqual([]);
  });

  it("takes what was picked for it, and uses it if the part is placed later", () => {
    const config = trying(["oled-ssd1306"]);
    const row = rowsOf(config).find((r) => r.parts.includes("oled-ssd1306"))!;
    const picked = applyFit(config, row, 0.1);
    expect(picked.fabrication).toEqual({ fitTestParts: ["oled-ssd1306"], fit: { partHoles: { "oled-ssd1306": 0.1 } } });
    expect(rowsOf(picked).find((r) => r.parts.includes("oled-ssd1306"))!.current).toBe(0.1);
  });
});

describe("the 0.96 inch OLED", () => {
  const part = library["oled-ssd1306"] as PanelPart;
  const placed = box({ topPanels: [{ surface: "top" }], components: [{ id: "o", type: "oled-ssd1306", surface: "top", u: 100, v: 60 }] });
  const PCB = { width: 27.3, height: 27.8 };
  const GLASS = { width: 26.7, height: 19.27, thickness: 1.5 }; // to the PCB's face, with what holds it on

  it("has room for the glass, and the PCB's face on the back of the panel", () => {
    const window = part.cutouts[0] as Extract<PanelPart["cutouts"][number], { kind: "rect" }>;
    const recess = window.recess!;
    expect(recess.width).toBeGreaterThan(GLASS.width);
    expect(recess.height).toBeGreaterThan(GLASS.height);
    expect(recess.skin + GLASS.thickness).toBeCloseTo(part.posts[0]!.reach);
    expect(part.panelThickness?.max).toBe(part.posts[0]!.reach);
  });

  it("shows all of the lit area", () => {
    const window = part.cutouts[0] as Extract<PanelPart["cutouts"][number], { kind: "rect" }>;
    const lit = { xHigh: 21.74 / 2, yLow: GLASS.height / 2 - 2.1 - 10.86, yHigh: GLASS.height / 2 - 2.1 };
    expect(window.at[0] + window.width / 2).toBeGreaterThan(lit.xHigh);
    expect(window.at[1] + window.height / 2).toBeGreaterThan(lit.yHigh);
    expect(window.at[1] - window.height / 2).toBeLessThan(lit.yLow);
    // and stays on the glass, so the recess has a lip to stop it
    expect(window.at[1] + window.height / 2).toBeLessThan(GLASS.height / 2);
    expect(window.width / 2).toBeLessThan(GLASS.width / 2);
  });

  it("has its screws in the board's holes, and clear of the glass", () => {
    for (const post of part.posts) {
      expect(Math.abs(post.at[0])).toBeCloseTo(PCB.width / 2 - 2);
      expect(Math.abs(post.at[1])).toBeCloseTo(PCB.height / 2 - 2);
      expect(Math.abs(post.at[1]) - post.diameter / 2).toBeGreaterThan(GLASS.height / 2);
    }
    expect(new Set(part.posts.map((post) => post.at.join())).size).toBe(4);
  });

  it("is accepted on a 3 mm panel, and warned about until it's measured", () => {
    const result = validateConfig(placed);
    expect(result.ok ? [] : result.errors).toEqual([]);
    expect(result.warnings.map((w) => w.code)).toContain("UNVERIFIED_PART");
  });

  it("cuts into a closed part, with the window through and the recess stopping at its skin", async () => {
    await initEngine();
    const { parts } = buildEnclosure(plan(placed));
    const top = parts.find((p) => p.name.toLowerCase().includes("top")) ?? parts.at(-1)!;
    expect(isValidSolid(top.shape)).toBe(true);
    const stl = analyseBinarySTL(new Uint8Array(await top.shape.blobSTL({ binary: true, tolerance: 0.05, angularTolerance: 0.2 }).arrayBuffer()));
    expect(stl.watertight).toBe(true);
    expect([...top.shape.solids]).toHaveLength(1);
  }, 120_000);
});
