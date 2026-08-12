/**
 * components/modals/close-out-modal.tsx
 * Faithful port of the prototype's field CLOSE-OUT / collect-payment flow —
 * the "job done → get paid on site" hero:
 *   - openCloseOut               (prototype 5284-5360)  → CloseOutModalContent
 *   - billAskBlock / billLineAmt / billLineDesc / suggestBill (5330-5405) → BillAsk
 *   - commitBill / invSetBill    (5406-5430)            → BillAsk commit paths
 *   - coPayBlock                 (5581-5620)            → PayBlock
 *   - coPay (state machine)      (5550-5580)            → PayBlock local reducer
 *
 * Composed from EXISTING store actions (never re-adding store model). Raw arrays
 * are selected from the store — NEVER a derived array inside a selector (that
 * loops). Local component state carries the pay + bill drafts (prototype _coUI /
 * _billDraft) so nothing new lands in the store.
 *
 * GATED for now (job.addons is empty; no verify state yet):
 *   // Field chunk 5: found-work settlement + verify gaps render here
 */

"use client";

import { DraftNumberInput } from "@/components/shared/draft-number-input";
import { fmt$2 } from "@/lib/format";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  useAppStore,
  useActiveModal,
  useCloseModal,
  useDismissModals,
} from "@/lib/store/app-store";
import { useMe } from "@/features/identity/hooks";
import { useOrgServiceFee } from "@/features/settings/use-org-service-fee";
import { Field } from "@/components/ui/input";
import { ListLoading } from "@/components/shared/list-loading";
import { TapToPayUnavailable } from "@/components/shared/tap-to-pay-unavailable";
import { useTapToPayAvailability } from "@/lib/native/tap-to-pay";
import { CardCheckoutStep } from "./close-out-card-step";
import { CloseOutDocument, SendDocumentButton } from "./close-out-document";
import { invDue, invPaid } from "@/lib/store/invoice-balance";
import { jobPricedTotals } from "@/lib/store/job-pricing";
import { readInvoice, type InvoiceWriteSurface } from "@/lib/store/invoice-write";
import { invalidateLists } from "@/lib/trpc/list-cache";
import type {
  Invoice,
  InvoiceLine,
  Job,
  JobLine,
  Lead,
  Addon,
  ChecklistItem,
  VerifyAns,
} from "@/lib/store/types";

// ---- helpers (ported 1:1 from the prototype) -------------------------------

/** fmt$ — integer dollars → "$N,NNN" (prototype fmt$). */
function fmt$(n: number): string {
  return "$" + Math.round(n).toLocaleString("en-US");
}

/**
 * jobTotal — sum of the job's line amounts (prototype jobTotal / tech-job-modal).
 *
 * OFFICE-GRADE ONLY. `?? 0` swallows the server's redaction, so on a field device this returns 0
 * for a fully-priced job; and even unredacted it is the raw line sum, with no deposit credited and
 * no recorded tax. Never render it to a technician — see the surface gate in CloseOutModalContent.
 */
function jobTotal(j: Job): number {
  return (j.lines ?? []).reduce((s, l) => s + (l.q ?? 1) * (l.r ?? 0), 0);
}

/**
 * invPaid / invDue — ONE definition, in lib/store/invoice-balance.ts. The sheet's own copy
 * ignored the server's balance on a summary row, so the amount on the Take-payment button
 * disagreed with the ledger's.
 */

/** custCard — the saved card lives on the linked lead (prototype custCard). */
function custCard(lead: Lead | undefined): Lead["card"] | null {
  return lead?.card ?? null;
}

/** custName — linked lead's name, else the job title (prototype custName, 3582). */
function custNameOf(j: Job, lead: Lead | undefined): string {
  if (lead) return lead.name;
  const m = (j.title ?? "").split("—");
  return m.length > 1 ? (m[1] ?? "").trim() : j.title || "Customer";
}

// prototype line 3866 — labor hours implied by the job's lines; floor of 2h.
const STD_LABOR_RATE = 170;

function estJobHours(j: Job): number {
  const ls = j.lines ?? [];
  if (!ls.length) return 2;
  // The app doesn't carry the prototype's per-line lineHours() lexicon, so fall
  // back to the pricebook-style hour hint carried on the line (h) when present,
  // else a 2h floor — faithful to "labor at your rate × the job size".
  const h = ls.reduce((s, l) => s + ((l as JobLine & { h?: number }).h ?? 0) * (l.q ?? 1), 0);
  return h > 0 ? Math.round(h * 2) / 2 : 2;
}

/**
 * suggestBill — a fast-booked job can reach the truck with no price; the
 * close-out asks ONE plain question with a suggested number (prototype 5334).
 * pricebook match > job.expected > labor at your rate × the job size + materials.
 */
function suggestBill(j: Job, pricebook: ReadonlyArray<{ name: string; unitPrice: number }>): number {
  const t = (j.title ?? "").toLowerCase();
  const p = pricebook.find(
    (pb) => pb.unitPrice > 150 && t.includes(pb.name.toLowerCase().split(" ")[0] ?? "")
  );
  if (p) return p.unitPrice;
  if (j.expected) return j.expected;
  return Math.max(95, Math.round((estJobHours(j) * STD_LABOR_RATE * 1.4) / 5) * 5);
}

// ---- bill-draft line model (prototype _billDraft.lines) --------------------

interface LaborBillLine {
  kind: "labor";
  h: number;
  m: number;
  rate: number;
  who?: string;
  fromClock?: boolean;
}

interface FlatBillLine {
  kind: "flat";
  d: string;
  r: number;
}

type BillLine = LaborBillLine | FlatBillLine;

/** billLineAmt — a labor line bills hours×rate; a flat line bills its $ (5341). */
function billLineAmt(L: BillLine): number {
  return L.kind === "labor"
    ? Math.round(((+L.h || 0) + (+L.m || 0) / 60) * (+L.rate || 0))
    : +L.r || 0;
}

/** billLineDesc — the invoice-line text for a bill line (5342). */
function billLineDesc(L: BillLine): string {
  return L.kind === "labor"
    ? `Labor — ${+L.h || 0}h${+L.m ? ` ${+L.m}m` : ""} × ${fmt$(+L.rate || 0)}/hr`
    : L.d || "";
}

// ===========================================================================
//  BILL-ASK — "No price on this job yet — what did it run?" (prototype billAskBlock)
//  Renders ONLY when the resolved invoice total ≤ 0. Tabs: One price / Itemize.
// ===========================================================================

interface BillDraft {
  mode: "flat" | "items";
  lines: BillLine[];
}

export interface BillAskProps {
  job: Job;
  suggested: number;
  onCommit: (invoiceLines: InvoiceLine[]) => void | Promise<void>;
  /** Persist failure surfaced by the parent (setJobLines rejected). */
  error?: string | null;
  /**
   * The org's real visit/diagnostic fee, dollars — read outside the store on this surface
   * (this modal's only entry, the tech job modal, lives in the field shell, which never
   * hydrates settings; see features/settings/use-org-service-fee.ts). null/0 = not genuinely
   * set yet, so presetFee falls back to 89, the ultimate fallback.
   */
  serviceFee?: number | null;
}

const NUM_INPUT: React.CSSProperties = {
  width: 130,
  border: "1.5px solid var(--line)",
  borderRadius: "var(--radius-sm)",
  padding: "var(--space-2) var(--space-3)",
  fontFamily: "inherit",
  fontWeight: 700,
};

