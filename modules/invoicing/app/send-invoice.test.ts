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

  async findByPublicToken(token: string): Promise<Invoice | null> {
    for (const invoice of this.store.values()) {
      if (invoice.props.publicToken === token) return invoice;
    }
    return null;
  }

  // The rest are required by the interface but unused by SendInvoiceUseCase.
  async nextNumber(): Promise<string> { return "INV-1"; }
  async insertForJob(): Promise<boolean> { return true; }
  async listByScopeJob() { return []; }
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
const makeInvoice = (
  status: "draft" | "sent" | "paid" | "void" = "draft",
  publicToken: string | null = null,
): Invoice => {
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
    publicToken,
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

  it("idempotent no-op: already-sent invoice (with its token) returns ok but does NOT save or emit", async () => {
    // An already-sent invoice causes invoice.send() to return ok(this) — same object reference.
    // The use-case detects `sent.value === invoice` and short-circuits. It carries a token here —
    // a sent-but-tokenless (pre-migration) invoice deliberately mints one instead, see below.
    const alreadySent = makeInvoice("sent", "f".repeat(64));
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

  it("mints a 64-hex public token on first send and persists it", async () => {
    repo.seed(makeInvoice("draft"));

    const result = await uc.exec({ invoiceId: INV_ID });

    expect(isOk(result)).toBe(true);
    if (!isOk(result)) return;
    // 32 bytes of crypto randomness, hex-encoded — same shape as the estimates' public token.
    expect(result.value.props.publicToken).toMatch(/^[0-9a-f]{64}$/);
    // Persisted, not just returned: the pay link must survive a reload.
    const stored = await repo.findById(INV_ID);
    expect(stored?.props.publicToken).toBe(result.value.props.publicToken);
  });

  it("keeps the token stable on re-send — no rotation, no extra save", async () => {
    repo.seed(makeInvoice("draft"));

    const first = await uc.exec({ invoiceId: INV_ID });
    if (!isOk(first)) throw new Error("first send failed");
    const token = first.value.props.publicToken;
    const savesAfterFirst = repo.saveCalls;

    const second = await uc.exec({ invoiceId: INV_ID });

    expect(isOk(second)).toBe(true);
    if (!isOk(second)) return;
    // A re-send must never rotate a link the customer already holds.
    expect(second.value.props.publicToken).toBe(token);
    expect(repo.saveCalls).toBe(savesAfterFirst); // fully idempotent — nothing rewritten
  });

  it("stamps a token on re-send of a legacy sent invoice that has none, without re-emitting invoice.sent", async () => {
    // Pre-migration invoices were sent before public tokens existed. A re-send is the shop's
    // way to mint one — but it must not fire a second invoice.sent event.
    repo.seed(makeInvoice("sent"));

    const result = await uc.exec({ invoiceId: INV_ID });

    expect(isOk(result)).toBe(true);
    if (!isOk(result)) return;
    expect(result.value.props.publicToken).toMatch(/^[0-9a-f]{64}$/);
    expect(repo.saveCalls).toBe(1); // the mint was persisted
    expect(bus.recorded).toHaveLength(0); // already sent — no duplicate event
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
