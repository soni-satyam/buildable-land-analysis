const API_BASE = import.meta.env.VITE_API_BASE || "http://localhost:8000";

/** Parcels in a bbox -> GeoJSON FeatureCollection (backend returns { parcels: [{ geometry }] }). */
export async function fetchParcels({ west, south, east, north }, signal) {
  const res = await fetch(`${API_BASE}/api/parcels?bbox=${west},${south},${east},${north}`, { signal });
  if (!res.ok) throw new Error(`Parcel request failed (${res.status})`);
  const data = await res.json();
  return {
    type: "FeatureCollection",
    features: (data.parcels || []).map((p) => ({ type: "Feature", geometry: p.geometry, properties: {} })),
  };
}