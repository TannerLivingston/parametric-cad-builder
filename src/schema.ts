// The config is the design: small, diffable, and strict about unknown keys so a
// typo fails loudly. All lengths are millimetres. Positions on a surface use (u, v):
// u is measured from the left edge, v from the surface's front edge along its slope.
import { z } from "zod";
import { CLIP_GAP } from "./fixtures.js";
import { INSERT_HOLE_DIAMETER, PIN_DIAMETER, PIN_SOCKET_DIAMETER, SCREW_CLEARANCE_DIAMETER } from "./plate.js";

const length = z.number().positive();
const offset = z.number().finite();

export const footprintSchema = z.discriminatedUnion("shape", [
  z.strictObject({ shape: z.literal("circle"), diameter: length }),
  z.strictObject({ shape: z.literal("rect"), width: length, height: length }),
]);

const at = z.tuple([offset, offset]).default([0, 0]);

// Extra room off the side of a hole, such as a keyway for a button's tab, or room for a screen's
// ribbon. It's positioned like the hole, from the part's origin, and has to overlap it.
const notchSchema = z.strictObject({ width: length, height: length, at });

export const cutoutSchema = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("circle"), diameter: length, at, notches: z.array(notchSchema).optional() }),
  z.strictObject({
    kind: z.literal("rect"),
    width: length,
    height: length,
    cornerRadius: z.number().nonnegative().default(0),
    at,
    notches: z.array(notchSchema).optional(),
    // A 45 degree bevel round the window's edge on the face, this deep, as on the Desk Synth's screen.
    bevel: length.optional(),
    // A wider recess from below, around this window, such as for a screen's glass.
    recess: z.strictObject({ width: length, height: length, skin: length, at, notches: z.array(notchSchema).optional() }).optional(),
  }),
  // A blind recess from below, leaving a thin skin, such as for a capacitive sensor.
  z.strictObject({ kind: z.literal("pocket"), width: length, height: length, skin: length, at }),
]);

// Where a part's numbers came from. Anything but "measured" gets a warning.
export const sourceSchema = z.enum(["measured", "datasheet", "estimated"]);

// What a part needs from the microcontroller, or what it gives. Switches are plain on and off
// inputs, which can go through a shift register. Direct pins are for anything else, such as an
// encoder's two phases or an LED. An I2C part shares the bus, and lists the addresses it can be set to.
const count = z.number().int().nonnegative();
export const pinsSchema = z.strictObject({
  switches: count.default(0),
  direct: count.default(0),
  analog: count.default(0),
  i2c: z.array(z.number().int().min(0).max(127)).optional(),
  // A microcontroller's own pins, and how many of them can read analog.
  gpio: count.optional(),
  analogPins: count.optional(),
  // What a shift register or an analog board adds.
  shiftInputs: count.optional(),
  analogInputs: count.optional(),
});

// Where a part's wires leave it, for keeping room there and routing them. `side` is a face of its
// body before turning: "down" is its underside below a panel, "up" the top of a board on the floor,
// "back" the inner end of a part in a wall. On "down" and "up", `at` is across the face from its
// middle. On the sides, it's along the edge from its middle, then how far the plug's middle is below
// the panel's underside, or above the floor. `width` and `height` are the plug or the bundle across,
// along the edge first, and `room` is how far it runs straight out before it can bend, or 0 where the
// body takes in its plugs already, which leaves it only a place for its wires to start from.
export const wireExitSchema = z.strictObject({
  side: z.enum(["down", "up", "back", "left", "right", "front", "rear"]),
  at: z.tuple([offset, offset]).optional(),
  width: length,
  height: length,
  room: z.number().nonnegative().default(12),
});

const partBase = {
  name: z.string().min(1),
  source: sourceSchema,
  notes: z.string().optional(),
  pins: pinsSchema.optional(),
  wires: z.array(wireExitSchema).optional(),
  // "any" for a part whose wires can leave from any one of them, such as a board with a plug at each end.
  wiresFrom: z.enum(["all", "any"]).optional(),
};

