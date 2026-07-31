import { describe, it, expect, vi } from "vitest";
import { GetQboSyncActivity } from "./get-qbo-sync-activity";
import type { QboSyncLogEntry, QboSyncLogRepository } from "../domain/qbo-sync-repositories";
import type { SyncLabelReader } from "../domain/sync-label-reader";
import { UNMAPPED_EMPLOYEE, BREAK_NOT_PAID } from "../domain/time-activity-mapping";

const entry = (over: Partial<QboSyncLogEntry> = {}): QboSyncLogEntry => ({
  entityType: "time_entry",
  malletId: "te-1",
  qboId: "1073741824",
  status: "succeeded",
  errorCode: null,
  errorMessage: null,
  attemptedAt: new Date("2026-07-25T20:00:00Z"),
  ...over,
});

const build = (entries: readonly QboSyncLogEntry[], labels: Record<string, string> = {}) => {
  const recent = vi.fn(async () => entries);
  const labelsFor = vi.fn(async () => new Map(Object.entries(labels)));
  const syncLog = { recent } as unknown as QboSyncLogRepository;
  const reader = { labelsFor } as SyncLabelReader;
  return { use: new GetQboSyncActivity(syncLog, reader), recent, labelsFor };
};

describe("GetQboSyncActivity", () => {
  it("is empty when nothing has ever been attempted, and asks for no labels", async () => {
    const { use, labelsFor } = build([]);
    expect(await use.exec()).toEqual({ rows: [], retryableCount: 0 });
    expect(labelsFor).not.toHaveBeenCalled();
  });

  it("names the record instead of showing its id", async () => {
    const { use } = build([entry()], { "te-1": "Owen Duggan · Jul 25" });
    const { rows } = await use.exec();
    expect(rows[0]!.label).toBe("Owen Duggan · Jul 25");
    expect(rows[0]!.problem).toBeNull();
  });

  /**
   * A record deleted since the attempt must keep its row. Dropping it would remove a failure from
   * the screen because its subject is gone — which is exactly how hours go missing unnoticed.
   */
  it("keeps a row whose record no longer exists", async () => {
    const { use } = build([entry({ status: "failed", errorCode: UNMAPPED_EMPLOYEE })], {});
    const { rows } = await use.exec();
    expect(rows).toHaveLength(1);
    expect(rows[0]!.label).toBe("(no longer in Elas)");
  });

  it("explains a failure and counts it as retryable", async () => {
    const { use } = build([entry({ status: "failed", errorCode: UNMAPPED_EMPLOYEE })]);
    const { rows, retryableCount } = await use.exec();
    expect(rows[0]!.problem?.says).toMatch(/isn't matched/i);
    expect(retryableCount).toBe(1);
  });

  it("does not count a skipped break as something to retry", async () => {
    const { use } = build([entry({ status: "skipped", errorCode: BREAK_NOT_PAID })]);
    const { rows, retryableCount } = await use.exec();
    expect(rows[0]!.problem).not.toBeNull();
    expect(retryableCount).toBe(0);
  });

  it("carries QuickBooks' own words through as detail", async () => {
    const { use } = build([
      entry({ status: "failed", errorCode: "validation", errorMessage: "Invalid Reference Id" }),
    ]);
    expect((await use.exec()).rows[0]!.detail).toBe("Invalid Reference Id");
  });

  it("looks labels up once per entity type, not once per row", async () => {
    const { use, labelsFor } = build([
      entry({ malletId: "te-1" }),
      entry({ malletId: "te-2" }),
      entry({ entityType: "invoice", malletId: "inv-1" }),
    ]);
    await use.exec();
    expect(labelsFor).toHaveBeenCalledTimes(2);
    expect(labelsFor).toHaveBeenCalledWith("time_entry", ["te-1", "te-2"]);
    expect(labelsFor).toHaveBeenCalledWith("invoice", ["inv-1"]);
  });

  // The limit reaches this from a router whose input is client-supplied.
  it("bounds the limit rather than trusting the caller", async () => {
    const { use, recent } = build([]);
    await use.exec(5_000);
    expect(recent).toHaveBeenCalledWith(100);
    await use.exec(0);
    expect(recent).toHaveBeenLastCalledWith(25);
    await use.exec(-3);
    expect(recent).toHaveBeenLastCalledWith(1);
  });
});
