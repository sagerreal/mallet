// @vitest-environment jsdom
/**
 * components/modals/job-modal.measurements-gate.test.tsx
 *
 * Guards the job modal against measurement rows coming back: measuring is an
 * estimating feature, so rooms AND satellite traces live on the quote page's
 * Measure section (app/(office)/composer/measured-surfaces-panel.tsx). The
 * modal must render NO Measurements row regardless of the org's
 * measurementEstimating toggle — the founder removed it deliberately.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { JobModalContent } from "./job-modal";
import type { Job, Lead } from "@/lib/store/types";

let mockMeasurementEstimating = false;

const noop = vi.fn();

function makeJob(overrides: Partial<Job> = {}): Job {
  return {
    id: "job-1",
    leadId: "lead-1",
    svc: "service",
    origin: "db",
    title: "Fix boiler",
    addr: "12 Oak St",
    phone: "",
    status: "unscheduled",
    archived: false,
    lines: [],
    addons: [],
    photos: [],
    notes: "",
    acts: [],
    visits: [],
    ...overrides,
  };
}

const lead: Lead = {
  id: "lead-1",
  name: "Dana Alvarez",
  phone: "555-0101",
  stage: "Won",
} as unknown as Lead;

let mockJobs: Job[] = [makeJob()];

vi.mock("@/lib/store/app-store", () => ({
  useActiveModal: () => ({ id: "job", params: { jobId: "job-1" } }),
  useCloseModal: () => noop,
  useOpenModal: () => noop,
  usePushModal: () => noop,
  useAppStore: (selector: (s: Record<string, unknown>) => unknown) =>
    selector({
      jobs: mockJobs,
      leads: [lead],
      techs: [],
      invoices: [],
      updateJob: noop,
      addVisit: noop,
      updateVisit: noop,
      removeVisit: noop,
      deleteJob: noop,
      roomsByJob: {},
      sitesByJob: {},
      toggles: { measurementEstimating: mockMeasurementEstimating },
    }),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn() }),
}));

// Bill-to-invoice affordance added in the sheet-clipping fix (#264) — not under test here,
// so stub the tRPC surface it reads (api.useUtils / api.v1.invoicing.createFromJob.useMutation).
vi.mock("@/lib/trpc/client", () => ({
  api: {
    useUtils: () => ({ v1: { invoicing: { list: { invalidate: vi.fn() } } } }),
    v1: {
      invoicing: {
        createFromJob: {
          useMutation: () => ({ mutate: vi.fn(), isPending: false }),
        },
      },
      // fetch-on-miss for jobs the store never hydrated; disabled in these tests (job present)
      jobs: { get: { useQuery: () => ({ data: undefined, isError: false }) } },
      // The customer's note trail behind the Customer notes row — idle here.
      customers: { listNotes: { useQuery: () => ({ data: undefined }) } },
    },
  },
}));

vi.mock("./dur-field", () => ({ DurField: () => null }));
vi.mock("./job-checklist-block", () => ({ JobChecklistBlock: () => null }));

beforeEach(() => {
  mockJobs = [makeJob()];
});

describe("JobModalContent — no measurement rows (measurements live on the quote page)", () => {
  it("renders no Measurements row when measurementEstimating is off", () => {
    mockMeasurementEstimating = false;
    render(<JobModalContent />);
    expect(screen.queryByText("Measurements")).toBeNull();
  });

  it("renders no Measurements row even when measurementEstimating is on", () => {
    mockMeasurementEstimating = true;
    render(<JobModalContent />);
    expect(screen.queryByText("Measurements")).toBeNull();
    expect(screen.queryByText("Site measurements")).toBeNull();
  });
});
