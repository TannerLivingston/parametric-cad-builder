import { beforeAll, describe, expect, it } from "vitest";
import { validateConfig } from "../src/validate.js";
import type { Part } from "../src/schema.js";
import { addComponent, formatConfig, parseConfig, updateComponent } from "../src/app/configEdit.js";
import { buildSceneModel } from "../src/app/sceneModel.js";
import {
  addCustomPart,
  addPlateHole,
  addPlatePin,
  addReservedRoom,
  addSurface,
  addWallHole,
  draftFromPart,
  newEnclosure,
  newPartDraft,
  parseSplits,
  partFromDraft,
  removeCustomPart,
  removePlateHole,
  removePlatePin,
  removeReservedRoom,
  removeSurface,
  removeWallHole,
  renameSurface,
  setBed,
  setOpening,
  setPlateSplit,
  setShiftRegisters,
  setRail,
  setRailScrew,
  setRound,
  setSeam,
  setTopPanel,
  shapeValues,
  updateCustomPart,
  updateEnclosure,
  updateOpening,
  updatePlateHole,
  updatePlatePin,
  updateRail,
  updateReservedRoom,
  updateSurface,
  updateWallHole,
} from "../src/app/shapeEdit.js";
import { library } from "../src/library.js";
import { deskSynth } from "./helpers.js";

const errorsIn = (config: unknown) => {
  const result = validateConfig(config);
  return result.ok ? [] : result.errors.map((e) => e.message);
};

function part(patch: Parameters<typeof partFromDraft>[0] extends infer D ? Partial<D> : never) {
  const result = partFromDraft({ ...newPartDraft(), name: "Thing", ...patch });
  if (!result.ok) throw new Error(result.message);
  return result.part;
}

describe("a part with more than one hole", () => {
  const raw = () => part({ moreHoles: [{ hole: { shape: "circle", diameter: 7 }, at: [20, 0] }, { hole: { shape: "rect", width: 8, height: 4 }, at: [-20, 5] }] });

  it("writes each with its offset", () => {
    expect((raw() as any).cutouts).toEqual([
      expect.objectContaining({ kind: "circle", diameter: 12, at: [0, 0] }),
      expect.objectContaining({ kind: "circle", diameter: 7, at: [20, 0] }),
      expect.objectContaining({ kind: "rect", width: 8, height: 4, at: [-20, 5] }),
    ]);
  });

  it("offsets the first too", () => {
    expect((part({ holeAt: [-5, 2], moreHoles: [{ hole: { shape: "circle", diameter: 7 }, at: [5, 2] }] }) as any).cutouts[0].at).toEqual([-5, 2]);
  });

  it("comes back the same to edit", () => {
    const draft = draftFromPart(raw())!;
    expect(draft.moreHoles).toEqual([{ hole: { shape: "circle", diameter: 7 }, at: [20, 0] }, { hole: { shape: "rect", width: 8, height: 4 }, at: [-20, 5] }]);
    const saved = partFromDraft(draft, raw());
    expect(saved.ok && saved.part).toEqual(raw());
  });

  it("can show a library part with a row of holes, keeping its spacing", () => {
    const draft = draftFromPart(library["encoder-board-5752"])!;
    expect(draft.holeAt).toEqual([-28.55, 0]);
    expect(draft.moreHoles.map((h) => h.at[0])).toEqual([-9.55, 9.55, 28.55]);
    const saved = partFromDraft(draft, library["encoder-board-5752"]);
    expect(saved.ok && (saved.part as any).cutouts).toEqual((library["encoder-board-5752"] as any).cutouts);
  });

  it("is rejected for a hole with a bad size", () => {
    const result = partFromDraft({ ...newPartDraft(), name: "Bad", moreHoles: [{ hole: { shape: "circle", diameter: 0 }, at: [1, 1] }] });
    expect(result.ok).toBe(false);
  });

  it("builds into a design, with its holes in the right places", () => {
    const made = addCustomPart(newEnclosure(), raw());
    const placed = addComponent(made.config, made.id, "top");
    const result = validateConfig(placed.config);
    expect(result.ok).toBe(true);
    if (result.ok) {
      const component = placed.config.components[0];
      const holes = result.plan.cutouts.filter((c) => c.componentId === placed.id);
      expect(holes).toHaveLength(3);
      expect(holes[1]!.u).toBeCloseTo(component.u + 20);
      expect(holes[2]!.v).toBeCloseTo(component.v + 5);
    }
  });
});

