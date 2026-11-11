// What a right-click in the view offers, and what each choice does.
import { describe, expect, it } from "vitest";
import { menuFor } from "../src/app/viewMenu.js";

const design = (): any => ({
  schemaVersion: 1,
  name: "box",
  enclosure: { width: 300, frontHeight: 40, surfaces: [{ id: "deck", y: 80, z: 40 }, { id: "panel", y: 150, z: 60 }] },
  seams: [{ x: 150 }],
  wallHoles: [{ wall: "rear", at: 60, z: 20, width: 14, height: 8 }],
  labels: [{ text: "GAIN", surface: "panel", u: 220, v: 30 }],
  plate: { feet: [{ x: 20, y: 20 }] },
  components: [{ id: "button-1", type: "arcade-24mm", surface: "deck", u: 60, v: 40 }],
});
const labels = (choices: { label: string }[]) => choices.map((c) => c.label);
const run = (choices: any[], label: string, config = design()) => choices.find((c) => c.label === label)!.run(config);

describe("the right-click menu", () => {
  it("offers a part its turns, copies, label, other surfaces and removal", () => {
    const choices = menuFor(design(), { part: "button-1" }, { deck: 80, panel: 31 });
    expect(labels(choices)).toEqual(["Rotate 90°", "Duplicate", "Make an array…", "Add a label", "Move to panel", "Delete"]);
    expect(run(choices, "Rotate 90°").config.components[0].rotationDeg).toBe(90);
    expect(run(choices, "Move to panel").config.components[0]).toMatchObject({ surface: "panel", u: 60, v: 15.5 });
    expect(run(choices, "Add a label").config.labels.at(-1)).toEqual({ text: "LABEL", component: "button-1" });
    expect(run(choices, "Duplicate").select).toBe("button-2");
    expect(run(choices, "Delete")).toMatchObject({ select: null, config: { components: [] } });
    // With a label already, there's none to add.
    const labelled = { ...design(), labels: [{ text: "GO", component: "button-1" }] };
    expect(labels(menuFor(labelled, { part: "button-1" }))).not.toContain("Add a label");
    expect(menuFor(design(), { part: "nothing" })).toEqual([]);
  });

  it("offers something else only what makes sense for it", () => {
    expect(labels(menuFor(design(), { path: "labels[0]" }))).toEqual(["Rotate 90°", "Duplicate", "Make an array…", "Delete"]);
    expect(labels(menuFor(design(), { path: "wallHoles[0]" }))).toEqual(["Duplicate", "Make an array…", "Delete"]);
    expect(labels(menuFor(design(), { path: "seams[0]" }))).toEqual(["Delete"]);
    const copied = run(menuFor(design(), { path: "wallHoles[0]" }), "Duplicate");
    expect(copied.pick).toBe("wallHoles[1]");
    expect(run(menuFor(design(), { path: "labels[0]" }), "Delete")).toMatchObject({ pick: null });
  });

  it("offers what can go where a bare spot was clicked, and picks it once added", () => {
    expect(labels(menuFor(design(), { spot: { kind: "surface", surface: "deck", u: 100, v: 20 } }))).toEqual(["Add a label here", "Add a seam here"]);
    expect(labels(menuFor(design(), { spot: { kind: "wall", wall: "rear", at: 100, z: 20 } }))).toEqual(["Add a label here", "Add a hole here", "Add a vent here", "Add a seam here"]);
    // A side wall says nothing about where across the width a seam would go.
    expect(labels(menuFor(design(), { spot: { kind: "wall", wall: "left", at: 50, z: 20 } }))).not.toContain("Add a seam here");
    expect(labels(menuFor(design(), { spot: { kind: "under", x: 50, y: 50 } }))).toContain("Add a foot here");

    const hole = run(menuFor(design(), { spot: { kind: "wall", wall: "front", at: 120, z: 18 } }), "Add a hole here");
    expect(hole.pick).toBe("wallHoles[1]");
    expect(hole.config.wallHoles[1]).toMatchObject({ wall: "front", at: 120, z: 18 });
    const foot = run(menuFor(design(), { spot: { kind: "under", x: 50, y: 60 } }), "Add a foot here");
    expect(foot.pick).toBe("plate.feet[1]");
    expect(foot.config.plate.feet[1]).toEqual({ x: 50, y: 60 });
    const label = run(menuFor(design(), { spot: { kind: "surface", surface: "deck", u: 100, v: 20 } }), "Add a label here");
    expect(label.config.labels[1]).toMatchObject({ surface: "deck", u: 100, v: 20 });
  });
});
