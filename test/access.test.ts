// Every screw has to be reachable with a driver, in the order the design goes together. The rules
// are in the validator, so these check them against the solids it says are clear.
import { beforeAll, describe, expect, it } from "vitest";
import { makeCylinder, measureVolume, type Shape3D } from "replicad";
import { buildEnclosure, initEngine, validateConfig, type BuildPlan } from "../src/index.js";
import { DRIVER_DIAMETER, SEAM_DRIVER_ROOM } from "../src/plate.js";
import { blocksTopDriver, TOP_TAB_THICKNESS, topScrewProblem } from "../src/top.js";
import { errors, deskSynth } from "./helpers.js";
import { readFileSync } from "node:fs";

function plan(config: unknown): BuildPlan {
  const result = validateConfig(config);
  if (!result.ok) throw new Error(JSON.stringify(result.errors, null, 1));
  return result.plan;
}
const example = (name: string) => JSON.parse(readFileSync(new URL(`../examples/${name}.json`, import.meta.url), "utf8"));
const box = (overrides: Record<string, unknown> = {}, enclosure: Record<string, unknown> = {}): any => ({
  schemaVersion: 1,
  name: "box",
  enclosure: { width: 240, frontHeight: 40, surfaces: [{ id: "top", y: 150, z: 40 }], ...enclosure },
  ...overrides,
});
const capped = (overrides: Record<string, unknown> = {}, enclosure: Record<string, unknown> = {}) => box({ topPanels: [{ surface: "top" }], ...overrides }, enclosure);
const rounded = (radius = 12) => ({ rounds: { frontBottom: radius } });
const underside = (screw: { postBottom: number }) => screw.postBottom - 0.2 - TOP_TAB_THICKNESS;
const r = DRIVER_DIAMETER / 2;
const M3_HEAD = 5.5;

describe("the paths in real solids", () => {
  beforeAll(() => initEngine(), 60_000);
  const overlap = (a: Shape3D, b: Shape3D) => {
    try {
      return measureVolume(a.intersect(b));
    } catch (error) {
      if (String(error).includes("deleted")) throw error;
      return 0;
    }
  };

  const designs: [string, () => unknown][] = [
    ["the Desk Synth", deskSynth],
    ["the Dial deck", () => example("dial-deck")],
    ["a plain capped box", () => capped()],
    ["a seamed box with a front round", () => capped({ topPanels: [{ surface: "top", splits: [150] }], seams: [{ x: 140 }] }, { width: 300, ...rounded() })],
    ["a box with both bottom rounds", () => capped({}, { rounds: { frontBottom: 10, rearBottom: 10 } })],
    ["a box without a plate", () => capped({ plate: { enabled: false } })],
  ];

  it.each(designs)("leaves a clear path up to every top screw in %s", (_, config) => {
    const built = plan(config());
    expect(built.topScrews.length).toBeGreaterThan(0);
    const shells = buildEnclosure(built).parts.filter((part) => part.kind === "shell");
    for (const screw of built.topScrews) {
      const path = makeCylinder(r, underside(screw) + 5 - 0.05, [screw.x, screw.y, -5], [0, 0, 1]);
      for (const shell of shells) expect(overlap(shell.shape, path), `${screw.wall} at ${screw.x}, ${screw.y}`).toBeLessThan(0.05);
    }
  }, 120_000);

  it("leaves room behind every seam bolt", () => {
    // The last has a low bolt beside the rear wall, where the slope of a boss would cross its path.
    const lowBolt = box({ seams: [{ x: 150 }] }, { width: 300, frontHeight: 15, surfaces: [{ id: "top", y: 50, z: 40 }, { id: "surface-2", y: 90, z: 40 }], wall: 1.6, floorThickness: 3, cornerRadius: 12, panelThickness: 1.6, rounds: { rearBottom: 12 } });
    for (const config of [deskSynth(), capped({ topPanels: [{ surface: "top", splits: [150] }], seams: [{ x: 140 }] }, { width: 300, ...rounded() }), lowBolt]) {
      const built = plan(config);
      const [left] = buildEnclosure(built).parts;
      const seam = built.seams[0]!;
      const head = seam.x - seam.ribHalfThickness;
      expect(seam.bolts.length).toBeGreaterThan(0);
      for (const [y, z] of seam.bolts) {
        // At the size of the head itself, since this path has the shell's wall right beside it.
        expect(overlap(left!.shape, makeCylinder(M3_HEAD / 2, SEAM_DRIVER_ROOM, [head - SEAM_DRIVER_ROOM, y, z], [1, 0, 0])), `${y}, ${z}`).toBeLessThan(0.05);
      }
    }
  }, 120_000);
});

