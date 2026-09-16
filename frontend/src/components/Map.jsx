import React, { useEffect, useRef, useState, useCallback } from "react";
import maplibregl from "maplibre-gl";
import { TerraDraw, TerraDrawPolygonMode, TerraDrawSelectMode } from "terra-draw";
import { TerraDrawMapLibreGLAdapter } from "terra-draw-maplibre-gl-adapter";
import "maplibre-gl/dist/maplibre-gl.css";
import { LAYER_COLORS, LAYER_LABELS } from "../layerColors.js";

const API_BASE = "http://localhost:8000";

const HARRIS_COUNTY_BOUNDS = [
  [-95.960733, 29.497297],
  [-94.908492, 30.170606],
];
const HARRIS_COUNTY_CENTER = [-95.43, 29.83];
const MIN_PARCEL_ZOOM = 15;

const BASEMAPS = {
  streets: {
    label: "Streets",
    tiles: ["https://tile.openstreetmap.org/{z}/{x}/{y}.png"],
    attribution: "&copy; OpenStreetMap contributors",
  },
  light: {
    label: "Light",
    tiles: [`https://basemaps.cartocdn.com/light_all/{z}/{x}/{y}.png?key=${import.meta.env.VITE_CARTO_API_KEY || ""}`],
    attribution: "&copy; OpenStreetMap contributors &copy; CARTO",
  },
  dark: {
    label: "Dark",
    tiles: [`https://basemaps.cartocdn.com/dark_all/{z}/{x}/{y}.png?key=${import.meta.env.VITE_CARTO_API_KEY || ""}`],
    attribution: "&copy; OpenStreetMap contributors &copy; CARTO",
  },
  satellite: {
    label: "Satellite",
    tiles: ["https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}"],
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

// Which result-driven layers get rendered/toggled, and in what order
// (later = drawn on top).
const ANALYSIS_LAYER_IDS = ["parcel", "buildable", "excluded", "wetlands", "fema_flood", "buildings", "transmission"];

const EMPTY_FEATURE = { type: "Feature", geometry: { type: "GeometryCollection", geometries: [] }, properties: {} };
const EMPTY_FC = { type: "FeatureCollection", features: [] };

// --- small geometry helpers (no turf dependency) ---

// Area-weighted centroid of a simple polygon ring, for placing the
// "Calculate Buildable Area" button roughly inside whatever shape was drawn.
function polygonCentroid(geometry) {
  const ring = geometry.coordinates[0];
  let area = 0, cx = 0, cy = 0;
  for (let i = 0; i < ring.length - 1; i++) {
    const [x0, y0] = ring[i];
    const [x1, y1] = ring[i + 1];
    const cross = x0 * y1 - x1 * y0;
    area += cross;
    cx += (x0 + x1) * cross;
    cy += (y0 + y1) * cross;
  }
  area *= 0.5;
  if (Math.abs(area) < 1e-12) return ring[0];
  return [cx / (6 * area), cy / (6 * area)];
}

// A small circle polygon (in degrees lon/lat) centered on a right-click
// point, used as the "restore brush" - a simple, reliable way to let the
// user mark a bit of excluded land as buildable again without needing a
// precise freehand right-click-drag capture.
function makeCircle(lng, lat, radiusFt, steps = 32) {
  const radiusM = radiusFt * 0.3048;
  const latRad = (lat * Math.PI) / 180;
  const dLat = radiusM / 111320;
  const dLng = radiusM / (111320 * Math.cos(latRad));
  const coords = [];
  for (let i = 0; i <= steps; i++) {
    const theta = (i / steps) * 2 * Math.PI;
    coords.push([lng + dLng * Math.cos(theta), lat + dLat * Math.sin(theta)]);
  }
  coords.push(coords[0]);
  return { type: "Polygon", coordinates: [coords] };
}

export default function MapView({ result, onAdjustment, onAreaSelected, layerVisibility, restoreBrushFt }) {
  const containerRef = useRef(null);
  const mapRef = useRef(null);
  const drawRef = useRef(null);
  const confirmMarkerRef = useRef(null);
  const drawnExclusionsRef = useRef([]);
  const drawnRestoresRef = useRef([]);
  const moveTimerRef = useRef(null);
  const restoreTimerRef = useRef(null);

  const hasResultRef = useRef(false);
  useEffect(() => {
    hasResultRef.current = !!result;
  }, [result]);

  const restoreBrushRef = useRef(restoreBrushFt || 60);
  useEffect(() => {
    restoreBrushRef.current = restoreBrushFt || 60;
  }, [restoreBrushFt]);

  const [basemap, setBasemapKey] = useState("streets");
  const [mapError, setMapError] = useState(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState([]);
  const [searching, setSearching] = useState(false);
  const [zoomHint, setZoomHint] = useState(false);
  const [hasPending, setHasPending] = useState(false);

  // --- Basemap: swap only the raster source/layer in place, so overlays
  // and drawn shapes are never disturbed by a basemap change. ---
  const applyBasemap = useCallback((map, key) => {
    const def = BASEMAPS[key] || BASEMAPS.streets;
    const existingLayers = map.getStyle()?.layers || [];
    const anchorLayer = existingLayers.find((l) => l.id !== "basemap");

    if (map.getLayer("basemap")) map.removeLayer("basemap");
    if (map.getSource("basemap")) map.removeSource("basemap");

    map.addSource("basemap", { type: "raster", tiles: def.tiles, tileSize: 256, attribution: def.attribution });
    map.addLayer({ id: "basemap", type: "raster", source: "basemap" }, anchorLayer ? anchorLayer.id : undefined);
  }, []);

  function switchBasemap(key) {
    setBasemapKey(key);
    if (mapRef.current) applyBasemap(mapRef.current, key);
  }

  // --- Search (Nominatim) ---
  async function runSearch(e) {
    e.preventDefault();
    if (!searchQuery.trim()) return;
    setSearching(true);
    try {
      const res = await fetch(`https://nominatim.openstreetmap.org/search?format=json&limit=5&q=${encodeURIComponent(searchQuery)}`);
      setSearchResults(await res.json());
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
    map.fitBounds([[west, south], [east, north]], { padding: 60, duration: 800, maxZoom: 17 });
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

  // --- Parcels-in-viewport: shown only as passive reference context now
  // (the primary selection method is drawing, not clicking a real parcel). ---
  const fetchParcelsInViewport = useCallback(async () => {
    const map = mapRef.current;
    if (!map) return;
    const zoom = map.getZoom();
    if (zoom < MIN_PARCEL_ZOOM) {
      setZoomHint(true);
      const src = map.getSource("parcels-view");
      if (src) src.setData(EMPTY_FC);
      return;
    }
    setZoomHint(false);
    const b = map.getBounds();
    const bbox = [b.getWest(), b.getSouth(), b.getEast(), b.getNorth()].join(",");
    try {
      const res = await fetch(`${API_BASE}/api/parcels?bbox=${bbox}`);
      if (!res.ok) return;
      const data = await res.json();
      const src = map.getSource("parcels-view");
      if (src) {
        src.setData({
          type: "FeatureCollection",
          features: data.parcels.map((p) => ({ type: "Feature", geometry: p.geometry, properties: {} })),
        });
      }
    } catch (e) {
      console.error("Failed to load parcels in viewport:", e);
    }
  }, []);

  // --- Clear every analysis-result layer back to empty (used on reset). ---
  const clearAnalysisLayers = useCallback((map) => {
    ANALYSIS_LAYER_IDS.forEach((id) => {
      const src = map.getSource(id);
      if (src) src.setData(EMPTY_FEATURE);
    });
  }, []);

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
      onAreaSelected?.(geometry);
      clearPendingSelection();
    };
    confirmMarkerRef.current = new maplibregl.Marker({ element: el, anchor: "bottom" }).setLngLat([lng, lat]).addTo(map);
  }

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

    map.on("error", (e) => console.error("MapLibre error:", e?.error || e));
    map.addControl(new maplibregl.NavigationControl(), "top-right");

    map.on("load", () => {
      applyBasemap(map, "streets");

      // Passive reference layer: real parcel boundaries in view, for context only.
      map.addSource("parcels-view", { type: "geojson", data: EMPTY_FC });
      map.addLayer({ id: "parcels-view-fill", type: "fill", source: "parcels-view", paint: { "fill-color": "#8296a1", "fill-opacity": 0.03 } });
      map.addLayer({ id: "parcels-view-outline", type: "line", source: "parcels-view", paint: { "line-color": "#8296a1", "line-width": 0.75 } });

      // The user's drawn-but-not-yet-confirmed area.
      map.addSource("pending-selection", { type: "geojson", data: EMPTY_FEATURE });
      map.addLayer({ id: "pending-selection-fill", type: "fill", source: "pending-selection", paint: { "fill-color": "#c99a46", "fill-opacity": 0.15 } });
      map.addLayer({ id: "pending-selection-outline", type: "line", source: "pending-selection", paint: { "line-color": "#c99a46", "line-width": 2, "line-dasharray": [2, 2] } });

      fetchParcelsInViewport();
      map.on("moveend", () => {
        clearTimeout(moveTimerRef.current);
        moveTimerRef.current = setTimeout(fetchParcelsInViewport, 250);
      });

      // Right-click anywhere = paint a restore-brush circle. Only meaningful
      // once there's a result to restore area *from*; the backend safely
      // no-ops a restore that doesn't overlap anything excluded anyway.
      map.on("contextmenu", (e) => {
        if (!hasResultRef.current) return;
        const circle = makeCircle(e.lngLat.lng, e.lngLat.lat, restoreBrushRef.current);
        drawnRestoresRef.current = [...drawnRestoresRef.current, { kind: "restore", geometry: circle }];
        clearTimeout(restoreTimerRef.current);
        restoreTimerRef.current = setTimeout(() => {
          onAdjustment({ user_exclusions: drawnExclusionsRef.current, user_restores: drawnRestoresRef.current });
        }, 200);
      });

      // --- Draw tool: always ready to draw a polygon. The very first
      // completed polygon becomes the pending "area of interest" (needs
      // the confirm button); once a result exists, every subsequent
      // polygon is treated as an additional exclude, applied immediately. ---
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
          draw.removeFeatures([id]); // we render results ourselves; keep the draw layer empty
          if (!feature || feature.geometry.type !== "Polygon") return;

          if (!hasResultRef.current) {
            map.getSource("pending-selection").setData({ type: "Feature", geometry: feature.geometry, properties: {} });
            setHasPending(true);
            showConfirmButton(map, feature.geometry);
          } else {
            drawnExclusionsRef.current = [...drawnExclusionsRef.current, { kind: "exclude", geometry: feature.geometry }];
            onAdjustment({ user_exclusions: drawnExclusionsRef.current, user_restores: drawnRestoresRef.current });
          }
          draw.setMode("polygon"); // stay ready for the next shape
        });
      } catch (e) {
        console.error("Draw tool failed to initialize:", e);
        setMapError("Map loaded, but the draw tool failed to initialize: " + e.message);
      }
    });

    return () => {
      clearTimeout(moveTimerRef.current);
      clearTimeout(restoreTimerRef.current);
      drawRef.current?.stop();
      confirmMarkerRef.current?.remove();
      map.remove();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // --- Render (or clear) analysis-result geometries whenever the result changes ---
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

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
      if (!result) {
        clearAnalysisLayers(map);
        return;
      }
      addOrUpdateFill("parcel", result.geometry.parcel, LAYER_COLORS.parcel);
      addOrUpdateFill("excluded", result.geometry.excluded, LAYER_COLORS.excluded);
      addOrUpdateFill("buildable", result.geometry.buildable, LAYER_COLORS.buildable);
      addOrUpdateFill("wetlands", result.layers?.wetlands, LAYER_COLORS.wetlands);
      addOrUpdateFill("fema_flood", result.layers?.fema_flood, LAYER_COLORS.fema_flood);
      addOrUpdateFill("buildings", result.layers?.buildings, LAYER_COLORS.buildings);
      addOrUpdateFill("transmission", result.layers?.transmission, LAYER_COLORS.transmission);

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

  useEffect(() => {
    const map = mapRef.current;
    if (map && map.isStyleLoaded()) applyLayerVisibility(map, layerVisibility);
  }, [layerVisibility]);

  function applyLayerVisibility(map, visibility) {
    ANALYSIS_LAYER_IDS.forEach((id) => {
      const visible = visibility?.[id] !== false;
      [id, `${id}-outline`].forEach((layerId) => {
        if (map.getLayer(layerId)) map.setLayoutProperty(layerId, "visibility", visible ? "visible" : "none");
      });
    });
  }

  function geometryBounds(geometry) {
    const coordsFlat = [];
    const walk = (c) => (typeof c[0] === "number" ? coordsFlat.push(c) : c.forEach(walk));
    walk(geometry.coordinates);
    if (!coordsFlat.length) return null;
    const lons = coordsFlat.map((c) => c[0]);
    const lats = coordsFlat.map((c) => c[1]);
    return [[Math.min(...lons), Math.min(...lats)], [Math.max(...lons), Math.max(...lats)]];
  }

  // Reset callback exposed to the parent (via a ref-like pattern would be
  // cleaner, but a simple prop-driven approach keeps this component self
  // contained: App.jsx calls this indirectly by clearing `result`, and we
  // react to that above; drawn-shape state is cleared here too).
  useEffect(() => {
    if (!result) {
      drawnExclusionsRef.current = [];
      drawnRestoresRef.current = [];
      clearPendingSelection();
      drawRef.current?.clear();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [result]);

  const activeLayerKeys = result
    ? ANALYSIS_LAYER_IDS.filter((id) => id === "parcel" || id === "buildable" || id === "excluded" || result.layers?.[id])
    : [];

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
            <button key={i} onClick={() => flyToSearchResult(r)} type="button">{r.display_name}</button>
          ))}
        </div>
      )}

      <div className="basemap-selector">
        {Object.entries(BASEMAPS).map(([key, def]) => (
          <button key={key} className={basemap === key ? "active" : ""} onClick={() => switchBasemap(key)} type="button">
            {def.label}
          </button>
        ))}
      </div>

      <div className="draw-hint">
        {!result && !hasPending && "Click points on the map to draw an area, then confirm it."}
        {hasPending && "Click \"Calculate Buildable Area\" to analyze the drawn shape."}
        {result && "Draw more to mark extra risk. Right-click excluded (red) land to mark it buildable."}
      </div>

      {zoomHint && <div className="zoom-hint">Zoom in to see reference parcel boundaries</div>}

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
    </div>
  );
}