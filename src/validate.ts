// Turns untrusted input into a BuildPlan, or a list of located problems. The engine
// only accepts a BuildPlan, so nothing can reach the geometry without passing here.
// That matters: overlapping cutouts crash the engine, and exact tangents or seam
// crossings produce wrong geometry with no error at all.
import { configSchema, type Config, type Cutout, type FloorPart, type PanelPart, type Part } from "./schema.js";
import { footprintShape, gap, halfExtents, polygonCrossesChain, polygonInside, polygonsOverlap, rotateOffset, type Rotation, type Shape } from "./geometry.js";
import { highestFloor, rearTangentLength, buildProfile, buildSurfaces, layoutSeamFasteners, lowestHeight, surfacePoint, tabSection, type Point2, type Profile, type SeamFasteners, type SeamTab, type Surface } from "./profile.js";
import { library, materials } from "./library.js";
import { shellPrintsOnSide } from "./printing.js";
import { clearSpans, CREASE_BOSS_DIAMETER, CREASE_BOSS_LENGTH, CREASE_FLANGE_THICKNESS, creaseGeometry, layoutCreaseScrews, type CreaseJoint } from "./crease.js";
import { blocksTopDriver, tabGussetDepth, TOP_TAB_LENGTH, TOP_TAB_THICKNESS, MIN_TOP_SCREWS, MIN_TOP_SCREW_SPACING, TOP_POST_DIAMETER, postBottomAt, topScrewProblem, topTabExtent, type TopJoint, type TopObstacles, type TopPiece, type TopScrew, type TopScrewWall, GROOVE_DEPTH, MIN_TONGUE_ROOT, TONGUE_FIT, TONGUE_INSET, TONGUE_ROOT } from "./top.js";
import { textOutline, unsupportedCharacters } from "./lettering.js";
import { planPins, type PinBudget } from "./pins.js";
import { capFit, DEFAULT_KNOB_COLOR, knobFit, type PlannedKnob } from "./knob.js";
import { BARB_REACH, holderBlocks, STANDOFF_HOLE_FLOOR, portTarget, TIE_BRIDGE, tieExtent, ventSlots, type HolderBlock, type PlannedWallHole } from "./fixtures.js";
import { panelWireRooms, floorWireRooms, wallWireRooms, wireRoomProblem, floorBlock, routeWire, WIRE_BUNDLE, type Point3, type WireObstacle, type WireRoom, type WireRoute } from "./wiring.js";
import { BOSS_DIAMETER, bossProblem, chosenBossLift, shortBossTop, INSERT_HOLE_DEPTH, INSERT_HOLE_DIAMETER, choosePlateJoints, samePlatePiece, DRIVER_DIAMETER, isShortBoss, layoutPlateScrews, MIN_SCREW_SPACING, plateRows, SEAM_DRIVER_ROOM, SHORT_BOSS_HEIGHT, supportProblem, supportTop, footProblem, type PlannedFoot, weightOutline, weightProblem, type PlannedWeight, surfaceSpan, layoutPlateRibBolts, plateRibBoltProblem, plateRibSpan, PLATE_RIB_BOSS, PLATE_RIB_END, PLATE_RIB_HEIGHT, PLATE_RIB_LEFT, PLATE_RIB_RIGHT, PLATE_RIB_TONGUE, type BossObstacles, type PlannedSupport, type PlateRib, type PlatePlanInput, type RibObstacle, type SeamDriverPath } from "./plate.js";

export const PART_CLEARANCE = 1; // between the bodies of neighbouring parts
export const SMALL_HOLE = 2; // holes below this rarely print round
export const MIN_RIB_WIDTH = 7; // fits an M3 clearance hole with walls around it
export const MIN_RIB_HALF_THICKNESS = 3.5; // leaves a usable pin in a blind socket
export const MIN_PART_WIDTH = 40;
export const PIN_ALLOWANCE = 1.5; // the rib keeps this much behind each pin
export const LIP_GAP = 0.2; // round a seam's lip, in the step it fits over
export const MIN_LIP = 1;
export const MIN_LABEL_SIZE = 3.5;
const MIN_STANDOFF_WALL = 0.8; // two lines from a 0.4 mm nozzle
const LABEL_GAP = 1.5; // from a part or hole it's for
const LABEL_CLEAR = 0.6; // from any hole, or another label
export const MAX_SURFACE_ANGLE = 75;
export const MIN_CREASE_ANGLE = 1; // below this, two surfaces should just be one
export const TOOL_OVERSHOOT_ABOVE = 0.2; // how far cut tools extend past each surface
export const TOOL_OVERSHOOT_BELOW = 0.5;
export const POST_ROOT_DEPTH = 0.6; // how far below the outer face a post is rooted
const MIN_PLATE_SCREWS = 3;
const TAB_TOUCH_MARGIN = 0.5;
const FASTENER_MATCH = 4; // how far a screw can have shifted and still be the one a removal names
// When screws look too far apart. These are judgement, not test results, so they only warn.
const PLATE_GAP_FACTOR = 1.5; // of the plate's screw spacing
const TOP_SCREW_GAP = 135;
const TOP_SCREW_FREE_END = 90; // a panel's end has nothing on its other side, so it's held less
const ROW_REACH = 12; // how far from a wall's line a screw still counts as on that wall
const MIN_ROUND_PAST_WALL = 2; // so that a round leaves the wall a curve of its own
const MIN_FLAT_BASE = 40;
const SKIMMING = 0.01; // keeps a body that starts on a surface from counting as crossing it

export type IssueCode =
  | "SCHEMA_INVALID"
  | "DUPLICATE_ID"
  | "UNKNOWN_PART"
  | "FIT_TEST_PART_INVALID"
  | "UNKNOWN_SURFACE"
  | "WRONG_MOUNT"
  | "SURFACE_INVALID"
  | "GEOMETRY_IMPOSSIBLE"
  | "WALL_TOO_THIN"
  | "PANEL_THICKNESS_UNSUITABLE"
  | "SKIN_INVALID"
  | "CUTOUTS_TOO_CLOSE"
  | "CUTOUT_OUTSIDE_SURFACE"
  | "CUTOUT_CROSSES_SEAM"
  | "CUTOUT_HITS_RIB"
  | "BODIES_COLLIDE"
  | "BODY_HITS_RIB"
  | "BODY_HITS_ENCLOSURE"
  | "SEAM_INVALID"
  | "SEAM_UNBRACED"
  | "PLATE_INVALID"
  | "TOP_PANEL_INVALID"
  | "FASTENER_GAP"
  | "FASTENER_CHANGE_UNUSED"
  | "WALL_HOLE_INVALID"
  | "LABEL_INVALID"
  | "LABEL_HIDDEN"
  | "PORT_UNREACHED"
  | "BOARD_HOLDER_INVALID"
  | "BOARD_HOLDER_SKIPPED"
  | "OPENING_INVALID"
  | "PART_TOO_LARGE"
  | "SMALL_HOLE"
  | "UNVERIFIED_PART"
  | "PINS_SHORT"
  | "ERGONOMICS"
  | "WIRE_ROOM"
  | "WIRE_ROUTE"
  | "KNOB_INVALID";

export interface Issue {
  severity: "error" | "warning";
  code: IssueCode;
  message: string;
  path: string; // where to look in the config, such as components[3]
  componentIds: string[];
  where?: IssueBox; // where it is, for showing it when the path alone can't say
}

export interface IssueBox {
  min: [number, number, number];
  max: [number, number, number];
}

export interface PlacedCutout {
  id: string;
  componentId: string;
  surface: string;
  printedPart: number;
  kind: Cutout["kind"];
  u: number;
  v: number;
  diameter?: number;
  width?: number;
  height?: number;
  cornerRadius?: number;
  skin?: number;
  notches?: PlacedNotch[];
  recess?: { u: number; v: number; width: number; height: number; skin: number; notches?: PlacedNotch[] };
  bevel?: number;
}

export interface PlacedNotch {
  u: number;
  v: number;
  width: number;
  height: number;
}

// Text to engrave, with its size as it sits there, so turned if it's turned.
export interface PlacedLabel {
  text: string;
  size: number;
  depth: number;
  rotationDeg: Rotation;
  printedPart: number;
  color?: string; // inlaid in it
  across: number;
  up: number;
  on: { kind: "surface"; surface: string; u: number; v: number } | { kind: "wall"; wall: PlannedWallHole["wall"]; at: number; z: number };
}

export interface PlacedPost {
  componentId: string;
  surface: string;
  printedPart: number;
  u: number;
  v: number;
  diameter: number;
  reach: number;
  holeDiameter: number;
  holeDepth: number;
}

export type { HolderBlock, PlannedWallHole } from "./fixtures.js";

export interface PlatePlan {
  clearance: number;
  joints: number[]; // where it splits, left to right
  screws: Point2[];
  shortBosses: boolean[]; // for each screw, whether its boss stops just past the insert
  lifts: number[]; // for each screw, how far up its insert is, over a sloped underside on an upright shell: see bossLift
  supports: PlannedSupport[];
  weights: PlannedWeight[];
  feet: PlannedFoot[];
  ribs: PlateRib[]; // one along each joint, if the joints are ribbed
}

export interface HardwareItem {
  name: string;
  count: number;
}

export interface PrintedPart {
  index: number;
  kind: "shell" | "top" | "plate" | "rail" | "knob";
  name: string;
  color: string;
  xMin: number;
  xMax: number;
  size: [number, number, number];
}

export interface PlannedSeam extends SeamFasteners {
  x: number;
  ribWidth: number;
  ribHalfThickness: number;
  lip: number;
  pinLength: number;
}

// A screw that can be changed, for showing and editing it. One the config adds has its index
// in that list, and a problem if it can't go there.
export interface PlannedFastener {
  id: string;
  kind: "plate" | "top";
  x: number;
  y: number;
  z: number; // the bottom of its boss or post
  surface: string | null; // the top panel's, for a top screw
  wall: TopScrewWall | null;
  addedAt: number | null;
  problem: string | null;
}

// A line along a wall that screws can sit on. `at` runs from `from` to `to` along it.
export interface FastenerEdge {
  kind: "plate" | "top";
  surface: string | null;
  wall: TopScrewWall;
  along: "x" | "y";
  fixed: number;
  from: number;
  to: number;
}

export interface PlannedFasteners {
  items: PlannedFastener[];
  edges: FastenerEdge[];
}

// Where wires leave each part, and their ways across the floor to the boards they go to: see wiring.ts.
export interface WiringPlan {
  rooms: WireRoom[];
  routes: WireRoute[];
}

export interface BuildPlan {
  wiring: WiringPlan;
  config: Config;
  profile: Profile;
  seams: PlannedSeam[];
  cutouts: PlacedCutout[];
  posts: PlacedPost[];
  plate: PlatePlan | null;
  wallHoles: PlannedWallHole[];
  labels: PlacedLabel[];
  holderBlocks: HolderBlock[];
  topPieces: TopPiece[];
  topScrews: TopScrew[];
  creases: CreaseJoint[];
  shellOnSide: boolean; // which its features are shaped for
  fasteners: PlannedFasteners;
  printedParts: PrintedPart[];
  hardware: HardwareItem[];
  assembly: string[]; // the order that keeps every screw reachable
  steps: { text: string; parts: number[] }[]; // the same, with the printed parts each involves
  pins: PinBudget | null; // with no microcontroller in the design, there's nothing to count against
  knobs: PlannedKnob[];
}

export type ValidationResult =
  | { ok: true; plan: BuildPlan; warnings: Issue[] }
  | { ok: false; errors: Issue[]; warnings: Issue[]; fasteners?: PlannedFasteners };

interface PlacedShape {
  cutout: PlacedCutout;
  shape: Shape;
  surface: Surface;
  index: number;
  notch?: true; // part of the cutout before it, as far as cutting goes
}

interface Placed {
  id: string;
  index: number;
  part: Part;
  surface: Surface | null;
  shape(which: "above" | "below"): Shape;
}

type PanelPlaced = Placed & { part: PanelPart; surface: Surface };
type FloorPlaced = Placed & { part: FloorPart };

interface Limits {
  minWall: number;
  minWeb: number;
  minSkin: number;
}

const mm = (value: number) => `${Math.round(value * 100) / 100} mm`;
const degrees = (radians: number) => (radians * 180) / Math.PI;

// `wiring: false` leaves the wires' rooms and routes out, which only ever warn, for a caller that
// only counts errors and validates many times over, such as the search for a spot for a new part.
export function validateConfig(input: unknown, { wiring: withWiring = true }: { wiring?: boolean } = {}): ValidationResult {
  const parsed = configSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      warnings: [],
      errors: parsed.error.issues.map((issue) => ({
        severity: "error",
        code: "SCHEMA_INVALID",
        message: issue.message,
        path: formatPath(issue.path),
        componentIds: [],
      })),
    };
  }
  const config = parsed.data;
  const issues = new Issues();
  const limits: Limits = { ...materials[config.fabrication.material], ...definedOnly(config.fabrication) };

  checkWalls(config, limits, issues);
  const profile = planProfile(config, issues);
  if (!profile) return issues.failure();
  checkProfileRadii(config, profile, issues);
  const shellParts = planPrintedParts(config, profile, issues);
  checkOpening(config, profile, issues);
  const topPieces = planTopPieces(config, profile, shellParts.length, limits, issues);

  const parts = withFittedHoles({ ...library, ...config.customParts }, config.fabrication.fit.partHoles);
  checkComponentReferences(config, parts, profile, issues);
  if (issues.hasError("DUPLICATE_ID", "UNKNOWN_PART", "UNKNOWN_SURFACE", "WRONG_MOUNT", "TOP_PANEL_INVALID")) return issues.failure();

  const placed = placeComponents(config, parts, profile);
  const partFor = printedPartFinder(shellParts, topPieces);
  const cutouts = placeCutouts(placed, partFor, config, issues);
  const posts = placePosts(placed, partFor, config);
  const seams = planSeams(config, profile, placed, cutouts, limits.minWeb, issues);
  const wallHoles = planWallHoles(config, profile, placed, issues);
  checkWallHoles(wallHoles, config, profile, seams, limits, issues);
  const holderBlockList = planHolders(config, placed, issues);
  checkPartSuitability(placed, config, limits, issues);
  checkErgonomics(placed, issues);
  checkPosts(placed, cutouts, config, limits, issues);
  checkFitTestParts(config, parts, limits, issues);
  checkCutoutSpacing(cutouts, limits.minWeb, issues);
  checkCutoutsOnSurfaces(cutouts, config, profile, limits.minWeb, issues);
  checkCutoutsAgainstSeams(cutouts, config, topPieces, limits.minWeb, issues);
  checkBodies(placed, config, profile, seams, issues);
  const labels = planLabels(config, profile, placed, cutouts, wallHoles, shellParts, topPieces, partFor, limits, issues);
  checkWallParts(placed, config, profile, seams, holderBlockList, issues);
  const fixtures = {
    holeBoxes: [...wallHoles.map((hole) => wallHoleBox(hole, config, profile)), ...placed.flatMap((item) => wallPartBox(item, config) ?? [])],
    blocks: holderBlockList,
  };
  const fasteners: PlannedFasteners = { items: [], edges: [] };
  const topScrews = planTopScrews(config, profile, topPieces, seams, placed, cutouts, limits, fixtures, fasteners, issues);
  const plate = planPlate(config, profile, seams, placed, cutouts, topScrews, topPieces, limits, fixtures, fasteners, issues);
  const creases = planCreaseJoints(config, profile, topPieces, placed, posts, topScrews, cutouts, fixtures, plate, limits, issues);
  checkHolders(holderBlockList, config, profile, seams, placed, plate, issues);
  const firstPlate = shellParts.length + topPieces.length;
  const plateParts = planPlateParts(config, profile, plate, holderBlockList, firstPlate, issues);
  const printedParts = [
    ...shellParts,
    ...topPieces.map((piece) => topPrintedPart(piece, config, profile)),
    ...plateParts,
    ...planRailPart(config, firstPlate + plateParts.length, issues),
  ];
  const knobs = planKnobs(config, placed, printedParts.length, issues);
  printedParts.push(...knobs.map((knob): PrintedPart => ({ index: knob.printedPart, kind: "knob", name: knob.name, color: knob.color, xMin: knob.u - knob.diameter / 2, xMax: knob.u + knob.diameter / 2, size: knob.key ? [knob.key.width, knob.key.depth, knob.height] : [knob.diameter, knob.diameter, knob.height] })));

  const pins = checkPins(config, placed, issues);
  const wiring = withWiring ? planWiring(config, profile, placed, seams, plate, topScrews, posts, holderBlockList, issues) : { rooms: [], routes: [] };
  const steps = listAssembly(config, seams, plate, posts, topScrews, placed, creases, cutouts.filter((c) => !c.notch).map((c) => c.cutout), shellParts.length);

  return issues.result({
    wiring,
    pins,
    knobs,
    config,
    profile,
    seams,
    posts,
    plate,
    topPieces,
    topScrews,
    creases,
    shellOnSide: shellPrintsOnSide(seams.length),
    fasteners,
    wallHoles,
    labels,
    holderBlocks: holderBlockList,
    printedParts,
    cutouts: cutouts.filter((c) => !c.notch).map((c) => c.cutout),
    hardware: listHardware(config, profile, seams, plate, posts, topScrews, creases, holderBlockList),
    assembly: steps.map((step) => step.text),
    steps: steps.map(({ text, kinds, parts = [] }) => ({ text, parts: printedParts.filter((part) => kinds.includes(part.kind) || parts.includes(part.index)).map((part) => part.index) })),
  });
}

// What wires have to keep out of: every part's body, and what holds the enclosure together.
function wiringObstacles(config: Config, profile: Profile, placed: Placed[], seams: PlannedSeam[], plate: PlatePlan | null, topScrews: TopScrew[], posts: PlacedPost[], blocks: HolderBlock[]): WireObstacle[] {
  const e = config.enclosure;
  const t = e.panelThickness;
  const floor = e.floorThickness;
  const top = profile.maxHeight;
  const column = (name: string, x: number, y: number, r: number, z0: number, z1: number): WireObstacle => ({ name, xLow: x - r, xHigh: x + r, section: [[y - r, z0], [y + r, z0], [y + r, z1], [y - r, z1]] });
  const box = (name: string, [x0, x1]: Point2, [y0, y1]: Point2, [z0, z1]: Point2, componentId?: string): WireObstacle => ({ name, xLow: x0, xHigh: x1, section: [[y0, z0], [y1, z0], [y1, z1], [y0, z1]], ...(componentId ? { componentId } : {}) });
  const obstacles: WireObstacle[] = [];
  for (const item of placed) {
    const component = config.components[item.index]!;
    const name = `the body of "${item.id}"`;
    if (item.part.mount === "panel" && item.surface && item.part.below.depth > 0) {
      const shape = item.shape("below");
      const [hu, hv] = halfExtents(shape);
      const point = (v: number, n: number) => surfacePoint(item.surface!, v, n);
      const far = -t - item.part.below.depth;
      obstacles.push({ name, componentId: item.id, xLow: shape.cx - hu, xHigh: shape.cx + hu, section: [point(shape.cy - hv, -t), point(shape.cy + hv, -t), point(shape.cy + hv, far), point(shape.cy - hv, far)] });
    } else if (item.part.mount === "floor") {
      const shape = item.shape("below");
      const [hx, hy] = halfExtents(shape);
      obstacles.push(box(name, [shape.cx - hx, shape.cx + hx], [shape.cy - hy, shape.cy + hy], [floor, floor + item.part.height], item.id));
    } else if (item.part.mount === "wall" && "wall" in component) {
      const fit = wallFit(item, config)!;
      const inward = { left: [e.wall, e.wall + fit.depth], right: [e.width - e.wall - fit.depth, e.width - e.wall], front: [e.wall, e.wall + fit.depth], rear: [profile.depth - e.wall - fit.depth, profile.depth - e.wall] }[component.wall] as Point2;
      const along: Point2 = [fit.at - fit.across / 2, fit.at + fit.across / 2];
      const zs: Point2 = [fit.z - fit.up / 2, fit.z + fit.up / 2];
      obstacles.push(component.wall === "left" || component.wall === "right" ? box(name, inward, along, zs, item.id) : box(name, along, inward, zs, item.id));
    }
  }
  if (plate) {
    plate.screws.forEach(([x, y], i) => obstacles.push(column("a plate screw's boss", x, y, BOSS_DIAMETER / 2, floor, plate.shortBosses[i] ? shortBossTop(e, plate.lifts[i]!) : top)));
    for (const support of plate.supports) obstacles.push(column("a support on the plate", support.x, support.y, support.diameter / 2, floor, support.top));
    for (const weight of plate.weights) {
      const outer = weightOutline(weight) as { cx: number; cy: number; w: number; h: number };
      obstacles.push(box("a weight pocket", [outer.cx - outer.w / 2, outer.cx + outer.w / 2], [outer.cy - outer.h / 2, outer.cy + outer.h / 2], [floor, floor + weight.height]));
    }
  }
  // Cable tie bridges aren't in the way, since wires run over them.
  const onSide = shellPrintsOnSide(seams.length);
  for (const screw of topScrews) {
    obstacles.push(column("a top screw's post", screw.x, screw.y, TOP_POST_DIAMETER / 2, screw.postBottom, top));
    const tab = topTabExtent(screw, e.wall, e.width, profile.depth - e.wall, onSide);
    const under = onSide ? 0 : tabGussetDepth(tab, screw.wall, floor);
    obstacles.push(box("a top screw's tab", [tab.xLow - tab.spread, tab.xHigh + tab.spread], [tab.yLow, tab.yHigh], [tab.zLow - under, tab.zHigh]));
  }
  for (const post of posts) {
    const surface = profile.surfaces.find((s) => s.id === post.surface)!;
    const r = post.diameter / 2;
    const [y0, z0] = surfacePoint(surface, post.v, -post.reach);
    obstacles.push(column(`a screw post for "${post.componentId}"`, post.u, y0, r, z0, top));
  }
  for (const seam of seams) {
    const reach = seam.ribHalfThickness + seam.ribWidth;
    for (const tab of seam.tabs) obstacles.push({ name: "a tab across the seam", xLow: seam.x - reach, xHigh: seam.x + reach, section: tabSection(tab) });
  }
  for (const block of blocks) obstacles.push(box(`the cradle for "${block.componentId}"`, [block.xLow, block.xHigh], [block.yLow, block.yHigh], [floor, floor + block.top], block.componentId));
  for (const kept of reservedBoxes(config)) obstacles.push(box("the room kept for the opening", [kept.xMin, kept.xMax], [kept.yMin, kept.yMax], [0, kept.top]));
  return obstacles;
}

