import { useState } from "react";


export const BRUSH_COLORS = ["#ffd60a", "#ff453a", "#32d7ff", "#ffffff"];

const SHAPE_TOOLS = [
  ["polygon",   "Polygon",   "⬡"],
  ["rectangle", "Rectangle", "▭"],
  ["circle",    "Circle",    "○"],
  ["line",      "Line",      "╱"],
  ["freehand",  "Freehand",  "∿"],
];

const PRESENT_TOOLS = [
  ["laser", "Laser pointer", "◎"],
  ["brush", "Brush",         "✏"],
  ["pan",   "Pan",           "✥"],
];

function TbBtn({ id, label, icon, active, disabled, onClick }) {
  return (
    <button
      type="button"
      className={`tb-btn${active ? " active" : ""}`}
      id = {id}
      data-tip={label}
      disabled={disabled}
      onClick={onClick}
      aria-label={label}
    >
      {icon}
    </button>
  );
}

export default function DrawToolbar({
  tool, onToolChange,
  sketch,
  brushColor, onBrushColorChange, onClearInk,
  onUndo, onRedo, canUndo, canRedo,
}) {
  const [open, setOpen] = useState(true);
  const isLine  = tool === "line";
  const isFree  = tool === "freehand";
  const canFinish   = isFree ? sketch.counts.points >= 3 : sketch.counts.points >= 2;
  const hasAnything = sketch.counts.points > 0 || sketch.counts.lines > 0;

  return (
    <>
      {/* ── Vertical icon strip ── */}
      <div className={`left-toolbar${open ? "" : " collapsed"}`}>
        <button
          type="button"
          className="tb-toggle"
          onClick={() => setOpen((o) => !o)}
          aria-expanded={open}
          aria-label={open ? "Collapse tools" : "Expand tools"}
        >
          {open ? "▴" : "▾"}
        </button>

        {!open && <span className="tb-group-label">TOOLS</span>}

        {open && (
            <>
            <div className="tb-undo-row">
              <TbBtn label="Undo (Ctrl+Z)"        icon="↩" disabled={!canUndo} onClick={onUndo} />
              <TbBtn label="Redo (Ctrl+Shift+Z)"  icon="↪" disabled={!canRedo} onClick={onRedo} />
            </div>

            <div className="tb-divider" />
            <span className="tb-group-label">SELECT</span>

            {SHAPE_TOOLS.map(([id, label, icon]) => (
              <TbBtn key={id} id={id} label={label} icon={icon}
                active={tool === id} onClick={() => onToolChange(id)} />
            ))}

            <div className="tb-divider" />
            <span className="tb-group-label">PRESENT</span>

            {PRESENT_TOOLS.map(([id, label, icon]) => (
              <TbBtn key={id} id={id} label={label} icon={icon}
                active={tool === id} onClick={() => onToolChange(id)} />
            ))}
            </>
        )}
      </div>

      {/* ── Sketch flyout (line / freehand) ── */}
      {(isLine || isFree) && (
        <div className="tb-flyout">
          <span className="tb-flyout-count">
            {isLine
              ? `Lines: ${sketch.counts.lines} · Pts: ${sketch.counts.points}`
              : `Points: ${sketch.counts.points}`}
          </span>
          <button type="button" className="tb-flyout-btn" disabled={!canFinish} onClick={sketch.finish}>
            {isLine ? "Finish line" : "Finish shape"}
          </button>
          <button type="button" className="tb-flyout-btn" disabled={!hasAnything} onClick={sketch.undo}>Undo point</button>
          <button type="button" className="tb-flyout-btn" disabled={!hasAnything} onClick={sketch.clearAll}>Clear</button>
        </div>
      )}

      {/* ── Brush flyout ── */}
      {tool === "brush" && (
        <div className="tb-flyout">
          <div className="tb-swatches">
            {BRUSH_COLORS.map((c) => (
              <button key={c} type="button"
                className={`tb-swatch${brushColor === c ? " active" : ""}`}
                style={{ background: c }}
                aria-label={`Color ${c}`}
                onClick={() => onBrushColorChange(c)}
              />
            ))}
          </div>
          <button type="button" className="tb-flyout-btn" onClick={onClearInk}>Clear ink</button>
        </div>
      )}
    </>
  );
}