// Builds the fit test with the same tools as the enclosure, so what fits here fits there. It
// prints as exported. Each row is built the way its feature prints: panel holes face down with
// their posts up, and bosses and clips upright on the bed.
import { compoundShapes, draw, drawRectangle, drawRoundedRectangle, makeCylinder, measureVolume, Plane, type Shape3D } from "replicad";
import { boxSolid, cutoutTool, holderSolid, placedOnBed, plateScrewHole, withPosts } from "./engine.js";
import { holderBlocks } from "./fixtures.js";
import { FIT_HOLE_PAD, KNOB_FIT_DEPTH, FIT_MARGIN, FIT_PIN_NAME, FIT_PIP_BAND, FIT_PLUG_NAME, FIT_SEAM_NAMES, FIT_SECTION_NAME, fitTestPieceName, FIT_PLUG_DEPTH, FIT_PLUG_WIDTH, FIT_WALL_DEPTH, FIT_WALL_FRONT, FIT_WALL_HEIGHT, partHoleBounds, type FitRow, type FitTestPlan, type FitWallSection } from "./fitTest.js";
import { BOSS_DIAMETER, INSERT_HOLE_DEPTH, SHORT_BOSS_HEIGHT } from "./plate.js";
import type { Surface } from "./profile.js";
import type { FloorPart, PanelPart } from "./schema.js";
import type { PlacedCutout } from "./validate.js";

export interface FitTestPart {
  name: string;
  shape: Shape3D;
}

const PIP_DEPTH = 0.4; // two layers, enough to see and to feel
const SIZE_PIP = 1.2;
const ROW_PIP = 1.6;
const JOIN = 0.5; // how far rows overlap, so they make one piece

// Dots in columns of up to `high`, like a domino.
function pips(count: number, x: number, y: number, top: number, diameter: number, high: number): Shape3D[] {
  const spacing = diameter * 2;
  const columns = Math.ceil(count / high);
  return Array.from({ length: count }, (_, i) => {
    const column = Math.floor(i / high);
    const row = i % high;
    return makeCylinder(diameter / 2, PIP_DEPTH + 1, [x + (column - (columns - 1) / 2) * spacing, y + ((high - 1) / 2 - row) * spacing, top - PIP_DEPTH], [0, 0, 1]);
  });
}

// A surface lying face down on the bed, with v running towards the front, so the real tools for
// cutouts and posts make what a top panel prints as.
function faceDown(y: number): Surface {
  return { id: "fit", index: 0, y0: y, z0: 0, y1: y, z1: 0, thickness: 0, length: 0, angle: 0, cos: -1, sin: 0 };
}

const cellX = (row: FitRow, i: number) => FIT_MARGIN + row.pitch * (i + 0.5);
const cellY = (row: FitRow) => row.y + (row.depth - FIT_PIP_BAND) / 2;

function partCutouts(part: PanelPart, change: number, x: number): PlacedCutout[] {
  const base = { id: "fit", componentId: "fit", surface: "fit", printedPart: 0 };
  const placed = (list: { at: readonly [number, number]; width: number; height: number }[] | undefined) =>
    list?.length ? { notches: list.map((notch) => ({ u: x + notch.at[0], v: notch.at[1], width: notch.width + change, height: notch.height + change })) } : {};
  return part.cutouts.map((cutout) => {
    const u = x + cutout.at[0];
    const v = cutout.at[1];
    if (cutout.kind === "circle") return { ...base, kind: cutout.kind, u, v, diameter: cutout.diameter + change, ...placed(cutout.notches) };
    const size = { width: cutout.width + change, height: cutout.height + change };
    if (cutout.kind === "pocket") return { ...base, kind: cutout.kind, u, v, ...size, skin: cutout.skin };
    const recess = cutout.recess && { u: x + cutout.recess.at[0], v: cutout.recess.at[1], width: cutout.recess.width + change, height: cutout.recess.height + change, skin: cutout.recess.skin, ...placed(cutout.recess.notches) };
    return { ...base, kind: cutout.kind, u, v, ...size, cornerRadius: cutout.cornerRadius, ...placed(cutout.notches), ...(recess && { recess }) };
  });
}

