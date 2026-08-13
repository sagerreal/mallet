import { describe, it, expect } from "vitest";
import { serverPageToRows, SORT_COL_TO_SERVER } from "./server-rows";
import type { JobListRow } from "./server-rows";

const dto = (over: Partial<JobListRow> = {}): JobListRow =>
  ({
    id: "j1",
    num: "JOB-1",
    leadId: "l1",
    customerName: "Dave Chen",
    sourceEstimateId: null,
    title: "Water heater",
    svc: "service",
    kind: "work",
    status: "scheduled",
    assigneeUserId: null,
    scheduledStart: null,
    total: { cents: 50000, currency: "USD" },
    notes: null,
    scope: null,
    callbackOf: null,
    callbackReason: null,
    checklist: null,
    requiredCerts: null,
    visits: [],
    createdAt: "2026-08-01T00:00:00.000Z",
    lines: [],
    addons: [],
    verifyAnswers: [],
    photos: [],
    ...over,
  }) as unknown as JobListRow;

/**
 * A placed visit, which is what the store mapper derives a job's status FROM: a job with no placed
 * visit reads "unscheduled" no matter what the backend column says, and one whose placed visits are
 * all complete reads "done". The band derivation keys on that store status, so a fixture that only
 * sets `status` is testing nothing.
 */
const visit = (over: Record<string, unknown> = {}) => ({
  id: "v1",
  assigneeUserId: "t1",
  scheduledDate: "2026-08-05",
  scheduledStart: "09:00",
  scheduledEnd: "11:00",
  durationMinutes: 120,
  status: "pending",
  enrouteAt: null,
  startedAt: null,
  completedAt: null,
  notes: null,
  position: 0,
  ...over,
});

