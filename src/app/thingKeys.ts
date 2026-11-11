// What the keys do to something selected in the view: the arrows nudge it, R turns it, Delete
// takes it away and Ctrl+D makes a copy beside it. Each works on a part by its id, or on anything
// else by its path in the config, such as `labels[0]` or `plate.feet[2]`. Each returns null where
// the key means nothing for that thing, such as turning a hole or deleting the walls.
import { textOutline } from "../lettering.js";
import { errorCount, tidy, unusedId, type RawConfig } from "./configEdit.js";

type Where = { key: string; plate: boolean; index: number };
type Axes = [string, string | null];

function whereOf(path: string): Where | null {
  const match = /^(plate\.)?(labels|wallHoles|vents|seams|feet|supports|pins|cableTies|countersunkHoles|weights)\[(\d+)\]$/.exec(path);
  if (!match) return null;
  const plate = Boolean(match[1]);
  // Labels, holes, vents and seams are top-level lists, the rest are on the plate.
  if (plate !== !["labels", "wallHoles", "vents", "seams"].includes(match[2]!)) return null;
  return { key: match[2]!, plate, index: Number(match[3]) };
}

function listOf(config: RawConfig, where: Where): RawConfig[] {
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
function axesOf(item: RawConfig, key: string): Axes | null {
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
function sizeOf(item: RawConfig, key: string): [number, number] {
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

// A copy of a part, with its knob, cap and labels, beside it. Its id is the next free one of its type.
export function duplicateComponent(config: RawConfig, id: string): { config: RawConfig; id: string } | null {
  const components: RawConfig[] = config.components ?? [];
  const original = components.find((c) => c.id === id);
  if (!original) return null;
  const axes: Axes = "wall" in original ? ["at", "z"] : "x" in original ? ["x", "y"] : ["u", "v"];
  const copyId = unusedId(config, original.type);
  const labels: RawConfig[] = config.labels ?? [];
  const copiedLabels = labels.filter((label) => label.component === id).map((label) => ({ ...label, component: copyId }));
  const next = besideOriginal(config, axes, (da, db) => ({
    ...config,
    components: [...components, { ...moved(original, axes, da, db), id: copyId }],
    ...(copiedLabels.length ? { labels: [...labels, ...copiedLabels] } : {}),
  }));
  return { config: next, id: copyId };
}
