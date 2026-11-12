// What the keys do to something selected in the view: the arrows nudge it, R turns it, Delete
// takes it away and Ctrl+D makes a copy beside it. Each works on a part by its id, or on anything
// else by its path in the config, such as `labels[0]` or `plate.feet[2]`. Each returns null where
// the key means nothing for that thing, such as turning a hole or deleting the walls.
import { textOutline } from "../lettering.js";
import { errorCount, tidy, type RawConfig } from "./configEdit.js";
import { validateConfig } from "../validate.js";
import { arrayComponent, MAX_COPIES, unusedIds } from "./layoutEdit.js";

type Where = { key: string; plate: boolean; index: number };
type Axes = [string, string | null];

export function whereOf(path: string): Where | null {
  const match = /^(plate\.)?(labels|wallHoles|vents|seams|feet|supports|pins|cableTies|countersunkHoles|weights)\[(\d+)\]$/.exec(path);
  if (!match) return null;
  const plate = Boolean(match[1]);
  // Labels, holes, vents and seams are top-level lists, the rest are on the plate.
  if (plate !== !["labels", "wallHoles", "vents", "seams"].includes(match[2]!)) return null;
  return { key: match[2]!, plate, index: Number(match[3]) };
}

export function listOf(config: RawConfig, where: Where): RawConfig[] {
  const list = where.plate ? config.plate?.[where.key] : config[where.key];
  return Array.isArray(list) ? list : [];
}

// An emptied top-level list leaves the file, as the remove buttons do; the plate's lists stay.
function withList(config: RawConfig, where: Where, items: RawConfig[]): RawConfig {
  if (where.plate) return { ...config, plate: { ...config.plate, [where.key]: items } };
  const { [where.key]: _, ...rest } = config;
  return items.length ? { ...rest, [where.key]: items } : rest;
}

// The two numbers that say where something is, across and up as the arrows see it.
export function axesOf(item: RawConfig, key: string): Axes | null {
  if (key === "seams") return ["x", null];
  if (key === "labels" && typeof item.component === "string") return null;
  if ("wall" in item) return ["at", "z"];
  if ("u" in item) return ["u", "v"];
  if ("x" in item) return ["x", "y"];
  return key === "labels" ? ["u", "v"] : null;
}

const moved = (item: RawConfig, [a, b]: Axes, da: number, db: number): RawConfig => ({
  ...item,
  [a]: tidy(Number(item[a] ?? 0) + da),
  ...(b ? { [b]: tidy(Number(item[b] ?? 0) + db) } : {}),
});

export function nudgeThing(config: RawConfig, path: string, da: number, db: number): RawConfig | null {
  const where = whereOf(path);
  if (!where) return null;
  const items = listOf(config, where);
  const item = items[where.index];
  const axes = item && axesOf(item, where.key);
  if (!axes || (axes[1] === null && da === 0)) return null;
  return withList(config, where, items.map((it, i) => (i === where.index ? moved(it, axes, da, db) : it)));
}

// Only what has a turn of its own: a label not tied to a part, and a weight pocket.
export function rotateThing(config: RawConfig, path: string): RawConfig | null {
  const where = whereOf(path);
  if (!where || !["labels", "weights"].includes(where.key)) return null;
  const items = listOf(config, where);
  const item = items[where.index];
  if (!item || typeof item.component === "string") return null;
  const turned = { ...item, rotationDeg: ((Number(item.rotationDeg) || 0) + 90) % 360 };
  return withList(config, where, items.map((it, i) => (i === where.index ? turned : it)));
}

export function removeThing(config: RawConfig, path: string): RawConfig | null {
  const where = whereOf(path);
  if (!where) return null;
  const items = listOf(config, where);
  if (!items[where.index]) return null;
  return withList(config, where, items.filter((_, i) => i !== where.index));
}

const STEP = 2; // how far apart the spots tried for a copy are
const TRIES = 60;
const GAP = 2; // the least room left between a copy and its original

// Its size across and up, as far as it says; a part's is the validator's to judge.
export function sizeOf(item: RawConfig, key: string): [number, number] {
  const turned = item.rotationDeg === 90 || item.rotationDeg === 270;
  if (key === "labels") {
    const outline = textOutline(String(item.text ?? ""), Number(item.size ?? 5));
    return turned ? [outline.height, outline.width] : [outline.width, outline.height];
  }
  if (typeof item.diameter === "number") return [item.diameter, item.diameter];
  const across = Number(item.width) || 0;
  const up = Number(item.height ?? item.depth) || 0;
  return turned ? [up, across] : [across, up];
}

