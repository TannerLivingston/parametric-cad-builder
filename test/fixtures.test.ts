// Holes in walls and cradles on the plate, including the ones a board brings with it.
import { beforeAll, describe, expect, it } from "vitest";
import { makeBox, makeCylinder, measureVolume, type Shape3D } from "replicad";
import { analyseBinarySTL, isValidSolid } from "../src/checks.js";
import { BARB_HEIGHT, BARB_REACH, BARB_ROOM, CLIP_GAP } from "../src/fixtures.js";
import { partsToRecut, planKeys } from "../src/app/planDiff.js";
import { buildEnclosure, cutoutVolume, initEngine, validateConfig, type BuildPlan } from "../src/index.js";
import { standoffScrew } from "../src/validate.js";
import { deckAndPanel, errors, deskSynth } from "./helpers.js";

function plan(config: unknown): BuildPlan {
  const result = validateConfig(config);
  if (!result.ok) throw new Error(JSON.stringify(result.errors, null, 1));
  return result.plan;
}

type Point = [number, number, number];
type Box = [Point, Point];

const warnings = (config: unknown) => validateConfig(config).warnings;

const overlap = (a: Shape3D, b: Shape3D) => {
  try {
    return measureVolume(a.intersect(b));
  } catch (error) {
    if (String(error).includes("deleted")) throw error;
    return 0;
  }
};

// One piece, 220 wide and 190 deep, with walls of 3 and corners of 6.
const small = (extra: Record<string, unknown> = {}): any => {
  const config = deckAndPanel({ seams: [], ...extra });
  config.enclosure.width = 220;
  config.enclosure.wall = 3;
  config.enclosure.cornerRadius = 6;
  return config;
};

const hole = (over: object) => ({ wall: "left", at: 100, z: 15, width: 14, height: 8, cornerRadius: 2, ...over });
const holeError = (config: unknown) => errors(config).find((e) => e.code === "WALL_HOLE_INVALID")?.message;
const board = (over: object) => ({ id: "mcu", type: "rp2040-plus", x: 28.7, y: 100, ...over });

describe("what the validator rejects in a wall hole", () => {
  it("accepts one that's clear", () => expect(plan(small({ wallHoles: [hole({})] })).wallHoles).toHaveLength(1));
  it("keeps it off a corner", () => expect(holeError(small({ wallHoles: [hole({ at: 10 })] }))).toContain("corner"));
  it("keeps it off the far corner", () => expect(holeError(small({ wallHoles: [hole({ at: 180 })] }))).toContain("corner"));
  it("keeps it above the plate", () => expect(holeError(small({ wallHoles: [hole({ z: 5 })] }))).toContain("below the top"));
  it("keeps it below the top", () => expect(holeError(small({ wallHoles: [hole({ at: 40, z: 34 })] }))).toContain("wall under the top"));
  it("keeps it under the rear wall's own height", () => expect(holeError(small({ wallHoles: [hole({ wall: "rear", at: 100, z: 50 })] }))).toContain("wall under the top"));
  it("rejects corners too big for it", () => expect(holeError(small({ wallHoles: [hole({ cornerRadius: 5 })] }))).toContain("corners"));
  it("keeps two holes apart", () => expect(holeError(small({ wallHoles: [hole({}), hole({ at: 110 })] }))).toContain("too close"));
  it("allows two holes on different walls", () => expect(plan(small({ wallHoles: [hole({}), hole({ wall: "right" })] })).wallHoles).toHaveLength(2));

  it("keeps it off a seam", () => {
    const config = deckAndPanel({ wallHoles: [hole({ wall: "front", at: 150 })] });
    expect(holeError(config)).toContain("seam");
  });
  it("keeps it out of an opening, where there's no wall", () => {
    const config = deskSynth();
    config.wallHoles = [hole({ wall: "front", at: 250, z: 18 })];
    expect(holeError(config)).toContain("opening");
  });
  it("keeps it off a rail block", () => {
    const opening = { xMin: 100, xMax: 200, yEnd: 60, sill: 7, rail: { depth: 14, screwX: [92, 208] } };
    const config = small({ opening, wallHoles: [hole({ wall: "front", at: 75, z: 8.5, height: 5, cornerRadius: 0 })] });
    expect(holeError(config)).toContain("rail block");
  });
});

describe("what moves out of a wall hole's way", () => {
  const near = (config: any, y: number) => plan(config).plate!.screws.filter(([x, sy]) => x < 12 && Math.abs(sy - y) < 13);

  it("moves plate bosses off it", () => {
    const clear = small();
    const y = plan(clear).plate!.screws.find(([x, sy]) => x < 12 && sy > 40 && sy < 150)?.[1];
    expect(y).toBeDefined();
    expect(near(small({ wallHoles: [hole({ at: y })] }), y!)).toEqual([]);
  });

  it("moves top screw tabs off it", () => {
    const capped = () => small({ topPanels: [{ surface: "deck" }] });
    const screw = plan(capped()).topScrews.find((s) => s.wall === "left" && s.y > 25)!;
    const config = capped();
    config.wallHoles = [hole({ at: screw.y, z: screw.postBottom - 2 })];
    for (const moved of plan(config).topScrews.filter((s) => s.wall === "left")) expect(Math.abs(moved.y - screw.y)).toBeGreaterThan(5);
  });
});

