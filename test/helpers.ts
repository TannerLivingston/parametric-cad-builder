import { readFileSync } from "node:fs";
import { validateConfig, type Issue, type IssueCode } from "../src/index.js";

export function deskSynth(): any {
  const url = new URL("../examples/desk-synth.json", import.meta.url);
  return JSON.parse(readFileSync(url, "utf8"));
}

// An enclosure whose whole top is one tilted surface, called "panel".
export function wedge({ depth, rearHeight, tiltDeg, ...rest }: { depth: number; rearHeight: number; tiltDeg: number; [key: string]: unknown }) {
  const frontHeight = rearHeight - depth * Math.tan((tiltDeg * Math.PI) / 180);
  return { frontHeight, surfaces: [{ id: "panel", y: depth, z: rearHeight }], ...rest };
}

// A valid two-part enclosure with nothing placed in it yet.
export function blank(overrides: Record<string, unknown> = {}): any {
  return {
    schemaVersion: 1,
    name: "test",
    enclosure: wedge({ width: 304.8, depth: 190.5, rearHeight: 58, tiltDeg: 6 }),
    seams: [{ x: 152.4 }],
    components: [],
    ...overrides,
  };
}

// A flat deck, a steep panel, and a back that falls away, like the real Desk Synth.
export function deckAndPanel(overrides: Record<string, unknown> = {}): any {
  return blank({
    enclosure: {
      width: 300,
      frontHeight: 40,
      surfaces: [
        { id: "deck", y: 80, z: 40 },
        { id: "panel", y: 125, z: 66 },
        { id: "back", y: 190, z: 55 },
      ],
    },
    seams: [{ x: 150 }],
    ...overrides,
  });
}

export const button = (id: string, u: number, v: number) => ({ id, type: "arcade-24mm", u, v });

export function errors(input: unknown): Issue[] {
  const result = validateConfig(input);
  return result.ok ? [] : result.errors;
}

export function errorCodes(input: unknown): IssueCode[] {
  return [...new Set(errors(input).map((e) => e.code))];
}
