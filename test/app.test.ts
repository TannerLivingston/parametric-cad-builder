import { describe, expect, it } from "vitest";
import { library } from "../src/library.js";
import { validateConfig } from "../src/validate.js";
import { surfacePoint } from "../src/profile.js";
import { addComponent, formatConfig, parseConfig, removeComponent, updateComponent } from "../src/app/configEdit.js";
import { partsToRecut, planKeys } from "../src/app/planDiff.js";
import { buildSceneModel, explodeOffset, issueSpot, measureBetween, nearestNeighbour, sectionPlane, sectionRange, snap, surfaceCoordinates } from "../src/app/sceneModel.js";
import { blank, deckAndPanel, deskSynth } from "./helpers.js";

function plan(config: unknown) {
  const result = validateConfig(config);
  if (!result.ok) throw new Error(JSON.stringify(result.errors));
  return result.plan;
}

describe("config text", () => {
  it("round-trips without changing the config", () => {
    const config = deskSynth();
    expect(parseConfig(formatConfig(config))).toEqual({ ok: true, config });
  });

  it("is stable when formatted twice", () => {
    const once = formatConfig(deskSynth());
    const parsed = parseConfig(once);
    if (!parsed.ok) throw new Error(parsed.message);
    expect(formatConfig(parsed.config)).toBe(once);
  });

  it("moves one line of the diff when one part moves", () => {
    const before = formatConfig(deskSynth()).split("\n");
    const after = formatConfig(updateComponent(deskSynth(), "button-2", { u: 57 })).split("\n");
    expect(after).toHaveLength(before.length);
    expect(after.filter((line, i) => line !== before[i])).toEqual([expect.stringContaining('"button-2"')]);
  });

  it("doesn't write defaults into the file", () => {
    const text = formatConfig(updateComponent(blank({ components: [{ id: "a", type: "ttp223", u: 40, v: 60 }] }), "a", { u: 41 }));
    expect(text).not.toContain("rotationDeg");
    expect(text).not.toContain("buildVolume");
  });

  it("reports bad JSON instead of throwing", () => {
    expect(parseConfig("{ nope").ok).toBe(false);
    expect(parseConfig("[1, 2]")).toEqual({ ok: false, message: "The config must be a JSON object." });
  });
});

describe("editing", () => {
  it("rounds positions to tidy numbers", () => {
    const edited = updateComponent(blank({ components: [{ id: "a", type: "ttp223", u: 40, v: 60 }] }), "a", { u: 41.23456 });
    expect(edited.components[0].u).toBe(41.23);
  });

  it("doesn't mutate the config it's given", () => {
    const config = blank({ components: [{ id: "a", type: "ttp223", u: 40, v: 60 }] });
    const snapshot = JSON.stringify(config);
    updateComponent(config, "a", { u: 41 });
    removeComponent(config, "a");
    addComponent(config, "ttp223");
    expect(JSON.stringify(config)).toBe(snapshot);
  });

  it("adds a panel part at a valid spot, with an unused id", () => {
    const { config, id } = addComponent(deckAndPanel({ components: [{ id: "ttp223-1", type: "ttp223", surface: "deck", u: 40, v: 40 }] }), "ttp223", "panel");
    expect(id).toBe("ttp223-2");
    expect(config.components.at(-1).surface).toBe("panel");
    expect(validateConfig(config).ok).toBe(true);
  });

  it("adds a floor part at a valid spot", () => {
    const { config } = addComponent(deckAndPanel(), "rp2040-plus");
    expect(config.components.at(-1)).toHaveProperty("x");
    expect(validateConfig(config).ok).toBe(true);
  });

  it("adds a part to a full enclosure anyway, and lets the validator explain", () => {
    const tiny = blank({ seams: [], enclosure: { width: 30, frontHeight: 40, surfaces: [{ id: "a", y: 30, z: 40 }] } });
    const { config } = addComponent(tiny, "encoder-board-5752");
    expect(config.components).toHaveLength(1);
    expect(validateConfig(config).ok).toBe(false);
  });

  it("removes a part", () => {
    expect(removeComponent(deskSynth(), "display").components.find((c: any) => c.id === "display")).toBeUndefined();
  });
});

