import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { validateConfig } from "../src/index.js";
import { buildProfile, buildSurfaces, chainHeight, layoutSeamFasteners, lowestHeight, offsetChain, surfacePoint } from "../src/profile.js";
import { polygonInside } from "../src/geometry.js";
import { blank, deckAndPanel, errorCodes, errors } from "./helpers.js";

const dial = (id: string, surface: string, u: number, v: number) => ({ id, type: "ec11-dial-30mm", surface, u, v });

describe("the side profile", () => {
  const surfaces = buildSurfaces(40, [
    { id: "deck", y: 80, z: 40 },
    { id: "panel", y: 125, z: 66 },
    { id: "back", y: 190, z: 55 },
  ]);

  it("works out directions without trig, so every platform gets identical bits", () => {
    const panel = surfaces[1]!;
    expect(panel.cos).toBe(45 / Math.sqrt(45 * 45 + 26 * 26));
    expect(panel.sin).toBe(26 / Math.sqrt(45 * 45 + 26 * 26));
    const trig = /Math\.(sin|cos|tan|asin|acos|atan2?)\(/;
    const source = (file: string) => readFileSync(new URL(`../src/${file}`, import.meta.url), "utf8");
    expect(source("engine.ts")).not.toMatch(trig);
    // The one allowed use is the angle, which only drives validation.
    expect(source("profile.ts").match(new RegExp(trig, "g"))).toEqual(["Math.atan2("]);
  });

  it("measures positions along each surface from its own front edge", () => {
    expect(surfacePoint(surfaces[0]!, 10, 0)).toEqual([10, 40]);
    const [y, z] = surfacePoint(surfaces[1]!, surfaces[1]!.length, 0);
    expect(y).toBeCloseTo(125);
    expect(z).toBeCloseTo(66);
  });

  it("moves along a surface's normal", () => {
    const [y, z] = surfacePoint(surfaces[1]!, 0, -3);
    expect(y).toBeCloseTo(80 + 3 * surfaces[1]!.sin);
    expect(z).toBeCloseTo(40 - 3 * surfaces[1]!.cos);
  });

  it("offsets the chain by the same thickness everywhere, including at creases", () => {
    const chain = offsetChain(surfaces, 3, 3, 187)!;
    expect(chain[0]).toEqual([3, 37]);
    const [y, z] = chain[1]!;
    const toPanelLine = (y - 80) * -surfaces[1]!.sin + (z - 40) * surfaces[1]!.cos;
    expect(z).toBeCloseTo(37);
    expect(toPanelLine).toBeCloseTo(-3);
  });

  it("reports a surface too short to survive the offset", () => {
    // A short flat between two slopes shrinks at both ends when offset inward.
    const stub = buildSurfaces(40, [
      { id: "a", y: 30, z: 70 },
      { id: "b", y: 32, z: 70 },
      { id: "c", y: 62, z: 40 },
      { id: "d", y: 190, z: 40 },
    ]);
    expect(offsetChain(stub, 3, 3, 187)).toBeNull();
  });

  it("finds the lowest point under a crease that dips", () => {
    const valley = [[0, 40], [50, 20], [100, 40]] as [number, number][];
    expect(chainHeight(valley, 25)).toBeCloseTo(30);
    expect(lowestHeight(valley, 30, 70)).toBeCloseTo(20);
    expect(lowestHeight(valley, 60, 80)).toBeCloseTo(24);
  });

  it("forms a closed cavity that holds points inside and excludes the walls", () => {
    const profile = buildProfile(surfaces, { wall: 3, panelThickness: 3, floorThickness: 3 })!;
    const box = (y0: number, y1: number, z0: number, z1: number): [number, number][] => [[y0, z0], [y1, z0], [y1, z1], [y0, z1]];
    expect(polygonInside(box(10, 70, 5, 30), profile.cavity)).toBe(true);
    expect(polygonInside(box(10, 70, 5, 38), profile.cavity)).toBe(false);
    expect(polygonInside(box(1, 70, 5, 30), profile.cavity)).toBe(false);
    expect(polygonInside(box(100, 150, 5, 45), profile.cavity)).toBe(true);
    expect(polygonInside(box(100, 150, 5, 50), profile.cavity)).toBe(false); // the panel is lower at y = 100
  });
});

describe("surface configs", () => {
  it("accepts one surface or several, and reports depth and height from them", () => {
    const one = validateConfig(blank());
    const several = validateConfig(deckAndPanel());
    if (!one.ok || !several.ok) throw new Error("expected valid");
    expect(one.plan.profile.depth).toBeCloseTo(190.5);
    expect(several.plan.profile.depth).toBe(190);
    expect(several.plan.profile.maxHeight).toBe(66);
    expect(several.plan.printedParts[0]?.size).toEqual([153.5, 190, 66]);
  });

  it.each([
    ["surfaces that double back", [{ id: "a", y: 80, z: 40 }, { id: "b", y: 60, z: 50 }], "SURFACE_INVALID", "front to rear"],
    ["a duplicate surface id", [{ id: "a", y: 80, z: 40 }, { id: "a", y: 160, z: 60 }], "SURFACE_INVALID", "used twice"],
    ["a near-vertical surface", [{ id: "a", y: 80, z: 40 }, { id: "b", y: 82, z: 80 }, { id: "c", y: 160, z: 80 }], "SURFACE_INVALID", "limit is 75°"],
    ["surfaces that should be one", [{ id: "a", y: 80, z: 40 }, { id: "b", y: 160, z: 40.5 }], "SURFACE_INVALID", "Merge them"],
    ["a surface too short for the panel", [{ id: "a", y: 30, z: 70 }, { id: "b", y: 32, z: 70 }, { id: "c", y: 62, z: 40 }, { id: "d", y: 160, z: 40 }], "GEOMETRY_IMPOSSIBLE", "too short"],
    ["a top that dips to the floor", [{ id: "a", y: 80, z: 5 }, { id: "b", y: 160, z: 40 }], "GEOMETRY_IMPOSSIBLE", "no room"],
  ])("rejects %s", (_name, surfaces, code, message) => {
    const found = errors(blank({ seams: [], enclosure: { width: 200, frontHeight: 40, surfaces } }));
    expect(found[0]?.code).toBe(code);
    expect(found[0]?.message).toContain(message);
  });

  it("rejects a top edge fillet on several surfaces, which isn't supported yet", () => {
    const config = deckAndPanel();
    config.enclosure.topEdgeFillet = 1;
    expect(errors(config)[0]?.path).toBe("enclosure.topEdgeFillet");
  });
});

describe("placing parts on surfaces", () => {
  it("requires a surface when there are several, and names them", () => {
    const found = errors(deckAndPanel({ components: [{ id: "a", type: "ttp223", u: 60, v: 30 }] }));
    expect(found[0]).toMatchObject({ code: "UNKNOWN_SURFACE", path: "components[0]" });
    expect(found[0]?.message).toContain('"deck", "panel", "back"');
  });

  it("rejects an unknown surface", () => {
    const found = errors(deckAndPanel({ components: [dial("a", "lid", 60, 30)] }));
    expect(found[0]).toMatchObject({ code: "UNKNOWN_SURFACE", path: "components[0].surface" });
  });

  it("assigns cutouts to their surface and printed part", () => {
    const result = validateConfig(deckAndPanel({ components: [
      { id: "a", type: "ttp223", surface: "deck", u: 60, v: 30 },
      { id: "b", type: "ttp223", surface: "panel", u: 200, v: 25 },
    ] }));
    if (!result.ok) throw new Error(JSON.stringify(result.errors));
    expect(result.plan.cutouts.map((c) => [c.surface, c.printedPart])).toEqual([["deck", 0], ["panel", 1]]);
  });

  it("measures usable length per surface, not across the whole top", () => {
    // The panel is about 52 mm long, so v = 70 runs off it even though the deck is longer.
    const found = errors(deckAndPanel({ components: [{ id: "a", type: "ttp223", surface: "panel", u: 60, v: 70 }] }));
    expect(found[0]?.code).toBe("CUTOUT_OUTSIDE_SURFACE");
    expect(found[0]?.message).toContain('usable part of "panel"');
  });

  it("doesn't compare cutout spacing across surfaces, where u and v mean different things", () => {
    const config = deckAndPanel({ components: [
      { id: "a", type: "ttp223", surface: "deck", u: 60, v: 30 },
      { id: "b", type: "ttp223", surface: "panel", u: 60, v: 30 },
    ] });
    expect(errorCodes(config)).not.toContain("CUTOUTS_TOO_CLOSE");
  });

  it("keeps cutouts away from a crease, on both sides of it", () => {
    const pocket = (surface: string, v: number) => deckAndPanel({ components: [{ id: "a", type: "ttp223", surface, u: 60, v }] });
    expect(errorCodes(pocket("deck", 80 - 6))).toContain("CUTOUT_OUTSIDE_SURFACE");
    expect(errorCodes(pocket("deck", 80 - 9))).not.toContain("CUTOUT_OUTSIDE_SURFACE");
    expect(errorCodes(pocket("panel", 6))).toContain("CUTOUT_OUTSIDE_SURFACE");
    expect(errorCodes(pocket("panel", 9))).not.toContain("CUTOUT_OUTSIDE_SURFACE");
  });

  it("allows a sensible layout across a downward crease too", () => {
    expect(errorCodes(deckAndPanel({ components: [{ id: "a", type: "ttp223", surface: "back", u: 60, v: 30 }] }))).toEqual([]);
  });
});

describe("bodies and surfaces", () => {
  it("flags a knob on the deck running into the panel rising behind it", () => {
    const found = errors(deckAndPanel({ components: [dial("a", "deck", 60, 70)] }));
    expect(found[0]?.code).toBe("BODY_HITS_ENCLOSURE");
    expect(found[0]?.message).toContain('runs into surface "panel"');
    expect(errorCodes(deckAndPanel({ components: [dial("a", "deck", 60, 45)] }))).toEqual([]);
  });

  it("flags a body running under a surface that drops away behind it", () => {
    const long = { name: "Long", source: "measured", mount: "panel",
      cutouts: [{ kind: "circle", diameter: 8 }],
      above: { footprint: { shape: "circle", diameter: 8 }, height: 0 },
      below: { footprint: { shape: "rect", width: 8, height: 50 }, depth: 2 } };
    const config = (v: number) => deckAndPanel({
      enclosure: {
        width: 300,
        frontHeight: 60,
        surfaces: [{ id: "high", y: 80, z: 60 }, { id: "down", y: 110, z: 40 }, { id: "low", y: 190, z: 40 }],
      },
      customParts: { long },
      components: [{ id: "a", type: "long", surface: "high", u: 60, v }],
    });
    expect(errors(config(60))[0]?.message).toContain("underside of another surface");
    expect(errorCodes(config(35))).toEqual([]);
  });

  it("flags bodies colliding across two surfaces", () => {
    // A body hanging from a falling surface leans forward, towards the one in front.
    const deep = { name: "Deep", source: "measured", mount: "panel",
      cutouts: [{ kind: "circle", diameter: 8 }],
      above: { footprint: { shape: "circle", diameter: 8 }, height: 0 },
      below: { footprint: { shape: "rect", width: 20, height: 20 }, depth: 20 } };
    const config = (u: number) => deckAndPanel({
      enclosure: {
        width: 300,
        frontHeight: 60,
        surfaces: [{ id: "high", y: 100, z: 60 }, { id: "down", y: 150, z: 40 }, { id: "low", y: 190, z: 40 }],
      },
      customParts: { deep },
      components: [
        { id: "a", type: "deep", surface: "high", u: 60, v: 90 },
        { id: "b", type: "deep", surface: "down", u, v: 15 },
      ],
    });
    expect(errors(config(60)).find((e) => e.code === "BODIES_COLLIDE")?.message).toContain("across surfaces");
    expect(errorCodes(config(100))).not.toContain("BODIES_COLLIDE");
  });

  it("measures a board's headroom at the lowest point over it, even at a crease", () => {
    const tall = { name: "Tall", source: "measured", mount: "floor", footprint: { shape: "rect", width: 20, height: 40 }, height: 36 };
    const at = (y: number) => deckAndPanel({ customParts: { tall }, components: [{ id: "a", type: "tall", x: 60, y }] });
    expect(errors(at(70))[0]?.message).toContain("underside of the top");
    expect(errorCodes(at(120))).not.toContain("BODY_HITS_ENCLOSURE");
  });
});

describe("seam fasteners", () => {
  const surfaces = (front: number) => buildSurfaces(front, [{ id: "a", y: 190, z: front }]);
  const layout = (front: number) => {
    const inner = offsetChain(surfaces(front), 3, 3, 187)!;
    return layoutSeamFasteners(surfaces(front), inner, { wall: 3, panelThickness: 3, ribWidth: 9 });
  };

  it("uses two bolts and a pin on each leg when there's room", () => {
    const fasteners = layout(50)!;
    expect(fasteners.pins).toHaveLength(2);
    expect(fasteners.bolts.filter(([y]) => y === 7.5)).toHaveLength(2);
  });

  it("drops to one bolt and a pin on a low leg", () => {
    const fasteners = layout(24)!;
    expect(fasteners.pins).toHaveLength(2);
    expect(fasteners.bolts.filter(([y]) => y === 7.5)).toHaveLength(1);
  });

  it("gives up when a leg can't take both, which the validator reports", () => {
    expect(layout(18)).toBeNull();
    const low = blank({ enclosure: { width: 300, frontHeight: 18, surfaces: [{ id: "a", y: 190, z: 18 }] }, seams: [{ x: 150 }] });
    expect(errorCodes(low)).toContain("SEAM_INVALID");
  });

  it("gives every tab a strip on the wall, sized to the rib", () => {
    const { tabs } = layout(50)!;
    expect(tabs.map((t) => t.surface)).toEqual([null, null, "a", "a"]);
    expect(tabs[0]).toMatchObject({ inward: [1, 0], width: 9 });
    expect(tabs[1]).toMatchObject({ inward: [-1, 0], width: 9 });
    const top = tabs[2]!;
    expect(top.start[1]).toBeCloseTo(47);
    expect(top.inward).toEqual([0, -1]);
  });

  it("moves a tab under a surface along it to find a clear spot, or leaves it out", () => {
    const surface = surfaces(50);
    const inner = offsetChain(surface, 3, 3, 187)!;
    const options = { wall: 3, panelThickness: 3, ribWidth: 9 };
    const bare = layoutSeamFasteners(surface, inner, options)!;
    const moved = layoutSeamFasteners(surface, inner, options, (tab) => tab.surface !== null && tab.start[0] < 75)!;
    expect(moved.tabs.filter((t) => t.surface)[0]!.start[0]).toBeGreaterThanOrEqual(75);
    expect(moved.tabs.length).toBe(bare.tabs.length);
    const none = layoutSeamFasteners(surface, inner, options, (tab) => tab.surface !== null)!;
    expect(none.tabs.map((t) => t.surface)).toEqual([null, null]);
    expect(none.bolts.length).toBe(4);
  });

  it("adds bolts along each long surface, and skips short ones", () => {
    const three = buildSurfaces(40, [{ id: "a", y: 110, z: 40 }, { id: "b", y: 130, z: 48 }, { id: "c", y: 190, z: 40 }]);
    const fasteners = layoutSeamFasteners(three, offsetChain(three, 3, 3, 187)!, { wall: 3, panelThickness: 3, ribWidth: 9 })!;
    const underTop = fasteners.bolts.filter(([y]) => y > 7.5 && y < 182.5);
    expect(underTop).toHaveLength(2);
  });
});
