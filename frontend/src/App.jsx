import React, { useState, useCallback, useRef, useEffect } from "react";
import HistoryList from "./components/HistoryList.jsx";
import MapView from "./components/map/Mapdraw.jsx";
import { LAYER_COLORS, LAYER_LABELS } from "./map/layerColors.js";
import { analyzeArea } from "./features/analysis/analysisApi.js";
import {
  loadPrefs, loadSession, readSession, replaceSession, saveSession, clearSession,
  patchPrefs, archiveSession, loadHistory, removeHistoryEntry, clearHistory,
} from "./features/persistence/sessionStore.js";

const LAYER_TOGGLES = [
  { id: "parcel",       label: "Parcel boundary" },
  { id: "buildable",    label: "Buildable area" },
  { id: "excluded",     label: "Excluded (constraints)" },
  { id: "wetlands",     label: "Wetlands" },
  { id: "fema_flood",   label: "FEMA flood zones" },
  { id: "buildings",    label: "Building footprints/buffers" },
  { id: "transmission", label: "Transmission lines" },
];

const SLIDERS = [
  { key: "wetland_buffer_ft",      label: "Wetland buffer",      min: 0, max: 300, step: 5 },
  { key: "building_setback_ft",    label: "Building setback",    min: 0, max: 300, step: 5 },
  { key: "transmission_buffer_ft", label: "Transmission buffer", min: 0, max: 400, step: 10 },
];

const PANEL_MIN = 280;
const PANEL_DEFAULT = 340;

const DEFAULT_SETTINGS = {
  wetland_buffer_ft: 50, building_setback_ft: 50, transmission_buffer_ft: 100,
  exclude_sfha: true, restore_brush_ft: 60,
};

// Read once at page load. An expired session is moved to History here.
const BOOT = { prefs: loadPrefs(), session: loadSession() };

