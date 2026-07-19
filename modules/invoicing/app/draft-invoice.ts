import type { OrgId, LeadId, InvoiceId, Money, Result, AppError, Clock } from "@mallet/shared/types";
import { asInvoiceId, money, zeroMoney, addMoney, validation, ok, err, isOk } from "@mallet/shared/types";
import type { EventBus, IdGenerator } from "@mallet/shared/ports";
import { Invoice } from "../domain/invoice";
import { InvoiceLine } from "../domain/invoice-line";
import type { InvoiceRepository } from "../domain/invoice-repository";

export interface InvoiceLineInput {
  readonly description: string;
  readonly quantity: number;
  readonly rateCents: number;
  readonly costCents: number;
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
        position: i,
      });
      if (!isOk(line)) return line;
      built.push(line.value);
    }
    const total: Money = built.reduce((sum, line) => addMoney(sum, line.amount()), zeroMoney);

    const now = this.clock.now();
    const num = await this.repo.nextNumber();
    const invoice = Invoice.create({
      id: cmd.id ?? asInvoiceId(this.ids.newId()),
      orgId: cmd.orgId,
      num,
      sourceJobId: null,
      leadId: cmd.leadId,
      title: cmd.title,
      status: "draft",
      total,
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

    await this.repo.save(invoice.value);
    await this.bus.emit({
      name: "invoice.drafted",
      orgId: cmd.orgId,
      payload: { invoiceId: invoice.value.props.id, leadId: cmd.leadId, num },
      occurredAt: now,
    });
    return ok(invoice.value);
  }
}
