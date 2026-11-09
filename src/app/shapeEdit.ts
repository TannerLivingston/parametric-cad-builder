// Edits behind the Shape tab and the custom part form. Each one changes the raw config, the
// same as typing it in, so the validator stays the only judge of what's possible.
import { configSchema, partSchema, type Config, type Footprint, type Part } from "../schema.js";
import { partsOf, tidy, type RawConfig } from "./configEdit.js";
import { validateConfig } from "../validate.js";
import { cableTieSpots } from "../wiring.js";

// A plain box with a separate top, which needs no supports: the shell prints upright, open at
// the top, and the top prints face down.
export function newEnclosure(): RawConfig {
  return {
    schemaVersion: 1,
    name: "My enclosure",
    enclosure: {
      width: 150,
      frontHeight: 40,
      surfaces: [{ id: "top", y: 100, z: 40 }],
      wall: 2.4,
      floorThickness: 2.4,
    },
    topPanels: [{ surface: "top" }],
    components: [],
  };
}

const DEFAULTS = configSchema.parse({
  schemaVersion: 1,
  name: "defaults",
  enclosure: { width: 1, frontHeight: 1, surfaces: [{ id: "a", y: 1, z: 1 }] },
});

// What a top panel is unless it says otherwise. Every select needs a value, or React stops
// setting it, and it shows what was picked last even after Undo takes it back.
const { surface: _surface, fasteners: _fasteners, ...TOP_PANEL_DEFAULTS } = configSchema.shape.topPanels.parse([{ surface: "a" }])[0]!;
export const DEFAULT_TOP_COLOR = TOP_PANEL_DEFAULTS.color;
const { x: _x, ...SEAM_DEFAULTS } = configSchema.shape.seams.parse([{ x: 1 }])[0]!;

export type ShapeValues = Pick<Config, "topPanels" | "seams" | "wallHoles" | "opening"> & {
  enclosure: Config["enclosure"];
  fabrication: Config["fabrication"];
  plate: Config["plate"];
};

// What the form shows: the config with its defaults filled in, without writing them to the file.
export function shapeValues(config: RawConfig): ShapeValues {
  const e = config.enclosure ?? {};
  const fabrication = config.fabrication ?? {};
  return {
    enclosure: {
      ...DEFAULTS.enclosure,
      ...e,
      surfaces: e.surfaces ?? [],
      rounds: { ...DEFAULTS.enclosure.rounds, ...e.rounds },
    },
    fabrication: {
      ...DEFAULTS.fabrication,
      ...fabrication,
      buildVolume: { ...DEFAULTS.fabrication.buildVolume, ...fabrication.buildVolume },
    },
    topPanels: (config.topPanels ?? []).map((panel: RawConfig) => ({ ...TOP_PANEL_DEFAULTS, ...panel })),
    seams: (config.seams ?? []).map((seam: RawConfig) => ({ ...SEAM_DEFAULTS, ...seam })),
    wallHoles: (config.wallHoles ?? []).map((hole: RawConfig) => ({ cornerRadius: 0, ...hole })),
    opening: config.opening ? { keepOut: [], ...config.opening } : undefined,
    plate: { ...DEFAULTS.plate, ...config.plate },
  };
}

const tidied = (patch: RawConfig) => Object.fromEntries(Object.entries(patch).map(([k, v]) => [k, typeof v === "number" ? tidy(v) : v]));

export function updateEnclosure(config: RawConfig, patch: RawConfig): RawConfig {
  return { ...config, enclosure: { ...config.enclosure, ...tidied(patch) } };
}

// A round of 0 is the same as none, so it leaves the file.
export function setRound(config: RawConfig, key: "frontBottom" | "rearTop" | "rearBottom", radius: number): RawConfig {
  const { rounds = {}, ...enclosure } = config.enclosure ?? {};
  const { [key]: _old, ...others } = rounds;
  const next = radius > 0 ? { ...others, [key]: tidy(radius) } : others;
  return { ...config, enclosure: Object.keys(next).length ? { ...enclosure, rounds: next } : enclosure };
}

export function updateFabrication(config: RawConfig, patch: RawConfig): RawConfig {
  return { ...config, fabrication: { ...config.fabrication, ...patch } };
}

