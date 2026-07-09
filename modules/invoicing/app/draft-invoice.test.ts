import { describe, it, expect, beforeEach } from "vitest";
import {
  asOrgId,
  asLeadId,
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
  async findBySourceJob(_jobId: JobId): Promise<Invoice | null> {
    return null;
  }
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
});
