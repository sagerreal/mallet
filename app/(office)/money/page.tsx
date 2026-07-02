"use client";

/**
 * Money page — pixel-faithful port of the prototype's vMoney / vInvoices.
 * Uses SAMPLE_INVOICES / SAMPLE_JOBS / SAMPLE_LEADS / SAMPLE_ESTIMATES
 * from lib/prototype-sample.ts.  No live hooks.  All backend actions are
 * console-logged stubs.
 *
 * Sub-tab pattern mirrors app/(office)/jobs/page.tsx.
 * Money values in SAMPLE_INVOICES are integer dollars (not cents) — the
 * prototype's fmt$() does `"$" + n.toLocaleString("en-US")`.
 */

import { useState } from "react";
import {
  SAMPLE_INVOICES,
  SAMPLE_JOBS,
  SAMPLE_ESTIMATES,
  SAMPLE_LEADS,
  type SampleInvoice,
  type SampleJob,
} from "@/lib/prototype-sample";

// ---- helpers ported from prototype ------------------------------------------

/** fmt$  — integer dollars → "$N,NNN"  (prototype: fmt$=n=>"$"+n.toLocaleString("en-US")) */
function fmt$(n: number): string {
  return "$" + Math.round(n).toLocaleString("en-US");
}

/** invPaid — sum of payment amounts */
function invPaid(i: SampleInvoice): number {
  return (i.payments ?? []).reduce((s, p) => s + (p.amt ?? 0), 0);
}

/** invDue — total − deposit − payments (floor 0) */
function invDue(i: SampleInvoice): number {
  return Math.max(0, (i.total ?? 0) - (i.depPaid ?? 0) - invPaid(i));
}

/** invOver — unpaid past 7-day default (matches prototype) */
function invOver(i: SampleInvoice): boolean {
  if (i.status === "draft" || invDue(i) <= 0) return false;
  return (i.age ?? 0) > 7;
}

/** invState — runtime status key (paid / partial / sent) */
function invState(i: SampleInvoice): string {
  if (invDue(i) <= 0) return "paid";
  if (invPaid(i) > 0) return "partial";
  return "sent";
}

/** invStatusKey — including draft and overdue (matches IST keys) */
function invStatusKey(i: SampleInvoice): string {
  if (i.status === "draft") return "draft";
  if (invOver(i)) return "over";
  return invState(i);
}

/** IST — invoice status table (prototype's const IST) */
const IST: Record<string, { l: string; c: string; bg: string }> = {
  paid: { l: "Paid", c: "var(--green-700)", bg: "var(--green-50)" },
  partial: { l: "Part-paid", c: "var(--amber)", bg: "var(--amber-bg)" },
  sent: { l: "Unpaid", c: "var(--blue)", bg: "var(--blue-bg)" },
  draft: { l: "Draft", c: "var(--ink-3)", bg: "var(--paper)" },
  over: { l: "Overdue", c: "var(--red)", bg: "var(--red-bg)" },
};

/** liveInvs — non-archived invoices */
function liveInvs(): SampleInvoice[] {
  return SAMPLE_INVOICES.filter((i) => !i.archived);
}

/** jobsReadyToInvoice — done jobs with no invoiceId */
function jobsReadyToInvoice(): SampleJob[] {
  return SAMPLE_JOBS.filter((j) => j.status === "done" && !(j as { invoiceId?: number }).invoiceId);
}

/** custName — resolve customer name from invoice */
function invCustName(i: SampleInvoice): string {
  const lead = SAMPLE_LEADS.find((l) => l.id === i.leadId);
  return lead?.name ?? i.cust ?? "Customer";
}

/** custCard — look up saved card from the linked lead */
function custCard(i: SampleInvoice): { brand: string; last4: string; via?: string } | null {
  const lead = SAMPLE_LEADS.find((l) => l.id === i.leadId);
  return (lead as { card?: { brand: string; last4: string; via?: string } })?.card ?? null;
}