export default function App() {
  const [result, setResult]   = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError]     = useState(null);
  const [panelW, setPanelW] = useState(() => Math.max(PANEL_MIN, Math.min(620, BOOT.prefs.panelW ?? PANEL_DEFAULT)));
  const [segmentSlot, setSegmentSlot] = useState(null); // portal target for "Land pieces"
  const [settings, setSettings] = useState({ ...DEFAULT_SETTINGS, ...BOOT.prefs.settings });
  const [dockOpen, setDockOpen] = useState(BOOT.prefs.dockOpen ?? true);
  const [historyList, setHistoryList] = useState(loadHistory);
  const [restoreRequest, setRestoreRequest] = useState(
    BOOT.session ? { session: BOOT.session, boot: true, nonce: 0 } : null,
  );
  const [layerVisibility, setLayerVisibility] = useState({
    ...Object.fromEntries(LAYER_TOGGLES.map((l) => [l.id, true])),
    ...BOOT.prefs.layerVisibility,
  });
  const selectionRef = useRef(BOOT.session?.selection ?? null);   // was useRef(null)
  const adjustTimerRef = useRef(null);
  const runAnalyzeRef = useRef(null);
  const adjustmentRef   = useRef({});
  const requestIdRef    = useRef(0);
  const analyzeTimerRef = useRef(null);
  const draggingRef     = useRef(false);

  const runAnalyze = useCallback(async (target, extra = {}) => {
    if (!target) return;
    const id = ++requestIdRef.current;
    setLoading(true); setError(null);
    try {
      const data = await analyzeArea({ ...target, ...settings, ...adjustmentRef.current, ...extra });
      if (id !== requestIdRef.current) return;
      setResult(data);
    } catch (e) {
      if (id !== requestIdRef.current) return;
      setError(e.message);
    } finally {
      if (id === requestIdRef.current) setLoading(false);
    }
  }, [settings]);

  runAnalyzeRef.current = runAnalyze;

  

  function handleAreaSelected(geometry) {
    adjustmentRef.current = {};
    selectionRef.current  = { custom_geometry: geometry };
    replaceSession({ selection: selectionRef.current });
    runAnalyze(selectionRef.current);
  }
  function handleAdjustment(adj) {
    if (!selectionRef.current) return;
    adjustmentRef.current = adj;
    setLoading(true);
    clearTimeout(adjustTimerRef.current);
    adjustTimerRef.current = setTimeout(() => {
      runAnalyzeRef.current?.(selectionRef.current, adj);
    }, 120);
  }
  function startNewSelection() {
    const current = readSession();
    if (current?.selection) { archiveSession(current, "replaced"); setHistoryList(loadHistory()); }
    clearSession();
    clearTimeout(adjustTimerRef.current);
    selectionRef.current = null; adjustmentRef.current = {};
    setResult(null); setError(null);
  }
  function updateSetting(key, value) {
    setSettings((s) => ({ ...s, [key]: value }));
    if (!selectionRef.current) return;
    clearTimeout(analyzeTimerRef.current);
    analyzeTimerRef.current = setTimeout(() => {
      runAnalyze(selectionRef.current, { [key]: value });
    }, 300);
  }
  function toggleLayer(id) {
    setLayerVisibility((v) => ({ ...v, [id]: !v[id] }));
  }

  function restoreFromHistory(id) {
    const entry = loadHistory().find((e) => e.id === id);
    if (!entry) return;
    const current = readSession();
    if (current?.selection) archiveSession(current, "replaced");   // don't lose what's open now
    removeHistoryEntry(id);

    clearTimeout(analyzeTimerRef.current);
    clearTimeout(adjustTimerRef.current);
    requestIdRef.current += 1;                    // drop any analysis still in flight
    selectionRef.current = entry.session.selection;
    adjustmentRef.current = {};
    replaceSession(entry.session);
    setResult(null);
    setLoading(true);
    setError(null);
    setRestoreRequest((r) => ({ session: entry.session, boot: false, nonce: (r?.nonce ?? 0) + 1 }));
    setHistoryList(loadHistory());
  }
  function deleteHistory(id) { removeHistoryEntry(id); setHistoryList(loadHistory()); }
  function clearAllHistory() { clearHistory(); setHistoryList([]); }

  useEffect(() => {
    patchPrefs({ settings, layerVisibility, panelW, dockOpen });
  }, [settings, layerVisibility, panelW, dockOpen]);

  useEffect(() => {
    if (result) saveSession({ summary: { parcel_acres: result.parcel_acres, buildable_acres: result.buildable_acres } });
  }, [result]);

  // ── Resizable right panel ──
  function onHandleDown(e) {
    draggingRef.current = true;
    e.currentTarget.setPointerCapture(e.pointerId);
  }
  function onHandleMove(e) {
    if (!draggingRef.current) return;
    const max = Math.min(620, Math.round(window.innerWidth * 0.5));
    setPanelW(Math.max(PANEL_MIN, Math.min(max, window.innerWidth - e.clientX)));
  }
  function onHandleUp(e) {
    draggingRef.current = false;
    e.currentTarget.releasePointerCapture?.(e.pointerId);
  }

  const totalExcluded = result
    ? Math.max(...(result.breakdown?.map((b) => parseFloat(b.acres_removed)) ?? [1]), 1)
    : 1;

  const buildableRatio = result
    ? Math.min(100, (parseFloat(result.buildable_acres) / parseFloat(result.parcel_acres)) * 100)
    : 0;

  return (
    <div className="app-shell" style={{ "--panel-w": `${panelW}px` }}>
      <MapView
        result={result}
        onAdjustment={handleAdjustment}
        onAreaSelected={handleAreaSelected}
        layerVisibility={layerVisibility}
        restoreBrushFt={settings.restore_brush_ft}
        segmentSlot={segmentSlot}
        initial={{ prefs: BOOT.prefs, view: BOOT.session?.view }}
        restoreRequest={restoreRequest}
      />
            {/* Centre-of-map loader: first calculation / restore only */}
      {loading && !result && (
        <div className="map-loading" role="status" aria-live="polite">
          <div className="map-loading-card">
            <div className="ring" />
            <p className="map-loading-title">Analysing land…</p>
            <p className="map-loading-sub">Checking wetlands, flood zones and buildings</p>
          </div>
        </div>
      )}

      {/* ───────── LEFT PANEL: name, setbacks, checkboxes, layers ───────── */}
      <aside className="left-panel">
        <div className="rp-header">
          <p className="rp-eyebrow">HARRIS COUNTY, TX</p>
          <p className="rp-title">Buildable Land Analysis</p>
        </div>

        <div className="rp-body">
          <div className="rp-section">
            <p className="rp-section-label">Setbacks</p>

            {SLIDERS.map(({ key, label, min, max, step }) => (
              <div className="rp-slider-row" key={key}>
                <div className="rp-slider-head">
                  <span>{label}</span>
                  <span className="rp-slider-val">{settings[key]} ft</span>
                </div>
                <input type="range" min={min} max={max} step={step}
                  value={settings[key]}
                  onChange={(e) => updateSetting(key, Number(e.target.value))} />
              </div>
            ))}

            <label className="rp-checkbox">
              <input type="checkbox" checked={settings.exclude_sfha}
                onChange={(e) => updateSetting("exclude_sfha", e.target.checked)} />
              Exclude FEMA flood zones
            </label>

            <div className="rp-slider-row" style={{ marginTop: 12 }}>
              <div className="rp-slider-head">
                <span>Restore brush</span>
                <span className="rp-slider-val">{settings.restore_brush_ft} ft</span>
              </div>
              <input type="range" min="10" max="200" step="10"
                value={settings.restore_brush_ft}
                onChange={(e) => setSettings((s) => ({ ...s, restore_brush_ft: Number(e.target.value) }))} />
              <p className="rp-hint">Right-click red land to restore it.</p>
            </div>
          </div>

          <div className="rp-section">
            <p className="rp-section-label">Layers</p>
            {LAYER_TOGGLES.map((l) => (
              <label className="rp-layer-row" key={l.id}>
                <input type="checkbox" checked={layerVisibility[l.id]} onChange={() => toggleLayer(l.id)} />
                <span className="rp-swatch" style={{ background: LAYER_COLORS[l.id] }} />
                <span className="rp-layer-label">{l.label}</span>
              </label>
            ))}
          </div>
          <HistoryList
              entries={historyList}
              onRestore={restoreFromHistory}
              onDelete={deleteHistory}
              onClear={clearAllHistory}
          />
        </div>
      </aside>

      {/* ───────── RIGHT PANEL: analysis + summary only ───────── */}
      <aside className="right-panel">
        <div
          className="rp-resize"
          onPointerDown={onHandleDown}
          onPointerMove={onHandleMove}
          onPointerUp={onHandleUp}
          onDoubleClick={() => setPanelW(PANEL_DEFAULT)}
          title="Drag to resize · double-click to reset"
        />

        <div className="rp-header">
          <p className="rp-title">Analysis</p>
        </div>
        <div className="rp-body-wrap">
        <div className="rp-body">
          <div className="rp-section">
            <p className="rp-section-label">Selected area</p>
            {result ? (
              <div className="rp-selected">
                <span className="rp-selected-name">
                  {result.parcel_id
                    ? <>Prop ID <strong>{result.parcel_id}</strong></>
                    : "Custom drawn area"}
                  {loading && <span className="rp-recalc"> · recalculating…</span>}
                </span>
                <button className="rp-new-selection" onClick={startNewSelection}>← New selection</button>
              </div>
            ) : (
              <p className="rp-empty">Draw an area on the map, then confirm to analyse it.</p>
            )}
            {error && <p className="rp-error">{error}</p>}
          </div>

          {result && (
            <>
              <div className="rp-section rp-stats-section">
                <div className="rp-stats">
                  <div className="rp-stat">
                    <span className="rp-stat-icon">⬡</span>
                    <span className="rp-stat-label">Selected</span>
                    <span className="rp-stat-val">{result.parcel_acres} <em>ac</em></span>
                  </div>
                  <div className="rp-stat">
                    <span className="rp-stat-icon" style={{ color: "var(--buildable)" }}>◼</span>
                    <span className="rp-stat-label">Buildable</span>
                    <span className="rp-stat-val" style={{ color: "var(--buildable)" }}>{result.buildable_acres} <em>ac</em></span>
                  </div>
                  <div className="rp-stat">
                    <span className="rp-stat-icon rp-ratio-icon">◔</span>
                    <span className="rp-stat-label">Ratio</span>
                    <span className="rp-stat-val rp-ratio-val">{buildableRatio.toFixed(1)}%</span>
                  </div>
                </div>
              </div>

              {result.breakdown?.length > 0 && (
                <div className="rp-section">
                  <p className="rp-section-label">Breakdown</p>
                  <p className="rp-note">Values may overlap.</p>
                  {result.breakdown.map((b, i) => {
                    const pct = Math.min(100, (parseFloat(b.acres_removed) / totalExcluded) * 100);
                    return (
                      <div className="rp-breakdown-row" key={i}>
                        <div className="rp-breakdown-top">
                          <span className="rp-breakdown-name">
                            <span className="rp-swatch" style={{ background: LAYER_COLORS[b.layer] || "#c99a46" }} />
                            {LAYER_LABELS[b.layer] || b.layer.replace(/_/g, " ")}
                            {b.buffer_ft ? <span className="rp-buf">+{b.buffer_ft}ft</span> : null}
                          </span>
                          <span className="rp-breakdown-acres">−{b.acres_removed} ac</span>
                          <span className="rp-breakdown-pct">{pct.toFixed(1)}%</span>
                        </div>
                        <div className="rp-bar-track">
                          <div className="rp-bar-fill" style={{ width: `${pct}%`, background: LAYER_COLORS[b.layer] || "#c99a46" }} />
                        </div>
                      </div>
                    );
                  })}

                  <div className="rp-breakdown-row rp-usable-row">
                    <div className="rp-breakdown-top">
                      <span className="rp-breakdown-name">
                        <span className="rp-swatch" style={{ background: "var(--buildable)" }} />
                        Usable land
                      </span>
                      <span className="rp-breakdown-acres" style={{ color: "var(--buildable)" }}>{result.buildable_acres} ac</span>
                      <span className="rp-breakdown-pct" style={{ color: "var(--buildable)" }}>{buildableRatio.toFixed(1)}%</span>
                    </div>
                    <div className="rp-bar-track">
                      <div className="rp-bar-fill" style={{ width: `${buildableRatio}%`, background: "var(--buildable)" }} />
                    </div>
                  </div>

                  {result.restored_acres > 0 && (
                    <div className="rp-restore-note">
                      ⚠ {result.restored_acres.toFixed(2)} ac marked buildable by you — verify before use.
                    </div>
                  )}
                  {result.note && <p className="rp-disclosure">{result.note}</p>}
                </div>
              )}
            </>
          )}  
        </div>
              {/* Centre-of-map loader: first calculation / restore only */}
          {loading && !result && (
            <div className="map-loading" role="status" aria-live="polite">
              <div className="map-loading-card">
                <div className="ring" />
                <p className="map-loading-title">Analysing land…</p>
                <p className="map-loading-sub">Checking wetlands, flood zones and buildings</p>
              </div>
            </div>
          )}
        </div>
        {result && (
          <div className="rp-dock">
            {/* list expands upward, above the bar */}
            <div ref={setSegmentSlot} className="rp-dock-body" hidden={!dockOpen} />
            <button
              type="button"
              className="rp-dock-bar"
              onClick={() => setDockOpen((o) => !o)}
              aria-expanded={dockOpen}
            >
              <span>Land pieces</span>
              <span className="rp-dock-arrow">{dockOpen ? "▾" : "▴"}</span>
            </button>
          </div>
        )}
      </aside>
    </div>
  );
}