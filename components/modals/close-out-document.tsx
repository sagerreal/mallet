/**
 * components/modals/close-out-document.tsx
 *
 * The customer's copy of the bill, at the door. Two controls, both optional, neither automatic:
 *
 *   • SHOW IT — expand the itemised document in-flow and turn the phone around.
 *   • SEND IT — put it in the customer's texts or inbox, server-side.
 *
 * The gap this closes: on a cash-at-the-door close-out the customer used to receive nothing at
 * all. The whole money display was one line — "INV-1852 · $185 due now" — and they handed over
 * cash against a number on someone else's phone. No document, no receipt, no message.
 *
 * NO SIGNATURE, and deliberately. The artifact is what was missing, not a ceremony: the price was
 * agreed at booking, the quote path already captures a real priced authorisation before the work
 * (modules/quoting/domain/signature.ts), and no competitor signs an INVOICE. A "work was done"
 * mark here would also be actively harmful — DrizzleAuthorizationReader.forJob reads jobs.signer_*
 * as the GOVERNING priced authorisation with precedence over the estimate, so a zero-valued
 * snapshot written there would flag every legitimate bill as unsigned.
 *
 * Split out of close-out-modal.tsx, which is already 1,500 lines.
 */

"use client";

import { useState } from "react";
import { InvoiceDocument } from "@/components/shared/invoice-document";
import { invoiceDocumentView } from "@/features/invoices/invoice-document-view";
import { documentIdentity } from "@/features/invoices/document-business";
import { sendInvoiceDocument } from "@/lib/store/invoice-write";
import { invDue } from "@/lib/store/invoice-balance";
import { useAppStore } from "@/lib/store/app-store";
import type { Invoice } from "@/lib/store/types";

/** What the tech is handed back after a send, so "Sent" can say WHERE it went. */
type SendState =
  | { kind: "idle" }
  | { kind: "sending" }
  | { kind: "sent"; channel: "sms" | "email" }
  | { kind: "failed"; message: string };

const SENT_COPY: Readonly<Record<"sms" | "email", string>> = {
  sms: "Sent by text.",
  email: "Sent by email.",
};

export interface SendDocumentButtonProps {
  readonly invoice: Invoice;
}

/**
 * "Send the invoice" / "Send the receipt" — the option, never the automatic act. Owen's rule:
 * give the option to send, do not send for them.
 *
 * The verb follows the invoice's balance so the button says what the server will actually do. The
 * server decides the channel and the copy for itself; this only reports the outcome.
 *
 * A FAILED SEND SAYS SO, in place, with the server's own sentence and a retry. Never a silent
 * failure and never a false "Sent" — an unconfigured channel, a customer with no phone and no
 * email, and a provider rejection all surface here (see assertDelivered).
 */
export function SendDocumentButton({ invoice }: SendDocumentButtonProps) {
  const [state, setState] = useState<SendState>({ kind: "idle" });
  const settled = invDue(invoice) <= 0;
  const label = settled ? "Send the receipt" : "Send the invoice";

  async function send() {
    if (state.kind === "sending") return;
    setState({ kind: "sending" });
    try {
      const { channel } = await sendInvoiceDocument(invoice.id);
      setState({ kind: "sent", channel });
    } catch (e) {
      setState({
        kind: "failed",
        message: e instanceof Error ? e.message : "Couldn't send it — check your connection and try again.",
      });
    }
  }

  return (
    <>
      <button className="btn sm" disabled={state.kind === "sending"} onClick={send}>
        {state.kind === "sending" ? "Sending…" : state.kind === "sent" ? "Send again" : label}
      </button>
      {state.kind === "sent" ? (
        <span className="muted" style={{ fontSize: "var(--type-sm)" }}>
          {SENT_COPY[state.channel]}
        </span>
      ) : null}
      {state.kind === "failed" ? (
        <p
          role="alert"
          style={{
            color: "var(--red)",
            fontSize: "var(--type-sm)",
            fontWeight: 600,
            width: "100%",
            margin: "var(--space-1) 0 0",
          }}
        >
          {state.message}
        </p>
      ) : null}
    </>
  );
}

export interface CloseOutDocumentProps {
  readonly invoice: Invoice;
}

/**
 * The document row under the due card: show it, send it.
 *
 * SHOW is offered only when there are line items to show. In a `techSeesPrice: false` shop the
 * server nulls every per-line rate and the DTO mapper drops the lines entirely, so a technician's
 * record genuinely cannot build the itemised view — and the honest answer is to offer no button
 * rather than an empty document. (Putting the customer's `publicUrl` into the field DTO would fix
 * it and is forbidden: that is a 256-bit unauthenticated bearer credential, and handing every
 * technician a permanent one is a credential leak. See field-invoice-dto.ts.)
 *
 * SEND is offered regardless, and works in those same shops — the send is entirely server-side and
 * never needs the technician to see a price.
 *
 * Both are absent on a bill with no money on it: there is nothing to show a customer and nothing
 * to send them.
 */
export function CloseOutDocument({ invoice }: CloseOutDocumentProps) {
  const [open, setOpen] = useState(false);
  // WHO billed the customer. `documentIdentity`, not `documentContact`: this sheet has no branded
  // header of its own, so the shop's name has to come from inside the document. Null until
  // BusinessIdentityHydrator lands — a technician's store never had these facts at all before
  // v1.settings.businessIdentity, and the block is omitted rather than half-printed.
  const business = useAppStore((s) => s.business);

  if ((invoice.total ?? 0) <= 0) return null;

  const doc = invoiceDocumentView(invoice, documentIdentity(business));
  const canShow = doc.lines.length > 0;

  return (
    <div style={{ marginTop: "var(--space-2)" }}>
      <div style={{ display: "flex", gap: "var(--space-2)", flexWrap: "wrap", alignItems: "center" }}>
        {canShow ? (
          <button className="btn sm" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
            {open ? "Hide the invoice" : "Show the invoice"}
          </button>
        ) : null}
        <SendDocumentButton invoice={invoice} />
      </div>

      {/* Expands IN-FLOW, anchored under its own control — no popover, no floating inset. */}
      {open ? (
        <div className="reqcard" style={{ marginTop: "var(--space-2)" }}>
          <InvoiceDocument
            num={invoice.num}
            business={doc.business}
            dates={doc.dates}
            parties={doc.parties}
            termsFace={doc.termsFace}
            title={invoice.title}
            lines={doc.lines}
            totalCents={doc.totalCents}
            taxCents={doc.taxCents}
            depositPaidCents={doc.depositPaidCents}
            amountPaidCents={doc.amountPaidCents}
            balanceDueCents={doc.balanceDueCents}
          />
        </div>
      ) : null}
    </div>
  );
}