describe("placing top screws", () => {
  it("keeps plate bosses off their paths", () => {
    const built = plan(capped());
    for (const screw of built.topScrews) {
      for (const [x, y] of built.plate!.screws) {
        expect(Math.abs(x - screw.x) >= 4 + r || Math.abs(y - screw.y) >= 4 + r, `${screw.x}, ${screw.y} and ${x}, ${y}`).toBe(true);
      }
    }
  });

  it("sets a front row back behind a bottom round", () => {
    const front = plan(capped({}, rounded())).topScrews.filter((screw) => screw.wall === "front");
    expect(front.length).toBeGreaterThan(0);
    for (const screw of front) expect(screw.y).toBeCloseTo(12 + r);
  });

  it("keeps a front row at the wall without one", () => {
    const front = plan(capped()).topScrews.filter((screw) => screw.wall === "front");
    expect(front.every((screw) => screw.y < 8)).toBe(true);
  });

  it("keeps side screws off a bottom round", () => {
    for (const screw of plan(capped({}, rounded())).topScrews) expect(screw.y - r).toBeGreaterThanOrEqual(12 - 0.001);
    for (const screw of plan(capped({}, { rounds: { rearBottom: 12 } })).topScrews) expect(screw.y + r).toBeLessThanOrEqual(150 - 12 + 0.001);
  });

  it("rejects an added screw whose path runs through a round, with the reason", () => {
    const config = capped({ topPanels: [{ surface: "top", fasteners: { add: [{ wall: "left", at: 8 }] } }] }, rounded());
    expect(errors(config)[0]?.message).toContain("past the end");
    const rear = capped({ topPanels: [{ surface: "top", fasteners: { add: [{ wall: "left", at: 145 }] } }] }, { rounds: { rearBottom: 12 } });
    expect(errors(rear)[0]?.message).toContain("past the end");
  });

  it("keeps it clear of a seam tab below", () => {
    // The tab on the seam's wall sits under where this panel's screw would be driven from.
    const config = capped({ seams: [{ x: 120 }] });
    for (const screw of plan(config).topScrews) {
      for (const tab of plan(config).seams[0]!.tabs) {
        const ys = [tab.start[0], tab.end[0], tab.start[0] + tab.inward[0] * tab.width];
        const clearAlongX = Math.abs(screw.x - 120) >= 14 + r;
        const clearAlongY = screw.y + r <= Math.min(...ys) || screw.y - r >= Math.max(...ys);
        expect(clearAlongX || clearAlongY).toBe(true);
      }
    }
  });

  it("keeps it clear of the body of a part", () => {
    const button = { id: "b", type: "arcade-24mm", surface: "top", u: 18, v: 75 };
    const near = (x: number, y: number) => Math.hypot(x - 18, y - 75) < 23.2 / 2 + r;
    for (const screw of plan(capped({ components: [button] })).topScrews) expect(near(screw.x, screw.y)).toBe(false);
  });

  it("keeps it clear of a rail's screw block", () => {
    const opening = { xMin: 60, xMax: 180, yEnd: 40, sill: 8, rail: { depth: 14, screwX: [50, 190] } };
    for (const screw of plan(capped({ opening })).topScrews) {
      for (const x of [50, 190]) expect(Math.abs(screw.x - x) >= 3.5 + r || screw.y - r >= 14).toBe(true);
    }
  });

  it("rejects an added screw on a seam bolt's path, with the reason", () => {
    const seamed = capped({ seams: [{ x: 120 }] });
    seamed.topPanels[0].fasteners = { add: [{ wall: "front", at: 90 }] };
    expect(errors(seamed)[0]?.message).toContain("seam bolt");
  });
});

