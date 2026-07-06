"use client";

/**
 * Money page — pixel-faithful port of the prototype's vMoney / vInvoices.
 * Reads live data from the Zustand store (invoices / jobs / leads / estimates)
 * so invoice-modal mutations reflect reactively. Wired actions open the invoice
 * modal or mutate the store; financing / QuickBooks are deferred.
 *
 * Sub-tab pattern mirrors app/(office)/jobs/page.tsx.
 * Money values are integer dollars (not cents) — the prototype's fmt$() does
 * `"$" + n.toLocaleString("en-US")`.
 */

import { useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useAppStore, useOpenModal } from "@/lib/store/app-store";
import { MODAL } from "@/lib/store/modal-ids";
import type { Estimate, Invoice, Job, Lead } from "@/lib/store/types";
import { fmt$ } from "@/lib/format";

// ---- helpers ported from prototype ------------------------------------------


/** invPaid — sum of payment amounts */
function invPaid(i: Invoice): number {
  return (i.payments ?? []).reduce((s, p) => s + (p.amt ?? 0), 0);
}

/** invDue — total − deposit − payments (floor 0) */
function invDue(i: Invoice): number {
  return Math.max(0, (i.total ?? 0) - (i.depPaid ?? 0) - invPaid(i));
}

/** invOver — unpaid past 7-day default (matches prototype) */
function invOver(i: Invoice): boolean {
  if (i.status === "draft" || invDue(i) <= 0) return false;
  return (i.age ?? 0) > 7;
}

/** invState — runtime status key (paid / partial / sent) */
function invState(i: Invoice): string {
  if (invDue(i) <= 0) return "paid";
  if (invPaid(i) > 0) return "partial";
  return "sent";
}

