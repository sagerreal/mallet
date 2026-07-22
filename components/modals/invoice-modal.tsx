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
import { useAppStore, useActiveModal, useCloseModal, usePushModal } from "@/lib/store/app-store";
import { MODAL } from "@/lib/store/modal-ids";
import { trpcVanilla } from "@/lib/trpc/vanilla";
import { calcQuote } from "@/lib/prototype-sample";
import type { Invoice, InvoiceLine, Lead, Service } from "@/lib/store/types";
import { fmt$ } from "@/lib/format";
import { DisclosureRow } from "@/components/ui/disclosure-row";
// Single source for invoice money math + status pill table (features/money).
import { invPaid, invDue, invStatusKey, IST } from "@/features/money/money-derive";

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

/** pricingSummary — the reveal-head "— …" hint (prototype pricingSummary). */
function pricingSummary(p: { disc?: number; tax?: number }, depPaid: number): string {
  const bits: string[] = [];
  if (p.disc) bits.push(p.disc + "% off");
  if (depPaid) bits.push(fmt$(depPaid) + " deposit");
  if (p.tax) bits.push(p.tax + "% tax");
  return bits.join(" · ");
}

// ---- shared inline styles (kept faithful to the prototype's inline CSS) -----

const LINE_INPUT: React.CSSProperties = {
  flex: 1,
  minWidth: 140,
  border: "1.5px solid var(--line)",
  borderRadius: "var(--radius-sm)",
  padding: "var(--space-2) var(--space-2)",
  fontFamily: "inherit",
  fontSize: "var(--type-base)",
};

const QTY_INPUT: React.CSSProperties = {
  width: 44,
  border: "1.5px solid var(--line)",
  borderRadius: "var(--radius-sm)",
  padding: "var(--space-2) var(--space-1)",
  fontFamily: "inherit",
  textAlign: "center",
};

const PRICE_INPUT: React.CSSProperties = {
  width: 78,
  border: "1.5px solid var(--line)",
  borderRadius: "var(--radius-sm)",
  padding: "var(--space-2) var(--space-2)",
  fontFamily: "inherit",
  fontWeight: 700,
};

const COST_INPUT: React.CSSProperties = {
  width: 64,
  border: "1.5px dashed var(--line)",
  borderRadius: "var(--radius-sm)",
  padding: "var(--space-2) var(--space-2)",
  fontFamily: "inherit",
  color: "var(--ink-2)",
};

const SEC_LABEL: React.CSSProperties = {
  fontSize: "var(--type-xs)",
  fontWeight: 800,
  textTransform: "uppercase",
  letterSpacing: ".05em",
  margin: "var(--space-4) 0 var(--space-2)",
};

const ROLLUP_ROW: React.CSSProperties = {
  display: "flex",
  justifyContent: "space-between",
  fontSize: "var(--type-base)",
  color: "var(--ink-2)",
};

// ===========================================================================
//  EDIT BLOCK — the hand-made-draft editor (prototype invEditBlock)
// ===========================================================================

