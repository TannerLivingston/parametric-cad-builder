// A band round the seam: the walls, and the skin under the top where there's no top panel, thickened
// inward near it, so that a tongue fits in a thin skin, as on the real Desk Synth.
import { beforeAll, describe, expect, it } from "vitest";
import { makeBox, type Shape3D } from "replicad";
import { isValidSolid } from "../src/checks.js";
import { buildEnclosure, initEngine, planPrint, validateConfig, type BuildPlan, type Enclosure } from "../src/index.js";
import { BAND_FULL, bandReach, seamTongueHalf, TONGUE_GAP } from "../src/validate.js";
import { buildProblems, overlap } from "./buildChecks.js";
import { deskSynth, errors } from "./helpers.js";

const box = (seam: Record<string, unknown>, more: Record<string, unknown> = {}, enclosure: Record<string, unknown> = {}): any => ({
  schemaVersion: 1,
  name: "banded",
  enclosure: { width: 300, frontHeight: 50, surfaces: [{ id: "top", y: 140, z: 50 }], wall: 3, panelThickness: 3, ...enclosure },
  seams: [{ x: 150, ...seam }],
  components: [],
  ...more,
});
function plan(config: unknown): BuildPlan {
  const result = validateConfig(config);
  if (!result.ok) throw new Error(JSON.stringify(result.errors, null, 1));
  return result.plan;
}
const seamErrors = (config: unknown, field: string) => errors(config).filter((e) => e.path === `seams[0].${field}`).map((e) => e.message).join(" ");
// A little cube at a point, to find out which piece has material there.
const at = (x: number, y: number, z: number) => makeBox([x - 0.15, y - 0.15, z - 0.15], [x + 0.15, y + 0.15, z + 0.15]) as Shape3D;
const has = (piece: Shape3D, x: number, y: number, z: number) => overlap(piece, at(x, y, z)) > 0.02;

beforeAll(async () => {
  await initEngine();
}, 180_000);

describe("a band round the seam, planned", () => {
  it("is off unless asked for, and sizes the tongue from the skin it makes", () => {
    const plain = plan(box({ tongue: 2.5 }, {}, { wall: 5, panelThickness: 5 })).seams[0]!;
    expect(plain.band).toBe(0);
    expect(plain.bandSections).toEqual([]);
    const banded = plan(box({ tongue: 2.5, band: 3 }));
    // A 3 mm skin and a 3 mm band make 6 mm, and a 2 mm tongue in its middle, as on the real one.
    expect(banded.printedParts[0]!.size[0]).toBeCloseTo(150 + 2.5 + seamTongueHalf(6));
    expect(banded.seams[0]!.bandReach).toEqual(bandReach({ tongue: 2.5, band: 3 }, 6));
    expect(banded.seams[0]!.bandReach[0]).toBeCloseTo(BAND_FULL + 3);
    expect(banded.seams[0]!.bandReach[1]).toBeCloseTo(2.5 + 1 + TONGUE_GAP + BAND_FULL + 3);
    // It goes all the way round when nothing's in its way: down the front wall, under the top, and
    // down the rear wall, but not across the open base.
    const sections = banded.seams[0]!.bandSections;
    expect(banded.seams[0]!.bandFrom).toBe(0);
    const ys = sections.flat().map(([y]) => y);
    expect(Math.min(...ys)).toBeCloseTo(3);
    expect(Math.max(...ys)).toBeCloseTo(137);
    expect(Math.min(...sections.flat().map(([, z]) => z))).toBeCloseTo(3);
  });

  it("lets a tongue go in a skin too thin for it alone, and says so when it's missing", () => {
    expect(seamErrors(box({ tongue: 2.5 }), "tongue")).toContain("with a band of 1.2 mm");
    expect(seamErrors(box({ tongue: 2.5, band: 1.2 }), "tongue")).toBe("");
    expect(seamErrors(box({ tongue: 2.5, band: 3 }), "tongue")).toBe("");
    expect(seamErrors(box({ tongue: 2.5, band: 3 }), "band")).toBe("");
  });

  it("is refused without a tongue, past the rib on the left or the room round the seam on the right, too thick for the rounds, or with a bowed wall", () => {
    expect(seamErrors(box({ band: 3 }), "band")).toContain("needs one");
    expect(seamErrors(box({ tongue: 2.5, band: 4 }), "band")).toContain("past its rib");
    expect(seamErrors(box({ tongue: 9, band: 3 }), "band")).toContain("Make the band or the tongue shorter");
    expect(seamErrors(box({ tongue: 2.5, band: 3 }, {}, { rounds: { frontBottom: 6 } }), "band")).toContain("rounds");
    expect(seamErrors(box({ tongue: 2.5, band: 3 }, {}, { bow: { front: 4 } }), "tongue")).toContain("bowed");
  });

  it("starts behind an opening near the seam, and the room kept for what it holds", () => {
    const opened = plan(box({ tongue: 2.5, band: 3 }, { opening: { xMin: 152, xMax: 280, yEnd: 60, sill: 10, keepOut: [{ xMin: 148, xMax: 284, yMin: 3.5, yMax: 70, top: 8 }] } })).seams[0]!;
    expect(opened.bandFrom).toBeCloseTo(70);
    expect(Math.min(...opened.bandSections.flat().map(([y]) => y))).toBeCloseTo(70);
    // Just past the end of the band, an opening doesn't move it.
    const apart = plan(box({ tongue: 2.5, band: 3 }, { opening: { xMin: 159, xMax: 280, yEnd: 60, sill: 10 } })).seams[0]!;
    expect(apart.bandFrom).toBe(0);
  });

  it("keeps cutouts in the skin clear of it, by its own reach", () => {
    // An arcade button's cutout reaches 17.26 mm from its middle. Clear of the rib, but not of the band.
    const button = (u: number) => box({ tongue: 2.5, band: 3 }, { components: [{ id: "b", type: "arcade-24mm", surface: "top", u, v: 70 }] });
    expect(errors(button(150 + 17.26 + 7)).map((e) => e.message).join(" ")).toContain("crowds the band");
    expect(errors(button(150 + 17.26 + 10)).filter((e) => e.code === "CUTOUT_HITS_RIB")).toEqual([]);
  });

  it("lets the Desk Synth example have the real one's tongue, starting on its back behind the display, with a key", () => {
    const example = plan(deskSynth());
    const seam = example.seams[0]!;
    expect(seam).toMatchObject({ tongue: 2.5, band: 3, keys: true });
    // The real band starts at y = 127, on the back just behind the ridge.
    expect(seam.bandFrom).toBeGreaterThan(120.7);
    expect(seam.bandFrom).toBeLessThan(130);
    expect(seam.rearKeys).toHaveLength(1);
  });
});

