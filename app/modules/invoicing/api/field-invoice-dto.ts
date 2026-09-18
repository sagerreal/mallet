import { z } from "zod";
import { PAYMENT_METHODS, type PaymentMethod } from "../domain/payment";
import { INVOICE_STATUSES, type Invoice, type InvoiceStatus } from "../domain/invoice";

const statusEnum = z.enum(INVOICE_STATUSES as unknown as [InvoiceStatus, ...InvoiceStatus[]]);
const methodEnum = z.enum(PAYMENT_METHODS as unknown as [PaymentMethod, ...PaymentMethod[]]);
const moneyDTO = z.object({ cents: z.number().int(), currency: z.literal("USD") });

/**
 * One bill line as a technician may see it.
 *
 * `cost` is ABSENT FROM THE SHAPE, not nulled — internal cost is never a technician's business at
 * any setting, and a field that cannot be sent cannot be sent by accident. `rate` is nullable
 * because it follows the shop's `techSeesPrice`, where null means "hidden from you" and is
 * deliberately distinguishable from a genuine $0.
 */
const fieldLineDTO = z.object({
  id: z.string().uuid(),
  description: z.string(),
  quantity: z.number(),
  rate: moneyDTO.nullable(),
  /** Does this line take sales tax. Not a price, so it rides even when rates are hidden — the
   *  close-out document marks it exactly as the customer's own copy does. */
  taxable: z.boolean(),
  position: z.number().int(),
});

const fieldPaymentDTO = z.object({
  id: z.string().uuid(),
  amount: moneyDTO,
  method: methodEnum,
  receivedAt: z.string(),
});

/**
 * The invoice as it crosses to a technician's device. A SEPARATE shape from `invoiceDTO`, never a
 * filtered copy of it — a redaction expressed as a subtraction is one careless spread away from
 * being undone, and every key below had to be argued for.
 *
 * ALWAYS PRESENT, whatever `techSeesPrice` says: `total`, `due`, `depositPaid`, `amountPaid`,
 * `tax`, and `payments[].amount`. You cannot collect $840 at the door without displaying "$840",
 * so in a price-hidden shop the technician sees "Balance due $840 — collect" and no per-line
 * breakdown. That is the whole point of the setting surviving here at line level and not above it.
 *
 * DELIBERATELY OMITTED, and each for its own reason:
 *   • `cost`               — see fieldLineDTO. Unconditional.
 *   • `publicToken` / `publicUrl` — a 256-bit UNAUTHENTICATED bearer credential for the customer's
 *     invoice. Handing every technician a permanent one is a credential leak, not a convenience.
 *   • `authorization`      — the signed-amount check and its overage banner are an office control.
 *   • `poNumber`, `taxBps`, `followUpOn`, `followUpStage` — collections policy and paperwork the
 *     field surface has no use for. Absent because unused, which is the cheapest kind of safe.
 */
export const fieldInvoiceDTO = z.object({
  id: z.string().uuid(),
  num: z.string(),
  sourceJobId: z.string().uuid().nullable(),
  /** The job this bill is about when it is not its bill — the visit fee's authorizing job. */
  scopeJobId: z.string().uuid().nullable(),
  leadId: z.string().uuid(),
  customerName: z.string().nullable(),
  /**
   * WHERE the work happened and WHEN — the two facts that make the close-out sheet a DOCUMENT.
   *
   * Argued for like every other key here: what a technician shows the customer at the door is that
   * customer's own copy of the bill, rendered by the same <InvoiceDocument> as `/i/<token>`. A copy
   * that omits the service address and the service date is not the same document. Neither is new
   * information to the person being handed it — it is their address and the day work was done at
   * it — and the technician is standing there. Both are null far more often than not; the document
   * omits the row rather than printing an empty label.
   */
  serviceAddress: z.string().nullable(),
  serviceAt: z.string().nullable(),
  title: z.string().nullable(),
  status: statusEnum,
  /** Tax-INCLUSIVE — `tax` says how much of it is tax, it is not added on top. */
  total: moneyDTO,
  tax: moneyDTO,
  /** What came off the line sum before tax. The close-out sheet renders the SAME document as
   *  the customer's page, so it has to be able to state the discount too. */
  discount: moneyDTO,
  depositPaid: moneyDTO,
  amountPaid: moneyDTO,
  due: moneyDTO,
  termsDays: z.number().int(),
  lines: z.array(fieldLineDTO),
  payments: z.array(fieldPaymentDTO),
  sentAt: z.string().nullable(),
  dueAt: z.string().nullable(),
  createdAt: z.string(),
});

export type FieldInvoiceDTO = z.infer<typeof fieldInvoiceDTO>;

const money$ = (cents: number) => ({ cents, currency: "USD" as const });
const iso = (d: Date | null) => d?.toISOString() ?? null;

/**
 * WHO was billed, WHERE and WHEN — the three document facts that are not on the invoice row.
 *
 * Grouped rather than passed as three more positional arguments: all three are null-in-practice
 * (a deleted lead, an addressless lead, a bill with no completed visit), and three nullable
 * positional arguments in a row is a call site where a swap compiles silently.
 */
export interface FieldInvoiceParty {
  readonly customerName: string | null;
  readonly serviceAddress: string | null;
  readonly serviceAt: Date | null;
}

/**
 * Build the technician's view of an invoice.
 *
 * `seesPrice` governs line rates ONLY. Owner/office callers of the field router pass `true` — they
 * already hold the office surface, and a narrower answer here would be a downgrade with no
 * security value.
 */
export const toFieldInvoiceDTO = (
  invoice: Invoice,
  party: FieldInvoiceParty,
  seesPrice: boolean,
): FieldInvoiceDTO => {
  const p = invoice.props;
  return {
    id: p.id,
    num: p.num,
    sourceJobId: p.sourceJobId,
    scopeJobId: p.scopeJobId,
    leadId: p.leadId,
    customerName: party.customerName,
    serviceAddress: party.serviceAddress,
    serviceAt: iso(party.serviceAt),
    title: p.title,
    status: p.status,
    total: money$(p.total),
    tax: money$(p.tax),
    discount: money$(p.discount),
    depositPaid: money$(p.depositPaid),
    amountPaid: money$(p.amountPaid),
    due: money$(invoice.due()),
    termsDays: p.termsDays,
    lines: p.lines.map((line) => ({
      id: line.props.id,
      description: line.props.description,
      quantity: line.props.quantity,
      // Null, never 0: the client must be able to tell "hidden from you" from "free".
      rate: seesPrice ? money$(line.props.rate) : null,
      taxable: line.props.taxable,
      position: line.props.position,
    })),
    payments: p.payments.map((pay) => ({
      id: pay.props.id,
      amount: money$(pay.props.amount),
      method: pay.props.method,
      receivedAt: pay.props.receivedAt.toISOString(),
    })),
    sentAt: iso(p.sentAt),
    dueAt: iso(p.dueAt),
    createdAt: p.createdAt.toISOString(),
  };
};
