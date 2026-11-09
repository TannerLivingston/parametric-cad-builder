// Builds printable solids from a validated BuildPlan. It takes only a BuildPlan, because
// bad layouts can crash OpenCascade or come out wrong without an error.
//
// WASM memory grows with every boolean and can't be freed, about 8 MB per full
// rebuild, so a long-running host should replace the instance now and then. Run it in
// a Worker, and replace it after any exception, since the heap may be corrupted.
import { Plane, cast, compoundShapes, draw, drawCircle, drawRectangle, drawRoundedRectangle, getOC, makeBox, makeCylinder, setOC, type Shape3D, type Sketch } from "replicad";
import type { Matrix } from "./printing.js";
import type { Fit } from "./schema.js";
import { textOutline } from "./lettering.js";
import { CREASE_BOSS_DIAMETER, CREASE_BOSS_LENGTH, CREASE_FLANGE_THICKNESS, type CreaseJoint } from "./crease.js";
import type { BuildPlan, PlacedCutout, PlacedLabel, PlacedNotch, PlacedPost, PlannedSeam } from "./validate.js";
import { POST_ROOT_DEPTH, TOOL_OVERSHOOT_ABOVE, TOOL_OVERSHOOT_BELOW } from "./validate.js";
import { CAP_COLLAR, KNOB_GRIP_COUNT, KNOB_POINTER, type PlannedCap, type PlannedKnob } from "./knob.js";
import { tabGussetDepth, TONGUE_FIT, TOP_POST_DIAMETER, TOP_TAB_THICKNESS, topTabExtent, type TopJoint, type TopScrew } from "./top.js";
import { plateInput, plateNotchFor, RAIL_FOOT_MARGIN, RAIL_BLOCK_HEIGHT } from "./validate.js";
import { BARB_HEIGHT, BARB_REACH, STANDOFF_HOLE_FLOOR, TIE_BRIDGE, tieExtent, type HolderBlock, type PlannedWallHole } from "./fixtures.js";
import { BOSS_DIAMETER, bossFeet, bossSlope, shortBossTop, FOOT_RECESS, weightOutline, DRIVER_DIAMETER, COUNTERSINK_DEPTH, COUNTERSINK_DIAMETER, INSERT_HOLE_DEPTH, INSERT_HOLE_DIAMETER, PIN_DIAMETER, PLATE_RIB_BOLT_Z, PLATE_RIB_BOSS, PLATE_RIB_END, PLATE_RIB_FIT, PLATE_RIB_HEIGHT, PLATE_RIB_LEFT, PLATE_RIB_RIGHT, PLATE_RIB_TONGUE, PLATE_RIB_TONGUE_Z, SCREW_CLEARANCE_DIAMETER, SHORT_BOSS_HEIGHT, type PlateRib } from "./plate.js";
import { offsetChain, surfacePoint, type PathStep, type Point2, type SeamTab, type Surface } from "./profile.js";

export const BOLT_DIAMETER = 3.4; // M3 clearance, as used in the Desk Synth shell
const FRAME_OVERLAP = 0.5; // tabs reach this far into the walls, so the fuse is clean
const POCKET_CORNER_RADIUS = 1;

export interface BuiltPart {
  index: number;
  kind: "shell" | "top" | "plate" | "rail" | "knob";
  name: string;
  color: string;
  blank: Shape3D; // before cutouts, so that moving a part only re-cuts one piece
  cut: Shape3D; // with the cutouts, before any screw posts
  shape: Shape3D;
}

export interface Enclosure {
  parts: BuiltPart[];
  stagesMs: Record<string, number>;
}

// Loads OpenCascade. In a browser, pass locateFile to say where the WASM is served.
export async function initEngine(options: { locateFile?: () => string } = {}) {
  const { default: opencascade } = await import("replicad-opencascadejs");
  const oc = await opencascade({ print() {}, printErr() {}, ...options });
  setOC(oc);
  return oc;
}

// A closed outline with true arcs, extruded along the width.
function extrudedPath(path: PathStep[], x0: number, x1: number): Shape3D {
  let pen = draw(path.at(-1)!.to);
  for (const { to, via } of path) pen = via ? pen.threePointsArcTo(to, via) : pen.lineTo(to);
  return pen.close().sketchOnPlane("YZ", x0).extrude(x1 - x0) as Shape3D;
}

// Rounds on the side profile can't take a fillet on top of them, so the corners come from
// the outline seen from above, as a solid to intersect with.
function roundedPlan(x0: number, x1: number, y0: number, y1: number, radius: number, z0: number, z1: number): Shape3D {
  const plan = radius > 0 ? drawRoundedRectangle(x1 - x0, y1 - y0, radius) : drawRectangle(x1 - x0, y1 - y0);
  return plan.translate((x0 + x1) / 2, (y0 + y1) / 2).sketchOnPlane("XY", z0).extrude(z1 - z0) as Shape3D;
}

function hasRounds(plan: BuildPlan): boolean {
  return Object.values(plan.config.enclosure.rounds).some((radius) => radius > 0);
}

function extrudedProfile(chain: Point2[], baseZ: number, x0: number, x1: number): Shape3D {
  const [firstY] = chain[0]!;
  const [lastY] = chain.at(-1)!;
  let pen = draw([firstY, baseZ]).lineTo([lastY, baseZ]);
  for (const point of [...chain].reverse()) pen = pen.lineTo(point);
  return pen.close().sketchOnPlane("YZ", x0).extrude(x1 - x0) as Shape3D;
}

// A tab across a seam. Seen along the wall it's a trapezoid, sloping back to the wall at
// 45 degrees on both sides, so it needs no support with the seam facing up.
function seamTabSolid(tab: SeamTab, seam: PlannedSeam): Shape3D {
  const half = seam.ribHalfThickness;
  const width = tab.width;
  const dy = tab.end[0] - tab.start[0];
  const dz = tab.end[1] - tab.start[1];
  const length = Math.sqrt(dy * dy + dz * dz);
  const plane = new Plane([0, tab.start[0], tab.start[1]], [1, 0, 0], [0, dy / length, dz / length]);
  // The plane's local y is its normal crossed with x. Inward may be either way along it.
  const facing = (dz / length) * tab.inward[0] - (dy / length) * tab.inward[1] > 0 ? 1 : -1;
  // Its slopes carry on past the line it's drawn along, into the wall, because a rounded wall can
  // bulge away from that line, and the slope's foot would hang short of it. The envelope trims it.
  const embed = FRAME_OVERLAP + width;
  return draw([seam.x - half - width - embed, -embed * facing])
    .lineTo([seam.x + half + width + embed, -embed * facing])
    .lineTo([seam.x + half, width * facing])
    .lineTo([seam.x - half, width * facing])
    .close()
    .sketchOnPlane(plane)
    .extrude(length) as Shape3D;
}

interface OuterForms {
  body: Shape3D;
  slabs: Map<string, Shape3D>; // each top panel's surface, as a solid to cut from the body
  openingTool: Shape3D | null;
  railTool: Shape3D | null;
}

// A strip following a surface, as thick as the panel, cut square to the neighbouring creases.
function surfaceSlab(plan: BuildPlan, surface: Surface): Shape3D {
  const e = plan.config.enclosure;
  const { surfaces, depth } = plan.profile;
  const inner = offsetChain(surfaces, e.panelThickness, -1, depth + 1)!;
  const raise = 1;
  const y0 = surface.index === 0 ? -1 : surface.y0;
  const y1 = surface.index === surfaces.length - 1 ? depth + 1 : surface.y1;
  const z0 = surface.z0;
  const points: Point2[] = [
    [y0, z0 + raise],
    [y1, surface.z1 + raise],
    [y1, surface.z1],
    inner[surface.index + 1]!,
    inner[surface.index]!,
    [y0, z0],
  ];
  let pen = draw(points[0]!);
  for (const point of points.slice(1)) pen = pen.lineTo(point);
  return pen.close().sketchOnPlane("YZ", -1).extrude(e.width + 2) as Shape3D;
}

export function boxSolid([x0, x1]: Point2, [y0, y1]: Point2, [z0, z1]: Point2): Shape3D {
  return makeBox([x0, y0, z0], [x1, y1, z1]) as unknown as Shape3D;
}

