// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";
import { NewJobModalContent } from "./new-job-modal";
import { MODAL } from "@/lib/store/modal-ids";

// Store actions captured so the test can assert ordering (create lead → then job).
const addLead = vi.fn();
const updateLead = vi.fn();
const addJob = vi.fn();
const addVisit = vi.fn();
const updateJob = vi.fn();
const attachJobFile = vi.fn();
// Saved checklists feeding the picker — set per test, reset in beforeEach.
let storeChecklists: unknown[] = [];
// Live leads feeding the customer picker — set per test, reset in beforeEach.
let storeLeads: unknown[] = [];
// Params the sheet was opened with. The customer sheet opens this modal with a leadId so the
// job lands on the customer you were standing in.
let activeParams: Record<string, unknown> = {};

// close mock at module scope — reassigned in beforeEach so each test gets a fresh spy.
// Declared before vi.mock so the factory closure captures the binding (not the value).
const openModalMock = vi.fn();
const pushModalMock = vi.fn();
const routerPush = vi.fn();
const adoptLead = vi.fn();
// Rest-typed so the mock below can forward the real call's arguments to it. Declared with no
// parameters, the spread at the call site is a TS2556 and the whole file fails `tsc --noEmit`.
const vanillaSearch = vi.fn(async (..._args: unknown[]) => ({ items: [], nextCursor: null }));
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

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: routerPush, replace: vi.fn() }) }));

const uploadJobFile = vi.fn();
vi.mock("@/lib/store/upload-job-file", async (orig) => ({
  ...(await orig<Record<string, unknown>>()),
  uploadJobFile: (...a: unknown[]) => uploadJobFile(...a),
}));

vi.mock("@/lib/store/app-store", () => ({
  useActiveModal: () => ({ id: "new-job", params: activeParams }),
  useCloseModal: () => closeMock,
  useOpenModal: () => openModalMock,
  usePushModal: () => pushModalMock,
  useLeads: () => storeLeads,
  useAppStore: (selector: (s: Record<string, unknown>) => unknown) =>
    selector({ addLead, updateLead, addJob, addVisit, updateJob, attachJobFile, adoptLead, leads: storeLeads, checklists: storeChecklists }),
}));

// ---- the two exits ---------------------------------------------------------
// There is NO Type chip: which foot button runs IS the kind. "Create job" makes the
// unpriced record (kind estimate); "Create & price it →" makes booked work (svc service)
// and lands in the price builder.
const createPlain = () => fireEvent.click(screen.getByRole("button", { name: "Create job" }));
const createPriced = () =>
  fireEvent.click(screen.getByRole("button", { name: "Create & price it →" }));

const titleInput = () => screen.getByPlaceholderText("e.g. water heater repair");

