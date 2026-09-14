import React, { useEffect, useRef, useState } from "react";
import maplibregl from "maplibre-gl";
import MapboxDraw from "@mapbox/mapbox-gl-draw";
import "maplibre-gl/dist/maplibre-gl.css";
import "@mapbox/mapbox-gl-draw/dist/mapbox-gl-draw.css";

// TODO: point at your own basemap style or a free vector tile source
const MAP_STYLE = "https://demotiles.maplibre.org/style.json";

// Centered roughly on Harris County, TX (per the data handoff spec's extent)
const HARRIS_COUNTY_CENTER = [-95.43, 29.83];

export default function MapView({ result, onAdjustment }) {
  const containerRef = useRef(null);
  const mapRef = useRef(null);
  const drawRef = useRef(null);
  const drawnExclusionsRef = useRef([]);
  const drawnRestoresRef = useRef([]);
  const [drawMode, setDrawMode] = useState("exclude"); // "exclude" | "restore"
  const drawModeRef = useRef(drawMode);
  drawModeRef.current = drawMode;

  useEffect(() => {
    const map = new maplibregl.Map({
      container: containerRef.current,
      style: MAP_STYLE,
      center: HARRIS_COUNTY_CENTER,
      zoom: 15,
    });
    mapRef.current = map;

    const draw = new MapboxDraw({
      displayControlsDefault: false,
      controls: { polygon: true, trash: true },
    });
    map.addControl(draw);
    drawRef.current = draw;

    function handleDraw(e) {
      const feature = e.features[0];

      if (!feature || feature.geometry?.type !== "Polygon") {
        return;
      }

      const adjustment = {
        kind: drawModeRef.current,
        geometry: feature.geometry,
      };

      if (drawModeRef.current === "restore") {
        drawnRestoresRef.current = [
          ...drawnRestoresRef.current,
          adjustment,
        ];
      } else {
        drawnExclusionsRef.current = [
          ...drawnExclusionsRef.current,
          adjustment,
        ];
      }

      onAdjustment({
        user_exclusions: drawnExclusionsRef.current,
        user_restores: drawnRestoresRef.current,
      });
    }

    map.on("draw.create", handleDraw);
    map.on("draw.update", handleDraw);

    return () => map.remove();
  }, []);

  useEffect(() => {
    if (!result || !mapRef.current) return;
    const map = mapRef.current;

    const addOrUpdateFill = (id, geometry, color) => {
      const geojson = { type: "Feature", geometry, properties: {} };
      if (map.getSource(id)) {
        map.getSource(id).setData(geojson);
      } else {
        map.addSource(id, { type: "geojson", data: geojson });
        map.addLayer({
          id,
          type: "fill",
          source: id,
          paint: { "fill-color": color, "fill-opacity": 0.45 },
        });
        map.addLayer({
          id: `${id}-outline`,
          type: "line",
          source: id,
          paint: { "line-color": color, "line-width": 1.5 },
        });
      }
    };

    // Draw order matters: parcel outline first, then excluded (red), then
    // buildable (green) on top so overlaps read clearly.
    addOrUpdateFill("parcel", result.geometry.parcel, "#3498db");
    addOrUpdateFill("excluded", result.geometry.excluded, "#e74c3c");
    addOrUpdateFill("buildable", result.geometry.buildable, "#2ecc71");

    try {
      const bbox = geometryBounds(result.geometry.parcel);
      if (bbox) map.fitBounds(bbox, { padding: 40, duration: 500 });
    } catch (_) {
      /* ignore fit errors on odd geometries */
    }
  }, [result]);

  function geometryBounds(geometry) {
    const coordsFlat = [];
    const walk = (c) => {
      if (typeof c[0] === "number") coordsFlat.push(c);
      else c.forEach(walk);
    };
    walk(geometry.coordinates);
    if (!coordsFlat.length) return null;
    const lons = coordsFlat.map((c) => c[0]);
    const lats = coordsFlat.map((c) => c[1]);
    return [
      [Math.min(...lons), Math.min(...lats)],
      [Math.max(...lons), Math.max(...lats)],
    ];
  }

  return (
    <div style={{ position: "relative", width: "100%", height: "100%" }}>
      <div
        style={{
          position: "absolute",
          zIndex: 1,
          top: 10,
          left: 10,
          background: "white",
          padding: 8,
          borderRadius: 4,
        }}
      >
        <label style={{ marginRight: 8 }}>
          <input
            type="radio"
            checked={drawMode === "exclude"}
            onChange={() => setDrawMode("exclude")}
          />
          Draw: Exclude
        </label>
        <label>
          <input
            type="radio"
            checked={drawMode === "restore"}
            onChange={() => setDrawMode("restore")}
          />
          Draw: Restore
        </label>
      </div>
      <div ref={containerRef} style={{ width: "100%", height: "100%" }} />
    </div>
  );
}
