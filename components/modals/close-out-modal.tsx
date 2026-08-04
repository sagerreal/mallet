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

import { useEffect, useRef, useState } from "react";
import {
  useAppStore,
  useActiveModal,
  useCloseModal,
} from "@/lib/store/app-store";
import { useOrgServiceFee } from "@/features/settings/use-org-service-fee";
import { Field } from "@/components/ui/input";
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

/** jobTotal — sum of the job's line amounts (prototype jobTotal / tech-job-modal). */
function jobTotal(j: Job): number {
  return (j.lines ?? []).reduce((s, l) => s + (l.q ?? 1) * (l.r ?? 0), 0);
}

/** invPaid — sum of payment amounts (prototype invPaid). */
function invPaid(i: Invoice): number {
  return (i.payments ?? []).reduce((s, p) => s + (p.amt ?? 0), 0);
}

/** invDue — total − deposit − payments, floored at 0 (prototype invDue). */
function invDue(i: Invoice): number {
  return Math.max(0, (i.total ?? 0) - (i.depPaid ?? 0) - invPaid(i));
}

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
            fmt$(due)
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
//  PAY BLOCK — the on-site Tap-to-Pay sheet (prototype coPayBlock / coPay)
//  Local pay state machine: method | tap | record | done.
// ===========================================================================

// Contactless ring icon (prototype ICON_CONTACTLESS, 5547).
const ICON_CONTACTLESS = (
  <svg
    width="44"
    height="44"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2.1"
    strokeLinecap="round"
  >
    <path d="M8.6 16.5a6 6 0 000-9M12 19a10 10 0 000-14M15.4 21a14 14 0 000-18" />
  </svg>
);

type PayMethod = "card" | "cash" | "check" | "ach";
type PayStep = "method" | "tap" | "record" | "done";

interface PayState {
  step: PayStep;
  method?: PayMethod;
  amt: number;
  save: boolean;
  onFile?: boolean;
  last4?: string;
  saved?: boolean;
}

interface PayBlockProps {
  invoice: Invoice;
  lead: Lead | undefined;
  onApprove: (args: {
    amt: number;
    method: PayMethod;
    onFile: boolean;
    save: boolean;
  }) => void;
  onFinish: () => void;
  onCancel: () => void;
}

function clampAmt(amt: number, due: number): number {
  let a = Math.min(amt || due, due);
  if (a <= 0) a = due;
  return a;
}

