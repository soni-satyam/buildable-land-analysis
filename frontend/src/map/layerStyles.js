import { LAYER_COLORS, LAYER_LABELS } from "./layerColors.js";

// Fallbacks only; colours and labels come from src/layerColors.js so the
// sidebar legend and the map can't drift apart.
const BASE = {
  parcel:       { label: "Parcel",          kind: "line", color: "#f5f0e6", width: 2.5 },
  buildable:    { label: "Buildable land",  kind: "fill", color: "#3f9d5a", opacity: 0.35 },
  excluded:     { label: "Excluded",        kind: "fill", color: "#c0392b", opacity: 0.30 },
  wetlands:     { label: "Wetlands",        kind: "fill", color: "#2b8fb3", opacity: 0.40 },
  fema_flood:   { label: "FEMA flood zone", kind: "fill", color: "#5b6fd6", opacity: 0.30 },
  buildings:    { label: "Buildings",       kind: "fill", color: "#8a6d3b", opacity: 0.50 },
  transmission: { label: "Transmission",    kind: "fill", color: "#d98a1e", opacity: 0.40 },
};

export const LAYER_STYLE = Object.fromEntries(
  Object.entries(BASE).map(([id, s]) => [
    id,
    { ...s, color: LAYER_COLORS?.[id] || s.color, label: LAYER_LABELS?.[id] || s.label },
  ])
);

export const OVERRIDE_TO_BUILDABLE = "#2ecc71";
export const OVERRIDE_TO_NONBUILDABLE = "#e74c3c";