describe("a new enclosure", () => {
  it("is valid before anything is added", () => {
    const result = validateConfig(newEnclosure());
    expect(errorsIn(newEnclosure())).toEqual([]);
    expect(result.warnings).toEqual([]);
  });

  it("is a shell, a separate top and a plate", () => {
    const result = validateConfig(newEnclosure());
    if (!result.ok) throw new Error("invalid");
    expect(result.plan.printedParts.map((p) => p.kind)).toEqual(["shell", "top", "plate"]);
  });

  it("takes parts from the library", () => {
    let config = newEnclosure();
    for (const type of ["arcade-24mm", "ec11-dial-30mm", "rp2040-plus"]) config = addComponent(config, type).config;
    expect(errorsIn(config)).toEqual([]);
    expect(config.components.map((c: any) => c.type)).toEqual(["arcade-24mm", "ec11-dial-30mm", "rp2040-plus"]);
  });
});

describe("the values the form shows", () => {
  it("fills in defaults without writing them to the file", () => {
    const config = newEnclosure();
    expect(shapeValues(config).enclosure.cornerRadius).toBe(6);
    expect(shapeValues(config).fabrication.buildVolume).toEqual({ x: 256, y: 256, z: 256 });
    expect(shapeValues(config).topPanels[0]!.color).toBe("#1b1c1f");
    expect(formatConfig(config)).not.toContain("cornerRadius");
    // Including the selects' choices, so that a select shows the default once Undo clears its choice.
    expect(shapeValues(config).topPanels[0]).toMatchObject({ splits: [], crease: "none", joint: "tongue" });
  });

  it("copes with a config that's missing most of its parts", () => {
    expect(shapeValues({}).enclosure.surfaces).toEqual([]);
    expect(addSurface({}).enclosure.surfaces).toHaveLength(1);
  });
});

describe("editing the shape", () => {
  it("leaves the config it's given alone", () => {
    const config = addWallHole(addSurface(newEnclosure()));
    const snapshot = JSON.stringify(config);
    updateEnclosure(config, { width: 200 });
    setRound(config, "rearTop", 10);
    renameSurface(config, "top", "deck");
    removeSurface(config, "top");
    setTopPanel(config, "top", null);
    setSeam(config, 70);
    updateWallHole(config, 0, { z: 20 });
    removeWallHole(config, 0);
    expect(JSON.stringify(config)).toBe(snapshot);
  });

  it("rounds what's typed to tidy numbers", () => {
    expect(updateEnclosure(newEnclosure(), { width: 150.123456 }).enclosure.width).toBe(150.12);
    expect(updateSurface(newEnclosure(), "top", { y: 90.123456 }).enclosure.surfaces[0].y).toBe(90.12);
  });

  it("drops a round set to 0, and the rounds with it when none are left", () => {
    const rounded = setRound(setRound(newEnclosure(), "rearTop", 14), "frontBottom", 8);
    expect(rounded.enclosure.rounds).toEqual({ rearTop: 14, frontBottom: 8 });
    expect(setRound(rounded, "rearTop", 0).enclosure.rounds).toEqual({ frontBottom: 8 });
    expect(setRound(setRound(rounded, "rearTop", 0), "frontBottom", 0).enclosure.rounds).toBeUndefined();
  });

  it("keeps the other bed sizes when one changes", () => {
    expect(setBed(newEnclosure(), "x", 180).fabrication.buildVolume).toEqual({ x: 180, y: 256, z: 256 });
  });
});

