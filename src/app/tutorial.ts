// A step-by-step tutorial that takes a newcomer through making a basic synth: its shape, buttons,
// knobs and a screen, a board on the floor, labels, a seam for the printer, a clean problem list,
// and the files to print. Each step checks the design itself, and says what's still missing, so
// the next one only opens once it's been done right.
import type { Issue } from "../validate.js";
import type { RawConfig } from "./configEdit.js";
import { newEnclosure } from "./shapeEdit.js";

export interface TutorialState {
  config: RawConfig;
  issues: Issue[]; // errors and warnings
  ok: boolean; // whether the design has no errors
  exported: boolean; // whether the files to print have been downloaded during the tutorial
}

export interface TutorialStep {
  title: string;
  body: string;
  target?: string; // the control to point at, as a selector
  missing(state: TutorialState): string[]; // what's still to do, or none once it's done
}

export const BUTTONS = ["arcade-24mm", "latch-button", "ttp223", "mx-switch"];
export const KNOBS = ["ec11-dial-30mm", "ec11-dial-19mm", "ec11-encoder", "encoder-board-5752", "pot-9mm", "fader-60mm"];
export const SCREENS = ["oled-242-ssd1309", "oled-ssd1306"];
export const BOARDS = ["rp2040-plus", "pico-rp2350", "pi-zero", "arduino-uno", "teensy-40", "teensy-41", "arduino-nano", "seeed-xiao"];

export const TUTORIAL_WIDTH = 300; // wide enough to need a seam on the printer's bed

const parts = (config: RawConfig): RawConfig[] => config.components ?? [];
const ofTypes = (config: RawConfig, types: string[]) => parts(config).filter((c) => types.includes(c.type));
const short = (count: number, wanted: number, what: string) => (count >= wanted ? [] : [`${wanted - count} more ${what}`]);

// Where the tutorial starts: a plain box, with a name of its own, its top part of the shell so that
// one seam is all it takes to fit the bed.
export function tutorialStart(): RawConfig {
  const { topPanels: _separateTop, ...box } = newEnclosure();
  return { ...box, name: "My first synth" };
}

export const TUTORIAL: TutorialStep[] = [
  {
    title: "Make room",
    body: `A synth needs room for its controls. On the Shape tab, set the Width to ${TUTORIAL_WIDTH} mm or more. The problem list will soon say it's too big for the printer: that's for a later step.`,
    target: '[data-tab="shape"]',
    missing: ({ config }) => (Number(config.enclosure?.width) >= TUTORIAL_WIDTH ? [] : [`the width at ${TUTORIAL_WIDTH} mm or more`]),
  },
  {
    title: "Slope the back",
    body: "A panel that rises towards the back is easier to reach and read. On the Shape tab, press Add a surface, then give the new one a Height above the first one's.",
    target: '[data-tutorial="add-surface"]',
    missing: ({ config }) => {
      const surfaces: RawConfig[] = config.enclosure?.surfaces ?? [];
      if (surfaces.length < 2) return ["a second top surface"];
      return Number(surfaces.at(-1)!.z) > Number(surfaces[0]!.z) ? [] : ["the back surface higher than the front one"];
    },
  },
  {
    title: "Add four buttons",
    body: "On the Layout tab, choose 24 mm arcade button and press Add, then click the front surface where it should go. Do it four times, or select one and press Ctrl+D to copy it.",
    target: "#part-to-add",
    missing: ({ config }) => short(ofTypes(config, BUTTONS).length, 4, "buttons"),
  },
  {
    title: "Add two knobs",
    body: "Knobs turn things up and down. Add two encoders with dials, such as the EC11 encoder with 19 mm dial, on the sloped surface.",
    target: "#part-to-add",
    missing: ({ config }) => short(ofTypes(config, KNOBS).length, 2, "knobs"),
  },
  {
    title: "Add a screen",
    body: "Add a screen, such as the 0.96 inch SSD1306 I2C OLED, where it can be read: the sloped surface is a good place.",
    target: "#part-to-add",
    missing: ({ config }) => short(ofTypes(config, SCREENS).length, 1, "screen"),
  },
  {
    title: "Put a board on the floor",
    body: "The board runs it all. Add a Waveshare RP2040-Plus, or another board, and click the floor inside to put it there. Turn on Show inside to see it.",
    target: "#part-to-add",
    missing: ({ config }) => short(ofTypes(config, BOARDS).length, 1, "board on the floor"),
  },
  {
    title: "Label the knobs",
    body: "Select each knob and type what it does into its Label field on the Layout tab, such as VOLUME. The words are cut into the panel beside it.",
    target: ".inspector",
    missing: ({ config }) => {
      const knobs = new Set(ofTypes(config, KNOBS).map((c) => c.id));
      const labelled = (config.labels ?? []).filter((label: RawConfig) => knobs.has(label.component) && String(label.text ?? "").trim() !== "").length;
      return short(labelled, Math.min(2, knobs.size || 2), "knobs with labels");
    },
  },
  {
    title: "Split it for the printer",
    body: "It's wider than the printer's bed, so it's printed in two pieces that join along a seam. On the Shape tab, tick Split the shell into pieces, for a small bed.",
    target: '[data-tutorial="seam"]',
    missing: ({ issues }) => (issues.some((issue) => issue.severity === "error" && issue.code === "PART_TOO_LARGE") ? ["every piece fitting the printer's bed"] : []),
  },
  {
    title: "Clear the problems",
    body: "The problem list says what won't work, and where. Click a problem to select what it's about, and fix it: move a part, or press Move it to the nearest spot that fits. Warnings can stay.",
    target: ".issue.error",
    missing: ({ ok, issues }) => (ok ? [] : [`${issues.filter((issue) => issue.severity === "error").length} problems fixed`]),
  },
  {
    title: "Get the files to print",
    body: "On the Print tab, press Download everything. You get each part oriented for printing, files for each bed, and the steps to put it together.",
    target: '[data-tutorial="download"]',
    missing: ({ exported }) => (exported ? [] : ["the files downloaded"]),
  },
];

// The first step that isn't done yet, so the tutorial can't be ahead of the design.
export function firstUnfinished(state: TutorialState, upTo = TUTORIAL.length): number {
  for (let i = 0; i < upTo; i++) if (TUTORIAL[i]!.missing(state).length) return i;
  return upTo;
}
