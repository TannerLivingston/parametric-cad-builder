// The Desk Synth V2: the plate bolted together through a rib, and the deck screwed to the screen panel.
import { readFileSync } from "node:fs";
import { beforeAll, describe, expect, it } from "vitest";
import { measureVolume } from "replicad";
import { analyseBinarySTL, isValidSolid } from "../src/checks.js";
import { buildEnclosure, initEngine, validateConfig, type BuildPlan } from "../src/index.js";

const config = () => JSON.parse(readFileSync("examples/desk-synth-v2.json", "utf8"));

beforeAll(async () => {
  await initEngine();
}, 60_000);

describe("the Desk Synth V2 example", () => {
  it("is valid, with its rib, crease, tongue and RP2350-Plus", () => {
    const result = validateConfig(config());
    expect(result.ok).toBe(true);
    const plan = (result as { plan: BuildPlan }).plan;
    expect(plan.plate!.ribs).toMatchObject([{ x: 176 }]);
    expect(plan.creases[0]!.screws.length).toBeGreaterThanOrEqual(3);
    expect(plan.topPieces.find((p) => p.name === "Panel 1")!.tongue).not.toBeNull();
    expect(plan.config.components.find((c) => c.id === "mcu")!.type).toBe("rp2350-plus");
  });

  it("builds every part sound, with none overlapping", async () => {
    const plan = (validateConfig(config()) as { plan: BuildPlan }).plan;
    const { parts } = buildEnclosure(plan);
    for (const part of parts) {
      expect(isValidSolid(part.shape), part.name).toBe(true);
      const stl = new Uint8Array(await part.shape.blobSTL({ binary: true }).arrayBuffer());
      expect(analyseBinarySTL(stl).watertight, part.name).toBe(true);
    }
    for (let i = 0; i < parts.length; i++) {
      for (let j = i + 1; j < parts.length; j++) {
        const a = parts[i]!.shape.boundingBox;
        const b = parts[j]!.shape.boundingBox;
        if (!a.isOut(b)) {
          let shared = 0;
          try {
            shared = measureVolume(parts[i]!.shape.intersect(parts[j]!.shape));
          } catch {
            shared = 0;
          }
          expect(shared, `${parts[i]!.name} and ${parts[j]!.name}`).toBeLessThan(0.001);
        }
      }
    }
  }, 300_000);
});