// The base of a row, then whatever stands on it, then what's cut from it.
function rowSolid(row: FitRow, first: boolean): Shape3D {
  const front = first ? row.y : row.y - JOIN;
  let solid = boxSolid([0, row.width], [front, row.y + row.depth], [0, row.thickness]);
  const y = cellY(row);
  const xs = row.steps.map((_, i) => cellX(row, i));
  const top = row.thickness;

  if (row.kind === "insert") {
    const height = SHORT_BOSS_HEIGHT;
    solid = solid.fuse(compoundShapes(xs.map((x) => makeCylinder(BOSS_DIAMETER / 2, height + 0.5, [x, y, top - 0.5], [0, 0, 1]))) as Shape3D);
    solid = solid.cut(compoundShapes(row.steps.map((step, i) => makeCylinder(step.size / 2, INSERT_HOLE_DEPTH + 1, [xs[i]!, y, top + height - INSERT_HOLE_DEPTH], [0, 0, 1]))) as Shape3D);
  }
  if (row.kind === "insertSideways") {
    const wallFront = row.y + FIT_WALL_FRONT;
    solid = solid.fuse(boxSolid([FIT_MARGIN, row.width], [wallFront, wallFront + FIT_WALL_DEPTH], [top - 0.5, top + FIT_WALL_HEIGHT]));
    // Open to the front, with a teardrop's point upwards, as in the shell.
    const z = top + FIT_WALL_HEIGHT / 2 - 0.5;
    const holes = row.steps.map((step, i) => {
      const r = step.size / 2;
      const c = r * Math.SQRT1_2;
      const x = xs[i]!;
      const hole = makeCylinder(r, INSERT_HOLE_DEPTH + 1, [x, wallFront - 1, z], [0, 1, 0]);
      const tip = draw([x - c, -(z + c)])
        .lineTo([x, -(z + r * Math.SQRT2)])
        .lineTo([x + c, -(z + c)])
        .close()
        .sketchOnPlane(new Plane([0, wallFront - 1, 0], [1, 0, 0], [0, 1, 0]))
        .extrude(INSERT_HOLE_DEPTH + 1) as Shape3D;
      return hole.fuse(tip);
    });
    solid = solid.cut(compoundShapes(holes) as Shape3D);
  }
  if (row.kind === "seamPin") {
    // In a boss here, because the rib it's in on the real shell is thicker than a row's base.
    const depth = row.socketDepth!;
    const height = Math.max(depth + 1 - top, 1);
    solid = solid.fuse(compoundShapes(xs.map((x) => makeCylinder(BOSS_DIAMETER / 2, height + 0.5, [x, y, top - 0.5], [0, 0, 1]))) as Shape3D);
    solid = solid.cut(compoundShapes(row.steps.map((step, i) => makeCylinder(step.size / 2, depth + 1, [xs[i]!, y, top + height - depth], [0, 0, 1]))) as Shape3D);
  }
  if (row.kind === "knob") {
    // A D hole in a boss for each size, printed upright, as the knob is, its flat towards the back.
    const { diameter, flat } = row.shaft!;
    const boss = diameter + 4;
    const height = Math.max(KNOB_FIT_DEPTH + 1 - top, 1);
    solid = solid.fuse(compoundShapes(xs.map((x) => makeCylinder(boss / 2, height + 0.5, [x, y, top - 0.5], [0, 0, 1]))) as Shape3D);
    const holes = row.steps.map((step, i) => {
      const r = step.size / 2;
      const hole = makeCylinder(r, KNOB_FIT_DEPTH + 1, [xs[i]!, y, top + height - KNOB_FIT_DEPTH], [0, 0, 1]) as Shape3D;
      if (flat === null) return hole;
      const off = flat + step.value - r;
      return hole.cut(boxSolid([xs[i]! - r - 1, xs[i]! + r + 1], [y + off, y + r + 1], [top + height - KNOB_FIT_DEPTH - 1, top + height + 1]));
    });
    solid = solid.cut(compoundShapes(holes) as Shape3D);
  }
  if (row.kind === "wallHole") {
    const hole = row.wallHole!;
    const outline = (value: number) => {
      const width = hole.width + value;
      const height = hole.height + value;
      const [across, up] = hole.printed === "sideways" ? [height, width] : [width, height];
      return hole.cornerRadius > 0 ? drawRoundedRectangle(across, up, hole.cornerRadius) : drawRectangle(across, up);
    };
    if (hole.printed === "flat") {
      solid = solid.cut(compoundShapes(row.steps.map((step, i) => outline(step.value).translate(xs[i]!, y).sketchOnPlane("XY", -1).extrude(top + 2) as Shape3D)) as Shape3D);
    } else {
      const widest = Math.max(...row.steps.map((step) => step.value));
      const up = (hole.printed === "sideways" ? hole.width : hole.height) + widest;
      const wallFront = row.y + FIT_WALL_FRONT;
      solid = solid.fuse(boxSolid([FIT_MARGIN, row.width], [wallFront, wallFront + hole.wall], [top - 0.5, top + up + 2 * FIT_HOLE_PAD]));
      // Drawn looking along y, whose plane has z running downwards.
      const plane = new Plane([0, wallFront - 1, 0], [1, 0, 0], [0, 1, 0]);
      solid = solid.cut(compoundShapes(row.steps.map((step, i) => outline(step.value).translate(xs[i]!, -(top + FIT_HOLE_PAD + up / 2)).sketchOnPlane(plane).extrude(hole.wall + 2) as Shape3D)) as Shape3D);
    }
  }
  if (row.kind === "screw") {
    solid = solid.cut(compoundShapes(row.steps.map((step, i) => plateScrewHole(xs[i]!, y, top, step.size))) as Shape3D);
  }
  if (row.kind === "plate") {
    solid = solid.cut(compoundShapes(row.steps.map((step, i) => boxSolid([xs[i]! - FIT_PLUG_WIDTH / 2 - step.size, xs[i]! + FIT_PLUG_WIDTH / 2 + step.size], [y - FIT_PLUG_DEPTH / 2 - step.size, y + FIT_PLUG_DEPTH / 2 + step.size], [-1, top + 1]))) as Shape3D);
  }
  if (row.kind === "clip") {
    const part = row.part as FloorPart;
    const holder = part.holder!;
    const one = { ...part, holder: { ...holder, pads: holder.pads.slice(0, 1).map((pad) => ({ ...pad, at: [0, 0] as [number, number] })), stops: [], clips: [{ ...holder.clips[0]!, at: 0 }] } };
    const blocks = row.steps.flatMap((step, i) => holderBlocks("fit", one, xs[i]!, y, 0, step.size));
    solid = solid.fuse(compoundShapes(blocks.map((block) => holderSolid(block, top))) as Shape3D);
  }
  if (row.kind === "part") {
    const part = row.part as PanelPart;
    const bounds = partHoleBounds(part);
    const middleX = (bounds.xLow + bounds.xHigh) / 2;
    const middleY = (bounds.yLow + bounds.yHigh) / 2;
    // v runs towards the front, so a part's rear is nearer the bed's front, as it is face down.
    const surface = faceDown(y + middleY);
    const tools = row.steps.flatMap((step, i) => partCutouts(part, step.value, xs[i]! - middleX).map((cutout) => cutoutTool(cutout, surface, row.thickness)));
    solid = solid.cut(compoundShapes(tools) as Shape3D);
    const posts = row.steps.flatMap((_, i) => part.posts.map((post) => ({ u: xs[i]! - middleX + post.at[0], v: post.at[1], diameter: post.diameter, reach: post.reach, holeDiameter: post.holeDiameter, holeDepth: post.holeDepth })));
    solid = withPosts(solid, posts, () => surface);
  }

  const marks = [
    ...pips(row.number, FIT_MARGIN / 2, y, top, ROW_PIP, 3),
    ...row.steps.flatMap((step, i) => pips(step.pips, xs[i]!, row.y + row.depth - FIT_PIP_BAND / 2, top, SIZE_PIP, 1)),
  ];
  return solid.cut(compoundShapes(marks) as Shape3D);
}