export function BillAsk({ job, suggested, onCommit, error, serviceFee }: BillAskProps) {
  const [draft, setDraft] = useState<BillDraft>({ mode: "flat", lines: [] });
  const [flatAmt, setFlatAmt] = useState<number>(suggested);
  const [addDesc, setAddDesc] = useState("");
  const [addAmt, setAddAmt] = useState("");

  const tot = draft.lines.reduce((s, L) => s + billLineAmt(L), 0);

  // ---- flat commit → one job/invoice line {d:title,q:1,r:amt} (invSetBill) ---
  function commitFlat() {
    const amt = +flatAmt || 0;
    if (amt <= 0) return;
    onCommit([{ d: job.title || "Work performed", q: 1, r: amt }]);
  }

  // ---- itemized commit → each bill line → invoice line (commitBill) ----------
  function commitItems() {
    const lines = draft.lines
      .map((L) => ({ d: billLineDesc(L), q: 1, r: billLineAmt(L) }))
      .filter((l) => l.r > 0);
    if (!lines.length) return;
    onCommit(lines);
  }

  // ---- itemized line ops (immutable; never mutate a stored line) -------------
  function addLabor() {
    setDraft((d) => ({
      ...d,
      lines: [...d.lines, { kind: "labor", h: 0, m: 0, rate: STD_LABOR_RATE }],
    }));
  }

  function setLabor(k: number, f: "h" | "m" | "rate", v: string) {
    setDraft((d) => ({
      ...d,
      lines: d.lines.map((L, i) => {
        if (i !== k || L.kind !== "labor") return L;
        let n = Math.max(0, Math.round(+v || 0));
        if (f === "m") n = Math.min(59, n);
        return { ...L, [f]: n };
      }),
    }));
  }

  function removeLine(k: number) {
    setDraft((d) => ({ ...d, lines: d.lines.filter((_, i) => i !== k) }));
  }

  function presetFee() {
    setAddDesc("Service / diagnostic call");
    // The org's real fee; 89 is the ultimate fallback only when it isn't genuinely set (0/null).
    if (!addAmt) setAddAmt(String(serviceFee || 89));
  }

  function addFlatLine() {
    const d = addDesc.trim();
    const r = +addAmt || 0;
    if (!d) return;
    setDraft((dr) => ({ ...dr, lines: [...dr.lines, { kind: "flat", d, r }] }));
    setAddDesc("");
    setAddAmt("");
  }

  const tab = (m: BillDraft["mode"], lbl: string) => (
    <button
      className={`chip ${draft.mode === m ? "sel" : ""}`}
      onClick={() => setDraft((d) => ({ ...d, mode: m }))}
    >
      {lbl}
    </button>
  );

  return (
    <div className="reqcard" style={{ marginBottom: "var(--space-3)" }}>
      <b>No price on this job yet — what did it run?</b>
      <div className="chips" style={{ margin: "var(--space-2) 0 0" }}>
        {tab("flat", "One price")}
        {tab("items", "Itemize")}
      </div>

      {error ? (
        <p style={{ color: "var(--red)", fontSize: "var(--type-base)", margin: "var(--space-2) 0 0" }}>{error}</p>
      ) : null}

      {draft.mode === "flat" ? (
        <>
          <div style={{ display: "flex", gap: "var(--space-2)", marginTop: "var(--space-3)", flexWrap: "wrap" }}>
            <input
              type="number"
              inputMode="decimal"
              value={flatAmt}
              onChange={(e) => setFlatAmt(+e.target.value || 0)}
              style={NUM_INPUT}
            />
            <button className="btn sm primary" onClick={commitFlat}>
              Set the bill
            </button>
          </div>
          <p className="muted" style={{ fontSize: "var(--type-sm)", marginTop: "var(--space-2)" }}>
            <b>Flat-rate.</b> One fixed price for the whole job — the hours your tech clocked are your
            cost, they don&rsquo;t change the bill. Suggested from your rates × the job size
            {job.expected ? ` · Front Desk read it as ~${fmt$(job.expected)}` : ""}.
          </p>
        </>
      ) : (
        <div style={{ marginTop: "var(--space-3)" }}>
          {draft.lines.length ? (
            draft.lines.map((L, k) =>
              L.kind === "labor" ? (
                <div
                  key={k}
                  className="stage-row"
                  style={{ border: "none", padding: "var(--space-2) 0", gap: "var(--space-2)", flexWrap: "wrap" }}
                >
                  <span style={{ minWidth: 44, fontWeight: 600 }}>
                    Labor
                    {L.who ? (
                      <span className="muted" style={{ fontWeight: 500 }}>
                        {" "}
                        · {L.who}
                      </span>
                    ) : null}
                  </span>
                  <input
                    type="number"
                    inputMode="decimal"
                    min={0}
                    value={L.h}
                    onChange={(e) => setLabor(k, "h", e.target.value)}
                    style={LABOR_IN}
                  />
                  <span className="muted">h</span>
                  <input
                    type="number"
                    inputMode="decimal"
                    min={0}
                    max={59}
                    value={L.m}
                    onChange={(e) => setLabor(k, "m", e.target.value)}
                    style={LABOR_IN}
                  />
                  <span className="muted">m × $</span>
                  <input
                    type="number"
                    inputMode="decimal"
                    min={0}
                    value={L.rate}
                    onChange={(e) => setLabor(k, "rate", e.target.value)}
                    style={{ ...LABOR_IN, width: 64 }}
                  />
                  <span className="muted">/hr</span>
                  {L.fromClock ? (
                    <span className="pill amber" style={{ fontSize: "var(--type-xs)" }}>
                      ⏱ from the clock
                    </span>
                  ) : null}
                  <b style={{ marginLeft: "auto" }}>{fmt$(billLineAmt(L))}</b>
                  <button className="btn sm ghost" onClick={() => removeLine(k)}>
                    ✕
                  </button>
                </div>
              ) : (
                <div key={k} className="stage-row" style={{ border: "none", padding: "var(--space-2) 0" }}>
                  <span style={{ flex: 1 }}>{L.d}</span>
                  <b>{fmt$(L.r)}</b>{" "}
                  <button className="btn sm ghost" onClick={() => removeLine(k)}>
                    ✕
                  </button>
                </div>
              )
            )
          ) : (
            <div className="muted" style={{ fontSize: "var(--type-sm)" }}>
              <b>Time &amp; materials.</b> The bill follows the work: <b>Labor</b> bills the hours your
              tech clocked × your rate (never marked up), plus any fees and parts. Add a labor line and
              it fills in from the clock.
            </div>
          )}

          <div className="chips" style={{ margin: "var(--space-2) 0 var(--space-2)" }}>
            <button className="chip" onClick={addLabor}>
              + Labor (time × rate)
            </button>
            <button className="chip" onClick={presetFee}>
              + Service / diagnostic fee
            </button>
            <button className="chip" onClick={() => setAddDesc("")}>
              + Part
            </button>
          </div>

          <div style={{ display: "flex", gap: "var(--space-2)", flexWrap: "wrap", alignItems: "center" }}>
            <input
              placeholder="fee or part description"
              value={addDesc}
              onChange={(e) => setAddDesc(e.target.value)}
              style={{
                flex: 2,
                minWidth: 150,
                border: "1.5px solid var(--line)",
                borderRadius: "var(--radius-sm)",
                padding: "var(--space-2) var(--space-3)",
                fontFamily: "inherit",
              }}
            />
            <input
              type="number"
              inputMode="decimal"
              placeholder="$"
              value={addAmt}
              onChange={(e) => setAddAmt(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") addFlatLine();
              }}
              style={{
                width: 90,
                border: "1.5px solid var(--line)",
                borderRadius: "var(--radius-sm)",
                padding: "var(--space-2) var(--space-3)",
                fontFamily: "inherit",
              }}
            />
            <button className="btn sm" onClick={addFlatLine}>
              Add
            </button>
          </div>

          {draft.lines.length ? (
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                marginTop: "var(--space-3)",
              }}
            >
              <b>Total {fmt$(tot)}</b>
              <button className="btn sm primary" onClick={commitItems}>
                Use this bill
              </button>
            </div>
          ) : null}
        </div>
      )}
    </div>
  );
}