// A screw post hanging from the underside. `reach` is how far below the outer face its
// end sits, and the hole runs up into it from there.
export const postSchema = z.strictObject({ at, diameter: length, reach: length, holeDiameter: length, holeDepth: length });

export const panelPartSchema = z.strictObject({
  ...partBase,
  mount: z.literal("panel"),
  cutouts: z.array(cutoutSchema).min(1),
  posts: z.array(postSchema).default([]),
  above: z.strictObject({ footprint: footprintSchema, height: z.number().nonnegative() }),
  below: z.strictObject({ footprint: footprintSchema, depth: z.number().nonnegative() }),
  panelThickness: z.strictObject({ min: length.optional(), max: length.optional() }).optional(),
  // Shafts that a printed knob can go on. `length` is from the underside of the panel, which the
  // part is held against, and `flat` is across a D shaft's flat side, which faces +v before turning.
  shafts: z.array(z.strictObject({ at, diameter: length, flat: length.optional(), length })).default([]),
  // Cross stems that a printed key cap can go on, like a Cherry MX switch's. Heights are above the
  // panel's face: `top` is the stem's tip, `cross` its arms' length and width, and `housing` the top
  // of what it moves in, which a pressed cap has to stay clear of.
  stems: z
    .array(z.strictObject({ at, top: length, cross: z.tuple([length, length]), crossHeight: length.default(3.6), housing: length, travel: length.default(4) }))
    .default([]),
  // How it's used, for checking there's room for fingers, and that a screen can be seen.
  control: z.enum(["press", "turn", "slide", "touch", "screen"]).optional(),
});

// A connector that faces a wall. `side` is which edge of the board, before rotating, and `at`
// is along that edge from its centre. `z` is the hole's centre above the floor. The hole only
// appears with the board within `reach` of that wall, and always follows it.
export const portSchema = z.strictObject({
  side: z.enum(["left", "right", "front", "rear"]),
  at: offset.default(0),
  z: length,
  width: length,
  height: length,
  cornerRadius: z.number().nonnegative().default(0),
  reach: z.number().nonnegative().default(1.5),
});

// A cradle on the plate that holds a rectangular board. Positions are from the board's centre,
// before rotating. Clips go in pairs on its long edges, at `at` along them.
const holderPadSchema = z.strictObject({ at: z.tuple([offset, offset]), width: length, height: length });
export const holderSchema = z.strictObject({
  underside: length, // of the board, above the floor
  thickness: length.default(1.6),
  pads: z.array(holderPadSchema).default([]),
  stops: z.array(holderPadSchema).default([]),
  clips: z.array(z.strictObject({ at: offset, length })).default([]),
});

export const floorPartSchema = z.strictObject({
  ...partBase,
  mount: z.literal("floor"),
  footprint: footprintSchema,
  height: length, // from the top of the floor, including any standoffs
  port: portSchema.optional(),
  holder: holderSchema.optional(),
  // Posts on the plate under a board's mounting holes, with a hole for a screw to cut its own thread.
  standoffs: z.array(z.strictObject({ at, diameter: length, holeDiameter: length, height: length })).optional(),
});

const wallSchema = z.enum(["left", "right", "front", "rear"]);

// A part that goes through a wall, like a jack, held by a nut on the outside. Its first hole is the
// main one, and any others are positioned from it, along the wall as you read it and upwards. `body`
// is what takes up room behind the wall. `outside` is what shows, like a nut or flange.
export const wallPartSchema = z.strictObject({
  ...partBase,
  mount: z.literal("wall"),
  holes: z.array(z.strictObject({ width: length, height: length, cornerRadius: z.number().nonnegative().default(0), at })).min(1),
  body: z.strictObject({ width: length, height: length, depth: length }),
  outside: z.strictObject({ width: length, height: length }),
  maxWall: length.optional(), // how thick a wall its thread can get through
});

