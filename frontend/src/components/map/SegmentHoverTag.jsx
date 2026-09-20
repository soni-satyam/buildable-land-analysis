import { LAYER_STYLE } from "../../map/layerStyles.js";

/** Small readout for the piece under the cursor. */
export default function SegmentHoverTag({ hovered, overrides }) {
  if (!hovered) return null;
  const style = LAYER_STYLE[hovered.layerKey];
  const isOverridden = Boolean(overrides[hovered.id]);
  const action = isOverridden
    ? "undo your change"
    : hovered.layerKey === "buildable"
    ? "mark as non-buildable"
    : "mark as buildable";

  return (
    <div className="segment-hover-tag" role="status">
      <span className="segment-swatch" style={{ background: style.color }} />
      <strong>{style.label}</strong>
      <span>{Number(hovered.acres).toFixed(2)} acres</span>
      <small>Right-click to {action}</small>
    </div>
  );
}