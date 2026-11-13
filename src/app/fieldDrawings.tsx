// Small drawings for the fields whose words alone don't make it plain: where u and v are measured
// from, a curve's bulge, a wall's bow, a seam's lip and the rounds. Drawn in the text's colour, with
// what the field sets in the accent.
import type { ReactNode } from "react";

const svg = (children: ReactNode, label: string) => (
  <svg viewBox="0 0 160 90" width="160" height="90" role="img" aria-label={label} className="field-drawing">
    <defs>
      <marker id="field-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
        <path d="M0 0L10 5L0 10z" fill="var(--accent)" />
      </marker>
    </defs>
    {children}
  </svg>
);
const measure = { stroke: "var(--accent)", strokeWidth: 1.6, markerEnd: "url(#field-arrow)", markerStart: "url(#field-arrow)" } as const;
const outline = { fill: "none", stroke: "currentColor", strokeWidth: 1.4 } as const;
const text = (x: number, y: number, words: string, accent = false) => (
  <text x={x} y={y} fontSize="10" fill={accent ? "var(--accent)" : "currentColor"} textAnchor="middle">
    {words}
  </text>
);

// A surface seen from above, front at the bottom: a part's centre measured from the left end and the front edge.
const uv = svg(
  <>
    <rect x="12" y="12" width="136" height="60" rx="3" {...outline} />
    <circle cx="96" cy="34" r="9" {...outline} />
    <circle cx="96" cy="34" r="1.6" fill="currentColor" />
    <line x1="12" y1="34" x2="94" y2="34" {...measure} />
    <line x1="96" y1="72" x2="96" y2="36" {...measure} />
    {text(52, 30, "u", true)}
    {text(104, 58, "v", true)}
    {text(80, 85, "front")}
  </>,
  "u across from the left end, v back from the front edge",
);

const curve = svg(
  <>
    <line x1="14" y1="64" x2="146" y2="40" stroke="currentColor" strokeWidth="1" strokeDasharray="3 3" />
    <path d="M14 64 Q80 6 146 40" {...outline} />
    <line x1="80" y1="52" x2="72" y2="30" {...measure} />
    {text(98, 32, "curve", true)}
    {text(14, 80, "front")}
    {text(146, 56, "back")}
  </>,
  "how far the arc rises above the straight line between the surface's ends",
);

const bow = svg(
  <>
    <path d="M14 14 H146 V54 Q80 82 14 54 Z" {...outline} />
    <line x1="14" y1="54" x2="146" y2="54" stroke="currentColor" strokeWidth="1" strokeDasharray="3 3" />
    <line x1="80" y1="54" x2="80" y2="67" {...measure} />
    {text(102, 72, "bow", true)}
    {text(80, 36, "seen from above")}
  </>,
  "how far a wall bows out at its middle, seen from above",
);

const sideBow = svg(
  <>
    <path d="M50 10 H110 Q132 45 110 80 H50 Z" {...outline} />
    <line x1="110" y1="10" x2="110" y2="80" stroke="currentColor" strokeWidth="1" strokeDasharray="3 3" />
    <line x1="110" y1="45" x2="121" y2="45" {...measure} />
    {text(140, 40, "bow", true)}
    {text(80, 48, "seen from")}
    {text(80, 60, "above")}
    {text(80, 88, "front")}
  </>,
  "how far a side wall bows out at its middle, seen from above",
);

const lip = svg(
  <>
    <path d="M10 30 H88 V36 H76 V70 H10 Z" {...outline} />
    <path d="M78 70 V38 H90 V30 H150 V70 Z" {...outline} />
    <line x1="76" y1="20" x2="76" y2="72" stroke="currentColor" strokeWidth="1" strokeDasharray="3 3" />
    <line x1="76" y1="24" x2="88" y2="24" {...measure} />
    {text(98, 18, "lip", true)}
    {text(40, 84, "left piece")}
    {text(118, 84, "right piece")}
  </>,
  "how far the left piece's skin reaches over the seam onto the right piece",
);

const round = (corner: "frontBottom" | "rearTop" | "rearBottom") => {
  const shape = "M20 70 H140 V20 H20 Z";
  const marks: Record<typeof corner, ReactNode> = {
    frontBottom: <path d="M20 46 A24 24 0 0 0 44 70" stroke="var(--accent)" strokeWidth="2.4" fill="none" />,
    rearTop: <path d="M116 20 A24 24 0 0 1 140 44" stroke="var(--accent)" strokeWidth="2.4" fill="none" />,
    rearBottom: <path d="M140 46 A24 24 0 0 1 116 70" stroke="var(--accent)" strokeWidth="2.4" fill="none" />,
  };
  return svg(
    <>
      <path d={shape} {...outline} strokeDasharray="3 3" />
      {marks[corner]}
      {text(30, 86, "front")}
      {text(130, 86, "back")}
      {text(80, 48, "seen from the side")}
    </>,
    "the round on that edge, seen from the side",
  );
};

export const FIELD_DRAWINGS: Record<string, ReactNode> = {
  "Across (u)": uv,
  "Back (v)": uv,
  Curve: curve,
  "Front wall bow": bow,
  "Rear wall bow": bow,
  "Left wall bow": sideBow,
  "Right wall bow": sideBow,
  "Lip past it": lip,
  "Front bottom round": round("frontBottom"),
  "Rear top round": round("rearTop"),
  "Rear bottom round": round("rearBottom"),
};
