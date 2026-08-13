import { describe, it, expect, beforeEach } from "vitest";
import {
  asOrgId,
  asLeadId,
  asInvoiceId,
  FixedClock,
  isOk,
  type OrgId,
  type LeadId,
  type InvoiceId,
} from "@mallet/shared/types";
import { InMemoryEventBus, type IdGenerator } from "@mallet/shared/ports";
import { Invoice } from "../domain/invoice";
import type { InvoiceRepository, InvoiceFilter, ApplyResult } from "../domain/invoice-repository";
import type { Payment } from "../domain/payment";
import type { CursorPage, Paginated } from "@mallet/shared/types";
import { buildPage } from "@mallet/shared/types";
import type { JobId } from "@mallet/shared/types";
import { DraftInvoiceUseCase, type DraftInvoiceCommand, type InvoiceLineInput } from "./draft-invoice";

const ORG: OrgId = asOrgId("11111111-1111-1111-1111-111111111111");
const LEAD: LeadId = asLeadId("22222222-2222-2222-2222-222222222222");

const seqIds = (): IdGenerator => {
  let n = 0;
  return {
    newId: () => {
      n += 1;
      return `00000000-0000-0000-0000-${String(n).padStart(12, "0")}`;
    },
  };
};

class FakeInvoiceRepository implements InvoiceRepository {
  private readonly store = new Map<InvoiceId, Invoice>();
  private seq = 5000;

  async nextNumber(): Promise<string> {
    const v = this.seq;
    this.seq += 1;
    return `INV-${v}`;
  }
  async save(invoice: Invoice): Promise<void> {
    this.store.set(invoice.props.id, invoice);
  }
  async insertNew(invoice: Invoice): Promise<boolean> {
    if (this.store.has(invoice.props.id)) return false;
    this.store.set(invoice.props.id, invoice);
    return true;
  }
  async insertForJob(invoice: Invoice): Promise<boolean> {
    this.store.set(invoice.props.id, invoice);
    return true;
  }
  async insertPayment(_orgId: OrgId, _invoiceId: InvoiceId, _payment: Payment): Promise<boolean> {
    return true;
  }
  async applyPayment(_invoiceId: InvoiceId, _amountCents: number): Promise<ApplyResult> {
    return { applied: false, invoice: null };
  }
  async findById(id: InvoiceId): Promise<Invoice | null> {
    return this.store.get(id) ?? null;
  }
  async findByPublicToken(_token: string): Promise<Invoice | null> {
    return null;
  }

  async listByScopeJob() { return []; }
  async findBySourceJob(_jobId: JobId): Promise<Invoice | null> {
    return null;
  }
  async totals(): Promise<{ openCents: number; overdueCents: number; openCount: number }> {
    return { openCents: 0, overdueCents: 0, openCount: 0 };
  }
  async count(): Promise<number> { return 0; }
  async list(_page: CursorPage, _filter?: InvoiceFilter): Promise<Paginated<Invoice>> {
    const rows = [...this.store.values()];
    return buildPage(rows, _page, (i) => ({ createdAt: i.props.createdAt, id: i.props.id }));
  }
  async listByLead(_leadId: LeadId, page: CursorPage): Promise<Paginated<Invoice>> {
    return this.list(page);
  }
  async findOverdue(_now: Date, page: CursorPage): Promise<Paginated<Invoice>> {
    return this.list(page);
  }
}

const validLine = (): InvoiceLineInput => ({
  description: "Labor",
  quantity: 1,
  rateCents: 10_000,
  costCents: 0,
});

const baseCmd = (): DraftInvoiceCommand => ({
  orgId: ORG,
  leadId: LEAD,
  title: "Test Invoice",
  termsDays: 30,
  lines: [validLine()],
});

