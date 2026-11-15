// Edge lips: short walls on the plate along a board's edges, to locate it, like those round the real
// Desk Synth's perfboard.
import { readFileSync } from "node:fs";
import { beforeAll, describe, expect, it } from "vitest";
import { makeBox, measureVolume, type Shape3D } from "replicad";
import { isValidSolid } from "../src/checks.js";
import { EDGE_LIP } from "../src/fixtures.js";
import { buildEnclosure, initEngine, validateConfig, type BuildPlan } from "../src/index.js";
import { orientationsFor, planPartPrint } from "../src/printing.js";
import { setLips, setLipSide } from "../src/app/configEdit.js";
import { defaultLipLength } from "../src/app/LipsFields.js";
import { errors } from "./helpers.js";

function plan(config: unknown): BuildPlan {
  const result = validateConfig(config);
  if (!result.ok) throw new Error(JSON.stringify(result.errors, null, 1));
  return result.plan;
}
const example = (name: string) => JSON.parse(readFileSync(new URL(`../examples/${name}.json`, import.meta.url), "utf8"));

// One piece, 200 x 150, with room for a 90 x 70 perfboard.
const box = (components: unknown[], extra: Record<string, unknown> = {}): any => ({
  schemaVersion: 1,
  name: "box",
  enclosure: { width: 200, frontHeight: 40, cornerRadius: 3, surfaces: [{ id: "top", y: 150, z: 40 }] },
  components,
  ...extra,
});
// The Desk Synth V2's: a long lip on the left, and two short ones on the front and rear.
const V2_LIPS = {
  edges: [
    { side: "left", length: 54 },
    { side: "front", at: -28, length: 10 },
    { side: "front", at: 28, length: 10 },
    { side: "rear", at: -28, length: 10 },
    { side: "rear", at: 28, length: 10 },
  ],
};
const perfboard = (more: Record<string, unknown> = {}) => ({ id: "pb", type: "perfboard-7x9", x: 100, y: 75, lips: V2_LIPS, ...more });
const lipsOf = (config: unknown) => plan(config).holderBlocks.filter((block) => block.kind === "lip");
const lipError = (config: unknown) => errors(config).find((e) => e.code === "BOARD_HOLDER_INVALID")?.message;

