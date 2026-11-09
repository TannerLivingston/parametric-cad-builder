// Labels have to read properly from outside, stay out of the way of everything else, and never cost
// a part its strength.
import { beforeAll, describe, expect, it } from "vitest";
import { makeCylinder, measureVolume, type Shape3D } from "replicad";
import { analyseBinarySTL, isValidSolid } from "../src/checks.js";
import { buildEnclosure, configSchema, initEngine, planPrint, textOutline, unsupportedCharacters, validateConfig, type BuildPlan } from "../src/index.js";
import { nibFor } from "../src/lettering.js";
import { removeComponent } from "../src/app/configEdit.js";
import { addSurfaceLabel, addWallLabel, labelOfComponent, removeLabel, setComponentLabel, updateLabel } from "../src/app/labelEdit.js";
import { partsToRecut, planKeys } from "../src/app/planDiff.js";
import { errors, deskSynth } from "./helpers.js";

const box = (overrides: Record<string, unknown> = {}): any => ({
  schemaVersion: 1,
  name: "box",
  enclosure: { width: 200, frontHeight: 40, cornerRadius: 3, surfaces: [{ id: "top", y: 120, z: 40 }] },
  ...overrides,
});
const label = (more: Record<string, unknown> = {}) => ({ text: "VOL", u: 100, v: 60, ...more });
function plan(config: unknown): BuildPlan {
  const result = validateConfig(config);
  if (!result.ok) throw new Error(JSON.stringify(result.errors, null, 1));
  return result.plan;
}
const problem = (config: unknown) => errors(config).find((e) => e.code === "LABEL_INVALID");
const warnings = (config: unknown) => {
  const result = validateConfig(config);
  return result.warnings.filter((w) => w.code === "LABEL_HIDDEN");
};
type Point = readonly [number, number];
const area = (loop: readonly Point[]) => loop.reduce((sum, [x, y], i) => sum + x * loop[(i + 1) % loop.length]![1] - loop[(i + 1) % loop.length]![0] * y, 0) / 2;
const crosses = (a: Point, b: Point, c: Point, d: Point) => {
  const side = (p: Point, q: Point, r: Point) => (q[0] - p[0]) * (r[1] - p[1]) - (q[1] - p[1]) * (r[0] - p[0]);
  return side(a, b, c) * side(a, b, d) < -1e-12 && side(c, d, a) * side(c, d, b) < -1e-12;
};
const inside = ([x, y]: Point, loop: readonly Point[]) => {
  let odd = false;
  loop.forEach((a, i) => {
    const b = loop[(i + 1) % loop.length]!;
    if (a[1] > y !== b[1] > y && x < a[0] + ((y - a[1]) * (b[0] - a[0])) / (b[1] - a[1])) odd = !odd;
  });
  return odd;
};

const ALL = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789.,:-+=/()'!?#&";
const WITH_INSIDES = "ABDOPQR04689#&";
const IN_PIECES = ":=!?";