// The room for each part's wires, and their ways across the floor: switches to a shift register board
// if there is one, analog parts to an analog board if there is one, and everything else to the
// microcontroller. All of it only warns, and none of it does with wiring.checks off.
function planWiring(config: Config, profile: Profile, placed: Placed[], seams: PlannedSeam[], plate: PlatePlan | null, topScrews: TopScrew[], posts: PlacedPost[], blocks: HolderBlock[], issues: Issues): WiringPlan {
  const e = config.enclosure;
  const floor = e.floorThickness;
  const warn = config.wiring.checks;
  const rooms: WireRoom[] = [];
  for (const item of placed) {
    const component = config.components[item.index]!;
    const rotation = component.rotationDeg as Rotation;
    if (item.part.mount === "panel" && item.surface && "u" in component) rooms.push(...panelWireRooms(item.id, item.part, item.surface, component.u, component.v, rotation, e.panelThickness));
    else if (item.part.mount === "floor" && "x" in component) rooms.push(...floorWireRooms(item.id, item.part, component.x, component.y, rotation, floor));
    else if (item.part.mount === "wall" && "wall" in component) rooms.push(...wallWireRooms(item.id, item.part, component.wall, component.at, component.z, rotation, { wall: e.wall, width: e.width, depth: profile.depth }));
  }
  const obstacles = wiringObstacles(config, profile, placed, seams, plate, topScrews, posts, blocks);
  const indexOf = (id: string) => placed.find((item) => item.id === id)!.index;
  if (warn) {
    const inside = { xMin: e.wall, xMax: e.width - e.wall, cavity: profile.cavity };
    const reported = new Set<string>();
    for (const room of rooms) {
      const problem = wireRoomProblem(room, inside, obstacles);
      if (!problem || reported.has(room.componentId)) continue;
      // Where one of a part's ways out will do, any one with room is enough.
      const item = placed.find((p) => p.id === room.componentId)!;
      if (item.part.wiresFrom === "any" && rooms.some((other) => other.componentId === room.componentId && !wireRoomProblem(other, inside, obstacles))) continue;
      reported.add(room.componentId);
      const side = { down: "underside", up: "top", back: "back", left: "left side", right: "right side", front: "front side", rear: "rear side" }[room.side];
      issues.warn("WIRE_ROOM", `"${room.componentId}"'s wires need room straight out of its ${side}, and ${problem} is in the way. Move one of them, or, since this is a rough guide, turn wiring checks off in the Wiring section.`, `components[${indexOf(room.componentId)}]`, [room.componentId]);
    }
  }

  // Routes go to boards on the floor, so they need a microcontroller there.
  const floorItems = placed.filter((item): item is FloorPlaced => item.part.mount === "floor");
  const mcu = floorItems.find((item) => item.part.pins?.gpio !== undefined);
  if (!mcu) return { rooms, routes: [] };
  const area = { xMin: e.wall + 1, xMax: e.width - e.wall - 1, yMin: profile.plateFront + 1, yMax: profile.plateRear - 1, floor };
  const blocksOnFloor = obstacles.flatMap((obstacle) => floorBlock(obstacle, floor) ?? []);
  const boxOf = (item: FloorPlaced) => {
    const shape = item.shape("below");
    const [hx, hy] = halfExtents(shape);
    return { xLow: shape.cx - hx, xHigh: shape.cx + hx, yLow: shape.cy - hy, yHigh: shape.cy + hy, componentId: item.id };
  };
  const nearest = (boards: FloorPlaced[], [x, y]: Point3) => [...boards].sort((a, b) => Math.hypot(a.shape("below").cx - x, a.shape("below").cy - y) - Math.hypot(b.shape("below").cx - x, b.shape("below").cy - y))[0];
  const shiftBoards = floorItems.filter((item) => (item.part.pins?.shiftInputs ?? 0) > 0);
  const analogBoards = floorItems.filter((item) => (item.part.pins?.analogInputs ?? 0) > 0);
  const routes: WireRoute[] = [];
  const unrouted: string[] = [];
  for (const item of placed) {
    if (item === mcu) continue;
    const own = rooms.filter((room) => room.componentId === item.id);
    if (own.length === 0) continue;
    const pins = item.part.pins;
    const onlySwitches = (pins?.switches ?? 0) > 0 && !pins?.direct && !pins?.analog && !pins?.i2c?.length;
    const onlyAnalog = (pins?.analog ?? 0) > 0 && !pins?.switches && !pins?.direct && !pins?.i2c?.length;
    const centre = own[0]!.end;
    const target = (onlySwitches && nearest(shiftBoards.filter((b) => b !== item), centre)) || (onlyAnalog && nearest(analogBoards.filter((b) => b !== item), centre)) || mcu;
    const box = boxOf(target);
    const tx = (box.xLow + box.xHigh) / 2;
    const ty = (box.yLow + box.yHigh) / 2;
    // The nearest way out to the board, with room if one has.
    const inside = { xMin: e.wall, xMax: e.width - e.wall, cavity: profile.cavity };
    const open = own.filter((room) => !wireRoomProblem(room, inside, obstacles));
    const room = [...(open.length ? open : own)].sort((a, b) => Math.hypot(a.end[0] - tx, a.end[1] - ty) - Math.hypot(b.end[0] - tx, b.end[1] - ty))[0]!;
    const route = routeWire(area, blocksOnFloor, { id: item.id, end: room.end }, { id: target.id, box, top: floor + target.part.height }, seams.map((seam) => seam.x));
    if (route) routes.push(route);
    else unrouted.push(item.id);
  }
  if (warn) {
    for (const id of unrouted) issues.warn("WIRE_ROUTE", `There's no way across the floor for "${id}"'s wires to reach the board they go to. Make room, or, since this is a rough guide, turn wiring checks off in the Wiring section.`, `components[${indexOf(id)}]`, [id]);
    const tight = routes.filter((route) => route.tight).map((route) => route.from);
    if (tight.length) issues.warn("WIRE_ROUTE", `Wires from ${quoteList(tight)} only just get past what's on the floor, with less than ${mm(WIRE_BUNDLE)} for them. Make room if you can.`, "wiring", tight);  }
  return { rooms, routes };
}

const quoteList = (ids: string[]) => {
  const quoted = ids.map((id) => `"${id}"`);
  return quoted.length < 3 ? quoted.join(" and ") : `${quoted.slice(0, -1).join(", ")} and ${quoted.at(-1)}`;
};

interface Fixtures {
  holeBoxes: { xMin: number; xMax: number; yMin: number; yMax: number; top: number }[];
  blocks: HolderBlock[];
}

function blockShape(block: HolderBlock): Shape {
  return { kind: "rect", cx: (block.xLow + block.xHigh) / 2, cy: (block.yLow + block.yHigh) / 2, w: block.xHigh - block.xLow, h: block.yHigh - block.yLow };
}

// Holes from the config, plus one for each board with a port within reach of its wall.
// How a part in a wall sits there, turned if it's turned, with `reads` the way along the wall that
// reads left to right from outside.
function wallFit(item: Placed, config: Config) {
  const component = config.components[item.index]!;
  if (item.part.mount !== "wall" || !("wall" in component)) return null;
  const rotation = component.rotationDeg as Rotation;
  const sideways = rotation === 90 || rotation === 270;
  const { body, outside } = item.part;
  return {
    wall: component.wall,
    at: component.at,
    z: component.z,
    reads: WALL_READS[component.wall],
    rotation,
    across: sideways ? body.height : body.width,
    up: sideways ? body.width : body.height,
    depth: body.depth,
    outsideAcross: sideways ? outside.height : outside.width,
    outsideUp: sideways ? outside.width : outside.height,
  };
}

function planWallHoles(config: Config, profile: Profile, placed: Placed[], issues: Issues): PlannedWallHole[] {
  const e = config.enclosure;
  const holes: PlannedWallHole[] = config.wallHoles.map(({ fitChange, ...hole }, i) => ({ ...hole, width: hole.width + fitChange, height: hole.height + fitChange, path: `wallHoles[${i}]`, componentId: null }));
  config.vents.forEach((vent, i) => {
    for (const at of ventSlots(vent)) {
      holes.push({ wall: vent.wall, at, z: vent.z, width: vent.slotWidth, height: vent.height, cornerRadius: Math.min(vent.slotWidth, vent.height) / 2 - 0.05, path: `vents[${i}]`, componentId: null, vent: true });
    }
  });
  for (const item of placed) {
    const fit = wallFit(item, config);
    if (fit && item.part.mount === "wall") {
      item.part.holes.forEach((hole) => {
        const [da, dz] = rotateOffset(hole.at, fit.rotation);
        const sideways = fit.rotation === 90 || fit.rotation === 270;
        holes.push({
          wall: fit.wall,
          at: fit.at + fit.reads * da,
          z: fit.z + dz,
          width: sideways ? hole.height : hole.width,
          height: sideways ? hole.width : hole.height,
          cornerRadius: hole.cornerRadius,
          path: `components[${item.index}]`,
          componentId: item.id,
        });
      });
      continue;
    }
    if (item.part.mount !== "floor" || !item.part.port) continue;
    const { port } = item.part;
    const shape = item.shape("below");
    const [hx, hy] = halfExtents(shape);
    const { wall, at } = portTarget(item.part, shape.cx, shape.cy, config.components[item.index]!.rotationDeg as Rotation);
    const gap = {
      left: shape.cx - hx - e.wall,
      right: e.width - e.wall - shape.cx - hx,
      front: shape.cy - hy - e.wall,
      rear: profile.depth - e.wall - shape.cy - hy,
    }[wall];
    if (gap > port.reach) {
      issues.warn("PORT_UNREACHED", `The connector on "${item.id}" faces the ${wall} wall, but it's ${mm(gap)} away, so there's no hole for it. Move it within ${mm(port.reach)} of that wall, or rotate it.`, `components[${item.index}]`, [item.id]);
      continue;
    }
    holes.push({ wall, at, z: e.floorThickness + port.z, width: port.width, height: port.height, cornerRadius: port.cornerRadius, path: `components[${item.index}]`, componentId: item.id });
  }
  return holes;
}

// The room inside the wall that has to stay clear around a hole.
function wallHoleBox(hole: PlannedWallHole, config: Config, profile: Profile) {
  const inside = config.enclosure.wall + 1.5;
  const half = hole.width / 2 + 1;
  const top = hole.z + hole.height / 2 + 1;
  if (hole.wall === "left") return { xMin: 0, xMax: inside, yMin: hole.at - half, yMax: hole.at + half, top };
  if (hole.wall === "right") return { xMin: config.enclosure.width - inside, xMax: config.enclosure.width, yMin: hole.at - half, yMax: hole.at + half, top };
  if (hole.wall === "front") return { xMin: hole.at - half, xMax: hole.at + half, yMin: 0, yMax: inside, top };
  return { xMin: hole.at - half, xMax: hole.at + half, yMin: profile.depth - inside, yMax: profile.depth, top };
}

// What a part in a wall takes up behind it, from the base up, for screws and the like to keep clear of.
function wallPartBox(item: Placed, config: Config) {
  const fit = wallFit(item, config);
  if (!fit) return null;
  const [hx, hy] = halfExtents(item.shape("below"));
  const { cx, cy } = item.shape("below");
  return { xMin: cx - hx - 1, xMax: cx + hx + 1, yMin: cy - hy - 1, yMax: cy + hy + 1, top: fit.z + fit.up / 2 + 1 };
}

function checkWallParts(placed: Placed[], config: Config, profile: Profile, seams: PlannedSeam[], blocks: HolderBlock[], issues: Issues) {
  const e = config.enclosure;
  const t = e.panelThickness;
  const walled = placed.filter((item) => item.part.mount === "wall");
  walled.forEach((item, n) => {
    const fit = wallFit(item, config)!;
    const path = `components[${item.index}]`;
    const fail = (code: IssueCode, message: string, others: string[] = []) => issues.error(code, message, path, [item.id, ...others]);
    if (item.part.mount === "wall" && item.part.maxWall !== undefined && e.wall > item.part.maxWall) {
      fail("WALL_TOO_THIN", `"${item.id}" fits through a wall up to ${mm(item.part.maxWall)} thick, and these are ${mm(e.wall)}.`);
    }
    const shape = item.shape("below");
    const [hx, hy] = halfExtents(shape);
    const [xLow, xHigh, yLow, yHigh] = [shape.cx - hx, shape.cx + hx, shape.cy - hy, shape.cy + hy];
    const bottom = fit.z - fit.up / 2;
    const top = fit.z + fit.up / 2;
    if (xLow < e.wall - 0.01 || xHigh > e.width - e.wall + 0.01 || yLow < e.wall - 0.01 || yHigh > profile.depth - e.wall + 0.01) {
      return fail("BODY_HITS_ENCLOSURE", `The body of "${item.id}" runs into a wall behind the ${fit.wall} wall. Move it along, or further from the corner.`);
    }
    // With no plate, there's only something under it where a bottom round is.
    const overRound = yLow < profile.plateFront || yHigh > profile.plateRear;
    const floor = config.plate.enabled || overRound ? highestFloor(profile.lower, yLow, yHigh) : 0;
    if (bottom < floor) fail("BODY_HITS_ENCLOSURE", `The body of "${item.id}" starts ${mm(bottom)} from the base, under the floor at ${mm(floor)}. Move it up.`);
    const ceiling = lowestHeight(profile.inner, yLow, yHigh);
    if (top > ceiling) fail("BODY_HITS_ENCLOSURE", `The body of "${item.id}" reaches ${mm(top)} from the base, and the underside of the top is at ${mm(ceiling)} over it. Move it down, or away from the wall's low end.`);
    const outsideReach = fit.outsideAcross / 2;
    const length = fit.wall === "left" || fit.wall === "right" ? profile.depth : e.width;
    if (fit.at - outsideReach < e.cornerRadius || fit.at + outsideReach > length - e.cornerRadius) {
      fail("BODY_HITS_ENCLOSURE", `What shows of "${item.id}" outside runs onto a rounded corner of the ${fit.wall} wall. Keep it between ${mm(e.cornerRadius + outsideReach)} and ${mm(length - e.cornerRadius - outsideReach)}.`);
    }
    const { opening } = config;
    const reservedRoom = reservedBoxes(config).find((box) => xLow < box.xMax && xHigh > box.xMin && yLow < box.yMax && yHigh > box.yMin && bottom < box.top);
    if (reservedRoom) fail("BODIES_COLLIDE", `The body of "${item.id}" runs into the room kept for what the opening holds.`);
    if (opening && xLow < opening.xMax && xHigh > opening.xMin && yLow < opening.yEnd && top > opening.sill) fail("OPENING_INVALID", `The body of "${item.id}" is in the opening.`);

    for (const seam of seams) {
      const reach = seam.ribHalfThickness + seam.ribWidth;
      if (xLow < seam.x + reach && xHigh > seam.x - reach) fail("BODY_HITS_RIB", `The body of "${item.id}" is in the way of the seam at x = ${mm(seam.x)}.`);
    }
    for (const other of placed) {
      if (other.part.mount === "floor") {
        if (bottom < e.floorThickness + other.part.height && gap(shape, other.shape("below")) < PART_CLEARANCE) fail("BODIES_COLLIDE", `The body of "${item.id}" runs into "${other.id}".`, [other.id]);
      } else if (other.part.mount === "panel" && other.surface && other.part.below.depth > 0) {
        const below = other.shape("below");
        const [ou, ov] = halfExtents(below);
        const surface = other.surface;
        const section = [surfacePoint(surface, below.cy - ov, -t), surfacePoint(surface, below.cy + ov, -t), surfacePoint(surface, below.cy + ov, -t - other.part.below.depth), surfacePoint(surface, below.cy - ov, -t - other.part.below.depth)];
        const mine: Point2[] = [[yLow, bottom], [yHigh, bottom], [yHigh, top], [yLow, top]];
        if (xLow < below.cx + ou + PART_CLEARANCE && xHigh > below.cx - ou - PART_CLEARANCE && polygonsOverlap(section, mine)) fail("BODIES_COLLIDE", `The body of "${item.id}" runs into "${other.id}" under the top.`, [other.id]);
      }
    }
    for (const block of blocks) {
      if (bottom < e.floorThickness + block.top && xLow < block.xHigh && xHigh > block.xLow && yLow < block.yHigh && yHigh > block.yLow) fail("BODIES_COLLIDE", `The body of "${item.id}" runs into the cradle for "${block.componentId}".`, [block.componentId]);
    }
    for (const other of walled.slice(0, n)) {
      const theirs = wallFit(other, config)!;
      const [ox, oy] = halfExtents(other.shape("below"));
      const below = other.shape("below");
      const inPlan = xLow < below.cx + ox + PART_CLEARANCE && xHigh > below.cx - ox - PART_CLEARANCE && yLow < below.cy + oy + PART_CLEARANCE && yHigh > below.cy - oy - PART_CLEARANCE;
      if (inPlan && bottom < theirs.z + theirs.up / 2 + PART_CLEARANCE && top > theirs.z - theirs.up / 2 - PART_CLEARANCE) fail("BODIES_COLLIDE", `"${item.id}" and "${other.id}" run into each other behind the wall.`, [other.id]);
      if (theirs.wall === fit.wall && Math.abs(theirs.at - fit.at) < (theirs.outsideAcross + fit.outsideAcross) / 2 + PART_CLEARANCE && Math.abs(theirs.z - fit.z) < (theirs.outsideUp + fit.outsideUp) / 2 + PART_CLEARANCE) {
        fail("BODIES_COLLIDE", `What shows of "${item.id}" and "${other.id}" outside the ${fit.wall} wall runs together.`, [other.id]);
      }
    }
  });
}

function checkWallHoles(holes: PlannedWallHole[], config: Config, profile: Profile, seams: PlannedSeam[], limits: Limits, issues: Issues) {
  const e = config.enclosure;
  const { depth } = profile;
  holes.forEach((hole, i) => {
    const ids = hole.componentId ? [hole.componentId] : [];
    const fail = (message: string) => issues.error("WALL_HOLE_INVALID", message, hole.path, ids);
    const name = hole.componentId ? `The hole for "${hole.componentId}"` : hole.vent ? "A slot in a vent" : `Wall hole ${i + 1}`;
    const sideways = hole.wall === "left" || hole.wall === "right";
    const low = hole.at - hole.width / 2;
    const high = hole.at + hole.width / 2;
    const length = sideways ? depth : e.width;
    if (hole.width <= 0 || hole.height <= 0) {
      fail(`${name} has nothing left of it, at ${mm(hole.width)} x ${mm(hole.height)}, after what the fit test takes off.`);
      return;
    }
    if (hole.cornerRadius * 2 > Math.min(hole.width, hole.height)) fail(`${name} has corners too big for its size.`);
    if (low < e.cornerRadius + limits.minWeb || high > length - e.cornerRadius - limits.minWeb) {
      fail(`${name} reaches from ${mm(low)} to ${mm(high)} along the ${hole.wall} wall, which is too close to a corner. It has to stay between ${mm(e.cornerRadius + limits.minWeb)} and ${mm(length - e.cornerRadius - limits.minWeb)}.`);
    }
    const bottom = hole.z - hole.height / 2;
    const top = hole.z + hole.height / 2;
    if (bottom < e.floorThickness) fail(`${name} starts at ${mm(bottom)} from the base, below the top of the ${mm(e.floorThickness)} plate.`);
    const { frontBottom, rearBottom } = e.rounds;
    const onRound = sideways ? bottom < highestFloor(profile.lower, Math.max(low, e.wall), Math.min(high, depth - e.wall)) : bottom < (hole.wall === "front" ? frontBottom : rearBottom);
    if (onRound) fail(`${name} starts at ${mm(bottom)} from the base, which is on a bottom round.`);
    const ceiling = sideways
      ? lowestHeight(profile.inner, Math.max(low, e.wall), Math.min(high, depth - e.wall))
      : hole.wall === "front"
        ? lowestHeight(profile.inner, e.wall, e.wall + 0.01)
        : lowestHeight(profile.inner, depth - e.wall - 0.01, depth - e.wall);
    if (top + limits.minWall > ceiling) fail(`${name} reaches ${mm(top)} from the base, but needs ${mm(limits.minWall)} of wall under the top, which is at ${mm(ceiling)} there.`);
    if (!sideways) {
      for (const seam of seams) {
        const reach = seam.ribHalfThickness + seam.ribWidth;
        if (low < seam.x + reach && high > seam.x - reach) fail(`${name} is in the way of the seam at x = ${mm(seam.x)}.`);
      }
      const opening = config.opening;
      if (opening && hole.wall === "front" && low < opening.xMax && high > opening.xMin) fail(`${name} is in the opening, where there's no wall.`);
      if (hole.wall === "front") {
        for (const block of railBlocks(config)) {
          if (low < block.xMax && high > block.xMin && bottom < block.top) fail(`${name} is in the way of a rail block.`);
        }
      }
    }
    for (const other of holes.slice(0, i)) {
      if (other.wall === hole.wall && low - limits.minWeb < other.at + other.width / 2 && high + limits.minWeb > other.at - other.width / 2) {
        if (bottom - limits.minWeb < other.z + other.height / 2 && top + limits.minWeb > other.z - other.height / 2) fail(`${name} is too close to another hole in the ${hole.wall} wall.`);
      }
    }
  });
}

// Which way a wall's reading direction runs along `at`, seen from outside.
const WALL_READS: Record<PlannedWallHole["wall"], 1 | -1> = { front: 1, right: 1, rear: -1, left: -1 };

