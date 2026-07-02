/**
 * components/modals/invoice-modal.tsx
 * Faithful port of the prototype's openInvoice (5451-5493) + invEditBlock
 * (5420-5450), with its Send-it card (sendInvoice, 5508) and the Take-a-payment
 * sheet (coPayBlock/coPay, payInvoice, 5528-5603).
 *
 * This is Finance — unlike the job modal, the invoice IS where money/margin
 * lives, so the cost column + "Your margin (only you)" ARE shown here.
 *
 * Branches faithfully:
 *   - EDITABLE (hand-made draft: !jobId && status==='draft') → invEditBlock:
 *     bill-to picker, phone, email, terms, line items w/ qty/price/cost, +Add
 *     line, from-pricebook, subtotal/discount/tax/Total + margin, Pricing options.
 *   - READ-ONLY (sent, or a job invoice) → the line table + Total − deposit −
 *     payments + Due-now/Paid-in-full row + the payments list.
 *
 * OUT OF SCOPE (handled elsewhere, per the prototype's other paths):
 *   - the job add-on plumbing (billAskBlock / invIncludeAddon / invSkipAddon).
 *   - the office charge-on-file one-tap (chargeOnFile / voidCharge).
 *   - the multi-step Tap-to-Pay simulation sheet (coPay tap/approve/done steps),
 *     the customer invoice page (openCustInv), receipts (sendReceipt) and
 *     reminders (remindInvoice). The payment card here records a payment
 *     straight through recordPayment (amount + method), which is the faithful
 *     outcome of the sheet without the on-glass simulation surface.
 */

"use client";

import { useState } from "react";
import { useAppStore, useActiveModal, useCloseModal, useOpenModal } from "@/lib/store/app-store";
import { MODAL } from "@/lib/store/modal-ids";
import { calcQuote } from "@/lib/prototype-sample";
import type { Invoice, InvoiceLine, Lead } from "@/lib/store/types";

// ---- money helpers (ported 1:1 from money/page.tsx) ------------------------

/** fmt$ — integer dollars → "$N,NNN" (prototype fmt$). */
function fmt$(n: number): string {
  return "$" + Math.round(n).toLocaleString("en-US");
}

/** invPaid — sum of payment amounts. */
function invPaid(i: Invoice): number {
  return (i.payments ?? []).reduce((s, p) => s + (p.amt ?? 0), 0);
}

/** invDue — total − deposit − payments (floor 0). */
function invDue(i: Invoice): number {
  return Math.max(0, (i.total ?? 0) - (i.depPaid ?? 0) - invPaid(i));
}

// ---- invoice status pill (prototype invPill / invStatusKey + IST) ----------

/** IST — invoice status table (prototype const IST, mirrored in money/page.tsx). */
const IST: Record<string, { l: string; c: string; bg: string }> = {
  paid: { l: "Paid", c: "var(--green-700)", bg: "var(--green-50)" },
  partial: { l: "Part-paid", c: "var(--amber)", bg: "var(--amber-bg)" },
  sent: { l: "Unpaid", c: "var(--blue)", bg: "var(--blue-bg)" },
  draft: { l: "Draft", c: "var(--ink-3)", bg: "var(--paper)" },
  over: { l: "Overdue", c: "var(--red)", bg: "var(--red-bg)" },
};

/** invOver — unpaid past the 7-day default (prototype invOver). */
function invOver(i: Invoice): boolean {
  if (i.status === "draft" || invDue(i) <= 0) return false;
  return (i.age ?? 0) > 7;
}

/** invStatusKey — runtime status key incl. draft + overdue (prototype). */
function invStatusKey(i: Invoice): string {
  if (i.status === "draft") return "draft";
  if (invOver(i)) return "over";
  if (invDue(i) <= 0) return "paid";
  if (invPaid(i) > 0) return "partial";
  return "sent";
}

function StatusPill({ invoice }: { invoice: Invoice }) {
  const s = IST[invStatusKey(invoice)] ?? IST.draft!;
  return (
    <span className="stpill" style={{ color: s.c, background: s.bg }}>
      {s.l}
    </span>
  );
}

// ---- live-resolved customer / phone (prototype invCust / invPhone) ---------
// The contact resolves LIVE from the linked lead so a corrected number/name
// isn't left stale on the frozen invoice snapshot.