export function setBed(config: RawConfig, axis: "x" | "y" | "z", size: number): RawConfig {
  const { buildVolume } = shapeValues(config).fabrication;
  return updateFabrication(config, { buildVolume: { ...buildVolume, [axis]: tidy(size) } });
}

export function updateSurface(config: RawConfig, id: string, patch: { y?: number; z?: number }): RawConfig {
  const surfaces = (config.enclosure?.surfaces ?? []).map((s: RawConfig) => (s.id === id ? { ...s, ...tidied(patch) } : s));
  return updateEnclosure(config, { surfaces });
}

// Parts and top panels follow the new name. A name that's empty or taken changes nothing.
export function renameSurface(config: RawConfig, id: string, name: string): RawConfig {
  const next = name.trim();
  const surfaces: RawConfig[] = config.enclosure?.surfaces ?? [];
  if (!next || surfaces.some((s) => s.id === next)) return config;
  return {
    ...updateEnclosure(config, { surfaces: surfaces.map((s) => (s.id === id ? { ...s, id: next } : s)) }),
    ...(config.topPanels ? { topPanels: config.topPanels.map((p: RawConfig) => (p.surface === id ? { ...p, surface: next } : p)) } : {}),
    components: (config.components ?? []).map((c: RawConfig) => (c.surface === id ? { ...c, surface: next } : c)),
  };
}

function unusedSurfaceId(surfaces: RawConfig[]): string {
  for (let n = surfaces.length + 1; ; n++) {
    const id = `surface-${n}`;
    if (!surfaces.some((s) => s.id === id)) return id;
  }
}

const NEW_SURFACE_LENGTH = 40;
const NEW_SURFACE_DROP = 10;

// Adds a section behind the rear. It has to differ in slope from the one before it, or the
// two would be one surface, so it falls away from a flat one and levels off from a slope.
export function addSurface(config: RawConfig): RawConfig {
  const e = config.enclosure ?? {};
  const surfaces: RawConfig[] = e.surfaces ?? [];
  const last = surfaces.at(-1) ?? { y: 0, z: e.frontHeight ?? 0 };
  const lastStart = surfaces.at(-2)?.z ?? e.frontHeight ?? last.z;
  const z = last.z === lastStart ? Math.max(last.z - NEW_SURFACE_DROP, 1) : last.z;
  const added = { id: unusedSurfaceId(surfaces), y: tidy(last.y + NEW_SURFACE_LENGTH), z: tidy(z) };
  // A part can only leave out its surface while there's just one.
  const only = surfaces.length === 1 ? surfaces[0]!.id : undefined;
  return {
    ...updateEnclosure(config, { surfaces: [...surfaces, added] }),
    components: (config.components ?? []).map((c: RawConfig) => ("u" in c && c.surface === undefined && only ? { ...c, surface: only } : c)),
  };
}

// Parts on it stay where they are in the file, and the validator points them out, since only
// the user knows where they should go now. Its top panel has nothing left to cap.
export function removeSurface(config: RawConfig, id: string): RawConfig {
  const surfaces: RawConfig[] = config.enclosure?.surfaces ?? [];
  if (surfaces.length <= 1) return config;
  return setTopPanel(updateEnclosure(config, { surfaces: surfaces.filter((s) => s.id !== id) }), id, null);
}

// Null makes the surface part of the shell again.
export function setTopPanel(config: RawConfig, surface: string, patch: RawConfig | null): RawConfig {
  const { topPanels = [], ...rest } = config;
  const others = topPanels.filter((p: RawConfig) => p.surface !== surface);
  const current = topPanels.find((p: RawConfig) => p.surface === surface);
  const next = patch ? [...others, { surface, ...current, ...patch }] : others;
  // In surface order, so that the file and the part names don't depend on what was ticked first.
  const order: string[] = (config.enclosure?.surfaces ?? []).map((s: RawConfig) => s.id);
  next.sort((a: RawConfig, b: RawConfig) => order.indexOf(a.surface) - order.indexOf(b.surface));
  return next.length ? { ...rest, topPanels: next } : rest;
}

// "90, 180" to [90, 180], or null if any of it isn't a positive number.
export function parseSplits(text: string): number[] | null {
  const pieces = text.split(",").map((s) => s.trim()).filter(Boolean);
  const numbers = pieces.map(Number);
  return numbers.every((n) => Number.isFinite(n) && n > 0) ? numbers.map(tidy) : null;
}