describe("surfaces", () => {
  it("adds one behind the rear that the validator accepts", () => {
    const once = addSurface(newEnclosure());
    expect(once.enclosure.surfaces[1]).toEqual({ id: "surface-2", y: 140, z: 30 });
    expect(errorsIn(once)).toEqual([]);
  });

  it("adds a second that doesn't carry on at the same slope", () => {
    const twice = addSurface(addSurface(newEnclosure()));
    expect(twice.enclosure.surfaces[2]).toEqual({ id: "surface-3", y: 180, z: 30 });
    expect(errorsIn(twice)).toEqual([]);
  });

  it("doesn't reuse a name", () => {
    const config = renameSurface(addSurface(newEnclosure()), "top", "surface-3");
    expect(addSurface(config).enclosure.surfaces.map((s: any) => s.id)).toEqual(["surface-3", "surface-2", "surface-4"]);
  });

  it("names the surface of a part that left it out, once there are several", () => {
    const config = { ...newEnclosure(), components: [{ id: "a", type: "arcade-24mm", u: 40, v: 40 }] };
    expect(errorsIn(config)).toEqual([]);
    const added = addSurface(config);
    expect(added.components[0].surface).toBe("top");
    expect(errorsIn(added)).toEqual([]);
  });

  it("takes parts and top panels with it when renamed", () => {
    const config = addComponent(newEnclosure(), "arcade-24mm", "top").config;
    const renamed = renameSurface(config, "top", "deck");
    expect(renamed.enclosure.surfaces[0].id).toBe("deck");
    expect(renamed.topPanels[0].surface).toBe("deck");
    expect(renamed.components[0].surface).toBe("deck");
    expect(errorsIn(renamed)).toEqual([]);
  });

  it.each(["", "  ", "surface-2"])("refuses to rename one to %j", (name) => {
    const config = addSurface(newEnclosure());
    expect(renameSurface(config, "top", name)).toBe(config);
  });

  it("removes its top panel with it", () => {
    const config = setTopPanel(addSurface(newEnclosure()), "surface-2", {});
    const removed = removeSurface(config, "surface-2");
    expect(removed.enclosure.surfaces.map((s: any) => s.id)).toEqual(["top"]);
    expect(removed.topPanels.map((p: any) => p.surface)).toEqual(["top"]);
    expect(errorsIn(removed)).toEqual([]);
  });

  it("keeps the last one", () => {
    const config = newEnclosure();
    expect(removeSurface(config, "top")).toBe(config);
  });

  it("lets the validator point out parts left on a removed surface", () => {
    const withSecond = addSurface(newEnclosure());
    const config = addComponent(withSecond, "ttp223", "surface-2").config;
    expect(config.components[0].surface).toBe("surface-2");
    const removed = removeSurface(config, "surface-2");
    expect(removed.components).toHaveLength(1);
    expect(errorsIn(removed).join()).toContain("surface-2");
  });
});

describe("top panels", () => {
  it("stay in surface order however they're ticked", () => {
    const base = setTopPanel(addSurface(newEnclosure()), "top", null);
    const config = setTopPanel(setTopPanel(base, "surface-2", {}), "top", {});
    expect(config.topPanels.map((p: any) => p.surface)).toEqual(["top", "surface-2"]);
  });

  it("keep their colour when split", () => {
    const coloured = setTopPanel(newEnclosure(), "top", { color: "#ff0000" });
    expect(setTopPanel(coloured, "top", { splits: [70] }).topPanels).toEqual([{ surface: "top", color: "#ff0000", splits: [70] }]);
  });

  it("leave the file when the last is turned off", () => {
    expect(setTopPanel(newEnclosure(), "top", null).topPanels).toBeUndefined();
    expect(errorsIn(setTopPanel(newEnclosure(), "top", null))).toEqual([]);
  });

  it.each([["70", [70]], ["70, 120.5", [70, 120.5]], ["", []], [" 70 ,", [70]], ["abc", null], ["70, x", null], ["-5", null], ["0", null]])("reads splits from %j", (text, expected) => {
    expect(parseSplits(text)).toEqual(expected);
  });
});