describe("NewJobModalContent — the unpriced exit (Create job)", () => {
  beforeEach(() => {
    addLead.mockReset();
    updateLead.mockReset();
    addJob.mockReset();
    addVisit.mockReset();
    closeMock = vi.fn();
    storeLeads = [];
    activeParams = {};
  });

  it("awaits the persisted lead, then creates a real estimate-kind JOB on the SERVER id", async () => {
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
    fireEvent.change(titleInput(), { target: { value: "water heater" } });
    createPlain();

    // Submit resolves the typed customer against the server first, so the chain is async now.
    await waitFor(() => expect(addLead).toHaveBeenCalledOnce());
    // The job must attach to the reconciled server lead id, not the optimistic one.
    await waitFor(() => {
      expect(addJob).toHaveBeenCalledOnce();
    });
    const [jobDraft] = addJob.mock.calls[0] as [{ leadId: string; kind: string; svc: string }];
    expect(jobDraft.leadId).toBe("srv-1");
    // The kind DERIVES from the exit: no price yet → estimate. svc stays the trade label.
    expect(jobDraft.kind).toBe("estimate");
    expect(jobDraft.svc).not.toBe("estimate");
    // The unplaced visit rides the persisted job, at the unpriced default length.
    await waitFor(() => {
      expect(addVisit).toHaveBeenCalledWith("job-1", 0.5);
    });
  });

  it("shows an error and keeps the modal open when persisted rejects (network failure)", async () => {
    // addLead returns a persisted promise that rejects (e.g. server/network error).
    addLead.mockReturnValue({
      lead: { id: "optimistic-2", name: "New customer" },
      persisted: Promise.reject(new Error("network error")),
    });

    render(<NewJobModalContent />);
    fireEvent.change(titleInput(), { target: { value: "boiler install" } });
    createPlain();

    // The error message must appear in the modal.
    await waitFor(() => {
      expect(screen.getByText(/couldn't save the customer/i)).toBeTruthy();
    });

    // The modal must NOT have been closed — data is preserved.
    expect(closeMock).not.toHaveBeenCalled();

    // No job may be created when the lead never persisted.
    expect(addJob).not.toHaveBeenCalled();
  });
});

/**
 * The Job-notes field must not touch the CUSTOMER's notes.
 *
 * The create used to fold `notes` into the lead patch. That write was doubly wrong:
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

  const fillWithNotes = () => {
    fireEvent.change(titleInput(), { target: { value: "water heater" } });
    fireEvent.change(screen.getByPlaceholderText("search or add"), { target: { value: "Cole Hayes" } });
    fireEvent.blur(screen.getByPlaceholderText("search or add"));
    // The notes field lives behind its own row — named for the record it writes.
    fireEvent.click(screen.getByText("Job notes"));
    fireEvent.change(screen.getByPlaceholderText("gate code, what to bring…"), {
      target: { value: "Attic access is through the closet" },
    });
    createPlain();
  };

  it("never patches lead.notes", async () => {
    addJob.mockReturnValue({
      job: { id: "job-est", origin: "manual", visits: [] },
      persisted: Promise.resolve({ id: "job-est", origin: "db", visits: [] }),
    });

    render(<NewJobModalContent />);
    fillWithNotes();

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
    fillWithNotes();

    await waitFor(() => expect(addJob).toHaveBeenCalledOnce());
    expect(addJob).toHaveBeenCalledWith(
      expect.objectContaining({ notes: "Attic access is through the closet" }),
    );
  });
});

describe("NewJobModalContent — the priced exit (Create & price it)", () => {
  beforeEach(() => {
    addLead.mockReset();
    updateLead.mockReset();
    addJob.mockReset();
    addVisit.mockReset();
    openModalMock.mockReset();
    routerPush.mockReset();
    closeMock = vi.fn();
    storeLeads = [];
  });

  it("opens the price builder on the client-authored id BEFORE the create settles", async () => {
    // Existing customer matched locally — the common case, and the one with zero
    // required round trips between the tap and the sheet.
    storeLeads = [{ id: "lead-fast", name: "Bob Smith", phone: "9255550100", archived: false }];
    let resolveJob!: (j: unknown) => void;
    addJob.mockReturnValue({
      job: { id: "job-fast", origin: "manual", visits: [] },
      persisted: new Promise((res) => { resolveJob = res; }),
    });

    render(<NewJobModalContent />);
    fireEvent.change(titleInput(), { target: { value: "fix boiler" } });
    fireEvent.change(screen.getByPlaceholderText("search or add"), { target: { value: "Bob Smith" } });
    fireEvent.blur(screen.getByPlaceholderText("search or add"));
    createPriced();

    // The builder opens while the job create is STILL IN FLIGHT — the client-authored id
    // is exactly what makes the optimistic hand-off possible.
    await waitFor(() =>
      expect(openModalMock).toHaveBeenCalledWith(MODAL.PRICE_BUILDER, { jobId: "job-fast" }),
    );
    expect(closeMock).toHaveBeenCalled();
    expect(routerPush).toHaveBeenCalledWith(expect.stringContaining("place=job-fast"));

    // Visits still wait for the create — addVisit is store-only before origin flips to db.
    expect(addVisit).not.toHaveBeenCalled();
    resolveJob({ id: "job-fast", origin: "db", visits: [] });
    await waitFor(() => expect(addVisit).toHaveBeenCalledWith("job-fast", 1.5));
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
    fireEvent.change(titleInput(), { target: { value: "fix boiler" } });
    fireEvent.change(screen.getByPlaceholderText("search or add"), {
      target: { value: "Maria Garcia" },
    });
    createPriced();

    // addLead must be called to create the new customer (after the async server resolution).
    await waitFor(() => expect(addLead).toHaveBeenCalledOnce());

    // Wait for the full async create to complete.
    await waitFor(() => {
      expect(addJob).toHaveBeenCalledOnce();
    });
    // addJob must receive the server-assigned lead id, not the optimistic one.
    expect(addJob).toHaveBeenCalledWith(
      expect.objectContaining({ leadId: "srv-lead-10" }),
    );
    /**
     * BOTH EXITS CREATE THE SAME JOB. The priced exit used to commit `svc: "service"` here —
     * typing the job as booked work BEFORE any price existed — which contradicted the one-job-type
     * model the price builder documents: "an unpriced job's kind flips estimate -> work on save …
     * this save IS the fork."
     *
     * Forking at create meant bailing out of the builder with "Price later" left a job typed as a
     * priced service call that was never priced (`kind=work svc=service lines=0` on production).
     * The technician's Quote tab then routed to the editable builder instead of the
     * "Quote it now / Send scope to the office" chooser, with no way back to it.
     *
     * The button now only decides WHERE THE USER LANDS NEXT, never what the job is.
     */
    const [jobDraft] = addJob.mock.calls[0] as [{ svc: string; kind?: string }];
    expect(jobDraft.kind).toBe("estimate");
    expect(jobDraft.svc).toBe("");
  });

  it("leaves an unpriced job in the SAME shape as the plain exit, so Price later is not a trap", async () => {
    // The whole point: whichever button was pressed, a job with no price is an unpriced job.
    const persistedLead = { id: "srv-lead-same", name: "Same Shape" };
    addLead.mockReturnValue({ lead: persistedLead, persisted: Promise.resolve(persistedLead) });
    addJob.mockReturnValue({ job: { id: "job-same", origin: "manual", visits: [] }, persisted: Promise.resolve({ id: "job-same" }) });
    render(<NewJobModalContent />);
    fireEvent.change(titleInput(), { target: { value: "Same shape" } });
    fireEvent.change(screen.getByPlaceholderText("search or add"), { target: { value: "Same Shape" } });
    fireEvent.click(screen.getByRole("button", { name: /Create & price it/ }));
    await waitFor(() => expect(addJob).toHaveBeenCalled());
    const [draft] = addJob.mock.calls[0] as [{ svc: string; kind?: string }];
    expect({ kind: draft.kind, svc: draft.svc }).toEqual({ kind: "estimate", svc: "" });
  });

  it("retunes a still-untouched default visit to the priced length", async () => {
    const persistedLead = { id: "lead-len", name: "Len Customer" };
    addLead.mockReturnValue({ lead: persistedLead, persisted: Promise.resolve(persistedLead) });
    addJob.mockReturnValue({
      job: { id: "job-len", origin: "manual", visits: [] },
      persisted: Promise.resolve({ id: "job-len", origin: "db", visits: [] }),
    });

    render(<NewJobModalContent />);
    fireEvent.change(titleInput(), { target: { value: "install faucet" } });
    // The form shows the unpriced default (0.5h); the user never touches it.
    createPriced();

    await waitFor(() => {
      expect(addVisit).toHaveBeenCalledWith("job-len", 1.5);
    });
  });

  it("keeps an EDITED visit length — the user's number is never retuned", async () => {
    const persistedLead = { id: "lead-edit", name: "Edit Customer" };
    addLead.mockReturnValue({ lead: persistedLead, persisted: Promise.resolve(persistedLead) });
    addJob.mockReturnValue({
      job: { id: "job-edit", origin: "manual", visits: [] },
      persisted: Promise.resolve({ id: "job-edit", origin: "db", visits: [] }),
    });

    render(<NewJobModalContent />);
    fireEvent.change(titleInput(), { target: { value: "install faucet" } });
    // Open the Visits row and set a custom length.
    fireEvent.click(screen.getByText("Visits"));
    fireEvent.change(screen.getByDisplayValue("0.5"), { target: { value: "3" } });
    createPriced();

    await waitFor(() => {
      expect(addVisit).toHaveBeenCalledWith("job-edit", 3);
    });
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
    fireEvent.change(titleInput(), { target: { value: "install faucet" } });
    createPriced();

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

  it("a rejected create mints no visits — the builder's not-loaded notice is the failure surface", async () => {
    // The priced exit is OPTIMISTIC: the modal has already closed and the builder is open on
    // the client-authored id when the create comes back refused. The slice rolls the job back
    // (the builder then renders its not-loaded notice — see price-builder-modal.test.tsx);
    // this test pins the modal side: no visits on a job that never persisted.
    addLead.mockReturnValue({
      lead: { id: "lead-fail-30", name: "Fail User" },
      persisted: Promise.resolve({ id: "lead-fail-30", name: "Fail User" }),
    });
    let rejectJob!: (e: Error) => void;
    addJob.mockReturnValue({
      job: { id: "job-fail-30", origin: "manual", visits: [] },
      persisted: new Promise((_res, rej) => { rejectJob = rej; }),
    });

    render(<NewJobModalContent />);
    fireEvent.change(titleInput(), { target: { value: "repair sink" } });
    createPriced();

    await waitFor(() =>
      expect(openModalMock).toHaveBeenCalledWith(MODAL.PRICE_BUILDER, { jobId: "job-fail-30" }),
    );
    expect(closeMock).toHaveBeenCalled();

    rejectJob(new Error("db error"));
    // Flush the rejection — visits must never ride a job that failed to persist.
    await waitFor(() => expect(addVisit).not.toHaveBeenCalled());
  });
});