// Part of the real shell, placed as the shell prints. If cutting it leaves bits on their own,
// such as the end of a boss, only the corner is kept.
export function buildWallSection(section: FitWallSection, shell: Shape3D): Shape3D {
  const cut = shell.intersect(boxSolid(section.x, section.y, section.z));
  const solids = cut.solids as Shape3D[];
  const volumes = solids.map((solid) => measureVolume(solid));
  const largest = solids[volumes.indexOf(Math.max(...volumes))] ?? cut;
  const turned = placedOnBed(largest, section.matrix, [0, 0, 0]);
  const [[x, y, z]] = turned.boundingBox.bounds;
  return placedOnBed(turned, [1, 0, 0, 0, 1, 0, 0, 0, 1], [-x, -y, -z]);
}

// What's cut from the real shell needs the design's parts, so it's only made if they're given.
export function buildFitTest(plan: FitTestPlan, designParts?: Shape3D[]): FitTestPart[] {
  const parts: FitTestPart[] = [];
  for (let coupon = 0; coupon < plan.coupons; coupon++) {
    const rows = plan.rows.filter((row) => row.coupon === coupon);
    let shape = rowSolid(rows[0]!, true);
    for (const row of rows.slice(1)) shape = shape.fuse(rowSolid(row, false));
    parts.push({ name: fitTestPieceName(plan, coupon), shape });
  }
  if (plan.plug) {
    parts.push({ name: FIT_PLUG_NAME, shape: boxSolid([0, plan.plug.width], [0, plan.plug.depth], [0, plan.plug.thickness]) });
  }
  if (plan.pin) {
    const { diameter, length, width, thickness } = plan.pin;
    const middle = width / 2;
    const tab = boxSolid([0, width], [0, width], [0, thickness]);
    parts.push({ name: FIT_PIN_NAME, shape: tab.fuse(makeCylinder(diameter / 2, length + 0.5, [middle, middle, thickness - 0.5], [0, 0, 1])) });
  }
  if (designParts) {
    if (plan.wallSection) parts.push({ name: FIT_SECTION_NAME, shape: buildWallSection(plan.wallSection, designParts[plan.wallSection.part]!) });
    plan.seamJoint?.forEach((section, i) => parts.push({ name: FIT_SEAM_NAMES[i]!, shape: buildWallSection(section, designParts[section.part]!) }));
  }
  return parts;
}
