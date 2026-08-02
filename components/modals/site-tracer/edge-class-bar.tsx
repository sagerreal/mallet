/**
 * components/modals/site-tracer/edge-class-bar.tsx
 * The EDGES step's anchored control bar (pitched surfaces, closed outline):
 * a legend that doubles as the running readout — each class shows its swatch
 * color and, once any edge carries it, its total ("Eaves 160 ft") — plus the
 * interior-line controls (Add a line / Undo line). Presentational and
 * controlled: the tracer owns the EdgeEditState; map taps do the classifying.
 * No floating UI — this is a flush bar under the map, like the trace bar.
 */

"use client";

import {
  EDGE_CLASSES,
  EDGE_CLASS_LABELS,
  EDGE_COLORS,
  edgeTotalFor,
  formatEdgeFt,
  type EdgeTotalsFt,
} from "@/lib/measure/edge-classes";

interface EdgeClassBarProps {
  totals: EdgeTotalsFt;
  /** True while "Add a line" is armed (map taps place the line's points). */
  addingLine: boolean;
  /** True once the armed line's first point is placed. */
  hasDraftPoint: boolean;
  canUndoLine: boolean;
  onToggleAddLine: () => void;
  onUndoLine: () => void;
}

function lineHint(addingLine: boolean, hasDraftPoint: boolean): string {
  if (!addingLine) {
    return "Tap an edge to change what it is — Eave → Rake → Ridge → Hip → Valley. Tap a drawn line to change its class.";
  }
  return hasDraftPoint
    ? "Tap the map where the line ends."
    : "Tap the map where the line starts — a ridge or valley that crosses the roof.";
}

export function EdgeClassBar({
  totals,
  addingLine,
  hasDraftPoint,
  canUndoLine,
  onToggleAddLine,
  onUndoLine,
}: EdgeClassBarProps) {
  return (
    <>
      <div className="tracer-bar" role="group" aria-label="Roof edges">
        {EDGE_CLASSES.map((cls) => {
          const ft = edgeTotalFor(totals, cls);
          return (
            <span key={cls} className="tracer-edge-key">
              <i className="swatch" style={{ background: EDGE_COLORS[cls] }} aria-hidden="true" />
              {EDGE_CLASS_LABELS[cls]}
              {ft > 0 && <span className="fig">{formatEdgeFt(ft)}</span>}
            </span>
          );
        })}
        <span className="gap" />
        <button type="button" className="btn sm" onClick={onToggleAddLine}>
          {addingLine ? "Cancel line" : "Add a line"}
        </button>
        <button type="button" className="btn sm" disabled={!canUndoLine} onClick={onUndoLine}>
          Undo line
        </button>
      </div>
      <p className="tracer-note">{lineHint(addingLine, hasDraftPoint)}</p>
    </>
  );
}