interface EditBlockProps {
  invoice: Invoice;
  leads: Lead[];
  services: Service[];
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
  services,
  onPickCust,
  onSetField,
  onSetTerms,
  onSetLines,
  onSetPricing,
  onSetDepPaid,
}: EditBlockProps) {
  // pricebook browse is local UI (prototype _invPb); the staged details
  // (send-to / due / adjustments) are disclosure rows, one open at a time.
  const [pbOpen, setPbOpen] = useState(false);
  const [pbQuery, setPbQuery] = useState("");
  const [openRow, setOpenRow] = useState<"sendto" | "due" | "pricing" | null>(null);
  const toggleRow = (k: "sendto" | "due" | "pricing") =>
    setOpenRow((prev) => (prev === k ? null : k));
  const pbMatches = pbQuery.trim()
    ? services.filter((svc) =>
        svc.name.toLowerCase().includes(pbQuery.trim().toLowerCase())
      )
    : services;

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
  // Collapsed row summary — the value IS the state (updates as the store writes).
  const sendToSummary = [invoice.phone, invoice.email].filter(Boolean).join(" · ") || "—";

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

  // Snapshots the service's current values — later pricebook edits never
  // retroactively change a line already added to this invoice.
  function addFromPricebook(svc: Service) {
    onSetLines([...lines, { d: svc.name, q: 1, r: svc.unitPrice, c: svc.cost }]);
  }

  return (
    <div style={{ marginTop: "var(--space-4)" }}>
      {/* Bill-to — the one essential field, stays open (everything else stages). */}
      <div className="field" style={{ margin: "0" }}>
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
              gap: "var(--space-2)",
              alignItems: "center",
              marginBottom: "var(--space-2)",
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
        <div className="muted" style={{ fontSize: "var(--type-sm)", padding: "var(--space-2xs) 0 var(--space-2)" }}>
          No lines yet — add what you&rsquo;re billing for.
        </div>
      )}

      {/* + Add line · from pricebook */}
      <div style={{ display: "flex", gap: "var(--space-3)", alignItems: "center", marginTop: "var(--space-1)" }}>
        <button type="button" className="btn sm ghost" onClick={addLine}>
          + Add line
        </button>
        {services.length ? (
          <span className="linklike" style={{ fontSize: "var(--type-sm)" }} onClick={() => setPbOpen((v) => !v)}>
            {pbOpen ? "close" : "from pricebook"}
          </span>
        ) : null}
      </div>

      {pbOpen ? (
        <div style={{ borderTop: "1px solid var(--line)", marginTop: "var(--space-2)", paddingTop: "var(--space-2)" }}>
          <input
            type="text"
            value={pbQuery}
            onChange={(e) => setPbQuery(e.target.value)}
            placeholder="Search your pricebook…"
            style={{ ...LINE_INPUT, flex: "none", width: "100%", marginBottom: "var(--space-2)" }}
          />
          {pbMatches.length ? (
            pbMatches.map((svc) => (
              <div
                key={svc.id}
                className="stage-row clickable"
                style={{ cursor: "pointer", border: "none", padding: "var(--space-1) 0" }}
                onClick={() => addFromPricebook(svc)}
              >
                <span style={{ flex: 1, fontSize: "var(--type-base)" }}>{svc.name}</span>
                <b className="fig">{fmt$(svc.unitPrice)}</b>
              </div>
            ))
          ) : (
            <div className="muted" style={{ fontSize: "var(--type-sm)", padding: "var(--space-1) 0" }}>
              No matches — try a different search.
            </div>
          )}
        </div>
      ) : null}

      {/* Subtotal / discount / tax / Total + margin */}
      <div style={{ borderTop: "1px solid var(--line)", marginTop: "var(--space-3)", paddingTop: "var(--space-2)" }}>
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
        <div style={{ display: "flex", justifyContent: "space-between", fontWeight: 800, fontSize: "var(--type-md)" }}>
          <span>Total</span>
          <span className="fig">{fmt$(invoice.total || 0)}</span>
        </div>
        {money && cost > 0 ? (
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              fontSize: "var(--type-sm)",
              color: "var(--ink-3)",
              marginTop: "var(--space-1)",
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

      {/* The staged details — disclosure rows (the intake-modal grammar):
          label · current value, one editor open at a time, in-flow. */}
      <div style={{ borderTop: "1px solid var(--line-2)", marginTop: "var(--space-4)" }}>
        <DisclosureRow
          label="Send to"
          value={sendToSummary}
          open={openRow === "sendto"}
          onToggle={() => toggleRow("sendto")}
        >
          <div className="row2" style={{ gridTemplateColumns: "1fr 1fr", gap: "var(--space-3)" }}>
            <div className="field" style={{ margin: "0" }}>
              <label>Phone</label>
              <input
                type="tel"
                defaultValue={invoice.phone || ""}
                placeholder="(925) 555-0123"
                onChange={(e) => onSetField({ phone: e.target.value.trim() })}
              />
            </div>
            <div className="field" style={{ margin: "0" }}>
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
          </div>
        </DisclosureRow>

        <DisclosureRow
          label="Due"
          value={(td ?? 0) === 0 ? "On receipt" : `${td} days`}
          open={openRow === "due"}
          onToggle={() => toggleRow("due")}
        >
          <div className="chips">
            <button
              type="button"
              className={`chip${(td ?? 0) === 0 ? " sel" : ""}`}
              onClick={() => onSetTerms(0)}
            >
              On receipt
            </button>
            <button
              type="button"
              className={`chip${td === 15 ? " sel" : ""}`}
              onClick={() => onSetTerms(15)}
            >
              15 days
            </button>
            <button
              type="button"
              className={`chip${td === 30 ? " sel" : ""}`}
              onClick={() => onSetTerms(30)}
            >
              30 days
            </button>
          </div>
        </DisclosureRow>

        <DisclosureRow
          label="Discount, tax & deposit"
          value={pricingSummary(p, invoice.depPaid || 0) || "None"}
          open={openRow === "pricing"}
          onToggle={() => toggleRow("pricing")}
        >
          <div style={{ display: "flex", gap: "var(--space-3)", flexWrap: "wrap" }}>
            <div className="field" style={{ flex: 1, minWidth: 90, margin: "0" }}>
              <label>Discount %</label>
              <input
                type="number"
                min={0}
                defaultValue={p.disc || ""}
                placeholder="0"
                onChange={(e) => onSetPricing({ disc: Math.max(0, Number(e.target.value) || 0) })}
              />
            </div>
            <div className="field" style={{ flex: 1, minWidth: 90, margin: "0" }}>
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
            <div className="field" style={{ flex: 1, minWidth: 110, margin: "0" }}>
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
        </DisclosureRow>
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
    <div className="card" style={{ marginTop: "var(--space-4)" }}>
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
            <td style={{ textAlign: "right", fontWeight: 900, fontSize: "var(--type-md)" }}>
              {total <= 0 ? "No bill set yet" : due > 0 ? "Due now" : "Paid in full ✓"}
            </td>
            <td
              style={{
                textAlign: "right",
                fontWeight: 900,
                fontSize: "var(--type-md)",
                color: due > 0 ? "var(--ink)" : "var(--green-700)",
              }}
            >
              {due > 0 ? fmt$(due) : ""}
            </td>
          </tr>
        </tbody>
      </table>
      {(invoice.payments ?? []).length ? (
        <div className="muted" style={{ fontSize: "var(--type-sm)", marginTop: "var(--space-1)" }}>
          {(invoice.payments ?? [])
            .map((p) => `✓ ${fmt$(p.amt)} ${p.method || "card"} · ${p.when}`)
            .join("  ·  ")}
        </div>
      ) : null}
    </div>
  );
}

