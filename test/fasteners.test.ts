// Changing the screws placed automatically: only what changes moves, and the validator still judges it.
import { beforeAll, describe, expect, it } from "vitest";
import { makeCylinder, measureVolume } from "replicad";
import { readFileSync } from "node:fs";
import { analyseBinarySTL } from "../src/checks.js";
import { buildEnclosure, initEngine, validateConfig, type PlannedFastener } from "../src/index.js";
import { addFastener, hasFastenerChanges, moveFastener, removeFastener, removedFasteners, resetFasteners, restoreRemoved } from "../src/app/fastenerEdit.js";
import { deskSynth } from "./helpers.js";

function plan(config: unknown) {
  const result = validateConfig(config);
  if (!result.ok) throw new Error(JSON.stringify(result.errors, null, 1));
  return result.plan;
}
const issuesOf = (config: unknown) => {
  const result = validateConfig(config);
  return { errors: result.ok ? [] : result.errors, warnings: result.warnings };
};
const fastenersOf = (config: unknown) => {
  const result = validateConfig(config);
  return result.ok ? result.plan.fasteners : result.fasteners!;
};
const has = (points: number[][], x: number, y: number) => points.some(([a, b]) => Math.abs(a! - x) < 0.01 && Math.abs(b! - y) < 0.01);

// A plain box, wide enough that one wall's screws are easy to reason about.
const box = (overrides: Record<string, unknown> = {}): any => ({
  schemaVersion: 1,
  name: "box",
  enclosure: { width: 240, frontHeight: 40, surfaces: [{ id: "top", y: 150, z: 40 }] },
  ...overrides,
});
const capped = (fasteners?: unknown, more: Record<string, unknown> = {}) => box({ topPanels: [{ surface: "top", ...(fasteners ? { fasteners } : {}) }], ...more });

