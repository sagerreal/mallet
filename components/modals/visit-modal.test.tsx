// @vitest-environment jsdom
/**
 * components/modals/visit-modal.test.tsx
 *
 * Guards the visit-after-job race fix in createJobForLead, and the one-job-type
 * foot: no Job/Estimate chips — the kind derives from which exit ran.
 *
 * Mirrors the new-job-modal.test.tsx patterns.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { VisitModalContent } from "./visit-modal";

// Store actions captured so the test can assert ordering (addJob → await → addVisit).
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
    fireEvent.click(screen.getByRole("button", { name: "Create & price it →" }));

    await waitFor(() => expect(addJob).toHaveBeenCalledOnce());
    // The priced exit derives booked work.
    expect(addJob).toHaveBeenCalledWith(expect.objectContaining({ kind: "work" }));

    // addVisit must NOT have been called yet — still waiting on jobPersisted.
    expect(addVisit).not.toHaveBeenCalled();

    // Resolve the job persisted promise to simulate the server reconcile.
    resolveJobPersisted({ id: "job-opt-1", origin: "db", visits: [] });

    // Now addVisit should be called with the job id.
    await waitFor(() => {
      expect(addVisit).toHaveBeenCalledWith("job-opt-1");
    });

    // Modal closes and lands the price builder ON the new job's sheet.
    await waitFor(() => {
      expect(closeMock).toHaveBeenCalledOnce();
    });
    expect(openModalMock).toHaveBeenCalledWith("job", { jobId: "job-opt-1" });
    expect(openModalMock).toHaveBeenCalledWith("price-builder", { jobId: "job-opt-1" });
  });

  it("Create job derives the unpriced kind and pops back to the lead — no builder", async () => {
    addJob.mockReturnValue({
      job: { id: "job-est-1", origin: "manual", visits: [] },
      persisted: Promise.resolve({ id: "job-est-1", origin: "db", visits: [] }),
    });

    render(<VisitModalContent />);
    fireEvent.click(screen.getByRole("button", { name: "Create job" }));

    await waitFor(() => expect(closeMock).toHaveBeenCalledOnce());
    expect(addJob).toHaveBeenCalledWith(expect.objectContaining({ kind: "estimate" }));
    expect(openModalMock).not.toHaveBeenCalled();
  });

  it("surfaces an error and keeps the modal open when addJob persisted rejects", async () => {
    const optimisticJob = { id: "job-fail-1", origin: "manual", visits: [] };
    addJob.mockReturnValue({
      job: optimisticJob,
      persisted: Promise.reject(new Error("network error")),
    });

    render(<VisitModalContent />);
    fireEvent.click(screen.getByRole("button", { name: "Create & price it →" }));

    await waitFor(() => {
      expect(screen.getByText(/couldn't save the job/i)).toBeTruthy();
    });

    // Modal must NOT close on failure.
    expect(closeMock).not.toHaveBeenCalled();

    // addVisit must NOT be called when the job failed.
    expect(addVisit).not.toHaveBeenCalled();
  });

  it("one press, one job — a second press while in flight is ignored", async () => {
    let release!: (j: unknown) => void;
    addJob.mockReturnValue({
      job: { id: "job-slow", origin: "manual", visits: [] },
      persisted: new Promise((res) => { release = res; }),
    });

    render(<VisitModalContent />);
    const pri = screen.getByRole("button", { name: "Create & price it →" });
    fireEvent.click(pri);
    fireEvent.click(pri);
    fireEvent.click(screen.getByText("Create job"));

    release({ id: "job-slow", origin: "db", visits: [] });
    await waitFor(() => expect(closeMock).toHaveBeenCalled());
    expect(addJob).toHaveBeenCalledTimes(1);
  });
});

describe("VisitModalContent — the one-job foot", () => {
  beforeEach(() => {
    addJob.mockReset();
    addVisit.mockReset();
    closeMock = vi.fn();
    openModalMock = vi.fn();
  });

  it("has no Job/Estimate chips — the fork is the foot", () => {
    render(<VisitModalContent />);
    expect(screen.queryByText("Estimate visit")).toBeNull();
    expect(screen.queryByRole("button", { name: /^Job$/ })).toBeNull();
    expect(screen.getByRole("button", { name: "Create job" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Create & price it →" })).toBeTruthy();
  });

  // .sheet-pri is width:100% at the class level; in a shared foot that over-constrains
  // the flex line. The cure: Cancel keeps its intrinsic width (flexShrink 0), the
  // creates take the remaining space (flex 1, width auto), all on one 44px line.
  it("Cancel keeps its intrinsic width and the creates split the remaining space", () => {
    render(<VisitModalContent />);
    const cancel = document.querySelector<HTMLButtonElement>(".sheet-foot .btn.ghost");
    const pri = document.querySelector<HTMLButtonElement>(".sheet-foot .sheet-pri");
    expect(cancel).toBeTruthy();
    expect(pri).toBeTruthy();
    expect(cancel?.style.flexShrink).toBe("0");
    expect(cancel?.style.minHeight).toBe("44px");
    expect(pri?.style.flexGrow).toBe("1");
    expect(pri?.style.width).toBe("auto");
  });
});
