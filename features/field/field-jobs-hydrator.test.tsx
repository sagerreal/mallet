// @vitest-environment jsdom
/**
 * features/field/field-jobs-hydrator.test.tsx
 *
 * Guards the clobber fix: myDay is the CALLER's personal subset. Only techs may
 * hydrate store.jobs from it — an owner/office user visiting a field page would
 * otherwise have the office hydrator's full jobs list replaced by their own
 * assigned-jobs subset (shared shell components then operate on partial data).
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render } from "@testing-library/react";
import { FieldJobsHydrator } from "./field-jobs-hydrator";

const setJobs = vi.fn();
vi.mock("@/lib/store/app-store", () => ({
  useAppStore: (sel: (s: { setJobs: typeof setJobs }) => unknown) => sel({ setJobs }),
}));

const myDayQuery = vi.fn();
vi.mock("@/lib/trpc/client", () => ({
  api: {
    v1: {
      field: { myDay: { useQuery: () => myDayQuery() } },
    },
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

describe("FieldJobsHydrator", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    myDayQuery.mockReturnValue({ data: { items: [jobItem] }, isError: false, error: null });
  });

  it("hydrates store.jobs for a tech", () => {
    meQuery.mockReturnValue({ data: { role: "tech" }, isLoading: false });
    render(<FieldJobsHydrator />);
    expect(setJobs).toHaveBeenCalledTimes(1);
    expect(setJobs.mock.calls[0]![0]).toHaveLength(1);
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
