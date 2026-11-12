// Snapping a dragged part into line with what's near it.
import { describe, expect, it } from "vitest";
import { guideSegments, snapDrag } from "../src/app/snap.js";

const deck = { id: "deck", index: 0, y0: 0, z0: 40, y1: 80, z1: 40, thickness: 3, length: 80, angle: 0, cos: 1, sin: 0 };
const part = (id: string, a: number, b: number, hu = 12, hv = 12): any => ({
  id,
  mount: "panel",
  a,
  b,
  surface: deck,
  printedPart: 0,
  onTopPanel: false,
  above: { shape: "rect", hu, hv, height: 10 },
  below: null,
  floor: null,
  inWall: null,
});
const model = (...components: any[]): any => ({ width: 300, surfaces: [deck], panelThickness: 3, floorThickness: 3, wall: 3, seamXs: [], reserved: [], components });

describe("snapping while dragging", () => {
  it("lines up with a neighbour's centre, across and back, with a guide for each", () => {
    const snapped = snapDrag(model(part("n", 100, 30), part("me", 0, 0)), "me", 101.2, 29.1);
    expect([snapped.a, snapped.b]).toEqual([100, 30]);
    expect(snapped.guides).toEqual([{ axis: "a", value: 100, kind: "centre" }, { axis: "b", value: 30, kind: "centre" }]);
  });

  it("lines up edges, so different sizes share a side", () => {
    // A 10 mm wide part beside a 24 mm one, lining up their left edges at 88.
    const snapped = snapDrag(model(part("n", 100, 30), part("me", 0, 0, 5, 5)), "me", 93.6, 60);
    expect(snapped.a).toBe(93);
    expect(snapped.guides[0]).toEqual({ axis: "a", value: 88, kind: "edge" });
  });

  it("finds the middle of its surface, and the row's own gap", () => {
    expect(snapDrag(model(part("me", 0, 0)), "me", 150.9, 40.6)).toMatchObject({ a: 150, b: 40, guides: [{ kind: "middle" }, { kind: "middle" }] });
    const row = model(part("x", 30, 20), part("y", 60, 20), part("me", 0, 0));
    const snapped = snapDrag(row, "me", 89.3, 20.4);
    expect(snapped.a).toBe(90);
    expect(snapped.guides.find((g) => g.axis === "a")).toEqual({ axis: "a", value: 90, kind: "spacing" });
  });

  it("rounds to the half millimetre where nothing is near, and ignores other surfaces", () => {
    const elsewhere = { ...part("n", 100, 30), surface: { ...deck, id: "panel" } };
    expect(snapDrag(model(elsewhere, part("me", 0, 0)), "me", 100.3, 30.2)).toEqual({ a: 100.5, b: 30, guides: [] });
  });

  it("draws a guide right across the surface, just above it", () => {
    const segments = guideSegments(model(part("me", 0, 0)), "me", [{ axis: "a", value: 50, kind: "centre" }, { axis: "b", value: 20, kind: "centre" }]);
    expect(segments).toEqual([
      [[50, 0, 40.5], [50, 80, 40.5]],
      [[0, 20, 40.5], [300, 20, 40.5]],
    ]);
  });
});