describe("seams and wall holes", () => {
  it("adds a seam that keeps its settings when moved, and leaves the file when removed", () => {
    const config = { ...newEnclosure(), seams: [{ x: 75, ribWidth: 10 }] };
    expect(setSeam(config, 80).seams).toEqual([{ x: 80, ribWidth: 10 }]);
    expect(setSeam(config, null).seams).toBeUndefined();
  });

  it("splits a box too wide for the bed", () => {
    const wide = setTopPanel(updateEnclosure(newEnclosure(), { width: 400 }), "top", { splits: [200] });
    expect(errorsIn(wide).join()).toContain("build volume");
    expect(errorsIn(setSeam(wide, 200))).toEqual([]);
  });

  it("adds a hole the validator accepts, then edits and removes it", () => {
    const config = addWallHole(newEnclosure());
    expect(errorsIn(config)).toEqual([]);
    const moved = updateWallHole(config, 0, { wall: "left", at: 50 });
    expect(moved.wallHoles[0]).toMatchObject({ wall: "left", at: 50 });
    expect(errorsIn(moved)).toEqual([]);
    expect(removeWallHole(moved, 0).wallHoles).toBeUndefined();
  });
});

describe("custom parts", () => {
  it("makes a part through the top", () => {
    const { config, id } = addCustomPart(newEnclosure(), part({ name: "Big Toggle!" }));
    expect(id).toBe("big-toggle");
    const placed = addComponent(config, id);
    expect(placed.config.components[0]).toMatchObject({ type: "big-toggle", surface: "top" });
    expect(errorsIn(placed.config)).toEqual([]);
  });

  it("makes a board on the floor", () => {
    const { config, id } = addCustomPart(newEnclosure(), part({ mount: "floor" }));
    const placed = addComponent(config, id);
    expect(placed.config.components[0]).toHaveProperty("x");
    expect(errorsIn(placed.config)).toEqual([]);
    expect(buildSceneModel(placed.config)?.components[0]?.mount).toBe("floor");
  });

  it("warns about a part that isn't measured, and not one that is", () => {
    const place = (source: "estimated" | "measured") => {
      const { config, id } = addCustomPart(newEnclosure(), part({ source }));
      return validateConfig(addComponent(config, id).config).warnings.map((w) => w.code);
    };
    expect(place("estimated")).toContain("UNVERIFIED_PART");
    expect(place("measured")).not.toContain("UNVERIFIED_PART");
  });

  it("is checked like any other part", () => {
    const huge = part({ hole: { shape: "circle", diameter: 200 }, above: { shape: "circle", diameter: 210 }, below: { shape: "circle", diameter: 210 } });
    const { config, id } = addCustomPart(newEnclosure(), huge);
    expect(errorsIn(addComponent(config, id).config).length).toBeGreaterThan(0);
  });

  it("doesn't take a library part's id, or another custom part's", () => {
    const first = addCustomPart(newEnclosure(), part({ name: "Thing" }));
    const second = addCustomPart(first.config, part({ name: "thing" }));
    expect([first.id, second.id]).toEqual(["thing", "thing-2"]);
    expect(addCustomPart(newEnclosure(), part({ name: "TTP223" })).id).toBe("ttp223-2");
    expect(addCustomPart(newEnclosure(), part({ name: "!!!" })).id).toBe("part");
  });

  it("stays small in the file and survives a round trip", () => {
    const { config } = addCustomPart(newEnclosure(), part({}));
    const text = formatConfig(config);
    expect(text).not.toContain("posts");
    expect(text).not.toContain('"at"');
    const parsed = parseConfig(text);
    expect(parsed.ok && errorsIn(parsed.config)).toEqual([]);
  });

  it("asks for a name and real sizes", () => {
    expect(partFromDraft({ ...newPartDraft(), name: " " })).toEqual({ ok: false, message: "Give the part a name." });
    expect(partFromDraft({ ...newPartDraft(), name: "Thing", hole: { shape: "circle", diameter: 0 } }).ok).toBe(false);
    expect(partFromDraft({ ...newPartDraft(), name: "Thing", belowDepth: -1 }).ok).toBe(false);
  });

  it("allows nothing above the top, such as a flush screen", () => {
    expect(partFromDraft({ ...newPartDraft(), name: "Flush", aboveHeight: 0 }).ok).toBe(true);
  });

  it("round-trips through the form, whichever shape it has", () => {
    const rect = part({ hole: { shape: "rect", width: 20, height: 10 }, above: { shape: "rect", width: 22, height: 12 } });
    const raw = addCustomPart(newEnclosure(), rect).config.customParts.thing;
    expect(draftFromPart(raw)).toMatchObject({ name: "Thing", hole: { shape: "rect", width: 20, height: 10 }, above: { shape: "rect", width: 22, height: 12 } });
    expect(draftFromPart(part({ mount: "floor", height: 12 }))).toMatchObject({ mount: "floor", height: 12 });
  });

  it("won't open in the form a part it would damage", () => {
    expect(draftFromPart(library.ttp223)).toBeNull(); // a pocket
    expect(draftFromPart(library["oled-242-ssd1309"])).toBeNull(); // a recess
    expect(draftFromPart(library["oled-ssd1306"])).toBeNull(); // a recess too
    expect(draftFromPart({ ...library["arcade-24mm"]!, cutouts: [{ kind: "rect", width: 26, height: 15, cornerRadius: 1, at: [0, 0] }] })).toBeNull(); // rounded corners
    expect(draftFromPart({ name: "broken" })).toBeNull();
  });

  it("keeps what the form doesn't show when saved", () => {
    const board = library["rp2040-plus"]!;
    const saved = partFromDraft({ ...draftFromPart(board)!, height: 14 }, board);
    expect(saved.ok && saved.part).toMatchObject({ height: 14, port: { side: "left" }, holder: { underside: 8 } });
    // The real button's keyway is more than the form can show, so this one has a plain hole.
    const button = { ...library["arcade-24mm"]!, cutouts: [{ kind: "circle", diameter: 24.24, at: [0, 0] }] } as Part;
    const edited = partFromDraft({ ...draftFromPart(button)!, belowDepth: 30 }, button);
    expect(edited.ok && edited.part).toMatchObject({ panelThickness: { max: 4 }, below: { depth: 30 } });
  });

  it("leaves a notched hole to the config, rather than losing its notch", () => {
    expect(draftFromPart(library["arcade-24mm"]!)).toBeNull();
    expect(draftFromPart(library["oled-242-ssd1309"]!)).toBeNull();
  });

  it("drops settings that only fit the old mount when it changes", () => {
    const board = library["rp2040-plus"]!;
    const moved = partFromDraft({ ...draftFromPart(board)!, mount: "panel" }, board);
    expect(moved.ok).toBe(true);
    expect(moved.ok && "port" in moved.part).toBe(false);
  });

  it("updates every placed copy when edited", () => {
    const { config, id } = addCustomPart(newEnclosure(), part({ mount: "floor", height: 10 }));
    const placed = addComponent(addComponent(config, id).config, id).config;
    const edited = updateCustomPart(placed, id, part({ mount: "floor", height: 15 }));
    expect(edited.components).toHaveLength(2);
    expect(buildSceneModel(edited)?.components.map((c) => c.floor?.height)).toEqual([15, 15]);
  });

  it("takes its copies with it when deleted, and nothing else", () => {
    const { config, id } = addCustomPart(newEnclosure(), part({}));
    const placed = addComponent(addComponent(config, id).config, "ttp223").config;
    const removed = removeCustomPart(placed, id);
    expect(removed.customParts).toBeUndefined();
    expect(removed.components.map((c: any) => c.type)).toEqual(["ttp223"]);
    expect(errorsIn(removed)).toEqual([]);
  });
});

