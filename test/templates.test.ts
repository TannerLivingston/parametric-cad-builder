// Every place to start has to be a design that works, on the printer it's for, as it stands.
import { beforeAll, describe, expect, it } from "vitest";
import { analyseBinarySTL, isValidSolid } from "../src/checks.js";
import { buildEnclosure, initEngine, planPrint, validateConfig, type BuildPlan } from "../src/index.js";
import { TEMPLATES } from "../src/app/templates.js";

describe.each(TEMPLATES.map((t) => [t.name, t] as const))("the %s template", (_, template) => {
  const built = (): BuildPlan => {
    const result = validateConfig(template.make());
    if (!result.ok) throw new Error(JSON.stringify(result.errors, null, 1));
    return result.plan;
  };

  it("is valid", () => expect(validateConfig(template.make()).ok).toBe(true));

  it("has nothing to warn about, except parts that aren't measured", () => {
    const { warnings } = validateConfig(template.make());
    expect(warnings.filter((w) => w.code !== "UNVERIFIED_PART").map((w) => w.message)).toEqual([]);
  });

  it("makes a new object each time, so that changing one leaves the next alone", () => {
    const first = template.make();
    first.enclosure.width = 1;
    expect(template.make().enclosure.width).not.toBe(1);
  });

  it("describes itself", () => {
    expect(template.description.length).toBeGreaterThan(0);
    expect(template.description).not.toMatch(/\.$/);
  });

  describe("once built", () => {
    beforeAll(() => initEngine(), 60_000);

    it("makes closed parts that fit the bed", async () => {
      const plan = built();
      const { parts } = buildEnclosure(plan);
      for (const part of parts) {
        expect(isValidSolid(part.shape), part.name).toBe(true);
        const stl = analyseBinarySTL(new Uint8Array(await part.shape.blobSTL({ binary: true, tolerance: 0.1, angularTolerance: 0.3 }).arrayBuffer()));
        expect(stl.watertight, part.name).toBe(true);
      }
      for (const report of planPrint(plan, parts.map((part) => part.shape.mesh({ tolerance: 0.1, angularTolerance: 0.3 })))) {
        expect(report.problems, report.name).toEqual([]);
        expect(report.best.fits, report.name).toBe(true);
      }
    }, 60_000);
  });
});