describe("the lettering", () => {
  for (const char of ALL) {
    it(`draws ${char} as clean outlines at every size`, () => {
      for (const size of [3.5, 4, 5, 8, 20]) {
        const { glyphs } = textOutline(char, size);
        expect(glyphs).toHaveLength(1);
        const { outers, holes } = glyphs[0]!;
        expect(outers.length).toBe(IN_PIECES.includes(char) ? 2 : 1);
        expect(holes.length > 0).toBe(WITH_INSIDES.includes(char));
        for (const loop of [...outers, ...holes]) {
          for (let i = 0; i < loop.length; i++) {
            const a = loop[i]!;
            const b = loop[(i + 1) % loop.length]!;
            expect(Math.hypot(a[0] - b[0], a[1] - b[1])).toBeGreaterThan(5e-5);
            for (let j = i + 2; j < loop.length; j++) {
              if (i === 0 && j === loop.length - 1) continue;
              expect(crosses(a, b, loop[j]!, loop[(j + 1) % loop.length]!)).toBe(false);
            }
          }
        }
        for (const hole of holes) {
          expect(area(hole)).toBeLessThan(0);
          expect(outers.some((outer) => hole.every((point) => inside(point, outer)))).toBe(true);
        }
        for (const outer of outers) expect(area(outer)).toBeGreaterThan(0);
      }
    });
  }

  it("takes lowercase as capitals, and says what it can't draw", () => {
    expect(textOutline("bass", 5)).toEqual(textOutline("BASS", 5));
    expect(unsupportedCharacters("Bass & 2")).toEqual([]);
    expect(unsupportedCharacters("Bass ★ é")).toEqual(["★", "é"]);
  });

  it("is as tall as asked, and centred", () => {
    const { width, height, glyphs } = textOutline("HE", 6);
    expect(height).toBeCloseTo(6, 5);
    const xs = glyphs.flatMap((g) => g.outers.flat()).map((p) => p[0]);
    expect(Math.min(...xs)).toBeCloseTo(-width / 2, 5);
    expect(Math.max(...xs)).toBeCloseTo(width / 2, 5);
    const ys = glyphs.flatMap((g) => g.outers.flat()).map((p) => p[1]);
    expect(Math.min(...ys)).toBeCloseTo(-3, 5);
    expect(Math.max(...ys)).toBeCloseTo(3, 5);
  });

  it("keeps letters apart, so they can be cut together", () => {
    const { glyphs } = textOutline("ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789", 3.5);
    const bounds = glyphs.map(({ outers }) => {
      const xs = outers.flat().map((p) => p[0]);
      return [Math.min(...xs), Math.max(...xs)] as const;
    });
    bounds.slice(1).forEach(([low], i) => expect(low - bounds[i]![1]).toBeGreaterThan(0.5));
  });

  it("never draws a stroke thinner than the printer can leave open", () => {
    expect(nibFor(3.5)).toBeGreaterThanOrEqual(0.6);
    expect(nibFor(20)).toBeCloseTo(2.8);
  });

  it("gives the same outlines every time", () => {
    expect(JSON.stringify(textOutline("MIDI 12", 5))).toBe(JSON.stringify(textOutline("MIDI 12", 5)));
  });
});

describe("a label in the config", () => {
  it("is optional, and has defaults", () => {
    expect(configSchema.parse(box()).labels).toEqual([]);
    expect(configSchema.parse(box({ labels: [label()] })).labels[0]).toMatchObject({ size: 5, depth: 0.6, rotationDeg: 0 });
    expect(configSchema.parse(box({ labels: [{ text: "A", component: "a" }] })).labels[0]).toMatchObject({ side: "below" });
  });

  it("can't mix ways of placing it", () => {
    expect(configSchema.safeParse(box({ labels: [{ text: "A", component: "a", u: 1, v: 2 }] })).success).toBe(false);
    expect(configSchema.safeParse(box({ labels: [{ text: "A" }] })).success).toBe(false);
  });
});

