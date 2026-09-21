export default function MapSearchBox({ query, onQueryChange, results, searching, onSubmit, onPick, onReset }) {
  const open = results.length > 0;

  return (
    <div className="center-strip map-topbar">
      <div className="map-topbar-inner">
        <div className="search-wrap">
          <form className={`search-box${open ? " open" : ""}`} onSubmit={onSubmit}>
            <input
              type="text"
              placeholder="Search place or address…"
              value={query}
              onChange={(e) => onQueryChange(e.target.value)}
              autoComplete="off"
            />
            <button type="submit" disabled={searching}>{searching ? "…" : "Search"}</button>
          </form>

          {open && (
            <div className="search-results">
              {results.map((r, i) => (
                <button key={i} onClick={() => onPick(r)} type="button">
                  <span className="sr-title">{r.title || r.display_name}</span>
                  {r.subtitle && <span className="sr-sub">{r.subtitle}</span>}
                </button>
              ))}
            </div>
          )}
        </div>

        <button className="reset-btn" onClick={onReset} type="button">Reset view</button>
      </div>
    </div>
  );
}