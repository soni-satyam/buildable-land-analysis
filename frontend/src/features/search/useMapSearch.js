import { useEffect, useRef, useState } from "react";
import { HARRIS_COUNTY_BOUNDS } from "../../map/constants.js";

const MIN_CHARS = 3;
const DEBOUNCE_MS = 350;

// Photon feature -> the { display_name, boundingbox } shape the UI already uses
function normalize(f) {
  const p = f.properties || {};
  const [lon, lat] = f.geometry.coordinates;

  const title = p.name || p.street || "";
  const kind = (p.type || p.osm_value || "").replace(/_/g, " ");
  const sub = [...new Set(
    [kind && kind[0].toUpperCase() + kind.slice(1), p.district, p.city, p.county, p.state, p.country]
      .filter((x) => x && x !== title),
  )].join(" · ");

  const display_name = [...new Set([title, p.city, p.state, p.country].filter(Boolean))].join(", ");

  let boundingbox;
  if (p.extent) {
    const [minLon, maxLat, maxLon, minLat] = p.extent;
    boundingbox = [minLat, maxLat, minLon, maxLon];
  } else {
    const d = 0.005;
    boundingbox = [lat - d, lat + d, lon - d, lon + d];
  }
  return { title, subtitle: sub, display_name, boundingbox, lat, lon };
}

export function useMapSearch(mapRef) {
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState([]);
  const [searching, setSearching] = useState(false);
  const skipNextRef = useRef(false); // don't re-search when we set the query ourselves

  useEffect(() => {
    if (skipNextRef.current) {
      skipNextRef.current = false;
      setSearching(false);
      return undefined;
    }
    const q = searchQuery.trim();
    if (q.length < MIN_CHARS) {
      setSearchResults([]);
      setSearching(false);
      return undefined;
    }

    const ctrl = new AbortController();
    const timer = setTimeout(async () => {
      setSearching(true);
      try {
        const c = mapRef.current?.getCenter();
        const bias = c ? `&lat=${c.lat}&lon=${c.lng}` : "";
        const res = await fetch(
          `https://photon.komoot.io/api/?limit=5&lang=en&q=${encodeURIComponent(q)}${bias}`,
          { signal: ctrl.signal },
        );
        const json = await res.json();
        const seen = new Set();
        const list = (json.features || []).map(normalize).filter((r) => {
          const k = `${r.title}|${r.subtitle}`;
          if (seen.has(k)) return false;
          seen.add(k);
          return true;
        });
        setSearchResults(list);
      } catch (err) {
        if (err.name !== "AbortError") {
          console.error("Search failed:", err);
          setSearchResults([]);
        }
      } finally {
        if (!ctrl.signal.aborted) setSearching(false);
      }
    }, DEBOUNCE_MS);

    // Typing another character cancels the pending / in-flight request.
    return () => { clearTimeout(timer); ctrl.abort(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchQuery]);

  // Enter / Search button: jump to the top suggestion if there is one.
  function runSearch(e) {
    e.preventDefault();
    if (searchResults.length > 0) flyToSearchResult(searchResults[0]);
  }

  function flyToSearchResult(r) {
    const map = mapRef.current;
    if (!map) return;
    const [south, north, west, east] = r.boundingbox.map(Number);
    map.fitBounds([[west, south], [east, north]], { padding: 60, duration: 800, maxZoom: 17 });
    skipNextRef.current = true;
    setSearchResults([]);
    setSearchQuery(r.display_name);
  }

  function resetToHarrisCounty() {
    const map = mapRef.current;
    if (!map) return;
    map.fitBounds(HARRIS_COUNTY_BOUNDS, { padding: 20, duration: 800 });
    skipNextRef.current = true;
    setSearchQuery("");
    setSearchResults([]);
  }

  return { searchQuery, setSearchQuery, searchResults, searching, runSearch, flyToSearchResult, resetToHarrisCounty };
}