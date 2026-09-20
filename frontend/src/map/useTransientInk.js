import { useCallback, useEffect, useRef } from "react";

const LASER_COLOR = "#ff2d2d";
const LASER_TRAIL_MS = 450;

/**
 * Presentation tools drawn on a canvas overlay (never part of the analysis):
 *
 *  - "laser": a glowing dot that follows the cursor with a short fading trail.
 *    The canvas stays click-through; input comes from map events.
 *  - "brush": hold the button and paint; every point fades out `fadeMs`
 *    after it was laid down, so the stroke "dries" from its oldest end.
 *    While the brush is active the canvas itself captures the pointer, so
 *    the map underneath can never start a drag. (Wheel zoom is forwarded to
 *    the map; to pan, switch to the Pan tool.)
 *
 * Points are stored as lng/lat and re-projected every frame, so ink stays
 * pinned to the ground if the map is zoomed while it fades. The animation
 * loop only runs while there is something left to fade.
 */
export function useTransientInk(mapRef, ready, canvasRef, { tool, color = "#ffd60a", width = 5, fadeMs = 4000 }) {
  const opts = useRef({});
  opts.current = { tool, color, width, fadeMs };
  const state = useRef({ strokes: [], current: null, trail: [], head: null });
  const kickRef = useRef(() => {});

  useEffect(() => {
    if (!ready) return;
    const map = mapRef.current;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    const s = state.current;
    let raf = 0;

    function kick() {
      if (!raf) raf = requestAnimationFrame(frame);
    }
    function frame() {
      raf = 0;
      if (render()) kick();
    }
    kickRef.current = kick;

    function resize() {
      const dpr = window.devicePixelRatio || 1;
      const { clientWidth: w, clientHeight: h } = map.getContainer();
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(h * dpr);
      canvas.style.width = `${w}px`;
      canvas.style.height = `${h}px`;
      kick();
    }

    const project = (p) => {
      const q = map.project([p.lng, p.lat]);
      return { x: q.x, y: q.y, t: p.t };
    };

    // Returns true while anything is still fading.
    function render() {
      const dpr = window.devicePixelRatio || 1;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, canvas.width / dpr, canvas.height / dpr);
      ctx.lineCap = "round";
      ctx.lineJoin = "round";

      const { fadeMs } = opts.current;
      const now = performance.now();
      let alive = false;

      // --- brush strokes ---
      s.strokes = s.strokes.filter((st) => {
        st.points = st.points.filter((p) => now - p.t < fadeMs);
        return st === s.current || st.points.length > 0;
      });
      for (const st of s.strokes) {
        const pts = st.points.map(project);
        if (!pts.length) continue;
        alive = true;
        ctx.strokeStyle = st.color;
        ctx.fillStyle = st.color;
        ctx.lineWidth = st.width;
        if (pts.length === 1) {
          ctx.globalAlpha = Math.max(0, 1 - (now - pts[0].t) / fadeMs);
          ctx.beginPath();
          ctx.arc(pts[0].x, pts[0].y, st.width / 2, 0, Math.PI * 2);
          ctx.fill();
        }
        for (let i = 1; i < pts.length; i++) {
          ctx.globalAlpha = Math.max(0, 1 - (now - pts[i].t) / fadeMs);
          ctx.beginPath();
          ctx.moveTo(pts[i - 1].x, pts[i - 1].y);
          ctx.lineTo(pts[i].x, pts[i].y);
          ctx.stroke();
        }
      }

      // --- laser: fading trail + glowing head ---
      s.trail = s.trail.filter((p) => now - p.t < LASER_TRAIL_MS);
      ctx.shadowColor = LASER_COLOR;
      ctx.shadowBlur = 14;
      ctx.strokeStyle = LASER_COLOR;
      ctx.lineWidth = 4;
      const trail = s.trail.map(project);
      for (let i = 1; i < trail.length; i++) {
        ctx.globalAlpha = Math.max(0, 1 - (now - trail[i].t) / LASER_TRAIL_MS);
        ctx.beginPath();
        ctx.moveTo(trail[i - 1].x, trail[i - 1].y);
        ctx.lineTo(trail[i].x, trail[i].y);
        ctx.stroke();
      }
      if (trail.length) alive = true;
      if (s.head) {
        const h = project(s.head);
        ctx.globalAlpha = 1;
        ctx.fillStyle = LASER_COLOR;
        ctx.beginPath();
        ctx.arc(h.x, h.y, 7, 0, Math.PI * 2);
        ctx.fill();
        ctx.shadowBlur = 0;
        ctx.fillStyle = "#ffffff";
        ctx.beginPath();
        ctx.arc(h.x, h.y, 2.5, 0, Math.PI * 2);
        ctx.fill();
      }

      ctx.shadowBlur = 0;
      ctx.globalAlpha = 1;
      return alive;
    }

    // ---------- laser: map events (canvas is click-through) ----------
    const mapPt = (e) => ({ lng: e.lngLat.lng, lat: e.lngLat.lat, t: performance.now() });
    const laserAt = (e) => {
      if (opts.current.tool !== "laser") return;
      const p = mapPt(e);
      s.head = p;
      s.trail.push(p);
      kick();
    };
    const onLaserDown = (e) => {
      if (e.originalEvent?.button > 0) return;
      laserAt(e);
    };
    const laserOff = () => {
      if (opts.current.tool !== "laser") return;
      s.head = null;
      kick();
    };

    // ---------- brush: pointer events on the canvas itself ----------
    const canvasPt = (e) => {
      const r = canvas.getBoundingClientRect();
      const ll = map.unproject([e.clientX - r.left, e.clientY - r.top]);
      return { lng: ll.lng, lat: ll.lat, t: performance.now() };
    };
    const onPointerDown = (e) => {
      if (opts.current.tool !== "brush" || e.button > 0) return;
      e.preventDefault();
      canvas.setPointerCapture?.(e.pointerId); // keep receiving moves even outside the map
      const { color, width } = opts.current;
      s.current = { color, width, points: [canvasPt(e)] };
      s.strokes.push(s.current);
      kick();
    };
    const onPointerMove = (e) => {
      if (opts.current.tool !== "brush" || !s.current) return;
      for (const ev of e.getCoalescedEvents?.() ?? [e]) s.current.points.push(canvasPt(ev)); // smoother strokes
      kick();
    };
    const onPointerUp = () => {
      s.current = null;
    };
    // The canvas covers the map while brushing, so hand wheel-zoom on to the map.
    const onWheel = (e) => {
      e.preventDefault();
      map.getCanvasContainer().dispatchEvent(new WheelEvent("wheel", e));
    };

    const mapCanvas = map.getCanvas();
    map.on("mousedown", onLaserDown);
    map.on("touchstart", onLaserDown);
    map.on("mousemove", laserAt);
    map.on("touchmove", laserAt);
    map.on("touchend", laserOff);
    map.on("touchcancel", laserOff);
    map.on("move", kick);
    map.on("resize", resize);
    mapCanvas.addEventListener("mouseleave", laserOff);
    canvas.addEventListener("pointerdown", onPointerDown);
    canvas.addEventListener("pointermove", onPointerMove);
    canvas.addEventListener("pointerup", onPointerUp);
    canvas.addEventListener("pointercancel", onPointerUp);
    canvas.addEventListener("wheel", onWheel, { passive: false });
    resize();

    return () => {
      cancelAnimationFrame(raf);
      map.off("mousedown", onLaserDown);
      map.off("touchstart", onLaserDown);
      map.off("mousemove", laserAt);
      map.off("touchmove", laserAt);
      map.off("touchend", laserOff);
      map.off("touchcancel", laserOff);
      map.off("move", kick);
      map.off("resize", resize);
      mapCanvas.removeEventListener("mouseleave", laserOff);
      canvas.removeEventListener("pointerdown", onPointerDown);
      canvas.removeEventListener("pointermove", onPointerMove);
      canvas.removeEventListener("pointerup", onPointerUp);
      canvas.removeEventListener("pointercancel", onPointerUp);
      canvas.removeEventListener("wheel", onWheel);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready]);

  // Only the brush makes the canvas interactive; every other tool leaves it click-through.
  useEffect(() => {
    if (!ready) return;
    const canvas = canvasRef.current;
    if (canvas) {
      const brush = tool === "brush";
      canvas.style.pointerEvents = brush ? "auto" : "none";
      canvas.style.touchAction = brush ? "none" : "";
    }
    const s = state.current;
    s.current = null;
    if (tool !== "laser") {
      s.head = null;
      s.trail = [];
    }
    kickRef.current();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, tool]);

  const clearInk = useCallback(() => {
    const s = state.current;
    s.strokes = [];
    s.current = null;
    s.trail = [];
    s.head = null;
    kickRef.current();
  }, []);

  return { clearInk };
}