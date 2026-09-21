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

const MODE_FOR_TOOL = { polygon: "polygon", rectangle: "rectangle", circle: "circle" };
const modeFor = (tool) => MODE_FOR_TOOL[tool] ?? "select";

export function useDrawTool(mapRef, ready, {
  tool, hasResultRef, parcelGeometryRef,
  onAreaSelected, onSubSelect, onExclude, onError,
}) {
  const drawRef = useRef(null);
  const confirmMarkerRef = useRef(null);
  const [hasPending, setHasPending] = useState(false);
  const drawnShapesRef = useRef([]);
  const pendingGeometryRef = useRef(null);
  const cbRef = useRef({});
  cbRef.current = { onAreaSelected, onSubSelect, onExclude, onError, tool };

  function clearPendingSelection() {
    const map = mapRef.current;
    if (map?.getSource("pending-selection")) map.getSource("pending-selection").setData(EMPTY_FEATURE);
    confirmMarkerRef.current?.remove();
    confirmMarkerRef.current = null;
    pendingGeometryRef.current = null;
    setHasPending(false);
  }

  function syncDrawnShapesSource(shapes) {
    const map = mapRef.current;
    if (!map?.getSource("drawn-shapes")) return;
    map.getSource("drawn-shapes").setData({
      type: "FeatureCollection",
      features: shapes.map((s) => ({
        type: "Feature",
        geometry: s.geometry,
        properties: { kind: s.kind },
      })),
    });
  }

  function addDrawnShape(geometry, kind) {
    const id = `drawn-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    const next = [...drawnShapesRef.current, { id, geometry, kind }];
    drawnShapesRef.current = next;
    syncDrawnShapesSource(next);
  }

  function restoreDrawn(shapes) {
    const next = shapes ?? [];
    drawnShapesRef.current = next;
    syncDrawnShapesSource(next);
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
    confirmMarkerRef.current = new maplibregl.Marker({ element: el, anchor: "bottom" })
      .setLngLat([lng, lat])
      .addTo(map);
  }

  function submitShape(geometry) {
    const map = mapRef.current;
    if (!map || !geometry) return;
    if (!hasResultRef.current) {
      map.getSource("pending-selection")?.setData({ type: "Feature", geometry, properties: {} });
      pendingGeometryRef.current = geometry;
      setHasPending(true);
      showConfirmButton(map, geometry);
    } else {
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

    map.addSource("pending-selection", { type: "geojson", data: EMPTY_FEATURE });
    map.addLayer({ id: "pending-selection-fill", type: "fill", source: "pending-selection", paint: { "fill-color": "#c99a46", "fill-opacity": 0.15 } });
    map.addLayer({ id: "pending-selection-outline", type: "line", source: "pending-selection", paint: { "line-color": "#c99a46", "line-width": 2, "line-dasharray": [2, 2] } });

    map.addSource("drawn-shapes", { type: "geojson", data: EMPTY_FC });
    map.addLayer({
      id: "drawn-shapes-fill", type: "fill", source: "drawn-shapes",
      paint: {
        "fill-color": ["match", ["get", "kind"], "subselect", "#c99a46", "#e74c3c"],
        "fill-opacity": ["match", ["get", "kind"], "subselect", 0.35, 0.20],
      },
    });
    map.addLayer({
      id: "drawn-shapes-outline", type: "line", source: "drawn-shapes",
      paint: {
        "line-color": ["match", ["get", "kind"], "subselect", "#c99a46", "#e74c3c"],
        "line-width": 2.5,
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
        draw.removeFeatures([id]);
        if (feature?.geometry?.type === "Polygon") submitShape(feature.geometry);
        draw.setMode(modeFor(cbRef.current.tool));
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

  useEffect(() => {
    if (!ready || !drawRef.current) return;
    try { drawRef.current.setMode(modeFor(tool)); }
    catch (e) { console.error("Could not switch draw mode:", e); }
  }, [ready, tool]);

  function resetDraw() {
    clearPendingSelection();
    drawnShapesRef.current = [];
    syncDrawnShapesSource([]);
    drawRef.current?.clear();
  }

  return { hasPending, resetDraw, submitShape, drawnShapesRef, pendingGeometryRef, restoreDrawn };
}