/** invStatusKey — including draft and overdue (matches IST keys) */
function invStatusKey(i: Invoice): string {
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
function liveInvs(invoices: Invoice[]): Invoice[] {
  return invoices.filter((i) => !i.archived);
}

/** jobsReadyToInvoice — done jobs no invoice references (Job has no invoiceId) */
function jobsReadyToInvoice(jobs: Job[], invoices: Invoice[]): Job[] {
  return jobs.filter((j) => j.status === "done" && !invoices.some((i) => i.jobId === j.id));
}

/** custName — resolve customer name from invoice */
function invCustName(i: Invoice, leads: Lead[]): string {
  const lead = leads.find((l) => l.id === i.leadId);
  return lead?.name ?? i.cust ?? "Customer";
}

/** custCard — look up saved card from the linked lead */
function custCard(i: Invoice, leads: Lead[]): { brand: string; last4: string; via?: string } | null {
  const lead = leads.find((l) => l.id === i.leadId);
  return lead?.card ?? null;
}

/** finKpis — KPI rollup (mirrors prototype's finKpis()) */
function finKpis(invoices: Invoice[], jobs: Job[], estimates: Estimate[]) {
  const live = liveInvs(invoices).filter((i) => i.status !== "draft");
  const collected = live.reduce((s, i) => s + invPaid(i) + (i.depPaid ?? 0), 0);
  const unpaidL = live.filter((i) => invDue(i) > 0);
  const overL = unpaidL.filter(invOver);

  // Sold · awaiting: accepted jobs not yet done and not yet invoiced
  const awaitJobs = jobs.filter((j) => {
    if (j.status === "done") return false;
    if (invoices.some((i) => i.jobId === j.id)) return false;
    const linked = estimates.find((e) => e.leadId === j.leadId && e.status === "accepted");
    return !!linked;
  });

  function jobPrice(j: Job): number {
    return (j.lines ?? []).reduce((s, l) => s + l.q * l.r, 0);
  }

  const awaiting = awaitJobs.reduce((s, j) => s + Math.max(0, jobPrice(j)), 0);

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

// ---- sub-tab types ----------------------------------------------------------

type FinSubTab = "fin-money" | "fin-invoices";

// ============================================================================
// vMoney — Money dashboard panel
// ============================================================================

function MoneyDashboard({ onGoInvoices }: { onGoInvoices: () => void }) {
  const invoices = useAppStore((s) => s.invoices);
  const jobs = useAppStore((s) => s.jobs);
  const leads = useAppStore((s) => s.leads);
  const estimates = useAppStore((s) => s.estimates);

  const openModal = useOpenModal();
  const router = useRouter();
  const addInvoice = useAppStore((s) => s.addInvoice);
  const recordPayment = useAppStore((s) => s.recordPayment);
  const updateInvoice = useAppStore((s) => s.updateInvoice);

  const [autoRemind, setAutoRemind] = useState(true);
  // Armed "charge card on file" — first tap arms, second tap charges.
  const [armedCharge, setArmedCharge] = useState<number | null>(null);

  const k = finKpis(invoices, jobs, estimates);
  const rdy = jobsReadyToInvoice(jobs, invoices);
  const drafts = liveInvs(invoices).filter((i) => i.status === "draft");
  const unpaid = liveInvs(invoices)
    .filter((i) => i.status !== "draft" && invDue(i) > 0)
    .sort((a, b) => ((invOver(b) ? 1 : 0) - (invOver(a) ? 1 : 0)) || invDue(b) - invDue(a));

  function openInvoice(i: Invoice) {
    openModal(MODAL.INVOICE, { invoiceId: i.id });
  }

  function createFromJob(j: Job) {
    const lead = leads.find((l) => l.id === j.leadId);
    const total = (j.lines ?? []).reduce((s, l) => s + l.q * l.r, 0);
    const inv = addInvoice({
      jobId: j.id,
      leadId: j.leadId,
      cust: lead?.name ?? "",
      phone: j.phone || (lead?.phone ?? ""),
      title: j.title,
      lines: (j.lines ?? []).map((l) => ({ d: l.d, q: l.q, r: l.r, c: l.c })),
      total,
      depPaid: 0,
      payments: [],
      status: "draft",
      age: 0,
      archived: false,
    });
    openModal(MODAL.INVOICE, { invoiceId: inv.id });
  }

  function chargeOnFile(i: Invoice) {
    if (armedCharge !== i.id) {
      setArmedCharge(i.id);
      return;
    }
    recordPayment(i.id, { amt: invDue(i), when: "Just now", method: "card", onFile: true });
    setArmedCharge(null);
  }

  function remindInvoice(i: Invoice) {
    updateInvoice(i.id, { fu: { on: true, stage: Math.min((i.fu?.stage ?? 0) + 1, 2) } });
  }

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
        <div className="kpi" onClick={() => onGoInvoices()}>
          <div className="lbl">Outstanding</div>
          <div className="val">{fmt$(k.unpaid)}</div>
          <div className="hint">
            {k.unpaidN} open invoice{k.unpaidN === 1 ? "" : "s"}
          </div>
        </div>

        {k.awaiting > 0 && (
          <div className="kpi" onClick={() => router.push("/jobs")}>
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
            const lead = leads.find((l) => l.id === j.leadId);
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
                  onClick={() => createFromJob(j)}
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
              <Javatar name={invCustName(i, leads)} />
              <div className="att-body">
                <b>{invCustName(i, leads)}</b>
                <div className="why">
                  {i.num} · {i.title}
                </div>
              </div>
              <span className="att-val">{fmt$(invDue(i))}</span>
              <button className="btn sm primary" onClick={() => openInvoice(i)}>
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
            const card = custCard(i, leads);
            const dotColor = over ? "var(--red)" : part ? "var(--amber)" : "var(--green-700)";

            return (
              <div key={i.id} className="att-item">
                <Javatar name={invCustName(i, leads)} />
                <div className="att-body">
                  <b>
                    <Dot color={dotColor} />
                    {invCustName(i, leads)}
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
                  <button className="btn sm" onClick={() => remindInvoice(i)}>
                    Remind
                  </button>
                  {card ? (
                    <button
                      className="btn sm primary"
                      onClick={() => chargeOnFile(i)}
                    >
                      {armedCharge === i.id ? "Confirm charge" : `Charge ···· ${card.last4}`}
                    </button>
                  ) : (
                    <button
                      className="btn sm primary"
                      onClick={() => openInvoice(i)}
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
  const invoices = useAppStore((s) => s.invoices);
  const leads = useAppStore((s) => s.leads);

  const openModal = useOpenModal();
  const addInvoice = useAppStore((s) => s.addInvoice);

  const [invQ, setInvQ] = useState("");
  const [invFiltersOpen, setInvFiltersOpen] = useState(false);
  const [statusFilter, setStatusFilter] = useState("");

  const allInvs = liveInvs(invoices);
  const total = allInvs.length;

  // All distinct status keys present in the dataset
  const keys = [...new Set(allInvs.map(invStatusKey))];

  function newInvoice() {
    const inv = addInvoice({
      jobId: null,
      leadId: 0,
      cust: "",
      phone: "",
      title: "New invoice",
      lines: [],
      total: 0,
      depPaid: 0,
      payments: [],
      status: "draft",
      age: 0,
      archived: false,
    });
    openModal(MODAL.INVOICE, { invoiceId: inv.id });
  }

  // Filter
  let rows = allInvs;
  const q = invQ.toLowerCase();
  if (q) {
    rows = rows.filter(
      (i) =>
        i.num.toLowerCase().includes(q) ||
        invCustName(i, leads).toLowerCase().includes(q) ||
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
          <button
            className="btn ghost"
            onClick={() => {
              // deferred: financing integration
            }}
          >
            Offer financing
          </button>
          <button
            className="btn ghost"
            onClick={() => {
              // deferred: QuickBooks integration
            }}
          >
            Connect QuickBooks
          </button>
          <button className="btn primary" onClick={() => newInvoice()}>
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
                    onClick={() => openModal(MODAL.INVOICE, { invoiceId: i.id })}
                  >
                    <td className="muted">{i.num}</td>
                    <td>
                      <b>{invCustName(i, leads)}</b>
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

const FIN_TABS: readonly FinSubTab[] = ["fin-money", "fin-invoices"];

export default function MoneyPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  // Sub-view driven by the sidebar nav (?tab=…), not an in-content strip.
  const tabParam = searchParams.get("tab");
  const activeTab: FinSubTab = FIN_TABS.includes(tabParam as FinSubTab)
    ? (tabParam as FinSubTab)
    : "fin-money";

  return (
    <div>
      {activeTab === "fin-money" && <MoneyDashboard onGoInvoices={() => router.push("/money?tab=fin-invoices")} />}
      {activeTab === "fin-invoices" && <InvoicesList />}
    </div>
  );
}