function outerForms(plan: BuildPlan): OuterForms {
  const e = plan.config.enclosure;
  const { outer, surfaces, maxHeight } = plan.profile;
  const { depth } = plan.profile;
  let body = hasRounds(plan)
    ? extrudedPath(plan.profile.outerPath, 0, e.width).intersect(roundedPlan(0, e.width, 0, depth, e.cornerRadius, -1, maxHeight + 1))
    : roundedVerticals(extrudedProfile(outer, 0, 0, e.width), e.cornerRadius, e.cornerRadius);
  if (e.topEdgeFillet > 0) {
    body = body.fillet(e.topEdgeFillet, (edge) => edge.inPlane(surfacePlane(surfaces[0]!, 0)));
  }
  const slabs = new Map<string, Shape3D>();
  for (const panel of plan.config.topPanels) {
    const surface = surfaces.find((s) => s.id === panel.surface)!;
    slabs.set(panel.surface, surfaceSlab(plan, surface));
  }
  const opening = plan.config.opening;
  const openingTool = opening ? boxSolid([opening.xMin, opening.xMax], [-1, opening.yEnd], [opening.sill, maxHeight + 2]) : null;
  const rail = opening?.rail;
  const railTool = opening && rail ? boxSolid([opening.xMin, opening.xMax], [-1, rail.depth], [0, opening.sill]) : null;
  return { body, slabs, openingTool, railTool };
}

function roundedVerticals(solid: Shape3D, cornerRadius: number, radius: number): Shape3D {
  return cornerRadius > 0 ? solid.fillet(radius, (edge) => edge.inDirection("Z")) : solid;
}

function railExtents(plan: BuildPlan) {
  const opening = plan.config.opening!;
  const rail = opening.rail!;
  const [left, right] = rail.screwX;
  const wall = plan.config.enclosure.wall;
  const yFront = wall + 0.2;
  const yBack = rail.depth;
  // Over a front round, the screw goes back to where the base is nearly flat.
  const screwY = Math.max((yFront + yBack) / 2, Math.min(yBack - 3.5, plan.config.enclosure.rounds.frontBottom));
  return { opening, rail, left, right, wall, yFront, yBack, screwY, xLow: left - RAIL_FOOT_MARGIN, xHigh: right + RAIL_FOOT_MARGIN };
}

function railPart(plan: BuildPlan, body: Shape3D): Shape3D {
  const { opening, rail, left, right, yFront, yBack, screwY, xLow, xHigh } = railExtents(plan);
  const clearance = 0.2;
  const main = boxSolid([opening.xMin + clearance, opening.xMax - clearance], [-1, yBack], [0, opening.sill]);
  const feet = body.intersect(boxSolid([xLow, xHigh], [yFront, yBack], [0, rail.footHeight]));
  // Countersunk, as the plate's are, since a counterbore's flat roof would need support as it
  // prints base down.
  const hole = plan.config.fabrication.fit.screwHole;
  return body.intersect(main).fuse(feet).cut(plateScrewHole(left, screwY, rail.footHeight, hole)).cut(plateScrewHole(right, screwY, rail.footHeight, hole));
}

// A hole along z through the shell. On a shell printing on its side, a round hole's ceiling would
// need support, so it gets a point on top: a teardrop towards the side that's up.
// An insert hole in the shell, which lies down if the shell prints on its side.
function shellInsertDiameter(plan: BuildPlan): number {
  const { insertHole, insertHoleSideways } = plan.config.fabrication.fit;
  return plan.shellOnSide ? insertHoleSideways : insertHole;
}

function shellHole(plan: BuildPlan, x: number, y: number, diameter: number, length: number, zBottom: number): Shape3D {
  const r = diameter / 2;
  const hole = makeCylinder(r, length, [x, y, zBottom], [0, 0, 1]);
  if (!plan.shellOnSide) return hole;
  // A shell in one piece prints with its left wall down, and each half with its outer wall down.
  const seamX = plan.seams[0]?.x ?? Infinity;
  const up = x < seamX ? 1 : -1;
  const c = r * Math.SQRT1_2;
  const tip = draw([x + up * c, y - c])
    .lineTo([x + up * r * Math.SQRT2, y])
    .lineTo([x + up * c, y + c])
    .close()
    .sketchOnPlane("XY", zBottom)
    .extrude(length) as Shape3D;
  return hole.fuse(tip);
}

function topTabGusset(tab: ReturnType<typeof topTabExtent>, wall: TopScrew["wall"], depth: number): Shape3D {
  const sideways = wall === "left" || wall === "right";
  const [atWall, atTip] = sideways ? (wall === "left" ? [tab.xLow, tab.xHigh] : [tab.xHigh, tab.xLow]) : wall === "front" ? [tab.yLow, tab.yHigh] : [tab.yHigh, tab.yLow];
  const toward = atTip > atWall ? 1 : -1;
  const low = tab.zLow - depth;
  const footTip = atTip - toward * depth;
  // Just into the tab above, so that the fuse is clean. It ends in a point if it runs out at the wall.
  const outline: Point2[] = [[atWall, tab.zLow + 0.01], [atTip, tab.zLow + 0.01], [atTip, tab.zLow], ...(Math.abs(footTip - atWall) > 0.001 ? ([[footTip, low]] as Point2[]) : []), [atWall, low]];
  // Heights go in negative on the first plane, whose y runs down.
  const flip = sideways ? -1 : 1;
  let pen = draw([outline[0]![0], outline[0]![1] * flip]);
  for (const [a, b] of outline.slice(1)) pen = pen.lineTo([a, b * flip]);
  const plane = sideways ? new Plane([0, tab.yLow, 0], [1, 0, 0], [0, 1, 0]) : new Plane([tab.xLow, 0, 0], [0, 1, 0], [1, 0, 0]);
  return pen.close().sketchOnPlane(plane).extrude(sideways ? tab.yHigh - tab.yLow : tab.xHigh - tab.xLow) as Shape3D;
}

const TOP_WEB_FIN = 1.6; // thick, four lines

// Which way, along the surface, a top screw's tab reaches from its wall.
function towardTip(screw: Pick<TopScrew, "wall">): [number, number] {
  return ({ left: [1, 0], right: [-1, 0], front: [0, 1], rear: [0, -1] } as const)[screw.wall] as [number, number];
}

// The point of a teardrop round a top screw, towards its tab's tip, past the chord between where its
// sides meet the circle, as a prism up from zBottom.
function teardropPoint(screw: Pick<TopScrew, "x" | "y" | "wall">, r: number, zBottom: number, height: number): Shape3D {
  const [ux, uy] = towardTip(screw);
  const c = r * Math.SQRT1_2;
  return draw([screw.x + ux * c - uy * c, screw.y + uy * c + ux * c])
    .lineTo([screw.x + ux * r * Math.SQRT2, screw.y + uy * r * Math.SQRT2])
    .lineTo([screw.x + ux * c + uy * c, screw.y + uy * c - ux * c])
    .close()
    .sketchOnPlane("XY", zBottom)
    .extrude(height) as Shape3D;
}

