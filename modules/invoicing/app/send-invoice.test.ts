import { describe, it, expect, beforeEach } from "vitest";
import {
  asOrgId,
  asLeadId,
  asInvoiceId,
  money,
  zeroMoney,
  FixedClock,
  isOk,
  type OrgId,
  type LeadId,
  type InvoiceId,
  type JobId,
  type CursorPage,
  type Paginated,
} from "@mallet/shared/types";
import { InMemoryEventBus } from "@mallet/shared/ports";
import { Invoice } from "../domain/invoice";
import type { InvoiceRepository, InvoiceFilter, ApplyResult } from "../domain/invoice-repository";
import type { Payment } from "../domain/payment";
import { SendInvoiceUseCase } from "./send-invoice";

// Stable IDs used across all tests
const ORG: OrgId = asOrgId("aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa");
const LEAD: LeadId = asLeadId("bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb");
const INV_ID: InvoiceId = asInvoiceId("cccccccc-cccc-4ccc-8ccc-cccccccccccc");

// Minimal stub: save() is a spy we can observe via a call counter.
class FakeInvoiceRepository implements InvoiceRepository {
  private store = new Map<InvoiceId, Invoice>();
  public saveCalls = 0;

  async findById(id: InvoiceId): Promise<Invoice | null> {
    return this.store.get(id) ?? null;
  }

  async save(invoice: Invoice): Promise<void> {
    this.saveCalls += 1;
    this.store.set(invoice.props.id, invoice);
  }

  // The rest are required by the interface but unused by SendInvoiceUseCase.
  async nextNumber(): Promise<string> { return "INV-1"; }
  async insertForJob(): Promise<boolean> { return true; }
  async findBySourceJob(): Promise<Invoice | null> { return null; }
  async insertPayment(_o: OrgId, _i: InvoiceId, _p: Payment): Promise<boolean> { return true; }
  async applyPayment(_id: InvoiceId, _amt: number): Promise<ApplyResult> {
    return { applied: false, invoice: null };
  }
  async totals(): Promise<{ openCents: number; overdueCents: number; openCount: number }> {
    return { openCents: 0, overdueCents: 0, openCount: 0 };
  }
  async count(): Promise<number> { return 0; }
  async list(_p: CursorPage, _f?: InvoiceFilter): Promise<Paginated<Invoice>> {
    return { items: [], nextCursor: null };
  }
  async listByLead(_l: LeadId, _p: CursorPage): Promise<Paginated<Invoice>> {
    return { items: [], nextCursor: null };
  }
  async findOverdue(_now: Date, _p: CursorPage): Promise<Paginated<Invoice>> {
    return { items: [], nextCursor: null };
  }

  /** Seed helper — inserts an invoice without incrementing saveCalls. */
  seed(invoice: Invoice): void {
    this.store.set(invoice.props.id, invoice);
  }
}

// Factory: builds a valid Invoice with sensible defaults and an optional status override.
const makeInvoice = (status: "draft" | "sent" | "paid" | "void" = "draft"): Invoice => {
  const now = new Date("2026-06-01T00:00:00Z");
  const r = Invoice.create({
    id: INV_ID,
    orgId: ORG,
    num: "INV-1000",
    sourceJobId: null,
    leadId: LEAD,
    title: "Test Job",
    status,
    total: money(50_000),
    depositPaid: zeroMoney,
    amountPaid: zeroMoney,
    payments: [],
    lines: [],
    termsDays: 7,
    sentAt: status === "sent" ? now : null,
    dueAt: status === "sent" ? new Date("2026-06-08T00:00:00Z") : null,
    createdAt: now,
    updatedAt: now,
  });
  if (!isOk(r)) throw new Error(`makeInvoice failed: ${r.error.message}`);
  return r.value;
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("SendInvoiceUseCase", () => {
  let clock: FixedClock;
  let repo: FakeInvoiceRepository;
  let bus: InMemoryEventBus;
  let uc: SendInvoiceUseCase;

  beforeEach(() => {
    clock = new FixedClock(new Date("2026-06-01T00:00:00Z"));
    repo = new FakeInvoiceRepository();
    bus = new InMemoryEventBus();
    uc = new SendInvoiceUseCase(repo, bus, clock);
  });

  it("returns not_found when the invoice does not exist", async () => {
    const result = await uc.exec({ invoiceId: INV_ID });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.kind).toBe("not_found");
    // Nothing was persisted and no event was emitted
    expect(repo.saveCalls).toBe(0);
    expect(bus.recorded).toHaveLength(0);
  });

  it("transitions a draft invoice to sent, saves it, and emits invoice.sent with dueAt", async () => {
    repo.seed(makeInvoice("draft"));

    const result = await uc.exec({ invoiceId: INV_ID });

    expect(isOk(result)).toBe(true);
    if (!isOk(result)) return;

    // Returned invoice is now sent
    expect(result.value.props.status).toBe("sent");
    expect(result.value.props.sentAt).toEqual(clock.now());

    // dueAt = sentAt + termsDays (7) = 2026-06-08
    const expectedDueAt = new Date("2026-06-08T00:00:00Z");
    expect(result.value.props.dueAt).toEqual(expectedDueAt);

    // repo.save was called exactly once
    expect(repo.saveCalls).toBe(1);

    // bus.emit was called with a correctly shaped invoice.sent event
    const sentEvents = bus.recorded.filter((e) => e.name === "invoice.sent");
    expect(sentEvents).toHaveLength(1);
    const event = sentEvents[0]!;
    expect(event.orgId).toBe(ORG);
    expect(event.payload.invoiceId).toBe(INV_ID);
    expect(event.payload.leadId).toBe(LEAD);
    expect(event.payload.dueAt).toBe(expectedDueAt.toISOString());
    expect(event.occurredAt).toEqual(clock.now());
  });

  it("idempotent no-op: already-sent invoice returns ok but does NOT save or emit", async () => {
    // An already-sent invoice causes invoice.send() to return ok(this) — same object reference.
    // The use-case detects `sent.value === invoice` and short-circuits.
    const alreadySent = makeInvoice("sent");
    repo.seed(alreadySent);

    const eventsBefore = bus.recorded.length;
    const savesBefore = repo.saveCalls;

    const result = await uc.exec({ invoiceId: INV_ID });

    expect(isOk(result)).toBe(true);
    if (!isOk(result)) return;

    // The returned invoice is the exact same object (idempotent — no new wrapper created)
    expect(result.value).toBe(alreadySent);

    // repo.save must NOT have been called
    expect(repo.saveCalls).toBe(savesBefore);

    // bus.emit must NOT have been called
    expect(bus.recorded.length).toBe(eventsBefore);
  });

  it("returns a validation error when send() is rejected (e.g. paid invoice) without saving or emitting", async () => {
    // A paid invoice cannot be sent: invoice.send() returns err(validation(...)).
    // The use-case propagates that error unchanged.
    repo.seed(makeInvoice("paid"));

    const result = await uc.exec({ invoiceId: INV_ID });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.kind).toBe("validation");

    // No side effects
    expect(repo.saveCalls).toBe(0);
    expect(bus.recorded).toHaveLength(0);
  });
});