describe("plate screws", () => {
  const base = plan(box()).plate!.screws;

  it("leaves the plan alone with no changes", () => {
    expect(plan(box({ plate: { fasteners: {} } })).plate!.screws).toEqual(base);
  });

  it("adds a screw and leaves the others where they were", () => {
    const { plate } = plan(box({ plate: { fasteners: { add: [{ x: 90, y: base[0]![1] }] } } }));
    expect(has(plate!.screws, 90, base[0]![1]!)).toBe(true);
    // The two within reach of it go, because it's in their way. Nothing else moves.
    const others = base.filter(([x, y]) => Math.hypot(x! - 90, y! - base[0]![1]!) >= 20);
    for (const [x, y] of others) expect(has(plate!.screws, x!, y!)).toBe(true);
  });

  it("takes out a screw it replaces, and only that one", () => {
    const [x, y] = base.find(([bx, by]) => by! < 20 && bx! > 100 && bx! < 140)!;
    const { plate } = plan(box({ plate: { fasteners: { add: [{ x: x! + 10, y: y! }] } } }));
    expect(has(plate!.screws, x!, y!)).toBe(false);
    expect(plate!.screws).toHaveLength(base.length);
  });

  it("removes a screw without filling the gap", () => {
    const [x, y] = base.find(([bx, by]) => by! < 20 && bx! > 100 && bx! < 140)!;
    const { plate } = plan(box({ plate: { fasteners: { remove: [{ x: x!, y: y! }] } } }));
    expect(plate!.screws).toHaveLength(base.length - 1);
    expect(has(plate!.screws, x!, y!)).toBe(false);
  });

  it("matches a removal to a screw that has only shifted a little", () => {
    const [x, y] = base.find(([bx, by]) => by! < 20 && bx! > 100 && bx! < 140)!;
    expect(plan(box({ plate: { fasteners: { remove: [{ x: x! + 3, y: y! }] } } })).plate!.screws).toHaveLength(base.length - 1);
  });

  it("warns about a removal that no longer matches anything, and keeps the screws", () => {
    const config = box({ plate: { fasteners: { remove: [{ x: 90, y: 75 }] } } });
    expect(plan(config).plate!.screws).toEqual(base);
    const warning = issuesOf(config).warnings.find((w) => w.code === "FASTENER_CHANGE_UNUSED");
    expect(warning?.path).toBe("plate.fasteners.remove[0]");
  });

  it("gives a reason for an added screw that can't go there, and still reports where it is", () => {
    const config = box({ plate: { fasteners: { add: [{ x: 120, y: 2 }] } } });
    const { errors } = issuesOf(config);
    expect(errors[0]).toMatchObject({ code: "PLATE_INVALID", path: "plate.fasteners.add[0]" });
    expect(errors[0]!.message).toContain("too close to the edge");
    const item = fastenersOf(config).items.find((f) => f.id === "plate.fasteners.add[0]");
    expect(item).toMatchObject({ x: 120, y: 2, addedAt: 0 });
    expect(item!.problem).toContain("too close to the edge");
  });

  it("keeps a part from sitting on an added screw", () => {
    const config = box({
      plate: { fasteners: { add: [{ x: 120, y: base.filter(([, y]) => y! < 20)[0]![1] }] } },
      customParts: { block: { name: "Block", source: "measured", mount: "floor", footprint: { shape: "rect", width: 40, height: 40 }, height: 20 } },
      components: [{ id: "b", type: "block", x: 120, y: 30 }],
    });
    expect(issuesOf(config).errors.find((e) => e.path === "plate.fasteners.add[0]")?.message).toContain("board");
  });

  it("rejects two added screws too close together", () => {
    const y = base[0]![1]!;
    const { errors } = issuesOf(box({ plate: { fasteners: { add: [{ x: 90, y }, { x: 100, y }] } } }));
    expect(errors[0]?.path).toBe("plate.fasteners.add[1]");
    expect(errors[0]?.message).toContain("closer");
  });

  it("needs enough screws left to hold the plate", () => {
    const { errors } = issuesOf(box({ plate: { fasteners: { remove: base.slice(2).map(([x, y]) => ({ x, y })) } } }));
    expect(errors.map((e) => e.code)).toContain("PLATE_INVALID");
    expect(errors.find((e) => e.path === "plate")?.message).toContain("needs 3");
  });

  it("counts the hardware it ends up with", () => {
    const [x, y] = base.find(([, by]) => by! < 20)!;
    const inserts = (config: unknown) => plan(config).hardware.find((h) => h.name === "M3 brass heat-set insert")!.count;
    expect(inserts(box())).toBe(base.length);
    expect(inserts(box({ plate: { fasteners: { remove: [{ x, y }] } } }))).toBe(base.length - 1);
  });

  it("works on top of a listed set of screws", () => {
    const screws = [{ x: 20, y: 20 }, { x: 120, y: 20 }, { x: 220, y: 20 }, { x: 120, y: 130 }];
    const { plate } = plan(box({ plate: { screws, fasteners: { remove: [{ x: 120, y: 130 }], add: [{ x: 120, y: 75 }] } } }));
    expect(plate!.screws).toEqual([[20, 20], [120, 20], [120, 75], [220, 20]]);
  });
});

