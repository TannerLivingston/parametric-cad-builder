// Edits to the screws, as changes in the raw config. An automatic screw that moves becomes a
// removal plus an addition, and nothing is written unless something has changed.
import { validateConfig, type FastenerEdge, type PlannedFastener, type PlannedFasteners } from "../validate.js";
import { tidy, type RawConfig } from "./configEdit.js";

const SPOT_STEP = 4;
const MIN_ROOM = 20; // the closest a new screw starts to another, so that it doesn't replace one

type Changes = { add?: any[]; remove?: any[] };

const plannedOf = (config: RawConfig): PlannedFasteners | undefined => {
  const result = validateConfig(config, { wiring: false });
  return result.ok ? result.plan.fasteners : result.fasteners;
};

function changesOf(config: RawConfig, surface: string | null): Changes {
  const owner = surface === null ? config.plate : (config.topPanels ?? []).find((panel: any) => panel.surface === surface);
  return owner?.fasteners ?? {};
}

function withChanges(config: RawConfig, surface: string | null, changes: Changes): RawConfig {
  const tidied: Changes = {};
  if (changes.add?.length) tidied.add = changes.add;
  if (changes.remove?.length) tidied.remove = changes.remove;
  const apply = (owner: any) => {
    const { fasteners: _, ...rest } = owner;
    return Object.keys(tidied).length ? { ...rest, fasteners: tidied } : rest;
  };
  if (surface !== null) return { ...config, topPanels: (config.topPanels ?? []).map((panel: any) => (panel.surface === surface ? apply(panel) : panel)) };
  const plate = apply(config.plate ?? {});
  if (Object.keys(plate).length) return { ...config, plate };
  const { plate: _, ...rest } = config;
  return rest;
}

const pathOf = (surface: string | null, config: RawConfig, index: number) =>
  surface === null ? `plate.fasteners.add[${index}]` : `topPanels[${(config.topPanels ?? []).findIndex((p: any) => p.surface === surface)}].fasteners.add[${index}]`;

const atOf = (wall: string, x: number, y: number) => (wall === "left" || wall === "right" ? y : x);

// A change's entry for a screw at this spot.
function spotFor(item: Pick<PlannedFastener, "kind" | "wall">, x: number, y: number) {
  return item.kind === "plate" ? { x: tidy(x), y: tidy(y) } : { wall: item.wall, at: tidy(atOf(item.wall!, x, y)) };
}

export function moveFastener(config: RawConfig, item: PlannedFastener, x: number, y: number): { config: RawConfig; id: string } {
  const changes = changesOf(config, item.surface);
  const add = [...(changes.add ?? [])];
  const spot = spotFor(item, x, y);
  if (item.addedAt !== null) {
    add[item.addedAt] = spot;
    return { config: withChanges(config, item.surface, { ...changes, add }), id: pathOf(item.surface, config, item.addedAt) };
  }
  add.push(spot);
  const remove = [...(changes.remove ?? []), spotFor(item, item.x, item.y)];
  return { config: withChanges(config, item.surface, { add, remove }), id: pathOf(item.surface, config, add.length - 1) };
}

export function removeFastener(config: RawConfig, item: PlannedFastener): RawConfig {
  const changes = changesOf(config, item.surface);
  if (item.addedAt !== null) {
    return withChanges(config, item.surface, { ...changes, add: (changes.add ?? []).filter((_, i) => i !== item.addedAt) });
  }
  return withChanges(config, item.surface, { ...changes, remove: [...(changes.remove ?? []), spotFor(item, item.x, item.y)] });
}

export function restoreRemoved(config: RawConfig, surface: string | null, index: number): RawConfig {
  const changes = changesOf(config, surface);
  return withChanges(config, surface, { ...changes, remove: (changes.remove ?? []).filter((_, i) => i !== index) });
}

export function resetFasteners(config: RawConfig, surface: string | null): RawConfig {
  return withChanges(config, surface, {});
}

export function removedFasteners(config: RawConfig, surface: string | null): any[] {
  return changesOf(config, surface).remove ?? [];
}

export function hasFastenerChanges(config: RawConfig): boolean {
  const owners = [config.plate, ...(config.topPanels ?? [])];
  return owners.some((owner) => owner?.fasteners?.add?.length || owner?.fasteners?.remove?.length);
}

// Spots along an edge, from the middle of its widest gap outwards.
function candidates(edge: FastenerEdge, taken: PlannedFastener[]): number[] {
  const position = (f: PlannedFastener) => (edge.along === "x" ? f.x : f.y);
  const across = (f: PlannedFastener) => (edge.along === "x" ? f.y : f.x);
  const held = taken.filter((f) => Math.abs(across(f) - edge.fixed) < MIN_ROOM).map(position);
  const stops = [edge.from, ...held.filter((p) => p > edge.from && p < edge.to), edge.to].sort((a, b) => a - b);
  let middle = edge.from;
  let widest = -1;
  for (let i = 0; i < stops.length - 1; i++) {
    if (stops[i + 1]! - stops[i]! > widest) {
      widest = stops[i + 1]! - stops[i]!;
      middle = (stops[i]! + stops[i + 1]!) / 2;
    }
  }
  const spots: number[] = [];
  for (let offset = 0; offset <= edge.to - edge.from; offset += SPOT_STEP) {
    for (const sign of offset === 0 ? [1] : [1, -1]) {
      const spot = middle + sign * offset;
      if (spot >= edge.from && spot <= edge.to && !held.some((p) => Math.abs(p - spot) < MIN_ROOM)) spots.push(spot);
    }
  }
  return spots;
}

// Adds a screw at the first good spot, trying the barest edge first. Null if there isn't one.
export function addFastener(config: RawConfig, planned: PlannedFasteners, surface: string | null): { config: RawConfig; id: string } | null {
  const kind = surface === null ? "plate" : "top";
  const taken = planned.items.filter((f) => f.kind === kind && f.surface === surface);
  const edges = planned.edges.filter((edge) => edge.kind === kind && edge.surface === surface);
  const widestFirst = edges
    .map((edge) => ({ edge, spots: candidates(edge, taken) }))
    .sort((a, b) => b.spots.length - a.spots.length);
  const changes = changesOf(config, surface);
  const index = changes.add?.length ?? 0;
  const id = pathOf(surface, config, index);
  for (const { edge, spots } of widestFirst) {
    for (const spot of spots) {
      const x = edge.along === "x" ? spot : edge.fixed;
      const y = edge.along === "x" ? edge.fixed : spot;
      const entry = spotFor({ kind, wall: edge.wall }, x, y);
      const next = withChanges(config, surface, { ...changes, add: [...(changes.add ?? []), entry] });
      if (plannedOf(next)?.items.find((f) => f.id === id)?.problem === null) return { config: next, id };
    }
  }
  return null;
}
