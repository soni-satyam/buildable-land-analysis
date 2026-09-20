import { useCallback, useRef, useState } from "react";

/**
 * Owns the user's per-segment overrides: { [segmentId]: { layerKey, acres,
 * geometry, mode } }, where mode is what the piece was switched TO.
 *
 *   constraint piece  -> "buildable"     (sent to the backend as a restore)
 *   buildable piece   -> "nonbuildable"  (sent to the backend as an exclude)
 *
 * This only works because the backend keeps `segments` independent of
 * overrides: an overridden piece is still listed in the next response, so
 * it stays clickable and toggling it again undoes it.
 *
 * `onChange(payload, reason)` fires after every change with
 * payload = { restores: Geometry[], excludes: Geometry[] } (WGS84 GeoJSON)
 * and reason = "toggle" | "undo" | "clear" | "reset". Merge the payload into
 * your analyze request; re-run analysis for everything except "reset".
 */
function toPayload(overrides) {
  const entries = Object.values(overrides);
  const pick = (mode) => entries.filter((o) => o.mode === mode).map((o) => o.geometry);
  return { restores: pick("buildable"), excludes: pick("nonbuildable") };
}

export function useSegmentOverrides(onChange) {
  const [overrides, setOverrides] = useState({});
  const ref = useRef({}); // always-current copy so rapid clicks never race state
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

  const commit = useCallback((next, reason) => {
    ref.current = next;
    setOverrides(next);
    onChangeRef.current?.(toPayload(next), reason);
  }, []);

  const toggle = useCallback(
    (layerKey, segment) => {
      const next = { ...ref.current };
      if (next[segment.id]) {
        delete next[segment.id];
      } else {
        next[segment.id] = {
          layerKey,
          acres: segment.acres,
          geometry: segment.geometry,
          mode: layerKey === "buildable" ? "nonbuildable" : "buildable",
        };
      }
      commit(next, "toggle");
    },
    [commit]
  );

  const undo = useCallback(
    (id) => {
      if (!ref.current[id]) return;
      const next = { ...ref.current };
      delete next[id];
      commit(next, "undo");
    },
    [commit]
  );

  const clearAll = useCallback(() => {
    if (Object.keys(ref.current).length) commit({}, "clear");
  }, [commit]);

  // Call when the analysed area changes: segment ids belong to one analysis.
  const reset = useCallback(() => {
    if (Object.keys(ref.current).length) commit({}, "reset");
  }, [commit]);

  return { overrides, toggle, undo, clearAll, reset };
}