function PayBlock({ invoice, lead, onApprove, onFinish, onCancel }: PayBlockProps) {
  const due = invDue(invoice);
  const card = custCard(lead);
  const [p, setP] = useState<PayState>({ step: "method", amt: due, save: !card });
  const [chk, setChk] = useState("");

  const amtIn = (
    <>
      <span className="muted">$</span>
      <input
        type="number"
        inputMode="decimal"
        value={p.amt || due}
        onChange={(e) => setP((s) => ({ ...s, amt: +e.target.value || 0 }))}
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

  // ---- charge card on file → record immediately, jump to done (coPay 'onfile') ---
  function chargeOnFile() {
    const amt = clampAmt(p.amt, due);
    onApprove({ amt, method: "card", onFile: true, save: false });
    setP({ step: "done", method: "card", amt, last4: card?.last4 ?? "4242", onFile: true, save: false });
  }

  // ---- approve tap / recorded payment (coPay 'approve') ----------------------
  function approve() {
    const amt = clampAmt(p.amt, due);
    const method = p.method ?? "card";
    const saveCard = method === "card" && !!p.save && !!lead && !lead.card;
    onApprove({ amt, method, onFile: false, save: saveCard });
    setP({ step: "done", method, amt, last4: "4242", saved: saveCard, save: p.save });
  }

  // step: tap ----------------------------------------------------------------
  if (p.step === "tap") {
    return (
      <div className="cotap">
        <div className="cotap-amt fig">{fmt$(p.amt || due)}</div>
        <div className="cotap-ring">{ICON_CONTACTLESS}</div>
        <div className="cotap-msg">
          Hold the customer&rsquo;s card or phone
          <br />
          to the back of your device
        </div>
        <div className="cotap-sub">Tap to Pay · powered by Stripe</div>
        {!card ? (
          <label
            style={{
              display: "flex",
              gap: "var(--space-2)",
              alignItems: "center",
              justifyContent: "center",
              marginTop: "var(--space-3)",
              fontSize: "var(--type-base)",
              cursor: "pointer",
            }}
          >
            <input
              type="checkbox"
              checked={!!p.save}
              onChange={() => setP((s) => ({ ...s, save: !s.save }))}
            />{" "}
            Save card on file — charge the balance &amp; next visit in one tap
          </label>
        ) : null}
        <div style={{ display: "flex", gap: "var(--space-2)", justifyContent: "center", marginTop: "var(--space-4)" }}>
          <button className="btn" onClick={onCancel}>
            Cancel
          </button>
          <button className="btn primary" onClick={approve}>
            Simulate tap →
          </button>
        </div>
      </div>
    );
  }

  // step: record (cash / check / bank) ---------------------------------------
  if (p.step === "record") {
    const lbl = p.method === "ach" ? "bank transfer" : p.method;
    return (
      <div
        style={{ marginTop: "var(--space-2)", display: "flex", gap: "var(--space-2)", alignItems: "center", flexWrap: "wrap" }}
      >
        {amtIn}
        {p.method === "check" ? (
          <input
            placeholder="Check #"
            value={chk}
            onChange={(e) => setChk(e.target.value)}
            style={{
              width: 100,
              border: "1.5px solid var(--line)",
              borderRadius: "var(--radius-sm)",
              padding: "var(--space-2) var(--space-3)",
              fontFamily: "inherit",
            }}
          />
        ) : null}
        <button className="btn primary" onClick={approve}>
          Record {lbl} — paid
        </button>
        <span
          className="linklike"
          onClick={() => setP((s) => ({ ...s, step: "method", amt: due }))}
        >
          back
        </span>
      </div>
    );
  }

  // step: done ---------------------------------------------------------------
  if (p.step === "done") {
    const detail = p.onFile
      ? `${card ? card.brand + " ···· " + card.last4 : "Card"} on file`
      : p.method === "card"
      ? `Visa ···· ${p.last4 || "4242"} · Tap to Pay`
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
          {p.saved ? " · card saved on file ✓" : ""}
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
          {/* "Text receipt" was a dead button (no receipt-send endpoint exists yet).
              Removed per the no-dead-buttons rule; the paid invoice already lands in
              the customer's SMS thread. Re-add here wired to a real send when a
              receipt-send primitive exists. */}
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
            onClick={chargeOnFile}
          >
            <b>
              Charge {card.brand} ···· {card.last4}
            </b>
            <span>
              {card.via ? "saved from " + card.via + " · " : ""}instant, no tap
            </span>
          </button>
        ) : null}
        <button
          className={`btn ${card ? "" : "primary"} copay-tap`}
          onClick={() => setP((s) => ({ ...s, step: "tap", method: "card" }))}
        >
          <b>Tap to Pay</b>
          <span>card or phone · contactless</span>
        </button>
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
}