describe("top screws", () => {
  const base = plan(capped()).topScrews;
  const front = base.filter((s) => s.wall === "front");

  it("leaves the plan alone with no changes", () => {
    expect(plan(capped({})).topScrews).toEqual(base);
  });

  it("works out the rest of a screw's position from its wall", () => {
    const left = base.find((s) => s.wall === "left")!;
    const { topScrews } = plan(capped({ add: [{ wall: "left", at: left.y + 30 }], remove: [{ wall: "left", at: left.y }] }));
    expect(topScrews.some((s) => s.wall === "left" && s.x === left.x && s.y === left.y + 30)).toBe(true);
  });

  it("removes one and leaves the others where they were", () => {
    const { topScrews } = plan(capped({ remove: [{ wall: "front", at: front[1]!.x }] }));
    expect(topScrews).toHaveLength(base.length - 1);
    expect(topScrews).toEqual(base.filter((s) => s !== front[1]));
  });

  it("warns about a removal that no longer matches anything", () => {
    const config = capped({ remove: [{ wall: "front", at: front[0]!.x + 10 }] });
    expect(issuesOf(config).warnings.find((w) => w.code === "FASTENER_CHANGE_UNUSED")?.path).toBe("topPanels[0].fasteners.remove[0]");
  });

  it("only removes from the panel it names", () => {
    const config = deskSynth();
    const before = plan(config).topScrews;
    const deckLeft = before.find((s) => s.wall === "left" && s.piece === 0)!;
    config.topPanels[1].fasteners = { remove: [{ wall: "left", at: deckLeft.y }] };
    expect(plan(config).topScrews).toEqual(before);
  });

  it("gives a reason for an added screw that can't go there", () => {
    const { errors } = issuesOf(capped({ add: [{ wall: "left", at: 500 }] }));
    expect(errors[0]).toMatchObject({ code: "TOP_PANEL_INVALID", path: "topPanels[0].fasteners.add[0]" });
    expect(errors[0]!.message).toContain("past the end");
  });

  it("needs an edge that can hold it", () => {
    // The Desk Synth's deck meets the panel at its rear, and its panel meets the deck at its front.
    const config = deskSynth();
    config.topPanels[0].fasteners = { add: [{ wall: "rear", at: 60 }] };
    config.topPanels[1].fasteners = { add: [{ wall: "front", at: 60 }] };
    const messages = issuesOf(config).errors.map((e) => e.message);
    expect(messages.some((m) => m.includes("deck has no rear edge"))).toBe(true);
    expect(messages.some((m) => m.includes("panel has no front edge"))).toBe(true);
  });

  it("keeps an added screw out of the opening", () => {
    const opening = { xMin: 80, xMax: 160, yEnd: 60, sill: 5 };
    const { errors } = issuesOf(capped({ add: [{ wall: "front", at: 120 }] }, { opening }));
    expect(errors.find((e) => e.path === "topPanels[0].fasteners.add[0]")?.message).toContain("opening");
  });

  it("rejects two added screws too close together", () => {
    const { errors } = issuesOf(capped({ add: [{ wall: "front", at: 90 }, { wall: "front", at: 100 }] }));
    expect(errors[0]?.path).toBe("topPanels[0].fasteners.add[1]");
    expect(errors[0]?.message).toContain("closer");
  });

  it("drops an automatic screw an added one is too close to", () => {
    const target = front[1]!;
    const { topScrews } = plan(capped({ add: [{ wall: "front", at: target.x + 10 }] }));
    expect(topScrews.some((s) => s.wall === "front" && s.x === target.x)).toBe(false);
    expect(topScrews).toHaveLength(base.length);
  });

  it("never leaves two tabs only just touching", () => {
    // Front tabs on an upright shell are 12 mm wide, so an add 12 mm from an automatic one, and past
    // the 20 mm that would count as crowding on another piece, meets it along a line.
    const target = front[1]!;
    const split = target.x + 6;
    const { topScrews } = plan(capped(undefined, { topPanels: [{ surface: "top", splits: [split], fasteners: { add: [{ wall: "front", at: target.x + 12 }] } }] }));
    expect(topScrews.some((s) => s.wall === "front" && s.x === target.x)).toBe(false);
  });

  it("needs enough screws left to hold a panel", () => {
    const { errors } = issuesOf(capped({ remove: base.slice(1).map((s) => ({ wall: s.wall, at: s.wall === "front" || s.wall === "rear" ? s.x : s.y })) }));
    expect(errors.find((e) => e.path === "topPanels")?.message).toContain("needs 2");
  });

  it("counts the hardware it ends up with", () => {
    const inserts = (config: unknown) => plan(config).hardware.find((h) => h.name.endsWith("for the top panels"))!.count;
    expect(inserts(capped({ remove: [{ wall: "front", at: front[1]!.x }] }))).toBe(base.length - 1);
  });

  it("keeps an added plate screw off a top screw's post", () => {
    const low = capped(undefined, { enclosure: { width: 240, frontHeight: 24, surfaces: [{ id: "top", y: 150, z: 24 }] } });
    const post = plan(low).topScrews.find((s) => s.wall === "left")!;
    low.plate = { fasteners: { add: [{ x: 6.55, y: post.y + 40 }] } };
    expect(issuesOf(low).errors).toEqual([]);
    low.plate = { fasteners: { add: [{ x: 6.55, y: post.y }] } };
    expect(issuesOf(low).errors[0]?.message).toContain("another part's screw");
  });
});

