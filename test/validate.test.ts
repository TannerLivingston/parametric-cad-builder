import { describe, expect, it } from "vitest";
import { validateConfig } from "../src/index.js";
import { gap } from "../src/geometry.js";
import { blank, button, errorCodes, errors, deskSynth, wedge } from "./helpers.js";

describe("the Desk Synth example", () => {
  const result = validateConfig(deskSynth());

  it("is valid and expands each part into its cutouts", () => {
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.plan.cutouts).toHaveLength(19);
  });

  it("splits its shell into two parts that fit the build volume", () => {
    if (!result.ok) throw new Error("expected valid");
    const [left, right] = result.plan.printedParts;
    expect(left?.size[0]).toBeCloseTo(189.5);
    expect(right?.size[0]).toBeCloseTo(165.4);
  });

  it("has no unmeasured parts to warn about", () => {
    expect(result.warnings.filter((w) => w.code === "UNVERIFIED_PART")).toEqual([]);
  });

  it("warns about an unmeasured part once per type, and lists who uses it", () => {
    const { warnings } = validateConfig(blank({ components: [
      { id: "a", type: "ttp223", u: 40, v: 60 },
      { id: "b", type: "ttp223", u: 70, v: 60 },
    ] }));
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toMatchObject({ code: "UNVERIFIED_PART", componentIds: ["a", "b"] });
  });

  it("gives identical results for identical input", () => {
    expect(validateConfig(deskSynth())).toEqual(validateConfig(deskSynth()));
  });
});

// Each layout here reached the engine in the spike and crashed it or came out wrong.
describe("cases from the engine spike", () => {
  it("rejects overlapping cutouts, which crash the engine", () => {
    const found = errors(blank({ components: [button("a", 60, 60), button("b", 70, 60)] }));
    const issue = found.find((e) => e.code === "CUTOUTS_TOO_CLOSE");
    expect(issue?.message).toContain("overlap by 14.24 mm");
    expect(issue?.componentIds).toEqual(["a", "b"]);
    expect(issue?.path).toBe("components[1]");
  });

  it("rejects identical cutouts", () => {
    expect(errorCodes(blank({ components: [button("a", 60, 60), button("b", 60, 60)] }))).toContain("CUTOUTS_TOO_CLOSE");
  });

  it("rejects exactly tangent cutouts, which make a non-manifold edge", () => {
    const found = errors(blank({ components: [button("a", 60, 60), button("b", 84.24, 60)] }));
    expect(found.find((e) => e.code === "CUTOUTS_TOO_CLOSE")?.message).toContain("only 0 mm");
  });

  it("rejects a cutout crossing the seam, which only cuts one half", () => {
    expect(errorCodes(blank({ components: [button("a", 152.4, 60)] }))).toContain("CUTOUT_CROSSES_SEAM");
  });

  it("rejects a cutout cutting into the seam rib", () => {
    expect(errorCodes(blank({ components: [button("a", 152.4 - 14, 60)] }))).toContain("CUTOUT_HITS_RIB");
  });

  it("rejects a cutout hanging off the edge", () => {
    expect(errorCodes(blank({ components: [button("a", 5, 60)] }))).toContain("CUTOUT_OUTSIDE_SURFACE");
  });

  it("rejects a cutout entirely off the panel", () => {
    expect(errorCodes(blank({ components: [button("a", -100, 60)] }))).toContain("CUTOUT_OUTSIDE_SURFACE");
  });

  it("rejects a cutout tangent to the inner wall", () => {
    const tangent = 3 + 12.12;
    expect(errorCodes(blank({ components: [button("a", tangent, 60)] }))).toContain("CUTOUT_OUTSIDE_SURFACE");
  });

  it("allows the layouts the spike built without trouble", () => {
    expect(validateConfig(blank({ enclosure: wedge({ width: 304.8, depth: 190.5, rearHeight: 58, tiltDeg: 0 }) })).ok).toBe(true);
    expect(validateConfig(blank({ components: [] })).ok).toBe(true);
  });
});