// Null joins the halves. A new seam starts in the middle, and keeps its other settings if moved.
export function setSeam(config: RawConfig, x: number | null): RawConfig {
  const { seams = [], ...rest } = config;
  if (x === null) return rest;
  return { ...rest, seams: [{ ...seams[0], x: tidy(x) }] };
}

// Another seam, in the middle of the widest piece.
export function addSeam(config: RawConfig): RawConfig {
  const { enclosure: e } = shapeValues(config);
  const seams: RawConfig[] = config.seams ?? [];
  const bounds = [0, ...seams.map((seam) => seam.x as number).sort((a, b) => a - b), e.width];
  let widest = 0;
  for (let i = 1; i < bounds.length - 1; i++) if (bounds[i + 1]! - bounds[i]! > bounds[widest + 1]! - bounds[widest]!) widest = i;
  return { ...config, seams: [...seams, { x: tidy((bounds[widest]! + bounds[widest + 1]!) / 2) }] };
}

// A lip of 0 is the default, a flat joint, so it leaves the file.
export function updateSeam(config: RawConfig, index: number, change: { x?: number; lip?: number }): RawConfig {
  const seams: RawConfig[] = config.seams ?? [];
  if (!seams[index]) return config;
  const { lip: old = 0, ...seam }: RawConfig = { ...seams[index], ...(change.x !== undefined && { x: tidy(change.x) }) };
  const lip = change.lip ?? old;
  return { ...config, seams: seams.map((old, i) => (i === index ? (lip > 0 ? { ...seam, lip: tidy(lip) } : seam) : old)) };
}

export function setSeamLip(config: RawConfig, lip: number, index = 0): RawConfig {
  return updateSeam(config, index, { lip });
}

// Taking away the last seam joins the shell again.
export function removeSeam(config: RawConfig, index: number): RawConfig {
  const { seams = [], ...rest } = config;
  const left = seams.filter((_: RawConfig, i: number) => i !== index);
  return left.length ? { ...rest, seams: left } : rest;
}

export function addWallHole(config: RawConfig): RawConfig {
  const { enclosure: e } = shapeValues(config);
  const hole = { wall: "rear", at: tidy(e.width / 2), z: tidy(e.floorThickness + 10), width: 14, height: 8, cornerRadius: 2 };
  return { ...config, wallHoles: [...(config.wallHoles ?? []), hole] };
}

export function updateWallHole(config: RawConfig, index: number, patch: RawConfig): RawConfig {
  return { ...config, wallHoles: (config.wallHoles ?? []).map((hole: RawConfig, i: number) => (i === index ? { ...hole, ...tidied(patch) } : hole)) };
}

export function removeWallHole(config: RawConfig, index: number): RawConfig {
  const { wallHoles = [], ...rest } = config;
  const next = wallHoles.filter((_: RawConfig, i: number) => i !== index);
  return next.length ? { ...rest, wallHoles: next } : rest;
}

// What the custom part form can describe: one hole with a body above and below it, or a board on
// the floor. Anything more, such as a pocket or a row of holes, is edited in the Config tab.
export interface PartDraft {
  name: string;
  source: Part["source"];
  mount: "panel" | "floor";
  hole: Footprint;
  holeAt: [number, number]; // from the part's centre
  moreHoles: { hole: Footprint; at: [number, number] }[];
  above: Footprint;
  aboveHeight: number;
  below: Footprint;
  belowDepth: number;
  footprint: Footprint;
  height: number;
}

export function newPartDraft(): PartDraft {
  return {
    name: "",
    source: "estimated",
    mount: "panel",
    hole: { shape: "circle", diameter: 12 },
    holeAt: [0, 0],
    moreHoles: [],
    above: { shape: "circle", diameter: 16 },
    aboveHeight: 5,
    below: { shape: "circle", diameter: 14 },
    belowDepth: 15,
    footprint: { shape: "rect", width: 30, height: 20 },
    height: 10,
  };
}

