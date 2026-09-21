const REASON = {
  expired: "Saved automatically after 7 days",
  replaced: "Replaced by a new selection",
};

function fmt(ts) {
  try {
    return new Date(ts).toLocaleString([], { dateStyle: "medium", timeStyle: "short" });
  } catch {
    return "";
  }
}

export default function HistoryList({ entries, onRestore, onDelete, onClear }) {
  return (
    <div className="rp-section rp-last-section">
      <div className="hist-head">
        <p className="rp-section-label" style={{ margin: 0 }}>History</p>
        {entries.length > 0 && (
          <button type="button" className="hist-clear" onClick={onClear}>Clear all</button>
        )}
      </div>

      {entries.length === 0 ? (
        <p className="rp-hint">Past analyses appear here when they expire or are replaced.</p>
      ) : (
        <ul className="hist-list">
          {entries.map((e) => (
            <li key={e.id} className="hist-item">
              <div className="hist-main">
                <span className="hist-title">
                  {e.summary
                    ? `${e.summary.parcel_acres} ac · ${e.summary.buildable_acres} ac buildable`
                    : "Custom area"}
                </span>
                <span className="hist-meta">{fmt(e.savedAt)}</span>
                <span className="hist-meta">{REASON[e.reason] || ""}</span>
              </div>
              <div className="hist-actions">
                <button type="button" onClick={() => onRestore(e.id)}>Restore</button>
                <button type="button" className="hist-x" aria-label="Delete" onClick={() => onDelete(e.id)}>✕</button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}