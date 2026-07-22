// @vitest-environment jsdom
/**
 * components/modals/visit-modal.test.tsx
 *
 * Guards the visit-after-job race fix in createJobForLead:
 *  - addVisit must NOT be called until `persisted` resolves (job has origin "db").
 *  - On addJob failure, an error is surfaced and the modal stays open.
 *
 * Mirrors the new-job-modal.test.tsx createJob patterns.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { VisitModalContent } from "./visit-modal";

// Store actions captured so the test can assert ordering (addJob → await → addVisit).
const addEvisit = vi.fn();
const addJob = vi.fn();
const addVisit = vi.fn();
const updateLead = vi.fn();

// Mutable close/openModal so each test gets a fresh spy.
let closeMock = vi.fn();
let openModalMock = vi.fn();

const LEAD_ID = "lead-abc";
const LEAD = {
  id: LEAD_ID,
  name: "Alice Tester",
  job: "fix boiler",
  address: "1 Main St",
  phone: "5550001234",
  archived: false,
};

vi.mock("@/lib/store/app-store", () => ({
  useActiveModal: () => ({ params: { leadId: LEAD_ID } }),
  useCloseModal: () => closeMock,
  useOpenModal: () => openModalMock,
  usePushModal: () => openModalMock,
  useAppStore: (selector: (s: Record<string, unknown>) => unknown) =>
    selector({
      leads: [LEAD],
      addEvisit,
      addJob,
      addVisit,
      updateLead,
    }),
}));

vi.mock("@/lib/store/modal-ids", () => ({
  MODAL: {
    LEAD: "lead",
    JOB: "job",
    PRICE_BUILDER: "price-builder",
  },
}));

describe("VisitModalContent — createJobForLead race fix", () => {
  beforeEach(() => {
    addEvisit.mockReset();
    addJob.mockReset();
    addVisit.mockReset();
    updateLead.mockReset();
    closeMock = vi.fn();
    openModalMock = vi.fn();
  });

  it("calls addVisit AFTER persisted resolves (visit persists when origin is db)", async () => {
    let resolveJobPersisted!: (j: unknown) => void;
    const jobPersistedPromise = new Promise((res) => {
      resolveJobPersisted = res;
    });
    const optimisticJob = { id: "job-opt-1", origin: "manual", visits: [] };
    addJob.mockReturnValue({ job: optimisticJob, persisted: jobPersistedPromise });

    render(<VisitModalContent />);
    // Default purpose is "job" (guessPurpose("fix boiler") → "job").
    fireEvent.click(screen.getByText("Create the job →"));

    await waitFor(() => expect(addJob).toHaveBeenCalledOnce());

    // addVisit must NOT have been called yet — still waiting on jobPersisted.
    expect(addVisit).not.toHaveBeenCalled();

    // Resolve the job persisted promise to simulate the server reconcile.
    resolveJobPersisted({ id: "job-opt-1", origin: "db", visits: [] });

    // Now addVisit should be called with the job id.
    await waitFor(() => {
      expect(addVisit).toHaveBeenCalledWith("job-opt-1");
    });

    // Modal closes and navigates to the job after persistence.
    await waitFor(() => {
      expect(closeMock).toHaveBeenCalledOnce();
    });
    expect(openModalMock).toHaveBeenCalledWith("job", { jobId: "job-opt-1" });
  });

  it("surfaces an error and keeps the modal open when addJob persisted rejects", async () => {
    const optimisticJob = { id: "job-fail-1", origin: "manual", visits: [] };
    addJob.mockReturnValue({
      job: optimisticJob,
      persisted: Promise.reject(new Error("network error")),
    });

    render(<VisitModalContent />);
    fireEvent.click(screen.getByText("Create the job →"));

    await waitFor(() => {
      expect(screen.getByText(/couldn't save the job/i)).toBeTruthy();
    });

    // Modal must NOT close on failure.
    expect(closeMock).not.toHaveBeenCalled();

    // addVisit must NOT be called when the job failed.
    expect(addVisit).not.toHaveBeenCalled();
  });
});