// Null if the form can't show this part without losing something.
export function draftFromPart(raw: unknown): PartDraft | null {
  const parsed = partSchema.safeParse(raw);
  if (!parsed.success) return null;
  const part = parsed.data;
  if (part.mount === "wall") return null; // Only in the Config tab, for now.
  const blank = newPartDraft();
  const common = { ...blank, name: part.name, source: part.source, mount: part.mount };
  if (part.mount === "floor") return { ...common, footprint: part.footprint, height: part.height };
  const plain = part.cutouts.flatMap((cutout) => {
    if (cutout.kind !== "pocket" && cutout.notches?.length) return [];
    if (cutout.kind === "circle") return [{ hole: { shape: "circle", diameter: cutout.diameter } as Footprint, at: cutout.at as [number, number] }];
    if (cutout.kind === "rect" && !cutout.recess && cutout.cornerRadius === 0) return [{ hole: { shape: "rect", width: cutout.width, height: cutout.height } as Footprint, at: cutout.at as [number, number] }];
    return [];
  });
  if (plain.length !== part.cutouts.length) return null;
  const [first, ...more] = plain;
  return {
    ...common,
    hole: first!.hole,
    holeAt: first!.at,
    moreHoles: more,
    above: part.above.footprint,
    aboveHeight: part.above.height,
    below: part.below.footprint,
    belowDepth: part.below.depth,
  };
}

const cutoutFrom = (hole: Footprint, at: [number, number]) => ({
  ...(hole.shape === "circle" ? { kind: "circle", diameter: hole.diameter } : { kind: "rect", width: hole.width, height: hole.height }),
  ...(at[0] || at[1] ? { at } : {}),
});

// Keeps what the form doesn't show, such as a board's port or a panel part's posts.
export function partFromDraft(draft: PartDraft, existing?: Part): { ok: true; part: Part } | { ok: false; message: string } {
  const base = { name: draft.name.trim(), source: draft.source };
  const kept = existing?.mount === draft.mount ? existing : {};
  const raw =
    draft.mount === "floor"
      ? { ...kept, ...base, mount: "floor", footprint: draft.footprint, height: draft.height }
      : {
          ...kept,
          ...base,
          mount: "panel",
          cutouts: [cutoutFrom(draft.hole, draft.holeAt), ...draft.moreHoles.map(({ hole, at }) => cutoutFrom(hole, at))],
          above: { footprint: draft.above, height: draft.aboveHeight },
          below: { footprint: draft.below, depth: draft.belowDepth },
        };
  if (!base.name) return { ok: false, message: "Give the part a name." };
  const parsed = partSchema.safeParse(raw);
  return parsed.success ? { ok: true, part: parsed.data } : { ok: false, message: "Every size has to be more than 0, and heights can't be negative." };
}

function partIdFor(config: RawConfig, name: string): string {
  const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "part";
  const taken = partsOf(config);
  if (!taken[slug]) return slug;
  for (let n = 2; ; n++) {
    if (!taken[`${slug}-${n}`]) return `${slug}-${n}`;
  }
}

// Parsing fills in defaults, and those stay out of the file like everywhere else.
function withoutDefaults(part: Part): RawConfig {
  const { notes, ...rest } = part as RawConfig;
  const raw: RawConfig = { ...rest, ...(notes ? { notes } : {}) };
  if (raw.mount === "panel") {
    if (!raw.posts?.length) delete raw.posts;
    raw.cutouts = raw.cutouts.map((cutout: RawConfig) => {
      const { at, cornerRadius, ...others } = cutout;
      return { ...others, ...(at && (at[0] || at[1]) ? { at } : {}), ...(cornerRadius ? { cornerRadius } : {}) };
    });
  }
  return raw;
}

export function addCustomPart(config: RawConfig, part: Part): { config: RawConfig; id: string } {
  const id = partIdFor(config, part.name);
  return { config: { ...config, customParts: { ...config.customParts, [id]: withoutDefaults(part) } }, id };
}

export function updateCustomPart(config: RawConfig, id: string, part: Part): RawConfig {
  return { ...config, customParts: { ...config.customParts, [id]: withoutDefaults(part) } };
}