describe("an opening", () => {
  it("starts valid, holding nothing in particular", () => {
    const config = setOpening(newEnclosure(), true);
    expect(config.opening).toEqual({ xMin: 37.5, xMax: 112.5, yEnd: 50, sill: 13.33 });
    expect(errorsIn(config)).toEqual([]);
  });

  it("is checked by the validator when it's edited", () => {
    const config = setOpening(newEnclosure(), true);
    expect(errorsIn(updateOpening(config, { xMax: 500 })).join()).toContain("inside the walls");
    expect(errorsIn(updateOpening(config, { yEnd: 500 })).join()).toContain("inside the");
  });

  it("leaves the file when turned off, with its rail and boxes", () => {
    const config = addReservedRoom(setRail(setOpening(newEnclosure(), true), true));
    expect(setOpening(config, false).opening).toBeUndefined();
    expect(errorsIn(setOpening(config, false))).toEqual([]);
  });

  it("takes a rail with a screw on each side of it", () => {
    const config = setRail(setOpening(newEnclosure(), true), true);
    expect(config.opening.rail).toEqual({ depth: 14, footHeight: 2, screwX: [29.5, 120.5] });
    expect(errorsIn(config)).toEqual([]);
    const result = validateConfig(config);
    expect(result.ok && result.plan.printedParts.map((p) => p.kind)).toContain("rail");
  });

  it("starts a rail deep enough for a front round", () => {
    const config = setRail(setOpening(setRound(newEnclosure(), "frontBottom", 18), true), true);
    expect(config.opening.rail.depth).toBe(20);
    expect(errorsIn(config)).toEqual([]);
  });

  it("drops the rail without touching the rest", () => {
    const config = setRail(updateOpening(setOpening(newEnclosure(), true), { sill: 9 }), true);
    expect(setRail(config, false).opening).toEqual({ ...config.opening, rail: undefined, sill: 9 });
    expect(setRail(config, false).opening).not.toHaveProperty("rail");
  });

  it("edits one rail screw at a time", () => {
    const config = setRail(setOpening(newEnclosure(), true), true);
    expect(setRailScrew(config, 1, 125.123).opening.rail.screwX).toEqual([29.5, 125.12]);
    expect(errorsIn(setRailScrew(config, 1, 100)).join()).toContain("either side of the opening");
    expect(updateRail(config, { color: "#000000" }).opening.rail).toMatchObject({ color: "#000000", depth: 14 });
  });

  it("says what's wrong when the sill is too low for the rail's feet", () => {
    const config = updateOpening(setRail(setOpening(newEnclosure(), true), true), { sill: 1 });
    expect(errorsIn(config).join()).toContain("sill");
  });

  it("reserves room that's added, edited and removed one box at a time", () => {
    const config = addReservedRoom(addReservedRoom(setOpening(newEnclosure(), true)));
    expect(config.opening.keepOut[0]).toEqual({ xMin: 37.5, xMax: 112.5, yMin: 2.4, yMax: 50, top: 13.33 });
    expect(errorsIn(config)).toEqual([]);
    const edited = updateReservedRoom(config, 1, { top: 20 });
    expect(edited.opening.keepOut.map((b: any) => b.top)).toEqual([13.33, 20]);
    expect(removeReservedRoom(edited, 0).opening.keepOut.map((b: any) => b.top)).toEqual([20]);
    expect(removeReservedRoom(removeReservedRoom(edited, 0), 0).opening.keepOut).toBeUndefined();
  });

  it("says when what it holds won't fit under the top", () => {
    const config = addReservedRoom(setOpening(newEnclosure(), true));
    const tooTall = updateReservedRoom(config, 0, { yMax: 90, top: 39 });
    expect(errorsIn(tooTall).join()).toContain("underside of the top");
  });

  it("keeps parts out of the room it reserves", () => {
    const room = updateReservedRoom(addReservedRoom(setOpening(newEnclosure(), true)), 0, { yMax: 90, top: 20 });
    const board = { id: "board", type: "ads7830", x: 75, y: 70 };
    expect(errorsIn({ ...room, components: [board] }).length).toBeGreaterThan(0);
  });

  it("shows its reserved room in the view", () => {
    const config = addReservedRoom(setOpening(newEnclosure(), true));
    expect(buildSceneModel(config)?.reserved).toEqual(config.opening.keepOut);
    expect(buildSceneModel(newEnclosure())?.reserved).toEqual([]);
  });

  it("doesn't assume what it holds in anything it says", () => {
    const wording = (config: unknown) => {
      const result = validateConfig(config);
      return result.ok ? "" : result.errors.map((e) => e.message).join();
    };
    const tooTall = updateReservedRoom(addReservedRoom(setOpening(newEnclosure(), true)), 0, { yMax: 90, top: 39 });
    expect(wording(tooTall)).not.toMatch(/key/i);
  });
});

