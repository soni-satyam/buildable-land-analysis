import { useCallback, useRef, useState } from "react";

function toPayload(overrides) {
  const entries = Object.values(overrides);
  const pick = (mode) => entries.filter((o) => o.mode === mode).map((o) => o.geometry);
  return { restores: pick("buildable"), excludes: pick("nonbuildable") };
}

export function useSegmentOverrides(onChange) {
  const [overrides, setOverrides] = useState({});
  const ref = useRef({});
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

  const commit = useCallback((next, reason) => {
    ref.current = next;
    setOverrides(next);
    onChangeRef.current?.(toPayload(next), reason);
  }, []);

  const toggle = useCallback((layerKey, segment) => {
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
  }, [commit]);

  const undo = useCallback((id) => {
    if (!ref.current[id]) return;
    const next = { ...ref.current };
    delete next[id];
    commit(next, "undo");
  }, [commit]);

  const clearAll = useCallback(() => {
    if (Object.keys(ref.current).length) commit({}, "clear");
  }, [commit]);

  const reset = useCallback(() => {
    if (Object.keys(ref.current).length) commit({}, "reset");
  }, [commit]);

  const restore = useCallback((snapshot) => {
    commit(snapshot ?? {}, "restore");
  }, [commit]);

  return { overrides, overridesRef: ref, toggle, undo, clearAll, reset, restore };
}