// Rounds on the side profile: what they need, what they rule out, and what gets built.
import { beforeAll, describe, expect, it } from "vitest";
import { makeBox, makeCylinder, measureVolume, type Shape3D } from "replicad";
import { bossProblem, bossSlope } from "../src/plate.js";
import { chainHeight, highestFloor } from "../src/profile.js";
import { plateInput } from "../src/validate.js";
import { buildEnclosure, initEngine, validateConfig, type BuildPlan } from "../src/index.js";
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

// One piece, 220 wide and 190 deep, rising from 40 to 66 and down to 55, with walls of 3.
const rounded = (rounds: object, extra: Record<string, unknown> = {}): any => {
  const config = deckAndPanel({ seams: [], ...extra });
  config.enclosure.width = 220;
  config.enclosure.wall = 3;
  config.enclosure.cornerRadius = 6;
  config.enclosure.rounds = rounds;
  return config;
};

const message = (config: unknown, code: string) => errors(config).find((e) => e.code === code)?.message;

describe("what a round needs", () => {
  it("accepts rounds that fit", () => expect(validateConfig(rounded({ frontBottom: 12, rearTop: 15, rearBottom: 15 })).ok).toBe(true));
  it("has to be well past the wall", () => expect(message(rounded({ frontBottom: 4 }), "GEOMETRY_IMPOSSIBLE")).toContain("past the"));
  it("has to fit on the front wall", () => expect(message(rounded({ frontBottom: 45 }), "GEOMETRY_IMPOSSIBLE")).toContain("taller than"));
  it("has to leave a flat base", () => expect(message(rounded({ frontBottom: 38, rearBottom: 115 }), "GEOMETRY_IMPOSSIBLE")).toContain("flat base"));
  it("has to fit on its surface", () => expect(message(rounded({ rearTop: 90 }), "GEOMETRY_IMPOSSIBLE")).toContain('surface "back"'));
  it("has to fit on the rear wall with the one below it", () => expect(message(rounded({ rearTop: 40, rearBottom: 30 }), "GEOMETRY_IMPOSSIBLE")).toContain("of wall"));
  it("can't share a surface with a separate top panel", () => {
    expect(message(rounded({ rearTop: 12 }, { topPanels: [{ surface: "back" }] }), "TOP_PANEL_INVALID")).toContain("ends in a round");
    expect(validateConfig(rounded({ rearTop: 12 }, { topPanels: [{ surface: "deck" }] })).ok).toBe(true);
  });
  it("can't be used with a top edge fillet yet", () => {
    const config = rounded({ rearTop: 12 });
    config.enclosure.surfaces = [{ id: "top", y: 150, z: 40 }];
    config.enclosure.topEdgeFillet = 1;
    expect(message(config, "GEOMETRY_IMPOSSIBLE")).toContain("fillet");
  });
  it("needs a rail to reach past it", () => {
    const opening = { xMin: 100, xMax: 200, yEnd: 60, sill: 7, rail: { depth: 10, screwX: [92, 208] } };
    expect(message(rounded({ frontBottom: 12 }, { opening }), "OPENING_INVALID")).toContain("past the");
  });
});

