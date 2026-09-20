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
import { EMPTY_FEATURE, EMPTY_FC } from "./constants.js";
import { polygonCentroid, geometryInsideParcel } from "./geometryUtils.js";

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
 *     - no result yet      -> pending area (confirm button, onAreaSelected)
 *     - result, inside parcel  -> sub-selection (onSubSelect), shown gold/dashed
 *     - result, outside parcel -> exclude (onExclude), shown red/dashed
 *
 * All post-analysis shapes are kept visible in a "drawn-shapes" source so
 * users can see what they drew — terra-draw removes them from its own layer
 * immediately, so without this they would vanish the moment the shape closed.
 */
export function useDrawTool(mapRef, ready, { tool, hasResultRef, parcelGeometryRef, onAreaSelected, onSubSelect, onExclude, onError }) {
  const drawRef = useRef(null);
  const confirmMarkerRef = useRef(null);
  const [hasPending, setHasPending] = useState(false);

  // Persistent list of all drawn shapes shown after a result exists.
  // Each entry: { id, geometry, kind: "subselect" | "exclude" }
  const drawnShapesRef = useRef([]);

  const cbRef = useRef({});
  cbRef.current = { onAreaSelected, onSubSelect, onExclude, onError, tool };

  function clearPendingSelection() {
    const map = mapRef.current;
    if (map?.getSource("pending-selection")) map.getSource("pending-selection").setData(EMPTY_FEATURE);
    confirmMarkerRef.current?.remove();
    confirmMarkerRef.current = null;
    setHasPending(false);
  }

  function updateDrawnShapesSource() {
    const map = mapRef.current;
    if (!map?.getSource("drawn-shapes")) return;
    map.getSource("drawn-shapes").setData({
      type: "FeatureCollection",
      features: drawnShapesRef.current.map((s) => ({
        type: "Feature",
        geometry: s.geometry,
        properties: { kind: s.kind },
      })),
    });
  }

  function addDrawnShape(geometry, kind) {
    const id = `drawn-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    drawnShapesRef.current = [...drawnShapesRef.current, { id, geometry, kind }];
    updateDrawnShapesSource();
  }

  function clearDrawnShapes() {
    drawnShapesRef.current = [];
    updateDrawnShapesSource();
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
      // First selection — show pending outline + confirm button.
      map.getSource("pending-selection")?.setData({ type: "Feature", geometry, properties: {} });
      setHasPending(true);
      showConfirmButton(map, geometry);
    } else {
      // Post-analysis draw — detect inside/outside parcel and route accordingly.
      const parcelGeom = parcelGeometryRef?.current;
      const isInside = parcelGeom && geometryInsideParcel(geometry, parcelGeom);
      if (isInside) {
        addDrawnShape(geometry, "subselect");
        cbRef.current.onSubSelect?.(geometry);
      } else {
        addDrawnShape(geometry, "exclude");
        cbRef.current.onExclude?.(geometry);
      }
    }
  }

  useEffect(() => {
    if (!ready) return;
    const map = mapRef.current;

    // Pending selection (before confirm).
    map.addSource("pending-selection", { type: "geojson", data: EMPTY_FEATURE });
    map.addLayer({ id: "pending-selection-fill", type: "fill", source: "pending-selection", paint: { "fill-color": "#c99a46", "fill-opacity": 0.15 } });
    map.addLayer({ id: "pending-selection-outline", type: "line", source: "pending-selection", paint: { "line-color": "#c99a46", "line-width": 2, "line-dasharray": [2, 2] } });

    // Persistent drawn shapes shown after analysis result exists.
    // kind="subselect" → gold dashed; kind="exclude" → red dashed.
    map.addSource("drawn-shapes", { type: "geojson", data: EMPTY_FC });
    map.addLayer({
      id: "drawn-shapes-fill", type: "fill", source: "drawn-shapes",
      paint: {
        "fill-color": ["match", ["get", "kind"], "subselect", "#c99a46", "#e74c3c"],
        "fill-opacity": 0.12,
      },
    });
    map.addLayer({
      id: "drawn-shapes-outline", type: "line", source: "drawn-shapes",
      paint: {
        "line-color": ["match", ["get", "kind"], "subselect", "#c99a46", "#e74c3c"],
        "line-width": 2,
        "line-dasharray": [3, 2],
      },
    });

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
    clearDrawnShapes();
    drawRef.current?.clear();
  }

  return { hasPending, resetDraw, submitShape };
}
