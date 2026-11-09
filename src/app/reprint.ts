// Which parts differ from what's been printed. Filament and hours go on whole parts, so a small move
// shouldn't cost a whole set.
import type { PartPrintReport } from "../printing.js";

const KEY = "enclosure-generator.printed-v1";

// By design name, then part name, each with its shape's fingerprint.
export type PrintedRecord = Record<string, Record<string, string>>;

export type ReprintStatus = "same" | "changed";

export function reprintStatus(printed: Record<string, string> | undefined, reports: Pick<PartPrintReport, "name" | "fingerprint">[]): { name: string; status: ReprintStatus }[] {
  if (!printed) return [];
  return reports.map(({ name, fingerprint }) => ({ name, status: printed[name] === fingerprint ? "same" : "changed" }));
}

export function markPrinted(record: PrintedRecord, design: string, reports: Pick<PartPrintReport, "name" | "fingerprint">[]): PrintedRecord {
  return { ...record, [design]: Object.fromEntries(reports.map(({ name, fingerprint }) => [name, fingerprint])) };
}

export function loadPrinted(): PrintedRecord {
  try {
    const value = JSON.parse(localStorage.getItem(KEY) ?? "{}");
    return value && typeof value === "object" && !Array.isArray(value) ? value : {};
  } catch {
    return {};
  }
}

export function savePrinted(record: PrintedRecord) {
  try {
    localStorage.setItem(KEY, JSON.stringify(record));
  } catch {
    // Without storage it just won't be remembered.
  }
}
