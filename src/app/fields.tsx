import { useEffect, useRef, useState } from "react";

// A short note on what a field changes, shown when the pointer rests on it, for those whose name
// alone doesn't say. Keyed by the field's label, so every field of that name gets it.
export const FIELD_NOTES: Record<string, string> = {
  "Across (u)": "How far from the left end of its surface, across the width, to its centre, in mm.",
  "Back (v)": "How far from the front edge of its surface, along the surface's slope, to its centre, in mm.",
  "Across (x)": "How far from the left wall's outside, across the width, to its centre, in mm.",
  "Back (y)": "How far from the front wall's outside, towards the rear, to its centre, in mm.",
  "Along the wall": "How far along the wall to its centre, in mm: from the left on the front and rear walls, from the front on the side walls.",
  "Centre height": "How far up from the bottom of the enclosure to its centre, in mm.",
  "Centre x": "How far from the left, across the wall, to its centre, in mm.",
  "Centre y": "How far from the front, along the side wall, to its centre, in mm.",
  Curve: "How far the surface's arc rises above the straight line between its ends, in mm. 0 is flat; less than 0 dips.",
  "Front wall bow": "How far the front wall bows out at its middle, seen from above, in mm. 0 is straight.",
  "Rear wall bow": "How far the rear wall bows out at its middle, seen from above, in mm. 0 is straight.",
  "Lip past it": "How far the left piece's outer skin reaches over the seam, onto a step in the right piece, in mm. 0 is a flat joint.",
  "Split at x": "Where the shell is split into pieces that each fit the printer's bed, from the left, in mm.",
  "Split the plate at x": "Where the base plate is split, from the left, in mm. Several are separated by commas. Empty chooses for you.",
  Depth: "How far back from the front the surface ends, in mm. The last one's is the enclosure's depth.",
  Height: "How high the surface's far end is, from the bottom of the enclosure, in mm.",
  "Front height": "How high the front edge of the enclosure is, in mm.",
  Thickness: "This surface's own thickness, for its top panel or the skin under it, in mm. Empty uses the enclosure's.",
  Wall: "The thickness of the side, front and rear walls, in mm.",
  Top: "The thickness of the top surfaces, in mm, unless a surface has its own.",
  Floor: "The thickness of the base plate, in mm.",
  "Corner radius": "How round the corners are, in mm. 0 is square.",
  "Sill height": "How high the front wall stays below the opening, in mm.",
  "Slot width": "How wide each slot of the vent is, in mm.",
  "Gap between slots": "How much wall is left between the vent's slots, in mm.",
  "Front bottom round": "The radius of the round along the front's bottom edge, seen from the side, in mm. 0 is square.",
  "Rear top round": "The radius of the round along the rear's top edge, seen from the side, in mm. 0 is square.",
  "Rear bottom round": "The radius of the round along the rear's bottom edge, seen from the side, in mm. 0 is square.",
  "Up to height": "How high the room kept clear reaches, from the bottom, in mm.",
};

// Keeps what you're typing until you leave the field or press Enter, so a half-typed
// number doesn't jump the part around.
// `field` is the one number's path in the config, such as enclosure.cornerRadius, for lighting up
// just its part of the shape while the field has the cursor.
export function NumberField({ label, value, onCommit, step = 0.5, field }: { label: string; value: number; onCommit(value: string): void; step?: number; field?: string }) {
  const [draft, setDraft] = useState<string | null>(null);
  const note = FIELD_NOTES[label];
  return (
    <label title={note} className={note ? "noted" : undefined} data-field={field}>
      {label}
      <input
        type="number"
        step={step}
        value={draft ?? value}
        onFocus={() => setDraft(String(value))}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={() => {
          if (draft !== null) onCommit(draft);
          setDraft(null);
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter" && draft !== null) onCommit(draft);
        }}
      />
    </label>
  );
}

// The same for text, where every keystroke would otherwise rebuild.
export function TextField({ label, value, onCommit, placeholder }: { label: string; value: string; onCommit(value: string): void; placeholder?: string }) {
  const [draft, setDraft] = useState<string | null>(null);
  const note = FIELD_NOTES[label];
  return (
    <label title={note} className={note ? "noted" : undefined}>
      {label}
      <input
        type="text"
        spellCheck={false}
        placeholder={placeholder}
        value={draft ?? value}
        onFocus={() => setDraft(value)}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={() => {
          if (draft !== null && draft !== value) onCommit(draft);
          setDraft(null);
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter" && draft !== null && draft !== value) onCommit(draft);
        }}
      />
    </label>
  );
}

// React's onChange fires for every step of a colour picker's drag, and each would rebuild
// the whole shell. The native change event only fires once the choice is made.
export function ColorField({ label, value, onCommit }: { label: string; value: string; onCommit(value: string): void }) {
  const ref = useRef<HTMLInputElement>(null);
  const commit = useRef(onCommit);
  commit.current = onCommit;
  useEffect(() => {
    const input = ref.current!;
    const listener = () => commit.current(input.value);
    input.addEventListener("change", listener);
    return () => input.removeEventListener("change", listener);
  }, []);
  useEffect(() => {
    if (/^#[0-9a-f]{6}$/i.test(value)) ref.current!.value = value;
  }, [value]);
  return (
    <label className="color-field">
      {label}
      <input type="color" ref={ref} defaultValue="#000000" />
    </label>
  );
}
