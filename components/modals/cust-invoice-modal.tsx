/**
 * components/modals/cust-invoice-modal.tsx
 * Faithful port of the prototype's openCustInv (5621) / renderCustInv (5626) /
 * custPayNow (5656) — the CUSTOMER-facing pay-invoice page, i.e. what the
 * customer sees when they open the pay link to review and settle the bill.
 *
 * This is a BRANDED customer surface (brand header, "thanks for having us out",
 * line-by-line bill, one fat pay button), distinct from the office invoice modal
 * (invoice-modal.tsx) which shows cost/margin. Money helpers (fmt$/invPaid/
 * invDue) are ported 1:1 from money/page.tsx + invoice-modal.tsx.
 *
 * Sheet grammar (PR #253): the brand banner IS the sticky .sheet-head (it keeps
 * its .custhead branding — the later rule wins padding/background, sheet-head
 * supplies stickiness and the edge bleed). Method chips and the editable amount
 * stay quiet in the body so the render stays faithful to what the customer
 * sees, but this modal is READ-ONLY — it never calls recordPayment. There is no
 * .sheet-foot: a preview has no terminal action to dock, so none is rendered.
 *
 * FIXED (the scout's HIGH finding): this used to fire recordPayment(invoice.id,
 * …) from a button labelled "Pay $X". Its one caller — invoice-modal.tsx's
 * "Preview as customer" — opens it for a LOOK, not a transaction, so an office
 * user tapping that button under a screen announcing itself as a preview was
 * recording a real ledger payment with no Stripe charge and no cash in hand.
 * The transacting path is removed, not hidden: a `.banner` says plainly that
 * this is a preview, and points back at the real Charge a card / Record a
 * payment actions that already exist on the invoice modal this was opened
 * from.
 *
 * ModalHost provides the outer shell + close affordance, so the `.custhead` is
 * rendered faithfully but WITHOUT a duplicate ✕ (the prototype's custCloseBtn()).
 *
 * DEFERRED: the "Your work, verified" photo-proof card (renderCustInv's `proof`
 * block) — needs checklist/verify state that isn't modeled here yet.
 */

"use client";

import { useState, useEffect } from "react";
import { api } from "@/lib/trpc/client";
import { dtoInvoiceToStore } from "@/lib/store/dto-mapper";
import { invDue } from "@/lib/store/invoice-balance";
import { useAppStore, useActiveModal } from "@/lib/store/app-store";
import type { Brand, Invoice, Job, Lead } from "@/lib/store/types";
import { fmt$ } from "@/lib/format";
// The ONE itemised invoice renderer (shared with /i/<token> and the field close-out) and the ONE
// store-dollars → document-cents adapter, which also builds the Net/due/PO face line.
import { InvoiceDocument } from "@/components/shared/invoice-document";
import { invoiceDocumentView } from "@/features/invoices/invoice-document-view";
import { documentContact } from "@/features/invoices/document-business";
import { ModalLoading } from "./modal-loading";

// ---- money helpers (ported 1:1 from money/page.tsx + invoice-modal.tsx) -----


/* invPaid / invDue now come from lib/store/invoice-balance (imported above) — ONE definition,
   because the customer's copy of the bill must agree with the shop's to the penny. */

/** custCard — saved card on the linked lead (prototype custCard). */
function custCard(invoice: Invoice, leads: Lead[]): Lead["card"] | null {
  const lead = leads.find((l) => l.id === invoice.leadId);
  return lead?.card ?? null;
}

// ---- payment method (prototype state.custSel.method: 'card' | 'ach') --------

type CustMethod = "card" | "ach";

// ===========================================================================
//  BRANDED HEADER (prototype renderCustInv §.custhead) — now the sticky
//  .sheet-head: sheet-head supplies stickiness + full-bleed margins, custhead
//  (the later rule) keeps the brand padding/background/flex.
// ===========================================================================

function CustHead({ brand }: { brand: Brand }) {
  return (
    <div className="sheet-head custhead" style={{ background: brand.color }}>
      <div className="custlogo" style={{ color: brand.color }}>
        {brand.initials}
      </div>
      <div style={{ flex: 1 }}>
        {/* A heading, not a styled div: the business name IS this surface's title, so
            it should be one for assistive tech and for anything that asks "does this
            modal have a title?". Same type/weight, so nothing moves. */}
        <h2 style={{ fontWeight: 800, fontSize: "var(--type-lg)", margin: 0, letterSpacing: "inherit", fontFamily: "inherit" }}>{brand.name}</h2>
        <div style={{ fontSize: "var(--type-sm)", opacity: 0.8 }}>{brand.tagline}</div>
      </div>
      {/* ModalHost provides close — no duplicate custCloseBtn() ✕ here. */}
    </div>
  );
}

// ===========================================================================
//  LINE ROWS + TOTALS (prototype renderCustInv §.custline + deductions/Due)
// ===========================================================================

/* The line rows and the totals used to be hand-rolled HERE, a second time — and the two copies
   had already drifted: this one carried no subtotal/tax split at all, so a taxed bill previewed
   as a flat total that did not match the customer's real page. Both now render
   components/shared/invoice-document.tsx. See that file for why it takes cents. */

