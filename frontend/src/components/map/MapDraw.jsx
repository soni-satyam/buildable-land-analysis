import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import "maplibre-gl/dist/maplibre-gl.css";
import "../../styles/segments.css";
import "../../styles/drawTools.css";
import { ANALYSIS_LAYER_IDS } from "../../map/constants.js";

import { useMapInstance } from "../../map/useMapInstance.js";
import { useMapSearch } from "../../features/search/useMapSearch.js";
import { useDrawTool } from "../../map/useDrawTool.js";
import { useTransientInk } from "../../map/useTransientInk.js";
import { useSketchTool } from "../../map/useSketchTool.js";
import { useViewportParcels } from "../../features/parcels/useViewportParcels.js";
import { useAnalysisLayers } from "../../features/analysis/useAnalysisLayers.js";
import { linesToArea } from "../../features/selection/selectionApi.js";
import { useAdjustments } from "../../features/analysis/useAdjustments.js";
import { useSegmentOverrides } from "../../features/segments/useSegmentOverrides.js";
import { useSegmentInteractions } from "../../features/segments/useSegmentInteractions.js";
import { useUserRegions } from "../../features/segments/useUserRegions.js";
import { useHistory } from "../../map/useHistory.js";

import MapSearchBox from "./MapSearchBox.jsx";
import BasemapSwitcher from "./BasemapSwitcher.jsx";
import DrawToolbar from "./Drawtoolbar.jsx";
import SegmentHoverTag from "./SegmentHoverTag.jsx";
import SegmentOverridePanel from "./SegmentOverridePanel.jsx";
import { polygonAreaAcres, geometryBounds } from "../../map/geometryUtils.js";
import { patchPrefs, saveSession } from "../../features/persistence/sessionStore.js";

// Short hints — shown briefly, then fade out.
const HINT_MS = 4000;

const TOOL_HINTS = {
  polygon: "Click points; click the last one to finish.",
  rectangle: "Click two opposite corners.",
  circle: "Click the centre, then click to set the radius.",
  line: "Click points, double-click to end a line. Lines must enclose the land.",
  freehand: "Click points; Enter closes the shape.",
  laser: "Point only — nothing is changed.",
  brush: "Paint freely. Ink fades and isn't analysed.",
  pan: "Drag to move the map.",
};

const SHAPE_TOOLS = new Set(["polygon", "rectangle", "circle", "line", "freehand"]);

