import type {
  InvoiceId,
  OrgId,
  LeadId,
  JobId,
  Money,
  Result,
  ValidationError,
} from "@mallet/shared/types";
import { money, addMoney, zeroMoney, validation, ok, err } from "@mallet/shared/types";
import type { Payment } from "./payment";
import type { InvoiceLine } from "./invoice-line";

export type InvoiceStatus = "draft" | "sent" | "partial" | "paid" | "void";

export const INVOICE_STATUSES: readonly InvoiceStatus[] = [
  "draft",
  "sent",
  "partial",
  "paid",
  "void",
];

export const isInvoiceStatus = (value: string): value is InvoiceStatus =>
  (INVOICE_STATUSES as readonly string[]).includes(value);

const MS_PER_DAY = 24 * 60 * 60 * 1000;

export interface InvoiceProps {
  readonly id: InvoiceId;
  readonly orgId: OrgId;
  readonly num: string; // per-org "INV-<n>"
  readonly sourceJobId: JobId | null;
  readonly leadId: LeadId;
  readonly title: string | null;
  readonly status: InvoiceStatus;
  readonly total: Money; // snapshot from the source job — never re-derived from lines
  /**
   * The tax split of `total`, carried from the job that was billed.
   *
   * `total` is tax-INCLUSIVE, so these describe it rather than adding to it. Recording the split is
   * what lets the document itemise tax and lets QuickBooks be told which part of the money is
   * revenue and which is a liability — sent as one lump they are wrong in the books and wrong on a
   * filing.
   */
  readonly taxBps: number;
  readonly tax: Money;
  readonly depositPaid: Money; // already-collected deposit (e.g. from the accepted estimate)
  readonly amountPaid: Money; // denormalized running sum of the payments ledger
  readonly payments: readonly Payment[];
  readonly lines: readonly InvoiceLine[];
  readonly termsDays: number;
  readonly sentAt: Date | null;
  readonly dueAt: Date | null;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

export interface InvoiceMetadataPatch {
  readonly leadId?: LeadId;
  readonly title?: string | null;
  readonly termsDays?: number;
  readonly depositPaid?: Money;
}

// A bill for completed work. Aggregate root over its payment ledger + display lines. Money is
// integer cents; the balance due is always derived (total − deposit − amountPaid, clamped ≥ 0).
// The total is a snapshot taken at creation, NOT recomputed from lines.
/**
 * Input to Invoice.create. The tax split may be omitted: most invoices are drafted by hand and no
 * tax was ever computed for them, which is different from a computed split that happens to be zero.
 */
export type InvoiceCreateProps = Omit<InvoiceProps, "taxBps" | "tax"> & {
  readonly taxBps?: number;
  readonly tax?: Money;
};

export class Invoice {
  private constructor(private readonly p: InvoiceProps) {}

  static create(props: InvoiceCreateProps): Result<Invoice, ValidationError> {
    const num = props.num.trim();
    if (num.length === 0) return err(validation("invoice number is required", "num"));
    if (!isInvoiceStatus(props.status)) {
      return err(validation(`unknown invoice status: ${props.status}`, "status"));
    }
    if (props.total < 0) return err(validation("invoice total cannot be negative", "total"));
    const taxBps = props.taxBps ?? 0;
    const tax = props.tax ?? zeroMoney;
    if (!Number.isInteger(taxBps) || taxBps < 0) {
      return err(validation("tax bps cannot be negative", "taxBps"));
    }
    // Tax is a PART of the total, never an addition to it. A caller that mistook `total` for a
    // pre-tax subtotal fails here rather than in somebody's books.
    if (tax < 0 || tax > props.total) {
      return err(validation("tax cannot exceed the invoice total", "tax"));
    }
    if (props.depositPaid < 0 || props.depositPaid > props.total) {
      return err(validation("deposit must be between 0 and the total", "depositPaid"));
    }
    if (props.amountPaid < 0) return err(validation("amount paid cannot be negative", "amountPaid"));
    if (props.termsDays < 0) return err(validation("terms days cannot be negative", "termsDays"));
    return ok(new Invoice({ ...props, num, taxBps, tax }));
  }

