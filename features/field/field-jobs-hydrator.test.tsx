// @vitest-environment jsdom
/**
 * features/field/field-jobs-hydrator.test.tsx
 *
 * Guards the clobber fix: myDay is the CALLER's personal subset. Only techs may
 * hydrate store.jobs from it — an owner/office user visiting a field page would
 * otherwise have the office hydrator's full jobs list replaced by their own
 * assigned-jobs subset (shared shell components then operate on partial data).
 *
 * Also guards the idle prefetch: once myDay resolves the hydrator schedules
 * prefetch calls for the sibling tabs (timesheets.list + messaging.listConversations)
 * with the exact input objects and staleTime values those pages use.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, act } from "@testing-library/react";
import { FieldJobsHydrator } from "./field-jobs-hydrator";

const setJobs = vi.fn();
const setLeads = vi.fn();
vi.mock("@/lib/store/app-store", () => ({
  useAppStore: (sel: (s: { setJobs: typeof setJobs; setLeads: typeof setLeads }) => unknown) =>
    sel({ setJobs, setLeads }),
}));

const timesheetsPrefetch = vi.fn().mockResolvedValue(undefined);
const conversationsPrefetch = vi.fn().mockResolvedValue(undefined);
const mockUtils = {
  v1: {
    timesheets: { list: { prefetch: timesheetsPrefetch } },
    messaging: { listConversations: { prefetch: conversationsPrefetch } },
  },
};

const myDayQuery = vi.fn();
vi.mock("@/lib/trpc/client", () => ({
  api: {
    v1: {
      field: { myDay: { useQuery: () => myDayQuery() } },
    },
    useUtils: () => mockUtils,
  },
}));

const meQuery = vi.fn();
vi.mock("@/features/identity/hooks", () => ({
  useMe: () => meQuery(),
}));

const jobItem = {
  id: "11111111-1111-1111-1111-111111111111",
  num: "JOB-1",
  leadId: "22222222-2222-2222-2222-222222222222",
  sourceEstimateId: null,
  title: "Fix water heater",
  svc: null,
  status: "scheduled",
  assigneeUserId: null,
  scheduledStart: null,
  total: { cents: 0, currency: "USD" },
  notes: null,
  checklist: null,
  visits: [],
  createdAt: "2026-07-12T00:00:00.000Z",
  lines: [],
  addons: [],
  verifyAnswers: [],
  photos: [],
};

// myDay carries the customers behind those jobs — the field surface has no other source for a
// customer's name or number, and without them its Call control cannot work.
const customerItem = {
  id: "22222222-2222-2222-2222-222222222222",
  name: "Dana Alvarez",
  phone: "+19415550134",
};

describe("FieldJobsHydrator", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    myDayQuery.mockReturnValue({ data: { items: [jobItem], customers: [customerItem] }, isError: false, error: null });
  });

  it("hydrates store.jobs for a tech", () => {
    meQuery.mockReturnValue({ data: { role: "tech" }, isLoading: false });
    render(<FieldJobsHydrator />);
    expect(setJobs).toHaveBeenCalledTimes(1);
    expect(setJobs.mock.calls[0]![0]).toHaveLength(1);
  });

  it("hydrates the customers behind those jobs, so a tech can name and ring them", () => {
    meQuery.mockReturnValue({ data: { role: "tech" }, isLoading: false });
    render(<FieldJobsHydrator />);
    expect(setLeads).toHaveBeenCalledTimes(1);
    expect(setLeads.mock.calls[0]![0]).toEqual([
      expect.objectContaining({ id: customerItem.id, name: "Dana Alvarez", phone: "+19415550134" }),
    ]);
  });

  it("does NOT clobber store.leads for an owner (the office list is the full one)", () => {
    meQuery.mockReturnValue({ data: { role: "owner" }, isLoading: false });
    render(<FieldJobsHydrator />);
    expect(setLeads).not.toHaveBeenCalled();
  });

  it("keeps a customer with no number on file — the call sheet prompts for one", () => {
    meQuery.mockReturnValue({ data: { role: "tech" }, isLoading: false });
    myDayQuery.mockReturnValue({
      data: { items: [jobItem], customers: [{ ...customerItem, phone: null }] },
      isError: false,
      error: null,
    });
    render(<FieldJobsHydrator />);
    expect(setLeads.mock.calls[0]![0][0].phone).toBe("");
  });

  it("does NOT clobber store.jobs for an owner (office hydrator owns their list)", () => {
    meQuery.mockReturnValue({ data: { role: "owner" }, isLoading: false });
    render(<FieldJobsHydrator />);
    expect(setJobs).not.toHaveBeenCalled();
  });

  it("does NOT hydrate before the role is known (fail closed)", () => {
    meQuery.mockReturnValue({ data: undefined, isLoading: true });
    render(<FieldJobsHydrator />);
    expect(setJobs).not.toHaveBeenCalled();
  });
});

describe("FieldJobsHydrator — idle prefetch", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    meQuery.mockReturnValue({ data: { role: "tech" }, isLoading: false });
    myDayQuery.mockReturnValue({ data: { items: [jobItem], customers: [customerItem] }, isError: false, error: null });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("prefetches timesheets.list with the exact my-hours input (todayISO=2026-07-01)", async () => {
    render(<FieldJobsHydrator />);
    // Advance the setTimeout fallback path (requestIdleCallback not available in jsdom)
    await act(async () => {
      vi.runAllTimers();
    });
    expect(timesheetsPrefetch).toHaveBeenCalledTimes(1);
    expect(timesheetsPrefetch).toHaveBeenCalledWith(
      { fromDate: "2026-04-08", toDate: "2026-07-08", limit: 500 },
      { staleTime: 60_000 },
    );
  });

  it("prefetches messaging.listConversations with undefined input + 15s staleTime", async () => {
    render(<FieldJobsHydrator />);
    await act(async () => {
      vi.runAllTimers();
    });
    expect(conversationsPrefetch).toHaveBeenCalledTimes(1);
    expect(conversationsPrefetch).toHaveBeenCalledWith(undefined, { staleTime: 15_000 });
  });

  it("does NOT prefetch when myDay data is not yet settled", async () => {
    myDayQuery.mockReturnValue({ data: undefined, isError: false, error: null });
    render(<FieldJobsHydrator />);
    await act(async () => {
      vi.runAllTimers();
    });
    expect(timesheetsPrefetch).not.toHaveBeenCalled();
    expect(conversationsPrefetch).not.toHaveBeenCalled();
  });

  it("runs the prefetch only once even if data reference changes on re-render", async () => {
    const { rerender } = render(<FieldJobsHydrator />);
    await act(async () => {
      vi.runAllTimers();
    });
    // Simulate data reference changing (e.g. a refetch)
    myDayQuery.mockReturnValue({ data: { items: [], customers: [] }, isError: false, error: null });
    rerender(<FieldJobsHydrator />);
    await act(async () => {
      vi.runAllTimers();
    });
    // Still only one call — the ref guard prevents re-scheduling
    expect(timesheetsPrefetch).toHaveBeenCalledTimes(1);
  });
});
