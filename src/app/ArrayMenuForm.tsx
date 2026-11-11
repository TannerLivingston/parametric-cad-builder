// The right-click menu's "Make an array…": how many across, how many rows, and how far apart,
// starting from the least spacing at which a copy adds no problem.
import { useState } from "react";
import type { RawConfig } from "./configEdit.js";
import { MAX_COPIES } from "./layoutEdit.js";
import { arrayPitch, arrayThing } from "./thingKeys.js";

interface ArrayMenuFormProps {
  config: RawConfig;
  target: { part: string } | { path: string };
  onMake(config: RawConfig): void;
}

export function ArrayMenuForm({ config, target, onMake }: ArrayMenuFormProps) {
  // Worked out once, when the form opens, since it tries spot after spot.
  const [pitch] = useState(() => arrayPitch(config, target));
  const [columns, setColumns] = useState(3);
  const [rows, setRows] = useState(1);
  const [stepAlong, setStepAlong] = useState(pitch?.along ?? 20);
  const [stepAcross, setStepAcross] = useState(pitch?.across ?? 20);
  if (!pitch) return <p>This can't be copied.</p>;
  const hasRows = pitch.across !== null;
  const total = columns * (hasRows ? rows : 1);
  const copies = total - 1;
  const ok = copies >= 1 && total <= MAX_COPIES;
  const field = (label: string, value: number, set: (n: number) => void, min: number, whole: boolean) => (
    <label>
      {label}
      <input
        type="number"
        value={value}
        min={min}
        step={whole ? 1 : 0.5}
        onChange={(event) => {
          const n = Number(event.target.value);
          if (event.target.value !== "" && Number.isFinite(n)) set(whole ? Math.floor(n) : n);
        }}
      />
    </label>
  );
  return (
    <form
      className="array-form"
      onSubmit={(event) => {
        event.preventDefault();
        const next = ok ? arrayThing(config, target, { columns, rows: hasRows ? rows : 1, stepAlong, stepAcross }) : null;
        if (next) onMake(next);
      }}
    >
      {field("Across", columns, setColumns, 1, true)}
      {field("Spacing", stepAlong, setStepAlong, -1000, false)}
      {hasRows ? field("Rows", rows, setRows, 1, true) : null}
      {hasRows ? field("Row spacing", stepAcross, setStepAcross, -1000, false) : null}
      <button type="submit" disabled={!ok}>
        Make {Math.max(copies, 0)} {copies === 1 ? "copy" : "copies"}
      </button>
    </form>
  );
}
