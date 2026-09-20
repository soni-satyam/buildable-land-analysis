import { useCallback, useRef, useState } from "react";

/**
 * Owns the list of user-drawn sub-regions inside the selected parcel.
 * Each region: { id, geometry, mode: "buildable" | "nonbuildable" | null, acres }
 *
 * Regions start with mode=null (neutral, shown as dashed outline) until the
 * user right-clicks them to assign a mode. Right-clicking again cycles:
 *   null -> "buildable" -> "nonbuildable" -> removed
 *
 * onChange(payload) fires whenever the list or any mode changes, where:
 *   payload = { userRegionExcludes: Geometry[], userRegionRestores: Geometry[] }
 */
export function useUserRegions(onChange) {
  const [regions, setRegions] = useState([]);
  const ref = useRef([]);
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

  const emit = useCallback((next) => {
    const excludes = next.filter((r) => r.mode === "nonbuildable").map((r) => r.geometry);
    const restores = next.filter((r) => r.mode === "buildable").map((r) => r.geometry);
    onChangeRef.current?.({ userRegionExcludes: excludes, userRegionRestores: restores });
  }, []);

  const addRegion = useCallback((geometry, acres) => {
    const id = `usr-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    const region = { id, geometry, mode: null, acres };
    const next = [...ref.current, region];
    ref.current = next;
    setRegions(next);
    emit(next);
    return id;
  }, [emit]);

  /**
   * Right-click a region: cycles null -> buildable -> nonbuildable -> (remove)
   */
  const cycleMode = useCallback((id) => {
    const next = ref.current.map((r) => {
      if (r.id !== id) return r;
      const nextMode = r.mode === null ? "buildable" : r.mode === "buildable" ? "nonbuildable" : null;
      return { ...r, mode: nextMode };
    });
    ref.current = next;
    setRegions(next);
    emit(next);
  }, [emit]);

  const removeRegion = useCallback((id) => {
    const next = ref.current.filter((r) => r.id !== id);
    ref.current = next;
    setRegions(next);
    emit(next);
  }, [emit]);

  const reset = useCallback(() => {
    ref.current = [];
    setRegions([]);
    // Don't emit on reset (new area, fresh slate)
  }, []);

  return { regions, addRegion, cycleMode, removeRegion, reset };
}