// ===========================================================================
//  PAY BLOCK — method chips + amount + save-card (due > 0). CONTROLLED: the
//  state lives in the modal body so the sheet-foot's Pay primary can fire with
//  the chosen method/amount. (prototype renderCustInv §chips/input + custPayNow)
// ===========================================================================

interface PayBlockProps {
  invoice: Invoice;
  brand: Brand;
  leads: Lead[];
  method: CustMethod;
  onMethodChange: (m: CustMethod) => void;
  save: boolean;
  onSaveChange: (v: boolean) => void;
  amt: number;
  onAmtChange: (v: number) => void;
}

function PayBlock({
  invoice,
  brand,
  leads,
  method,
  onMethodChange,
  save,
  onSaveChange,
  amt,
  onAmtChange,
}: PayBlockProps) {
  const card = custCard(invoice, leads);
  const showSave = method === "card" && !card;

  return (
    <>
      {/* method chips — Card / Apple Pay (default) · Bank transfer (quiet, never
          the primary — the foot's Pay button is the one loud action) */}
      <div className="chips" style={{ margin: "var(--space-3) 0 var(--space-2)", justifyContent: "center" }}>
        <button
          className={`chip ${method === "card" ? "sel" : ""}`}
          onClick={() => onMethodChange("card")}
        >
          Card / Apple Pay
        </button>
        <button
          className={`chip ${method === "ach" ? "sel" : ""}`}
          onClick={() => onMethodChange("ach")}
        >
          Bank transfer
        </button>
      </div>

      {/* amount (defaults to due, editable; the Pay button lives in the sheet-foot) */}
      <div style={{ display: "flex", gap: "var(--space-2)", justifyContent: "center" }}>
        <input
          type="number"
          inputMode="decimal"
          value={amt}
          onChange={(e) => onAmtChange(Number(e.target.value) || 0)}
          aria-label="Amount to pay"
          style={{
            flex: "0 0 110px",
            border: "1.5px solid var(--line)",
            borderRadius: "var(--radius-md)",
            padding: "var(--space-3)",
            fontFamily: "inherit",
            fontWeight: 800,
            fontSize: "var(--type-md)",
          }}
        />
      </div>

      {/* save-my-card — only when paying by card and no card on file */}
      {showSave ? (
        <label
          style={{
            display: "flex",
            gap: "var(--space-2)",
            alignItems: "flex-start",
            fontSize: "var(--type-sm)",
            color: "var(--ink-2)",
            marginTop: "var(--space-2)",
            cursor: "pointer",
          }}
        >
          <input
            type="checkbox"
            checked={save}
            onChange={() => onSaveChange(!save)}
            style={{ marginTop: "var(--space-2xs)" }}
          />{" "}
          <span>
            {/* The {" "} is load-bearing. The space that is plainly there in the
                source does not survive JSX's whitespace handling on a text child that
                follows an expression and wraps to a second line — the rendered nodes
                were "Save my card so ", "E2E Plumbing", "can settle…", so a CUSTOMER
                read "E2E Plumbingcan settle". Verified in the DOM, not just on screen. */}
            Save my card so {brand.name}{" "}
            can settle any remaining balance — you&rsquo;ll get a receipt for every charge.
          </span>
        </label>
      ) : null}

      {/* footer copy — method-aware */}
      <p className="muted" style={{ fontSize: "var(--type-xs)", textAlign: "center", marginTop: "var(--space-2)" }}>
        {method === "ach" ? "Bank transfer (ACH) · no card fee" : "Card or Apple Pay"} · pay part
        now if you need to — the amount is yours to edit.
      </p>
    </>
  );
}

// ===========================================================================
//  THE MODAL BODY (prototype renderCustInv)
// ===========================================================================

