import React, { useEffect, useRef, useState, useCallback } from "react";
import maplibregl from "maplibre-gl";
import { TerraDraw, TerraDrawPolygonMode, TerraDrawSelectMode } from "terra-draw";
import { TerraDrawMapLibreGLAdapter } from "terra-draw-maplibre-gl-adapter";
import "maplibre-gl/dist/maplibre-gl.css";

const API_BASE = "http://localhost:8000";

// Harris County, TX extent (per the project's data handoff spec).
const HARRIS_COUNTY_BOUNDS = [
  [-95.960733, 29.497297],
  [-94.908492, 30.170606],
];
const HARRIS_COUNTY_CENTER = [-95.43, 29.83];

// Below this zoom the viewport bbox is too large for the backend's parcel
// cap (1,500 features) to give a meaningful picture, and would frequently
// hit the backend's "viewport too large" guard. Prompt the user to zoom
// in instead of silently failing.
const MIN_PARCEL_ZOOM = 15;

// Free, no-API-key raster basemaps. Each is a plain XYZ raster source, not
// a full vector style - fewer moving parts (no glyphs/sprite to fetch),
// and easy to swap without touching anything else on the map (see
// setBasemap below - we add/remove just this one source+layer rather than
// calling map.setStyle, which would tear down every overlay and the draw
// tool along with it).
const CARTO_API_KEY = import.meta.env.VITE_CARTO_API_KEY || "";
const BASEMAPS = {
  streets: {
    label: "Streets",
    tiles: ["https://tile.openstreetmap.org/{z}/{x}/{y}.png"],
    attribution: "&copy; OpenStreetMap contributors",
  },
  light: {
    label: "Light",
    tiles: [`https://basemaps.cartocdn.com/light_all/{z}/{x}/{y}.png?key=${CARTO_API_KEY}`],
    attribution: "&copy; OpenStreetMap contributors &copy; CARTO",
  },
  dark: {
    label: "Dark",
    tiles: [`https://basemaps.cartocdn.com/dark_all/{z}/{x}/{y}.png?key=${CARTO_API_KEY}`],
    attribution: "&copy; OpenStreetMap contributors &copy; CARTO",
  },
  satellite: {
    label: "Satellite",
    tiles: [
      "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
    ],
    attribution: "Esri, Maxar, Earthstar Geographics",
  },
  terrain: {
    label: "Terrain",
    tiles: [
      "https://a.tile.opentopomap.org/{z}/{x}/{y}.png",
      "https://b.tile.opentopomap.org/{z}/{x}/{y}.png",
      "https://c.tile.opentopomap.org/{z}/{x}/{y}.png",
    ],
    attribution: "&copy; OpenTopoMap contributors (CC-BY-SA)",
  },
};

// Layers whose visibility the sidebar's "Analysis Layers" control can
// toggle, and which source they come from (per-request `layers` geometries
// vs. the base `geometry` block that's always present on a result).
const ANALYSIS_LAYER_IDS = ["parcel", "buildable", "excluded", "wetlands", "fema_flood", "buildings", "transmission"];

const EMPTY_FEATURE = { type: "Feature", geometry: { type: "GeometryCollection", geometries: [] }, properties: {} };

