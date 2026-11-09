// Works out how little needs rebuilding between two plans. Cutouts only affect the
// printed part that holds them, so moving a part usually re-cuts one piece.
import type { BuildPlan } from "../validate.js";

export interface PlanKeys {
  shell: string;
  parts: string[];
}

export function planKeys(plan: BuildPlan): PlanKeys {
  const { enclosure, topPanels, opening, plate: plateConfig, fabrication } = plan.config;
  return {
    // Everything that shapes a blank. Moving a part can change screws, holes and cradles.
    shell: JSON.stringify([enclosure, topPanels, opening, plateConfig, fabrication.fit, plan.seams, plan.plate, plan.topPieces, plan.topScrews, plan.wallHoles, plan.holderBlocks]),
    parts: plan.printedParts.map((part) => JSON.stringify([plan.cutouts.filter((c) => c.printedPart === part.index), plan.posts.filter((p) => p.printedPart === part.index), plan.labels.filter((label) => label.printedPart === part.index)])),
  };
}

// Indexes of the parts to re-cut, or null if the shell changed and all must be rebuilt.
export function partsToRecut(previous: PlanKeys | null, next: PlanKeys): number[] | null {
  if (!previous || previous.shell !== next.shell || previous.parts.length !== next.parts.length) return null;
  return next.parts.flatMap((key, index) => (key === previous.parts[index] ? [] : [index]));
}