export function CustInvoiceModalContent() {
  const activeModal = useActiveModal();

  const invoices = useAppStore((s) => s.invoices);
  const leads = useAppStore((s) => s.leads);
  const jobs = useAppStore((s) => s.jobs);
  const brand = useAppStore((s) => s.brand);
  // The shop's address/phone/email/website/licence. Null until BusinessIdentityHydrator lands,
  // and the document omits the whole block while it is — a preview that printed an empty "Lic."
  // would be previewing a bug.
  const business = useAppStore((s) => s.business);
  const adoptInvoice = useAppStore((s) => s.adoptInvoice);
  const updateLead = useAppStore((s) => s.updateLead);

  const invoiceId = activeModal?.params?.invoiceId as string | undefined;
  const invoice = invoices.find((i) => i.id === invoiceId);
  const due = invoice ? invDue(invoice) : 0;

  // FETCH-ON-OPEN — the customer-facing twin of invoice-modal. This is the sheet a customer is
  // shown to take a payment on, so a wrong render is the worst of the places this bug lived:
  // it happens with someone standing there. A summary row (`partial: true` — no lines, no
  // payment history) would show an empty bill under a real balance, so the full record is
  // fetched whenever the sheet opens and a partial row is never rendered.
  const missing = Boolean(invoiceId) && !invoice;
  const needsFull = missing || Boolean(invoice?.partial);
  const invQ = api.v1.invoicing.get.useQuery(
    { invoiceId: invoiceId ?? "" },
    { enabled: Boolean(invoiceId), staleTime: 30_000, refetchOnWindowFocus: false },
  );
  useEffect(() => {
    if (!needsFull || !invQ.data) return;
    const dto = invQ.data;
    adoptInvoice(
      // "" not "—": this synthetic prior only supplies the three fields the wire does not carry,
      // and the em-dash placeholder it used to invent reached the document as "Bill to —".
      dtoInvoiceToStore(dto as never, { cust: "", phone: "", email: "" } as never),
    );
  }, [needsFull, invQ.data, adoptInvoice]);

  // Pay state lives HERE (not in PayBlock) so the sheet-foot primary can fire it.
  // Hooks run before the missing-invoice return, per the rules of hooks.
  const [method, setMethod] = useState<CustMethod>("card");
  const [save, setSave] = useState<boolean>(true);
  const [amt, setAmt] = useState<number>(due);

  // Reset per invoice (render-time state reset): PayBlock's mount used to do
  // this; with lifted state the sheet must not carry one invoice's amount or
  // method into another's.
  const [seenInvoiceId, setSeenInvoiceId] = useState(invoice?.id);
  if (invoice && invoice.id !== seenInvoiceId) {
    setSeenInvoiceId(invoice.id);
    setMethod("card");
    setSave(true);
    setAmt(due);
  }

  if (!invoiceId) return null;
  if (!invoice || invoice.partial) {
    if (invQ.isError) {
      return <p className="muted">Couldn&apos;t load this invoice. Close and try again.</p>;
    }
    return <ModalLoading size="lg" />;
  }

  const job: Job | undefined =
    invoice.jobId != null ? jobs.find((j) => j.id === invoice.jobId) : undefined;
  // The document itself — lines, subtotal/tax, deposit credit, paid-so-far and the balance —
  // plus its "Net 30 · due Sep 2 · PO 4471" face line, built by the ONE adapter that turns the
  // store's dollars into the document's cents (features/invoices/invoice-document-view.ts).
  // `documentContact`, not `documentIdentity`: CustHead above already prints the shop's name, and
  // the contact-only shape cannot express one — so it cannot be printed twice.
  const doc = invoiceDocumentView(invoice, documentContact(business));

  return (
    <>
      <CustHead brand={brand} />
      <div className="custbody">
        {/* Preview banner — this surface is a LOOK at what the customer sees, never a place to
            take money. Its one caller (invoice-modal.tsx's "Preview as customer") already has
            the real Charge a card / Record a payment actions; this modal must not duplicate
            them with a control that actually transacts. See the FIXED note at the top of this
            file for the bug this replaced. */}
        <div className="banner">
          Preview only — this is what {brand.name} sends the customer. It doesn&rsquo;t take real
          payments. To charge a card or record one, use the invoice this preview was opened from.
        </div>

        {/* intro + invoice number */}
        <p style={{ fontSize: "var(--type-base)", lineHeight: 1.55, marginBottom: "var(--space-2)" }}>
          Thanks for having us out
          {job ? (
            <>
              {" "}
              for your <b>{job.title.toLowerCase()}</b>
            </>
          ) : (
            ""
          )}{" "}
          — here&rsquo;s the bill, line by line.
        </p>
        {/* THE document — the same component the customer's real /i/<token> page renders, so a
            "Preview as customer" that disagrees with the customer's copy is not expressible. */}
        <InvoiceDocument
          num={invoice.num}
          business={doc.business}
          dates={doc.dates}
          parties={doc.parties}
          termsFace={doc.termsFace}
          // The prose above already names the job; repeating it inside the document is noise.
          title={null}
          lines={doc.lines}
          totalCents={doc.totalCents}
          taxCents={doc.taxCents}
          depositPaidCents={doc.depositPaidCents}
          amountPaidCents={doc.amountPaidCents}
          balanceDueCents={doc.balanceDueCents}
        />

        {/* deferred: photo proof — "Your work, verified" card (needs verify data) */}

        {due > 0 ? (
          <PayBlock
            invoice={invoice}
            brand={brand}
            leads={leads}
            method={method}
            onMethodChange={setMethod}
            save={save}
            onSaveChange={setSave}
            amt={amt}
            onAmtChange={setAmt}
          />
        ) : (
          <div className="deltabanner" style={{ textAlign: "center" }}>
            Settled — thank you! A receipt is in your texts.
          </div>
        )}

        <p
          className="muted"
          style={{ fontSize: "var(--type-xs)", textAlign: "center", marginTop: "var(--space-3)" }}
        >
          Powered by Mallet — licensed &amp; insured
        </p>
      </div>

      {/* No .sheet-foot: this preview has no terminal action to dock. The customer's own pay
          link (not this modal) takes the real payment; the office's real Charge a card /
          Record a payment actions live on the invoice modal this was opened from. */}
    </>
  );
}