// What a top screw needs on the shell: a tab to bear on, with a clearance hole.
function topScrewTab(plan: BuildPlan, screw: TopScrew, envelope: Shape3D): Shape3D {
  const e = plan.config.enclosure;
  const surface = plan.profile.surfaces.find((s) => s.id === plan.topPieces[screw.piece]!.surface)!;
  const rearWallY = surface.y1 + 3;
  const tab = topTabExtent(screw, e.wall, e.width, screw.wall === "rear" ? rearWallY : plan.profile.depth - e.wall, plan.shellOnSide);
  let solid: Shape3D;
  if (screw.wall === "left" || screw.wall === "right") {
    // These lie against the side wall, which is on the bed as they print.
    solid = boxSolid([tab.xLow, tab.xHigh], [tab.yLow, tab.yHigh], [tab.zLow, tab.zHigh]);
  } else {
    // These reach out of a front or rear wall, so they slope back to it as they print.
    const { spread } = tab;
    const atWall = screw.wall === "front" ? tab.yLow : tab.yHigh;
    const atEnd = screw.wall === "front" ? tab.yHigh : tab.yLow;
    const outline = () =>
      draw([tab.xLow - spread, atWall])
        .lineTo([tab.xHigh + spread, atWall])
        .lineTo([tab.xHigh, atEnd])
        .lineTo([tab.xLow, atEnd])
        .close();
    solid = outline().sketchOnPlane("XY", tab.zLow).extrude(TOP_TAB_THICKNESS) as Shape3D;
    if (screw.wall === "rear") {
      // Nothing is behind the rear edge of a panel but the skin above, so a web hangs from it,
      // sloped like the tab so that it needs no support.
      const tall = outline().sketchOnPlane("XY", tab.zLow).extrude(plan.profile.maxHeight + 1 - tab.zLow) as Shape3D;
      const web = tall.intersect(boxSolid([tab.xLow - spread, tab.xHigh + spread], [surface.y1 + 0.2, rearWallY], [tab.zLow, plan.profile.maxHeight + 1]));
      solid = solid.fuse(envelope.intersect(web));
      if (plan.shellOnSide) {
        // On its side, the web's corner nearest the bed would come first, as a line hanging from the
        // skin, so a fin carries on from it at 45 degrees up to the skin, for it to grow from.
        const towardBed = screw.x < (plan.seams[0]?.x ?? Infinity) ? -1 : 1;
        const corner = towardBed > 0 ? tab.xHigh + spread : tab.xLow - spread;
        const top = plan.profile.maxHeight + 1;
        const rise = top - tab.zLow;
        const fin = draw([corner - towardBed * 2, tab.zLow])
          .lineTo([corner, tab.zLow])
          .lineTo([corner + towardBed * rise, top])
          .lineTo([corner - towardBed * 2, top])
          .close()
          .sketchOnPlane(new Plane([0, rearWallY, 0], [1, 0, 0], [0, -1, 0]))
          .extrude(TOP_WEB_FIN) as Shape3D;
        solid = solid.fuse(envelope.intersect(fin));
      }
    }
  }
  const hole = plan.config.fabrication.fit.screwHole;
  const boreDiameter = Math.max(DRIVER_DIAMETER, COUNTERSINK_DIAMETER) + 0.6;
  if (!plan.shellOnSide) {
    // Upright, it'd be a flat roof, so a gusset slopes back to the wall, with the screw's way bored
    // through, wide enough for a flat head. The head sits in a countersink, since the flat ring
    // round a plain hole would hang over the bore.
    const depth = tabGussetDepth(tab, screw.wall, e.floorThickness);
    if (depth > 0) {
      const gusset = topTabGusset(tab, screw.wall, depth);
      // A teardrop, pointing up the gusset's slope. Round, its far side would leave a sliver of the
      // slope starting in mid-air, the way a seam bolt's head bore does.
      const bore = makeCylinder(boreDiameter / 2, depth + 2, [screw.x, screw.y, tab.zLow - depth - 2], [0, 0, 1]).fuse(teardropPoint(screw, boreDiameter / 2, tab.zLow - depth - 2, depth + 2));
      solid = solid.fuse(envelope.intersect(gusset).cut(bore));
    }
    // The countersink sits as deep as it has to for its cone to be as wide as the bore where the two
    // meet, under the tab, and the bore's point has a 45 degree roof, so the tab's underside has no
    // flat rim round them.
    const head = COUNTERSINK_DIAMETER / 2;
    const sink = (boreDiameter / 2 - head) / ((head - hole / 2) / COUNTERSINK_DEPTH);
    const apex = (boreDiameter / 2) * Math.SQRT2;
    const [ux, uy] = towardTip(screw);
    const roof = draw([0, tab.zLow - 0.01])
      .lineTo([apex, tab.zLow - 0.01])
      .lineTo([apex, tab.zLow])
      .lineTo([0, tab.zLow + apex])
      .close()
      .sketchOnPlane(new Plane([screw.x - uy * apex, screw.y + ux * apex, 0], [ux, uy, 0], [uy, -ux, 0]))
      .extrude(2 * apex) as Shape3D;
    const pointRoofed = teardropPoint(screw, boreDiameter / 2, tab.zLow - 0.01, apex + 0.01).intersect(roof);
    return solid.cut(plateScrewHole(screw.x, screw.y, TOP_TAB_THICKNESS, hole, tab.zLow + sink, boreDiameter)).cut(pointRoofed);
  }
  return solid.cut(shellHole(plan, screw.x, screw.y, hole, TOP_TAB_THICKNESS + 2, tab.zLow - 1));
}

// A hole through a wall, and no further. The rounded rectangle is drawn across the wall.
function wallHoleTool(plan: BuildPlan, hole: PlannedWallHole): Shape3D {
  const e = plan.config.enclosure;
  const length = e.wall + 2;
  const { depth } = plan.profile;
  const plane = {
    left: new Plane([-1, 0, 0], [0, 1, 0], [1, 0, 0]),
    right: new Plane([e.width - e.wall - 1, 0, 0], [0, 1, 0], [1, 0, 0]),
    front: new Plane([0, e.wall + 1, 0], [1, 0, 0], [0, -1, 0]),
    rear: new Plane([0, depth + 1, 0], [1, 0, 0], [0, -1, 0]),
  }[hole.wall];
  // A hole with a radius of half its size has no straight sides left to draw.
  const round = hole.width === hole.height && hole.cornerRadius * 2 >= hole.width;
  const radius = Math.min(hole.cornerRadius, Math.min(hole.width, hole.height) / 2 - 0.001);
  const outline = round ? drawCircle(hole.width / 2) : hole.cornerRadius > 0 ? drawRoundedRectangle(hole.width, hole.height, radius) : drawRectangle(hole.width, hole.height);
  return outline.translate(hole.at, hole.z).sketchOnPlane(plane).extrude(length) as Shape3D;
}

export function holderSolid(block: HolderBlock, floorTop: number): Shape3D {
  const top = floorTop + block.top;
  if (block.post) {
    const { x, y, diameter, holeDiameter } = block.post;
    // The hole stops short of the plate, so a screw can't reach through it.
    return makeCylinder(diameter / 2, block.top + 0.5, [x, y, floorTop - 0.5], [0, 0, 1]).cut(makeCylinder(holeDiameter / 2, block.top, [x, y, floorTop + STANDOFF_HOLE_FLOOR], [0, 0, 1]));
  }
  const solid = boxSolid([block.xLow, block.xHigh], [block.yLow, block.yHigh], [floorTop - 0.5, top]);
  if (!block.inward) return solid;
  // The barb sits just over the board, and its top slopes so that the board pushes past it.
  const [dx, dy] = block.inward;
  const barbBase = top - BARB_HEIGHT;
  if (dy !== 0) {
    const face = dy > 0 ? block.yHigh : block.yLow;
    const barb = draw([face - dy * 0.1, barbBase]).lineTo([face + dy * BARB_REACH, barbBase]).lineTo([face - dy * 0.1, top]).close().sketchOnPlane("YZ", block.xLow).extrude(block.xHigh - block.xLow);
    return solid.fuse(barb as Shape3D);
  }
  const face = dx > 0 ? block.xHigh : block.xLow;
  const barb = draw([face - dx * 0.1, barbBase]).lineTo([face + dx * BARB_REACH, barbBase]).lineTo([face - dx * 0.1, top]).close().sketchOnPlane(new Plane([0, block.yHigh, 0], [1, 0, 0], [0, -1, 0])).extrude(block.yHigh - block.yLow);
  return solid.fuse(barb as Shape3D);
}

// On a shell that prints upright, the space under a plate boss: below a 45 degree slope rising from
// each wall it touches. It's cut from the boss, and filled by a wedge on the plate.
// It's null for a boss with a flat underside, with no lift.
function underBoss(plan: BuildPlan, x: number, y: number, lift: number): Shape3D | null {
  if (lift === 0) return null;
  const feet = bossFeet(plateInput(plan.config, plan.profile), x, y);
  const z0 = plan.config.enclosure.floorThickness;
  const reach = BOSS_DIAMETER + 4;
  const tools = feet.map(({ axis, at, inward }) => {
    // Drawn across the wall, along x or y and up, and pushed along it past the boss either side.
    const outline = draw([at - inward, z0 - 1])
      .lineTo([at + inward * reach, z0 - 1])
      .lineTo([at + inward * reach, z0 + reach])
      .lineTo([at, z0])
      .lineTo([at - inward, z0])
      .close();
    const plane = axis === "y" ? new Plane([x - reach, 0, 0], [0, 1, 0], [1, 0, 0]) : new Plane([0, y + reach, 0], [1, 0, 0], [0, -1, 0]);
    return outline.sketchOnPlane(plane).extrude(2 * reach) as Shape3D;
  });
  return tools.reduce((all, tool) => all.intersect(tool));
}