describe("a band round the seam, built", () => {
  let built: BuildPlan;
  let left: Shape3D;
  let right: Shape3D;
  let enclosure: Enclosure;
  beforeAll(() => {
    built = plan(box({ tongue: 2.5, band: 3 }));
    enclosure = buildEnclosure(built);
    const shells = enclosure.parts.filter((part) => part.kind === "shell");
    [left, right] = [shells[0]!.shape, shells[1]!.shape];
  }, 180_000);

  it("thickens the skin round the seam, full near it and sloping back to the skin", () => {
    expect(isValidSolid(left)).toBe(true);
    expect(isValidSolid(right)).toBe(true);
    // Under the top, between the rib's tabs, where the 3 mm skin is 47 to 50 mm up and the band 3 more.
    // It's full from 148.5 to 155.2, and slopes away over 3 mm either side of that.
    expect(has(left, 149, 70, 44.5)).toBe(true);
    expect(has(left, 148, 70, 45)).toBe(true);
    expect(has(left, 146, 70, 45.5)).toBe(false);
    expect(has(left, 144, 70, 46.5)).toBe(false);
    expect(has(right, 155, 70, 44.5)).toBe(true);
    expect(has(right, 156.5, 70, 45.5)).toBe(true);
    expect(has(right, 159, 70, 46.5)).toBe(false);
  });

  it("has the tongue in the middle of the thickened skin, in a groove in the right piece", () => {
    // The middle of the 6 mm is 3 mm in, straddling the wall's own inside face.
    for (const [y, z] of [[3, 25], [3.8, 25], [70, 47], [70, 46.2]] as const) {
      expect(has(left, 151, y, z), `tongue at y ${y}, z ${z}`).toBe(true);
      expect(has(right, 151, y, z), `groove at y ${y}, z ${z}`).toBe(false);
    }
    for (const [y, z] of [[0.6, 25], [5.4, 25], [70, 49.4], [70, 44.6]] as const) {
      expect(has(right, 151, y, z), `right piece at y ${y}, z ${z}`).toBe(true);
      expect(has(left, 151, y, z), `left piece at y ${y}, z ${z}`).toBe(false);
    }
    expect(overlap(left, right)).toBeLessThan(0.001);
  });

  it("stays above the plate where a wall comes straight down to it", () => {
    // The plate's top is at 3 mm. Below it the wall is as it was, with no band, tongue or groove.
    expect(has(right, 151, 2.4, 1.5)).toBe(true);
    expect(has(left, 151, 2.4, 1.5)).toBe(false);
    expect(has(right, 151, 4.5, 1.5)).toBe(false);
    expect(has(left, 151, 4.5, 1.5)).toBe(false);
  });

  it("builds sound, and no shell piece needs support", async () => {
    expect(await buildProblems(built, enclosure)).toEqual([]);
    const reports = planPrint(built, enclosure.parts.map((part) => part.shape.mesh({ tolerance: 0.1, angularTolerance: 0.3 })));
    for (const part of built.printedParts.filter((p) => p.kind === "shell")) {
      expect(reports[part.index]!.needsSupport, `${part.name}: ${reports[part.index]!.notes.join(" ")}`).toBe(false);
    }
  }, 240_000);

  it("prints a piece between two seams, standing on its grooved end, without support", async () => {
    const three = plan(box({ x: 160, tongue: 2.5, band: 3 }, { seams: [{ x: 160, tongue: 2.5, band: 3 }, { x: 320, tongue: 2.5, band: 3 }] }, { width: 480 }));
    const built3 = buildEnclosure(three);
    expect(await buildProblems(three, built3)).toEqual([]);
    const reports = planPrint(three, built3.parts.map((part) => part.shape.mesh({ tolerance: 0.1, angularTolerance: 0.3 })));
    // The piece between the seams, which stands on its grooved end, the band's full end under it. The
    // end pieces print as they would with a plain seam: in this box, the left one needs a little support
    // with or without a band.
    const middle = three.printedParts.filter((p) => p.kind === "shell")[1]!;
    expect(reports[middle.index]!.needsSupport, `${middle.name}: ${reports[middle.index]!.notes.join(" ")}`).toBe(false);
    expect(reports[middle.index]!.reports[0]!.label).toMatch(/Left wall/);
    expect(reports[three.printedParts.filter((p) => p.kind === "shell")[2]!.index]!.needsSupport).toBe(false);
  }, 300_000);

  it("builds the Desk Synth example sound, with neither shell piece needing support", async () => {
    const example = plan(deskSynth());
    const desk = buildEnclosure(example);
    expect(await buildProblems(example, desk)).toEqual([]);
    const reports = planPrint(example, desk.parts.map((part) => part.shape.mesh({ tolerance: 0.1, angularTolerance: 0.3 })));
    const shells = example.printedParts.filter((p) => p.kind === "shell");
    for (const part of shells) {
      expect(reports[part.index]!.needsSupport, `${part.name}: ${reports[part.index]!.notes.join(" ")}`).toBe(false);
    }
    // On the back, past where the band starts, the tongue is in the left piece, just past the seam.
    const [l, r] = shells.map((part) => desk.parts[part.index]!.shape);
    const back = example.profile.surfaces.find((s) => s.id === "back")!;
    const y = 160;
    const outside = back.z0 + ((y - back.y0) * (back.z1 - back.z0)) / (back.y1 - back.y0);
    // 3 mm deep into the 3 mm skin and 3 mm band, along the normal, near enough on a shallow slope.
    expect(has(l!, 187, y, outside - 3)).toBe(true);
    expect(has(r!, 187, y, outside - 3)).toBe(false);
    expect(has(r!, 187, y, outside - 5.5)).toBe(true);
  }, 300_000);
});

describe("a band round the seam, in the form", () => {
  it("is set on its own, and leaves the file at 0", async () => {
    const { updateSeam } = await import("../src/app/shapeEdit.js");
    const set = updateSeam(box({ tongue: 2.5 }), 0, { band: 3 });
    expect(set.seams[0]).toEqual({ x: 150, tongue: 2.5, band: 3 });
    expect(updateSeam(set, 0, { band: 0 }).seams[0]).toEqual({ x: 150, tongue: 2.5 });
    expect(updateSeam(set, 0, { x: 160 }).seams[0]).toEqual({ x: 160, tongue: 2.5, band: 3 });
  });
});
