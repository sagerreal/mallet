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
  /**
   * The job this bill is ABOUT, when it is not the job it was raised FROM. Null on almost every
   * invoice.
   *
   * Set only where the two genuinely differ: the visit fee on a declined estimate is lead-tied
   * (`sourceJobId: null`) so it does not consume the job's one `invoices_org_source_job_uidx`
   * slot — the customer may still accept a quote on that job, and its real bill needs the slot —
   * but a technician must still be able to collect it on the doorstep, which needs a job to
   * authorize against. This is that job, and authorization is the only thing it is for.
   *
   * Never a fallback for `sourceJobId`: it carries no uniqueness, so nothing may infer "the bill
   * for this job" from it.
   */
  readonly scopeJobId: JobId | null;
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
  /** Customer-supplied purchase order number, free text. Null when the customer didn't issue one. */
  readonly poNumber: string | null;
  /**
   * The unguessable credential for the public pay page (/i/<token>), 64 hex chars.
   *
   * Minted on FIRST send and stable thereafter — a re-send must never rotate a link the customer
   * already holds in a text thread. Null until the invoice has been sent (and on pre-migration
   * rows, which mint one on their next send).
   */
  readonly publicToken: string | null;
  /** Is the shop still chasing this invoice, and how many nudges in. Same client-local fate as
   *  the quote's — the toggle disagreed with whether reminders were actually going out. */
  readonly followUpOn?: boolean;
  readonly followUpStage?: number;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

export interface InvoiceMetadataPatch {
  readonly leadId?: LeadId;
  readonly title?: string | null;
  readonly termsDays?: number;
  readonly depositPaid?: Money;
  /**
   * Customer-supplied purchase order number. Undefined = keep current; explicit null (or a
   * blank/whitespace-only string) clears it. Trimmed before it reaches Invoice.create.
   */
  readonly poNumber?: string | null;
}

const PO_NUMBER_MAX_LEN = 64;

// A bill for completed work. Aggregate root over its payment ledger + display lines. Money is
// integer cents; the balance due is always derived (total − deposit − amountPaid, clamped ≥ 0).
// The total is a snapshot taken at creation, NOT recomputed from lines.
/**
 * Input to Invoice.create. The tax split may be omitted: most invoices are drafted by hand and no
 * tax was ever computed for them, which is different from a computed split that happens to be zero.
 */
export type InvoiceCreateProps = Omit<
  InvoiceProps,
  "taxBps" | "tax" | "poNumber" | "publicToken" | "scopeJobId"
> & {
  readonly taxBps?: number;
  readonly tax?: Money;
  // Both optional with a null default: most construction sites (drafts, job invoices) have
  // neither — the PO arrives from the customer later, the token is minted at send time.
  readonly poNumber?: string | null;
  readonly publicToken?: string | null;
  /**
   * Optional with a null default because almost nothing sets it: an ordinary bill is raised FROM
   * its job (`sourceJobId`) and has no separate scope. Only the visit-fee path passes one.
   */
  readonly scopeJobId?: JobId | null;
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
    if (props.poNumber != null && props.poNumber.length > PO_NUMBER_MAX_LEN) {
      return err(validation(`PO number cannot exceed ${PO_NUMBER_MAX_LEN} characters`, "poNumber"));
    }
    return ok(
      new Invoice({
        ...props,
        num,
        taxBps,
        tax,
        poNumber: props.poNumber ?? null,
        publicToken: props.publicToken ?? null,
        scopeJobId: props.scopeJobId ?? null,
      }),
    );
  }

  /**
   * Stamp the public pay-link token. WRITE-ONCE: an invoice that already carries one keeps it —
   * rotating the token would strand the link already texted to the customer. The repository
   * enforces the same rule in SQL (COALESCE on save), so even a racing double-send cannot rotate.
   */
  withPublicToken(token: string): Invoice {
    if (this.p.publicToken !== null) return this;
    return new Invoice({ ...this.p, publicToken: token });
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
    // Trim poNumber to null when blank — preserve null for "not set". Undefined keeps current.
    const poNumber =
      patch.poNumber === undefined ? this.p.poNumber : (patch.poNumber?.trim() || null);
    return Invoice.create({
      ...this.p,
      leadId: patch.leadId ?? this.p.leadId,
      title: patch.title === undefined ? this.p.title : patch.title,
      termsDays: patch.termsDays ?? this.p.termsDays,
      depositPaid: patch.depositPaid ?? this.p.depositPaid,
      poNumber,
      updatedAt: now,
    });
  }

  /**
   * Turn chasing on or off, and record how many nudges have gone out.
   *
   * Deliberately NOT gated on paid/void like editMetadata: the moment an invoice is paid is
   * exactly when the shop stops chasing it, and a gate would refuse the write that says so.
   */
  setFollowUp(on: boolean, stage: number, now: Date): Result<Invoice, ValidationError> {
    if (!Number.isInteger(stage) || stage < 0) {
      return err(validation("follow-up stage cannot be negative", "followUpStage"));
    }
    return Invoice.create({ ...this.p, followUpOn: on, followUpStage: stage, updatedAt: now });
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
