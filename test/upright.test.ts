// A shell with no seam prints upright, base down, so what would hang over the bed is shaped not to.
import { readFileSync } from "node:fs";
import { beforeAll, describe, expect, it } from "vitest";
import { makeCylinder, measureVolume, type Shape3D } from "replicad";
import { isValidSolid } from "../src/checks.js";
import { buildEnclosure, initEngine, planPrint, validateConfig, type BuildPlan } from "../src/index.js";
import { bossFeet } from "../src/plate.js";
import { tabGussetDepth, topTabExtent } from "../src/top.js";
import { plateInput } from "../src/validate.js";
import { TEMPLATES } from "../src/app/templates.js";

function plan(config: unknown): BuildPlan {
  const result = validateConfig(config);
  if (!result.ok) throw new Error(JSON.stringify(result.errors, null, 1));
  return result.plan;
}
const dialDeck = () => JSON.parse(readFileSync(new URL("../examples/dial-deck.json", import.meta.url), "utf8"));
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

describe("the Dial deck, printed upright", () => {
  let built: BuildPlan;
  let parts: ReturnType<typeof buildEnclosure>["parts"];
  beforeAll(() => {
    built = plan(dialDeck());
    parts = buildEnclosure(built).parts;
  }, 120_000);

  it("needs no support for any part", () => {
    const reports = planPrint(built, parts.map((part) => part.shape.mesh({ tolerance: 0.1, angularTolerance: 0.3 })));
    for (const report of reports) expect(report.needsSupport, `${report.name}: ${report.notes.join(" ")}`).toBe(false);
  }, 60_000);

  it("slopes each plate boss's underside up from its wall, with a wedge on the plate under it", () => {
    const shell = parts.find((p) => p.kind === "shell")!.shape;
    const plate = parts.find((p) => p.kind === "plate")!.shape;
    expect(isValidSolid(plate)).toBe(true);
    const floor = built.config.enclosure.floorThickness;
    const input = plateInput(built.config, built.profile);
    for (const [x, y] of built.plate!.screws) {
      const [foot] = bossFeet(input, x, y);
      expect(foot, `${x}, ${y}`).toBeDefined();
      // 3 mm out from the wall, and 2.5 along it, clear of the screw: just above the plate, it's under
      // the slope, so plate rather than shell.
      const at = foot!.at + foot!.inward * 3;
      const probeAt = (z: number) => makeCylinder(0.3, 1, foot!.axis === "y" ? [x + 2.5, at, z] : [at, y + 2.5, z], [0, 0, 1]);
      const probe = probeAt(floor + 0.5);
      expect(overlap(shell, probe), `shell at ${x}, ${y}`).toBeLessThan(0.001);
      expect(overlap(plate, probe), `plate at ${x}, ${y}`).toBeGreaterThan(0.2);
      // And above the slope, boss.
      const above = probeAt(floor + 3.5);
      expect(overlap(shell, above), `boss at ${x}, ${y}`).toBeGreaterThan(0.2);
    }
  });

  it("lists longer plate screws for it, and flat heads for the top", () => {
    const lift = Math.min(...built.plate!.lifts);
    expect(lift).toBeGreaterThan(5);
    expect(built.hardware).toContainEqual({ name: "M3 x 12 flat-head screw", count: built.plate!.screws.length });
    expect(built.hardware).toContainEqual({ name: "M3 x 8 flat-head screw, for the top panels", count: built.topScrews.length });
  });

  it("puts top screws only where their tab's whole gusset fits", () => {
    const e = built.config.enclosure;
    for (const screw of built.topScrews) {
      const tab = topTabExtent(screw, e.wall, e.width, built.profile.depth - e.wall, false);
      const reach = screw.wall === "left" || screw.wall === "right" ? tab.xHigh - tab.xLow : tab.yHigh - tab.yLow;
      expect(tabGussetDepth(tab, screw.wall, e.floorThickness), `${screw.wall} at ${screw.x}, ${screw.y}`).toBeGreaterThanOrEqual(reach - 0.9);
    }
  });
});

describe("top screws on an upright shell", () => {
  it("go on no rear edge, which has nothing under it", () => {
    for (const template of TEMPLATES) {
      const built = plan(template.make());
      if (built.shellOnSide) continue;
      expect(built.topScrews.filter((s) => s.wall === "rear"), template.name).toEqual([]);
    }
  });

  it("still go on a box too low for a whole gusset anywhere", () => {
    const low = { schemaVersion: 1, name: "low", enclosure: { width: 240, frontHeight: 24, surfaces: [{ id: "top", y: 150, z: 24 }] }, topPanels: [{ surface: "top" }] };
    expect(plan(low).topScrews.length).toBeGreaterThan(2);
  });
});
