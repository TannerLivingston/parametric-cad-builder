// Placing parts relative to each other, checked against the real validator and the Desk Synth's layout.
import { describe, expect, it } from "vitest";
import { validateConfig } from "../src/index.js";
import { alignableWith, alignComponent, arrayComponent, centreComponent, lineUpGroup, MAX_COPIES, mirrorComponent, spaceEvenly } from "../src/app/layoutEdit.js";
import { deskSynth } from "./helpers.js";

const box = (components: unknown[] = []): any => ({ schemaVersion: 1, name: "box", enclosure: { width: 240, frontHeight: 30, surfaces: [{ id: "top", y: 150, z: 30 }, { id: "back", y: 200, z: 20 }] }, components });
const dial = { id: "dial-1", type: "ec11-dial-19mm", surface: "top", u: 40, v: 40 };
const board = { id: "adc", type: "ads7830", x: 40, y: 40 };

describe("making copies", () => {
  it("rebuilds the Desk Synth's eight buttons from one", () => {
    const real = deskSynth();
    const buttons = real.components.filter((c: any) => c.type === "arcade-24mm");
    const others = real.components.filter((c: any) => c.type !== "arcade-24mm");
    const start = { ...real, components: [buttons[0], ...others] };
    const { config, ids } = arrayComponent(start, "button-1", { columns: 4, rows: 2, stepAlong: 30, stepAcross: 29 });
    expect(ids).toHaveLength(7);
    const made = config.components.filter((c: any) => c.type === "arcade-24mm");
    const places = (list: any[]) => list.map((c) => `${c.u},${c.v}`).sort();
    expect(places(made)).toEqual(places(buttons));
    expect(validateConfig(config).ok).toBe(true);
  });

  it("gives each copy its own id, and keeps the original where it was", () => {
    const { config, ids } = arrayComponent(box([dial]), "dial-1", { columns: 2, rows: 2, stepAlong: 30, stepAcross: 25 });
    expect(ids).toEqual(["dial-2", "dial-3", "dial-4"]);
    expect(config.components[0]).toEqual(dial);
    expect(config.components[3]).toMatchObject({ id: "dial-4", u: 70, v: 65, surface: "top", type: dial.type });
    expect(new Set(config.components.map((c: any) => c.id)).size).toBe(4);
  });

  it("skips ids that are taken", () => {
    const { ids } = arrayComponent(box([dial, { ...dial, id: "dial-2", u: 100 }]), "dial-1", { columns: 2, rows: 1, stepAlong: 30, stepAcross: 0 });
    expect(ids).toEqual(["dial-3"]);
  });

  it("uses x and y for a part on the floor", () => {
    const { config } = arrayComponent(box([board]), "adc", { columns: 2, rows: 2, stepAlong: 25, stepAcross: 50 });
    expect(config.components[3]).toMatchObject({ x: 65, y: 90 });
  });

  it("lets the validator judge what doesn't fit", () => {
    const { config } = arrayComponent(box([dial]), "dial-1", { columns: 2, rows: 1, stepAlong: 5, stepAcross: 0 });
    expect(validateConfig(config).ok).toBe(false);
  });

  it("keeps to a sensible number", () => {
    expect(arrayComponent(box([dial]), "dial-1", { columns: 1000, rows: 1000, stepAlong: 1, stepAcross: 1 }).ids.length).toBeLessThan(MAX_COPIES);
    expect(arrayComponent(box([dial]), "dial-1", { columns: 0, rows: -3, stepAlong: 1, stepAcross: 1 }).ids).toEqual([]);
    expect(arrayComponent(box([dial]), "dial-1", { columns: 2.9, rows: 1, stepAlong: 40, stepAcross: 1 }).ids).toHaveLength(1);
  });

  it("does nothing for a part that isn't there", () => {
    const config = box([dial]);
    expect(arrayComponent(config, "nope", { columns: 2, rows: 2, stepAlong: 1, stepAcross: 1 })).toEqual({ config, ids: [] });
  });
});

