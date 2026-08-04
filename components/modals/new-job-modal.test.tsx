// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { NewJobModalContent } from "./new-job-modal";

// Store actions captured so the test can assert ordering (create lead → then estimate job).
const addLead = vi.fn();
const updateLead = vi.fn();
const addJob = vi.fn();
const addVisit = vi.fn();
const updateJob = vi.fn();
// Saved checklists feeding the picker — set per test, reset in beforeEach.
let storeChecklists: unknown[] = [];
// Live leads feeding the customer picker — set per test, reset in beforeEach.
let storeLeads: unknown[] = [];

// close mock at module scope — reassigned in beforeEach so each test gets a fresh spy.
// Declared before vi.mock so the factory closure captures the binding (not the value).
const openModalMock = vi.fn();
const pushModalMock = vi.fn();
const adoptLead = vi.fn();
const vanillaSearch = vi.fn(async () => ({ items: [], nextCursor: null }));
let closeMock = vi.fn();

// The customer picker's server search — settled and empty for these tests, which exercise the
// modal's own logic; the search path has its own tests.
vi.mock("@/lib/trpc/client", () => ({
  api: {
    v1: { customers: { list: { useQuery: () => ({ data: undefined, isFetched: true }) } } },
  },
}));
// The submit path awaits a DIRECT search (not the debounced hook) before deciding whether the
// typed name is an existing customer — that is the fix for the race that minted duplicates.
vi.mock("@/lib/trpc/vanilla", () => ({
  trpcVanilla: { v1: { customers: { list: { query: (...a: unknown[]) => vanillaSearch(...a) } } } },
}));

vi.mock("@/lib/store/app-store", () => ({
  useCloseModal: () => closeMock,
  useOpenModal: () => openModalMock,
  usePushModal: () => pushModalMock,
  useLeads: () => storeLeads,
  useAppStore: (selector: (s: Record<string, unknown>) => unknown) =>
    selector({ addLead, updateLead, addJob, addVisit, updateJob, adoptLead, leads: storeLeads, checklists: storeChecklists }),
}));