describe("edge lips", () => {
  it("stand along the edges they're given, a gap from the board", () => {
    const lips = lipsOf(box([perfboard()]));
    expect(lips).toHaveLength(5);
    const [left, ...short] = lips;
    // The board runs from x 55 to 145 and y 40 to 110.
    expect(left).toMatchObject({ componentId: "pb", inward: null });
    expect(left!.xHigh).toBeCloseTo(55 - EDGE_LIP.gap);
    expect(left!.xLow).toBeCloseTo(55 - EDGE_LIP.gap - EDGE_LIP.thickness);
    expect([left!.yLow, left!.yHigh]).toEqual([48, 102]);
    expect(short.map((lip) => [lip.xLow, lip.xHigh])).toEqual([[67, 77], [123, 133], [67, 77], [123, 133]]);
    expect(short[0]!.yHigh).toBeCloseTo(40 - EDGE_LIP.gap);
    expect(short[2]!.yLow).toBeCloseTo(110 + EDGE_LIP.gap);
  });

  it("stand over the board's top, wherever the board sits", () => {
    // The perfboard is on 6 mm standoffs, and 1.6 mm thick.
    for (const lip of lipsOf(box([perfboard()]))) expect(lip.top).toBeCloseTo(6 + 1.6 + EDGE_LIP.above);
    const higher = lipsOf(box([perfboard({ lips: { ...V2_LIPS, above: 2.5 } })]));
    expect(higher[0]!.top).toBeCloseTo(6 + 1.6 + 2.5);
    // A board in a cradle: the RP2040-Plus sits 8 mm up and is 1 mm thick.
    const mcu = { id: "mcu", type: "rp2040-plus", x: 100, y: 75, lips: { edges: [{ side: "front", at: 1.4, length: 10 }], gap: 0.2, thickness: 2 } };
    const [lip] = lipsOf(box([mcu]));
    expect(lip!.top).toBeCloseTo(8 + 1 + 1);
    expect(lip!.yHigh).toBeCloseTo(75 - 10.5 - 0.2);
    expect(lip!.yLow).toBeCloseTo(75 - 10.5 - 0.2 - 2);
    // A board of your own, straight on the plate.
    const flat = { name: "Flat", source: "measured", mount: "floor", footprint: { shape: "rect", width: 30, height: 20 }, height: 5 };
    const [own] = lipsOf(box([{ id: "f", type: "flat", x: 100, y: 75, lips: { edges: [{ side: "front", length: 20 }] } }], { customParts: { flat } }));
    expect(own!.top).toBeCloseTo(1.6 + 1);
  });

  it("turn with the board, by the edge they're on", () => {
    const lips = lipsOf(box([perfboard({ rotationDeg: 90, lips: { edges: [{ side: "left", length: 54 }, { side: "front", at: 28, length: 10 }] } })]));
    // Turned a quarter, its left edge faces the front, and its front edge the right.
    const [left, front] = lips;
    expect(left!.yHigh).toBeCloseTo(75 - 45 - EDGE_LIP.gap);
    expect([left!.xLow, left!.xHigh]).toEqual([73, 127]);
    expect(front!.xLow).toBeCloseTo(100 + 35 + EDGE_LIP.gap);
    expect([front!.yLow, front!.yHigh]).toEqual([98, 108]);
  });

  it("go on boards that stand on standoffs or sit in a cradle, and leave the rest of the mount as it was", () => {
    const plain = plan(box([perfboard({ lips: undefined })])).holderBlocks;
    expect(plan(box([perfboard()])).holderBlocks.filter((block) => block.kind !== "lip")).toEqual(plain);
  });

  it("can't run past the end of their edge", () => {
    expect(lipError(box([perfboard({ lips: { edges: [{ side: "left", length: 71 }] } })]))).toContain("runs past the end of its left edge, which is 70 mm long");
    expect(lipError(box([perfboard({ lips: { edges: [{ side: "front", at: 40, length: 12 }] } })]))).toContain("front edge");
    expect(errors(box([perfboard({ lips: { edges: [{ side: "front", length: 90 }] } })]))).toEqual([]);
  });

  it("can't be too thin to print, or taller than the board's body", () => {
    expect(lipError(box([perfboard({ lips: { ...V2_LIPS, thickness: 0.6 } })]))).toContain("too thin");
    expect(lipError(box([perfboard({ lips: { ...V2_LIPS, above: 13 } })]))).toContain("over the top");
    // A lip's own thickness or height counts, and a problem shared by several lips is said once.
    expect(lipError(box([perfboard({ lips: { edges: [{ side: "left", length: 10, thickness: 0.6 }] } })]))).toContain("too thin");
    expect(errors(box([perfboard({ lips: { ...V2_LIPS, thickness: 0.6 } })]))).toHaveLength(1);
  });

  it("only go on a rectangular board", () => {
    const disc = { name: "Disc", source: "measured", mount: "floor", footprint: { shape: "circle", diameter: 30 }, height: 5 };
    const config = box([{ id: "d", type: "disc", x: 100, y: 75, lips: { edges: [{ side: "left", length: 10 }] } }], { customParts: { disc } });
    expect(lipError(config)).toContain("rectangular");
  });

  it("keep out of the way of the board's connector and its own cradle", () => {
    const mcu = (lips: object) => box([{ id: "mcu", type: "rp2040-plus", x: 100, y: 75, lips: { gap: 0.2, ...lips } }]);
    // USB is on its left edge, in the middle.
    expect(lipError(mcu({ edges: [{ side: "left", length: 6 }] }))).toContain("connector");
    expect(errors(mcu({ edges: [{ side: "left", at: 8.9, length: 3 }] }))).toEqual([]);
    // Its clips are on the front and rear, 6 mm long at -9.6 and 12.4, and its stop on the right.
    expect(lipError(mcu({ edges: [{ side: "front", at: -9.6, length: 4 }] }))).toContain("its own cradle");
    expect(lipError(mcu({ edges: [{ side: "right", length: 10 }] }))).toContain("its own cradle");
    expect(errors(mcu({ edges: [{ side: "front", at: 1.4, length: 10 }] }))).toEqual([]);
  });

  it("get the checks a cradle gets", () => {
    // Off the plate, and into another board, though the boards alone would be clear.
    expect(errors(box([perfboard({ x: 49, lips: undefined })]))).toEqual([]);
    expect(lipError(box([perfboard({ x: 49 })]))).toContain("An edge lip for \"pb\" runs off the edge of the plate");
    const ads = { id: "adc", type: "ads7830", x: 100 - 45 - 1.5 - 8.85, y: 75 };
    expect(errors(box([perfboard({ lips: undefined }), ads])).map((e) => e.code)).toEqual([]);
    expect(lipError(box([perfboard(), ads]))).toMatch(/An edge lip for "pb" runs into (the cradle for )?"adc"/);
    expect(lipError(box([perfboard()], { plate: { seamX: 70 } }))).toContain("crosses the plate's joint");
  });

  it("are skipped, with a warning, without a plate", () => {
    const result = validateConfig(box([perfboard({ type: "lipped", lips: { edges: [{ side: "left", length: 10 }] } })], {
      plate: { enabled: false },
      customParts: { lipped: { name: "Lipped", source: "measured", mount: "floor", footprint: { shape: "rect", width: 30, height: 20 }, height: 5 } },
    }));
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.plan.holderBlocks).toEqual([]);
    expect(result.warnings.find((w) => w.code === "BOARD_HOLDER_SKIPPED")?.message).toContain("edge lips");
  });

  it("only go on a part on the floor", () => {
    const config = box([{ id: "b", type: "arcade-24mm", u: 50, v: 50, lips: V2_LIPS }]);
    expect(validateConfig(config).ok).toBe(false);
  });
});

