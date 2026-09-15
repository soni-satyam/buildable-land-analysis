import React, { useEffect, useRef, useState } from "react";
import maplibregl from "maplibre-gl";
import { TerraDraw, TerraDrawPolygonMode, TerraDrawSelectMode } from "terra-draw";
import { TerraDrawMapLibreGLAdapter } from "terra-draw-maplibre-gl-adapter";
import "maplibre-gl/dist/maplibre-gl.css";

// A plain raster OSM basemap defined inline, rather than pointing at an
// external full vector style (fonts/glyphs/sprite). A vector style needs
// several extra assets to load successfully; a raster XYZ source only
// needs the tile images themselves, so it degrades far more gracefully on
// a restricted or slow network and is a common reason a map silently
// fails to render at all.
const BASEMAP_STYLE = {
  version: 8,
  sources: {
    osm: {
      type: "raster",
      tiles: ["https://tile.openstreetmap.org/{z}/{x}/{y}.png"],
      tileSize: 256,
      attribution: "&copy; OpenStreetMap contributors",
    },
  },
  layers: [{ id: "osm", type: "raster", source: "osm" }],
};

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
  const [mapError, setMapError] = useState(null);

  useEffect(() => {
    let map;
    try {
      map = new maplibregl.Map({
        container: containerRef.current,
        style: BASEMAP_STYLE,
        center: HARRIS_COUNTY_CENTER,
        zoom: 15,
      });
      mapRef.current = map;
    } catch (e) {
      console.error("Map failed to initialize:", e);
      setMapError(e.message || "Map failed to initialize.");
      return;
    }

    map.on("error", (e) => {
      // MapLibre reports async failures (bad tile URLs, style errors, etc.)
      // through this event rather than throwing - log so they're visible.
      console.error("MapLibre error:", e?.error || e);
    });

    map.addControl(new maplibregl.NavigationControl(), "top-right");

    map.on("load", () => {
      try {
        const draw = new TerraDraw({
          adapter: new TerraDrawMapLibreGLAdapter({ map, lib: maplibregl }),
          modes: [new TerraDrawPolygonMode(), new TerraDrawSelectMode()],
        });
        draw.start();
        draw.setMode("polygon");
        drawRef.current = draw;

        draw.on("finish", (id) => {
          const snapshot = draw.getSnapshot();
          const feature = snapshot.find((f) => f.id === id);
          if (!feature || feature.geometry.type !== "Polygon") return;

          const adjustment = { kind: drawModeRef.current, geometry: feature.geometry };
          if (drawModeRef.current === "restore") {
            drawnRestoresRef.current = [...drawnRestoresRef.current, adjustment];
          } else {
            drawnExclusionsRef.current = [...drawnExclusionsRef.current, adjustment];
          }

          onAdjustment({
            user_exclusions: drawnExclusionsRef.current,
            user_restores: drawnRestoresRef.current,
          });

          // Stay in drawing mode so the next shape can be drawn immediately.
          draw.setMode("polygon");
        });
      } catch (e) {
        console.error("Draw tool failed to initialize:", e);
        setMapError("Map loaded, but the draw tool failed to initialize: " + e.message);
      }
    });

    return () => {
      drawRef.current?.stop();
      map.remove();
    };
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

    const render = () => {
      addOrUpdateFill("parcel", result.geometry.parcel, "#3498db");
      addOrUpdateFill("excluded", result.geometry.excluded, "#b95d40");
      addOrUpdateFill("buildable", result.geometry.buildable, "#63a06f");

      try {
        const bbox = geometryBounds(result.geometry.parcel);
        if (bbox) map.fitBounds(bbox, { padding: 40, duration: 500 });
      } catch (_) {
        /* ignore fit errors on odd geometries */
      }
    };

    if (map.isStyleLoaded()) render();
    else map.once("load", render);
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
    <div className="map-area">
      <div className="draw-toggle">
        <label className={drawMode === "exclude" ? "active" : ""}>
          <input
            type="radio"
            checked={drawMode === "exclude"}
            onChange={() => setDrawMode("exclude")}
          />
          Draw: Exclude
        </label>
        <label className={drawMode === "restore" ? "active" : ""}>
          <input
            type="radio"
            checked={drawMode === "restore"}
            onChange={() => setDrawMode("restore")}
          />
          Draw: Restore
        </label>
      </div>

      {result && (
        <div className="legend">
          <div className="legend-item">
            <span className="legend-swatch" style={{ background: "#3498db" }} />
            Parcel boundary
          </div>
          <div className="legend-item">
            <span className="legend-swatch" style={{ background: "#63a06f" }} />
            Buildable
          </div>
          <div className="legend-item">
            <span className="legend-swatch" style={{ background: "#b95d40" }} />
            Excluded
          </div>
        </div>
      )}

      {mapError && (
        <div className="map-error-banner">
          {mapError}
        </div>
      )}

      <div ref={containerRef} style={{ width: "100%", height: "100%" }} />
    </div>
  );
}