describe("mirroring", () => {
  it("puts a copy the same distance from the other side", () => {
    const mirrored = mirrorComponent(box([dial]), "dial-1")!;
    expect(mirrored.id).toBe("dial-2");
    expect(mirrored.config.components[1]).toMatchObject({ u: 200, v: 40, surface: "top" });
    expect(mirrored.config.components[0]).toEqual(dial);
  });

  it("turns a rotated part to match", () => {
    const at = (rotationDeg: number) => mirrorComponent(box([{ ...dial, rotationDeg }]), "dial-1")!.config.components[1].rotationDeg;
    expect(at(90)).toBe(270);
    expect(at(270)).toBe(90);
    expect(at(180)).toBe(180);
    expect(at(0)).toBeUndefined();
  });

  it("works on the floor", () => {
    expect(mirrorComponent(box([board]), "adc")!.config.components[1]).toMatchObject({ x: 200, y: 40 });
  });

  it("does nothing without a part or a width", () => {
    expect(mirrorComponent(box([dial]), "nope")).toBeNull();
    expect(mirrorComponent({ components: [dial] }, "dial-1")).toBeNull();
  });
});

describe("centring", () => {
  it("moves it to the middle of the width", () => {
    expect(centreComponent(box([dial]), "dial-1").components[0]).toMatchObject({ u: 120, v: 40 });
    expect(centreComponent(box([board]), "adc").components[0]).toMatchObject({ x: 120, y: 40 });
  });

  it("leaves other parts alone", () => {
    const other = { ...dial, id: "other", u: 7 };
    expect(centreComponent(box([dial, other]), "dial-1").components[1]).toEqual(other);
  });
});

describe("lining up", () => {
  const other = { ...dial, id: "other", u: 100, v: 90 };

  it("takes a row or a column from another part", () => {
    expect(alignComponent(box([dial, other]), "dial-1", "other", "row").components[0]).toMatchObject({ u: 40, v: 90 });
    expect(alignComponent(box([dial, other]), "dial-1", "other", "column").components[0]).toMatchObject({ u: 100, v: 40 });
  });

  it("works on the floor", () => {
    const second = { ...board, id: "b", x: 90, y: 70 };
    expect(alignComponent(box([board, second]), "adc", "b", "row").components[0]).toMatchObject({ x: 40, y: 70 });
  });

  it("only offers parts on the same surface, or the floor", () => {
    const elsewhere = { ...dial, id: "far", surface: "back" };
    const config = box([dial, other, elsewhere, board]);
    expect(alignableWith(config, "dial-1")).toEqual(["other"]);
    expect(alignableWith(config, "adc")).toEqual([]);
    expect(alignableWith(config, "nope")).toEqual([]);
  });

  it("does nothing for a part that isn't there", () => {
    const config = box([dial]);
    expect(alignComponent(config, "dial-1", "nope", "row")).toBe(config);
  });
});

describe("several parts at once", () => {
  const config = (): any => ({
    enclosure: { width: 300, surfaces: [{ id: "deck", y: 80, z: 40 }, { id: "panel", y: 150, z: 60 }] },
    components: [
      { id: "a", type: "arcade-24mm", surface: "deck", u: 20, v: 30 },
      { id: "b", type: "arcade-24mm", surface: "deck", u: 90, v: 34 },
      { id: "c", type: "arcade-24mm", surface: "deck", u: 50, v: 41 },
      { id: "p", type: "arcade-24mm", surface: "panel", u: 70, v: 20 },
    ],
  });
  const where = (c: any) => Object.fromEntries(c.components.map((p: any) => [p.id, [p.u, p.v]]));

  it("line up with the first, only where they share its surface", () => {
    expect(where(lineUpGroup(config(), ["a", "b", "c", "p"], "row"))).toEqual({ a: [20, 30], b: [90, 30], c: [50, 30], p: [70, 20] });
    expect(where(lineUpGroup(config(), ["c", "a"], "column"))).toEqual({ a: [50, 30], b: [90, 34], c: [50, 41], p: [70, 20] });
  });

  it("space evenly between the outermost, in the order they sit", () => {
    const spaced = where(spaceEvenly(config(), ["b", "a", "c", "p"]));
    expect(spaced).toEqual({ a: [20, 30], b: [90, 34], c: [55, 41], p: [70, 20] });
    // Two are already as even as they can be.
    expect(spaceEvenly(config(), ["a", "b"])).toEqual(config());
  });
});
