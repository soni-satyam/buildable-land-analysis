import React, { useState, useCallback, useRef } from "react";
import MapView from "./components/Map.jsx";

const API_BASE = "http://localhost:8000";

const LAYER_TOGGLES = [
  { id: "parcel", label: "Parcel boundary" },
  { id: "buildable", label: "Buildable area" },
  { id: "excluded", label: "Excluded (all constraints)" },
  { id: "wetlands", label: "Wetlands" },
  { id: "fema_flood", label: "FEMA flood zones" },
  { id: "buildings", label: "Building footprints/buffers" },
  { id: "transmission", label: "Transmission lines" },
];

export default function App() {
  const [selectedParcelId, setSelectedParcelId] = useState(null);
  const [result, setResult] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [settings, setSettings] = useState({
    wetland_buffer_ft: 50,
    building_setback_ft: 50,
    transmission_buffer_ft: 100,
    exclude_sfha: true,
  });
  const [layerVisibility, setLayerVisibility] = useState(
    Object.fromEntries(LAYER_TOGGLES.map((l) => [l.id, true]))
  );

  const analyze = useCallback(
    async (parcelId, extra = {}) => {
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
    },
    [settings]
  );

  function handleParcelSelect(parcelId) {
    setSelectedParcelId(parcelId);
    analyze(parcelId);
  }

  function handleAdjustment(adjustment) {
    if (!selectedParcelId) return;
    analyze(selectedParcelId, adjustment);
  }

  const analyzeTimerRef = useRef(null);

  function updateSetting(key, value) {
    setSettings((s) => ({ ...s, [key]: value }));
    if (!selectedParcelId) return;
    // Debounced: range sliders fire onChange continuously while dragging,
    // so wait for a short pause before re-running the analysis. Pass the
    // new value explicitly as an override rather than relying on `settings`
    // state (which won't have updated yet in this closure) to avoid
    // sending a stale request.
    clearTimeout(analyzeTimerRef.current);
    analyzeTimerRef.current = setTimeout(() => {
      analyze(selectedParcelId, { [key]: value });
    }, 300);
  }

  function toggleLayer(id) {
    setLayerVisibility((v) => ({ ...v, [id]: !v[id] }));
  }

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="sidebar-header">
          <p className="eyebrow">HARRIS COUNTY, TX — FIPS 48201</p>
          <h1>Buildable Land Analysis</h1>
          <p>Search a location or click a parcel on the map to see its estimated buildable area.</p>
        </div>

        <div className="section">
          <p className="section-title">SELECTED PARCEL</p>
          {selectedParcelId ? (
            <p className="empty-state">
              Prop_ID <strong style={{ color: "var(--brass)" }}>{selectedParcelId}</strong>
              {loading ? " — calculating…" : ""}
            </p>
          ) : (
            <p className="empty-state">
              Search for a location, zoom in, and click a parcel on the map to analyze it.
            </p>
          )}
          {error && <p style={{ color: "#b95d40", fontSize: 12.5, marginTop: 10, lineHeight: 1.5 }}>{error}</p>}
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

        <div className="section">
          <p className="section-title">ANALYSIS LAYERS</p>
          {LAYER_TOGGLES.map((l) => (
            <label className="checkbox-row" key={l.id}>
              <input type="checkbox" checked={layerVisibility[l.id]} onChange={() => toggleLayer(l.id)} />
              {l.label}
            </label>
          ))}
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
      </aside>

      <MapView
        result={result}
        onAdjustment={handleAdjustment}
        onParcelSelect={handleParcelSelect}
        layerVisibility={layerVisibility}
      />
    </div>
  );
}