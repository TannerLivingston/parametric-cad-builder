// Undo has to come back after a reload, for the design it belongs to, and never at the cost of the
// design itself when storage runs out.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { addVersion, describeChange, loadHistory, loadVersions, saveHistory, saveVersions, trimmedHistory } from "../src/app/designHistory.js";

const config = (components: unknown[], more: Record<string, unknown> = {}) => JSON.stringify({ name: "a", components, ...more });
const button = (u: number, id = "b") => ({ id, type: "arcade-24mm", u, v: 10 });

let store: Record<string, string>;
beforeEach(() => {
  store = {};
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => store[key] ?? null,
    setItem: (key: string, value: string) => {
      store[key] = value;
    },
    removeItem: (key: string) => delete store[key],
  });
});

describe("undo history", () => {
  it("comes back with the draft it was saved with", () => {
    saveHistory({ past: ["one", "two"], future: ["four"] }, "three");
    expect(loadHistory("three")).toEqual({ past: ["one", "two"], future: ["four"] });
  });

  it("starts fresh for any other draft", () => {
    saveHistory({ past: ["one"], future: [] }, "two");
    expect(loadHistory("changed elsewhere")).toEqual({ past: [], future: [] });
  });

  it("starts fresh if there's nothing, or nothing it can read", () => {
    expect(loadHistory("x")).toEqual({ past: [], future: [] });
    store["enclosure-generator.history-v1"] = "not json";
    expect(loadHistory("x")).toEqual({ past: [], future: [] });
    store["enclosure-generator.history-v1"] = JSON.stringify({ current: "x", past: "nope", future: [] });
    expect(loadHistory("x")).toEqual({ past: [], future: [] });
    store["enclosure-generator.history-v1"] = JSON.stringify({ current: "x", past: ["fine", 3], future: [] });
    expect(loadHistory("x").past).toEqual(["fine"]);
  });

  it("drops the oldest steps when it gets too big, and never redo", () => {
    expect(trimmedHistory({ past: ["aaaa", "bbbb", "cccc"], future: ["dd"] }, 10)).toEqual({ past: ["bbbb", "cccc"], future: ["dd"] });
    expect(trimmedHistory({ past: ["aaaa"], future: ["dddddddddddd"] }, 10)).toEqual({ past: [], future: ["dddddddddddd"] });
  });

  it("doesn't mind storage failing", () => {
    vi.stubGlobal("localStorage", {
      getItem: () => {
        throw new Error("blocked");
      },
      setItem: () => {
        throw new Error("full");
      },
    });
    expect(() => saveHistory({ past: ["a"], future: [] }, "b")).not.toThrow();
    expect(loadHistory("b")).toEqual({ past: [], future: [] });
    expect(loadVersions()).toEqual([]);
    expect(saveVersions([])).toBe(false);
  });
});

describe("versions", () => {
  const now = new Date("2026-11-03T10:00:00Z");

  it("keeps the newest first, and comes back as it went in", () => {
    const versions = addVersion(addVersion([], "first", "one", now), "second", "two", new Date("2026-11-04T10:00:00Z"));
    expect(versions.map((v) => v.name)).toEqual(["second", "first"]);
    expect(saveVersions(versions)).toBe(true);
    expect(loadVersions()).toEqual(versions);
  });

  it("replaces one of the same name", () => {
    const versions = addVersion(addVersion([], "first", "one", now), "first", "two", now);
    expect(versions).toHaveLength(1);
    expect(versions[0]!.text).toBe("two");
  });

  it("names itself after the time if it isn't named", () => {
    expect(addVersion([], "  ", "one", now)[0]!.name).toBe(now.toLocaleString());
  });

  it("ignores what it can't read", () => {
    store["enclosure-generator.versions-v1"] = "not json";
    expect(loadVersions()).toEqual([]);
    store["enclosure-generator.versions-v1"] = JSON.stringify([{ name: "fine", savedAt: "x", text: "y" }, { name: "no text" }]);
    expect(loadVersions().map((v) => v.name)).toEqual(["fine"]);
    store["enclosure-generator.versions-v1"] = JSON.stringify({ not: "a list" });
    expect(loadVersions()).toEqual([]);
  });
});

describe("saying how two designs differ", () => {
  it("counts parts, by what happened to them", () => {
    const from = config([button(10), button(20, "c")]);
    expect(describeChange(from, from)).toBe("The same as now");
    expect(describeChange(from, config([button(10), button(20, "c"), button(30, "d")]))).toBe("1 part more");
    expect(describeChange(from, config([]))).toBe("2 parts fewer");
    expect(describeChange(from, config([button(11), button(21, "c")]))).toBe("2 parts moved or changed");
  });

  it("says when something else changed", () => {
    expect(describeChange(config([]), config([], { name: "b" }))).toBe("other changes");
    expect(describeChange(config([button(10)]), config([button(11)], { name: "b" }))).toBe("1 part moved or changed, other changes");
  });

  it("tells formatting alone from a change", () => {
    expect(describeChange(config([]), config([]) + " ")).toBe("Different in layout only");
  });

  it("doesn't mind a design that doesn't parse", () => {
    expect(describeChange("{", config([]))).toBe("Different");
  });
});
