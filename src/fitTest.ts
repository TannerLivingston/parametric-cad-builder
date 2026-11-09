// A small print with the design's real holes, posts and clips in a row of sizes, to find out
// what fits on this printer before printing the whole thing. It's planned from the design, so
// it only tests what's in it. Dots in the print say which is which: dots in the margin number
// the rows, and dots by each hole number the sizes.
//
// A row's sizes stay put when one is picked, so a print already made can still be read. They only
// move for a setting that isn't one of them, which is how to test further than a row goes.
import { BARB_REACH, CLIP_GAP, CLIP_THICKNESS } from "./fixtures.js";
import { library } from "./library.js";
import { BOSS_DIAMETER, INSERT_HOLE_DIAMETER, PIN_DIAMETER, PIN_SOCKET_DIAMETER, SCREW_CLEARANCE_DIAMETER } from "./plate.js";
import { orientationsFor, type Matrix } from "./printing.js";
import { tabSection } from "./profile.js";
import type { FloorPart, PanelPart, WallPart } from "./schema.js";
import type { BuildPlan } from "./validate.js";

export type FitSetting = "insertHole" | "insertHoleSideways" | "screwHole" | "clipGap" | "pinSocket" | "plateClearance" | "partHoles" | "wallHole" | "knobHole";
export type FitRowKind = "insert" | "insertSideways" | "screw" | "plate" | "seamPin" | "clip" | "part" | "wallHole" | "knob";

// A hole through a wall, as the shell prints it: through a flat wall on the bed, or across a
// standing one, where its width goes along the bed, or upwards if the shell is on its side.
export interface FitWallHole {
  width: number; // before any change
  height: number;
  cornerRadius: number;
  printed: "flat" | "standing" | "sideways";
  wall: number; // how thick
}

export interface FitStep {
  pips: number; // 0 if it's the only size in its row, so needs no telling apart
  value: number; // what to set, in the row's setting
  size: number; // what's cut, which for a part's hole adds its size to the setting
}

export interface FitRow {
  number: number;
  kind: FitRowKind;
  title: string;
  how: string;
  setting: FitSetting;
  parts: string[]; // the parts it decides, for a setting kept per part, or the holes in config.wallHoles
  current: number;
  steps: FitStep[];
  thickness: number; // of the row's base
  width: number;
  depth: number;
  pitch: number; // from one size to the next
  coupon: number;
  y: number;
  part: PanelPart | FloorPart | WallPart | null; // what's cut, for a row made from a part
  socketDepth?: number;
  wallHole?: FitWallHole;
  shaft?: { diameter: number; flat: number | null }; // a knob's, without the fit
}

// A corner of the shell cut out of the real part, printed the way the whole shell prints, to see
// how its walls and rounds come out before spending the filament on all of it.
export interface FitWallSection {
  part: number;
  x: [number, number];
  y: [number, number];
  z: [number, number];
  matrix: Matrix;
  wall: number;
}

export interface FitTestPlan {
  rows: FitRow[];
  coupons: number;
  plug: { width: number; depth: number; thickness: number } | null;
  pin: { diameter: number; length: number; width: number; thickness: number } | null;
  wallSection: FitWallSection | null;
  seamJoint: [FitWallSection, FitWallSection] | null; // both sides of one tab, to bolt together
  floorThickness: number;
  panelThickness: number;
  hardware: string[];
}

export const FIT_MARGIN = 10; // down the left, for the dots that number the rows
export const FIT_PIP_BAND = 5; // along the back of a row, for the dots that number the sizes
export const FIT_PLUG_WIDTH = 20;
export const FIT_PLUG_DEPTH = 10;
export const FIT_WALL_HEIGHT = 10; // above the base, for holes that print lying down
export const FIT_WALL_DEPTH = 9;
export const FIT_WALL_FRONT = 2; // from the front of its row
export const FIT_HOLE_PAD = 4; // of plastic around a part's holes
export const FIT_PIN_TAB = 14;
// Not a round number, because features land on round numbers, and a cut exactly along the edge of
// one leaves a corner of it only just touching.
export const FIT_SECTION_SIZE = 30.13;
const SECTION_PAD = 4.13;
export const SECTION_REACH = 20.13; // from a seam

