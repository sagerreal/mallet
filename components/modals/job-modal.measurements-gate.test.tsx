// @vitest-environment jsdom
/**
 * components/modals/job-modal.measurements-gate.test.tsx
 *
 * Guards the org-level measurement gate: the job modal's Measurements SheetRow
 * must not render AT ALL when the org has measurementEstimating off (the
 * plumbing default) — not render collapsed, not render empty. It must render
 * when the toggle is on (measurement-priced trades, e.g. painting).
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
      setJobSvc: noop,
      addVisit: noop,
      updateVisit: noop,
      removeVisit: noop,
      deleteJob: noop,
      roomsByJob: {},
      toggles: { measurementEstimating: mockMeasurementEstimating },
    }),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn() }),
}));

vi.mock("./dur-field", () => ({ DurField: () => null }));
vi.mock("./job-checklist-block", () => ({ JobChecklistBlock: () => null }));
vi.mock("./job-measure-block", () => ({ JobMeasureBlock: () => <div data-testid="job-measure-block" /> }));

beforeEach(() => {
  mockJobs = [makeJob()];
});

describe("JobModalContent — Measurements section org gate", () => {
  it("does not render the Measurements row when measurementEstimating is off (plumbing default)", () => {
    mockMeasurementEstimating = false;
    render(<JobModalContent />);
    expect(screen.queryByText("Measurements")).toBeNull();
    expect(screen.queryByTestId("job-measure-block")).toBeNull();
  });

  it("renders the Measurements row when measurementEstimating is on (measurement-priced trade)", () => {
    mockMeasurementEstimating = true;
    render(<JobModalContent />);
    expect(screen.getByText("Measurements")).toBeTruthy();
  });
});