describe("the scene model", () => {
  it("places each component and its printed part", () => {
    const model = buildSceneModel(deskSynth())!;
    const by = (id: string) => model.components.find((c) => c.id === id)!;
    expect(by("button-1").surface?.id).toBe("deck");
    expect(by("button-1").printedPart).toBe(0);
    expect(by("encoders-right").surface?.id).toBe("panel");
    expect(by("encoders-right").printedPart).toBe(1);
    expect(by("mcu").mount).toBe("floor");
    expect(by("mcu").floor?.height).toBe(13.5);
  });

  it("still models layouts the validator rejects, so they can be dragged out of trouble", () => {
    const config = updateComponent(deskSynth(), "button-2", { u: 26 });
    expect(validateConfig(config).ok).toBe(false);
    expect(buildSceneModel(config)?.components).toHaveLength(config.components.length);
  });

  it("returns nothing for a config that doesn't parse", () => {
    expect(buildSceneModel({ schemaVersion: 2 })).toBeNull();
  });

  it("swaps a footprint's sizes when it's turned", () => {
    const flat = buildSceneModel(deckAndPanel({ components: [{ id: "a", type: "ttp223", surface: "deck", u: 40, v: 40 }] }))!.components[0]!;
    const turned = buildSceneModel(deckAndPanel({ components: [{ id: "a", type: "ttp223", surface: "deck", u: 40, v: 40, rotationDeg: 90 }] }))!.components[0]!;
    expect(flat.below).toMatchObject({ hu: 8, hv: 6 });
    expect(turned.below).toMatchObject({ hu: 6, hv: 8 });
  });

  it("finds a surface position from a world point, the inverse of placing one", () => {
    const { surfaces } = buildSceneModel(deckAndPanel())!;
    for (const surface of surfaces) {
      const [y, z] = surfacePoint(surface, 17.5, 0);
      const { u, v } = surfaceCoordinates(surface, [42, y, z]);
      expect(u).toBe(42);
      expect(v).toBeCloseTo(17.5);
    }
  });

  it("spreads parts evenly when separated", () => {
    expect(explodeOffset(0, 2, 40)).toBe(-20);
    expect(explodeOffset(1, 2, 40)).toBe(20);
    expect(explodeOffset(0, 1, 40)).toBe(0);
  });

  it("snaps to a grid", () => {
    expect(snap(10.3, 0.5)).toBe(10.5);
    expect(snap(10.04, 0.1)).toBeCloseTo(10);
  });
});

describe("rebuilding as little as possible", () => {
  const keysFor = (config: unknown) => planKeys(plan(config));

  it("rebuilds everything the first time", () => {
    expect(partsToRecut(null, keysFor(deskSynth()))).toBeNull();
  });

  it("does nothing when the plan is unchanged", () => {
    expect(partsToRecut(keysFor(deskSynth()), keysFor(deskSynth()))).toEqual([]);
  });

  it("re-cuts only the part holding a moved cutout", () => {
    const partOf = (name: string) => plan(deskSynth()).printedParts.find((p) => p.name === name)!.index;
    expect(partsToRecut(keysFor(deskSynth()), keysFor(updateComponent(deskSynth(), "button-2", { u: 57 })))).toEqual([partOf("Deck 1")]);
    expect(partsToRecut(keysFor(deskSynth()), keysFor(updateComponent(deskSynth(), "encoders-right", { u: 280 })))).toEqual([partOf("Panel 2")]);
  });

  it("re-cuts neither part when only a floor part moves", () => {
    // One with nothing on the plate to hold it.
    const loose = () => {
      const config = deskSynth();
      const { standoffs: _, ...plain } = library.ads7830 as Record<string, unknown>;
      config.customParts = { ...config.customParts, "plain-adc": plain };
      config.components.find((c: any) => c.id === "adc-a").type = "plain-adc";
      return config;
    };
    expect(partsToRecut(keysFor(loose()), keysFor(updateComponent(loose(), "adc-a", { x: 164 })))).toEqual([]);
  });

  it("rebuilds the plate when a board on standoffs moves", () => {
    expect(partsToRecut(keysFor(deskSynth()), keysFor(updateComponent(deskSynth(), "adc-a", { x: 164 })))).toBeNull();
  });

  it("rebuilds everything when the shell changes", () => {
    const wider = deskSynth();
    wider.enclosure.cornerRadius = 10;
    expect(partsToRecut(keysFor(deskSynth()), keysFor(wider))).toBeNull();
    const moved = deskSynth();
    moved.seams[0].x = 191;
    expect(partsToRecut(keysFor(deskSynth()), keysFor(moved))).toBeNull();
  });
});