describe("what the curves rule out", () => {
  const button = (over: object) => ({ id: "b", type: "ttp223", surface: "back", u: 100, v: 30, ...over });
  const board = (over: object) => ({ id: "adc", type: "ads7830", x: 100, y: 100, ...over });

  it("keeps a cutout off the part of a surface a round takes", () => {
    const near = rounded({}, { components: [button({ v: 52 })] });
    expect(validateConfig(near).ok).toBe(true);
    near.enclosure.rounds = { rearTop: 25 };
    expect(message(near, "CUTOUT_OUTSIDE_SURFACE")).toContain('"b"');
  });

  it("keeps a board on the flat base", () => {
    const front = rounded({ frontBottom: 20 }, { components: [board({ y: 21.3 })] });
    expect(errors(front).map((e) => e.code)).toContain("BODY_HITS_ENCLOSURE");
    expect(validateConfig(rounded({ frontBottom: 20 }, { components: [board({ y: 41.3 })] })).ok).toBe(true);
    const rear = rounded({ rearBottom: 20 }, { components: [board({ y: 165 })] });
    expect(errors(rear).map((e) => e.code)).toContain("BODY_HITS_ENCLOSURE");
  });

  it("keeps a part's body inside the top round", () => {
    const deep = { name: "Deep", source: "measured", mount: "panel", cutouts: [{ kind: "circle", diameter: 8 }], above: { footprint: { shape: "circle", diameter: 8 }, height: 0 }, below: { footprint: { shape: "circle", diameter: 24 }, depth: 30 } };
    const at = { id: "d", type: "deep", surface: "back", u: 100, v: 40 };
    expect(validateConfig(rounded({}, { customParts: { deep }, components: [at] })).ok).toBe(true);
    expect(errors(rounded({ rearTop: 20 }, { customParts: { deep }, components: [at] })).map((e) => e.code)).toContain("BODY_HITS_ENCLOSURE");
  });

  it("keeps wall holes off a bottom round, on every wall", () => {
    const hole = (over: object) => ({ wall: "front", at: 100, z: 12, width: 12, height: 6, ...over });
    expect(validateConfig(rounded({ frontBottom: 8 }, { wallHoles: [hole({})] })).ok).toBe(true);
    expect(message(rounded({ frontBottom: 12 }, { wallHoles: [hole({})] }), "WALL_HOLE_INVALID")).toContain("bottom round");
    expect(message(rounded({ rearBottom: 12 }, { wallHoles: [hole({ wall: "rear" })] }), "WALL_HOLE_INVALID")).toContain("bottom round");
    expect(message(rounded({ frontBottom: 25 }, { wallHoles: [hole({ wall: "left", at: 14 })] }), "WALL_HOLE_INVALID")).toContain("bottom round");
  });

  it("keeps a wall hole under a top round", () => {
    const hole = { wall: "rear", at: 100, z: 45, width: 12, height: 6 };
    expect(validateConfig(rounded({}, { wallHoles: [hole] })).ok).toBe(true);
    expect(message(rounded({ rearTop: 25 }, { wallHoles: [hole] }), "WALL_HOLE_INVALID")).toContain("wall under the top");
  });

  it("moves plate screws onto what's left of the plate", () => {
    const { plate, profile } = plan(rounded({ frontBottom: 20, rearBottom: 20 }));
    expect(profile.plateFront).toBe(20);
    expect(profile.plateRear).toBe(170);
    for (const [, y] of plate!.screws) {
      expect(y).toBeGreaterThanOrEqual(20 + 3.3);
      expect(y).toBeLessThanOrEqual(170 - 3.3);
    }
  });

  it("keeps a top screw's tab above a bottom round", () => {
    const capped = plan(rounded({ frontBottom: 25 }, { topPanels: [{ surface: "deck" }] }));
    for (const screw of capped.topScrews) expect(screw.postBottom - 3.2).toBeGreaterThanOrEqual(highestFloor(capped.profile.lower, screw.y - 6, screw.y + 6) + 1 - 8);
    expect(capped.topScrews.filter((s) => s.wall === "front")).toEqual([]);
  });

  it("makes the plate shorter by what the rounds take", () => {
    const { printedParts } = plan(rounded({ frontBottom: 20, rearBottom: 20 }));
    expect(printedParts.find((p) => p.kind === "plate")!.size[1]).toBeCloseTo(150 - 2 * 0.25);
  });
});

describe("what a boss is allowed near, with rounds about", () => {
  const { profile } = plan(rounded({ frontBottom: 15, rearBottom: 15 }));
  const input = plateInput(plan(rounded({ frontBottom: 15, rearBottom: 15 })).config, profile);
  const none = { ribs: [], jointX: null, onSide: true, capped: [], posts: [], plateNotch: null, floorParts: [], cutouts: [], keepOut: [], bodies: [], minWeb: 1.2, partClearance: 1 };
  const front = profile.plateFront + 0.25 + 3.4;
  const rear = profile.plateRear - 0.25 - 3.4;

  it("keeps a listed screw on the plate, away from a round", () => {
    expect(bossProblem(input, profile, none, 100, front)).toBeNull();
    expect(bossProblem(input, profile, none, 100, front - 1)).toContain("edge of the plate");
    expect(bossProblem(input, profile, none, 100, rear)).toBeNull();
    expect(bossProblem(input, profile, none, 100, rear + 1)).toContain("edge of the plate");
  });

  it("stops a slope where it meets the round, not at the wall behind it", () => {
    expect(input.slopeFront).toBeGreaterThan(3);
    const wide = plateInput(plan(rounded({})).config, plan(rounded({})).profile);
    expect(wide.slopeFront).toBeUndefined();
    const big = plan(rounded({ rearBottom: 25 }));
    const limited = plateInput(big.config, big.profile);
    const [wallPoint] = bossSlope(limited, 100, big.profile.plateRear - 4)!;
    expect(wallPoint![1]).toBeLessThan(big.profile.depth - 3);
    expect(wallPoint![1]).toBeCloseTo(limited.slopeRear!);
  });

  it("only widens a boss near the wall, so a board further in can sit close beside it", () => {
    // Beside the boss's circle, but further from the wall than its slope reaches.
    const beside = { kind: "rect" as const, cx: 100 + 4 + 1.5 + 10, cy: front + 10, w: 20, h: 16 };
    expect(bossProblem(input, profile, { ...none, floorParts: [beside] }, 100, front)).toBeNull();
    // The same board level with the slope does count.
    const level = { ...beside, cy: 3 + 8, h: 8 };
    expect(bossProblem(input, profile, { ...none, floorParts: [level] }, 100, front)).toContain("board");
  });

  it("only keeps it off a seam's tabs where they really are", () => {
    const far = { yLow: 150, yHigh: 158, zLow: 3 };
    // Near enough along x that its slope would reach a tab at the wall, but this one's elsewhere.
    expect(bossProblem(input, profile, { ...none, ribs: [{ x: 130, half: 13, tabs: [far] }] }, 100, front)).toBeNull();
    const here = { yLow: 3, yHigh: 11, zLow: 3 };
    expect(bossProblem(input, profile, { ...none, ribs: [{ x: 130, half: 13, tabs: [here] }] }, 100, front)).toContain("rib");
  });

  it("still won't let a slope cross the seam itself, wherever the tabs are", () => {
    const far = { yLow: 150, yHigh: 158, zLow: 3 };
    expect(bossProblem(input, profile, { ...none, ribs: [{ x: 108, half: 1, tabs: [far] }] }, 100, front)).toContain("rib");
  });
});