describe("placing a label", () => {
  const button = { id: "b", type: "arcade-24mm", surface: "top", u: 100, v: 60 };
  const spot = (config: unknown) => plan(config).labels[0]!;

  it("sits beside its part, on each side, clear of it", () => {
    const at = (side: string) => spot(box({ components: [button], labels: [{ text: "VOL", component: "b", side }] }));
    const flange = (plan(box({ components: [button] })).cutouts[0]!.diameter! / 2);
    expect(flange).toBeGreaterThan(10);
    const below = at("below");
    const above = at("above");
    const left = at("left");
    const right = at("right");
    expect(below.on).toMatchObject({ kind: "surface", surface: "top", u: 100 });
    if (below.on.kind !== "surface" || above.on.kind !== "surface" || left.on.kind !== "surface" || right.on.kind !== "surface") throw new Error();
    expect(below.on.v).toBeLessThan(60 - flange - below.up / 2);
    expect(above.on.v).toBeGreaterThan(60 + flange + above.up / 2);
    expect(left.on.u).toBeLessThan(100 - flange - left.across / 2);
    expect(right.on.u).toBeGreaterThan(100 + flange + right.across / 2);
    expect(left.on.v).toBe(60);
  });

  it("moves with its part", () => {
    const at = (u: number) => spot(box({ components: [{ ...button, u }], labels: [{ text: "VOL", component: "b" }] })).on;
    expect((at(60) as { u: number }).u).toBeCloseTo(60);
    expect((at(130) as { u: number }).u).toBeCloseTo(130);
  });

  it("goes beside a board's hole in the wall, on that wall, reading from outside", () => {
    const board = { id: "m", type: "rp2040-plus", x: 29, y: 60 };
    const built = (side: string) => plan(box({ components: [board], labels: [{ text: "USB", component: "m", side }] }));
    const hole = built("above").wallHoles[0]!;
    const above = built("above").labels[0]!;
    expect(above.on).toMatchObject({ kind: "wall", wall: "left", at: hole.at });
    expect((above.on as { z: number }).z).toBeGreaterThan(hole.z + hole.height / 2);
    // The left wall reads towards the front from outside, so a label to its right has a smaller y.
    expect((built("right").labels[0]!.on as { at: number }).at).toBeLessThan(hole.at - hole.width / 2);
    expect((built("left").labels[0]!.on as { at: number }).at).toBeGreaterThan(hole.at + hole.width / 2);
  });

  it("says when a part can't have one", () => {
    expect(problem(box({ labels: [{ text: "A", component: "gone" }] }))?.message).toContain("isn't in the design");
    const floor = { id: "a", type: "ads7830", x: 100, y: 60 };
    expect(problem(box({ components: [floor], labels: [{ text: "A", component: "a" }] }))?.message).toContain("no hole");
  });

  it("finds its printed part", () => {
    const seamed = box({ seams: [{ x: 100 }], topPanels: [{ surface: "top", splits: [] }] });
    const on = (labels: unknown[]) => plan({ ...seamed, labels }).labels.map((l) => plan({ ...seamed, labels }).printedParts[l.printedPart]!.name);
    expect(on([label({ u: 50 })])).toEqual(["Top"]);
    expect(on([{ text: "A", wall: "left", at: 60, z: 20 }])).toEqual(["Shell 1"]);
    expect(on([{ text: "A", wall: "right", at: 60, z: 20 }])).toEqual(["Shell 2"]);
    expect(on([{ text: "A", wall: "front", at: 50, z: 20 }])).toEqual(["Shell 1"]);
    expect(on([{ text: "A", wall: "rear", at: 150, z: 20 }])).toEqual(["Shell 2"]);
    const openTop = box({ seams: [{ x: 100 }] });
    const names = (config: any) => plan(config).labels.map((l) => plan(config).printedParts[l.printedPart]!.name);
    expect(names({ ...openTop, labels: [label({ u: 50 })] })).toEqual(["Shell 1"]);
    expect(names({ ...openTop, labels: [label({ u: 150 })] })).toEqual(["Shell 2"]);
  });

  it("turns its room with it", () => {
    const flat = spot(box({ labels: [label({ rotationDeg: 0 })] }));
    const turned = spot(box({ labels: [label({ rotationDeg: 90 })] }));
    expect(turned.across).toBeCloseTo(flat.up);
    expect(turned.up).toBeCloseTo(flat.across);
  });

  describe("won't take one that", () => {
    const top = (more: Record<string, unknown>) => box({ labels: [label(more)] });
    const wall = (more: Record<string, unknown>, config: any = box()) => ({ ...config, labels: [{ text: "VOL", wall: "rear", at: 100, z: 20, ...more }] });

    it("is empty, or has what it can't draw", () => {
      expect(problem(top({ text: "   " }))?.message).toContain("nothing");
      expect(problem(top({ text: "A★" }))?.message).toContain("★");
    });

    it("is too small to print", () => {
      expect(problem(top({ size: 3.4 }))?.message).toContain("close up");
      expect(problem(top({ size: 3.5 }))).toBeUndefined();
    });

    it("is too deep for what's behind it", () => {
      expect(problem(top({ depth: 2.5 }))?.message).toContain("deep");
      expect(problem(top({ depth: 2.4 }))).toBeUndefined();
      expect(problem(wall({ depth: 2.5 }))?.message).toContain("deep");
      expect(problem(wall({ depth: 2.4 }))).toBeUndefined();
    });

    it("runs off a surface", () => {
      expect(problem(top({ u: 5 }))?.message).toContain("edge");
      expect(problem(top({ u: 195 }))?.message).toContain("edge");
      expect(problem(top({ v: 2 }))?.message).toContain("edge");
      expect(problem(top({ v: 118 }))?.message).toContain("edge");
    });

    it("runs off a rounded corner", () => {
      const round = (u: number, v: number) => ({ ...box({ labels: [label({ text: "I", u, v, size: 10 })] }), enclosure: { width: 200, frontHeight: 40, cornerRadius: 24, surfaces: [{ id: "top", y: 120, z: 40 }] } });
      expect(problem(round(9, 10))?.message).toContain("edge");
      expect(problem(round(9, 60))).toBeUndefined();
    });

    it("is on a surface that isn't there", () => {
      expect(problem(top({ surface: "nope" }))?.message).toContain("doesn't exist");
    });

    it("crosses a joint between printed parts", () => {
      expect(problem({ ...top({}), seams: [{ x: 100 }] })?.message).toContain("joint");
      expect(problem({ ...top({ u: 60 }), seams: [{ x: 100 }] })).toBeUndefined();
      const panel = { topPanels: [{ surface: "top", splits: [100] }] };
      expect(problem({ ...top({}), ...panel })?.message).toContain("joint");
      expect(problem({ ...top({ u: 60 }), ...panel })).toBeUndefined();
      // A top panel in one piece doesn't care about the shell's seam.
      expect(problem({ ...top({}), seams: [{ x: 100 }], topPanels: [{ surface: "top" }] })).toBeUndefined();
      expect(problem(wall({ wall: "rear", at: 100 }, box({ seams: [{ x: 100 }] })))?.message).toContain("joint");
      expect(problem(wall({ wall: "rear", at: 60 }, box({ seams: [{ x: 100 }] })))).toBeUndefined();
    });

    it("is in the opening", () => {
      const opening = { opening: { xMin: 60, xMax: 140, yEnd: 40, sill: 10 } };
      expect(problem({ ...top({ v: 30 }), ...opening })?.message).toContain("opening");
      expect(problem({ ...top({ v: 80 }), ...opening })).toBeUndefined();
      expect(problem({ ...wall({ wall: "front", at: 100 }), ...opening })?.message).toContain("opening");
      expect(problem({ ...wall({ wall: "front", at: 30 }), ...opening })).toBeUndefined();
      expect(problem({ ...wall({ wall: "rear", at: 100 }), ...opening })).toBeUndefined();
    });

    it("runs into a hole", () => {
      const button = { id: "b", type: "arcade-24mm", surface: "top", u: 100, v: 60 };
      expect(problem({ ...top({ v: 60 }), components: [button] })?.message).toContain('"b"');
      expect(problem({ ...top({ v: 85 }), components: [button] })).toBeUndefined();
    });

    it("runs into a hole in the wall", () => {
      const holes = { wallHoles: [{ wall: "rear", at: 100, z: 20, width: 14, height: 8 }] };
      expect(problem(wall({}, box(holes)))?.message).toContain("hole");
      expect(problem(wall({ at: 150 }, box(holes)))).toBeUndefined();
      expect(problem(wall({ wall: "front" }, box(holes)))).toBeUndefined();
    });

    it("runs into another label", () => {
      const labels = [label(), label({ text: "VAL", v: 62 })];
      expect(problem(box({ labels }))?.message).toContain('"VOL"');
      expect(problem(box({ labels: [label(), label({ text: "VAL", v: 70 })] }))).toBeUndefined();
      expect(problem(box({ labels: [{ text: "A", wall: "rear", at: 100, z: 20 }, { text: "B", wall: "front", at: 100, z: 20 }] }))).toBeUndefined();
      expect(problem(box({ labels: [{ text: "A", wall: "rear", at: 100, z: 20 }, { text: "B", wall: "rear", at: 100, z: 22 }] }))?.message).toContain('"A"');
    });

    it("runs off a wall", () => {
      expect(problem(wall({ at: 2 }))?.message).toContain("corner");
      expect(problem(wall({ at: 198 }))?.message).toContain("corner");
      expect(problem(wall({ z: 1 }))?.message).toContain("flat");
      expect(problem(wall({ z: 36 }))?.message).toContain("flat");
      expect(problem(wall({ wall: "left", at: 2 }))?.message).toContain("corner");
    });

    it("is on a round at the bottom of a wall", () => {
      const rounded = box();
      rounded.enclosure.rounds = { rearBottom: 12 };
      expect(problem(wall({ z: 8 }, rounded))?.message).toContain("flat");
      expect(problem(wall({ z: 20 }, rounded))).toBeUndefined();
    });
  });

  it("warns about one a part would hide", () => {
    const button = { id: "b", type: "arcade-24mm", surface: "top", u: 100, v: 60 };
    // Clear of the hole, but under the flange, on the side away from its keyway.
    const hidden = box({ components: [button], labels: [label({ text: "I", u: 100, v: 60 - 12.12 - 0.6 - 2.5 - 0.05 })] });
    expect(problem(hidden)).toBeUndefined();
    expect(warnings(hidden).map((w) => w.componentIds)).toEqual([["b"]]);
    expect(warnings(box({ components: [button], labels: [label({ v: 85 })] }))).toEqual([]);
  });

  it("says where a problem is", () => {
    const where = (config: unknown) => problem(config)?.where;
    expect(where(box({ labels: [label({ u: 5 })] }))).toBeDefined();
    const atWall = where(box({ labels: [{ text: "A", wall: "rear", at: 2, z: 20 }] }));
    expect(atWall!.min[1]).toBeCloseTo(119);
    expect(atWall!.max[1]).toBeCloseTo(121);
  });
});