const LABOR_IN: React.CSSProperties = {
  width: 48,
  border: "1.5px solid var(--line)",
  borderRadius: "var(--radius-xs)",
  padding: "var(--space-1) var(--space-2)",
  fontFamily: "inherit",
};

// ===========================================================================
//  DUE CARD — the money side (prototype openCloseOut §money card, 5312-5320)
// ===========================================================================

function DueCard({ invoice }: { invoice: Invoice }) {
  const due = invDue(invoice);
  const paid = invPaid(invoice);
  const total = invoice.total ?? 0;

  return (
    <div
      className="card"
      style={{
        marginBottom: "0",
        display: "flex",
        justifyContent: "space-between",
        alignItems: "flex-end",
      }}
    >
      <span className="muted" style={{ fontSize: "var(--type-sm)" }}>
        {invoice.num}
      </span>
      <span style={{ textAlign: "right" }}>
        {invoice.depPaid ? (
          <div className="muted" style={{ fontSize: "var(--type-sm)", color: "var(--green-700)" }}>
            − {fmt$(invoice.depPaid)} deposit paid
          </div>
        ) : null}
        {paid ? (
          <div className="muted" style={{ fontSize: "var(--type-sm)", color: "var(--green-700)" }}>
            − {fmt$(paid)} paid
          </div>
        ) : null}
        <div style={{ fontWeight: 900, fontSize: "var(--type-2xl)", lineHeight: 1.1 }}>
          {total <= 0 ? (
            <span style={{ fontSize: "var(--type-lg)", color: "var(--ink-3)" }}>No bill set yet</span>
          ) : due > 0 ? (
            // Cent-precise on purpose: the local fmt$ rounds to whole dollars, which printed "$10"
            // over an invoice genuinely due $10.40 — a money figure may never disagree with the charge.
            fmt$2(due)
          ) : (
            "Paid ✓"
          )}
        </div>
        {due > 0 ? (
          <div className="muted" style={{ fontSize: "var(--type-xs)" }}>
            due now
          </div>
        ) : null}
      </span>
    </div>
  );
}

// ===========================================================================
//  PAY BLOCK — the on-site payment sheet (prototype coPayBlock / coPay)
//  Local pay state machine: method | card | record | done. The card step is a
//  REAL Stripe Checkout (QR + link, poll to paid) — see close-out-card-step.tsx.
// ===========================================================================

type PayMethod = "card" | "cash" | "check" | "ach";
type PayStep = "method" | "card" | "record" | "done";

interface PayState {
  step: PayStep;
  method?: PayMethod;
  amt: number;
  onFile?: boolean;
}

interface PayBlockProps {
  invoice: Invoice;
  lead: Lead | undefined;
  /**
   * Record a payment taken outside the app. Resolves only once the record can genuinely
   * proceed (draft sent first; fresh paid-check done) — `alreadyPaid` means the checkout
   * QR beat the manual record and the money is ALREADY in: jump to done, record nothing.
   */
  onApprove: (args: {
    amt: number;
    method: PayMethod;
    onFile: boolean;
  }) => Promise<{ ok: boolean; error?: string; alreadyPaid?: boolean }>;
  /** The store's sendInvoice — the card step must SEND a draft before minting. */
  sendInvoice: (id: string) => Promise<{ ok: boolean; error?: string }>;
  /** Which API the card step's mint + poll go to. See CardCheckoutStepProps.surface. */
  surface: InvoiceWriteSurface;
  /** The card step's poll saw paid/partial — the parent adopts the fresh record. */
  onCardPaid: (invoice: Invoice) => void;
  /**
   * Whether this device's holder is the person collecting AT THE DOOR (tech or owner) — the
   * audience the Tap to Pay affordance exists for. Office staff work a desk: a phone-as-reader
   * control there is noise, so they don't get it.
   */
  offerTapToPay: boolean;
  onFinish: () => void;
  onCancel: () => void;
}

function clampAmt(amt: number, due: number): number {
  let a = Math.min(amt || due, due);
  if (a <= 0) a = due;
  return a;
}