describe("NewJobModalContent — the plain exit keeps its awaited failure surface", () => {
  beforeEach(() => {
    addLead.mockReset();
    addJob.mockReset();
    addVisit.mockReset();
    openModalMock.mockReset();
    closeMock = vi.fn();
    storeLeads = [];
  });

  it("surfaces an error and keeps the modal open when addJob persisted rejects", async () => {
    // The plain exit lands on the board, which has nowhere to say "the job didn't save" —
    // so it still awaits the create and names the failure HERE.
    addLead.mockReturnValue({
      lead: { id: "lead-fail-31", name: "Fail User" },
      persisted: Promise.resolve({ id: "lead-fail-31", name: "Fail User" }),
    });
    addJob.mockReturnValue({
      job: { id: "job-fail-31", origin: "manual", visits: [] },
      persisted: Promise.reject(new Error("db error")),
    });

    render(<NewJobModalContent />);
    fireEvent.change(titleInput(), { target: { value: "repair sink" } });
    createPlain();

    await waitFor(() => {
      expect(screen.getByText(/the customer was saved, but the job wasn't/i)).toBeTruthy();
    });
    expect(closeMock).not.toHaveBeenCalled();
    expect(addVisit).not.toHaveBeenCalled();
  });
});

describe("NewJobModalContent — phone validation", () => {
  beforeEach(() => {
    addLead.mockReset();
    addJob.mockReset();
    closeMock = vi.fn();
    storeLeads = [];
  });

  it("blocks submit inline on an invalid 8-digit phone — no network call at all", () => {
    render(<NewJobModalContent />);
    fireEvent.change(titleInput(), { target: { value: "water heater repair" } });
    fireEvent.change(screen.getByPlaceholderText("(925) 555-0123"), {
      target: { value: "78138501" },
    });
    createPlain();

    expect(screen.getByText(/that phone number isn't valid/i)).toBeTruthy();
    // Neither addLead nor addJob should ever fire — the server never sees this.
    expect(addLead).not.toHaveBeenCalled();
    expect(addJob).not.toHaveBeenCalled();
  });

  it("clears the inline phone error as soon as the field is edited", () => {
    render(<NewJobModalContent />);
    fireEvent.change(titleInput(), { target: { value: "water heater repair" } });
    const phoneInput = screen.getByPlaceholderText("(925) 555-0123");
    fireEvent.change(phoneInput, { target: { value: "78138501" } });
    createPlain();
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
    fireEvent.change(titleInput(), { target: { value: "water heater repair" } });
    createPlain();
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
    fireEvent.change(titleInput(), { target: { value: "water heater repair" } });
    createPlain();

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
    fireEvent.change(titleInput(), { target: { value: "water heater repair" } });
    createPlain();

    await waitFor(() => {
      expect(screen.getByText(/check your connection/i)).toBeTruthy();
    });
  });
});

describe("NewJobModalContent — checklist wiring", () => {
  beforeEach(() => {
    addLead.mockReset();
    addJob.mockReset();
    addVisit.mockReset();
    updateJob.mockReset();
    // updateJob resolves { ok } (jobs-slice contract) — default to success.
    updateJob.mockResolvedValue({ ok: true });
    storeChecklists = [];
    storeLeads = [];
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
    fireEvent.change(titleInput(), { target: { value: "swap water heater" } });
    // Expand the picker and pick the saved checklist row.
    fireEvent.click(screen.getByText("No checklist"));
    fireEvent.click(screen.getByText("Water heater close-out"));
    createPriced();

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

  /**
   * FROM-SCRATCH LISTS ARE NAMED, and their steps say what they are.
   *
   * This screen used to have its own builder — one text box and "Add item" — which named every
   * list it produced the literal string "Checklist" and decided a step was a photo by testing the
   * TEXT against /photo|picture/i. "Photo of the repair" became a photo by luck of wording;
   * "Snap the panel label" did not. It now uses the same ChecklistStepsEditor as the Checklists
   * library and the job sheet, so a name is asked for and the type is chosen.
   */
  const buildFromScratch = (name: string, steps: { text: string; photo?: boolean }[]) => {
    fireEvent.click(screen.getByText("No checklist"));
    fireEvent.click(screen.getByText("Build from scratch"));
    fireEvent.change(screen.getByLabelText("Checklist name"), { target: { value: name } });
    steps.forEach((step, i) => {
      // The builder seeds one empty step; every step after the first needs its own row.
      if (i > 0) fireEvent.click(screen.getByText("+ Add step"));
      fireEvent.change(screen.getByLabelText(`Step ${i + 1} description`), {
        target: { value: step.text },
      });
      if (step.photo) {
        const row = screen.getByLabelText(`Step ${i + 1} description`).closest(".clstep")!;
        fireEvent.click(within(row as HTMLElement).getByText("Photo"));
      }
    });
  };

  it("builds a NAMED custom checklist, with the step type chosen rather than guessed", async () => {
    const persistedLead = { id: "lead-41", name: "Custom Customer" };
    addLead.mockReturnValue({ lead: persistedLead, persisted: Promise.resolve(persistedLead) });
    addJob.mockReturnValue({
      job: { id: "job-41", origin: "manual", visits: [] },
      persisted: Promise.resolve({ id: "job-41", origin: "db", visits: [] }),
    });

    render(<NewJobModalContent />);
    fireEvent.change(titleInput(), { target: { value: "fix leak" } });
    // Deliberately a step whose TEXT says nothing about photos — the old regex would have made
    // this a plain check no matter what the user chose.
    buildFromScratch("Water heater swap", [{ text: "Snap the panel label", photo: true }]);
    createPriced();

    await waitFor(() => expect(updateJob).toHaveBeenCalledOnce());
    const [, patch] = updateJob.mock.calls[0] as [
      string,
      { checklist: { name: string; items: { text: string; type: string; required: boolean }[] } },
    ];
    expect(patch.checklist.name).toBe("Water heater swap");
    expect(patch.checklist.items).toEqual([
      expect.objectContaining({ text: "Snap the panel label", type: "photo", required: true }),
    ]);
  });

  it("keeps the steps in the order they were typed", async () => {
    const persistedLead = { id: "lead-42", name: "Ordered Customer" };
    addLead.mockReturnValue({ lead: persistedLead, persisted: Promise.resolve(persistedLead) });
    addJob.mockReturnValue({
      job: { id: "job-42", origin: "manual", visits: [] },
      persisted: Promise.resolve({ id: "job-42", origin: "db", visits: [] }),
    });

    render(<NewJobModalContent />);
    fireEvent.change(titleInput(), { target: { value: "fix leak" } });
    buildFromScratch("Two steps", [{ text: "Shut the water off" }, { text: "Drain the tank" }]);
    createPriced();

    await waitFor(() => expect(updateJob).toHaveBeenCalledOnce());
    const [, patch] = updateJob.mock.calls[0] as [string, { checklist: { items: { text: string; position: number }[] } }];
    expect(patch.checklist.items.map((i) => i.text)).toEqual(["Shut the water off", "Drain the tank"]);
    expect(patch.checklist.items.map((i) => i.position)).toEqual([0, 1]);
  });

  /** An abandoned empty step is the normal end state of typing a list — it must not be saved. */
  it("drops blank steps instead of saving empty rows", async () => {
    const persistedLead = { id: "lead-43", name: "Blank Customer" };
    addLead.mockReturnValue({ lead: persistedLead, persisted: Promise.resolve(persistedLead) });
    addJob.mockReturnValue({
      job: { id: "job-43", origin: "manual", visits: [] },
      persisted: Promise.resolve({ id: "job-43", origin: "db", visits: [] }),
    });

    render(<NewJobModalContent />);
    fireEvent.change(titleInput(), { target: { value: "fix leak" } });
    buildFromScratch("One real step", [{ text: "Bleed the line" }]);
    fireEvent.click(screen.getByText("+ Add step"));   // left empty
    createPriced();

    await waitFor(() => expect(updateJob).toHaveBeenCalledOnce());
    const [, patch] = updateJob.mock.calls[0] as [string, { checklist: { items: unknown[] } }];
    expect(patch.checklist.items).toHaveLength(1);
  });

  /**
   * Attaching it unnamed is how every custom list came to be called "Checklist"; dropping it
   * silently would throw away typing the crew will go looking for on the job. So it refuses and
   * says which field.
   */
  it("refuses to create with steps typed but no checklist name", async () => {
    render(<NewJobModalContent />);
    fireEvent.change(titleInput(), { target: { value: "fix leak" } });
    buildFromScratch("", [{ text: "Bleed the line" }]);
    createPriced();

    expect(await screen.findByText("Name the checklist.")).toBeTruthy();
    expect(addJob).not.toHaveBeenCalled();
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
    fireEvent.change(titleInput(), { target: { value: "clear main line" } });
    fireEvent.click(screen.getByText("No checklist"));
    fireEvent.click(screen.getByText("Drain close-out"));
    createPriced();

    // Failure surfaced, no silent close — the job exists but its checklist doesn't.
    await waitFor(() =>
      expect(screen.getByText(/job was saved, but the checklist wasn't/i)).toBeTruthy(),
    );
    expect(closeMock).not.toHaveBeenCalled();

    // Retry: re-attaches to job-50 — no duplicate job, no duplicate visits. (Wait for the
    // in-flight state to settle first — the button reads "Creating…" until finally runs.)
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Create & price it →" })).toBeTruthy(),
    );
    createPriced();
    await waitFor(() => expect(closeMock).toHaveBeenCalled());
    expect(addJob).toHaveBeenCalledTimes(1);
    expect(updateJob).toHaveBeenCalledTimes(2);
    expect(updateJob).toHaveBeenLastCalledWith("job-50", expect.objectContaining({
      checklist: expect.objectContaining({ name: "Drain close-out" }),
    }));
  });

  it("offers every saved checklist in one flat list, and none attaches without a pick", async () => {
    // There is one kind of checklist now. The picker used to split into "Scoping" and "Before you
    // leave" groups, but the stage never survived attachment — a job stores {name, items} with no
    // stage — so the split labelled a difference the product never acted on.
    storeChecklists = [
      { id: "chk-j", name: "Drain close-out", trade: "Custom", stage: "job", match: [],
        items: [{ id: "j1", text: "Water back on", type: "check", required: true, position: 0 }] },
      // Deliberately a LEGACY scope row: with one of each, the old code rendered group headers.
      { id: "chk-s", name: "Repipe walkthrough", trade: "Custom", stage: "scope", match: [],
        items: [{ id: "s1", text: "Measure the run", type: "check", required: true, position: 0 }] },
    ];
    const persistedLead = { id: "lead-42", name: "Plain Customer" };
    addLead.mockReturnValue({ lead: persistedLead, persisted: Promise.resolve(persistedLead) });
    addJob.mockReturnValue({
      job: { id: "job-42", origin: "manual", visits: [] },
      persisted: Promise.resolve({ id: "job-42", origin: "db", visits: [] }),
    });

    render(<NewJobModalContent />);
    fireEvent.click(screen.getByText("Checklist"));
    expect(screen.getByText("Repipe walkthrough")).toBeTruthy();
    expect(screen.getByText("Drain close-out")).toBeTruthy();
    // No group headers — there are no groups.
    expect(screen.queryByText("Scoping")).toBeNull();
    expect(screen.queryByText("Before you leave")).toBeNull();

    // Create WITHOUT picking → no checklist attach.
    fireEvent.change(titleInput(), { target: { value: "plain estimate" } });
    createPlain();
    await waitFor(() => expect(addVisit).toHaveBeenCalled());
    expect(updateJob).not.toHaveBeenCalled();
  });

  it("still offers a checklist left on the retired scope stage", () => {
    // Nothing can create one any more, but a shop that made one before the stages were collapsed
    // must not find it silently missing from the picker.
    storeChecklists = [
      { id: "chk-s", name: "Repipe walkthrough", trade: "Custom", stage: "scope", match: [],
        items: [{ id: "s1", text: "Measure the run", type: "check", required: true, position: 0 }] },
    ];
    render(<NewJobModalContent />);
    fireEvent.click(screen.getByText("Checklist"));
    expect(screen.getByText("Repipe walkthrough")).toBeTruthy();
  });

  it("an unpriced job with a picked scoping checklist attaches it to the created job", async () => {
    storeChecklists = [
      { id: "chk-j", name: "Drain close-out", trade: "Custom", stage: "job", match: [],
        items: [{ id: "j1", text: "Water back on", type: "check", required: true, position: 0 }] },
      { id: "chk-s", name: "Repipe walkthrough", trade: "Custom", stage: "job", match: [],
        items: [{ id: "s1", text: "Measure the run", type: "check", required: true, position: 0 }] },
    ];
    const persistedLead = { id: "lead-43", name: "Scoped Customer" };
    addLead.mockReturnValue({ lead: persistedLead, persisted: Promise.resolve(persistedLead) });
    addJob.mockReturnValue({
      job: { id: "job-43", origin: "manual", visits: [] },
      persisted: Promise.resolve({ id: "job-43", origin: "db", visits: [] }),
    });
    updateJob.mockResolvedValue({ ok: true });

    render(<NewJobModalContent />);
    fireEvent.click(screen.getByText("Checklist"));
    fireEvent.click(screen.getByText("Repipe walkthrough"));
    fireEvent.change(titleInput(), { target: { value: "scoped estimate" } });
    createPlain();

    await waitFor(() =>
      expect(updateJob).toHaveBeenCalledWith("job-43", expect.objectContaining({
        checklist: expect.objectContaining({ name: "Repipe walkthrough" }),
      })),
    );
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
    storeLeads = [];
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
    fireEvent.change(titleInput(), { target: { value: "fix boiler" } });
    fireEvent.change(screen.getByPlaceholderText("search or add"), {
      target: { value: "Maria Garcia" },
    });
  };

  it("ignores further presses while the first is still in flight", async () => {
    const release = armSlowChain();
    render(<NewJobModalContent />);
    fillForm();

    // Grab the element once — after the first press its label reads "Creating…".
    const pri = screen.getByRole("button", { name: "Create & price it →" });
    fireEvent.click(pri);
    fireEvent.click(pri);
    fireEvent.click(pri);

    // The customer is the first step of the chain and the one the server cannot de-duplicate.
    // The chain opens with an async server resolution now, so the first call lands a tick later —
    // the guard's job is that three presses still produce exactly ONE.
    await waitFor(() => expect(addLead).toHaveBeenCalledOnce());

    release();
    await waitFor(() => expect(addJob).toHaveBeenCalledOnce());
    expect(addVisit).toHaveBeenCalledOnce();
  });

  it("says it is working, and refuses every foot button while it is", async () => {
    armSlowChain();
    render(<NewJobModalContent />);
    fillForm();
    createPriced();

    // The label is the feedback the missing round-trip time never gave — on the pressed
    // button; its sibling create and Cancel just disable.
    const submit = screen.getByText("Creating…");
    expect(submit.hasAttribute("disabled")).toBe(true);
    expect(screen.getByText("Create job").hasAttribute("disabled")).toBe(true);
    expect(screen.getByText("Cancel").hasAttribute("disabled")).toBe(true);
  });

  it("guards a press of the OTHER exit while the first is in flight", async () => {
    armSlowChain();
    render(<NewJobModalContent />);
    fillForm();

    createPriced();
    createPlain();

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
    fireEvent.change(titleInput(), { target: { value: "fix disposal" } });
    fireEvent.change(custInput(), { target: { value: "ann" } });
    fireEvent.mouseDown(screen.getByRole("option"));
    createPriced();

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
    fireEvent.change(titleInput(), { target: { value: "new build rough-in" } });
    fireEvent.change(custInput(), { target: { value: "Brand New Person" } });
    // No match → no list, and the typed name is what gets created.
    expect(screen.queryByRole("listbox")).toBeNull();
    createPriced();

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
 * The foot and where each exit lands, pinned. There is no Type chip anywhere in this form:
 * the fork lives in the foot, and the kind derives from which button ran.
 */
describe("NewJobModalContent — the two exits", () => {
  beforeEach(() => {
    addLead.mockReset(); addJob.mockReset(); addVisit.mockReset();
    openModalMock.mockReset(); pushModalMock.mockReset(); routerPush.mockReset();
    closeMock = vi.fn();
    storeLeads = [];
    addLead.mockReturnValue({
      lead: { id: "opt-lead-1", name: "Maria Garcia" },
      persisted: Promise.resolve({ id: "srv-lead-1", name: "Maria Garcia" }),
    });
    addJob.mockReturnValue({
      job: { id: "job-opt-1", origin: "manual", visits: [] },
      persisted: Promise.resolve({ id: "job-opt-1", origin: "db", visits: [] }),
    });
  });

  it("the form has no Type chips and no submit control — the foot holds the fork", () => {
    render(<NewJobModalContent />);
    // No Estimate/Flat-rate chips anywhere.
    expect(screen.queryByText("Flat rate")).toBeNull();
    expect(screen.queryByText("Estimate")).toBeNull();
    // ENTER SAVED THE JOB MID-THOUGHT once. Implicit submission needs a default button
    // (HTML spec), so the guarantee is structural: NO type="submit" control exists — every
    // foot button is type="button".
    const form = screen.getByRole("button", { name: "Create job" }).closest("form")!;
    expect(form.querySelector('button[type="submit"], input[type="submit"]')).toBeNull();
    for (const name of ["Cancel", "Create job", "Create & price it →"]) {
      expect((screen.getByRole("button", { name }) as HTMLButtonElement).type).toBe("button");
    }
  });

  // Owen, testing: "when I create the flat rate job it brings me to the job modal, it should be
  // bringing me to the scheduling page so I can drag and drop it". This form has no date picker,
  // so every job it makes has UNPLACED visits — the record sheet is a dead end and the board is
  // the actual next step.
  it("Create & price it lands on the schedule board with the new job armed, and asks for the price there", async () => {
    render(<NewJobModalContent />);
    fireEvent.change(titleInput(), { target: { value: "fix boiler" } });
    fireEvent.change(screen.getByPlaceholderText("search or add"), { target: { value: "Maria Garcia" } });
    createPriced();

    await waitFor(() => expect(routerPush).toHaveBeenCalledWith("/jobs?tab=schedule&place=job-opt-1"));
    // A ROOT open, not a drill-in: closing the builder reveals the BOARD, not a job sheet.
    expect(openModalMock).toHaveBeenCalledWith("price-builder", { jobId: "job-opt-1" });
    expect(pushModalMock).not.toHaveBeenCalled();
    expect(openModalMock).not.toHaveBeenCalledWith("job", expect.anything());
  });

  it("Create job navigates to the board too, and skips the builder — it has no price yet", async () => {
    render(<NewJobModalContent />);
    fireEvent.change(titleInput(), { target: { value: "quote a repipe" } });
    fireEvent.change(screen.getByPlaceholderText("search or add"), { target: { value: "Maria Garcia" } });
    createPlain();

    await waitFor(() => expect(closeMock).toHaveBeenCalled());
    expect(routerPush).toHaveBeenCalledWith("/jobs?tab=schedule&place=job-opt-1");
    expect(openModalMock).not.toHaveBeenCalled();
    expect(pushModalMock).not.toHaveBeenCalled();
  });

  it("the PLAIN exit navigates nowhere when the create failed — the form stays put with its error", async () => {
    // The plain exit still awaits the create: the board it lands on has nowhere to say "the
    // job didn't save". (The priced exit is optimistic and its failure surface is the price
    // builder's not-loaded notice — pinned in the priced-exit describe above.)
    addJob.mockReturnValue({
      job: { id: "job-opt-1", origin: "manual", visits: [] },
      persisted: Promise.reject(new Error("network error")),
    });
    render(<NewJobModalContent />);
    fireEvent.change(titleInput(), { target: { value: "fix boiler" } });
    fireEvent.change(screen.getByPlaceholderText("search or add"), { target: { value: "Maria Garcia" } });
    createPlain();

    await waitFor(() => expect(screen.getByText(/the customer was saved, but the job wasn't/i)).toBeTruthy());
    expect(routerPush).not.toHaveBeenCalled();
    expect(closeMock).not.toHaveBeenCalled();
  });
});

describe("NewJobModalContent — opened from a customer", () => {
  beforeEach(() => {
    storeLeads = [];
    storeChecklists = [];
    activeParams = {};
  });

  it("prefills the customer, phone and address from the leadId it was opened with", () => {
    // The customer sheet's "Create a job" opens this modal. Landing on a blank customer field
    // when you were standing in ZZ Bob Tester's sheet means retyping a name the app already knows,
    // and picking the wrong one attaches the job to a different customer.
    storeLeads = [
      { id: "lead-9", name: "ZZ Bob Tester", phone: "7818328282", address: "12 Elm St", archived: false },
    ];
    activeParams = { leadId: "lead-9" };

    render(<NewJobModalContent />);

    expect((screen.getByPlaceholderText("search or add") as HTMLInputElement).value).toBe("ZZ Bob Tester");
  });

  it("opens blank when there is no leadId", () => {
    storeLeads = [{ id: "lead-9", name: "ZZ Bob Tester", phone: "7818328282", archived: false }];
    activeParams = {};

    render(<NewJobModalContent />);

    expect((screen.getByPlaceholderText("search or add") as HTMLInputElement).value).toBe("");
  });

  it("opens blank when the leadId is not in the book", () => {
    storeLeads = [];
    activeParams = { leadId: "lead-missing" };

    render(<NewJobModalContent />);

    expect((screen.getByPlaceholderText("search or add") as HTMLInputElement).value).toBe("");
  });
});

/**
 * A JOB NOTE MAY CARRY A FILE — the permit, the spec sheet — but the upload URL is scoped to a job
 * id that does not exist until this form is submitted. So the file is staged and uploaded once the
 * job is persisted, which also means a staged file rules out the optimistic priced hand-off for
 * exactly the reason a checklist does.
 */
describe("attaching a file to the job notes", () => {
  const fakeFile = (name: string) => new File(["x"], name, { type: "application/pdf" });

  const pickFile = (file: File) => {
    const input = document.querySelector('input[type="file"]') as HTMLInputElement;
    Object.defineProperty(input, "files", { value: [file], configurable: true });
    fireEvent.change(input);
  };

  const openNotes = () => fireEvent.click(screen.getByText("Job notes"));

  beforeEach(() => {
    // Every shared spy, not just the new ones: closeMock and addJob accumulate across this file,
    // so a leaked call from an earlier test reads as this test's own behaviour.
    addLead.mockReset();
    updateLead.mockReset();
    addJob.mockReset();
    addVisit.mockReset();
    updateJob.mockReset();
    attachJobFile.mockReset();
    uploadJobFile.mockReset();
    closeMock = vi.fn();
    storeLeads = [];
    storeChecklists = [];
    activeParams = {};
  });

  it("uploads against the created job id and hangs the file on it", async () => {
    addLead.mockReturnValue({ lead: { id: "lead-50" }, persisted: Promise.resolve({ id: "lead-50" }) });
    addJob.mockReturnValue({
      job: { id: "job-50", origin: "manual", visits: [] },
      persisted: Promise.resolve({ id: "job-50", origin: "db", visits: [] }),
    });
    uploadJobFile.mockResolvedValue({ id: "f1", storagePath: "p", name: "permit.pdf", mimeType: "application/pdf", caption: null });

    render(<NewJobModalContent />);
    fireEvent.change(titleInput(), { target: { value: "water heater" } });
    openNotes();
    pickFile(fakeFile("permit.pdf"));
    createPlain();

    await waitFor(() => expect(uploadJobFile).toHaveBeenCalledWith("job-50", expect.any(File)));
    await waitFor(() => expect(attachJobFile).toHaveBeenCalledWith("job-50", expect.objectContaining({ name: "permit.pdf" })));
  });

  /**
   * The job IS saved by the time the upload runs, so a swallowed failure closes the modal on an
   * office that believes its permit went with the job.
   */
  it("keeps the modal open with the reason when the job saved but the file did not", async () => {
    addLead.mockReturnValue({ lead: { id: "lead-51" }, persisted: Promise.resolve({ id: "lead-51" }) });
    addJob.mockReturnValue({
      job: { id: "job-51", origin: "manual", visits: [] },
      persisted: Promise.resolve({ id: "job-51", origin: "db", visits: [] }),
    });
    uploadJobFile.mockRejectedValue(new Error("network died"));

    render(<NewJobModalContent />);
    fireEvent.change(titleInput(), { target: { value: "water heater" } });
    openNotes();
    pickFile(fakeFile("permit.pdf"));
    createPlain();

    expect(await screen.findByText("The job was saved, but the file wasn't — try again.")).toBeTruthy();
    expect(closeMock).not.toHaveBeenCalled();
    expect(attachJobFile).not.toHaveBeenCalled();
  });

  /** No file staged: nothing about the existing paths changes. */
  it("uploads nothing when no file was picked", async () => {
    addLead.mockReturnValue({ lead: { id: "lead-52" }, persisted: Promise.resolve({ id: "lead-52" }) });
    addJob.mockReturnValue({
      job: { id: "job-52", origin: "manual", visits: [] },
      persisted: Promise.resolve({ id: "job-52", origin: "db", visits: [] }),
    });

    render(<NewJobModalContent />);
    fireEvent.change(titleInput(), { target: { value: "water heater" } });
    createPlain();

    await waitFor(() => expect(addJob).toHaveBeenCalledOnce());
    expect(uploadJobFile).not.toHaveBeenCalled();
    expect(attachJobFile).not.toHaveBeenCalled();
  });
});
