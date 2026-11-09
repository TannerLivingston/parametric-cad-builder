// What a fit test showed has to carry over to other designs, without changing what's in a saved file
// until it's asked to.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { validateConfig } from "../src/index.js";
import { applyProfile, loadProfile, mergeProfile, profileDifferences, profileFromConfig, profileSummary, saveProfile, type PrinterProfile } from "../src/app/printerProfile.js";

const box = (more: Record<string, unknown> = {}): any => ({ schemaVersion: 1, name: "box", enclosure: { width: 200, frontHeight: 40, surfaces: [{ id: "top", y: 120, z: 40 }] }, ...more });
const tuned: PrinterProfile = { insertHole: 4.1, insertHoleSideways: 4.2, screwHole: 3.5, clipGap: 0.1, pinSocket: 4.4, plateClearance: 0.35, partHoles: { "arcade-24mm": 0.15, "pot-9mm": -0.1 } };
const usual: PrinterProfile = { insertHole: 4, insertHoleSideways: 4, screwHole: 3.4, clipGap: 0.2, pinSocket: 4.3, plateClearance: 0.25, partHoles: {} };
const button = { id: "b", type: "arcade-24mm", surface: "top", u: 100, v: 60 };

describe("a printer profile", () => {
  it("reads what a design has, with the defaults", () => {
    expect(profileFromConfig(box())).toEqual(usual);
    const config = box({ fabrication: { fit: { insertHole: 4.1, partHoles: { x: 0.1 } } }, plate: { clearance: 0.3 } });
    expect(profileFromConfig(config)).toEqual({ ...usual, insertHole: 4.1, plateClearance: 0.3, partHoles: { x: 0.1 } });
  });

  it("writes into a design, and the validator takes it", () => {
    const applied = applyProfile(box({ components: [button] }), tuned);
    expect(applied.fabrication.fit).toEqual({ insertHole: 4.1, insertHoleSideways: 4.2, screwHole: 3.5, clipGap: 0.1, pinSocket: 4.4, partHoles: { "arcade-24mm": 0.15 } });
    expect(applied.plate.clearance).toBe(0.35);
    const result = validateConfig(applied);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.plan.cutouts[0]!.diameter).toBeCloseTo(24.39);
  });

  it("only writes holes for parts the design has", () => {
    expect(applyProfile(box({ components: [button] }), tuned).fabrication.fit.partHoles).not.toHaveProperty("pot-9mm");
    expect(applyProfile(box(), tuned).fabrication.fit.partHoles).toBeUndefined();
  });

  it("leaves nothing in the file for usual sizes", () => {
    expect(applyProfile(box(), usual)).toEqual(box());
  });

  it("clears a part's own size when the profile doesn't have one", () => {
    const config = box({ components: [button], fabrication: { fit: { partHoles: { "arcade-24mm": 0.5 } } } });
    expect(applyProfile(config, usual)).toEqual(box({ components: [button] }));
  });

  it("says how a design differs", () => {
    expect(profileDifferences(box(), usual)).toEqual([]);
    const differences = profileDifferences(box({ components: [button] }), tuned);
    expect(differences.join()).toContain("Screw hole: 3.4 here, 3.5 on your printer");
    expect(differences.join()).toContain("Plate clearance: 0.25 here, 0.35");
    expect(differences.join()).toContain("Holes for arcade-24mm: 0 here, 0.15");
    expect(differences.join()).not.toContain("pot-9mm");
  });

  it("differs from nothing once applied", () => {
    const config = box({ components: [button] });
    expect(profileDifferences(applyProfile(config, tuned), tuned)).toEqual([]);
  });

  it("sums up only what's changed", () => {
    expect(profileSummary(usual)).toEqual([]);
    expect(profileSummary({ ...usual, screwHole: 3.5, partHoles: { a: 0.1 } })).toEqual(["Screw hole 3.5 mm", "1 part's holes"]);
    expect(profileSummary({ ...usual, plateClearance: 0.3, partHoles: { a: 0.1, b: 0.2 } })).toEqual(["Plate clearance 0.3 mm", "2 parts' holes"]);
  });

  it("keeps other parts' sizes when saving from another design", () => {
    expect(mergeProfile({ ...usual, partHoles: { a: 0.1, b: 0.2 } }, { ...tuned, partHoles: { b: 0.3 } })).toEqual({ ...tuned, partHoles: { a: 0.1, b: 0.3 } });
    expect(mergeProfile(null, tuned)).toEqual(tuned);
  });

  describe("kept in the browser", () => {
    let store: Record<string, string>;
    beforeEach(() => {
      store = {};
      vi.stubGlobal("localStorage", {
        getItem: (key: string) => store[key] ?? null,
        setItem: (key: string, value: string) => (store[key] = value),
        removeItem: (key: string) => delete store[key],
      });
    });

    it("comes back as it went in", () => {
      expect(loadProfile()).toBeNull();
      saveProfile(tuned);
      expect(loadProfile()).toEqual(tuned);
      saveProfile(null);
      expect(loadProfile()).toBeNull();
    });

    it("ignores what it can't read", () => {
      store["enclosure-generator.printer-v1"] = "not json";
      expect(loadProfile()).toBeNull();
      store["enclosure-generator.printer-v1"] = JSON.stringify({ ...tuned, insertHole: 99 });
      expect(loadProfile()).toBeNull();
      store["enclosure-generator.printer-v1"] = JSON.stringify({ ...tuned, plateClearance: "wide" });
      expect(loadProfile()).toBeNull();
    });

    it("copes without storage", () => {
      vi.stubGlobal("localStorage", {
        getItem: () => {
          throw new Error("blocked");
        },
        setItem: () => {
          throw new Error("blocked");
        },
      });
      expect(loadProfile()).toBeNull();
      expect(() => saveProfile(tuned)).not.toThrow();
    });
  });
});
