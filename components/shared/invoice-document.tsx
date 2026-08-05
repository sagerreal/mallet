/**
 * components/shared/invoice-document.tsx
 *
 * THE invoice document — the itemised bill a customer reads. ONE component, three surfaces:
 *
 *   • app/(public)/i/[token]/page.tsx        the real customer page (server-rendered)
 *   • components/modals/cust-invoice-modal   the office's "Preview as customer"
 *   • components/modals/close-out-document   the tech turning the phone around at the door
 *
 * It was written twice before this file existed (the public page and the preview modal each had
 * their own line rows and their own totals), and the two had already drifted: the preview showed
 * no subtotal/tax split at all. A third copy for the close-out was the thing this extraction
 * exists to prevent.
 *
 * PURE PRESENTATION. No hooks, no handlers, no store — so it renders inside a server component
 * (the public page) and a client modal alike, with no "use client" boundary and no extra JS on
 * the page a customer actually loads.
 *
 * MONEY IS INTEGER CENTS, always. Two of the three callers hold DOLLARS (the Zustand store's
 * unit); they convert through features/invoices/invoice-document-view.ts, which is the one place
 * that conversion is written. A document states cents — `formatMoney` renders "$185.00", never a
 * rounded "$185", because a bill that disagrees with the ledger by 50¢ is a bill the customer
 * argues with.
 *
 * It does NOT render the branded header. Each surface owns its own identity chrome (the public
 * page's org badge, the preview's brand banner, the close-out's sheet head) and only the document
 * body is genuinely the same thing three times.
 *
 * WHAT MAKES IT A DOCUMENT rather than a pay page: three OPTIONAL prop groups — `business` (who
 * billed you), `dates` (when the work happened and when the bill was raised), `parties` (who was
 * billed and where). For a long time this printed line items and a Pay button and nothing else:
 * no company address, no phone, no licence, no customer name, no service address, no invoice date.
 * The three groups live HERE rather than on the public page so the shop's copy and the customer's
 * copy cannot drift, which is the reason this component was extracted in the first place.
 *
 * Every group is omittable and every FIELD inside one is optional. With all three absent the
 * output is byte-identical to what it was before they existed. The invariant that matters most:
 * NEVER PRINT A LABEL WITH NO VALUE. A blank "Service address:" is worse than no block at all —
 * it reads as a bug, and a customer who finds one stops trusting the numbers too.
 */

import type { ReactNode } from "react";
import { formatDate, formatDocDate, formatMoney } from "@/lib/format";

export interface InvoiceDocumentLine {
  readonly description: string;
  readonly quantity: number;
  /** The EXTENDED amount in integer cents (quantity × rate), computed by the caller. */
  readonly amountCents: number;
}

export interface InvoiceDocumentPayment {
  readonly amountCents: number;
  /** The domain PaymentMethod string — mapped to a customer-readable label below. */
  readonly method: string;
  /** ISO timestamp the money was received. */
  readonly receivedAt: string;
}

/**
 * WHO billed the customer — the block at the very top of the document.
 *
 * Every field is optional and an absent one prints NOTHING. That is the rule, not a nicety: a
 * document that prints "Licence:" with nothing after it reads as a bug, and a customer who spots
 * one stops trusting the rest of the page.
 *
 * `name` is optional ON PURPOSE and carries no boolean flag. The two surfaces that sit under a
 * branded header (the public page's `custhead`, the office preview's `CustHead`) already print the
 * shop's name an inch above this block, so they pass `business` WITHOUT `name`; a surface with no
 * branded chrome of its own passes it WITH one. A flag would have made "should the name show" a
 * question every caller answers wrongly at least once — an absent value cannot be rendered.
 */
export interface InvoiceDocumentBusiness {
  /** The shop's display name. Omitted where the surface's own branded header already prints it. */
  readonly name?: string;
  /** Street address of the business — NOT the service address, and NOT the routing origin. */
  readonly address?: string | null;
  /** The number a customer should call about this bill. */
  readonly phone?: string | null;
  /** The address a customer should email about this bill. */
  readonly email?: string | null;
  /** Website, as the shop writes it. */
  readonly site?: string | null;
  /** Contractor/trade licence. Rendered as "Lic. <value>" — the shop's own string, unparsed. */
  readonly license?: string | null;
}

