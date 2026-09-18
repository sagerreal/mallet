import { describe, it, expect } from "vitest";
import {
  EMPTY_TRACE,
  MIN_TRACE_VERTICES,
  addVertex,
  undoLast,
  clearTrace,
  canClose,
  closeTrace,
  type TraceState,
} from "./trace-state";

const v = (n: number) => ({ lat: n, lng: n });

const openWith = (count: number): TraceState => {
  let s = EMPTY_TRACE;
  for (let i = 0; i < count; i++) s = addVertex(s, v(i));
  return s;
};

describe("addVertex", () => {
  it("appends immutably", () => {
    const s1 = addVertex(EMPTY_TRACE, v(1));
    expect(s1.vertices).toEqual([v(1)]);
    expect(EMPTY_TRACE.vertices).toEqual([]);
  });

  it("is ignored once the outline is closed", () => {
    const closed = closeTrace(openWith(3));
    expect(addVertex(closed, v(9))).toBe(closed);
  });
});

describe("undoLast", () => {
  it("drops the last vertex on an open outline", () => {
    const s = undoLast(openWith(3));
    expect(s.vertices).toEqual([v(0), v(1)]);
  });

  it("re-opens a closed outline without dropping a vertex", () => {
    const closed = closeTrace(openWith(3));
    const s = undoLast(closed);
    expect(s.closed).toBe(false);
    expect(s.vertices).toHaveLength(3);
  });

  it("is a no-op on an empty trace", () => {
    expect(undoLast(EMPTY_TRACE)).toBe(EMPTY_TRACE);
  });
});

describe("close rules", () => {
  it(`needs at least ${MIN_TRACE_VERTICES} vertices`, () => {
    expect(canClose(openWith(2))).toBe(false);
    expect(canClose(openWith(3))).toBe(true);
  });

  it("closeTrace closes only when closable", () => {
    const two = openWith(2);
    expect(closeTrace(two)).toBe(two);
    expect(closeTrace(openWith(3)).closed).toBe(true);
  });

  it("an already-closed outline cannot close again", () => {
    const closed = closeTrace(openWith(3));
    expect(canClose(closed)).toBe(false);
  });
});

describe("clearTrace", () => {
  it("resets to the empty trace", () => {
    expect(clearTrace()).toEqual(EMPTY_TRACE);
  });
});