function planLabels(config: Config, profile: Profile, placed: Placed[], cutouts: PlacedShape[], wallHoles: PlannedWallHole[], shellParts: PrintedPart[], topPieces: TopPiece[], partFor: (surface: string, u: number) => number, limits: Limits, issues: Issues): PlacedLabel[] {
  const e = config.enclosure;
  const labels: PlacedLabel[] = [];
  config.labels.forEach((label, i) => {
    const path = `labels[${i}]`;
    const ids = "component" in label ? [label.component] : [];
    const fail = (message: string, where?: IssueBox) => issues.error("LABEL_INVALID", `Label "${label.text}" ${message}`, path, ids, where);
    if (label.text.trim() === "") return fail("has nothing to engrave.");
    const unknown = unsupportedCharacters(label.text);
    if (unknown.length) return fail(`has characters there's no lettering for: ${unknown.join(" ")}. It has letters, numbers, spaces and . , : - + = / ( ) ' ! ? # &`);
    if (label.size < MIN_LABEL_SIZE) return fail(`is ${mm(label.size)} tall, and under ${mm(MIN_LABEL_SIZE)} the insides of its letters would close up in printing.`);

    const rotationDeg = ("rotationDeg" in label ? label.rotationDeg : 0) as Rotation;
    const outline = textOutline(label.text, label.size);
    const sideways = rotationDeg === 90 || rotationDeg === 270;
    const across = sideways ? outline.height : outline.width;
    const up = sideways ? outline.width : outline.height;

    let on: PlacedLabel["on"] | null = null;
    if ("component" in label) {
      const item = placed.find((candidate) => candidate.id === label.component);
      if (!item) return fail(`is for "${label.component}", which isn't in the design.`);
      const beside = (a: number, b: number, halfA: number, halfB: number, reads: 1 | -1 = 1): [number, number] => {
        if (label.side === "below") return [a, b - halfB - LABEL_GAP - up / 2];
        if (label.side === "above") return [a, b + halfB + LABEL_GAP + up / 2];
        return [a + (label.side === "right" ? reads : -reads) * (halfA + LABEL_GAP + across / 2), b];
      };
      const inWall = wallFit(item, config);
      if (item.part.mount === "panel") {
        const shape = item.shape("above");
        const [hu, hv] = halfExtents(shape);
        const [u, v] = beside(shape.cx, shape.cy, hu, hv);
        on = { kind: "surface", surface: item.surface!.id, u, v };
      } else if (inWall) {
        const [at, z] = beside(inWall.at, inWall.z, inWall.outsideAcross / 2, inWall.outsideUp / 2, inWall.reads);
        on = { kind: "wall", wall: inWall.wall, at, z };
      } else {
        const hole = wallHoles.find((candidate) => candidate.componentId === item.id);
        if (!hole) return fail(`is for "${item.id}", which is on the floor with no hole in a wall to put it beside. Give it a spot on a wall or surface instead.`);
        const [at, z] = beside(hole.at, hole.z, hole.width / 2, hole.height / 2, WALL_READS[hole.wall]);
        on = { kind: "wall", wall: hole.wall, at, z };
      }
    } else if ("wall" in label) {
      on = { kind: "wall", wall: label.wall, at: label.at, z: label.z };
    } else {
      const surface = label.surface ? profile.surfaces.find((s) => s.id === label.surface) : profile.surfaces[0];
      if (!surface) return fail(`is on surface "${label.surface}", which doesn't exist.`);
      on = { kind: "surface", surface: surface.id, u: label.u, v: label.v };
    }

    if (on.kind === "surface") {
      const { surface: surfaceId, u, v } = on;
      const surface = profile.surfaces.find((s) => s.id === surfaceId)!;
      const low = { u: u - across / 2, v: v - up / 2 };
      const high = { u: u + across / 2, v: v + up / 2 };
      const [yLow, zLow] = surfacePoint(surface, low.v, 0);
      const [yHigh, zHigh] = surfacePoint(surface, high.v, 0);
      const where: IssueBox = { min: [low.u, Math.min(yLow, yHigh), Math.min(zLow, zHigh) - 1], max: [high.u, Math.max(yLow, yHigh), Math.max(zLow, zHigh) + 1] };
      const problem = (message: string) => fail(message, where);
      if (e.panelThickness - label.depth < limits.minSkin) return problem(`is ${mm(label.depth)} deep, leaving under ${mm(limits.minSkin)} of the ${mm(e.panelThickness)} panel behind it.`);
      const { margin, vMin, vMax } = usableSurface(surface, config, profile, limits.minWeb);
      if (low.u < margin || high.u > e.width - margin || low.v < vMin || high.v > vMax || offRoundedCorner(surface, config, profile, limits.minWeb, low, high)) {
        return problem(`takes up u ${mm(low.u)} to ${mm(high.u)}, v ${mm(low.v)} to ${mm(high.v)}, too close to or past the edge. The usable part of "${surface.id}" is u ${mm(margin)} to ${mm(e.width - margin)}, v ${mm(vMin)} to ${mm(vMax)}.`);
      }
      const pieces = topPieces.filter((piece) => piece.surface === surface.id);
      const joints = pieces.length ? pieces.flatMap((piece) => [piece.xMin, piece.xMax]).filter((x) => x > 0.01 && x < e.width - 0.01) : config.seams.map((seam) => seam.x);
      if (joints.some((x) => low.u - limits.minWeb < x && high.u + limits.minWeb > x)) return problem("runs across a joint between printed parts, which it would be cut in two by. Move it, or make it shorter.");
      const { opening } = config;
      if (opening && high.u + limits.minWeb > opening.xMin && low.u - limits.minWeb < opening.xMax && Math.min(yLow, yHigh) < opening.yEnd + limits.minWeb) return problem("is in or too close to the opening.");
      const box: Shape = { kind: "rect", cx: u, cy: v, w: across, h: up };
      const cutout = cutouts.find((c) => c.surface.id === surface.id && gap(c.shape, box) < LABEL_CLEAR);
      if (cutout) return problem(`runs into the hole for "${cutout.cutout.componentId}".`);
      for (const item of placed) {
        if (item.part.mount === "panel" && item.surface?.id === surface.id && gap(item.shape("above"), box) < 0) {
          issues.warn("LABEL_HIDDEN", `Label "${label.text}" is under "${item.id}", so it won't be seen.`, path, [item.id], where);
        }
      }
    } else {
      const { wall, at, z } = on;
      const low = at - across / 2;
      const high = at + across / 2;
      const bottom = z - up / 2;
      const top = z + up / 2;
      const flatSide = wall === "left" || wall === "right";
      const outside = flatSide ? [wall === "left" ? 0 : e.width, wall === "left" ? 0 : e.width] : [wall === "front" ? 0 : profile.depth, wall === "front" ? 0 : profile.depth];
      const where: IssueBox = flatSide
        ? { min: [outside[0]! - 1, low, bottom], max: [outside[0]! + 1, high, top] }
        : { min: [low, outside[0]! - 1, bottom], max: [high, outside[0]! + 1, top] };
      const problem = (message: string) => fail(message, where);
      if (e.wall - label.depth < limits.minSkin) return problem(`is ${mm(label.depth)} deep, leaving under ${mm(limits.minSkin)} of the ${mm(e.wall)} wall behind it.`);
      const length = flatSide ? profile.depth : e.width;
      const reach = e.cornerRadius + limits.minWeb;
      if (low < reach || high > length - reach) return problem(`reaches from ${mm(low)} to ${mm(high)} along the ${wall} wall, too close to a corner. It has to stay between ${mm(reach)} and ${mm(length - reach)}.`);
      const floorAt = flatSide ? highestFloor(profile.lower, Math.max(low, e.wall), Math.min(high, profile.depth - e.wall)) : wall === "front" ? e.rounds.frontBottom : e.rounds.rearBottom;
      const ceiling = flatSide
        ? lowestHeight(profile.inner, Math.max(low, e.wall), Math.min(high, profile.depth - e.wall))
        : wall === "front"
          ? lowestHeight(profile.inner, e.wall, e.wall + 0.01)
          : lowestHeight(profile.inner, profile.depth - e.wall - 0.01, profile.depth - e.wall);
      if (bottom < Math.max(floorAt, limits.minWeb) || top + limits.minWeb > ceiling) return problem(`takes up ${mm(bottom)} to ${mm(top)} from the base, and the flat of the ${wall} wall there is ${mm(Math.max(floorAt, limits.minWeb))} to ${mm(ceiling - limits.minWeb)}.`);
      if (!flatSide && config.seams.some((seam) => low - limits.minWeb < seam.x && high + limits.minWeb > seam.x)) return problem("runs across a joint between printed parts, which it would be cut in two by. Move it, or make it shorter.");
      const { opening } = config;
      if (opening && wall === "front" && high + limits.minWeb > opening.xMin && low - limits.minWeb < opening.xMax && top > opening.sill) return problem("is in the opening, where there's no wall.");
      for (const item of placed) {
        const fit = wallFit(item, config);
        if (fit?.wall === wall && low < fit.at + fit.outsideAcross / 2 && high > fit.at - fit.outsideAcross / 2 && bottom < fit.z + fit.outsideUp / 2 && top > fit.z - fit.outsideUp / 2) {
          issues.warn("LABEL_HIDDEN", `Label "${label.text}" is under "${item.id}", so it won't be seen.`, path, [item.id], where);
        }
      }
      const hole = wallHoles.find((other) => other.wall === wall && low - LABEL_CLEAR < other.at + other.width / 2 && high + LABEL_CLEAR > other.at - other.width / 2 && bottom - LABEL_CLEAR < other.z + other.height / 2 && top + LABEL_CLEAR > other.z - other.height / 2);
      if (hole) return problem(`runs into a hole in the ${wall} wall.`);
    }

    const spot = (where: PlacedLabel["on"]) => (where.kind === "surface" ? { place: `surface ${where.surface}`, a: where.u, b: where.v } : { place: `wall ${where.wall}`, a: where.at, b: where.z });
    const here = spot(on);
    const overlapping = labels.find((other) => {
      const there = spot(other.on);
      return there.place === here.place && Math.abs(there.a - here.a) < (across + other.across) / 2 + LABEL_CLEAR && Math.abs(there.b - here.b) < (up + other.up) / 2 + LABEL_CLEAR;
    });
    if (overlapping) return fail(`runs into the label "${overlapping.text}".`);

    const onWallPart = (at: number, wall: PlannedWallHole["wall"]) => (wall === "left" ? shellParts[0]! : wall === "right" ? shellParts.at(-1)! : shellParts.find((part) => at < part.xMax) ?? shellParts.at(-1)!).index;
    const printedPart = on.kind === "surface" ? partFor(on.surface, on.u) : onWallPart(on.at, on.wall);
    labels.push({ text: label.text, size: label.size, depth: label.depth, rotationDeg, printedPart, ...(label.color && { color: label.color }), across, up, on });
  });
  return labels;
}

function planHolders(config: Config, placed: Placed[], issues: Issues): HolderBlock[] {
  return placed.flatMap((item) => {
    if (item.part.mount !== "floor" || (!item.part.holder && !item.part.standoffs?.length)) return [];
    const path = `components[${item.index}]`;
    if (!config.plate.enabled) {
      issues.warn("BOARD_HOLDER_SKIPPED", `"${item.id}" has a ${item.part.holder ? "cradle" : "set of standoffs"}, but it goes on the plate, and the plate is turned off.`, path, [item.id]);
      return [];
    }
    for (const standoff of item.part.standoffs ?? []) {
      if (standoff.height > item.part.height) issues.error("BOARD_HOLDER_INVALID", `"${item.id}" is ${mm(item.part.height)} tall, less than its ${mm(standoff.height)} standoffs.`, path, [item.id]);
      if ((standoff.diameter - standoff.holeDiameter) / 2 < MIN_STANDOFF_WALL) issues.error("BOARD_HOLDER_INVALID", `A standoff for "${item.id}" would have under ${mm(MIN_STANDOFF_WALL)} of wall around its hole. Make it wider, or the hole smaller.`, path, [item.id]);
    }
    if (!item.part.holder) {
      const shape = item.shape("below");
      return holderBlocks(item.id, item.part, shape.cx, shape.cy, config.components[item.index]!.rotationDeg as Rotation, config.fabrication.fit.clipGap);
    }
    if (item.part.footprint.shape !== "rect") {
      issues.error("BOARD_HOLDER_INVALID", `"${item.id}" has a cradle, which only works on a rectangular board.`, path, [item.id]);
      return [];
    }
    if (item.part.holder.underside + item.part.holder.thickness > item.part.height) {
      issues.error("BOARD_HOLDER_INVALID", `"${item.id}" is ${mm(item.part.height)} tall, less than the height of its board in its cradle.`, path, [item.id]);
    }
    if (item.part.holder.clips.length > 0 && config.fabrication.fit.clipGap >= BARB_REACH) {
      issues.error("BOARD_HOLDER_INVALID", `A clip gap of ${mm(config.fabrication.fit.clipGap)} is wider than the ${mm(BARB_REACH)} its barbs reach, so the clips on "${item.id}" wouldn't hold the board.`, "fabrication.fit.clipGap", [item.id]);
    }
    const shape = item.shape("below");
    return holderBlocks(item.id, item.part, shape.cx, shape.cy, config.components[item.index]!.rotationDeg as Rotation, config.fabrication.fit.clipGap);
  });
}

function checkHolders(blocks: HolderBlock[], config: Config, profile: Profile, seams: PlannedSeam[], placed: Placed[], plate: PlatePlan | null, issues: Issues) {
  if (!plate) return;
  const e = config.enclosure;
  const inset = e.wall + plate.clearance;
  const notch = plateNotchFor(config);
  const floorParts = placed.filter((p): p is FloorPlaced => p.part.mount === "floor");
  const reported = new Set<string>();
  for (const block of blocks) {
    const owner = placed.find((p) => p.id === block.componentId)!;
    // A cradle has many blocks, and one problem is enough to say once.
    const fail = (message: string) => {
      if (!reported.has(message)) issues.error("BOARD_HOLDER_INVALID", message, `components[${owner.index}]`, [block.componentId]);
      reported.add(message);
    };
    const name = block.kind === "standoff" ? `A standoff for "${block.componentId}"` : `The cradle for "${block.componentId}"`;
    const top = e.floorThickness + block.top;
    if (block.xLow < inset || block.xHigh > e.width - inset || block.yLow < profile.plateFront + plate.clearance || block.yHigh > profile.plateRear - plate.clearance) fail(`${name} runs off the edge of the plate.`);
    const joint = plate.joints.find((x) => block.xLow < x && block.xHigh > x);
    if (joint !== undefined) fail(`${name} crosses the plate's joint at x = ${mm(joint)}. Move the board, or move the joint with plate.seamX.`);
    if (notch && block.xLow < notch.xHigh && block.xHigh > notch.xLow && block.yLow < notch.yHigh) fail(`${name} is in the plate's notch for the rail.`);
    for (const hole of config.plate.countersunkHoles) {
      if (block.xLow - 3.5 < hole.x && block.xHigh + 3.5 > hole.x && block.yLow - 3.5 < hole.y && block.yHigh + 3.5 > hole.y) fail(`${name} covers a hole in the plate.`);
    }
    for (const pin of config.plate.pins) {
      const r = pin.diameter / 2;
      if (block.xLow - r < pin.x && block.xHigh + r > pin.x && block.yLow - r < pin.y && block.yHigh + r > pin.y) fail(`${name} hits a pin on the plate.`);
    }
    for (const box of reservedBoxes(config)) {
      if (block.xLow < box.xMax && block.xHigh > box.xMin && block.yLow < box.yMax && block.yHigh > box.yMin && e.floorThickness < box.top) fail(`${name} is in the space the opening's contents need.`);
    }
    for (const other of blocks) {
      if (other.componentId === block.componentId || other.componentId > block.componentId) continue;
      if (block.xLow < other.xHigh + PART_CLEARANCE && block.xHigh > other.xLow - PART_CLEARANCE && block.yLow < other.yHigh + PART_CLEARANCE && block.yHigh > other.yLow - PART_CLEARANCE) {
        fail(`${name} runs into the cradle for "${other.componentId}".`);
      }
    }
    for (const other of floorParts) {
      if (other.id === block.componentId) continue;
      const shape = other.shape("below");
      const [hx, hy] = halfExtents(shape);
      if (block.xLow < shape.cx + hx + PART_CLEARANCE && block.xHigh > shape.cx - hx - PART_CLEARANCE && block.yLow < shape.cy + hy + PART_CLEARANCE && block.yHigh > shape.cy - hy - PART_CLEARANCE) {
        fail(`${name} runs into "${other.id}".`);
      }
    }
    const column: Point2[] = [[block.yLow, e.floorThickness], [block.yHigh, e.floorThickness], [block.yHigh, top], [block.yLow, top]];
    for (const seam of seams) {
      const reach = seam.ribHalfThickness + seam.ribWidth;
      if (block.xLow < seam.x + reach && block.xHigh > seam.x - reach && seam.tabs.some((tab) => polygonsOverlap(column, tabSection(tab)))) fail(`${name} runs into a seam tab at x = ${mm(seam.x)}.`);
    }
    for (const item of placed) {
      if (item.part.mount !== "panel" || !item.surface || item.part.below.depth === 0) continue;
      const shape = item.shape("below");
      const [hu, hv] = halfExtents(shape);
      if (block.xLow >= shape.cx + hu + PART_CLEARANCE || block.xHigh <= shape.cx - hu - PART_CLEARANCE) continue;
      const far = -e.panelThickness - item.part.below.depth;
      const section = [surfacePoint(item.surface, shape.cy - hv, 0), surfacePoint(item.surface, shape.cy + hv, 0), surfacePoint(item.surface, shape.cy + hv, far), surfacePoint(item.surface, shape.cy - hv, far)];
      if (polygonsOverlap(section, column)) fail(`${name} runs into the body of "${item.id}".`);
    }
  }
}

function topPanelFor(config: Config, surfaceId: string) {
  return config.topPanels.find((panel) => panel.surface === surfaceId);
}

// A top surface belongs to its piece, and everything else to the shell half under it.
function printedPartFinder(shellParts: PrintedPart[], topPieces: TopPiece[]) {
  return (surfaceId: string, u: number): number => {
    const pieces = topPieces.filter((piece) => piece.surface === surfaceId);
    if (pieces.length) return (pieces.find((piece) => u < piece.xMax) ?? pieces.at(-1)!).printedPart;
    return shellParts.find((p) => u < p.xMax)?.index ?? shellParts.length - 1;
  };
}

function checkOpening(config: Config, profile: Profile, issues: Issues) {
  const opening = config.opening;
  if (!opening) return;
  const e = config.enclosure;
  if (opening.xMin >= opening.xMax || opening.xMin < e.wall || opening.xMax > e.width - e.wall) {
    issues.error("OPENING_INVALID", `The opening runs from x = ${mm(opening.xMin)} to ${mm(opening.xMax)}, which must be inside the walls of a ${mm(e.width)} wide enclosure.`, "opening");
  }
  if (opening.yEnd <= e.wall || opening.yEnd >= profile.depth - e.wall) {
    issues.error("OPENING_INVALID", `The opening ends at y = ${mm(opening.yEnd)}, which must be inside the ${mm(profile.depth)} depth.`, "opening.yEnd");
  }
  // The point of keepOut: anything past the opening has to fit under the surfaces above it.
  opening.keepOut.forEach((box, i) => {
    const y0 = Math.max(box.yMin, opening.yEnd);
    if (y0 >= box.yMax) return;
    const ceiling = lowestHeight(profile.inner, y0, box.yMax);
    if (box.top > ceiling) {
      issues.error("OPENING_INVALID", `What the opening holds reaches ${mm(box.top)} from y = ${mm(box.yMin)} to ${mm(box.yMax)}, but the underside of the top drops to ${mm(ceiling)} there. Extend opening.yEnd or raise that surface.`, `opening.keepOut[${i}]`);
    }
  });
  const rail = opening.rail;
  if (rail) {
    if (opening.sill <= rail.footHeight) {
      issues.error("OPENING_INVALID", `The rail's ${mm(rail.footHeight)} feet need a sill taller than that, but it's ${mm(opening.sill)}.`, "opening.sill");
    }
    const [left, right] = rail.screwX;
    if (left >= opening.xMin || right <= opening.xMax) {
      issues.error("OPENING_INVALID", "The rail's two screws must be either side of the opening, under the shell.", "opening.rail.screwX");
    }
  }
}

function planTopPieces(config: Config, profile: Profile, firstIndex: number, limits: Limits, issues: Issues): TopPiece[] {
  const e = config.enclosure;
  const { x: bedX, y: bedY } = config.fabrication.buildVolume;
  const pieces: TopPiece[] = [];
  const seen = new Set<string>();
  config.topPanels.forEach((panel, i) => {
    const surface = profile.surfaces.find((s) => s.id === panel.surface);
    if (!surface) {
      issues.error("TOP_PANEL_INVALID", `Top panel ${i + 1} is on surface "${panel.surface}", which doesn't exist.`, `topPanels[${i}].surface`);
      return;
    }
    if (seen.has(panel.surface)) {
      issues.error("TOP_PANEL_INVALID", `Surface "${panel.surface}" has two top panels.`, `topPanels[${i}].surface`);
      return;
    }
    seen.add(panel.surface);
    // A deck the opening passes all the way through falls into separate pieces, whether or
    // not a split is listed. A surface the opening stops partway up stays in one piece.
    const opening = config.opening;
    const inOpening = opening && surface.y1 <= opening.yEnd;
    const cuts = [...panel.splits];
    const ranges: [number, number][] = [];
    const bounds = [0, ...cuts.sort((a, b) => a - b), e.width];
    for (let n = 0; n < bounds.length - 1; n++) {
      const from = bounds[n]!;
      const to = bounds[n + 1]!;
      if (inOpening) {
        if (from < opening.xMin) ranges.push([from, Math.min(to, opening.xMin)]);
        if (to > opening.xMax) ranges.push([Math.max(from, opening.xMax), to]);
      } else {
        ranges.push([from, to]);
      }
    }
    const usable = ranges.filter(([from, to]) => to - from > 0.01);
    // Only pieces that meet get a tongue, and not those either side of the opening.
    const meets = (n: number) => panel.joint === "tongue" && n >= 0 && n < usable.length - 1 && Math.abs(usable[n]![1] - usable[n + 1]![0]) < 0.01;
    const root = Math.min(TONGUE_ROOT, e.panelThickness - 2 * limits.minSkin - 2 * TONGUE_FIT);
    if (usable.some((_, n) => meets(n)) && root < MIN_TONGUE_ROOT) {
      issues.error("TOP_PANEL_INVALID", `A ${mm(e.panelThickness)} panel is too thin for a tongue where ${panel.surface} splits, which needs ${mm(2 * limits.minSkin + 2 * TONGUE_FIT + MIN_TONGUE_ROOT)}. Make the panel thicker, or set its joint to "flat".`, `topPanels[${i}].joint`);
    }
    const vFrom = TONGUE_INSET;
    const vTo = surface.length - TONGUE_INSET - (surface.index === profile.surfaces.length - 1 ? profile.rearTangent : 0);
    const joint = (x: number): TopJoint => ({ x, face: limits.minSkin + TONGUE_FIT, root, vFrom, vTo });
    usable.forEach(([from, to], n) => {
      const name = `${panel.surface[0]!.toUpperCase()}${panel.surface.slice(1)}${usable.length > 1 ? ` ${n + 1}` : ""}`;
      const tongued = root >= MIN_TONGUE_ROOT && vTo > vFrom;
      pieces.push({ printedPart: firstIndex + pieces.length, surface: panel.surface, xMin: from, xMax: to, name, tongue: tongued && meets(n) ? joint(to) : null, groove: tongued && meets(n - 1) ? joint(from) : null });
      const across = surface.length;
      const fits = (to - from <= bedX && across <= bedY) || (to - from <= bedY && across <= bedX);
      if (!fits) {
        issues.error("PART_TOO_LARGE", `${name} is ${mm(to - from)} x ${mm(across)}, which doesn't fit the ${bedX} x ${bedY} mm bed. Add a split.`, `topPanels[${i}].splits`);
      }
    });
  });
  return pieces;
}

function topPrintedPart(piece: TopPiece, config: Config, profile: Profile): PrintedPart {
  const surface = profile.surfaces.find((s) => s.id === piece.surface)!;
  const color = topPanelFor(config, piece.surface)!.color;
  // A tongue sticks out past its piece.
  const size: [number, number, number] = [piece.xMax - piece.xMin + (piece.tongue?.root ?? 0), surface.length, Math.abs(surface.z1 - surface.z0) + config.enclosure.panelThickness];
  return { index: piece.printedPart, kind: "top", name: piece.name, color, xMin: piece.xMin, xMax: piece.xMax, size };
}

function planRailPart(config: Config, index: number, issues: Issues): PrintedPart[] {
  const opening = config.opening;
  const rail = opening?.rail;
  if (!opening || !rail) return [];
  const xMin = rail.screwX[0] - RAIL_FOOT_MARGIN;
  const xMax = rail.screwX[1] + RAIL_FOOT_MARGIN;
  // A front round takes some of the rail's depth, as far up as the sill.
  const round = config.enclosure.rounds.frontBottom;
  const lost = round > opening.sill ? round - Math.sqrt(round * round - (round - opening.sill) * (round - opening.sill)) : 0;
  const { x: bedX, y: bedY } = config.fabrication.buildVolume;
  if (xMax - xMin > Math.max(bedX, bedY)) {
    issues.error("PART_TOO_LARGE", `The front rail is ${mm(xMax - xMin)} long, which doesn't fit the ${bedX} x ${bedY} mm bed. Make the opening narrower.`, "opening.rail.screwX");
  }
  return [{ index, kind: "rail", name: "Front rail", color: rail.color ?? config.enclosure.color, xMin, xMax, size: [xMax - xMin, rail.depth - lost, opening.sill] }];
}