function shellBlank(plan: BuildPlan, forms: OuterForms): Shape3D {
  const e = plan.config.enclosure;
  const { inner } = plan.profile;
  const { body } = forms;
  let envelope = body;
  for (const slab of forms.slabs.values()) envelope = envelope.cut(slab);
  const innerRadius = Math.max(e.cornerRadius - e.wall, 0.5);
  const cavity = hasRounds(plan)
    ? extrudedPath(plan.profile.cavityPath, e.wall, e.width - e.wall).intersect(roundedPlan(e.wall, e.width - e.wall, e.wall, plan.profile.depth - e.wall, e.cornerRadius > 0 ? innerRadius : 0, -2, plan.profile.maxHeight + 1))
    : roundedVerticals(extrudedProfile(inner, -1, e.wall, e.width - e.wall), e.cornerRadius, innerRadius);
  let shell = envelope.cut(cavity);

  for (const seam of plan.seams) {
    for (const tab of seam.tabs) shell = shell.fuse(envelope.intersect(seamTabSolid(tab, seam)));
  }

  // Bosses rise from the plate to the top, trimmed to the shell's outline, so they
  // print without support from the panel side.
  if (plan.plate?.screws.length) {
    const floorTop = e.floorThickness;
    const height = plan.profile.maxHeight - floorTop + 1;
    const sizes = plateInput(plan.config, plan.profile);
    const columns: Shape3D[] = [];
    plan.plate.screws.forEach(([x, y], i) => {
      const short = plan.plate!.shortBosses[i];
      const slope = short ? bossSlope(sizes, x, y) : null;
      const lift = plan.plate!.lifts[i]!;
      const shortHeight = shortBossTop(sizes, lift) - floorTop;
      const boss = makeCylinder(BOSS_DIAMETER / 2, short ? shortHeight : height, [x, y, floorTop], [0, 0, 1]);
      // Upright, its underside rises from the walls it touches: see bossFeet.
      const under = underBoss(plan, x, y, lift);
      if (!slope) {
        columns.push(under ? boss.cut(under) : boss);
        return;
      }
      // A round can stop the wall short of a boss at the edge of the plate, so it needs tying to it.
      if (!plan.shellOnSide) {
        const across = (BOSS_DIAMETER / 2) * Math.SQRT1_2;
        const wallY = slope[0]![1];
        const tied = boss.fuse(boxSolid([x - across, x + across], [Math.min(y, wallY), Math.max(y, wallY)], [floorTop, floorTop + shortHeight]));
        shell = shell.fuse(envelope.intersect(under ? tied.cut(under) : tied));
        return;
      }
      // It prints on its side, so it slopes back to the wall. Slopes can overlap their
      // neighbours', so these go on one at a time.
      let pen = draw(slope[0]!);
      for (const point of slope.slice(1)) pen = pen.lineTo(point);
      shell = shell.fuse(envelope.intersect(boss.fuse(pen.close().sketchOnPlane("XY", floorTop).extrude(SHORT_BOSS_HEIGHT) as Shape3D)));
    });
    if (columns.length) shell = shell.fuse(envelope.intersect(compoundShapes(columns) as Shape3D));
    const holes = compoundShapes(
      plan.plate.screws.map(([x, y], i) => shellHole(plan, x, y, shellInsertDiameter(plan), INSERT_HOLE_DEPTH + 1 + plan.plate!.lifts[i]!, floorTop - 1)),
    );
    shell = shell.cut(holes as Shape3D);
  }

  if (forms.openingTool) shell = shell.cut(forms.openingTool);
  for (const screw of plan.topScrews) shell = shell.fuse(topScrewTab(plan, screw, envelope));

  // The validator keeps them apart, so they can be cut together, which a vent's many slots need.
  if (plan.wallHoles.length) shell = shell.cut(compoundShapes(plan.wallHoles.map((hole) => wallHoleTool(plan, hole))) as Shape3D);

  if (plan.config.opening?.rail) {
    const { rail, left, right, yBack, xLow, xHigh, yFront, screwY } = railExtents(plan);
    // Cleared for the rail and its feet, then a block over each foot for its screw to reach.
    shell = shell.cut(forms.railTool!);
    shell = shell.cut(boxSolid([xLow - 0.2, xHigh + 0.2], [yFront - 0.2 - 1, yBack + 0.2], [-1, rail.footHeight + 0.2]));
    const blockBase = rail.footHeight + 0.2;
    const blockTop = blockBase + RAIL_BLOCK_HEIGHT;
    const wallY = e.wall - 0.5;
    for (const [x, outward] of [[left, -1], [right, 1]] as const) {
      const block = boxSolid([x - RAIL_FOOT_MARGIN, x + RAIL_FOOT_MARGIN], [wallY, yBack], [blockBase, blockTop]);
      shell = shell.fuse(envelope.intersect(block));
      // The outer side faces the bed as the shell prints, so it slopes back to the wall.
      // This stays above the plate, which only the foot's notch cuts away.
      const edge = x + outward * RAIL_FOOT_MARGIN;
      const slopeBase = Math.max(blockBase, e.floorThickness + 0.2);
      const slope = draw([edge, yBack])
        .lineTo([edge + outward * (yBack - wallY), wallY])
        .lineTo([edge, wallY])
        .close()
        .sketchOnPlane("XY", slopeBase)
        .extrude(blockTop - slopeBase) as Shape3D;
      shell = shell.fuse(envelope.intersect(slope));
    }
    const insert = (x: number) => shellHole(plan, x, screwY, shellInsertDiameter(plan), INSERT_HOLE_DEPTH + 1, blockBase - 1);
    shell = shell.cut(compoundShapes([insert(left), insert(right)]) as Shape3D);
  }
  return shell;
}

// A crease's flange, under the front piece's rear edge, with a hole for each screw: see crease.ts.
// The flange under the front piece, kept out of the rear piece's slab.
function withCreaseFlange(solid: Shape3D, crease: CreaseJoint, forms: OuterForms, plan: BuildPlan): Shape3D {
  const fit = plan.config.fabrication.fit;
  const back = crease.y - CREASE_FLANGE_THICKNESS;
  const flanges = crease.spans.map(([a, b]) => boxSolid([a, b], [back, crease.y], [crease.flangeBottom, crease.flangeTop]));
  const holes = crease.screws.map((x) => makeCylinder(fit.screwHole / 2, CREASE_FLANGE_THICKNESS + 1.01, [x, back - 1, crease.z], [0, 1, 0]));
  const rear = plan.topPieces[crease.rear]!;
  let result = solid.fuse(forms.body.intersect(compoundShapes(flanges) as Shape3D).cut(forms.slabs.get(rear.surface)!));
  if (holes.length) result = result.cut(compoundShapes(holes) as Shape3D);
  return result;
}

// A boss for each screw's insert, under the piece behind, kept out of the front piece's slab.
function withCreaseBosses(solid: Shape3D, crease: CreaseJoint, forms: OuterForms, plan: BuildPlan): Shape3D {
  if (crease.screws.length === 0) return solid;
  const r = CREASE_BOSS_DIAMETER / 2;
  const end = crease.y + CREASE_BOSS_LENGTH;
  const bosses = crease.screws.map((x) => makeCylinder(r, CREASE_BOSS_LENGTH, [x, crease.y, crease.z], [0, 1, 0]).fuse(boxSolid([x - r, x + r], [crease.y, end], [crease.z, crease.bossTop])));
  const front = plan.topPieces[crease.front]!;
  // The rear piece prints face down, so the insert's hole lies on a slope with its underside up.
  // It gets a teardrop's point there, as a shell's sideways insert holes do.
  const hole = plan.config.fabrication.fit.insertHoleSideways / 2;
  const c = hole * Math.SQRT1_2;
  const length = INSERT_HOLE_DEPTH + 0.01;
  // On this plane, x is x and the drawing's up is down, and it extrudes back along y.
  const plane = new Plane([0, crease.y - 0.01, 0], [1, 0, 0], [0, 1, 0]);
  // Each made whole first, since a cut by overlapping solids can quietly do nothing.
  const inserts = crease.screws.map((x) =>
    makeCylinder(hole, length, [x, crease.y - 0.01, crease.z], [0, 1, 0]).fuse(
      draw([x - c, -crease.z + c]).lineTo([x, -crease.z + hole * Math.SQRT2]).lineTo([x + c, -crease.z + c]).close().sketchOnPlane(plane).extrude(length) as Shape3D,
    ),
  );
  const joined = forms.body.intersect(compoundShapes(bosses) as Shape3D).cut(forms.slabs.get(front.surface)!);
  return solid.fuse(joined).cut(compoundShapes(inserts) as Shape3D);
}

const GROOVE_OVERRUN = 0.5; // past each end of the tongue

// The wedge in a top panel's split, drawn across x and into the panel, and run along its surface.
// `grow` makes the groove for it.
function tongueSolid(surface: Surface, joint: TopJoint, grow: number): Shape3D {
  const { x, face, root } = joint;
  const longer = grow > 0 ? GROOVE_OVERRUN : 0;
  const vFrom = joint.vFrom - longer;
  const vTo = joint.vTo + longer;
  const [y, z] = surfacePoint(surface, vFrom, 0);
  // Its y axis is the plane's normal crossed with x, which points into the panel.
  const plane = new Plane([x, y, z], [1, 0, 0], [0, surface.cos, surface.sin]);
  const deep = face + root + grow;
  return draw([-0.5, face - grow])
    .lineTo([-0.5, deep])
    .lineTo([0, deep])
    .lineTo([deep - face + grow, face - grow])
    .close()
    .sketchOnPlane(plane)
    .extrude(vTo - vFrom) as Shape3D;
}