// ===========================================================================
//  GET PAID — Send (finalize) · Charge a card · Record cash/check
// ===========================================================================

type RecordMethod = "cash" | "check";

interface GetPaidProps {
  due: number;
  sent: boolean;
  busy: boolean;
  error: string | null;
  onSend: () => void;
  onCharge: () => void;
  onRecord: (method: RecordMethod) => void;
}

// One panel, three verb-honest actions. A draft's only action is Send (which finalizes it).
// A sent, still-owed invoice offers Charge a card (real Stripe checkout) or Record for cash/check
// already collected. "Card" is never a recordable method — a card always charges.
function GetPaid({ due, sent, busy, error, onSend, onCharge, onRecord }: GetPaidProps) {
  const [recOpen, setRecOpen] = useState(false);
  const [method, setMethod] = useState<RecordMethod>("cash");

  return (
    <div className="card" style={{ marginTop: "var(--space-3)", background: "var(--paper)" }}>
      <div className="muted" style={{ ...SEC_LABEL, margin: "0 0 var(--space-3)" }}>
        Get paid
      </div>
      {error ? (
        <div style={{ color: "var(--red)", fontSize: "var(--type-base)", marginBottom: "var(--space-3)" }}>{error}</div>
      ) : null}
      {!sent ? (
        <button
          className="btn primary"
          style={{ minHeight: 46, width: "100%" }}
          disabled={busy}
          onClick={onSend}
        >
          Send invoice{due > 0 ? " — " + fmt$(due) : ""}
        </button>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-2)" }}>
          <button
            className="btn primary"
            style={{ minHeight: 46 }}
            disabled={busy}
            onClick={onCharge}
          >
            {busy ? "Opening…" : `Charge a card — ${fmt$(due)}`}
          </button>
          {recOpen ? (
            <div style={{ border: "1px solid var(--line)", borderRadius: "var(--radius-md)", padding: "var(--space-3)", background: "var(--bg)" }}>
              <div className="chips" style={{ marginBottom: "var(--space-3)" }}>
                <button className={`chip ${method === "cash" ? "sel" : ""}`} onClick={() => setMethod("cash")}>
                  Cash
                </button>
                <button className={`chip ${method === "check" ? "sel" : ""}`} onClick={() => setMethod("check")}>
                  Check
                </button>
              </div>
              <div style={{ display: "flex", gap: "var(--space-2)", alignItems: "center" }}>
                <button
                  className="btn primary"
                  onClick={() => {
                    onRecord(method);
                    setRecOpen(false);
                  }}
                >
                  Record payment — {fmt$(due)}
                </button>
                <span className="linklike" onClick={() => setRecOpen(false)}>
                  ← back
                </span>
              </div>
            </div>
          ) : (
            <button className="btn ghost" onClick={() => setRecOpen(true)}>
              Record cash or check
            </button>
          )}
        </div>
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
  const pushModal = usePushModal();

  const invoices = useAppStore((s) => s.invoices);
  const leads = useAppStore((s) => s.leads);
  const services = useAppStore((s) => s.services);
  const jobs = useAppStore((s) => s.jobs);
  const updateInvoice = useAppStore((s) => s.updateInvoice);
  const archiveInvoice = useAppStore((s) => s.archiveInvoice);
  const setInvoiceLines = useAppStore((s) => s.setInvoiceLines);
  const recordPayment = useAppStore((s) => s.recordPayment);
  const sendInvoice = useAppStore((s) => s.sendInvoice);

  const [busy, setBusy] = useState(false);
  const [payErr, setPayErr] = useState<string | null>(null);

  const invoiceId = activeModal?.params?.invoiceId as string | undefined;
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
      patch.leadId = "";
    }
    updateInvoice(invoice.id, patch);
  }

  function send() {
    if (!invoice) return;
    // Finalize (draft → sent). The modal stays open and re-renders to the sent state, where
    // Charge / Record become available — no dead-end close.
    sendInvoice(invoice.id);
  }

  function record(amt: number, method: RecordMethod) {
    if (!invoice) return;
    recordPayment(invoice.id, { amt, when: "Just now", method });
  }

  // Charge a card: mint the Stripe hosted-checkout link for the balance and open it. Because the
  // client id is preserved through draft, invoice.id is the server row id. Surfaces the provider
  // error (e.g. "finish payment setup") instead of failing silently.
  async function charge() {
    if (!invoice) return;
    setPayErr(null);
    setBusy(true);
    try {
      const { url } = await trpcVanilla.v1.invoicing.createPayment.mutate({ invoiceId: invoice.id });
      window.open(url, "_blank", "noopener");
    } catch (e) {
      setPayErr(e instanceof Error ? e.message : "Couldn't start the card payment — try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      {/* Header — num · customer · title + phone · status pill. paddingRight clears the shell ✕. */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: "var(--space-3)", paddingRight: "var(--space-8)" }}>
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
        <div className="muted" style={{ fontSize: "var(--type-sm)", marginTop: "var(--space-2)" }}>
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
          services={services}
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

      {/* Get paid — Send (draft, finalizes) · Charge a card / Record cash-check (sent, owed) */}
      {total > 0 && (due > 0 || !sent) ? (
        <GetPaid
          due={due}
          sent={sent}
          busy={busy}
          error={payErr}
          onSend={send}
          onCharge={charge}
          onRecord={(m) => record(due, m)}
        />
      ) : null}

      {/* Footer — Preview as customer + Done */}
      <div
        style={{
          display: "flex",
          justifyContent: "flex-end",
          gap: "var(--space-3)",
          marginTop: "var(--space-4)",
          borderTop: "1px solid var(--line)",
          paddingTop: "var(--space-3)",
        }}
      >
        {invoice.archived ? (
          <button
            className="btn ghost"
            style={{ marginRight: "auto" }}
            onClick={() => updateInvoice(invoice.id, { archived: false })}
          >
            Restore
          </button>
        ) : (
          <button
            className="btn ghost"
            style={{ marginRight: "auto" }}
            onClick={() => {
              archiveInvoice(invoice.id);
              close();
            }}
          >
            Archive
          </button>
        )}
        <button className="btn ghost" onClick={() => pushModal(MODAL.CUST_INVOICE, { invoiceId: invoice.id })}>
          Preview as customer
        </button>
        <button className="btn primary" onClick={close}>
          Done
        </button>
      </div>
    </div>
  );
}