describe("a section", () => {
  const keeps = (axis: "x" | "y" | "z", at: number, point: [number, number, number]) => {
    const { normal, constant } = sectionPlane({ axis, at });
    return normal[0] * point[0] + normal[1] * point[1] + normal[2] * point[2] + constant >= 0;
  };

  it("keeps the side away from the default view, so the cut faces it", () => {
    expect(keeps("x", 50, [49, 0, 0])).toBe(true);
    expect(keeps("x", 50, [51, 0, 0])).toBe(false);
    expect(keeps("y", 50, [0, 51, 0])).toBe(true);
    expect(keeps("y", 50, [0, 49, 0])).toBe(false);
    expect(keeps("z", 50, [0, 0, 49])).toBe(true);
    expect(keeps("z", 50, [0, 0, 51])).toBe(false);
  });

  it("runs the whole size of the design", () => {
    const model = buildSceneModel({ schemaVersion: 1, name: "x", enclosure: { width: 200, frontHeight: 20, surfaces: [{ id: "a", y: 60, z: 50 }, { id: "b", y: 120, z: 30 }] } })!;
    expect(sectionRange(model, "x")).toEqual([0, 200]);
    expect(sectionRange(model, "y")).toEqual([0, 120]);
    expect(sectionRange(model, "z")).toEqual([0, 50]);
  });
});

describe("the space around a part", () => {
  const config = {
    schemaVersion: 1,
    name: "x",
    enclosure: { width: 200, frontHeight: 40, surfaces: [{ id: "a", y: 100, z: 40 }, { id: "b", y: 120, z: 30 }] },
    components: [
      { id: "one", type: "ec11-dial-19mm", surface: "a", u: 40, v: 40 },
      { id: "two", type: "ec11-dial-19mm", surface: "a", u: 70, v: 40 },
      { id: "far", type: "ec11-dial-19mm", surface: "a", u: 150, v: 40 },
      { id: "elsewhere", type: "ec11-dial-19mm", surface: "b", u: 42, v: 5 },
      { id: "board", type: "ads7830", x: 40, y: 40 },
    ],
  };
  const model = buildSceneModel(config)!;

  it("finds the nearest on the same surface, edge to edge", () => {
    const near = nearestNeighbour(model, "one")!;
    expect(near.id).toBe("two");
    expect(near.gap).toBeCloseTo(30 - 19);
  });

  it("doesn't count another surface, or the floor", () => {
    expect(nearestNeighbour(model, "elsewhere")).toBeNull();
    expect(nearestNeighbour(model, "board")).toBeNull();
  });

  it("copes with a part that isn't there", () => expect(nearestNeighbour(model, "nope")).toBeNull());

  it("measures between two points", () => {
    expect(measureBetween([0, 0, 0], [3, 4, 0])).toEqual({ distance: 5, dx: 3, dy: 4, dz: 0 });
    expect(measureBetween([3, 4, 12], [0, 0, 0]).distance).toBe(13);
  });
});

