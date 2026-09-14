import React, { useState } from "react";
import MapView from "./components/Map.jsx";

const API_BASE = "http://localhost:8000";

export default function App() {
  const [parcelId, setParcelId] = useState("");
  const [result, setResult] = useState(null);
  const [loading, setLoading] = useState(false);
  const [settings, setSettings] = useState({
    wetland_buffer_ft: 50,
    building_setback_ft: 50,
    transmission_buffer_ft: 100,
    exclude_sfha: true,
  });

  async function analyze(extra = {}) {
    if (!parcelId) return;
    setLoading(true);
    try {
      const res = await fetch(`${API_BASE}/api/analyze`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ parcel_id: parcelId, ...settings, ...extra }),
      });
      const data = await res.json();
      setResult(data);
    } finally {
      setLoading(false);
    }
  }

  function handleAdjustment(adjustment) {
    // adjustment: { user_exclusions: [...] } or { user_restores: [...] }
    analyze(adjustment);
  }

  return (
    <div style={{ display: "flex", height: "100vh" }}>
      <div style={{ flex: 1 }}>
        <MapView result={result} onAdjustment={handleAdjustment} />
      </div>
      <aside style={{ width: 340, padding: 16, borderLeft: "1px solid #ddd", overflowY: "auto" }}>
        <h2>Buildable Land Analysis</h2>

        <label style={{ display: "block", marginBottom: 8 }}>
          Prop_ID
          <input
            value={parcelId}
            onChange={(e) => setParcelId(e.target.value)}
            placeholder="e.g. 0660640000012"
            style={{ width: "100%" }}
          />
        </label>

        <fieldset style={{ marginBottom: 12 }}>
          <legend>Setbacks (screening assumptions)</legend>
          <label style={{ display: "block" }}>
            Wetland buffer (ft)
            <input
              type="number"
              value={settings.wetland_buffer_ft}
              onChange={(e) => setSettings((s) => ({ ...s, wetland_buffer_ft: Number(e.target.value) }))}
            />
          </label>
          <label style={{ display: "block" }}>
            Building setback (ft)
            <input
              type="number"
              value={settings.building_setback_ft}
              onChange={(e) => setSettings((s) => ({ ...s, building_setback_ft: Number(e.target.value) }))}
            />
          </label>
          <label style={{ display: "block" }}>
            Transmission buffer (ft)
            <input
              type="number"
              value={settings.transmission_buffer_ft}
              onChange={(e) => setSettings((s) => ({ ...s, transmission_buffer_ft: Number(e.target.value) }))}
            />
          </label>
          <label style={{ display: "block" }}>
            <input
              type="checkbox"
              checked={settings.exclude_sfha}
              onChange={(e) => setSettings((s) => ({ ...s, exclude_sfha: e.target.checked }))}
            />
            Exclude FEMA Special Flood Hazard Areas
          </label>
        </fieldset>

        <button onClick={() => analyze()} disabled={!parcelId || loading}>
          {loading ? "Calculating…" : "Analyze parcel"}
        </button>

        {result && (
          <>
            <p style={{ marginTop: 16 }}>
              <strong>Parcel:</strong> {result.parcel_acres} acres
            </p>
            <p>
              <strong>Excluded (union of all constraints):</strong> {result.excluded_acres} acres
            </p>
            <p>
              <strong>Buildable:</strong> {result.buildable_acres} acres
            </p>
            <h3>Breakdown by constraint</h3>
            <p style={{ fontSize: 12, color: "#666" }}>
              Individual values may overlap — they will not sum exactly to the excluded total above.
            </p>
            <ul>
              {result.breakdown.map((b, i) => (
                <li key={i}>
                  {b.layer}: -{b.acres_removed} ac {b.buffer_ft ? `(${b.buffer_ft} ft buffer)` : ""}
                </li>
              ))}
            </ul>
            <p style={{ fontSize: 12, color: "#666", marginTop: 12 }}>{result.note}</p>
          </>
        )}
        {!result && !loading && <p>Enter a Prop_ID and click Analyze.</p>}
      </aside>
    </div>
  );
}
