const SHAPE_TOOLS = [
  ["polygon", "Polygon"],
  ["rectangle", "Rectangle"],
  ["circle", "Circle"],
  ["line", "Line"],
  ["freehand", "Freehand"],
];
const PRESENT_TOOLS = [
  ["laser", "Laser pointer"],
  ["brush", "Temporary brush"],
  ["pan", "Pan only"],
];
export const BRUSH_COLORS = ["#ffd60a", "#ff453a", "#32d7ff", "#ffffff"];

function ToolButton({ id, label, tool, onToolChange }) {
  return (
    <button
      type="button"
      className={tool === id ? "active" : ""}
      aria-pressed={tool === id}
      onClick={() => onToolChange(id)}
    >
      {label}
    </button>
  );
}

/**
 * `sketch`   = { counts, finish, undo, clearAll } from useSketchTool
 * `history`  = { canUndo, canRedo } from useHistory (wires the two global buttons)
 * `onUndo`   = global undo handler from MapDraw
 * `onRedo`   = global redo handler from MapDraw
 */
export default function DrawToolbar({
  tool, onToolChange,
  sketch,
  brushColor, onBrushColorChange, onClearInk,
  onUndo, onRedo, canUndo, canRedo,
}) {
  const isLine = tool === "line";
  const isFree = tool === "freehand";
  const canFinish = isFree ? sketch.counts.points >= 3 : sketch.counts.points >= 2;
  const hasAnything = sketch.counts.points > 0 || sketch.counts.lines > 0;

  return (
    <div className="draw-toolbar" role="toolbar" aria-label="Drawing tools">

      {/* Global undo / redo — always visible */}
      <div className="draw-toolbar-group draw-toolbar-history">
        <button
          type="button"
          className="history-btn"
          disabled={!canUndo}
          onClick={onUndo}
          title="Undo (Ctrl+Z)"
          aria-label="Undo"
        >
          ↩ Undo
        </button>
        <button
          type="button"
          className="history-btn"
          disabled={!canRedo}
          onClick={onRedo}
          title="Redo (Ctrl+Shift+Z)"
          aria-label="Redo"
        >
          ↪ Redo
        </button>
      </div>

      <div className="draw-toolbar-group">
        <span className="draw-toolbar-label">Select area</span>
        {SHAPE_TOOLS.map(([id, label]) => (
          <ToolButton key={id} id={id} label={label} tool={tool} onToolChange={onToolChange} />
        ))}
      </div>

      {(isLine || isFree) && (
        <div className="draw-toolbar-option">
          <span className="draw-toolbar-count">
            {isLine
              ? `Lines: ${sketch.counts.lines} · Points: ${sketch.counts.points}`
              : `Points: ${sketch.counts.points}`}
          </span>
          <button type="button" disabled={!canFinish} onClick={sketch.finish}>
            {isLine ? "Finish line" : "Finish shape"}
          </button>
          <button type="button" disabled={!hasAnything} onClick={sketch.undo}>Undo point</button>
          <button type="button" disabled={!hasAnything} onClick={sketch.clearAll}>Clear sketch</button>
        </div>
      )}

      <div className="draw-toolbar-group">
        <span className="draw-toolbar-label">Present</span>
        {PRESENT_TOOLS.map(([id, label]) => (
          <ToolButton key={id} id={id} label={label} tool={tool} onToolChange={onToolChange} />
        ))}
      </div>

      {tool === "brush" && (
        <div className="draw-toolbar-option">
          <div className="draw-toolbar-swatches">
            {BRUSH_COLORS.map((c) => (
              <button
                key={c}
                type="button"
                className={brushColor === c ? "active" : ""}
                style={{ background: c }}
                aria-label={`Brush color ${c}`}
                aria-pressed={brushColor === c}
                onClick={() => onBrushColorChange(c)}
              />
            ))}
          </div>
          <button type="button" onClick={onClearInk}>Clear ink</button>
        </div>
      )}
    </div>
  );
}