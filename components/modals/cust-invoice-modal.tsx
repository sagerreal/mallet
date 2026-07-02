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

// ---- money helpers (ported 1:1 from money/page.tsx + invoice-modal.tsx) -----

/** fmt$ — integer dollars → "$N,NNN" (prototype fmt$). */
function fmt$(n: number): string {
  return "$" + Math.round(n).toLocaleString("en-US");
}

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
//  BRANDED HEADER (prototype renderCustInv §.custhead)
// ===========================================================================

function CustHead({ brand }: { brand: Brand }) {
  return (
    <div className="custhead" style={{ background: brand.color }}>
      <div className="custlogo" style={{ color: brand.color }}>
        {brand.initials}
      </div>
      <div style={{ flex: 1 }}>
        <div style={{ fontWeight: 800, fontSize: 16 }}>{brand.name}</div>
        <div style={{ fontSize: 11.5, opacity: 0.8 }}>{brand.tagline}</div>
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
        gap: 4,
        padding: "12px 0 4px",
      }}
    >
      {invoice.depPaid ? (
        <div className="muted" style={{ fontSize: 12.5, color: "var(--green-700)" }}>
          − deposit you already paid &nbsp; −{fmt$(invoice.depPaid)}
        </div>
      ) : null}
      {paid ? (
        <div className="muted" style={{ fontSize: 12.5, color: "var(--green-700)" }}>
          − paid so far &nbsp; −{fmt$(paid)}
        </div>
      ) : null}
      <div style={{ fontWeight: 900, fontSize: 19 }}>
        {due > 0 ? <>Due &nbsp; {fmt$(due)}</> : "Paid in full ✓"}
      </div>
    </div>
  );
}

// ===========================================================================
//  PAY BLOCK — method chips + amount + Pay button + save-card (due > 0)
//  (prototype renderCustInv §chips/input/pay + custPayNow)
// ===========================================================================

interface PayBlockProps {
  invoice: Invoice;
  brand: Brand;
  leads: Lead[];
  due: number;
  onPay: (amt: number, method: CustMethod, save: boolean) => void;
}

function PayBlock({ invoice, brand, leads, due, onPay }: PayBlockProps) {
  const [method, setMethod] = useState<CustMethod>("card");
  const [save, setSave] = useState<boolean>(true);
  const [amt, setAmt] = useState<number>(due);

  const card = custCard(invoice, leads);
  const showSave = method === "card" && !card;

  function pay() {
    onPay(clampAmt(amt, due), method, save);
  }

  return (
    <>
      {/* method chips — Card / Apple Pay (default) · Bank transfer */}
      <div className="chips" style={{ margin: "10px 0 9px", justifyContent: "center" }}>
        <button
          className={`chip ${method === "card" ? "sel" : ""}`}
          onClick={() => setMethod("card")}
        >
          Card / Apple Pay
        </button>
        <button
          className={`chip ${method === "ach" ? "sel" : ""}`}
          onClick={() => setMethod("ach")}
        >
          Bank transfer
        </button>
      </div>

      {/* amount (defaults to due, editable) + Pay button */}
      <div style={{ display: "flex", gap: 8 }}>
        <input
          type="number"
          inputMode="decimal"
          value={amt}
          onChange={(e) => setAmt(Number(e.target.value) || 0)}
          style={{
            flex: "0 0 110px",
            border: "1.5px solid var(--line)",
            borderRadius: 10,
            padding: 10,
            fontFamily: "inherit",
            fontWeight: 800,
            fontSize: 15,
          }}
        />
        <button
          className="btn primary"
          style={{ flex: 1, padding: 13, fontSize: 14.5 }}
          onClick={pay}
        >
          {" "}
          Pay{due > 0 ? " " + fmt$(due) : ""}
        </button>
      </div>

      {/* save-my-card — only when paying by card and no card on file */}
      {showSave ? (
        <label
          style={{
            display: "flex",
            gap: 8,
            alignItems: "flex-start",
            fontSize: 12,
            color: "var(--ink-2)",
            marginTop: 9,
            cursor: "pointer",
          }}
        >
          <input
            type="checkbox"
            checked={save}
            onChange={() => setSave((v) => !v)}
            style={{ marginTop: 2 }}
          />{" "}
          <span>
            Save my card so {brand.name} can settle any remaining balance — you&rsquo;ll get a
            receipt for every charge.
          </span>
        </label>
      ) : null}

      {/* footer copy — method-aware */}
      <p className="muted" style={{ fontSize: 11, textAlign: "center", marginTop: 6 }}>
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

  const invoiceId = activeModal?.params?.invoiceId as number | undefined;
  const invoice = invoices.find((i) => i.id === invoiceId);
  if (!invoice) return null;

  const job: Job | undefined =
    invoice.jobId != null ? jobs.find((j) => j.id === invoice.jobId) : undefined;
  const due = invDue(invoice);
  const paid = invPaid(invoice);

  // custPayNow (5656): record the payment, then optionally vault the card.
  // The store update re-renders this view; when due hits 0 the settled state shows.
  function pay(amt: number, method: CustMethod, save: boolean) {
    if (!invoice) return;
    recordPayment(invoice.id, { amt, when: "Just now", method });
    if (method === "card" && save) {
      const lead = leads.find((l) => l.id === invoice.leadId);
      if (lead && !lead.card) {
        updateLead(invoice.leadId, { card: { brand: "Visa", last4: "4242", via: "online" } });
      }
    }
  }

  return (
    <div>
      <CustHead brand={brand} />
      <div className="custbody">
        {/* intro + invoice number */}
        <p style={{ fontSize: 13.5, lineHeight: 1.55, marginBottom: 6 }}>
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
        <p className="muted" style={{ marginBottom: 8 }}>
          Invoice {invoice.num}
        </p>

        {/* line rows */}
        <CustLines invoice={invoice} />

        {/* deductions + Due / Paid-in-full */}
        <CustTotals invoice={invoice} due={due} paid={paid} />

        {/* deferred: photo proof — "Your work, verified" card (needs verify data) */}

        {due > 0 ? (
          <PayBlock invoice={invoice} brand={brand} leads={leads} due={due} onPay={pay} />
        ) : (
          <div className="deltabanner" style={{ textAlign: "center" }}>
            Settled — thank you! A receipt is in your texts.
          </div>
        )}

        <p
          className="muted"
          style={{ fontSize: 10.5, textAlign: "center", marginTop: 12 }}
        >
          Powered by Mallet — licensed &amp; insured
        </p>
      </div>
    </div>
  );
}
