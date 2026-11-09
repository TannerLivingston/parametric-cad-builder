// Edits to labels in the raw config. These only write text and spots, so the validator still says
// whether it fits.
import { tidy, type RawConfig } from "./configEdit.js";

export type LabelSide = "below" | "above" | "left" | "right";

const labelsOf = (config: RawConfig): RawConfig[] => config.labels ?? [];

function withLabels(config: RawConfig, labels: RawConfig[]): RawConfig {
  const { labels: _, ...rest } = config;
  return labels.length ? { ...rest, labels } : rest;
}

const rounded = (patch: RawConfig) => Object.fromEntries(Object.entries(patch).map(([key, value]) => [key, typeof value === "number" ? tidy(value) : value]));

export function labelOfComponent(config: RawConfig, id: string): RawConfig | undefined {
  return labelsOf(config).find((label) => label.component === id);
}

// A part has one label here, and no text means none.
export function setComponentLabel(config: RawConfig, id: string, patch: { text?: string; side?: LabelSide }): RawConfig {
  const labels = labelsOf(config);
  const known = labelOfComponent(config, id);
  const text = patch.text ?? known?.text ?? "";
  if (text.trim() === "") return withLabels(config, labels.filter((label) => label !== known));
  // Connectors usually sit low on a wall, so the room for a label is above them.
  const low = !known && (config.components ?? []).some((component: RawConfig) => component.id === id && !("u" in component));
  const side = patch.side ?? (low ? "above" : undefined);
  const next = { ...known, text, component: id, ...(side && { side }) };
  return withLabels(config, known ? labels.map((label) => (label === known ? next : label)) : [...labels, next]);
}

export function addSurfaceLabel(config: RawConfig): RawConfig {
  const { enclosure: e } = config;
  const surface = e.surfaces[0];
  const label = { text: "LABEL", surface: surface.id, u: tidy(e.width / 2), v: tidy(surface.y / 2) };
  return withLabels(config, [...labelsOf(config), label]);
}

export function addWallLabel(config: RawConfig): RawConfig {
  const { enclosure: e } = config;
  const label = { text: "LABEL", wall: "rear", at: tidy(e.width / 2), z: tidy((e.floorThickness ?? 3) + 10) };
  return withLabels(config, [...labelsOf(config), label]);
}

export function updateLabel(config: RawConfig, index: number, patch: RawConfig): RawConfig {
  return withLabels(config, labelsOf(config).map((label, i) => (i === index ? { ...label, ...rounded(patch) } : label)));
}

export function removeLabel(config: RawConfig, index: number): RawConfig {
  return withLabels(config, labelsOf(config).filter((_, i) => i !== index));
}
