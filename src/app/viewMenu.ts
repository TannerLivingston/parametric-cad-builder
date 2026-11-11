// What a right-click in the view offers, for what's under it: a part, something else selected by
// clicking it such as a label or a hole, or a bare surface, wall or floor to add something to.
// Each choice only writes the config, so the validator still judges the result.
import { removeComponent, updateComponent, type RawConfig } from "./configEdit.js";
import { labelOfComponent, setComponentLabel } from "./labelEdit.js";
import type { Spot } from "./pickSpot.js";
import { PLACING, type Placing } from "./placeEdit.js";
import { duplicateComponent, duplicateThing, removeThing, rotateThing } from "./thingKeys.js";

export interface MenuResult {
  config: RawConfig;
  select?: string | null; // the part to select after
  pick?: string | null; // the path to pick after
}

export interface MenuChoice {
  label: string;
  run(config: RawConfig): MenuResult | null;
  danger?: boolean;
  // Asks how many and how far apart first, in the menu, rather than running straight away.
  array?: { part: string } | { path: string };
}

const arrayChoice = (target: { part: string } | { path: string }): MenuChoice => ({ label: "Make an array…", array: target, run: () => null });

export type MenuTarget = { part: string } | { path: string } | { spot: Spot };

const tidy = (value: number) => Math.round(value * 10) / 10;

// `lengths` is each top surface's length from front to back, by id, for moving a part onto one.
export function menuFor(config: RawConfig, target: MenuTarget, lengths: Record<string, number> = {}): MenuChoice[] {
  if ("part" in target) return partMenu(config, target.part, lengths);
  if ("path" in target) return thingMenu(config, target.path);
  return addMenu(target.spot);
}

function partMenu(config: RawConfig, id: string, lengths: Record<string, number>): MenuChoice[] {
  const component: RawConfig | undefined = (config.components ?? []).find((c: RawConfig) => c.id === id);
  if (!component) return [];
  const choices: MenuChoice[] = [
    { label: "Rotate 90°", run: (c) => ({ config: updateComponent(c, id, { rotationDeg: ((Number(component.rotationDeg) || 0) + 90) % 360 }) }) },
    {
      label: "Duplicate",
      run: (c) => {
        const copy = duplicateComponent(c, id);
        return copy && { config: copy.config, select: copy.id };
      },
    },
  ];
  choices.push(arrayChoice({ part: id }));
  if (!labelOfComponent(config, id)) choices.push({ label: "Add a label", run: (c) => ({ config: setComponentLabel(c, id, { text: "LABEL" }) }) });
  // A part on a top surface can go onto another, halfway along it.
  if ("u" in component) {
    const first = config.enclosure?.surfaces?.[0]?.id;
    const on = component.surface ?? first;
    for (const surface of config.enclosure?.surfaces ?? []) {
      if (surface.id === on) continue;
      const v = tidy((lengths[surface.id] ?? 0) / 2);
      choices.push({ label: `Move to ${surface.id}`, run: (c) => ({ config: updateComponent(c, id, { surface: surface.id, v }) }) });
    }
  }
  choices.push({ label: "Delete", danger: true, run: (c) => ({ config: removeComponent(c, id), select: null }) });
  return choices;
}

function thingMenu(config: RawConfig, path: string): MenuChoice[] {
  const choices: MenuChoice[] = [];
  if (rotateThing(config, path)) choices.push({ label: "Rotate 90°", run: (c) => { const next = rotateThing(c, path); return next && { config: next }; } });
  if (!/^seams/.test(path) && removeThing(config, path)) {
    choices.push({
      label: "Duplicate",
      run: (c) => {
        const copy = duplicateThing(c, path);
        return copy && { config: copy.config, pick: copy.path };
      },
    });
    choices.push(arrayChoice({ path }));
  }
  if (removeThing(config, path)) choices.push({ label: "Delete", danger: true, run: (c) => { const next = removeThing(c, path); return next && { config: next, pick: null }; } });
  return choices;
}

// What can be added where it was clicked, in the order the Shape tab lists them, with the list it
// joins, so that it's picked once it's there.
const ADDABLE: [string, Placing, string][] = [
  ["a label", PLACING.label, "labels"],
  ["a hole", PLACING.wallHole, "wallHoles"],
  ["a vent", PLACING.vent, "vents"],
  ["a seam", PLACING.seam, "seams"],
  ["a support", PLACING.support, "plate.supports"],
  ["a pin", PLACING.platePin, "plate.pins"],
  ["a hole in the plate", PLACING.plateHole, "plate.countersunkHoles"],
  ["a cable tie bridge", PLACING.cableTie, "plate.cableTies"],
  ["a weight pocket", PLACING.weight, "plate.weights"],
  ["a foot", PLACING.foot, "plate.feet"],
];

const lengthOf = (config: RawConfig, list: string): number => {
  const value = list.split(".").reduce<any>((at, key) => at?.[key], config);
  return Array.isArray(value) ? value.length : 0;
};

function addMenu(spot: Spot): MenuChoice[] {
  // A seam runs across the width, so a side wall says nothing about where.
  const sideWall = spot.kind === "wall" && (spot.wall === "left" || spot.wall === "right");
  return ADDABLE.filter(([, placing, list]) => placing.onto.includes(spot.kind) && !(list === "seams" && sideWall)).map(([what, placing, list]) => ({
    label: `Add ${what} here`,
    run: (c) => {
      const next = placing.at(c, spot);
      return { config: next, pick: `${list}[${lengthOf(next, list) - 1}]` };
    },
  }));
}
