import { useEffect, useState } from "react";
import { EMPTY_FC, MIN_PARCEL_ZOOM } from "../../map/constants.js";
import { fetchParcels } from "./parcelApi.js";

/**
 * Passive reference layer: real parcel boundaries in view. Below
 * MIN_PARCEL_ZOOM it clears and reports `zoomedOut` for the hint banner.
 * In-flight requests are aborted when the view moves again.
 */
export function useViewportParcels(mapRef, ready) {
  const [zoomedOut, setZoomedOut] = useState(false);

  useEffect(() => {
    if (!ready) return;
    const map = mapRef.current;

    map.addSource("parcels-view", { type: "geojson", data: EMPTY_FC });
    map.addLayer({ id: "parcels-view-fill", type: "fill", source: "parcels-view", paint: { "fill-color": "#8296a1", "fill-opacity": 0.03 } });
    map.addLayer({ id: "parcels-view-outline", type: "line", source: "parcels-view", paint: { "line-color": "#8296a1", "line-width": 0.75 } });

    let timer;
    let controller;

    async function refresh() {
      controller?.abort();
      if (map.getZoom() < MIN_PARCEL_ZOOM) {
        setZoomedOut(true);
        map.getSource("parcels-view")?.setData(EMPTY_FC);
        return;
      }
      setZoomedOut(false);
      const mine = new AbortController();
      controller = mine;
      const b = map.getBounds();
      try {
        const fc = await fetchParcels(
          { west: b.getWest(), south: b.getSouth(), east: b.getEast(), north: b.getNorth() },
          mine.signal
        );
        if (!mine.signal.aborted) map.getSource("parcels-view")?.setData(fc);
      } catch (e) {
        if (e.name !== "AbortError") console.error("Failed to load parcels in viewport:", e);
      }
    }

    const schedule = () => {
      clearTimeout(timer);
      timer = setTimeout(refresh, 250);
    };

    map.on("moveend", schedule);
    refresh();

    return () => {
      clearTimeout(timer);
      controller?.abort();
      map.off("moveend", schedule);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready]);

  return { zoomedOut };
}