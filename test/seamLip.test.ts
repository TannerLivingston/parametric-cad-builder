// A lip along the seam: the left half's outer skin reaches past it, over a step in the right half.
import { readFileSync } from "node:fs";
import { beforeAll, describe, expect, it } from "vitest";
import { makeCylinder, measureVolume, type Shape3D } from "replicad";
import { isValidSolid } from "../src/checks.js";
import { buildEnclosure, initEngine, planPrint, validateConfig, type BuildPlan } from "../src/index.js";
import { chainHeight } from "../src/profile.js";
import { LIP_GAP } from "../src/validate.js";
import { errors } from "./helpers.js";
import { setSeam, setSeamLip, shapeValues } from "../src/app/shapeEdit.js";

const v2 = () => JSON.parse(readFileSync(new URL("../examples/desk-synth-v2.json", import.meta.url), "utf8"));
const withLip = (lip: number, change: (config: any) => void = () => {}) => {
  const config = v2();
  config.seams[0].lip = lip;
  change(config);
  return config;
};
function plan(config: unknown): BuildPlan {
  const result = validateConfig(config);
  if (!result.ok) throw new Error(JSON.stringify(result.errors, null, 1));
  return result.plan;
}
const lipErrors = (config: unknown) => errors(config).filter((e) => e.path === "seams[0].lip").map((e) => e.message).join(" ");
const overlap = (a: Shape3D, b: Shape3D) => {
  try {
    return measureVolume(a.intersect(b));
  } catch (error) {
    if (String(error).includes("deleted")) throw error;
    return 0;
  }
};

beforeAll(async () => {
  await initEngine();
}, 60_000);

describe("a seam's lip, planned", () => {
  it("is off unless asked for, and makes the left half that much longer", () => {
    const flat = plan(withLip(0));
    expect(flat.seams[0]!.lip).toBe(0);
    // Longer than the pins that already stick out past the seam.
    const long = plan(withLip(8));
    // Its end slopes on by half the 3.25 mm wall.
    expect(long.printedParts[0]!.size[0]).toBeCloseTo(186 + 8 + 3.25 / 2);
    expect(plan(withLip(1.5)).printedParts[0]!.size[0]).toBeCloseTo(flat.printedParts[0]!.size[0]);
  });

  it("is refused too short, past the room kept round the seam, or on a skin too thin to halve", () => {
    expect(lipErrors(withLip(0.5))).toContain("too short");
    expect(lipErrors(withLip(20))).toContain("Make it shorter");
    expect(lipErrors(withLip(3, (c) => (c.fabrication.material = "PETG-GF")))).toContain("Make the walls and panel at least");
    expect(lipErrors(withLip(3))).toBe("");
  });
});

describe("a seam's lip, built", () => {
  const lip = 3;
  let built: BuildPlan;
  let left: Shape3D;
  let right: Shape3D;
  beforeAll(() => {
    built = plan(withLip(lip));
    const shells = buildEnclosure(built).parts.filter((part) => part.kind === "shell");
    [left, right] = [shells[0]!.shape, shells[1]!.shape];
  }, 180_000);

  it("is the outer half of the skin, past the seam, over a step in the right half", () => {
    expect(isValidSolid(left)).toBe(true);
    expect(isValidSolid(right)).toBe(true);
    const x = built.seams[0]!.x;
    // On the back, which has no top panel: its outer half belongs to the left half past the seam,
    // its inner half to the right.
    const y = 160;
    const top = chainHeight(built.profile.outer, y);
    const t = built.config.enclosure.panelThickness;
    const probe = (depth: number, from: number) => makeCylinder(0.25, 1, [from, y, top - depth], [1, 0, 0]) as Shape3D;
    expect(overlap(left, probe(t / 4, x + 1))).toBeGreaterThan(0.1);
    expect(overlap(right, probe(t / 4, x + 1))).toBeLessThan(0.001);
    expect(overlap(left, probe((3 * t) / 4, x + 1))).toBeLessThan(0.001);
    expect(overlap(right, probe((3 * t) / 4, x + 1))).toBeGreaterThan(0.1);
    // The lip's end slopes at 45 degrees, longer outside than in, and the step's start follows it.
    expect(overlap(left, probe(t / 8, x + lip + 0.1))).toBeGreaterThan(0.05);
    expect(overlap(right, probe(t / 8, x + lip + 0.1))).toBeLessThan(0.001);
    expect(overlap(left, probe(t / 8, x + lip + t / 2 + 0.1))).toBeLessThan(0.001);
    // Past it and its gap, the right half has the whole skin again.
    expect(overlap(right, probe(t / 4, x + lip + t / 2 + 2 * LIP_GAP))).toBeGreaterThan(0.1);
    // The halves don't overlap anywhere.
    expect(overlap(left, right)).toBeLessThan(0.01);
  });

  it("leaves both halves printing without support", () => {
    const shells = built.printedParts.filter((part) => part.kind === "shell").map((part) => part.index);
    const parts = buildEnclosure(built).parts;
    const reports = planPrint(built, parts.map((part) => part.shape.mesh({ tolerance: 0.1, angularTolerance: 0.3 })));
    for (const index of shells) expect(reports[index]!.needsSupport, reports[index]!.notes.join(" ")).toBe(false);
  }, 180_000);
});

describe("a seam's lip, in the form", () => {
  it("shows 0 for none, and leaves the file when set back to it", () => {
    const flat = v2();
    delete flat.seams[0].lip;
    expect(shapeValues(flat).seams[0]!.lip).toBe(0);
    const lipped = setSeamLip(flat, 2.5);
    expect(lipped.seams).toEqual([{ x: 186, lip: 2.5 }]);
    expect(setSeamLip(lipped, 0).seams).toEqual([{ x: 186 }]);
    // Moving the seam keeps it.
    expect(setSeam(lipped, 190).seams).toEqual([{ x: 190, lip: 2.5 }]);
  });
});
