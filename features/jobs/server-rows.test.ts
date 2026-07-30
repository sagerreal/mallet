import { describe, it, expect } from "vitest";
import { serverRowsToBands, SORT_COL_TO_SERVER } from "./server-rows";
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

describe("serverRowsToBands", () => {
  it("puts a whole page in ONE band when a view is active", () => {
    // The grouping now happens in SQL, so every row on screen belongs to the selected view. One
    // band with that key is the truth, not an approximation.
    const r = serverRowsToBands([dto({ id: "a" }), dto({ id: "b" })], "today");
    expect(r.bands).toHaveLength(1);
    expect(r.bands[0]!.key).toBe("today");
    expect(r.bands[0]!.jobs).toHaveLength(2);
  });

  it("maps each server view to the band key the row helpers understand", () => {
    const key = (v: Parameters<typeof serverRowsToBands>[1]) => serverRowsToBands([dto()], v).bands[0]!.key;
    expect(key("needsSlot")).toBe("needsSlot");
    expect(key("week")).toBe("thisWeek");
    expect(key("upcoming")).toBe("later");
    expect(key("needsInvoice")).toBe("doneUnbilled");
    expect(key("done")).toBe("done");
  });

  it("returns NO bands for an empty page, not an empty band", () => {
    // An empty band renders a header with nothing under it, which reads as a failed load rather
    // than "no matches".
    expect(serverRowsToBands([], "today").bands).toEqual([]);
    expect(serverRowsToBands([], null).bands).toEqual([]);
  });

  it("preserves the SERVER's row order in a mixed list", () => {
    // The server owns the sort now. Grouping for display must not reorder rows within a group.
    const rows = [dto({ id: "a", num: "JOB-A" }), dto({ id: "b", num: "JOB-B" }), dto({ id: "c", num: "JOB-C" })];
    const r = serverRowsToBands(rows, null);
    expect(r.jobs.map((j) => j.id)).toEqual(["a", "b", "c"]);
  });

  it("sums each band's money from its LINE ITEMS, which is where the amount lives", () => {
    // jobTotal() sums lines, not the job's total_cents column. The list resolver has to batch-load
    // execution data or every row reads $0 — which is exactly what the Jobs screen was showing
    // while the jobs carried real prices.
    const line = (r: number) => ({ id: "x", description: "Repair", quantity: 1, rate: { cents: r, currency: "USD" }, cost: { cents: 0, currency: "USD" }, position: 0 });
    const r = serverRowsToBands(
      [
        dto({ id: "a", lines: [line(50000)] } as never),
        dto({ id: "b", lines: [line(25000)] } as never),
      ],
      "today",
    );
    expect(r.bands[0]!.sum).toBe(750);
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