function planTopScrews(config: Config, profile: Profile, pieces: TopPiece[], seams: PlannedSeam[], placed: Placed[], cutouts: PlacedShape[], limits: Limits, fixtures: Fixtures, fasteners: PlannedFasteners, issues: Issues): TopScrew[] {
  if (pieces.length === 0) return [];
  const e = config.enclosure;
  const t = e.panelThickness;
  const r = TOP_POST_DIAMETER / 2;
  const near = e.wall + r + 0.3; // a post can't touch the wall, because it's on a separate part
  const rearWallY = profile.depth - e.wall;
  const obstacles: TopObstacles = {
    cutouts: cutouts.map(({ surface, shape }) => ({ surface: surface.id, shape })),
    bodies: placed.flatMap((p) => {
      if (p.part.mount !== "panel" || !p.surface || p.part.below.depth === 0) return [];
      const shape = p.shape("below");
      const [hu, hv] = halfExtents(shape);
      const surface = p.surface;
      const far = -t - p.part.below.depth;
      return [{ xLow: shape.cx - hu, xHigh: shape.cx + hu, section: [surfacePoint(surface, shape.cy - hv, -t), surfacePoint(surface, shape.cy + hv, -t), surfacePoint(surface, shape.cy + hv, far), surfacePoint(surface, shape.cy - hv, far)] }];
    }),
    floorParts: [...placed.filter((p) => p.part.mount === "floor").map((p) => p.shape("below")), ...fixtures.blocks.map(blockShape)],
    opening: config.opening ?? null,
    blockedBoxes: [...reservedBoxes(config), ...fixtures.holeBoxes].map((box) => ({ xLow: box.xMin, xHigh: box.xMax, yLow: box.yMin, yHigh: box.yMax, zTop: box.top })),
    seamTabs: seams.flatMap((seam) => seam.tabs.map((tab) => ({ xLow: seam.x - seam.ribHalfThickness - seam.ribWidth, xHigh: seam.x + seam.ribHalfThickness + seam.ribWidth, section: tabSection(tab) }))),
    minWeb: limits.minWeb,
    partClearance: PART_CLEARANCE,
    openBase: { yLow: profile.plateFront, yHigh: profile.plateRear },
    railBlocks: railBlocks(config).map((block) => ({ xLow: block.xMin, xHigh: block.xMax, yLow: block.yMin, yHigh: block.yMax })),
    seamPaths: seamDriverPaths(seams),
  };
  // How far along a wall a screw can go and still have a clear path from below.
  const driver = DRIVER_DIAMETER / 2;
  const edgeSpan = (surface: Surface) => ({
    yLow: Math.max(Math.max(surface.y0, e.wall) + r + 1, profile.plateFront + driver),
    yHigh: Math.min(surface.y1 - r - 1, profile.plateRear - driver),
  });
  const frontY = Math.max(near, profile.plateFront + driver);
  type TakenScrew = { screw: TopScrew; tab: { xLow: number; xHigh: number; yLow: number; yHigh: number } };
  const opening = config.opening;
  const surfaceOf = (piece: TopPiece) => profile.surfaces.find((s) => s.id === piece.surface)!;
  const rearEdge = (surface: Surface) => {
    const next = profile.surfaces[surface.index + 1];
    return next !== undefined && !topPanelFor(config, next.id);
  };
  // Tabs can overlap, or stand apart, but two that only just touch meet along a line, which
  // isn't a solid that can be printed.
  const tabsTouch = (a: TakenScrew["tab"], b: TakenScrew["tab"]) => {
    const dx = Math.max(a.xLow - b.xHigh, b.xLow - a.xHigh);
    const dy = Math.max(a.yLow - b.yHigh, b.yLow - a.yHigh);
    return (Math.abs(dx) < TAB_TOUCH_MARGIN && dy < TAB_TOUCH_MARGIN) || (Math.abs(dy) < TAB_TOUCH_MARGIN && dx < TAB_TOUCH_MARGIN);
  };
  const crowds = (a: TopScrew, b: TopScrew) => a.piece === b.piece && Math.hypot(a.x - b.x, a.y - b.y) < MIN_TOP_SCREW_SPACING;

  const FALLBACK_SCREW_RANGE = 45; // a third of the most a top panel should have between screws
  // A screw at this spot, or why it can't go there given the ones already taken.
  const trySpot = (pieceIndex: number, wall: TopScrew["wall"], x: number, y: number, taken: TakenScrew[], wholeGusset = false): TakenScrew | string => {
    const piece = pieces[pieceIndex]!;
    const surface = surfaceOf(piece);
    if (x < piece.xMin + r || x > piece.xMax - r) return "it's past the end of its piece of the panel";
    if (opening && x > opening.xMin - r - 1 && x < opening.xMax + r + 1 && y < opening.yEnd + r + 1) return "it's in the opening";
    const candidate: TopScrew = { x, y, wall, postBottom: postBottomAt(profile, y), piece: pieceIndex };
    if (taken.some(({ screw }) => crowds(screw, candidate))) return `another screw is closer than ${mm(MIN_TOP_SCREW_SPACING)}`;
    const v = (y - surface.y0) / surface.cos;
    const sizes = {
      wall: e.wall,
      width: e.width,
      depth: profile.depth,
      cornerRadius: e.cornerRadius,
      floorThickness: e.floorThickness,
      rearWallY: wall === "rear" ? surface.y1 + 3 : rearWallY,
      seamXs: seams.map((seam) => seam.x),
      onSide: shellPrintsOnSide(seams.length),
      wholeGusset,
    };
    const problem = topScrewProblem(profile, obstacles, surface.id, candidate, sizes, { u: x, v });
    if (problem) return problem;
    const extent = topTabExtent(candidate, e.wall, e.width, sizes.rearWallY, sizes.onSide);
    const tab = { xLow: extent.xLow - extent.spread, xHigh: extent.xHigh + extent.spread, yLow: extent.yLow, yHigh: extent.yHigh };
    if (taken.some((other) => tabsTouch(other.tab, tab))) return "its tab would only just touch another, which can't be printed";
    const spot = { screw: candidate, tab };
    if (taken.some((other) => blocksTopDriver(other, candidate) || blocksTopDriver(spot, other.screw))) return "another top screw would block a screwdriver";
    return spot;
  };

  let taken: TakenScrew[] = [];
  pieces.forEach((piece, pieceIndex) => {
    const surface = surfaceOf(piece);
    const { yLow, yHigh } = edgeSpan(surface);
    const attempt = (wall: TopScrew["wall"], x: number, y: number, wholeGusset: boolean): boolean => {
      const spot = trySpot(pieceIndex, wall, x, y, taken, wholeGusset);
      if (typeof spot === "string") return false;
      taken.push(spot);
      return true;
    };
    const along = (wall: TopScrew["wall"], x0: number, x1: number, fixed: number, vertical: boolean) => {
      const span = x1 - x0;
      if (span <= 0) return;
      fasteners.edges.push({ kind: "top", surface: surface.id, wall, along: vertical ? "y" : "x", fixed, from: x0, to: x1 });
      const stops = Math.max(3, Math.ceil(span / 90) + 1);
      // Each spot near a stop, first only where a tab's whole gusset fits, then anywhere.
      const near = (target: number, wholeGusset: boolean): boolean => {
        for (let offset = 0; offset <= 20; offset += 2) {
          for (const sign of offset === 0 ? [1] : [1, -1]) {
            const position = target + sign * offset;
            if (position < x0 - 0.01 || position > x1 + 0.01) continue;
            if (vertical ? attempt(wall, fixed, position, wholeGusset) : attempt(wall, position, fixed, wholeGusset)) return true;
          }
        }
        return false;
      };
      for (let i = 0; i < stops; i++) {
        const target = x0 + (span * i) / (stops - 1);
        if (!near(target, true)) fallbacks.push({ at: vertical ? [fixed, target] : [target, fixed], place: () => near(target, false) });
      }
    };
    // A tab whose gusset can't reach the wall needs a little support, so one only goes where no
    // other screw is near enough to make up for leaving it out.
    const fallbacks: { at: Point2; place: () => boolean }[] = [];
    if (piece.xMin <= 0.01) along("left", yLow, yHigh, near, true);
    if (piece.xMax >= e.width - 0.01) along("right", yLow, yHigh, e.width - near, true);
    const xFrom = piece.xMin + r + 1;
    const xTo = piece.xMax - r - 1;
    if (surface.y0 <= 0.01) along("front", xFrom, xTo, frontY, false);
    if (rearEdge(surface)) along("rear", xFrom, xTo, yHigh, false);
    for (const { at: [x, y], place } of fallbacks) {
      if (!taken.some(({ screw }) => screw.piece === pieceIndex && Math.hypot(screw.x - x, screw.y - y) < FALLBACK_SCREW_RANGE)) place();
    }
  });

  const atOf = (screw: Pick<TopScrew, "x" | "y" | "wall">) => (screw.wall === "left" || screw.wall === "right" ? screw.y : screw.x);

  // Changes in the config come after, so that changing one screw leaves the others where they are.
  const added: { spot: TakenScrew | string; panel: number; index: number; x: number; y: number; wall: TopScrew["wall"]; surface: string }[] = [];
  config.topPanels.forEach((panel, panelIndex) => {
    const surface = profile.surfaces.find((s) => s.id === panel.surface);
    if (!surface) return;
    const isThisPanel = (i: number) => pieces[i]!.surface === panel.surface;
    panel.fasteners.remove.forEach((removal, i) => {
      const matched = taken.filter(({ screw }) => isThisPanel(screw.piece) && screw.wall === removal.wall && Math.abs(atOf(screw) - removal.at) <= FASTENER_MATCH);
      if (matched.length === 0) {
        issues.warn("FASTENER_CHANGE_UNUSED", `There's no longer a screw on the ${removal.wall} edge at ${mm(removal.at)} of ${panel.surface} to remove, because the design has changed. Delete this change, or remove the screw again.`, `topPanels[${panelIndex}].fasteners.remove[${i}]`);
      }
      taken = taken.filter((item) => !matched.includes(item));
    });
  });
  const placedAdds: TakenScrew[] = [];
  config.topPanels.forEach((panel, panelIndex) => {
    const surface = profile.surfaces.find((s) => s.id === panel.surface);
    if (!surface) return;
    const { yLow, yHigh } = edgeSpan(surface);
    panel.fasteners.add.forEach(({ wall, at }, index) => {
      const sideways = wall === "left" || wall === "right";
      const x = wall === "left" ? near : wall === "right" ? e.width - near : at;
      const y = sideways ? at : wall === "front" ? frontY : yHigh;
      const hasEdge = wall === "front" ? surface.y0 <= 0.01 : wall === "rear" ? rearEdge(surface) : true;
      const pieceIndex = pieces.findIndex((piece) => {
        if (piece.surface !== panel.surface) return false;
        if (wall === "left") return piece.xMin <= 0.01;
        if (wall === "right") return piece.xMax >= e.width - 0.01;
        return at >= piece.xMin && at <= piece.xMax;
      });
      let spot: TakenScrew | string;
      if (!hasEdge || pieceIndex === -1) spot = `${panel.surface} has no ${wall} edge there to fix it to`;
      else if (sideways && (at < yLow || at > yHigh)) spot = "it's past the end of the panel";
      else spot = trySpot(pieceIndex, wall, x, y, placedAdds);
      if (typeof spot === "string") {
        issues.error("TOP_PANEL_INVALID", `The added screw on the ${wall} edge of ${panel.surface} at ${mm(at)} can't go there, because ${spot}.`, `topPanels[${panelIndex}].fasteners.add[${index}]`);
      } else {
        placedAdds.push(spot);
      }
      added.push({ spot, panel: panelIndex, index, x, y, wall, surface: panel.surface });
    });
  });
  // What's added wins over an automatic screw that's in its way.
  for (const item of placedAdds) {
    taken = taken.filter((other) => !crowds(other.screw, item.screw) && !tabsTouch(other.tab, item.tab) && !blocksTopDriver(other, item.screw) && !blocksTopDriver(item, other.screw));
  }
  taken.push(...placedAdds);

  const screws = taken.map(({ screw }) => screw);
  pieces.forEach((piece, pieceIndex) => {
    const held = screws.filter((s) => s.piece === pieceIndex);
    const panelIndex = config.topPanels.findIndex((panel) => panel.surface === piece.surface);
    if (held.length < MIN_TOP_SCREWS) {
      issues.error("TOP_PANEL_INVALID", `${piece.name} only has ${held.length} ${held.length === 1 ? "screw" : "screws"} holding it, and needs ${MIN_TOP_SCREWS}. Parts, the opening or a removed screw are leaving its edges bare. Move them, or change topPanels.`, "topPanels");
      return;
    }
    const surface = surfaceOf(piece);
    const across = (positions: number[], from: number, to: number, what: string) => {
      const sorted = [...positions].sort((a, b) => a - b);
      const gaps = sorted.slice(1).map((value, i) => value - sorted[i]!);
      const inside = Math.max(0, ...gaps);
      const end = Math.max(sorted[0]! - from, to - sorted.at(-1)!);
      const pieceBox: IssueBox = { min: [piece.xMin, Math.max(surface.y0, e.wall), Math.min(surface.z0, surface.z1) - t], max: [piece.xMax, surface.y1, Math.max(surface.z0, surface.z1)] };
      if (inside > TOP_SCREW_GAP) {
        issues.warn("FASTENER_GAP", `${piece.name} has ${mm(inside)} between screws ${what}, so it may lift or flex there. Add a screw if there's room, or add a split.`, `topPanels[${panelIndex}]`, [], pieceBox);
      } else if (end > TOP_SCREW_FREE_END) {
        issues.warn("FASTENER_GAP", `${piece.name} runs ${mm(end)} ${what} past its last screw, so that end may lift. Add a screw if there's room, or add a split.`, `topPanels[${panelIndex}]`, [], pieceBox);
      }
    };
    across(held.map((s) => s.x), piece.xMin, piece.xMax, "across its width");
    across(held.map((s) => s.y), Math.max(surface.y0, e.wall), surface.y1, "along its depth");
  });

  const round = (value: number) => Math.round(value * 100) / 100;
  for (const { screw } of taken) {
    if (added.some(({ spot }) => typeof spot !== "string" && spot.screw === screw)) continue;
    const surface = pieces[screw.piece]!.surface;
    fasteners.items.push({ id: `top:${surface}:${screw.wall}:${round(atOf(screw))}`, kind: "top", x: screw.x, y: screw.y, z: screw.postBottom, surface, wall: screw.wall, addedAt: null, problem: null });
  }
  for (const { spot, panel, index, x, y, wall, surface } of added) {
    fasteners.items.push({ id: `topPanels[${panel}].fasteners.add[${index}]`, kind: "top", x, y, z: postBottomAt(profile, y), surface, wall, addedAt: index, problem: typeof spot === "string" ? spot : null });
  }
  return screws.sort((a, b) => a.piece - b.piece || a.x - b.x || a.y - b.y);
}

class Issues {
  private all: Issue[] = [];

  error(code: IssueCode, message: string, path: string, componentIds: string[] = [], where?: IssueBox) {
    this.all.push({ severity: "error", code, message, path, componentIds, ...(where ? { where } : {}) });
  }

  warn(code: IssueCode, message: string, path: string, componentIds: string[] = [], where?: IssueBox) {
    this.all.push({ severity: "warning", code, message, path, componentIds, ...(where ? { where } : {}) });
  }

  hasError(...codes: IssueCode[]) {
    return this.all.some((i) => i.severity === "error" && codes.includes(i.code));
  }

  failure(): ValidationResult {
    return {
      ok: false,
      errors: this.all.filter((i) => i.severity === "error"),
      warnings: this.all.filter((i) => i.severity === "warning"),
    };
  }

  result(plan: BuildPlan): ValidationResult {
    if (this.all.some((i) => i.severity === "error")) {
      return { ok: false, errors: this.all.filter((i) => i.severity === "error"), warnings: this.all.filter((i) => i.severity === "warning"), fasteners: plan.fasteners };
    }
    return { ok: true, plan, warnings: this.all };
  }
}

function formatPath(path: readonly PropertyKey[]): string {
  return path.reduce<string>(
    (out, key) => (typeof key === "number" ? `${out}[${key}]` : out ? `${out}.${String(key)}` : String(key)),
    "",
  );
}

// A part's holes at the size a fit test chose, so that every check sees the holes that get cut.
export function fittedPart(part: Part, change: number): Part {
  if (change === 0) return part;
  if (part.mount === "wall") return { ...part, holes: part.holes.map((hole) => ({ ...hole, width: hole.width + change, height: hole.height + change })) };
  if (part.mount === "floor") return part.port ? { ...part, port: { ...part.port, width: part.port.width + change, height: part.port.height + change } } : part;
  const cutouts = part.cutouts.map((cutout) => {
    // A notch grows like the hole it's off, so its far side moves as the hole's does.
    const grown = <T extends { notches?: { width: number; height: number; at: [number, number] }[] | undefined }>(owner: T): T =>
      owner.notches ? { ...owner, notches: owner.notches.map((notch) => ({ ...notch, width: notch.width + change, height: notch.height + change })) } : owner;
    if (cutout.kind === "circle") return grown({ ...cutout, diameter: cutout.diameter + change });
    const sized = { ...cutout, width: cutout.width + change, height: cutout.height + change };
    if (sized.kind === "pocket") return sized;
    if (!sized.recess) return grown(sized);
    return grown({ ...sized, recess: grown({ ...sized.recess, width: sized.recess.width + change, height: sized.recess.height + change }) });
  });
  return { ...part, cutouts };
}

function withFittedHoles(parts: Record<string, Part>, changes: Record<string, number>): Record<string, Part> {
  return Object.fromEntries(Object.entries(parts).map(([id, part]) => [id, fittedPart(part, changes[id] ?? 0)]));
}

function definedOnly(f: Config["fabrication"]) {
  return {
    ...(f.minWall !== undefined && { minWall: f.minWall }),
    ...(f.minWeb !== undefined && { minWeb: f.minWeb }),
    ...(f.minSkin !== undefined && { minSkin: f.minSkin }),
  };
}

function checkWalls(config: Config, limits: Limits, issues: Issues) {
  const e = config.enclosure;
  const material = config.fabrication.material;
  if (e.wall < limits.minWall) {
    issues.error("WALL_TOO_THIN", `Wall is ${mm(e.wall)}, but ${material} needs at least ${mm(limits.minWall)}.`, "enclosure.wall");
  }
  if (e.panelThickness < limits.minWall) {
    issues.error("WALL_TOO_THIN", `Panel is ${mm(e.panelThickness)}, but ${material} needs at least ${mm(limits.minWall)}.`, "enclosure.panelThickness");
  }
}

function checkRounds(config: Config, surfaces: Surface[], issues: Issues) {
  const e = config.enclosure;
  const { frontBottom, rearTop, rearBottom } = e.rounds;
  const last = surfaces.at(-1)!;
  const fail = (key: string, message: string) => issues.error("GEOMETRY_IMPOSSIBLE", message, `enclosure.rounds.${key}`);
  for (const [key, radius] of Object.entries(e.rounds)) {
    if (radius > 0 && radius <= e.wall + MIN_ROUND_PAST_WALL) fail(key, `A ${key} round of ${mm(radius)} needs to be more than ${mm(e.wall + MIN_ROUND_PAST_WALL)}, past the ${mm(e.wall)} wall.`);
  }
  if (frontBottom >= surfaces[0]!.z0) fail("frontBottom", `A ${mm(frontBottom)} round is taller than the ${mm(surfaces[0]!.z0)} front wall.`);
  if (frontBottom + rearBottom >= last.y1 - MIN_FLAT_BASE) fail("rearBottom", `The bottom rounds leave less than ${mm(MIN_FLAT_BASE)} of flat base in the ${mm(last.y1)} depth.`);
  if (rearTop > 0) {
    const tangent = rearTangentLength(last, rearTop);
    if (tangent >= last.length) fail("rearTop", `A ${mm(rearTop)} round takes ${mm(tangent)} of surface "${last.id}", which is only ${mm(last.length)} long.`);
    if (tangent + rearBottom > last.z1) fail("rearTop", `The rear rounds need ${mm(tangent + rearBottom)} of wall, and it's only ${mm(last.z1)} high.`);
    if (topPanelFor(config, last.id)) issues.error("TOP_PANEL_INVALID", `Surface "${last.id}" ends in a round, so it can't be a separate top panel, which prints flat.`, "topPanels");
  }
  if ((frontBottom > 0 || rearTop > 0 || rearBottom > 0) && e.topEdgeFillet > 0) fail("rearTop", "A top edge fillet can't be used with rounds yet. Set it to 0.");
  const rail = config.opening?.rail;
  if (rail && rail.depth < frontBottom + 1) issues.error("OPENING_INVALID", `The rail is ${mm(rail.depth)} deep, and needs to reach past the ${mm(frontBottom)} front round.`, "opening.rail.depth");
}

function planProfile(config: Config, issues: Issues): Profile | null {
  const e = config.enclosure;
  const ids = new Set<string>();
  let previousY = 0;
  let sound = true;
  e.surfaces.forEach((s, i) => {
    const path = `enclosure.surfaces[${i}]`;
    if (ids.has(s.id)) {
      issues.error("SURFACE_INVALID", `Surface id "${s.id}" is used twice.`, `${path}.id`);
      sound = false;
    }
    ids.add(s.id);
    if (s.y <= previousY) {
      issues.error("SURFACE_INVALID", `Surface "${s.id}" ends at y = ${mm(s.y)}, but surfaces must run from front to rear, past y = ${mm(previousY)}.`, `${path}.y`);
      sound = false;
    }
    previousY = s.y;
  });
  if (!sound) return null;

  const surfaces = buildSurfaces(e.frontHeight, e.surfaces);
  surfaces.forEach((s, i) => {
    const path = `enclosure.surfaces[${i}]`;
    if (Math.abs(degrees(s.angle)) > MAX_SURFACE_ANGLE) {
      issues.error("SURFACE_INVALID", `Surface "${s.id}" slopes at ${Math.round(degrees(s.angle))}°, and the limit is ${MAX_SURFACE_ANGLE}°.`, path);
      sound = false;
    }
    const next = surfaces[i + 1];
    if (next && Math.abs(degrees(next.angle - s.angle)) < MIN_CREASE_ANGLE) {
      issues.error("SURFACE_INVALID", `Surfaces "${s.id}" and "${next.id}" meet at under ${MIN_CREASE_ANGLE}°. Merge them into one surface.`, `enclosure.surfaces[${i + 1}]`);
      sound = false;
    }
  });
  if (!sound) return null;

  const depth = surfaces.at(-1)!.y1;
  if (2 * e.wall >= Math.min(e.width, depth)) {
    issues.error("GEOMETRY_IMPOSSIBLE", `Walls of ${mm(e.wall)} leave no cavity in a ${mm(e.width)} x ${mm(depth)} footprint.`, "enclosure.wall");
    return null;
  }
  checkRounds(config, surfaces, issues);
  if (issues.hasError("GEOMETRY_IMPOSSIBLE")) return null;
  const profile = buildProfile(surfaces, e);
  if (!profile) {
    issues.error("GEOMETRY_IMPOSSIBLE", `A surface is too short for a ${mm(e.panelThickness)} panel and ${mm(e.wall)} walls, so the inside has no shape. Lengthen it or merge it with a neighbour.`, "enclosure.surfaces");
    return null;
  }
  const lowest = Math.min(...profile.inner.map(([, z]) => z));
  if (lowest <= e.floorThickness) {
    issues.error("GEOMETRY_IMPOSSIBLE", `The underside of the top drops to ${mm(lowest)} above the base, leaving no room over the ${mm(e.floorThickness)} floor. Reduce the slope or raise the enclosure.`, "enclosure.surfaces");
    return null;
  }
  return profile;
}

