// Undo that survives a reload, and versions kept by name, both only in this browser. They're whole
// copies of the config, because that's what the app already treats as the design.
import { parseConfig, type RawComponent, type RawConfig } from "./configEdit.js";

const HISTORY_KEY = "enclosure-generator.history-v1";
const VERSIONS_KEY = "enclosure-generator.versions-v1";
const HISTORY_ROOM = 1_500_000; // of the 5 MB a browser usually gives a site

export interface DesignHistory {
  past: string[];
  future: string[];
}

export interface DesignVersion {
  name: string;
  savedAt: string;
  text: string;
}

const isText = (value: unknown): value is string => typeof value === "string";

// Only for the draft it was saved with, or undo would jump to another design altogether.
export function loadHistory(current: string): DesignHistory {
  try {
    const saved = JSON.parse(localStorage.getItem(HISTORY_KEY) ?? "null");
    if (saved?.current !== current || !Array.isArray(saved.past) || !Array.isArray(saved.future)) return { past: [], future: [] };
    return { past: saved.past.filter(isText), future: saved.future.filter(isText) };
  } catch {
    return { past: [], future: [] };
  }
}

// The oldest steps go first when it gets too big to keep.
export function trimmedHistory({ past, future }: DesignHistory, room = HISTORY_ROOM): DesignHistory {
  let used = [...past, ...future].reduce((sum, text) => sum + text.length, 0);
  const kept = [...past];
  while (used > room && kept.length) used -= kept.shift()!.length;
  return { past: kept, future };
}

export function saveHistory(history: DesignHistory, current: string) {
  try {
    localStorage.setItem(HISTORY_KEY, JSON.stringify({ current, ...trimmedHistory(history) }));
  } catch {
    // Without room or storage, undo just won't survive a reload.
  }
}

export function loadVersions(): DesignVersion[] {
  try {
    const saved = JSON.parse(localStorage.getItem(VERSIONS_KEY) ?? "[]");
    if (!Array.isArray(saved)) return [];
    return saved.filter((version) => isText(version?.name) && isText(version?.savedAt) && isText(version?.text));
  } catch {
    return [];
  }
}

// Says whether it worked, because unlike undo, losing one of these would matter.
export function saveVersions(versions: DesignVersion[]): boolean {
  try {
    localStorage.setItem(VERSIONS_KEY, JSON.stringify(versions));
    return true;
  } catch {
    return false;
  }
}

// Newest first. A name in use is replaced, as saving over it would.
export function addVersion(versions: DesignVersion[], name: string, text: string, now: Date): DesignVersion[] {
  const clean = name.trim() || now.toLocaleString();
  return [{ name: clean, savedAt: now.toISOString(), text }, ...versions.filter((version) => version.name !== clean)];
}

const count = (n: number, one: string) => `${n} ${one}${n === 1 ? "" : "s"}`;

// How one design differs from another, in a few words.
export function describeChange(from: string, to: string): string {
  if (from === to) return "The same as now";
  const a = parseConfig(from);
  const b = parseConfig(to);
  if (!a.ok || !b.ok) return "Different";
  const list = (config: RawConfig): RawComponent[] => (Array.isArray(config.components) ? config.components : []);
  const before = new Map(list(a.config).map((component) => [component.id, JSON.stringify(component)]));
  const after = new Map(list(b.config).map((component) => [component.id, JSON.stringify(component)]));
  const added = [...after.keys()].filter((id) => !before.has(id)).length;
  const removed = [...before.keys()].filter((id) => !after.has(id)).length;
  const moved = [...after.entries()].filter(([id, text]) => before.has(id) && before.get(id) !== text).length;
  const rest = (config: RawConfig) => {
    const { components: _, ...others } = config;
    return JSON.stringify(others);
  };
  const changes = [
    ...(added ? [`${count(added, "part")} more`] : []),
    ...(removed ? [`${count(removed, "part")} fewer`] : []),
    ...(moved ? [`${count(moved, "part")} moved or changed`] : []),
    ...(rest(a.config) !== rest(b.config) ? ["other changes"] : []),
  ];
  return changes.length ? changes.join(", ") : "Different in layout only";
}