describe("a board with a connector", () => {
  it("gets a hole in the wall its connector faces, centred on it", () => {
    const { wallHoles, config } = plan(small({ components: [board({})] }));
    expect(wallHoles).toEqual([expect.objectContaining({ wall: "left", at: 100, width: 14, height: 8.5, componentId: "mcu" })]);
    expect(wallHoles[0]!.z).toBeCloseTo(config.enclosure.floorThickness + 10.6);
  });

  it("moves the hole with the board", () => {
    expect(plan(small({ components: [board({ y: 120 })] })).wallHoles[0]!.at).toBe(120);
  });

  it("follows the board when it's rotated", () => {
    const facing = (over: object) => plan(small({ components: [board(over)] })).wallHoles[0];
    expect(facing({ rotationDeg: 180, x: 220 - 28.7 })).toMatchObject({ wall: "right", at: 100 });
    expect(facing({ rotationDeg: 90, x: 80, y: 28.7 })).toMatchObject({ wall: "front", at: 80 });
    expect(facing({ rotationDeg: 270, x: 80, y: 190 - 28.7 })).toMatchObject({ wall: "rear", at: 80 });
  });

  it("warns, and makes no hole, when the board is too far from the wall", () => {
    const config = small({ components: [board({ x: 60 })] });
    expect(plan(config).wallHoles).toEqual([]);
    expect(warnings(config).find((w) => w.code === "PORT_UNREACHED")?.message).toContain("left wall");
  });

  it("lets it touch that wall, but not go through it", () => {
    expect(plan(small({ components: [board({ x: 28.5 })] })).wallHoles).toHaveLength(1);
    expect(errors(small({ components: [board({ x: 28.4 })] })).map((e) => e.code)).toContain("BODY_HITS_ENCLOSURE");
  });

  it("reports a hole that can't go there, against the board", () => {
    const found = errors(small({ components: [board({ y: 14 })] })).find((e) => e.code === "WALL_HOLE_INVALID");
    expect(found?.message).toContain('"mcu"');
    expect(found?.componentIds).toEqual(["mcu"]);
  });
});

