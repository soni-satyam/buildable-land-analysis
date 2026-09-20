import { LAYER_STYLE } from "../../map/layerStyles.js";

/** Lists every piece the user has flipped, each with its own undo. */
export default function SegmentOverridePanel({ overrides, onUndo, onClearAll }) {
  const items = Object.entries(overrides);

  return (
    <aside className="segment-panel" aria-label="Land pieces">
      <h3>Land pieces</h3>
      {items.length === 0 ? (
        <p>Right-click a highlighted piece on the map to switch it between buildable and non-buildable.</p>
      ) : (
        <>
          <ul>
            {items.map(([id, o]) => (
              <li key={id}>
                <span>
                  {LAYER_STYLE[o.layerKey].label}, {Number(o.acres).toFixed(2)} acres
                  <em>{o.mode === "buildable" ? "now buildable" : "now non-buildable"}</em>
                </span>
                <button type="button" onClick={() => onUndo(id)}>Undo</button>
              </li>
            ))}
          </ul>
          <button type="button" className="segment-panel-clear" onClick={onClearAll}>Undo all changes</button>
        </>
      )}
    </aside>
  );
}