/** finKpis — KPI rollup (mirrors prototype's finKpis()) */
function finKpis() {
  const live = liveInvs().filter((i) => i.status !== "draft");
  const collected = live.reduce((s, i) => s + invPaid(i) + (i.depPaid ?? 0), 0);
  const unpaidL = live.filter((i) => invDue(i) > 0);
  const overL = unpaidL.filter(invOver);

  // Sold · awaiting: accepted jobs not yet done and not yet invoiced
  const awaitJobs = SAMPLE_JOBS.filter((j) => {
    if (j.status === "done") return false;
    if ((j as { invoiceId?: number }).invoiceId) return false;
    const linked = SAMPLE_ESTIMATES.find((e) => e.leadId === j.leadId && e.status === "accepted");
    return !!linked;
  });

  function jobPrice(j: SampleJob): number {
    return (j.lines ?? []).reduce((s, l) => s + l.q * l.r, 0);
  }

  const awaiting = awaitJobs.reduce(
    (s, j) => s + Math.max(0, jobPrice(j)),
    0
  );

  return {
    collected,
    unpaid: unpaidL.reduce((s, i) => s + invDue(i), 0),
    unpaidN: unpaidL.length,
    over: overL.reduce((s, i) => s + invDue(i), 0),
    overN: overL.length,
    awaiting,
    awaitingN: awaitJobs.length,
  };
}

// ---- stubs ------------------------------------------------------------------

function stub(action: string, ...args: unknown[]) {
  // eslint-disable-next-line no-console
  console.log(`[stub] ${action}`, ...args);
}

// ---- sub-tab types ----------------------------------------------------------

type FinSubTab = "fin-money" | "fin-invoices";

const SUB_TABS: Array<{ id: FinSubTab; label: string }> = [
  { id: "fin-money", label: "Money" },
  { id: "fin-invoices", label: "Invoices" },
];

// ============================================================================
// vMoney — Money dashboard panel
// ============================================================================

