// src/layerColors.js — constraint colours/labels come from map/constraints.js
import { CONSTRAINTS } from "./constraints.js";

export const LAYER_COLORS = {
  parcel: "#f5f0e6",
  buildable: "#3f9d5a",
  excluded: "#c0392b",
  ...Object.fromEntries(CONSTRAINTS.map((c) => [c.id, c.color])),
};

export const LAYER_LABELS = {
  parcel: "Parcel boundary",
  buildable: "Buildable area",
  excluded: "Excluded (all constraints)",
  ...Object.fromEntries(CONSTRAINTS.map((c) => [c.id, c.label])),
};