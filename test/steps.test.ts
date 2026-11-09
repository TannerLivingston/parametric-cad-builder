// The assembly steps, each with the printed parts it involves, for showing them one at a time.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { validateConfig, type BuildPlan } from "../src/index.js";

function plan(name: string): BuildPlan {
  const result = validateConfig(JSON.parse(readFileSync(`examples/${name}.json`, "utf8")));
  if (!result.ok) throw new Error(JSON.stringify(result.errors, null, 1));
  return result.plan;
}
const named = (built: BuildPlan, start: string) => {
  const step = built.steps.find((s) => s.text.startsWith(start));
  if (!step) throw new Error(`no step "${start}"`);
  return step.parts.map((index) => built.printedParts[index]!.name);
};

describe("each assembly step", () => {
  it("is the same text as the list, in the same order", () => {
    const built = plan("desk-synth-v2");
    expect(built.steps.map((step) => step.text)).toEqual(built.assembly);
  });

  it("names the parts it involves", () => {
    const built = plan("desk-synth-v2");
    expect(named(built, "Bolt the shell halves")).toEqual(["Shell 1", "Shell 2"]);
    expect(named(built, "Bolt the plate's pieces")).toEqual(["Plate 1", "Plate 2"]);
    // The crease joins the deck to the panel behind it, and the screen is on the panel's left piece.
    expect(named(built, "Lay the top pieces face down")).toEqual(["Deck 1", "Panel 1"]);
    expect(named(built, "Screw the screen to its posts")).toEqual(["Panel 1"]);
    expect(named(built, "Screw on the top pieces")).toEqual(["Shell 1", "Shell 2", "Deck 1", "Deck 2", "Panel 1", "Panel 2"]);
    expect(named(built, "Screw on the rail")).toEqual(["Shell 1", "Shell 2", "Front rail"]);
    // Inserts go in the shells, the top pieces' posts, the panel's crease bosses and the plate's rib.
    expect(named(built, "Press in the heat-set inserts")).toEqual(["Shell 1", "Shell 2", "Deck 1", "Deck 2", "Panel 1", "Panel 2", "Plate 1", "Plate 2"]);
  });

  it("puts the panel parts in only the pieces that have holes for them", () => {
    const built = plan("desk-synth");
    const pieces = named(built, "Fit the panel parts");
    expect(pieces.length).toBeGreaterThan(0);
    for (const name of pieces) expect(built.printedParts.find((p) => p.name === name)!.kind).toBe("top");
  });
});
