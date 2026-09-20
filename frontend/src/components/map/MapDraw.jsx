import { useCallback, useEffect, useRef, useState } from "react";
import "maplibre-gl/dist/maplibre-gl.css";
import "../../styles/segments.css";
import "../../styles/drawTools.css";
import { LAYER_COLORS, LAYER_LABELS } from "../../map/layerColors.js";
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
import { polygonAreaAcres } from "../../map/geometryUtils.js";

const TOOL_HINTS = {
  polygon: "Click points on the map, then click the last point again to finish.",
  rectangle: "Click one corner, then click the opposite corner.",
  circle: "Click the center, then click again to set the radius.",
  line: "Outline the land with lines: click points, double-click to end a line. The lines must connect to enclose the land.",
  freehand: "Click points around the land; they are joined in order. Click the first point, double-click, or press Enter to close. Backspace removes the last point.",
  laser: "Move the cursor to point at things. Nothing is selected or changed.",
  brush: "Hold the mouse button and paint. Ink fades after a few seconds and is never analysed.",
  pan: "Drag to move the map.",
};

const SHAPE_TOOLS = new Set(["polygon", "rectangle", "circle", "line", "freehand"]);

export default function MapView({
  result,
  onAdjustment,
  onAreaSelected,
  layerVisibility,
  restoreBrushFt,
  onError,
}) {
  const containerRef = useRef(null);
  const inkCanvasRef = useRef(null);
  const hasResultRef = useRef(false);
  hasResultRef.current = Boolean(result);

  const parcelGeometryRef = useRef(null);
  parcelGeometryRef.current = result?.geometry?.parcel ?? null;

  const [tool, setTool] = useState("polygon");
  const [brushColor, setBrushColor] = useState("#ffd60a");
  const presenting = tool === "laser" || tool === "brush";

  const [toast, setToast] = useState(null);
  const toastTimer = useRef(null);

  const notify = useCallback((message) => {
    setToast(message);
    clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(null), 2600);
  }, []);

  useEffect(() => () => clearTimeout(toastTimer.current), []);

  const { mapRef, ready, mapError, basemap, switchBasemap } =
    useMapInstance(containerRef);

  const search = useMapSearch(mapRef);

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

  useAnalysisLayers(mapRef, ready, {
    result,
    overrides,
    visibility: layerVisibility,
    userRegions,
  });

  const takeSnapshot = useCallback(() => ({
      drawnShapes: [...drawnShapesRef.current],
      drawnExcludes: [...adjustments.getLists().drawnExcludes],
      brushRestores: [...adjustments.getLists().brushRestores],
      userRegions: [...userRegionsRef.current],
    }),[]); // no deps — reads refs directly, always current

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

  const { clearInk } = useTransientInk(
    mapRef,
    ready,
    inkCanvasRef,
    {
      tool,
      color: brushColor,
    },
  );

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
      if (
        e.target?.tagName === "INPUT" ||
        e.target?.tagName === "TEXTAREA"
      ) {
        return;
      }

      if (tool === "line" || tool === "freehand") {
        return; // sketch handles Ctrl+Z itself
      }

      if (
        (e.ctrlKey || e.metaKey) &&
        e.key.toLowerCase() === "z" &&
        !e.shiftKey
      ) {
        e.preventDefault();
        history.undo();
      }

      if (
        (e.ctrlKey || e.metaKey) &&
        (
          e.key.toLowerCase() === "y" ||
          (e.key.toLowerCase() === "z" && e.shiftKey)
        )
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

  if (SHAPE_TOOLS.has(tool)) {
    if (hasPending) {
      hint = 'Click "Calculate Buildable Area" to analyze the selected land.';
    } else if (result) {
      hint =
        "Draw inside your land to mark a custom region (right-click to set buildable/non-buildable). Draw outside to exclude that area. Right-click a highlighted segment to flip it.";
    }
  }

  return (
    <div className={`map-area tool-${tool}`}>
      <MapSearchBox
        query={search.searchQuery}
        onQueryChange={search.setSearchQuery}
        results={search.searchResults}
        searching={search.searching}
        onSubmit={search.runSearch}
        onPick={search.flyToSearchResult}
        onReset={search.resetToHarrisCounty}
      />

      <BasemapSwitcher
        basemap={basemap}
        onChange={switchBasemap}
      />

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

      <div className="draw-hint">{hint}</div>

      {toast && (
        <div className="map-toast" role="alert">
          {toast}
        </div>
      )}

      {zoomedOut && (
        <div className="zoom-hint">
          Zoom in to see reference parcel boundaries
        </div>
      )}

      {result && activeLayerKeys.length > 0 && (
        <div className="legend">
          {activeLayerKeys.map((id) => (
            <div className="legend-item" key={id}>
              <span
                className="legend-swatch"
                style={{ background: LAYER_COLORS[id] }}
              />
              {LAYER_LABELS[id]}
            </div>
          ))}
        </div>
      )}

      {mapError && (
        <div className="map-error-banner">
          {mapError}
        </div>
      )}

      <div
        ref={containerRef}
        style={{ width: "100%", height: "100%" }}
      />

      <canvas
        ref={inkCanvasRef}
        className="ink-canvas"
      />

      {result && (
        <SegmentOverridePanel
          overrides={overrides}
          onUndo={undoOverride}
          onClearAll={clearAll}
          userRegions={userRegions}
          onRemoveRegion={removeRegion}
        />
      )}

      <SegmentHoverTag
        hovered={hovered}
        overrides={overrides}
      />
    </div>
  );
}