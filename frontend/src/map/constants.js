export const HARRIS_COUNTY_BOUNDS = [
  [-95.960733, 29.497297],
  [-94.908492, 30.170606],
];
export const HARRIS_COUNTY_CENTER = [-95.43, 29.83];
export const MIN_PARCEL_ZOOM = 15;

// Free, no-API-key raster basemaps (Light/Dark need a free CARTO key - see
// VITE_CARTO_API_KEY). Each is a plain XYZ raster source, not a full vector
// style, so swapping one in only ever touches this one source+layer - see
// useMapInstance's applyBasemap.
export const BASEMAPS = {
  streets: {
    label: "Streets",
    tiles: ["https://tile.openstreetmap.org/{z}/{x}/{y}.png"],
    attribution: "&copy; OpenStreetMap contributors",
  },
  light: {
    label: "Light",
    tiles: [`https://basemaps.cartocdn.com/light_all/{z}/{x}/{y}.png?key=${import.meta.env.VITE_CARTO_API_KEY || ""}`],
    attribution: "&copy; OpenStreetMap contributors &copy; CARTO",
  },
  dark: {
    label: "Dark",
    tiles: [`https://basemaps.cartocdn.com/dark_all/{z}/{x}/{y}.png?key=${import.meta.env.VITE_CARTO_API_KEY || ""}`],
    attribution: "&copy; OpenStreetMap contributors &copy; CARTO",
  },
  satellite: {
    label: "Satellite",
    tiles: ["https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}"],
    attribution: "Esri, Maxar, Earthstar Geographics",
  },
  terrain: {
    label: "Terrain",
    tiles: [
      "https://a.tile.opentopomap.org/{z}/{x}/{y}.png",
      "https://b.tile.opentopomap.org/{z}/{x}/{y}.png",
      "https://c.tile.opentopomap.org/{z}/{x}/{y}.png",
    ],
    attribution: "&copy; OpenTopoMap contributors (CC-BY-SA)",
  },
};

// Which result-driven layers get rendered/toggled, and in what order
// (later = drawn on top).
export const ANALYSIS_LAYER_IDS = ["parcel", "buildable", "excluded", "wetlands", "fema_flood", "buildings", "transmission"];

// Layers that come segmented into individually clickable pieces (see the
// backend's `segments` field). Right-click on one of these toggles that
// exact piece; right-click elsewhere falls back to the brush circle.
export const SEGMENT_LAYER_KEYS = ["wetlands", "fema_flood", "buildings", "transmission", "buildable"];
export const SEGMENT_FILL_LAYER_IDS = SEGMENT_LAYER_KEYS.map((k) => `${k}-segments-fill`);

export const EMPTY_FEATURE = { type: "Feature", geometry: { type: "GeometryCollection", geometries: [] }, properties: {} };
export const EMPTY_FC = { type: "FeatureCollection", features: [] };