describe("warning about thin fastening", () => {
  const blocker = (width: number, x: number, y: number): any => ({
    customParts: { block: { name: "Block", source: "measured", mount: "floor", footprint: { shape: "rect", width, height: 30 }, height: 20 } },
    components: [{ id: "b", type: "block", x, y }],
  });
  const gaps = (config: unknown) => issuesOf(config).warnings.filter((w) => w.code === "FASTENER_GAP");

  it("says nothing about a plain box", () => {
    expect(gaps(box())).toEqual([]);
    expect(gaps(capped())).toEqual([]);
  });

  it("warns when parts leave a wall without screws", () => {
    const [warning] = gaps(box(blocker(190, 120, 19)));
    expect(warning?.message).toContain("front wall");
    expect(warning?.path).toBe("plate");
    expect(warning?.message).toContain("226.9 mm");
  });

  it("warns when screws are removed from a wall", () => {
    const base = plan(box()).plate!.screws.filter(([x, y]) => y! < 20 && x! > 20 && x! < 220);
    expect(gaps(box({ plate: { fasteners: { remove: base.map(([x, y]) => ({ x, y })) } } }))[0]?.message).toContain("front wall");
  });

  it("clears once a screw is added", () => {
    const base = plan(box()).plate!.screws.filter(([x, y]) => y! < 20 && x! > 20 && x! < 220);
    const remove = base.map(([x, y]) => ({ x, y }));
    expect(gaps(box({ plate: { fasteners: { remove, add: [{ x: 120, y: base[0]![1] }] } } }))).toEqual([]);
  });

  it("counts a screw that's a little off the wall's line", () => {
    const base = plan(box()).plate!.screws.filter(([x, y]) => y! < 20 && x! > 20 && x! < 220);
    const remove = base.map(([x, y]) => ({ x, y }));
    expect(gaps(box({ plate: { fasteners: { remove, add: [{ x: 120, y: base[0]![1]! + 5 }] } } }))).toEqual([]);
  });

  it("doesn't count the stretch an opening takes out of the front wall", () => {
    // Wider than the warning's limit, so it would warn if this stretch counted.
    const opening = { xMin: 25, xMax: 215, yEnd: 30, sill: 5 };
    expect(gaps(box({ opening })).filter((w) => w.message.includes("front wall"))).toEqual([]);
  });

  it("copes with an opening across the whole front wall", () => {
    const opening = { xMin: 3, xMax: 237, yEnd: 30, sill: 5 };
    const result = validateConfig(box({ opening }));
    expect(result.warnings.filter((w) => w.message.includes("front wall"))).toEqual([]);
  });

  it("follows the plate's spacing", () => {
    const config = box(blocker(190, 120, 19));
    config.plate = { screwSpacing: 200 };
    expect(gaps(config)).toEqual([]);
  });

  it("warns about a long panel between two screws", () => {
    const remove = plan(capped()).topScrews.filter((s) => s.wall === "front").map((s) => ({ wall: s.wall, at: s.x }));
    const [warning] = gaps(capped({ remove }));
    expect(warning?.message).toContain("between screws across its width");
    expect(warning?.path).toBe("topPanels[0]");
  });

  it("warns about a panel's end with nothing holding it", () => {
    const remove = plan(capped()).topScrews.filter((s) => s.wall !== "left").map((s) => ({ wall: s.wall, at: s.wall === "right" ? s.y : s.x }));
    expect(gaps(capped({ remove })).map((w) => w.message).join()).toContain("past its last screw");
  });

  it("warns about the Desk Synth's rear wall and long panels", () => {
    const messages = gaps(deskSynth()).map((w) => w.message);
    expect(messages).toHaveLength(4);
    expect(messages.some((m) => m.startsWith("Deck 1 runs 91 mm"))).toBe(true);
    expect(messages.some((m) => m.startsWith("Panel 1 has 201.45 mm between screws"))).toBe(true);
    expect(messages.some((m) => m.startsWith("Panel 2 runs 129.85 mm"))).toBe(true);
    expect(messages.some((m) => m.startsWith("The rear wall has 337.8 mm"))).toBe(true);
  });
});

