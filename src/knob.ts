// Printed knobs, one on each of a part's shafts. A knob stands clear of the washer and nut on the
// panel, takes the shaft in a D hole from below, and prints top down so the hole opens upwards.

export const KNOB_LIFT = 3; // its underside above the panel's face, clear of a washer and nut
export const KNOB_ROOF = 1.6; // above the end of its hole
export const KNOB_WALL = 1.6; // round the shaft, at least
export const KNOB_MIN_GRIP = 6; // of shaft inside it, at least
export const KNOB_SHAFT_ROOM = 0.5; // past the end of the shaft, so it doesn't bottom out
export const KNOB_GRIP_COUNT = 18; // flutes round it
export const KNOB_POINTER = { width: 1.2, depth: 0.6 }; // a groove across its top, over the shaft's flat
export const DEFAULT_KNOB_COLOR = "#1b1c1f";

export interface PlannedKnob {
  componentId: string;
  name: string;
  printedPart: number;
  surface: string;
  u: number; // the shaft's centre
  v: number;
  toward: [number, number]; // which way, along the surface, the shaft's flat faces
  diameter: number;
  underside: number; // above the panel's face
  height: number; // its own
  hole: { diameter: number; flat: number | null; depth: number }; // as cut, with the fit added
  color: string;
}

// Where a knob sits on its shaft, or why it can't. It goes as low as the nut allows, unless the
// shaft is longer than the knob can take, when it rides up it. The shaft reaches `length - thickness`
// above the face, since its length is from the panel's underside.
export function knobFit(knob: { diameter: number; height: number }, shaft: { diameter: number; length: number }, thickness: number): { underside: number; depth: number } | string {
  const above = shaft.length - thickness;
  if (knob.diameter < shaft.diameter + 2 * KNOB_WALL) return `is ${knob.diameter} mm across, and needs at least ${shaft.diameter + 2 * KNOB_WALL} mm round its ${shaft.diameter} mm shaft`;
  if (above - KNOB_LIFT < KNOB_MIN_GRIP) return `would only have ${round(above - KNOB_LIFT)} mm of shaft in it, since the shaft reaches ${round(above)} mm above a ${thickness} mm panel, and needs ${KNOB_MIN_GRIP} mm`;
  const underside = Math.max(KNOB_LIFT, above + KNOB_SHAFT_ROOM + KNOB_ROOF - knob.height);
  const grip = above - underside;
  if (grip < KNOB_MIN_GRIP) return `is too short to take ${KNOB_MIN_GRIP} mm of its shaft. Make it at least ${round(KNOB_MIN_GRIP + KNOB_SHAFT_ROOM + KNOB_ROOF)} mm tall`;
  return { underside, depth: grip + KNOB_SHAFT_ROOM };
}

const round = (value: number) => Math.round(value * 10) / 10;
