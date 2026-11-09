// Which parts can share a print: each colour packed onto as few beds as it fits.
import { beforeAll, describe, expect, it } from "vitest";
import { BED_EDGE, BED_GAP, bedsFor, describeBed, layoutBeds, type Bed, type BedItem } from "../src/bedLayout.js";
import { buildEnclosure, initEngine, planPrint, printGuide, validateConfig, type BuildPlan } from "../src/index.js";
import { deskSynth } from "./helpers.js";

const bed = { x: 256, y: 256 };
let next = 0;
const item = (width: number, depth: number, more: Partial<BedItem> = {}): BedItem => {
  next += 1;
  return { index: next, name: `Part ${next}`, color: "#fff", width, depth, height: 10, hours: 1, grams: 10, ...more };
};
function checkFits(beds: Bed[]) {
  for (const each of beds) {
    for (const placed of each.items) {
      expect(placed.x).toBeGreaterThanOrEqual(BED_EDGE - 1e-9);
      expect(placed.y).toBeGreaterThanOrEqual(BED_EDGE - 1e-9);
      expect(placed.x + placed.width).toBeLessThanOrEqual(bed.x - BED_EDGE + 1e-9);
      expect(placed.y + placed.depth).toBeLessThanOrEqual(bed.y - BED_EDGE + 1e-9);
    }
    each.items.forEach((a, i) =>
      each.items.slice(i + 1).forEach((b) => {
        const apart = Math.max(b.x - (a.x + a.width), a.x - (b.x + b.width), b.y - (a.y + a.depth), a.y - (b.y + b.depth));
        expect(apart, `${a.name} and ${b.name}`).toBeGreaterThanOrEqual(BED_GAP - 1e-9);
      }),
    );
  }
}

beforeAll(async () => {
  await initEngine();
}, 60_000);

describe("sharing the bed", () => {
  it("puts small parts of one colour together, apart and on the bed", () => {
    const beds = layoutBeds([item(100, 100), item(100, 100), item(50, 40), item(30, 30)], bed);
    expect(beds).toHaveLength(1);
    expect(beds[0]!.items).toHaveLength(4);
    expect(beds[0]!.hours).toBe(4);
    expect(beds[0]!.grams).toBe(40);
    checkFits(beds);
  });

  it("never mixes colours", () => {
    const beds = layoutBeds([item(50, 50, { color: "#000" }), item(50, 50, { color: "#fff" })], bed);
    expect(beds.map((b) => b.color)).toEqual(["#000", "#fff"]);
  });

  it("turns a part a quarter to fit beside another", () => {
    const beds = layoutBeds([item(200, 100), item(100, 30)], bed);
    expect(beds).toHaveLength(1);
    expect(beds[0]!.items.find((p) => p.width === 30)?.turned).toBe(true);
    checkFits(beds);
  });

  it("starts another bed when one is full, and gives a part too big for any its own", () => {
    const beds = layoutBeds([item(200, 200), item(200, 200), item(300, 50)], bed);
    expect(beds).toHaveLength(3);
    checkFits(beds.filter((b) => b.items.every((p) => p.width <= 246)));
  });

  it("packs many parts without overlap, and the same way every time", () => {
    const many = Array.from({ length: 30 }, (_, i) => item(10 + ((i * 37) % 90), 10 + ((i * 53) % 70)));
    const once = layoutBeds(many, bed);
    checkFits(once);
    expect(layoutBeds(many, bed)).toEqual(once);
    expect(once.reduce((sum, b) => sum + b.items.length, 0)).toBe(30);
  });

  it("names a turned part", () => {
    expect(describeBed({ color: "#fff", hours: 1, grams: 1, height: 1, items: [{ index: 1, name: "Deck 2", x: 5, y: 5, width: 1, depth: 1, turned: false }, { index: 2, name: "Rail", x: 9, y: 5, width: 1, depth: 1, turned: true }] })).toBe("Deck 2 and Rail turned a quarter");
  });

  it("puts the Desk Synth's small parts together, and says so in the print guide", () => {
    const result = validateConfig(deskSynth());
    const plan = (result as { plan: BuildPlan }).plan;
    const { parts } = buildEnclosure(plan);
    const reports = planPrint(plan, parts.map((p) => p.shape.mesh({ tolerance: 0.1, angularTolerance: 0.3 })));
    const beds = bedsFor(plan, reports);
    expect(beds.length).toBeLessThan(reports.length);
    for (const each of beds) for (const placed of each.items) expect(plan.printedParts[placed.index]!.color).toBe(each.color);
    expect(printGuide(plan, reports)).toContain("Sharing the bed");
    // And what to buy, before how to put it together.
    const guide = printGuide(plan, reports);
    expect(guide).toContain(`- ${plan.hardware[0]!.count} x ${plan.hardware[0]!.name}`);
    expect(guide.indexOf("\nHardware\n")).toBeLessThan(guide.indexOf("Putting it together"));
  }, 120_000);
});