describe("spacing limits", () => {
  const atGap = (web: number) => blank({ components: [
    { id: "a", type: "ttp223", u: 40, v: 60 },
    { id: "b", type: "ttp223", u: 40 + 16 + web, v: 60 },
  ] });

  it("accepts the minimum web and rejects anything under it", () => {
    expect(errorCodes(atGap(1.2))).not.toContain("CUTOUTS_TOO_CLOSE");
    expect(errorCodes(atGap(1.19))).toContain("CUTOUTS_TOO_CLOSE");
  });

  it("uses the stricter limit for PETG-GF", () => {
    expect(errorCodes({ ...atGap(1.2), fabrication: { material: "PETG-GF" } })).toContain("CUTOUTS_TOO_CLOSE");
  });

  it("lets the config override the material default", () => {
    expect(errorCodes({ ...atGap(1.2), fabrication: { material: "PETG-GF", minWeb: 1 } })).not.toContain("CUTOUTS_TOO_CLOSE");
  });

  it("checks the cutouts within a custom part", () => {
    const config = blank({
      customParts: {
        clash: {
          name: "Bad part", source: "measured", mount: "panel",
          cutouts: [{ kind: "circle", diameter: 10 }, { kind: "circle", diameter: 10, at: [5, 0] }],
          above: { footprint: { shape: "circle", diameter: 20 }, height: 1 },
          below: { footprint: { shape: "circle", diameter: 20 }, depth: 1 },
        },
      },
      components: [{ id: "a", type: "clash", u: 60, v: 60 }],
    });
    expect(errors(config).find((e) => e.code === "CUTOUTS_TOO_CLOSE")?.message).toContain('Two cutouts of "a"');
  });

  it("accounts for rotation", () => {
    const wide = { name: "Wide", source: "measured", mount: "panel",
      cutouts: [{ kind: "rect", width: 40, height: 10 }],
      above: { footprint: { shape: "rect", width: 40, height: 10 }, height: 0 },
      below: { footprint: { shape: "rect", width: 40, height: 10 }, depth: 0 } };
    const near = (rotationDeg: number) => blank({
      customParts: { wide },
      components: [
        { id: "a", type: "wide", u: 50, v: 60, rotationDeg },
        { id: "b", type: "ttp223", u: 50 + 28, v: 60 },
      ],
    });
    expect(errorCodes(near(0))).toContain("CUTOUTS_TOO_CLOSE");
    expect(errorCodes(near(90))).not.toContain("CUTOUTS_TOO_CLOSE");
  });
});

describe("panel limits", () => {
  it("measures the rear limit on the panel's underside, which sits further back", () => {
    // At 30° and a 3 mm panel the underside is 1.5 mm further back than the top face.
    const config = (v: number) => blank({
      enclosure: wedge({ width: 304.8, depth: 190.5, rearHeight: 160, tiltDeg: 30 }),
      seams: [],
      fabrication: { buildVolume: { x: 400, y: 400, z: 400 } },
      components: [{ id: "a", type: "ttp223", u: 60, v }],
    });
    expect(errorCodes(config(209))).toContain("CUTOUT_OUTSIDE_SURFACE");
    expect(errorCodes(config(207))).not.toContain("CUTOUT_OUTSIDE_SURFACE");
  });

  it("requires the minimum web beyond the rib, not just clearance from it", () => {
    const config = (u: number) => blank({ components: [{ id: "a", type: "ttp223", u, v: 60 }] });
    const ribFace = 152.4 + 5 + 8;
    expect(errorCodes(config(ribFace + 0.5))).toContain("CUTOUT_HITS_RIB");
    expect(errorCodes(config(ribFace + 1.21))).not.toContain("CUTOUT_HITS_RIB");
  });

  it("keeps cutouts out of a rounded corner that the edge limits would allow", () => {
    const config = (u: number) => blank({
      enclosure: wedge({ width: 304.8, depth: 190.5, rearHeight: 58, tiltDeg: 6, cornerRadius: 10 }),
      components: [{ id: "a", type: "ttp223", u, v: 10.4 }],
    });
    expect(errors(config(12.3))[0]?.message).toContain("rounded corner");
    expect(errorCodes(config(19))).not.toContain("CUTOUT_OUTSIDE_SURFACE");
  });
});

describe("the tilted panel", () => {
  const deepPart = {
    name: "Deep", source: "measured", mount: "panel",
    cutouts: [{ kind: "circle", diameter: 10 }],
    above: { footprint: { shape: "circle", diameter: 12 }, height: 2 },
    below: { footprint: { shape: "circle", diameter: 12 }, depth: 34 },
  };
  const at = (v: number, tiltDeg = 6) => blank({
    enclosure: wedge({ width: 304.8, depth: 190.5, rearHeight: 58, tiltDeg }),
    customParts: { deep: deepPart },
    components: [{ id: "a", type: "deep", u: 60, v }],
  });

  it("flags a deep part at the low front but not at the high rear", () => {
    const front = errors(at(20));
    expect(front.map((e) => e.code)).toContain("BODY_HITS_ENCLOSURE");
    expect(front[0]?.message).toContain("somewhere taller");
    expect(errorCodes(at(150))).not.toContain("BODY_HITS_ENCLOSURE");
  });

  it("allows the same front position with the panel level", () => {
    expect(errorCodes(at(20, 0))).not.toContain("BODY_HITS_ENCLOSURE");
  });

  it("flags a body that swings into the rear wall as it hangs from the tilt", () => {
    const steep = blank({
      enclosure: wedge({ width: 304.8, depth: 190.5, rearHeight: 160, tiltDeg: 30 }),
      seams: [],
      fabrication: { buildVolume: { x: 400, y: 400, z: 400 } },
      customParts: { deep: deepPart },
      components: [{ id: "a", type: "deep", u: 60, v: 205 }],
    });
    expect(errors(steep).find((e) => e.code === "BODY_HITS_ENCLOSURE")?.message).toContain("runs into a wall");
    expect(errorCodes({ ...steep, components: [{ id: "a", type: "deep", u: 60, v: 150 }] })).not.toContain("BODY_HITS_ENCLOSURE");
  });
});

