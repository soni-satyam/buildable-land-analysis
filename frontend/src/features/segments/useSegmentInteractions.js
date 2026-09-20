import { useEffect, useRef, useState } from "react";
import { SEGMENT_FILL_LAYER_IDS } from "../../map/constants.js";

/**
 * Hover highlight + right-click toggle for segment pieces.
 *
 *  - hover: sets feature-state on the topmost piece under the cursor and
 *    exposes it as `hovered` (for the small info tag).
 *  - right-click on a piece: onToggleSegment(layerKey, segment).
 *  - right-click on empty space: onRestoreAt(lngLat) - your existing brush
 *    circle restore, unchanged.
 *
 * The full geometry is looked up from `result.segments` rather than read
 * off the rendered feature, because rendered features are clipped to tiles.
 */
export function useSegmentInteractions(mapRef, ready, { result, onToggleSegment, onRestoreAt }) {
  const latest = useRef({});
  latest.current = { result, onToggleSegment, onRestoreAt };
  const [hovered, setHovered] = useState(null);

  useEffect(() => {
    if (!ready) return;
    const map = mapRef.current;
    const canvas = map.getCanvas();
    let active = null; // { source, id } currently hovered

    const hitTest = (point) => {
      const layers = SEGMENT_FILL_LAYER_IDS.filter((id) => map.getLayer(id));
      if (!layers.length) return null;
      const f = map.queryRenderedFeatures(point, { layers })[0]; // topmost first
      if (!f) return null;
      const { id, layerKey, acres } = f.properties;
      return { source: f.source, id, layerKey, acres };
    };

    const setHover = (hit) => {
      if (active?.id === hit?.id && active?.source === hit?.source) return;
      try {
        if (active) map.setFeatureState(active, { hover: false });
        if (hit) map.setFeatureState({ source: hit.source, id: hit.id }, { hover: true });
      } catch {
        /* source may be gone during teardown */
      }
      active = hit ? { source: hit.source, id: hit.id } : null;
      setHovered(hit ? { id: hit.id, layerKey: hit.layerKey, acres: hit.acres } : null);
    };

    const onMove = (e) => setHover(hitTest(e.point));
    const onLeave = () => setHover(null);

    const onContextMenu = (e) => {
      e.originalEvent?.preventDefault?.();
      const hit = hitTest(e.point);
      const { result, onToggleSegment, onRestoreAt } = latest.current;
      if (hit) {
        const segment = result?.segments?.[hit.layerKey]?.find((s) => s.id === hit.id);
        if (segment) {
          onToggleSegment?.(hit.layerKey, segment);
          return;
        }
      }
      onRestoreAt?.(e.lngLat);
    };

    // Keep the browser's own context menu off the canvas.
    const suppress = (ev) => ev.preventDefault();

    map.on("mousemove", onMove);
    map.on("contextmenu", onContextMenu);
    canvas.addEventListener("mouseleave", onLeave);
    canvas.addEventListener("contextmenu", suppress);

    return () => {
      map.off("mousemove", onMove);
      map.off("contextmenu", onContextMenu);
      canvas.removeEventListener("mouseleave", onLeave);
      canvas.removeEventListener("contextmenu", suppress);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready]);

  return { hovered };
}