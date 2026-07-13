// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { NewJobModalContent } from "./new-job-modal";

// Store actions captured so the test can assert ordering (create → then evisit patch).
const addLead = vi.fn();
const updateLead = vi.fn();
const addJob = vi.fn();
const addVisit = vi.fn();
const updateJob = vi.fn();
// Saved checklists feeding the picker — set per test, reset in beforeEach.
let storeChecklists: unknown[] = [];

// close mock at module scope — reassigned in beforeEach so each test gets a fresh spy.
// Declared before vi.mock so the factory closure captures the binding (not the value).
let closeMock = vi.fn();

vi.mock("@/lib/store/app-store", () => ({
  useCloseModal: () => closeMock,
  useOpenModal: () => vi.fn(),
  useLeads: () => [],
  useAppStore: (selector: (s: Record<string, unknown>) => unknown) =>
    selector({ addLead, updateLead, addJob, addVisit, updateJob, checklists: storeChecklists }),
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

describe("NewJobModalContent — checklist wiring (Job type)", () => {
  beforeEach(() => {
    addLead.mockReset();
    addJob.mockReset();
    addVisit.mockReset();
    updateJob.mockReset();
    storeChecklists = [];
    closeMock = vi.fn();
  });

  it("attaches a picked saved checklist via updateJob AFTER jobPersisted resolves", async () => {
    storeChecklists = [
      {
        id: "chk-1",
        name: "Water heater close-out",
        trade: "Custom",
        stage: "job",
        match: [],
        items: [
          { id: "i1", text: "Photo of the install", type: "photo", required: true, position: 0 },
        ],
      },
    ];
    const persistedLead = { id: "lead-40", name: "Chk Customer", evisits: [] };
    addLead.mockReturnValue({ lead: persistedLead, persisted: Promise.resolve(persistedLead) });
    let resolveJobPersisted!: (j: unknown) => void;
    addJob.mockReturnValue({
      job: { id: "job-40", origin: "manual", visits: [] },
      persisted: new Promise((res) => { resolveJobPersisted = res; }),
    });

    render(<NewJobModalContent />);
    fireEvent.change(screen.getByPlaceholderText("e.g. water heater repair"), {
      target: { value: "swap water heater" },
    });
    // Expand the picker and pick the saved checklist row.
    fireEvent.click(screen.getByText("No checklist"));
    fireEvent.click(screen.getByText("Water heater close-out"));
    fireEvent.submit(screen.getByText("Create job").closest("form")!);

    await waitFor(() => expect(addJob).toHaveBeenCalledOnce());
    // Not yet — the snapshot only persists once the job is DB-origin.
    expect(updateJob).not.toHaveBeenCalled();
    resolveJobPersisted({ id: "job-40", origin: "db", visits: [] });
    await waitFor(() => expect(updateJob).toHaveBeenCalledOnce());
    const [jobId, patch] = updateJob.mock.calls[0] as [
      string,
      { checklist: { name: string; items: { required: boolean }[] } },
    ];
    expect(jobId).toBe("job-40");
    expect(patch.checklist.name).toBe("Water heater close-out");
    expect(patch.checklist.items).toHaveLength(1);
  });

  it("builds a custom checklist from scratch with required photo/check items", async () => {
    const persistedLead = { id: "lead-41", name: "Custom Customer", evisits: [] };
    addLead.mockReturnValue({ lead: persistedLead, persisted: Promise.resolve(persistedLead) });
    addJob.mockReturnValue({
      job: { id: "job-41", origin: "manual", visits: [] },
      persisted: Promise.resolve({ id: "job-41", origin: "db", visits: [] }),
    });

    render(<NewJobModalContent />);
    fireEvent.change(screen.getByPlaceholderText("e.g. water heater repair"), {
      target: { value: "fix leak" },
    });
    fireEvent.click(screen.getByText("No checklist"));
    fireEvent.click(screen.getByText("Build from scratch"));
    fireEvent.change(screen.getByPlaceholderText("e.g. Photo: dry under the sink"), {
      target: { value: "Photo of the repair" },
    });
    fireEvent.click(screen.getByText("Add item"));
    fireEvent.submit(screen.getByText("Create job").closest("form")!);

    await waitFor(() => expect(updateJob).toHaveBeenCalledOnce());
    const [, patch] = updateJob.mock.calls[0] as [
      string,
      { checklist: { name: string; items: { text: string; type: string; required: boolean }[] } },
    ];
    expect(patch.checklist.items).toEqual([
      expect.objectContaining({ text: "Photo of the repair", type: "photo", required: true }),
    ]);
  });

  it("no checklist section for the Estimate type; none attached without a pick", async () => {
    const persistedLead = { id: "lead-42", name: "Plain Customer", evisits: [] };
    addLead.mockReturnValue({ lead: persistedLead, persisted: Promise.resolve(persistedLead) });
    addJob.mockReturnValue({
      job: { id: "job-42", origin: "manual", visits: [] },
      persisted: Promise.resolve({ id: "job-42", origin: "db", visits: [] }),
    });

    render(<NewJobModalContent />);
    // Estimate type hides the checklist picker entirely.
    fireEvent.click(screen.getByText("Estimate"));
    expect(screen.queryByText("No checklist")).toBeNull();
    // Back to Job: create without picking → no checklist attach.
    fireEvent.click(screen.getByRole("button", { name: "Job" }));
    fireEvent.change(screen.getByPlaceholderText("e.g. water heater repair"), {
      target: { value: "plain job" },
    });
    fireEvent.submit(screen.getByText("Create job").closest("form")!);
    await waitFor(() => expect(addVisit).toHaveBeenCalled());
    expect(updateJob).not.toHaveBeenCalled();
  });
});
