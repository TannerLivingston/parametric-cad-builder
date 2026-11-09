// A part's own model, from its STEP file, to see and measure against the design. See reference.ts.
import { useRef } from "react";
import { referenceTransform, type Bounds, type QuarterTurn, type ReferencePlace } from "../reference.js";
import { NumberField } from "./fields.js";

export interface LoadedReference {
  name: string;
  bounds: Bounds;
  place: ReferencePlace;
}

const TURNS: QuarterTurn[] = [0, 90, 180, 270];

export function ReferencePanel({
  reference,
  loading,
  problem,
  onOpen,
  onPlace,
  onRemove,
}: {
  reference: LoadedReference | null;
  loading: boolean;
  problem: string | null;
  onOpen(file: File): void;
  onPlace(place: ReferencePlace): void;
  onRemove(): void;
}) {
  const input = useRef<HTMLInputElement>(null);
  const size = reference ? referenceTransform(reference.bounds, reference.place).size : null;
  const set = (key: "x" | "y" | "z") => (text: string) => {
    const value = Number(text);
    if (reference && text.trim() !== "" && Number.isFinite(value)) onPlace({ ...reference.place, [key]: value });
  };
  return (
    <section>
      <h2>Reference model</h2>
      <p className="hint">A part's own STEP file, shown see-through in the design, to measure and line things up against. It isn't printed, checked, or kept with the design.</p>
      <button disabled={loading} onClick={() => input.current?.click()}>{loading ? "Reading it…" : reference ? "Open another" : "Open a STEP file"}</button>
      <input
        ref={input}
        className="sr-only"
        type="file"
        accept=".step,.stp,.STEP,.STP"
        tabIndex={-1}
        aria-label="Open a STEP file to show"
        onChange={(event) => {
          const file = event.target.files?.[0];
          event.target.value = "";
          if (file) onOpen(file);
        }}
      />
      {problem ? <p className="danger note">{problem}</p> : null}
      {reference && size ? (
        <div className="surface-card">
          <p>
            <strong>{reference.name}</strong>, {size.map((value) => Math.round(value * 10) / 10).join(" x ")} mm
          </p>
          <div className="fields">
            <NumberField label="Bottom middle x" value={reference.place.x} onCommit={set("x")} />
            <NumberField label="y" value={reference.place.y} onCommit={set("y")} />
            <NumberField label="z" value={reference.place.z} onCommit={set("z")} />
            <label>
              Turn
              <select value={reference.place.turn} onChange={(event) => onPlace({ ...reference.place, turn: Number(event.target.value) as QuarterTurn })}>
                {TURNS.map((turn) => (
                  <option key={turn} value={turn}>{turn}°</option>
                ))}
              </select>
            </label>
            <label>
              Tip over
              <select value={reference.place.tip} onChange={(event) => onPlace({ ...reference.place, tip: Number(event.target.value) as QuarterTurn })}>
                {TURNS.map((tip) => (
                  <option key={tip} value={tip}>{tip}°</option>
                ))}
              </select>
            </label>
          </div>
          <button className="danger" onClick={onRemove}>Remove it</button>
        </div>
      ) : null}
    </section>
  );
}
