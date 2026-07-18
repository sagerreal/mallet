/**
 * lib/store/slices/leads-slice.test.ts
 * Unit tests for updateLead's payload-mapping logic.
 *
 * Covers:
 *   (a) A phone patch maps to { leadId, phone } and the mutation is called.
 *   (b) A local-only patch (e.g. { last }) does NOT call the mutation.
 *   (c) Empty string phone maps to null.
 *   (d) value dollars → valueCents (Math.round * 100).
 *
 * trpcVanilla is module-mocked so no network/Supabase session is needed.
 * vi.mock is hoisted by Vitest above all imports, so the module-under-test
 * sees the mock when it evaluates.
 */

// ---------------------------------------------------------------------------
// Module mocks (hoisted by Vitest before all imports)
// ---------------------------------------------------------------------------

import { describe, it, expect, vi, beforeEach } from "vitest";

// The mockMutate stub is captured in module scope so tests can call
// mockMutate.mock.calls / mockMutate.mockReset() etc.
const mockMutate = vi.fn();
const mockCreate = vi.fn();
const mockArchive = vi.fn();
const mockRestore = vi.fn();

vi.mock("@/lib/trpc/vanilla", () => ({
  trpcVanilla: {
    v1: {
      customers: {
        update: { mutate: (...args: unknown[]) => mockMutate(...args) },
        create: { mutate: (...args: unknown[]) => mockCreate(...args) },
        archive: { mutate: (...args: unknown[]) => mockArchive(...args) },
        restore: { mutate: (...args: unknown[]) => mockRestore(...args) },
      },
      tasks: {
        create: { mutate: vi.fn().mockResolvedValue({ id: "t1", text: "", dueDate: null, leadId: null, done: false }) },
        setDone: { mutate: vi.fn().mockResolvedValue({ id: "t1", text: "", dueDate: null, leadId: null, done: true }) },
        update: { mutate: vi.fn().mockResolvedValue({ id: "t1", text: "", dueDate: null, leadId: null, done: false }) },
        remove: { mutate: vi.fn().mockResolvedValue({ ok: true }) },
      },
    },
  },
}));

// Static imports — resolved AFTER the mock above is registered.
import { buildLeadUpdatePayload, createLeadsSlice } from "./leads-slice";
import type { LeadsSlice } from "./leads-slice";
import type { Lead } from "@/lib/store/types";

// ---------------------------------------------------------------------------
// Minimal Lead builder
// ---------------------------------------------------------------------------

