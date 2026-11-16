// A board's edge lips, on the Layout tab: which of its edges have one, how long, and the gap,
// thickness and height they share. Edges are named by the wall they face as the board is turned now.
import { EDGE_LIP, edgeFacing, edgeLength, type Wall } from "../fixtures.js";
import type { Rotation } from "../geometry.js";
import type { FloorPart } from "../schema.js";
import { setLips, setLipSide, type RawComponent, type RawConfig } from "./configEdit.js";
import { NumberField } from "./fields.js";

const SIDES: Wall[] = ["left", "right", "front", "rear"];
// A new lip leaves 8 mm clear at each end of its edge, as the Desk Synth V2's long one does.
export const defaultLipLength = (edge: number) => Math.round(Math.max(edge - 16, edge / 2));

const number = (text: string) => {
  const value = Number(text);
  return text.trim() !== "" && Number.isFinite(value) ? value : null;
};

export function LipsFields({ config, component, part, onChange }: { config: RawConfig; component: RawComponent; part: FloorPart; onChange(next: RawConfig): void }) {
  if (part.footprint.shape !== "rect") return null;
  const rotation = (component.rotationDeg ?? 0) as Rotation;
  const edges: RawComponent[] = component.lips?.edges ?? [];
  const sides = [...SIDES].sort((a, b) => SIDES.indexOf(edgeFacing(a, rotation)) - SIDES.indexOf(edgeFacing(b, rotation)));
  const lips = component.lips;
  return (
    <fieldset className="fields lips">
      <legend>Edge lips, to locate it on the plate</legend>
      {sides.map((side) => {
        const mine = edges.filter((edge) => edge.side === side);
        const wall = edgeFacing(side, rotation);
        return (
          <div key={side} className="lip-edge">
            <label className="check">
              <input
                type="checkbox"
                aria-label={`Lip along its ${wall} edge`}
                checked={mine.length > 0}
                onChange={(e) => onChange(setLipSide(config, component.id, side, e.target.checked ? defaultLipLength(edgeLength(part, side)) : null))}
              />
              {wall[0]!.toUpperCase() + wall.slice(1)} edge{mine.length > 1 ? `, ${mine.length} lips` : ""}
            </label>
            {mine.length ? (
              <NumberField
                label={mine.length > 1 ? "Each lip's length" : "Lip length"}
                value={mine[0]!.length}
                onCommit={(text) => {
                  const length = number(text);
                  if (length !== null && length > 0) onChange(setLipSide(config, component.id, side, length));
                }}
              />
            ) : (
              <span />
            )}
          </div>
        );
      })}
      {lips ? (
        <>
          <NumberField label="Lip gap" step={0.05} value={lips.gap ?? EDGE_LIP.gap} onCommit={(text) => number(text) !== null && onChange(setLips(config, component.id, { gap: number(text) }))} />
          <NumberField label="Lip thickness" step={0.2} value={lips.thickness ?? EDGE_LIP.thickness} onCommit={(text) => number(text) !== null && onChange(setLips(config, component.id, { thickness: number(text) }))} />
          <NumberField label="Over the board" step={0.2} value={lips.above ?? EDGE_LIP.above} onCommit={(text) => number(text) !== null && onChange(setLips(config, component.id, { above: number(text) }))} />
        </>
      ) : null}
    </fieldset>
  );
}