function MoneyDashboard() {
  const [autoRemind, setAutoRemind] = useState(true);

  const k = finKpis();
  const rdy = jobsReadyToInvoice();
  const drafts = liveInvs().filter((i) => i.status === "draft");
  const unpaid = liveInvs()
    .filter((i) => i.status !== "draft" && invDue(i) > 0)
    .sort((a, b) => ((invOver(b) ? 1 : 0) - (invOver(a) ? 1 : 0)) || invDue(b) - invDue(a));

  /** Initials from a name (prototype's ini) */
  function ini(n: string): string {
    return (n || "?")
      .split(" ")
      .map((w) => w[0])
      .join("")
      .slice(0, 2)
      .toUpperCase();
  }

  /** Javatar element */
  function Javatar({ name }: { name: string }) {
    return (
      <span
        className="javatar"
        style={{ width: 34, height: 34, fontSize: 12, background: "var(--green-100)", color: "var(--ink-2)" }}
      >
        {ini(name)}
      </span>
    );
  }

  /** Colored status dot */
  function Dot({ color }: { color: string }) {
    return (
      <span
        style={{
          display: "inline-block",
          width: 7,
          height: 7,
          borderRadius: "50%",
          background: color,
          marginRight: 6,
          verticalAlign: "middle",
        }}
      />
    );
  }

  return (
    <>
      <h1>Money</h1>
      <div className="sub">What you&rsquo;re owed, and what&rsquo;s come in.</div>

      {/* KPI strip */}
      <div
        className="kpis"
        style={{ gridTemplateColumns: `repeat(${k.awaiting > 0 ? 4 : 3}, 1fr)` }}
      >
        <div className="kpi" onClick={() => stub("go", "fin-invoices")}>
          <div className="lbl">Outstanding</div>
          <div className="val">{fmt$(k.unpaid)}</div>
          <div className="hint">
            {k.unpaidN} open invoice{k.unpaidN === 1 ? "" : "s"}
          </div>
        </div>

        {k.awaiting > 0 && (
          <div className="kpi" onClick={() => stub("setModule", "operations")}>
            <div className="lbl">Sold · awaiting</div>
            <div className="val">{fmt$(k.awaiting)}</div>
            <div className="hint">
              {k.awaitingN} job{k.awaitingN === 1 ? "" : "s"} sold, not yet billed
            </div>
          </div>
        )}

        <div className={`kpi${k.overN ? " warn" : ""}`}>
          <div className="lbl">Overdue</div>
          <div className="val" style={k.overN ? { color: "var(--red)" } : undefined}>
            {fmt$(k.over)}
          </div>
          <div className="hint">
            {k.overN ? `${k.overN} invoice${k.overN === 1 ? "" : "s"} · 7+ days` : "all current"}
          </div>
        </div>

        <div className="kpi">
          <div className="lbl">Collected this month</div>
          <div className="val">{fmt$(k.collected)}</div>
          <div className="hint">deposits + payments</div>
        </div>
      </div>

      {/* Auto payment reminders toggle */}
      <div className="card" style={{ display: "flex", alignItems: "center", gap: 12 }}>
        <div style={{ flex: 1 }}>
          <b style={{ fontWeight: 700 }}>Automatic payment reminders</b>
          <div className="muted" style={{ fontSize: 12, marginTop: 2 }}>
            {autoRemind
              ? "Unpaid invoices get a reminder text on a set schedule until they’re paid. Anything still open after the last reminder moves to Needs Attention."
              : "Off — you send payment reminders yourself."}
          </div>
        </div>
        <label className="switch">
          <input
            type="checkbox"
            checked={autoRemind}
            onChange={(e) => {
              setAutoRemind(e.target.checked);
              stub("setAutoRemind", e.target.checked);
            }}
          />
          <i />
        </label>
      </div>

      {/* Ready to bill */}
      {rdy.length > 0 && (
        <div className="card">
          <h3>Ready to bill</h3>
          <p className="muted" style={{ fontSize: "11.5px", margin: "-2px 0 8px" }}>
            Built from what was sold, plus any add-ons approved in the field.
          </p>
          {rdy.map((j) => {
            const lead = SAMPLE_LEADS.find((l) => l.id === j.leadId);
            const name = lead?.name ?? "Customer";
            const jobTotal = (j.lines ?? []).reduce((s, l) => s + l.q * l.r, 0);
            return (
              <div key={j.id} className="att-item">
                <Javatar name={name} />
                <div className="att-body">
                  <b>{name}</b>
                  <div className="why">
                    {j.title} — done · {fmt$(jobTotal)}
                  </div>
                </div>
                <button
                  className="btn sm primary"
                  onClick={() => stub("createInvoiceFromJob", j.id)}
                >
                  Create invoice
                </button>
              </div>
            );
          })}
        </div>
      )}

      {/* Started, not sent */}
      {drafts.length > 0 && (
        <div className="card">
          <h3>Started, not sent</h3>
          {drafts.map((i) => (
            <div key={i.id} className="att-item">
              <Javatar name={invCustName(i)} />
              <div className="att-body">
                <b>{invCustName(i)}</b>
                <div className="why">
                  {i.num} · {i.title}
                </div>
              </div>
              <span className="att-val">{fmt$(invDue(i))}</span>
              <button className="btn sm primary" onClick={() => stub("openInvoice", i.id)}>
                Finish &amp; send
              </button>
            </div>
          ))}
        </div>
      )}

      {/* Open invoices */}
      <div className="card">
        <h3>Open invoices</h3>
        {unpaid.length > 0 ? (
          unpaid.map((i) => {
            const over = invOver(i);
            const part = invPaid(i) > 0;
            const sent = i.fu && i.fu.on && i.fu.stage > 0;
            const card = custCard(i);
            const dotColor = over ? "var(--red)" : part ? "var(--amber)" : "var(--green-700)";

            return (
              <div key={i.id} className="att-item">
                <Javatar name={invCustName(i)} />
                <div className="att-body">
                  <b>
                    <Dot color={dotColor} />
                    {invCustName(i)}
                  </b>
                  <div className="why">
                    {i.num} · sent {i.age === 0 ? "today" : `${i.age}d ago`}
                    {part ? ` · ${fmt$(invPaid(i))} paid` : ""}
                    {card ? ` · ${card.brand} ···· ${card.last4} on file` : ""}
                    {sent ? ` · ${i.fu!.stage} reminder${i.fu!.stage === 1 ? "" : "s"} sent` : ""}
                  </div>
                </div>
                <span className="att-val" style={over ? { color: "var(--red)" } : undefined}>
                  {fmt$(invDue(i))}
                </span>
                <div className="att-actions">
                  <button className="btn sm" onClick={() => stub("remindInvoice", i.id)}>
                    Remind
                  </button>
                  {card ? (
                    <button
                      className="btn sm primary"
                      onClick={() => stub("chargeOnFile", i.id)}
                    >
                      Charge ···· {card.last4}
                    </button>
                  ) : (
                    <button
                      className="btn sm primary"
                      onClick={() => stub("openInvoice", i.id)}
                    >
                      Take payment
                    </button>
                  )}
                </div>
              </div>
            );
          })
        ) : (
          <div className="empty-att">
            Nothing outstanding — every finished job is paid.
          </div>
        )}
      </div>
    </>
  );
}