describe("the Desk Synth's edge lips", () => {
  it("are the V2's round its perfboard: 1.6 mm thick, 0.25 mm from it, and 1 mm over it", () => {
    const lips = lipsOf(example("desk-synth-v2"));
    expect(lips).toHaveLength(5);
    // The board runs from x 63 to 153 and y 98 to 168. On the real one, the long lip stops 8 mm
    // short of each corner, and the short ones are 12 to 22 mm in from each end.
    const [left, ...short] = lips;
    expect([left!.xLow, left!.xHigh, left!.yLow, left!.yHigh].map((n) => +n.toFixed(2))).toEqual([61.15, 62.75, 106, 160]);
    expect(short.map((lip) => [lip.xLow, lip.xHigh])).toEqual([[75, 85], [131, 141], [75, 85], [131, 141]]);
    for (const lip of lips) expect(lip.top).toBeCloseTo(6 + 1.6 + 1);
  });

  it("are the V1's two short lips on the perfboard's ends, 0.2 mm from it, each its own thickness and height", () => {
    // The real ones are 6 mm long: on the left, 2 mm forward of the middle, 2.4 mm thick and up to
    // 10 mm, and on the right, in the middle, 2.2 mm thick and up to 8.6 mm, 1 mm over the board.
    const [left, right, ...rest] = lipsOf(example("desk-synth"));
    expect(rest).toEqual([]);
    expect([left!.xLow, left!.xHigh, left!.yLow, left!.yHigh].map((n) => +n.toFixed(2))).toEqual([60.4, 62.8, 128, 134]);
    expect(left!.top).toBeCloseTo(10);
    expect([right!.xLow, right!.xHigh, right!.yLow, right!.yHigh].map((n) => +n.toFixed(2))).toEqual([153.2, 155.4, 130, 136]);
    expect(right!.top).toBeCloseTo(8.6);
  });
});

