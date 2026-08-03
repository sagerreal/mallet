import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { QueryClient } from "@tanstack/react-query";
import { registerListCache, resetListCache, invalidateLists } from "./list-cache";

/**
 * The bridge between store mutations and the server-paginated lists.
 *
 * Without it a save reached the database and the list on screen did not move until the window was
 * refocused — the row was saved, the screen said otherwise.
 */
describe("invalidateLists", () => {
  let qc: QueryClient;
  let spy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    qc = new QueryClient();
    spy = vi.spyOn(qc, "invalidateQueries").mockResolvedValue(undefined);
    registerListCache(qc);
  });

  afterEach(() => {
    resetListCache();
    vi.restoreAllMocks();
  });

  /** Every key this call asked React Query to invalidate, flattened for readability. */
  const keysInvalidated = (): string[] =>
    spy.mock.calls.map((c: unknown[]) => JSON.stringify((c[0] as { queryKey: unknown }).queryKey));

  it("invalidates the list AND its count — a stale total says 51 of 606", () => {
    invalidateLists("customers");
    const keys = keysInvalidated().join(" ");
    expect(keys).toContain("list");
    expect(keys).toContain("count");
  });

  it("refreshes the filter facets too, so a new source appears in the dropdown", () => {
    invalidateLists("customers");
    expect(keysInvalidated().join(" ")).toContain("facets");
  });

  it("covers the Pipeline column counts, which are a different query from the list", () => {
    invalidateLists("customers");
    expect(keysInvalidated().join(" ")).toContain("viewCounts");
  });

  // Money's top half is "finished work nobody has billed" — a JOBS query. A job write that
  // refreshed only the jobs lists would leave the ledger stale in the exact case it exists for.
  it("a job write refreshes the invoice lists as well", () => {
    invalidateLists("jobs", "invoices");
    const keys = keysInvalidated().join(" ");
    expect(keys).toContain("jobs");
    expect(keys).toContain("invoicing");
  });

  // A reassignment is a jobs write, but the tech reads v1.field.myDay (and the time editor
  // v1.field.myJobs). Before these keys joined the jobs domain, a dispatched visit never reached
  // the phone until a manual reload.
  it("a job write reaches the field surface: myDay and myJobs are in the jobs domain", () => {
    invalidateLists("jobs");
    const keys = keysInvalidated().join(" ");
    expect(keys).toContain("myDay");
    expect(keys).toContain("myJobs");
  });

  it("does nothing, and does not throw, before the provider has registered a client", () => {
    resetListCache();
    expect(() => invalidateLists("jobs")).not.toThrow();
    expect(spy).not.toHaveBeenCalled();
  });

  // A refetch that fails must not turn a save that SUCCEEDED into an error the user sees. The
  // next focus refetch picks it up.
  it("swallows a failing refetch rather than rejecting into the mutation's catch", async () => {
    spy.mockRejectedValue(new Error("offline"));
    expect(() => invalidateLists("jobs")).not.toThrow();
    await Promise.resolve();
  });

  it("invalidates each named domain exactly once per call", () => {
    invalidateLists("timesheets");
    // list + count for timesheets, and nothing from another domain.
    expect(spy).toHaveBeenCalledTimes(2);
    expect(keysInvalidated().join(" ")).not.toContain("customers");
  });
});