function topBlank(plan: BuildPlan, forms: OuterForms, pieceIndex: number): Shape3D {
  const piece = plan.topPieces[pieceIndex]!;
  const slab = forms.slabs.get(piece.surface)!;
  let solid = forms.body.intersect(slab).intersect(boxSolid([piece.xMin, piece.xMax], [-2, plan.profile.depth + 2], [-1, plan.profile.maxHeight + 3]));
  // The opening comes out after, tongue and all, and the groove comes out last of all.
  const surface = plan.profile.surfaces.find((s) => s.id === piece.surface)!;
  if (piece.tongue) solid = solid.fuse(forms.body.intersect(slab).intersect(tongueSolid(surface, piece.tongue, 0)));
  if (forms.openingTool) solid = solid.cut(forms.openingTool);
  for (const crease of plan.creases) {
    if (crease.front === pieceIndex) solid = withCreaseFlange(solid, crease, forms, plan);
    if (crease.rear === pieceIndex) solid = withCreaseBosses(solid, crease, forms, plan);
  }
  const screws = plan.topScrews.filter((s) => s.piece === pieceIndex);
  if (screws.length) {
    for (const screw of screws) {
      const height = plan.profile.maxHeight + 2 - screw.postBottom;
      const post = makeCylinder(TOP_POST_DIAMETER / 2, height, [screw.x, screw.y, screw.postBottom], [0, 0, 1]);
      solid = solid.fuse(forms.body.intersect(post));
    }
    const holes = screws.map((screw) => makeCylinder(plan.config.fabrication.fit.insertHole / 2, INSERT_HOLE_DEPTH + 0.5, [screw.x, screw.y, screw.postBottom - 0.5], [0, 0, 1]));
    solid = solid.cut(compoundShapes(holes) as Shape3D);
  }
  return solid;
}

// Countersunk from the base, so screw heads end up flush with the underside.
// A countersunk hole up from zBase. Its cone carries on below until it's `widest` across, so that
// it meets a bore under it without a ledge.
export function plateScrewHole(x: number, y: number, thickness: number, diameter: number, zBase = 0, widest = 0): Shape3D {
  const head = COUNTERSINK_DIAMETER / 2;
  const shank = diameter / 2;
  const slope = (head - shank) / COUNTERSINK_DEPTH;
  const overshoot = Math.max(0.2, (widest / 2 - head) / slope + 0.05);
  return draw([0, -overshoot])
    .lineTo([head + slope * overshoot, -overshoot])
    .lineTo([shank, COUNTERSINK_DEPTH])
    .lineTo([shank, thickness + overshoot])
    .lineTo([0, thickness + overshoot])
    .close()
    .sketchOnPlane(new Plane([x, y, zBase], [1, 0, 0], [0, -1, 0]))
    .revolve([0, 0, 1], { origin: [x, y, zBase] }) as Shape3D;
}

function plateBlanks(plan: BuildPlan): Shape3D[] {
  if (!plan.plate) return [];
  const e = plan.config.enclosure;
  const { fit } = plan.config.fabrication;
  const inset = e.wall + plan.plate.clearance;
  const width = e.width - 2 * inset;
  const yFront = plan.profile.plateFront + plan.plate.clearance;
  const yRear = plan.profile.plateRear - plan.plate.clearance;
  const depth = yRear - yFront;
  const radius = e.cornerRadius > 0 ? Math.max(Math.max(e.cornerRadius - e.wall, 0.5) - plan.plate.clearance, 0.2) : 0;
  const outline = radius > 0 ? drawRoundedRectangle(width, depth, radius) : drawRectangle(width, depth);
  let plate = outline.translate(e.width / 2, (yFront + yRear) / 2).sketchOnPlane("XY").extrude(e.floorThickness) as Shape3D;
  const notch = plateNotchFor(plan.config);
  if (notch) plate = plate.cut(boxSolid([notch.xLow, notch.xHigh], [-1, notch.yHigh], [-1, e.floorThickness + 1]));
  if (plan.plate.screws.length) {
    // Upright, a wedge fills the space under each boss's slope, for the screw to pull up against.
    if (!plan.shellOnSide) {
      const footprint = outline.translate(e.width / 2, (yFront + yRear) / 2).sketchOnPlane("XY").extrude(e.floorThickness + BOSS_DIAMETER + 4) as Shape3D;
      // A gusset that reaches under a boss fills that part of the space itself.
      const gussets = plan.topScrews.flatMap((screw) => {
        const surface = plan.profile.surfaces.find((s) => s.id === plan.topPieces[screw.piece]!.surface)!;
        const tab = topTabExtent(screw, e.wall, e.width, screw.wall === "rear" ? surface.y1 + 3 : plan.profile.depth - e.wall, false);
        const depth = tabGussetDepth(tab, screw.wall, e.floorThickness);
        return depth > 0 ? [{ tab, solid: () => topTabGusset(tab, screw.wall, depth) }] : [];
      });
      const wedges = plan.plate.screws.flatMap(([x, y], i) => {
        const under = underBoss(plan, x, y, plan.plate!.lifts[i]!);
        if (!under) return [];
        let wedge = makeCylinder(BOSS_DIAMETER / 2, BOSS_DIAMETER + 1, [x, y, e.floorThickness - 0.5], [0, 0, 1]).intersect(under).intersect(footprint);
        const r = BOSS_DIAMETER / 2;
        for (const { tab, solid } of gussets) {
          if (x + r > tab.xLow && x - r < tab.xHigh && y + r > tab.yLow && y - r < tab.yHigh) wedge = wedge.cut(solid());
        }
        return [wedge];
      });
      if (wedges.length) plate = plate.fuse(compoundShapes(wedges) as Shape3D);
    }
    plate = plate.cut(compoundShapes(plan.plate.screws.map(([x, y], i) => plateScrewHole(x, y, e.floorThickness + plan.plate!.lifts[i]!, fit.screwHole))) as Shape3D);
  }
  const { countersunkHoles, pins } = plan.config.plate;
  if (countersunkHoles.length) {
    plate = plate.cut(compoundShapes(countersunkHoles.map(({ x, y }) => plateScrewHole(x, y, e.floorThickness, fit.screwHole))) as Shape3D);
  }
  for (const pin of pins) {
    plate = plate.fuse(makeCylinder(pin.diameter / 2, pin.height + 0.5, [pin.x, pin.y, e.floorThickness - 0.5], [0, 0, 1]));
    if (pin.tipDiameter && pin.tipHeight) {
      plate = plate.fuse(makeCylinder(pin.tipDiameter / 2, pin.tipHeight + 0.5, [pin.x, pin.y, e.floorThickness + pin.height - 0.5], [0, 0, 1]));
    }
  }
  if (plan.plate.weights.length) {
    const floor = e.floorThickness;
    const pockets = plan.plate.weights.map((weight) => {
      const outer = weightOutline(weight) as { cx: number; cy: number; w: number; h: number };
      const walls = boxSolid([outer.cx - outer.w / 2, outer.cx + outer.w / 2], [outer.cy - outer.h / 2, outer.cy + outer.h / 2], [floor - 0.5, floor + weight.height]);
      return walls.cut(boxSolid([weight.x - weight.width / 2, weight.x + weight.width / 2], [weight.y - weight.depth / 2, weight.y + weight.depth / 2], [floor, floor + weight.height + 1]));
    });
    plate = plate.fuse(compoundShapes(pockets) as Shape3D);
  }
  if (plan.plate.feet.length) {
    plate = plate.cut(compoundShapes(plan.plate.feet.map((foot) => makeCylinder(foot.diameter / 2, FOOT_RECESS + 0.5, [foot.x, foot.y, -0.5], [0, 0, 1]))) as Shape3D);
  }
  if (plan.plate.supports.length) {
    plate = plate.fuse(compoundShapes(plan.plate.supports.map((s) => makeCylinder(s.diameter / 2, s.top - e.floorThickness + 0.5, [s.x, s.y, e.floorThickness - 0.5], [0, 0, 1]))) as Shape3D);
  }
  const { cableTies } = plan.config.plate;
  if (cableTies.length) {
    const top = e.floorThickness;
    plate = plate.fuse(compoundShapes(cableTies.map((tie) => {
      const { xLow, xHigh, yLow, yHigh } = tieExtent(tie);
      const { slotWidth, slotSide, slotHeight, along } = TIE_BRIDGE;
      const half = slotWidth / 2;
      const turned = tie.rotationDeg === 90;
      // A plane's up is down for one of these, because it's what its normal and x direction give.
      const up = turned ? 1 : -1;
      const slot = draw([-half, 0]).lineTo([-half, up * slotSide]).lineTo([0, up * slotHeight]).lineTo([half, up * slotSide]).lineTo([half, 0]).close()
        .sketchOnPlane(turned ? new Plane([xLow - 1, tie.y, top], [0, 1, 0], [1, 0, 0]) : new Plane([tie.x, yLow - 1, top], [1, 0, 0], [0, 1, 0]))
        .extrude(along + 2) as Shape3D;
      return boxSolid([xLow, xHigh], [yLow, yHigh], [top - 0.5, top + TIE_BRIDGE.height]).cut(slot);
    })) as Shape3D);
  }
  // The validator keeps blocks apart, so they can go on together.
  if (plan.holderBlocks.length) plate = plate.fuse(compoundShapes(plan.holderBlocks.map((block) => holderSolid(block, e.floorThickness))) as Shape3D);
  if (plan.plate.jointX === null) return [plate];
  const { positive, negative } = plate.split("YZ", plan.plate.jointX);
  if (!positive || !negative) throw new Error(`The plate joint at x = ${plan.plate.jointX} missed the plate.`);
  if (plan.plate.rib) return withPlateRib(negative as Shape3D, positive as Shape3D, plan.plate.rib, e.floorThickness, fit);
  return [negative as Shape3D, positive as Shape3D];
}

