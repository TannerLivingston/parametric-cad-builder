import { describe, expect, it } from "vitest";
import { validateConfig } from "../src/index.js";
import { BOSS_DIAMETER } from "../src/plate.js";
import { blank, deckAndPanel, errorCodes, errors, deskSynth } from "./helpers.js";

function plan(config: unknown) {
  const result = validateConfig(config);
  if (!result.ok) throw new Error(JSON.stringify(result.errors, null, 1));
  return result.plan;
}

// One listed screw at the position being tested, plus enough good ones to be valid.
const withScrew = (config: any, x: number, y: number) => {
  config.plate = { screws: [{ x: 20, y: 170 }, { x: 80, y: 170 }, { x: 240, y: 170 }, { x: 280, y: 170 }, { x: 280, y: 100 }, { x, y }] };
  return config;
};
const screwProblem = (config: any) => errors(config).find((e) => e.code === "PLATE_INVALID")?.message;

describe("planning the plate", () => {
  it("splits it only when the bed can't take it whole", () => {
    expect(plan(deskSynth()).plate?.jointX).not.toBeNull();
    const big = blank({ fabrication: { buildVolume: { x: 400, y: 400, z: 256 } } });
    expect(plan(big).plate?.jointX).toBeNull();
    expect(plan(big).printedParts.filter((p) => p.kind === "plate").map((p) => p.name)).toEqual(["Plate"]);
  });

  it("keeps the joint away from the shell's seam, and every piece on the bed", () => {
    const { plate, seams, printedParts } = plan(deskSynth());
    expect(Math.abs(plate!.jointX! - seams[0]!.x)).toBeGreaterThan(30);
    for (const part of printedParts.filter((p) => p.kind === "plate")) {
      expect(Math.max(part.size[0], part.size[1])).toBeLessThanOrEqual(256);
    }
  });

  it("sizes the plate to fit inside the walls with clearance", () => {
    const config = blank({ fabrication: { buildVolume: { x: 400, y: 400, z: 256 } }, plate: { clearance: 0.5 } });
    const part = plan(config).printedParts.find((p) => p.kind === "plate")!;
    expect(part.size[0]).toBeCloseTo(304.8 - 2 * 3.5);
    expect(part.size[1]).toBeCloseTo(190.5 - 2 * 3.5);
    expect(part.size[2]).toBe(3);
  });

  it("reports a plate piece too big for the bed", () => {
    const config = blank({ plate: { seamX: 280 } });
    expect(errors(config).find((e) => e.code === "PART_TOO_LARGE")?.message).toContain("Plate 1");
  });

  it.each([400, 450, 480])("comes closer to the seam when a %i mm plate needs it to fit", (width) => {
    const { plate, seams, printedParts } = plan(blank({ enclosure: { width, frontHeight: 40, surfaces: [{ id: "top", y: 100, z: 40 }] }, seams: [{ x: width / 2 }] }));
    expect(Math.abs(plate!.jointX! - seams[0]!.x)).toBeGreaterThanOrEqual(15);
    for (const part of printedParts.filter((p) => p.kind === "plate")) expect(part.size[0]).toBeLessThanOrEqual(256);
  });

  it("rejects a joint too near the edge", () => {
    expect(errors(blank({ plate: { seamX: 10 } })).map((e) => e.code)).toContain("PLATE_INVALID");
  });

  it("leaves out the plate, its screws and its hardware when turned off", () => {
    const result = plan(blank({ plate: { enabled: false } }));
    expect(result.plate).toBeNull();
    expect(result.printedParts.every((p) => p.kind === "shell")).toBe(true);
    expect(result.hardware.map((h) => h.name).join()).not.toContain("M3 x 8");
  });

  it("lets the rib reach the base when there's no plate to make room for", () => {
    const low = (enabled: boolean) => plan(blank({ plate: { enabled } })).seams[0]!.bolts[0]![1];
    expect(low(false)).toBe(6);
    expect(low(true)).toBe(6.5);
  });
});