export default function MapView({
  result,
  onAdjustment,
  onAreaSelected,
  layerVisibility,
  restoreBrushFt,
  segmentSlot,   // DOM element inside the right panel where "Land pieces" renders
  onError,
  initial, 
  restoreRequest,
}) {
  const containerRef = useRef(null);
  const inkCanvasRef = useRef(null);
  const hasResultRef = useRef(false);
  hasResultRef.current = Boolean(result);

  const parcelGeometryRef = useRef(null);
  parcelGeometryRef.current = result?.geometry?.parcel ?? null;

  const [tool, setTool] = useState(initial?.prefs?.tool ?? "pan");
  const [brushColor, setBrushColor] = useState(initial?.prefs?.brushColor ?? "#ffd60a");
  const presenting = tool === "laser" || tool === "brush";

  const [toast, setToast] = useState(null);
  const toastTimer = useRef(null);

  const notify = useCallback((message) => {
    setToast(message);
    clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(null), 2600);
  }, []);

  useEffect(() => () => clearTimeout(toastTimer.current), []);

  const { mapRef, ready, mapError, basemap, switchBasemap } = useMapInstance(containerRef, {
    initialBasemap: initial?.prefs?.basemap,
    initialView: initial?.view,
  });

  const search = useMapSearch(mapRef);

  const handleResetView = useCallback(() => {
    const map = mapRef.current;
    if (!map) return;

    // parcelGeometryRef always holds the current analysed selection (or null)
    const parcel = parcelGeometryRef.current;
    const bounds = parcel ? geometryBounds(parcel) : null;

    if (bounds) {
      // A land selection exists: recentre on it
      map.fitBounds(bounds, {
        padding: { top: 90, bottom: 80, left: 340, right: 400 },
        maxZoom: 17,
        duration: 800,
      });
    } else {
      // Nothing selected: back to Harris County
      search.resetToHarrisCounty();
    }
  }, [mapRef, search.resetToHarrisCounty]);

  const adjustments = useAdjustments({ onAdjustment, restoreBrushFt });

  const {
    overrides,
    overridesRef,
    toggle,
    undo: undoOverride,
    clearAll,
    reset: resetOverrides,
    restore: restoreOverrides,
  } = useSegmentOverrides(adjustments.setSegmentOverrides);

  const {
    regions: userRegions,
    regionsRef: userRegionsRef,
    addRegion,
    cycleMode: cycleUserRegionMode,
    removeRegion,
    reset: resetUserRegions,
    restore: restoreUserRegions,
  } = useUserRegions(adjustments.setUserRegions);

  const resetAdjustments = adjustments.reset;

  const { zoomedOut } = useViewportParcels(mapRef, ready);
  const skipFitRef = useRef(Boolean(initial?.view));

  useAnalysisLayers(mapRef, ready, {
    result,
    overrides,
    visibility: layerVisibility,
    userRegions,
    skipFitRef,
  });

  const takeSnapshot = useCallback(() => ({
    drawnShapes: [...drawnShapesRef.current],
    drawnExcludes: [...adjustments.getLists().drawnExcludes],
    brushRestores: [...adjustments.getLists().brushRestores],
    userRegions: [...userRegionsRef.current],
  }), []); // no deps — reads refs directly, always current

  const applySnapshotRef = useRef(null);

  const history = useHistory(
    (snapshot) => applySnapshotRef.current?.(snapshot),
  );

  const historyRef = useRef(history);
  historyRef.current = history;

  const {
    hasPending,
    resetDraw,
    submitShape,
    drawnShapesRef,
    pendingGeometryRef,
    restoreDrawn,
  } = useDrawTool(mapRef, ready, {
    tool,
    hasResultRef,
    parcelGeometryRef,

    onAreaSelected: (geometry) => {
      resetOverrides();
      resetUserRegions();
      resetAdjustments();
      historyRef.current.reset();
      skipFitRef.current = false;
      onAreaSelected?.(geometry);
    },

    onSubSelect: (geometry) => {
      addRegion(geometry, polygonAreaAcres(geometry));
      historyRef.current.push(takeSnapshot());
    },

    onExclude: (geometry) => {
      adjustments.addExclude(geometry);
      historyRef.current.push(takeSnapshot());
    },

    onError,
  });

  applySnapshotRef.current = (snapshot) => {
    if (!snapshot) {
      restoreDrawn([]);
      adjustments.restoreDrawnAndBrush([], []);
      restoreUserRegions([]);
      return;
    }
    restoreDrawn(snapshot.drawnShapes);
    adjustments.restoreDrawnAndBrush(snapshot.drawnExcludes, snapshot.brushRestores);
    restoreUserRegions(snapshot.userRegions);
  };

  const sketch = useSketchTool(mapRef, ready, {
    tool,
    submitShape,
    resolveLines: linesToArea,
    notify,
  });

  const { clearInk } = useTransientInk(mapRef, ready, inkCanvasRef, {
    tool,
    color: brushColor,
  });

  const { hovered } = useSegmentInteractions(mapRef, ready, {
    result,

    onToggleSegment: (key, segment) => {
      if (presenting) return;
      toggle(key, segment);
    },

    onRestoreAt: (lngLat) => {
      if (presenting || !hasResultRef.current) return;
      adjustments.restoreAt(lngLat);
    },

    onCycleUserRegion: (id) => {
      if (presenting) return;
      cycleUserRegionMode(id);
    },
  });

  // Keyboard shortcuts.
  useEffect(() => {
    const onKey = (e) => {
      if (e.target?.tagName === "INPUT" || e.target?.tagName === "TEXTAREA") return;
      if (tool === "line" || tool === "freehand") return; // sketch handles Ctrl+Z itself

      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "z" && !e.shiftKey) {
        e.preventDefault();
        history.undo();
      }

      if (
        (e.ctrlKey || e.metaKey) &&
        (e.key.toLowerCase() === "y" || (e.key.toLowerCase() === "z" && e.shiftKey))
      ) {
        e.preventDefault();
        history.redo();
      }
    };

    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tool, history.undo, history.redo]);

  // New selection clears everything.
  useEffect(() => {
    if (!result) {
      resetOverrides();
      resetUserRegions();
      resetAdjustments();
      history.reset();
      resetDraw();
      sketch.clearAll();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [result]);

  const activeLayerKeys = result
    ? ANALYSIS_LAYER_IDS.filter(
        (id) =>
          id === "parcel" ||
          id === "buildable" ||
          id === "excluded" ||
          result.layers?.[id],
      )
    : [];

  let hint = TOOL_HINTS[tool];
    // ───────── Persistence ─────────
  // Nothing is written until stored work has been restored, otherwise the
  // empty initial state would overwrite it.
  const canSaveRef = useRef(!restoreRequest);
  const saveTimer = useRef(null);

  const saveMapState = useCallback(() => {
    const map = mapRef.current;
    if (!map || !canSaveRef.current) return;
    const c = map.getCenter();
    const h = historyRef.current.getState();
    saveSession({
      view: { center: [c.lng, c.lat], zoom: map.getZoom(), bearing: map.getBearing(), pitch: map.getPitch() },
      overrides: overridesRef.current,
      userRegions: userRegionsRef.current,
      drawnShapes: drawnShapesRef.current,
      drawnExcludes: adjustments.getLists().drawnExcludes,
      brushRestores: adjustments.getLists().brushRestores,
      history: { past: h.past.slice(-50), future: h.future.slice(0, 50) },
      pending: pendingGeometryRef.current,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const scheduleSave = useCallback(() => {
    clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(saveMapState, 400);
  }, [saveMapState]);

  // Work changed -> save.
  useEffect(() => { scheduleSave(); }, [result, overrides, userRegions, hasPending, scheduleSave]);

  // Map moved -> save the view.
  useEffect(() => {
    if (!ready) return undefined;
    const map = mapRef.current;
    map.on("moveend", scheduleSave);
    return () => map.off("moveend", scheduleSave);
  }, [ready, scheduleSave, mapRef]);

  // Preferences.
  useEffect(() => { patchPrefs({ tool, brushColor }); }, [tool, brushColor]);
  useEffect(() => { patchPrefs({ basemap }); }, [basemap]);

  // Flush immediately when the tab is hidden, closed or refreshed.
  useEffect(() => {
    const flush = () => { clearTimeout(saveTimer.current); saveMapState(); };
    const onVis = () => { if (document.visibilityState === "hidden") flush(); };
    window.addEventListener("pagehide", flush);
    document.addEventListener("visibilitychange", onVis);
    return () => {
      window.removeEventListener("pagehide", flush);
      document.removeEventListener("visibilitychange", onVis);
    };
  }, [saveMapState]);

  // Put a saved (or archived) session back once the map is ready.
  useEffect(() => {
    if (!ready || !restoreRequest) return;
    const s = restoreRequest.session || {};
    try {
      skipFitRef.current = Boolean(restoreRequest.boot && s.view);
      resetDraw();
      sketch.clearAll();
      resetOverrides();
      resetUserRegions();
      resetAdjustments();
      historyRef.current.reset();

      restoreOverrides(s.overrides ?? {});
      restoreUserRegions(s.userRegions ?? []);
      restoreDrawn(s.drawnShapes ?? []);
      historyRef.current.load(s.history);
      // Last: this emits the complete set of edits, which triggers the analysis.
      adjustments.restoreDrawnAndBrush(s.drawnExcludes ?? [], s.brushRestores ?? []);

      if (s.pending && !s.selection) submitShape(s.pending);   // drawn but never calculated
    } catch (e) {
      console.warn("Could not restore the saved session:", e);
    } finally {
      canSaveRef.current = true;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, restoreRequest]);

  if (SHAPE_TOOLS.has(tool)) {
    if (hasPending) {
      hint = 'Click "Calculate Buildable Area".';
    } else if (result) {
      hint = "Draw inside to add a region, outside to exclude. Right-click a segment to flip it.";
    }
  }

  // Show the hint whenever it changes, then fade it out after a few seconds.
  const [hintVisible, setHintVisible] = useState(true);
  useEffect(() => {
    if (!hint) return undefined;
    setHintVisible(true);
    const t = setTimeout(() => setHintVisible(false), HINT_MS);
    return () => clearTimeout(t);
  }, [hint]);

  return (
    <div className={`map-area tool-${tool}`}>
      {/* Map canvas first so overlays stack above it */}
      <div ref={containerRef} className="map-container" />
      <canvas ref={inkCanvasRef} className="ink-canvas" />

      <MapSearchBox
        query={search.searchQuery}
        onQueryChange={search.setSearchQuery}
        results={search.searchResults}
        searching={search.searching}
        onSubmit={search.runSearch}
        onPick={search.flyToSearchResult}
        onReset={handleResetView}
      />

      {/* Toolbar attached to the right edge of the left panel */}
      <DrawToolbar
        tool={tool}
        onToolChange={setTool}
        sketch={sketch}
        brushColor={brushColor}
        onBrushColorChange={setBrushColor}
        onClearInk={clearInk}
        canUndo={history.canUndo}
        canRedo={history.canRedo}
        onUndo={hasPending ? resetDraw : history.undo}
        onRedo={history.redo}
      />

      {/* Transient hint + toast, centred in the free map area */}
      <div className="center-strip hint-strip">
        {hint && (
          <span className={`draw-hint${hintVisible ? " show" : ""}`}>{hint}</span>
        )}
      </div>

      {toast && (
        <div className="center-strip toast-strip">
          <span className="map-toast" role="alert">{toast}</span>
        </div>
      )}

      {mapError && (
        <div className="center-strip error-strip">
          <span className="map-error-banner">{mapError}</span>
        </div>
      )}

      {/* "Land pieces" lives in the right (Analysis) panel via a portal */}
      {result && segmentSlot && createPortal(
        <SegmentOverridePanel
          overrides={overrides}
          onUndo={undoOverride}
          onClearAll={clearAll}
          userRegions={userRegions}
          onRemoveRegion={removeRegion}
        />,
        segmentSlot,
      )}

      <SegmentHoverTag hovered={hovered} overrides={overrides} />

      {/* Basemaps: bottom, just left of the right panel (not attached) */}
      <BasemapSwitcher basemap={basemap} onChange={switchBasemap} />
    </div>
  );
}