describe("bodies", () => {
  it("flags bodies colliding below the panel even when the cutouts are clear", () => {
    const part = { name: "Fat", source: "measured", mount: "panel",
      cutouts: [{ kind: "circle", diameter: 8 }],
      above: { footprint: { shape: "circle", diameter: 8 }, height: 1 },
      below: { footprint: { shape: "circle", diameter: 30 }, depth: 5 } };
    const config = blank({ customParts: { fat: part }, components: [
      { id: "a", type: "fat", u: 60, v: 80 },
      { id: "b", type: "fat", u: 80, v: 80 },
    ] });
    expect(errors(config)).toHaveLength(1);
    expect(errors(config)[0]).toMatchObject({ code: "BODIES_COLLIDE", componentIds: ["a", "b"] });
    expect(errors(config)[0]?.message).toContain("below the panel");
  });

  it("flags knobs colliding above the panel", () => {
    const found = errors(blank({ components: [
      { id: "a", type: "pot-9mm", u: 60, v: 100 },
      { id: "b", type: "pot-9mm", u: 80, v: 100 },
    ] }));
    expect(found.find((e) => e.code === "BODIES_COLLIDE")?.message).toContain("above the panel");
  });

  it("flags a panel body running into a seam tab on a wall", () => {
    // Low at the front of a tilted panel, next to the seam, is where the wall's tab is.
    const part = { name: "Fat", source: "measured", mount: "panel",
      cutouts: [{ kind: "circle", diameter: 8 }],
      above: { footprint: { shape: "circle", diameter: 8 }, height: 1 },
      below: { footprint: { shape: "circle", diameter: 30 }, depth: 5 } };
    const config = (u: number) => blank({ customParts: { fat: part }, components: [{ id: "a", type: "fat", u, v: 18 }] });
    expect(errorCodes(config(152.4 - 12))).toContain("BODY_HITS_RIB");
    expect(errorCodes(config(100))).not.toContain("BODY_HITS_RIB");
  });

  it("moves a tab under a surface out of a part's way, instead of failing", () => {
    const part = { name: "Fat", source: "measured", mount: "panel",
      cutouts: [{ kind: "circle", diameter: 8 }],
      above: { footprint: { shape: "circle", diameter: 8 }, height: 1 },
      below: { footprint: { shape: "circle", diameter: 30 }, depth: 5 } };
    const clear = validateConfig(blank());
    const crowded = validateConfig(blank({ customParts: { fat: part }, components: [{ id: "a", type: "fat", u: 152.4 - 25, v: 62 }] }));
    if (!clear.ok || !crowded.ok) throw new Error("expected valid");
    const tops = (r: typeof clear) => r.plan.seams[0]!.tabs.filter((t) => t.surface).map((t) => t.start[0]);
    expect(tops(crowded)).not.toEqual(tops(clear));
    expect(tops(crowded).length).toBeGreaterThan(0);
  });

  it("warns when parts leave a seam bolted only at the front and rear", () => {
    const wide = { name: "Wide", source: "measured", mount: "panel",
      cutouts: [{ kind: "rect", width: 60, height: 130 }],
      above: { footprint: { shape: "rect", width: 60, height: 130 }, height: 0 },
      below: { footprint: { shape: "rect", width: 60, height: 130 }, depth: 2 } };
    const result = validateConfig(blank({ customParts: { wide }, components: [{ id: "a", type: "wide", u: 118, v: 96 }] }));
    expect(result.warnings.map((w) => w.code)).toContain("SEAM_UNBRACED");
    expect(result.warnings.find((w) => w.code === "SEAM_UNBRACED")?.message).toContain("only bolted at the front and rear");
  });

  it("flags a board under a panel part hanging over it", () => {
    const found = errors(blank({ components: [
      button("a", 60, 36),
      { id: "b", type: "pico-rp2350", x: 60, y: 38 },
    ] }));
    expect(found.find((e) => e.code === "BODIES_COLLIDE")?.componentIds).toEqual(["b", "a"]);
  });

  it("flags a board too tall for the low front of the panel", () => {
    const tall = { name: "Tall", source: "measured", mount: "floor", footprint: { shape: "rect", width: 20, height: 20 }, height: 36 };
    const config = (y: number) => blank({ customParts: { tall }, components: [{ id: "a", type: "tall", x: 60, y }] });
    expect(errors(config(20))[0]?.message).toContain("underside of the top");
    expect(errorCodes(config(150))).not.toContain("BODY_HITS_ENCLOSURE");
  });

  it("measures a board's headroom at its front edge, where the panel is lowest", () => {
    // 41 mm from the base clears the panel at the board's rear edge but not its front.
    const long = { name: "Long", source: "measured", mount: "floor", footprint: { shape: "rect", width: 20, height: 50 }, height: 38 };
    const found = errors(blank({ customParts: { long }, components: [{ id: "a", type: "long", x: 60, y: 60 }] }));
    expect(found.map((e) => e.code)).toEqual(["BODY_HITS_ENCLOSURE"]);
    expect(found[0]?.message).toContain("underside of the top");
  });

  it("flags a board crossing the seam", () => {
    expect(errorCodes(blank({ components: [{ id: "a", type: "pico-rp2350", x: 152.4, y: 150 }] }))).toEqual(["BODY_HITS_RIB"]);
  });

  it("flags a board outside the walls", () => {
    expect(errorCodes(blank({ components: [{ id: "a", type: "pico-rp2350", x: 5, y: 150 }] }))).toContain("BODY_HITS_ENCLOSURE");
  });

  it("ignores the above-panel footprint of flush parts", () => {
    const flush = blank({ components: [
      { id: "a", type: "ttp223", u: 40, v: 60 },
      { id: "b", type: "ttp223", u: 57.2, v: 60 },
    ] });
    expect(errorCodes(flush)).not.toContain("BODIES_COLLIDE");
  });
});