function invCustName(invoice: Invoice, leads: Lead[]): string {
  const lead = leads.find((l) => l.id === invoice.leadId);
  return lead?.name ?? invoice.cust ?? "Customer";
}

function invPhone(invoice: Invoice, leads: Lead[]): string {
  const lead = leads.find((l) => l.id === invoice.leadId);
  return lead?.phone || invoice.phone || "";
}

/** custCard — saved card on the linked lead (prototype custCard). */
function custCard(invoice: Invoice, leads: Lead[]): Lead["card"] | null {
  const lead = leads.find((l) => l.id === invoice.leadId);
  return lead?.card ?? null;
}

/** pricingSummary — the reveal-head "— …" hint (prototype pricingSummary). */
function pricingSummary(p: { disc?: number; tax?: number }, depPaid: number): string {
  const bits: string[] = [];
  if (p.disc) bits.push(p.disc + "% off");
  if (depPaid) bits.push(fmt$(depPaid) + " deposit");
  if (p.tax) bits.push(p.tax + "% tax");
  return bits.join(" · ");
}

// ---- pricebook (prototype state.pricebook; same shape as the composer) ------

interface PricebookItem {
  d: string;
  r: number;
  c?: number;
}

const PRICEBOOK: ReadonlyArray<PricebookItem> = [
  { d: "40-gal gas water heater (Rheem Performance)", r: 1650 },
  { d: "Remove & haul away existing unit", r: 150 },
  { d: "Expansion tank + seismic straps (code)", r: 385 },
  { d: "Hydro-jet kitchen drain line", r: 450 },
  { d: "Camera inspection w/ locate", r: 285 },
  { d: "Toilet — Toto Drake, supplied & installed", r: 460 },
  { d: "City permit", r: 110 },
];

// ---- shared inline styles (kept faithful to the prototype's inline CSS) -----

const LINE_INPUT: React.CSSProperties = {
  flex: 1,
  minWidth: 140,
  border: "1.5px solid var(--line)",
  borderRadius: 8,
  padding: "7px 9px",
  fontFamily: "inherit",
  fontSize: 13,
};

const QTY_INPUT: React.CSSProperties = {
  width: 44,
  border: "1.5px solid var(--line)",
  borderRadius: 8,
  padding: "7px 4px",
  fontFamily: "inherit",
  textAlign: "center",
};

const PRICE_INPUT: React.CSSProperties = {
  width: 78,
  border: "1.5px solid var(--line)",
  borderRadius: 8,
  padding: "7px 8px",
  fontFamily: "inherit",
  fontWeight: 700,
};

const COST_INPUT: React.CSSProperties = {
  width: 64,
  border: "1.5px dashed var(--line)",
  borderRadius: 8,
  padding: "7px 6px",
  fontFamily: "inherit",
  color: "var(--ink-2)",
};

const SEC_LABEL: React.CSSProperties = {
  fontSize: 11,
  fontWeight: 800,
  textTransform: "uppercase",
  letterSpacing: ".05em",
  margin: "16px 0 6px",
};

const ROLLUP_ROW: React.CSSProperties = {
  display: "flex",
  justifyContent: "space-between",
  fontSize: 13,
  color: "var(--ink-2)",
};

// ===========================================================================
//  EDIT BLOCK — the hand-made-draft editor (prototype invEditBlock)
// ===========================================================================

interface EditBlockProps {
  invoice: Invoice;
  leads: Lead[];
  onPickCust: (name: string) => void;
  onSetField: (patch: Partial<Invoice>) => void;
  onSetTerms: (days: number | null) => void;
  onSetLines: (lines: InvoiceLine[]) => void;
  onSetPricing: (patch: { disc?: number; tax?: number }) => void;
  onSetDepPaid: (depPaid: number) => void;
}