const BED_MARGIN = 10;
const HOLE_STEPS = [-0.2, -0.1, 0, 0.1, 0.2];
const KNOB_HOLE_FIT = 0.1; // the default
export const KNOB_FIT_DEPTH = 8; // of shaft in each hole, enough to feel the fit
const KNOB_FIT_WALL = 2;
const PART_STEPS = [-0.15, 0, 0.15];
const NEIGHBOUR_STEPS = [-0.1, 0, 0.1];
const HOLE_PITCH = 12;
const PART_PAD = FIT_HOLE_PAD;
const WALL_HOLE_STEPS = [-0.2, 0, 0.2];
const LARGEST_WALL_HOLE = 40; // anything bigger doesn't fit anything closely
const MIN_PLATE_CLEARANCE = 0.05;
const USUAL_PLATE_CLEARANCE = 0.25;

const tidy = (value: number) => Math.round(value * 1000) / 1000;
const ladder = (usual: number, current: number, offsets: number[], size = (value: number) => value): FitStep[] => {
  const middle = offsets.some((offset) => Math.abs(usual + offset - current) < 0.0005) ? usual : current;
  return offsets.map((offset, i) => {
    const value = tidy(middle + offset);
    return { pips: i + 1, value, size: size(value) };
  });
};

export const FIT_PLUG_NAME = "Fit test plug";
export const FIT_PIN_NAME = "Fit test pin";
export const FIT_SECTION_NAME = "Wall section";
export const FIT_SEAM_NAMES = ["Seam joint, left", "Seam joint, right"] as const;
export const fitTestPieceName = (plan: Pick<FitTestPlan, "coupons">, coupon: number) => (plan.coupons > 1 ? `Fit test ${coupon + 1}` : "Fit test");

// In the order they're built and exported.
export function fitTestPieces(plan: FitTestPlan): string[] {
  return [
    ...Array.from({ length: plan.coupons }, (_, i) => fitTestPieceName(plan, i)),
    ...(plan.plug ? [FIT_PLUG_NAME] : []),
    ...(plan.pin ? [FIT_PIN_NAME] : []),
    ...(plan.wallSection ? [FIT_SECTION_NAME] : []),
    ...(plan.seamJoint ? FIT_SEAM_NAMES : []),
  ];
}

// What a size in a row is called.
export function fitStepSize(row: Pick<FitRow, "wallHole">, step: FitStep): string {
  if (!row.wallHole) return `${step.size} mm`;
  return `${tidy(row.wallHole.width + step.value)} x ${tidy(row.wallHole.height + step.value)} mm`;
}

// How far a part's holes and posts reach from its centre.
export function partHoleBounds(part: PanelPart) {
  const boxes = [
    ...part.cutouts.flatMap((cutout) => {
      const box = (at: readonly [number, number], w: number, h: number) => ({ xLow: at[0] - w / 2, xHigh: at[0] + w / 2, yLow: at[1] - h / 2, yHigh: at[1] + h / 2 });
      const notches = (list: { at: readonly [number, number]; width: number; height: number }[] | undefined) => (list ?? []).map((notch) => box(notch.at, notch.width, notch.height));
      if (cutout.kind === "circle") return [box(cutout.at, cutout.diameter, cutout.diameter), ...notches(cutout.notches)];
      const own = box(cutout.at, cutout.width, cutout.height);
      if (cutout.kind !== "rect") return [own];
      return [own, ...notches(cutout.notches), ...(cutout.recess ? [box(cutout.recess.at, cutout.recess.width, cutout.recess.height), ...notches(cutout.recess.notches)] : [])];
    }),
    ...part.posts.map((post) => ({ xLow: post.at[0] - post.diameter / 2, xHigh: post.at[0] + post.diameter / 2, yLow: post.at[1] - post.diameter / 2, yHigh: post.at[1] + post.diameter / 2 })),
  ];
  return {
    xLow: Math.min(...boxes.map((b) => b.xLow)),
    xHigh: Math.max(...boxes.map((b) => b.xHigh)),
    yLow: Math.min(...boxes.map((b) => b.yLow)),
    yHigh: Math.max(...boxes.map((b) => b.yHigh)),
  };
}

