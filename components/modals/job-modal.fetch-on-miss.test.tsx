// @vitest-environment jsdom
/**
 * components/modals/job-modal.fetch-on-miss.test.tsx
 *
 * The Jobs list is served by the database a page at a time, so it lists jobs the
 * store never hydrated. Opening one of those used to `return null` under an open
 * sheet shell — a completely blank modal (Owen hit this the day the server list
 * shipped). Guards the fetch-on-miss contract: a store-missing job renders an
 * honest loading state (never nothing), fetches by id, adopts the result, and a
 * server NOT_FOUND renders the named fallback.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { JobModalContent } from "./job-modal";
import type { Job } from "@/lib/store/types";

const noop = vi.fn();
const adoptJob = vi.fn();
let mockJobs: Job[] = [];
let queryState: { data: unknown; isError: boolean } = { data: undefined, isError: false };
let lastQueryOpts: { enabled?: boolean } | undefined;

vi.mock("@/lib/store/app-store", () => ({
  useActiveModal: () => ({ id: "job", params: { jobId: "job-far-page" } }),
  useCloseModal: () => noop,
  useOpenModal: () => noop,
  usePushModal: () => noop,
  useAppStore: (selector: (s: Record<string, unknown>) => unknown) =>
    selector({
      jobs: mockJobs,
      leads: [],
      techs: [],
      invoices: [],
      updateJob: noop,
      addVisit: noop,
      updateVisit: noop,
      removeVisit: noop,
      deleteJob: noop,
      adoptJob,
      roomsByJob: {},
      sitesByJob: {},
      toggles: { measurementEstimating: false },
    }),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn() }),
}));

vi.mock("@/lib/trpc/client", () => ({
  api: {
    useUtils: () => ({ v1: { invoicing: { list: { invalidate: vi.fn() } } } }),
    v1: {
      invoicing: {
        createFromJob: { useMutation: () => ({ mutate: vi.fn(), isPending: false }) },
      },
      jobs: {
        get: {
          useQuery: (_input: unknown, opts?: { enabled?: boolean }) => {
            lastQueryOpts = opts;
            return queryState;
          },
        },
      },
      // The sheet header's record trail — settled/empty here.
      links: { forRecord: { useQuery: () => ({ data: undefined }) } },
      // The customer's note trail behind the Customer notes row — idle here.
      customers: { listNotes: { useQuery: () => ({ data: undefined }) } },
    },
  },
}));

describe("JobModalContent — fetch-on-miss for store-absent jobs", () => {
  beforeEach(() => {
    adoptJob.mockClear();
    mockJobs = [];
    queryState = { data: undefined, isError: false };
    lastQueryOpts = undefined;
  });

  it("renders an honest loading state — never an empty sheet — and enables the by-id fetch", () => {
    const { container } = render(<JobModalContent />);
    expect(container.firstChild).not.toBeNull();
    expect(screen.getByText("Loading…")).toBeTruthy();
    expect(lastQueryOpts?.enabled).toBe(true);
  });

  it("adopts the fetched job into the store when the query lands", () => {
    queryState = { data: { id: "job-far-page", title: "Hydro-jetting" }, isError: false };
    render(<JobModalContent />);
    expect(adoptJob).toHaveBeenCalledWith({ id: "job-far-page", title: "Hydro-jetting" });
  });

  it("names the failure when the job genuinely does not exist", () => {
    queryState = { data: undefined, isError: true };
    render(<JobModalContent />);
    expect(screen.getByText("Job not found")).toBeTruthy();
  });
});

describe("JobModalContent — the phone is not in the meta line", () => {
  beforeEach(() => {
    adoptJob.mockClear();
    queryState = { data: undefined, isError: false };
    mockJobs = [
      {
        id: "job-far-page", leadId: "lead-aaa", title: "Drain clearing — kitchen", svc: "service",
        origin: "db", addr: "", phone: "+19255550181", status: "complete", archived: false,
        lines: [], addons: [], photos: [], notes: "", acts: [], visits: [],
      },
    ];
  });

  it("keeps the number out of the header, where it sat beside the record trail", () => {
    // It rendered E.164 straight after "no invoice" — unformatted, and pushed against a row of
    // record links it has nothing to do with. The customer sheet already settled this: a number
    // gets ONE home, and a header slot that only appears when the number exists is not it.
    const { container } = render(<JobModalContent />);

    const head = container.querySelector(".sheet-head");
    expect(head?.textContent).not.toContain("9255550181");
  });

  it("keeps its one home — the Customer phone row — and formats it there", () => {
    render(<JobModalContent />);

    // Formatted, like every other surface. The row read the stored E.164 straight out.
    expect(screen.getByText("(925) 555-0181")).toBeTruthy();
  });

  it("still offers Call and Text, which is what the number was there for", () => {
    render(<JobModalContent />);

    expect(screen.getByRole("button", { name: "Call" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Text" })).toBeTruthy();
  });
});
