// Links with the design in them, after the #.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { designFromHash, designHash } from "../src/app/shareLink.js";

const deskSynth = readFileSync("examples/desk-synth-v2.json", "utf8");

describe("a design's link", () => {
  it("brings back the same design", async () => {
    const hash = await designHash(deskSynth);
    expect(JSON.parse((await designFromHash(`#${hash}`))!)).toEqual(JSON.parse(deskSynth));
  });

  it("is short enough to paste, and safe in a URL", async () => {
    const hash = await designHash(deskSynth);
    expect(hash).toMatch(/^design=[A-Za-z0-9_-]+$/);
    // The V2 is about 5 kB of JSON.
    expect(hash.length).toBeLessThan(deskSynth.length / 2);
  });

  it("is nothing without a design, or with a damaged one", async () => {
    expect(await designFromHash("")).toBeNull();
    expect(await designFromHash("#section")).toBeNull();
    const hash = await designHash(deskSynth);
    expect(await designFromHash(`#${hash.slice(0, -20)}`)).toBeNull();
    expect(await designFromHash("#design=!!!")).toBeNull();
  });
});
