import { LAYER_COLORS, LAYER_LABELS } from "./layerColors.js";
import {CONSTRAINTS} from "./constraints.js";

// Fallbacks only; colours and labels come from src/layerColors.js so the
// sidebar legend and the map can't drift apart.
const BASE = {
  parcel:       { label: "Parcel",          kind: "line", color: "#f5f0e6", width: 2.5 },
  buildable:    { label: "Buildable land",  kind: "fill", color: "#3f9d5a", opacity: 0.35 },
  excluded:     { label: "Excluded",        kind: "fill", color: "#c0392b", opacity: 0.30 },
  ...Object.fromEntries(CONSTRAINTS.map((c) => [c.id, { label: c.label, kind: "fill", color: c.color, opacity: c.opacity }])),
};

export const LAYER_STYLE = Object.fromEntries(
  Object.entries(BASE).map(([id, s]) => [
    id,
    { ...s, color: LAYER_COLORS?.[id] || s.color, label: LAYER_LABELS?.[id] || s.label },
  ])
);

export const OVERRIDE_TO_BUILDABLE = "#2ecc71";
export const OVERRIDE_TO_NONBUILDABLE = "#e74c3c";