describe("a board's cradle", () => {
  const cradleError = (config: unknown) => errors(config).find((e) => e.code === "BOARD_HOLDER_INVALID")?.message;

  it("is made of pads, a stop and two pairs of clips", () => {
    const blocks = plan(small({ components: [board({})] })).holderBlocks;
    expect(blocks.map((b) => b.kind).sort()).toEqual(["clip", "clip", "clip", "clip", "pad", "pad", "pad", "stop"]);
  });

  it("leaves every pin hole clear on the RP2040-Plus", () => {
    // A Pico's pins: 20 a side at 2.54 pitch, in rows 17.78 apart, with holes about 1 across.
    const blocks = plan(small({ components: [board({ x: 100 })] })).holderBlocks;
    const pins = Array.from({ length: 20 }, (_, i) => -24.13 + 2.54 * i).flatMap((x) => [[100 + x, 100 - 8.89], [100 + x, 100 + 8.89]]);
    expect(pins).toHaveLength(40);
    // Pads are under the board, where a solder joint needs about 1 mm around its pin.
    for (const pad of blocks.filter((b) => b.kind === "pad")) {
      for (const [x, y] of pins) expect(Math.max(pad.xLow - x!, x! - pad.xHigh, pad.yLow - y!, y! - pad.yHigh), `pad at ${pad.xLow}, ${pad.yLow}`).toBeGreaterThan(1);
    }
    // A clip's barb only reaches over the board's edge, well short of the pin holes, which
    // start 1.1 from that edge.
    const overEdge = BARB_REACH - CLIP_GAP;
    expect(overEdge).toBeLessThan(1.1);
  });

  it("leaves the board's four corner mounting holes clear, in case of screws", () => {
    const blocks = plan(small({ components: [board({ x: 100 })] })).holderBlocks.filter((b) => b.kind === "pad");
    for (const [dx, dy] of [[-23.5, -5.7], [-23.5, 5.7], [23.5, -5.7], [23.5, 5.7]]) {
      for (const pad of blocks) expect(Math.max(pad.xLow - (100 + dx!), 100 + dx! - pad.xHigh, pad.yLow - (100 + dy!), 100 + dy! - pad.yHigh)).toBeGreaterThan(1);
    }
  });

  it("matches the real Desk Synth's clips, with the board where it is in that model", () => {
    const config = deskSynth();
    config.components.find((c: any) => c.id === "mcu").x = 28.6;
    config.enclosure.wall = 3;
    config.plate.seamX = 127;
    const clips = plan(config).holderBlocks.filter((b) => b.kind === "clip");
    const y = (value: number) => clips.some((c) => Math.abs(c.yLow - value) < 0.01);
    expect(y(106.2)).toBe(true);
    expect(y(129.2)).toBe(true);
    expect(clips.every((c) => Math.abs(c.top - 10.15) < 0.01)).toBe(true);
    // Measured from the printed plate. The barbs start 1.15 above the 8 mm pads, for a 1 mm board.
    expect(10.15 - BARB_HEIGHT).toBeCloseTo(9.15);
    expect(BARB_REACH).toBe(1);
    expect(plan(config).holderBlocks.find((b) => b.kind === "stop")!.top).toBeCloseTo(10);
    expect(clips.map((c) => c.xLow).sort((a, b) => a - b)[0]).toBeCloseTo(16);
  });

  it("turns with the board, and its clips still point at it", () => {
    const blocks = plan(small({ components: [board({ rotationDeg: 90, x: 80, y: 28.7 })] })).holderBlocks;
    for (const clip of blocks.filter((b) => b.kind === "clip")) {
      const [dx, dy] = clip.inward!;
      expect(dy === 0 || Object.is(dy, -0)).toBe(true);
      // Each clip sits beside the board along x, pointing back at its centre.
      expect(Math.sign(dx)).toBe(clip.xLow < 80 ? 1 : -1);
    }
  });

  it("is left out, with a warning, when the plate is off", () => {
    const config = small({ components: [board({})], plate: { enabled: false } });
    expect(plan(config).holderBlocks).toEqual([]);
    expect(warnings(config).map((w) => w.code)).toContain("BOARD_HOLDER_SKIPPED");
  });

  it("has to stay on the plate", () => {
    expect(cradleError(small({ components: [board({ rotationDeg: 90, x: 13.5, y: 100 })] }))).toContain("edge of the plate");
  });

  it("can't cross the plate's joint", () => {
    const config = small({ components: [board({})], plate: { seamX: 42 } });
    expect(cradleError(config)).toContain("joint");
  });

  it("stays clear of the plate's holes and pins", () => {
    expect(cradleError(small({ components: [board({})], plate: { countersunkHoles: [{ x: 19, y: 88 }] } }))).toContain("hole");
    expect(cradleError(small({ components: [board({})], plate: { pins: [{ x: 19, y: 88, diameter: 3, height: 4 }] } }))).toContain("pin");
  });

  it("stays clear of other boards, and says so once", () => {
    const other = { id: "adc", type: "ads7830", x: 30, y: 121 };
    const found = errors(small({ components: [board({}), other] })).filter((e) => e.code === "BOARD_HOLDER_INVALID");
    expect(found[0]?.message).toContain('"adc"');
    expect(new Set(found.map((e) => e.message)).size).toBe(found.length);
  });

  it("stays clear of another board's cradle", () => {
    // Their footprints are apart, but their clips would meet. This overlap broke a mesh.
    const first = board({ id: "first", x: 100, y: 60 });
    const second = board({ id: "second", x: 100, y: 60 + 21 + 2 * 1.8 + 0.5 });
    expect(cradleError(small({ components: [first, second] }))).toContain("cradle for");
  });

  it("stays clear of a part's body", () => {
    const deep = { name: "Deep", source: "measured", mount: "panel", cutouts: [{ kind: "circle", diameter: 8 }], above: { footprint: { shape: "circle", diameter: 8 }, height: 0 }, below: { footprint: { shape: "rect", width: 12, height: 4 }, depth: 36 } };
    // Beside the board, over a clip, deep enough to reach it.
    const config = small({ customParts: { deep }, components: [board({ x: 28.7, y: 60 }), { id: "deep", type: "deep", surface: "deck", u: 19, v: 49.6 }] });
    expect(cradleError(config)).toContain('"deep"');
  });

  it("stays clear of reserved room, even where the board itself would fit", () => {
    // Only the clip at x 16 to 22, y 87.7 to 89.3 is in this box. The board starts at y 89.5.
    const keepOut = [{ xMin: 15, xMax: 23, yMin: 88, yMax: 89.4, top: 10 }];
    const config = small({ opening: { xMin: 100, xMax: 200, yEnd: 60, sill: 7, keepOut }, components: [board({})] });
    expect(cradleError(config)).toContain("opening's contents");
  });

  it("stays out of the plate's notch for a rail", () => {
    const opening = { xMin: 100, xMax: 200, yEnd: 60, sill: 7, rail: { depth: 14, screwX: [92, 208] } };
    const config = small({ opening, components: [board({ x: 150, y: 25 })] });
    expect(cradleError(config)).toContain("notch");
  });

  // A small board whose only block sticks out to one side, so that only the block is in the way.
  const reaching = (at: [number, number]) => ({
    name: "Reaching",
    source: "measured",
    mount: "floor",
    footprint: { shape: "rect", width: 20, height: 20 },
    height: 14,
    holder: { underside: 8, stops: [{ at, width: 4, height: 4 }] },
  });

  it("stays clear of a seam tab, even where the board itself would fit", () => {
    const { seams } = plan(deckAndPanel());
    const tab = seams[0]!.tabs.find((t) => t.surface === null && t.start[0] > 100)!;
    const seamX = seams[0]!.x;
    // The board is 15 from the seam and well forward of the tab. Its block reaches back to it.
    const config = deckAndPanel({ customParts: { reaching: reaching([16, tab.start[0] - 3 - 130]) }, components: [{ id: "r", type: "reaching", x: seamX - 25, y: 130 }] });
    expect(cradleError(config)).toContain("seam tab");
  });

  it("moves bosses off it, even where the board itself is clear", () => {
    const y = plan(small()).plate!.screws.find(([x, sy]) => x < 12 && sy > 40 && sy < 150)![1];
    const config = small({ customParts: { reaching: reaching([-33.2, 0]) }, components: [{ id: "r", type: "reaching", x: 40, y }] });
    const { plate, holderBlocks } = plan(config);
    const [block] = holderBlocks;
    for (const [x, sy] of plate!.screws) expect(Math.max(block!.xLow - x, x - block!.xHigh, block!.yLow - sy, sy - block!.yHigh), `boss at ${x}, ${sy}`).toBeGreaterThan(4);
  });

  it("moves top screw tabs off it, even where the board itself is clear", () => {
    const capped = (extra: object) => small({ topPanels: [{ surface: "deck" }], ...extra });
    const screw = plan(capped({})).topScrews.find((s) => s.wall === "left" && s.y > 25)!;
    const config = capped({ customParts: { reaching: reaching([-33, 0]) }, components: [{ id: "r", type: "reaching", x: 40, y: screw.y }] });
    const { topScrews, holderBlocks } = plan(config);
    const [block] = holderBlocks;
    // Boards are checked along the floor, whatever their height, so the tab has to move away.
    const middle = (block!.yLow + block!.yHigh) / 2;
    for (const moved of topScrews.filter((s) => s.wall === "left")) expect(Math.abs(moved.y - middle)).toBeGreaterThanOrEqual(8.9);
  });

  it("moves bosses off it", () => {
    for (const [x, y] of plan(small({ components: [board({})] })).plate!.screws) {
      for (const block of plan(small({ components: [board({})] })).holderBlocks) {
        const dx = Math.max(block.xLow - x, x - block.xHigh);
        const dy = Math.max(block.yLow - y, y - block.yHigh);
        expect(Math.max(dx, dy)).toBeGreaterThan(4);
      }
    }
  });

  it("rejects a board too short for its own cradle", () => {
    const short = { name: "Short", source: "measured", mount: "floor", footprint: { shape: "rect", width: 30, height: 20 }, height: 5, holder: { underside: 8 } };
    expect(cradleError(small({ customParts: { short }, components: [{ id: "s", type: "short", x: 60, y: 60 }] }))).toContain("tall");
  });

  it("counts towards the plate's height", () => {
    const { printedParts } = plan(small({ components: [board({})] }));
    expect(printedParts.find((p) => p.kind === "plate")!.size[2]).toBeCloseTo(3 + 10.15);
  });
});