describe("placing screws automatically", () => {
  it("covers all four sides of an enclosure with no opening", () => {
    const { plate, profile, config } = plan(blank());
    const { width } = config.enclosure;
    const near = (value: number, target: number) => Math.abs(value - target) < 25;
    const { screws } = plate!;
    expect(screws.some(([x, y]) => near(x, 0) && near(y, 0))).toBe(true);
    expect(screws.some(([x, y]) => near(x, width) && near(y, 0))).toBe(true);
    expect(screws.some(([x, y]) => near(x, 0) && near(y, profile.depth))).toBe(true);
    expect(screws.some(([x, y]) => near(x, width) && near(y, profile.depth))).toBe(true);
  });

  it("keeps the real Desk Synth's screw count, and stays out of the opening", () => {
    const { plate, config } = plan(deskSynth());
    const { opening } = config;
    expect(plate!.screws.length).toBeGreaterThanOrEqual(8);
    for (const [x, y] of plate!.screws) expect(x > opening!.xMin && x < opening!.xMax && y < opening!.yEnd).toBe(false);
  });

  it("holds down both sides of the plate's joint", () => {
    const { plate } = plan(deskSynth());
    const joint = plate!.jointX!;
    expect(plate!.screws.some(([x]) => x < joint && joint - x < 25)).toBe(true);
    expect(plate!.screws.some(([x]) => x > joint && x - joint < 25)).toBe(true);
  });

  it("uses a closer spacing when asked", () => {
    const count = (screwSpacing: number) => plan(blank({ plate: { screwSpacing } })).plate!.screws.length;
    expect(count(50)).toBeGreaterThan(count(150));
  });

  it("moves screws out of the way of a part, and gives the same answer each time", () => {
    const empty = plan(deckAndPanel());
    const crowded = deckAndPanel({ components: [{ id: "a", type: "rp2040-plus", x: 34, y: 18 }] });
    const screws = plan(crowded).plate!.screws;
    expect(screws).not.toEqual(empty.plate!.screws);
    const r = BOSS_DIAMETER / 2;
    for (const [x, y] of screws) {
      const clearX = Math.abs(x - 34) - 25.5 - r;
      const clearY = Math.abs(y - 18) - 10.5 - r;
      expect(Math.max(clearX, clearY)).toBeGreaterThanOrEqual(1);
    }
    expect(plan(crowded).plate!.screws).toEqual(screws);
  });

  it("explains when parts block too many spots", () => {
    const tiny = blank({ seams: [], enclosure: { width: 120, frontHeight: 40, surfaces: [{ id: "a", y: 120, z: 40 }] } });
    tiny.plate = { screws: [{ x: 20, y: 20 }] };
    expect(errors(tiny).find((e) => e.code === "PLATE_INVALID")?.message).toContain("only has 1 screw");
  });
});

describe("listed screw positions", () => {
  it("accepts a clear spot", () => {
    expect(errorCodes(withScrew(deckAndPanel(), 20, 20))).toEqual([]);
  });

  it("rejects a spot past the plate's edge", () => {
    expect(screwProblem(withScrew(deckAndPanel(), 5, 100))).toContain("edge of the plate");
  });

  it("rejects a spot in a rounded corner", () => {
    const config = deckAndPanel();
    config.enclosure.cornerRadius = 16;
    expect(screwProblem(withScrew(config, 8, 8))).toContain("edge of the plate");
  });

  it("rejects a spot on the plate's joint", () => {
    const config = withScrew(deckAndPanel(), 100, 170);
    config.plate.seamX = 100;
    expect(screwProblem(config)).toContain("edge of the plate");
  });

  it("rejects a spot in the seam rib", () => {
    expect(screwProblem(withScrew(deckAndPanel(), 150, 100))).toContain("seam");
  });

  it("rejects a spot under a board", () => {
    const config = withScrew(deckAndPanel({ components: [{ id: "a", type: "rp2040-plus", x: 50, y: 100 }] }), 50, 100);
    expect(screwProblem(config)).toContain("board");
  });

  it("rejects a spot where it would show through a cutout", () => {
    const opening = { name: "Opening", source: "measured", mount: "panel",
      cutouts: [{ kind: "rect", width: 40, height: 40 }],
      above: { footprint: { shape: "rect", width: 40, height: 40 }, height: 0 },
      below: { footprint: { shape: "rect", width: 40, height: 40 }, depth: 0 } };
    const config = withScrew(deckAndPanel({ customParts: { opening }, components: [{ id: "a", type: "opening", surface: "deck", u: 60, v: 40 }] }), 60, 40);
    expect(screwProblem(config)).toContain("show through");
  });

  it("rejects a spot under a part's body, allowing for the tilt", () => {
    const deep = { name: "Deep", source: "measured", mount: "panel",
      cutouts: [{ kind: "circle", diameter: 8 }],
      above: { footprint: { shape: "circle", diameter: 8 }, height: 0 },
      below: { footprint: { shape: "circle", diameter: 20 }, depth: 15 } };
    const config = (y: number) => withScrew(deckAndPanel({ customParts: { deep }, components: [{ id: "a", type: "deep", surface: "panel", u: 60, v: 26 }] }), 60, y);
    // The body hangs at an angle, so its footprint on the floor sits further back.
    expect(screwProblem(config(115))).toContain("body");
    expect(screwProblem(config(170 - 25))).toBeUndefined();
  });

  it("rejects a spot with no height for an insert", () => {
    const low = deckAndPanel({ seams: [], fabrication: { buildVolume: { x: 400, y: 400, z: 256 } }, enclosure: { width: 300, frontHeight: 12, surfaces: [{ id: "a", y: 190, z: 12 }] } });
    expect(screwProblem(withScrew(low, 60, 60))).toContain("height");
  });
});

