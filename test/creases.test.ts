// Joining two top pieces at a crease, with a flange under the front one screwed into bosses under the next.
import { beforeAll, describe, expect, it } from "vitest";
import { makeBox, makeCylinder, measureVolume, type Shape3D } from "replicad";
import { buildEnclosure, initEngine, orientationsFor, validateConfig, type BuildPlan } from "../src/index.js";
import { planPartPrint } from "../src/printing.js";
import { isValidSolid } from "../src/checks.js";
import { clearSpans, CREASE_BOSS_LENGTH, CREASE_FLANGE_THICKNESS, CREASE_SCREW_DROP, layoutCreaseScrews, undersideAt } from "../src/crease.js";
import { errors, deskSynth } from "./helpers.js";

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
const cube = (x: [number, number], y: [number, number], z: [number, number]) => makeBox([x[0], y[0], z[0]], [x[1], y[1], z[1]]) as unknown as Shape3D;
function creased(change?: (config: any) => void) {
  const config = deskSynth();
  config.topPanels[0].crease = "screws";
  change?.(config);
  return config;
}

beforeAll(async () => {
  await initEngine();
}, 60_000);

describe("a crease joint", () => {
  it("is only there when a panel asks for it", () => {
    expect(plan(deskSynth()).creases).toEqual([]);
    const joint = plan(creased()).creases[0]!;
    const buildPlan = plan(creased());
    expect(buildPlan.topPieces[joint.front]!.name).toBe("Deck 1");
    expect(buildPlan.topPieces[joint.rear]!.name).toBe("Panel 1");
  });

  it("meets where the two pieces' undersides do, with its screws under the front piece", () => {
    const buildPlan = plan(creased());
    const joint = buildPlan.creases[0]!;
    const [deck, panel] = buildPlan.profile.surfaces;
    const t = buildPlan.config.enclosure.panelThickness;
    expect(undersideAt(deck!, t, joint.y)).toBeCloseTo(undersideAt(panel!, t, joint.y), 6);
    expect(joint.z).toBeCloseTo(undersideAt(deck!, buildPlan.config.enclosure.panelThickness, joint.y) - CREASE_SCREW_DROP);
    expect(joint.screws.length).toBeGreaterThanOrEqual(3);
    for (const x of joint.screws) expect(joint.spans.some(([a, b]) => x > a && x < b)).toBe(true);
  });

  it("needs a top panel on the surface behind", () => {
    const config = deskSynth();
    config.topPanels[1].crease = "screws";
    expect(errors(config).find((e) => e.code === "TOP_PANEL_INVALID")?.message).toContain("crease");
  });

  it("keeps the flange and bosses clear of what's around the crease", () => {
    const base = plan(creased()).creases[0]!;
    const [from] = base.spans[0]!;
    // A screen whose body hangs under the deck by the crease.
    const dial = plan(
      creased((c) => {
        c.components = c.components.filter((part: any) => part.id !== "button-6" && part.id !== "button-7");
        c.components.push({ id: "near", type: "oled-ssd1306", surface: "deck", u: 70, v: 60 });
      }),
    ).creases[0]!;
    expect(dial.spans.some(([a, b]) => a < 70 && b > 70)).toBe(false);
    // Something on the plate, tall enough to reach the flange.
    const tall = plan(
      creased((c) => {
        c.customParts = { block: { name: "Block", source: "estimated", mount: "floor", footprint: { shape: "rect", width: 10, height: 6 }, height: 15 } };
        c.components.push({ id: "tall", type: "block", x: 71, y: 77 });
      }),
    );
    expect(tall.creases[0]!.spans.some(([a, b]) => a < 71 && b > 71)).toBe(false);
    // The wall's top screw at the left end is what stops it there now.
    expect(from).toBeGreaterThan(plan(creased()).topScrews.find((s) => s.piece === 0 && s.wall === "left" && s.y > 60)!.x);
  });

  // Parts with one thing near the crease each: a body below, a post, or a hole.
  const custom = (id: string, part: object, at: object) =>
    creased((c) => {
      c.components = c.components.filter((p: any) => p.id !== "button-6");
      c.customParts = { [id]: { name: id, source: "estimated", mount: "panel", above: { footprint: { shape: "circle", diameter: 8 }, height: 2 }, ...part } };
      c.components.push({ id, type: id, surface: "deck", ...at });
    });
  const covers = (buildPlan: BuildPlan, x: number) => buildPlan.creases[0]!.spans.some(([a, b]) => a < x && b > x);

  it("keeps clear of a part's body, its posts and its holes, each on its own", () => {
    const body = { cutouts: [{ kind: "circle", diameter: 6 }], below: { footprint: { shape: "rect", width: 10, height: 30 }, depth: 12 } };
    expect(covers(plan(custom("body", body, { u: 56, v: 60 })), 56)).toBe(false);
    const post = { cutouts: [{ kind: "circle", diameter: 6 }], posts: [{ at: [0, 13], diameter: 3.5, reach: 4, holeDiameter: 1.6, holeDepth: 2 }], below: { footprint: { shape: "circle", diameter: 8 }, depth: 0 } };
    expect(covers(plan(custom("post", post, { u: 56, v: 60 })), 56)).toBe(false);
    const hole = { cutouts: [{ kind: "rect", width: 6, height: 3 }], below: { footprint: { shape: "rect", width: 6, height: 3 }, depth: 0 } };
    expect(covers(plan(custom("hole", hole, { u: 56, v: 72.5 })), 56)).toBe(false);
    // And none of them when they're further forward.
    expect(covers(plan(custom("hole", hole, { u: 56, v: 66 })), 56)).toBe(true);
  });

  it("keeps clear of a support under it", () => {
    expect(covers(plan(creased((c) => (c.plate = { ...c.plate, supports: [{ x: 71, y: 78 }] }))), 71)).toBe(false);
  });

  it("moves a screw off the way of a post on the front piece", () => {
    const screws = plan(creased()).creases[0]!.screws;
    const post = { cutouts: [{ kind: "circle", diameter: 6, at: [0, 10] }], posts: [{ at: [0, 0], diameter: 3.5, reach: 4, holeDiameter: 1.6, holeDepth: 2 }], below: { footprint: { shape: "circle", diameter: 8 }, depth: 0 } };
    const x = screws[1]!;
    const moved = plan(custom("post", post, { u: x, v: 55 })).creases[0]!.screws;
    expect(moved.every((s) => Math.abs(s - x) >= 1.75 + 3)).toBe(true);
  });

  it("warns where two pieces meet with no room for a screw", () => {
    const result = validateConfig(creased());
    expect(result.warnings.some((w) => w.message.includes("Deck 2 and Panel 2 have no room for a screw along their crease"))).toBe(true);
  });

  it("builds the flange on the front piece and the bosses on the one behind, apart", () => {
    const buildPlan = plan(creased());
    const joint = buildPlan.creases[0]!;
    const { parts } = buildEnclosure(buildPlan);
    const shape = (name: string) => parts.find((p) => p.name === name)!.shape;
    const deck = shape("Deck 1");
    const panel = shape("Panel 1");
    expect(isValidSolid(deck) && isValidSolid(panel)).toBe(true);
    expect(overlap(deck, panel)).toBeLessThan(0.001);
    for (const other of ["Shell 1", "Shell 2", "Plate 1"]) expect(overlap(deck, shape(other)) + overlap(panel, shape(other))).toBeLessThan(0.001);
    const x = joint.screws[1]!;
    const inside = (part: Shape3D, solid: Shape3D) => overlap(part, solid) / measureVolume(solid);
    // Flange, beside its screw's hole, and the hole itself.
    expect(inside(deck, cube([x + 2.5, x + 4], [joint.y - CREASE_FLANGE_THICKNESS + 0.1, joint.y - 0.1], [joint.flangeBottom + 0.1, joint.z + 3]))).toBeGreaterThan(0.999);
    expect(overlap(deck, makeCylinder(1.5, CREASE_FLANGE_THICKNESS, [x, joint.y - CREASE_FLANGE_THICKNESS, joint.z], [0, 1, 0]) as Shape3D)).toBeLessThan(0.001);
    // A boss, with its insert hole.
    expect(inside(panel, cube([x + 2.2, x + 3.5], [joint.y + 0.5, joint.y + CREASE_BOSS_LENGTH - 0.5], [joint.z - 1, joint.z + 1]))).toBeGreaterThan(0.999);
    expect(overlap(panel, makeCylinder(1.8, 5.5, [x, joint.y, joint.z], [0, 1, 0]) as Shape3D)).toBeLessThan(0.001);
    // Face down, the bosses start from the panel's own edge, and their holes have a point on the side that's up.
    const index = buildPlan.printedParts.findIndex((p) => p.name === "Panel 1");
    const report = planPartPrint(buildPlan.printedParts[index]!, panel.mesh({ tolerance: 0.1, angularTolerance: 0.3 }), orientationsFor(buildPlan, buildPlan.printedParts[index]!), buildPlan.config.fabrication.buildVolume);
    expect(report.best.label).toContain("surface on the bed");
    expect(report.needsSupport).toBe(false);
  }, 120_000);

  it("adds its screws to the hardware, and screwing them to the steps before the screen", () => {
    const buildPlan = plan(creased());
    const count = buildPlan.creases.reduce((sum, joint) => sum + joint.screws.length, 0);
    expect(buildPlan.hardware).toEqual(expect.arrayContaining([{ name: "M3 x 8 screw, for the creases", count }, { name: "M3 brass heat-set insert, for the creases", count }]));
    const steps = buildPlan.assembly;
    const at = steps.findIndex((step) => step.includes("along each crease"));
    expect(at).toBeGreaterThan(0);
    expect(at).toBeLessThan(steps.findIndex((step) => step.startsWith("Screw the screen")));
  });
});

describe("laying out a crease", () => {
  it("takes what's blocked out of a range, and drops what's too short", () => {
    expect(clearSpans(0, 100, [[20, 30], [50, 52]], 10)).toEqual([[0, 20], [30, 50], [52, 100]]);
    expect(clearSpans(0, 100, [[5, 95]], 10)).toEqual([]);
  });

  it("spreads screws along each stretch, and moves one off something in the driver's way", () => {
    layoutCreaseScrews([[0, 100]], () => false).forEach((x, i) => expect(x).toBeCloseTo([6, 35.33, 64.67, 94][i]!));
    const moved = layoutCreaseScrews([[0, 100]], (x) => Math.abs(x - 35.33) < 5);
    expect(moved.every((x) => Math.abs(x - 35.33) >= 5)).toBe(true);
    expect(moved).toHaveLength(4);
    // A short stretch still gets one, in its middle.
    expect(layoutCreaseScrews([[0, 11]], () => false)).toEqual([5.5]);
  });
});
