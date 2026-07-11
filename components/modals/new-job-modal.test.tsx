// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { NewJobModalContent } from "./new-job-modal";

// Store actions captured so the test can assert ordering (create → then evisit patch).
const addLead = vi.fn();
const updateLead = vi.fn();
const addJob = vi.fn();
const addVisit = vi.fn();

// close mock at module scope — reassigned in beforeEach so each test gets a fresh spy.
// Declared before vi.mock so the factory closure captures the binding (not the value).
let closeMock = vi.fn();

vi.mock("@/lib/store/app-store", () => ({
  useCloseModal: () => closeMock,
  useOpenModal: () => vi.fn(),
  useLeads: () => [],
  useAppStore: (selector: (s: Record<string, unknown>) => unknown) =>
    selector({ addLead, updateLead, addJob, addVisit }),
}));

describe("NewJobModalContent — createEstimate", () => {
  beforeEach(() => {
    addLead.mockReset();
    updateLead.mockReset();
    closeMock = vi.fn();
  });

  it("awaits the persisted lead, then attaches the evisit to the SERVER id", async () => {
    // addLead returns an optimistic id but persists to a different server id.
    addLead.mockReturnValue({
      lead: { id: "optimistic-1", name: "New customer", evisits: [] },
      persisted: Promise.resolve({ id: "srv-1", name: "New customer", evisits: [] }),
    });

    render(<NewJobModalContent />);
    // Fill "What's the job?" and pick the Estimate type.
    fireEvent.change(screen.getByPlaceholderText("e.g. water heater repair"), {
      target: { value: "water heater" },
    });
    fireEvent.click(screen.getByText("Estimate"));
    fireEvent.submit(screen.getByText("Create job").closest("form")!);

    expect(addLead).toHaveBeenCalledOnce();
    // The evisit patch must land on the reconciled server id, not the optimistic one.
    await waitFor(() => {
      expect(updateLead).toHaveBeenCalledOnce();
    });
    const [id, patch] = updateLead.mock.calls[0] as [string, { evisits: unknown[] }];
    expect(id).toBe("srv-1");
    expect(patch.evisits).toHaveLength(1);
  });

  it("shows an error and keeps the modal open when persisted rejects (network failure)", async () => {
    // addLead returns a persisted promise that rejects (e.g. server/network error).
    addLead.mockReturnValue({
      lead: { id: "optimistic-2", name: "New customer", evisits: [] },
      persisted: Promise.reject(new Error("network error")),
    });

    render(<NewJobModalContent />);
    fireEvent.change(screen.getByPlaceholderText("e.g. water heater repair"), {
      target: { value: "boiler install" },
    });
    fireEvent.click(screen.getByText("Estimate"));
    fireEvent.submit(screen.getByText("Create job").closest("form")!);

    // The error message must appear in the modal.
    await waitFor(() => {
      expect(screen.getByText(/couldn't save the customer/i)).toBeTruthy();
    });

    // The modal must NOT have been closed — data is preserved.
    expect(closeMock).not.toHaveBeenCalled();

    // updateLead must NOT have been called (no evisit attached on failure).
    expect(updateLead).not.toHaveBeenCalled();
  });
});

describe("NewJobModalContent — createJob (Job type)", () => {
  beforeEach(() => {
    addLead.mockReset();
    updateLead.mockReset();
    addJob.mockReset();
    addVisit.mockReset();
    closeMock = vi.fn();
  });

  it("creates a lead first for a new customer, then addJob receives the server-assigned leadId", async () => {
    // Lead persist returns a different (server) id from the optimistic one.
    const persistedLead = { id: "srv-lead-10", name: "Maria Garcia", evisits: [], phone: "5551234567" };
    addLead.mockReturnValue({
      lead: { id: "opt-lead-10", name: "Maria Garcia", evisits: [] },
      persisted: Promise.resolve(persistedLead),
    });
    // addJob returns { job, persisted } shape; persisted resolves to the reconciled job.
    const optimisticJob = { id: "job-opt-10", origin: "manual", visits: [] };
    const reconciledJob = { id: "job-opt-10", origin: "db", visits: [] };
    addJob.mockReturnValue({
      job: optimisticJob,
      persisted: Promise.resolve(reconciledJob),
    });

    render(<NewJobModalContent />);
    fireEvent.change(screen.getByPlaceholderText("e.g. water heater repair"), {
      target: { value: "fix boiler" },
    });
    // Default type is "Job" (service), so no type switch needed.
    fireEvent.change(screen.getByPlaceholderText("search or add"), {
      target: { value: "Maria Garcia" },
    });
    fireEvent.submit(screen.getByText("Create job").closest("form")!);

    // addLead must be called to create the new customer.
    expect(addLead).toHaveBeenCalledOnce();

    // Wait for the full async createJob to complete.
    await waitFor(() => {
      expect(addJob).toHaveBeenCalledOnce();
    });
    // addJob must receive the server-assigned lead id, not the optimistic one.
    expect(addJob).toHaveBeenCalledWith(
      expect.objectContaining({ leadId: "srv-lead-10" }),
    );
  });

  it("calls addVisit AFTER job persisted resolves (visits persist when origin is db)", async () => {
    // existing customer — no addLead call needed.
    const persistedLead = { id: "existing-lead-20", name: "Bob Smith", evisits: [] };
    addLead.mockReturnValue({
      lead: persistedLead,
      persisted: Promise.resolve(persistedLead),
    });

    let resolveJobPersisted!: (j: unknown) => void;
    const jobPersistedPromise = new Promise((res) => { resolveJobPersisted = res; });
    const optimisticJob = { id: "job-opt-20", origin: "manual", visits: [] };
    addJob.mockReturnValue({ job: optimisticJob, persisted: jobPersistedPromise });

    render(<NewJobModalContent />);
    fireEvent.change(screen.getByPlaceholderText("e.g. water heater repair"), {
      target: { value: "install faucet" },
    });
    fireEvent.submit(screen.getByText("Create job").closest("form")!);

    await waitFor(() => expect(addJob).toHaveBeenCalledOnce());

    // addVisit must NOT have been called yet — still waiting on jobPersisted.
    expect(addVisit).not.toHaveBeenCalled();

    // Resolve the job persisted promise to simulate the server reconcile.
    resolveJobPersisted({ id: "job-opt-20", origin: "db", visits: [] });

    // Now addVisit should be called.
    await waitFor(() => {
      expect(addVisit).toHaveBeenCalledWith("job-opt-20", expect.any(Number));
    });
  });

  it("surfaces an error and keeps the modal open when addJob persisted rejects", async () => {
    addLead.mockReturnValue({
      lead: { id: "lead-fail-30", name: "Fail User", evisits: [] },
      persisted: Promise.resolve({ id: "lead-fail-30", name: "Fail User", evisits: [] }),
    });
    const optimisticJob = { id: "job-fail-30", origin: "manual", visits: [] };
    addJob.mockReturnValue({
      job: optimisticJob,
      persisted: Promise.reject(new Error("db error")),
    });

    render(<NewJobModalContent />);
    fireEvent.change(screen.getByPlaceholderText("e.g. water heater repair"), {
      target: { value: "repair sink" },
    });
    fireEvent.submit(screen.getByText("Create job").closest("form")!);

    await waitFor(() => {
      expect(screen.getByText(/couldn't save the job/i)).toBeTruthy();
    });

    // Modal must NOT close on failure.
    expect(closeMock).not.toHaveBeenCalled();
    // Visits must NOT be created when the job failed to persist.
    expect(addVisit).not.toHaveBeenCalled();
  });
});