describe("fabrication limits", () => {
  it("explains that the reference footprint needs a seam, and how many", () => {
    const found = errors(blank({ seams: [] }));
    expect(found[0]?.code).toBe("PART_TOO_LARGE");
    expect(found[0]?.message).toContain("needs at least 1 seam");
  });

  it("allows a turn on the bed to fit", () => {
    const config = blank({ seams: [], enclosure: wedge({ width: 100, depth: 150, rearHeight: 58, tiltDeg: 6 }), fabrication: { buildVolume: { x: 160, y: 110, z: 100 } } });
    expect(validateConfig(config).ok).toBe(true);
  });

  it("flags a part too tall to print, and doesn't suggest a seam", () => {
    const found = errors(blank({ fabrication: { buildVolume: { x: 256, y: 256, z: 50 } } }));
    expect(found.find((e) => e.code === "PART_TOO_LARGE")?.message).toContain("reduce the depth or height");
  });

  it("flags a seam off centre enough to leave one half too big", () => {
    expect(errorCodes(blank({ seams: [{ x: 45 }] }))).toContain("PART_TOO_LARGE");
  });

  it.each([
    ["a seam too near the edge", { seams: [{ x: 20 }] }, "SEAM_INVALID"],
    ["a rib too narrow for bolts", { seams: [{ x: 152.4, ribWidth: 4 }] }, "SEAM_INVALID"],
    ["a rib too thin for pins", { seams: [{ x: 152.4, ribHalfThickness: 2 }] }, "SEAM_INVALID"],
  ])("flags %s", (_name, overrides, code) => {
    expect(errorCodes(blank(overrides))).toContain(code);
  });

  it("flags a seam where the front is too short for its fasteners", () => {
    expect(errorCodes(blank({ enclosure: wedge({ width: 304.8, depth: 190.5, rearHeight: 38, tiltDeg: 6 }) }))).toContain("SEAM_INVALID");
  });

  it.each([
    ["wall", { wall: 1 }, "WALL_TOO_THIN"],
    ["panel", { panelThickness: 1 }, "WALL_TOO_THIN"],
    ["corner radius", { cornerRadius: 200 }, "GEOMETRY_IMPOSSIBLE"],
    ["top fillet", { topEdgeFillet: 3 }, "GEOMETRY_IMPOSSIBLE"],
    ["tilt", { tiltDeg: 20 }, "GEOMETRY_IMPOSSIBLE"],
  ])("flags an unbuildable %s", (_name, overrides, code) => {
    const config = blank({ enclosure: wedge({ width: 304.8, depth: 190.5, rearHeight: 58, tiltDeg: 6, ...overrides }) });
    expect(errorCodes(config)).toContain(code);
  });

  it("flags a pocket with too thin a skin, or none left", () => {
    const pocket = (skin: number) => ({
      name: "Pocket", source: "measured", mount: "panel",
      cutouts: [{ kind: "pocket", width: 10, height: 10, skin }],
      above: { footprint: { shape: "rect", width: 10, height: 10 }, height: 0 },
      below: { footprint: { shape: "rect", width: 10, height: 10 }, depth: 2 },
    });
    const config = (skin: number) => blank({ customParts: { p: pocket(skin) }, components: [{ id: "a", type: "p", u: 60, v: 60 }] });
    expect(errorCodes(config(0.2))).toEqual(["SKIN_INVALID"]);
    expect(errorCodes(config(3))).toEqual(["SKIN_INVALID"]);
    expect(errorCodes(config(1))).toEqual([]);
  });

  it("flags a panel too thick for snap-in buttons", () => {
    const config = blank({
      enclosure: wedge({ width: 304.8, depth: 190.5, rearHeight: 58, tiltDeg: 6, panelThickness: 5 }),
      components: [button("a", 60, 80)],
    });
    expect(errors(config)[0]).toMatchObject({ code: "PANEL_THICKNESS_UNSUITABLE", componentIds: ["a"] });
  });
});

