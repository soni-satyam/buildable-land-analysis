import { useCallback, useEffect, useRef, useState } from "react";
import "maplibre-gl/dist/maplibre-gl.css";
import "../../styles/segments.css";
import "../../styles/drawTools.css";
import { LAYER_COLORS, LAYER_LABELS } from "../../layerColors.js";
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

import MapSearchBox from "./MapSearchBox.jsx";
import BasemapSwitcher from "./BasemapSwitcher.jsx";
import DrawToolbar from "./DrawToolbar.jsx";
import SegmentHoverTag from "./SegmentHoverTag.jsx";
import SegmentOverridePanel from "./SegmentOverridePanel.jsx";

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

/**
 * Props (unchanged): result, onAdjustment, onAreaSelected, layerVisibility, restoreBrushFt
 * Optional: onError(message)
 */
export default function MapView({ result, onAdjustment, onAreaSelected, layerVisibility, restoreBrushFt, onError }) {
  const containerRef = useRef(null);
  const inkCanvasRef = useRef(null);
  const hasResultRef = useRef(false);
  hasResultRef.current = Boolean(result);

  const [tool, setTool] = useState("polygon");
  const [brushColor, setBrushColor] = useState("#ffd60a");
  const presenting = tool === "laser" || tool === "brush";

  // Short, self-dismissing notice (e.g. "Land not selected").
  const [toast, setToast] = useState(null);
  const toastTimer = useRef(null);
  const notify = useCallback((message) => {
    setToast(message);
    clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(null), 2600);
  }, []);
  useEffect(() => () => clearTimeout(toastTimer.current), []);

  const { mapRef, ready, mapError, basemap, switchBasemap } = useMapInstance(containerRef);
  const search = useMapSearch(mapRef);

  const adjustments = useAdjustments({ onAdjustment, restoreBrushFt });
  const { overrides, toggle, undo, clearAll, reset: resetOverrides } = useSegmentOverrides(adjustments.setSegmentOverrides);
  const resetAdjustments = adjustments.reset;

  // Hook order = layer stacking order: parcels < analysis + segments < pending selection < sketch.
  const { zoomedOut } = useViewportParcels(mapRef, ready);
  useAnalysisLayers(mapRef, ready, { result, overrides, visibility: layerVisibility });
  const { hasPending, resetDraw, submitShape } = useDrawTool(mapRef, ready, {
    tool,
    hasResultRef,
    onAreaSelected: (geometry) => {
      resetOverrides();   // segment ids belong to one analysis
      resetAdjustments(); // a new area starts from a clean slate
      onAreaSelected?.(geometry);
    },
    onExclude: adjustments.addExclude,
    onError,
  });
  const sketch = useSketchTool(mapRef, ready, { tool, submitShape, resolveLines: linesToArea, notify });
  const { clearInk } = useTransientInk(mapRef, ready, inkCanvasRef, { tool, color: brushColor });

  // While presenting (laser / brush) a stray right-click must not flip pieces or paint a restore.
  const { hovered } = useSegmentInteractions(mapRef, ready, {
    result,
    onToggleSegment: (key, segment) => !presenting && toggle(key, segment),
    onRestoreAt: (lngLat) => !presenting && hasResultRef.current && adjustments.restoreAt(lngLat),
  });

  // "New selection" clears the result -> drop every manual edit and pending shape.
  useEffect(() => {
    if (!result) {
      resetOverrides();
      resetAdjustments();
      resetDraw();
      sketch.clearAll();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [result]);

  const activeLayerKeys = result
    ? ANALYSIS_LAYER_IDS.filter((id) => id === "parcel" || id === "buildable" || id === "excluded" || result.layers?.[id])
    : [];

  let hint = TOOL_HINTS[tool];
  if (SHAPE_TOOLS.has(tool)) {
    if (hasPending) hint = 'Click "Calculate Buildable Area" to analyze the selected land.';
    else if (result) hint = "Shapes you draw now are excluded. Right-click a highlighted piece to flip it, or other excluded (red) land to restore a small area.";
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
      <BasemapSwitcher basemap={basemap} onChange={switchBasemap} />
      <DrawToolbar
        tool={tool}
        onToolChange={setTool}
        sketch={sketch}
        brushColor={brushColor}
        onBrushColorChange={setBrushColor}
        onClearInk={clearInk}
      />

      <div className="draw-hint">{hint}</div>
      {toast && <div className="map-toast" role="alert">{toast}</div>}

      {zoomedOut && <div className="zoom-hint">Zoom in to see reference parcel boundaries</div>}

      {result && activeLayerKeys.length > 0 && (
        <div className="legend">
          {activeLayerKeys.map((id) => (
            <div className="legend-item" key={id}>
              <span className="legend-swatch" style={{ background: LAYER_COLORS[id] }} />
              {LAYER_LABELS[id]}
            </div>
          ))}
        </div>
      )}

      {mapError && <div className="map-error-banner">{mapError}</div>}

      <div ref={containerRef} style={{ width: "100%", height: "100%" }} />
      <canvas ref={inkCanvasRef} className="ink-canvas" />

      {result && <SegmentOverridePanel overrides={overrides} onUndo={undo} onClearAll={clearAll} />}
      <SegmentHoverTag hovered={hovered} overrides={overrides} />
    </div>
  );
}