function makeLead(overrides: Partial<Lead> = {}): Lead {
  return {
    id: "lead-111",
    name: "Ada Lovelace",
    phone: "+15550001234",
    source: "referral",
    stage: "New customer",
    age: 3,
    job: "",
    last: "Just added",
    unread: false,
    email: "ada@example.com",
    value: 250,
    companyId: undefined,
    role: undefined,
    acts: [],
    evisits: [],
    archived: false,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// buildLeadUpdatePayload — pure helper tests
// ---------------------------------------------------------------------------

describe("buildLeadUpdatePayload", () => {
  it("(a) maps a phone patch to { leadId, phone } and returns a payload", () => {
    const payload = buildLeadUpdatePayload("lead-111", { phone: "+15559998888" });
    expect(payload).not.toBeNull();
    expect(payload?.leadId).toBe("lead-111");
    expect(payload?.phone).toBe("+15559998888");
    // No other fields should be present.
    expect(payload?.name).toBeUndefined();
    expect(payload?.email).toBeUndefined();
    expect(payload?.valueCents).toBeUndefined();
  });

  it("(b) a local-only patch ({ last }) returns null — mutation must NOT be called", () => {
    const payload = buildLeadUpdatePayload("lead-111", { last: "Called back" });
    expect(payload).toBeNull();
  });

  it("(b) a patch of multiple local-only fields returns null", () => {
    const payload = buildLeadUpdatePayload("lead-111", {
      last: "some note",
      age: 5,
      job: "HVAC",
      book: true,
    });
    expect(payload).toBeNull();
  });

  it("(b2) address is now persisted — patch with only address returns a payload", () => {
    const payload = buildLeadUpdatePayload("lead-111", {
      address: "123 Main St",
    });
    expect(payload).not.toBeNull();
    expect(payload?.address).toBe("123 Main St");
  });

  it("(b3) empty string address maps to null", () => {
    const payload = buildLeadUpdatePayload("lead-111", { address: "" });
    expect(payload).not.toBeNull();
    expect(payload?.address).toBeNull();
  });

  it("(c) empty string phone maps to null", () => {
    const payload = buildLeadUpdatePayload("lead-111", { phone: "" });
    expect(payload).not.toBeNull();
    expect(payload?.phone).toBeNull();
  });

  it("(c) empty string email maps to null", () => {
    const payload = buildLeadUpdatePayload("lead-111", { email: "" });
    expect(payload).not.toBeNull();
    expect(payload?.email).toBeNull();
  });

  it("(d) value dollars → valueCents via Math.round", () => {
    const payload = buildLeadUpdatePayload("lead-111", { value: 12.345 });
    expect(payload).not.toBeNull();
    // 12.345 * 100 = 1234.5 → rounded to 1235
    expect(payload?.valueCents).toBe(1235);
  });

  it("(d) whole-dollar value converts exactly", () => {
    const payload = buildLeadUpdatePayload("lead-111", { value: 250 });
    expect(payload?.valueCents).toBe(25000);
  });

  it("mixed patch: persistable + local-only — only persistable fields are in the payload", () => {
    const payload = buildLeadUpdatePayload("lead-111", {
      name: "Charlie",
      last: "Updated name",   // local-only — must be excluded
      age: 10,                // local-only — must be excluded
    });
    expect(payload).not.toBeNull();
    expect(payload?.name).toBe("Charlie");
    // local-only keys must not bleed through
    const record = payload as unknown as Record<string, unknown>;
    expect(record?.last).toBeUndefined();
    expect(record?.age).toBeUndefined();
  });

  it("name patch round-trips correctly", () => {
    const payload = buildLeadUpdatePayload("lead-222", { name: "Babbage" });
    expect(payload?.leadId).toBe("lead-222");
    expect(payload?.name).toBe("Babbage");
  });

  it("source patch round-trips correctly", () => {
    const payload = buildLeadUpdatePayload("lead-111", { source: "Google Ads" });
    expect(payload?.source).toBe("Google Ads");
  });

  it("unread: false patch is included", () => {
    const payload = buildLeadUpdatePayload("lead-111", { unread: false });
    expect(payload).not.toBeNull();
    expect(payload?.unread).toBe(false);
  });

  it("companyId: undefined in patch maps to companyId: null in payload", () => {
    const payload = buildLeadUpdatePayload("lead-111", { companyId: undefined });
    // companyId key IS in the patch object → persisted field → included as null
    expect(payload).not.toBeNull();
    expect(payload?.companyId).toBeNull();
  });

  it("role patch is included", () => {
    const payload = buildLeadUpdatePayload("lead-111", { role: "Decision maker" });
    expect(payload?.role).toBe("Decision maker");
  });

  it("maps a display stage to the DB enum in the payload", () => {
    const payload = buildLeadUpdatePayload("lead-111", { stage: "Quote Sent" });
    expect(payload).not.toBeNull();
    expect(payload?.stage).toBe("quote_sent");
  });

  it("maps 'Lost' (sweep) to the DB enum", () => {
    const payload = buildLeadUpdatePayload("lead-111", { stage: "Lost" });
    expect(payload?.stage).toBe("lost");
  });

  it("passes an already-enum stage through unchanged", () => {
    const payload = buildLeadUpdatePayload("lead-111", { stage: "won" });
    expect(payload?.stage).toBe("won");
  });
});

// ---------------------------------------------------------------------------
// Minimal Zustand-like harness — drives the slice without a real store.
// ---------------------------------------------------------------------------

function makeSlice(): { readonly state: LeadsSlice; seedLeads: (leads: Lead[]) => void } {
  let state: LeadsSlice = {} as LeadsSlice;

  const set = (updater: ((s: LeadsSlice) => Partial<LeadsSlice>) | Partial<LeadsSlice>): void => {
    if (typeof updater === "function") {
      state = { ...state, ...updater(state) };
    } else {
      state = { ...state, ...updater };
    }
  };

  state = createLeadsSlice(set, () => state, {} as never);

  return {
    get state(): LeadsSlice { return state; },
    seedLeads(leads: Lead[]): void {
      state = { ...state, leads };
    },
  };
}

// ---------------------------------------------------------------------------
// updateLead integration — verify the mutation is called / skipped correctly.
// ---------------------------------------------------------------------------

describe("updateLead integration (with trpcVanilla mock)", () => {
  beforeEach(() => {
    mockMutate.mockReset();
    mockMutate.mockResolvedValue({
      id: "lead-111",
      name: "Ada Lovelace",
      phone: "+15550001234",
      email: "ada@example.com",
      source: "referral",
      stage: "new",
      value: { cents: 25000, currency: "USD" },
      unread: false,
      companyId: null,
      role: null,
      createdAt: new Date().toISOString(),
    });
  });

  it("(a) calls trpcVanilla for a phone patch and passes phone as the payload field", async () => {
    const slice = makeSlice();
    slice.seedLeads([makeLead()]);

    slice.state.updateLead("lead-111", { phone: "+15559998888" });

    expect(mockMutate).toHaveBeenCalledOnce();
    const call = mockMutate.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(call.leadId).toBe("lead-111");
    expect(call.phone).toBe("+15559998888");
  });

  it("(b) does NOT call trpcVanilla for a local-only patch ({ last })", () => {
    const slice = makeSlice();
    slice.seedLeads([makeLead()]);

    slice.state.updateLead("lead-111", { last: "Sent a text" });

    expect(mockMutate).not.toHaveBeenCalled();
  });

  it("(c) sends phone: null when phone is cleared (empty string)", () => {
    const slice = makeSlice();
    slice.seedLeads([makeLead()]);

    slice.state.updateLead("lead-111", { phone: "" });

    expect(mockMutate).toHaveBeenCalledOnce();
    const call = mockMutate.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(call.phone).toBeNull();
  });

  it("(d) maps value dollars to valueCents in the mutation payload", () => {
    const slice = makeSlice();
    slice.seedLeads([makeLead()]);

    slice.state.updateLead("lead-111", { value: 150 });

    expect(mockMutate).toHaveBeenCalledOnce();
    const call = mockMutate.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(call.valueCents).toBe(15000);
  });

  it("preserves local-only fields (acts, evisits, age, address) on DTO reconciliation", async () => {
    const slice = makeSlice();
    const lead = makeLead({
      acts: [{ type: "note", when: "today", t: "Called back" }],
      evisits: [{ id: "ev-1", date: "2026-07-10", techId: "t1", start: 9, dur: 2, status: "scheduled" }],
      age: 7,
      address: "456 Oak Ave",
    });
    slice.seedLeads([lead]);

    mockMutate.mockResolvedValue({
      id: "lead-111",
      name: "Ada Updated",
      phone: "+15550001234",
      email: "ada@example.com",
      source: "referral",
      stage: "new",
      value: { cents: 25000, currency: "USD" },
      unread: false,
      companyId: null,
      role: null,
      createdAt: new Date().toISOString(),
    });

    slice.state.updateLead("lead-111", { name: "Ada Updated" });

    // Wait for the resolved promise to propagate.
    await Promise.resolve();
    await Promise.resolve();

    const updated = slice.state.leads.find((l: Lead) => l.id === "lead-111");
    expect(updated?.name).toBe("Ada Updated");
    // Local-only fields must survive reconciliation.
    expect(updated?.acts).toHaveLength(1);
    expect(updated?.evisits).toHaveLength(1);
    expect(updated?.age).toBe(7);
    expect(updated?.address).toBe("456 Oak Ave");
  });

  it("rolls back on mutation error (field-level: only the patched field reverts)", async () => {
    const slice = makeSlice();
    slice.seedLeads([makeLead({ name: "Before" })]);
    mockMutate.mockRejectedValue(new Error("network error"));

    slice.state.updateLead("lead-111", { name: "After" });

    // Optimistic update applied immediately.
    expect(slice.state.leads.find((l: Lead) => l.id === "lead-111")?.name).toBe("After");

    // Wait for rejection to propagate.
    await Promise.resolve();
    await Promise.resolve(); // two ticks for .catch chain

    // Should have rolled back only the patched field.
    expect(slice.state.leads.find((l: Lead) => l.id === "lead-111")?.name).toBe("Before");
  });

});

// ---------------------------------------------------------------------------
// addTask — verify optimistic insertion and that create is called with the
// correct payload including dueDate.
// ---------------------------------------------------------------------------

describe("addTask (with trpcVanilla mock)", () => {
  // Grab the tasks.create mock so we can inspect calls.
  let createMutate: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    // Re-import the mock to get the live vi.fn reference after each reset.
    const { trpcVanilla } = await import("@/lib/trpc/vanilla");
    createMutate = trpcVanilla.v1.tasks.create.mutate as ReturnType<typeof vi.fn>;
    createMutate.mockReset();
    createMutate.mockResolvedValue({
      id: "task-uuid",
      text: "Follow up",
      dueDate: "2026-07-15",
      leadId: "lead-111",
      done: false,
    });
  });

  it("adds task optimistically and calls create with the supplied dueDate", async () => {
    const slice = makeSlice();

    slice.state.addTask({
      t: "Follow up",
      due: "2026-07-15",
      leadId: "lead-111",
    });

    // Optimistic insert — task is immediately visible in the store.
    expect(slice.state.tasks).toHaveLength(1);
    expect(slice.state.tasks[0]?.t).toBe("Follow up");
    expect(slice.state.tasks[0]?.due).toBe("2026-07-15");
    expect(slice.state.tasks[0]?.done).toBe(false);

    // Mutation was called with the correct shape.
    expect(createMutate).toHaveBeenCalledOnce();
    const call = createMutate.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(call.text).toBe("Follow up");
    expect(call.dueDate).toBe("2026-07-15");
    expect(call.leadId).toBe("lead-111");

    // Wait for reconciliation.
    await Promise.resolve();
    await Promise.resolve();

    // Task is still present (id reconciled from DTO).
    expect(slice.state.tasks).toHaveLength(1);
  });

  it("adds task with no due date — passes null to create", async () => {
    createMutate.mockResolvedValue({
      id: "task-uuid-2",
      text: "No date task",
      dueDate: null,
      leadId: "lead-111",
      done: false,
    });

    const slice = makeSlice();

    // Pass empty string (as the component does when the date input is blank).
    slice.state.addTask({
      t: "No date task",
      due: "",
      leadId: "lead-111",
    });

    expect(createMutate).toHaveBeenCalledOnce();
    const call = createMutate.mock.calls[0]?.[0] as Record<string, unknown>;
    // Empty string is coerced to null by the slice (draft.due || null).
    expect(call.dueDate).toBeNull();
  });

  it("rolls back the optimistic task on create failure", async () => {
    createMutate.mockRejectedValue(new Error("server error"));

    const slice = makeSlice();
    slice.state.addTask({ t: "Fail task", due: "2026-08-01", leadId: "lead-111" });

    // Optimistic insert visible before rejection.
    expect(slice.state.tasks).toHaveLength(1);

    await Promise.resolve();
    await Promise.resolve();

    // Rolled back — task gone.
    expect(slice.state.tasks).toHaveLength(0);
  });
});