export const partSchema = z.discriminatedUnion("mount", [panelPartSchema, floorPartSchema, wallPartSchema]);

const componentBase = {
  id: z.string().min(1),
  type: z.string().min(1),
  rotationDeg: z.union([z.literal(0), z.literal(90), z.literal(180), z.literal(270)]).default(0),
};

// `surface` can be left out when the enclosure only has one.
// A printed knob for each of a part's shafts, this wide and tall. It sits as low on the shaft as the nut allows.
export const knobSchema = z.strictObject({ diameter: length.default(14), height: length.default(16), color: z.string().min(1).optional() });

// A printed key cap for each of a part's stems: a flat top this wide, deep and thick, on a collar
// round the stem.
export const capSchema = z.strictObject({ width: length.default(15), depth: length.default(15), thickness: length.default(2.4), color: z.string().min(1).optional() });

export const componentSchema = z.union([
  z.strictObject({ ...componentBase, surface: z.string().min(1).optional(), u: offset, v: offset, knob: knobSchema.optional(), cap: capSchema.optional() }),
  z.strictObject({ ...componentBase, x: offset, y: offset }),
  z.strictObject({ ...componentBase, wall: wallSchema, at: offset, z: length }),
]);

// A surface runs from the end of the previous one (or the top of the front wall) to
// this y and z. The last one's y sets the enclosure's depth.
export const surfaceSchema = z.strictObject({ id: z.string().min(1), y: offset, z: offset });

// Changes to the screws placed automatically, which keep adapting around them. Removing one
// names where it was, and moving one is removing it and adding another.
const topScrewSpot = z.strictObject({ wall: wallSchema, at: offset });
const plateScrewSpot = z.strictObject({ x: offset, y: offset });

// A surface printed as separate pieces that cap the walls, like the black top of the
// Desk Synth. `splits` divide it along x, for the bed or to stay off the shell's seam, and a tongue
// in each one keeps the faces either side flush, unless `joint` is "flat". A screw's `at` is y on
// the left and right walls and x on the others, and its wall sets the rest.
export const topPanelSchema = z.strictObject({
  surface: z.string().min(1),
  color: z.string().min(1).default("#1b1c1f"),
  splits: z.array(length).default([]),
  joint: z.enum(["tongue", "flat"]).default("tongue"),
  // Where it meets the next surface's top panel at a crease: screwed through a flange under its
  // rear edge into bosses under that panel, or not joined at all.
  crease: z.enum(["none", "screws"]).default("none"),
  fasteners: z.strictObject({ add: z.array(topScrewSpot).default([]), remove: z.array(topScrewSpot).default([]) }).prefault({}),
});

// A rail across the bottom of an opening, fitted last from below. It screws up into
// blocks at each end, like the Desk Synth's front rail.
export const railSchema = z.strictObject({
  depth: length,
  footHeight: length.default(2),
  screwX: z.tuple([length, length]),
  color: z.string().min(1).optional(),
});

// A gap through the front wall and the top, for something that reaches out of the
// enclosure, such as a keybed. It runs from the front back to `yEnd`, above `sill`.
// `keepOut` lists the room the contents need inside, which nothing may enter, and is what
// lets the validator check they fit.
export const openingSchema = z.strictObject({
  xMin: length,
  xMax: length,
  yEnd: length,
  sill: z.number().nonnegative(),
  rail: railSchema.optional(),
  keepOut: z.array(z.strictObject({ xMin: offset, xMax: offset, yMin: offset, yMax: offset, top: length })).default([]),
});

export const seamSchema = z.strictObject({
  x: length,
  ribWidth: length.default(9),
  ribHalfThickness: length.default(5),
});