function checkProfileRadii(config: Config, profile: Profile, issues: Issues) {
  const e = config.enclosure;
  if (2 * e.cornerRadius >= Math.min(e.width, profile.depth)) {
    issues.error("GEOMETRY_IMPOSSIBLE", `Corner radius ${mm(e.cornerRadius)} is too large for a ${mm(e.width)} x ${mm(profile.depth)} footprint.`, "enclosure.cornerRadius");
  }
  if (e.topEdgeFillet >= e.wall) {
    issues.error("GEOMETRY_IMPOSSIBLE", `Top edge fillet ${mm(e.topEdgeFillet)} must be smaller than the ${mm(e.wall)} wall.`, "enclosure.topEdgeFillet");
  }
  if (e.topEdgeFillet > 0 && profile.surfaces.length > 1) {
    issues.error("GEOMETRY_IMPOSSIBLE", "A top edge fillet only works with a single surface so far. Set it to 0.", "enclosure.topEdgeFillet");
  }
}

// Whether an opening takes away a wall a seam tab would use.
function wallGoneAtSeam(seam: Config["seams"][number], config: Config) {
  const opening = config.opening;
  const reachX = seam.ribHalfThickness + seam.ribWidth;
  return (tab: SeamTab) => {
    if (!opening || seam.x + reachX <= opening.xMin || seam.x - reachX >= opening.xMax) return false;
    return Math.min(...tabSection(tab).map(([y]) => y)) < opening.yEnd;
  };
}

// Where a low end moves a wall's tab in along the floor, all it can hang from is the surface above,
// and a top panel isn't part of the shell. With no round there either, it would be left floating.
function tabHoldsOnToNothing(config: Config, profile: Profile) {
  const { wall } = config.enclosure;
  return (tab: SeamTab) => {
    const y = tab.start[0];
    if (tab.surface || Math.abs(y - wall) < 0.01 || Math.abs(y - (profile.depth - wall)) < 0.01) return false;
    if (y < profile.plateFront || y > profile.plateRear) return false;
    const surface = profile.surfaces.find((s) => y <= s.y1) ?? profile.surfaces.at(-1)!;
    return topPanelFor(config, surface.id) !== undefined;
  };
}

// Whether a part stops a tab going here. Tabs slope out past the rib's own thickness.
function tabBlockers(seam: Config["seams"][number], placed: Placed[], cutouts: PlacedShape[], config: Config, minWeb: number) {
  const reachX = seam.ribHalfThickness + seam.ribWidth;
  const t = config.enclosure.panelThickness;
  const floorTop = config.enclosure.floorThickness;
  const opening = config.opening;
  return (tab: SeamTab) => {
    const quad = tabSection(tab);
    // A tab under a top panel would have nothing on the shell to hang from.
    if (tab.surface && topPanelFor(config, tab.surface)) return true;
    if (opening && seam.x + reachX > opening.xMin && seam.x - reachX < opening.xMax) {
      const ys = quad.map(([y]) => y);
      if (Math.min(...ys) < opening.yEnd) return true;
      for (const box of reservedBoxes(config)) {
        if (seam.x + reachX <= box.xMin || seam.x - reachX >= box.xMax) continue;
        const area: Point2[] = [[box.yMin, 0], [box.yMax, 0], [box.yMax, box.top], [box.yMin, box.top]];
        if (polygonsOverlap(quad, area)) return true;
      }
    }
    for (const item of placed) {
      const shape = item.shape("below");
      const [hu, hv] = halfExtents(shape);
      if (Math.abs(shape.cx - seam.x) - hu - reachX >= PART_CLEARANCE) continue;
      if (item.part.mount === "floor") {
        const top = floorTop + item.part.height;
        const box: Point2[] = [[shape.cy - hv, floorTop], [shape.cy + hv, floorTop], [shape.cy + hv, top], [shape.cy - hv, top]];
        if (polygonsOverlap(quad, box)) return true;
      } else if (item.part.mount === "panel" && item.surface && item.part.below.depth > 0) {
        const surface = item.surface;
        const far = -t - item.part.below.depth;
        const body = [surfacePoint(surface, shape.cy - hv, -t), surfacePoint(surface, shape.cy + hv, -t), surfacePoint(surface, shape.cy + hv, far), surfacePoint(surface, shape.cy - hv, far)];
        if (polygonsOverlap(quad, body)) return true;
      }
    }
    // A tab under a surface can't sit behind a hole in it.
    for (const { shape, surface } of cutouts) {
      const [hu, hv] = halfExtents(shape);
      if (Math.abs(shape.cx - seam.x) - hu - reachX >= minWeb) continue;
      const [yLow] = surfacePoint(surface, shape.cy - hv, 0);
      const [yHigh] = surfacePoint(surface, shape.cy + hv, 0);
      const ys = quad.map(([y]) => y);
      if (Math.min(...ys) < yHigh + minWeb && Math.max(...ys) > yLow - minWeb) return true;
    }
    return false;
  };
}

function planSeams(config: Config, profile: Profile, placed: Placed[], cutouts: PlacedShape[], minWeb: number, issues: Issues): PlannedSeam[] {
  const e = config.enclosure;
  const planned: PlannedSeam[] = [];
  config.seams.forEach((seam, i) => {
    const path = `seams[${i}]`;
    if (config.seams.findIndex((other) => other.x === seam.x) < i) {
      issues.error("SEAM_INVALID", `There's already a seam at x = ${mm(seam.x)}.`, `${path}.x`);
      return;
    }
    if (seam.x < MIN_PART_WIDTH || seam.x > e.width - MIN_PART_WIDTH) {
      issues.error("SEAM_INVALID", `Seam at x = ${mm(seam.x)} would leave a part narrower than ${mm(MIN_PART_WIDTH)} in a ${mm(e.width)} wide enclosure.`, `${path}.x`);
    }
    if (seam.ribWidth < MIN_RIB_WIDTH) {
      issues.error("SEAM_INVALID", `Rib width ${mm(seam.ribWidth)} is under the ${mm(MIN_RIB_WIDTH)} needed for M3 bolts.`, `${path}.ribWidth`);
    }
    if (seam.ribHalfThickness < MIN_RIB_HALF_THICKNESS) {
      issues.error("SEAM_INVALID", `Rib half thickness ${mm(seam.ribHalfThickness)} is under the ${mm(MIN_RIB_HALF_THICKNESS)} needed for alignment pins.`, `${path}.ribHalfThickness`);
    }
    if (2 * (e.wall + seam.ribWidth) >= profile.depth) {
      issues.error("GEOMETRY_IMPOSSIBLE", `Ribs of ${mm(seam.ribWidth)} fill the whole ${mm(profile.depth)} depth.`, `${path}.ribWidth`);
      return;
    }
    let unheldEnds = 0;
    const fasteners = layoutSeamFasteners(
      profile.surfaces,
      profile.inner,
      {
        wall: e.wall,
        panelThickness: e.panelThickness,
        ribWidth: seam.ribWidth,
        ribBase: config.plate.enabled ? e.floorThickness : 0,
        lower: Object.values(e.rounds).some((radius) => radius > 0) ? profile.lower : undefined,
        rearTangent: profile.rearTangent,
      },
      tabBlockers(seam, placed, cutouts, config, minWeb),
      (tab) => {
        const nothing = tabHoldsOnToNothing(config, profile)(tab);
        if (nothing) unheldEnds += 1;
        return nothing || wallGoneAtSeam(seam, config)(tab);
      },
    );
    if (!fasteners) {
      issues.error("SEAM_INVALID", "A seam needs room for a bolt and a pin at the front or rear, but the enclosure is too low, a surface is too short, or an opening took both walls. Raise it or move the seam.", path);
      return;
    }
    if (unheldEnds > 0) issues.warn("SEAM_UNBRACED", `One end of the seam at x = ${mm(seam.x)} has no bolt, because that end is too low for one at the wall and there's only a top panel further in to hang it from. Only the plate and top panel tie the halves together there. Making it taller there would fix it.`, path);
    const topBolts = fasteners.tabs.filter((tab) => tab.surface).length;
    if (topBolts === 0 && config.topPanels.length === 0) {
      issues.warn("SEAM_UNBRACED", `Parts leave no room for a tab under any surface at the seam at x = ${mm(seam.x)}, so it's only bolted at the front and rear. Move parts away from it if you can.`, path);
    }
    if (seam.lip > 0) {
      const reach = seam.ribHalfThickness + seam.ribWidth;
      if (seam.lip < MIN_LIP) issues.error("SEAM_INVALID", `A lip of ${mm(seam.lip)} is too short to line the halves up. Make it at least ${mm(MIN_LIP)}, or 0 for none.`, `${path}.lip`);
      if (seam.lip > reach) issues.error("SEAM_INVALID", `A lip of ${mm(seam.lip)} reaches past the room kept clear round the seam, ${mm(reach)} either side. Make it shorter.`, `${path}.lip`);
      // The lip is the outer half of the skin, and what it fits over is the inner half less the gap.
      const thinnest = Math.min(e.wall, ...(config.topPanels.length < profile.surfaces.length ? [e.panelThickness] : []));
      if (thinnest / 2 - LIP_GAP < minWeb) {
        issues.error("SEAM_INVALID", `A lip takes half of the ${mm(thinnest)} skin, leaving ${mm(thinnest / 2 - LIP_GAP)} for the step it fits over, which needs ${mm(minWeb)}. Make the walls and panel at least ${mm(2 * (minWeb + LIP_GAP))}, or leave the joint flat.`, `${path}.lip`);
      }
    }
    // The next seam to the left, whose rib and tabs reach into the same piece.
    const before = config.seams.filter((other) => other.x < seam.x).sort((a, b) => b.x - a.x)[0];
    const leftEnd = before ? before.x + before.ribHalfThickness + before.ribWidth : e.wall;
    if (seam.x - seam.ribHalfThickness - SEAM_DRIVER_ROOM < leftEnd) {
      const where = before ? `between it and the seam at x = ${mm(before.x)}` : "in the left half";
      issues.error("SEAM_INVALID", `A seam at x = ${mm(seam.x)} leaves too little room ${where} to drive its bolts, which needs ${mm(SEAM_DRIVER_ROOM)} for a stubby screwdriver. Move it to the right.`, `${path}.x`);
    }
    const blocks = railBlocks(config);
    for (const [y, z] of fasteners.bolts) {
      const xHigh = seam.x - seam.ribHalfThickness;
      const blocked = blocks.some((block) => block.xMax > xHigh - SEAM_DRIVER_ROOM && block.xMin < xHigh && block.yMin < y + DRIVER_DIAMETER / 2 && block.yMax > y - DRIVER_DIAMETER / 2 && z - DRIVER_DIAMETER / 2 < block.top);
      if (blocked) issues.error("SEAM_INVALID", `A screw block for the rail would stop a screwdriver reaching the seam bolt at y = ${mm(y)}, z = ${mm(z)}. Move the seam or the rail's screws.`, `${path}.x`);
    }
    planned.push({ ...seam, ...fasteners, pinLength: seam.ribHalfThickness - PIN_ALLOWANCE });
  });
  return planned.sort((a, b) => a.x - b.x);
}

function planPrintedParts(config: Config, profile: Profile, issues: Issues): PrintedPart[] {
  const e = config.enclosure;
  const { x: bedX, y: bedY, z: bedZ } = config.fabrication.buildVolume;
  const bounds = [0, ...config.seams.map((s) => s.x).sort((a, b) => a - b), e.width];
  const parts: PrintedPart[] = [];
  for (let index = 0; index < bounds.length - 1; index++) {
    const xMin = bounds[index]!;
    const xMax = bounds[index + 1]!;
    // The part left of a seam carries the alignment pins, and any lip, which stick out past it.
    const seam = [...config.seams].sort((a, b) => a.x - b.x)[index];
    const pins = seam ? Math.max(seam.ribHalfThickness - PIN_ALLOWANCE, seam.lip) : 0;
    const size: [number, number, number] = [xMax - xMin + pins, profile.depth, profile.maxHeight];
    const name = bounds.length > 2 ? `Shell ${index + 1}` : "Shell";
    parts.push({ index, kind: "shell", name, color: e.color, xMin, xMax, size });
    const fitsFlat = size[0] <= bedX && size[1] <= bedY;
    const fitsTurned = size[0] <= bedY && size[1] <= bedX;
    if ((!fitsFlat && !fitsTurned) || size[2] > bedZ) {
      const longestBed = Math.max(bedX, bedY);
      const hint =
        profile.depth > longestBed || size[2] > bedZ
          ? "Seams only split the width, so reduce the depth or height."
          : `The enclosure needs at least ${Math.ceil(e.width / (longestBed - 3)) - 1} seam(s).`;
      issues.error(
        "PART_TOO_LARGE",
        `Printed part ${index + 1} is ${size.map((s) => mm(s)).join(" x ")}, which doesn't fit the ${bedX} x ${bedY} x ${bedZ} mm build volume. ${hint}`,
        config.seams.length ? `seams[${Math.min(index, config.seams.length - 1)}].x` : "seams",
      );
    }
  }
  return parts;
}

function checkComponentReferences(config: Config, parts: Record<string, Part>, profile: Profile, issues: Issues) {
  const seen = new Map<string, number>();
  const names = profile.surfaces.map((s) => `"${s.id}"`).join(", ");
  config.components.forEach((component, i) => {
    const path = `components[${i}]`;
    const first = seen.get(component.id);
    if (first !== undefined) {
      issues.error("DUPLICATE_ID", `Component id "${component.id}" is also used by components[${first}].`, `${path}.id`, [component.id]);
    }
    seen.set(component.id, i);
    const part = parts[component.type];
    if (!part) {
      issues.error("UNKNOWN_PART", `"${component.id}" uses part type "${component.type}", which isn't in the library or customParts.`, `${path}.type`, [component.id]);
    } else if (part.mount === "panel" && !("u" in component)) {
      issues.error("WRONG_MOUNT", `"${component.id}" is a panel part, so it's placed with u and v rather than x and y.`, path, [component.id]);
    } else if (part.mount === "floor" && !("x" in component)) {
      issues.error("WRONG_MOUNT", `"${component.id}" is a floor part, so it's placed with x and y rather than u and v.`, path, [component.id]);
    } else if (part.mount === "wall" && !("wall" in component)) {
      issues.error("WRONG_MOUNT", `"${component.id}" goes through a wall, so it's placed with wall, at and z.`, path, [component.id]);
    }
    if ("u" in component) {
      if (component.surface === undefined && profile.surfaces.length > 1) {
        issues.error("UNKNOWN_SURFACE", `"${component.id}" needs a surface, because this enclosure has several: ${names}.`, path, [component.id]);
      } else if (component.surface !== undefined && !profile.surfaces.some((s) => s.id === component.surface)) {
        issues.error("UNKNOWN_SURFACE", `"${component.id}" is on surface "${component.surface}", but the surfaces are ${names}.`, `${path}.surface`, [component.id]);
      }
    }
  });
}

function placeComponents(config: Config, parts: Record<string, Part>, profile: Profile): Placed[] {
  return config.components.map((component, index) => {
    const part = parts[component.type]!;
    const onSurface = "u" in component;
    const rotation = component.rotationDeg as Rotation;
    const surface = onSurface
      ? profile.surfaces.find((s) => s.id === component.surface) ?? profile.surfaces[0]!
      : null;
    if ("wall" in component) {
      // Its body, as seen from above, standing in for a footprint.
      const { wall: thick, width } = config.enclosure;
      const body = part.mount === "wall" ? part.body : { width: 0, height: 0, depth: 0 };
      const across = rotation === 90 || rotation === 270 ? body.height : body.width;
      const inward = body.depth;
      const plan: Shape = component.wall === "left" || component.wall === "right"
        ? { kind: "rect", cx: component.wall === "left" ? thick + inward / 2 : width - thick - inward / 2, cy: component.at, w: inward, h: across }
        : { kind: "rect", cx: component.at, cy: component.wall === "front" ? thick + inward / 2 : profile.depth - thick - inward / 2, w: across, h: inward };
      return { id: component.id, index, part, surface: null, shape: () => plan };
    }
    const [cx, cy] = onSurface ? [component.u, component.v] : [component.x, component.y];
    return {
      id: component.id,
      index,
      part,
      surface,
      shape: (which) => {
        // A part's placement has already been checked against its mount, and this is only for those two.
        const footprint = part.mount === "floor" ? part.footprint : (part as PanelPart)[which].footprint;
        const shape = footprintShape(footprint, cx, cy, rotation);
        // A knob wider than what the part has above the panel stands in for it.
        const knob = "knob" in component ? component.knob : undefined;
        const shafts = part.mount === "panel" ? part.shafts : [];
        if (which === "above" && knob && shafts.length === 1 && knob.diameter / 2 > Math.max(...halfExtents(shape))) {
          const [du, dv] = rotateOffset(shafts[0]!.at, rotation);
          return { kind: "circle", cx: cx + du, cy: cy + dv, r: knob.diameter / 2 };
        }
        // So does a key cap wider than its switch.
        const cap = "cap" in component ? component.cap : undefined;
        const stems = part.mount === "panel" ? part.stems : [];
        if (which === "above" && cap && stems.length === 1) {
          const [hu, hv] = halfExtents(shape);
          const [w, h] = rotation === 90 || rotation === 270 ? [cap.depth, cap.width] : [cap.width, cap.depth];
          if (w / 2 > hu || h / 2 > hv) {
            const [du, dv] = rotateOffset(stems[0]!.at, rotation);
            return { kind: "rect", cx: cx + du, cy: cy + dv, w: Math.max(w, 2 * hu), h: Math.max(h, 2 * hv) };
          }
        }
        return shape;
      },
    };
  });
}

function placeCutouts(placed: Placed[], partFor: (surface: string, u: number) => number, config: Config, issues: Issues): PlacedShape[] {
  const out: PlacedShape[] = [];
  for (const item of placed) {
    if (item.part.mount !== "panel" || !item.surface) continue;
    const surface = item.surface;
    const component = config.components[item.index]!;
    if (!("u" in component)) continue;
    const rotation = component.rotationDeg as Rotation;
    item.part.cutouts.forEach((cutout, n) => {
      const [du, dv] = rotateOffset(cutout.at, rotation);
      const u = component.u + du;
      const v = component.v + dv;
      const footprint = cutout.kind === "circle"
        ? ({ shape: "circle", diameter: cutout.diameter } as const)
        : ({ shape: "rect", width: cutout.width, height: cutout.height } as const);
      const window = footprintShape(footprint, u, v, rotation);
      const [hu, hv] = halfExtents(window);
      const size = { width: 2 * hu, height: 2 * hv };
      const printedPart = partFor(surface.id, u);
      const base = { id: `${component.id}#${n}`, componentId: component.id, surface: surface.id, printedPart, u, v };
      const detail =
        cutout.kind === "circle"
          ? { kind: cutout.kind, diameter: cutout.diameter }
          : cutout.kind === "rect"
            ? { kind: cutout.kind, ...size, cornerRadius: cutout.cornerRadius, ...(cutout.bevel && { bevel: cutout.bevel }) }
            : { kind: cutout.kind, ...size, skin: cutout.skin };
      const placeNotch = (notch: { at: readonly [number, number]; width: number; height: number }): PlacedNotch => {
        const [nu, nv] = rotateOffset(notch.at, rotation);
        const quarterTurned = rotation === 90 || rotation === 270;
        return { u: component.u + nu, v: component.v + nv, width: quarterTurned ? notch.height : notch.width, height: quarterTurned ? notch.width : notch.height };
      };
      const notches = cutout.kind === "pocket" ? [] : (cutout.notches ?? []).map(placeNotch);
      // A recess is wider than its window, so it's what limits how close things can get.
      let shape = window;
      let recess: PlacedCutout["recess"];
      let recessNotches: PlacedNotch[] = [];
      if (cutout.kind === "rect" && cutout.recess) {
        const [ru, rv] = rotateOffset(cutout.recess.at, rotation);
        shape = footprintShape({ shape: "rect", width: cutout.recess.width, height: cutout.recess.height }, component.u + ru, component.v + rv, rotation);
        const [rhu, rhv] = halfExtents(shape);
        recessNotches = (cutout.recess.notches ?? []).map(placeNotch);
        recess = { u: component.u + ru, v: component.v + rv, width: 2 * rhu, height: 2 * rhv, skin: cutout.recess.skin, ...(recessNotches.length && { notches: recessNotches }) };
      }
      // A bevel widens the window at the face, so take in whichever reaches further.
      if (cutout.kind === "rect" && cutout.bevel && shape.kind === "rect" && window.kind === "rect") {
        const b = cutout.bevel;
        const left = Math.min(shape.cx - shape.w / 2, window.cx - window.w / 2 - b);
        const right = Math.max(shape.cx + shape.w / 2, window.cx + window.w / 2 + b);
        const low = Math.min(shape.cy - shape.h / 2, window.cy - window.h / 2 - b);
        const high = Math.max(shape.cy + shape.h / 2, window.cy + window.h / 2 + b);
        shape = { kind: "rect", cx: (left + right) / 2, cy: (low + high) / 2, w: right - left, h: high - low };
      }
      // Each notch has to reach what it's off, or it would come out as a hole of its own.
      const owner = shape;
      const [ownerU, ownerV] = halfExtents(owner);
      for (const notch of [...notches, ...recessNotches]) {
        const apart = Math.max(Math.abs(notch.u - owner.cx) - notch.width / 2 - ownerU, Math.abs(notch.v - owner.cy) - notch.height / 2 - ownerV);
        if (apart >= -0.01) issues.error("GEOMETRY_IMPOSSIBLE", `A notch on "${component.id}" has to overlap the hole it's off.`, `components[${item.index}]`, [component.id]);
      }
      const placedCutout: PlacedCutout = { ...base, ...detail, ...(notches.length && { notches }), ...(recess && { recess }) };
      out.push({ cutout: placedCutout, shape, surface, index: item.index });
      // Each notch keeps other things away too, as a shape of its own.
      for (const notch of [...notches, ...recessNotches]) {
        out.push({ cutout: placedCutout, shape: { kind: "rect", cx: notch.u, cy: notch.v, w: notch.width, h: notch.height }, surface, index: item.index, notch: true });
      }
    });
  }
  return out;
}

function placePosts(placed: Placed[], partFor: (surface: string, u: number) => number, config: Config): PlacedPost[] {
  const out: PlacedPost[] = [];
  for (const item of placed) {
    if (item.part.mount !== "panel" || !item.surface) continue;
    const component = config.components[item.index]!;
    if (!("u" in component)) continue;
    for (const post of item.part.posts) {
      const [du, dv] = rotateOffset(post.at, component.rotationDeg as Rotation);
      const u = component.u + du;
      out.push({
        componentId: component.id,
        surface: item.surface.id,
        printedPart: partFor(item.surface.id, u),
        u,
        v: component.v + dv,
        diameter: post.diameter,
        reach: post.reach,
        holeDiameter: post.holeDiameter,
        holeDepth: post.holeDepth,
      });
    }
  }
  return out;
}

function checkPosts(placed: Placed[], cutouts: PlacedShape[], config: Config, limits: Limits, issues: Issues) {
  for (const item of placed) {
    if (item.part.mount !== "panel" || !item.surface) continue;
    const component = config.components[item.index]!;
    if (!("u" in component)) continue;
    const path = `components[${item.index}]`;
    const rotation = component.rotationDeg as Rotation;
    for (const post of item.part.posts) {
      // A post can stand in a recess, but it can't block a window, or anyone's hole.
      const [du, dv] = rotateOffset(post.at, rotation);
      const circle = footprintShape({ shape: "circle", diameter: post.diameter }, component.u + du, component.v + dv, rotation);
      for (const other of cutouts) {
        if (other.surface !== item.surface) continue;
        const window = other.cutout.recess
          ? footprintShape({ shape: "rect", width: other.cutout.width!, height: other.cutout.height! }, other.cutout.u, other.cutout.v, 0)
          : other.shape;
        if (gap(circle, window) < limits.minWeb) {
          issues.error("BODIES_COLLIDE", `A screw post on "${item.id}" is too close to a cutout of "${other.cutout.componentId}".`, path, [item.id, other.cutout.componentId]);
        }
      }
    }
  }
}