describe("recesses and screw posts", () => {
  const screen = (overrides: { recess?: object; posts?: object[] } = {}) => ({
    name: "Screen", source: "measured", mount: "panel",
    cutouts: [{ kind: "rect", width: 30, height: 20, recess: { width: 40, height: 30, skin: 1.5 }, ...(overrides.recess ? { recess: overrides.recess } : {}) }],
    posts: overrides.posts ?? [{ at: [-18.5, -13.5], diameter: 4, reach: 4, holeDiameter: 1.7, holeDepth: 3 }],
    above: { footprint: { shape: "rect", width: 30, height: 20 }, height: 0 },
    below: { footprint: { shape: "rect", width: 44, height: 34 }, depth: 5 },
  });
  const placed = (part: object, u = 70, v = 40) => deckAndPanel({ customParts: { screen: part }, components: [{ id: "a", type: "screen", surface: "deck", u, v }] });

  it("plans the recess and posts", () => {
    const result = plan(placed(screen()));
    expect(result.cutouts[0]?.recess).toMatchObject({ u: 70, v: 40, width: 40, height: 30, skin: 1.5 });
    expect(result.posts[0]).toMatchObject({ u: 51.5, v: 26.5, printedPart: 0 });
    expect(result.hardware.find((h) => h.name.includes("M2"))?.count).toBe(1);
  });

  it("turns the recess and posts with the part", () => {
    const config = placed(screen());
    config.components[0].rotationDeg = 90;
    const result = plan(config);
    expect(result.cutouts[0]?.recess).toMatchObject({ width: 30, height: 40 });
    expect(result.posts[0]).toMatchObject({ u: 83.5, v: 21.5 });
  });

  it("uses the recess, not just the window, for spacing and edges", () => {
    const neighbour = placed(screen());
    neighbour.components.push({ id: "b", type: "ttp223", surface: "deck", u: 70 + 20 + 8 + 0.5, v: 40 });
    expect(errorCodes(neighbour)).toContain("CUTOUTS_TOO_CLOSE");
    // The window alone would stop 5 mm short of the crease, but the recess gets too close.
    expect(errorCodes(placed(screen(), 70, 80 - 15 - 1))).toContain("CUTOUT_OUTSIDE_SURFACE");
  });

  it("rejects a recess that doesn't surround its window", () => {
    expect(errorCodes(placed(screen({ recess: { width: 25, height: 30, skin: 1.5 } })))).toContain("GEOMETRY_IMPOSSIBLE");
  });

  it("rejects a recess with too thin a skin, or none left", () => {
    expect(errorCodes(placed(screen({ recess: { width: 40, height: 30, skin: 0.2 } })))).toContain("SKIN_INVALID");
    expect(errorCodes(placed(screen({ recess: { width: 40, height: 30, skin: 3 } })))).toContain("SKIN_INVALID");
  });

  it("rejects a screw hole that would poke through the face", () => {
    const part = screen({ posts: [{ at: [-18.5, -13.5], diameter: 4, reach: 4, holeDiameter: 1.7, holeDepth: 3.8 }] });
    expect(errorCodes(placed(part))).toContain("SKIN_INVALID");
  });

  it("rejects a post blocking the window", () => {
    const part = screen({ posts: [{ at: [0, 0], diameter: 4, reach: 4, holeDiameter: 1.7, holeDepth: 3 }] });
    expect(errors(placed(part)).find((e) => e.code === "BODIES_COLLIDE")?.message).toContain("screw post");
  });

  it("rejects a post whose hole is wider than it is", () => {
    const part = screen({ posts: [{ at: [-18.5, -13.5], diameter: 2, reach: 4, holeDiameter: 2, holeDepth: 3 }] });
    expect(errorCodes(placed(part))).toContain("GEOMETRY_IMPOSSIBLE");
  });
});

describe("the hardware list", () => {
  it("counts what the Desk Synth needs", () => {
    const { hardware, plate, seams } = plan(deskSynth());
    const count = (text: string) => hardware.find((h) => h.name.includes(text))?.count;
    expect(hardware.find((h) => h.name === "M3 brass heat-set insert")?.count).toBe(plate!.screws.length);
    expect(hardware.find((h) => h.name === "M3 x 8 flat-head screw")?.count).toBe(plate!.screws.length);
    expect(count("for the top panels")).toBeGreaterThan(0);
    expect(count("for the rail")).toBe(2);
    expect(count("through the plate")).toBe(2);
    expect(count("insert, for the seam")).toBe(seams[0]!.bolts.length);
    expect(count("flat-head screw, for the seam")).toBe(seams[0]!.bolts.length);
    expect(count("M2")).toBe(4);
  });
});