describe("updateLead integration (with trpcVanilla mock) — continued", () => {
  beforeEach(() => {
    mockMutate.mockReset();
    mockMutate.mockResolvedValue({
      id: "lead-111",
      name: "Ada Lovelace",
      phone: "+15550001234",
      email: "ada@example.com",
      source: "referral",
      stage: "new",
      value: { cents: 25000, currency: "USD" },
      unread: false,
      companyId: null,
      role: null,
      createdAt: new Date().toISOString(),
    });
  });

  it("field-level rollback: concurrent edit to a different field survives a failed first mutation", async () => {
    // Setup: lead starts with name="A" and phone="+1111"
    const slice = makeSlice();
    slice.seedLeads([makeLead({ name: "A", phone: "+1111" })]);

    // First call (name patch) will reject; set up before calling so the rejection
    // is already registered when updateLead fires.
    let rejectFirst!: (err: Error) => void;
    const firstCallPromise = new Promise<never>((_, rej) => { rejectFirst = rej; });
    mockMutate.mockReturnValueOnce(firstCallPromise);

    // Second call (phone patch) resolves successfully.
    mockMutate.mockResolvedValueOnce({
      id: "lead-111",
      name: "A",
      phone: "+9999",
      email: "ada@example.com",
      source: "referral",
      stage: "New customer",
      value: { cents: 25000, currency: "USD" },
      unread: false,
      companyId: null,
      role: null,
    });

    // Fire both optimistic updates synchronously (simulates concurrent edits
    // while the first network call is in-flight).
    slice.state.updateLead("lead-111", { name: "B" });   // first: will fail
    slice.state.updateLead("lead-111", { phone: "+9999" }); // second: will succeed

    // Both optimistic writes are visible immediately.
    const afterOptimistic = slice.state.leads.find((l: Lead) => l.id === "lead-111");
    expect(afterOptimistic?.name).toBe("B");
    expect(afterOptimistic?.phone).toBe("+9999");

    // Now reject the first call, then let microtask queue drain.
    rejectFirst(new Error("network error"));
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();

    const afterRollback = slice.state.leads.find((l: Lead) => l.id === "lead-111");
    // name should revert to "A" (rolled back by the first call's failure).
    expect(afterRollback?.name).toBe("A");
    // phone should remain "+9999" — the second edit must NOT be clobbered.
    expect(afterRollback?.phone).toBe("+9999");
  });
});