function PayBlock({
  invoice,
  lead,
  onApprove,
  sendInvoice,
  surface,
  onCardPaid,
  offerTapToPay,
  onFinish,
  onCancel,
}: PayBlockProps) {
  const due = invDue(invoice);
  const card = custCard(lead);
  // Unconditional (hooks law); rendered only when this holder gets the affordance at all.
  const tapAvailability = useTapToPayAvailability();
  const [p, setP] = useState<PayState>({ step: "method", amt: due });
  // A record that could NOT proceed (draft send failed, server refused) — named in
  // place on the step the tech is looking at, never a silent "Approved".
  const [payErr, setPayErr] = useState<string | null>(null);
  // SINGLE-FLIGHT. approve() is async (fresh read + possibly an awaited send), so the
  // button stays mounted through a network round-trip — and every recordPayment mints a
  // FRESH idempotency key, so the server cannot dedupe a double tap. On a PARTIAL amount
  // the invoice stays payable and a second record genuinely applies. The ref is the
  // re-entry gate (synchronous — two taps in one tick both see stale state); the state
  // drives the visible busy treatment.
  const inFlightRef = useRef(false);
  const [busy, setBusy] = useState(false);

  const amtIn = (
    <>
      <span className="muted">$</span>
      <DraftNumberInput
        value={p.amt || due}
        decimals={2}
        aria-label="Amount due in dollars"
        onCommit={(n) => setP((s) => ({ ...s, amt: n }))}
        style={{
          width: 118,
          border: "1.5px solid var(--line)",
          borderRadius: "var(--radius-sm)",
          padding: "var(--space-2) var(--space-3)",
          fontFamily: "inherit",
          fontWeight: 700,
        }}
      />
    </>
  );

  // ---- charge card on file → record, jump to done (coPay 'onfile') -----------
  async function chargeOnFile() {
    if (inFlightRef.current) return; // single-flight — a double tap must not double-record
    inFlightRef.current = true;
    setBusy(true);
    setPayErr(null);
    try {
      const amt = clampAmt(p.amt, due);
      const res = await onApprove({ amt, method: "card", onFile: true });
      if (!res.ok) {
        setPayErr(res.error ?? "Couldn't record the payment — try again.");
        return;
      }
      if (res.alreadyPaid) {
        // The checkout QR (or an emailed link) already collected the balance.
        setP({ step: "done", method: "card", amt: due });
        return;
      }
      setP({ step: "done", method: "card", amt, onFile: true });
    } finally {
      inFlightRef.current = false;
      setBusy(false);
    }
  }

  // ---- record a payment taken outside the app (coPay 'approve') --------------
  // Done only renders once onApprove genuinely succeeded — a refused record must
  // never show "Approved" (the old fire-and-forget did exactly that).
  async function approve() {
    if (inFlightRef.current) return; // single-flight — a double tap must not double-record
    inFlightRef.current = true;
    setBusy(true);
    setPayErr(null);
    try {
      const amt = clampAmt(p.amt, due);
      const method = p.method ?? "cash";
      const res = await onApprove({ amt, method, onFile: false });
      if (!res.ok) {
        setPayErr(res.error ?? "Couldn't record the payment — try again.");
        return;
      }
      if (res.alreadyPaid) {
        setP({ step: "done", method: "card", amt: due });
        return;
      }
      setP({ step: "done", method, amt });
    } finally {
      inFlightRef.current = false;
      setBusy(false);
    }
  }

  // step: card — a REAL Stripe Checkout as a QR (the simulated tap is gone) ----
  if (p.step === "card") {
    return (
      <CardCheckoutStep
        invoice={invoice}
        amount={due}
        surface={surface}
        sendInvoice={sendInvoice}
        onPaid={(fresh) => {
          // The webhook already recorded the money; adopt the fresh record (no
          // recordPayment double-write) and land on the existing done step.
          onCardPaid(fresh);
          setP({ step: "done", method: "card", amt: due });
        }}
        onRecordInstead={() => setP({ step: "record", method: "cash", amt: due })}
        onCancel={onCancel}
      />
    );
  }

  // step: record (cash / check / bank) ---------------------------------------
  if (p.step === "record") {
    const lbl = p.method === "ach" ? "bank transfer" : p.method;
    return (
      <div
        className="copay-record"
        style={{ marginTop: "var(--space-2)", display: "flex", gap: "var(--space-2)", alignItems: "center", flexWrap: "wrap" }}
      >
        {amtIn}
        {/* No "Check #" field here: `payments` has nowhere honest to put it. `external_id` is
            documented (payment.ts, payment-gateway.ts) as "Stripe payment id later; null for
            manual entries" — writing a hand-written check number into that column would be
            exactly the conflation the domain layer's own comment rules out, and this PR does
            not add a migration for a real column. An input whose value is silently discarded
            is worse than no input, so it was removed rather than kept as decoration. */}
        <button className="btn primary" disabled={busy} onClick={approve}>
          {busy ? "Recording…" : <>Record {lbl} — paid</>}
        </button>
        <span
          className="linklike"
          onClick={() => setP((s) => ({ ...s, step: "method", amt: due }))}
        >
          back
        </span>
        {payErr ? (
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
            {payErr}
          </p>
        ) : null}
      </div>
    );
  }

  // step: done ---------------------------------------------------------------
  if (p.step === "done") {
    const detail = p.onFile
      ? `${card ? card.brand + " ···· " + card.last4 : "Card"} on file`
      : p.method === "card"
      ? "Card · Stripe checkout"
      : p.method === "ach"
      ? "Bank transfer"
      : p.method === "check"
      ? "Check recorded"
      : "Cash recorded";
    const nowDue = invDue(invoice);
    return (
      <div className="cotap cotap-ok">
        <div className="cotap-check">✓</div>
        <div style={{ fontWeight: 800, fontSize: "var(--type-xl)" }}>Approved · {fmt$(p.amt || due)}</div>
        <div className="cotap-sub">
          {detail}
          {nowDue > 0 ? ` · ${fmt$(nowDue)} still due` : " · paid in full"}
        </div>
        <div
          style={{
            display: "flex",
            gap: "var(--space-2)",
            justifyContent: "center",
            marginTop: "var(--space-4)",
            flexWrap: "wrap",
          }}
        >
          {/* The receipt send, re-wired. "Text receipt" was deleted from here as a dead button
              because no receipt-send endpoint existed; `v1.fieldInvoicing.sendDocument` is that
              endpoint, and once the balance is settled it sends the RECEIPT rather than the bill
              (the server picks the copy from the invoice's own balance, not from this button).
              Still an option, never automatic — nothing sends itself on payment. */}
          <SendDocumentButton invoice={invoice} />
          <button className="btn primary" onClick={onFinish}>
            Done
          </button>
        </div>
      </div>
    );
  }

  // step: method (default) ---------------------------------------------------
  return (
    <div style={{ marginTop: "var(--space-2)" }}>
      <div style={{ display: "flex", alignItems: "center", gap: "var(--space-2)", marginBottom: "var(--space-3)" }}>
        <span className="muted" style={{ fontSize: "var(--type-sm)" }}>
          Amount due
        </span>
        {amtIn}
      </div>
      <div className="copay-methods">
        {card ? (
          <button
            className="btn primary copay-tap"
            disabled={busy}
            onClick={chargeOnFile}
          >
            <b>
              {busy ? "Charging…" : <>Charge {card.brand} ···· {card.last4}</>}
            </b>
            <span>
              {card.via ? "saved from " + card.via + " · " : ""}instant, no tap
            </span>
          </button>
        ) : null}
        {/* The amount box above applies to RECORDED methods only — a checkout
            session always charges the full balance, so the button says so. */}
        <button
          className={`btn ${card ? "" : "primary"} copay-tap`}
          onClick={() => setP((s) => ({ ...s, step: "card", method: "card" }))}
        >
          <b>Card</b>
          <span>scan to pay · charges the full balance</span>
        </button>
        {/* Tap to Pay — phone-as-reader. The server rails exist (v1.terminal.*); the native
            reader plugin is the next app-shell PR, so until it ships this renders DISABLED with
            the honest reason (the ScanUnavailable pattern) — visible so the person at the door
            knows it is coming, never a dead button pretending to work. */}
        {offerTapToPay ? <TapToPayUnavailable availability={tapAvailability} /> : null}
        <button
          className="btn"
          onClick={() => setP((s) => ({ ...s, step: "record", method: "cash" }))}
        >
          Cash
        </button>
        <button
          className="btn"
          onClick={() => setP((s) => ({ ...s, step: "record", method: "check" }))}
        >
          Check
        </button>
        <button
          className="btn"
          onClick={() => setP((s) => ({ ...s, step: "record", method: "ach" }))}
        >
          Bank
        </button>
      </div>
      {payErr ? (
        <p
          role="alert"
          style={{
            color: "var(--red)",
            fontSize: "var(--type-sm)",
            fontWeight: 600,
            margin: "var(--space-2) 0 0",
          }}
        >
          {payErr}
        </p>
      ) : null}
      <span
        className="linklike"
        onClick={onCancel}
        style={{ display: "inline-block", marginTop: "var(--space-3)" }}
      >
        ← back
      </span>
    </div>
  );
}

// ===========================================================================
//  FOUND-WORK SETTLEMENT (prototype invIncludeAddon / invSkipAddon, 5494-5507)
//  Add-ons still proposed & not skipped need the customer's OK before the bill
//  goes out — a .reqcard listing each with "OK'd — include" / "Leave off".
// ===========================================================================