function FoundWorkSettle({ pending, onInclude, onSkip }: FoundWorkSettleProps) {
  if (!pending.length) return null;
  const sum = pending.reduce((s, a) => s + (a.q ?? 1) * (a.r ?? 0), 0);

  return (
    <div className="reqcard" style={{ marginBottom: "var(--space-3)" }}>
      <b>
        ⚠ {fmt$(sum)} in found work awaiting the customer&rsquo;s OK
      </b>
      <div style={{ marginTop: "var(--space-2)" }}>
        {pending.map((a) => (
          <div key={a.id} className="stage-row">
            <div style={{ flex: 1 }}>
              <b style={{ fontWeight: 600 }}>{a.d}</b>{" "}
              <span className="muted">· {fmt$((a.q ?? 1) * (a.r ?? 0))}</span>
            </div>
            <button className="btn sm primary" onClick={() => onInclude(a)}>
              ✓ OK&rsquo;d — include
            </button>
            <button className="btn sm ghost" onClick={() => onSkip(a)}>
              Leave off
            </button>
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
//  THE MODAL BODY — "Wrap up — {custName}" (prototype openCloseOut)
// ===========================================================================

export function CloseOutModalContent() {
  const activeModal = useActiveModal();
  const close = useCloseModal();

  // RAW arrays only — never a derived array inside a selector.
  const jobs = useAppStore((s) => s.jobs);
  const invoices = useAppStore((s) => s.invoices);
  const leads = useAppStore((s) => s.leads);
  const pricebook = useAppStore((s) => s.services);

  const addInvoice = useAppStore((s) => s.addInvoice);
  const setInvoiceLines = useAppStore((s) => s.setInvoiceLines);
  const updateJob = useAppStore((s) => s.updateJob);
  const setJobLines = useAppStore((s) => s.setJobLines);
  const recordPayment = useAppStore((s) => s.recordPayment);
  const sendInvoice = useAppStore((s) => s.sendInvoice);
  const updateLead = useAppStore((s) => s.updateLead);
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

  // ---- ensureInvoiceForJob (prototype) — find the job's invoice, else create
  //      one from the job. Creation runs in an effect (never mutate the store
  //      during render); a ref guards against a duplicate before the new invoice
  //      shows up in `invoices`. Until it exists we render nothing (one frame). --
  const invoice = job
    ? invoices.find((i) => (invoiceIdParam ? i.id === invoiceIdParam : i.jobId === job.id))
    : undefined;
  const creatingRef = useRef<string | null>(null);

  useEffect(() => {
    if (!job || invoice) return;
    // The visit-fee flow already raised (or is still raising) this job's invoice — never race
    // it with createFromJob, which would CONFLICT outright on a genuinely unpriced estimate
    // and, even when it wouldn't, would mint a SECOND invoice fighting the lead-tied one.
    if (invoiceIdParam) return;
    if (creatingRef.current === job.id) return;
    creatingRef.current = job.id;
    addInvoice({
      jobId: job.id,
      leadId: job.leadId,
      cust: custNameOf(job, lead),
      phone: job.phone || lead?.phone || "",
      title: job.title,
      lines: (job.lines ?? []).map((l) => ({ d: l.d, q: l.q ?? 1, r: l.r ?? 0, c: l.c ?? 0 })),
      total: jobTotal(job),
      depPaid: 0,
      payments: [],
      status: "draft",
      age: 0,
      archived: false,
    });
  }, [job, invoice, lead, addInvoice, invoiceIdParam]);

  // The org's real visit fee for BillAsk's "+ Service / diagnostic fee" preset — read outside
  // the store (this modal's only entry, the tech job modal, lives in the field shell, which
  // never hydrates settings; see features/settings/use-org-service-fee.ts). Only fetched when
  // BillAsk will actually render (mirrors its own render condition below), so an already-priced
  // close-out never fires the extra request.
  const needsBillAsk = Boolean(job && invoice && (invoice.total ?? 0) <= 0 && jobTotal(job) <= 0);
  const orgServiceFee = useOrgServiceFee(needsBillAsk);

  if (!job || !invoice) return null;

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

  // ---- take a payment (coPay approve/onfile) --------------------------------
  function approvePayment({
    amt,
    method,
    onFile,
    save,
  }: {
    amt: number;
    method: PayMethod;
    onFile: boolean;
    save: boolean;
  }) {
    if (!invoice) return;
    recordPayment(invoice.id, { amt, when: "Just now", method, onFile });
    // A card on file is NOT recorded here. This used to write a hardcoded
    // { brand: "Visa", last4: "4242" } onto the customer — fabricated payment data shown back as
    // a real card. Saving a card is Stripe Connect's job; until it exists, record nothing.
    if (invoice.status === "draft") sendInvoice(invoice.id);
  }

  // ---- send to office (sendForInvoicing) ------------------------------------
  function sendToOffice() {
    if (!job) return;
    updateJob(job.id, { invRequested: true });
    close();
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

      {/* What was done — goes on the invoice the customer sees (completionNote). */}
      <Field
        label="What was done"
        style={{ marginBottom: "var(--space-3)" }}
        hint={
          <span className="muted" style={{ fontWeight: 500 }}>
            — goes on the invoice the customer sees
          </span>
        }
      >
        {/* The placeholder is short enough to READ on a phone. The old hint needed
            490px inside a 309px field, so it was cut off mid-word on every device a
            tech actually owns. */}
        <input
          type="text"
          defaultValue={job.completion || ""}
          placeholder="e.g. Replaced 40-gal water heater"
          onChange={(e) => updateJob(job.id, { completion: e.target.value })}
          style={{
            width: "100%",
            boxSizing: "border-box",
            border: "1.5px solid var(--line)",
            borderRadius: "var(--radius-sm)",
            padding: "var(--space-2) var(--space-3)",
            fontFamily: "inherit",
            fontSize: "var(--type-base)",
          }}
        />
      </Field>

      {/* Bill-ask — ONLY when there is GENUINELY no price. A persisted on-site
          price flows job.lines → invoice.total via ensureInvoiceForJob, so we
          gate on BOTH: an invoice already carrying a total, OR the job's own
          lines summing above zero (covers the frame before the invoice effect
          re-derives). Never show the suggestBill heuristic once a real price
          exists — that produced the phantom $475. */}
      {(invoice.total ?? 0) <= 0 && jobTotal(job) <= 0 ? (
        <BillAsk
          job={job}
          suggested={suggestBill(job, pricebook)}
          onCommit={commitBill}
          error={commitError}
          serviceFee={orgServiceFee}
        />
      ) : null}

      {/* Found-work settlement — pending add-ons awaiting the customer's OK. */}
      <FoundWorkSettle pending={pending} onInclude={includeAddon} onSkip={skipAddon} />

      {/* Verify gaps — required checks still open (collapsible; never blocks). */}
      <VerifyGaps
        job={job}
        onCheck={(itemId) => checkVerifyItem(job.id, itemId)}
        onRephoto={() => addJobPhoto(job.id)}
        onOverride={(itemId, reason) => overrideVerifyItem(job.id, itemId, reason)}
      />

      {/* Due summary card — the money side. */}
      <DueCard invoice={invoice} />

      {/* Pay block — its steps carry their own buttons (Simulate tap, Record,
          Done), so while it is open it renders in-flow and the foot is skipped. */}
      {payOpen ? (
        <div style={{ marginTop: "var(--space-3)" }}>
          <PayBlock
            invoice={invoice}
            lead={lead}
            onApprove={approvePayment}
            onFinish={() => {
              setPayOpen(false);
              close();
            }}
            onCancel={() => setPayOpen(false)}
          />
        </div>
      ) : (
        /* THE terminal action, docked where the thumb is. Money due → Take
           payment is the primary with send-to-office quiet beside it; nothing
           due → send-to-office IS the wrap-up confirm. */
        <div
          className="sheet-foot"
          style={{ display: "flex", gap: "var(--space-2)", flexWrap: "wrap", alignItems: "center" }}
        >
          {due > 0 ? (
            <>
              <button
                className="sheet-pri"
                style={{ flex: 1, ...(pending.length > 0 ? { opacity: 0.55, cursor: "not-allowed" } : {}) }}
                disabled={pending.length > 0}
                onClick={() => setPayOpen(true)}
              >
                Take payment — {fmt$(due)}
              </button>
              <button className="btn" style={{ minHeight: 48 }} onClick={sendToOffice}>
                Log &amp; send to office →
              </button>
            </>
          ) : (
            <button className="sheet-pri" onClick={sendToOffice}>
              Log &amp; send to office →
            </button>
          )}
        </div>
      )}
    </>
  );
}