// ---------------------------------------------------------------------------
// updateTask — optimistic update, correct v1.tasks.update args, rollback on error.
// ---------------------------------------------------------------------------

describe("addLead (with trpcVanilla mock)", () => {
  beforeEach(() => {
    mockCreate.mockReset();
    mockCreate.mockResolvedValue({
      id: "srv-lead-999",
      name: "Ada Lovelace",
      phone: "+15550001234",
      email: null,
      source: "Added manually",
      stage: "new",
      value: { cents: 0, currency: "USD" },
      unread: false,
      companyId: null,
      role: null,
      createdAt: new Date().toISOString(),
      created: true,
    });
  });

  it("prepends optimistically and calls create with name/phone/source", () => {
    const slice = makeSlice();
    const { lead } = slice.state.addLead({
      name: "Ada Lovelace",
      phone: "+15550001234",
      source: "Added manually",
      stage: "New customer",
      job: "",
    });
    // Optimistic insert visible immediately with a client UUID.
    expect(slice.state.leads).toHaveLength(1);
    expect(slice.state.leads[0]?.name).toBe("Ada Lovelace");
    expect(lead.id).toBe(slice.state.leads[0]?.id);
    // create called with the DB-persisted fields (no stage — server starts at "new").
    expect(mockCreate).toHaveBeenCalledOnce();
    const call = mockCreate.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(call.name).toBe("Ada Lovelace");
    expect(call.phone).toBe("+15550001234");
    expect(call.source).toBe("Added manually");
    expect(call.stage).toBeUndefined();
  });

  it("adopts the server-assigned id on reconcile (dedupe-safe)", async () => {
    const slice = makeSlice();
    const { lead, persisted } = slice.state.addLead({
      name: "Ada Lovelace",
      phone: "+15550001234",
      source: "Added manually",
      stage: "New customer",
      job: "",
    });
    const optimisticId = lead.id;
    const reconciled = await persisted;
    // The optimistic row's id is replaced by the server id.
    expect(reconciled.id).toBe("srv-lead-999");
    expect(slice.state.leads.some((l: Lead) => l.id === optimisticId)).toBe(false);
    expect(slice.state.leads.some((l: Lead) => l.id === "srv-lead-999")).toBe(true);
    // Local-only fields (acts, evisits) survive the id swap.
    const row = slice.state.leads.find((l: Lead) => l.id === "srv-lead-999");
    expect(row?.acts).toEqual([]);
    expect(row?.evisits).toEqual([]);
  });

  it("maps the reconciled DB enum stage back to a display string", async () => {
    mockCreate.mockResolvedValue({
      id: "srv-lead-1000", name: "Existing Dedup", phone: null, email: null,
      source: null, stage: "quote_sent", value: { cents: 0, currency: "USD" },
      unread: false, companyId: null, role: null,
      createdAt: new Date().toISOString(), created: false,
    });
    const slice = makeSlice();
    const { persisted } = slice.state.addLead({
      name: "Existing Dedup", phone: "", source: "", stage: "New customer", job: "",
    });
    const reconciled = await persisted;
    expect(reconciled.stage).toBe("Quote Sent");
  });

  it("rolls back the optimistic lead on create failure", async () => {
    mockCreate.mockRejectedValue(new Error("network error"));
    const slice = makeSlice();
    const { persisted } = slice.state.addLead({
      name: "Fail", phone: "", source: "", stage: "New customer", job: "",
    });
    expect(slice.state.leads).toHaveLength(1);
    await persisted.catch(() => undefined);
    expect(slice.state.leads).toHaveLength(0);
  });
});

