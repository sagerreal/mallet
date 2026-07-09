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

vi.mock("@/lib/trpc/vanilla", () => ({
  trpcVanilla: {
    v1: {
      customers: {
        update: {
          mutate: (...args: unknown[]) => mockMutate(...args),
        },
      },
      tasks: {
        create: { mutate: vi.fn().mockResolvedValue({ id: "t1", text: "", dueDate: null, leadId: null, done: false }) },
        setDone: { mutate: vi.fn().mockResolvedValue({ id: "t1", text: "", dueDate: null, leadId: null, done: true }) },
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
      address: "123 Main St",
    });
    expect(payload).toBeNull();
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
