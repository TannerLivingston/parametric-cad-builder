// What every build has to be, whatever it is: valid, closed, as planned, and clear of its other parts.
import { measureVolume, type Shape3D } from "replicad";
import { findSurface } from "../src/profile.js";
import { analyseBinarySTL, isValidSolid } from "../src/checks.js";
import { TOP_POST_LENGTH } from "../src/top.js";
import { buildEnclosure, cutoutUp, cutoutVolume, validateConfig, type BuildPlan, type Enclosure } from "../src/index.js";

export const stlBytes = async (shape: Shape3D, tolerance = 0.1) =>
  new Uint8Array(await shape.blobSTL({ binary: true, tolerance, angularTolerance: 0.3 }).arrayBuffer());

export function overlap(a: Shape3D, b: Shape3D): number {
  try {
    return measureVolume(a.intersect(b));
  } catch (error) {
    // An empty intersection has nothing to measure. Anything else is a real failure.
    if (String(error).includes("deleted")) throw error;
    return 0;
  }
}

export function plan(input: unknown): BuildPlan {
  const result = validateConfig(input);
  if (!result.ok) throw new Error(JSON.stringify(result.errors, null, 2));
  return result.plan;
}

export async function buildProblems(buildPlan: BuildPlan, enclosure: Enclosure = buildEnclosure(buildPlan)) {
  const problems: string[] = [];
  const thickness = buildPlan.config.enclosure.panelThickness;
  const { x, y, z } = buildPlan.config.fabrication.buildVolume;
  for (const part of enclosure.parts) {
    const label = `part ${part.index}`;
    if (!isValidSolid(part.shape)) problems.push(`${label}: invalid solid`);
    const mesh = analyseBinarySTL(await stlBytes(part.shape));
    if (!mesh.watertight) problems.push(`${label}: mesh not watertight`);
    const expected = buildPlan.cutouts.filter((c) => c.printedPart === part.index).reduce((sum, c) => sum + cutoutVolume(c, findSurface(buildPlan.profile, c.surface)!.thickness, cutoutUp(buildPlan, c)), 0);
    const removed = measureVolume(part.blank) - measureVolume(part.cut);
    // Lettering comes out with the holes: somewhere between nothing and its whole box for each label.
    const lettering = buildPlan.labels.filter((l) => l.printedPart === part.index).reduce((sum, l) => sum + l.across * l.up * l.depth, 0);
    const low = expected * 0.99;
    const high = (expected + lettering) * 1.01;
    if (expected > 0 && (removed < low || removed > high)) {
      problems.push(`${label}: removed ${removed.toFixed(1)} mm3, expected ${expected.toFixed(1)}${lettering ? ` and up to ${lettering.toFixed(1)} of lettering` : ""}`);
    }
    const [sx, sy, sz] = mesh.size;
    const fits = (sx <= x + 0.01 && sy <= y + 0.01) || (sx <= y + 0.01 && sy <= x + 0.01);
    if (!fits || sz > z + 0.01) problems.push(`${label}: doesn't fit the build volume`);
    // Everything but the two shell halves, which meet on purpose with pins, has to clear.
    for (const other of enclosure.parts.slice(0, part.index)) {
      if (other.kind === "shell" && part.kind === "shell") continue;
      const hit = overlap(other.shape, part.shape);
      if (hit > 0.01) {
        const { bounds } = other.shape.intersect(part.shape).boundingBox;
        problems.push(`${label}: collides with ${other.name} by ${hit.toFixed(2)} mm3 at ${bounds.flat().map((v: number) => v.toFixed(1))}`);
      }
    }
    const planned = buildPlan.printedParts[part.index]!.size;
    // A top edge fillet can round off the highest point, so height may come in lower.
    // So can a top panel, which takes the highest point off the shell it caps.
    const heightAllowance = part.kind === "shell" ? buildPlan.config.enclosure.topEdgeFillet + (buildPlan.topPieces.length ? planned[2] : 0) : 0;
    // A top piece's plan is how it lies flat for printing, and posts stick out below that.
    const sizeMatches = part.kind === "top"
      ? Math.abs(sx - planned[0]) <= 0.05 && sy <= planned[1] + 1 && sz <= planned[2] + TOP_POST_LENGTH + 0.05
      : Math.abs(sx - planned[0]) <= 0.05 && Math.abs(sy - planned[1]) <= 0.05 && sz <= planned[2] + 0.05 && sz >= planned[2] - heightAllowance - 0.05;
    if (!sizeMatches) problems.push(`${label}: size ${mesh.size} differs from planned ${planned} (${part.kind})`);
  }
  return problems;
}
