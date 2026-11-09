// A thickness of its own for a surface, where it differs from the enclosure's.
import { beforeAll, describe, expect, it } from "vitest";
import { makeCylinder, measureVolume, type Shape3D } from "replicad";
import { buildEnclosure, initEngine, planFitTest, planPrint, validateConfig, type BuildPlan } from "../src/index.js";
import { chainHeight } from "../src/profile.js";
import { buildProblems } from "./buildChecks.js";
import { errors } from "./helpers.js";
import { setSurfaceThickness } from "../src/app/shapeEdit.js";

// A flat deck 2.8 mm thick, a tilted panel at the enclosure's 3 mm, and a back 4 mm thick.
const mixed = (more: Record<string, unknown> = {}): any => ({
  schemaVersion: 1,
  name: "mixed",
  enclosure: {
    width: 300,
    frontHeight: 40,
    surfaces: [
      { id: "deck", y: 80, z: 40, thickness: 2.8 },
      { id: "panel", y: 125, z: 66 },
      { id: "back", y: 190, z: 55, thickness: 4 },
    ],
  },
  seams: [{ x: 150, lip: 3 }],
  components: [
    { id: "a", type: "ttp223", surface: "deck", u: 60, v: 40 },
    { id: "b", type: "ec11-dial-19mm", surface: "panel", u: 60, v: 26 },
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
const overlap = (a: Shape3D, b: Shape3D) => {
  try {
    return measureVolume(a.intersect(b));
  } catch (error) {
    if (String(error).includes("deleted")) throw error;
    return 0;
  }
};

describe("a surface's own thickness, planned", () => {
  it("is the enclosure's unless it says, and sets how far down the inside starts", () => {
    const built = plan(mixed());
    expect(built.profile.surfaces.map((surface) => surface.thickness)).toEqual([2.8, 3, 4]);
    // Under the flat deck, the inside starts 2.8 mm down.
    expect(chainHeight(built.profile.inner, 40)).toBeCloseTo(37.2);
    // Under the back, 4 mm in along its normal.
    const back = built.profile.surfaces[2]!;
    expect(chainHeight(built.profile.outer, 160) - chainHeight(built.profile.inner, 160)).toBeCloseTo(4 / back.cos);
  });

  it("is checked against the material, and against what a part's cutout needs", () => {
    const thin = mixed();
    thin.enclosure.surfaces[0].thickness = 1;
    expect(errors(thin).map((e) => e.path)).toContain("enclosure.surfaces[0].thickness");
    // A touch pad's pocket leaves a 1 mm skin, so its own surface has to be thicker than that.
    const skin = mixed({ seams: [] });
    skin.enclosure.surfaces[0].thickness = 1;
    skin.fabrication = { minWall: 1 };
    expect(errors(skin).filter((e) => e.code === "SKIN_INVALID").map((e) => e.componentIds)).toEqual([["a"]]);
    // A label can only go as deep as its own surface leaves skin behind.
    const label = (surface: string) => mixed({ labels: [{ text: "A", surface, u: 100, v: 30, depth: 2.4 }] });
    expect(errors(label("back"))).toEqual([]);
    expect(errors(label("deck")).map((e) => e.message).join(" ")).toContain("of the 2.8 mm panel");
  });

  it("makes each top panel's piece as thick as its surface", () => {
    const built = plan(mixed({ topPanels: [{ surface: "deck", splits: [150] }, { surface: "back", splits: [150] }], components: [] }));
    const tops = built.printedParts.filter((part) => part.kind === "top");
    expect(tops.filter((part) => part.name.startsWith("Deck")).every((part) => Math.abs(part.size[2] - 2.8) < 1e-6)).toBe(true);
    const back = built.profile.surfaces[2]!;
    expect(tops.find((part) => part.name.startsWith("Back"))!.size[2]).toBeCloseTo(Math.abs(back.z1 - back.z0) + 4);
  });
});

describe("a surface's own thickness, built", () => {
  let built: BuildPlan;
  let enclosure: ReturnType<typeof buildEnclosure>;
  beforeAll(async () => {
    await initEngine();
    built = plan(mixed());
    enclosure = buildEnclosure(built);
  }, 240_000);

  it("has that much plastic under each surface, and cuts its holes that deep", async () => {
    const shell = enclosure.parts[0]!.shape;
    // Straight down through the deck at a clear spot: plastic for 2.8 mm, and none below.
    const down = (y: number, from: number, length: number) => makeCylinder(0.3, length, [100, y, from], [0, 0, -1]) as Shape3D;
    const area = Math.PI * 0.09;
    expect(overlap(shell, down(40, 41, 10))).toBeCloseTo(2.8 * area, 1);
    const back = built.profile.surfaces[2]!;
    const top = chainHeight(built.profile.outer, 160);
    expect(overlap(shell, down(160, top + 1, 15))).toBeCloseTo((4 / back.cos) * area, 1);
    expect(await buildProblems(built, enclosure)).toEqual([]);
  }, 120_000);

  it("still needs no support, lip and all", () => {
    const reports = planPrint(built, enclosure.parts.map((part) => part.shape.mesh({ tolerance: 0.1, angularTolerance: 0.3 })));
    for (const part of built.printedParts.filter((p) => p.kind === "shell")) {
      expect(reports[part.index]!.needsSupport, `${part.name}: ${reports[part.index]!.notes.join(" ")}`).toBe(false);
    }
  }, 240_000);
});

describe("a surface's own thickness, in the form", () => {
  it("is set for one surface, and leaves the file when cleared", () => {
    const set = setSurfaceThickness(mixed(), "panel", 2.5);
    expect(set.enclosure.surfaces[1]).toEqual({ id: "panel", y: 125, z: 66, thickness: 2.5 });
    expect(setSurfaceThickness(set, "panel", undefined).enclosure.surfaces[1]).toEqual({ id: "panel", y: 125, z: 66 });
    expect(set.enclosure.surfaces[0].thickness).toBe(2.8);
  });
});

describe("a surface's own thickness, in the fit test", () => {
  it("prints a part's holes in a base as thick as the surface it's on", () => {
    const rows = planFitTest(plan(mixed())).rows.filter((row) => row.kind === "part");
    expect(rows.find((row) => row.parts?.includes("ttp223"))!.thickness).toBe(2.8);
    expect(rows.find((row) => row.parts?.includes("ec11-dial-19mm"))!.thickness).toBe(3);
  });
});