describe("fixings on the plate", () => {
  it("adds a hole in the middle that the validator accepts, and takes it away again", () => {
    const config = addPlateHole(newEnclosure());
    expect(config.plate.countersunkHoles).toEqual([{ x: 75, y: 50 }]);
    expect(errorsIn(config)).toEqual([]);
    expect(updatePlateHole(config, 0, { x: 60 }).plate.countersunkHoles[0]).toEqual({ x: 60, y: 50 });
    expect(removePlateHole(config, 0).plate).toBeUndefined();
  });

  it("adds a pin in the middle that the validator accepts, and takes it away again", () => {
    const config = addPlatePin(newEnclosure());
    expect(config.plate.pins).toEqual([{ x: 75, y: 50, diameter: 3.7, height: 4 }]);
    expect(errorsIn(config)).toEqual([]);
    expect(removePlatePin(config, 0).plate).toBeUndefined();
  });

  it("gives a pin a tip, and takes it off when the field is emptied", () => {
    const tipped = updatePlatePin(addPlatePin(newEnclosure()), 0, { tipDiameter: 2.6, tipHeight: 0.6 });
    expect(tipped.plate.pins[0]).toMatchObject({ tipDiameter: 2.6, tipHeight: 0.6 });
    expect(errorsIn(tipped)).toEqual([]);
    expect(updatePlatePin(tipped, 0, { tipDiameter: undefined, tipHeight: undefined }).plate.pins[0]).toEqual({ x: 75, y: 50, diameter: 3.7, height: 4 });
  });

  it("keeps the plate's other settings when the last fixing goes", () => {
    const config = addPlateHole({ ...newEnclosure(), plate: { clearance: 0.3 } });
    expect(removePlateHole(config, 0).plate).toEqual({ clearance: 0.3 });
  });

  it("sets the plate's split by hand, and goes back to automatic", () => {
    const wide = setTopPanel(setSeam(updateEnclosure(newEnclosure(), { width: 400 }), 200), "top", { splits: [200] });
    expect(errorsIn(wide)).toEqual([]);
    const moved = setPlateSplit(wide, 150);
    expect(moved.plate).toEqual({ seamX: 150 });
    const result = validateConfig(moved);
    expect(result.ok && result.plan.plate?.jointX).toBe(150);
    expect(setPlateSplit(moved, null).plate).toBeUndefined();
  });

  it("says when the plate's split doesn't fit the bed, without naming the file's fields", () => {
    const wide = setTopPanel(setSeam(updateEnclosure(newEnclosure(), { width: 400 }), 200), "top", { splits: [200] });
    const message = errorsIn(setPlateSplit(wide, 100)).join();
    expect(message).toContain("Move the plate's split");
    expect(message).not.toContain("seamX");
  });
});