describe("a top screw's path, on its own", () => {
  // A front screw whose tab reaches back along the deck of the Desk Synth's shape, with nothing near it.
  const { profile } = plan(deskSynth());
  const screw = { x: 60, y: 20, wall: "front" as const, postBottom: 18 };
  const sizes = { wall: 3.25, width: 351.4, depth: profile.depth, cornerRadius: 11.5, floorThickness: 3, rearWallY: profile.depth - 3.25, seamXs: [] };
  const none = { cutouts: [], bodies: [], floorParts: [], blockedBoxes: [], seamTabs: [], minWeb: 1.2, partClearance: 1 };
  const check = (obstacles: Record<string, unknown>, at = screw) => topScrewProblem(profile, { ...none, ...obstacles }, "deck", at, sizes, { u: at.x, v: at.y });
  // Under the tab, so that only the path can hit it: it's 15 mm below the tab's underside.
  const lowDown = { xLow: screw.x - 1, xHigh: screw.x + 1, section: [[screw.y - 1, 1], [screw.y + 1, 1], [screw.y + 1, 2], [screw.y - 1, 2]] as [number, number][] };

  it("is clear with nothing there", () => expect(check({})).toBeNull());
  it("can't run through a bottom round at the front", () => {
    expect(check({ openBase: { yLow: screw.y - r + 0.01, yHigh: 200 } })).toContain("bottom round");
    expect(check({ openBase: { yLow: screw.y - r, yHigh: 200 } })).toBeNull();
  });
  it("can't run through a bottom round at the rear", () => {
    expect(check({ openBase: { yLow: 0, yHigh: screw.y + r - 0.01 } })).toContain("bottom round");
  });
  it("can't run through the body of a part", () => expect(check({ bodies: [lowDown] })).toContain("body of a part would block"));
  it("can't run through a seam tab", () => expect(check({ seamTabs: [lowDown] })).toContain("seam tab would block"));
  it("can run beside them", () => {
    const beside = { ...lowDown, xLow: screw.x + r, xHigh: screw.x + r + 2 };
    // Past the driver, but under the tab, which is fine: the tab is above it.
    expect(check({ bodies: [beside], seamTabs: [beside] })).toBeNull();
  });
  it("can't run through a rail's block", () => {
    const block = { xLow: screw.x + r - 0.01, xHigh: screw.x + 10, yLow: 0, yHigh: 30 };
    expect(check({ railBlocks: [block] })).toContain("rail");
    expect(check({ railBlocks: [{ ...block, xLow: screw.x + r }] })).toBeNull();
  });
});

describe("one top screw in the way of another", () => {
  const tab = { xLow: 0, xHigh: 20, yLow: 0, yHigh: 20 };
  const lower = { screw: { x: 10, y: 10, postBottom: 10 }, tab };

  it("counts its tab", () => expect(blocksTopDriver(lower, { x: 15, y: 15, postBottom: 30 })).toBe(true));
  it("counts its post, past the edge of its tab", () => {
    expect(blocksTopDriver({ ...lower, tab: { xLow: 8, xHigh: 12, yLow: 8, yHigh: 12 } }, { x: 10, y: 16, postBottom: 30 })).toBe(true);
  });
  it("needs the driver's width to clear", () => {
    expect(blocksTopDriver(lower, { x: 20 + r + 0.01, y: 10, postBottom: 30 })).toBe(false);
    expect(blocksTopDriver(lower, { x: 20 + r - 0.01, y: 10, postBottom: 30 })).toBe(true);
  });
  it("only counts one lower down", () => {
    expect(blocksTopDriver(lower, { x: 15, y: 15, postBottom: 10 })).toBe(false);
    expect(blocksTopDriver(lower, { x: 15, y: 15, postBottom: 5 })).toBe(false);
  });
});