// Takes its placed copies with it, since nothing else could describe them. Undo brings them back.
export function removeCustomPart(config: RawConfig, id: string): RawConfig {
  const { customParts = {}, ...rest } = config;
  const { [id]: _removed, ...others } = customParts;
  return {
    ...rest,
    ...(Object.keys(others).length ? { customParts: others } : {}),
    components: (config.components ?? []).filter((c: RawConfig) => c.type !== id),
  };
}

// An opening starts in the middle of the front, reaching halfway back. What it holds is up to the
// user, who says how much room that needs, so it starts with none reserved.
export function setOpening(config: RawConfig, on: boolean): RawConfig {
  const { opening: _old, ...rest } = config;
  if (!on) return rest;
  const { enclosure: e } = shapeValues(config);
  const depth = e.surfaces.at(-1)?.y ?? 0;
  return { ...rest, opening: { xMin: tidy(e.width / 4), xMax: tidy((e.width * 3) / 4), yEnd: tidy(depth / 2), sill: tidy(e.frontHeight / 3) } };
}

export function updateOpening(config: RawConfig, patch: RawConfig): RawConfig {
  return { ...config, opening: { ...config.opening, ...tidied(patch) } };
}

const NEW_RAIL_DEPTH = 14;
const NEW_RAIL_FOOT_HEIGHT = 2;
const NEW_RAIL_SCREW_OFFSET = 8;

// A rail closes the front of the opening below the sill, with a screw on each side of it. It has
// to reach past a front round, so it starts deep enough for one.
export function setRail(config: RawConfig, on: boolean): RawConfig {
  const { rail: _old, ...opening } = config.opening ?? {};
  if (!on) return { ...config, opening };
  const { enclosure: e } = shapeValues(config);
  const rail = {
    depth: Math.max(NEW_RAIL_DEPTH, e.rounds.frontBottom + 2),
    footHeight: NEW_RAIL_FOOT_HEIGHT,
    screwX: [tidy(opening.xMin - NEW_RAIL_SCREW_OFFSET), tidy(opening.xMax + NEW_RAIL_SCREW_OFFSET)],
  };
  return { ...config, opening: { ...opening, rail } };
}

export function updateRail(config: RawConfig, patch: RawConfig): RawConfig {
  return updateOpening(config, { rail: { ...config.opening?.rail, ...tidied(patch) } });
}

export function setRailScrew(config: RawConfig, side: 0 | 1, x: number): RawConfig {
  const screwX = [...(config.opening?.rail?.screwX ?? [0, 0])];
  screwX[side] = tidy(x);
  return updateRail(config, { screwX });
}

// The room the opening's contents take inside, across the whole opening up to the sill to begin
// with. Only the user knows the real shape.
export function addReservedRoom(config: RawConfig): RawConfig {
  const { enclosure: e } = shapeValues(config);
  const opening = config.opening ?? {};
  const box = { xMin: opening.xMin, xMax: opening.xMax, yMin: e.wall, yMax: opening.yEnd, top: opening.sill };
  return updateOpening(config, { keepOut: [...(opening.keepOut ?? []), box] });
}

export function updateReservedRoom(config: RawConfig, index: number, patch: RawConfig): RawConfig {
  const keepOut = (config.opening?.keepOut ?? []).map((box: RawConfig, i: number) => (i === index ? { ...box, ...tidied(patch) } : box));
  return updateOpening(config, { keepOut });
}

export function removeReservedRoom(config: RawConfig, index: number): RawConfig {
  const { keepOut = [], ...opening } = config.opening ?? {};
  const next = keepOut.filter((_: RawConfig, i: number) => i !== index);
  return { ...config, opening: next.length ? { ...opening, keepOut: next } : opening };
}

// Anything left empty leaves the file, so the plate's defaults stay in charge.
function updatePlate(config: RawConfig, patch: RawConfig): RawConfig {
  const { plate = {}, ...rest } = config;
  const next: RawConfig = { ...plate, ...patch };
  for (const [key, value] of Object.entries(next)) {
    if (value === undefined || (Array.isArray(value) && value.length === 0)) delete next[key];
  }
  return Object.keys(next).length ? { ...rest, plate: next } : rest;
}

// Null, or none, goes back to choosing them automatically. One joint is kept as a number.
export function setPlateSplit(config: RawConfig, x: number | number[] | null): RawConfig {
  const joints = [x ?? []].flat().map(tidy).sort((a, b) => a - b);
  return updatePlate(config, { seamX: joints.length === 0 ? undefined : joints.length === 1 ? joints[0] : joints });
}