// Everything in the example file, made only with what the Shape and Layout tabs can do.
function deskSynthFromTheForm() {
  const real = deskSynth();
  let config: any = { ...newEnclosure(), name: real.name };
  config = renameSurface(config, "top", "deck");
  const { width, frontHeight, wall, panelThickness, floorThickness, cornerRadius } = real.enclosure;
  config = updateEnclosure(config, { width, frontHeight, wall, panelThickness, floorThickness, cornerRadius });
  config = updateSurface(config, "deck", { y: real.enclosure.surfaces[0].y, z: real.enclosure.surfaces[0].z });
  for (const surface of real.enclosure.surfaces.slice(1)) {
    config = addSurface(config);
    config = renameSurface(config, config.enclosure.surfaces.at(-1).id, surface.id);
    config = updateSurface(config, surface.id, { y: surface.y, z: surface.z });
  }
  for (const [key, radius] of Object.entries(real.enclosure.rounds)) config = setRound(config, key as "rearTop", radius as number);
  config = setTopPanel(config, "deck", { color: "#1b1c1f" });
  config = setTopPanel(config, "panel", { color: "#1b1c1f", splits: [214] });
  config = setSeam(config, real.seams[0].x);
  config = setOpening(config, true);
  const { xMin, xMax, yEnd, sill, rail, keepOut } = real.opening;
  config = updateOpening(config, { xMin, xMax, yEnd, sill });
  config = setRail(config, true);
  config = updateRail(config, { depth: rail.depth, footHeight: rail.footHeight });
  config = setRailScrew(setRailScrew(config, 0, rail.screwX[0]), 1, rail.screwX[1]);
  keepOut.forEach((box: any, i: number) => {
    config = updateReservedRoom(addReservedRoom(config), i, box);
  });
  config = setPlateSplit(config, real.plate.seamX);
  config = setShiftRegisters(config, real.wiring.shiftRegisters);
  real.plate.countersunkHoles.forEach((hole: any, i: number) => {
    config = updatePlateHole(addPlateHole(config), i, hole);
  });
  real.plate.pins.forEach((pin: any, i: number) => {
    config = updatePlatePin(addPlatePin(config), i, pin);
  });
  for (const part of real.components) {
    const added = addComponent(config, part.type, part.surface);
    const { id: _id, type: _type, ...position } = part;
    config = updateComponent(added.config, added.id, position);
  }
  return config;
}