/**
 * The dates a document of record states. All optional; an absent one is omitted from the strip.
 *
 * `serviceAt` is NEVER a fallback for `invoicedAt`. They answer different questions — when the work
 * happened vs when the bill was raised — and a customer may hand this page to an insurer or a
 * landlord. Printing the invoice date under a "Service" label would be stating something untrue on
 * a document someone else relies on, so a bill whose work date is unknown simply omits it.
 */
export interface InvoiceDocumentDates {
  /** When the invoice was raised (invoices.created_at). */
  readonly invoicedAt?: string | null;
  /** When the work was actually done — the source job's completed visit. */
  readonly serviceAt?: string | null;
  /** When payment is due. Omit when `termsFace` already carries the due date. */
  readonly dueAt?: string | null;
}

/**
 * WHO was billed and WHERE the work happened.
 *
 * `serviceAddress` is frequently null — most leads are created without one (see the comment on
 * `leads.address`) — and when it is, the whole "Service address" block is omitted rather than
 * rendered empty.
 */
export interface InvoiceDocumentParties {
  readonly customerName?: string | null;
  readonly serviceAddress?: string | null;
}

export interface InvoiceDocumentProps {
  /** "INV-1852". Omitted where the surface's own header already names the invoice. */
  readonly num?: string;
  /**
   * The shop's identity block, rendered above everything else. Omitted entirely when absent —
   * which is what every surface did before this existed, so leaving it off changes nothing.
   */
  readonly business?: InvoiceDocumentBusiness;
  /** Invoice/service/due dates for the meta strip. See InvoiceDocumentDates. */
  readonly dates?: InvoiceDocumentDates;
  /** Bill-to and service-address blocks. See InvoiceDocumentParties. */
  readonly parties?: InvoiceDocumentParties;
  /**
   * Customer-supplied purchase order number, appended to the meta strip as "PO 88-1191".
   * Omit when `termsFace` already carries it — termsLine() puts the PO on its own line.
   */
  readonly poNumber?: string | null;
  /** termsLine() output — "Net 30 · due Sep 2 · PO 4471". Empty means there is nothing to say. */
  readonly termsFace?: string;
  /** Rendered before the meta text — the public page's status pill. */
  readonly statusPill?: ReactNode;
  readonly title?: string | null;
  readonly lines: readonly InvoiceDocumentLine[];
  /** TAX-INCLUSIVE. `taxCents` says how much of it is tax, it is not added on top. */
  readonly totalCents: number;
  readonly taxCents: number;
  readonly depositPaidCents: number;
  readonly amountPaidCents: number;
  /**
   * null suppresses the row entirely. A voided bill owes nothing, so it states no balance —
   * printing "Balance due $0.00" on a canceled invoice reads as "settled", which it is not.
   */
  readonly balanceDueCents: number | null;
  /**
   * The individual payments, oldest first. What turns a pay page into a receipt the customer can
   * keep: an aggregate "Paid −$185.00" cannot say WHEN, HOW MUCH or BY WHAT MEANS. Surfaces whose
   * record carries no payment dates (the store's Payment has a clock time, not a date) pass none
   * and the aggregate row still stands.
   */
  readonly payments?: readonly InvoiceDocumentPayment[];
}

/** Customer-readable payment methods. An unknown method says "Payment", never the raw enum. */
const METHOD_LABEL: Readonly<Record<string, string>> = {
  card: "Card",
  card_terminal: "Card",
  ach: "Bank transfer",
  cash: "Cash",
  check: "Check",
};

const methodLabel = (method: string): string => METHOD_LABEL[method] ?? "Payment";

