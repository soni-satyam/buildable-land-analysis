import { useCallback, useEffect, useRef } from "react";
import { makeCircle } from "../../map/geometryUtils.js";

// Verified against your old Map.jsx: the backend takes arrays of
// { kind, geometry } under these two keys.
export const ADJUSTMENT_KEYS = { excludes: "user_exclusions", restores: "user_restores" };

/**
 * Accumulates every manual edit and reports the FULL arrays each time:
 *   drawn excludes    (polygon drawn after a result exists)
 *   brush restores    (right-click on empty space, restoreBrushFt radius; debounced 200ms like before)
 *   segment excludes / restores (from useSegmentOverrides)
 */
export function useAdjustments({ onAdjustment, restoreBrushFt }) {
  const cb = useRef({});
  cb.current = { onAdjustment, restoreBrushFt };
  const lists = useRef({ drawnExcludes: [], brushRestores: [], segExcludes: [], segRestores: [] });
  const restoreTimer = useRef(null);

  const emit = useCallback(() => {
    const l = lists.current;
    cb.current.onAdjustment?.({
      [ADJUSTMENT_KEYS.excludes]: [
        ...l.drawnExcludes,
        ...l.segExcludes.map((geometry) => ({ kind: "exclude", geometry })),
      ],
      [ADJUSTMENT_KEYS.restores]: [
        ...l.brushRestores,
        ...l.segRestores.map((geometry) => ({ kind: "restore", geometry })),
      ],
    });
  }, []);

  const addExclude = useCallback((geometry) => {
    lists.current.drawnExcludes = [...lists.current.drawnExcludes, { kind: "exclude", geometry }];
    emit();
  }, [emit]);

  const restoreAt = useCallback((lngLat) => {
    const circle = makeCircle(lngLat.lng, lngLat.lat, cb.current.restoreBrushFt || 60);
    lists.current.brushRestores = [...lists.current.brushRestores, { kind: "restore", geometry: circle }];
    clearTimeout(restoreTimer.current);
    restoreTimer.current = setTimeout(emit, 200);
  }, [emit]);

  // Wire to useSegmentOverrides' onChange. "reset" = a new analysis is
  // starting: store the empty lists but don't trigger a re-analysis.
  const setSegmentOverrides = useCallback((payload, reason) => {
    lists.current.segRestores = payload.restores;
    lists.current.segExcludes = payload.excludes;
    if (reason !== "reset") emit();
  }, [emit]);

  const reset = useCallback(() => {
    clearTimeout(restoreTimer.current);
    lists.current = { drawnExcludes: [], brushRestores: [], segExcludes: [], segRestores: [] };
  }, []);

  useEffect(() => () => clearTimeout(restoreTimer.current), []);

  return { addExclude, restoreAt, setSegmentOverrides, reset };
}