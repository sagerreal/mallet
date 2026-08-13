import type { OrgId, LeadId, JobId, InvoiceId, Money, Result, AppError, Clock } from "@mallet/shared/types";
import { asInvoiceId, money, zeroMoney, addMoney, validation, conflict, ok, err, isOk, deriveTotals } from "@mallet/shared/types";
import type { EventBus, IdGenerator } from "@mallet/shared/ports";
import { Invoice } from "../domain/invoice";
import { InvoiceLine } from "../domain/invoice-line";
import type { InvoiceRepository } from "../domain/invoice-repository";

export interface InvoiceLineInput {
  readonly description: string;
  readonly quantity: number;
  readonly rateCents: number;
  readonly costCents: number;
  /** Omitted reads as TRUE (InvoiceLine.create's default). Carried through a line EDIT so
   *  re-saving a bill does not silently re-tax a line the shop had excluded. */
  readonly taxable?: boolean;
}

export interface DraftInvoiceCommand {
  readonly orgId: OrgId;
  // Client-authored id (the store needs a stable id synchronously); preserved so the store's
  // local id === the server row id. Falls back to a fresh id for callers that don't supply one.
  readonly id?: InvoiceId;
  readonly leadId: LeadId;
  readonly title: string | null;
  readonly termsDays: number;
  readonly lines: readonly InvoiceLineInput[];
  /**
   * The job this lead-tied invoice is ABOUT, when there is one. Optional and null by default —
   * an ordinary manual invoice is about nothing but its customer.
   *
   * `sourceJobId` stays null on this path regardless: a drafted invoice is never "the bill for"
   * a job, and stamping it there would consume that job's one `invoices_org_source_job_uidx` slot.
   * See InvoiceProps.scopeJobId.
   */
  readonly scopeJobId?: JobId | null;
  /**
   * Discount and tax RATES in basis points, both optional and 0 by default — a hand-drafted
   * invoice usually has neither.
   *
   * They are rates, not amounts: the money is derived here through deriveTotals, the same chain
   * the quote the customer signed used and the same one create-invoice-from-job rebuilds a job's
   * bill with. The office sheet showed both controls and sent neither, so a discount was displayed
   * and the customer was billed the full amount, and a shop that typed its sales-tax rate ate the
   * tax.
   */
  readonly discBps?: number;
  readonly taxBps?: number;
}

// A standalone/manual invoice (no source job). Total is the sum of its line amounts.
export class DraftInvoiceUseCase {
  constructor(
    private readonly repo: InvoiceRepository,
    private readonly bus: EventBus,
    private readonly clock: Clock,
    private readonly ids: IdGenerator,
  ) {}

  async exec(cmd: DraftInvoiceCommand): Promise<Result<Invoice, AppError>> {
    if (cmd.lines.length === 0) {
      return err(validation("an invoice needs at least one line", "lines"));
    }

    const built: InvoiceLine[] = [];
    for (let i = 0; i < cmd.lines.length; i += 1) {
      const input = cmd.lines[i];
      if (!input) continue;
      const line = InvoiceLine.create({
        id: this.ids.newId(),
        sourceJobLineId: null,
        description: input.description,
        quantity: input.quantity,
        rate: money(input.rateCents),
        cost: money(input.costCents),
        taxable: input.taxable,
        position: i,
      });
      if (!isOk(line)) return line;
      built.push(line.value);
    }
    // discount -> net -> tax -> total, each step rounded to whole cents. NOT a plain line sum:
    // tax is part of the total and the discount comes off before it, and the tax base is the
    // TAXABLE lines only — an exempt line is still billed in full, it is just not taxed.
    const rates = { discBps: cmd.discBps ?? 0, taxBps: cmd.taxBps ?? 0, depBps: 0 };
    const derived = deriveTotals(
      money(built.reduce((sum, line) => sum + line.amount(), 0)),
      money(built.reduce((sum, line) => (line.props.taxable ? sum + line.amount() : sum), 0)),
      rates,
    );

    const now = this.clock.now();
    const num = await this.repo.nextNumber();
    const invoice = Invoice.create({
      id: cmd.id ?? asInvoiceId(this.ids.newId()),
      orgId: cmd.orgId,
      num,
      sourceJobId: null,
      scopeJobId: cmd.scopeJobId ?? null,
      leadId: cmd.leadId,
      title: cmd.title,
      status: "draft",
      total: derived.total,
      taxBps: rates.taxBps,
      tax: derived.tax,
      discBps: rates.discBps,
      discount: derived.discount,
      depositPaid: zeroMoney,
      amountPaid: zeroMoney,
      payments: [],
      lines: built,
      termsDays: cmd.termsDays,
      sentAt: null,
      dueAt: null,
      createdAt: now,
      updatedAt: now,
    });
    if (!isOk(invoice)) return invoice;

    // insertNew, NOT save. `save` is an upsert, and this is the one path that mints an invoice from
    // an id the CLIENT chose — so used here it made that id a write primitive aimed at any invoice
    // in the org. A collision is refused loudly rather than silently overwriting or silently
    // succeeding; the caller may re-read and decide (RaiseVisitFeeUseCase does exactly that).
    const inserted = await this.repo.insertNew(invoice.value);
    if (!inserted) {
      return err(conflict("an invoice with that id already exists"));
    }
    await this.bus.emit({
      name: "invoice.drafted",
      orgId: cmd.orgId,
      payload: { invoiceId: invoice.value.props.id, leadId: cmd.leadId, num },
      occurredAt: now,
    });
    return ok(invoice.value);
  }
}