describe("editing the screws", () => {
  const items = (config: unknown) => fastenersOf(config).items;
  const auto = (config: unknown, kind: string) => items(config).find((f) => f.kind === kind && f.addedAt === null) as PlannedFastener;

  it("moves an automatic screw by removing it and adding another", () => {
    const item = items(box()).find((f) => f.kind === "plate" && f.y < 20 && f.x > 100 && f.x < 140)!;
    const { config, id } = moveFastener(box(), item, item.x + 6, item.y);
    expect(config.plate.fasteners).toEqual({ add: [{ x: item.x + 6, y: Math.round(item.y * 100) / 100 }], remove: [{ x: Math.round(item.x * 100) / 100, y: Math.round(item.y * 100) / 100 }] });
    expect(id).toBe("plate.fasteners.add[0]");
    const result = plan(config);
    expect(result.plate!.screws).toHaveLength(plan(box()).plate!.screws.length);
    expect(issuesOf(config).warnings.filter((w) => w.code === "FASTENER_CHANGE_UNUSED")).toEqual([]);
  });

  it("moves an added screw without adding another change", () => {
    const first = moveFastener(box(), auto(box(), "plate"), 60, 75);
    const added = items(first.config).find((f) => f.id === first.id)!;
    const second = moveFastener(first.config, added, 70, 75);
    expect(second.config.plate.fasteners.add).toEqual([{ x: 70, y: 75 }]);
    expect(second.config.plate.fasteners.remove).toHaveLength(1);
    expect(second.id).toBe(first.id);
  });

  it("moves a top screw along its wall", () => {
    const item = items(capped()).find((f) => f.kind === "top" && f.wall === "left")!;
    const { config, id } = moveFastener(capped(), item, item.x, item.y + 12);
    expect(id).toBe("topPanels[0].fasteners.add[0]");
    expect(config.topPanels[0].fasteners.add[0]).toEqual({ wall: "left", at: Math.round((item.y + 12) * 100) / 100 });
    expect(issuesOf(config).errors).toEqual([]);
  });

  it("removes an automatic screw as a change, and an added one by forgetting it", () => {
    const item = auto(box(), "plate");
    const removed = removeFastener(box(), item);
    expect(removed.plate.fasteners.remove).toHaveLength(1);
    const moved = moveFastener(box(), item, 60, 75);
    const gone = removeFastener(moved.config, items(moved.config).find((f) => f.id === moved.id)!);
    expect(gone.plate.fasteners.add).toBeUndefined();
    expect(gone.plate.fasteners.remove).toHaveLength(1);
  });

  it("brings a removed screw back", () => {
    const item = auto(box(), "plate");
    const removed = removeFastener(box(), item);
    expect(removedFasteners(removed, null)).toHaveLength(1);
    expect(restoreRemoved(removed, null, 0)).toEqual(box());
  });

  it("goes back to automatic, leaving nothing in the file", () => {
    const moved = moveFastener(capped(), items(capped()).find((f) => f.kind === "top")!, 7, 40).config;
    const both = removeFastener(moved, auto(moved, "plate"));
    expect(hasFastenerChanges(both)).toBe(true);
    const reset = resetFasteners(resetFasteners(both, null), "top");
    expect(reset).toEqual(capped());
    expect(hasFastenerChanges(reset)).toBe(false);
  });

  it("keeps other plate settings when going back", () => {
    const config = box({ plate: { screwSpacing: 90, fasteners: { remove: [{ x: 1, y: 1 }] } } });
    expect(resetFasteners(config, null).plate).toEqual({ screwSpacing: 90 });
  });

  it("adds a plate screw where the Desk Synth's rear wall has room", () => {
    const config = deskSynth();
    const added = addFastener(config, fastenersOf(config), null)!;
    expect(added.id).toBe("plate.fasteners.add[0]");
    const result = validateConfig(added.config);
    expect(result.ok).toBe(true);
    const before = plan(config).plate!.screws;
    const after = plan(added.config).plate!.screws;
    expect(after).toHaveLength(before.length + 1);
  });

  it("adds a top screw to the panel it's asked for", () => {
    const config = deskSynth();
    const added = addFastener(config, fastenersOf(config), "deck")!;
    expect(added.config.topPanels[0].fasteners.add).toHaveLength(1);
    expect(validateConfig(added.config).ok).toBe(true);
    expect(plan(added.config).topScrews).toHaveLength(plan(config).topScrews.length + 1);
  });

  it("says when there's nowhere left", () => {
    const full = box({
      customParts: { block: { name: "Block", source: "measured", mount: "floor", footprint: { shape: "rect", width: 232, height: 142 }, height: 20 } },
      components: [{ id: "b", type: "block", x: 120, y: 75 }],
    });
    expect(addFastener(full, fastenersOf(full), null)).toBeNull();
  });
});

