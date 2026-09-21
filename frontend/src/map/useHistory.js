import { useCallback, useRef, useState } from "react";

export function useHistory(onRestore) {
  const past = useRef([]);
  const future = useRef([]);
  const onRestoreRef = useRef(onRestore);
  onRestoreRef.current = onRestore;

  const [counts, setCounts] = useState({ past: 0, future: 0 });

  const sync = useCallback(() => {
    setCounts((c) => {
      const np = past.current.length;
      const nf = future.current.length;
      return c.past === np && c.future === nf ? c : { past: np, future: nf };
    });
  }, []);

  const push = useCallback((snapshot) => {
    past.current.push(snapshot);
    future.current = [];
    sync();
  }, [sync]);

  const undo = useCallback(() => {
    if (!past.current.length) return;
    const snapshot = past.current.pop();
    future.current.unshift(snapshot);
    const target = past.current[past.current.length - 1] ?? null;
    onRestoreRef.current?.(target);
    sync();
  }, [sync]);

  const redo = useCallback(() => {
    if (!future.current.length) return;
    const snapshot = future.current.shift();
    past.current.push(snapshot);
    onRestoreRef.current?.(snapshot);
    sync();
  }, [sync]);

  const reset = useCallback(() => {
    past.current = [];
    future.current = [];
    sync();
  }, [sync]);

  const getState = useCallback(() => ({ past: past.current, future: future.current }), []);
  const load = useCallback((state) => {
    past.current = state?.past ?? [];
    future.current = state?.future ?? [];
    sync();
  }, [sync]);

  return { push, undo, redo, reset, getState, load, canUndo: counts.past > 0, canRedo: counts.future > 0 };
}