function EditBlock({
  invoice,
  leads,
  onPickCust,
  onSetField,
  onSetTerms,
  onSetLines,
  onSetPricing,
  onSetDepPaid,
}: EditBlockProps) {
  // pricebook browse + Pricing-options reveal are local UI (prototype _invPb / _invPx).
  const [pbOpen, setPbOpen] = useState(false);
  const [pxOpen, setPxOpen] = useState(false);

  // Finance surface — money (cost col + margin) is always shown here.
  const money = true;
  const p = invoice.pricing ?? { disc: 0, tax: 0 };
  const lines = invoice.lines ?? [];
  const m = calcQuote(
    lines.map((l) => ({ q: l.q || 1, r: l.r || 0, d: l.d, opt: false })),
    p
  );
  const cost = lines.reduce((s, l) => s + (l.q || 1) * (l.c || 0), 0);
  const margin = (invoice.total || 0) - cost;
  const td = invoice.termsDays;

  // ---- immutable line ops (map to a fresh array, never mutate a line) -------

  function setLine(ix: number, patch: Partial<InvoiceLine>) {
    onSetLines(lines.map((l, i) => (i === ix ? { ...l, ...patch } : l)));
  }

  function addLine() {
    onSetLines([...lines, { d: "", q: 1, r: 0 }]);
  }

  function removeLine(ix: number) {
    onSetLines(lines.filter((_, i) => i !== ix));
  }

  function addFromPricebook(item: PricebookItem) {
    onSetLines([...lines, { d: item.d, q: 1, r: item.r, c: item.c ?? 0 }]);
  }

  return (
    <div style={{ marginTop: 14 }}>
      {/* Bill-to + Phone */}
      <div className="row2" style={{ gridTemplateColumns: "1fr 1fr", gap: 12 }}>
        <div className="field" style={{ margin: 0 }}>
          <label>Bill to</label>
          <input
            type="text"
            list="invCustList"
            defaultValue={invoice.cust || ""}
            placeholder="search or add a customer"
            onChange={(e) => onPickCust(e.target.value)}
          />
          <datalist id="invCustList">
            {leads.map((l) => (
              <option key={l.id} value={l.name || ""} />
            ))}
          </datalist>
        </div>
        <div className="field" style={{ margin: 0 }}>
          <label>Phone</label>
          <input
            type="tel"
            defaultValue={invoice.phone || ""}
            placeholder="(925) 555-0123"
            onChange={(e) => onSetField({ phone: e.target.value.trim() })}
          />
        </div>
      </div>

      {/* Email + Terms */}
      <div className="row2" style={{ gridTemplateColumns: "1fr 1fr", gap: 12, marginTop: 12 }}>
        <div className="field" style={{ margin: 0 }}>
          <label>
            Email{" "}
            <span
              className="muted"
              style={{ fontWeight: 500, textTransform: "none", letterSpacing: 0 }}
            >
              (for a PDF copy)
            </span>
          </label>
          <input
            type="email"
            inputMode="email"
            defaultValue={invoice.email || ""}
            placeholder="name@email.com"
            onChange={(e) => onSetField({ email: e.target.value.trim() })}
          />
        </div>
        <div className="field" style={{ margin: 0 }}>
          <label>Terms</label>
          <select
            value={td == null ? "" : String(td)}
            onChange={(e) => onSetTerms(e.target.value === "" ? null : Number(e.target.value))}
          >
            {td == null ? <option value="">Choose…</option> : null}
            <option value="0">Due on receipt</option>
            <option value="15">Net 15</option>
            <option value="30">Net 30</option>
          </select>
        </div>
      </div>

      {/* Line items */}
      <div className="muted" style={SEC_LABEL}>
        Line items
      </div>
      {lines.length ? (
        lines.map((l, ix) => (
          <div
            key={ix}
            style={{
              display: "flex",
              gap: 6,
              alignItems: "center",
              marginBottom: 6,
              flexWrap: "wrap",
            }}
          >
            <input
              value={l.d || ""}
              placeholder="description"
              onChange={(e) => setLine(ix, { d: e.target.value })}
              style={LINE_INPUT}
            />
            <input
              type="number"
              min={1}
              value={l.q || 1}
              title="qty"
              onChange={(e) => setLine(ix, { q: Math.max(1, Math.round(Number(e.target.value) || 1)) })}
              style={QTY_INPUT}
            />
            <span className="muted">$</span>
            <input
              type="number"
              min={0}
              value={l.r || 0}
              title="price"
              onChange={(e) => setLine(ix, { r: Math.max(0, Math.round(Number(e.target.value) || 0)) })}
              style={PRICE_INPUT}
            />
            {money ? (
              <input
                type="number"
                min={0}
                value={l.c ?? ""}
                placeholder="cost"
                title="your cost (only you)"
                onChange={(e) =>
                  setLine(ix, { c: Math.max(0, Math.round(Number(e.target.value) || 0)) })
                }
                style={COST_INPUT}
              />
            ) : null}
            <span
              className="linklike"
              style={{ color: "var(--ink-3)", fontWeight: 800 }}
              onClick={() => removeLine(ix)}
            >
              ✕
            </span>
          </div>
        ))
      ) : (
        <div className="muted" style={{ fontSize: 12, padding: "2px 0 6px" }}>
          No lines yet — add what you&rsquo;re billing for.
        </div>
      )}

      {/* + Add line · from pricebook */}
      <div style={{ display: "flex", gap: 12, alignItems: "center", marginTop: 4 }}>
        <button type="button" className="btn sm ghost" onClick={addLine}>
          + Add line
        </button>
        {PRICEBOOK.length ? (
          <span className="linklike" style={{ fontSize: 12 }} onClick={() => setPbOpen((v) => !v)}>
            {pbOpen ? "close" : "from pricebook"}
          </span>
        ) : null}
      </div>

      {pbOpen ? (
        <div style={{ borderTop: "1px solid var(--line)", marginTop: 8, paddingTop: 8 }}>
          {PRICEBOOK.map((pp, pi) => (
            <div
              key={pi}
              className="stage-row clickable"
              style={{ cursor: "pointer", border: "none", padding: "4px 0" }}
              onClick={() => addFromPricebook(pp)}
            >
              <span style={{ flex: 1, fontSize: 13 }}>{pp.d}</span>
              <b className="fig">{fmt$(pp.r)}</b>
            </div>
          ))}
        </div>
      ) : null}

      {/* Subtotal / discount / tax / Total + margin */}
      <div style={{ borderTop: "1px solid var(--line)", marginTop: 10, paddingTop: 8 }}>
        {p.disc || p.tax ? (
          <div style={ROLLUP_ROW}>
            <span>Subtotal</span>
            <span>{fmt$(m.sub)}</span>
          </div>
        ) : null}
        {p.disc ? (
          <div style={ROLLUP_ROW}>
            <span>Discount {p.disc}%</span>
            <span style={{ color: "var(--red)" }}>−{fmt$(m.disc)}</span>
          </div>
        ) : null}
        {p.tax ? (
          <div style={ROLLUP_ROW}>
            <span>Tax {p.tax}%</span>
            <span>+{fmt$(m.taxed)}</span>
          </div>
        ) : null}
        <div style={{ display: "flex", justifyContent: "space-between", fontWeight: 800, fontSize: 15 }}>
          <span>Total</span>
          <span className="fig">{fmt$(invoice.total || 0)}</span>
        </div>
        {money && cost > 0 ? (
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              fontSize: 11.5,
              color: "var(--ink-3)",
              marginTop: 3,
            }}
          >
            <span>
              Your margin <span className="muted">(only you)</span>
            </span>
            <span>
              {fmt$(margin)} · {(invoice.total || 0) > 0 ? Math.round((margin / (invoice.total || 1)) * 100) : 0}%
            </span>
          </div>
        ) : null}
      </div>

      {/* Pricing options reveal */}
      <div className={`reveal ${pxOpen ? "open" : ""}`} style={{ marginTop: 10 }}>
        <div className="reveal-head" onClick={() => setPxOpen((v) => !v)}>
          <span className="caret">▸</span>{" "}
          <b style={{ fontSize: 12.5 }}>Pricing options</b>{" "}
          <span className="muted" style={{ fontWeight: 500, fontSize: 12 }}>
            — {pricingSummary(p, invoice.depPaid || 0) || "discount, tax, deposit"}
          </span>
        </div>
        <div className="reveal-body">
          <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
            <div className="field" style={{ flex: 1, minWidth: 90, margin: 0 }}>
              <label>Discount %</label>
              <input
                type="number"
                min={0}
                defaultValue={p.disc || ""}
                placeholder="0"
                onChange={(e) => onSetPricing({ disc: Math.max(0, Number(e.target.value) || 0) })}
              />
            </div>
            <div className="field" style={{ flex: 1, minWidth: 90, margin: 0 }}>
              <label>Tax %</label>
              <input
                type="number"
                min={0}
                step={0.25}
                defaultValue={p.tax || ""}
                placeholder="0"
                onChange={(e) => onSetPricing({ tax: Math.max(0, Number(e.target.value) || 0) })}
              />
            </div>
            <div className="field" style={{ flex: 1, minWidth: 110, margin: 0 }}>
              <label>Deposit paid $</label>
              <input
                type="number"
                min={0}
                defaultValue={invoice.depPaid || ""}
                placeholder="0"
                onChange={(e) => onSetDepPaid(Math.max(0, Math.round(Number(e.target.value) || 0)))}
              />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