// The first spot beside the original where the copy adds no problems, trying across first, then
// up, either way. If there's nowhere, it goes where it adds the fewest, and the validator explains why.
function besideOriginal(config: RawConfig, axes: Axes, place: (da: number, db: number) => RawConfig, [across, up]: [number, number] = [0, 0]): RawConfig {
  const baseline = errorCount(config);
  let best = { config: place(STEP, 0), errors: Infinity };
  // Across first, so that copies make a row, nearest first either way.
  const rows: [number, number][][] = [[[1, 0], [-1, 0]], ...(axes[1] ? [[[0, 1], [0, -1]] as [number, number][]] : [])];
  for (const ways of rows) {
    for (let n = 1; n <= TRIES; n++) {
      for (const [a, b] of ways) {
        const candidate = place(a * (n * STEP + (across ? across + GAP - STEP : 0)), b * (n * STEP + (up ? up + GAP - STEP : 0)));
        const errors = errorCount(candidate);
        if (errors <= baseline) return candidate;
        if (errors < best.errors) best = { config: candidate, errors };
      }
    }
  }
  return best.config;
}

// A copy of something on a list, with the path it's at now.
export function duplicateThing(config: RawConfig, path: string): { config: RawConfig; path: string } | null {
  const where = whereOf(path);
  if (!where || where.key === "seams") return null;
  const items = listOf(config, where);
  const item = items[where.index];
  const axes = item && axesOf(item, where.key);
  if (!item || !axes) return null;
  const next = besideOriginal(config, axes, (da, db) => withList(config, where, [...items, moved(item, axes, da, db)]), sizeOf(item, where.key));
  return { config: next, path: `${where.plate ? "plate." : ""}${where.key}[${items.length}]` };
}

// A copy of a part, with its knob, cap and labels, beside it. Its id is the next free one in its
// numbering, as a row of copies gets.
export function duplicateComponent(config: RawConfig, id: string): { config: RawConfig; id: string } | null {
  const components: RawConfig[] = config.components ?? [];
  const original = components.find((c) => c.id === id);
  if (!original) return null;
  const axes: Axes = "wall" in original ? ["at", "z"] : "x" in original ? ["x", "y"] : ["u", "v"];
  const [copyId] = unusedIds(config, id, 1) as [string];
  const labels: RawConfig[] = config.labels ?? [];
  const copiedLabels = labels.filter((label) => label.component === id).map((label) => ({ ...label, component: copyId }));
  const next = besideOriginal(config, axes, (da, db) => ({
    ...config,
    components: [...components, { ...moved(original, axes, da, db), id: copyId }],
    ...(copiedLabels.length ? { labels: [...labels, ...copiedLabels] } : {}),
  }));
  return { config: next, id: copyId };
}

// How far apart copies in a row (axis 0) or between rows (axis 1) can be: the least step, either
// way, at which one copy adds no problem. Failing that, its size and a gap, or 20 mm.
function clearPitch(config: RawConfig, place: (da: number, db: number) => RawConfig, size: number, axis: 0 | 1): number {
  const baseline = errorCount(config);
  for (let n = 1; n <= TRIES; n++) {
    const offset = n * STEP + (size ? size + GAP - STEP : 0);
    for (const way of [1, -1]) {
      if (errorCount(axis === 0 ? place(way * offset, 0) : place(0, way * offset)) <= baseline) return tidy(offset);
    }
  }
  return tidy(size ? size + GAP : 20);
}

export interface ArrayOptions {
  columns: number;
  rows: number;
  stepAlong: number;
  stepAcross: number;
}