export function planFitTest(plan: BuildPlan): FitTestPlan {
  const { config } = plan;
  const { fit, buildVolume } = config.fabrication;
  const { floorThickness, panelThickness } = config.enclosure;
  const parts = { ...library, ...config.customParts };
  const used = [...new Set(config.components.map((c) => c.type))].flatMap((id) => (parts[id] ? [{ id, part: parts[id]! }] : []));
  // Parts to try for later come last, so trying one more doesn't renumber a print already made.
  const testOnly = [...new Set(config.fabrication.fitTestParts)].flatMap((id) => (parts[id] && !used.some((u) => u.id === id) ? [{ id, part: parts[id]! }] : []));
  const shellInserts = plan.plate !== null && plan.plate.screws.length > 0;
  const seamed = plan.seams.length > 0;
  const onSide = plan.shellOnSide;
  const uprightInserts = plan.topScrews.length > 0 || seamed || (shellInserts && !onSide);
  const screws = plan.topScrews.length > 0 || seamed || shellInserts || config.opening?.rail !== undefined;

  type Draft = Omit<FitRow, "number" | "coupon" | "y" | "width"> & { width?: number };
  const drafts: Draft[] = [];
  if (uprightInserts) {
    drafts.push({
      kind: "insert",
      title: "Insert holes, printed upright",
      how: "Press in a heat-set insert with a soldering iron. Pick the smallest hole where it goes in straight and flush, with no plastic pushed out over the top, then see that a screw doesn't pull it out.",
      setting: "insertHole",
      parts: [],
      current: fit.insertHole,
      steps: ladder(INSERT_HOLE_DIAMETER, fit.insertHole, HOLE_STEPS),
      thickness: floorThickness,
      depth: BOSS_DIAMETER + 3 + FIT_PIP_BAND,
      pitch: HOLE_PITCH,
      part: null,
    });
  }
  if (shellInserts && onSide) {
    drafts.push({
      kind: "insertSideways",
      title: "Insert holes, printed lying down",
      how: "These are for the shell, which prints on its side. Press in an insert the same way. Pick the smallest hole it goes into straight and flush.",
      setting: "insertHoleSideways",
      parts: [],
      current: fit.insertHoleSideways,
      steps: ladder(INSERT_HOLE_DIAMETER, fit.insertHoleSideways, HOLE_STEPS),
      thickness: floorThickness,
      depth: FIT_WALL_FRONT + FIT_WALL_DEPTH + FIT_PIP_BAND,
      pitch: HOLE_PITCH,
      part: null,
    });
  }
  if (screws) {
    drafts.push({
      kind: "screw",
      title: "Screw holes",
      how: "Push an M3 screw through from the side with the countersink. Pick the smallest hole it slides through without threading into the plastic, and see that its head sits flush.",
      setting: "screwHole",
      parts: [],
      current: fit.screwHole,
      steps: ladder(SCREW_CLEARANCE_DIAMETER, fit.screwHole, HOLE_STEPS),
      thickness: floorThickness,
      depth: 8 + FIT_PIP_BAND + 3,
      pitch: HOLE_PITCH,
      part: null,
    });
  }
  if (plan.plate) {
    const { clearance } = plan.plate;
    const steps = ladder(USUAL_PLATE_CLEARANCE, clearance, NEIGHBOUR_STEPS).filter((step) => step.value >= MIN_PLATE_CLEARANCE);
    const widest = Math.max(...steps.map((step) => step.value));
    drafts.push({
      kind: "plate",
      title: "Plate clearance",
      how: "Drop the loose plug into each window. Pick the tightest one it drops into and out of by hand, without forcing it.",
      setting: "plateClearance",
      parts: [],
      current: clearance,
      steps,
      thickness: floorThickness,
      depth: FIT_PLUG_DEPTH + 2 * widest + 2 * PART_PAD + FIT_PIP_BAND,
      pitch: FIT_PLUG_WIDTH + 2 * widest + 2 * PART_PAD,
      part: null,
    });
  }
  if (seamed) {
    const socketDepth = plan.seams[0]!.pinLength + 0.5;
    drafts.push({
      kind: "seamPin",
      title: "Seam pin sockets",
      how: "Push the loose pin into each socket. Pick the tightest one it goes all the way into by hand, so the halves line up without forcing them together.",
      setting: "pinSocket",
      parts: [],
      current: fit.pinSocket,
      steps: ladder(PIN_SOCKET_DIAMETER, fit.pinSocket, HOLE_STEPS).filter((step) => step.value >= PIN_DIAMETER),
      thickness: floorThickness,
      depth: BOSS_DIAMETER + 3 + FIT_PIP_BAND,
      pitch: HOLE_PITCH,
      part: null,
      socketDepth,
    });
  }
  const knob = plan.knobs[0];
  if (knob) {
    // The shaft's own size, from the hole with the fit taken back off.
    const shaft = { diameter: tidy(knob.hole.diameter - fit.knobHole), flat: knob.hole.flat === null ? null : tidy(knob.hole.flat - fit.knobHole) };
    drafts.push({
      kind: "knob",
      title: "Knob shaft holes",
      how: "Push a knob's shaft into each hole, flat to flat. Pick the tightest one it goes all the way into by hand, and stays on when you pull lightly.",
      setting: "knobHole",
      parts: [],
      current: fit.knobHole,
      steps: ladder(KNOB_HOLE_FIT, fit.knobHole, HOLE_STEPS, (value) => shaft.diameter + value),
      thickness: floorThickness,
      depth: shaft.diameter + 2 * KNOB_FIT_WALL + 3 + FIT_PIP_BAND,
      pitch: Math.max(HOLE_PITCH, shaft.diameter + 2 * KNOB_FIT_WALL + 2),
      part: null,
      shaft,
    });
  }
  const addClipRows = (list: typeof used) => {
    for (const { id, part } of list) {
      if (part.mount !== "floor" || !part.holder || part.holder.clips.length === 0 || part.footprint.shape !== "rect") continue;
      const clip = part.holder.clips[0]!;
      const steps = ladder(CLIP_GAP, fit.clipGap, NEIGHBOUR_STEPS).filter((step) => step.value >= 0 && step.value < BARB_REACH);
      const gapAtMost = Math.max(...steps.map((step) => step.value));
      drafts.push({
        kind: "clip",
        title: `Clips for ${part.name}`,
        how: "Snap the board in across each pair of clips. Pick the one that holds it without rattling, and doesn't stress the clips going in.",
        setting: "clipGap",
        parts: [id],
        current: fit.clipGap,
        steps,
        thickness: floorThickness,
        depth: part.footprint.height + 2 * (gapAtMost + CLIP_THICKNESS) + 2 * PART_PAD + FIT_PIP_BAND,
        pitch: Math.max(clip.length, part.holder.pads[0]?.width ?? 0) + 2 * PART_PAD,
        part,
      });
    }
  };
  // Parts with identical holes share a row. One round hole gets a range of sizes, and anything
  // else is printed once to check its pattern, because a range of those would be too big.
  const groups = new Map<string, { ids: string[]; part: PanelPart; change: number; placed: boolean }>();
  for (const { id, part } of [...used, ...testOnly]) {
    if (part.mount !== "panel") continue;
    const change = fit.partHoles[id] ?? 0;
    const key = JSON.stringify([part.cutouts, part.posts, change]);
    const group = groups.get(key);
    if (group) group.ids.push(id);
    else groups.set(key, { ids: [id], part, change, placed: used.some((u) => u.id === id) });
  }
  // As thick as the surface the part is on, taking the first if it's on several.
  const thicknessFor = (ids: string[]) => {
    const component = config.components.find((c) => ids.includes(c.type) && "u" in c);
    const surfaces = config.enclosure.surfaces;
    const surface = component && "u" in component ? (surfaces.find((s) => s.id === component.surface) ?? surfaces[0]) : undefined;
    return surface?.thickness ?? panelThickness;
  };
  const addPartRows = (placed: boolean) => {
    for (const { ids, part, change, placed: isPlaced } of groups.values()) {
      if (isPlaced !== placed) continue;
      const only = part.cutouts.length === 1 && part.posts.length === 0 ? part.cutouts[0] : undefined;
      const names = ids.map((id) => parts[id]!.name);
      const bounds = partHoleBounds(part);
      const span = bounds.xHigh - bounds.xLow;
      const tall = bounds.yHigh - bounds.yLow;
      if (only?.kind === "circle") {
        const sized = (value: number) => tidy(only.diameter + value);
        const steps = ladder(0, change, PART_STEPS, sized);
        const largest = Math.max(...steps.map((step) => step.size));
        const grown = largest - only.diameter; // and any notch with it
        drafts.push({
          kind: "part",
          title: `${only.diameter} mm hole for ${names.join(", ")}`,
          how: "Push the part through each hole. Pick the smallest one it fits without forcing, and that doesn't leave it loose.",
          setting: "partHoles",
          parts: ids,
          current: change,
          steps,
          thickness: thicknessFor(ids),
          depth: tall + grown + 2 * PART_PAD + FIT_PIP_BAND,
          pitch: span + grown + 2 * PART_PAD,
          part,
        });
      } else {
        drafts.push({
          kind: "part",
          title: `Holes for ${names.join(", ")}`,
          how: "Try the part in it. If it's too tight or too loose, set how much to add to its holes, in mm. The spacing can't be changed here, so if that's wrong, its numbers need measuring again.",
          setting: "partHoles",
          parts: ids,
          current: change,
          steps: [{ pips: 0, value: change, size: change }],
          thickness: thicknessFor(ids),
          depth: tall + 2 * PART_PAD + FIT_PIP_BAND,
          pitch: span + 2 * PART_PAD,
          part,
        });
      }
    }
  };
  addClipRows(used);
  addPartRows(true);

  // Holes in the walls, whose sizes are only known once they're planned. Identical ones share a row.
  const printedAs = (wall: string): FitWallHole["printed"] => (!onSide ? "standing" : wall === "left" || wall === "right" ? "flat" : "sideways");
  const wallRows = new Map<string, { hole: FitWallHole; change: number; parts: string[]; setting: FitSetting; part: FloorPart | WallPart | null; name: string | null }>();
  const addWallHole = (width: number, height: number, cornerRadius: number, wall: string, change: number, setting: FitSetting, id: string, part: FloorPart | WallPart | null) => {
    if (Math.max(width, height) > LARGEST_WALL_HOLE) return;
    const printed = printedAs(wall);
    const key = JSON.stringify([width, height, cornerRadius, printed, change, setting, setting === "partHoles" ? id : ""]);
    const known = wallRows.get(key);
    if (known) {
      if (!known.parts.includes(id)) known.parts.push(id);
    } else {
      wallRows.set(key, { hole: { width, height, cornerRadius, printed, wall: config.enclosure.wall }, change, parts: [id], setting, part, name: part?.name ?? null });
    }
  };
  config.wallHoles.forEach((hole, i) => addWallHole(hole.width, hole.height, hole.cornerRadius, hole.wall, hole.fitChange, "wallHole", String(i), null));
  // Only a part's main hole, because they all share one setting.
  const tested = new Set<string>();
  for (const hole of plan.wallHoles) {
    const id = config.components.find((component) => component.id === hole.componentId)?.type;
    const part = id ? parts[id] : undefined;
    if (!id || !part || part.mount === "panel" || tested.has(hole.componentId!)) continue;
    tested.add(hole.componentId!);
    const change = fit.partHoles[id] ?? 0;
    addWallHole(tidy(hole.width - change), tidy(hole.height - change), hole.cornerRadius, hole.wall, change, "partHoles", id, part);
  }
  for (const { hole, change, parts: ids, setting, part, name } of wallRows.values()) {
    const fits = (value: number) => Math.min(hole.width, hole.height) + value > Math.max(2 * hole.cornerRadius, 0);
    const steps = ladder(0, change, WALL_HOLE_STEPS, (value) => tidy(hole.width + value)).filter((step) => fits(step.value));
    const widest = Math.max(...steps.map((step) => step.value));
    const across = (hole.printed === "sideways" ? hole.height : hole.width) + widest;
    const up = (hole.printed === "sideways" ? hole.width : hole.height) + widest;
    drafts.push({
      kind: "wallHole",
      title: `${hole.width} x ${hole.height} mm hole in the wall${name ? ` for ${name}` : ""}`,
      how: "This one is the real wall's thickness, printed the way the shell prints it. Push the connector or plug through from outside. Pick the smallest hole it goes through without forcing.",
      setting,
      parts: ids,
      current: change,
      steps,
      thickness: hole.printed === "flat" ? hole.wall : floorThickness,
      depth: hole.printed === "flat" ? up + 2 * PART_PAD + FIT_PIP_BAND : FIT_WALL_FRONT + hole.wall + FIT_PIP_BAND,
      pitch: across + 2 * PART_PAD,
      part,
      wallHole: hole,
    });
  }

  addClipRows(testOnly);
  addPartRows(false);

  const rows: FitRow[] = [];
  let coupon = 0;
  let y = 0;
  // Fixings go on a piece of their own, because every design needs them, and parts take longer.
  const isFixing = (draft: Draft) => draft.kind === "insert" || draft.kind === "insertSideways" || draft.kind === "screw" || draft.kind === "plate" || draft.kind === "seamPin";
  drafts.forEach((draft, i) => {
    const room = buildVolume.y - BED_MARGIN;
    const firstPart = i > 0 && !isFixing(draft) && isFixing(drafts[i - 1]!);
    if (y > 0 && (firstPart || y + draft.depth > room)) {
      coupon += 1;
      y = 0;
    }
    rows.push({ ...draft, number: i + 1, coupon, y, width: FIT_MARGIN + draft.pitch * draft.steps.length });
    y += draft.depth;
  });

  const hardware = [
    ...(uprightInserts || (shellInserts && onSide) ? ["M3 brass heat-set inserts, and a soldering iron with an insert tip"] : []),
    ...(screws ? ["An M3 flat-head screw"] : []),
    ...[...used, ...testOnly].map(({ part }) => part).filter((part, i, all) => all.indexOf(part) === i && drafts.some((d) => d.part === part)).map((part) => `One ${part.name}`),
  ];
  return {
    rows,
    coupons: rows.length ? coupon + 1 : 0,
    plug: drafts.some((d) => d.kind === "plate") ? { width: FIT_PLUG_WIDTH, depth: FIT_PLUG_DEPTH, thickness: floorThickness } : null,
    pin: seamed ? { diameter: PIN_DIAMETER, length: plan.seams[0]!.pinLength, width: FIT_PIN_TAB, thickness: floorThickness } : null,
    wallSection: rows.length ? planWallSection(plan) : null,
    seamJoint: planSeamJoint(plan),
    floorThickness,
    panelThickness,
    hardware,
  };
}