// The rib along the plate's joint: see PLATE_RIB_HEIGHT.
function withPlateRib(left: Shape3D, right: Shape3D, rib: PlateRib, floor: number, fit: Fit): [Shape3D, Shape3D] {
  const { x, yLow, yHigh, bolts } = rib;
  const top = floor + PLATE_RIB_HEIGHT;
  const z = floor + PLATE_RIB_BOLT_Z;
  const r = BOSS_DIAMETER / 2;
  let l = left.fuse(boxSolid([x - PLATE_RIB_LEFT, x], [yLow, yHigh], [floor - 0.5, top]));
  let rr = right.fuse(boxSolid([x, x + PLATE_RIB_RIGHT], [yLow, yHigh], [floor - 0.5, top]));
  // Each boss sits on a block down to the plate, so it needs no support.
  const bosses = bolts.map((y) =>
    makeCylinder(r, PLATE_RIB_BOSS - PLATE_RIB_LEFT + 0.5, [x - PLATE_RIB_BOSS, y, z], [1, 0, 0]).fuse(boxSolid([x - PLATE_RIB_BOSS, x - PLATE_RIB_LEFT + 0.5], [y - r, y + r], [floor - 0.5, z])),
  );
  l = l.fuse(compoundShapes(bosses) as Shape3D);
  // A wedge pointing left, drawn across x and up, and run back along y.
  const middle = floor + PLATE_RIB_TONGUE_Z;
  const wedge = (half: number, inset: number) =>
    draw([x + 0.5, middle - half])
      .lineTo([x, middle - half])
      .lineTo([x - half, middle])
      .lineTo([x, middle + half])
      .lineTo([x + 0.5, middle + half])
      .close()
      .sketchOnPlane(new Plane([0, yHigh - inset, 0], [1, 0, 0], [0, -1, 0]))
      .extrude(yHigh - yLow - 2 * inset) as Shape3D;
  rr = rr.fuse(wedge(PLATE_RIB_TONGUE, PLATE_RIB_END));
  l = l.cut(wedge(PLATE_RIB_TONGUE + PLATE_RIB_FIT, PLATE_RIB_END - 0.5));
  // Inserts go in sideways, so their holes get a point on top.
  const insert = fit.insertHoleSideways / 2;
  const c = insert * Math.SQRT1_2;
  const inserts = bolts.map((y) =>
    makeCylinder(insert, INSERT_HOLE_DEPTH + 0.01, [x - INSERT_HOLE_DEPTH, y, z], [1, 0, 0]).fuse(
      draw([y - c, z + c]).lineTo([y, z + insert * Math.SQRT2]).lineTo([y + c, z + c]).close().sketchOnPlane(new Plane([x - INSERT_HOLE_DEPTH, 0, 0], [0, 1, 0], [1, 0, 0])).extrude(INSERT_HOLE_DEPTH + 0.01) as Shape3D,
    ),
  );
  l = l.cut(compoundShapes(inserts) as Shape3D);
  // Countersunk on the right face, where the driver comes in.
  const head = COUNTERSINK_DIAMETER / 2;
  const shank = fit.screwHole / 2;
  const face = x + PLATE_RIB_RIGHT;
  const cone = ((head - shank) * COUNTERSINK_DEPTH) / (head - SCREW_CLEARANCE_DIAMETER / 2);
  const holes = bolts.map((y) =>
    draw([x - 0.5, 0])
      .lineTo([x - 0.5, shank])
      .lineTo([face - cone, shank])
      .lineTo([face, head])
      .lineTo([face + 1, head])
      .lineTo([face + 1, 0])
      .close()
      .sketchOnPlane(new Plane([0, y, z], [1, 0, 0], [0, 0, 1]))
      .revolve([1, 0, 0], { origin: [0, y, z] }) as Shape3D,
  );
  rr = rr.cut(compoundShapes(holes) as Shape3D);
  return [l, rr];
}

function acrossSeam(diameter: number, length: number, x: number, [y, z]: Point2) {
  return makeCylinder(diameter / 2, length, [x, y, z], [1, 0, 0]);
}

// Each bolt goes through a countersink on the left, into a heat-set insert on the right. Both
// print without needing a flat seat. The head's bore runs through the tab's slope, which rises
// away from the wall as the half prints, so it's a teardrop pointing that way: round, its far side
// would leave a sliver of the slope starting in mid-air, which cost about 3 m of support per bolt
// in ElegooSlicer. The point has a 45 degree roof where it meets the countersink.
function seamBoltLeftHole(seam: PlannedSeam, [y, z]: Point2, boltDiameter: number): Shape3D {
  const head = COUNTERSINK_DIAMETER / 2;
  const shank = boltDiameter / 2;
  const far = seam.x - seam.ribHalfThickness;
  const clearOut = seam.ribWidth + FRAME_OVERLAP + 1;
  const coneDepth = (head - shank) / ((head - SCREW_CLEARANCE_DIAMETER / 2) / COUNTERSINK_DEPTH);
  const round = draw([far - clearOut, 0])
    .lineTo([far - clearOut, head])
    .lineTo([far, head])
    .lineTo([far + coneDepth, shank])
    .lineTo([seam.x + 1, shank])
    .lineTo([seam.x + 1, 0])
    .close()
    .sketchOnPlane(new Plane([0, y, z], [1, 0, 0], [0, 0, 1]))
    .revolve([1, 0, 0], { origin: [0, y, z] }) as Shape3D;
  const tab = nearestTab(seam, [y, z]);
  if (!tab) return round;
  // Across the bolt, in y and z: which way is up the slope, and square to that.
  const [iy, iz] = tab.inward;
  const length = Math.hypot(iy, iz);
  const [uy, uz] = [iy / length, iz / length];
  const c = head * Math.SQRT1_2;
  const apex = head * Math.SQRT2;
  const point = draw([y + uy * c - uz * c, z + uz * c + uy * c])
    .lineTo([y + uy * apex, z + uz * apex])
    .lineTo([y + uy * c + uz * c, z + uz * c - uy * c])
    .close()
    .sketchOnPlane(new Plane([far - clearOut, 0, 0], [0, 1, 0], [1, 0, 0]))
    .extrude(clearOut + apex) as Shape3D;
  // Drawn along the slope and x, and pushed across it either side.
  const roof = draw([0, far - clearOut])
    .lineTo([apex, far - clearOut])
    .lineTo([apex, far])
    .lineTo([0, far + apex])
    .close()
    .sketchOnPlane(new Plane([0, y - uz * apex, z + uy * apex], [0, uy, uz], [0, uz, -uy]))
    .extrude(2 * apex) as Shape3D;
  return round.fuse(point.intersect(roof));
}

// The tab a seam bolt goes through: the one whose line it's nearest.
function nearestTab(seam: PlannedSeam, [y, z]: Point2): SeamTab | null {
  let best: SeamTab | null = null;
  let bestDistance = Infinity;
  for (const tab of seam.tabs) {
    const [ay, az] = tab.start;
    const [by, bz] = tab.end;
    const dy = by - ay;
    const dz = bz - az;
    const t = Math.max(0, Math.min(1, ((y - ay) * dy + (z - az) * dz) / (dy * dy + dz * dz || 1)));
    const distance = Math.hypot(y - (ay + t * dy), z - (az + t * dz));
    if (distance < bestDistance) {
      bestDistance = distance;
      best = tab;
    }
  }
  return best;
}

// Seam inserts print upright, because a shell half prints with its seam facing up.
function joinAtSeam(left: Shape3D, right: Shape3D, seam: PlannedSeam, fit: Fit): [Shape3D, Shape3D] {
  let l = left.cut(compoundShapes(seam.bolts.map((point) => seamBoltLeftHole(seam, point, fit.screwHole))) as Shape3D);
  let r = right.cut(compoundShapes(seam.bolts.map((point) => acrossSeam(fit.insertHole, INSERT_HOLE_DEPTH + 1, seam.x - 1, point))) as Shape3D);
  for (const point of seam.pins) {
    l = l.fuse(acrossSeam(PIN_DIAMETER, seam.pinLength + 1, seam.x - 1, point));
    r = r.cut(acrossSeam(fit.pinSocket, seam.pinLength + 1, seam.x - 0.5, point));
  }
  return [l, r];
}

function splitAtSeams(shell: Shape3D, seams: PlannedSeam[], fit: Fit): Shape3D[] {
  const parts: Shape3D[] = [];
  let remaining = shell;
  for (const seam of [...seams].sort((a, b) => a.x - b.x)) {
    const { positive, negative } = remaining.split("YZ", seam.x);
    if (!positive || !negative) throw new Error(`The seam at x = ${seam.x} missed the shell.`);
    const [left, right] = joinAtSeam(negative as Shape3D, positive as Shape3D, seam, fit);
    parts.push(left);
    remaining = right;
  }
  parts.push(remaining);
  return parts;
}

