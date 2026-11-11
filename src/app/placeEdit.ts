// Things that can be added by clicking where they go in the view. Each says what it can be clicked
// onto, and how to add it there. Without a click, it goes where it always did, in the middle.
import { addComponent, updateComponent, type RawConfig } from "./configEdit.js";
import { addSurfaceLabel, addWallLabel } from "./labelEdit.js";
import type { Spot } from "./pickSpot.js";
import { addCableTie, addFoot, addPlateHole, addPlatePin, addSeam, addSupport, addVent, addWallHole, addWeight } from "./shapeEdit.js";
import type { Part } from "../schema.js";

export interface Placing {
  what: string; // as in "Click a wall to put ... there"
  onto: Spot["kind"][];
  middle(config: RawConfig): RawConfig;
  at(config: RawConfig, spot: Spot): RawConfig;
  selects?: string; // the part to select once it's placed
}

const tidy = (value: number) => Math.round(value * 10) / 10;

// The last item of a list in the config changed, such as the one just added.
function withLast(config: RawConfig, path: string[], patch: RawConfig): RawConfig {
  const [key, ...rest] = path;
  if (!key) return config;
  if (rest.length) return { ...config, [key]: withLast(config[key] ?? {}, rest, patch) };
  const list: RawConfig[] = config[key] ?? [];
  return { ...config, [key]: list.map((item, i) => (i === list.length - 1 ? { ...item, ...patch } : item)) };
}

const onWall = (spot: Spot): RawConfig => (spot.kind === "wall" ? { wall: spot.wall, at: spot.at, z: spot.z } : {});
const onPlate = (spot: Spot): RawConfig => (spot.kind === "floor" || spot.kind === "under" ? { x: spot.x, y: spot.y } : {});

function placing(what: string, onto: Spot["kind"][], add: (config: RawConfig) => RawConfig, path: string[], patch: (spot: Spot) => RawConfig): Placing {
  return { what, onto, middle: add, at: (config, spot) => withLast(add(config), path, patch(spot)) };
}

export const PLACING = {
  // A label goes on whichever it's clicked onto, with the other left out of what it adds.
  label: {
    what: "the label",
    onto: ["surface", "wall"],
    middle: addSurfaceLabel,
    at: (config, spot) =>
      spot.kind === "surface"
        ? withLast(addSurfaceLabel(config), ["labels"], { surface: spot.surface, u: spot.u, v: spot.v })
        : withLast(addWallLabel(config), ["labels"], onWall(spot)),
  } as Placing,
  surfaceLabel: placing("the label", ["surface"], addSurfaceLabel, ["labels"], (spot) => (spot.kind === "surface" ? { surface: spot.surface, u: spot.u, v: spot.v } : {})),
  wallLabel: placing("the label", ["wall"], addWallLabel, ["labels"], onWall),
  wallHole: placing("the hole", ["wall"], addWallHole, ["wallHoles"], onWall),
  vent: placing("the vent", ["wall"], addVent, ["vents"], onWall),
  plateHole: placing("the hole", ["floor", "under"], addPlateHole, ["plate", "countersunkHoles"], onPlate),
  platePin: placing("the pin", ["floor", "under"], addPlatePin, ["plate", "pins"], onPlate),
  cableTie: placing("the cable tie bridge", ["floor", "under"], addCableTie, ["plate", "cableTies"], onPlate),
  support: placing("the support", ["floor", "under"], addSupport, ["plate", "supports"], onPlate),
  weight: placing("the weight pocket", ["floor", "under"], addWeight, ["plate", "weights"], onPlate),
  foot: placing("the foot", ["under", "floor"], addFoot, ["plate", "feet"], onPlate),
  // A seam runs right across, so anywhere on the model gives where along the width.
  seam: {
    what: "the seam",
    onto: ["surface", "wall", "floor", "under"],
    middle: addSeam,
    at: (config, spot) => {
      const x = spot.kind === "surface" ? spot.u : spot.kind === "wall" ? (spot.wall === "front" || spot.wall === "rear" ? spot.at : null) : spot.x;
      return x === null ? config : withLast(addSeam(config), ["seams"], { x: tidy(x) });
    },
  } as Placing,
} satisfies Record<string, Placing>;

// A part from the library, onto what it mounts on.
export function placingPart(config: RawConfig, type: string, part: Part, surfaceId?: string): Placing {
  const added = addComponent(config, type, surfaceId);
  const onto: Spot["kind"][] = part.mount === "panel" ? ["surface"] : part.mount === "wall" ? ["wall"] : ["floor", "under"];
  return {
    what: part.name,
    onto,
    selects: added.id,
    middle: (current) => addComponent(current, type, surfaceId).config,
    at: (current, spot) => {
      const { config: next, id } = addComponent(current, type, surfaceId);
      const patch = spot.kind === "surface" ? { surface: spot.surface, u: spot.u, v: spot.v } : spot.kind === "wall" ? onWall(spot) : onPlate(spot);
      return updateComponent(next, id, patch);
    },
  };
}

// The first face under a click that the thing can go on.
export function spotFor(placing: Placing, spots: (Spot | null)[]): Spot | null {
  return spots.find((spot): spot is Spot => spot !== null && placing.onto.includes(spot.kind)) ?? null;
}

// What to click, in words: "a top surface or a wall".
export function ontoWords(placing: Placing): string {
  const names: Record<Spot["kind"], string> = { surface: "a top surface", wall: "a wall", floor: "the floor inside", under: "the underside" };
  const words = placing.onto.map((kind) => names[kind]);
  return placing.onto.length === 4 ? "the model" : words.length > 1 ? `${words.slice(0, -1).join(", ")} or ${words.at(-1)}` : words[0]!;
}
