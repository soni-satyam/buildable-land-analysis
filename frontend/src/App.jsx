import React, { useState } from "react";
import MapView from "./components/Map.jsx";

const API_BASE = "http://localhost:8000";

export default function App() {
  const [parcelId, setParcelId] = useState("");
  const [result, setResult] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [settings, setSettings] = useState({
    wetland_buffer_ft: 50,
    building_setback_ft: 50,
    transmission_buffer_ft: 100,
    exclude_sfha: true,
  });

  async function analyze(extra = {}) {
    if (!parcelId) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`${API_BASE}/api/analyze`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ parcel_id: parcelId, ...settings, ...extra }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.detail || `Request failed (${res.status})`);
      }
      const data = await res.json();
      setResult(data);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }

  function handleAdjustment(adjustment) {
    analyze(adjustment);
  }

  function updateSetting(key, value) {
    setSettings((s) => ({ ...s, [key]: value }));
  }

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="sidebar-header">
          <p className="eyebrow">HARRIS COUNTY, TX — FIPS 48201</p>
          <h1>Buildable Land Analysis</h1>
          <p>Estimated buildable area, screened against wetlands, flood hazard, structures, and transmission easements.</p>
        </div>

        <div className="section">
          <p className="section-title">PARCEL</p>
          <div className="field">
            <label htmlFor="parcel-id">Prop_ID</label>
            <input
              id="parcel-id"
              type="text"
              value={parcelId}
              onChange={(e) => setParcelId(e.target.value)}
              placeholder="e.g. 0660640000012"
              onKeyDown={(e) => e.key === "Enter" && analyze()}
            />
          </div>
          <button className="btn-primary" onClick={() => analyze()} disabled={!parcelId || loading}>
            {loading ? "Calculating…" : "Analyze parcel"}
          </button>
          {error && (
            <p style={{ color: "#b95d40", fontSize: 12.5, marginTop: 10, lineHeight: 1.5 }}>{error}</p>
          )}
        </div>

        <div className="section">
          <p className="section-title">SETBACKS — SCREENING ASSUMPTIONS</p>

          <div className="setback-row">
            <div className="setback-row-head">
              <span>Wetland buffer</span>
              <span className="setback-value">{settings.wetland_buffer_ft} ft</span>
            </div>
            <input
              type="range"
              min="0"
              max="300"
              step="5"
              value={settings.wetland_buffer_ft}
              onChange={(e) => updateSetting("wetland_buffer_ft", Number(e.target.value))}
            />
          </div>

          <div className="setback-row">
            <div className="setback-row-head">
              <span>Building setback</span>
              <span className="setback-value">{settings.building_setback_ft} ft</span>
            </div>
            <input
              type="range"
              min="0"
              max="300"
              step="5"
              value={settings.building_setback_ft}
              onChange={(e) => updateSetting("building_setback_ft", Number(e.target.value))}
            />
          </div>

          <div className="setback-row">
            <div className="setback-row-head">
              <span>Transmission buffer</span>
              <span className="setback-value">{settings.transmission_buffer_ft} ft</span>
            </div>
            <input
              type="range"
              min="0"
              max="400"
              step="10"
              value={settings.transmission_buffer_ft}
              onChange={(e) => updateSetting("transmission_buffer_ft", Number(e.target.value))}
            />
          </div>

          <label className="checkbox-row">
            <input
              type="checkbox"
              checked={settings.exclude_sfha}
              onChange={(e) => updateSetting("exclude_sfha", e.target.checked)}
            />
            Exclude FEMA Special Flood Hazard Areas
          </label>
        </div>

        {result && (
          <div className="section">
            <p className="section-title">RESULT</p>
            <div className="stat-grid">
              <div className="stat">
                <p className="stat-label">PARCEL</p>
                <p className="stat-value">{result.parcel_acres}<span className="stat-unit">ac</span></p>
              </div>
              <div className="stat">
                <p className="stat-label">EXCLUDED</p>
                <p className="stat-value">{result.excluded_acres}<span className="stat-unit">ac</span></p>
              </div>
              <div className="stat stat-wide">
                <p className="stat-label">ESTIMATED BUILDABLE</p>
                <p className="stat-value">{result.buildable_acres}<span className="stat-unit">ac</span></p>
              </div>
            </div>

            <p className="section-title">BREAKDOWN BY CONSTRAINT</p>
            <p className="breakdown-note">
              Individual values may overlap — they will not sum exactly to the excluded total above.
            </p>
            <table className="breakdown-table">
              <tbody>
                {result.breakdown.map((b, i) => (
                  <tr key={i}>
                    <td>
                      {b.layer.replace(/_/g, " ")}
                      {b.buffer_ft ? <span className="breakdown-buffer">+{b.buffer_ft}ft</span> : null}
                    </td>
                    <td>-{b.acres_removed} ac</td>
                  </tr>
                ))}
              </tbody>
            </table>

            <p className="disclosure">{result.note}</p>
          </div>
        )}

        {!result && !loading && !error && (
          <div className="section">
            <p className="empty-state">Enter a Prop_ID and click Analyze to see the buildable area breakdown and map.</p>
          </div>
        )}
      </aside>

      <MapView result={result} onAdjustment={handleAdjustment} />
    </div>
  );
}