// ============================================================================
// vInvoices — Invoices list panel
// ============================================================================

function InvoicesList() {
  const [invQ, setInvQ] = useState("");
  const [invFiltersOpen, setInvFiltersOpen] = useState(false);
  const [statusFilter, setStatusFilter] = useState("");

  const allInvs = liveInvs();
  const total = allInvs.length;

  // All distinct status keys present in the dataset
  const keys = [...new Set(allInvs.map(invStatusKey))];

  // Filter
  let rows = allInvs;
  const q = invQ.toLowerCase();
  if (q) {
    rows = rows.filter(
      (i) =>
        i.num.toLowerCase().includes(q) ||
        invCustName(i).toLowerCase().includes(q) ||
        i.title.toLowerCase().includes(q)
    );
  }
  if (statusFilter) {
    rows = rows.filter((i) => invStatusKey(i) === statusFilter);
  }

  const activeF = statusFilter ? 1 : 0;

  return (
    <>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          marginBottom: 4,
          gap: 8,
          flexWrap: "wrap",
        }}
      >
        <h1>Invoices</h1>
        <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
          <button className="btn ghost" onClick={() => stub("financeConnect")}>
            Offer financing
          </button>
          <button className="btn ghost" onClick={() => stub("qbConnect")}>
            Connect QuickBooks
          </button>
          <button className="btn primary" onClick={() => stub("newInvoice")}>
            + New invoice
          </button>
        </div>
      </div>
      <div className="sub">Every bill, its age, and what&rsquo;s owed.</div>

      <div className="toolbar">
        <input
          type="text"
          placeholder="Search #, customer, job…"
          value={invQ}
          onChange={(e) => setInvQ(e.target.value)}
        />
        <button
          className={`btn${invFiltersOpen || activeF ? "" : " ghost"}`}
          onClick={() => setInvFiltersOpen((v) => !v)}
        >
          Filters
          {activeF > 0 && (
            <span className="pill amber" style={{ marginLeft: 2 }}>
              {activeF}
            </span>
          )}
        </button>
        <span className="muted" style={{ marginLeft: "auto" }}>
          {rows.length} of {total}
        </span>
      </div>

      {invFiltersOpen && (
        <div className="fpanel">
          <div className="field">
            <label>Status</label>
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
            >
              <option value="">Any</option>
              {keys.map((k) => (
                <option key={k} value={k}>
                  {IST[k]?.l ?? k}
                </option>
              ))}
            </select>
          </div>
          <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
            <span
              className="linklike"
              onClick={() => {
                setStatusFilter("");
                setInvQ("");
              }}
            >
              Clear all
            </span>
          </div>
        </div>
      )}

      <div className="card" style={{ padding: "6px 14px" }}>
        <table>
          <thead>
            <tr>
              <th>#</th>
              <th>Customer</th>
              <th>Job</th>
              <th>Status</th>
              <th>Age</th>
              <th style={{ textAlign: "right" }}>Paid</th>
              <th style={{ textAlign: "right" }}>Due</th>
            </tr>
          </thead>
          <tbody>
            {rows.length > 0 ? (
              rows.map((i) => {
                const sk = invStatusKey(i);
                const s = IST[sk] ?? { l: sk, c: "var(--ink-2)", bg: "var(--paper)" };
                return (
                  <tr
                    key={i.id}
                    className="clickable"
                    onClick={() => stub("openInvoice", i.id)}
                  >
                    <td className="muted">{i.num}</td>
                    <td>
                      <b>{invCustName(i)}</b>
                    </td>
                    <td>{i.title}</td>
                    <td>
                      <span
                        className="stpill"
                        style={{ color: s.c, background: s.bg }}
                      >
                        {s.l}
                      </span>
                    </td>
                    <td className="muted">
                      {i.status === "draft" ? "—" : i.age === 0 ? "today" : `${i.age}d`}
                    </td>
                    <td style={{ textAlign: "right" }}>
                      {fmt$(invPaid(i) + (i.depPaid ?? 0))}
                    </td>
                    <td style={{ textAlign: "right", fontWeight: 700 }}>
                      {fmt$(invDue(i))}
                    </td>
                  </tr>
                );
              })
            ) : (
              <tr>
                <td colSpan={7}>
                  <div className="empty-att">
                    {total ? (
                      <>
                        Nothing matches —{" "}
                        <span
                          className="linklike"
                          onClick={() => {
                            setStatusFilter("");
                            setInvQ("");
                          }}
                        >
                          clear the filters
                        </span>
                      </>
                    ) : (
                      "No invoices yet — finish a job and it lands here, ready to bill."
                    )}
                  </div>
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </>
  );
}