describe("the Desk Synth, made from nothing with the form", () => {
  let made: any;
  beforeAll(() => {
    made = deskSynthFromTheForm();
  });

  const sorted = (value: unknown) => JSON.stringify(value, (_, v) => (v && typeof v === "object" && !Array.isArray(v) ? Object.fromEntries(Object.entries(v).sort()) : v));

  it("is the same design as the example, apart from the names of its parts", () => {
    const real = deskSynth();
    expect(errorsIn(made)).toEqual([]);
    const { fabrication: _f, components: realParts, ...realRest } = real;
    const { components: madeParts, ...madeRest } = made;
    expect(sorted(madeRest)).toBe(sorted(realRest));
    const unnamed = (parts: any[]) => parts.map(({ id: _id, ...rest }) => sorted(rest));
    expect(unnamed(madeParts)).toEqual(unnamed(realParts));
  });

  it("makes the same plan as the example", () => {
    const ours = validateConfig(made);
    const real = validateConfig(deskSynth());
    if (!ours.ok || !real.ok) throw new Error("invalid");
    expect(ours.plan.printedParts).toEqual(real.plan.printedParts);
    expect(ours.plan.seams).toEqual(real.plan.seams);
    expect(ours.plan.plate?.screws).toEqual(real.plan.plate?.screws);
    expect(ours.plan.topScrews).toEqual(real.plan.topScrews);
    expect(ours.plan.hardware).toEqual(real.plan.hardware);
  });
});

describe("the Desk Synth, opened in the form", () => {
  it("is unchanged by a field left as it was", () => {
    const config = deskSynth();
    const { enclosure } = shapeValues(config);
    expect(validateConfig(updateEnclosure(config, { width: enclosure.width })).ok).toBe(true);
    expect(updateEnclosure(config, { width: enclosure.width })).toEqual(config);
  });

  it("keeps the parts on a renamed surface", () => {
    const renamed = renameSurface(deskSynth(), "panel", "dash");
    expect(errorsIn(renamed)).toEqual([]);
    expect(renamed.components.filter((c: any) => c.surface === "panel")).toEqual([]);
  });
});
