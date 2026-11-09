// How long the whole thing takes to print and what it costs in filament, roughly. The price is only
// kept in this browser, because it's about the buyer, not the design.
import { useState } from "react";
import { describeEstimate, filamentCost, totalEstimate, type PartPrintReport } from "../printing.js";
import { NumberField } from "./fields.js";

const KEY = "enclosure-generator.filament-price-v1";
const USUAL_PRICE = 20;

function loadPrice(): number {
  try {
    const value = Number(localStorage.getItem(KEY));
    return value > 0 ? value : USUAL_PRICE;
  } catch {
    return USUAL_PRICE;
  }
}

export function PrintCost({ reports }: { reports: Pick<PartPrintReport, "estimate">[] }) {
  const [price, setPrice] = useState(loadPrice);
  const total = totalEstimate(reports);
  const save = (text: string) => {
    const value = Number(text);
    if (!(value > 0)) return;
    setPrice(value);
    try {
      localStorage.setItem(KEY, String(value));
    } catch {
      // Without storage it just goes back to the usual price next time.
    }
  };
  return (
    <div className="print-cost">
      <p className="hint">
        All together, {describeEstimate(total)} of filament, or about {filamentCost(total.grams, price).toFixed(2)} at this price. It's a rough figure from each part's shape, so a single part can be well out. Your slicer has the real one.
      </p>
      <div className="fields">
        <NumberField label="Filament, per kg" step={1} value={price} onCommit={save} />
      </div>
    </div>
  );
}