// Engraved text. It goes with a part, moving when the part does, or at a spot on a surface or wall.
// Capitals, because that's the lettering there is, so lowercase comes out as capitals.
const labelBase = {
  text: z.string().min(1).max(40),
  size: z.number().positive().default(5), // how tall a capital is
  depth: z.number().min(0.2).default(0.6),
  // Inlaid in this colour, as a body of its own filling the engraving, rather than left engraved.
  color: z.string().min(1).optional(),
};
const labelRotation = z.union([z.literal(0), z.literal(90), z.literal(180), z.literal(270)]).default(0);

export const labelSchema = z.union([
  z.strictObject({ ...labelBase, component: z.string().min(1), side: z.enum(["below", "above", "left", "right"]).default("below") }),
  z.strictObject({ ...labelBase, surface: z.string().min(1).optional(), u: offset, v: offset, rotationDeg: labelRotation }),
  z.strictObject({ ...labelBase, wall: wallSchema, at: offset, z: length, rotationDeg: labelRotation }),
]);

export const materialSchema = z.enum(["PETG", "PETG-GF"]);

// What a fit-test print showed fits on this printer, as hole sizes in mm. `insertHoleSideways`
// is for holes that print lying down, which come out differently. `partHoles` adds to the holes
// of a part, by its id. The defaults are what the real Desk Synth used, before any test here.
export const fitSchema = z.strictObject({
  insertHole: z.number().min(3).max(6).default(INSERT_HOLE_DIAMETER),
  insertHoleSideways: z.number().min(3).max(6).default(INSERT_HOLE_DIAMETER),
  screwHole: z.number().min(2.5).max(5).default(SCREW_CLEARANCE_DIAMETER),
  clipGap: z.number().min(0).max(1).default(CLIP_GAP),
  pinSocket: z.number().min(PIN_DIAMETER).max(PIN_DIAMETER + 1).default(PIN_SOCKET_DIAMETER),
  partHoles: z.record(z.string(), z.number().min(-2).max(2)).default({}),
  // Added to a knob's shaft hole, across its diameter and its flat, for a push fit.
  knobHole: z.number().min(-1).max(1).default(0.1),
});