// A rail sits in front of the plate, so the plate is notched to make room for it.
export function plateNotchFor(config: Config) {
  const rail = config.opening?.rail;
  if (!rail) return null;
  return { xLow: rail.screwX[0] - RAIL_FOOT_MARGIN - 0.5, xHigh: rail.screwX[1] + RAIL_FOOT_MARGIN + 0.5, yHigh: rail.depth + 0.25 };
}

export const RAIL_FOOT_MARGIN = 3.5;
export const RAIL_BLOCK_HEIGHT = SHORT_BOSS_HEIGHT;

// The block over each rail foot, and the slope back to the wall on its outer side, which
// is the side that faces the bed as the shell prints.
export function railBlocks(config: Config) {
  const rail = config.opening?.rail;
  if (!rail) return [];
  const { wall } = config.enclosure;
  const slope = rail.depth - wall;
  const top = rail.footHeight + 0.2 + RAIL_BLOCK_HEIGHT;
  const [left, right] = rail.screwX;
  return [
    { xMin: left - RAIL_FOOT_MARGIN - slope, xMax: left + RAIL_FOOT_MARGIN, yMin: wall, yMax: rail.depth, top },
    { xMin: right - RAIL_FOOT_MARGIN, xMax: right + RAIL_FOOT_MARGIN + slope, yMin: wall, yMax: rail.depth, top },
  ];
}

// All the space inside that belongs to what the opening holds or what fixes it.
function reservedBoxes(config: Config) {
  return [...(config.opening?.keepOut ?? []), ...railBlocks(config)];
}

export function plateInput(config: Config, profile: Profile): PlatePlanInput {
  const e = config.enclosure;
  // A slope stops where it meets a bottom round, at the height of a short boss's top.
  const top = e.floorThickness + SHORT_BOSS_HEIGHT;
  const roundMeets = (radius: number) => {
    const inner = radius - e.wall;
    const rise = radius - top;
    return Math.sqrt(Math.max(inner * inner - rise * rise, 0));
  };
  const { frontBottom, rearBottom } = e.rounds;
  return {
    ...(frontBottom > top ? { slopeFront: frontBottom - roundMeets(frontBottom) - 0.5 } : {}),
    ...(rearBottom > top ? { slopeRear: profile.depth - rearBottom + roundMeets(rearBottom) + 0.5 } : {}),
    width: e.width,
    depth: profile.depth,
    wall: e.wall,
    cornerRadius: e.cornerRadius,
    floorThickness: e.floorThickness,
    clearance: config.plate.clearance,
    plateFront: profile.plateFront + config.plate.clearance,
    plateRear: profile.plateRear - config.plate.clearance,
  };
}

// A seam bolt's head is on the left half, so a driver reaches it from inside that half.
function seamDriverPaths(seams: PlannedSeam[]): SeamDriverPath[] {
  return seams.flatMap((seam) => {
    const xHigh = seam.x - seam.ribHalfThickness;
    return seam.bolts.map(([y, z]) => ({ xLow: xHigh - SEAM_DRIVER_ROOM, xHigh, y, z }));
  });
}

function planPlate(config: Config, profile: Profile, seams: PlannedSeam[], placed: Placed[], cutouts: PlacedShape[], topScrews: TopScrew[], topPieces: TopPiece[], limits: Limits, fixtures: Fixtures, fasteners: PlannedFasteners, issues: Issues): PlatePlan | null {
  if (!config.plate.enabled) return null;
  const e = config.enclosure;
  const input = plateInput(config, profile);
  const { x: bedX, y: bedY } = config.fabrication.buildVolume;
  const joints = config.plate.seamX === undefined ? choosePlateJoints(input, config.seams.map((seam) => seam.x), Math.max(bedX, bedY), MIN_PART_WIDTH) : [config.plate.seamX].flat().sort((a, b) => a - b);
  [0, ...joints, e.width].forEach((x, i, all) => {
    if (i === 0) return;
    if (x - all[i - 1]! < MIN_PART_WIDTH) issues.error("PLATE_INVALID", `A plate joint at x = ${mm(i === all.length - 1 ? all[i - 1]! : x)} would leave a piece narrower than ${mm(MIN_PART_WIDTH)}.`, "plate.seamX");
  });
  const t = e.panelThickness;
  const obstacles: BossObstacles = {
    ribs: seams.map((seam) => ({
      x: seam.x,
      half: seam.ribHalfThickness + seam.ribWidth,
      tabs: seam.tabs.map((tab) => {
        const section = tabSection(tab);
        return { yLow: Math.min(...section.map(([y]) => y)), yHigh: Math.max(...section.map(([y]) => y)), zLow: Math.min(...section.map(([, z]) => z)) };
      }),
    })),
    joints,
    onSide: shellPrintsOnSide(seams.length),
    capped: profile.surfaces.filter((surface) => topPanelFor(config, surface.id)).map((surface): [number, number] => [surface.index === 0 ? 0 : surface.y0, surface.index === profile.surfaces.length - 1 ? profile.depth : surface.y1]),
    plateNotch: plateNotchFor(config),
    floorParts: [...placed.filter((p) => p.part.mount === "floor").map((p) => p.shape("below")), ...fixtures.blocks.map(blockShape)],
    cutouts: cutouts.map(({ shape, surface }) => {
      const [hu, hv] = halfExtents(shape);
      const [yLow, yHigh] = surfaceSpan(surface, shape.cy - hv, shape.cy + hv);
      // A round hole, judged where it meets the surface, as its box is.
      const middle = surfacePoint(surface, shape.cy, 0)[0];
      const round = shape.kind === "circle" ? { x: shape.cx, yLow: middle, yHigh: middle, r: shape.r } : undefined;
      return { xLow: shape.cx - hu, xHigh: shape.cx + hu, yLow, yHigh, round };
    }),
    posts: [
      ...(config.opening ? [{ xLow: config.opening.xMin, xHigh: config.opening.xMax, yLow: 0, yHigh: config.opening.yEnd }] : []),
      ...topScrews.map((screw) => ({ xLow: screw.x - TOP_POST_DIAMETER, xHigh: screw.x + TOP_POST_DIAMETER, yLow: screw.y - TOP_POST_DIAMETER, yHigh: screw.y + TOP_POST_DIAMETER, zLow: screw.postBottom - TOP_TAB_THICKNESS - 0.2 })),
    ],
    keepOut: [...reservedBoxes(config), ...fixtures.holeBoxes].map((box) => ({ xLow: box.xMin, xHigh: box.xMax, yLow: box.yMin, yHigh: box.yMax })),
    bodies: placed.flatMap((p) => {
      if (p.part.mount !== "panel" || !p.surface || p.part.below.depth === 0) return [];
      const shape = p.shape("below");
      const [hu, hv] = halfExtents(shape);
      const surface = p.surface;
      const point = (v: number, n: number) => surfacePoint(surface, v, n);
      const far = -t - p.part.below.depth;
      const ends = [point(shape.cy, -t)[0], point(shape.cy, far)[0]];
      return [{
        xLow: shape.cx - hu,
        xHigh: shape.cx + hu,
        section: [point(shape.cy - hv, -t), point(shape.cy + hv, -t), point(shape.cy + hv, far), point(shape.cy - hv, far)],
        round: shape.kind === "circle" ? { x: shape.cx, yLow: Math.min(...ends), yHigh: Math.max(...ends), r: shape.r } : undefined,
      }];
    }),
    minWeb: limits.minWeb,
    partClearance: PART_CLEARANCE,
    driverColumns: topScrews.map(({ x, y }) => ({ x, y })),
    gussets: seams.length ? [] : topScrews.map((screw) => {
      const surface = profile.surfaces.find((s) => s.id === topPieces[screw.piece]!.surface)!;
      const tab = topTabExtent(screw, e.wall, e.width, screw.wall === "rear" ? surface.y1 + 3 : profile.depth - e.wall, false);
      return { xLow: tab.xLow, xHigh: tab.xHigh, yLow: tab.yLow, yHigh: tab.yHigh, zLow: tab.zLow - tabGussetDepth(tab, screw.wall, e.floorThickness), zHigh: tab.zHigh };
    }),
    seamPaths: seamDriverPaths(seams),
  };

  let screws: Point2[];
  if (config.plate.screws) {
    screws = config.plate.screws.map(({ x, y }): Point2 => [x, y]);
    screws.forEach(([x, y], i) => {
      const problem = bossProblem(input, profile, obstacles, x, y);
      if (problem) issues.error("PLATE_INVALID", `Plate screw ${i + 1} at x ${mm(x)}, y ${mm(y)} can't go there, because ${problem}.`, `plate.screws[${i}]`);
    });
  } else {
    screws = layoutPlateScrews(input, profile, obstacles, config.plate.screwSpacing);
  }

  // Changes in the config come after, so that changing one screw leaves the others where they are.
  config.plate.fasteners.remove.forEach(({ x, y }, i) => {
    const matched = screws.filter(([sx, sy]) => Math.hypot(sx - x, sy - y) <= FASTENER_MATCH);
    if (matched.length === 0) {
      issues.warn("FASTENER_CHANGE_UNUSED", `There's no longer a plate screw at x ${mm(x)}, y ${mm(y)} to remove, because the design has changed. Delete this change, or remove the screw again.`, `plate.fasteners.remove[${i}]`);
    }
    screws = screws.filter((screw) => !matched.includes(screw));
  });
  const samePiece = (a: number, b: number) => samePlatePiece(joints, a, b);
  const added: Point2[] = [];
  const addedItems: PlannedFastener[] = [];
  config.plate.fasteners.add.forEach(({ x, y }, index) => {
    const crowded = added.some(([ax, ay]) => samePiece(ax, x) && Math.hypot(ax - x, ay - y) < MIN_SCREW_SPACING);
    const problem = crowded ? `another added screw is closer than ${mm(MIN_SCREW_SPACING)}` : bossProblem(input, profile, obstacles, x, y);
    if (problem) issues.error("PLATE_INVALID", `The added plate screw at x ${mm(x)}, y ${mm(y)} can't go there, because ${problem}.`, `plate.fasteners.add[${index}]`);
    else added.push([x, y]);
    addedItems.push({ id: `plate.fasteners.add[${index}]`, kind: "plate", x, y, z: e.floorThickness, surface: null, wall: null, addedAt: index, problem });
  });
  // What's added wins over an automatic screw that's in its way.
  const automatic = screws.filter(([sx, sy]) => !added.some(([ax, ay]) => samePiece(ax, sx) && Math.hypot(ax - sx, ay - sy) < MIN_SCREW_SPACING));
  const round = (value: number) => Math.round(value * 100) / 100;
  fasteners.items.push(...automatic.map(([x, y]): PlannedFastener => ({ id: `plate:${round(x)},${round(y)}`, kind: "plate", x, y, z: e.floorThickness, surface: null, wall: null, addedAt: null, problem: null })), ...addedItems);
  screws = [...automatic, ...added].sort((a, b) => a[0] - b[0] || a[1] - b[1]);

  const rows = plateRows(input);
  fasteners.edges.push(...rows.map(({ wall, along, fixed, from, to }): FastenerEdge => ({ kind: "plate", surface: null, wall, along, fixed, from, to })));
  for (const row of rows) {
    // An opening takes that stretch of the front wall, so there's nothing there to fix.
    const opening = row.wall === "front" ? config.opening : undefined;
    const held = screws.filter(([x, y]) => Math.abs((row.along === "x" ? y : x) - row.fixed) <= ROW_REACH).map(([x, y]) => (row.along === "x" ? x : y));
    const stops = [row.from, ...held, row.to, ...(opening ? [opening.xMin, opening.xMax] : [])].sort((a, b) => a - b);
    const gaps = stops.slice(1).map((to, i) => ({ from: stops[i]!, to })).filter(({ from, to }) => !(opening && from >= opening.xMin && to <= opening.xMax));
    const widest = gaps.reduce((best, gap) => (gap.to - gap.from > best.to - best.from ? gap : best), { from: 0, to: 0 });
    if (widest.to - widest.from > config.plate.screwSpacing * PLATE_GAP_FACTOR) {
      issues.warn("FASTENER_GAP", `The ${row.wall} wall has ${mm(widest.to - widest.from)} with no plate screw, from ${row.along} ${mm(widest.from)} to ${mm(widest.to)}, against a target of ${mm(config.plate.screwSpacing)}. The plate may flex or gap there. Parts are probably blocking the spots in between, so move them or add a screw if there's room.`, "plate", [], {
        min: row.along === "x" ? [widest.from, row.fixed - 2, 0] : [row.fixed - 2, widest.from, 0],
        max: row.along === "x" ? [widest.to, row.fixed + 2, e.floorThickness] : [row.fixed + 2, widest.to, e.floorThickness],
      });
    }
  }

  const pieces = [0, ...joints].map((from, i) => [from, joints[i] ?? e.width]);
  pieces.forEach(([from, to], i) => {
    const count = screws.filter(([x]) => x > from! && x < to!).length;
    if (count < MIN_PLATE_SCREWS) {
      issues.error("PLATE_INVALID", `${pieces.length > 1 ? `Plate piece ${i + 1}` : "The plate"} only has ${count} ${count === 1 ? "screw" : "screws"}, and needs ${MIN_PLATE_SCREWS}. Parts or removed screws are leaving the walls bare. Move them, add a screw, or set plate.enabled to false.`, "plate");
    }
  });
  config.plate.countersunkHoles.forEach(({ x, y }, i) => {
    if (x < e.wall + 3.5 || x > e.width - e.wall - 3.5 || y < profile.plateFront + 3.5 || y > profile.plateRear - 3.5) {
      issues.error("PLATE_INVALID", `Plate hole ${i + 1} at x ${mm(x)}, y ${mm(y)} is too close to the edge of the plate.`, `plate.countersunkHoles[${i}]`);
    }
  });
  config.plate.cableTies.forEach((tie, i) => {
    const path = `plate.cableTies[${i}]`;
    const fail = (why: string) => issues.error("PLATE_INVALID", `The cable tie bridge at x ${mm(tie.x)}, y ${mm(tie.y)} ${why}`, path);
    const { xLow, xHigh, yLow, yHigh } = tieExtent(tie);
    const overlaps = (x0: number, x1: number, y0: number, y1: number) => xLow < x1 + PART_CLEARANCE && xHigh > x0 - PART_CLEARANCE && yLow < y1 + PART_CLEARANCE && yHigh > y0 - PART_CLEARANCE;
    const inset = e.wall + config.plate.clearance;
    if (xLow < inset || xHigh > e.width - inset || yLow < profile.plateFront + config.plate.clearance || yHigh > profile.plateRear - config.plate.clearance) return fail("runs off the edge of the plate.");
    const joint = joints.find((x) => xLow < x && xHigh > x);
    if (joint !== undefined) return fail(`crosses the plate's joint at x = ${mm(joint)}.`);
    const notch = plateNotchFor(config);
    if (notch && xLow < notch.xHigh && xHigh > notch.xLow && yLow < notch.yHigh) return fail("is in the plate's notch for the rail.");
    if (screws.some(([x, y]) => overlaps(x - BOSS_DIAMETER / 2, x + BOSS_DIAMETER / 2, y - BOSS_DIAMETER / 2, y + BOSS_DIAMETER / 2))) return fail("is on one of the plate's screws.");
    if (config.plate.countersunkHoles.some(({ x, y }) => overlaps(x - 3.5, x + 3.5, y - 3.5, y + 3.5))) return fail("covers a hole in the plate.");
    if (config.plate.pins.some(({ x, y, diameter }) => overlaps(x - diameter / 2, x + diameter / 2, y - diameter / 2, y + diameter / 2))) return fail("hits a pin on the plate.");
    if (fixtures.blocks.some((block) => overlaps(block.xLow, block.xHigh, block.yLow, block.yHigh))) return fail("runs into a board's mount.");
    for (const item of placed) {
      if (item.part.mount !== "floor") continue;
      const shape = item.shape("below");
      const [hx, hy] = halfExtents(shape);
      if (overlaps(shape.cx - hx, shape.cx + hx, shape.cy - hy, shape.cy + hy)) return fail(`is under "${item.id}".`);
    }
    if (reservedBoxes(config).some((box) => overlaps(box.xMin, box.xMax, box.yMin, box.yMax) && e.floorThickness < box.top)) return fail("is in the room kept for what the opening holds.");
    for (const other of config.plate.cableTies.slice(0, i)) {
      const them = tieExtent(other);
      if (overlaps(them.xLow, them.xHigh, them.yLow, them.yHigh)) return fail("runs into another one.");
    }
  });

  const circle = (cx: number, cy: number, r: number): Shape => ({ kind: "circle", cx, cy, r });
  const fixings: Shape[] = [
    ...screws.map(([x, y]) => circle(x, y, BOSS_DIAMETER / 2)),
    ...config.plate.countersunkHoles.map(({ x, y }) => circle(x, y, 3.5)),
    ...config.plate.pins.map(({ x, y, diameter }) => circle(x, y, diameter / 2)),
    ...config.plate.cableTies.map((tie): Shape => {
      const { xLow, xHigh, yLow, yHigh } = tieExtent(tie);
      return { kind: "rect", cx: (xLow + xHigh) / 2, cy: (yLow + yHigh) / 2, w: xHigh - xLow, h: yHigh - yLow };
    }),
  ];
  const weights: PlannedWeight[] = [];
  config.plate.weights.forEach((weight, i) => {
    const crowded = weights.some((other) => gap(weightOutline(other), weightOutline(weight)) < PART_CLEARANCE);
    const problem = crowded ? "it runs into another weight pocket" : weightProblem(input, profile, obstacles, fixings, weight);
    if (problem) issues.error("PLATE_INVALID", `The weight pocket at x ${mm(weight.x)}, y ${mm(weight.y)} can't go there, because ${problem}.`, `plate.weights[${i}]`);
    else weights.push({ ...weight });
  });
  fixings.push(...weights.map(weightOutline));
  const supports: PlannedSupport[] = [];
  config.plate.supports.forEach(({ x, y, diameter }, i) => {
    const crowded = supports.some((other) => Math.hypot(other.x - x, other.y - y) < (other.diameter + diameter) / 2 + PART_CLEARANCE);
    const problem = crowded ? "it runs into another support" : supportProblem(input, profile, obstacles, fixings, x, y, diameter);
    if (problem) issues.error("PLATE_INVALID", `The support at x ${mm(x)}, y ${mm(y)} can't go there, because ${problem}.`, `plate.supports[${i}]`);
    else supports.push({ x, y, diameter, top: supportTop(profile, y, diameter) });
  });
  const feet: PlannedFoot[] = [];
  const countersinks: Point2[] = [...screws, ...config.plate.countersunkHoles.map(({ x, y }): Point2 => [x, y])];
  config.plate.feet.forEach(({ x, y, diameter }, i) => {
    const crowded = feet.some((other) => Math.hypot(other.x - x, other.y - y) < (other.diameter + diameter) / 2 + 1);
    const problem = crowded ? "it runs into another foot" : footProblem(input, obstacles, countersinks, x, y, diameter);
    if (problem) issues.error("PLATE_INVALID", `The rubber foot at x ${mm(x)}, y ${mm(y)} can't go there, because ${problem}.`, `plate.feet[${i}]`);
    else feet.push({ x, y, diameter });
  });
  const ribs = config.plate.joint === "rib" ? joints.flatMap((x) => planPlateRib(config, profile, seams, placed, fixtures, x, screws, supports, weights, issues) ?? []) : [];
  return { clearance: config.plate.clearance, joints, screws, shortBosses: screws.map(([x, y]) => isShortBoss(input, obstacles, x, y)), lifts: screws.map(([x, y]) => chosenBossLift(input, profile, obstacles, x, y)), supports, weights, feet, ribs };
}