// The spacing a row and rows of copies start from, or null for what can't be copied. Rows only
// where it has a second number to step, which a seam hasn't.
export function arrayPitch(config: RawConfig, target: { part: string } | { path: string }): { along: number; across: number | null } | null {
  if ("part" in target) {
    const components: RawConfig[] = config.components ?? [];
    const original = components.find((c) => c.id === target.part);
    if (!original) return null;
    const axes: Axes = "wall" in original ? ["at", "z"] : "x" in original ? ["x", "y"] : ["u", "v"];
    // What the part needs from its own copies, with the other parts out of the way: what's beside
    // it now shows as a problem once the copies are made.
    const alone = { ...config, components: [original], labels: (config.labels ?? []).filter((label: RawConfig) => label.component === original.id) };
    const place = (da: number, db: number) => ({ ...alone, components: [original, { ...moved(original, axes, da, db), id: `${original.id}-pitch` }] });
    return { along: clearPitch(alone, place, 0, 0), across: clearPitch(alone, place, 0, 1) };
  }
  const where = whereOf(target.path);
  if (!where || where.key === "seams") return null;
  const items = listOf(config, where);
  const item = items[where.index];
  const axes = item && axesOf(item, where.key);
  if (!item || !axes) return null;
  const size = sizeOf(item, where.key);
  const place = (da: number, db: number) => withList(config, where, [...items, moved(item, axes, da, db)]);
  return { along: clearPitch(config, place, size[0], 0), across: axes[1] ? clearPitch(config, place, size[1], 1) : null };
}

// Rows of copies of something on a list, or of a part, with the original as the first of the first
// row. Rows go up, or back on a top surface or the floor.
export function arrayThing(config: RawConfig, target: { part: string } | { path: string }, { columns, rows, stepAlong, stepAcross }: ArrayOptions): RawConfig | null {
  if ("part" in target) {
    const made = arrayComponent(config, target.part, { columns, rows, stepAlong, stepAcross });
    return made.ids.length ? made.config : null;
  }
  const where = whereOf(target.path);
  if (!where || where.key === "seams") return null;
  const items = listOf(config, where);
  const item = items[where.index];
  const axes = item && axesOf(item, where.key);
  if (!item || !axes) return null;
  const across = axes[1] ? Math.max(1, Math.floor(rows)) : 1;
  const along = Math.max(1, Math.floor(columns));
  if (along * across <= 1 || along * across > MAX_COPIES) return null;
  const copies: RawConfig[] = [];
  for (let row = 0; row < across; row++) {
    for (let column = 0; column < along; column++) {
      if (row || column) copies.push(moved(item, axes, column * stepAlong, row * stepAcross));
    }
  }
  return withList(config, where, [...items, ...copies]);
}

// Parts copied, as text, so that they can be pasted into this design or another: with their knobs,
// caps and labels, and any custom part they are, which the other design may not have.
export const CLIP_KIND = "enclosure-parts";

export function copyParts(config: RawConfig, ids: string[]): string | null {
  const components: RawConfig[] = (config.components ?? []).filter((c: RawConfig) => ids.includes(c.id));
  if (!components.length) return null;
  const labels = (config.labels ?? []).filter((label: RawConfig) => ids.includes(label.component));
  const custom: Record<string, unknown> = config.customParts ?? {};
  const customParts = Object.fromEntries(components.filter((c) => c.type in custom).map((c) => [c.type, custom[c.type]]));
  return JSON.stringify({ kind: CLIP_KIND, components, labels, customParts });
}

// Puts copied parts in, each with the next free id in its numbering: where they were if that adds no
// problem, or else all moved together across, then up, to the nearest place that doesn't. A part
// on a surface this design hasn't goes on its first. Null for text that isn't copied parts.
export function pasteParts(config: RawConfig, text: string): { config: RawConfig; ids: string[] } | null {
  let clip: any;
  try {
    clip = JSON.parse(text);
  } catch {
    return null;
  }
  if (clip?.kind !== CLIP_KIND || !Array.isArray(clip.components) || !clip.components.length) return null;
  const surfaces = new Set((config.enclosure?.surfaces ?? []).map((s: RawConfig) => s.id));
  const first = config.enclosure?.surfaces?.[0]?.id;
  let named: RawConfig = config;
  const renamed = new Map<string, string>();
  for (const component of clip.components as RawConfig[]) {
    const [id] = unusedIds(named, component.id, 1) as [string];
    renamed.set(component.id, id);
    named = { ...named, components: [...(named.components ?? []), { id }] };
  }
  const customParts = { ...(clip.customParts ?? {}), ...(config.customParts ?? {}) };
  const place = (da: number, db: number): RawConfig => {
    const pasted = (clip.components as RawConfig[]).map((component) => {
      const axes: Axes = "wall" in component ? ["at", "z"] : "x" in component ? ["x", "y"] : ["u", "v"];
      const onSurface = "u" in component && component.surface !== undefined && !surfaces.has(component.surface) ? { surface: first } : {};
      return { ...moved(component, axes, da, db), ...onSurface, id: renamed.get(component.id) };
    });
    const labels = (clip.labels ?? []).map((label: RawConfig) => ({ ...label, component: renamed.get(label.component) }));
    return {
      ...config,
      components: [...(config.components ?? []), ...pasted],
      ...(labels.length ? { labels: [...(config.labels ?? []), ...labels] } : {}),
      ...(Object.keys(customParts).length ? { customParts } : {}),
    };
  };
  const baseline = errorCount(config);
  const still = place(0, 0);
  if (errorCount(still) <= baseline) return { config: still, ids: [...renamed.values()] };
  return { config: besideOriginal(config, ["u", "v"], place), ids: [...renamed.values()] };
}

