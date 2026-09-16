// Shared between Map.jsx (map layers + legend) and App.jsx (sidebar
// breakdown color dots) so both always agree on what color means what.

export const LAYER_COLORS = {
  parcel: "#3498db",       // the analyzed area's outline
  buildable: "#63a06f",    // green - can build here
  excluded: "#b95d40",     // clay red - combined "cannot build" overlay
  wetlands: "#2f8f6e",     // teal
  fema_flood: "#3b6fb0",   // blue - flood/water association
  buildings: "#a2673a",    // brown
  transmission: "#8a4fae", // violet
};

export const LAYER_LABELS = {
  parcel: "Selected area",
  buildable: "Buildable",
  excluded: "Excluded (all)",
  wetlands: "Wetlands",
  fema_flood: "FEMA flood zone",
  buildings: "Buildings",
  transmission: "Transmission lines",
};