describe("where a problem is", () => {
  const config: any = {
    schemaVersion: 1,
    name: "x",
    enclosure: { width: 200, frontHeight: 40, surfaces: [{ id: "top", y: 120, z: 40 }], floorThickness: 3, panelThickness: 3 },
    topPanels: [{ surface: "top" }],
    seams: [{ x: 100 }],
    wallHoles: [{ wall: "left", at: 50, z: 20, width: 10, height: 6 }, { wall: "rear", at: 50, z: 20, width: 10, height: 6 }],
    opening: { xMin: 30, xMax: 90, yEnd: 40, sill: 8, keepOut: [{ xMin: 40, xMax: 80, yMin: 5, yMax: 30, top: 12 }] },
    plate: { countersunkHoles: [{ x: 60, y: 70 }], seamX: 80 },
    components: [{ id: "dial", type: "ec11-dial-19mm", surface: "top", u: 150, v: 60 }, { id: "board", type: "ads7830", x: 150, y: 60 }],
  };
  const model = buildSceneModel(config)!;
  const fasteners = { items: [{ id: "plate.fasteners.add[0]", kind: "plate" as const, x: 20, y: 30, z: 3, surface: null, wall: null, addedAt: 0, problem: "no" }], edges: [] };
  const spot = (path: string, where?: any) => issueSpot({ path, ...(where ? { where } : {}) }, config, model, fasteners);
  const contains = (box: any, point: number[]) => point.every((value, axis) => value >= box.min[axis] && value <= box.max[axis]);

  it("uses the spot a problem gives", () => {
    const where = { min: [1, 2, 3], max: [4, 5, 6] };
    expect(spot("plate", where)).toEqual(where);
  });
  it("finds a part on a surface", () => expect(contains(spot("components[0]"), [150, 60, 36])).toBe(true));
  it("finds a board on the floor", () => expect(contains(spot("components[1].type"), [150, 60, 5])).toBe(true));
  it("finds an added screw", () => expect(contains(spot("plate.fasteners.add[0]"), [20, 30, 7])).toBe(true));
  it("finds a hole in the plate", () => expect(contains(spot("plate.countersunkHoles[0]"), [60, 70, 3])).toBe(true));
  it("finds a wall hole on its wall", () => {
    expect(contains(spot("wallHoles[0]"), [1, 50, 20])).toBe(true);
    expect(contains(spot("wallHoles[1]"), [50, 119, 20])).toBe(true);
    expect(contains(spot("wallHoles[0]"), [50, 119, 20])).toBe(false);
  });
  it("finds a seam", () => expect(contains(spot("seams[0].x"), [100, 60, 20])).toBe(true));
  it("finds the plate's split", () => expect(contains(spot("plate.seamX"), [80, 60, 1])).toBe(true));
  it("finds reserved room, before the opening around it", () => {
    expect(contains(spot("opening.keepOut[0]"), [60, 20, 10])).toBe(true);
    expect(contains(spot("opening.keepOut[0]"), [35, 20, 10])).toBe(false);
  });
  it("finds the opening", () => expect(contains(spot("opening.xMin"), [60, 20, 30])).toBe(true));
  it("finds a top panel", () => expect(contains(spot("topPanels[0].splits"), [100, 60, 38])).toBe(true));
  it("has nothing to show for the design as a whole", () => {
    expect(spot("name")).toBeNull();
    expect(spot("fabrication.material")).toBeNull();
  });
  it("copes with something that's gone", () => {
    expect(spot("components[9]")).toBeNull();
    expect(spot("wallHoles[9]")).toBeNull();
    expect(spot("opening.keepOut[9]")).toBeNull();
    expect(spot("plate.screws[9]")).toBeNull();
  });
});
