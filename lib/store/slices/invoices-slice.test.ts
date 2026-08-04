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
const voidMutate = vi.fn();
const createFromJobMutate = vi.fn();
const draftMutate = vi.fn();
const sendMutate = vi.fn();

vi.mock("@/lib/trpc/vanilla", () => ({
  trpcVanilla: {
    v1: {
      invoicing: {
        updateMetadata: { mutate: (...a: unknown[]) => updateMetadataMutate(...a) },
        patchLines: { mutate: (...a: unknown[]) => patchLinesMutate(...a) },
        createFromJob: { mutate: (...a: unknown[]) => createFromJobMutate(...a) },
        draft: { mutate: (...a: unknown[]) => draftMutate(...a) },
        send: { mutate: (...a: unknown[]) => sendMutate(...a) },
        recordPayment: { mutate: vi.fn() },
        void: { mutate: (...a: unknown[]) => voidMutate(...a) },
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
  // taxBps/tax: previously absent — harmless for tests that only assert the SYNCHRONOUS
  // optimistic state, but sendInvoice's tests below await the full reconcile, which reads
  // dto.tax.cents/dto.taxBps unconditionally (dto-mapper.ts:549-550) and threw without these.
  taxBps: 0, tax: { cents: 0, currency: "USD" },
  depositPaid: { cents: 0, currency: "USD" }, amountPaid: { cents: 0, currency: "USD" },
  due: { cents: 100_000, currency: "USD" }, termsDays: 7, lines: [], payments: [],
  followUpOn: false, followUpStage: 0,
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

  it("maps a poNumber", () => {
    const p = buildInvoiceMetadataPayload("inv-1", { poNumber: "4471" });
    expect(p?.poNumber).toBe("4471");
  });

  it("trims a poNumber", () => {
    const p = buildInvoiceMetadataPayload("inv-1", { poNumber: "  4471  " });
    expect(p?.poNumber).toBe("4471");
  });

  it("trims a blank poNumber to null (clears it)", () => {
    const p = buildInvoiceMetadataPayload("inv-1", { poNumber: "   " });
    expect(p?.poNumber).toBeNull();
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

  // PO number round-trip — Task 9's edit path. Same optimistic → trpcVanilla →
  // reconcile → rollback convention as every other field on this action.
  it("sets a poNumber optimistically and persists it via updateMetadata", () => {
    updateMetadataMutate.mockResolvedValue(dbDto({ poNumber: "4471" }));
    const s = makeSlice(); s.seed([makeInvoice()]);
    s.state.updateInvoice("inv-1", { poNumber: "4471" });
    expect(s.state.invoices[0]?.poNumber).toBe("4471"); // optimistic
    expect(updateMetadataMutate).toHaveBeenCalledOnce();
    const call = updateMetadataMutate.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(call.invoiceId).toBe("inv-1");
    expect(call.poNumber).toBe("4471");
  });

  it("reconciles the server-canonical poNumber after a successful save", async () => {
    updateMetadataMutate.mockResolvedValue(dbDto({ poNumber: "4471" }));
    const s = makeSlice(); s.seed([makeInvoice()]);
    s.state.updateInvoice("inv-1", { poNumber: "4471" });
    await Promise.resolve(); await Promise.resolve(); await Promise.resolve();
    expect(s.state.invoices[0]?.poNumber).toBe("4471");
  });

  it("rolls back the poNumber on mutation error", async () => {
    updateMetadataMutate.mockRejectedValue(new Error("boom"));
    const s = makeSlice(); s.seed([makeInvoice({ poNumber: "old-po" })]);
    s.state.updateInvoice("inv-1", { poNumber: "4471" });
    expect(s.state.invoices[0]?.poNumber).toBe("4471"); // optimistic
    await Promise.resolve(); await Promise.resolve();
    expect(s.state.invoices[0]?.poNumber).toBe("old-po"); // reverted
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

describe("archiveInvoice persistence", () => {
  beforeEach(() => { voidMutate.mockReset(); voidMutate.mockResolvedValue(dbDto({ status: "void" })); });

  // The fix: a DRAFT must persist its archive via void, not just hide locally — otherwise the
  // next hydrate re-derives archived=false from status "draft" and the row reappears.
  it("voids a DRAFT db invoice (persists the archive) and hides it optimistically", () => {
    const s = makeSlice();
    s.seed([makeInvoice({ status: "draft", origin: "db", archived: false })]);
    s.state.archiveInvoice("inv-1");
    expect(s.state.invoices.find((i) => i.id === "inv-1")?.archived).toBe(true); // optimistic
    expect(voidMutate).toHaveBeenCalledWith({ invoiceId: "inv-1" }); // persisted
  });

  it("voids a SENT db invoice too", () => {
    const s = makeSlice();
    s.seed([makeInvoice({ status: "sent", origin: "db", archived: false })]);
    s.state.archiveInvoice("inv-1");
    expect(voidMutate).toHaveBeenCalledWith({ invoiceId: "inv-1" });
  });

  it("does NOT call void for a manual invoice (no DB row yet — store-local hide only)", () => {
    const s = makeSlice();
    s.seed([makeInvoice({ status: "draft", origin: "manual", archived: false })]);
    s.state.archiveInvoice("inv-1");
    expect(s.state.invoices.find((i) => i.id === "inv-1")?.archived).toBe(true);
    expect(voidMutate).not.toHaveBeenCalled();
  });

  it("rolls the archive back if the void mutation fails", async () => {
    voidMutate.mockRejectedValue(new Error("boom"));
    const s = makeSlice();
    s.seed([makeInvoice({ status: "draft", origin: "db", archived: false })]);
    s.state.archiveInvoice("inv-1");
    expect(s.state.invoices.find((i) => i.id === "inv-1")?.archived).toBe(true); // optimistic
    await Promise.resolve(); await Promise.resolve();
    expect(s.state.invoices.find((i) => i.id === "inv-1")?.archived).toBe(false); // reverted
  });
});

// ---------------------------------------------------------------------------
// sendInvoice — the manual (lead-tied) path. Task 5's visit-fee invoice rides exactly this
// path (addInvoice with jobId: null, then sendInvoice) SPECIFICALLY so it never touches
// createFromJob — that use-case (a) refuses an unpriced estimate outright and (b) would claim
// the job's one invoice slot via source_job_id's partial unique index. Both must never fire
// here, for any manual invoice, regardless of whether it happens to be visit-fee shaped.
// ---------------------------------------------------------------------------

describe("sendInvoice — manual (lead-tied) invoice: exactly one server create, no createFromJob", () => {
  beforeEach(() => {
    draftMutate.mockReset();
    sendMutate.mockReset();
    createFromJobMutate.mockReset();
  });

  it("resolves ok:true, calls draft then send exactly once each, and NEVER calls createFromJob", async () => {
    draftMutate.mockResolvedValue(dbDto({ id: "inv-1", status: "draft" }));
    sendMutate.mockResolvedValue(dbDto({ id: "inv-1", status: "sent" }));
    const s = makeSlice();
    s.seed([
      makeInvoice({
        id: "inv-1",
        origin: "manual",
        jobId: null,
        leadId: "lead-1",
        title: "Visit fee — service call",
        lines: [{ d: "Visit fee — service call", q: 1, r: 89 }],
        total: 89,
        status: "draft",
      }),
    ]);

    const result = await s.state.sendInvoice("inv-1");

    expect(result).toEqual({ ok: true });
    expect(draftMutate).toHaveBeenCalledTimes(1); // exactly one server create
    expect(sendMutate).toHaveBeenCalledTimes(1);
    expect(createFromJobMutate).not.toHaveBeenCalled(); // never — this is the Critical it fixes

    const draftCall = draftMutate.mock.calls[0]?.[0] as { leadId: string; title?: string; lines: unknown[] };
    expect(draftCall.leadId).toBe("lead-1");
    expect(draftCall.title).toBe("Visit fee — service call");
    expect(draftCall.lines).toHaveLength(1);
  });

  it("resolves ok:false with the server's error when draft rejects, and never calls send or createFromJob", async () => {
    draftMutate.mockRejectedValue(new Error("network down"));
    const s = makeSlice();
    s.seed([
      makeInvoice({
        id: "inv-1", origin: "manual", jobId: null, leadId: "lead-1",
        title: "Visit fee — service call", lines: [{ d: "x", q: 1, r: 89 }], total: 89, status: "draft",
      }),
    ]);

    const result = await s.state.sendInvoice("inv-1");

    expect(result.ok).toBe(false);
    expect(result.error).toBe("network down");
    expect(sendMutate).not.toHaveBeenCalled();
    expect(createFromJobMutate).not.toHaveBeenCalled();
    // Optimistic status flip rolled back — the invoice never silently reads "sent".
    expect(s.state.invoices[0]?.status).toBe("draft");
  });

  // Round-3 finding: a full restore-to-prior here used to silently clobber origin back to
  // "manual" even though the draft leg genuinely succeeded — a REAL server row exists. That
  // made a caller's local-orphan cleanup (removeLocalInvoice, origin !== "db") delete the
  // pointer to that real row, and a retry then minted a SECOND server draft (draft-invoice.ts
  // has no lead/title dedup) — N flaky retries, N orphaned "Visit fee" drafts in the ledger.
  it("resolves ok:false when send rejects after a successful draft, but origin STAYS db (the real server row survives)", async () => {
    draftMutate.mockResolvedValue(dbDto({ id: "inv-1", status: "draft" }));
    sendMutate.mockRejectedValue(new Error("send failed"));
    const s = makeSlice();
    s.seed([
      makeInvoice({
        id: "inv-1", origin: "manual", jobId: null, leadId: "lead-1",
        title: "Visit fee — service call", lines: [{ d: "x", q: 1, r: 89 }], total: 89, status: "draft",
      }),
    ]);

    const result = await s.state.sendInvoice("inv-1");

    expect(result.ok).toBe(false);
    expect(result.error).toBe("send failed");
    expect(createFromJobMutate).not.toHaveBeenCalled();
    // The draft leg's own reconcile already stamped origin: "db" — the send-leg failure must
    // restore ONLY the optimistic status flip, never the whole pre-draft snapshot.
    const survivor = s.state.invoices.find((i) => i.id === "inv-1");
    expect(survivor?.origin).toBe("db");
    expect(survivor?.status).toBe("draft");
  });

  it("a retry after a send-leg failure resumes the SAME server draft (db path — no second draft.mutate)", async () => {
    draftMutate.mockResolvedValue(dbDto({ id: "inv-1", status: "draft" }));
    sendMutate.mockRejectedValueOnce(new Error("send failed"));
    const s = makeSlice();
    s.seed([
      makeInvoice({
        id: "inv-1", origin: "manual", jobId: null, leadId: "lead-1",
        title: "Visit fee — service call", lines: [{ d: "x", q: 1, r: 89 }], total: 89, status: "draft",
      }),
    ]);

    const first = await s.state.sendInvoice("inv-1");
    expect(first.ok).toBe(false);
    expect(draftMutate).toHaveBeenCalledTimes(1);

    // The invoice is now origin "db" — sendInvoice's SECOND call takes the "db" path (send
    // directly), never re-drafting.
    sendMutate.mockResolvedValueOnce(dbDto({ id: "inv-1", status: "sent" }));
    const second = await s.state.sendInvoice("inv-1");

    expect(second).toEqual({ ok: true });
    expect(draftMutate).toHaveBeenCalledTimes(1); // still exactly one — no duplicate draft
    expect(sendMutate).toHaveBeenCalledTimes(2);
  });

  it("a db-origin invoice's send still resolves ok:true (signature change is additive)", async () => {
    sendMutate.mockResolvedValue(dbDto({ id: "inv-1", status: "sent" }));
    const s = makeSlice();
    s.seed([makeInvoice({ id: "inv-1", origin: "db", status: "draft" })]);
    const result = await s.state.sendInvoice("inv-1");
    expect(result).toEqual({ ok: true });
    expect(createFromJobMutate).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// removeLocalInvoice — cleans up an orphaned optimistic draft after a failed sendInvoice (the
// fee-collection flow's retry-in-session bug: left in place, the orphan satisfies every
// "already collected" guard reading title/leadId forever, until reload).
// ---------------------------------------------------------------------------

describe("removeLocalInvoice", () => {
  it("removes a manual-origin invoice", () => {
    const s = makeSlice();
    s.seed([makeInvoice({ id: "inv-1", origin: "manual" })]);
    s.state.removeLocalInvoice("inv-1");
    expect(s.state.invoices.find((i) => i.id === "inv-1")).toBeUndefined();
  });

  it("removes an invoice with no origin stamp at all (never reached addInvoice's reconcile)", () => {
    const s = makeSlice();
    s.seed([makeInvoice({ id: "inv-1", origin: undefined })]);
    s.state.removeLocalInvoice("inv-1");
    expect(s.state.invoices.find((i) => i.id === "inv-1")).toBeUndefined();
  });

  it("refuses to remove a db-origin invoice — that one has a real row", () => {
    const s = makeSlice();
    s.seed([makeInvoice({ id: "inv-1", origin: "db" })]);
    s.state.removeLocalInvoice("inv-1");
    expect(s.state.invoices.find((i) => i.id === "inv-1")).toBeTruthy();
  });

  it("leaves other invoices untouched", () => {
    const s = makeSlice();
    s.seed([
      makeInvoice({ id: "inv-1", origin: "manual" }),
      makeInvoice({ id: "inv-2", origin: "manual" }),
    ]);
    s.state.removeLocalInvoice("inv-1");
    expect(s.state.invoices.map((i) => i.id)).toEqual(["inv-2"]);
  });

  it("is a no-op for an id that doesn't exist", () => {
    const s = makeSlice();
    s.seed([makeInvoice({ id: "inv-1", origin: "manual" })]);
    s.state.removeLocalInvoice("nope");
    expect(s.state.invoices).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// addInvoice fromJob — ONE id end-to-end (the same-session id split).
//
// The reconcile used to clobber the server DTO's id with the client-minted one
// (`{...reconciled, id}`), so every later mutation keyed on the store id (send,
// recordPayment, createPayment, get) hit the server with an id it never issued —
// NOT_FOUND, optimistic rollback, dev-only log, while the UI said "Approved".
// Two-part fix: the client id rides the createFromJob input (a FRESH create
// echoes it back — ids never split), and the reconcile adopts the SERVER id (an
// EXISTING invoice returned by the idempotent path converges to server truth).
// ---------------------------------------------------------------------------

describe("addInvoice fromJob — one id end-to-end", () => {
  beforeEach(() => {
    createFromJobMutate.mockReset();
  });

  const flush = () => new Promise((r) => setTimeout(r, 0));

  const fromJobDraft = () => {
    const { id: _id, num: _num, ...rest } = makeInvoice({ jobId: "job-1", origin: undefined });
    return rest;
  };

  it("passes the client-authored id to createFromJob; a fresh create echoes it and ONE row keeps it", async () => {
    createFromJobMutate.mockImplementation((input: unknown) =>
      Promise.resolve(
        dbDto({ id: (input as { id: string }).id, sourceJobId: "job-1", status: "draft" }),
      ),
    );
    const s = makeSlice();
    s.seed([]);
    const { invoice: inv } = s.state.addInvoice(fromJobDraft());

    expect(createFromJobMutate).toHaveBeenCalledTimes(1);
    expect(createFromJobMutate).toHaveBeenCalledWith({ jobId: "job-1", id: inv.id });

    await flush();
    expect(s.state.invoices).toHaveLength(1);
    expect(s.state.invoices[0]?.id).toBe(inv.id); // ids never split on the fresh path
    expect(s.state.invoices[0]?.origin).toBe("db");
  });

  it("adopts the SERVER id when the idempotent path returns an EXISTING invoice (local id vanishes)", async () => {
    createFromJobMutate.mockResolvedValue(
      dbDto({ id: "inv-server-9", num: "INV-777", sourceJobId: "job-1", status: "sent" }),
    );
    const s = makeSlice();
    s.seed([]);
    const { invoice: inv } = s.state.addInvoice(fromJobDraft());

    await flush();
    expect(s.state.invoices).toHaveLength(1);
    expect(s.state.invoices[0]?.id).toBe("inv-server-9"); // server truth wins
    expect(s.state.invoices[0]?.num).toBe("INV-777");
    expect(s.state.invoices.some((i) => i.id === inv.id)).toBe(false); // dead local id gone
  });

  it("never leaves two rows with the server id when that row was already in the store", async () => {
    createFromJobMutate.mockResolvedValue(
      dbDto({ id: "inv-server-9", sourceJobId: "job-1", status: "sent" }),
    );
    const s = makeSlice();
    s.seed([makeInvoice({ id: "inv-server-9", jobId: null })]);
    s.state.addInvoice(fromJobDraft());

    await flush();
    expect(s.state.invoices.filter((i) => i.id === "inv-server-9")).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// setInvoices — a hydrator SNAPSHOT must not erase what the summary cannot carry.
//
// The list DTO is a header: no lines, no payment history, and (until this branch) no job link.
// Replacing the store row with it wholesale meant every refetch threw away the reconciled
// record a mutation had just written — the field close-out's done card flipped branches and its
// payment sheet, which finds the job's invoice through jobId, went blank.
// ---------------------------------------------------------------------------

describe("setInvoices — summary rows merge, never clobber", () => {
  const summaryRow = (over: Partial<Invoice> = {}): Invoice =>
    makeInvoice({
      jobId: null, lines: [], payments: [], depPaid: 0, termsDays: undefined,
      partial: true, total: 1000, due: 400, paidTotal: 600, ...over,
    });

  it("keeps the job link, the payment history and the lines a full record already had", () => {
    const s = makeSlice();
    s.seed([
      makeInvoice({
        id: "inv-1", jobId: "job-1", payments: [{ amt: 600, when: "Jul 30", method: "card" }],
        lines: [{ d: "Water heater", q: 1, r: 1000 }], termsDays: 30,
      }),
    ]);

    s.state.setInvoices([summaryRow({ id: "inv-1" })]);

    const merged = s.state.invoices[0]!;
    expect(merged.jobId).toBe("job-1");
    expect(merged.payments).toHaveLength(1);
    expect(merged.lines).toHaveLength(1);
    expect(merged.termsDays).toBe(30);
  });

  it("still takes the server's own answers from the snapshot", () => {
    const s = makeSlice();
    s.seed([makeInvoice({ id: "inv-1", jobId: "job-1", status: "draft", total: 100 })]);

    s.state.setInvoices([summaryRow({ id: "inv-1", status: "partial" })]);

    const merged = s.state.invoices[0]!;
    expect(merged.status).toBe("partial");
    expect(merged.total).toBe(1000);
    expect(merged.due).toBe(400);
  });

  it("takes a FULL row whole — a mutation reconcile is authoritative, not a header", () => {
    const s = makeSlice();
    s.seed([makeInvoice({ id: "inv-1", jobId: "job-1", lines: [{ d: "Old", q: 1, r: 1 }] })]);

    s.state.setInvoices([makeInvoice({ id: "inv-1", jobId: null, lines: [] })]);

    expect(s.state.invoices[0]?.jobId).toBeNull();
    expect(s.state.invoices[0]?.lines).toEqual([]);
  });

  it("drops rows the snapshot no longer lists (the snapshot owns WHICH invoices exist)", () => {
    const s = makeSlice();
    s.seed([makeInvoice({ id: "inv-1" }), makeInvoice({ id: "inv-2" })]);

    s.state.setInvoices([summaryRow({ id: "inv-2" })]);

    expect(s.state.invoices.map((i) => i.id)).toEqual(["inv-2"]);
  });
});

// ---------------------------------------------------------------------------
// addInvoice rollback — row-level, not wholesale.
//
// The catch restored an array snapshot taken BEFORE the optimistic insert, so every invoice the
// hydrator landed while the create was in flight was discarded with it: one failed create
// emptied the ledger.
// ---------------------------------------------------------------------------

describe("addInvoice — a failed create removes ONE row", () => {
  beforeEach(() => {
    createFromJobMutate.mockReset();
  });

  const flush = () => new Promise((r) => setTimeout(r, 0));
  const fromJobDraft = () => {
    const { id: _id, num: _num, ...rest } = makeInvoice({ jobId: "job-1", origin: undefined });
    return rest;
  };

  it("keeps invoices the hydrator landed mid-flight", async () => {
    createFromJobMutate.mockRejectedValue(new Error("nope"));
    const s = makeSlice();
    s.seed([]);

    const { invoice, persisted } = s.state.addInvoice(fromJobDraft());
    // The hydrator's snapshot lands while createFromJob is still in flight.
    s.state.setInvoices([makeInvoice({ id: "inv-hydrated", partial: true })]);

    await persisted;
    await flush();

    expect(s.state.invoices.map((i) => i.id)).toEqual(["inv-hydrated"]);
    expect(s.state.invoices.some((i) => i.id === invoice.id)).toBe(false);
  });

  it("resolves { ok: false } with the server's own reason so the caller can show it", async () => {
    createFromJobMutate.mockRejectedValue(
      Object.assign(new Error("job must be complete before it can be invoiced"), {
        data: { code: "CONFLICT" },
      }),
    );
    const s = makeSlice();
    s.seed([]);

    const { persisted } = s.state.addInvoice(fromJobDraft());
    const result = await persisted;

    expect(result.ok).toBe(false);
    expect(result.error).toBe("job must be complete before it can be invoiced");
  });

  it("resolves { ok: true } once the server confirms", async () => {
    createFromJobMutate.mockImplementation((input: unknown) =>
      Promise.resolve(dbDto({ id: (input as { id: string }).id, sourceJobId: "job-1" })),
    );
    const s = makeSlice();
    s.seed([]);

    await expect(s.state.addInvoice(fromJobDraft()).persisted).resolves.toEqual({ ok: true });
  });
});