/**
 * A value worth printing, or null.
 *
 * ONE gate for the whole "never print a label with no value" rule. Null, undefined and a
 * whitespace-only string are all "not set" — the domain normalises blank to null on the way in,
 * but a store-fed surface can still hand over "" from a cleared input, and an empty label under a
 * heading is the documented failure mode this file exists to avoid.
 */
const present = (v: string | null | undefined): string | null => {
  const trimmed = (v ?? "").trim();
  return trimmed.length === 0 ? null : trimmed;
};

/**
 * The shop's identity, at the very top. Quiet by design: this is the return address on an
 * envelope, not a masthead — the customer already knows who they called.
 */
function BusinessBlock({ business }: { business: InvoiceDocumentBusiness }) {
  const name = present(business.name);
  const license = present(business.license);
  // Address / phone / email / site read as one contact paragraph; the licence sits under it
  // because it is a credential, not a way to reach anyone.
  const contact = [business.address, business.phone, business.email, business.site]
    .map(present)
    .filter((v): v is string => v !== null);

  if (!name && contact.length === 0 && !license) return null;

  return (
    <div style={{ marginBottom: "var(--space-3)" }}>
      {name && (
        <div style={{ fontWeight: 700, fontSize: "var(--type-base)" }}>{name}</div>
      )}
      {contact.map((entry) => (
        <div key={entry} className="muted" style={{ fontSize: "var(--type-sm)" }}>
          {entry}
        </div>
      ))}
      {license && (
        <div className="muted" style={{ fontSize: "var(--type-sm)" }}>
          Lic. {license}
        </div>
      )}
    </div>
  );
}

/**
 * Bill-to and service address, side by side on a wide page and stacked on a narrow one.
 *
 * Laid out with `flex-wrap` and a `minWidth` basis rather than a media query: the document renders
 * at 520px on the public page, inside a modal, and inside a technician's job sheet, and those three
 * widths are not the viewport's.
 */
function PartiesBlock({ parties }: { parties: InvoiceDocumentParties }) {
  const customerName = present(parties.customerName);
  const serviceAddress = present(parties.serviceAddress);
  if (!customerName && !serviceAddress) return null;

  return (
    <div
      style={{
        display: "flex",
        flexWrap: "wrap",
        gap: "var(--space-2) var(--space-6)",
        marginBottom: "var(--space-3)",
      }}
    >
      {customerName && <PartyCell label="Bill to" value={customerName} />}
      {serviceAddress && <PartyCell label="Service address" value={serviceAddress} />}
    </div>
  );
}

function PartyCell({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ minWidth: 180 }}>
      <div className="muted" style={{ fontSize: "var(--type-xs)", fontWeight: 700 }}>
        {label}
      </div>
      <div style={{ fontSize: "var(--type-sm)" }}>{value}</div>
    </div>
  );
}

/**
 * The one meta strip: "Invoice 1042 · Invoiced Aug 5, 2026 · Service Aug 3, 2026 · Net 30 ·
 * Due Aug 12, 2026 · PO 88-1191".
 *
 * `termsFace` sits between the service date and the due date because "Net 30" modifies the due
 * date it precedes. With no `dates` and no `poNumber` — every caller before this existed — the
 * strip collapses to exactly what it printed before: `Invoice {num} · {termsFace}`.
 */
function metaStrip(
  num: string | undefined,
  termsFace: string | undefined,
  dates: InvoiceDocumentDates | undefined,
  poNumber: string | null | undefined,
): string {
  const segments: string[] = [];
  if (num) segments.push(`Invoice ${num}`);
  if (present(dates?.invoicedAt)) segments.push(`Invoiced ${formatDocDate(dates?.invoicedAt)}`);
  if (present(dates?.serviceAt)) segments.push(`Service ${formatDocDate(dates?.serviceAt)}`);
  if (termsFace) segments.push(termsFace);
  if (present(dates?.dueAt)) segments.push(`Due ${formatDocDate(dates?.dueAt)}`);
  const po = present(poNumber);
  if (po) segments.push(`PO ${po}`);
  return segments.join(" · ");
}