// The shell's rear left corner, which has the walls and whatever rounds the design has, and prints
// the way the first part of the shell does.
function planWallSection(plan: BuildPlan): FitWallSection {
  const { depth, maxHeight } = plan.profile;
  const planned = orientationsFor(plan, plan.printedParts[0]!).find((option) => option.planned);
  return {
    part: 0,
    x: [-1, FIT_SECTION_SIZE],
    y: [depth - FIT_SECTION_SIZE, depth + 1],
    z: [-1, maxHeight + 1],
    matrix: planned!.matrix,
    wall: plan.config.enclosure.wall,
  };
}

// Slices of the real shell either side of a seam, around a tab with its bolts and pin. A tab on a
// wall is the first choice, because that's what most holds the halves in line.
function planSeamJoint(plan: BuildPlan): [FitWallSection, FitWallSection] | null {
  const seam = plan.seams[0];
  if (!seam) return null;
  const tab = seam.tabs.find((candidate) => !candidate.surface) ?? seam.tabs[0];
  if (!tab) return null;
  const { wall } = plan.config.enclosure;
  const panelThickness = plan.profile.surfaces.find((surface) => surface.id === tab.surface)?.thickness ?? 0;
  const corners = tabSection(tab);
  const ys = corners.map(([y]) => y);
  const zs = corners.map(([, z]) => z);
  const onFront = !tab.surface && tab.inward[0] > 0;
  const onRear = !tab.surface && tab.inward[0] < 0;
  const y: [number, number] = [Math.min(...ys) - (onFront ? wall + 1 : SECTION_PAD), Math.max(...ys) + (onRear ? wall + 1 : SECTION_PAD)];
  const z: [number, number] = [Math.min(...zs) - SECTION_PAD, Math.max(...zs) + SECTION_PAD + (tab.surface ? panelThickness : 0)];
  const planned = (part: number) => orientationsFor(plan, plan.printedParts[part]!).find((option) => option.planned)!.matrix;
  return [
    { part: 0, x: [seam.x - SECTION_REACH, seam.x + seam.pinLength + 1], y, z, matrix: planned(0), wall },
    { part: 1, x: [seam.x - 1, seam.x + SECTION_REACH], y, z, matrix: planned(1), wall },
  ];
}