// ===========================================================================
//  READ-ONLY VIEW — sent / job invoices (prototype openInvoice else-branch)
// ===========================================================================

interface ReadOnlyViewProps {
  invoice: Invoice;
}

function ReadOnlyView({ invoice }: ReadOnlyViewProps) {
  const paid = invPaid(invoice);
  const due = invDue(invoice);
  const total = invoice.total ?? 0;

  return (
    <div className="card" style={{ marginTop: 14 }}>
      <table>
        <tbody>
          {(invoice.lines ?? []).map((x, i) => (
            <tr key={i}>
              <td>
                {x.d}
                {(x.q ?? 1) > 1 ? ` ×${x.q}` : ""}
              </td>
              <td style={{ textAlign: "right" }}>{fmt$((x.q ?? 1) * (x.r ?? 0))}</td>
            </tr>
          ))}
          <tr>
            <td style={{ textAlign: "right", fontWeight: 800, borderTop: "1px solid var(--line)" }}>
              Total
            </td>
            <td style={{ textAlign: "right", fontWeight: 800, borderTop: "1px solid var(--line)" }}>
              {fmt$(total)}
            </td>
          </tr>
          {invoice.depPaid ? (
            <tr>
              <td style={{ textAlign: "right" }} className="muted">
                − deposit already paid
              </td>
              <td style={{ textAlign: "right", color: "var(--green-700)" }}>−{fmt$(invoice.depPaid)}</td>
            </tr>
          ) : null}
          {paid ? (
            <tr>
              <td style={{ textAlign: "right" }} className="muted">
                − payments so far
              </td>
              <td style={{ textAlign: "right", color: "var(--green-700)" }}>−{fmt$(paid)}</td>
            </tr>
          ) : null}
          <tr>
            <td style={{ textAlign: "right", fontWeight: 900, fontSize: 15 }}>
              {total <= 0 ? "No bill set yet" : due > 0 ? "Due now" : "Paid in full ✓"}
            </td>
            <td
              style={{
                textAlign: "right",
                fontWeight: 900,
                fontSize: 15,
                color: due > 0 ? "var(--ink)" : "var(--green-700)",
              }}
            >
              {due > 0 ? fmt$(due) : ""}
            </td>
          </tr>
        </tbody>
      </table>
      {(invoice.payments ?? []).length ? (
        <div className="muted" style={{ fontSize: 12, marginTop: 4 }}>
          {(invoice.payments ?? [])
            .map((p) => `✓ ${fmt$(p.amt)} ${p.method || "card"} · ${p.when}`)
            .join("  ·  ")}
        </div>
      ) : null}
    </div>
  );
}