// A shape as it goes on the bed.
export function placedOnBed(shape: Shape3D, matrix: Matrix, offset: readonly [number, number, number]): Shape3D {
  const oc = getOC();
  const transform = new oc.gp_Trsf();
  const m = matrix;
  transform.SetValues(m[0], m[1], m[2], offset[0], m[3], m[4], m[5], offset[1], m[6], m[7], m[8], offset[2]);
  const builder = new oc.BRepBuilderAPI_Transform(shape.wrapped, transform, true, false);
  const placed = cast(builder.ModifiedShape(shape.wrapped)) as Shape3D;
  builder.delete();
  transform.delete();
  return placed;
}

function surfacePlane(surface: Surface, normal: number): Plane {
  const [y, z] = surfacePoint(surface, 0, normal);
  return new Plane([0, y, z], [1, 0, 0], [0, -surface.sin, surface.cos]);
}

export function cutoutTool(cutout: PlacedCutout, surface: Surface, thickness: number): Shape3D {
  const plane = () => surfacePlane(surface, -(thickness + TOOL_OVERSHOOT_BELOW));
  const through = thickness + TOOL_OVERSHOOT_BELOW + TOOL_OVERSHOOT_ABOVE;
  const width = cutout.width ?? 0;
  const height = cutout.height ?? 0;
  // One tool for all of a hole's steps, because overlapping tools crash a batched cut.
  const withNotches = (tool: Shape3D, notches: PlacedNotch[] | undefined, length: number) =>
    (notches ?? []).reduce((joined, notch) => joined.fuse(drawRectangle(notch.width, notch.height).translate(notch.u, notch.v).sketchOnPlane(plane()).extrude(length) as Shape3D), tool);
  if (cutout.kind === "circle") {
    return withNotches(drawCircle(cutout.diameter! / 2).translate(cutout.u, cutout.v).sketchOnPlane(plane()).extrude(through) as Shape3D, cutout.notches, through);
  }
  if (cutout.kind === "rect") {
    const outline = cutout.cornerRadius ? drawRoundedRectangle(width, height, cutout.cornerRadius) : drawRectangle(width, height);
    let window = withNotches(outline.translate(cutout.u, cutout.v).sketchOnPlane(plane()).extrude(through) as Shape3D, cutout.notches, through);
    if (cutout.bevel) {
      // Lofted from just above the face, at 45 degrees, down to the window's own size.
      const b = cutout.bevel;
      const at = (normal: number, grow: number) =>
        (cutout.cornerRadius ? drawRoundedRectangle(width + 2 * grow, height + 2 * grow, cutout.cornerRadius + grow) : drawRectangle(width + 2 * grow, height + 2 * grow))
          .translate(cutout.u, cutout.v)
          .sketchOnPlane(surfacePlane(surface, normal)) as Sketch;
      window = window.fuse(at(TOOL_OVERSHOOT_ABOVE, b + TOOL_OVERSHOOT_ABOVE).loftWith(at(-b, 0)));
    }
    if (!cutout.recess) return window;
    const { recess } = cutout;
    const depth = thickness - recess.skin + TOOL_OVERSHOOT_BELOW;
    const pocket = withNotches(drawRectangle(recess.width, recess.height).translate(recess.u, recess.v).sketchOnPlane(plane()).extrude(depth) as Shape3D, recess.notches, depth);
    return window.fuse(pocket);
  }
  const depth = thickness - cutout.skin! + TOOL_OVERSHOOT_BELOW;
  return drawRoundedRectangle(width, height, pocketRadius(cutout)).translate(cutout.u, cutout.v).sketchOnPlane(plane()).extrude(depth) as Shape3D;
}

function pocketRadius(cutout: PlacedCutout): number {
  return Math.min(POCKET_CORNER_RADIUS, Math.min(cutout.width!, cutout.height!) / 4);
}

// What a cutout should remove, for checking the booleans against arithmetic.
// How much a hole's notches add to it, counted on a fine grid, since they overlap it and each other.
function notchArea(notches: PlacedNotch[] | undefined, inHole: (u: number, v: number) => boolean): number {
  if (!notches?.length) return 0;
  const step = 0.02;
  const uLow = Math.min(...notches.map((n) => n.u - n.width / 2));
  const uHigh = Math.max(...notches.map((n) => n.u + n.width / 2));
  const vLow = Math.min(...notches.map((n) => n.v - n.height / 2));
  const vHigh = Math.max(...notches.map((n) => n.v + n.height / 2));
  let cells = 0;
  for (let u = uLow + step / 2; u < uHigh; u += step) {
    for (let v = vLow + step / 2; v < vHigh; v += step) {
      if (!inHole(u, v) && notches.some((n) => Math.abs(u - n.u) <= n.width / 2 && Math.abs(v - n.v) <= n.height / 2)) cells += 1;
    }
  }
  return cells * step * step;
}

export function cutoutVolume(cutout: PlacedCutout, thickness: number): number {
  const cornerLoss = (r: number) => (4 - Math.PI) * r * r;
  if (cutout.kind === "circle") {
    const r = cutout.diameter! / 2;
    return (Math.PI * r * r + notchArea(cutout.notches, (u, v) => Math.hypot(u - cutout.u, v - cutout.v) <= r)) * thickness;
  }
  const area = cutout.width! * cutout.height!;
  if (cutout.kind === "rect") {
    const inRect = (box: { u: number; v: number; width: number; height: number }) => (u: number, v: number) => Math.abs(u - box.u) <= box.width / 2 && Math.abs(v - box.v) <= box.height / 2;
    const window = area - cornerLoss(cutout.cornerRadius ?? 0) + notchArea(cutout.notches, inRect(cutout as Required<Pick<PlacedCutout, "u" | "v" | "width" | "height">>));
    // What the bevel adds: the window grown by s, from s = 0 down at its foot to the bevel at the face.
    const b = cutout.bevel ?? 0;
    const r = cutout.cornerRadius ?? 0;
    const grown = (s: number) => 2 * (cutout.width! + cutout.height!) * s + 4 * s * s - (r > 0 ? (4 - Math.PI) * ((r + s) ** 2 - r * r) : 0);
    const steps = 200;
    let bevel = 0;
    for (let i = 0; i < steps; i++) bevel += grown(((i + 0.5) / steps) * b) * (b / steps);
    if (!cutout.recess) return window * thickness + bevel;
    const recessArea = cutout.recess.width * cutout.recess.height + notchArea(cutout.recess.notches, inRect(cutout.recess));
    return window * cutout.recess.skin + recessArea * (thickness - cutout.recess.skin) + bevel;
  }
  return (area - cornerLoss(pocketRadius(cutout))) * (thickness - cutout.skin!);
}

// A label's plane, looking at it from outside so that it reads properly, `normal` out from the face.
function labelPlane(label: PlacedLabel, plan: BuildPlan, normal: number): Plane {
  const { on } = label;
  if (on.kind === "surface") {
    const surface = plan.profile.surfaces.find((s) => s.id === on.surface)!;
    const [y, z] = surfacePoint(surface, on.v, normal);
    return new Plane([on.u, y, z], [1, 0, 0], [0, -surface.sin, surface.cos]);
  }
  const { width } = plan.config.enclosure;
  const { depth } = plan.profile;
  if (on.wall === "front") return new Plane([on.at, -normal, on.z], [1, 0, 0], [0, -1, 0]);
  if (on.wall === "rear") return new Plane([on.at, depth + normal, on.z], [-1, 0, 0], [0, 1, 0]);
  if (on.wall === "left") return new Plane([-normal, on.at, on.z], [0, -1, 0], [-1, 0, 0]);
  return new Plane([width + normal, on.at, on.z], [0, 1, 0], [1, 0, 0]);
}

// What cuts a label, as one tool per letter. Letters don't touch, so they can go in one batch.
export function labelTools(label: PlacedLabel, plan: BuildPlan): Shape3D[] {
  const turn = ([x, y]: readonly [number, number]): [number, number] => {
    if (label.rotationDeg === 90) return [-y, x];
    if (label.rotationDeg === 180) return [-x, -y];
    if (label.rotationDeg === 270) return [y, -x];
    return [x, y];
  };
  const prism = (loop: readonly (readonly [number, number])[], normal: number, length: number) => {
    let pen = draw(turn(loop[0]!));
    for (const point of loop.slice(1)) pen = pen.lineTo(turn(point));
    return pen.close().sketchOnPlane(labelPlane(label, plan, normal)).extrude(length) as Shape3D;
  };
  return textOutline(label.text, label.size).glyphs.map(({ outers, holes }) => {
    const solid = compoundShapes(outers.map((loop) => prism(loop, -label.depth, label.depth + TOOL_OVERSHOOT_ABOVE))) as Shape3D;
    if (holes.length === 0) return solid;
    return solid.cut(compoundShapes(holes.map((loop) => prism(loop, -label.depth - 0.5, label.depth + TOOL_OVERSHOOT_ABOVE + 1))) as Shape3D);
  });
}

