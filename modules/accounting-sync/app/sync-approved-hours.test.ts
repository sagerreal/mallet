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
  // Present so the fake satisfies the port; the hours path never touches customers.
  findCustomerByEmail: vi.fn(),
  findCustomerByName: vi.fn(),
  createCustomer: vi.fn(),
  createInvoice: vi.fn(),
  createPayment: vi.fn(),
  readInvoiceToken: vi.fn(),
  updateInvoice: vi.fn(),
  voidInvoice: vi.fn(),
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
  it("creates ONE TimeActivity per day, not per entry", async () => {
    // QuickBooks runs payroll and is paid for HOURS; what each hour was spent on is Mallet's
    // costing and stays here. Same model Jobber and Housecall Pro use.
    const h = harness();
    const res = await run(h, [
      entry({ id: "a", startTime: "08:00", endTime: "12:00" }),
      entry({ id: "b", startTime: "13:00", endTime: "16:00" }),
    ]);

    expect(res.ok).toBe(true);
    if (res.ok) expect(res.value.sent).toBe(1);
    expect(h.created).toHaveLength(1);
    expect(h.created[0]).toMatchObject({ hours: 7, minutes: 0 });
  });

  it("sends one activity per day when the batch spans days", async () => {
    const h = harness();
    const res = await run(h, [entry({ id: "a" }), entry({ id: "b", workDate: "2026-07-22" })]);
    if (res.ok) expect(res.value.sent).toBe(2);
    expect(h.created).toHaveLength(2);
  });

  it("records the success against the DAY, with the QuickBooks id", async () => {
    const h = harness();
    await run(h, [entry({ id: "a" })]);

    expect(h.recorded[0]).toMatchObject({
      malletId: `${TECH}:2026-07-21`,
      status: "succeeded",
      qboId: "qbo-1",
      errorCode: null,
    });
  });

  it("sends the day as non-billable and without a job name", async () => {
    // A day total spans whatever the man did, so a billable flag would be a claim about a customer
    // QuickBooks was never told the name of.
    const h = harness();
    await run(h, [entry({ note: "Water heater" })]);
    expect(h.created[0]).toMatchObject({ billable: false, description: "Hours worked" });
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
  it("skips a DAY already pushed successfully", async () => {
    const h = harness({ alreadySent: [`${TECH}:2026-07-21`] });
    const res = await run(h, [entry({ id: "a" })]);

    expect(h.api.createTimeActivity).not.toHaveBeenCalled();
    if (res.ok) expect(res.value).toMatchObject({ sent: 0, skipped: 1 });
  });

  it("a redelivered batch resends only the days not yet pushed", async () => {
    const h = harness({ alreadySent: [`${TECH}:2026-07-21`] });
    await run(h, [entry({ id: "a" }), entry({ id: "b", workDate: "2026-07-22" })]);

    expect(h.created).toHaveLength(1);
    expect(h.recorded.filter((r) => r.status === "succeeded")[0]?.malletId).toBe(`${TECH}:2026-07-22`);
  });

  it("a second entry on an ALREADY-SENT day cannot resend it", async () => {
    // The exact shape that pays somebody twice: the day is the unit, so another row landing on it
    // must not mint a second activity for hours already in QuickBooks.
    const h = harness({ alreadySent: [`${TECH}:2026-07-21`] });
    await run(h, [entry({ id: "a" }), entry({ id: "b", startTime: "16:00", endTime: "18:00" })]);
    expect(h.api.createTimeActivity).not.toHaveBeenCalled();
  });

  it("checks the whole batch in two queries — never one per day", async () => {
    // Two, not one: days already sent, plus entries the OLD per-entry code sent. Both are read up
    // front for the whole batch rather than per row.
    const h = harness();
    await run(h, [entry({ id: "a" }), entry({ id: "b" }), entry({ id: "c" })]);
    expect(h.syncLog.succeededIds).toHaveBeenCalledTimes(2);
  });

  it("records the success BEFORE moving on, so a crash costs at most one duplicate", async () => {
    const h = harness();
    await run(h, [entry({ id: "a" }), entry({ id: "b", workDate: "2026-07-22" })]);

    // record() must interleave with create(), not run as a batch at the end.
    expect(h.recorded.map((r) => r.malletId)).toEqual([`${TECH}:2026-07-21`, `${TECH}:2026-07-22`]);
  });
});