describe("NewJobModalContent — createEstimate", () => {
  beforeEach(() => {
    addLead.mockReset();
    updateLead.mockReset();
    addJob.mockReset();
    addVisit.mockReset();
    closeMock = vi.fn();
  });

  it("awaits the persisted lead, then creates a real estimate JOB on the SERVER id", async () => {
    // addLead returns an optimistic id but persists to a different server id.
    addLead.mockReturnValue({
      lead: { id: "optimistic-1", name: "New customer" },
      persisted: Promise.resolve({ id: "srv-1", name: "New customer" }),
    });
    addJob.mockReturnValue({
      job: { id: "job-1" },
      persisted: Promise.resolve({ id: "job-1", origin: "db" }),
    });

    render(<NewJobModalContent />);
    // Fill "What's the job?" and pick the Estimate type.
    fireEvent.change(screen.getByPlaceholderText("e.g. water heater repair"), {
      target: { value: "water heater" },
    });
    fireEvent.click(screen.getByText("Estimate"));
    fireEvent.submit(screen.getByRole("button", { name: /^Create/ }).closest("form")!);

    // Submit resolves the typed customer against the server first, so the chain is async now.
    await waitFor(() => expect(addLead).toHaveBeenCalledOnce());
    // The estimate job must attach to the reconciled server lead id, not the optimistic one.
    await waitFor(() => {
      expect(addJob).toHaveBeenCalledOnce();
    });
    const [jobDraft] = addJob.mock.calls[0] as [{ leadId: string; kind: string; svc: string }];
    expect(jobDraft.leadId).toBe("srv-1");
    // kind carries estimate-ness now; svc is purely the trade label (empty for a walkthrough).
    expect(jobDraft.kind).toBe("estimate");
    expect(jobDraft.svc).not.toBe("estimate");
    // The unplaced visit rides the persisted job.
    await waitFor(() => {
      expect(addVisit).toHaveBeenCalledWith("job-1", expect.any(Number));
    });
  });

  it("shows an error and keeps the modal open when persisted rejects (network failure)", async () => {
    // addLead returns a persisted promise that rejects (e.g. server/network error).
    addLead.mockReturnValue({
      lead: { id: "optimistic-2", name: "New customer" },
      persisted: Promise.reject(new Error("network error")),
    });

    render(<NewJobModalContent />);
    fireEvent.change(screen.getByPlaceholderText("e.g. water heater repair"), {
      target: { value: "boiler install" },
    });
    fireEvent.click(screen.getByText("Estimate"));
    fireEvent.submit(screen.getByRole("button", { name: /^Create/ }).closest("form")!);

    // The error message must appear in the modal.
    await waitFor(() => {
      expect(screen.getByText(/couldn't save the customer/i)).toBeTruthy();
    });

    // The modal must NOT have been closed — data is preserved.
    expect(closeMock).not.toHaveBeenCalled();

    // No estimate job may be created when the lead never persisted.
    expect(addJob).not.toHaveBeenCalled();
  });
});

/**
 * The Job-notes field must not touch the CUSTOMER's notes.
 *
 * createEstimate used to fold `notes` into the lead patch. That write was doubly wrong:
 * buildLeadUpdatePayload deliberately skips `notes`, so it never reached the database, while
 * updateLead's optimistic set replaced the customer's real notes in the store for the rest of
 * the session — the gate code on Cole's record, overwritten by an estimate description. With
 * customer notes now rendered on the job sheet, that overwrite is visible where it does damage.
 */
describe("NewJobModalContent — the job's notes stay on the job", () => {
  const cole = {
    id: "lead-cole",
    name: "Cole Hayes",
    phone: "9255550100",
    address: "12 Pine St",
    notes: "Gate code 4482",
    archived: false,
  };

  beforeEach(() => {
    addLead.mockReset();
    updateLead.mockReset();
    addJob.mockReset();
    addVisit.mockReset();
    closeMock = vi.fn();
    storeLeads = [cole];
  });

  const fillEstimateWithNotes = () => {
    fireEvent.change(screen.getByPlaceholderText("e.g. water heater repair"), {
      target: { value: "water heater" },
    });
    fireEvent.click(screen.getByText("Estimate"));
    fireEvent.change(screen.getByPlaceholderText("search or add"), { target: { value: "Cole Hayes" } });
    fireEvent.blur(screen.getByPlaceholderText("search or add"));
    // The notes field lives behind its own row — now named for the record it writes.
    fireEvent.click(screen.getByText("Job notes"));
    fireEvent.change(screen.getByPlaceholderText("gate code, what to bring…"), {
      target: { value: "Attic access is through the closet" },
    });
    fireEvent.submit(screen.getByRole("button", { name: /^Create/ }).closest("form")!);
  };

  it("never patches lead.notes when creating an estimate", async () => {
    addJob.mockReturnValue({
      job: { id: "job-est", origin: "manual", visits: [] },
      persisted: Promise.resolve({ id: "job-est", origin: "db", visits: [] }),
    });

    render(<NewJobModalContent />);
    fillEstimateWithNotes();

    await waitFor(() => expect(addJob).toHaveBeenCalledOnce());
    // The existing customer is matched, so no new one is minted and the patch is a merge.
    expect(addLead).not.toHaveBeenCalled();
    expect(updateLead).toHaveBeenCalledOnce();
    const [leadId, patch] = updateLead.mock.calls[0] as [string, Record<string, unknown>];
    expect(leadId).toBe("lead-cole");
    expect(patch).not.toHaveProperty("notes");
    // The rest of the merge is untouched — this is a targeted removal, not a gutting.
    expect(patch.job).toBe("water heater");
  });

  it("still carries the typed text onto the JOB, which is what the field is for", async () => {
    addJob.mockReturnValue({
      job: { id: "job-est", origin: "manual", visits: [] },
      persisted: Promise.resolve({ id: "job-est", origin: "db", visits: [] }),
    });

    render(<NewJobModalContent />);
    fillEstimateWithNotes();

    await waitFor(() => expect(addJob).toHaveBeenCalledOnce());
    expect(addJob).toHaveBeenCalledWith(
      expect.objectContaining({ notes: "Attic access is through the closet" }),
    );
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
    const persistedLead = { id: "srv-lead-10", name: "Maria Garcia", phone: "5551234567" };
    addLead.mockReturnValue({
      lead: { id: "opt-lead-10", name: "Maria Garcia" },
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
    // Default type is "Flat rate" (internally: service), so no type switch needed.
    fireEvent.change(screen.getByPlaceholderText("search or add"), {
      target: { value: "Maria Garcia" },
    });
    fireEvent.submit(screen.getByRole("button", { name: /^Create/ }).closest("form")!);

    // addLead must be called to create the new customer (after the async server resolution).
    await waitFor(() => expect(addLead).toHaveBeenCalledOnce());

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
    const persistedLead = { id: "existing-lead-20", name: "Bob Smith" };
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
    fireEvent.submit(screen.getByRole("button", { name: /^Create/ }).closest("form")!);

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
      lead: { id: "lead-fail-30", name: "Fail User" },
      persisted: Promise.resolve({ id: "lead-fail-30", name: "Fail User" }),
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
    fireEvent.submit(screen.getByRole("button", { name: /^Create/ }).closest("form")!);

    await waitFor(() => {
      expect(screen.getByText(/couldn't save the job/i)).toBeTruthy();
    });

    // Modal must NOT close on failure.
    expect(closeMock).not.toHaveBeenCalled();
    // Visits must NOT be created when the job failed to persist.
    expect(addVisit).not.toHaveBeenCalled();
  });
});

describe("NewJobModalContent — phone validation", () => {
  beforeEach(() => {
    addLead.mockReset();
    addJob.mockReset();
    closeMock = vi.fn();
  });

  it("blocks submit inline on an invalid 8-digit phone — no network call at all", () => {
    render(<NewJobModalContent />);
    fireEvent.change(screen.getByPlaceholderText("e.g. water heater repair"), {
      target: { value: "water heater repair" },
    });
    fireEvent.change(screen.getByPlaceholderText("(925) 555-0123"), {
      target: { value: "78138501" },
    });
    fireEvent.submit(screen.getByRole("button", { name: /^Create/ }).closest("form")!);

    expect(screen.getByText(/that phone number isn't valid/i)).toBeTruthy();
    // Neither addLead nor addJob should ever fire — the server never sees this.
    expect(addLead).not.toHaveBeenCalled();
    expect(addJob).not.toHaveBeenCalled();
  });

  it("clears the inline phone error as soon as the field is edited", () => {
    render(<NewJobModalContent />);
    fireEvent.change(screen.getByPlaceholderText("e.g. water heater repair"), {
      target: { value: "water heater repair" },
    });
    const phoneInput = screen.getByPlaceholderText("(925) 555-0123");
    fireEvent.change(phoneInput, { target: { value: "78138501" } });
    fireEvent.submit(screen.getByRole("button", { name: /^Create/ }).closest("form")!);
    expect(screen.getByText(/that phone number isn't valid/i)).toBeTruthy();

    fireEvent.change(phoneInput, { target: { value: "9255550123" } });
    expect(screen.queryByText(/that phone number isn't valid/i)).toBeNull();
  });

  it("a blank phone is fine — it's optional", async () => {
    addLead.mockReturnValue({
      lead: { id: "opt-1", name: "New customer" },
      persisted: Promise.resolve({ id: "srv-1", name: "New customer" }),
    });
    addJob.mockReturnValue({
      job: { id: "job-1", origin: "manual", visits: [] },
      persisted: Promise.resolve({ id: "job-1", origin: "db", visits: [] }),
    });
    render(<NewJobModalContent />);
    fireEvent.change(screen.getByPlaceholderText("e.g. water heater repair"), {
      target: { value: "water heater repair" },
    });
    fireEvent.submit(screen.getByRole("button", { name: /^Create/ }).closest("form")!);
    await waitFor(() => expect(addLead).toHaveBeenCalledOnce());
    expect(screen.queryByText(/that phone number isn't valid/i)).toBeNull();
  });

  it("names the server's own validation reason instead of blaming the connection (BAD_REQUEST)", async () => {
    // Simulates a TRPCClientError shape the leads-slice rethrows unchanged.
    addLead.mockReturnValue({
      lead: { id: "opt-2", name: "New customer" },
      persisted: Promise.reject({
        message: 'invalid US phone number: "78138501"',
        data: { code: "BAD_REQUEST" },
      }),
    });
    render(<NewJobModalContent />);
    fireEvent.change(screen.getByPlaceholderText("e.g. water heater repair"), {
      target: { value: "water heater repair" },
    });
    fireEvent.submit(screen.getByRole("button", { name: /^Create/ }).closest("form")!);

    await waitFor(() => {
      expect(screen.getByText(/invalid US phone number/i)).toBeTruthy();
    });
    // The wrong, connection-blaming copy must NOT appear.
    expect(screen.queryByText(/check your connection/i)).toBeNull();
  });

  it("still blames the connection for a genuine network failure (no server data shape)", async () => {
    addLead.mockReturnValue({
      lead: { id: "opt-3", name: "New customer" },
      persisted: Promise.reject(new TypeError("Failed to fetch")),
    });
    render(<NewJobModalContent />);
    fireEvent.change(screen.getByPlaceholderText("e.g. water heater repair"), {
      target: { value: "water heater repair" },
    });
    fireEvent.submit(screen.getByRole("button", { name: /^Create/ }).closest("form")!);

    await waitFor(() => {
      expect(screen.getByText(/check your connection/i)).toBeTruthy();
    });
  });
});

describe("NewJobModalContent — checklist wiring (Job type)", () => {
  beforeEach(() => {
    addLead.mockReset();
    addJob.mockReset();
    addVisit.mockReset();
    updateJob.mockReset();
    // updateJob resolves { ok } (jobs-slice contract) — default to success.
    updateJob.mockResolvedValue({ ok: true });
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
    const persistedLead = { id: "lead-40", name: "Chk Customer" };
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
    fireEvent.submit(screen.getByRole("button", { name: /^Create/ }).closest("form")!);

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
    const persistedLead = { id: "lead-41", name: "Custom Customer" };
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
    fireEvent.submit(screen.getByRole("button", { name: /^Create/ }).closest("form")!);

    await waitFor(() => expect(updateJob).toHaveBeenCalledOnce());
    const [, patch] = updateJob.mock.calls[0] as [
      string,
      { checklist: { name: string; items: { text: string; type: string; required: boolean }[] } },
    ];
    expect(patch.checklist.items).toEqual([
      expect.objectContaining({ text: "Photo of the repair", type: "photo", required: true }),
    ]);
  });

  it("keeps the modal open with an error when the checklist attach fails, and a retry re-attaches to the SAME job", async () => {
    storeChecklists = [
      {
        id: "chk-2",
        name: "Drain close-out",
        trade: "Custom",
        stage: "job",
        match: [],
        items: [{ id: "i1", text: "Flow tested", type: "check", required: true, position: 0 }],
      },
    ];
    const persistedLead = { id: "lead-50", name: "Retry Customer" };
    addLead.mockReturnValue({ lead: persistedLead, persisted: Promise.resolve(persistedLead) });
    addJob.mockReturnValue({
      job: { id: "job-50", origin: "manual", visits: [] },
      persisted: Promise.resolve({ id: "job-50", origin: "db", visits: [] }),
    });
    // First attach fails ({ ok:false } — the slice rolled back), second succeeds.
    updateJob.mockResolvedValueOnce({ ok: false });

    render(<NewJobModalContent />);
    fireEvent.change(screen.getByPlaceholderText("e.g. water heater repair"), {
      target: { value: "clear main line" },
    });
    fireEvent.click(screen.getByText("No checklist"));
    fireEvent.click(screen.getByText("Drain close-out"));
    fireEvent.submit(screen.getByRole("button", { name: /^Create/ }).closest("form")!);

    // Failure surfaced, no silent close — the job exists but its checklist doesn't.
    await waitFor(() =>
      expect(screen.getByText(/job was saved, but the checklist wasn't/i)).toBeTruthy(),
    );
    expect(closeMock).not.toHaveBeenCalled();

    // Retry: re-attaches to job-50 — no duplicate job, no duplicate visits.
    fireEvent.submit(screen.getByRole("button", { name: /^Create/ }).closest("form")!);
    await waitFor(() => expect(closeMock).toHaveBeenCalled());
    expect(addJob).toHaveBeenCalledTimes(1);
    expect(updateJob).toHaveBeenCalledTimes(2);
    expect(updateJob).toHaveBeenLastCalledWith("job-50", expect.objectContaining({
      checklist: expect.objectContaining({ name: "Drain close-out" }),
    }));
  });

  it("no checklist section for the Estimate type; none attached without a pick", async () => {
    const persistedLead = { id: "lead-42", name: "Plain Customer" };
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
    // The chip reads "Flat rate" now — "Job" was wrong twice: an estimate visit IS a job, and
    // what the chip means is that the price is known.
    fireEvent.click(screen.getByRole("button", { name: "Flat rate" }));
    fireEvent.change(screen.getByPlaceholderText("e.g. water heater repair"), {
      target: { value: "plain job" },
    });
    fireEvent.submit(screen.getByRole("button", { name: /^Create/ }).closest("form")!);
    await waitFor(() => expect(addVisit).toHaveBeenCalled());
    expect(updateJob).not.toHaveBeenCalled();
  });
});

/**
 * One press must create one job.
 *
 * Seen in production: three clicks on Create job produced three customers, three jobs and three
 * visits (v1.customers.create → v1.jobs.create → v1.visits.createVisit, ×3, all 200). The chain is
 * two awaited round trips — about a second — and the modal only closes on success, so the button
 * sat live and every impatient press ran the whole thing again with fresh UUIDs. Server
 * idempotency cannot collapse them: customers.create takes no client id.
 */
describe("NewJobModalContent — one press, one job", () => {
  beforeEach(() => {
    addLead.mockReset();
    updateLead.mockReset();
    addJob.mockReset();
    addVisit.mockReset();
    closeMock = vi.fn();
  });

  const armSlowChain = () => {
    let releaseLead: (v: unknown) => void = () => {};
    addLead.mockReturnValue({
      lead: { id: "opt-lead-x", name: "Maria Garcia" },
      persisted: new Promise((res) => { releaseLead = res; }),
    });
    addJob.mockReturnValue({
      job: { id: "job-x", origin: "manual", visits: [] },
      persisted: Promise.resolve({ id: "job-x", origin: "db", visits: [] }),
    });
    return () => releaseLead({ id: "srv-lead-x", name: "Maria Garcia", phone: "5551234567" });
  };

  const fillForm = () => {
    fireEvent.change(screen.getByPlaceholderText("e.g. water heater repair"), {
      target: { value: "fix boiler" },
    });
    fireEvent.change(screen.getByPlaceholderText("search or add"), {
      target: { value: "Maria Garcia" },
    });
  };

  it("ignores further presses while the first is still in flight", async () => {
    const release = armSlowChain();
    render(<NewJobModalContent />);
    fillForm();

    const form = screen.getByRole("button", { name: /^Create/ }).closest("form")!;
    fireEvent.submit(form);
    fireEvent.submit(form);
    fireEvent.submit(form);

    // The customer is the first step of the chain and the one the server cannot de-duplicate.
    // The chain opens with an async server resolution now, so the first call lands a tick later —
    // the guard's job is that three submits still produce exactly ONE.
    await waitFor(() => expect(addLead).toHaveBeenCalledOnce());

    release();
    await waitFor(() => expect(addJob).toHaveBeenCalledOnce());
    expect(addVisit).toHaveBeenCalledOnce();
  });

  it("says it is working, and refuses the button while it is", async () => {
    armSlowChain();
    render(<NewJobModalContent />);
    fillForm();
    fireEvent.submit(screen.getByRole("button", { name: /^Create/ }).closest("form")!);

    // The label is the feedback the missing round-trip time never gave.
    const submit = screen.getByText("Creating…");
    expect(submit.hasAttribute("disabled")).toBe(true);
    expect(screen.getByText("Cancel").hasAttribute("disabled")).toBe(true);
  });

  /**
   * The in-body "Build the price" row is gone — for flat rate, the PRIMARY creates and lands in
   * the builder in one motion ("Create & price it"), because a flat-rate job's price is the point
   * of the type. The double-submit guard still has to hold across that single entry point.
   */
  it("guards a second submit while the create-and-price chain is in flight", async () => {
    armSlowChain();
    render(<NewJobModalContent />);
    fillForm();

    fireEvent.click(screen.getByRole("button", { name: /^Create/ }));
    fireEvent.submit(screen.getByText("Creating…").closest("form")!);

    await waitFor(() => expect(addLead).toHaveBeenCalledOnce());
  });
});

/**
 * The customer picker — an IN-FLOW suggestion list under the input, replacing
 * the native <input list>/<datalist> whose OS popup overlaid the whole modal
 * (and could not be styled). Search-or-ADD: picking fills the field with the
 * lead's exact name (matchLead resolves by trimmed case-insensitive name), and
 * free-typed new names still create a new customer.
 */
describe("NewJobModalContent — customer picker", () => {
  const ann = {
    id: "lead-ann",
    name: "Ann Alpha",
    phone: "9255550100",
    address: "1 Alpha St",
    archived: false,
  };
  const bob = { id: "lead-bob", name: "Bob Beta", phone: "—", archived: false };
  const gone = { id: "lead-gone", name: "Anna Archived", phone: "9255550199", archived: true };

  beforeEach(() => {
    addLead.mockReset();
    updateLead.mockReset();
    addJob.mockReset();
    addVisit.mockReset();
    updateJob.mockReset();
    closeMock = vi.fn();
    storeLeads = [ann, bob, gone];
  });

  const custInput = () => screen.getByPlaceholderText("search or add");

  it("typing filters live leads into in-flow option rows; archived leads never appear", () => {
    render(<NewJobModalContent />);
    // No list until the user types.
    expect(screen.queryByRole("listbox")).toBeNull();

    fireEvent.change(custInput(), { target: { value: "an" } });
    const options = screen.getAllByRole("option");
    expect(options.map((o) => o.textContent)).toEqual([expect.stringContaining("Ann Alpha")]);
    // The archived "Anna Archived" matched the query but must not be offered.
    expect(screen.queryByText("Anna Archived")).toBeNull();
  });

  it("caps the list at 8 rows", () => {
    storeLeads = Array.from({ length: 12 }, (_, i) => ({
      id: `lead-${i}`,
      name: `Match Customer ${i}`,
      phone: "—",
      archived: false,
    }));
    render(<NewJobModalContent />);
    fireEvent.change(custInput(), { target: { value: "match" } });
    expect(screen.getAllByRole("option")).toHaveLength(8);
  });

  it("picking a row fills the input and prefills empty phone/address (no clobber of typed)", () => {
    render(<NewJobModalContent />);
    fireEvent.change(custInput(), { target: { value: "ann" } });
    // mousedown, not click — the pick must land before the input's blur.
    fireEvent.mouseDown(screen.getByRole("option"));

    expect((custInput() as HTMLInputElement).value).toBe("Ann Alpha");
    expect((screen.getByPlaceholderText("(925) 555-0123") as HTMLInputElement).value).toBe("9255550100");
    expect((screen.getByPlaceholderText("add the address") as HTMLInputElement).value).toBe("1 Alpha St");
    // The pick closes the list.
    expect(screen.queryByRole("listbox")).toBeNull();
  });

  it("the committed value round-trips through matchLead — submit uses the EXISTING lead", async () => {
    addJob.mockReturnValue({
      job: { id: "job-ann", origin: "manual", visits: [] },
      persisted: Promise.resolve({ id: "job-ann", origin: "db", visits: [] }),
    });
    render(<NewJobModalContent />);
    fireEvent.change(screen.getByPlaceholderText("e.g. water heater repair"), {
      target: { value: "fix disposal" },
    });
    fireEvent.change(custInput(), { target: { value: "ann" } });
    fireEvent.mouseDown(screen.getByRole("option"));
    fireEvent.submit(screen.getByRole("button", { name: /^Create/ }).closest("form")!);

    await waitFor(() => expect(addJob).toHaveBeenCalledOnce());
    // Matched by name → no new customer minted, the job rides the existing lead.
    expect(addLead).not.toHaveBeenCalled();
    expect(addJob).toHaveBeenCalledWith(expect.objectContaining({ leadId: "lead-ann" }));
  });

  it("free-typed new names pass through — search or ADD", async () => {
    addLead.mockReturnValue({
      lead: { id: "opt-new", name: "Brand New Person" },
      persisted: Promise.resolve({ id: "srv-new", name: "Brand New Person" }),
    });
    addJob.mockReturnValue({
      job: { id: "job-new", origin: "manual", visits: [] },
      persisted: Promise.resolve({ id: "job-new", origin: "db", visits: [] }),
    });
    render(<NewJobModalContent />);
    fireEvent.change(screen.getByPlaceholderText("e.g. water heater repair"), {
      target: { value: "new build rough-in" },
    });
    fireEvent.change(custInput(), { target: { value: "Brand New Person" } });
    // No match → no list, and the typed name is what gets created.
    expect(screen.queryByRole("listbox")).toBeNull();
    fireEvent.submit(screen.getByRole("button", { name: /^Create/ }).closest("form")!);

    await waitFor(() => expect(addLead).toHaveBeenCalledOnce());
    expect(addLead).toHaveBeenCalledWith(expect.objectContaining({ name: "Brand New Person" }));
  });

  /**
   * Bare Enter — nothing highlighted — KEEPS the typed text and just closes the list. It used to
   * commit the top match, which silently swapped a typed NEW customer for whichever existing name
   * sorted first; with the whole server book now searchable, that stopped being a rare collision.
   * Only an explicitly highlighted row commits (true AddressInput parity).
   */
  it("Enter with the list open but nothing highlighted keeps the typed text", () => {
    render(<NewJobModalContent />);
    fireEvent.change(custInput(), { target: { value: "bo" } });
    expect(screen.getByRole("listbox")).toBeTruthy();

    fireEvent.keyDown(custInput(), { key: "Enter" });
    expect((custInput() as HTMLInputElement).value).toBe("bo");
    expect(screen.queryByRole("listbox")).toBeNull();
    // And it is never a form submit either way.
    expect(addLead).not.toHaveBeenCalled();
    expect(addJob).not.toHaveBeenCalled();
  });

  it("ArrowDown moves the highlight and Enter commits the highlighted row", () => {
    render(<NewJobModalContent />);
    // "a" matches both live leads: "Ann Alpha" and "Bob Beta" (the a in Beta).
    fireEvent.change(custInput(), { target: { value: "a" } });
    expect(screen.getAllByRole("option")).toHaveLength(2);

    fireEvent.keyDown(custInput(), { key: "ArrowDown" });
    fireEvent.keyDown(custInput(), { key: "ArrowDown" });
    expect(screen.getAllByRole("option")[1]!.getAttribute("aria-selected")).toBe("true");

    fireEvent.keyDown(custInput(), { key: "Enter" });
    expect((custInput() as HTMLInputElement).value).toBe("Bob Beta");
    expect(screen.queryByRole("listbox")).toBeNull();
  });

  it("Escape closes the list only — the modal stays open", () => {
    render(<NewJobModalContent />);
    fireEvent.change(custInput(), { target: { value: "ann" } });
    expect(screen.getByRole("listbox")).toBeTruthy();

    fireEvent.keyDown(custInput(), { key: "Escape" });
    expect(screen.queryByRole("listbox")).toBeNull();
    expect(closeMock).not.toHaveBeenCalled();
  });

  it("blur closes the list and still prefills from a typed-exact name", () => {
    render(<NewJobModalContent />);
    fireEvent.change(custInput(), { target: { value: "Ann Alpha" } });
    fireEvent.blur(custInput());

    expect(screen.queryByRole("listbox")).toBeNull();
    expect((screen.getByPlaceholderText("(925) 555-0123") as HTMLInputElement).value).toBe("9255550100");
  });
});

/**
 * The three fixes Owen reported on the booking modal, pinned.
 */
describe("NewJobModalContent — booking fixes", () => {
  beforeEach(() => {
    addLead.mockReset(); addJob.mockReset(); addVisit.mockReset();
    openModalMock.mockReset(); pushModalMock.mockReset();
    closeMock = vi.fn();
    addLead.mockReturnValue({
      lead: { id: "opt-lead-1", name: "Maria Garcia" },
      persisted: Promise.resolve({ id: "srv-lead-1", name: "Maria Garcia" }),
    });
    addJob.mockReturnValue({
      job: { id: "job-opt-1", origin: "manual", visits: [] },
      persisted: Promise.resolve({ id: "job-opt-1", origin: "db", visits: [] }),
    });
  });

  /**
   * ENTER SAVED THE JOB MID-THOUGHT. Implicit submission needs a default button (HTML spec), so
   * the guarantee is structural: the form contains NO type="submit" control — the primary is
   * type="button". jsdom does not implement implicit submission, so asserting a keydown here
   * would pass vacuously; asserting the mechanism is what actually pins the fix.
   */
  it("the form has no submit button, so Enter cannot implicitly create the job", () => {
    render(<NewJobModalContent />);
    const form = screen.getByRole("button", { name: /^Create/ }).closest("form")!;
    expect(form.querySelector('button[type="submit"], input[type="submit"]')).toBeNull();
    expect((screen.getByRole("button", { name: /^Create/ }) as HTMLButtonElement).type).toBe("button");
  });

  // FLAT RATE MEANS THE PRICE IS KNOWN — creating one lands in the price builder in one motion.
  it("flat rate's primary creates the job and opens the price builder", async () => {
    render(<NewJobModalContent />);
    fireEvent.change(screen.getByPlaceholderText("e.g. water heater repair"), { target: { value: "fix boiler" } });
    fireEvent.change(screen.getByPlaceholderText("search or add"), { target: { value: "Maria Garcia" } });
    fireEvent.submit(screen.getByRole("button", { name: /^Create/ }).closest("form")!);
    await waitFor(() => expect(pushModalMock).toHaveBeenCalled());
    expect(pushModalMock.mock.calls[0]![0]).toBe("price-builder");
  });

  it("an estimate creates plain — its price comes later by definition", async () => {
    render(<NewJobModalContent />);
    fireEvent.click(screen.getByText("Estimate"));
    fireEvent.change(screen.getByPlaceholderText("e.g. water heater repair"), { target: { value: "quote a repipe" } });
    fireEvent.change(screen.getByPlaceholderText("search or add"), { target: { value: "Maria Garcia" } });
    fireEvent.submit(screen.getByRole("button", { name: /^Create/ }).closest("form")!);
    await waitFor(() => expect(closeMock).toHaveBeenCalled());
    expect(pushModalMock).not.toHaveBeenCalled();
  });
});