describe("lead lifecycle persistence (with trpcVanilla mock)", () => {
  beforeEach(() => {
    mockMutate.mockReset();
    mockArchive.mockReset();
    mockRestore.mockReset();
    mockMutate.mockResolvedValue({
      id: "lead-111", name: "Ada Lovelace", phone: "+15550001234", email: null,
      source: "referral", stage: "quote_sent", value: { cents: 25000, currency: "USD" },
      unread: false, companyId: null, role: null, createdAt: new Date().toISOString(),
    });
    mockArchive.mockResolvedValue({ ok: true });
    mockRestore.mockResolvedValue({
      id: "lead-111", name: "Ada Lovelace", phone: "+15550001234", email: null,
      source: "referral", stage: "new", value: { cents: 25000, currency: "USD" },
      unread: false, companyId: null, role: null, createdAt: new Date().toISOString(),
    });
  });

  it("moveLeadStage applies optimistically, sends the enum, and sets the 'Moved to' note", () => {
    const slice = makeSlice();
    slice.seedLeads([makeLead({ stage: "New customer" })]);
    slice.state.moveLeadStage("lead-111", "Quote Sent");
    const row = slice.state.leads.find((l: Lead) => l.id === "lead-111");
    expect(row?.stage).toBe("Quote Sent");
    expect(row?.last).toBe("Moved to Quote Sent");
    expect(mockMutate).toHaveBeenCalledOnce();
    const call = mockMutate.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(call.leadId).toBe("lead-111");
    expect(call.stage).toBe("quote_sent"); // display → enum
  });

  it("moveLeadStage rolls back the stage on mutation error", async () => {
    mockMutate.mockRejectedValue(new Error("network error"));
    const slice = makeSlice();
    slice.seedLeads([makeLead({ stage: "New customer" })]);
    slice.state.moveLeadStage("lead-111", "Quote Sent");
    expect(slice.state.leads.find((l: Lead) => l.id === "lead-111")?.stage).toBe("Quote Sent");
    await Promise.resolve();
    await Promise.resolve();
    expect(slice.state.leads.find((l: Lead) => l.id === "lead-111")?.stage).toBe("New customer");
  });

  it("archiveLead sets archived optimistically and calls v1.customers.archive", () => {
    const slice = makeSlice();
    slice.seedLeads([makeLead({ archived: false })]);
    slice.state.archiveLead("lead-111");
    expect(slice.state.leads.find((l: Lead) => l.id === "lead-111")?.archived).toBe(true);
    expect(mockArchive).toHaveBeenCalledOnce();
    expect((mockArchive.mock.calls[0]?.[0] as Record<string, unknown>).leadId).toBe("lead-111");
  });

  it("archiveLead rolls back on error", async () => {
    mockArchive.mockRejectedValue(new Error("network error"));
    const slice = makeSlice();
    slice.seedLeads([makeLead({ archived: false })]);
    slice.state.archiveLead("lead-111");
    await Promise.resolve();
    await Promise.resolve();
    expect(slice.state.leads.find((l: Lead) => l.id === "lead-111")?.archived).toBe(false);
  });

  it("restoreLead clears archived optimistically and calls v1.customers.restore", () => {
    const slice = makeSlice();
    slice.seedLeads([makeLead({ archived: true })]);
    slice.state.restoreLead("lead-111");
    expect(slice.state.leads.find((l: Lead) => l.id === "lead-111")?.archived).toBe(false);
    expect(mockRestore).toHaveBeenCalledOnce();
    expect((mockRestore.mock.calls[0]?.[0] as Record<string, unknown>).leadId).toBe("lead-111");
  });

  it("restoreLead rolls back on error", async () => {
    mockRestore.mockRejectedValue(new Error("network error"));
    const slice = makeSlice();
    slice.seedLeads([makeLead({ archived: true })]);
    slice.state.restoreLead("lead-111");
    await Promise.resolve();
    await Promise.resolve();
    expect(slice.state.leads.find((l: Lead) => l.id === "lead-111")?.archived).toBe(true);
  });

  it("deleteLead is a soft-delete: sets archived, keeps the row, calls archive", () => {
    const slice = makeSlice();
    slice.seedLeads([makeLead({ archived: false })]);
    slice.state.deleteLead("lead-111");
    // Row is NOT removed — archived instead (soft-delete only).
    expect(slice.state.leads).toHaveLength(1);
    expect(slice.state.leads.find((l: Lead) => l.id === "lead-111")?.archived).toBe(true);
    expect(mockArchive).toHaveBeenCalledOnce();
  });
});