// The nearest place to where something is now at which it has no problem of its own, and nothing
// else is made worse: a part by its id, or a label, hole, vent, seam or plate item by its path.
// Tried outward in rings half a millimetre apart, a millimetre apart around each, to 40 mm, so a
// narrow band between two limits isn't stepped over. A seam moves only across.
const FIT_REACH = 40;
const FIT_SPACING = 1; // mm between the spots tried around a ring

function* fitOffsets(twoD: boolean): Generator<[number, number]> {
  for (let r = 0.5; r <= FIT_REACH; r += 0.5) {
    if (!twoD) {
      yield [r, 0];
      yield [-r, 0];
      continue;
    }
    const count = Math.max(8, Math.ceil((2 * Math.PI * r) / FIT_SPACING));
    for (let i = 0; i < count; i++) {
      const angle = (i / count) * 2 * Math.PI;
      yield [Math.round(r * Math.cos(angle) * 10) / 10, Math.round(r * Math.sin(angle) * 10) / 10];
    }
  }
}

export type FitTarget = { part: string } | { path: string };

// A search that's worked through a step at a time: each yield is how far out it's got, in mm, and
// what it returns is the design with it moved, or null if there's nowhere in reach. Nothing at all
// for something that has no problem of its own.
export function* fitSearch(config: RawConfig, target: FitTarget): Generator<number, RawConfig | null> {
  let own: (issue: { path: string; componentIds: string[] }) => boolean;
  let at: (da: number, db: number) => RawConfig;
  let twoD: boolean;
  if ("part" in target) {
    const components: RawConfig[] = config.components ?? [];
    const original = components.find((c) => c.id === target.part);
    if (!original) return null;
    const axes: Axes = "wall" in original ? ["at", "z"] : "x" in original ? ["x", "y"] : ["u", "v"];
    own = (issue) => issue.componentIds.includes(target.part);
    at = (da, db) => ({ ...config, components: components.map((c) => (c.id === target.part ? moved(c, axes, da, db) : c)) });
    twoD = true;
  } else {
    const where = whereOf(target.path);
    if (!where) return null;
    const items = listOf(config, where);
    const item = items[where.index];
    const axes = item && axesOf(item, where.key);
    if (!item || !axes) return null;
    own = (issue) => issue.path === target.path || issue.path.startsWith(`${target.path}.`);
    at = (da, db) => withList(config, where, items.map((it, i) => (i === where.index ? moved(it, axes, da, db) : it)));
    twoD = axes[1] !== null;
  }
  const problems = (c: RawConfig) => {
    const result = validateConfig(c, { wiring: false });
    const errors = result.ok ? [] : result.errors;
    return { own: errors.filter(own).length, all: errors.length };
  };
  const start = problems(config);
  if (start.own === 0) return null;
  for (const [da, db] of fitOffsets(twoD)) {
    const candidate = at(da, db);
    const now = problems(candidate);
    if (now.own === 0 && now.all <= start.all - start.own) return candidate;
    yield Math.hypot(da, db);
  }
  return null;
}

// The search run to its end, all at once.
function finish(search: Generator<number, RawConfig | null>): RawConfig | null {
  for (;;) {
    const step = search.next();
    if (step.done) return step.value;
  }
}

export const nearestFit = (config: RawConfig, id: string) => finish(fitSearch(config, { part: id }));
export const nearestFitThing = (config: RawConfig, path: string) => finish(fitSearch(config, { path }));
