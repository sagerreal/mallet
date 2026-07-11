/**
 * lib/store/slices/invoices-slice.test.ts
 * Unit tests for buildInvoiceMetadataPayload, updateInvoice persistence,
 * and setInvoiceLines persistence.
 *
 * Covers:
 *   (a) buildInvoiceMetadataPayload — pure helper mapping/filtering logic.
 *   (b) updateInvoice — optimistic update, mutation called/skipped, rollback.
 *   (c) setInvoiceLines — optimistic total recompute, patchLines called, rollback.
 *
 * trpcVanilla is module-mocked so no network/Supabase session is needed.
 * vi.mock is hoisted by Vitest above all imports, so the module-under-test
 * sees the mock when it evaluates.
 */

// ---------------------------------------------------------------------------
// Module mocks (hoisted by Vitest before all imports)
// ---------------------------------------------------------------------------

import { describe, it, expect, vi, beforeEach } from "vitest";

const updateMetadataMutate = vi.fn();
const patchLinesMutate = vi.fn();

vi.mock("@/lib/trpc/vanilla", () => ({
  trpcVanilla: {
    v1: {
      invoicing: {
        updateMetadata: { mutate: (...a: unknown[]) => updateMetadataMutate(...a) },
        patchLines: { mutate: (...a: unknown[]) => patchLinesMutate(...a) },
        createFromJob: { mutate: vi.fn() },
        draft: { mutate: vi.fn() },
        send: { mutate: vi.fn() },
        recordPayment: { mutate: vi.fn() },
        void: { mutate: vi.fn() },
      },
    },
  },
}));

// Static imports — resolved AFTER the mock above is registered.
import { buildInvoiceMetadataPayload, createInvoicesSlice, type InvoicesSlice } from "./invoices-slice";
import type { Invoice, InvoiceLine } from "@/lib/store/types";

// ---------------------------------------------------------------------------
// Minimal Invoice builder
// ---------------------------------------------------------------------------

