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
 */

import type { ReactNode } from "react";
import { formatDate, formatMoney } from "@/lib/format";

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

export interface InvoiceDocumentProps {
  /** "INV-1852". Omitted where the surface's own header already names the invoice. */
  readonly num?: string;
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
  const meta = num ? `Invoice ${num}${termsFace ? ` · ${termsFace}` : ""}` : (termsFace ?? "");

  return (
    <>
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