// Joins each top piece to the one behind it at a crease, where its panel asks for it. The flange
// runs wherever nothing hangs in its way, and the screws spread along it.
function planCreaseJoints(config: Config, profile: Profile, pieces: TopPiece[], placed: Placed[], posts: PlacedPost[], topScrews: TopScrew[], cutouts: PlacedShape[], fixtures: Fixtures, plate: PlatePlan | null, limits: Limits, issues: Issues): CreaseJoint[] {
  const e = config.enclosure;
  const t = e.panelThickness;
  const joints: CreaseJoint[] = [];
  config.topPanels.forEach((panel, panelIndex) => {
    if (panel.crease !== "screws") return;
    const front = profile.surfaces.find((s) => s.id === panel.surface);
    const rear = front && profile.surfaces[front.index + 1];
    if (!front || !rear || !topPanelFor(config, rear.id)) {
      issues.error("TOP_PANEL_INVALID", `The ${panel.surface} panel's crease can only be screwed to a top panel on the surface behind it.`, `topPanels[${panelIndex}].crease`);
      return;
    }
    const g = creaseGeometry(front, rear, t);
    // One box in the side view takes in the flange, the bosses, and the screws' way through them.
    const zone: Point2[] = [[g.y - CREASE_FLANGE_THICKNESS, g.flangeBottom], [g.y + CREASE_BOSS_LENGTH, g.flangeBottom], [g.y + CREASE_BOSS_LENGTH, g.bossTop], [g.y - CREASE_FLANGE_THICKNESS, g.bossTop]];
    const [zoneLow, zoneHigh] = [g.y - CREASE_FLANGE_THICKNESS, g.y + CREASE_BOSS_LENGTH];
    const gap = 0.5;
    const blocked: [number, number][] = [];
    const block = (xLow: number, xHigh: number, margin = gap) => blocked.push([xLow - margin, xHigh + margin]);
    const section = (surface: Surface, v0: number, v1: number, n0: number, n1: number): Point2[] => [surfacePoint(surface, v0, n0), surfacePoint(surface, v1, n0), surfacePoint(surface, v1, n1), surfacePoint(surface, v0, n1)];
    for (const item of placed) {
      if (item.part.mount === "panel" && item.surface && item.part.below.depth > 0) {
        const shape = item.shape("below");
        const [hu, hv] = halfExtents(shape);
        if (polygonsOverlap(section(item.surface, shape.cy - hv, shape.cy + hv, -t, -t - item.part.below.depth), zone)) block(shape.cx - hu, shape.cx + hu);
      } else if (item.part.mount === "floor" && e.floorThickness + item.part.height > g.flangeBottom) {
        const shape = item.shape("below");
        const [hx, hy] = halfExtents(shape);
        if (shape.cy + hy > zoneLow && shape.cy - hy < zoneHigh) block(shape.cx - hx, shape.cx + hx);
      }
    }
    for (const post of posts) {
      const surface = profile.surfaces.find((s) => s.id === post.surface)!;
      const r = post.diameter / 2;
      if (polygonsOverlap(section(surface, post.v - r, post.v + r, -t, -post.reach), zone)) block(post.u - r, post.u + r);
    }
    for (const screw of topScrews) {
      const r = TOP_POST_DIAMETER / 2;
      if (screw.y + r + TOP_TAB_LENGTH > zoneLow && screw.y - r - TOP_TAB_LENGTH < zoneHigh) block(screw.x - r - TOP_TAB_LENGTH, screw.x + r + TOP_TAB_LENGTH);
    }
    // A hole's tool reaches a little below the panel, so it mustn't be over the flange or a boss.
    for (const { shape, surface } of cutouts) {
      if (surface.id !== front.id && surface.id !== rear.id) continue;
      const [hu, hv] = halfExtents(shape);
      const [yLow, yHigh] = surfaceSpan(surface, shape.cy - hv, shape.cy + hv);
      if (yHigh > zoneLow && yLow < zoneHigh) block(shape.cx - hu, shape.cx + hu, limits.minWeb);
    }
    const standing = [
      ...[...reservedBoxes(config), ...fixtures.holeBoxes].map((b) => ({ xLow: b.xMin, xHigh: b.xMax, yLow: b.yMin, yHigh: b.yMax, top: b.top })),
      ...fixtures.blocks.map((b) => ({ xLow: b.xLow, xHigh: b.xHigh, yLow: b.yLow, yHigh: b.yHigh, top: e.floorThickness + b.top })),
      ...(plate?.supports ?? []).map((s) => ({ xLow: s.x - s.diameter / 2, xHigh: s.x + s.diameter / 2, yLow: s.y - s.diameter / 2, yHigh: s.y + s.diameter / 2, top: s.top })),
      ...(plate?.screws ?? []).map(([x, y], i) => ({ xLow: x - BOSS_DIAMETER / 2, xHigh: x + BOSS_DIAMETER / 2, yLow: y - BOSS_DIAMETER / 2, yHigh: y + BOSS_DIAMETER / 2, top: plate!.shortBosses[i] ? shortBossTop(e, plate!.lifts[i]!) : profile.maxHeight })),
    ];
    for (const b of standing) if (b.top > g.flangeBottom && b.yHigh > zoneLow && b.yLow < zoneHigh) block(b.xLow, b.xHigh);
    for (const f of pieces.filter((p) => p.surface === front.id)) {
      for (const r of pieces.filter((p) => p.surface === rear.id)) {
        const from = Math.max(f.xMin, r.xMin, e.wall + gap);
        const to = Math.min(f.xMax, r.xMax, e.width - e.wall - gap);
        if (to - from < CREASE_BOSS_DIAMETER + 2) continue;
        // Inside a piece, keep off its edges.
        const spans = clearSpans(from + (from > e.wall + gap ? gap : 0), to - (to < e.width - e.wall - gap ? gap : 0), blocked, CREASE_BOSS_DIAMETER + 2);
        // A driver comes in from the front, past anything already on the front piece.
        const fixed = [
          ...posts.filter((post) => post.surface === front.id && post.printedPart === f.printedPart).map((post) => ({ x: post.u, half: post.diameter / 2 })),
          ...topScrews.filter((screw) => screw.piece === pieces.indexOf(f)).map((screw) => ({ x: screw.x, half: TOP_POST_DIAMETER / 2 })),
        ];
        const screws = layoutCreaseScrews(spans, (x) => fixed.some((o) => Math.abs(o.x - x) < o.half + DRIVER_DIAMETER / 2));
        if (screws.length === 0) {
          issues.warn("FASTENER_GAP", `${f.name} and ${r.name} have no room for a screw along their crease, so only the shell holds them together there.`, `topPanels[${panelIndex}].crease`);
        }
        joints.push({ front: pieces.indexOf(f), rear: pieces.indexOf(r), y: g.y, z: g.z, flangeTop: g.flangeTop, flangeBottom: g.flangeBottom, bossTop: g.bossTop, spans, screws });
      }
    }
  });
  return joints;
}

const RIB_GAP = 0.3;
const RIB_BOARD_GAP = 0.2;

function planPlateRib(config: Config, profile: Profile, seams: PlannedSeam[], placed: Placed[], fixtures: Fixtures, x: number, screws: Point2[], supports: PlannedSupport[], weights: PlannedWeight[], issues: Issues): PlateRib | null {
  const floor = config.enclosure.floorThickness;
  const fail = (why: string) => {
    issues.error("PLATE_INVALID", `The rib along the plate's joint at x = ${mm(x)} ${why}`, "plate.joint");
    return null;
  };
  const [yLow, yHigh] = plateRibSpan(profile.cavity, floor, x, screws, plateNotchFor(config), seams);
  // Each grown by the room it needs. A board can come as close as the Desk Synth V2's do, since the rib is a plain wall.
  const box = (xLow: number, xHigh: number, yLow: number, yHigh: number, top: number, name: string, fixed: boolean, gap = RIB_GAP): RibObstacle => ({ xLow: xLow - gap, xHigh: xHigh + gap, yLow: yLow - gap, yHigh: yHigh + gap, top, name, fixed });
  const around = (cx: number, cy: number, half: number, top: number, name: string) => box(cx - half, cx + half, cy - half, cy + half, top, name, true);
  const obstacles: RibObstacle[] = [
    ...placed.flatMap((item) => {
      if (item.part.mount !== "floor") return [];
      const shape = item.shape("below");
      const [hx, hy] = halfExtents(shape);
      return [box(shape.cx - hx, shape.cx + hx, shape.cy - hy, shape.cy + hy, item.part.height, `"${item.id}"`, false, RIB_BOARD_GAP)];
    }),
    ...fixtures.blocks.map((b) => box(b.xLow, b.xHigh, b.yLow, b.yHigh, b.top, `the mount for "${b.componentId}"`, true)),
    ...config.plate.pins.map((pin) => around(pin.x, pin.y, pin.diameter / 2, pin.height + (pin.tipHeight ?? 0), "a pin on the plate")),
    ...config.plate.countersunkHoles.map((hole) => around(hole.x, hole.y, 3.5, 0, "a hole in the plate")),
    ...config.plate.cableTies.map((tie) => {
      const { xLow, xHigh, yLow, yHigh } = tieExtent(tie);
      return box(xLow, xHigh, yLow, yHigh, TIE_BRIDGE.height, "a cable tie bridge", true);
    }),
    ...supports.map((s) => around(s.x, s.y, s.diameter / 2, s.top - floor, "a support")),
    ...weights.map((w) => {
      const outline = weightOutline(w) as Extract<Shape, { kind: "rect" }>;
      return box(outline.cx - outline.w / 2, outline.cx + outline.w / 2, outline.cy - outline.h / 2, outline.cy + outline.h / 2, w.height, "a weight pocket", true);
    }),
    ...[...reservedBoxes(config), ...fixtures.holeBoxes].map((b) => box(b.xMin, b.xMax, b.yMin, b.yMax, b.top - floor, "the room kept for something else", false)),
  ];
  // It stands on the plate, so anything over the same spot is in the way, even a hole.
  const wall = obstacles.find((o) => o.xLow < x + PLATE_RIB_RIGHT && o.xHigh > x - PLATE_RIB_LEFT && o.yLow < yHigh && o.yHigh > yLow);
  if (wall) return fail(`runs into ${wall.name}. Move it, or move plate.seamX.`);
  const span = { x, yLow, yHigh };
  const bolts = layoutPlateRibBolts(span, obstacles);
  if (bolts.length < 2) {
    const why = [yLow + PLATE_RIB_END, (yLow + yHigh) / 2, yHigh - PLATE_RIB_END].map((y) => plateRibBoltProblem(x, y, obstacles)).find((problem) => problem);
    return fail(`has no room for two bolts${why ? `, because ${why}` : ""}.`);
  }
  return { ...span, bolts };
}

function planPlateParts(config: Config, profile: Profile, plate: PlatePlan | null, blocks: HolderBlock[], firstIndex: number, issues: Issues): PrintedPart[] {
  if (!plate) return [];
  const e = config.enclosure;
  const { x: bedX, y: bedY } = config.fabrication.buildVolume;
  const inset = e.wall + plate.clearance;
  const bounds = [inset, ...plate.joints, e.width - inset];
  const depth = profile.plateRear - profile.plateFront - 2 * plate.clearance;
  const parts: PrintedPart[] = [];
  for (let i = 0; i < bounds.length - 1; i++) {
    const xMin = bounds[i]!;
    const xMax = bounds[i + 1]!;
    const pinTop = Math.max(
      0,
      ...config.plate.pins.filter((pin) => pin.x > xMin && pin.x < xMax).map((pin) => pin.height + (pin.tipHeight ?? 0)),
      ...config.plate.cableTies.filter((tie) => tie.x > xMin && tie.x < xMax).map(() => TIE_BRIDGE.height),
      ...blocks.filter((block) => block.xLow >= xMin && block.xHigh <= xMax).map((block) => block.top),
      ...plate.supports.filter((support) => support.x > xMin && support.x < xMax).map((support) => support.top - e.floorThickness),
      ...plate.weights.filter((weight) => weight.x > xMin && weight.x < xMax).map((weight) => weight.height),
      ...(plate.ribs.length ? [PLATE_RIB_HEIGHT] : []),
      // Upright, the wedges under the bosses, as high as their slopes reach at a boss's far side.
      ...plate.screws.map(([x], i) => (x > xMin && x < xMax && plate.lifts[i]! > 0 ? plate.lifts[i]! - INSERT_HOLE_DIAMETER / 2 + BOSS_DIAMETER / 2 : 0)),
    );
    // A rib's tongue sticks out past the piece right of it.
    const tongue = plate.ribs.length && i > 0 ? PLATE_RIB_TONGUE : 0;
    const size: [number, number, number] = [xMax - xMin + tongue, depth, e.floorThickness + pinTop];
    const name = bounds.length > 2 ? `Plate ${i + 1}` : "Plate";
    parts.push({ index: firstIndex + i, kind: "plate", name, color: config.enclosure.color, xMin, xMax, size });
    if (!((size[0] <= bedX && size[1] <= bedY) || (size[0] <= bedY && size[1] <= bedX))) {
      issues.error("PART_TOO_LARGE", `${name} is ${mm(size[0])} x ${mm(size[1])}, which doesn't fit the ${bedX} x ${bedY} mm bed. Move the plate's split, or reduce the depth.`, "plate.seamX");
    }
  }
  return parts;
}

// The order that keeps every screw reachable, which is what the checks on their paths assume.
// What each step involves, by kind of printed part, or by which ones.
interface AssemblyStep {
  text: string;
  kinds: PrintedPart["kind"][];
  parts?: number[];
}

function listAssembly(config: Config, seams: PlannedSeam[], plate: PlatePlan | null, posts: PlacedPost[], topScrews: TopScrew[], placed: Placed[], creases: CreaseJoint[], cutouts: PlacedCutout[], firstTop: number): AssemblyStep[] {
  const steps: AssemblyStep[] = [];
  const step = (text: string, kinds: PrintedPart["kind"][], parts?: number[]) => steps.push({ text, kinds, ...(parts && { parts }) });
  if (seams.length || plate?.screws.length || topScrews.length) {
    const kinds: PrintedPart["kind"][] = [];
    if (seams.length || plate?.screws.length) kinds.push("shell");
    if (topScrews.length) kinds.push("top");
    if (plate?.ribs.length) kinds.push("plate");
    step("Press in the heat-set inserts.", kinds, creases.filter((crease) => crease.screws.length).map((crease) => firstTop + crease.rear));
  }
  if (seams.length === 1) step(`Bolt the shell halves together first, with nothing else fitted. The driver goes in from inside the left half, with ${mm(SEAM_DRIVER_ROOM)} kept clear behind each bolt, so a stubby one fits.`, ["shell"]);
  if (seams.length > 1) step(`Bolt the shell's pieces together first, left to right, with nothing else fitted. At each seam the driver goes in from inside the piece to its left, with ${mm(SEAM_DRIVER_ROOM)} kept clear behind each bolt, so a stubby one fits.`, ["shell"]);
  if (plate?.ribs.length === 1) step("Bolt the plate's pieces together through the rib along their joint, from the right, before anything goes on the plate.", ["plate"]);
  if (plate && plate.ribs.length > 1) step("Bolt the plate's pieces together through the ribs along their joints, from the right, before anything goes on the plate.", ["plate"]);
  const screwed = creases.filter((crease) => crease.screws.length);
  if (screwed.length) step("Lay the top pieces face down, and screw them together along each crease, from the front through the flange, before anything goes in them.", [], screwed.flatMap((crease) => [firstTop + crease.front, firstTop + crease.rear]));
  if (posts.length) step("Screw the screen to its posts, before its top piece goes on.", [], [...new Set(posts.map((post) => post.printedPart))]);
  if (placed.some((p) => p.part.mount === "panel")) step(topScrews.length ? "Fit the panel parts into the top pieces." : "Fit the panel parts.", [], [...new Set(cutouts.map((cutout) => cutout.printedPart))]);
  if (topScrews.length) {
    const reach = Math.max(...topScrews.map((screw) => screw.postBottom - 0.2 - TOP_TAB_THICKNESS));
    step(`Screw on the top pieces from below, up through the open base, with the plate off. You need a driver with at least ${mm(Math.ceil(reach / 5) * 5)} of shaft.`, ["shell", "top"]);
  }
  if (placed.some((p) => p.part.mount === "wall")) step("Fit the parts that go through the walls, nuts on the outside.", ["shell"]);
  if (placed.some((p) => p.part.mount === "floor") || config.opening) step(plate ? "Fit the boards and whatever the opening holds to the plate." : "Fit the boards and whatever the opening holds.", [plate ? "plate" : "shell"]);
  if (plate?.weights.length) step("Glue the weights into their pockets on the plate.", ["plate"]);
  if (plate?.screws.length) step("Screw on the plate from below.", ["shell", "plate"]);
  if (config.opening?.rail) step("Screw on the rail from below, last.", ["shell", "rail"]);
  if (plate?.feet.length) step("Stick a rubber foot into each recess under the plate.", ["plate"]);
  const hasKnobs = config.components.some((c) => "knob" in c && c.knob);
  const hasCaps = config.components.some((c) => "cap" in c && c.cap);
  if (hasKnobs) step("Push the knobs onto their shafts, last, each with its groove over the shaft's flat.", ["knob"]);
  else if (hasCaps) step("Push the key caps onto their switches' stems, last.", ["knob"]);
  if (hasKnobs && hasCaps) step("Push the key caps onto their switches' stems.", []);
  return steps;
}

// A board's screw into its standoff, from the hole's size, long enough to go through the board and
// as far into the hole as it can without bottoming out.
const SCREW_LENGTHS = [3, 4, 5, 6, 8, 10, 12];
const BOARD_THICKNESS = 1.6;
export function standoffScrew(holeDiameter: number, height: number): string {
  const size = holeDiameter < 2 ? "M2" : holeDiameter < 2.4 ? "M2.5" : "M3";
  const room = BOARD_THICKNESS + height - STANDOFF_HOLE_FLOOR;
  const length = [...SCREW_LENGTHS].reverse().find((l) => l <= room + 1e-9) ?? SCREW_LENGTHS[0]!;
  return `${size} x ${length} screw, for the boards' standoffs`;
}

// A plate screw reaches through the plate, and on an upright shell through the wedge under its
// boss too, to as far into the insert as it can go without bottoming out.
const PLATE_SCREW_LENGTHS = [8, 10, 12, 14, 16];
function plateScrewLength(config: Config, lift: number): number {
  if (lift === 0) return 8;
  const room = config.enclosure.floorThickness + lift + INSERT_HOLE_DEPTH - 0.5;
  return [...PLATE_SCREW_LENGTHS].reverse().find((l) => l <= room + 1e-9) ?? 8;
}

function listHardware(config: Config, profile: Profile, seams: PlannedSeam[], plate: PlatePlan | null, posts: PlacedPost[], topScrews: TopScrew[], creases: CreaseJoint[], blocks: HolderBlock[]): HardwareItem[] {
  const items: HardwareItem[] = [];
  if (plate?.screws.length) {
    items.push({ name: "M3 brass heat-set insert", count: plate.screws.length });
    const lengths = plate.lifts.map((lift) => plateScrewLength(config, lift));
    for (const length of [...new Set(lengths)].sort((a, b) => a - b)) {
      items.push({ name: `M3 x ${length} flat-head screw`, count: lengths.filter((l) => l === length).length });
    }
  }
  const ribBolts = plate?.ribs.reduce((sum, rib) => sum + rib.bolts.length, 0) ?? 0;
  if (ribBolts) {
    items.push({ name: "M3 brass heat-set insert, for the plate's joint", count: ribBolts });
    items.push({ name: "M3 x 10 flat-head screw, for the plate's joint", count: ribBolts });
  }
  const seamBolts = seams.reduce((sum, seam) => sum + seam.bolts.length, 0);
  if (seamBolts) {
    items.push({ name: "M3 brass heat-set insert, for the seam", count: seamBolts });
    items.push({ name: `M3 x ${Math.ceil(Math.max(...seams.map((s) => s.ribHalfThickness)) + 5)} flat-head screw, for the seam`, count: seamBolts });
  }
  if (topScrews.length) {
    items.push({ name: "M3 brass heat-set insert, for the top panels", count: topScrews.length });
    items.push({ name: shellPrintsOnSide(seams.length) ? "M3 x 8 screw, for the top panels" : "M3 x 8 flat-head screw, for the top panels", count: topScrews.length });
  }
  const creaseScrews = creases.reduce((sum, crease) => sum + crease.screws.length, 0);
  if (creaseScrews) {
    items.push({ name: "M3 brass heat-set insert, for the creases", count: creaseScrews });
    items.push({ name: "M3 x 8 screw, for the creases", count: creaseScrews });
  }
  if (config.plate.countersunkHoles.length) {
    items.push({ name: "M3 x 8 flat-head screw, through the plate", count: config.plate.countersunkHoles.length });
  }
  if (config.opening?.rail) {
    items.push({ name: "M3 brass heat-set insert, for the rail", count: 2 });
    items.push({ name: "M3 x 8 flat-head screw, for the rail", count: 2 });
  }
  if (posts.length) items.push({ name: "M2 x 5 screw", count: posts.length });
  const pockets = new Map<string, number>();
  for (const weight of plate?.weights ?? []) {
    const name = `Weight to glue into a ${mm(weight.width)} x ${mm(weight.depth)} pocket, up to ${mm(weight.height)} tall, such as steel`;
    pockets.set(name, (pockets.get(name) ?? 0) + 1);
  }
  for (const [name, count] of pockets) items.push({ name, count });
  if (plate?.feet.length) {
    const largest = Math.max(...plate.feet.map((foot) => foot.diameter));
    items.push({ name: `Stick-on rubber foot, up to ${mm(largest)} across`, count: plate.feet.length });
  }
  const standoffs = new Map<string, number>();
  for (const block of blocks) {
    if (!block.post) continue;
    const name = standoffScrew(block.post.holeDiameter, block.top);
    standoffs.set(name, (standoffs.get(name) ?? 0) + 1);
  }
  for (const [name, count] of standoffs) items.push({ name, count });
  return items;
}

// A knob on each shaft of a part that asks for them, and a cap on each stem, after the other printed parts.
function planKnobs(config: Config, placed: Placed[], first: number, issues: Issues): PlannedKnob[] {
  const knobs: PlannedKnob[] = [];
  const { fit } = config.fabrication;
  const planCaps = (item: Placed, component: { u: number; v: number; rotationDeg: number }, cap: { width: number; depth: number; thickness: number; color?: string | undefined }) => {
    const path = `components[${item.index}].cap`;
    const stems = item.part.mount === "panel" ? item.part.stems : [];
    if (!stems.length || !item.surface) {
      issues.error("KNOB_INVALID", `"${item.id}" has no stem for a key cap.`, path, [item.id]);
      return;
    }
    const rotation = component.rotationDeg as Rotation;
    stems.forEach((stem, n) => {
      const fits = capFit(cap, stem, fit.knobHole);
      if (typeof fits === "string") {
        issues.error("KNOB_INVALID", `The cap for "${item.id}" ${fits}.`, path, [item.id]);
        return;
      }
      const [du, dv] = rotateOffset(stem.at, rotation);
      const [width, depth] = rotation === 90 || rotation === 270 ? [cap.depth, cap.width] : [cap.width, cap.depth];
      const { collarBottom, ...key } = fits;
      knobs.push({
        componentId: item.id,
        name: stems.length > 1 ? `Cap ${n + 1} for ${item.id}` : `Cap for ${item.id}`,
        printedPart: first + knobs.length,
        surface: item.surface!.id,
        u: component.u + du,
        v: component.v + dv,
        toward: rotateOffset([0, 1], rotation),
        diameter: Math.max(width, depth),
        underside: collarBottom,
        height: key.topUnderside + cap.thickness - collarBottom,
        hole: { diameter: key.cross[0], flat: null, depth: key.socketTop - collarBottom },
        color: cap.color ?? DEFAULT_KNOB_COLOR,
        key: { width, depth, thickness: cap.thickness, ...key },
      });
    });
  };
  for (const item of placed) {
    const component = config.components[item.index]!;
    if ("u" in component && component.cap) planCaps(item, component, component.cap);
    if (!("u" in component) || !component.knob) continue;
    const path = `components[${item.index}].knob`;
    const shafts = item.part.mount === "panel" ? item.part.shafts : [];
    if (!shafts.length || !item.surface) {
      issues.error("KNOB_INVALID", `"${item.id}" has no shaft for a knob.`, path, [item.id]);
      continue;
    }
    const rotation = component.rotationDeg as Rotation;
    shafts.forEach((shaft, n) => {
      const knob = component.knob!;
      const fits = knobFit(knob, shaft, config.enclosure.panelThickness);
      const name = shafts.length > 1 ? `Knob ${n + 1} for ${item.id}` : `Knob for ${item.id}`;
      if (typeof fits === "string") {
        issues.error("KNOB_INVALID", `The knob for "${item.id}" ${fits}.`, path, [item.id]);
        return;
      }
      const [du, dv] = rotateOffset(shaft.at, rotation);
      const toward = rotateOffset([0, 1], rotation);
      knobs.push({
        componentId: item.id,
        name,
        printedPart: first + knobs.length,
        surface: item.surface!.id,
        u: component.u + du,
        v: component.v + dv,
        toward,
        diameter: knob.diameter,
        underside: fits.underside,
        height: knob.height,
        hole: { diameter: shaft.diameter + fit.knobHole, flat: shaft.flat === undefined ? null : shaft.flat + fit.knobHole, depth: fits.depth },
        color: knob.color ?? DEFAULT_KNOB_COLOR,
      });
    });
  }
  return knobs;
}

// Whether the microcontroller has the pins for what's wired to it. Short is a warning, since a
// design can be wired other ways than these counts assume.
function checkPins(config: Config, placed: Placed[], issues: Issues): PinBudget | null {
  const budget = planPins(placed.map((item) => ({ id: item.id, part: item.part })), config.wiring.shiftRegisters);
  if (!budget) return null;
  const path = `components[${placed.find((item) => item.id === budget.controller)!.index}]`;
  if (budget.used > budget.gpio) {
    issues.warn("PINS_SHORT", `"${budget.controller}" has ${budget.gpio} pins, and this needs ${budget.used}: ${budget.uses.map((use) => `${use.pins} for ${use.what[0]!.toLowerCase()}${use.what.slice(1)}`).join("; ")}. Add a shift register for switches, or wiring.shiftRegisters if they're on a board of your own.`, path, [budget.controller]);
  }
  if (budget.unaddressed.length) {
    issues.warn("PINS_SHORT", `There aren't enough I2C addresses for ${budget.unaddressed.map((id) => `"${id}"`).join(", ")}, since the parts on the bus can't all be set apart. A second bus, or a multiplexer, would do it.`, path, budget.unaddressed);
  }
  if (budget.analogShort > 0) {
    issues.warn("PINS_SHORT", `${budget.analogShort} analog ${budget.analogShort === 1 ? "input has" : "inputs have"} nothing to read ${budget.analogShort === 1 ? "it" : "them"}. Add an analog board, such as the ADS7830.`, path, [budget.controller]);
  }
  return budget;
}

