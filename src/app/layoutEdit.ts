// Placing parts relative to each other. These only write positions, so the validator still says
// whether the result fits.
import { tidy, type RawComponent, type RawConfig } from "./configEdit.js";

export const MAX_COPIES = 100;

const componentsOf = (config: RawConfig): RawComponent[] => config.components ?? [];
const onFloor = (component: RawComponent) => "x" in component;
const inWall = (component: RawComponent) => "wall" in component;
const along = (component: RawComponent) => (inWall(component) ? "at" : onFloor(component) ? "x" : "u");
const across = (component: RawComponent) => (inWall(component) ? "z" : onFloor(component) ? "y" : "v");

// "button-1" gives "button-2" and so on, keeping to the numbering it already has.
export function unusedIds(config: RawConfig, id: string, count: number): string[] {
  const base = id.replace(/-\d+$/, "");
  const taken = new Set(componentsOf(config).map((component) => component.id));
  const ids: string[] = [];
  for (let n = 1; ids.length < count; n++) {
    const candidate = `${base}-${n}`;
    if (!taken.has(candidate)) ids.push(candidate);
  }
  return ids;
}

export function arrayComponent(config: RawConfig, id: string, { columns, rows, stepAlong, stepAcross }: { columns: number; rows: number; stepAlong: number; stepAcross: number }): { config: RawConfig; ids: string[] } {
  const source = componentsOf(config).find((component) => component.id === id);
  if (!source) return { config, ids: [] };
  const across_ = Math.max(1, Math.min(Math.floor(rows), MAX_COPIES));
  const along_ = Math.max(1, Math.min(Math.floor(columns), Math.floor(MAX_COPIES / across_)));
  const count = along_ * across_ - 1;
  const ids = unusedIds(config, id, count);
  const copies: RawComponent[] = [];
  for (let row = 0; row < across_; row++) {
    for (let column = 0; column < along_; column++) {
      if (row === 0 && column === 0) continue;
      copies.push({
        ...source,
        id: ids[copies.length]!,
        [along(source)]: tidy(source[along(source)] + column * stepAlong),
        [across(source)]: tidy(source[across(source)] + row * stepAcross),
      });
    }
  }
  return { config: { ...config, components: [...componentsOf(config), ...copies] }, ids };
}

// A copy on the other side of the enclosure's centre, turned to match.
export function mirrorComponent(config: RawConfig, id: string): { config: RawConfig; id: string } | null {
  const source = componentsOf(config).find((component) => component.id === id);
  const width = config.enclosure?.width;
  if (!source || typeof width !== "number") return null;
  const [copyId] = unusedIds(config, id, 1);
  const rotation = (360 - (source.rotationDeg ?? 0)) % 360;
  const sideWall = source.wall === "left" || source.wall === "right";
  // A part on a side wall goes across to the other one. On the rest, it's just further along.
  const copy: RawComponent = sideWall ? { ...source, id: copyId!, wall: source.wall === "left" ? "right" : "left" } : { ...source, id: copyId!, [along(source)]: tidy(width - source[along(source)]) };
  if (rotation) copy.rotationDeg = rotation;
  else delete copy.rotationDeg;
  return { config: { ...config, components: [...componentsOf(config), copy] }, id: copyId! };
}

export function centreComponent(config: RawConfig, id: string): RawConfig {
  const width = config.enclosure?.width;
  if (typeof width !== "number") return config;
  const depth = config.enclosure?.surfaces?.at?.(-1)?.y;
  const middle = (component: RawComponent) => ((component.wall === "left" || component.wall === "right") && typeof depth === "number" ? depth : width) / 2;
  return { ...config, components: componentsOf(config).map((component) => (component.id === id ? { ...component, [along(component)]: tidy(middle(component)) } : component)) };
}

// The parts this one can line up with, which share its surface, or the floor.
export function alignableWith(config: RawConfig, id: string): string[] {
  const source = componentsOf(config).find((component) => component.id === id);
  if (!source) return [];
  return componentsOf(config)
    .filter((other) => other.id !== id && inWall(other) === inWall(source) && other.wall === source.wall && onFloor(other) === onFloor(source) && (onFloor(source) || other.surface === source.surface))
    .map((other) => other.id);
}

// Puts it in the same row, or the same column, as another.
export function alignComponent(config: RawConfig, id: string, targetId: string, direction: "row" | "column"): RawConfig {
  const target = componentsOf(config).find((component) => component.id === targetId);
  if (!target) return config;
  const key = direction === "row" ? across(target) : along(target);
  return { ...config, components: componentsOf(config).map((component) => (component.id === id ? { ...component, [key]: target[key] } : component)) };
}

// Several parts at once. The first is the one they line up with.

// All of them into the first one's row, or column, where they share its surface, wall or the floor.
export function lineUpGroup(config: RawConfig, ids: string[], direction: "row" | "column"): RawConfig {
  const [first, ...rest] = ids;
  if (!first) return config;
  const alike = new Set(alignableWith(config, first));
  return rest.filter((id) => alike.has(id)).reduce((next, id) => alignComponent(next, id, first, direction), config);
}

// Equal gaps between their centres along the row, from the first to the last as they sit now, for
// those that share the first one's surface, wall or the floor. Three at least, or there's nothing to even.
export function spaceEvenly(config: RawConfig, ids: string[]): RawConfig {
  const [first] = ids;
  if (!first) return config;
  const alike = new Set([first, ...alignableWith(config, first)]);
  const members = componentsOf(config).filter((component) => ids.includes(component.id) && alike.has(component.id));
  if (members.length < 3) return config;
  const key = along(members[0]!);
  const sorted = [...members].sort((a, b) => a[key] - b[key]);
  const start = sorted[0]![key];
  const step = (sorted.at(-1)![key] - start) / (sorted.length - 1);
  const placed = new Map(sorted.map((component, i) => [component.id, tidy(start + i * step)]));
  return { ...config, components: componentsOf(config).map((component) => (placed.has(component.id) ? { ...component, [key]: placed.get(component.id) } : component)) };
}
