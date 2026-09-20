import { LAYER_STYLE } from "../../map/layerStyles.js";

const USER_REGION_COLORS = { buildable: "#2ecc71", nonbuildable: "#e74c3c", none: "#c99a46" };
const USER_REGION_NEXT_ACTION = { none: "set as buildable", buildable: "set as non-buildable", nonbuildable: "remove override" };

/** Small readout for the piece under the cursor. */
export default function SegmentHoverTag({ hovered, overrides }) {
  if (!hovered) return null;

  if (hovered.kind === "userRegion") {
    const mode = hovered.mode && hovered.mode !== "none" ? hovered.mode : "none";
    const label = mode === "buildable" ? "Buildable (your region)" : mode === "nonbuildable" ? "Non-buildable (your region)" : "Your drawn region";
    return (
      <div className="segment-hover-tag" role="status">
        <span className="segment-swatch" style={{ background: USER_REGION_COLORS[mode] }} />
        <strong>{label}</strong>
        <span>{Number(hovered.acres ?? 0).toFixed(2)} acres</span>
        <small>Right-click to {USER_REGION_NEXT_ACTION[mode]}</small>
      </div>
    );
  }

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