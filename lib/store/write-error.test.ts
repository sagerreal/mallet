import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { reportWriteError, subscribeWriteErrors, resetWriteErrorListeners } from "./write-error";

describe("write-error reporting seam", () => {
  beforeEach(() => resetWriteErrorListeners());
  afterEach(() => vi.restoreAllMocks());

  it("announces a rolled-back write to subscribers with a plain-language message", () => {
    const seen: string[] = [];
    subscribeWriteErrors((e) => seen.push(e.message));
    vi.spyOn(console, "error").mockImplementation(() => {});

    reportWriteError("archiveLead", new Error("network"));

    expect(seen).toHaveLength(1);
    // Names the action in the user's words, says the change was undone, says what to do.
    expect(seen[0]).toBe(
      "Couldn't archive lead — your change was undone. Check your connection and try again.",
    );
  });

  it("gives each failure a rising seq so a repeat failure re-announces", () => {
    const seqs: number[] = [];
    subscribeWriteErrors((e) => seqs.push(e.seq));
    vi.spyOn(console, "error").mockImplementation(() => {});

    reportWriteError("updateJob", new Error("a"));
    reportWriteError("updateJob", new Error("b"));

    expect(seqs).toHaveLength(2);
    expect(seqs[1]!).toBeGreaterThan(seqs[0]!);
  });

  it("unsubscribes cleanly", () => {
    const seen: string[] = [];
    const off = subscribeWriteErrors((e) => seen.push(e.action));
    vi.spyOn(console, "error").mockImplementation(() => {});

    reportWriteError("first", new Error("x"));
    off();
    reportWriteError("second", new Error("x"));

    expect(seen).toEqual(["first"]);
  });
});
