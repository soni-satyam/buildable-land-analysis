import { useEffect, useRef, useState } from "react";
import maplibregl from "maplibre-gl";
import {
  TerraDraw,
  TerraDrawPolygonMode,
  TerraDrawRectangleMode,
  TerraDrawCircleMode,
  TerraDrawSelectMode,
} from "terra-draw";
import { TerraDrawMapLibreGLAdapter } from "terra-draw-maplibre-gl-adapter";
import { EMPTY_FEATURE } from "./constants.js";
import { polygonCentroid } from "./geometryUtils.js";

// Tools terra-draw handles. Every other tool (line, freehand, pan, laser,
// brush) parks terra-draw in "select" mode: it's registered, and has nothing
// to select because every finished shape is removed immediately.
// (line + freehand are handled by useSketchTool, which calls submitShape.)
const MODE_FOR_TOOL = { polygon: "polygon", rectangle: "rectangle", circle: "circle" };
const modeFor = (tool) => MODE_FOR_TOOL[tool] ?? "select";

/**
 * Terra-draw shapes (polygon | rectangle | circle) plus the shared
 * "a shape was completed" path used by every selection tool:
 *
 *   submitShape(geometry)
 *     - no result yet -> becomes the pending area (confirm button, onAreaSelected)
 *     - result exists -> an additional exclude (onExclude), applied immediately
 *
 * Callbacks are read through a ref so they never go stale.
 */
export function useDrawTool(mapRef, ready, { tool, hasResultRef, onAreaSelected, onExclude, onError }) {
  const drawRef = useRef(null);
  const confirmMarkerRef = useRef(null);
  const [hasPending, setHasPending] = useState(false);

  const cbRef = useRef({});
  cbRef.current = { onAreaSelected, onExclude, onError, tool };

  function clearPendingSelection() {
    const map = mapRef.current;
    if (map?.getSource("pending-selection")) map.getSource("pending-selection").setData(EMPTY_FEATURE);
    confirmMarkerRef.current?.remove();
    confirmMarkerRef.current = null;
    setHasPending(false);
  }

  function showConfirmButton(map, geometry) {
    confirmMarkerRef.current?.remove();
    const [lng, lat] = polygonCentroid(geometry);
    const el = document.createElement("button");
    el.className = "confirm-area-btn";
    el.type = "button";
    el.textContent = "Calculate Buildable Area";
    el.onclick = (e) => {
      e.stopPropagation();
      cbRef.current.onAreaSelected?.(geometry);
      clearPendingSelection();
    };
    confirmMarkerRef.current = new maplibregl.Marker({ element: el, anchor: "bottom" }).setLngLat([lng, lat]).addTo(map);
  }

  function submitShape(geometry) {
    const map = mapRef.current;
    if (!map || !geometry) return;
    if (!hasResultRef.current) {
      map.getSource("pending-selection")?.setData({ type: "Feature", geometry, properties: {} });
      setHasPending(true);
      showConfirmButton(map, geometry);
    } else {
      cbRef.current.onExclude?.(geometry);
    }
  }

  useEffect(() => {
    if (!ready) return;
    const map = mapRef.current;

    map.addSource("pending-selection", { type: "geojson", data: EMPTY_FEATURE });
    map.addLayer({ id: "pending-selection-fill", type: "fill", source: "pending-selection", paint: { "fill-color": "#c99a46", "fill-opacity": 0.15 } });
    map.addLayer({ id: "pending-selection-outline", type: "line", source: "pending-selection", paint: { "line-color": "#c99a46", "line-width": 2, "line-dasharray": [2, 2] } });

    let draw;
    try {
      draw = new TerraDraw({
        adapter: new TerraDrawMapLibreGLAdapter({ map, lib: maplibregl }),
        modes: [
          new TerraDrawPolygonMode(),
          new TerraDrawRectangleMode(),
          new TerraDrawCircleMode(),
          new TerraDrawSelectMode(),
        ],
      });
      draw.start();
      draw.setMode(modeFor(cbRef.current.tool));
      drawRef.current = draw;

      draw.on("finish", (id) => {
        const feature = draw.getSnapshot().find((f) => f.id === id);
        draw.removeFeatures([id]); // we render results ourselves; keep the draw layer empty
        if (feature?.geometry?.type === "Polygon") submitShape(feature.geometry);
        draw.setMode(modeFor(cbRef.current.tool)); // stay ready for the next shape
      });
    } catch (e) {
      console.error("Draw tool failed to initialize:", e);
      cbRef.current.onError?.("Map loaded, but the draw tool failed to initialize: " + e.message);
    }

    return () => {
      draw?.stop();
      confirmMarkerRef.current?.remove();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready]);

  // Switching tools swaps the terra-draw mode (an unfinished shape is discarded).
  useEffect(() => {
    if (!ready || !drawRef.current) return;
    try {
      drawRef.current.setMode(modeFor(tool));
    } catch (e) {
      console.error("Could not switch draw mode:", e);
    }
  }, [ready, tool]);

  function resetDraw() {
    clearPendingSelection();
    drawRef.current?.clear();
  }

  return { hasPending, resetDraw, submitShape };
}