// What fills a printed part's inlaid labels, by colour: the plastic their engraving took out.
export function labelInlays(plan: BuildPlan, index: number, blank: Shape3D): { color: string; shape: Shape3D }[] {
  const inlaid = plan.labels.filter((label) => label.printedPart === index && label.color);
  const colors = [...new Set(inlaid.map((label) => label.color!))];
  return colors.map((color) => {
    const letters = inlaid.filter((label) => label.color === color).flatMap((label) => labelTools(label, plan));
    return { color, shape: blank.intersect(compoundShapes(letters) as Shape3D) };
  });
}

function cutPart(blank: Shape3D, index: number, plan: BuildPlan): Shape3D {
  const cutouts = plan.cutouts.filter((c) => c.printedPart === index);
  const labels = plan.labels.filter((label) => label.printedPart === index);
  if (cutouts.length === 0 && labels.length === 0) return blank;
  const thickness = plan.config.enclosure.panelThickness;
  const tools = [
    ...cutouts.map((c) => cutoutTool(c, plan.profile.surfaces.find((s) => s.id === c.surface)!, thickness)),
    ...labels.flatMap((label) => labelTools(label, plan)),
  ];
  return blank.cut(compoundShapes(tools) as Shape3D);
}

// Screw posts on a surface, with their holes.
export function withPosts(shape: Shape3D, posts: Pick<PlacedPost, "u" | "v" | "diameter" | "reach" | "holeDiameter" | "holeDepth">[], surfaceOf: (index: number) => Surface): Shape3D {
  if (posts.length === 0) return shape;
  const along = (post: (typeof posts)[number], surface: Surface, normal: number, radius: number, length: number) => {
    const [y, z] = surfacePoint(surface, post.v, normal);
    return makeCylinder(radius, length, [post.u, y, z], [0, -surface.sin, surface.cos]);
  };
  const bodies = posts.map((post, i) => along(post, surfaceOf(i), -post.reach, post.diameter / 2, post.reach - POST_ROOT_DEPTH));
  const holes = posts.map((post, i) => along(post, surfaceOf(i), -post.reach - 0.5, post.holeDiameter / 2, post.holeDepth + 0.5));
  // Batched, because fusing them one at a time more than doubles the time to move a part.
  return shape.fuse(compoundShapes(bodies) as Shape3D).cut(compoundShapes(holes) as Shape3D);
}

// Posts go on after the cutouts, because they stand inside recesses. A groove for the next
// piece's tongue goes after those, so that no post or screw boss fills it.
function addPosts(shape: Shape3D, index: number, plan: BuildPlan): Shape3D {
  const posts = plan.posts.filter((p) => p.printedPart === index);
  const posted = withPosts(shape, posts, (i) => plan.profile.surfaces.find((s) => s.id === posts[i]!.surface)!);
  const piece = plan.topPieces.find((p) => p.printedPart === index);
  if (!piece?.groove) return posted;
  return posted.cut(tongueSolid(plan.profile.surfaces.find((s) => s.id === piece.surface)!, piece.groove, TONGUE_FIT));
}

export function buildEnclosure(plan: BuildPlan): Enclosure {
  const stagesMs: Record<string, number> = {};
  const timed = <T>(name: string, fn: () => T): T => {
    const start = performance.now();
    const result = fn();
    stagesMs[name] = performance.now() - start;
    return result;
  };
  const forms = timed("forms", () => outerForms(plan));
  const shell = timed("shell", () => shellBlank(plan, forms));
  const blanks = timed("split", () => splitAtSeams(shell, plan.seams, plan.config.fabrication.fit));
  const parts: BuiltPart[] = [];
  const add = (blank: Shape3D) => {
    const index = parts.length;
    const printed = plan.printedParts[index]!;
    const cut = timed(`cut${index}`, () => cutPart(blank, index, plan));
    parts.push({ index, kind: printed.kind, name: printed.name, color: printed.color, blank, cut, shape: addPosts(cut, index, plan) });
  };
  blanks.forEach(add);
  timed("top", () => plan.topPieces.forEach((_, i) => add(topBlank(plan, forms, i))));
  timed("plate", () => plateBlanks(plan).forEach(add));
  if (plan.config.opening?.rail) timed("rail", () => add(railPart(plan, forms.body)));
  timed("knobs", () => plan.knobs.forEach((knob) => add(knobSolid(knob, plan.profile.surfaces.find((surface) => surface.id === knob.surface)!))));
  return { parts, stagesMs };
}

// cos and sin of a twentieth of a turn's worth, 2π / 18, written out so that every machine places
// the flutes the same way.
const FLUTE_STEP = { cos: 0.9396926207859084, sin: 0.3420201433256687 };

// A knob where it goes, over its shaft, along the surface's normal: fluted round its side, with a
// groove across its top over the shaft's flat, and a D hole up into it from below.
export function knobSolid(knob: PlannedKnob, surface: Surface): Shape3D {
  const r = knob.diameter / 2;
  const plane = (normal: number) => {
    const [y, z] = surfacePoint(surface, knob.v, normal);
    return new Plane([knob.u, y, z], [1, 0, 0], [0, -surface.sin, surface.cos]);
  };
  if (knob.key) return capSolid(knob, knob.key, plane);
  const bottom = knob.underside;
  const tall = knob.height;
  let solid = drawCircle(r).sketchOnPlane(plane(bottom)).extrude(tall) as Shape3D;
  // Flutes round the side, for grip.
  const flutes: Shape3D[] = [];
  let [c, s] = [1, 0];
  for (let i = 0; i < KNOB_GRIP_COUNT; i++) {
    flutes.push(drawCircle(0.8).translate((r + 0.3) * c, (r + 0.3) * s).sketchOnPlane(plane(bottom - 1)).extrude(tall + 2) as Shape3D);
    [c, s] = [c * FLUTE_STEP.cos - s * FLUTE_STEP.sin, s * FLUTE_STEP.cos + c * FLUTE_STEP.sin];
  }
  solid = solid.cut(compoundShapes(flutes) as Shape3D);
  // The pointer, from the middle to the edge, over the flat.
  const [tu, tv] = knob.toward;
  const { width, depth } = KNOB_POINTER;
  const pointer = (tv !== 0 ? drawRectangle(width, r + 1) : drawRectangle(r + 1, width)).translate((tu * (r + 1)) / 2, (tv * (r + 1)) / 2);
  solid = solid.cut(pointer.sketchOnPlane(plane(bottom + tall - depth)).extrude(depth + 1) as Shape3D);
  // The shaft's hole, with its flat on the pointer's side.
  const { hole } = knob;
  let bore = drawCircle(hole.diameter / 2).sketchOnPlane(plane(bottom - 1)).extrude(hole.depth + 1) as Shape3D;
  if (hole.flat !== null) {
    const off = hole.flat - hole.diameter / 2; // from the middle to the flat
    const big = hole.diameter + 2;
    const beyond = drawRectangle(big, big).translate(tu * (off + big / 2), tv * (off + big / 2));
    bore = bore.cut(beyond.sketchOnPlane(plane(bottom - 2)).extrude(hole.depth + 4) as Shape3D);
  }
  return solid.cut(bore);
}

// A key cap where it goes, over its switch: a flat top with rounded corners, on a round collar that
// the stem's cross goes up into. Printed top down, the socket opens upwards, and nothing overhangs.
function capSolid(knob: PlannedKnob, key: PlannedCap, plane: (normal: number) => Plane): Shape3D {
  const corner = Math.min(1.5, key.width / 4, key.depth / 4);
  const top = drawRoundedRectangle(key.width, key.depth, corner).sketchOnPlane(plane(key.topUnderside)).extrude(key.thickness) as Shape3D;
  const collar = drawCircle(CAP_COLLAR / 2).sketchOnPlane(plane(knob.underside)).extrude(key.topUnderside - knob.underside + 0.01) as Shape3D;
  const [length, width] = key.cross;
  const height = key.socketTop - knob.underside + 1;
  const cross = (drawRectangle(length, width).sketchOnPlane(plane(knob.underside - 1)).extrude(height) as Shape3D).fuse(drawRectangle(width, length).sketchOnPlane(plane(knob.underside - 1)).extrude(height) as Shape3D);
  return top.fuse(collar).cut(cross);
}

// Re-cuts one printed part after its cutouts change, reusing its blank. The shell and
// seams must be unchanged, or the blanks are out of date.
export function recutPart(enclosure: Enclosure, plan: BuildPlan, index: number): void {
  const part = enclosure.parts[index];
  if (!part) throw new Error(`There is no printed part ${index}.`);
  part.cut = cutPart(part.blank, index, plan);
  part.shape = addPosts(part.cut, index, plan);
}
