// A left or right wall that bows outward, seen from above. A split shell's end pieces print standing
// on those walls, so a bowed one needs a shell in one piece, which prints upright.
import { beforeAll, describe, expect, it } from "vitest";
import { measureVolume } from "replicad";
import { buildEnclosure, initEngine, planPrint, validateConfig, type BuildPlan } from "../src/index.js";
import { bowAt, planOutline } from "../src/bow.js";
import { bowHollows } from "../src/engine.js";
import { orientationsFor } from "../src/printing.js";
import { buildProblems } from "./buildChecks.js";
import { errors } from "./helpers.js";
import { setBow, shapeValues } from "../src/app/shapeEdit.js";
import { handlesFor } from "../src/app/shapeHandles.js";
import { WALLS_PATH } from "../src/app/pickThing.js";
import { buildSceneModel, fieldSpot } from "../src/app/sceneModel.js";

// The bowed wall test's deck and panel, narrow enough for one piece, with both side walls bowed and
// the top in panels, as an upright shell wants. Square corners, since an upright shell's plate bosses
// leave a sliver in mid-air in a rounded one, bowed or not.
const sided = (more: Record<string, unknown> = {}, bow: Record<string, number> = { left: 10, right: 6 }): any => ({
  schemaVersion: 1,
  name: "sided",
  enclosure: {
    width: 220,
    frontHeight: 40,
    cornerRadius: 0,
    surfaces: [
      { id: "deck", y: 80, z: 40 },
      { id: "panel", y: 150, z: 66 },
    ],
    bow,
  },
  topPanels: [{ surface: "deck" }, { surface: "panel" }],
  components: [
    { id: "a", type: "ttp223", surface: "deck", u: 60, v: 40 },
    { id: "b", type: "ec11-dial-19mm", surface: "panel", u: 160, v: 36 },
    { id: "e", type: "rp2040-plus", x: 110, y: 110 },
  ],
  ...more,
});
function plan(config: unknown): BuildPlan {
  const result = validateConfig(config);
  if (!result.ok) throw new Error(JSON.stringify(result.errors, null, 1));
  return result.plan;
}

describe("a bowed side wall's outline", () => {
  it("bulges out at the middle of the depth, and meets the front and rear at its corners", () => {
    const path = planOutline(300, 150, 0, { left: 10 });
    expect(path[0]).toEqual({ to: [0, 0], via: [-10, 75] });
    expect(path.map(({ to }) => to)).toContainEqual([0, 150]);
    expect(bowAt(150, 10, 75)).toBeCloseTo(10);
  });

  it("runs a round smoothly into two bowed walls at once", () => {
    const path = planOutline(300, 150, 6, { front: 8, left: 10 });
    const [left, round, front] = path;
    const circle = (half: number, bow: number) => (half * half + bow * bow) / (2 * bow);
    const leftCentre = [-10 + circle(75, 10), 75] as const;
    const frontCentre = [150, -8 + circle(150, 8)] as const;
    // The round starts on the left wall's circle and ends on the front's.
    const [a, b] = [left!.to, round!.to];
    expect(Math.hypot(a[0] - leftCentre[0], a[1] - leftCentre[1])).toBeCloseTo(circle(75, 10), 6);
    expect(Math.hypot(b[0] - frontCentre[0], b[1] - frontCentre[1])).toBeCloseTo(circle(150, 8), 6);
    expect(front!.via).toEqual([150, -8]);
    // Its radius is 6, and its centre in line with each wall's centre and its end there, so it runs
    // into each wall without a kink.
    const [mx, my] = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
    const [vx, vy] = round!.via!;
    const sagitta = Math.hypot(vx - mx, vy - my);
    const chord = Math.hypot(a[0] - b[0], a[1] - b[1]) / 2;
    const radius = (chord * chord + sagitta * sagitta) / (2 * sagitta);
    expect(radius).toBeCloseTo(6, 6);
    const centre = [vx + ((mx - vx) / sagitta) * radius, vy + ((my - vy) / sagitta) * radius] as const;
    const inLine = (c: readonly [number, number], p: readonly [number, number]) => (p[0] - c[0]) * (centre[1] - c[1]) - (p[1] - c[1]) * (centre[0] - c[0]);
    expect(Math.abs(inLine(leftCentre, a))).toBeLessThan(1e-6);
    expect(Math.abs(inLine(frontCentre, b))).toBeLessThan(1e-6);
  });
});

