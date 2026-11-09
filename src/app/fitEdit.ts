// Puts what a fit test showed into the raw config, leaving out anything that's the default.
import { fitSchema } from "../schema.js";
import type { FitRow } from "../fitTest.js";
import { tidy, type RawConfig } from "./configEdit.js";

const DEFAULTS = fitSchema.parse({});
const DEFAULT_PLATE_CLEARANCE = 0.25;

function withoutEmpty(owner: RawConfig, key: string, value: RawConfig): RawConfig {
  const { [key]: _, ...rest } = owner;
  return Object.keys(value).length ? { ...rest, [key]: value } : rest;
}

function withFit(config: RawConfig, fit: RawConfig): RawConfig {
  const fabrication = withoutEmpty(config.fabrication ?? {}, "fit", fit);
  return withoutEmpty(config, "fabrication", fabrication);
}

export function applyFit(config: RawConfig, row: Pick<FitRow, "setting" | "parts">, value: number): RawConfig {
  const rounded = tidy(value);
  if (row.setting === "plateClearance") {
    const { clearance: _, ...plate } = config.plate ?? {};
    return withoutEmpty(config, "plate", rounded === DEFAULT_PLATE_CLEARANCE ? plate : { ...plate, clearance: rounded });
  }
  if (row.setting === "wallHole") {
    const wallHoles = (config.wallHoles ?? []).map((hole: RawConfig, i: number) => {
      if (!row.parts.includes(String(i))) return hole;
      const { fitChange: _, ...rest } = hole;
      return rounded === 0 ? rest : { ...rest, fitChange: rounded };
    });
    return { ...config, wallHoles };
  }
  const fit: RawConfig = { ...(config.fabrication?.fit ?? {}) };
  if (row.setting === "partHoles") {
    const partHoles: RawConfig = { ...(fit.partHoles ?? {}) };
    for (const id of row.parts) {
      if (rounded === 0) delete partHoles[id];
      else partHoles[id] = rounded;
    }
    return withFit(config, withoutEmpty(fit, "partHoles", partHoles));
  }
  if (rounded === DEFAULTS[row.setting]) delete fit[row.setting];
  else fit[row.setting] = rounded;
  return withFit(config, fit);
}

// Parts to try in the fit test, though the design doesn't use them.
export function setFitTestParts(config: RawConfig, ids: string[]): RawConfig {
  const { fitTestParts: _, ...fabrication } = config.fabrication ?? {};
  return withoutEmpty(config, "fabrication", ids.length ? { ...fabrication, fitTestParts: ids } : fabrication);
}
