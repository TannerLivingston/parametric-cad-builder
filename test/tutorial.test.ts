// The tutorial's steps: each one checks the design, and none can be got ahead of.
import { describe, expect, it } from "vitest";
import { firstUnfinished, TUTORIAL, TUTORIAL_WIDTH, tutorialStart, type TutorialState } from "../src/app/tutorial.js";
import { validateConfig } from "../src/validate.js";

const state = (config: any, more: Partial<TutorialState> = {}): TutorialState => {
  const result = validateConfig(config);
  return { config, issues: [...(result.ok ? [] : result.errors), ...result.warnings], ok: result.ok, exported: false, ...more };
};
const missing = (step: number, s: TutorialState) => TUTORIAL[step]!.missing(s);

describe("the tutorial", () => {
  const start = tutorialStart();

  it("starts on a plain box, at the first step", () => {
    expect(validateConfig(start).ok).toBe(true);
    expect(firstUnfinished(state(start))).toBe(0);
    expect(missing(0, state(start))).toEqual([`the width at ${TUTORIAL_WIDTH} mm or more`]);
  });

  const wide = { ...start, enclosure: { ...start.enclosure, width: 300 } };
  const sloped = { ...wide, enclosure: { ...wide.enclosure, surfaces: [{ id: "top", y: 100, z: 40 }, { id: "back", y: 160, z: 55 }] } };

  it("checks the shape: wide enough, and a second surface higher at the back", () => {
    expect(missing(0, state(wide))).toEqual([]);
    expect(missing(1, state(wide))).toEqual(["a second top surface"]);
    const flatBack = { ...wide, enclosure: { ...wide.enclosure, surfaces: [{ id: "top", y: 100, z: 40 }, { id: "back", y: 160, z: 40 }] } };
    expect(missing(1, state(flatBack))).toEqual(["the back surface higher than the front one"]);
    expect(missing(1, state(sloped))).toEqual([]);
  });

  it("counts buttons, knobs, a screen and a board, saying how many more", () => {
    const some = { ...sloped, components: [{ id: "b1", type: "arcade-24mm", surface: "top", u: 40, v: 50 }, { id: "k1", type: "ec11-dial-19mm", surface: "back", u: 40, v: 30 }] };
    expect(missing(2, state(some))).toEqual(["3 more buttons"]);
    expect(missing(3, state(some))).toEqual(["1 more knobs"]);
    expect(missing(4, state(some))).toEqual(["1 more screen"]);
    expect(missing(5, state(some))).toEqual(["1 more board on the floor"]);
  });

  it("wants the knobs labelled, the shell split for the bed, no problems, and the files", () => {
    const knobs = { ...sloped, components: [{ id: "k1", type: "ec11-dial-19mm", surface: "back", u: 40, v: 30 }, { id: "k2", type: "ec11-dial-19mm", surface: "back", u: 90, v: 30 }] };
    expect(missing(6, state(knobs))).toEqual(["2 more knobs with labels"]);
    const labelled = { ...knobs, labels: [{ text: "VOLUME", component: "k1" }, { text: "TONE", component: "k2" }] };
    expect(missing(6, state(labelled))).toEqual([]);
    // Wider than the bed, it's too large until it's split.
    expect(missing(7, state(sloped))).toEqual(["every piece fitting the printer's bed"]);
    expect(missing(7, state({ ...sloped, seams: [{ x: 150 }] }))).toEqual([]);
    expect(missing(8, state(sloped))[0]).toMatch(/problems fixed$/);
    expect(missing(9, state(sloped))).toEqual(["the files downloaded"]);
    expect(missing(9, state(sloped, { exported: true }))).toEqual([]);
  });

  it("can't be ahead of the design: an earlier step undone is the one to do", () => {
    expect(firstUnfinished(state(sloped), 5)).toBe(2);
    expect(firstUnfinished(state(start), 5)).toBe(0);
  });

  it("can be finished: a design that does every step has nothing missing but the download", () => {
    const finished = {
      ...sloped,
      seams: [{ x: 150 }],
      components: [
        { id: "b1", type: "arcade-24mm", surface: "top", u: 30, v: 50 },
        { id: "b2", type: "arcade-24mm", surface: "top", u: 62, v: 50 },
        { id: "b3", type: "arcade-24mm", surface: "top", u: 94, v: 50 },
        { id: "b4", type: "arcade-24mm", surface: "top", u: 126, v: 50 },
        { id: "k1", type: "ec11-dial-19mm", surface: "back", u: 200, v: 30 },
        { id: "k2", type: "ec11-dial-19mm", surface: "back", u: 250, v: 30 },
        { id: "s1", type: "oled-ssd1306", surface: "back", u: 60, v: 30 },
        { id: "m1", type: "rp2040-plus", x: 220, y: 50 },
      ],
      labels: [{ text: "VOLUME", component: "k1" }, { text: "TONE", component: "k2" }],
    };
    expect(firstUnfinished(state(finished))).toBe(TUTORIAL.length - 1);
    expect(firstUnfinished(state(finished, { exported: true }))).toBe(TUTORIAL.length);
  });
});
