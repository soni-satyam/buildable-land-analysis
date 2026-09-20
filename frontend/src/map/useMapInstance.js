import { useEffect, useRef, useState, useCallback } from "react";
import maplibregl from "maplibre-gl";
import { BASEMAPS, HARRIS_COUNTY_CENTER } from "./constants.js";

/**
 * Creates the MapLibre map once, mounted into `containerRef`. Also owns
 * basemap switching: swaps only the raster source/layer in place (never
 * the whole style), so every other hook's sources/layers and any drawn
 * shapes survive a basemap change untouched.
 *
 * `ready` flips true exactly once, after the map's "load" event fires -
 * every other hook in this module waits on `ready` before adding its own
 * sources/layers/listeners, so init order is deterministic regardless of
 * hook call order.
 */
export function useMapInstance(containerRef) {
  const mapRef = useRef(null);
  const [ready, setReady] = useState(false);
  const [mapError, setMapError] = useState(null);
  const [basemap, setBasemapKey] = useState("streets");

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
      setReady(true);
    });

    return () => map.remove();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return { mapRef, ready, mapError, setMapError, basemap, switchBasemap };
}