describe("building with changed screws", () => {
  beforeAll(() => initEngine(), 60_000);

  const closed = async (config: unknown) => {
    const results: boolean[] = [];
    for (const part of buildEnclosure(plan(config)).parts) {
      const bytes = new Uint8Array(await part.shape.blobSTL({ binary: true, tolerance: 0.1, angularTolerance: 0.3 }).arrayBuffer());
      results.push(analyseBinarySTL(bytes).watertight);
    }
    return results;
  };

  it("makes closed parts from added and removed plate and top screws", async () => {
    const base = plan(capped());
    const plateScrew = base.plate!.screws.find(([x, y]) => y! < 20 && x! > 100 && x! < 140)!;
    const front = base.topScrews.filter((s) => s.wall === "front")[1]!;
    const config = capped(
      { add: [{ wall: "front", at: front.x + 30 }], remove: [{ wall: "front", at: front.x }] },
      { plate: { fasteners: { add: [{ x: plateScrew[0]! + 8, y: plateScrew[1] }], remove: [{ x: plateScrew[0], y: plateScrew[1] }] } } },
    );
    const results = await closed(config);
    expect(results.length).toBeGreaterThan(1);
    expect(results.every(Boolean)).toBe(true);
  }, 120_000);

  it("makes closed parts on the seamed Desk Synth, where a boss on the rear wall gets slopes", async () => {
    const config = deskSynth();
    config.plate.fasteners = { add: [{ x: 26.5, y: 170.35 }, { x: 50, y: 170.35 }], remove: [{ x: 6.8, y: 170.35 }] };
    config.topPanels[0].fasteners = { add: [{ wall: "front", at: 70 }], remove: [{ wall: "front", at: 93 }] };
    expect((await closed(config)).every(Boolean)).toBe(true);
  }, 120_000);
});

