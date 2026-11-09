// Parts that go through a wall: a hole, room behind it that everything else keeps out of, and what
// shows outside.
import { beforeAll, describe, expect, it } from "vitest";
import { makeCylinder, measureVolume, type Shape3D } from "replicad";
import { analyseBinarySTL, isValidSolid } from "../src/checks.js";
import { buildEnclosure, initEngine, library, planFitTest, validateConfig, type BuildPlan } from "../src/index.js";
import { addComponent, removeComponent } from "../src/app/configEdit.js";
import { labelOfComponent, setComponentLabel } from "../src/app/labelEdit.js";
import { alignableWith, centreComponent, mirrorComponent } from "../src/app/layoutEdit.js";
import { buildSceneModel, issueSpot, nearestNeighbour } from "../src/app/sceneModel.js";
import { errors } from "./helpers.js";

const box = (overrides: Record<string, unknown> = {}): any => ({
  schemaVersion: 1,
  name: "box",
  enclosure: { width: 200, frontHeight: 40, cornerRadius: 3, surfaces: [{ id: "top", y: 120, z: 40 }] },
  ...overrides,
});
const din = (more: Record<string, unknown> = {}) => ({ id: "m", type: "midi-din-5", wall: "rear", at: 100, z: 22, ...more });
const jack = (more: Record<string, unknown> = {}) => ({ id: "j", type: "trs-35-panel", wall: "rear", at: 60, z: 20, ...more });
const withParts = (...components: unknown[]) => box({ components });
const custom = (more: Record<string, unknown> = {}) => ({ name: "custom", source: "measured", mount: "wall", holes: [{ width: 8, height: 8, at: [0, 0] }], body: { width: 10, height: 10, depth: 10 }, outside: { width: 10, height: 10 }, ...more });
const codes = (config: unknown) => errors(config).map((e) => e.code);
function plan(config: unknown): BuildPlan {
  const result = validateConfig(config);
  if (!result.ok) throw new Error(JSON.stringify(result.errors, null, 1));
  return result.plan;
}
const overlap = (a: Shape3D, b: Shape3D) => {
  try {
    return measureVolume(a.intersect(b));
  } catch (error) {
    if (String(error).includes("deleted")) throw error;
    return 0;
  }
};