describe("serverPageToRows", () => {
  it("tags every row with the selected view's band key", () => {
    // The grouping happens in SQL, so every row on screen belongs to the selected view. That key
    // is not an approximation — it is the truth, and it is the same for every row.
    const r = serverPageToRows([dto({ id: "a" }), dto({ id: "b" })], "today");
    expect(r.rows).toHaveLength(2);
    expect(r.rows.map((x) => x.bandKey)).toEqual(["today", "today"]);
  });

  it("maps each server view to the band key the row helpers understand", () => {
    const key = (v: Parameters<typeof serverPageToRows>[1]) => serverPageToRows([dto()], v).rows[0]!.bandKey;
    expect(key("needsSlot")).toBe("needsSlot");
    expect(key("week")).toBe("thisWeek");
    expect(key("upcoming")).toBe("later");
    expect(key("needsInvoice")).toBe("doneUnbilled");
    expect(key("done")).toBe("done");
    expect(key("archived")).toBe("archived");
    expect(key("late")).toBe("late");
  });

  /**
   * The All view's per-row band is the ONLY place a row's band is not simply the selected chip, so
   * it is the only place `late` can be got wrong visibly — it renders as a rust date instead of a
   * plain one. These mirror viewCondition's rule clause for clause. (Mocked today: 2026-07-01.)
   */
  describe("late, in a mixed list", () => {
    it("derives late for an open job whose placed visit is dated before today", () => {
      const r = serverPageToRows(
        [dto({ id: "a", status: "scheduled", visits: [visit({ scheduledDate: "2026-06-28" })] } as never)],
        null,
      );
      expect(r.rows[0]!.bandKey).toBe("late");
    });

    it("prefers today over late when the job has both", () => {
      // Same ranking as the server: a day view that omits work going out today is not a day view.
      const r = serverPageToRows(
        [dto({
          id: "a",
          status: "scheduled",
          visits: [
            visit({ id: "v1", scheduledDate: "2026-06-28" }),
            visit({ id: "v2", scheduledDate: "2026-07-01", position: 1 }),
          ],
        } as never)],
        null,
      );
      expect(r.rows[0]!.bandKey).toBe("today");
    });

    it("stops calling a past visit late once it is finished", () => {
      const r = serverPageToRows(
        [dto({
          id: "a",
          status: "scheduled",
          visits: [visit({ scheduledDate: "2026-06-28", status: "complete" })],
        } as never)],
        null,
      );
      expect(r.rows[0]!.bandKey).not.toBe("late");
    });

    it("leaves a past-dated visit with no crew out of late — it needs a slot", () => {
      const r = serverPageToRows(
        [dto({
          id: "a",
          status: "scheduled",
          visits: [visit({ scheduledDate: "2026-06-28", assigneeUserId: null })],
        } as never)],
        null,
      );
      expect(r.rows[0]!.bandKey).toBe("needsSlot");
    });
  });

  it("returns no rows for an empty page", () => {
    expect(serverPageToRows([], "today").rows).toEqual([]);
    expect(serverPageToRows([], null).rows).toEqual([]);
  });

  it("keeps the SERVER's order in a mixed list, whatever the rows' bands are", () => {
    // THE BUG THIS EXISTS TO CATCH. The page used to be bucketed by lifecycle band and the buckets
    // concatenated, so the first row's band absorbed every same-band row further down and floated
    // them up. A page of [done, scheduled, done, scheduled] rendered as [done, done, scheduled,
    // scheduled] — which is how the Jobs list came to open on a wall of last week's finished work
    // while the sort said otherwise.
    const done = { status: "complete", visits: [visit({ status: "complete" })] };
    const booked = { status: "scheduled", visits: [visit()] };
    const rows = [
      dto({ id: "a", ...done } as never),
      dto({ id: "b", ...booked } as never),
      dto({ id: "c", ...done } as never),
      dto({ id: "d", status: "scheduled", visits: [] } as never),
      dto({ id: "e", ...booked } as never),
    ];
    const r = serverPageToRows(rows, null);
    expect(r.rows.map((x) => x.job.id)).toEqual(["a", "b", "c", "d", "e"]);
    expect(r.jobs.map((j) => j.id)).toEqual(["a", "b", "c", "d", "e"]);
    // The bands really are interleaved — this is the arrangement the old grouping destroyed.
    expect(r.rows.map((x) => x.bandKey)).toEqual(["done", "later", "done", "needsSlot", "later"]);
  });

  it("still derives a per-row band key in a mixed list, so labels stay right", () => {
    // Order is flat, but each row must keep its OWN band or every row renders the first row's
    // status pill and "when" text.
    const r = serverPageToRows(
      [
        dto({ id: "a", status: "complete", visits: [visit({ status: "complete" })] } as never),
        dto({ id: "b", status: "scheduled", visits: [] } as never),
        dto({ id: "c", status: "scheduled", visits: [visit()] } as never),
      ],
      null,
    );
    expect(r.rows.map((x) => x.bandKey)).toEqual(["done", "needsSlot", "later"]);
  });

  it("a selected view overrides the per-row derivation", () => {
    const r = serverPageToRows(
      [
        dto({ id: "a", status: "complete", visits: [visit({ status: "complete" })] } as never),
        dto({ id: "b", status: "scheduled", visits: [visit()] } as never),
      ],
      "needsSlot",
    );
    expect(r.rows.map((x) => x.bandKey)).toEqual(["needsSlot", "needsSlot"]);
  });

  /**
   * The list's whole reason for reading server-side. `dtoJobToStoreJob` is written for the FULL
   * jobDTO, which carries neither of these fields, so it drops them — correctly, for its own
   * callers. This adapter is the one place the SUMMARY shape exists, and the summary is the only
   * shape the server resolves them onto. Losing them here sends the list back to joining against
   * the store's `leads` collection, which is paged, so every customer past that page prints "—".
   */
  describe("the server-resolved customer fields", () => {
    it("carries the customer's name onto the row", () => {
      const r = serverPageToRows([dto({ customerName: "Ed Okafor" })], "today");
      expect(r.rows[0]!.job.cust).toBe("Ed Okafor");
    });

    it("carries the customer's service address onto the row", () => {
      const r = serverPageToRows([dto({ customerAddr: "1850 Geary Rd, Concord, CA" })], "today");
      expect(r.rows[0]!.job.custAddr).toBe("1850 Geary Rd, Concord, CA");
    });

    it("leaves both undefined — never '' — when the server resolved neither", () => {
      // custName reads `lead?.name ?? j.cust ?? "—"`. An empty string is a VALUE to `??`, so
      // mapping absence to "" would print a blank cell where "—" belongs, and jobAddr would stop
      // falling through to the job's own address.
      const r = serverPageToRows([dto({ customerName: null, customerAddr: null })], "today");
      expect(r.rows[0]!.job.cust).toBeUndefined();
      expect(r.rows[0]!.job.custAddr).toBeUndefined();
    });
  });
});

describe("SORT_COL_TO_SERVER", () => {
  it("maps 'when' to the SCHEDULED sort, not created", () => {
    // The column shows when the work happens. Sorting it by row-creation date would be a
    // different question wearing the same label.
    expect(SORT_COL_TO_SERVER.when).toBe("scheduled");
  });

  it("leaves customer unsorted rather than mapping it to the wrong column", () => {
    // Sorting jobs by customer name needs a joined ORDER BY the cursor would have to carry too.
    // Until that exists, an inert header is better than rows in an order the header does not
    // claim.
    expect(SORT_COL_TO_SERVER.customer).toBeNull();
  });
});
