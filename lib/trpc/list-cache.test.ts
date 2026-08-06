import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { QueryClient } from "@tanstack/react-query";
import { registerListCache, resetListCache, invalidateLists, withListBatch } from "./list-cache";

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

  /**
   * "Create & price it" is a CHAIN — create the customer, await it, create the job that needs its
   * id, then the job's visits. Each link reconciled and refetched every list, so one press ran the
   * whole refetch three times, and the customer one went out a millisecond before v1.jobs.create,
   * the request the user was blocked on (measured: 3275 ms alongside it, 2485 ms without).
   */
  describe("withListBatch — one refetch per flow, not one per write", () => {
    it("holds the refetch while the flow is still running", async () => {
      let duringFlow = -1;
      await withListBatch(async () => {
        invalidateLists("customers");
        // The write that comes NEXT in the chain must not be racing a refetch.
        duringFlow = spy.mock.calls.length;
      });
      expect(duringFlow).toBe(0);
    });

    it("refetches once the flow finishes — a deferred list is not a dropped one", async () => {
      await withListBatch(async () => {
        invalidateLists("customers");
      });
      const keys = keysInvalidated().join(" ");
      expect(keys).toContain("customers");
      expect(keys).toContain("count");
    });

    it("collapses the chain's repeated invalidations into a single refetch per domain", async () => {
      await withListBatch(async () => {
        // addLead's reconcile, then addJob's, then the visit create's — the real create chain.
        invalidateLists("customers");
        invalidateLists("jobs", "invoices");
        invalidateLists("jobs", "invoices");
      });
      // customers (4) + jobs (5) + invoices (2) = 11 keys, each asked for exactly once —
      // not the 22 the unbatched chain fired.
      expect(spy).toHaveBeenCalledTimes(11);
    });

    it("still covers every key the domain owns, so the header count cannot go stale", async () => {
      await withListBatch(async () => {
        invalidateLists("jobs");
      });
      const keys = keysInvalidated().join(" ");
      for (const key of ["list", "count", "viewCounts", "myDay", "myJobs"]) {
        expect(keys).toContain(key);
      }
    });

    it("only the outermost batch flushes — a nested flow must not refetch mid-chain", async () => {
      let afterInner = -1;
      await withListBatch(async () => {
        invalidateLists("jobs");
        await withListBatch(async () => {
          invalidateLists("customers");
        });
        afterInner = spy.mock.calls.length;
      });
      expect(afterInner).toBe(0);
      expect(keysInvalidated().join(" ")).toContain("customers");
      expect(keysInvalidated().join(" ")).toContain("jobs");
    });

    // A create that saved the customer and then lost the job would otherwise leave that customer
    // in the database and off every list on screen — the data-loss report this module prevents.
    it("refetches even when the flow throws, and re-raises", async () => {
      await expect(
        withListBatch(async () => {
          invalidateLists("customers");
          throw new Error("job create failed");
        }),
      ).rejects.toThrow("job create failed");
      expect(keysInvalidated().join(" ")).toContain("customers");
    });

    it("returns the flow's value", async () => {
      await expect(withListBatch(async () => "created")).resolves.toBe("created");
    });

    it("leaves unbatched callers refetching immediately, as before", () => {
      invalidateLists("estimates");
      expect(spy).toHaveBeenCalledTimes(1);
    });

    // A batch abandoned by a crashing suite must not swallow the next suite's invalidations, and
    // must not leave the depth counter negative — a negative counter never reaches zero again, so
    // every later batch would close without flushing and the lists would quietly stop refreshing.
    it("survives resetListCache called inside an open batch", async () => {
      await withListBatch(async () => {
        invalidateLists("jobs");
        resetListCache();
        registerListCache(qc);
      });

      spy.mockClear();
      invalidateLists("estimates");
      expect(spy).toHaveBeenCalledTimes(1);

      // The next batch must still BATCH. A negative counter reads as "no batch open", so every
      // later flow would go straight back to refetching mid-chain — the defect, silently restored.
      spy.mockClear();
      let duringNextFlow = -1;
      await withListBatch(async () => {
        invalidateLists("estimates");
        duringNextFlow = spy.mock.calls.length;
      });
      expect(duringNextFlow).toBe(0);
      expect(spy).toHaveBeenCalledTimes(1);
    });
  });
});
