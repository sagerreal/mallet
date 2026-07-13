/**
 * modules/quoting/api/job-creation-savepoint.test.ts
 * Review batch 2 — Fix 4 (MEDIUM): a savepoint failure AFTER the use-case
 * assigned a job summary must not leak the phantom job into the accept
 * response — the insert rolled back with the savepoint, so the helper must
 * return null whenever tx.transaction rejects.
 */

import { describe, it, expect, vi } from "vitest";
import { runInSavepoint, type SavepointRunner } from "./savepoint";

/** Fake savepoint tx: runs the callback, then optionally throws (RELEASE failure). */
function fakeTx(opts: { runCallback: boolean; throwAfter?: Error; throwBefore?: Error }): SavepointRunner {
  return {
    transaction: (async (fn: (sp: never) => Promise<unknown>) => {
      if (opts.throwBefore) throw opts.throwBefore;
      if (opts.runCallback) await fn({} as never);
      if (opts.throwAfter) throw opts.throwAfter;
    }) as SavepointRunner["transaction"],
  };
}

describe("runInSavepoint", () => {
  it("returns the summary when the savepoint commits", async () => {
    const onError = vi.fn();
    const summary = await runInSavepoint(
      fakeTx({ runCallback: true }),
      async () => ({ id: "job-1" }),
      onError,
    );
    expect(summary).toEqual({ id: "job-1" });
    expect(onError).not.toHaveBeenCalled();
  });

  it("returns null when the use-case produced no job (result error)", async () => {
    const onError = vi.fn();
    const summary = await runInSavepoint(
      fakeTx({ runCallback: true }),
      async () => null,
      onError,
    );
    expect(summary).toBeNull();
    expect(onError).not.toHaveBeenCalled();
  });

  it("returns null when the savepoint fails before the callback runs", async () => {
    const onError = vi.fn();
    const boom = new Error("could not open savepoint");
    const summary = await runInSavepoint(
      fakeTx({ runCallback: false, throwBefore: boom }),
      async () => ({ id: "job-never" }),
      onError,
    );
    expect(summary).toBeNull();
    expect(onError).toHaveBeenCalledWith(boom);
  });

  it("returns null when the savepoint fails AFTER the summary was assigned (rolled-back insert must not leak)", async () => {
    const onError = vi.fn();
    const releaseFailure = new Error("connection dropped during RELEASE");
    const summary = await runInSavepoint(
      fakeTx({ runCallback: true, throwAfter: releaseFailure }),
      async () => ({ id: "job-phantom" }),
      onError,
    );
    // The job row rolled back with the savepoint — a non-null return would
    // make the client adopt a job that has no DB row.
    expect(summary).toBeNull();
    expect(onError).toHaveBeenCalledWith(releaseFailure);
  });
});
