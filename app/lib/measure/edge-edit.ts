/**
 * lib/measure/edge-edit.ts
 * Pure state transitions for the tracer's EDGES step (pitched surfaces only):
 * tap a perimeter edge to cycle its class, and draw optional interior lines
 * (a hip roof's ridge) point-to-point with undo. The tracer UI holds one
 * EdgeEditState and applies these — never mutates. Map-free and unit-tested,
 * the same contract as trace-state.ts.
 */

import {
  cycleEdgeClass,
  cycleInteriorLineClass,
  defaultEdgeClasses,
  type EdgeClass,
  type EdgeLatLng,
  type InteriorLineShape,
} from "@/lib/measure/edge-classes";

export interface EdgeEditState {
  /** Class per perimeter edge — edge i = vertex i → i+1 (wrapping). */
  readonly edgeClasses: readonly EdgeClass[];
  readonly interiorLines: readonly InteriorLineShape[];
  /** True while "Add a line" is armed — the next map taps place the line. */
  readonly addingLine: boolean;
  /** The armed line's first point, once placed. */
  readonly draftPoint: EdgeLatLng | null;
}

/** Fresh edges step for a closed outline: every edge an EAVE, no lines. */
export function initialEdgeEdit(vertexCount: number): EdgeEditState {
  return {
    edgeClasses: defaultEdgeClasses(vertexCount),
    interiorLines: [],
    addingLine: false,
    draftPoint: null,
  };
}

/** Tap edge i: cycle its class. Out-of-range taps change nothing. */
export function cycleEdgeAt(state: EdgeEditState, index: number): EdgeEditState {
  const current = state.edgeClasses[index];
  if (current === undefined) return state;
  return {
    ...state,
    edgeClasses: state.edgeClasses.map((cls, i) => (i === index ? cycleEdgeClass(current) : cls)),
  };
}

/** Tap interior line i: cycle RIDGE → HIP → VALLEY. */
export function cycleInteriorLineAt(state: EdgeEditState, index: number): EdgeEditState {
  const line = state.interiorLines[index];
  if (line === undefined) return state;
  return {
    ...state,
    interiorLines: state.interiorLines.map((l, i) =>
      i === index ? { ...l, cls: cycleInteriorLineClass(line.cls) } : l,
    ),
  };
}

/** Arm "Add a line", or cancel it (dropping a half-placed point). */
export function toggleAddLine(state: EdgeEditState): EdgeEditState {
  return { ...state, addingLine: !state.addingLine, draftPoint: null };
}

/**
 * A map tap while the line is armed: the first tap places the start, the
 * second completes the line (born a RIDGE — the most common interior line,
 * one tap to change) and disarms.
 */
export function placeLinePoint(state: EdgeEditState, point: EdgeLatLng): EdgeEditState {
  if (!state.addingLine) return state;
  if (state.draftPoint === null) return { ...state, draftPoint: point };
  return {
    ...state,
    interiorLines: [...state.interiorLines, { a: state.draftPoint, b: point, cls: "ridge" }],
    addingLine: false,
    draftPoint: null,
  };
}

export function canUndoLine(state: EdgeEditState): boolean {
  return state.draftPoint !== null || state.interiorLines.length > 0;
}

/** Undo the last line step: a half-placed point first, else the last line. */
export function undoLine(state: EdgeEditState): EdgeEditState {
  if (state.draftPoint !== null) return { ...state, draftPoint: null };
  if (state.interiorLines.length === 0) return state;
  return { ...state, interiorLines: state.interiorLines.slice(0, -1) };
}