describe("rebuilding after a move", () => {
  const keys = (config: unknown) => planKeys(plan(config));

  it("rebuilds when a board moves its hole and cradle", () => {
    const moved = deskSynth();
    moved.components.find((c: any) => c.id === "mcu").y = 116;
    expect(partsToRecut(keys(deskSynth()), keys(moved))).toBeNull();
    const base = plan(deskSynth());
    expect(partsToRecut(planKeys(base), planKeys({ ...base, wallHoles: [] }))).toBeNull();
    expect(partsToRecut(planKeys(base), planKeys({ ...base, holderBlocks: [] }))).toBeNull();
  });

  it("rebuilds when top screws change, since their posts and tabs do", () => {
    const base = plan(deskSynth());
    const shifted = { ...base, topScrews: base.topScrews.slice(1) };
    expect(partsToRecut(planKeys(base), planKeys(shifted))).toBeNull();
  });
});

describe("what gets built", () => {
  beforeAll(async () => {
    await initEngine();
  });

  const shellOf = (buildPlan: BuildPlan) => buildEnclosure(buildPlan).parts.filter((p) => p.kind === "shell").map((p) => p.shape);
  const fill = (shapes: Shape3D[], tool: Shape3D) => shapes.reduce((sum, s) => sum + overlap(s, tool), 0) / measureVolume(tool);

  it("cuts a hole through each wall, and only through the wall", () => {
    const w = 3;
    const cases: { wall: string; air: Box; beside: Box }[] = [
      { wall: "left", air: [[-0.5, 95, 12], [w + 0.5, 105, 18]], beside: [[0.2, 80, 12], [w - 0.2, 90, 18]] },
      { wall: "right", air: [[220 - w - 0.5, 95, 12], [220.5, 105, 18]], beside: [[220 - w + 0.2, 80, 12], [219.8, 90, 18]] },
      { wall: "front", air: [[95, -0.5, 12], [105, w + 0.5, 18]], beside: [[80, 0.2, 12], [90, w - 0.2, 18]] },
      { wall: "rear", air: [[95, 190 - w - 0.5, 12], [105, 190.5, 18]], beside: [[80, 190 - w + 0.2, 12], [90, 189.8, 18]] },
    ];
    for (const { wall, air, beside } of cases) {
      const shells = shellOf(plan(small({ wallHoles: [hole({ wall })] })));
      expect(fill(shells, makeBox(...air) as unknown as Shape3D), `${wall}: the hole`).toBeLessThan(0.001);
      expect(fill(shells, makeBox(...beside) as unknown as Shape3D), `${wall}: the wall beside it`).toBeGreaterThan(0.999);
    }
  });

  it("rounds its corners", () => {
    const shells = shellOf(plan(small({ wallHoles: [hole({ cornerRadius: 3 })] })));
    // A sliver of wall in the very corner of its bounding box, which a square hole would remove.
    expect(fill(shells, makeBox([0.5, 93.05, 11.05], [2.5, 93.3, 11.3]) as unknown as Shape3D)).toBeGreaterThan(0.999);
  });

  it("gives the Desk Synth a hole for its USB, in the first shell half, lined up with the board", () => {
    const buildPlan = plan(deskSynth());
    const shell = buildEnclosure(buildPlan).parts.find((p) => p.name === "Shell 1")!.shape;
    const [usb] = buildPlan.wallHoles;
    expect(usb).toMatchObject({ wall: "left", at: 118.5, componentId: "mcu" });
    expect(usb!.z).toBeCloseTo(13.6);
    expect(overlap(shell, makeBox([-1, 112.5, 10.5], [4.5, 124.5, 17]) as unknown as Shape3D)).toBeLessThan(0.001);
  });

  it("builds the cradle on the plate, leaving room for the board in it", () => {
    const buildPlan = plan(deskSynth());
    const { parts } = buildEnclosure(buildPlan);
    const plate = parts.find((p) => p.name === "Plate 1")!.shape;
    const floor = buildPlan.config.enclosure.floorThickness;
    const holder = { underside: 8, thickness: 1 };
    const under = floor + holder.underside;
    for (const block of buildPlan.holderBlocks) {
      // A standoff is round with a hole, so this takes a piece of its wall.
      const post = block.post;
      const inside = post
        ? (makeBox([post.x + post.holeDiameter / 2 + 0.1, post.y - 0.3, floor + 0.1], [post.x + post.diameter / 2 - 0.2, post.y + 0.3, floor + block.top - 0.1]) as unknown as Shape3D)
        : (makeBox([block.xLow + 0.1, block.yLow + 0.1, floor + 0.1], [block.xHigh - 0.1, block.yHigh - 0.1, floor + block.top - 0.1]) as unknown as Shape3D);
      const plates = parts.filter((p) => p.name.startsWith("Plate")).map((p) => p.shape);
      expect(plates.reduce((sum, piece) => sum + overlap(piece, inside), 0) / measureVolume(inside), block.kind).toBeGreaterThan(0.999);
    }
    // The board's own space, between its pads and clips, up to its top.
    const mcu = buildPlan.config.components.find((c) => c.id === "mcu") as { x: number; y: number };
    const room = makeBox([mcu.x - 25.5, mcu.y - 10.5, under + 0.01], [mcu.x + 25.5, mcu.y + 10.5, under + holder.thickness + BARB_ROOM]) as unknown as Shape3D;
    expect(overlap(plate, room)).toBeLessThan(0.001);
    // The barb reaches over the board's edge, with only a little room between them.
    const clip = buildPlan.holderBlocks.find((b) => b.kind === "clip" && b.inward![1] > 0)!;
    const overEdge = makeBox([clip.xLow + 1, clip.yHigh + 0.02, under + holder.thickness + BARB_ROOM + 0.05], [clip.xHigh - 1, clip.yHigh + 0.15, under + holder.thickness + BARB_ROOM + 0.1]) as unknown as Shape3D;
    expect(overlap(plate, overEdge) / measureVolume(overEdge)).toBeGreaterThan(0.999);
    expect(clip.yHigh + CLIP_GAP).toBeCloseTo(mcu.y - 10.5);
    expect(BARB_REACH).toBeGreaterThan(CLIP_GAP);
  });

  it("builds a rotated board's barbs too", () => {
    const buildPlan = plan(small({ components: [board({ rotationDeg: 90, x: 80, y: 28.7 })] }));
    const { parts } = buildEnclosure(buildPlan);
    const plate = parts.find((p) => p.kind === "plate")!.shape;
    const floor = buildPlan.config.enclosure.floorThickness;
    const clip = buildPlan.holderBlocks.find((b) => b.kind === "clip" && b.inward![0] > 0)!;
    const barb = makeBox([clip.xHigh + 0.02, clip.yLow + 1, floor + 9.66], [clip.xHigh + 0.15, clip.yHigh - 1, floor + 9.7]) as unknown as Shape3D;
    expect(overlap(plate, barb) / measureVolume(barb)).toBeGreaterThan(0.999);
    expect(buildPlan.wallHoles[0]!.wall).toBe("front");
  });
});

