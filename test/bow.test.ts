// A front or rear wall that bows outward, seen from above.
import { beforeAll, describe, expect, it } from "vitest";
import { measureVolume } from "replicad";
import { buildEnclosure, initEngine, planPrint, validateConfig, type BuildPlan } from "../src/index.js";
import { bowAt, planOutline } from "../src/bow.js";
import { buildProblems } from "./buildChecks.js";
import { errors } from "./helpers.js";
import { setBow, shapeValues } from "../src/app/shapeEdit.js";

// A flat deck and a tilted panel, as in the Dial deck, with both long walls bowed.
const bowed = (more: Record<string, unknown> = {}, bow: Record<string, number> = { front: 8, rear: 5 }): any => ({
  schemaVersion: 1,
  name: "bowed",
  enclosure: {
    width: 300,
    frontHeight: 40,
    surfaces: [
      { id: "deck", y: 80, z: 40 },
      { id: "panel", y: 150, z: 66 },
    ],
    bow,
  },
  seams: [{ x: 150, lip: 2 }],
  components: [
    { id: "a", type: "ttp223", surface: "deck", u: 60, v: 40 },
    { id: "b", type: "ec11-dial-19mm", surface: "panel", u: 220, v: 36 },
    { id: "e", type: "rp2040-plus", x: 28.9, y: 110 },
  ],
  ...more,
});
function plan(config: unknown): BuildPlan {
  const result = validateConfig(config);
  if (!result.ok) throw new Error(JSON.stringify(result.errors, null, 1));
  return result.plan;
}

describe("a bowed wall's outline", () => {
  it("is furthest out at the middle, and back at the wall's line by the corners", () => {
    expect(bowAt(300, 8, 150)).toBeCloseTo(8);
    expect(bowAt(300, 8, 0)).toBeCloseTo(0);
    expect(bowAt(300, 8, 75)).toBeGreaterThan(5);
    expect(bowAt(300, 0, 150)).toBe(0);
  });

  it("runs each corner's round smoothly into the bow", () => {
    const path = planOutline(300, 150, 6, { front: 8, rear: 0 });
    // The front: from the left wall, a round, the bow through its middle, a round, the right wall.
    const [start, round, arc] = path;
    expect(start!.to[0]).toBe(0);
    expect(arc!.via).toEqual([150, -8]);
    // The round's end is on the bow's circle, and on its own, whose centres line up with it.
    const big = (150 * 150 + 64) / 16;
    const centre = [150, big - 8];
    const corner = [6, start!.to[1]];
    const [tx, ty] = round!.to;
    expect(Math.hypot(tx - centre[0]!, ty - centre[1]!)).toBeCloseTo(big, 6);
    expect(Math.hypot(tx - corner[0]!, ty - corner[1]!)).toBeCloseTo(6, 6);
    const cross = (tx - centre[0]!) * (corner[1]! - centre[1]!) - (ty - centre[1]!) * (corner[0]! - centre[0]!);
    expect(Math.abs(cross)).toBeLessThan(1e-6);
    // The rear, unbowed, is the plain rounded corners.
    expect(path.map(({ to }) => to)).toContainEqual([294, 150]);
    expect(path.map(({ to }) => to)).toContainEqual([300, 144]);
  });
});

describe("a bowed wall, planned", () => {
  it("leaves the inside alone, and sizes each piece out to the curve", () => {
    const built = plan(bowed());
    const straight = plan(bowed({}, {}));
    expect(built.profile).toEqual(straight.profile);
    expect(built.plate).toEqual(straight.plate);
    // Each half reaches the middle, where both walls are furthest out.
    expect(built.printedParts[0]!.size[1]).toBeCloseTo(150 + 8 + 5);
    expect(built.printedParts[0]!.size[1] - straight.printedParts[0]!.size[1]).toBeCloseTo(13);
  });

  it("is refused when it's too little, too much, or meets a round", () => {
    const paths = (config: unknown) => errors(config).map((e) => e.path);
    expect(paths(bowed({}, { front: 0.2 }))).toEqual(["enclosure.bow.front"]);
    expect(paths(bowed({}, { rear: 25 }))).toEqual(["enclosure.bow.rear"]);
    const round = bowed({}, { rear: 5 });
    round.enclosure.rounds = { rearTop: 12 };
    expect(paths(round)).toEqual(["enclosure.bow.rear"]);
    const low = bowed({}, { front: 0, rear: 20 });
    low.enclosure.surfaces = [{ id: "deck", y: 80, z: 40 }, { id: "panel", y: 150, z: 14 }];
    low.components = [{ id: "a", type: "ttp223", surface: "deck", u: 60, v: 40 }];
    low.seams = [];
    expect(errors(low).map((e) => e.message).join()).toMatch(/carries the top down its slope/);
  });

  it("lets nothing through it, and no lettering on it", () => {
    const hole = bowed({ wallHoles: [{ wall: "rear", at: 60, z: 20, width: 12, height: 8 }] });
    expect(errors(hole).map((e) => e.code)).toEqual(["BOW_INVALID"]);
    const label = bowed({ labels: [{ text: "HI", wall: "front", at: 60, z: 20 }] });
    expect(errors(label).map((e) => e.path)).toEqual(["labels[0].wall"]);
    // The side walls are as they were.
    expect(errors(bowed({ wallHoles: [{ wall: "left", at: 60, z: 20, width: 12, height: 8 }] }))).toEqual([]);
  });
});

describe("a bowed wall, built", () => {
  beforeAll(async () => {
    await initEngine();
  });

  it("builds sound halves with a lip, heavier by the solid walls, needing no support", async () => {
    const built = plan(bowed());
    const enclosure = buildEnclosure(built);
    expect(await buildProblems(built, enclosure)).toEqual([]);
    const straight = buildEnclosure(plan(bowed({}, {})));
    const volume = (e: typeof enclosure) => e.parts.filter((part) => built.printedParts[part.index]!.kind === "shell").reduce((sum, part) => sum + measureVolume(part.shape), 0);
    // Two segments of about two thirds of 300 x 8 and 300 x 5, some 45 mm high on average.
    const extra = volume(enclosure) - volume(straight);
    expect(extra).toBeGreaterThan(80_000);
    expect(extra).toBeLessThan(160_000);
    const reports = planPrint(built, enclosure.parts.map((part) => part.shape.mesh({ tolerance: 0.1, angularTolerance: 0.3 })));
    for (const part of built.printedParts.filter((p) => p.kind === "shell" || p.kind === "plate")) {
      expect(reports[part.index]!.needsSupport, `${part.name}: ${reports[part.index]!.notes.join(" ")}`).toBe(false);
    }
  }, 240_000);

  it("builds in one piece with a top panel that follows the curve", async () => {
    const built = plan(bowed({ seams: [], topPanels: [{ surface: "deck" }], enclosure: { ...bowed().enclosure, width: 240, cornerRadius: 0 } }));
    expect(await buildProblems(built, buildEnclosure(built))).toEqual([]);
  }, 240_000);
});

describe("a bowed wall, in the form", () => {
  it("is set for one wall, shows 0 when there's none, and leaves the file at 0", () => {
    const plain = bowed({}, {});
    delete plain.enclosure.bow;
    expect(shapeValues(plain).enclosure.bow).toEqual({ front: 0, rear: 0 });
    const set = setBow(plain, "front", 6);
    expect(set.enclosure.bow).toEqual({ front: 6 });
    expect(setBow(set, "front", 0).enclosure.bow).toBeUndefined();
  });
});