interface TotalRowProps {
  readonly label: string;
  readonly cents: number;
  readonly negative?: boolean;
  readonly strong?: boolean;
}

function TotalRow({ label, cents, negative, strong }: TotalRowProps) {
  return (
    <div
      className="custline"
      style={
        strong
          ? { borderBottom: "none", fontWeight: 800, fontSize: "var(--type-md)" }
          : { borderBottom: "none" }
      }
    >
      <span className={strong ? undefined : "muted"}>{label}</span>
      <b style={strong ? undefined : { fontWeight: 600 }}>
        {negative ? `−${formatMoney(cents)}` : formatMoney(cents)}
      </b>
    </div>
  );
}

function DocumentLines({ lines }: { lines: readonly InvoiceDocumentLine[] }) {
  return (
    <>
      {lines.map((line, i) => (
        <div className="custline" key={i}>
          <span>
            {line.description}
            {line.quantity !== 1 ? ` × ${line.quantity}` : ""}
          </span>
          <b>{formatMoney(line.amountCents)}</b>
        </div>
      ))}
    </>
  );
}

function DocumentPayments({ payments }: { payments: readonly InvoiceDocumentPayment[] }) {
  if (payments.length === 0) return null;
  return (
    <div style={{ marginTop: "var(--space-3)" }}>
      <div className="muted" style={{ fontSize: "var(--type-sm)", fontWeight: 700 }}>
        Payments received
      </div>
      {payments.map((payment, i) => (
        <div className="custline" key={i} style={{ borderBottom: "none" }}>
          <span className="muted">
            {formatDate(payment.receivedAt)} · {methodLabel(payment.method)}
          </span>
          <b style={{ fontWeight: 600 }}>{formatMoney(payment.amountCents)}</b>
        </div>
      ))}
    </div>
  );
}

export function InvoiceDocument({
  num,
  business,
  dates,
  parties,
  poNumber,
  termsFace,
  statusPill,
  title,
  lines,
  totalCents,
  taxCents,
  depositPaidCents,
  amountPaidCents,
  balanceDueCents,
  payments = [],
}: InvoiceDocumentProps) {
  // Total is tax-INCLUSIVE, so the subtotal is what is left once the recorded tax comes out —
  // never a re-sum of the lines (an invoice raised from a quote carries the agreed total with no
  // lines at all, and a line-derived subtotal would print $0.00 under a four-figure bill).
  const subtotalCents = totalCents - taxCents;
  const meta = metaStrip(num, termsFace, dates, poNumber);

  return (
    <>
      {business && <BusinessBlock business={business} />}

      {(statusPill || meta) && (
        <div
          style={{
            display: "flex",
            alignItems: "center",
            flexWrap: "wrap",
            gap: "var(--space-2)",
            marginBottom: "var(--space-3)",
          }}
        >
          {statusPill}
          {meta && (
            <span className="muted" style={{ fontSize: "var(--type-sm)" }}>
              {meta}
            </span>
          )}
        </div>
      )}

      {parties && <PartiesBlock parties={parties} />}

      {title && (
        <p style={{ fontSize: "var(--type-base)", lineHeight: 1.55, marginBottom: "var(--space-2)" }}>
          {title}
        </p>
      )}

      <DocumentLines lines={lines} />

      {/* Totals — the balance math the domain computed, never re-derived here. */}
      <div style={{ marginTop: "var(--space-3)" }}>
        {taxCents > 0 && (
          <>
            <TotalRow label="Subtotal" cents={subtotalCents} />
            <TotalRow label="Tax" cents={taxCents} />
          </>
        )}
        <TotalRow label="Total" cents={totalCents} />
        {depositPaidCents > 0 && <TotalRow label="Deposit credit" cents={depositPaidCents} negative />}
        {amountPaidCents > 0 && <TotalRow label="Paid" cents={amountPaidCents} negative />}
        {balanceDueCents !== null && <TotalRow label="Balance due" cents={balanceDueCents} strong />}
      </div>

      <DocumentPayments payments={payments} />
    </>
  );
}
