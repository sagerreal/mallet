/**
 * lib/measure/trace-state.ts
 * Pure state transitions for an in-progress aerial trace. The tracer UI holds
 * one TraceState and applies these functions — never mutates. Kept free of
 * Google Maps types so the vertex rules are unit-testable.
 */

export interface TraceVertex {
  readonly lat: number;
  readonly lng: number;
}

export interface TraceState {
  readonly vertices: readonly TraceVertex[];
  readonly closed: boolean;
}

export const EMPTY_TRACE: TraceState = { vertices: [], closed: false };

/** A polygon needs at least this many vertices before it can close. */
export const MIN_TRACE_VERTICES = 3;

/** Drop a vertex at the tapped point. Ignored once the outline is closed. */
export function addVertex(state: TraceState, vertex: TraceVertex): TraceState {
  if (state.closed) return state;
  return { vertices: [...state.vertices, vertex], closed: false };
}

/**
 * Undo the last step: a closed outline re-opens (vertices kept — undoing the
 * close, not a point); an open outline drops its last vertex.
 */
export function undoLast(state: TraceState): TraceState {
  if (state.closed) return { vertices: state.vertices, closed: false };
  if (state.vertices.length === 0) return state;
  return { vertices: state.vertices.slice(0, -1), closed: false };
}

export function clearTrace(): TraceState {
  return EMPTY_TRACE;
}

export function canClose(state: TraceState): boolean {
  return !state.closed && state.vertices.length >= MIN_TRACE_VERTICES;
}

/** Close the outline (tap the first vertex, or Done). No-op unless closable. */
export function closeTrace(state: TraceState): TraceState {
  if (!canClose(state)) return state;
  return { vertices: state.vertices, closed: true };
}
