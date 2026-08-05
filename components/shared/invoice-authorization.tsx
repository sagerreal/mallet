"use client";

import type { InvoiceAuthorization } from "@/lib/store/types";
import { fmt$, formatDocDate } from "@/lib/format";

/**
 * What the customer signed, cited on the bill — and a warning when the bill outgrew it.
 *
 * The failure this exists to prevent: a shop quotes $20,000, the customer signs, the crew adds
 * $15,000 of work nobody signed for, and a $35,000 invoice goes out. The customer refuses the
 * excess with cause. Mallet used to be silent through every step of that, so the shop discovered
 * it at collection time — months after the moment a change order could still have been signed.
 *
 * Placed ABOVE the send/charge actions, deliberately. A warning that appears after the invoice is
 * sent is a post-mortem; the entire value is in the ten seconds before.
 *
 * Renders nothing when nothing was signed. That is not an oversight — an unsigned invoice has no
 * authorised amount to exceed, so there is no claim to make about it. Warning on every unsigned
 * bill would train people to dismiss this banner, and it only works while it stays rare.
 */

export interface InvoiceAuthorizationProps {
  readonly authorization: InvoiceAuthorization | undefined;
}

// Same "Aug 5, 2026" a document date carries — shared with the invoice document's meta strip via
// lib/format so the two dates on one bill cannot end up in two different formats.
const day = formatDocDate;

export function InvoiceAuthorizationNote({ authorization: a }: InvoiceAuthorizationProps) {
  if (!a) return null;

  const label = a.source === "job" ? "signed on site" : "signed quote";
  const cite = `Authorized by ${a.signerName}, ${day(a.signedAt)}${a.documentRef ? ` · ${label} ${a.documentRef}` : ` · ${label}`}`;

  if (!a.overage) {
    return (
      <div
        className="muted"
        style={{ fontSize: "var(--type-sm)", marginTop: "var(--space-3)", lineHeight: 1.5 }}
      >
        {cite}
      </div>
    );
  }

  return (
    <div
      role="alert"
      style={{
        marginTop: "var(--space-3)",
        border: "1.5px solid var(--red)",
        background: "var(--red-bg)",
        borderRadius: "var(--radius-sm)",
        padding: "var(--space-3)",
        fontSize: "var(--type-base)",
        lineHeight: 1.55,
        color: "var(--ink)",
      }}
    >
      <b>
        {fmt$(a.overage.excessCents / 100)} of this bill was never signed for.
      </b>{" "}
      {a.signerName} signed for {fmt$(a.overage.authorizedCents / 100)} on {day(a.signedAt)}
      {a.documentRef ? ` (${label} ${a.documentRef})` : ""}. This invoice is{" "}
      {fmt$(a.overage.invoicedCents / 100)}.
      {/* Names the fix, not just the problem — the shop can still get this signed today, and
          cannot once the customer has already refused to pay. */}
      <div style={{ marginTop: "var(--space-2)", color: "var(--ink-2)", fontSize: "var(--type-sm)" }}>
        Get the extra work approved before you send this, or the customer can refuse that part.
      </div>
    </div>
  );
}