  // Remaining balance, clamped at zero (an overpayment never shows negative).
  due(): Money {
    return money(Math.max(0, this.p.total - this.p.depositPaid - this.p.amountPaid));
  }

  isOverdue(now: Date): boolean {
    return (
      (this.p.status === "sent" || this.p.status === "partial") &&
      this.p.dueAt !== null &&
      this.p.dueAt < now
    );
  }

  canSend(): boolean {
    return this.p.status === "draft";
  }

  // draft → sent, stamping the due date. Idempotent: re-sending a sent invoice is a no-op.
  send(now: Date): Result<Invoice, ValidationError> {
    if (this.p.status === "sent") return ok(this);
    if (!this.canSend()) return err(validation("only a draft invoice can be sent", "status"));
    const dueAt = new Date(now.getTime() + this.p.termsDays * MS_PER_DAY);
    return ok(new Invoice({ ...this.p, status: "sent", sentAt: now, dueAt, updatedAt: now }));
  }

  // Append a settled payment to the ledger, bump the denormalized total, and recompute status.
  recordPayment(pay: Payment, now: Date): Result<Invoice, ValidationError> {
    if (this.p.status === "void") {
      return err(validation("cannot record a payment on a void invoice", "status"));
    }
    const amountPaid = addMoney(this.p.amountPaid, pay.props.amount);
    const remaining = Math.max(0, this.p.total - this.p.depositPaid - amountPaid);
    const status: InvoiceStatus =
      remaining === 0 ? "paid" : amountPaid > 0 ? "partial" : this.p.status;
    return ok(
      new Invoice({
        ...this.p,
        amountPaid,
        payments: [...this.p.payments, pay],
        status,
        updatedAt: now,
      }),
    );
  }

  // Any non-paid invoice can be voided; a paid invoice cannot.
  void(now: Date): Result<Invoice, ValidationError> {
    if (this.p.status === "paid") return err(validation("a paid invoice cannot be voided", "status"));
    if (this.p.status === "void") return ok(this);
    return ok(new Invoice({ ...this.p, status: "void", updatedAt: now }));
  }

  // Replace the display lines — only while still a draft (frozen once sent).
  withLines(lines: readonly InvoiceLine[], now: Date): Result<Invoice, ValidationError> {
    if (this.p.status !== "draft") {
      return err(validation("lines can only be edited on a draft", "status"));
    }
    return ok(new Invoice({ ...this.p, lines, updatedAt: now }));
  }

  // Edit header metadata on an open invoice (draft | sent | partial). Frozen once paid/void.
  // Undefined fields keep their current value; re-runs create() so every invariant
  // (deposit ≤ total, termsDays ≥ 0) is re-checked.
  editMetadata(patch: InvoiceMetadataPatch, now: Date): Result<Invoice, ValidationError> {
    if (this.p.status === "paid" || this.p.status === "void") {
      return err(validation("a paid or void invoice cannot be edited", "status"));
    }
    return Invoice.create({
      ...this.p,
      leadId: patch.leadId ?? this.p.leadId,
      title: patch.title === undefined ? this.p.title : patch.title,
      termsDays: patch.termsDays ?? this.p.termsDays,
      depositPaid: patch.depositPaid ?? this.p.depositPaid,
      updatedAt: now,
    });
  }

  // Replace display lines AND recompute the total from their amounts. For open invoices
  // (draft | sent | partial). This DIFFERS from withLines, which keeps the snapshot total
  // and is draft-only — that path stays for the create/draft flow.
  editLines(lines: readonly InvoiceLine[], now: Date): Result<Invoice, ValidationError> {
    if (this.p.status === "paid" || this.p.status === "void") {
      return err(validation("a paid or void invoice cannot be edited", "status"));
    }
    const total = lines.reduce((sum, l) => addMoney(sum, l.amount()), zeroMoney);
    return Invoice.create({ ...this.p, lines, total, updatedAt: now });
  }

  get props(): InvoiceProps {
    return this.p;
  }
}