describe("standoffs", () => {
  const box = (overrides: Record<string, unknown> = {}): any => ({
    schemaVersion: 1,
    name: "box",
    enclosure: { width: 200, frontHeight: 40, cornerRadius: 3, surfaces: [{ id: "top", y: 120, z: 40 }] },
    ...overrides,
  });
  const pico = (more: Record<string, unknown> = {}) => ({ id: "p", type: "pico-rp2350", x: 100, y: 60, ...more });
  const customBoard = (standoff: Record<string, unknown>, height = 12) => ({
    b: { name: "b", source: "measured", mount: "floor", footprint: { shape: "rect", width: 30, height: 30 }, height, standoffs: [{ at: [10, 10], diameter: 5, holeDiameter: 2, height: 4, ...standoff }] },
  });
  const plannedPosts = (config: unknown) => {
    const result = validateConfig(config);
    if (!result.ok) throw new Error(JSON.stringify(result.errors, null, 1));
    return result.plan.holderBlocks.filter((block) => block.kind === "standoff");
  };

  it("go under the holes, turning with the board", () => {
    const posts = plannedPosts(box({ components: [pico()] }));
    expect(posts).toHaveLength(4);
    expect(posts[0]).toMatchObject({ top: 4, post: { x: 100 - 5.7, y: 60 - 23.5, diameter: 4.5, holeDiameter: 1.7 } });
    const turned = plannedPosts(box({ components: [pico({ rotationDeg: 90 })] }));
    expect(turned[0]!.post!.x).toBeCloseTo(100 + 23.5);
    expect(turned[0]!.post!.y).toBeCloseTo(60 - 5.7);
  });

  it("put the boards' screws in the hardware list, sized from their holes", () => {
    const hardware = (config: unknown) => plan(config).hardware.filter((h) => h.name.includes("standoffs"));
    // The pico's 1.7 mm holes in 4 mm posts take M2, through a 1.6 mm board into 3.8 mm of hole.
    expect(hardware(box({ components: [pico(), pico({ id: "q", x: 150 })] }))).toEqual([{ name: "M2 x 5 screw, for the boards' standoffs", count: 8 }]);
    expect(standoffScrew(1.6, 3)).toBe("M2 x 4 screw, for the boards' standoffs"); // the ADS7830's, as its notes say
    expect(standoffScrew(2.2, 4)).toMatch(/^M2\.5 x 5 /);
    expect(standoffScrew(2.5, 4)).toMatch(/^M3 x 5 /);
    expect(standoffScrew(1.6, 6)).toMatch(/^M2 x 6 /);
    expect(hardware(box({ plate: { enabled: false }, components: [pico()] }))).toEqual([]);
  });

  it("are skipped, with a warning, without a plate", () => {
    const result = validateConfig(box({ plate: { enabled: false }, components: [pico()] }));
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.plan.holderBlocks).toEqual([]);
    expect(result.warnings.find((w) => w.code === "BOARD_HOLDER_SKIPPED")?.message).toContain("standoffs");
  });

  it("can't be too thin around the hole, or taller than the board", () => {
    const with_ = (standoff: Record<string, unknown>, height?: number) => box({ customParts: customBoard(standoff, height), components: [{ id: "c", type: "b", x: 100, y: 60 }] });
    expect(errors(with_({})).map((e) => e.code)).toEqual([]);
    expect(errors(with_({ holeDiameter: 3.6 })).map((e) => e.message).join(" ")).toContain("wall around its hole");
    expect(errors(with_({ height: 14 })).map((e) => e.message).join(" ")).toContain("standoffs");
  });

  it("get the checks a cradle gets", () => {
    const message = (config: unknown) => errors(config).map((e) => e.message).join(" ");
    expect(message(box({ seams: [], components: [pico({ x: 100, y: 26 })] }))).toContain("A standoff for");
    const crossing = box({ plate: { seamX: 100 + 5.7 }, components: [pico()] });
    expect(message(crossing)).toContain("crosses the plate's joint");
  });

  it("keep the plate's screws away", () => {
    const result = validateConfig(box({ components: [pico({ x: 100, y: 34 })] }));
    if (!result.ok) throw new Error(JSON.stringify(result.errors));
    for (const post of result.plan.holderBlocks) {
      for (const [x, y] of result.plan.plate!.screws) expect(Math.hypot(x - post.post!.x, y - post.post!.y)).toBeGreaterThan(4 + 2);
    }
  });

  describe("as printed", () => {
    beforeAll(() => initEngine(), 60_000);

    it("stand on the plate with a blind hole, and it all holds together", async () => {
      const config = box({ components: [pico()] });
      const result = validateConfig(config);
      if (!result.ok) throw new Error(JSON.stringify(result.errors));
      const plate = buildEnclosure(result.plan).parts.find((part) => part.kind === "plate")!.shape;
      expect(isValidSolid(plate)).toBe(true);
      expect(plate.solids).toHaveLength(1);
      const stl = analyseBinarySTL(new Uint8Array(await plate.blobSTL({ binary: true, tolerance: 0.05, angularTolerance: 0.2 }).arrayBuffer()));
      expect(stl.watertight).toBe(true);
      const post = result.plan.holderBlocks[0]!.post!;
      const floor = result.plan.config.enclosure.floorThickness;
      const at = (r: number, from: number, length: number, dx = 0) => {
        try {
          return measureVolume(plate.intersect(makeCylinder(r, length, [post.x + dx, post.y, from], [0, 0, 1])));
        } catch {
          return 0;
        }
      };
      // Wall around the hole, and nothing in it.
      expect(at(0.2, floor + 1, 2, post.holeDiameter / 2 + 0.4)).toBeGreaterThan(0.1);
      expect(at(post.holeDiameter / 2 - 0.02, floor + 0.4, 4)).toBeLessThan(0.001);
      // It doesn't go through to the plate's far side.
      expect(at(0.5, 0.1, floor)).toBeCloseTo(Math.PI * 0.25 * floor, 1);
      // And no further up than it should.
      expect(at(2, floor + 4.1, 2, 0)).toBeLessThan(0.001);
    }, 60_000);
  });
});