interface FoundWorkSettleProps {
  pending: Addon[];
  onInclude: (addon: Addon) => void;
  onSkip: (addon: Addon) => void;
  /**
   * May settle found work — `v1.jobs.setAddonStatus` / `setAddonInvSkip`, both ownerOrOffice.
   * The office OK-pill IS the approval gate and `v1.field.addAddon` hard-codes `status:
   * "proposed"` for exactly that reason, so letting a technician approve their own found work
   * would invert a stated law. False renders the list READ-ONLY.
   */
  canSettle: boolean;
}

function FoundWorkSettle({ pending, onInclude, onSkip, canSettle }: FoundWorkSettleProps) {
  if (!pending.length) return null;
  // `a.r === null` is the server's redaction, not a free add-on (money-redaction.ts nulls addon
  // rates on a techSeesPrice-off device). Reducing it with `?? 0` prints "$0 in found work", which
  // reads as "nothing extra was found" — the opposite of the warning this card exists to give. If
  // even one rate is withheld the total is unknowable on this device, so name none — the tech
  // surface's standing rule for redacted money (work-order-sec follows it too).
  const anyHidden = pending.some((a) => a.r === null);
  const sum = pending.reduce((s, a) => s + (a.q ?? 1) * (a.r ?? 0), 0);
  const what = anyHidden ? "Found work" : `${fmt$(sum)} in found work`;

  return (
    <div className="reqcard" style={{ marginBottom: "var(--space-3)" }}>
      <b>
        {canSettle
          ? `⚠ ${what} awaiting the customer’s OK`
          : `⚠ ${what} — not on this bill`}
      </b>
      {canSettle ? null : (
        <div className="muted" style={{ fontSize: "var(--type-sm)", marginTop: "var(--space-1)" }}>
          The office quotes it. Collect what was agreed.
        </div>
      )}
      <div style={{ marginTop: "var(--space-2)" }}>
        {pending.map((a) => (
          <div key={a.id} className="stage-row">
            <div style={{ flex: 1 }}>
              <b style={{ fontWeight: 600 }}>{a.d}</b>{" "}
              {/* Redacted rate: show nothing, never $0 (see anyHidden above). */}
              {a.r != null ? (
                <span className="muted">· {fmt$((a.q ?? 1) * a.r)}</span>
              ) : null}
            </div>
            {canSettle ? (
              <>
                <button className="btn sm primary" onClick={() => onInclude(a)}>
                  ✓ OK&rsquo;d — include
                </button>
                <button className="btn sm ghost" onClick={() => onSkip(a)}>
                  Leave off
                </button>
              </>
            ) : null}
          </div>
        ))}
      </div>
    </div>
  );
}

// ===========================================================================
//  VERIFY GAPS (prototype verifySection gaps, 4876) — required checklist items
//  still unanswered. Collapsible; does NOT block the bill. Each gap: ✓ done /
//  re-photo + N/A / Customer declined / Photo unclear override chips.
// ===========================================================================

interface VerifyGapRow {
  it: ChecklistItem;
  a: VerifyAns | undefined;
}

/** Required + unanswered checklist items (prototype jobVerifyState.gaps). */
function verifyGaps(job: Job): VerifyGapRow[] {
  const cl = job.checklist;
  if (!cl) return [];
  const ans = job.verify?.ans ?? {};
  return (cl.items ?? [])
    .filter((it) => (it.text ?? "").trim())
    .map((it) => ({ it, a: ans[it.id] }))
    .filter((x) => !x.a && x.it.required);
}

const GAP_REASONS = ["N/A", "Customer declined", "Photo unclear"] as const;

interface VerifyGapsProps {
  job: Job;
  onCheck: (itemId: string) => void;
  onRephoto: () => void;
  onOverride: (itemId: string, reason: string) => void;
}

