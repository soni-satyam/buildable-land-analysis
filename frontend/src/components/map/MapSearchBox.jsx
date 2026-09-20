export default function MapSearchBox({ query, onQueryChange, results, searching, onSubmit, onPick, onReset }) {
  return (
    <>
      <div className="map-topbar">
        <form className="search-box" onSubmit={onSubmit}>
          <input
            type="text"
            placeholder="Search for a place or address…"
            value={query}
            onChange={(e) => onQueryChange(e.target.value)}
          />
          <button type="submit" disabled={searching}>{searching ? "…" : "Search"}</button>
        </form>
        <button className="reset-btn" onClick={onReset} type="button">
          Reset to Harris County
        </button>
      </div>

      {results.length > 0 && (
        <div className="search-results">
          {results.map((r, i) => (
            <button key={i} onClick={() => onPick(r)} type="button">{r.display_name}</button>
          ))}
        </div>
      )}
    </>
  );
}