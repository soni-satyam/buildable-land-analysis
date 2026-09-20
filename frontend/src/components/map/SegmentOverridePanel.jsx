import { LAYER_STYLE } from "../../map/layerStyles.js";

const REGION_MODE_LABEL = { buildable: "buildable", nonbuildable: "non-buildable", none: "unset — right-click to assign" };
const REGION_MODE_COLOR = { buildable: "#2ecc71", nonbuildable: "#e74c3c", none: "#c99a46" };

/** Lists every piece the user has flipped + every user-drawn region. */
export default function SegmentOverridePanel({ overrides, onUndo, onClearAll, userRegions, onRemoveRegion }) {
  const overrideItems = Object.entries(overrides);
  const regionItems = userRegions ?? [];
  const hasAnything = overrideItems.length > 0 || regionItems.length > 0;

  return (
    <aside className="segment-panel" aria-label="Land pieces">
      <h3>Land pieces</h3>

      {!hasAnything && (
        <p>Right-click a highlighted piece on the map to switch it between buildable and non-buildable. Draw a shape on your selected land to create a custom region.</p>
      )}

      {regionItems.length > 0 && (
        <>
          <p className="segment-panel-section-title">Your drawn regions</p>
          <ul>
            {regionItems.map((r) => {
              const mode = r.mode ?? "none";
              return (
                <li key={r.id}>
                  <span>
                    <span className="segment-swatch" style={{ background: REGION_MODE_COLOR[mode], display: "inline-block", width: 8, height: 8, borderRadius: 2, marginRight: 5 }} />
                    {Number(r.acres ?? 0).toFixed(2)} ac
                    <em>{REGION_MODE_LABEL[mode]}</em>
                  </span>
                  <button type="button" onClick={() => onRemoveRegion(r.id)}>Remove</button>
                </li>
              );
            })}
          </ul>
        </>
      )}

      {overrideItems.length > 0 && (
        <>
          <p className="segment-panel-section-title">Flipped segments</p>
          <ul>
            {overrideItems.map(([id, o]) => (
              <li key={id}>
                <span>
                  {LAYER_STYLE[o.layerKey].label}, {Number(o.acres).toFixed(2)} acres
                  <em>{o.mode === "buildable" ? "now buildable" : "now non-buildable"}</em>
                </span>
                <button type="button" onClick={() => onUndo(id)}>Undo</button>
              </li>
            ))}
          </ul>
          <button type="button" className="segment-panel-clear" onClick={onClearAll}>Undo all segment changes</button>
        </>
      )}
    </aside>
  );
}