function VerifyGaps({ job, onCheck, onRephoto, onOverride }: VerifyGapsProps) {
  const [open, setOpen] = useState(false);
  const gaps = verifyGaps(job);
  if (!gaps.length) return null;

  return (
    <div className="reqcard" style={{ marginBottom: "var(--space-3)" }}>
      <div
        style={{ display: "flex", alignItems: "center", cursor: "pointer" }}
        onClick={() => setOpen((o) => !o)}
      >
        <b style={{ flex: 1 }}>
          ⚠ {gaps.length} {gaps.length === 1 ? "check" : "checks"} open — doesn&rsquo;t block the bill
        </b>
        <span className="linklike" style={{ fontSize: "var(--type-sm)" }}>
          {open ? "hide" : "review"}
        </span>
      </div>
      {open ? (
        <div style={{ marginTop: "var(--space-2)" }}>
          {gaps.map((x) => (
            <div key={x.it.id} className="stage-row" style={{ flexWrap: "wrap" }}>
              <span style={{ flex: 1, minWidth: 140 }}>{x.it.text}</span>
              {x.it.type === "photo" ? (
                <button className="btn sm ghost" onClick={onRephoto}>
                  re-photo
                </button>
              ) : (
                <button className="btn sm primary" onClick={() => onCheck(x.it.id)}>
                  ✓ done
                </button>
              )}
              {GAP_REASONS.map((r) => (
                <button
                  key={r}
                  className="chip"
                  style={{ padding: "var(--space-1) var(--space-3)", fontSize: "var(--type-sm)" }}
                  onClick={() => onOverride(x.it.id, r)}
                >
                  {r}
                </button>
              ))}
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}

// ===========================================================================
//  A sheet that cannot show the close-out yet — but never a blank one
// ===========================================================================

interface CloseOutNoticeProps {
  /** The sticky sheet title, so the technician still knows which sheet this is. */
  title: string;
  /** The job line under it, when a job is loaded. */
  subtitle?: string;
  /** What went wrong, in the shop's words. */
  heading?: string;
  /** The next step. Never a bare apology. */
  message: string;
  /** Present only when there is genuinely something to re-fire. */
  onRetry?: () => void;
}

/**
 * The honest stand-in for the close-out sheet. Composed from the same .sheet-head + .loadfail
 * primitives the office list surfaces use (see components/shared/load-failed.tsx) — the copy
 * differs because a bill that could not be RAISED is not a list that failed to load, and the
 * reason is usually a domain refusal ("job must be complete before it can be invoiced",
 * "Your role can't do that") that the technician needs to read verbatim.
 */
function CloseOutNotice({ title, subtitle, heading, message, onRetry }: CloseOutNoticeProps) {
  return (
    <>
      <div className="sheet-head">
        <h2>{title}</h2>
        {subtitle ? (
          <div className="sheet-meta">
            <span>{subtitle}</span>
          </div>
        ) : null}
      </div>
      <div className="loadfail" role="alert">
        {heading ? <p className="loadfail-h">{heading}</p> : null}
        <p className="loadfail-s">{message}</p>
        {onRetry ? (
          <button className="btn" onClick={onRetry}>
            Try again
          </button>
        ) : null}
      </div>
    </>
  );
}

// ===========================================================================
//  THE MODAL BODY — "Wrap up — {custName}" (prototype openCloseOut)
// ===========================================================================

export function CloseOutModalContent() {
  const activeModal = useActiveModal();
  const close = useCloseModal();
  const dismissModals = useDismissModals();

  // WHO IS HOLDING THIS SHEET. Until this change the close-out had zero role checks and was
  // protected only by being unreachable — the tech job modal never opened it for a technician.
  // It opens for them now, so every write below has to say which API it goes to, and the office
  // capabilities with no field sibling have to say so themselves. Fail closed: an unresolved role
  // reads as the field.
  const me = useMe();
  const isOffice = me.data?.role === "owner" || me.data?.role === "office";
  const surface: InvoiceWriteSurface = isOffice ? "office" : "field";
  // The layout seeds this query, so the role is normally on the very first render. `roleKnown`
  // exists for the frame where it is not: `surface` fails closed to "field", and the mount effect
  // below RAISES AN INVOICE — an owner who lost that race would land their office bill in the
  // redacted field shape (no recorded tax, no pay-link) and never re-fetch it, because the effect
  // short-circuits once an invoice exists. Nothing is written until identity is settled.
  const roleKnown = !me.isLoading;

  // RAW arrays only — never a derived array inside a selector.
  const jobs = useAppStore((s) => s.jobs);
  const invoices = useAppStore((s) => s.invoices);
  const leads = useAppStore((s) => s.leads);
  const pricebook = useAppStore((s) => s.services);

  const addInvoice = useAppStore((s) => s.addInvoice);
  const adoptInvoice = useAppStore((s) => s.adoptInvoice);
  const setInvoiceLines = useAppStore((s) => s.setInvoiceLines);
  const updateJob = useAppStore((s) => s.updateJob);
  const setJobLines = useAppStore((s) => s.setJobLines);
  const recordPayment = useAppStore((s) => s.recordPayment);
  const sendInvoice = useAppStore((s) => s.sendInvoice);
  const setAddonStatus = useAppStore((s) => s.setAddonStatus);
  const setAddonInvSkip = useAppStore((s) => s.setAddonInvSkip);
  const checkVerifyItem = useAppStore((s) => s.checkVerifyItem);
  const overrideVerifyItem = useAppStore((s) => s.overrideVerifyItem);
  const addJobPhoto = useAppStore((s) => s.addJobPhoto);

  const [payOpen, setPayOpen] = useState(false);
  // Surfaced when the on-site bill fails to PERSIST (setJobLines rejected) — the
  // bill must not silently proceed to the invoice while job.lines is unsaved.
  const [commitError, setCommitError] = useState<string | null>(null);

  const jobId = activeModal?.params?.jobId as string | undefined;
  const job = jobs.find((j) => j.id === jobId);

  const lead = leads.find((l) => l.id === job?.leadId);

  // The visit-fee flow (tech-job-modal.tsx's collectVisitFee) already raised a LEAD-tied
  // manual invoice before pushing this modal, and passes its id — that invoice's jobId is NOT
  // reliable (the server never stamps sourceJobId on a manual invoice, so the async draft/send
  // reconcile wipes any local jobId hint back to null). Matching by id when provided is the
  // durable way to find it regardless of that flap.
  const invoiceIdParam = activeModal?.params?.invoiceId as string | undefined;

  /**
   * WHERE DONE LANDS.
   *
   * This sheet is a drill-in from two different places, and finishing it means two different
   * things. Opened from a field job (tech-job-modal declares `from: "field-job"`), it is the LAST
   * step of a visit — the next thing that person does is the next stop, so Done dismisses the
   * whole stack to My day. Opened from anywhere else (an office drill from Money → invoice, say),
   * it is one level of a deeper flow and Done pops back to its parent, as before.
   *
   * Branch on the opener's declared intent, NOT on role and NOT on stack depth: an owner-operator
   * collecting at the customer's door is `owner` and still belongs on My day, and the visit-fee
   * path pushes an extra level so the depth is not fixed.
   */
  const fromField = activeModal?.params?.from === "field-job";
  const finish = fromField ? dismissModals : close;

  // ---- ensureInvoiceForJob (prototype) — find the job's invoice, else create
  //      one from the job. Creation runs in an effect (never mutate the store
  //      during render); a ref guards against a duplicate before the new invoice
  //      shows up in `invoices`.
  const invoice = job
    ? invoices.find((i) => (invoiceIdParam ? i.id === invoiceIdParam : i.jobId === job.id))
    : undefined;
  const creatingRef = useRef<string | null>(null);
  // The create's outcome, so this sheet always has something honest to render. It used to
  // return null while `creatingRef` was stamped — and the ref was never cleared, so a create
  // that FAILED (a technician hitting the ownerOrOffice gate on createFromJob gets FORBIDDEN)
  // left an empty white panel with nothing but a ✕ on it, forever.
  const [createError, setCreateError] = useState<string | null>(null);
  // Bumped by Retry: clears the guard ref and re-runs the effect below.
  const [createAttempt, setCreateAttempt] = useState(0);

  useEffect(() => {
    if (!job || invoice) return;
    // Never raise a bill against a role we have not resolved yet — see roleKnown.
    if (!roleKnown) return;
    // The visit-fee flow already raised (or is still raising) this job's invoice — never race
    // it with createFromJob, which would CONFLICT outright on a genuinely unpriced estimate
    // and, even when it wouldn't, would mint a SECOND invoice fighting the lead-tied one.
    if (invoiceIdParam) return;
    if (creatingRef.current === job.id) return;
    creatingRef.current = job.id;
    setCreateError(null);
    // The optimistic figure is the BILLED figure. This draw used to carry `jobTotal(job)` — the
    // raw line sum — so a job with a stored tax rate flashed "$100" and snapped to "$108.45"
    // when the server's answer landed (the hydration-flash law, applied to money). The chain
    // below is deriveTotals over the same lines and the same `job.pricing` rates the server
    // bills with (CreateInvoiceFromJobUseCase), so the number never changes on reconcile.
    // The one client-underivable figure — an estimate's deposit credit — is gated below instead.
    const optimistic = jobPricedTotals(job);
    const { persisted } = addInvoice(
      {
        jobId: job.id,
        leadId: job.leadId,
        cust: custNameOf(job, lead),
        phone: job.phone || lead?.phone || "",
        title: job.title,
        // The optimistic draw only. The server snapshots the job's OWN lines onto the invoice
        // and answers with them, so a device that cannot see rates (`r: null` → 0 here) never
        // writes a fabricated $0 anywhere — this shape is replaced wholesale by the reconcile.
        lines: (job.lines ?? []).map((l) => ({ d: l.d, q: l.q ?? 1, r: l.r ?? 0, c: l.c ?? 0 })),
        ...(job.pricing ? { pricing: job.pricing } : {}),
        total: optimistic.total / 100,
        tax: optimistic.tax / 100,
        disc: optimistic.discount / 100,
        depPaid: 0,
        payments: [],
        status: "draft",
        age: 0,
        archived: false,
      },
      surface,
    );
    // Never rejects (the slice resolves { ok, error }). Clearing the guard on BOTH outcomes is
    // what makes Retry possible at all.
    void persisted.then(({ ok, error }) => {
      creatingRef.current = null;
      if (!ok) setCreateError(error ?? "Couldn't raise the invoice — check your connection and try again.");
    });
  }, [job, invoice, lead, addInvoice, invoiceIdParam, createAttempt, surface, roleKnown]);

  const retryCreate = useCallback(() => {
    creatingRef.current = null;
    setCreateError(null);
    setCreateAttempt((n) => n + 1);
  }, []);

  // The org's real visit fee for BillAsk's "+ Service / diagnostic fee" preset — read outside
  // the store (this modal's only entry, the tech job modal, lives in the field shell, which
  // never hydrates settings; see features/settings/use-org-service-fee.ts). Only fetched when
  // BillAsk will actually render (mirrors its own render condition below), so an already-priced
  // close-out never fires the extra request.
  //
  // OFFICE ONLY, twice over. BillAsk commits through `v1.jobs.setLines` + `v1.invoicing.patchLines`
  // — both ownerOrOffice, both bulk REPLACES, and neither was widened (an append-only field
  // sibling is still owed), so for a technician the builder has no route at all. And per the
  // owner's price-visibility rule, a shop that hides prices from techs hides the price BUILDER
  // from them too: they may read the balance they are collecting, they may not author it.
  const needsBillAsk = Boolean(
    isOffice && job && invoice && (invoice.total ?? 0) <= 0 && jobTotal(job) <= 0,
  );
  const orgServiceFee = useOrgServiceFee(needsBillAsk);

  // ---- states before the sheet can render. NONE of them may be blank: this modal's shell is
  //      already on screen by the time this component mounts, so returning null leaves the
  //      technician holding a white panel with a ✕ and no way to tell what went wrong.
  if (!job) {
    return (
      <CloseOutNotice
        title="Wrap up"
        message="This job isn't loaded. Close this and open it again from My day."
      />
    );
  }
  if (!invoice) {
    if (createError) {
      return (
        <CloseOutNotice
          title={`Wrap up — ${custNameOf(job, lead)}`}
          subtitle={job.title}
          message={createError}
          heading="Couldn't raise the invoice"
          onRetry={retryCreate}
        />
      );
    }
    if (invoiceIdParam) {
      // Handed an invoice id that isn't in the store. Nothing to retry here — the sheet was
      // opened against a record this device never loaded.
      return (
        <CloseOutNotice
          title={`Wrap up — ${custNameOf(job, lead)}`}
          subtitle={job.title}
          heading="That invoice isn't loaded"
          message="Close this and tap Take payment again from the job."
        />
      );
    }
    return (
      <>
        <div className="sheet-head">
          <h2>Wrap up — {custNameOf(job, lead)}</h2>
          <div className="sheet-meta">
            <span>{job.title}</span>
          </div>
        </div>
        <ListLoading rows={3} label="Raising the invoice…" />
      </>
    );
  }

  // A TECHNICIAN NEVER RENDERS AN OPTIMISTIC TOTAL. This sheet raises the bill on mount and draws
  // the row it just asked for, carrying `total: jobTotal(job)` — a figure the field device is in no
  // position to compute. It is 0 when the shop withholds rates (`pricesHidden`), and even when the
  // rates ARE visible it is the raw line sum: no deposit credited, no tax as recorded. On a $1,000
  // job with a $200 deposit the sheet would say "Take payment — $1,000", pre-fill the amount box
  // with 1000, and a tap inside the round-trip records $1,000 against an $880 invoice.
  //
  // The gate is the SURFACE, not `pricesHidden`: the deposit skew has nothing to do with redaction,
  // and `pricesHidden` is false for a job with no lines at all, which is reachable. The server's
  // answer always carries the balance (modules/invoicing/api/field-invoice-dto.ts), so wait for it
  // and say what is happening. The office is near-untouched — its invoices are hydrated, so it
  // rarely draws an optimistic row at all, and every existing expectation of its behaviour holds.
  // A failed create rolls the row back, so this state never outlives the error notice above.
  //
  // ESTIMATE-SOURCED JOBS GATE ON EVERY SURFACE. The optimistic total is now the full
  // discount→tax chain (see the draw above), which the client CAN derive — but the deposit the
  // customer already paid on the source estimate is credited server-side (depositPaidCents), and
  // a figure missing that credit is exactly the "$1,000 asked against an $880 balance" skew this
  // gate exists for. Never show a number that will change; one honest "Reading the balance…"
  // beat instead.
  if (invoice.origin !== "db" && (surface === "field" || job.sourceEstimateId)) {
    return (
      <>
        <div className="sheet-head">
          <h2>Wrap up — {custNameOf(job, lead)}</h2>
          <div className="sheet-meta">
            <span>{job.title}</span>
          </div>
        </div>
        <ListLoading rows={3} label="Reading the balance…" />
      </>
    );
  }

  const custName = custNameOf(job, lead);
  const due = invDue(invoice);

  // Found work still proposed & not skipped — settle before the bill goes out.
  const pending = (job.addons ?? []).filter((a) => a.status === "proposed" && !a.invSkip);

  // ---- found-work settlement: OK'd → approve + append the invoice line;
  //      Leave off → mark invSkip (kept on the job, off this bill).
  function includeAddon(a: Addon) {
    if (!job || !invoice) return;
    setAddonStatus(job.id, a.id, "approved");
    setInvoiceLines(invoice.id, [
      ...(invoice.lines ?? []),
      { d: a.d + " — add-on, OK'd on site", q: a.q ?? 1, r: a.r ?? 0 },
    ]);
  }

  function skipAddon(a: Addon) {
    if (!job) return;
    setAddonInvSkip(job.id, a.id);
  }

  // ---- set-bill: PERSIST the merged job lines via setJobLines (the invoice
  //      total persists fine through setInvoiceLines, but updateJob({lines})
  //      silently drops lines — no jobs.update column — so the job.lines mirror
  //      was erased by the next refetch). setLines is a bulk REPLACE, so pass the
  //      complete intended set (existing + new), not an append delta. Await the
  //      write; only append the invoice lines on success so the bill never
  //      proceeds with an unsaved job price.
  async function commitBill(newLines: InvoiceLine[]) {
    if (!job || !invoice) return;
    setCommitError(null);
    const jobLines: JobLine[] = newLines.map((l) => ({ d: l.d, q: l.q, r: l.r }));
    const { ok } = await setJobLines(job.id, [...(job.lines ?? []), ...jobLines]);
    if (!ok) {
      setCommitError("Couldn't save the bill — check your connection and try again.");
      return;
    }
    setInvoiceLines(invoice.id, [...(invoice.lines ?? []), ...newLines]);
  }

  // ---- record a payment taken outside the app (coPay approve/onfile) --------
  // ORDER MATTERS, twice over:
  //  1. The customer may have JUST paid the checkout QR (or an emailed link)
  //     while the tech reached for "record it instead" — one fresh read first;
  //     an already-paid invoice jumps to done instead of recording a second
  //     payment the server would refuse (and the slice would silently roll back).
  //  2. recordPayment refuses drafts server-side (sent|partial only), so a draft
  //     is SENT — awaited, genuinely ok — before recording, the same ordering the
  //     card step uses. Recording first made every first-record on a fresh draft
  //     fail behind an "Approved" screen.
  async function approvePayment({
    amt,
    method,
    onFile,
  }: {
    amt: number;
    method: PayMethod;
    onFile: boolean;
  }): Promise<{ ok: boolean; error?: string; alreadyPaid?: boolean }> {
    if (!invoice) return { ok: false, error: "invoice not found" };
    // The server's answer outranks the store's for the send decision below: a store row
    // optimistically flipped to "sent" over a server row still in draft would otherwise
    // record straight into the draft guard — silent rollback behind "Approved".
    let liveStatus = invoice.status;
    if (invoice.origin === "db") {
      try {
        const fresh = await readInvoice(surface, invoice.id, invoice);
        if (fresh.status === "paid") {
          adoptPaidInvoice(fresh);
          return { ok: true, alreadyPaid: true };
        }
        liveStatus = fresh.status;
      } catch {
        // Unreadable (offline blip) — proceed with the record; the server remains
        // the final guard and the slice rolls back an optimistic write it refuses.
      }
    }
    if (liveStatus === "draft") {
      const sent = await sendInvoice(invoice.id, surface);
      if (!sent.ok) {
        return {
          ok: false,
          error: sent.error ?? "Couldn't send the invoice — check your connection and try again.",
        };
      }
    }
    // 3. AWAIT the record itself. This was the last unawaited leg: recordPayment used to be
    //    `=> void`, so a server refusal (invoice voided, paid concurrently, offline, amount
    //    race) rolled the store back behind an "Approved · $1,000" screen the tech had already
    //    read out to the customer. The slice now resolves the server's real answer.
    const recorded = await recordPayment(invoice.id, { amt, when: "Just now", method, onFile }, surface);
    if (!recorded.ok) {
      return {
        ok: false,
        error: recorded.error ?? "Couldn't record the payment — check your connection and try again.",
      };
    }
    // A card on file is NOT recorded here. This used to write a hardcoded
    // { brand: "Visa", last4: "4242" } onto the customer — fabricated payment data shown back as
    // a real card. Saving a card is Stripe Connect's job; until it exists, record nothing.
    return { ok: true };
  }

  // ---- a checkout payment landed (card-step poll, or the pre-record check) ---
  // The Stripe webhook already RECORDED the payment server-side; adopting the
  // fresh record (local id kept stable, mirroring the slice's reconcile convention)
  // flips DueCard/status immediately — no recordPayment double-write. The read that
  // produced it already picked the caller's own API and mapper (see invoice-write.ts).
  function adoptPaidInvoice(fresh: Invoice) {
    if (!invoice) return;
    invalidateLists("invoices", "jobs");
    adoptInvoice({ ...fresh, id: invoice.id });
  }

  // ---- send to office (sendForInvoicing) ------------------------------------
  function sendToOffice() {
    if (!job) return;
    updateJob(job.id, { invRequested: true });
    finish();
  }

  return (
    <>
      {/* Sticky sheet header — the job you are wrapping up never scrolls away. */}
      <div className="sheet-head">
        <h2>Wrap up — {custName}</h2>
        <div className="sheet-meta">
          <span>{job.title}</span>
        </div>
      </div>

      {/* NO "What was done" BOX HERE, and its removal is not a matter of taste.
          Its own label promised "goes on the invoice the customer sees" and that was FALSE:
          nothing in components/shared/invoice-document.tsx, features/invoices/ or
          modules/invoicing/ has ever read `job.completion`. The customer never saw a word of it.
          So the one thing this control claimed to do, it did not do — and the wrap-up sheet is
          the worst place to ask a question whose answer goes nowhere, because it stands between
          a technician and taking the money.

          The COLUMN and the office surface stay: job-modal.tsx still renders `completion` in the
          job's living record, which is a real place for it, and no data is dropped. If the
          customer's copy should carry a what-we-did line later, it needs to actually reach the
          document — a field endpoint and a renderer — not a box that saves into silence. */}

      {/* Bill-ask — ONLY when there is GENUINELY no price. A persisted on-site
          price flows job.lines → invoice.total via ensureInvoiceForJob, so we
          gate on BOTH: an invoice already carrying a total, OR the job's own
          lines summing above zero (covers the frame before the invoice effect
          re-derives). Never show the suggestBill heuristic once a real price
          exists — that produced the phantom $475. */}
      {needsBillAsk ? (
        <BillAsk
          job={job}
          suggested={suggestBill(job, pricebook)}
          onCommit={commitBill}
          error={commitError}
          serviceFee={orgServiceFee}
        />
      ) : null}

      {/* Found-work settlement — pending add-ons awaiting the customer's OK. Read-only for the
          field, where the OK-pill is not the technician's to press. */}
      <FoundWorkSettle
        pending={pending}
        onInclude={includeAddon}
        onSkip={skipAddon}
        canSettle={isOffice}
      />

      {/* Verify gaps — required checks still open (collapsible; never blocks). */}
      <VerifyGaps
        job={job}
        onCheck={(itemId) => checkVerifyItem(job.id, itemId)}
        onRephoto={() => addJobPhoto(job.id)}
        onOverride={(itemId, reason) => overrideVerifyItem(job.id, itemId, reason)}
      />

      {/* Due summary card — the money side. */}
      <DueCard invoice={invoice} />

      {/* The customer's copy: show the itemised document and turn the phone around, or send it
          to them. Both optional, neither automatic — see close-out-document.tsx. Before this the
          customer received NOTHING on a cash-at-the-door close-out. */}
      <CloseOutDocument invoice={invoice} />

      {/* Pay block — its steps carry their own buttons (the card checkout, Record,
          Done), so while it is open it renders in-flow and the foot is skipped. */}
      {payOpen ? (
        <div style={{ marginTop: "var(--space-3)" }}>
          <PayBlock
            invoice={invoice}
            lead={lead}
            onApprove={approvePayment}
            sendInvoice={(id) => sendInvoice(id, surface)}
            surface={surface}
            onCardPaid={adoptPaidInvoice}
            // Techs and owners collect at the door; office staff are at a desk. Role, not
            // surface: an owner-operator on My day computes surface "office" and still belongs
            // in the tap audience.
            offerTapToPay={me.data?.role === "tech" || me.data?.role === "owner"}
            onFinish={() => {
              setPayOpen(false);
              finish();
            }}
            onCancel={() => setPayOpen(false)}
          />
        </div>
      ) : (
        /* THE terminal action, docked where the thumb is. Money due → Take
           payment is the primary with send-to-office quiet beside it; nothing
           due → send-to-office IS the wrap-up confirm.

           Take payment is BLOCKED on unsettled found work for the office only. Clearing
           `pending` means calling setAddonStatus, which is ownerOrOffice by law — so the same
           disable on a technician's device is a button that can never become live, on the one
           screen where the customer is standing there with cash. They collect what was agreed;
           the found-work list above says, read-only, what is not on this bill. */
        <div
          className="sheet-foot"
          style={{ display: "flex", gap: "var(--space-2)", flexWrap: "wrap", alignItems: "center" }}
        >
          {due > 0 ? (
            <>
              <button
                className="sheet-pri"
                style={{
                  flex: 1,
                  ...(isOffice && pending.length > 0 ? { opacity: 0.55, cursor: "not-allowed" } : {}),
                }}
                disabled={isOffice && pending.length > 0}
                onClick={() => setPayOpen(true)}
              >
                Take payment — {fmt$(due)}
              </button>
              {isOffice ? (
                <button className="btn" style={{ minHeight: 48 }} onClick={sendToOffice}>
                  Log &amp; send to office →
                </button>
              ) : null}
            </>
          ) : isOffice ? (
            <button className="sheet-pri" onClick={sendToOffice}>
              Log &amp; send to office →
            </button>
          ) : (
            /* Nothing owed and no office writes to offer — the bill is settled or unpriced, and
               either way the technician is done here. Never a dead hand-off button. */
            <button className="sheet-pri" onClick={finish}>
              Done
            </button>
          )}
        </div>
      )}
    </>
  );
}