describe("updateTask (with trpcVanilla mock)", () => {
  let updateMutate: ReturnType<typeof vi.fn>;

  const seedTask = (slice: { state: LeadsSlice; seedLeads: (l: Lead[]) => void }) => {
    // Directly set tasks on the slice state (mimics setTasks).
    (slice as unknown as { state: { tasks: unknown[] } }).state.tasks = [];
    slice.state.setTasks([
      { id: "task-abc", t: "Call client", due: "2026-07-20", leadId: "lead-111", done: false },
    ]);
  };

  beforeEach(async () => {
    const { trpcVanilla } = await import("@/lib/trpc/vanilla");
    updateMutate = trpcVanilla.v1.tasks.update.mutate as ReturnType<typeof vi.fn>;
    updateMutate.mockReset();
    updateMutate.mockResolvedValue({
      id: "task-abc",
      text: "Call client",
      dueDate: "2026-07-20",
      leadId: "lead-111",
      done: false,
    });
  });

  it("applies the optimistic update immediately before the mutation resolves", async () => {
    const slice = makeSlice();
    seedTask(slice);

    updateMutate.mockResolvedValue({
      id: "task-abc",
      text: "Call client UPDATED",
      dueDate: "2026-07-25",
      leadId: "lead-111",
      done: false,
    });

    slice.state.updateTask("task-abc", { t: "Call client UPDATED", due: "2026-07-25" });

    // Optimistic update visible immediately.
    const task = slice.state.tasks.find((t) => t.id === "task-abc");
    expect(task?.t).toBe("Call client UPDATED");
    expect(task?.due).toBe("2026-07-25");
  });

  it("calls v1.tasks.update with correct taskId, text, and dueDate", async () => {
    const slice = makeSlice();
    seedTask(slice);

    slice.state.updateTask("task-abc", { t: "Renamed task", due: "2026-08-01" });

    expect(updateMutate).toHaveBeenCalledOnce();
    const call = updateMutate.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(call.taskId).toBe("task-abc");
    expect(call.text).toBe("Renamed task");
    expect(call.dueDate).toBe("2026-08-01");
  });

  it("maps empty string due to null (clears the due date)", async () => {
    const slice = makeSlice();
    seedTask(slice);

    slice.state.updateTask("task-abc", { due: "" });

    expect(updateMutate).toHaveBeenCalledOnce();
    const call = updateMutate.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(call.dueDate).toBeNull();
    // text was not in the patch — must not be sent.
    expect(call.text).toBeUndefined();
  });

  it("only sends text when only text changes (does not send dueDate)", async () => {
    const slice = makeSlice();
    seedTask(slice);

    slice.state.updateTask("task-abc", { t: "Only text changed" });

    expect(updateMutate).toHaveBeenCalledOnce();
    const call = updateMutate.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(call.text).toBe("Only text changed");
    expect(call.dueDate).toBeUndefined();
  });

  it("reconciles the returned DTO after successful update", async () => {
    const slice = makeSlice();
    seedTask(slice);

    updateMutate.mockResolvedValue({
      id: "task-abc",
      text: "Reconciled text",
      dueDate: "2026-09-01",
      leadId: "lead-111",
      done: false,
    });

    slice.state.updateTask("task-abc", { t: "Reconciled text", due: "2026-09-01" });

    await Promise.resolve();
    await Promise.resolve();

    const task = slice.state.tasks.find((t) => t.id === "task-abc");
    expect(task?.t).toBe("Reconciled text");
    expect(task?.due).toBe("2026-09-01");
  });

  it("rolls back the task to its prior state on update failure", async () => {
    const slice = makeSlice();
    seedTask(slice);

    updateMutate.mockRejectedValue(new Error("network error"));

    slice.state.updateTask("task-abc", { t: "Failed rename", due: "2026-12-31" });

    // Optimistic update visible before rejection.
    expect(slice.state.tasks.find((t) => t.id === "task-abc")?.t).toBe("Failed rename");

    await Promise.resolve();
    await Promise.resolve();

    // Rolled back — original values restored.
    const task = slice.state.tasks.find((t) => t.id === "task-abc");
    expect(task?.t).toBe("Call client");
    expect(task?.due).toBe("2026-07-20");
  });

  it("re-attaches a task to a different lead, and detaches with '' → null", () => {
    const slice = makeSlice();
    seedTask(slice);

    slice.state.updateTask("task-abc", { leadId: "lead-999" });
    expect(slice.state.tasks.find((t) => t.id === "task-abc")?.leadId).toBe("lead-999");
    let call = updateMutate.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(call.leadId).toBe("lead-999");
    expect(call.text).toBeUndefined(); // only the changed field is sent
    expect(call.dueDate).toBeUndefined();

    updateMutate.mockClear();
    slice.state.updateTask("task-abc", { leadId: "" });
    expect(slice.state.tasks.find((t) => t.id === "task-abc")?.leadId).toBeNull();
    call = updateMutate.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(call.leadId).toBeNull();
  });
});