// Shift registers on a board of your own, for the pin count. None is the default, so it leaves the file.
// Wiring's defaults leave the file, and the section with them when nothing else is in it.
function updateWiring(config: RawConfig, patch: RawConfig): RawConfig {
  const { wiring = {}, ...rest } = config;
  const next = Object.fromEntries(Object.entries({ ...wiring, ...patch }).filter(([, value]) => value !== undefined));
  return Object.keys(next).length ? { ...rest, wiring: next } : rest;
}

export function setShiftRegisters(config: RawConfig, count: number): RawConfig {
  const n = Math.max(0, Math.round(count));
  return updateWiring(config, { shiftRegisters: n || undefined });
}

// Whether to warn about room for wires and their ways across the floor. On is the default.
export function setWiringChecks(config: RawConfig, on: boolean): RawConfig {
  return updateWiring(config, { checks: on ? undefined : false });
}

// Cable tie bridges along the wires' routes, as the validator lays them out, keeping only those it
// accepts where they are, beside any already there.
export function tiesAlongWires(config: RawConfig): RawConfig {
  const result = validateConfig(config);
  if (!result.ok) return config;
  const existing: RawConfig[] = config.plate?.cableTies ?? [];
  const spots = cableTieSpots(result.plan.wiring.routes).filter((spot) => !existing.some((tie) => Math.hypot(tie.x - spot.x, tie.y - spot.y) < 15));
  let next = spots.length ? updatePlate(config, { cableTies: [...existing, ...spots] }) : config;
  // Each pass drops those the validator rejects, since one can only clash with another that's already in.
  for (let pass = 0; pass < spots.length; pass++) {
    const check = validateConfig(next, { wiring: false });
    if (check.ok) break;
    const bad = new Set(check.errors.flatMap((issue) => /^plate\.cableTies\[(\d+)\]$/.exec(issue.path)?.[1] ?? []).map(Number).filter((i: number) => i >= existing.length));
    if (bad.size === 0) break;
    next = updatePlate(next, { cableTies: next.plate.cableTies.filter((_: RawConfig, i: number) => !bad.has(i)) });
  }
  return next;
}

// A flat joint is the default, so it leaves the file.
export function setPlateJoint(config: RawConfig, joint: "flat" | "rib"): RawConfig {
  return updatePlate(config, { joint: joint === "flat" ? undefined : joint });
}

function plateCentre(config: RawConfig) {
  const { enclosure: e } = shapeValues(config);
  return { x: tidy(e.width / 2), y: tidy((e.surfaces.at(-1)?.y ?? 0) / 2) };
}

export function addPlateHole(config: RawConfig): RawConfig {
  return updatePlate(config, { countersunkHoles: [...(config.plate?.countersunkHoles ?? []), plateCentre(config)] });
}

export function updatePlateHole(config: RawConfig, index: number, patch: RawConfig): RawConfig {
  return updatePlate(config, { countersunkHoles: config.plate.countersunkHoles.map((hole: RawConfig, i: number) => (i === index ? { ...hole, ...tidied(patch) } : hole)) });
}

export function removePlateHole(config: RawConfig, index: number): RawConfig {
  return updatePlate(config, { countersunkHoles: config.plate.countersunkHoles.filter((_: RawConfig, i: number) => i !== index) });
}

const NEW_PIN = { diameter: 3.7, height: 4 };

export function addSupport(config: RawConfig): RawConfig {
  return updatePlate(config, { supports: [...(config.plate?.supports ?? []), plateCentre(config)] });
}

export function updateSupport(config: RawConfig, index: number, patch: RawConfig): RawConfig {
  return updatePlate(config, { supports: config.plate.supports.map((support: RawConfig, i: number) => (i === index ? { ...support, ...tidied(patch) } : support)) });
}

export function removeSupport(config: RawConfig, index: number): RawConfig {
  return updatePlate(config, { supports: config.plate.supports.filter((_: RawConfig, i: number) => i !== index) });
}

export function addWeight(config: RawConfig): RawConfig {
  return updatePlate(config, { weights: [...(config.plate?.weights ?? []), { ...plateCentre(config), width: 40, depth: 20 }] });
}