describe("a bowed side wall, planned", () => {
  it("prints upright in one piece, sized out to both curves", () => {
    const built = plan(sided());
    const straight = plan(sided({}, {}));
    expect(built.shellOnSide).toBe(false);
    expect(built.profile).toEqual(straight.profile);
    expect(built.plate).toEqual(straight.plate);
    expect(built.printedParts[0]!.size[0] - straight.printedParts[0]!.size[0]).toBeCloseTo(16);
    expect(orientationsFor(built, built.printedParts[0]!).find((o) => o.planned)?.id).toBe("as-designed");
    // Each top panel reaches out over both curves, as far as each is out along its surface.
    expect(built.printedParts.find((p) => p.name === "Deck")!.size[0]).toBeCloseTo(236);
    expect(built.printedParts.find((p) => p.name === "Panel")!.size[0]).toBeCloseTo(220 + bowAt(150, 10, 80) + bowAt(150, 6, 80));
  });

  it("is refused on a split shell, since an end piece stands on it to print", () => {
    const split = errors(sided({ seams: [{ x: 143, lip: 2 }] }, { left: 10 }));
    expect(split.map((e) => e.path)).toEqual(["enclosure.bow.left"]);
    expect(split[0]!.message).toMatch(/can't bow on a shell split at a seam/);
    // And too wide for the bed, it says so rather than asking for a seam.
    const wide = errors(sided({ enclosure: { ...sided().enclosure, width: 300 }, topPanels: [{ surface: "deck", splits: [150] }, { surface: "panel", splits: [150] }] }));
    expect(wide.map((e) => e.message).join()).toMatch(/can't be split at a seam, so make it narrower/);
  });

  it("is refused when it's too little or too much for the depth", () => {
    const paths = (config: unknown) => errors(config).map((e) => e.path);
    expect(paths(sided({}, { left: 0.2 }))).toEqual(["enclosure.bow.left"]);
    // An eighth of 150 deep.
    expect(paths(sided({}, { right: 19 }))).toEqual(["enclosure.bow.right"]);
    expect(errors(sided({}, { right: 19 }))[0]!.message).toMatch(/150 mm deep one can is 18.75 mm/);
  });

  it("lets nothing through it, and no lettering on it", () => {
    const hole = sided({ wallHoles: [{ wall: "left", at: 60, z: 20, width: 12, height: 8 }] });
    expect(errors(hole).map((e) => e.code)).toEqual(["BOW_INVALID"]);
    const vent = sided({ vents: [{ wall: "right", at: 75, z: 20, width: 30, height: 10 }] });
    expect(errors(vent).map((e) => e.code)).toEqual(["BOW_INVALID"]);
    const label = sided({ labels: [{ text: "HI", wall: "left", at: 60, z: 20 }] });
    expect(errors(label).map((e) => e.path)).toEqual(["labels[0].wall"]);
    const jack = sided({ components: [...sided().components, { id: "j", type: "trs-35-panel", wall: "right", at: 70, z: 20 }] });
    expect(errors(jack).map((e) => e.code)).toContain("BOW_INVALID");
    // The front and rear are as they were.
    expect(errors(sided({ wallHoles: [{ wall: "front", at: 60, z: 20, width: 12, height: 8 }] }))).toEqual([]);
  });

  it("can be had with a round on the side profile, and with the front bowed too", () => {
    const round = sided();
    round.enclosure.cornerRadius = 6;
    round.enclosure.rounds = { frontBottom: 6, rearBottom: 6 };
    expect(errors(round)).toEqual([]);
    expect(errors(sided({}, { left: 10, front: 8 }))).toEqual([]);
  });
});

describe("a bowed side wall, built", () => {
  beforeAll(async () => {
    await initEngine();
  });

  it("builds sound parts, hollow behind the curve, that print upright without support", async () => {
    const built = plan(sided());
    const enclosure = buildEnclosure(built);
    expect(await buildProblems(built, enclosure)).toEqual([]);
    const straight = buildEnclosure(plan(sided({}, {})));
    const shell = (e: typeof enclosure) => measureVolume(e.parts.find((part) => built.printedParts[part.index]!.kind === "shell")!.shape);
    // Solid, the two walls' segments would be about two thirds of 150 x 10 and 150 x 6, under a top
    // some 40 to 66 mm high, about 70 cm3. Hollow, about a third of that comes out again: the top
    // panels' screws are every 35 mm or so along each side, and the wall stays solid round each.
    const extra = shell(enclosure) - shell(straight);
    expect(measureVolume(bowHollows(built)!)).toBeGreaterThan(15_000);
    expect(extra).toBeGreaterThan(30_000);
    expect(extra).toBeLessThan(60_000);
    const reports = planPrint(built, enclosure.parts.map((part) => part.shape.mesh({ tolerance: 0.1, angularTolerance: 0.3 })));
    for (const part of built.printedParts) {
      expect(reports[part.index]!.needsSupport, `${part.name}: ${reports[part.index]!.notes.join(" ")}`).toBe(false);
    }
  }, 240_000);

  it("builds with rounded corners, a round on the side profile, and the front bowed too", async () => {
    const round = sided({}, { left: 10, front: 8 });
    round.enclosure.rounds = { rearBottom: 6 };
    round.enclosure.cornerRadius = 6;
    const built = plan(round);
    expect(await buildProblems(built, buildEnclosure(built))).toEqual([]);
  }, 240_000);
});

describe("a bowed side wall, in the form", () => {
  it("is set for one side, and leaves the file at 0", () => {
    const plain = sided({}, {});
    delete plain.enclosure.bow;
    expect(shapeValues(plain).enclosure.bow).toEqual({ front: 0, rear: 0, left: 0, right: 0 });
    const set = setBow(plain, "left", 6);
    expect(set.enclosure.bow).toEqual({ left: 6 });
    expect(setBow(set, "left", 0).enclosure.bow).toBeUndefined();
  });

  it("has a handle out from its middle, with the width's out past the curve", () => {
    const handles = handlesFor(sided(), WALLS_PATH);
    const left = handles.find((h) => h.id === "bow.left")!;
    expect(left.axis).toEqual([-1, 0, 0]);
    expect(left.at[0]).toBeLessThan(-10);
    expect(left.at[1]).toBe(75);
    expect(left.apply(sided(), 2).enclosure.bow).toEqual({ left: 12, right: 6 });
    const right = handles.find((h) => h.id === "bow.right")!;
    expect(right.apply(sided(), -1.2).enclosure.bow).toEqual({ left: 10, right: 5 });
    const width = handles.find((h) => h.id === "width")!;
    expect(width.at[0]).toBeGreaterThan(226);
    expect(width.at[2]).not.toBe(right.at[2]);
  });

  it("lights up the curve's own strip of the shape", () => {
    const config = sided();
    const model = buildSceneModel(config)!;
    expect(fieldSpot("enclosure.bow.left", config, model)).toEqual({ min: [-10, 0, 0], max: [0, 150, 66] });
    expect(fieldSpot("enclosure.bow.right", config, model)).toEqual({ min: [220, 0, 0], max: [226, 150, 66] });
  });
});
