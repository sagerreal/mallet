/**
 * app/(public)/i/[token]/page.tsx
 *
 * Public customer invoice page — no auth, no office chrome.
 * URL: /i/<64-hex-char-token>   (minted on first send, 256 bits of entropy)
 *
 * Server component: calls getPublicInvoice(token) via the invoicing module (same pattern as
 * /q/[token] — it does NOT go through tRPC) and renders a mobile-first branded invoice: lines,
 * totals with deposit credit and payments, status pill, Net terms, PO number. The one
 * interaction — Pay — is the PayInvoiceButton client island, shown ONLY when there is a balance,
 * the shop can take cards, and the invoice is open (sent|partial). Paid renders as a receipt.
 *
 * Reuses custhead / custbody / custline CSS from prototype.css (same visual DNA as the public
 * quote page) but as a full page, not a modal.
 *
 * Unknown token → friendly "link is no longer valid" page.
 */

import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getPublicInvoice } from "@/modules/invoicing/app/public-invoice";
import type { PublicInvoiceView } from "@/modules/invoicing/app/public-invoice";
import { termsLine } from "@/features/invoices/terms-line";
import { InvoiceDocument } from "@/components/shared/invoice-document";
import { PayInvoiceButton } from "./PayInvoiceButton";

// Token format: 64 hex chars. Validate before hitting the DB.
const TOKEN_RE = /^[0-9a-f]{64}$/i;

interface Params {
  token: string;
}

export async function generateMetadata({
  params,
}: {
  params: Promise<Params>;
}): Promise<Metadata> {
  const { token } = await params;
  if (!TOKEN_RE.test(token)) return { title: "Invoice — Mallet" };
  const view = await getPublicInvoice(token);
  if (!view) return { title: "Invoice — Mallet" };
  return {
    title: `Invoice from ${view.orgName}`,
    description: `View and pay your invoice from ${view.orgName}.`,
    robots: { index: false, follow: false },
  };
}

// ---- status pill -------------------------------------------------------------

const STATUS_PILL: Record<PublicInvoiceView["status"], { label: string; tone: string }> = {
  draft: { label: "Draft", tone: "gray" },
  sent: { label: "Due", tone: "amber" },
  partial: { label: "Partly paid", tone: "blue" },
  paid: { label: "Paid", tone: "green" },
  void: { label: "Canceled", tone: "gray" },
};

// ---- page ----------------------------------------------------------------------

