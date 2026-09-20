const API_BASE = import.meta.env.VITE_API_BASE || "http://localhost:8000";

/**
 * Asks the backend whether drawn lines enclose any land.
 * Returns the enclosed area as GeoJSON (Polygon / MultiPolygon), or null
 * when the lines don't form a closed shape.
 */
export async function linesToArea(lines, snapFt) {
  const res = await fetch(`${API_BASE}/api/lines-to-area`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ lines, snap_ft: snapFt }),
  });
  if (!res.ok) throw new Error(`Request failed (${res.status})`);
  const data = await res.json();
  return data.geometry ?? null;
}