describe("placing a part in a wall", () => {
  it("makes its holes, along the wall as it reads from outside", () => {
    const at = (wall: string, position: number) => plan(withParts(din({ wall, at: position }))).wallHoles.map((h) => h.at);
    expect(at("front", 100)).toEqual([100, 100 - 11.1, 100 + 11.1]);
    expect(at("rear", 100)).toEqual([100, 100 + 11.1, 100 - 11.1]);
    expect(plan(withParts(din())).wallHoles[0]).toMatchObject({ wall: "rear", z: 22, width: 15.5, height: 15.5, componentId: "m" });
  });

  it("turns its holes with it", () => {
    const holes = plan(withParts(din({ rotationDeg: 90 }))).wallHoles;
    expect(holes.map((h) => h.at)).toEqual([100, 100, 100]);
    expect(holes.map((h) => h.z)).toEqual([22, 22 - 11.1, 22 + 11.1].map((v) => expect.closeTo(v, 5)));
    const flat = plan(withParts({ id: "u", type: "usb-c-panel", wall: "rear", at: 100, z: 19.5, rotationDeg: 90 })).wallHoles[0]!;
    expect([flat.width, flat.height]).toEqual([4.5, 10.5]);
  });

  it("is placed with a wall, not like other parts", () => {
    expect(codes(withParts({ id: "m", type: "midi-din-5", x: 100, y: 60 }))).toContain("WRONG_MOUNT");
    expect(codes(withParts({ id: "a", type: "arcade-24mm", wall: "rear", at: 100, z: 20 }))).toContain("WRONG_MOUNT");
  });

  it("has every library part valid somewhere", () => {
    for (const [id, part] of Object.entries(library)) {
      if (part.mount !== "wall") continue;
      expect(validateConfig(withParts({ id: "a", type: id, wall: "rear", at: 100, z: 24 })).ok, id).toBe(true);
    }
    const { config } = addComponent(box(), "fader-60mm");
    expect(validateConfig(config).ok).toBe(true);
    expect(validateConfig(addComponent(box(), "led-3mm").config).ok).toBe(true);
    expect(validateConfig(addComponent(box(), "led-5mm").config).ok).toBe(true);
  });

  it("says its numbers aren't measured", () => {
    const result = validateConfig(withParts(din()));
    expect(result.warnings.map((w) => w.code)).toContain("UNVERIFIED_PART");
  });

  describe("won't take one", () => {
    it("through too thick a wall", () => {
      const config = withParts(jack());
      config.enclosure.wall = 5;
      expect(codes(config)).toContain("WALL_TOO_THIN");
      expect(errors(withParts(jack())).length).toBe(0);
    });

    it("that runs into a wall behind it", () => {
      expect(codes(withParts(din({ at: 10 })))).toEqual(expect.arrayContaining(["BODY_HITS_ENCLOSURE"]));
      expect(codes(withParts(din({ wall: "left", at: 5 })))).toEqual(expect.arrayContaining(["BODY_HITS_ENCLOSURE"]));
    });

    it("under the floor, or over the top", () => {
      expect(codes(withParts(din({ z: 10 })))).toContain("BODY_HITS_ENCLOSURE");
      expect(errors(withParts(din({ z: 16 }))).find((e) => e.code === "BODY_HITS_ENCLOSURE")).toBeUndefined();
      expect(codes(withParts(din({ z: 35 })))).toContain("BODY_HITS_ENCLOSURE");
      // Without a plate there's no floor to keep above.
      expect(codes({ ...withParts(jack({ z: 8 })), plate: { enabled: false } })).not.toContain("BODY_HITS_ENCLOSURE");
    });

    it("with its top under a sloping surface", () => {
      const sloped = withParts(din({ wall: "rear", z: 25 }));
      sloped.enclosure.surfaces = [{ id: "top", y: 120, z: 30 }];
      sloped.enclosure.frontHeight = 60;
      expect(errors(sloped).some((e) => e.message.includes("underside of the top") || e.code === "WALL_HOLE_INVALID")).toBe(true);
    });

    it("that shows on a rounded corner", () => {
      const flanged = custom({ outside: { width: 40, height: 12 } });
      const at = (position: number) => {
        const config = { ...withParts({ id: "c", type: "custom", wall: "rear", at: position, z: 20 }), customParts: { custom: flanged } };
        config.enclosure.cornerRadius = 12;
        return errors(config).map((e) => e.message).join(" ");
      };
      expect(at(25)).toContain("rounded corner");
      expect(at(35)).not.toContain("rounded corner");
    });

    it("in the way of a seam", () => {
      const seamed = (component: unknown) => ({ ...withParts(component), seams: [{ x: 100 }] });
      expect(codes(seamed(din({ at: 100 })))).toContain("BODY_HITS_RIB");
      expect(codes(seamed(jack({ at: 60, z: 22 })))).not.toContain("BODY_HITS_RIB");
    });

    it("that hits a board", () => {
      const board = { id: "b", type: "ads7830", x: 60, y: 100 };
      expect(codes(withParts(jack({ at: 60, z: 10 }), board))).toContain("BODIES_COLLIDE");
      expect(codes(withParts(jack({ at: 60, z: 35 }), board))).not.toContain("BODIES_COLLIDE");
    });

    it("that hits a board's cradle", () => {
      const board = { id: "b", type: "rp2040-plus", x: 60, y: 90 };
      const near = withParts(jack({ at: 60, z: 10 }), board);
      expect(codes(near)).toContain("BODIES_COLLIDE");
    });

    it("that only hits a board's cradle, past the board itself", () => {
      const board = { id: "b", type: "rp2040-plus", x: 60, y: 80 };
      const clip = plan(withParts(board)).holderBlocks.filter((block) => block.kind === "clip").sort((a, b) => b.yHigh - a.yHigh)[0]!;
      const atClip = custom({ body: { width: 6, height: 8, depth: 117 - (clip.yHigh - 0.5) } });
      const reaching = { ...withParts(board, { id: "c", type: "custom", wall: "rear", at: (clip.xLow + clip.xHigh) / 2, z: 10 }), customParts: { custom: atClip } };
      expect(errors(reaching).map((e) => e.message).join(" ")).toContain("cradle");
    });

    it("that hits a part hanging from the top", () => {
      const dial = { id: "d", type: "arcade-24mm", surface: "top", u: 60, v: 100 };
      expect(codes(withParts(din({ at: 60, z: 30 }), dial))).toContain("BODIES_COLLIDE");
      expect(codes(withParts(din({ at: 130, z: 30 }), dial))).not.toContain("BODIES_COLLIDE");
    });

    it("in the opening, or the room it keeps", () => {
      const opening = { xMin: 40, xMax: 160, yEnd: 60, sill: 8, keepOut: [{ xMin: 40, xMax: 160, yMin: 0, yMax: 100, top: 15 }] };
      expect(codes({ ...withParts(jack({ wall: "front", at: 100, z: 20 })), opening })).toContain("OPENING_INVALID");
      expect(codes({ ...withParts({ id: "l", type: "trs-635-panel", wall: "left", at: 90, z: 20 }), opening: { ...opening, keepOut: [{ xMin: 0, xMax: 40, yMin: 70, yMax: 100, top: 15 }] } })).toContain("BODIES_COLLIDE");
    });

    it("on top of another", () => {
      expect(codes(withParts(din(), jack({ at: 104 })))).toContain("BODIES_COLLIDE");
      expect(codes(withParts(din(), jack({ at: 125 })))).not.toContain("BODIES_COLLIDE");
      // Around a corner, where only what's behind the walls can meet.
      const corner = (y: number) => errors(withParts({ id: "l", type: "trs-635-panel", wall: "left", at: y, z: 20 }, din({ at: 20, z: 20 }))).map((e) => e.message).join(" ");
      expect(corner(100)).toContain("run into each other");
      expect(corner(60)).not.toContain("run into each other");
      // Far enough apart behind the wall, but what shows outside runs together.
      expect(errors(withParts(din(), { id: "k", type: "midi-din-5", wall: "rear", at: 127, z: 22 })).some((e) => e.message.includes("outside"))).toBe(true);
      expect(errors(withParts(din(), { id: "k", type: "midi-din-5", wall: "rear", at: 132, z: 22 })).some((e) => e.message.includes("outside"))).toBe(false);
    });
  });

  it("keeps screws out of the room behind it, not just its hole", () => {
    const [x, y] = plan(box()).plate!.screws.find(([sx, sy]) => sx === 100 && sy > 60)!;
    // The hole is well along from the screw, and a wide body reaches over it.
    const wide = custom({ body: { width: 60, height: 12, depth: 12 } });
    const config = { ...withParts({ id: "c", type: "custom", wall: "rear", at: x + 25, z: 25 }), customParts: { custom: wide } };
    const screws = plan(config).plate!.screws;
    expect(plan(box()).plate!.screws.some(([sx, sy]) => sx === x && sy === y)).toBe(true);
    expect(screws.some(([sx, sy]) => sx > x + 25 - 30 - 4 && sx < x + 25 + 30 + 4 && sy > 117 - 12 - 4)).toBe(false);
  });

  it("tells the assembly to fit it", () => {
    expect(plan(withParts(din())).assembly.join(" ")).toContain("through the walls");
    expect(plan(box()).assembly.join(" ")).not.toContain("through the walls");
  });

  it("gets a row in the fit test for its main hole, with its size set per part", () => {
    const rows = planFitTest(plan(withParts(din(), { id: "k", type: "midi-din-5", wall: "rear", at: 50, z: 22 }))).rows.filter((row) => row.kind === "wallHole");
    expect(rows).toHaveLength(1);
    expect(rows[0]!.parts).toEqual(["midi-din-5"]);
    expect(rows[0]!.wallHole).toMatchObject({ width: 15.5, height: 15.5 });
    expect(rows[0]!.setting).toBe("partHoles");
    const tuned = { ...withParts(din()), fabrication: { fit: { partHoles: { "midi-din-5": 0.2 } } } };
    expect(plan(tuned).wallHoles[0]).toMatchObject({ width: 15.7, height: 15.7 });
    expect(plan(tuned).wallHoles[1]!.width).toBeCloseTo(3.4);
  });

  it("can have a label beside it", () => {
    const label = (side: string) => plan({ ...withParts(din({ z: 16 })), labels: [{ text: "MIDI", component: "m", side }] }).labels[0]!;
    expect(label("above").on).toMatchObject({ kind: "wall", wall: "rear", at: 100 });
    expect((label("above").on as { z: number }).z).toBeGreaterThan(16 + 10);
    // The rear wall reads towards -x from outside.
    expect((label("right").on as { at: number }).at).toBeLessThan(100 - 15);
    expect((label("left").on as { at: number }).at).toBeGreaterThan(100 + 15);
  });

  it("warns about a label it hides", () => {
    const result = validateConfig({ ...withParts(din()), labels: [{ text: "I", wall: "rear", at: 100 + 14, z: 22 + 8 }] });
    expect(result.warnings.map((w) => w.code)).toContain("LABEL_HIDDEN");
  });
});