describe("one bad day does not sink the batch", () => {
  it("continues after a failed create", async () => {
    const h = harness({
      createResults: [err(externalService("quickbooks", "400", false)), ok({ id: "qbo-2" })],
    });
    const res = await run(h, [entry({ id: "a" }), entry({ id: "b", workDate: "2026-07-22" })]);

    if (res.ok) expect(res.value).toMatchObject({ sent: 1, failed: 1 });
  });

  it("records a failure with a code the UI can explain", async () => {
    const h = harness({ createResults: [err(externalService("quickbooks", "boom", true))] });
    await run(h, [entry({ id: "a" })]);

    expect(h.recorded[0]).toMatchObject({ malletId: `${TECH}:2026-07-21`, status: "failed", qboId: null });
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

  it("leaves a break out of the day total without calling it a problem", async () => {
    // Unpaid time is not hours worked. A day of nothing but break has no total to send, and that
    // is not a failure the shop is asked to fix.
    const h = harness();
    const res = await run(h, [entry({ id: "a", kind: "break" })]);

    expect(h.api.createTimeActivity).not.toHaveBeenCalled();
    if (res.ok) expect(res.value).toMatchObject({ sent: 0, failed: 0 });
  });

  it("still counts the worked part of a day that also has a break", async () => {
    const h = harness();
    await run(h, [
      entry({ id: "a", startTime: "08:00", endTime: "16:00" }),
      entry({ id: "b", kind: "break", startTime: "12:00", endTime: "12:30" }),
    ]);
    expect(h.created[0]).toMatchObject({ hours: 8, minutes: 0 });
  });

  it("REFUSES the whole day when a timer is still running", async () => {
    // A day short by one entry is a short paycheque that looks correct.
    const h = harness();
    const res = await run(h, [entry({ id: "a" }), entry({ id: "b", endTime: null })]);
    expect(h.api.createTimeActivity).not.toHaveBeenCalled();
    if (res.ok) expect(res.value.failed).toBe(1);
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
    expect(h.recorded[0]).toMatchObject({ malletId: `${TECH}:2026-07-21`, status: "failed" });
  });
});

/**
 * The first sync after the per-entry → per-day change.
 *
 * Weeks the old code already pushed are sitting in QuickBooks as one activity per entry. Sending
 * the day total on top of them is hours paid twice — the one failure this file exists to prevent.
 */
describe("days already pushed by the OLD per-entry code", () => {
  const legacyRun = run;
  const legacyHarness = (legacyIds: string[], dayKeys: string[] = []) => {
    const h = harness();
    (h.syncLog.succeededIds as ReturnType<typeof vi.fn>).mockImplementation(
      async (entityType: string, ids: string[]) =>
        new Set(ids.filter((id) => (entityType === "time_entry" ? legacyIds : dayKeys).includes(id))),
    );
    return h;
  };

  it("does NOT resend a day whose entries went across one at a time", async () => {
    const h = legacyHarness(["a"]);
    const res = await legacyRun(h, [entry({ id: "a" })]);
    expect(h.api.createTimeActivity).not.toHaveBeenCalled();
    if (res.ok) expect(res.value).toMatchObject({ sent: 0, skipped: 1 });
  });

  it("skips the day when only PART of it was pushed by the old code", async () => {
    // The remaining hours are already covered by the entry rows QuickBooks holds; sending the whole
    // day would count the pushed part a second time.
    const h = legacyHarness(["a"]);
    await legacyRun(h, [entry({ id: "a" }), entry({ id: "b", startTime: "16:00", endTime: "18:00" })]);
    expect(h.api.createTimeActivity).not.toHaveBeenCalled();
  });

  it("still sends a day the old code never touched", async () => {
    const h = legacyHarness(["a"]);
    await legacyRun(h, [entry({ id: "z", workDate: "2026-07-23" })]);
    expect(h.api.createTimeActivity).toHaveBeenCalledTimes(1);
  });
});