// ===========================================================================
//  SEND-IT CARD (prototype openInvoice §Send it → sendInvoice)
// ===========================================================================

interface SendCardProps {
  invoice: Invoice;
  phone: string;
  due: number;
  onSend: () => void;
}

function SendCard({ invoice, phone, due, onSend }: SendCardProps) {
  return (
    <div className="card" style={{ marginTop: 12, background: "var(--paper)" }}>
      <b style={{ fontSize: 13 }}>Send it</b>
      <p className="muted" style={{ fontSize: 12, margin: "3px 0 8px" }}>
        {phone ? (
          <>
            Texts a pay link to <b>{phone}</b>
            {invoice.email ? (
              <>
                {" "}
                and emails a PDF to <b>{invoice.email}</b>
              </>
            ) : null}{" "}
            — they pay from their phone, nothing to retype.
          </>
        ) : (
          "Add a phone above to text it."
        )}
      </p>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
        <button className="btn primary" onClick={onSend}>
          Send invoice{due > 0 ? " — " + fmt$(due) : ""}
        </button>
        {invoice.email ? null : (
          <span className="muted" style={{ fontSize: 11.5 }}>
            add an email above to also send a PDF
          </span>
        )}
      </div>
    </div>
  );
}

// ===========================================================================
//  TAKE-A-PAYMENT CARD (prototype openInvoice §Take a payment + coPayBlock)
// ===========================================================================

