import { useCallback, useEffect, useRef } from "react";
import { makeCircle } from "../../map/geometryUtils.js";

export const ADJUSTMENT_KEYS = { excludes: "user_exclusions", restores: "user_restores" };

export function useAdjustments({ onAdjustment, restoreBrushFt }) {
  const cb = useRef({});
  cb.current = { onAdjustment, restoreBrushFt };
  const lists = useRef({
    drawnExcludes: [], brushRestores: [],
    segExcludes: [], segRestores: [],
    userRegionExcludes: [], userRegionRestores: [],
  });
  const restoreTimer = useRef(null);

  const emit = useCallback(() => {
    const l = lists.current;
    cb.current.onAdjustment?.({
      [ADJUSTMENT_KEYS.excludes]: [
        ...l.drawnExcludes,
        ...l.segExcludes.map((geometry) => ({ kind: "exclude", geometry })),
        ...l.userRegionExcludes.map((geometry) => ({ kind: "exclude", geometry })),
      ],
      [ADJUSTMENT_KEYS.restores]: [
        ...l.brushRestores,
        ...l.segRestores.map((geometry) => ({ kind: "restore", geometry })),
        ...l.userRegionRestores.map((geometry) => ({ kind: "restore", geometry })),
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

  const setSegmentOverrides = useCallback((payload, reason) => {
    lists.current.segRestores = payload.restores;
    lists.current.segExcludes = payload.excludes;
    if (reason !== "reset") emit();
  }, [emit]);

  const setUserRegions = useCallback((payload) => {
    lists.current.userRegionExcludes = payload.userRegionExcludes ?? [];
    lists.current.userRegionRestores = payload.userRegionRestores ?? [];
    emit();
  }, [emit]);

  const restoreDrawnAndBrush = useCallback((drawnExcludes, brushRestores) => {
    lists.current.drawnExcludes = drawnExcludes ?? [];
    lists.current.brushRestores = brushRestores ?? [];
    emit();
  }, [emit]);

  const getLists = useCallback(() => ({ ...lists.current }), []);

  const reset = useCallback(() => {
    clearTimeout(restoreTimer.current);
    lists.current = {
      drawnExcludes: [], brushRestores: [],
      segExcludes: [], segRestores: [],
      userRegionExcludes: [], userRegionRestores: [],
    };
  }, []);

  useEffect(() => () => clearTimeout(restoreTimer.current), []);

  return { addExclude, restoreAt, setSegmentOverrides, setUserRegions, restoreDrawnAndBrush, getLists, reset };
}