export default async function PublicInvoicePage({
  params,
}: {
  params: Promise<Params>;
}) {
  const { token } = await params;

  // Bad token format — 404 immediately.
  if (!TOKEN_RE.test(token)) {
    notFound();
  }

  const view = await getPublicInvoice(token);

  if (!view) {
    // Token valid format but no match — friendly not-found page (mirrors /q).
    return (
      <main
        style={{
          minHeight: "100vh",
          background: "var(--bg)",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          padding: "var(--space-6) var(--space-5)",
        }}
      >
        <div style={{ maxWidth: 400, textAlign: "center" }}>
          <div style={{ fontSize: "var(--type-3xl)", marginBottom: "var(--space-4)", color: "var(--ink-3)" }}>
            &#x2014;
          </div>
          <h1
            style={{
              fontFamily: "var(--font-display)",
              fontSize: "var(--type-xl)",
              fontWeight: 700,
              marginBottom: "var(--space-3)",
            }}
          >
            This invoice link is no longer valid
          </h1>
          <p className="muted" style={{ fontSize: "var(--type-base)", lineHeight: 1.6 }}>
            The link may have expired or been revoked. Contact the business directly for a copy of
            your invoice.
          </p>
          <p style={{ fontSize: "var(--type-xs)", color: "var(--ink-3)", marginTop: "var(--space-8)" }}>
            Powered by Mallet
          </p>
        </div>
      </main>
    );
  }

  // Derive initials from org name for the brand badge (same as /q).
  const initials = view.orgName
    .split(/\s+/)
    .slice(0, 2)
    .map((w) => w[0] ?? "")
    .join("")
    .toUpperCase();

  const isPaid = view.status === "paid";
  const isVoid = view.status === "void";
  const pill = STATUS_PILL[view.status];
  const dueAtIso = view.dueAt?.toISOString() ?? null;
  // Net terms + due date + PO — ONE source of truth shared with the office sheet and the
  // customer preview modal (features/invoices/terms-line.ts). Net/due are suppressed once
  // settled (paid/void) — a due date is meaningless on a receipt — but the PO number is a
  // permanent reference and stays on the line regardless of status.
  const line = termsLine({
    termsDays: isPaid || isVoid ? 0 : view.termsDays,
    dueAt: isPaid || isVoid ? null : dueAtIso,
    poNumber: view.poNumber,
  });

  // The Pay button exists ONLY when there is money to take, the shop can take it, and the
  // invoice is open. Everything else renders as a statement/receipt.
  const payable =
    view.balanceDueCents > 0 &&
    view.chargesEnabled &&
    (view.status === "sent" || view.status === "partial");

  return (
    <main
      style={{
        minHeight: "100vh",
        background: "var(--bg)",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        padding: "0 0 var(--space-10)",
      }}
    >
      {/* Invoice card — max 520px, full-width on mobile */}
      <div
        style={{
          width: "100%",
          maxWidth: 520,
          background: "var(--card)",
          border: "1px solid var(--line)",
          borderRadius: "0 0 16px 16px",
          overflow: "hidden",
          boxShadow: "var(--shadow)",
        }}
      >
        {/* Branded header */}
        <div className="custhead">
          <div className="custlogo">{initials}</div>
          <div style={{ flex: 1 }}>
            <div style={{ fontWeight: 800, fontSize: "var(--type-lg)" }}>{view.orgName}</div>
            <div style={{ fontSize: "var(--type-sm)", opacity: 0.8 }}>Invoice {view.num}</div>
          </div>
        </div>

        {/* Body */}
        <div className="custbody">
          {/* A settled invoice states its outcome ABOVE the document, never instead of it —
              the customer keeps the itemized record they paid against. */}
          {isPaid && (
            <>
              <div className="deltabanner" style={{ textAlign: "center" }}>
                Paid — thank you!
              </div>
              <p
                className="muted"
                style={{ textAlign: "center", margin: "var(--space-2) 0 var(--space-4)", fontSize: "var(--type-base)" }}
              >
                This invoice is settled in full. Keep this link for your records.
              </p>
            </>
          )}
          {isVoid && (
            <div className="reqcard" style={{ textAlign: "center", marginBottom: "var(--space-4)" }}>
              This invoice was canceled — nothing is owed on it.
            </div>
          )}

          {/* THE document — the same component the office preview and the technician's
              close-out render, so the customer's copy cannot drift from the shop's.
              Meta line: status pill · invoice date · service date · Net terms once sent · PO when
              the customer issued one.
              The invoice NUMBER is omitted here — the branded header above already states it, and
              so is the shop's NAME for the same reason: `business` carries the contact block only. */}
          <InvoiceDocument
            statusPill={<span className={`pill ${pill.tone}`}>{pill.label}</span>}
            business={view.business}
            dates={{
              invoicedAt: view.invoicedAt.toISOString(),
              // Omitted when there is no completed visit to state. NEVER the invoice date under a
              // "Service" label — see InvoiceDocumentDates.
              serviceAt: view.serviceAt?.toISOString() ?? null,
              // `termsFace` already carries "Net 30 · due Sep 2"; a second Due segment would
              // print the same date twice.
            }}
            parties={{ customerName: view.customerName, serviceAddress: view.serviceAddress }}
            termsFace={line}
            title={view.title}
            lines={view.lines.map((l) => ({
              description: l.description,
              quantity: l.quantity,
              amountCents: Math.round(l.quantity * l.rateCents),
            }))}
            totalCents={view.totalCents}
            taxCents={view.taxCents}
            depositPaidCents={view.depositPaidCents}
            amountPaidCents={view.amountPaidCents}
            // A canceled invoice owes nothing, so it states no balance at all.
            balanceDueCents={isVoid ? null : view.balanceDueCents}
            // What makes this keepable: the date, amount and method of every payment received.
            payments={view.payments.map((p) => ({
              amountCents: p.amountCents,
              method: p.method,
              receivedAt: p.receivedAt.toISOString(),
            }))}
          />

          {/* THE action — only when it can actually run */}
          {payable && <PayInvoiceButton token={token} balanceDueCents={view.balanceDueCents} />}

          {/* Open but not card-payable: say how to settle instead of showing nothing. */}
          {!payable && !isPaid && !isVoid && view.balanceDueCents > 0 && (
            <p
              className="muted"
              style={{ fontSize: "var(--type-sm)", textAlign: "center", marginTop: "var(--space-3)" }}
            >
              To pay this invoice, contact {view.orgName} directly.
            </p>
          )}

          {/* Footer */}
          <p className="muted" style={{ fontSize: "var(--type-xs)", textAlign: "center", marginTop: "var(--space-4)" }}>
            Powered by Mallet
          </p>
        </div>
      </div>
    </main>
  );
}
