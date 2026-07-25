import { describe, it, expect, vi } from "vitest";
import { ok, err, externalService, unauthorized } from "@mallet/shared/types";
import type { QboApiGateway, QboAccess } from "../domain/qbo-api-gateway";
import type {
  QboEntityLink,
  QboEntityLinkRepository,
  QboSyncLogEntry,
  QboSyncLogRepository,
} from "../domain/qbo-sync-repositories";
import type { SyncableTimeEntry } from "../domain/time-activity-mapping";
import { SyncApprovedHours } from "./sync-approved-hours";

const T0 = new Date("2026-07-24T12:00:00.000Z");
const ORG = "org-1";
const TECH = "user-1";
const ITEM = "42";
const ACCESS: QboAccess = { accessToken: "ACCESS-1", realmId: "913035" };

const entry = (over: Partial<SyncableTimeEntry> = {}): SyncableTimeEntry => ({
  id: "te-1",
  techUserId: TECH,
  workDate: "2026-07-21",
  kind: "job",
  startTime: "08:00",
  endTime: "16:00",
  note: "Water heater",
  ...over,
});

const EMPLOYEE_LINK: QboEntityLink = {
  entityType: "employee",
  malletId: TECH,
  qboId: "77",
  qboEntityKind: "Employee",
  displayName: "Mike Rivera",
};

const harness = (opts: {
  link?: QboEntityLink | null;
  alreadySent?: string[];
  createResults?: Array<Awaited<ReturnType<QboApiGateway["createTimeActivity"]>>>;
} = {}) => {
  const recorded: QboSyncLogEntry[] = [];
  const created: unknown[] = [];
  const queue = [...(opts.createResults ?? [])];

  const api: QboApiGateway = {
    listPeople: vi.fn(),
    listServiceItems: vi.fn(),
    preflight: vi.fn(),
    countTimeActivitySince: vi.fn(),
    createTimeActivity: vi.fn(async (_a, input) => {
      created.push(input);
      return queue.shift() ?? ok({ id: `qbo-${created.length}` });
    }),
  };

  const links: QboEntityLinkRepository = {
    listByType: vi.fn(),
    find: vi.fn().mockResolvedValue(opts.link === undefined ? EMPLOYEE_LINK : opts.link),
    save: vi.fn(),
    remove: vi.fn(),
  };

  const syncLog: QboSyncLogRepository = {
    succeededIds: vi.fn().mockResolvedValue(new Set(opts.alreadySent ?? [])),
    record: vi.fn(async (e: QboSyncLogEntry) => void recorded.push(e)),
    recent: vi.fn(),
  };

  return {
    api,
    links,
    syncLog,
    recorded,
    created,
    useCase: new SyncApprovedHours(api, links, syncLog, { now: () => T0 }),
  };
};

const run = (
  h: ReturnType<typeof harness>,
  entries: SyncableTimeEntry[],
  itemId: string | null = ITEM,
) =>
  h.useCase.exec({ techUserId: TECH, entries, defaultItemQboId: itemId }, ACCESS, ORG);

describe("the happy path", () => {
  it("creates one TimeActivity per entry", async () => {
    const h = harness();
    const res = await run(h, [entry({ id: "a" }), entry({ id: "b" })]);

    expect(res.ok).toBe(true);
    if (res.ok) expect(res.value.sent).toBe(2);
    expect(h.created).toHaveLength(2);
  });

  it("records each success with the QuickBooks id", async () => {
    const h = harness();
    await run(h, [entry({ id: "a" })]);

    expect(h.recorded[0]).toMatchObject({
      malletId: "a",
      status: "succeeded",
      qboId: "qbo-1",
      errorCode: null,
    });
  });

  it("routes a 1099 sub as a Vendor", async () => {
    const h = harness({ link: { ...EMPLOYEE_LINK, qboEntityKind: "Vendor", qboId: "88" } });
    await run(h, [entry()]);
    expect(h.created[0]).toMatchObject({ personKind: "Vendor", personId: "88" });
  });

  it("does nothing at all for an empty batch", async () => {
    const h = harness();
    const res = await run(h, []);
    expect(res.ok).toBe(true);
    expect(h.api.createTimeActivity).not.toHaveBeenCalled();
  });
});

