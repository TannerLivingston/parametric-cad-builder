// What a fit test showed describes the printer rather than the design, so it's kept here too, for
// other designs to use. The config stays the source of truth: applying a profile writes the sizes
// into it, so that a saved file builds the same anywhere.
import { fitSchema, type Fit } from "../schema.js";
import type { RawConfig } from "./configEdit.js";
import { applyFit } from "./fitEdit.js";

const KEY = "enclosure-generator.printer-v1";
const DEFAULTS = fitSchema.parse({});
const DEFAULT_PLATE_CLEARANCE = 0.25;

type FixingKey = "insertHole" | "insertHoleSideways" | "screwHole" | "clipGap" | "pinSocket";
const FIXINGS: FixingKey[] = ["insertHole", "insertHoleSideways", "screwHole", "clipGap", "pinSocket"];
const LABELS: Record<FixingKey | "plateClearance", string> = {
  insertHole: "Insert hole, upright",
  insertHoleSideways: "Insert hole, lying down",
  screwHole: "Screw hole",
  clipGap: "Clip gap",
  pinSocket: "Seam pin socket",
  plateClearance: "Plate clearance",
};

export type PrinterProfile = Pick<Fit, FixingKey | "partHoles"> & { plateClearance: number };

export function profileFromConfig(config: RawConfig): PrinterProfile {
  const fit = fitSchema.parse(config.fabrication?.fit ?? {});
  const { insertHole, insertHoleSideways, screwHole, clipGap, pinSocket, partHoles } = fit;
  return { insertHole, insertHoleSideways, screwHole, clipGap, pinSocket, partHoles, plateClearance: config.plate?.clearance ?? DEFAULT_PLATE_CLEARANCE };
}

// Only the parts this design has, so that it doesn't collect sizes for parts it never uses.
export function applyProfile(config: RawConfig, profile: PrinterProfile): RawConfig {
  let next = config;
  for (const setting of FIXINGS) next = applyFit(next, { setting, parts: [] }, profile[setting]);
  next = applyFit(next, { setting: "plateClearance", parts: [] }, profile.plateClearance);
  const used = new Set<string>((config.components ?? []).map((component: RawConfig) => component.type));
  for (const id of used) next = applyFit(next, { setting: "partHoles", parts: [id] }, profile.partHoles[id] ?? 0);
  return next;
}

// How this design's sizes differ from the profile's, to say so before changing them.
export function profileDifferences(config: RawConfig, profile: PrinterProfile): string[] {
  const here = profileFromConfig(config);
  const differences = [...FIXINGS, "plateClearance" as const].flatMap((setting) => (here[setting] === profile[setting] ? [] : [`${LABELS[setting]}: ${here[setting]} here, ${profile[setting]} on your printer`]));
  const used = new Set<string>((config.components ?? []).map((component: RawConfig) => component.type));
  for (const id of used) {
    const a = here.partHoles[id] ?? 0;
    const b = profile.partHoles[id] ?? 0;
    if (a !== b) differences.push(`Holes for ${id}: ${a} here, ${b} on your printer`);
  }
  return differences;
}

// What a profile changes from the defaults, for showing it.
export function profileSummary(profile: PrinterProfile): string[] {
  const summary = FIXINGS.flatMap((setting) => (profile[setting] === DEFAULTS[setting] ? [] : [`${LABELS[setting]} ${profile[setting]} mm`]));
  if (profile.plateClearance !== DEFAULT_PLATE_CLEARANCE) summary.push(`${LABELS.plateClearance} ${profile.plateClearance} mm`);
  const parts = Object.keys(profile.partHoles).length;
  if (parts) summary.push(`${parts} ${parts === 1 ? "part's holes" : "parts' holes"}`);
  return summary;
}

// New sizes for this design's parts join what's saved, rather than replacing it for other parts.
export function mergeProfile(saved: PrinterProfile | null, next: PrinterProfile): PrinterProfile {
  return { ...next, partHoles: { ...(saved?.partHoles ?? {}), ...next.partHoles } };
}

export function loadProfile(): PrinterProfile | null {
  try {
    const text = localStorage.getItem(KEY);
    if (!text) return null;
    const value = JSON.parse(text);
    const fit = fitSchema.safeParse({ insertHole: value.insertHole, insertHoleSideways: value.insertHoleSideways, screwHole: value.screwHole, clipGap: value.clipGap, pinSocket: value.pinSocket, partHoles: value.partHoles });
    if (!fit.success || typeof value.plateClearance !== "number") return null;
    const { insertHole, insertHoleSideways, screwHole, clipGap, pinSocket, partHoles } = fit.data;
    return { insertHole, insertHoleSideways, screwHole, clipGap, pinSocket, partHoles, plateClearance: value.plateClearance };
  } catch {
    return null;
  }
}

export function saveProfile(profile: PrinterProfile | null) {
  try {
    if (profile) localStorage.setItem(KEY, JSON.stringify(profile));
    else localStorage.removeItem(KEY);
  } catch {
    // Without storage it just won't carry over to the next design.
  }
}
