import { EMPTY_FEATURE } from "./constants.js";

function ringArea(ring) {
  let a = 0;
  for (let i = 0; i < ring.length - 1; i++) a += ring[i][0] * ring[i + 1][1] - ring[i + 1][0] * ring[i][1];
  return Math.abs(a / 2);
}

// Area-weighted centroid of a simple polygon ring, for placing the
// "Calculate Buildable Area" button roughly inside whatever shape was drawn.
// A MultiPolygon (e.g. from the lines tool) uses its largest part.
export function polygonCentroid(geometry) {
  const polygon =
    geometry.type === "MultiPolygon"
      ? [...geometry.coordinates].sort((a, b) => ringArea(b[0]) - ringArea(a[0]))[0]
      : geometry.coordinates;
  const ring = polygon[0];
  let area = 0, cx = 0, cy = 0;
  for (let i = 0; i < ring.length - 1; i++) {
    const [x0, y0] = ring[i];
    const [x1, y1] = ring[i + 1];
    const cross = x0 * y1 - x1 * y0;
    area += cross;
    cx += (x0 + x1) * cross;
    cy += (y0 + y1) * cross;
  }
  area *= 0.5;
  if (Math.abs(area) < 1e-12) return ring[0];
  return [cx / (6 * area), cy / (6 * area)];
}

// Small circle polygon (degrees lon/lat) used as the right-click restore brush.
export function makeCircle(lng, lat, radiusFt, steps = 32) {
  const radiusM = radiusFt * 0.3048;
  const latRad = (lat * Math.PI) / 180;
  const dLat = radiusM / 111320;
  const dLng = radiusM / (111320 * Math.cos(latRad));
  const coords = [];
  for (let i = 0; i <= steps; i++) {
    const theta = (i / steps) * 2 * Math.PI;
    coords.push([lng + dLng * Math.cos(theta), lat + dLat * Math.sin(theta)]);
  }
  coords.push(coords[0]);
  return { type: "Polygon", coordinates: [coords] };
}

export function geometryBounds(geometry) {
  const flat = [];
  const walk = (c) => (typeof c[0] === "number" ? flat.push(c) : c.forEach(walk));
  walk(geometry.coordinates);
  if (!flat.length) return null;
  const lons = flat.map((c) => c[0]);
  const lats = flat.map((c) => c[1]);
  return [[Math.min(...lons), Math.min(...lats)], [Math.max(...lons), Math.max(...lats)]];
}

/** Accepts a bare geometry, a Feature, a FeatureCollection, or null. */
export function toFeature(g) {
  if (!g) return EMPTY_FEATURE;
  if (g.type === "Feature" || g.type === "FeatureCollection") return g;
  return { type: "Feature", geometry: g, properties: {} };
}