// The bug that would pay somebody twice.
describe("idempotency — the outbox redelivers by design", () => {
  it("skips an entry already pushed successfully", async () => {
    const h = harness({ alreadySent: ["a"] });
    const res = await run(h, [entry({ id: "a" })]);

    expect(h.api.createTimeActivity).not.toHaveBeenCalled();
    if (res.ok) expect(res.value).toMatchObject({ sent: 0, skipped: 1 });
  });

  it("sends only the entries not yet pushed when a batch is redelivered", async () => {
    const h = harness({ alreadySent: ["a"] });
    await run(h, [entry({ id: "a" }), entry({ id: "b" })]);

    expect(h.created).toHaveLength(1);
    expect(h.recorded.filter((r) => r.status === "succeeded")[0]?.malletId).toBe("b");
  });

  it("checks the whole batch in one query rather than per entry", async () => {
    const h = harness();
    await run(h, [entry({ id: "a" }), entry({ id: "b" }), entry({ id: "c" })]);
    expect(h.syncLog.succeededIds).toHaveBeenCalledTimes(1);
  });

  it("records the success BEFORE moving on, so a crash costs at most one duplicate", async () => {
    const h = harness();
    await run(h, [entry({ id: "a" }), entry({ id: "b" })]);

    // record() must interleave with create(), not run as a batch at the end.
    expect(h.recorded.map((r) => r.malletId)).toEqual(["a", "b"]);
  });
});

describe("one bad entry does not sink the batch", () => {
  it("continues after a failed create", async () => {
    const h = harness({
      createResults: [err(externalService("quickbooks", "400", false)), ok({ id: "qbo-2" })],
    });
    const res = await run(h, [entry({ id: "a" }), entry({ id: "b" })]);

    if (res.ok) expect(res.value).toMatchObject({ sent: 1, failed: 1 });
  });

  it("records a failure with a code the UI can explain", async () => {
    const h = harness({ createResults: [err(externalService("quickbooks", "boom", true))] });
    await run(h, [entry({ id: "a" })]);

    expect(h.recorded[0]).toMatchObject({ malletId: "a", status: "failed", qboId: null });
    expect(h.recorded[0]?.errorCode).toBeTruthy();
  });

  it("marks an unmapped tech as failed — never silently drops their hours", async () => {
    const h = harness({ link: null });
    const res = await run(h, [entry({ id: "a" })]);

    expect(h.api.createTimeActivity).not.toHaveBeenCalled();
    expect(h.recorded[0]).toMatchObject({ status: "failed", errorCode: "unmapped_employee" });
    if (res.ok) expect(res.value.failed).toBe(1);
  });

  it("marks a missing service item as failed, not skipped", async () => {
    const h = harness();
    await run(h, [entry({ id: "a" })], null);
    expect(h.recorded[0]).toMatchObject({ status: "failed", errorCode: "no_default_item" });
  });

  it("treats a break as an expected exclusion, not a failure the shop must fix", async () => {
    const h = harness();
    const res = await run(h, [entry({ id: "a", kind: "break" })]);

    expect(h.recorded[0]).toMatchObject({ status: "skipped", errorCode: "break_not_synced" });
    if (res.ok) expect(res.value).toMatchObject({ skipped: 1, failed: 0 });
  });

  it("skips a still-running timer rather than inventing an end time", async () => {
    const h = harness();
    await run(h, [entry({ id: "a", endTime: null })]);
    expect(h.api.createTimeActivity).not.toHaveBeenCalled();
    expect(h.recorded[0]?.errorCode).toBe("entry_not_finished");
  });
});

describe("a dead token aborts rather than burning the batch", () => {
  it("stops on the first unauthorized and returns the error", async () => {
    const h = harness({
      createResults: [err(unauthorized("token expired")), ok({ id: "qbo-2" })],
    });
    const res = await run(h, [entry({ id: "a" }), entry({ id: "b" })]);

    expect(res.ok).toBe(false);
    // Only the first entry was attempted — the rest would fail identically.
    expect(h.created).toHaveLength(1);
  });

  it("still records the failed attempt before aborting", async () => {
    const h = harness({ createResults: [err(unauthorized("token expired"))] });
    await run(h, [entry({ id: "a" })]);
    expect(h.recorded[0]).toMatchObject({ malletId: "a", status: "failed" });
  });
});