describe("placing plate screws", () => {
  it("rejects an added boss on a top screw's path, with the reason", () => {
    const screw = plan(capped()).topScrews.find((s) => s.wall === "left")!;
    const config = capped({ plate: { fasteners: { add: [{ x: 6.55, y: screw.y + 3 }] } } });
    expect(errors(config)[0]?.message).toContain("top screw");
  });

  it("rejects a listed one too", () => {
    const screw = plan(capped()).topScrews.find((s) => s.wall === "left")!;
    const listed = [{ x: 6.55, y: screw.y }, { x: 120, y: 6.55 }, { x: 233, y: 6.55 }, { x: 120, y: 143 }];
    expect(errors(capped({ plate: { screws: listed } }))[0]?.message).toContain("top screw");
  });

  it("rejects one on a seam bolt's path, with the reason", () => {
    const seamed = box({ seams: [{ x: 120 }] });
    const [y, z] = plan(seamed).seams[0]!.bolts.find(([, boltZ]) => boltZ! < 30)!;
    expect(z! - r).toBeLessThan(40);
    seamed.plate = { fasteners: { add: [{ x: 90, y }] } };
    expect(errors(seamed).find((e) => e.path === "plate.fasteners.add[0]")?.message).toContain("seam bolt");
  });
});

describe("seam bolts", () => {
  it("need room for a driver in the left half", () => {
    const left = (x: number) => errors(box({ seams: [{ x }] }, { width: 300 })).find((e) => e.path === "seams[0].x")?.message;
    expect(left(60)).toContain("stubby");
    expect(left(100)).toBeUndefined();
  });

  it("can't have a rail's screw block on their path", () => {
    const config = box(
      { seams: [{ x: 120 }], opening: { xMin: 140, xMax: 230, yEnd: 50, sill: 8, rail: { depth: 14, screwX: [100, 235] } } },
    );
    const problem = errors(config).find((e) => e.code === "SEAM_INVALID");
    expect(problem?.message ?? "").toContain("rail");
  });
});

describe("the assembly order", () => {
  it("starts with the seam and ends with the rail on the Desk Synth", () => {
    const steps = plan(deskSynth()).assembly;
    expect(steps[0]).toContain("inserts");
    expect(steps[1]).toContain("shell halves");
    expect(steps.at(-1)).toContain("rail");
    const at = (word: string) => steps.findIndex((step) => step.includes(word));
    expect(at("shell halves")).toBeLessThan(at("top pieces from below"));
    expect(at("top pieces from below")).toBeLessThan(at("plate from below"));
    expect(at("boards")).toBeLessThan(at("plate from below"));
    expect(at("screen")).toBeLessThan(at("top pieces from below"));
  });

  it("gives the shaft a top screw needs", () => {
    const built = plan(deskSynth());
    const highest = Math.max(...built.topScrews.map(underside));
    const step = built.assembly.find((s) => s.includes("top pieces from below"))!;
    const shaft = Number(/at least (\d+)/.exec(step)![1]);
    expect(shaft).toBeGreaterThanOrEqual(highest);
    expect(shaft).toBeLessThan(highest + 5);
  });

  it("only lists what the design has", () => {
    expect(plan(box()).assembly.join()).not.toContain("shell halves");
    expect(plan(box()).assembly.join()).not.toContain("top pieces");
    expect(plan(box()).assembly.join()).not.toContain("rail");
    expect(plan(box()).assembly.join()).toContain("plate from below");
  });
});