describe("building a part in a wall", () => {
  beforeAll(() => initEngine(), 60_000);

  const sound = async (shape: Shape3D) => {
    expect(isValidSolid(shape)).toBe(true);
    const stl = analyseBinarySTL(new Uint8Array(await shape.blobSTL({ binary: true, tolerance: 0.05, angularTolerance: 0.2 }).arrayBuffer()));
    expect(stl.watertight).toBe(true);
    expect(shape.solids).toHaveLength(1);
  };

  it("cuts a round hole and its screw holes through the rear wall", async () => {
    const shape = buildEnclosure(plan(withParts(din()))).parts[0]!.shape;
    await sound(shape);
    const through = (dx: number, r: number) => overlap(shape, makeCylinder(r, 4, [100 + dx, 116.5, 22], [0, 1, 0]));
    expect(through(0, 7.7)).toBeLessThan(0.001);
    expect(through(11.1, 1.55)).toBeLessThan(0.001);
    expect(through(-11.1, 1.55)).toBeLessThan(0.001);
    expect(through(7.7 + 0.2, 0.05)).toBeGreaterThan(0.001);
  }, 60_000);

  it("cuts a fully round hole as one round face", () => {
    const faces = (config: unknown) => buildEnclosure(plan(config)).parts[0]!.shape.faces.length;
    expect(faces(withParts(jack())) - faces(box())).toBe(1);
  }, 60_000);

  it("works on every wall, and on a seamed shell", async () => {
    for (const wall of ["front", "left", "right"] as const) {
      const at = wall === "front" ? 100 : 60;
      await sound(buildEnclosure(plan(withParts(jack({ wall, at })))).parts[0]!.shape);
    }
    const { parts } = buildEnclosure(plan({ ...withParts(jack({ wall: "rear", at: 50, z: 22 })), seams: [{ x: 100 }] }));
    await sound(parts[0]!.shape);
    await sound(parts[1]!.shape);
  }, 120_000);
});