describe("DraftInvoiceUseCase – branch coverage", () => {
  let clock: FixedClock;
  let repo: FakeInvoiceRepository;
  let bus: InMemoryEventBus;
  let useCase: DraftInvoiceUseCase;

  beforeEach(() => {
    clock = new FixedClock(new Date("2026-07-01T00:00:00Z"));
    repo = new FakeInvoiceRepository();
    bus = new InMemoryEventBus();
    useCase = new DraftInvoiceUseCase(repo, bus, clock, seqIds());
  });

  it("returns a validation error when lines array is empty", async () => {
    const result = await useCase.exec({ ...baseCmd(), lines: [] });

    expect(result.ok).toBe(false);
    if (!result.ok && result.error.kind === "validation") {
      expect(result.error.kind).toBe("validation");
      expect(result.error.field).toBe("lines");
      expect(result.error.message).toMatch(/at least one line/i);
    }
  });

  it("returns the InvoiceLine.create error when a line has an empty description", async () => {
    const badLine: InvoiceLineInput = { description: "   ", quantity: 1, rateCents: 5_000, costCents: 0 };

    const result = await useCase.exec({ ...baseCmd(), lines: [badLine] });

    expect(result.ok).toBe(false);
    if (!result.ok && result.error.kind === "validation") {
      expect(result.error.kind).toBe("validation");
      expect(result.error.field).toBe("description");
    }
  });

  it("returns the InvoiceLine.create error when a line has a negative rate", async () => {
    const badLine: InvoiceLineInput = { description: "Work", quantity: 1, rateCents: -1, costCents: 0 };

    const result = await useCase.exec({ ...baseCmd(), lines: [badLine] });

    expect(result.ok).toBe(false);
    if (!result.ok && result.error.kind === "validation") {
      expect(result.error.kind).toBe("validation");
      expect(result.error.field).toBe("rate");
    }
  });

  it("returns InvoiceLine.create error from the second line when the first is valid", async () => {
    const lines: readonly InvoiceLineInput[] = [
      validLine(),
      { description: "", quantity: 1, rateCents: 500, costCents: 0 },
    ];

    const result = await useCase.exec({ ...baseCmd(), lines });

    expect(result.ok).toBe(false);
    if (!result.ok && result.error.kind === "validation") {
      expect(result.error.kind).toBe("validation");
      expect(result.error.field).toBe("description");
    }
    // Must NOT have saved or emitted — the error short-circuits before repo.save
    expect(bus.recorded.filter((e) => e.name === "invoice.drafted")).toHaveLength(0);
  });

  it("returns a validation error when termsDays is negative (Invoice.create fails)", async () => {
    const result = await useCase.exec({ ...baseCmd(), termsDays: -1 });

    expect(result.ok).toBe(false);
    if (!result.ok && result.error.kind === "validation") {
      expect(result.error.kind).toBe("validation");
      expect(result.error.field).toBe("termsDays");
    }
    // No event should be emitted when Invoice.create fails
    expect(bus.recorded.filter((e) => e.name === "invoice.drafted")).toHaveLength(0);
  });

  it("succeeds and emits invoice.drafted for a valid command", async () => {
    const result = await useCase.exec(baseCmd());

    expect(isOk(result)).toBe(true);
    if (isOk(result)) {
      expect(result.value.props.orgId).toBe(ORG);
      expect(result.value.props.leadId).toBe(LEAD);
      expect(result.value.props.status).toBe("draft");
      expect(result.value.props.total).toBe(10_000); // 1 * 10_000
    }
    expect(bus.recorded.filter((e) => e.name === "invoice.drafted")).toHaveLength(1);
  });

  it("applies a discount rate to the drafted total", async () => {
    // The invoice sheet's Discount % used to change the number on screen and nothing else — the
    // customer was billed the full undiscounted sum.
    const result = await useCase.exec({
      ...baseCmd(),
      lines: [{ description: "Work", quantity: 1, rateCents: 100_000, costCents: 0, taxable: true }],
      discBps: 1_000,
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.props.discBps).toBe(1_000);
      expect(result.value.props.discount).toBe(10_000);
      expect(result.value.props.total).toBe(90_000);
    }
  });

  it("applies a tax rate to the drafted total", async () => {
    const result = await useCase.exec({
      ...baseCmd(),
      lines: [{ description: "Work", quantity: 1, rateCents: 100_000, costCents: 0, taxable: true }],
      taxBps: 875,
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.props.taxBps).toBe(875);
      expect(result.value.props.tax).toBe(8_750);
      expect(result.value.props.total).toBe(108_750); // tax is PART of the total
    }
  });

  it("taxes only the taxable lines, and taxes them after the discount", async () => {
    const result = await useCase.exec({
      ...baseCmd(),
      lines: [
        { description: "Labour", quantity: 1, rateCents: 100_000, costCents: 0, taxable: true },
        { description: "Permit", quantity: 1, rateCents: 50_000, costCents: 0, taxable: false },
      ],
      discBps: 1_000,
      taxBps: 1_000,
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.props.discount).toBe(15_000); // 10% of the whole $1500 subtotal
      expect(result.value.props.tax).toBe(9_000); // 10% of the discounted taxable $900
      expect(result.value.props.total).toBe(144_000); // 1500 - 150 + 90
    }
  });

  it("refuses a discount over 100% rather than inverting the bill", async () => {
    const result = await useCase.exec({ ...baseCmd(), discBps: 15_000 });
    expect(result.ok).toBe(false);
  });

  it("still totals the plain line sum when no rates are given", async () => {
    const result = await useCase.exec({
      ...baseCmd(),
      lines: [{ description: "Work", quantity: 2, rateCents: 20_000, costCents: 0, taxable: true }],
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.props.total).toBe(40_000);
      expect(result.value.props.tax).toBe(0);
      expect(result.value.props.discount).toBe(0);
    }
  });

  it("preserves a client-authored id so the store's optimistic id matches the persisted row", async () => {
    const clientId = asInvoiceId("99999999-9999-4999-8999-999999999999");
    const result = await useCase.exec({ ...baseCmd(), id: clientId });

    expect(isOk(result)).toBe(true);
    if (isOk(result)) expect(result.value.props.id).toBe(clientId);
    // The persisted row is addressable by that same id (findById round-trips it).
    expect(await repo.findById(clientId)).not.toBeNull();
  });

  it("falls back to a generated id when no client id is supplied", async () => {
    const result = await useCase.exec(baseCmd());

    expect(isOk(result)).toBe(true);
    // seqIds mints the line id (…0001) then the invoice id (…0002); no client id was given.
    if (isOk(result)) expect(result.value.props.id).toBe("00000000-0000-0000-0000-000000000002");
  });
});

