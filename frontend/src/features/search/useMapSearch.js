import { useState } from "react";
import { HARRIS_COUNTY_BOUNDS } from "../../map/constants.js";

/**
 * Free-text place/address search via Nominatim (OpenStreetMap's free
 * geocoder, no API key) and the "Reset to Harris County" action. Both
 * just move the existing map instance - no sources/layers of their own.
 */
export function useMapSearch(mapRef) {
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState([]);
  const [searching, setSearching] = useState(false);

  async function runSearch(e) {
    e.preventDefault();
    if (!searchQuery.trim()) return;
    setSearching(true);
    try {
      const res = await fetch(`https://nominatim.openstreetmap.org/search?format=json&limit=5&q=${encodeURIComponent(searchQuery)}`);
      setSearchResults(await res.json());
    } catch (e) {
      console.error("Search failed:", e);
      setSearchResults([]);
    } finally {
      setSearching(false);
    }
  }

  function flyToSearchResult(r) {
    const map = mapRef.current;
    if (!map) return;
    const [south, north, west, east] = r.boundingbox.map(Number);
    map.fitBounds([[west, south], [east, north]], { padding: 60, duration: 800, maxZoom: 17 });
    setSearchResults([]);
    setSearchQuery(r.display_name);
  }

  function resetToHarrisCounty() {
    const map = mapRef.current;
    if (!map) return;
    map.fitBounds(HARRIS_COUNTY_BOUNDS, { padding: 20, duration: 800 });
    setSearchQuery("");
    setSearchResults([]);
  }

  return { searchQuery, setSearchQuery, searchResults, searching, runSearch, flyToSearchResult, resetToHarrisCounty };
}