// ============================================================================
// Main page
// ============================================================================

export default function MoneyPage() {
  const [activeTab, setActiveTab] = useState<FinSubTab>("fin-money");

  // Badge: number of jobs ready to invoice
  const rdyCount = jobsReadyToInvoice().length;

  return (
    <div>
      {/* In-content sub-tab strip — matches Jobs page pattern exactly */}
      <div
        style={{
          display: "flex",
          gap: 2,
          marginBottom: 22,
          borderBottom: "1px solid var(--line)",
          paddingBottom: 0,
        }}
      >
        {SUB_TABS.map((tab) => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            style={{
              background: "none",
              border: "none",
              padding: "8px 14px",
              fontFamily: "inherit",
              fontSize: 13.5,
              fontWeight: activeTab === tab.id ? 700 : 500,
              color: activeTab === tab.id ? "var(--ink)" : "var(--ink-2)",
              cursor: "pointer",
              borderBottom:
                activeTab === tab.id ? "2.5px solid var(--ink)" : "2.5px solid transparent",
              marginBottom: -1,
              borderRadius: 0,
            }}
          >
            {tab.label}
            {tab.id === "fin-money" && rdyCount > 0 && (
              <span className="cnt" style={{ marginLeft: 6 }}>
                {rdyCount}
              </span>
            )}
          </button>
        ))}
      </div>

      {/* Panel */}
      {activeTab === "fin-money" && <MoneyDashboard />}
      {activeTab === "fin-invoices" && <InvoicesList />}
    </div>
  );
}