describe("the seam around rounds", () => {
  const seamed = (rounds: object) => {
    const config = deckAndPanel();
    config.enclosure.rounds = rounds;
    return plan(config);
  };

  it("moves a tab in from a wall that's all round", () => {
    const { seams, profile } = seamed({ rearTop: 25, rearBottom: 25 });
    const tab = seams[0]!.tabs.find((t) => t.surface === null && t.start[0] > 100)!;
    expect(tab.start[0]).toBeLessThan(profile.depth - 3);
    for (const [y, z] of seams[0]!.bolts.filter(([y]) => y > 120)) {
      expect(z).toBeGreaterThan(chainHeight(profile.lower, y));
      expect(z).toBeLessThan(chainHeight(profile.inner, y));
    }
  });

  it("finds room for two bolts when it can", () => {
    const { seams } = seamed({ rearTop: 25, rearBottom: 25 });
    expect(seams[0]!.bolts.filter(([y]) => y > 150).length).toBe(2);
    expect(seams[0]!.pins.filter(([y]) => y > 150).length).toBe(1);
  });

  it("hangs no tab from the part of a surface a round takes", () => {
    const { seams, profile } = seamed({ rearTop: 30 });
    const limit = profile.depth - profile.rearTangent;
    for (const tab of seams[0]!.tabs.filter((t) => t.surface === "back")) expect(Math.max(tab.start[0], tab.end[0])).toBeLessThanOrEqual(limit);
  });
});

