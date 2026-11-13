// Only what actually changed should need printing again.
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { buildEnclosure, initEngine, planPrint, validateConfig, type BuildPlan, type PartPrintReport } from "../src/index.js";
import { meshFingerprint, weldMesh } from "../src/printing.js";
import { loadPrinted, markPrinted, reprintStatus, savePrinted } from "../src/app/reprint.js";
import { deskSynth } from "./helpers.js";

function plan(config: unknown): BuildPlan {
  const result = validateConfig(config);
  if (!result.ok) throw new Error(JSON.stringify(result.errors, null, 1));
  return result.plan;
}
const reportsFor = (config: unknown) => {
  const built = plan(config);
  return planPrint(built, buildEnclosure(built).parts.map((part) => part.shape.mesh({ tolerance: 0.1, angularTolerance: 0.3 })));
};
const changed = (a: PartPrintReport[], b: PartPrintReport[]) => reprintStatus(markPrinted({}, "d", a).d, b).filter((part) => part.status === "changed").map((part) => part.name);

describe("a part's fingerprint", () => {
  const triangle = (dx = 0) => weldMesh({ vertices: [dx, 0, 0, 10, 0, 0, 0, 10, 0, 0, 0, 10], triangles: [0, 1, 2, 0, 3, 1] });

  it("comes out the same for the same shape", () => expect(meshFingerprint(triangle())).toBe(meshFingerprint(triangle())));
  it("changes when the shape does", () => expect(meshFingerprint(triangle(1))).not.toBe(meshFingerprint(triangle())));
  it("sees a small move", () => expect(meshFingerprint(triangle(0.01))).not.toBe(meshFingerprint(triangle())));
  it("doesn't mind the order of the mesh", () => {
    const reordered = weldMesh({ vertices: [0, 0, 0, 10, 0, 0, 0, 10, 0, 0, 0, 10], triangles: [0, 3, 1, 0, 1, 2] });
    expect(meshFingerprint(reordered)).toBe(meshFingerprint(triangle()));
  });
});

describe("what needs reprinting", () => {
  beforeAll(() => initEngine(), 60_000);
  const base = () => reportsFor(deskSynth());
  let before: PartPrintReport[];
  beforeAll(() => {
    before = base();
  }, 180_000);

  it("is nothing if nothing changed", () => expect(changed(before, base())).toEqual([]));

  it("is only the top piece a button moved on", () => {
    const moved = deskSynth();
    moved.components.find((c: any) => c.id === "button-6").v += 0.5;
    expect(changed(before, reportsFor(moved))).toEqual(["Deck 1"]);
  }, 60_000);

  it("includes what else changes if moving it shifts the automatic screws", () => {
    // Close to the front row of screws, so one moves out of its way, and its boss and tab move too.
    const moved = deskSynth();
    moved.components.find((c: any) => c.id === "button-2").v += 1;
    expect(changed(before, reportsFor(moved))).toEqual(["Shell 1", "Deck 1", "Plate 1"]);
  }, 60_000);

  it("is whatever a fit change reaches", () => {
    const fitted = deskSynth();
    fitted.fabrication.fit = { ...fitted.fabrication.fit, screwHole: 3.6 };
    const parts = changed(before, reportsFor(fitted));
    expect(parts).toEqual(expect.arrayContaining(["Shell 1", "Shell 2", "Plate 1", "Plate 2", "Front rail"]));
    expect(parts).not.toContain("Deck 1");
    expect(parts).not.toContain("Panel 2");
  }, 60_000);

  it("counts a part that's new since", () => {
    expect(reprintStatus({ "Deck 1": "x" }, [{ name: "Deck 1", fingerprint: "x" }, { name: "Deck 2", fingerprint: "y" }])).toEqual([
      { name: "Deck 1", status: "same" },
      { name: "Deck 2", status: "changed" },
    ]);
  });

  it("says nothing before anything's marked", () => expect(reprintStatus(undefined, [{ name: "a", fingerprint: "x" }])).toEqual([]));

  it("keeps designs apart", () => {
    const record = markPrinted(markPrinted({}, "one", [{ name: "a", fingerprint: "1" }]), "two", [{ name: "a", fingerprint: "2" }]);
    expect(record).toEqual({ one: { a: "1" }, two: { a: "2" } });
  });

  describe("kept in the browser", () => {
    let store: Record<string, string>;
    beforeEach(() => {
      store = {};
      vi.stubGlobal("localStorage", { getItem: (key: string) => store[key] ?? null, setItem: (key: string, value: string) => (store[key] = value) });
    });

    it("comes back as it went in", () => {
      expect(loadPrinted()).toEqual({});
      savePrinted({ d: { a: "1" } });
      expect(loadPrinted()).toEqual({ d: { a: "1" } });
    });

    it("ignores what it can't read", () => {
      store["enclosure-generator.printed-v1"] = "not json";
      expect(loadPrinted()).toEqual({});
      store["enclosure-generator.printed-v1"] = "[1]";
      expect(loadPrinted()).toEqual({});
    });
  });
});
