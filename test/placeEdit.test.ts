// Adding things where a click in the view lands.
import { describe, expect, it } from "vitest";
import { library } from "../src/library.js";
import { ontoAnotherSurface, ontoWords, PLACING, placingPart, spotFor } from "../src/app/placeEdit.js";
import { validateConfig } from "../src/index.js";

const box = (): any => ({
  schemaVersion: 1,
  name: "box",
  enclosure: { width: 200, frontHeight: 40, surfaces: [{ id: "deck", y: 80, z: 40 }, { id: "panel", y: 150, z: 60 }] },
  components: [],
});
const onPanel = { kind: "surface", surface: "panel", u: 120, v: 30 } as const;
const onRear = { kind: "wall", wall: "rear", at: 60, z: 22 } as const;
const onFloor = { kind: "floor", x: 90, y: 70 } as const;

describe("placing by a click", () => {
  it("puts a label on the surface or wall that was clicked, and nowhere else", () => {
    expect(PLACING.surfaceLabel.at(box(), onPanel).labels).toEqual([{ text: "LABEL", surface: "panel", u: 120, v: 30 }]);
    expect(PLACING.wallLabel.at(box(), onRear).labels).toEqual([{ text: "LABEL", wall: "rear", at: 60, z: 22 }]);
    expect(PLACING.label.at(box(), onRear).labels[0].wall).toBe("rear");
    expect(PLACING.label.at(box(), onPanel).labels[0].surface).toBe("panel");
    // Only the new one moves.
    const two = PLACING.surfaceLabel.at(PLACING.surfaceLabel.middle(box()), onPanel).labels;
    expect(two.map((label: any) => label.surface)).toEqual(["deck", "panel"]);
    expect(validateConfig(PLACING.surfaceLabel.at(box(), onPanel)).ok).toBe(true);
  });

  it("puts holes and vents in the wall clicked, and plate things at the spot on the floor", () => {
    expect(PLACING.wallHole.at(box(), onRear).wallHoles[0]).toMatchObject({ wall: "rear", at: 60, z: 22, width: 14 });
    expect(PLACING.vent.at(box(), { ...onRear, wall: "left" }).vents[0]).toMatchObject({ wall: "left", at: 60 });
    expect(PLACING.support.at(box(), onFloor).plate.supports).toEqual([{ x: 90, y: 70 }]);
    expect(PLACING.foot.at(box(), { kind: "under", x: 20, y: 20 }).plate.feet).toEqual([{ x: 20, y: 20 }]);
    expect(PLACING.weight.at(box(), onFloor).plate.weights[0]).toMatchObject({ x: 90, y: 70, width: 40 });
    expect(PLACING.platePin.at(box(), onFloor).plate.pins[0]).toMatchObject({ x: 90, y: 70 });
  });

  it("puts a seam across the width at the click, but not from a click on a side wall", () => {
    expect(PLACING.seam.at(box(), onPanel).seams).toEqual([{ x: 120 }]);
    expect(PLACING.seam.at(box(), onRear).seams).toEqual([{ x: 60 }]);
    expect(PLACING.seam.at(box(), { kind: "wall", wall: "left", at: 60, z: 22 }).seams).toBeUndefined();
  });

  it("puts a part where its kind goes, and says which to select", () => {
    const dial = placingPart(box(), "ec11-dial-19mm", library["ec11-dial-19mm"]!);
    expect(dial.onto).toEqual(["surface"]);
    const placed = dial.at(box(), onPanel);
    expect(placed.components).toEqual([expect.objectContaining({ id: dial.selects, surface: "panel", u: 120, v: 30 })]);
    const board = placingPart(box(), "rp2040-plus", library["rp2040-plus"]!);
    expect(board.at(box(), onFloor).components[0]).toMatchObject({ x: 90, y: 70 });
    const jack = placingPart(box(), "trs-35-panel", library["trs-35-panel"]!);
    expect(jack.onto).toEqual(["wall"]);
    expect(jack.at(box(), onRear).components[0]).toMatchObject({ wall: "rear", at: 60, z: 22 });
    expect(dial.middle(box()).components).toHaveLength(1);
  });

  it("takes the first face under the click that it can go on, through any it can't", () => {
    expect(spotFor(PLACING.support, [onPanel, null, onFloor])).toEqual(onFloor);
    expect(spotFor(PLACING.wallHole, [onPanel, onFloor])).toBeNull();
    expect(ontoWords(PLACING.label)).toBe("a top surface or a wall");
    expect(ontoWords(PLACING.wallHole)).toBe("a wall");
    expect(ontoWords(PLACING.seam)).toBe("the model");
  });
});

describe("dragging a part onto another surface", () => {
  const config = (): any => ({ components: [{ id: "b", type: "arcade-24mm", surface: "deck", u: 40, v: 30 }] });
  it("moves it there, under the pointer, in half millimetres", () => {
    const next = ontoAnotherSurface(config(), "b", "deck", [null, { kind: "surface", surface: "panel", u: 101.26, v: 12.8 }]);
    expect(next!.components[0]).toEqual({ id: "b", type: "arcade-24mm", surface: "panel", u: 101.5, v: 13 });
  });
  it("leaves it where it's still over its own surface, or over no surface", () => {
    expect(ontoAnotherSurface(config(), "b", "deck", [{ kind: "surface", surface: "deck", u: 50, v: 30 }])).toBeNull();
    expect(ontoAnotherSurface(config(), "b", "deck", [{ kind: "wall", wall: "rear", at: 50, z: 10 }])).toBeNull();
    expect(ontoAnotherSurface(config(), "b", "deck", [])).toBeNull();
  });
});