describe("component references", () => {
  it("rejects duplicate ids and points at both", () => {
    const found = errors(blank({ components: [button("a", 60, 60), button("a", 120, 60)] }));
    expect(found).toHaveLength(1);
    expect(found[0]).toMatchObject({ code: "DUPLICATE_ID", path: "components[1].id" });
    expect(found[0]?.message).toContain("components[0]");
  });

  it("rejects unknown part types", () => {
    expect(errors(blank({ components: [{ id: "a", type: "nope", u: 60, v: 60 }] }))[0]).toMatchObject({ code: "UNKNOWN_PART", path: "components[0].type" });
  });

  it("rejects placing a panel part on the floor and a board on the panel", () => {
    expect(errorCodes(blank({ components: [{ id: "a", type: "ttp223", x: 60, y: 60 }] }))).toEqual(["WRONG_MOUNT"]);
    expect(errorCodes(blank({ components: [{ id: "a", type: "pico-rp2350", u: 60, v: 60 }] }))).toEqual(["WRONG_MOUNT"]);
  });

  it("lets a custom part replace a library part of the same name", () => {
    const measured = { name: "My button", source: "measured", mount: "panel",
      cutouts: [{ kind: "circle", diameter: 24.4 }],
      above: { footprint: { shape: "circle", diameter: 28 }, height: 8 },
      below: { footprint: { shape: "circle", diameter: 28 }, depth: 28 } };
    const result = validateConfig(blank({ customParts: { "arcade-24mm": measured }, components: [button("a", 60, 80)] }));
    expect(result.ok).toBe(true);
    expect(result.warnings).toHaveLength(0);
    if (result.ok) expect(result.plan.cutouts[0]?.diameter).toBe(24.4);
  });
});

describe("gap", () => {
  const circle = (cx: number, cy: number, r: number) => ({ kind: "circle" as const, cx, cy, r });
  const rect = (cx: number, cy: number, w: number, h: number) => ({ kind: "rect" as const, cx, cy, w, h });

  it("measures circles", () => {
    expect(gap(circle(0, 0, 1), circle(5, 0, 1))).toBeCloseTo(3);
    expect(gap(circle(0, 0, 3), circle(5, 0, 3))).toBeCloseTo(-1);
  });

  it("measures rectangles, including corner to corner", () => {
    expect(gap(rect(0, 0, 2, 2), rect(5, 0, 2, 2))).toBeCloseTo(3);
    expect(gap(rect(0, 0, 2, 2), rect(4, 5, 2, 2))).toBeCloseTo(Math.hypot(2, 3));
    expect(gap(rect(0, 0, 4, 4), rect(1, 0, 4, 4))).toBeCloseTo(-3);
  });

  it("measures a circle against a rectangle in either order", () => {
    expect(gap(circle(5, 0, 1), rect(0, 0, 2, 2))).toBeCloseTo(3);
    expect(gap(rect(0, 0, 2, 2), circle(4, 4, 1))).toBeCloseTo(Math.hypot(3, 3) - 1);
    expect(gap(rect(0, 0, 10, 10), circle(0, 0, 1))).toBeLessThan(0);
  });
});
