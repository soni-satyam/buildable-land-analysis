import { useCallback, useRef, useState } from "react";

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

  const commit = useCallback((next) => {
    ref.current = next;
    setRegions(next);
    emit(next);
  }, [emit]);

  const addRegion = useCallback((geometry, acres) => {
    const id = `usr-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    commit([...ref.current, { id, geometry, mode: null, acres }]);
    return id;
  }, [commit]);

  const cycleMode = useCallback((id) => {
    const region = ref.current.find((r) => r.id === id);
    if (!region) return;
    if (region.mode === "nonbuildable") {
      // instead of going back to null, just remove it
      commit(ref.current.filter((r) => r.id !== id));
    } else {
      const nextMode = region.mode === null ? "buildable" : "nonbuildable";
      commit(ref.current.map((r) => r.id !== id ? r : { ...r, mode: nextMode }));
    }
  }, [commit]);

  const removeRegion = useCallback((id) => {
    commit(ref.current.filter((r) => r.id !== id));
  }, [commit]);

  const reset = useCallback(() => {
    ref.current = [];
    setRegions([]);
  }, []);

  const restore = useCallback((snapshot) => {
    commit(snapshot ?? []);
  }, [commit]);

  return { regions, regionsRef: ref, addRegion, cycleMode, removeRegion, reset, restore };
}