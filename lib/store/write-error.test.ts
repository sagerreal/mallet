import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { reportWriteError, reportWriteNotice, subscribeWriteErrors, resetWriteErrorListeners } from "./write-error";

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

  // A deliberate no-op is not a failure. It must still be said out loud — silently recording
  // nothing is what makes someone believe the clock is broken — but it must not be dressed as an
  // error, or the shop goes looking for a bug that is not there.
  describe("reportWriteNotice", () => {
    it("announces with the caller's own sentence and a notice tone", () => {
      const seen: { message: string; tone: string }[] = [];
      subscribeWriteErrors((e) => seen.push({ message: e.message, tone: e.tone }));

      reportWriteNotice("clock", "That was under a minute, so it wasn't recorded.");

      expect(seen).toEqual([
        { message: "That was under a minute, so it wasn't recorded.", tone: "notice" },
      ]);
    });

    it("does not log to the console — nothing went wrong", () => {
      const spy = vi.spyOn(console, "error").mockImplementation(() => {});
      subscribeWriteErrors(() => {});
      reportWriteNotice("clock", "nothing to see");
      expect(spy).not.toHaveBeenCalled();
    });

    it("keeps failures tagged as errors, so the two can never be styled the same", () => {
      const seen: string[] = [];
      subscribeWriteErrors((e) => seen.push(e.tone));
      vi.spyOn(console, "error").mockImplementation(() => {});

      reportWriteError("archiveLead", new Error("network"));
      reportWriteNotice("clock", "under a minute");

      expect(seen).toEqual(["error", "notice"]);
    });
  });
});