function makeInvoice(overrides: Partial<Invoice> = {}): Invoice {
  return {
    id: "inv-1", num: "INV-800", jobId: null, leadId: "lead-1",
    cust: "Ada", phone: "+15550001234", title: "Deck", email: "ada@x.com",
    termsDays: 7, lines: [{ d: "Labor", q: 1, r: 1000 }], total: 1000,
    depPaid: 0, payments: [], status: "draft", age: 0, archived: false,
    origin: "db", ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Minimal Zustand-like harness — drives the slice without a real store.
// ---------------------------------------------------------------------------

function makeSlice(): { readonly state: InvoicesSlice; seed: (i: Invoice[]) => void } {
  let state: InvoicesSlice = {} as InvoicesSlice;
  const set = (u: ((s: InvoicesSlice) => Partial<InvoicesSlice>) | Partial<InvoicesSlice>) => {
    state = typeof u === "function" ? { ...state, ...u(state) } : { ...state, ...u };
  };
  state = createInvoicesSlice(set, () => state, {} as never);
  return { get state() { return state; }, seed(i) { state = { ...state, invoices: i }; } };
}

// ---------------------------------------------------------------------------
// Minimal DB DTO factory — mirrors what the backend returns.
// ---------------------------------------------------------------------------

const dbDto = (over: Record<string, unknown> = {}) => ({
  id: "inv-1", num: "INV-800", sourceJobId: null, leadId: "lead-1", title: "Deck",
  status: "draft", total: { cents: 100_000, currency: "USD" },
  depositPaid: { cents: 0, currency: "USD" }, amountPaid: { cents: 0, currency: "USD" },
  due: { cents: 100_000, currency: "USD" }, termsDays: 7, lines: [], payments: [],
  sentAt: null, dueAt: null, createdAt: new Date().toISOString(), ...over,
});

// ---------------------------------------------------------------------------
// buildInvoiceMetadataPayload — pure helper tests
// ---------------------------------------------------------------------------

describe("buildInvoiceMetadataPayload", () => {
  it("maps termsDays and title", () => {
    const p = buildInvoiceMetadataPayload("inv-1", { termsDays: 30, title: "Renamed" });
    expect(p).not.toBeNull();
    expect(p?.invoiceId).toBe("inv-1");
    expect(p?.termsDays).toBe(30);
    expect(p?.title).toBe("Renamed");
  });

  it("maps depPaid dollars → depositPaidCents", () => {
    const p = buildInvoiceMetadataPayload("inv-1", { depPaid: 250 });
    expect(p?.depositPaidCents).toBe(25_000);
  });

  it("maps a leadId change", () => {
    const p = buildInvoiceMetadataPayload("inv-1", { leadId: "lead-2" });
    expect(p?.leadId).toBe("lead-2");
  });

  it("returns null for a client-local-only patch (cust/phone/fu/archived)", () => {
    expect(buildInvoiceMetadataPayload("inv-1", { cust: "Bob" })).toBeNull();
    expect(buildInvoiceMetadataPayload("inv-1", { phone: "+199" })).toBeNull();
    expect(buildInvoiceMetadataPayload("inv-1", { fu: { on: true, stage: 1 } })).toBeNull();
    expect(buildInvoiceMetadataPayload("inv-1", { archived: true })).toBeNull();
  });

  it("mixed patch keeps only persistable fields", () => {
    const p = buildInvoiceMetadataPayload("inv-1", { termsDays: 14, cust: "ignored" });
    expect(p).not.toBeNull();
    expect(p?.termsDays).toBe(14);
    expect((p as unknown as Record<string, unknown>).cust).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// updateInvoice persistence
// ---------------------------------------------------------------------------

describe("updateInvoice persistence", () => {
  beforeEach(() => { updateMetadataMutate.mockReset(); updateMetadataMutate.mockResolvedValue(dbDto()); });

  it("calls updateMetadata for a persistable patch on a db invoice", () => {
    const s = makeSlice(); s.seed([makeInvoice()]);
    s.state.updateInvoice("inv-1", { termsDays: 30 });
    expect(updateMetadataMutate).toHaveBeenCalledOnce();
    const call = updateMetadataMutate.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(call.invoiceId).toBe("inv-1");
    expect(call.termsDays).toBe(30);
  });

  it("applies the optimistic patch immediately", () => {
    const s = makeSlice(); s.seed([makeInvoice()]);
    s.state.updateInvoice("inv-1", { termsDays: 30 });
    expect(s.state.invoices[0]?.termsDays).toBe(30);
  });

  it("does NOT call updateMetadata for a local-only patch", () => {
    const s = makeSlice(); s.seed([makeInvoice()]);
    s.state.updateInvoice("inv-1", { cust: "Bob" });
    expect(updateMetadataMutate).not.toHaveBeenCalled();
    expect(s.state.invoices[0]?.cust).toBe("Bob");
  });

  it("does NOT call updateMetadata for a manual invoice", () => {
    const s = makeSlice(); s.seed([makeInvoice({ origin: "manual" })]);
    s.state.updateInvoice("inv-1", { termsDays: 30 });
    expect(updateMetadataMutate).not.toHaveBeenCalled();
  });

  it("rolls back on mutation error", async () => {
    updateMetadataMutate.mockRejectedValue(new Error("boom"));
    const s = makeSlice(); s.seed([makeInvoice({ termsDays: 7 })]);
    s.state.updateInvoice("inv-1", { termsDays: 30 });
    expect(s.state.invoices[0]?.termsDays).toBe(30);
    await Promise.resolve(); await Promise.resolve();
    expect(s.state.invoices[0]?.termsDays).toBe(7);
  });
});

// ---------------------------------------------------------------------------
// setInvoiceLines persistence
// ---------------------------------------------------------------------------

describe("setInvoiceLines persistence", () => {
  beforeEach(() => { patchLinesMutate.mockReset(); patchLinesMutate.mockResolvedValue(dbDto({ total: { cents: 45_000, currency: "USD" } })); });

  it("recomputes the total optimistically and calls patchLines (dollars → cents)", () => {
    const s = makeSlice(); s.seed([makeInvoice()]);
    const lines: InvoiceLine[] = [{ d: "A", q: 2, r: 200 }, { d: "B", q: 1, r: 50 }];
    s.state.setInvoiceLines("inv-1", lines);
    expect(s.state.invoices[0]?.total).toBe(450); // 2*200 + 1*50
    expect(patchLinesMutate).toHaveBeenCalledOnce();
    const call = patchLinesMutate.mock.calls[0]?.[0] as { invoiceId: string; lines: Array<Record<string, number>> };
    expect(call.invoiceId).toBe("inv-1");
    expect(call.lines[0]?.rateCents).toBe(20_000); // 200 dollars → cents
    expect(call.lines[0]?.quantity).toBe(2);
  });

  it("does NOT call patchLines for a manual invoice", () => {
    const s = makeSlice(); s.seed([makeInvoice({ origin: "manual" })]);
    s.state.setInvoiceLines("inv-1", [{ d: "A", q: 1, r: 100 }]);
    expect(patchLinesMutate).not.toHaveBeenCalled();
  });

  it("rolls back the lines on error", async () => {
    patchLinesMutate.mockRejectedValue(new Error("boom"));
    const s = makeSlice(); s.seed([makeInvoice()]);
    s.state.setInvoiceLines("inv-1", [{ d: "A", q: 5, r: 100 }]);
    expect(s.state.invoices[0]?.total).toBe(500);
    await Promise.resolve(); await Promise.resolve();
    expect(s.state.invoices[0]?.total).toBe(1000); // reverted to seed total
  });
});