describe("removeTask (with trpcVanilla mock)", () => {
  let removeMutate: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    const { trpcVanilla } = await import("@/lib/trpc/vanilla");
    removeMutate = trpcVanilla.v1.tasks.remove.mutate as ReturnType<typeof vi.fn>;
    removeMutate.mockReset();
    removeMutate.mockResolvedValue({ ok: true });
  });

  it("optimistically removes the task and calls v1.tasks.remove with its id", () => {
    const slice = makeSlice();
    slice.state.setTasks([
      { id: "task-abc", t: "Call client", due: null, leadId: null, done: false },
      { id: "task-def", t: "Send quote", due: null, leadId: null, done: false },
    ]);

    slice.state.removeTask("task-abc");

    expect(slice.state.tasks.map((t) => t.id)).toEqual(["task-def"]);
    expect(removeMutate).toHaveBeenCalledOnce();
    expect((removeMutate.mock.calls[0]?.[0] as Record<string, unknown>).taskId).toBe("task-abc");
  });

  it("restores the task on remove failure (rollback)", async () => {
    const slice = makeSlice();
    slice.state.setTasks([{ id: "task-abc", t: "Call client", due: null, leadId: null, done: false }]);
    removeMutate.mockRejectedValue(new Error("network error"));

    slice.state.removeTask("task-abc");
    expect(slice.state.tasks).toHaveLength(0); // optimistic remove first

    await Promise.resolve();
    await Promise.resolve();

    expect(slice.state.tasks.map((t) => t.id)).toEqual(["task-abc"]); // rolled back
  });
});