/**
 * The client-authored id is a convenience for the browser's optimistic row. It must never be a
 * write primitive aimed at an invoice that already exists.
 *
 * Before this was hardened the draft path called `repo.save()` — an UPSERT — so naming an existing
 * invoice's id REPLACED its header: status reset to draft, total rewritten to the new lines,
 * `source_job_id` nulled (orphaning the real bill, in a codebase whose rule is soft-delete-only)
 * and any recorded payments stranded against a total that no longer matched. That is a strictly
 * worse capability than the `void` and `patchLines` endpoints deliberately withheld from techs.
 */
describe("DraftInvoiceUseCase — a client-authored id cannot overwrite an existing invoice", () => {
  it("refuses a colliding id instead of replacing the row", async () => {
    const bus = new InMemoryEventBus();
    const repo = new FakeInvoiceRepository();
    const useCase = new DraftInvoiceUseCase(
      repo,
      bus,
      new FixedClock(new Date("2026-07-01T00:00:00Z")),
      seqIds(),
    );

    const victimId = asInvoiceId("99999999-9999-4999-8999-999999999999");
    const first = await useCase.exec({
      orgId: ORG,
      id: victimId,
      leadId: LEAD,
      title: "The real bill",
      termsDays: 7,
      lines: [{ description: "Water heater", quantity: 1, rateCents: 500_000, costCents: 0 }],
    });
    expect(isOk(first)).toBe(true);

    const attack = await useCase.exec({
      orgId: ORG,
      id: victimId, // aimed at the invoice above
      leadId: LEAD,
      title: "Visit fee — service call",
      termsDays: 0,
      lines: [{ description: "Visit fee", quantity: 1, rateCents: 8_900, costCents: 0 }],
    });

    // Refused, and refused LOUDLY — a silent success would leave the caller believing it landed.
    expect(isOk(attack)).toBe(false);

    // And the victim is untouched: same title, same total, still $5,000.
    const survivor = await repo.findById(victimId);
    expect(survivor?.props.title).toBe("The real bill");
    expect(survivor?.props.total).toBe(500_000);
  });

  it("emits no invoice.drafted event for the refused write", async () => {
    const bus = new InMemoryEventBus();
    const repo = new FakeInvoiceRepository();
    const useCase = new DraftInvoiceUseCase(
      repo,
      bus,
      new FixedClock(new Date("2026-07-01T00:00:00Z")),
      seqIds(),
    );
    const id = asInvoiceId("99999999-9999-4999-8999-999999999999");
    const cmd = {
      orgId: ORG,
      id,
      leadId: LEAD,
      title: "x",
      termsDays: 7,
      lines: [{ description: "x", quantity: 1, rateCents: 100, costCents: 0 }],
    };
    await useCase.exec(cmd);
    await useCase.exec(cmd);

    // One insert, one event. The second call must not announce a write it did not make.
    expect(bus.recorded.filter((e) => e.name === "invoice.drafted")).toHaveLength(1);
  });
});
