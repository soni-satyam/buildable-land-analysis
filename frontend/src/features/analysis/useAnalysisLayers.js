import { useEffect, useRef } from "react";
import { ANALYSIS_LAYER_IDS, EMPTY_FC, EMPTY_FEATURE, SEGMENT_LAYER_KEYS } from "../../map/constants.js";
import { geometryBounds, toFeature } from "../../map/geometryUtils.js";
import { LAYER_STYLE, OVERRIDE_TO_BUILDABLE, OVERRIDE_TO_NONBUILDABLE } from "../../map/layerStyles.js";

const ALL_VISIBLE = {};
const NO_OVERRIDES = {};

// parcel / excluded / buildable live under result.geometry; the per-constraint
// layers live under result.layers (same as your old Map.jsx).
const TOP_LEVEL = new Set(["parcel", "buildable", "excluded"]);
const sourceGeometry = (result, id) => (TOP_LEVEL.has(id) ? result?.geometry?.[id] : result?.layers?.[id]);

// Data-driven paint for the clickable segment pieces.
const OVERRIDE = ["get", "override"];
const HOVER = ["boolean", ["feature-state", "hover"], false];
const BASE_COLOR = [
  "match", ["get", "layerKey"],
  ...SEGMENT_LAYER_KEYS.flatMap((k) => [k, LAYER_STYLE[k].color]),
  "#888888",
];
const SEGMENT_COLOR = [
  "case",
  ["==", OVERRIDE, "buildable"], OVERRIDE_TO_BUILDABLE,
  ["==", OVERRIDE, "nonbuildable"], OVERRIDE_TO_NONBUILDABLE,
  BASE_COLOR,
];

/**
 * Renders the analysis result:
 *  1. merged layers - fill + outline per id, same look as before;
 *  2. one source per segmented layer, whose features are the clickable
 *     pieces (faint until hovered; overridden pieces get a coloured outline);
 *  3. fits the map to the parcel - only when the parcel itself changes, so
 *     flipping a piece or moving a slider doesn't yank the camera away.
 */
export function useAnalysisLayers(mapRef, ready, { result, overrides = NO_OVERRIDES, visibility = ALL_VISIBLE }) {
  const lastFit = useRef(null);

  useEffect(() => {
    if (!ready) return;
    const map = mapRef.current;

    for (const id of ANALYSIS_LAYER_IDS) {
      const color = LAYER_STYLE[id].color;
      map.addSource(id, { type: "geojson", data: EMPTY_FEATURE });
      map.addLayer({ id, type: "fill", source: id, paint: { "fill-color": color, "fill-opacity": 0.45 } });
      map.addLayer({ id: `${id}-outline`, type: "line", source: id, paint: { "line-color": color, "line-width": 1.5 } });
    }

    // Reversed so "buildable" sits underneath and constraints on top.
    for (const key of [...SEGMENT_LAYER_KEYS].reverse()) {
      const source = `${key}-segments`;
      map.addSource(source, { type: "geojson", data: EMPTY_FC, promoteId: "id" });
      map.addLayer({
        id: `${key}-segments-fill`, type: "fill", source,
        paint: {
          "fill-color": SEGMENT_COLOR,
          "fill-opacity": ["case", HOVER, 0.55, ["!=", OVERRIDE, "none"], 0.3, 0.01],
        },
      });
      map.addLayer({
        id: `${key}-segments-outline`, type: "line", source,
        paint: {
          "line-color": SEGMENT_COLOR,
          "line-width": ["case", HOVER, 3, ["!=", OVERRIDE, "none"], 2.5, 1],
          "line-opacity": 0.8,
        },
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready]);

  // Merged layers follow the result.
  useEffect(() => {
    if (!ready) return;
    const map = mapRef.current;
    for (const id of ANALYSIS_LAYER_IDS) map.getSource(id)?.setData(toFeature(sourceGeometry(result, id)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, result]);

  // Segment pieces follow the result AND the overrides. Overrides only
  // change styling - the list of pieces never depends on them.
  useEffect(() => {
    if (!ready) return;
    const map = mapRef.current;
    for (const key of SEGMENT_LAYER_KEYS) {
      const pieces = result?.segments?.[key] ?? [];
      map.getSource(`${key}-segments`)?.setData({
        type: "FeatureCollection",
        features: pieces.map((s) => ({
          type: "Feature",
          geometry: s.geometry,
          properties: { id: s.id, layerKey: key, acres: s.acres, override: overrides[s.id]?.mode ?? "none" },
        })),
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, result, overrides]);

  // Fit to the parcel only when it actually changed.
  useEffect(() => {
    if (!ready) return;
    const parcel = result?.geometry?.parcel;
    if (!parcel) {
      lastFit.current = null;
      return;
    }
    try {
      const bounds = geometryBounds(parcel);
      if (!bounds) return;
      const key = bounds.flat().map((n) => n.toFixed(6)).join(",");
      if (key === lastFit.current) return;
      lastFit.current = key;
      mapRef.current.fitBounds(bounds, { padding: 60, duration: 500 });
    } catch (_) {
      /* ignore fit errors on odd geometries */
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, result]);

  // Layer visibility (hidden layers are also not clickable).
  useEffect(() => {
    if (!ready) return;
    const map = mapRef.current;
    const setVis = (layerId, on) => map.getLayer(layerId) && map.setLayoutProperty(layerId, "visibility", on ? "visible" : "none");
    for (const id of ANALYSIS_LAYER_IDS) {
      const on = visibility[id] !== false;
      setVis(id, on);
      setVis(`${id}-outline`, on);
    }
    for (const key of SEGMENT_LAYER_KEYS) {
      const on = visibility[key] !== false;
      setVis(`${key}-segments-fill`, on);
      setVis(`${key}-segments-outline`, on);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, visibility]);
}