export function updateWeight(config: RawConfig, index: number, patch: RawConfig): RawConfig {
  return updatePlate(config, { weights: config.plate.weights.map((weight: RawConfig, i: number) => (i === index ? { ...weight, ...tidied(patch) } : weight)) });
}

export function removeWeight(config: RawConfig, index: number): RawConfig {
  return updatePlate(config, { weights: config.plate.weights.filter((_: RawConfig, i: number) => i !== index) });
}

export function addFoot(config: RawConfig): RawConfig {
  return updatePlate(config, { feet: [...(config.plate?.feet ?? []), plateCentre(config)] });
}

export function updateFoot(config: RawConfig, index: number, patch: RawConfig): RawConfig {
  return updatePlate(config, { feet: config.plate.feet.map((foot: RawConfig, i: number) => (i === index ? { ...foot, ...tidied(patch) } : foot)) });
}

export function removeFoot(config: RawConfig, index: number): RawConfig {
  return updatePlate(config, { feet: config.plate.feet.filter((_: RawConfig, i: number) => i !== index) });
}

// Four feet, one in from each corner of the plate, clear of the screws round its edge.
export const FOOT_CORNER_INSET = 20;
export function feetAtCorners(config: RawConfig): RawConfig {
  const { enclosure: e } = shapeValues(config);
  const depth = e.surfaces.at(-1)?.y ?? 0;
  const front = Math.max(e.rounds.frontBottom, e.wall);
  const rear = depth - Math.max(e.rounds.rearBottom, e.wall);
  const xs = [e.wall + FOOT_CORNER_INSET, e.width - e.wall - FOOT_CORNER_INSET];
  const ys = [front + FOOT_CORNER_INSET, rear - FOOT_CORNER_INSET];
  return updatePlate(config, { feet: ys.flatMap((y) => xs.map((x) => ({ x: tidy(x), y: tidy(y) }))) });
}

export function addCableTie(config: RawConfig): RawConfig {
  return updatePlate(config, { cableTies: [...(config.plate?.cableTies ?? []), plateCentre(config)] });
}

export function updateCableTie(config: RawConfig, index: number, patch: RawConfig): RawConfig {
  return updatePlate(config, { cableTies: config.plate.cableTies.map((tie: RawConfig, i: number) => (i === index ? { ...tie, ...tidied(patch) } : tie)) });
}

export function removeCableTie(config: RawConfig, index: number): RawConfig {
  return updatePlate(config, { cableTies: config.plate.cableTies.filter((_: RawConfig, i: number) => i !== index) });
}

export function addVent(config: RawConfig): RawConfig {
  const { enclosure: e } = shapeValues(config);
  const vent = { wall: "rear", at: tidy(e.width / 2), z: tidy(e.floorThickness + 12), width: 40, height: 12 };
  return { ...config, vents: [...(config.vents ?? []), vent] };
}

export function updateVent(config: RawConfig, index: number, patch: RawConfig): RawConfig {
  return { ...config, vents: (config.vents ?? []).map((vent: RawConfig, i: number) => (i === index ? { ...vent, ...tidied(patch) } : vent)) };
}

export function removeVent(config: RawConfig, index: number): RawConfig {
  const { vents = [], ...rest } = config;
  const next = vents.filter((_: RawConfig, i: number) => i !== index);
  return next.length ? { ...rest, vents: next } : rest;
}

export function addPlatePin(config: RawConfig): RawConfig {
  return updatePlate(config, { pins: [...(config.plate?.pins ?? []), { ...plateCentre(config), ...NEW_PIN }] });
}

// A tip of undefined leaves the file.
export function updatePlatePin(config: RawConfig, index: number, patch: RawConfig): RawConfig {
  const pins = config.plate.pins.map((pin: RawConfig, i: number) => {
    if (i !== index) return pin;
    const next: RawConfig = { ...pin, ...tidied(patch) };
    for (const key of Object.keys(next)) if (next[key] === undefined) delete next[key];
    return next;
  });
  return updatePlate(config, { pins });
}

export function removePlatePin(config: RawConfig, index: number): RawConfig {
  return updatePlate(config, { pins: config.plate.pins.filter((_: RawConfig, i: number) => i !== index) });
}
