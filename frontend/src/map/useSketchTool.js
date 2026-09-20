import { useCallback, useEffect, useRef, useState } from "react";
import { EMPTY_FC } from "./constants.js";

const SKETCH_TOOLS = new Set(["line", "freehand"]);
const CLOSE_PX = 12;  // freehand: a click this close to the first point closes the shape
const DEDUPE_PX = 4;  // ignore a click this close to the previous point (2nd click of a double-click)
const SNAP_PX = 14;   // line: ends within this many pixels of another line count as connected

const brass = "#c99a46";

/**
 * Two click-to-place tools that share one sketch layer:
 *
 *  freehand - click points; they are joined in order. Close the shape by
 *             clicking the first point, double-clicking, or pressing Enter.
 *             The result is a polygon.
 *
 *  line     - draw the boundary with lines (click points, double-click /
 *             Enter to end each line). Lines stay on the map. After each
 *             line, `resolveLines(lines, snapFt)` asks the backend whether
 *             the lines enclose land; if so that land is submitted, if not
 *             the user gets a short "not connected" notice and can keep
 *             adding lines.
 *
 * Backspace / Ctrl+Z undo, Esc cancels. Finished shapes go to
 * `submitShape(geometry)` (from useDrawTool).
 */
export function useSketchTool(mapRef, ready, { tool, submitShape, resolveLines, notify }) {
  const cb = useRef({});
  cb.current = { tool, submitShape, resolveLines, notify };
  const api = useRef({});
  const st = useRef({ path: [], lines: [], cursor: null, req: 0 });
  const [counts, setCounts] = useState({ points: 0, lines: 0 });

  useEffect(() => {
    if (!ready) return;
    const map = mapRef.current;
    const s = st.current;

    map.addSource("sketch", { type: "geojson", data: EMPTY_FC });
    map.addLayer({ id: "sketch-fill", type: "fill", source: "sketch", filter: ["==", ["get", "kind"], "preview"], paint: { "fill-color": brass, "fill-opacity": 0.15 } });
    map.addLayer({ id: "sketch-lines", type: "line", source: "sketch", filter: ["any", ["==", ["get", "kind"], "line"], ["==", ["get", "kind"], "path"]], paint: { "line-color": brass, "line-width": 2.5 } });
    map.addLayer({ id: "sketch-rubber", type: "line", source: "sketch", filter: ["==", ["get", "kind"], "rubber"], paint: { "line-color": brass, "line-width": 2, "line-dasharray": [2, 2] } });
    map.addLayer({
      id: "sketch-vertex", type: "circle", source: "sketch", filter: ["==", ["get", "kind"], "vertex"],
      paint: { "circle-radius": ["case", ["get", "first"], 7, 4], "circle-color": "#ffffff", "circle-stroke-color": brass, "circle-stroke-width": 2 },
    });

    const lineFeature = (coords, kind) => ({ type: "Feature", properties: { kind }, geometry: { type: "LineString", coordinates: coords } });
    const pointFeature = (c, first = false) => ({ type: "Feature", properties: { kind: "vertex", first }, geometry: { type: "Point", coordinates: c } });
    const px = (a, b) => {
      const p = map.project(a), q = map.project(b);
      return Math.hypot(p.x - q.x, p.y - q.y);
    };

    function render() {
      const { path, lines, cursor } = s;
      const isFree = cb.current.tool === "freehand";
      const f = [];
      for (const l of lines) {
        f.push(lineFeature(l, "line"));
        f.push(pointFeature(l[0]), pointFeature(l[l.length - 1]));
      }
      if (path.length >= 2) f.push(lineFeature(path, "path"));
      if (path.length && cursor) f.push(lineFeature([path[path.length - 1], cursor], "rubber"));
      if (isFree && path.length >= 2 && cursor) {
        f.push(lineFeature([cursor, path[0]], "rubber")); // closing preview
        f.push({ type: "Feature", properties: { kind: "preview" }, geometry: { type: "Polygon", coordinates: [[...path, cursor, path[0]]] } });
      }
      path.forEach((p, i) => f.push(pointFeature(p, isFree && i === 0)));
      map.getSource("sketch")?.setData({ type: "FeatureCollection", features: f });
      setCounts((c) => (c.points === path.length && c.lines === lines.length ? c : { points: path.length, lines: lines.length }));
    }

    // Pixels -> feet at the current zoom, so "connected" feels the same at any zoom.
    function snapToleranceFt() {
      const lat = map.getCenter().lat;
      const mpp = (78271.517 * Math.cos((lat * Math.PI) / 180)) / Math.pow(2, map.getZoom());
      return Math.min(150, Math.max(5, (SNAP_PX * mpp) / 0.3048));
    }

    async function closeLines() {
      const { resolveLines, submitShape, notify } = cb.current;
      const mine = ++s.req;
      const lines = s.lines.map((coordinates) => ({ type: "LineString", coordinates }));
      try {
        const geometry = await resolveLines(lines, snapToleranceFt());
        if (mine !== s.req) return; // sketch changed while waiting
        if (!geometry) {
          notify?.("Land not selected: lines aren't connected");
          return;
        }
        s.lines = [];
        render();
        submitShape(geometry);
      } catch (e) {
        if (mine !== s.req) return;
        console.error("Could not resolve lines:", e);
        notify?.("Couldn't check the lines. Try again.");
      }
    }

    function finish() {
      const { tool, submitShape, notify } = cb.current;
      if (tool === "freehand") {
        if (s.path.length < 3) return notify?.("Add at least 3 points");
        const ring = [...s.path, s.path[0]];
        s.path = [];
        s.cursor = null;
        render();
        submitShape({ type: "Polygon", coordinates: [ring] });
      } else if (tool === "line") {
        if (s.path.length < 2) return notify?.("A line needs at least 2 points");
        s.lines.push(s.path);
        s.path = [];
        render();
        closeLines();
      }
    }

    function undo() {
      s.req++;
      if (s.path.length) s.path.pop();
      else if (s.lines.length) s.lines.pop();
      render();
    }
    function cancel() {
      s.req++;
      if (s.path.length) s.path = [];
      else s.lines = [];
      render();
    }
    function clearAll() {
      s.req++;
      s.path = [];
      s.lines = [];
      s.cursor = null;
      render();
    }
    api.current = { finish, undo, cancel, clearAll };

    const active = () => SKETCH_TOOLS.has(cb.current.tool);

    function onClick(e) {
      if (!active()) return;
      const pt = [e.lngLat.lng, e.lngLat.lat];
      const last = s.path[s.path.length - 1];
      if (last && px(last, pt) < DEDUPE_PX) return;
      if (cb.current.tool === "freehand" && s.path.length >= 3 && px(s.path[0], pt) < CLOSE_PX) return finish();
      s.path.push(pt);
      render();
    }
    function onDblClick(e) {
      if (!active()) return;
      e.preventDefault(); // no zoom
      finish();
    }
    function onMove(e) {
      if (!active()) return;
      s.cursor = [e.lngLat.lng, e.lngLat.lat];
      if (s.path.length) render();
    }
    function onKey(e) {
      if (!active()) return;
      const t = e.target;
      if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable)) return;
      if (e.key === "Enter") { e.preventDefault(); finish(); }
      else if (e.key === "Backspace" || e.key === "Delete" || ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "z")) {
        e.preventDefault();
        e.stopPropagation(); // ← add this
        undo();
      }
      else if (e.key === "Escape") cancel();
    }

    map.on("click", onClick);
    map.on("dblclick", onDblClick);
    map.on("mousemove", onMove);
    window.addEventListener("keydown", onKey);

    return () => {
      map.off("click", onClick);
      map.off("dblclick", onDblClick);
      map.off("mousemove", onMove);
      window.removeEventListener("keydown", onKey);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready]);

  // Switching tools discards the sketch; double-click must not zoom while sketching.
  useEffect(() => {
    if (!ready) return;
    const map = mapRef.current;
    api.current.clearAll?.();
    if (SKETCH_TOOLS.has(tool)) map.doubleClickZoom.disable();
    else map.doubleClickZoom.enable();
    return () => {
      try {
        map.doubleClickZoom.enable();
      } catch {
        /* map already removed */
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, tool]);

  return {
    counts,
    finish: useCallback(() => api.current.finish?.(), []),
    undo: useCallback(() => api.current.undo?.(), []),
    clearAll: useCallback(() => api.current.clearAll?.(), []),
  };
}