// Room between controls for fingers, at their edges as they stand above the surface. A button is
// pressed from above, so it can be closer than a knob or fader, which is gripped from the side.
// Both are what the Desk Synth has, which is comfortable: buttons 3.6 mm apart, and dials 5.5 mm.
export const FINGER_ROOM: Record<"press" | "touch" | "turn" | "slide", number> = { press: 2, touch: 2, turn: 5, slide: 5 };
// A screen lying flatter than about 15 degrees, or facing away, is hard to read from in front.
export const SCREEN_MIN_SIN = 0.26;

function checkErgonomics(placed: Placed[], issues: Issues) {
  const panel = placed.filter((item): item is PanelPlaced => item.part.mount === "panel" && item.surface !== null);
  const controls = panel.filter((item) => item.part.control && item.part.control !== "screen");
  controls.forEach((a, i) => {
    for (const b of controls.slice(i + 1)) {
      if (a.surface.id !== b.surface.id) continue;
      const room = Math.max(FINGER_ROOM[a.part.control as keyof typeof FINGER_ROOM], FINGER_ROOM[b.part.control as keyof typeof FINGER_ROOM]);
      const apart = gap(a.shape("above"), b.shape("above"));
      if (apart >= 0 && apart < room - 1e-9) {
        issues.warn("ERGONOMICS", `"${a.id}" and "${b.id}" are ${mm(apart)} apart at their edges, and fingers need about ${mm(room)} between ${room > FINGER_ROOM.press ? "a knob or fader and what's beside it" : "buttons"}.`, `components[${b.index}]`, [a.id, b.id]);
      }
    }
  });
  for (const screen of panel.filter((item) => item.part.control === "screen")) {
    if (screen.surface.sin < SCREEN_MIN_SIN) {
      issues.warn("ERGONOMICS", `"${screen.id}" ${screen.surface.sin < 0 ? "faces away from you" : "lies nearly flat"}, so it's hard to read from in front. It reads best tilted towards you, like the Desk Synth's at 30 degrees.`, `components[${screen.index}]`, [screen.id]);
    }
  }
}

function checkPartSuitability(placed: Placed[], config: Config, limits: Limits, issues: Issues) {
  const thickness = config.enclosure.panelThickness;
  const reported = new Set<string>();
  for (const item of placed) {
    const path = `components[${item.index}]`;
    const type = config.components[item.index]!.type;
    if (item.part.source !== "measured" && !reported.has(type)) {
      reported.add(type);
      const users = placed.filter((p) => config.components[p.index]!.type === type).map((p) => p.id);
      issues.warn("UNVERIFIED_PART", `"${type}" dimensions are ${item.part.source === "datasheet" ? "from a datasheet" : "estimates"}, not measured. Check the real part before printing, or print a fit test.`, path, users);
    }
    if (item.part.mount === "panel") checkPanelPart(item.part, item.id, path, thickness, limits, issues);
  }
}

// Whether the fit test has anything to try for a part: a panel part's holes, or a board's clips.
export function fitTestable(part: Part): boolean {
  return part.mount === "panel" || (part.mount === "floor" && part.holder !== undefined && part.holder.clips.length > 0 && part.footprint.shape === "rect");
}

function checkFitTestParts(config: Config, parts: Record<string, Part>, limits: Limits, issues: Issues) {
  config.fabrication.fitTestParts.forEach((id, i) => {
    const path = `fabrication.fitTestParts[${i}]`;
    const part = parts[id];
    if (!part) issues.error("UNKNOWN_PART", `The fit test is set to try "${id}", which isn't in the library or customParts.`, path, []);
    else if (!fitTestable(part)) issues.error("FIT_TEST_PART_INVALID", `The fit test has nothing to try for "${id}" unless it's placed in the design.`, path, []);
    else if (part.mount === "panel") checkPanelPart(part, id, path, config.enclosure.panelThickness, limits, issues);
  });
}

// What's true of a panel part wherever it goes.
function checkPanelPart(part: PanelPart, id: string, path: string, thickness: number, limits: Limits, issues: Issues) {
  const { min, max } = part.panelThickness ?? {};
  if ((min !== undefined && thickness < min) || (max !== undefined && thickness > max)) {
    issues.error(
      "PANEL_THICKNESS_UNSUITABLE",
      `"${id}" needs a panel ${min !== undefined ? `at least ${mm(min)}` : ""}${min !== undefined && max !== undefined ? " and " : ""}${max !== undefined ? `at most ${mm(max)}` : ""} thick, but the design has ${mm(thickness)}.`,
      path,
      [id],
    );
  }
  for (const cutout of part.cutouts) {
    if (cutout.kind === "pocket" && (cutout.skin < limits.minSkin || cutout.skin >= thickness)) {
      issues.error("SKIN_INVALID", `"${id}" leaves a ${mm(cutout.skin)} skin, which must be at least ${mm(limits.minSkin)} and under the ${mm(thickness)} panel.`, path, [id]);
    }
    if (cutout.kind === "circle" && cutout.diameter < SMALL_HOLE) {
      issues.warn("SMALL_HOLE", `"${id}" has a ${mm(cutout.diameter)} hole, which may not print accurately.`, path, [id]);
    }
    if (cutout.kind === "rect" && 2 * cutout.cornerRadius >= Math.min(cutout.width, cutout.height)) {
      issues.error("GEOMETRY_IMPOSSIBLE", `"${id}" has a ${mm(cutout.cornerRadius)} corner radius, too large for its ${mm(cutout.width)} x ${mm(cutout.height)} cutout.`, path, [id]);
    }
    if (cutout.kind === "rect" && cutout.bevel !== undefined && cutout.bevel >= (cutout.recess?.skin ?? thickness)) {
      issues.error("GEOMETRY_IMPOSSIBLE", `"${id}" has a ${mm(cutout.bevel)} bevel, which has to be shallower than the ${mm(cutout.recess?.skin ?? thickness)} it cuts into.`, path, [id]);
    }
    if (cutout.kind !== "rect" || !cutout.recess) continue;
    const { recess } = cutout;
    if (recess.skin < limits.minSkin || recess.skin >= thickness) {
      issues.error("SKIN_INVALID", `The recess of "${id}" leaves a ${mm(recess.skin)} skin, which must be at least ${mm(limits.minSkin)} and under the ${mm(thickness)} panel.`, path, [id]);
    }
    const contained = Math.abs(cutout.at[0] - recess.at[0]) + cutout.width / 2 <= recess.width / 2 && Math.abs(cutout.at[1] - recess.at[1]) + cutout.height / 2 <= recess.height / 2;
    if (!contained) {
      issues.error("GEOMETRY_IMPOSSIBLE", `The recess of "${id}" must be wider than its window on every side.`, path, [id]);
    }
  }
  for (const post of part.posts) {
    if (post.reach - post.holeDepth < limits.minSkin) {
      issues.error("SKIN_INVALID", `A screw hole in "${id}" stops ${mm(post.reach - post.holeDepth)} below the surface, and it needs ${mm(limits.minSkin)}.`, path, [id]);
    }
    if (post.reach <= POST_ROOT_DEPTH || post.holeDiameter >= post.diameter) {
      issues.error("GEOMETRY_IMPOSSIBLE", `A screw post on "${id}" is too short, or its hole is wider than it is.`, path, [id]);
    }
  }
}

// Covers overlaps, which crash the engine, and exact tangents, which it turns into
// non-manifold edges. Cutouts of the same component are included, so a bad custom
// part gets caught too. Margins at creases keep cutouts on different surfaces apart.
function checkCutoutSpacing(cutouts: PlacedShape[], minWeb: number, issues: Issues) {
  for (let i = 0; i < cutouts.length; i++) {
    for (let j = i + 1; j < cutouts.length; j++) {
      const a = cutouts[i]!;
      const b = cutouts[j]!;
      if (a.surface !== b.surface || a.cutout === b.cutout) continue;
      const clear = gap(a.shape, b.shape);
      if (clear < minWeb) {
        const ids = [...new Set([a.cutout.componentId, b.cutout.componentId])];
        const relation = clear < -0.005 ? `overlap by ${mm(-clear)}` : `leave only ${mm(Math.max(clear, 0))} of plastic between them`;
        const who = ids.length === 1 ? `Two cutouts of "${ids[0]}"` : `"${ids[0]}" and "${ids[1]}"`;
        issues.error("CUTOUTS_TOO_CLOSE", `${who} ${relation}. The minimum is ${mm(minWeb)}.`, `components[${b.index}]`, ids);
      }
    }
  }
}

// How close to a crease a cutout can sit before its tool reaches the next surface.
function creaseMargin(a: Surface, b: Surface, thickness: number, minWeb: number): number {
  const bend = b.angle - a.angle;
  const size = Math.abs(bend);
  const tool = bend > 0 ? TOOL_OVERSHOOT_ABOVE / Math.tan(size) : TOOL_OVERSHOOT_BELOW * Math.tan(size);
  return minWeb + thickness * Math.tan(size / 2) + tool;
}

// How far a surface can be used, in u and v.
function usableSurface(surface: Surface, config: Config, profile: Profile, minWeb: number) {
  const e = config.enclosure;
  const t = e.panelThickness;
  const margin = Math.max(e.wall, e.topEdgeFillet) + minWeb;
  // A slope makes the top and underside of a surface reach different ys, so an
  // end wall limits whichever of the two reaches furthest.
  const previous = profile.surfaces[surface.index - 1];
  const next = profile.surfaces[surface.index + 1];
  const vMin = previous
    ? creaseMargin(previous, surface, t, minWeb)
    : (margin - Math.min(0, t * surface.sin)) / surface.cos;
  const vMax = next
    ? surface.length - creaseMargin(surface, next, t, minWeb)
    : (profile.depth - margin - Math.max(0, t * surface.sin) - surface.y0) / surface.cos - profile.rearTangent;
  return { margin, vMin, vMax };
}

// Rounded corners take a bite out of the usable rectangle.
function offRoundedCorner(surface: Surface, config: Config, profile: Profile, minWeb: number, low: { u: number; v: number }, high: { u: number; v: number }): boolean {
  const e = config.enclosure;
  const cornerCentre = e.cornerRadius;
  const allowedCornerRadius = Math.max(e.cornerRadius - e.wall, 0.5) - minWeb;
  return ([[low.u, low.v], [high.u, low.v], [low.u, high.v], [high.u, high.v]] as const).some(([x, v]) => {
    const [y] = surfacePoint(surface, v, 0);
    const dx = Math.max(cornerCentre - x, x - (e.width - cornerCentre), 0);
    const dy = Math.max(cornerCentre - y, y - (profile.depth - cornerCentre), 0);
    return dx > 0 && dy > 0 && Math.hypot(dx, dy) > allowedCornerRadius;
  });
}

function checkCutoutsOnSurfaces(cutouts: PlacedShape[], config: Config, profile: Profile, minWeb: number, issues: Issues) {
  const e = config.enclosure;

  for (const { cutout, shape, surface, index } of cutouts) {
    const { margin, vMin, vMax } = usableSurface(surface, config, profile, minWeb);
    const [hu, hv] = halfExtents(shape);
    const low = { u: shape.cx - hu, v: shape.cy - hv };
    const high = { u: shape.cx + hu, v: shape.cy + hv };
    const path = `components[${index}]`;
    const report = (detail: string) =>
      issues.error("CUTOUT_OUTSIDE_SURFACE", `"${cutout.componentId}" ${detail} The usable part of "${surface.id}" is u ${mm(margin)} to ${mm(e.width - margin)}, v ${mm(vMin)} to ${mm(vMax)}.`, path, [cutout.componentId]);

    if (low.u < margin || high.u > e.width - margin || low.v < vMin || high.v > vMax) {
      report(`has a cutout reaching u ${mm(low.u)} to ${mm(high.u)}, v ${mm(low.v)} to ${mm(high.v)}, too close to or past the edge.`);
      continue;
    }
    if (offRoundedCorner(surface, config, profile, minWeb, low, high)) report("has a cutout too close to a rounded corner.");
  }
}

function checkCutoutsAgainstSeams(cutouts: PlacedShape[], config: Config, topPieces: TopPiece[], minWeb: number, issues: Issues) {
  const opening = config.opening;
  for (const { cutout, shape, surface, index } of cutouts) {
    const [hu, hv] = halfExtents(shape);
    const path = `components[${index}]`;
    const id = cutout.componentId;
    const pieces = topPieces.filter((piece) => piece.surface === surface.id);
    if (pieces.length) {
      // On a top panel, the shell's seam is out of reach, and only the panel's own joints matter.
      const piece = pieces.find((p) => shape.cx < p.xMax) ?? pieces.at(-1)!;
      for (const edge of [piece.xMin, piece.xMax]) {
        if (edge <= 0.01 || edge >= config.enclosure.width - 0.01) continue;
        // A groove reaches into the piece past its edge.
        const needs = minWeb + (piece.groove && edge === piece.xMin ? GROOVE_DEPTH : 0);
        if (Math.abs(shape.cx - edge) - hu < needs) {
          issues.error("CUTOUT_CROSSES_SEAM", `"${id}" has a cutout too close to the edge of ${piece.name} at x = ${mm(edge)}. It needs ${mm(needs)}.`, path, [id]);
        }
      }
    } else {
      for (const seam of config.seams) {
        const distance = Math.abs(shape.cx - seam.x) - hu;
        if (distance <= 0) {
          issues.error("CUTOUT_CROSSES_SEAM", `"${id}" has a cutout crossing the seam at x = ${mm(seam.x)}. Move it at least ${mm(seam.ribHalfThickness + minWeb - distance)} sideways.`, path, [id]);
        } else if (distance < seam.ribHalfThickness + minWeb) {
          issues.error("CUTOUT_HITS_RIB", `"${id}" has a cutout ${mm(distance)} from the seam, which cuts into or crowds its rib. It needs ${mm(seam.ribHalfThickness + minWeb)}.`, path, [id]);
        }
      }
    }
    if (opening) {
      const [yA] = surfacePoint(surface, shape.cy - hv, 0);
      const [yB] = surfacePoint(surface, shape.cy + hv, 0);
      const inX = shape.cx + hu > opening.xMin - minWeb && shape.cx - hu < opening.xMax + minWeb;
      if (inX && Math.min(yA, yB) < opening.yEnd + minWeb) {
        issues.error("OPENING_INVALID", `"${id}" has a cutout in or too close to the opening.`, path, [id]);
      }
    }
  }
}

function checkBodies(placed: Placed[], config: Config, profile: Profile, seams: PlannedSeam[], issues: Issues) {
  const e = config.enclosure;
  const panel = placed.filter((p): p is PanelPlaced => p.part.mount === "panel" && p.surface !== null);
  const floor = placed.filter((p): p is FloorPlaced => p.part.mount === "floor");
  const t = e.panelThickness;

  // A part's body as a polygon in the world's YZ plane. It tilts with its surface.
  const section = (item: PanelPlaced, which: "above" | "below"): Point2[] => {
    const shape = item.shape(which);
    const [, hv] = halfExtents(shape);
    const near = which === "below" ? -t - SKIMMING : SKIMMING;
    const far = which === "below" ? -t - item.part.below.depth : item.part.above.height;
    const point = (v: number, n: number) => surfacePoint(item.surface, v, n);
    return [point(shape.cy - hv, near), point(shape.cy + hv, near), point(shape.cy + hv, far), point(shape.cy - hv, far)];
  };

  const report = (a: Placed, b: Placed, where: string, detail: string) => {
    issues.error("BODIES_COLLIDE", `"${a.id}" and "${b.id}" ${where} ${detail}. They need ${mm(PART_CLEARANCE)}.`, `components[${b.index}]`, [a.id, b.id]);
  };
  const compare = (a: PanelPlaced, b: PanelPlaced, which: "above" | "below", where: string) => {
    const shapeA = a.shape(which);
    const shapeB = b.shape(which);
    if (a.surface === b.surface) {
      const clear = gap(shapeA, shapeB);
      if (clear < PART_CLEARANCE) report(a, b, where, clear < 0 ? `overlap by ${mm(-clear)}` : `are only ${mm(clear)} apart`);
      return;
    }
    // On different surfaces the only shared axis is X, so test the side view too.
    const xGap = Math.abs(shapeA.cx - shapeB.cx) - halfExtents(shapeA)[0] - halfExtents(shapeB)[0];
    if (xGap < PART_CLEARANCE && polygonsOverlap(section(a, which), section(b, which))) {
      report(a, b, where, "collide across surfaces");
    }
  };

  for (let i = 0; i < panel.length; i++) {
    for (let j = i + 1; j < panel.length; j++) {
      const a = panel[i]!;
      const b = panel[j]!;
      // A part with no height on one side, like a flush sensor, can't collide there.
      if (a.part.above.height > 0 && b.part.above.height > 0) compare(a, b, "above", "above the panel");
      if (a.part.below.depth > 0 && b.part.below.depth > 0) compare(a, b, "below", "below the panel");
    }
  }
  for (let i = 0; i < floor.length; i++) {
    for (let j = i + 1; j < floor.length; j++) {
      const a = floor[i]!;
      const b = floor[j]!;
      const clear = gap(a.shape("below"), b.shape("below"));
      if (clear < PART_CLEARANCE) report(a, b, "on the floor", clear < 0 ? `overlap by ${mm(-clear)}` : `are only ${mm(clear)} apart`);
    }
  }

  const xMin = e.wall;
  const xMax = e.width - e.wall;
  const yMin = e.wall;
  const yMax = profile.depth - e.wall;
  const floorTop = e.floorThickness;

  for (const item of panel) {
    const path = `components[${item.index}]`;
    if (item.part.above.height > 0) {
      const others = profile.surfaces.filter((s) => s !== item.surface);
      const hit = others.find((s) => polygonCrossesChain(section(item, "above"), [[s.y0, s.z0], [s.y1, s.z1]]));
      if (hit) {
        issues.error("BODY_HITS_ENCLOSURE", `The part of "${item.id}" above "${item.surface.id}" runs into surface "${hit.id}". Move it further from the crease.`, path, [item.id]);
      }
    }
    if (item.part.below.depth === 0) continue;
    const shape = item.shape("below");
    const [hu] = halfExtents(shape);
    const body = section(item, "below");
    const lowest = Math.min(...body.map(([, z]) => z));
    const ys = body.map(([y]) => y);
    if (lowest < floorTop) {
      issues.error("BODY_HITS_ENCLOSURE", `"${item.id}" reaches ${mm(lowest)} above the base, but the floor's top is at ${mm(floorTop)}. It needs ${mm(floorTop - lowest)} more height: move it somewhere taller, or raise the enclosure.`, path, [item.id]);
    } else if (shape.cx - hu < xMin || shape.cx + hu > xMax || Math.min(...ys) < yMin || Math.max(...ys) > yMax) {
      issues.error("BODY_HITS_ENCLOSURE", `The body of "${item.id}" runs into a wall below the surface.`, path, [item.id]);
    } else if (!polygonInside(body, profile.cavity)) {
      issues.error("BODY_HITS_ENCLOSURE", `The body of "${item.id}" runs into the underside of another surface.`, path, [item.id]);
    }
    for (const box of reservedBoxes(config)) {
      if (shape.cx + hu <= box.xMin || shape.cx - hu >= box.xMax) continue;
      const area: Point2[] = [[box.yMin, 0], [box.yMax, 0], [box.yMax, box.top], [box.yMin, box.top]];
      if (polygonsOverlap(body, area)) {
        issues.error("OPENING_INVALID", `The body of "${item.id}" runs into the space the opening's contents need.`, path, [item.id]);
        break;
      }
    }
    // Only the tabs on the walls are fixed. Tabs under surfaces already moved out of the way.
    for (const seam of seams) {
      const reachX = seam.ribHalfThickness + seam.ribWidth;
      if (Math.abs(shape.cx - seam.x) - hu >= reachX) continue;
      if (seam.tabs.some((tab) => polygonsOverlap(body, tabSection(tab)))) {
        issues.error("BODY_HITS_RIB", `The body of "${item.id}" runs into a seam tab at x = ${mm(seam.x)}.`, path, [item.id]);
      }
    }
  }

  for (const item of floor) {
    const path = `components[${item.index}]`;
    const shape = item.shape("below");
    const [hx, hy] = halfExtents(shape);
    const top = floorTop + item.part.height;
    if (shape.cx - hx < xMin || shape.cx + hx > xMax || shape.cy - hy < profile.plateFront || shape.cy + hy > profile.plateRear) {
      issues.error("BODY_HITS_ENCLOSURE", `"${item.id}" at x ${mm(shape.cx)}, y ${mm(shape.cy)} extends past the inside of the walls.`, path, [item.id]);
    }
    const ceiling = lowestHeight(profile.inner, shape.cy - hy, shape.cy + hy);
    if (top > ceiling) {
      issues.error("BODY_HITS_ENCLOSURE", `"${item.id}" is ${mm(top)} tall from the base, but the underside of the top drops to ${mm(ceiling)} over it. Move it somewhere taller.`, path, [item.id]);
    }
    for (const seam of config.seams) {
      if (Math.abs(shape.cx - seam.x) - hx < seam.ribHalfThickness) {
        issues.error("BODY_HITS_RIB", `"${item.id}" crosses the seam at x = ${mm(seam.x)}. Boards must sit entirely within one printed part.`, path, [item.id]);
      }
    }
    for (const keep of reservedBoxes(config)) {
      if (shape.cx + hx <= keep.xMin || shape.cx - hx >= keep.xMax) continue;
      if (shape.cy + hy > keep.yMin && shape.cy - hy < keep.yMax && floorTop < keep.top) {
        issues.error("OPENING_INVALID", `"${item.id}" sits in the space the opening's contents need.`, path, [item.id]);
        break;
      }
    }
    for (const seam of seams) {
      if (Math.abs(shape.cx - seam.x) - hx >= seam.ribHalfThickness + seam.ribWidth) continue;
      const box: Point2[] = [[shape.cy - hy, floorTop], [shape.cy + hy, floorTop], [shape.cy + hy, top], [shape.cy - hy, top]];
      if (seam.tabs.some((tab) => polygonsOverlap(box, tabSection(tab)))) {
        issues.error("BODY_HITS_RIB", `"${item.id}" runs into a seam tab at x = ${mm(seam.x)}.`, path, [item.id]);
      }
    }
    for (const above of panel) {
      const body = above.shape("below");
      const [hu] = halfExtents(body);
      const xApart = Math.abs(shape.cx - body.cx) - hx - hu >= PART_CLEARANCE;
      if (xApart || above.part.below.depth === 0) continue;
      const c = PART_CLEARANCE;
      const box: Point2[] = [
        [shape.cy - hy - c, floorTop],
        [shape.cy + hy + c, floorTop],
        [shape.cy + hy + c, top + c],
        [shape.cy - hy - c, top + c],
      ];
      if (polygonsOverlap(section(above, "below"), box)) {
        issues.error("BODIES_COLLIDE", `"${item.id}" on the floor and the body of "${above.id}" hanging from "${above.surface.id}" collide, or come within ${mm(c)}.`, path, [item.id, above.id]);
      }
    }
  }
}
