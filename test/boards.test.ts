// Cradles for boards without mounting holes, from their makers' sizes.
import { beforeAll, describe, expect, it } from "vitest";
import { isValidSolid } from "../src/checks.js";
import { buildEnclosure, buildFitTest, initEngine, planFitTest, validateConfig, type BuildPlan } from "../src/index.js";
import { library } from "../src/library.js";
import type { FloorPart } from "../src/schema.js";

const CRADLED = ["teensy-40", "teensy-41", "arduino-nano", "seeed-xiao"];
const box = (components: unknown[], more: Record<string, unknown> = {}): any => ({
  schemaVersion: 1,
  name: "b",
  enclosure: { width: 120, frontHeight: 30, cornerRadius: 3, surfaces: [{ id: "top", y: 80, z: 30 }] },
  components,
  ...more,
});
function plan(config: unknown): BuildPlan {
  const result = validateConfig(config);
  if (!result.ok) throw new Error(JSON.stringify(result.errors, null, 1));
  return result.plan;
}

beforeAll(async () => {
  await initEngine();
}, 60_000);

describe("cradled boards", () => {
  it.each(CRADLED)("%s sits in a cradle, its USB through the left wall when it's against it, and counts its pins", (type) => {
    const part = library[type] as FloorPart;
    expect(part.source).toBe("datasheet");
    expect(part.pins?.gpio).toBeGreaterThan(0);
    const width = part.footprint.shape === "rect" ? part.footprint.width : 0;
    const placed = plan(box([{ id: "mcu", type, x: 3 + width / 2 + 0.5, y: 40 }]));
    const kinds = placed.holderBlocks.map((block) => block.kind);
    expect(kinds).toContain("pad");
    expect(kinds).toContain("clip");
    expect(kinds).toContain("stop");
    expect(placed.wallHoles).toHaveLength(1);
    expect(placed.wallHoles[0]!.wall).toBe("left");
    expect(placed.pins!.controller).toBe("mcu");
    expect(buildEnclosure(placed).parts.every((p) => isValidSolid(p.shape))).toBe(true);
  }, 60_000);

  it("can each have their clips tried in the fit test", () => {
    const test = planFitTest(plan(box([], { fabrication: { fitTestParts: CRADLED } })));
    for (const type of CRADLED) expect(test.rows.some((row) => row.parts.includes(type) || row.title.includes(library[type]!.name)), type).toBe(true);
    expect(buildFitTest(test).every((p) => isValidSolid(p.shape))).toBe(true);
  }, 120_000);
});