describe("notches", () => {
  const box = (overrides: Record<string, unknown> = {}): any => ({
    schemaVersion: 1,
    name: "box",
    enclosure: { width: 200, frontHeight: 40, cornerRadius: 3, surfaces: [{ id: "top", y: 120, z: 40 }] },
    ...overrides,
  });
  const keyed = (notch: Record<string, unknown>, more: Record<string, unknown> = {}) => ({
    k: { name: "k", source: "measured", mount: "panel", cutouts: [{ kind: "circle", diameter: 20, notches: [{ width: 6, height: 4, at: [0, 11], ...notch }] }], above: { footprint: { shape: "circle", diameter: 22 }, height: 2 }, below: { footprint: { shape: "circle", diameter: 19 }, depth: 10 }, ...more },
  });
  const one = (notch: Record<string, unknown> = {}, component: Record<string, unknown> = {}) => box({ customParts: keyed(notch), components: [{ id: "c", type: "k", surface: "top", u: 100, v: 60, ...component }] });

  it("have to reach the hole they're off", () => {
    expect(errors(one())).toEqual([]);
    expect(errors(one({ at: [0, 15] })).map((e) => e.code)).toContain("GEOMETRY_IMPOSSIBLE");
  });

  it("turn with the part", () => {
    expect(plan(one()).cutouts[0]!.notches).toEqual([{ u: 100, v: 71, width: 6, height: 4 }]);
    const turned = plan(one({}, { rotationDeg: 90 })).cutouts[0]!.notches![0]!;
    expect(turned.u).toBeCloseTo(100 - 11);
    expect(turned.v).toBeCloseTo(60);
    expect([turned.width, turned.height]).toEqual([4, 6]);
  });

  it("grow with the part's holes, so a fit test's choice reaches them", () => {
    const fitted = { ...one(), fabrication: { fit: { partHoles: { k: 0.2 } } } };
    expect(plan(fitted).cutouts[0]!.notches![0]!.width).toBeCloseTo(6.2);
    expect(plan(fitted).cutouts[0]!.notches![0]!.height).toBeCloseTo(4.2);
    const screen = { ...box({ components: [{ id: "o", type: "oled-242-ssd1309", surface: "top", u: 100, v: 60 }] }), fabrication: { fit: { partHoles: { "oled-242-ssd1309": 0.2 } } } };
    expect(plan(screen).cutouts[0]!.recess!.notches![0]!.width).toBeCloseTo(39.2);
    expect(plan(screen).cutouts[0]!.recess!.notches![0]!.height).toBeCloseTo(1.6);
  });

  it("keep other things away, and not the rest of their own hole", () => {
    const near = (v: number) => one({}, {}).components.concat([{ id: "d", type: "ec11-dial-19mm", surface: "top", u: 100, v }]);
    const spacing = (v: number) => errors({ ...one(), components: near(v) }).map((e) => e.code);
    // The dial's 7.4 mm hole at v 80 is 1.3 mm from the notch's end, and would be fine without it.
    expect(spacing(77)).toContain("CUTOUTS_TOO_CLOSE");
    expect(spacing(80)).not.toContain("CUTOUTS_TOO_CLOSE");
    expect(errors(one({ at: [0, 57] }, { v: 60 })).length).toBeGreaterThan(0);
    expect(plan(one()).cutouts).toHaveLength(1);
    const label = { ...one(), labels: [{ text: "I", u: 100, v: 75 }] };
    expect(errors(label).map((e) => e.message).join(" ")).toContain("runs into the hole");
  });

  it("are refused where they run off the surface", () => {
    // The hole alone would fit here.
    expect(errors(one({}, { v: 104 })).map((e) => e.code)).toContain("CUTOUT_OUTSIDE_SURFACE");
    const plainHole = { ...box({ customParts: { k: { ...keyed({}).k, cutouts: [{ kind: "circle", diameter: 20 }] } } }), components: [{ id: "c", type: "k", surface: "top", u: 100, v: 104 }] };
    expect(errors(plainHole).map((e) => e.code)).not.toContain("CUTOUT_OUTSIDE_SURFACE");
  });

  describe("as printed", () => {
    beforeAll(() => initEngine(), 60_000);

    it("are cut through with a hole, and to its depth with a recess, adding what they should", async () => {
      const button = plan(one());
      const part = buildEnclosure(button).parts[0]!.shape;
      expect(isValidSolid(part)).toBe(true);
      expect(overlap(part, makeCylinder(0.5, 6, [100, 72, 34], [0, 0, 1]))).toBeLessThan(0.001);
      expect(overlap(part, makeCylinder(0.5, 2, [104, 72, 37.5], [0, 0, 1]))).toBeGreaterThan(0.1);
      // The hole, plus what the notch adds beyond it.
      const added = cutoutVolume(button.cutouts[0]!, 3) - Math.PI * 100 * 3;
      expect(added).toBeGreaterThan(0);
      const plain = plan(box({ customParts: { k: { ...keyed({}).k, cutouts: [{ kind: "circle", diameter: 20 }] } }, components: [{ id: "c", type: "k", surface: "top", u: 100, v: 60 }] }));
      const removed = measureVolume(buildEnclosure(plain).parts[0]!.shape) - measureVolume(part);
      expect(removed).toBeCloseTo(added, 0);
    }, 60_000);

    it("match the real Desk Synth button hole and screen recess", () => {
      const config = box({ topPanels: [{ surface: "top" }], components: [{ id: "b", type: "arcade-24mm", surface: "top", u: 40, v: 60 }, { id: "o", type: "oled-242-ssd1309", surface: "top", u: 125, v: 60 }] });
      const built = plan(config);
      const top = buildEnclosure(built).parts.find((part) => part.kind === "top")!.shape;
      expect(isValidSolid(top)).toBe(true);
      const [, [xHigh, , zHigh]] = [[0, 0, 0], top.boundingBox.bounds[1]] as const;
      expect(xHigh).toBeGreaterThan(0);
      const at = (u: number, v: number, depth: number) => overlap(top, makeCylinder(0.05, 0.1, [u, v, zHigh! - depth], [0, 0, 1])) < 0.0001;
      // The keyway reaches 13 mm from the button's centre, and is 8.36 mm wide there.
      expect(at(40, 60 + 12.9, 1.5)).toBe(true);
      expect(at(40, 60 + 13.1, 1.5)).toBe(false);
      expect(at(40 + 4.1, 60 + 12.9, 1.5)).toBe(true);
      expect(at(40 + 4.3, 60 + 12.9, 1.5)).toBe(false);
      expect(at(40, 60 - 12.3, 1.5)).toBe(false);
      // The screen's recess is 63.2 mm wide, from 19 mm in front of the part's centre to 20.5 mm behind, and
      // its 39 mm notch reaches 20.2 mm in front.
      const deep = 2.5;
      expect(at(125 + 31.5, 60, deep)).toBe(true);
      expect(at(125 + 31.7, 60, deep)).toBe(false);
      expect(at(125 + 25, 60 + 20.4, deep)).toBe(true);
      expect(at(125 + 25, 60 + 20.6, deep)).toBe(false);
      expect(at(125 + 25, 60 - 18.9, deep)).toBe(true);
      expect(at(125 + 25, 60 - 19.1, deep)).toBe(false);
      expect(at(125 + 19.4, 60 - 20.1, deep)).toBe(true);
      expect(at(125 + 19.6, 60 - 20.1, deep)).toBe(false);
      expect(at(125, 60 - 20.3, deep)).toBe(false);
      // The notch stops at the skin.
      expect(at(125 + 10, 60 - 20.1, 1)).toBe(false);
      // The window is 57.6 mm wide, and bevelled 0.75 mm at 45 degrees on the face.
      expect(at(125 + 28.8 + 0.4, 62.7, 0.2)).toBe(true);
      expect(at(125 + 28.8 + 0.7, 62.7, 0.2)).toBe(false);
      expect(at(125 + 28.7, 62.7, 1)).toBe(true);
      expect(at(125 + 29, 62.7, 1)).toBe(false);
    }, 60_000);

    it("bevel a window's face edge, removing what they should, and no deeper than the panel allows", () => {
      const windowed = (bevel?: number, cornerRadius = 0) =>
        box({
          topPanels: [{ surface: "top" }],
          customParts: { w: { name: "w", source: "measured", mount: "panel", cutouts: [{ kind: "rect", width: 30, height: 20, cornerRadius, ...(bevel && { bevel }) }], above: { footprint: { shape: "rect", width: 30, height: 20 }, height: 0 }, below: { footprint: { shape: "rect", width: 30, height: 20 }, depth: 5 } } },
          components: [{ id: "w", type: "w", surface: "top", u: 100, v: 60 }],
        });
      const top = (config: unknown) => buildEnclosure(plan(config)).parts.find((part) => part.kind === "top")!.shape;
      for (const radius of [0, 3]) {
        const bevelled = plan(windowed(1, radius));
        const expected = cutoutVolume(bevelled.cutouts[0]!, 3) - cutoutVolume(plan(windowed(undefined, radius)).cutouts[0]!, 3);
        // b²(w + h) + 4b³/3 with square corners.
        if (radius === 0) expect(expected).toBeCloseTo(50 + 4 / 3, 2);
        expect(measureVolume(top(windowed(undefined, radius))) - measureVolume(top(windowed(1, radius)))).toBeCloseTo(expected, 1);
      }
      // It keeps other holes further off at the face: 1.5 mm apart is enough for plain windows, not bevelled ones.
      const pair = (bevel?: number) => ({ ...windowed(bevel), components: [{ id: "a", type: "w", surface: "top", u: 100, v: 60 }, { id: "b", type: "w", surface: "top", u: 131.5, v: 60 }] });
      expect(errors(pair())).toEqual([]);
      expect(errors(pair(1)).map((e) => e.code)).toContain("CUTOUTS_TOO_CLOSE");
      expect(errors(windowed(3)).map((e) => e.code)).toContain("GEOMETRY_IMPOSSIBLE");
    }, 60_000);
  });
});