describe("what a label changes", () => {
  it("only re-cuts the part it's on", () => {
    const one = box({ topPanels: [{ surface: "top" }] });
    const before = planKeys(plan(one));
    const after = planKeys(plan({ ...one, labels: [label()] }));
    const top = plan(one).printedParts.find((p) => p.kind === "top")!.index;
    expect(partsToRecut(before, after)).toEqual([top]);
  });
});

describe("engraving", () => {
  beforeAll(() => initEngine(), 60_000);
  const overlap = (a: Shape3D, b: Shape3D) => {
    try {
      return measureVolume(a.intersect(b));
    } catch (error) {
      if (String(error).includes("deleted")) throw error;
      return 0;
    }
  };
  const volume = (config: unknown, index = 0) => measureVolume(buildEnclosure(plan(config)).parts[index]!.shape);
  const sound = async (shape: Shape3D) => {
    expect(isValidSolid(shape)).toBe(true);
    const stl = analyseBinarySTL(new Uint8Array(await shape.blobSTL({ binary: true, tolerance: 0.05, angularTolerance: 0.2 }).arrayBuffer()));
    expect(stl.watertight).toBe(true);
  };

  it("cuts as much as the letters take, to its depth", async () => {
    const config = box({ labels: [label({ text: "HOTEL", depth: 0.8 })] });
    const shape = buildEnclosure(plan(config)).parts[0]!.shape;
    await sound(shape);
    const { glyphs } = textOutline("HOTEL", 5);
    const ink = glyphs.reduce((sum, g) => sum + g.outers.reduce((a, o) => a + area(o), 0) + g.holes.reduce((a, h) => a + area(h), 0), 0);
    expect(volume(box()) - measureVolume(shape)).toBeCloseTo(ink * 0.8, 1);
  }, 60_000);

  it("leaves what's inside a letter", () => {
    const config = box({ labels: [label({ text: "O", size: 20 })] });
    const shape = buildEnclosure(plan(config)).parts[0]!.shape;
    // The middle of the O is still there, and its stroke isn't.
    expect(overlap(shape, makeCylinder(0.5, 0.3, [100, 60, 39.9 - 0.3], [0, 0, 1]))).toBeGreaterThan(0.1);
    const { width } = textOutline("O", 20);
    expect(overlap(shape, makeCylinder(0.3, 0.3, [100 + width / 2 - 1.4, 60, 39.8], [0, 0, 1]))).toBeLessThan(0.001);
  }, 60_000);

  // An L's stem is at its reading start, and the rest of that end's height is empty past its foot.
  const ALONG = {
    front: { dir: [1, 0], out: [0, -1], at: (a: number): [number, number] => [a, 0] },
    rear: { dir: [-1, 0], out: [0, 1], at: (a: number): [number, number] => [a, 120] },
    left: { dir: [0, -1], out: [-1, 0], at: (a: number): [number, number] => [0, a] },
    right: { dir: [0, 1], out: [1, 0], at: (a: number): [number, number] => [200, a] },
  } as const;

  for (const wall of ["front", "rear", "left", "right"] as const) {
    it(`reads properly from outside the ${wall} wall`, async () => {
      const at = wall === "left" || wall === "right" ? 60 : 100;
      const config = box({ labels: [{ text: "L", wall, at, z: 20, size: 12 }] });
      const built = plan(config);
      const shape = buildEnclosure(built).parts[0]!.shape;
      await sound(shape);
      const { across, up } = built.labels[0]!;
      const { dir, out } = ALONG[wall];
      const nib = nibFor(12);
      const reading = (offset: number): [number, number] => {
        const [x, y] = ALONG[wall].at(at);
        return [x + dir[0] * offset, y + dir[1] * offset];
      };
      const probe = (offset: number, z: number) => {
        const [x, y] = reading(offset);
        // A short stick going in from just inside the face.
        return overlap(shape, makeCylinder(0.15, 0.3, [x - out[0] * 0.4, y - out[1] * 0.4, z], [out[0], out[1], 0]));
      };
      // The stem, at the start of the reading direction, near the top.
      expect(probe(-across / 2 + nib / 2, 20 + up / 2 - nib)).toBeLessThan(0.001);
      // Nothing at the far end up there.
      expect(probe(across / 2 - nib / 2, 20 + up / 2 - nib)).toBeGreaterThan(0.01);
      // The foot, at the far end at the bottom.
      expect(probe(across / 2 - nib / 2, 20 - up / 2 + nib / 2)).toBeLessThan(0.001);
      // And it stops at its depth.
      const [x, y] = reading(-across / 2 + nib / 2);
      expect(overlap(shape, makeCylinder(0.15, 0.3, [x - out[0] * 1.2, y - out[1] * 1.2, 20], [out[0], out[1], 0]))).toBeGreaterThan(0.01);
    }, 60_000);
  }

  it("reads properly from above a surface, and turned", async () => {
    const stem = (rotationDeg: number, [dx, dy]: [number, number]) => {
      const config = box({ labels: [label({ text: "L", size: 12, rotationDeg })] });
      const built = plan(config);
      const shape = buildEnclosure(built).parts[0]!.shape;
      const { across, up } = built.labels[0]!;
      return overlap(shape, makeCylinder(0.15, 0.3, [100 + (dx * across) / 2, 60 + (dy * up) / 2, 39.7], [0, 0, 1]));
    };
    // The top of the stem is at the upper left, and the far end of the foot is at the lower right.
    expect(stem(0, [-0.9, 0.9])).toBeLessThan(0.001);
    expect(stem(0, [0.9, 0.9])).toBeGreaterThan(0.01);
    expect(stem(0, [0.9, -0.9])).toBeLessThan(0.001);
    // A quarter turn counterclockwise puts them at the lower left and upper right.
    expect(stem(90, [-0.9, -0.9])).toBeLessThan(0.001);
    expect(stem(90, [-0.9, 0.9])).toBeGreaterThan(0.01);
    expect(stem(90, [0.9, 0.9])).toBeLessThan(0.001);
    expect(stem(180, [0.9, -0.9])).toBeLessThan(0.001);
    expect(stem(180, [-0.9, -0.9])).toBeGreaterThan(0.01);
    expect(stem(270, [0.9, 0.9])).toBeLessThan(0.001);
    expect(stem(270, [0.9, -0.9])).toBeGreaterThan(0.01);
  }, 120_000);

  it("follows a sloped surface", async () => {
    const config = { ...box({ labels: [label({ text: "HI" })] }), enclosure: { width: 200, frontHeight: 20, cornerRadius: 3, surfaces: [{ id: "top", y: 120, z: 60 }] } };
    const shape = buildEnclosure(plan(config)).parts[0]!.shape;
    await sound(shape);
    const { glyphs } = textOutline("HI", 5);
    const ink = glyphs.reduce((sum, g) => sum + g.outers.reduce((a, o) => a + area(o), 0), 0);
    const plain = { ...config, labels: [] };
    expect(measureVolume(buildEnclosure(plan(plain)).parts[0]!.shape) - measureVolume(shape)).toBeCloseTo(ink * 0.6, 1);
  }, 60_000);

  it("gives a sound part with every letter on a top panel, and it still prints face down", async () => {
    const config = box({ topPanels: [{ surface: "top" }], labels: [label({ text: "ABCDEFGHIJKLM", v: 80, size: 4 }), label({ text: "NOPQRSTUVWXYZ", v: 60, size: 4 }), label({ text: "0123456789", v: 40, size: 4 }), label({ text: ".,:-+=/()'!?#&", v: 20, size: 4 })] });
    const built = plan(config);
    const { parts } = buildEnclosure(built);
    const top = parts.find((part) => part.kind === "top")!;
    await sound(top.shape);
    const reports = planPrint(built, parts.map((part) => part.shape.mesh({ tolerance: 0.1, angularTolerance: 0.3 })));
    const report = reports[top.index]!;
    expect(report.best.id).toBe("face-top");
    expect(report.needsSupport).toBe(false);
    expect(report.problems).toEqual([]);
    expect(report.resolved.join(" ")).toContain("labels");
  }, 120_000);

  it("doesn't change how the Desk Synth prints", () => {
    const config = deskSynth();
    config.labels = [{ text: "Bass", component: "bass-voicing", side: "right", size: 4 }, { text: "Desk Synth", surface: "back", u: 150, v: 35, size: 8 }, { text: "USB-C", component: "mcu", side: "above", size: 4 }];
    const built = plan(config);
    const orientations = (p: BuildPlan) => {
      const { parts } = buildEnclosure(p);
      return planPrint(p, parts.map((part) => part.shape.mesh({ tolerance: 0.1, angularTolerance: 0.3 }))).map((report) => report.best.id);
    };
    expect(orientations(built)).toEqual(orientations(plan(deskSynth())));
  }, 180_000);
});