describe("what gets built", () => {
  beforeAll(async () => {
    await initEngine();
  });

  const shell = (config: unknown) => buildEnclosure(plan(config)).parts.find((p) => p.kind === "shell")!.shape;
  const probe = (y: number, z: number) => makeBox([100, y - 0.05, z - 0.05], [101, y + 0.05, z + 0.05]) as unknown as Shape3D;
  const solid = (part: Shape3D, y: number, z: number) => overlap(part, probe(y, z)) / measureVolume(probe(y, z));

  it("follows a round on the outside and the inside, keeping the wall", () => {
    const part = shell(rounded({ frontBottom: 15, rearTop: 20, rearBottom: 20 }));
    const h = Math.SQRT1_2;
    // Front: centre (15, 15). Outside the curve, in the wall, and inside the space.
    expect(solid(part, 15 - 15.5 * h, 15 - 15.5 * h)).toBe(0);
    expect(solid(part, 15 - 13.5 * h, 15 - 13.5 * h)).toBeCloseTo(1);
    expect(solid(part, 15 - 11.5 * h, 15 - 11.5 * h)).toBe(0);
    // Rear bottom: centre (170, 20).
    expect(solid(part, 170 + 20.5 * h, 20 - 20.5 * h)).toBe(0);
    expect(solid(part, 170 + 18.5 * h, 20 - 18.5 * h)).toBeCloseTo(1);
    expect(solid(part, 170 + 16.5 * h, 20 - 16.5 * h)).toBe(0);
  });

  it("is truly curved, rather than many flat faces", async () => {
    const part = shell(rounded({ frontBottom: 15, rearTop: 20, rearBottom: 20 }));
    const step = await part.blobSTEP().text();
    const cylinders = step.match(/CYLINDRICAL_SURFACE\([^;]*,\s*([\d.E+-]+)\s*\)/g) ?? [];
    for (const radius of ["15.", "20.", "12.", "17."]) expect(cylinders.some((c) => c.includes(`,${radius}`) || c.includes(`, ${radius}`)), `R${radius}`).toBe(true);
  });

  it("leaves the plate flush with the base, inside a lip", () => {
    const buildPlan = plan(rounded({ frontBottom: 15, rearBottom: 20 }));
    const { parts } = buildEnclosure(buildPlan);
    const { profile } = buildPlan;
    const plate = parts.find((p) => p.kind === "plate")!.shape;
    const body = parts.find((p) => p.kind === "shell")!.shape;
    const edge = profile.plateFront + 0.25;
    expect(solid(plate, edge + 0.2, 0.2)).toBeCloseTo(1);
    expect(solid(plate, edge - 0.2, 0.2)).toBe(0);
    expect(overlap(plate, body)).toBeLessThan(0.01);
  });

  it("gives a rear round's boss a slope that meets the wall", () => {
    const buildPlan = plan(rounded({ rearBottom: 25 }, { seams: [{ x: 110 }] }));
    const part = buildEnclosure(buildPlan).parts.filter((p) => p.kind === "shell").map((p) => p.shape);
    const screw = buildPlan.plate!.screws.find(([, y]) => y > 150)!;
    // Between the boss and the round, right behind it.
    const bridge = makeBox([screw[0] - 1, screw[1] + 5, 6], [screw[0] + 1, screw[1] + 8, 8]) as unknown as Shape3D;
    expect(part.reduce((sum, s) => sum + overlap(s, bridge), 0) / measureVolume(bridge)).toBeGreaterThan(0.99);
    expect(part.reduce((sum, s) => sum + overlap(s, makeCylinder(1.8, 5, [screw[0], screw[1], 3.5], [0, 0, 1])), 0)).toBeLessThan(0.01);
  });

  it("trims the rail to the round, feet too", () => {
    const buildPlan = plan(deskSynth());
    const rail = buildEnclosure(buildPlan).parts.find((p) => p.kind === "rail")!;
    const [left] = buildPlan.config.opening!.rail!.screwX;
    // Under the curve, at the foot's front end, is outside the enclosure.
    const below = makeBox([left - 2, 3.6, 0.1], [left + 2, 4.4, 1]) as unknown as Shape3D;
    expect(overlap(rail.shape, below)).toBeLessThan(0.001);
    const planned = buildPlan.printedParts.find((p) => p.kind === "rail")!.size;
    const { bounds } = rail.shape.boundingBox;
    expect(planned[1]).toBeCloseTo(bounds[1][1] - bounds[0][1], 1);
    expect(planned[1]).toBeLessThan(buildPlan.config.opening!.rail!.depth);
  });

  it("matches the real Desk Synth's outline", () => {
    const { parts } = buildEnclosure(plan(deskSynth()));
    const pieces = parts.filter((p) => p.name === "Shell 1" || p.name === "Deck 1" || p.name === "Panel 1").map((p) => p.shape);
    const edge = (rear: boolean, z: number) => {
      const slab = (y0: number, y1: number) => makeBox([139.9, y0, z - 0.01], [140.1, y1, z + 0.01]) as unknown as Shape3D;
      let low = rear ? 170 : -1;
      let high = rear ? 197 : 15;
      for (let i = 0; i < 12; i++) {
        const middle = (low + high) / 2;
        const hit = pieces.some((piece) => overlap(piece, rear ? slab(middle, 197) : slab(-1, middle)) > 1e-6);
        if (hit === rear) low = middle;
        else high = middle;
      }
      return (low + high) / 2;
    };
    // Measured from the real shell's mesh, in this project's coordinates.
    for (const [z, y] of [[2, 183.16], [10, 192.6], [20, 196.32], [30, 195.22], [40, 188.32]] as const) expect(edge(true, z), `rear at z ${z}`).toBeCloseTo(y, 0);
    for (const [z, y] of [[1, 7.2], [3, 4.06], [5, 2.28], [8, 0.7]] as const) expect(edge(false, z), `front at z ${z}`).toBeCloseTo(y, 0);
  });
});

describe("a wall tab that a round moved in", () => {
  it("keeps a surface tab and its bolt off it", () => {
    const built = plan({
      schemaVersion: 1,
      name: "falls to the rear",
      enclosure: { width: 200, frontHeight: 40, surfaces: [{ id: "top", y: 100, z: 15 }], wall: 2.4, floorThickness: 1.6, panelThickness: 4, rounds: { rearTop: 12 } },
      seams: [{ x: 100 }],
    });
    const { bolts } = built.seams[0]!;
    expect(bolts.length).toBeGreaterThan(2);
    for (const [i, a] of bolts.entries()) {
      for (const b of bolts.slice(i + 1)) expect(Math.hypot(a[0] - b[0], a[1] - b[1])).toBeGreaterThan(7);
    }
  });
});