type PayMethod = "card" | "check" | "cash" | "ach";

const PAY_METHODS: ReadonlyArray<{ key: PayMethod; label: string }> = [
  { key: "card", label: "Card" },
  { key: "check", label: "Check" },
  { key: "cash", label: "Cash" },
  { key: "ach", label: "Bank" },
];

interface PaymentCardProps {
  invoice: Invoice;
  leads: Lead[];
  due: number;
  onRecord: (amt: number, method: PayMethod) => void;
}

function PaymentCard({ invoice, leads, due, onRecord }: PaymentCardProps) {
  const [payOpen, setPayOpen] = useState(false);
  const [amt, setAmt] = useState<number>(due);
  const [method, setMethod] = useState<PayMethod>("card");

  const card = custCard(invoice, leads);

  function record() {
    const entered = Number.isFinite(amt) && amt > 0 ? amt : due;
    onRecord(Math.min(entered, due), method);
  }

  return (
    <div className="card" style={{ marginTop: 12, background: "var(--green-50)", borderColor: "#DDD7C9" }}>
      <b style={{ fontSize: 13 }}>Take a payment</b>
      {payOpen ? (
        <div style={{ marginTop: 6 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 11 }}>
            <span className="muted" style={{ fontSize: 12 }}>
              Amount due
            </span>
            <span className="muted">$</span>
            <input
              type="number"
              inputMode="decimal"
              value={amt}
              onChange={(e) => setAmt(Number(e.target.value) || 0)}
              style={{
                width: 118,
                border: "1.5px solid var(--line)",
                borderRadius: 8,
                padding: "9px 10px",
                fontFamily: "inherit",
                fontWeight: 700,
              }}
            />
          </div>
          <div className="chips">
            {PAY_METHODS.map((mth) => (
              <button
                key={mth.key}
                className={`chip ${method === mth.key ? "sel" : ""}`}
                onClick={() => setMethod(mth.key)}
              >
                {mth.label}
              </button>
            ))}
          </div>
          <div style={{ display: "flex", gap: 8, alignItems: "center", marginTop: 11, flexWrap: "wrap" }}>
            <button className="btn primary" onClick={record}>
              Record payment
            </button>
            <span
              className="linklike"
              style={{ display: "inline-block" }}
              onClick={() => setPayOpen(false)}
            >
              ← back
            </span>
          </div>
        </div>
      ) : (
        <>
          <p className="muted" style={{ fontSize: 12, margin: "3px 0 9px" }}>
            {card
              ? "Charge the card on file, Tap to Pay, or take a bank transfer, check or cash."
              : "Tap to Pay, bank transfer, check or cash."}{" "}
            A partial is fine — the rest stays badged on Money.
          </p>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <button
              className="btn primary"
              style={{ minHeight: 46, fontSize: 14 }}
              onClick={() => {
                setAmt(due);
                setPayOpen(true);
              }}
            >
              Take payment — {fmt$(due)}
            </button>
          </div>
        </>
      )}
    </div>
  );
}

// ===========================================================================
//  THE MODAL BODY
// ===========================================================================