describe("editing labels", () => {
  const one = () => box({ components: [{ id: "b", type: "arcade-24mm", surface: "top", u: 100, v: 60 }] });

  it("sets and clears a part's label, leaving nothing in the file", () => {
    const set = setComponentLabel(one(), "b", { text: "VOL" });
    expect(labelOfComponent(set, "b")).toEqual({ text: "VOL", component: "b" });
    const moved = setComponentLabel(set, "b", { side: "above" });
    expect(labelOfComponent(moved, "b")).toEqual({ text: "VOL", component: "b", side: "above" });
    expect(labelOfComponent(setComponentLabel(moved, "b", { text: "GAIN" }), "b")).toEqual({ text: "GAIN", component: "b", side: "above" });
    expect(setComponentLabel(moved, "b", { text: " " })).toEqual(one());
    expect(setComponentLabel(one(), "b", { side: "above" })).toEqual(one());
    expect(validateConfig(moved).ok).toBe(true);
  });

  it("goes with its part when that's deleted", () => {
    const labelled = { ...setComponentLabel(one(), "b", { text: "VOL" }) };
    const gone = removeComponent(labelled, "b");
    expect(gone.labels).toBeUndefined();
    expect(gone.components).toEqual([]);
    const free = { ...labelled, labels: [...labelled.labels, label()] };
    expect(removeComponent(free, "b").labels).toEqual([label()]);
  });

  it("adds them where the validator takes them", () => {
    const base = box();
    expect(validateConfig(addSurfaceLabel(base)).ok).toBe(true);
    expect(validateConfig(addWallLabel(base)).ok).toBe(true);
    const added = addWallLabel(addSurfaceLabel(base));
    expect(added.labels).toHaveLength(2);
    expect(validateConfig(added).ok).toBe(true);
  });

  it("updates one and removes one", () => {
    const added = addWallLabel(addSurfaceLabel(box()));
    const changed = updateLabel(added, 1, { z: 22.123, text: "OUT" });
    expect(changed.labels[1]).toMatchObject({ z: 22.12, text: "OUT" });
    expect(changed.labels[0]).toEqual(added.labels[0]);
    expect(removeLabel(removeLabel(changed, 0), 0)).toEqual(box());
  });
});