describe("a part in a wall in the app", () => {
  it("finds a spot for itself, on the rear wall first", () => {
    const { config, id } = addComponent(box(), "midi-din-5");
    const added = config.components.find((c: any) => c.id === id);
    expect(added.wall).toBe("rear");
    expect(validateConfig(config).ok).toBe(true);
    const again = addComponent(config, "midi-din-5");
    expect(validateConfig(again.config).ok).toBe(true);
  });

  it("is in the scene model, for showing and picking", () => {
    const model = buildSceneModel(withParts(din(), jack({ wall: "left", at: 60 })))!;
    const placed = model.components.find((c) => c.id === "m")!;
    expect(placed).toMatchObject({ mount: "wall", a: 100, b: 22, surface: null });
    expect(placed.inWall).toMatchObject({ wall: "rear", depth: 22 });
    expect(placed.inWall!.face).toMatchObject({ hu: 15, hv: 10 });
    expect(model.components.find((c) => c.id === "j")!.printedPart).toBe(0);
  });

  it("turns in the scene model", () => {
    const placed = buildSceneModel(withParts(din({ rotationDeg: 90 })))!.components[0]!;
    expect(placed.inWall!.face).toMatchObject({ hu: 10, hv: 15 });
  });

  it("finds its neighbour on the same wall only", () => {
    const model = buildSceneModel(withParts(din(), jack({ at: 60 }), jack({ id: "k", wall: "front", at: 100 })))!;
    expect(nearestNeighbour(model, "m")).toMatchObject({ id: "j" });
    expect(nearestNeighbour(model, "k")).toBeNull();
  });

  it("marks the spot of a problem with it", () => {
    const config = withParts(din());
    const model = buildSceneModel(config)!;
    const spot = issueSpot({ path: "components[0]" }, config, model, { items: [], edges: [] })!;
    expect(spot.min[1]).toBeCloseTo(118);
    expect(spot.max[1]).toBeCloseTo(122);
    expect(spot.min[0]).toBeCloseTo(85);
    expect(spot.max[2]).toBeCloseTo(32);
  });

  it("lines up with parts on its wall, and mirrors across", () => {
    const config = withParts(din(), jack({ at: 60 }), jack({ id: "k", wall: "front", at: 100 }), { id: "a", type: "arcade-24mm", surface: "top", u: 60, v: 60 });
    expect(alignableWith(config, "m")).toEqual(["j"]);
    expect(alignableWith(config, "a")).toEqual([]);
    const mirrored = mirrorComponent(withParts(jack({ wall: "left", at: 60 })), "j")!;
    expect(mirrored.config.components[1]).toMatchObject({ wall: "right", at: 60 });
    const along = mirrorComponent(withParts(jack({ at: 60 })), "j")!;
    expect(along.config.components[1]).toMatchObject({ wall: "rear", at: 140 });
    expect(centreComponent(withParts(jack({ at: 60 })), "j").components[0].at).toBe(100);
    expect(centreComponent(withParts(jack({ wall: "left", at: 30 })), "j").components[0].at).toBe(60);
  });

  it("starts its label above it, where there's room", () => {
    const set = setComponentLabel(withParts(din({ z: 16 })), "m", { text: "MIDI IN" });
    expect(labelOfComponent(set, "m")).toEqual({ text: "MIDI IN", component: "m", side: "above" });
    expect(validateConfig(set).ok).toBe(true);
    // It keeps what's been chosen after that.
    const below = setComponentLabel(set, "m", { side: "below" });
    expect(labelOfComponent(setComponentLabel(below, "m", { text: "OUT" }), "m")!.side).toBe("below");
  });

  it("goes with its label when deleted", () => {
    const labelled = { ...withParts(din()), labels: [{ text: "MIDI", component: "m" }] };
    expect(validateConfig(removeComponent(labelled, "m")).ok).toBe(true);
  });
});