describe("editing edge lips", () => {
  const config = { components: [{ id: "pb", type: "perfboard-7x9", x: 100, y: 75 }] };

  it("puts one lip along an edge, sets its length, and takes it off", () => {
    const one = setLipSide(config, "pb", "left", defaultLipLength(70));
    expect(one.components[0].lips).toEqual({ edges: [{ side: "left", length: 54 }] });
    const longer = setLipSide(one, "pb", "left", 60.123);
    expect(longer.components[0].lips.edges).toEqual([{ side: "left", length: 60.12 }]);
    expect(setLipSide(longer, "pb", "left", null).components[0]).toEqual(config.components[0]);
  });

  it("sets the length of each lip on an edge with several, keeping where they sit", () => {
    const v2 = { components: [{ ...config.components[0], lips: V2_LIPS }] };
    const edges = setLipSide(v2, "pb", "front", 12).components[0].lips.edges;
    expect(edges.filter((edge: any) => edge.side === "front")).toEqual([{ side: "front", at: -28, length: 12 }, { side: "front", at: 28, length: 12 }]);
    expect(edges.filter((edge: any) => edge.side !== "front")).toHaveLength(3);
  });

  it("sets the gap, thickness and height they share", () => {
    const one = setLipSide(config, "pb", "rear", 30);
    expect(setLips(one, "pb", { gap: 0.3, above: 2 }).components[0].lips).toEqual({ edges: [{ side: "rear", length: 30 }], gap: 0.3, above: 2 });
    expect(setLips(config, "pb", { gap: 0.3 })).toEqual(config);
  });

  it("starts a lip 8 mm short of each end of a long edge, and half a short one", () => {
    expect(defaultLipLength(70)).toBe(54);
    expect(defaultLipLength(20)).toBe(10);
  });
});

describe("edge lips as printed", () => {
  beforeAll(() => initEngine(), 180_000);

  it("stand on the plate, with room for the board between them, and need no support", () => {
    const built = plan(box([perfboard()]));
    const parts = buildEnclosure(built).parts;
    const plate = parts.find((part) => part.kind === "plate")!;
    expect(isValidSolid(plate.shape)).toBe(true);
    expect(plate.shape.solids).toHaveLength(1);
    const floor = built.config.enclosure.floorThickness;
    const filled = (from: [number, number, number], to: [number, number, number]) => {
      const tool = makeBox(from, to) as unknown as Shape3D;
      try {
        return measureVolume(plate.shape.intersect(tool)) / measureVolume(tool);
      } catch {
        return 0;
      }
    };
    const top = floor + 6 + 1.6 + EDGE_LIP.above;
    for (const lip of built.holderBlocks.filter((block) => block.kind === "lip")) {
      expect(filled([lip.xLow + 0.05, lip.yLow + 0.05, floor + 0.05], [lip.xHigh - 0.05, lip.yHigh - 0.05, top - 0.05])).toBeGreaterThan(0.999);
      expect(filled([lip.xLow - 0.5, lip.yLow - 0.5, top + 0.05], [lip.xHigh + 0.5, lip.yHigh + 0.5, top + 1])).toBe(0);
    }
    // The gap between the left lip and the board's edge is clear, up the board's whole height.
    expect(filled([55 - EDGE_LIP.gap + 0.02, 50, floor + 0.05], [55.5, 100, top])).toBe(0);
    const printed = built.printedParts.find((part) => part.kind === "plate")!;
    const report = planPartPrint(printed, plate.shape.mesh({ tolerance: 0.05, angularTolerance: 0.2 }), orientationsFor(built, printed), built.config.fabrication.buildVolume);
    expect(report.needsSupport).toBe(false);
    expect(report.best.planned).toBe(true);
  });
});
