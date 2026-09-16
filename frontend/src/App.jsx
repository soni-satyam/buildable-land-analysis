import React, { useState, useCallback, useRef } from "react";
import MapView from "./components/Map.jsx";
import { LAYER_COLORS, LAYER_LABELS } from "./layerColors.js";

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
  const [result, setResult] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [settings, setSettings] = useState({
    wetland_buffer_ft: 50,
    building_setback_ft: 50,
    transmission_buffer_ft: 100,
    exclude_sfha: true,
    restore_brush_ft: 60,
  });
  const [layerVisibility, setLayerVisibility] = useState(
    Object.fromEntries(LAYER_TOGGLES.map((l) => [l.id, true]))
  );
  const selectionRef = useRef(null);

  const runAnalyze = useCallback(
    async (extra = {}) => {
      const selection = selectionRef.current;
      if (!selection) return;
      setLoading(true);
      setError(null);
      try {
        const res = await fetch(`${API_BASE}/api/analyze`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ ...selection, ...settings, ...extra }),
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

  function handleAreaSelected(geometry) {
    selectionRef.current = { custom_geometry: geometry };    runAnalyze();
  }

  // Called by MapView on every subsequent exclude/restore draw, with the
  // full accumulated arrays so far.
  function handleAdjustment(adjustment) {
    if (!selectionRef.current) return;
    runAnalyze(adjustment);
  }

  function startNewSelection() {
    selectionRef.current = null;
    setResult(null);
    setError(null);
  }

  const analyzeTimerRef = useRef(null);

  function updateSetting(key, value) {
    setSettings((s) => ({ ...s, [key]: value }));
    if (!selectionRef.current) return;
    // Debounced: range sliders fire onChange continuously while dragging,
    // so wait for a short pause before re-running the analysis. Pass the
    // new value explicitly as an override rather than relying on `settings`
    // state (which won't have updated yet in this closure) to avoid
    // sending a stale request.
    clearTimeout(analyzeTimerRef.current);
    analyzeTimerRef.current = setTimeout(() => {
      runAnalyze({ [key]: value });
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
          <p className="section-title">SELECTED AREA</p>
          {result ? (
            <>
              <p className="empty-state">
                {result.parcel_id ? (
                  <>Prop_ID <strong style={{ color: "var(--brass)" }}>{result.parcel_id}</strong></>
                ) : (
                  "Custom drawn area"
                )}
                {loading ? " — recalculating…" : ""}
              </p>
              <button type="button" className="new-selection-link" onClick={startNewSelection}>
                ← New selection
              </button>
            </>

          ) : (
            <p className="empty-state">
              Click points on the map to draw an area, then click "Calculate Buildable Area" on the shape.
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

          <div className="setback-row">
            <div className="setback-row-head">
              <span>Restore brush radius</span>
              <span className="setback-value">{settings.restore_brush_ft} ft</span>
            </div>
            <input
              type="range"
              min="10"
              max="200"
              step="10"
              value={settings.restore_brush_ft}
              onChange={(e) => setSettings((s) => ({ ...s, restore_brush_ft: Number(e.target.value) }))}
            />
            <p className="field-hint">Right-click excluded (red) land on the map to mark this much of it buildable again.</p>
          </div>
        </div>

        <div className="section">
          <p className="section-title">ANALYSIS LAYERS</p>
          {LAYER_TOGGLES.map((l) => (
            <label className="checkbox-row" key={l.id}>
              <input type="checkbox" checked={layerVisibility[l.id]} onChange={() => toggleLayer(l.id)} />
              <span className="legend-swatch" style={{ background: LAYER_COLORS[l.id] }} />
              {l.label}
            </label>
          ))}
        </div>

        {result && (
          <div className="section">
            <p className="section-title">RESULT</p>
            <div className="stat-grid">
              <div className="stat">
                 <p className="stat-label">SELECTED</p>
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

            {result.restored_acres > 0 && (
            <div className="restore-caution">
                <p><strong>{result.restored_acres.toFixed(2)} ac</strong> manually marked buildable by you.</p>
                <p className="restore-caution-warning">⚠ Double-check this override before relying on it.</p>
              </div>
            )}

            <p className="section-title">BREAKDOWN BY CONSTRAINT</p>
            <p className="breakdown-note">
              Individual values may overlap — they will not sum exactly to the excluded total above.
            </p>
            <table className="breakdown-table">
              <tbody>
                {result.breakdown.map((b, i) => (
                  <tr key={i}>
                    <td>
                      <span className="legend-swatch" style={{ background: LAYER_COLORS[b.layer] || "#c99a46" }} />
                      {LAYER_LABELS[b.layer] || b.layer.replace(/_/g, " ")}
                      {b.buffer_ft ? <span className="breakdown-buffer">+{b.buffer_ft}ft</span> : null}
                      <div className="breakdown-reason">{b.reason}</div>
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
        onAreaSelected={handleAreaSelected}
        layerVisibility={layerVisibility}
        restoreBrushFt={settings.restore_brush_ft}
       />

    </div>
  );
}