// A part with a piece floating free of it would print as loose bits.
describe("every printed part holds together", () => {
  beforeAll(() => initEngine(), 60_000);
  const solidCounts = (config: unknown) => {
    const result = validateConfig(config);
    if (!result.ok) throw new Error(JSON.stringify(result.errors, null, 1));
    return buildEnclosure(result.plan).parts.map((part) => [part.name, part.shape.solids.length]);
  };
  const allOne = (counts: (string | number)[][]) => counts.forEach(([name, count]) => expect(count, String(name)).toBe(1));

  it("ties a boss to the wall where a bottom round stops it reaching", () => {
    const config = {
      schemaVersion: 1,
      name: "low round",
      enclosure: { width: 150, frontHeight: 30, wall: 2.4, cornerRadius: 0, rounds: { rearBottom: 5 }, surfaces: [{ id: "top", y: 140, z: 40 }, { id: "back", y: 180, z: 40 }] },
      topPanels: [{ surface: "top" }, { surface: "back" }],
    };
    allOne(solidCounts(config));
    // The tie is no wider than the boss, because that's all the room its checks kept.
    const built = plan(config);
    const [x, y] = built.plate!.screws.find(([, at]) => at > 170)!;
    const shell = buildEnclosure(built).parts[0]!.shape;
    const inside = (dx: number) => {
      try {
        return measureVolume(shell.intersect(makeCylinder(0.2, 2, [x + dx, 176.5, 5], [0, 0, 1])));
      } catch {
        return 0;
      }
    };
    expect(inside(0)).toBeGreaterThan(0.1);
    expect(inside(5)).toBeLessThan(0.001);
  }, 60_000);

  it("keeps a seam tab that can hold on to a round", () => {
    const config = {
      schemaVersion: 1,
      name: "big round",
      enclosure: { width: 220, frontHeight: 40, cornerRadius: 3, rounds: { rearBottom: 30 }, surfaces: [{ id: "top", y: 140, z: 40 }] },
      topPanels: [{ surface: "top" }],
      seams: [{ x: 110 }],
    };
    const built = plan(config);
    const wallTabs = built.seams[0]!.tabs.filter((tab) => !tab.surface);
    expect(wallTabs).toHaveLength(2);
    // It's moved in from the wall, and is still over the round.
    expect(wallTabs[1]!.start[0]).toBeLessThan(137);
    expect(wallTabs[1]!.start[0]).toBeGreaterThan(built.profile.plateRear);
    allOne(solidCounts(config));
  }, 60_000);

  it("leaves off a seam tab that would have nothing to hold on to", () => {
    const config = {
      schemaVersion: 1,
      name: "low rear",
      enclosure: { width: 220, frontHeight: 60, wall: 1.6, panelThickness: 1.6, floorThickness: 1.6, cornerRadius: 12, rounds: { rearBottom: 8 }, surfaces: [{ id: "top", y: 140, z: 15 }] },
      topPanels: [{ surface: "top" }],
      seams: [{ x: 110 }],
    };
    allOne(solidCounts(config));
    const result = validateConfig(config);
    if (!result.ok) throw new Error("It should be valid.");
    // Only the tab at the front is left.
    expect(result.plan.seams[0]!.tabs.map((tab) => tab.start[0])).toEqual([1.6]);
    expect(result.warnings.map((w) => w.code)).toContain("SEAM_UNBRACED");
    // A surface that's part of the shell can hold it.
    const open = validateConfig({ ...config, topPanels: [] });
    if (!open.ok) throw new Error("It should be valid.");
    expect(open.plan.seams[0]!.tabs.filter((tab) => !tab.surface).length).toBe(2);
    allOne(solidCounts({ ...config, topPanels: [] }));
  }, 60_000);

  for (const name of ["desk-synth", "dial-deck"]) {
    it(`holds for the ${name} example`, () => {
      allOne(solidCounts(JSON.parse(readFileSync(new URL(`../examples/${name}.json`, import.meta.url), "utf8"))));
    }, 120_000);
  }
});