export default function MapView({ result, onAdjustment, onParcelSelect, layerVisibility }) {
  const containerRef = useRef(null);
  const mapRef = useRef(null);
  const drawRef = useRef(null);
  const drawnExclusionsRef = useRef([]);
  const drawnRestoresRef = useRef([]);
  const moveTimerRef = useRef(null);

  const [basemap, setBasemapKey] = useState("streets");
  const [drawMode, setDrawMode] = useState("select"); // "select" | "exclude" | "restore"
  const drawModeRef = useRef(drawMode);
  drawModeRef.current = drawMode;

  const [mapError, setMapError] = useState(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState([]);
  const [searching, setSearching] = useState(false);
  const [zoomHint, setZoomHint] = useState(false);
  const [parcelNote, setParcelNote] = useState(null);

  // --- Basemap: swap only the raster source/layer in place, never the
  // whole style, so overlays and the draw tool are never disturbed. ---
  const applyBasemap = useCallback((map, key) => {
    const def = BASEMAPS[key] || BASEMAPS.streets;

    // Find the current bottom-most non-basemap layer so the new basemap
    // layer gets reinserted below everything else, not on top.
    const existingLayers = map.getStyle()?.layers || [];
    const anchorLayer = existingLayers.find((l) => l.id !== "basemap");

    if (map.getLayer("basemap")) map.removeLayer("basemap");
    if (map.getSource("basemap")) map.removeSource("basemap");

    map.addSource("basemap", {
      type: "raster",
      tiles: def.tiles,
      tileSize: 256,
      attribution: def.attribution,
    });
    map.addLayer({ id: "basemap", type: "raster", source: "basemap" }, anchorLayer ? anchorLayer.id : undefined);
  }, []);

  function switchBasemap(key) {
    setBasemapKey(key);
    if (mapRef.current) applyBasemap(mapRef.current, key);
  }

  // --- Search (Nominatim - free, no API key) ---
  async function runSearch(e) {
    e.preventDefault();
    if (!searchQuery.trim()) return;
    setSearching(true);
    try {
      const url = `https://nominatim.openstreetmap.org/search?format=json&limit=5&q=${encodeURIComponent(searchQuery)}`;
      const res = await fetch(url);
      const data = await res.json();
      setSearchResults(data);
    } catch (e) {
      console.error("Search failed:", e);
      setSearchResults([]);
    } finally {
      setSearching(false);
    }
  }

  function flyToSearchResult(r) {
    const map = mapRef.current;
    if (!map) return;
    const [south, north, west, east] = r.boundingbox.map(Number);
    map.fitBounds(
      [
        [west, south],
        [east, north],
      ],
      { padding: 60, duration: 800, maxZoom: 17 }
    );
    setSearchResults([]);
    setSearchQuery(r.display_name);
  }

  function resetToHarrisCounty() {
    const map = mapRef.current;
    if (!map) return;
    map.fitBounds(HARRIS_COUNTY_BOUNDS, { padding: 20, duration: 800 });
    setSearchQuery("");
    setSearchResults([]);
  }

  // --- Parcels-in-viewport (bbox-filtered, never the full dataset) ---
  const fetchParcelsInViewport = useCallback(async () => {
    const map = mapRef.current;
    if (!map) return;

    const zoom = map.getZoom();
    if (zoom < MIN_PARCEL_ZOOM) {
      setZoomHint(true);
      setParcelNote(null);
      const src = map.getSource("parcels-view");
      if (src) src.setData({ type: "FeatureCollection", features: [] });
      return;
    }
    setZoomHint(false);

    const b = map.getBounds();
    const bbox = [b.getWest(), b.getSouth(), b.getEast(), b.getNorth()].join(",");

    try {
      const res = await fetch(`${API_BASE}/api/parcels?bbox=${bbox}`);
      if (!res.ok) {
        setParcelNote(null);
        return;
      }
      const data = await res.json();
      setParcelNote(data.note);
      const featureCollection = {
        type: "FeatureCollection",
        features: data.parcels.map((p) => ({
          type: "Feature",
          geometry: p.geometry,
          properties: { parcel_id: p.parcel_id },
        })),
      };
      const src = map.getSource("parcels-view");
      if (src) src.setData(featureCollection);
    } catch (e) {
      console.error("Failed to load parcels in viewport:", e);
    }
  }, []);

  // --- Map init (runs once) ---
  useEffect(() => {
    let map;
    try {
      map = new maplibregl.Map({
        container: containerRef.current,
        style: { version: 8, sources: {}, layers: [] },
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
      console.error("MapLibre error:", e?.error || e);
    });

    map.addControl(new maplibregl.NavigationControl(), "top-right");

    map.on("load", () => {
      applyBasemap(map, "streets");

      // Parcels-in-viewport layer (added once; data streamed in via setData)
      map.addSource("parcels-view", { type: "geojson", data: { type: "FeatureCollection", features: [] } });
      map.addLayer({
        id: "parcels-view-fill",
        type: "fill",
        source: "parcels-view",
        paint: { "fill-color": "#c99a46", "fill-opacity": 0.04 },
      });
      map.addLayer({
        id: "parcels-view-outline",
        type: "line",
        source: "parcels-view",
        paint: { "line-color": "#c99a46", "line-width": 1 },
      });

      map.on("mouseenter", "parcels-view-fill", () => {
        if (drawModeRef.current === "select") map.getCanvas().style.cursor = "pointer";
      });
      map.on("mouseleave", "parcels-view-fill", () => {
        map.getCanvas().style.cursor = "";
      });
      map.on("click", "parcels-view-fill", (e) => {
        if (drawModeRef.current !== "select") return; // don't hijack clicks while drawing
        const propId = e.features?.[0]?.properties?.parcel_id;
        if (propId) onParcelSelect?.(propId);
      });

      fetchParcelsInViewport();
      map.on("moveend", () => {
        clearTimeout(moveTimerRef.current);
        moveTimerRef.current = setTimeout(fetchParcelsInViewport, 250);
      });

      // --- Draw tool (Terra Draw + its official MapLibre adapter) ---
      try {
        const draw = new TerraDraw({
          adapter: new TerraDrawMapLibreGLAdapter({ map, lib: maplibregl }),
          modes: [new TerraDrawPolygonMode(), new TerraDrawSelectMode()],
        });
        draw.start();
        draw.setMode("select"); // start in select mode so parcel clicks work immediately
        drawRef.current = draw;

        draw.on("finish", (id) => {
          const snapshot = draw.getSnapshot();
          const feature = snapshot.find((f) => f.id === id);
          if (!feature || feature.geometry.type !== "Polygon") return;

          const adjustment = { kind: drawModeRef.current, geometry: feature.geometry };
          if (drawModeRef.current === "restore") {
            drawnRestoresRef.current = [...drawnRestoresRef.current, adjustment];
          } else if (drawModeRef.current === "exclude") {
            drawnExclusionsRef.current = [...drawnExclusionsRef.current, adjustment];
          }

          onAdjustment({
            user_exclusions: drawnExclusionsRef.current,
            user_restores: drawnRestoresRef.current,
          });

          // Stay in the same drawing mode so the next shape can be drawn immediately.
          if (drawModeRef.current !== "select") draw.setMode("polygon");
        });
      } catch (e) {
        console.error("Draw tool failed to initialize:", e);
        setMapError("Map loaded, but the draw tool failed to initialize: " + e.message);
      }
    });

    return () => {
      clearTimeout(moveTimerRef.current);
      drawRef.current?.stop();
      map.remove();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Keep Terra Draw's active mode in sync with the Select/Exclude/Restore toggle.
  useEffect(() => {
    const draw = drawRef.current;
    if (!draw) return;
    draw.setMode(drawMode === "select" ? "select" : "polygon");
  }, [drawMode]);

  // --- Render analysis result geometries (parcel / buildable / excluded
  // / per-constraint layers) whenever a new /api/analyze result arrives ---
  useEffect(() => {
    if (!result || !mapRef.current) return;
    const map = mapRef.current;

    const addOrUpdateFill = (id, geometry, color) => {
      const geojson = geometry ? { type: "Feature", geometry, properties: {} } : EMPTY_FEATURE;
      if (map.getSource(id)) {
        map.getSource(id).setData(geojson);
      } else {
        map.addSource(id, { type: "geojson", data: geojson });
        map.addLayer({ id, type: "fill", source: id, paint: { "fill-color": color, "fill-opacity": 0.45 } });
        map.addLayer({ id: `${id}-outline`, type: "line", source: id, paint: { "line-color": color, "line-width": 1.5 } });
      }
    };

    const render = () => {
      addOrUpdateFill("parcel", result.geometry.parcel, "#3498db");
      addOrUpdateFill("excluded", result.geometry.excluded, "#b95d40");
      addOrUpdateFill("buildable", result.geometry.buildable, "#63a06f");

      addOrUpdateFill("wetlands", result.layers?.wetlands, "#2f8f6e");
      addOrUpdateFill("fema_flood", result.layers?.fema_flood, "#3b6fb0");
      addOrUpdateFill("buildings", result.layers?.buildings, "#a2673a");
      addOrUpdateFill("transmission", result.layers?.transmission, "#8a4fae");

      applyLayerVisibility(map, layerVisibility);

      try {
        const bbox = geometryBounds(result.geometry.parcel);
        if (bbox) map.fitBounds(bbox, { padding: 60, duration: 500 });
      } catch (_) {
        /* ignore fit errors on odd geometries */
      }
    };

    if (map.isStyleLoaded()) render();
    else map.once("load", render);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [result]);

  // --- Apply layer-visibility toggles whenever the sidebar checkboxes change ---
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    if (map.isStyleLoaded()) applyLayerVisibility(map, layerVisibility);
  }, [layerVisibility]);

  function applyLayerVisibility(map, visibility) {
    ANALYSIS_LAYER_IDS.forEach((id) => {
      const visible = visibility?.[id] !== false; // default visible
      [id, `${id}-outline`].forEach((layerId) => {
        if (map.getLayer(layerId)) {
          map.setLayoutProperty(layerId, "visibility", visible ? "visible" : "none");
        }
      });
    });
  }

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
      <div className="map-topbar">
        <form className="search-box" onSubmit={runSearch}>
          <input
            type="text"
            placeholder="Search for a place or address…"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
          />
          <button type="submit" disabled={searching}>{searching ? "…" : "Search"}</button>
        </form>
        <button className="reset-btn" onClick={resetToHarrisCounty} type="button">
          Reset to Harris County
        </button>
      </div>

      {searchResults.length > 0 && (
        <div className="search-results">
          {searchResults.map((r, i) => (
            <button key={i} onClick={() => flyToSearchResult(r)} type="button">
              {r.display_name}
            </button>
          ))}
        </div>
      )}

      <div className="basemap-selector">
        {Object.entries(BASEMAPS).map(([key, def]) => (
          <button
            key={key}
            className={basemap === key ? "active" : ""}
            onClick={() => switchBasemap(key)}
            type="button"
          >
            {def.label}
          </button>
        ))}
      </div>

      <div className="draw-toggle">
        <label className={drawMode === "select" ? "active" : ""}>
          <input type="radio" checked={drawMode === "select"} onChange={() => setDrawMode("select")} />
          Select parcel
        </label>
        <label className={drawMode === "exclude" ? "active" : ""}>
          <input type="radio" checked={drawMode === "exclude"} onChange={() => setDrawMode("exclude")} />
          Draw: Exclude
        </label>
        <label className={drawMode === "restore" ? "active" : ""}>
          <input type="radio" checked={drawMode === "restore"} onChange={() => setDrawMode("restore")} />
          Draw: Restore
        </label>
      </div>

      {zoomHint && <div className="zoom-hint">Zoom in to see individual parcels</div>}
      {!zoomHint && parcelNote && <div className="zoom-hint">{parcelNote}</div>}

      {result && (
        <div className="legend">
          <div className="legend-item"><span className="legend-swatch" style={{ background: "#3498db" }} />Parcel</div>
          <div className="legend-item"><span className="legend-swatch" style={{ background: "#63a06f" }} />Buildable</div>
          <div className="legend-item"><span className="legend-swatch" style={{ background: "#b95d40" }} />Excluded</div>
        </div>
      )}

      {mapError && <div className="map-error-banner">{mapError}</div>}

      <div ref={containerRef} style={{ width: "100%", height: "100%" }} />
    </div>
  );
}