export function InvoiceModalContent() {
  const activeModal = useActiveModal();
  const close = useCloseModal();
  const openModal = useOpenModal();

  const invoices = useAppStore((s) => s.invoices);
  const leads = useAppStore((s) => s.leads);
  const jobs = useAppStore((s) => s.jobs);
  const updateInvoice = useAppStore((s) => s.updateInvoice);
  const setInvoiceLines = useAppStore((s) => s.setInvoiceLines);
  const recordPayment = useAppStore((s) => s.recordPayment);
  const sendInvoice = useAppStore((s) => s.sendInvoice);

  const invoiceId = activeModal?.params?.invoiceId as number | undefined;
  const invoice = invoices.find((i) => i.id === invoiceId);
  if (!invoice) return null;

  const job = invoice.jobId != null ? jobs.find((j) => j.id === invoice.jobId) : undefined;
  // hand-made invoices are built here; job invoices flow from the job (read-only).
  const editable = !job && invoice.status === "draft";
  const sent = invoice.status !== "draft";
  const due = invDue(invoice);
  const total = invoice.total ?? 0;

  const custName = invCustName(invoice, leads);
  const phone = invPhone(invoice, leads);

  // ---- edit-block wiring (prototype invCustPick / invSetField / invSetTerms /
  //      invSetLine|invAddLine|invRemoveLine / invSetPricing) -----------------

  function pickCust(rawName: string) {
    if (!invoice) return;
    const name = rawName.trim();
    const matched = leads.find((l) => (l.name || "").toLowerCase() === name.toLowerCase());
    const patch: Partial<Invoice> = { cust: name };
    if (!invoice.title || invoice.title === "New invoice" || invoice.title === "Customer") {
      patch.title = name || "New invoice";
    }
    if (matched) {
      patch.leadId = matched.id;
      if (matched.phone && matched.phone !== "—") patch.phone = matched.phone;
      if (matched.email) patch.email = matched.email;
    } else {
      // no live match — leave the typed name, clear the link (prototype sets leadId=null)
      patch.leadId = 0;
    }
    updateInvoice(invoice.id, patch);
  }

  function send() {
    if (!invoice) return;
    sendInvoice(invoice.id);
    close();
  }

  function record(amt: number, method: PayMethod) {
    if (!invoice) return;
    recordPayment(invoice.id, { amt, when: "Just now", method });
  }

  return (
    <div>
      {/* Header — num · customer · title + phone · status pill */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 10 }}>
        <div>
          <div className="muted">{invoice.num}</div>
          <h2>{custName}</h2>
          <div className="muted">
            {invoice.title}
            {phone ? " · " + phone : ""}
          </div>
        </div>
        <div>
          <StatusPill invoice={invoice} />
        </div>
      </div>

      {/* Payment-reminder trail — sent + open + reminders on (prototype fu line) */}
      {sent && invoice.fu?.on && due > 0 ? (
        <div className="muted" style={{ fontSize: 12, marginTop: 8 }}>
          Payment reminders · 1st{" "}
          {invoice.fu.stage >= 1 ? <b>sent</b> : "in 3 days"} · 2nd{" "}
          {invoice.fu.stage >= 2 ? (
            <>
              <b>sent</b> — now in Needs Attention
            </>
          ) : (
            "in 6 days"
          )}
        </div>
      ) : null}

      {/* Body — editable edit-block vs read-only view */}
      {editable ? (
        <EditBlock
          invoice={invoice}
          leads={leads}
          onPickCust={pickCust}
          onSetField={(patch) => updateInvoice(invoice.id, patch)}
          onSetTerms={(termsDays) => updateInvoice(invoice.id, { termsDays })}
          onSetLines={(lines) => setInvoiceLines(invoice.id, lines)}
          onSetPricing={(patch) =>
            updateInvoice(invoice.id, {
              pricing: { disc: 0, tax: 0, ...(invoice.pricing ?? {}), ...patch },
            })
          }
          onSetDepPaid={(depPaid) => updateInvoice(invoice.id, { depPaid })}
        />
      ) : (
        <ReadOnlyView invoice={invoice} />
      )}

      {/* Send it — not yet sent + something to bill */}
      {!sent && total > 0 ? <SendCard invoice={invoice} phone={phone} due={due} onSend={send} /> : null}

      {/* Take a payment — anything still owed */}
      {due > 0 ? <PaymentCard invoice={invoice} leads={leads} due={due} onRecord={record} /> : null}

      {/* Footer — Preview as customer + Done */}
      <div
        style={{
          display: "flex",
          justifyContent: "flex-end",
          gap: 10,
          marginTop: 14,
          borderTop: "1px solid var(--line)",
          paddingTop: 12,
        }}
      >
        <button className="btn ghost" onClick={() => openModal(MODAL.CUST_INVOICE, { invoiceId: invoice.id })}>
          Preview as customer
        </button>
        <button className="btn primary" onClick={close}>
          Done
        </button>
      </div>
    </div>
  );
}
