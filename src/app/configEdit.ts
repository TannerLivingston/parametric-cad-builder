// Edits to the raw config, as the user wrote it. Working on the raw form rather than
// the parsed one keeps defaults out of the file, so the config stays small and diffable.
import { validateConfig } from "../validate.js";
import { library } from "../library.js";
import type { Part } from "../schema.js";
import { buildSurfaces } from "../profile.js";

export type RawConfig = Record<string, any>;
export type RawComponent = Record<string, any>;

// One-line objects for anything short, like the files in examples/, so that moving
// one part changes one line of the diff.
export function formatConfig(config: RawConfig): string {
  const pretty = JSON.stringify(config, null, 2);
  return (
    pretty
      .replace(/\{[^{}[\]]*\}/g, (block) => {
        const line = block.replace(/\s*\n\s*/g, " ");
        return line.length <= 100 ? line : block;
      })
      .replace(/\[\s*(\{[^{}[\]]*\})\s*\]/g, "[$1]") + "\n"
  );
}

export function parseConfig(text: string): { ok: true; config: RawConfig } | { ok: false; message: string } {
  try {
    const value = JSON.parse(text);
    if (typeof value !== "object" || value === null || Array.isArray(value)) {
      return { ok: false, message: "The config must be a JSON object." };
    }
    return { ok: true, config: value };
  } catch (error) {
    return { ok: false, message: (error as Error).message };
  }
}

export const tidy = (value: number) => Math.round(value * 100) / 100;

export function updateComponent(config: RawConfig, id: string, patch: RawComponent): RawConfig {
  const rounded = Object.fromEntries(Object.entries(patch).map(([k, v]) => [k, typeof v === "number" ? tidy(v) : v]));
  return {
    ...config,
    components: (config.components ?? []).map((c: RawComponent) => (c.id === id ? { ...c, ...rounded } : c)),
  };
}

// A printed knob for a part's shafts, changed, or taken off with null.
export function setKnob(config: RawConfig, id: string, patch: RawComponent | null): RawConfig {
  return {
    ...config,
    components: (config.components ?? []).map((c: RawComponent) => {
      if (c.id !== id) return c;
      const { knob, ...rest } = c;
      return patch === null ? rest : { ...rest, knob: { ...knob, ...Object.fromEntries(Object.entries(patch).map(([k, v]) => [k, typeof v === "number" ? tidy(v) : v])) } };
    }),
  };
}

// A printed key cap for a part's stems, changed, or taken off with null.
export function setCap(config: RawConfig, id: string, patch: RawComponent | null): RawConfig {
  return {
    ...config,
    components: (config.components ?? []).map((c: RawComponent) => {
      if (c.id !== id) return c;
      const { cap, ...rest } = c;
      return patch === null ? rest : { ...rest, cap: { ...cap, ...Object.fromEntries(Object.entries(patch).map(([k, v]) => [k, typeof v === "number" ? tidy(v) : v])) } };
    }),
  };
}

export function removeComponent(config: RawConfig, id: string): RawConfig {
  const { labels = [], ...rest } = config;
  const kept = labels.filter((label: RawConfig) => label.component !== id);
  return { ...rest, components: (config.components ?? []).filter((c: RawComponent) => c.id !== id), ...(kept.length ? { labels: kept } : {}) };
}

export function partsOf(config: RawConfig): Record<string, Part> {
  return { ...library, ...(config.customParts ?? {}) };
}

function unusedId(config: RawConfig, type: string): string {
  const taken = new Set((config.components ?? []).map((c: RawComponent) => c.id));
  for (let n = 1; ; n++) {
    const id = `${type}-${n}`;
    if (!taken.has(id)) return id;
  }
}

function errorCount(config: RawConfig): number {
  const result = validateConfig(config);
  return result.ok ? 0 : result.errors.length;
}

// Adds a part at the first spot that causes no new errors, searching from the front
// left. If there's nowhere, it goes in the middle, and the validator explains why.
export function addComponent(config: RawConfig, type: string, surfaceId?: string): { config: RawConfig; id: string } {
  const part = partsOf(config)[type];
  if (!part) throw new Error(`Unknown part type "${type}".`);
  const id = unusedId(config, type);
  const enclosure = config.enclosure ?? {};
  const width = Number(enclosure.width) || 200;
  const baseline = errorCount(config);
  const withComponent = (component: RawComponent) => ({ ...config, components: [...(config.components ?? []), component] });
  const STEP = 4;

  if (part.mount === "floor") {
    const inputs = enclosure.surfaces ?? [];
    const depth = Number(inputs.at?.(-1)?.y) || 100;
    for (let y = STEP; y < depth; y += STEP) {
      for (let x = STEP; x < width; x += STEP) {
        const candidate = withComponent({ id, type, x, y });
        if (errorCount(candidate) <= baseline) return { config: candidate, id };
      }
    }
    return { config: withComponent({ id, type, x: tidy(width / 2), y: tidy(depth / 2) }), id };
  }

  if (part.mount === "wall") {
    const inputs = enclosure.surfaces ?? [];
    const depth = Number(inputs.at?.(-1)?.y) || 100;
    const low = (Number(enclosure.floorThickness) || 3) + part.body.height / 2 + 1;
    // The rear first, which is where connectors usually go.
    for (const [wall, length] of [["rear", width], ["left", depth], ["right", depth], ["front", width]] as const) {
      for (let at = STEP; at < length; at += STEP) {
        for (let z = low; z < low + 40; z += STEP) {
          const candidate = withComponent({ id, type, wall, at, z: tidy(z) });
          if (errorCount(candidate) <= baseline) return { config: candidate, id };
        }
      }
    }
    return { config: withComponent({ id, type, wall: "rear", at: tidy(width / 2), z: tidy(low) }), id };
  }

  const surfaces = buildSurfaces(Number(enclosure.frontHeight) || 0, enclosure.surfaces ?? []);
  const ordered = [...surfaces].sort((a, b) => (a.id === surfaceId ? -1 : b.id === surfaceId ? 1 : a.index - b.index));
  for (const surface of ordered) {
    for (let v = STEP; v < surface.length; v += STEP) {
      for (let u = STEP; u < width; u += STEP) {
        const candidate = withComponent({ id, type, surface: surface.id, u, v });
        if (errorCount(candidate) <= baseline) return { config: candidate, id };
      }
    }
  }
  const fallback = surfaces[0];
  return { config: withComponent({ id, type, surface: surfaceId ?? fallback?.id, u: tidy(width / 2), v: tidy((fallback?.length ?? 40) / 2) }), id };
}
