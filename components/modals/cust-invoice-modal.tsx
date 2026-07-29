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
 * supplies stickiness and the edge bleed), and "Pay $X" is THE .sheet-pri, docked
 * in a sticky .sheet-foot. Method chips and the editable amount stay quiet in the
 * body; pay state lives at the modal level so the foot can fire it. A settled
 * invoice has no terminal action, so it renders no foot.
 *
 * ModalHost provides the outer shell + close affordance, so the `.custhead` is
 * rendered faithfully but WITHOUT a duplicate ✕ (the prototype's custCloseBtn()).
 *
 * DEFERRED: the "Your work, verified" photo-proof card (renderCustInv's `proof`
 * block) — needs checklist/verify state that isn't modeled here yet.
 */

"use client";

import { useState } from "react";
import { useAppStore, useActiveModal } from "@/lib/store/app-store";
import type { Brand, Invoice, Job, Lead } from "@/lib/store/types";
import { fmt$ } from "@/lib/format";

// ---- money helpers (ported 1:1 from money/page.tsx + invoice-modal.tsx) -----


/** invPaid — sum of payment amounts (prototype invPaid). */
function invPaid(i: Invoice): number {
  return (i.payments ?? []).reduce((s, p) => s + (p.amt ?? 0), 0);
}

/** invDue — total − deposit − payments (floor 0) (prototype invDue). */
function invDue(i: Invoice): number {
  return Math.max(0, (i.total ?? 0) - (i.depPaid ?? 0) - invPaid(i));
}

/** custCard — saved card on the linked lead (prototype custCard). */
function custCard(invoice: Invoice, leads: Lead[]): Lead["card"] | null {
  const lead = leads.find((l) => l.id === invoice.leadId);
  return lead?.card ?? null;
}

// ---- payment method (prototype state.custSel.method: 'card' | 'ach') --------

type CustMethod = "card" | "ach";

/** clamp — the entered amount is min(max(amt,1),due) (prototype custPayNow). */
function clampAmt(entered: number, due: number): number {
  const base = Number.isFinite(entered) && entered > 0 ? entered : due;
  return Math.min(Math.max(base, 1), due);
}

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

function CustLines({ invoice }: { invoice: Invoice }) {
  return (
    <>
      {(invoice.lines ?? []).map((x, i) => (
        <div key={i} className="custline">
          <span>
            {x.d}
            {(x.q || 1) !== 1 ? ` × ${x.q}` : ""}
          </span>
          <b>{fmt$((x.q || 1) * (x.r || 0))}</b>
        </div>
      ))}
    </>
  );
}

function CustTotals({ invoice, due, paid }: { invoice: Invoice; due: number; paid: number }) {
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "flex-end",
        gap: "var(--space-1)",
        padding: "var(--space-3) 0 var(--space-1)",
      }}
    >
      {invoice.depPaid ? (
        <div className="muted" style={{ fontSize: "var(--type-base)", color: "var(--green-700)" }}>
          − deposit you already paid &nbsp; −{fmt$(invoice.depPaid)}
        </div>
      ) : null}
      {paid ? (
        <div className="muted" style={{ fontSize: "var(--type-base)", color: "var(--green-700)" }}>
          − paid so far &nbsp; −{fmt$(paid)}
        </div>
      ) : null}
      <div style={{ fontWeight: 900, fontSize: "var(--type-xl)" }}>
        {due > 0 ? <>Due &nbsp; {fmt$(due)}</> : "Paid in full ✓"}
      </div>
    </div>
  );
}

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
  const recordPayment = useAppStore((s) => s.recordPayment);
  const updateLead = useAppStore((s) => s.updateLead);

  const invoiceId = activeModal?.params?.invoiceId as string | undefined;
  const invoice = invoices.find((i) => i.id === invoiceId);
  const due = invoice ? invDue(invoice) : 0;

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

  if (!invoice) return null;

  const job: Job | undefined =
    invoice.jobId != null ? jobs.find((j) => j.id === invoice.jobId) : undefined;
  const paid = invPaid(invoice);

  // custPayNow (5656): record the payment, then optionally vault the card.
  // The store update re-renders this view; when due hits 0 the settled state shows.
  function pay() {
    if (!invoice) return;
    recordPayment(invoice.id, { amt: clampAmt(amt, due), when: "Just now", method });
    if (method === "card" && save) {
      const lead = leads.find((l) => l.id === invoice.leadId);
      if (lead && !lead.card) {
        updateLead(invoice.leadId, { card: { brand: "Visa", last4: "4242", via: "online" } });
      }
    }
  }

  return (
    <>
      <CustHead brand={brand} />
      <div className="custbody">
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
        <p className="muted" style={{ marginBottom: "var(--space-2)" }}>
          Invoice {invoice.num}
        </p>

        {/* line rows */}
        <CustLines invoice={invoice} />

        {/* deductions + Due / Paid-in-full */}
        <CustTotals invoice={invoice} due={due} paid={paid} />

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

      {/* THE primary — the one terminal action, docked where the thumb is. A
          settled invoice has no terminal action, so it gets no foot. */}
      {due > 0 && (
        <div className="sheet-foot">
          <button className="sheet-pri" onClick={pay}>
            Pay {fmt$(due)}
          </button>
        </div>
      )}
    </>
  );
}