export const configSchema = z.strictObject({
  schemaVersion: z.literal(1),
  name: z.string().min(1),
  enclosure: z.strictObject({
    width: length,
    frontHeight: offset,
    surfaces: z.array(surfaceSchema).min(1),
    wall: length.default(3),
    panelThickness: length.default(3),
    floorThickness: length.default(3),
    cornerRadius: z.number().nonnegative().default(6),
    topEdgeFillet: z.number().nonnegative().default(0),
    // Rounds on the side profile. The wall follows each one, and the plate stops short of a
    // bottom round. Parts can't go on the part of a surface that a round takes.
    rounds: z
      .strictObject({
        frontBottom: z.number().nonnegative().default(0),
        rearTop: z.number().nonnegative().default(0),
        rearBottom: z.number().nonnegative().default(0),
      })
      .prefault({}),
    color: z.string().min(1).default("#cfc7b4"),
  }),
  topPanels: z.array(topPanelSchema).default([]),
  opening: openingSchema.optional(),
  // The engine builds one seam so far, hence the limit.
  seams: z.array(seamSchema).max(1).default([]),
  fabrication: z
    .strictObject({
      material: materialSchema.default("PETG"),
      buildVolume: z
        .strictObject({ x: length, y: length, z: length })
        .default({ x: 256, y: 256, z: 256 }),
      minWall: length.optional(),
      minWeb: length.optional(),
      minSkin: length.optional(),
      fit: fitSchema.prefault({}),
      // Parts to try in the fit test as well, though this design doesn't use them.
      fitTestParts: z.array(z.string().min(1)).default([]),
    })
    .prefault({}),
  // The plate fits inside the walls. Screws are placed around the parts automatically,
  // unless listed here. `seamX` splits it, and is chosen for you if the bed needs it.
  plate: z
    .strictObject({
      enabled: z.boolean().default(true),
      clearance: z.number().nonnegative().default(0.25),
      seamX: length.optional(),
      screwSpacing: length.default(110),
      screws: z.array(plateScrewSpot).optional(),
      fasteners: z.strictObject({ add: z.array(plateScrewSpot).default([]), remove: z.array(plateScrewSpot).default([]) }).prefault({}),
      // For fixing something to the plate from below, and locating it from above.
      countersunkHoles: z.array(z.strictObject({ x: offset, y: offset })).default([]),
      // Bridges to pass a cable tie under, to hold wires and take the strain off them. `rotationDeg`
      // of 0 has the tie running front to back.
      cableTies: z.array(z.strictObject({ x: offset, y: offset, rotationDeg: z.union([z.literal(0), z.literal(90)]).default(0) })).default([]),
      pins: z
        .array(z.strictObject({ x: offset, y: offset, diameter: length, height: length, tipDiameter: length.optional(), tipHeight: length.optional() }))
        .default([]),
      // Where the plate splits, a rib that bolts its pieces together, or just a butt joint.
      joint: z.enum(["flat", "rib"]).default("flat"),
      // Posts that rise to just under the top, to hold up a wide stretch of it.
      supports: z.array(z.strictObject({ x: offset, y: offset, diameter: length.default(8) })).default([]),
      // Walled pockets on the plate, this size inside, to glue weights into so that it doesn't slide.
      weights: z.array(z.strictObject({ x: offset, y: offset, width: length, depth: length, height: length.default(6) })).default([]),
      // Shallow recesses under the plate, to locate stick-on rubber feet of this diameter.
      feet: z.array(z.strictObject({ x: offset, y: offset, diameter: length.default(10) })).default([]),
    })
    .prefault({}),
  // A hole through a wall. `at` is y on the left and right walls and x on the others. `fitChange`
  // adds to its width and height, from what a fit test showed.
  wallHoles: z
    .array(
      z.strictObject({
        wall: wallSchema,
        at: offset,
        z: length,
        width: length,
        height: length,
        cornerRadius: z.number().nonnegative().default(0),
        fitChange: z.number().min(-2).max(2).default(0),
      }),
    )
    .default([]),
  // A row of upright slots through a wall, filling a box of this size, for air.
  vents: z
    .array(
      z.strictObject({
        wall: wallSchema,
        at: offset,
        z: length,
        width: length,
        height: length,
        slotWidth: length.default(2),
        gap: length.default(2),
      }),
    )
    .default([]),
  labels: z.array(labelSchema).default([]),
  // Shift registers on a board of your own, such as the Desk Synth's perfboard, rather than parts of their own.
  // `checks` turns the warnings about wires off: their room and routes are rough guides, not measurements.
  wiring: z.strictObject({ shiftRegisters: count.default(0), checks: z.boolean().default(true) }).prefault({}),
  customParts: z.record(z.string(), partSchema).default({}),
  components: z.array(componentSchema).default([]),
});

export type Footprint = z.infer<typeof footprintSchema>;
export type Cutout = z.infer<typeof cutoutSchema>;
export type Part = z.infer<typeof partSchema>;
export type WireExit = z.infer<typeof wireExitSchema>;
export type PanelPart = z.infer<typeof panelPartSchema>;
export type FloorPart = z.infer<typeof floorPartSchema>;
export type WallPart = z.infer<typeof wallPartSchema>;
export type Component = z.infer<typeof componentSchema>;
export type Config = z.infer<typeof configSchema>;
export type ConfigInput = z.input<typeof configSchema>;
export type Material = z.infer<typeof materialSchema>;
export type Fit = z.infer<typeof fitSchema>;
export type Label = z.infer<typeof labelSchema>;

// For editors, and for an LLM front end whose output has to pass the same schema.
export function configJsonSchema() {
  return z.toJSONSchema(configSchema, { io: "input" });
}
