"use client";

/**
 * Home dashboard — pixel-faithful port of the prototype's vHome().
 * KPIs, the Needs-attention list and Today's tasks all read LIVE from the
 * Zustand store (leads / estimates / invoices / jobs / tasks / brand) and
 * derive in the component body — never inside a selector (a selector that
 * returns a new array crashes with "getServerSnapshot should be cached").
 */

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useAppStore, useOpenModal } from "@/lib/store/app-store";
import { MODAL } from "@/lib/store/modal-ids";
import { estTotal } from "@/lib/prototype-sample";
import type { Estimate, Invoice, Job, Lead, Task } from "@/lib/store/types";
import { fmt$ } from "@/lib/format";
import { dueLabel } from "@/lib/task-dates";

// ---- constants (verbatim from prototype) ----
const OWNER_FIRST = "Mike";
const TODAY_ISO = "2026-07-01";

// ---- Greeting helpers ----
function timeGreeting(): string {
  // Prototype always says "Good morning" on the Home hero; match it verbatim
  return "Good morning";
}

function formatEyebrowDate(orgName: string): string {
  let result = orgName;
  try {
    const now = new Date(TODAY_ISO + "T12:00:00");
    const formatted = now
      .toLocaleDateString("en-US", {
        weekday: "short",
        month: "short",
        day: "numeric",
      })
      .replace(",", "");
    result += ` · ${formatted}`;
  } catch {
    // ignore
  }
  return result;
}


// ---- Money helpers (replicated locally — mirror money/page.tsx) ----
function invPaid(i: Invoice): number {
  return (i.payments ?? []).reduce((s, p) => s + (p.amt ?? 0), 0);
}

function invDue(i: Invoice): number {
  return Math.max(0, (i.total ?? 0) - (i.depPaid ?? 0) - invPaid(i));
}

function invOver(i: Invoice): boolean {
  if (i.status === "draft" || invDue(i) <= 0) return false;
  return (i.age ?? 0) > 7;
}

// ---- Lead helpers ----
function leadName(leads: Lead[], id: number | null | undefined): string {
  if (id == null) return "";
  return leads.find((l) => l.id === id)?.name ?? "";
}

/** The lead's estimate value (mirrors prototype leadVal): its estimate total, else its declared value. */
function leadVal(lead: Lead, estimates: Estimate[]): number {
  const est = lead.estId != null ? estimates.find((e) => e.id === lead.estId) : undefined;
  if (est) return estTotal(est);
  return lead.value ?? 0;
}

/** Job total from its line items (mirrors prototype jobPrice). */
function jobPrice(job: Job): number {
  return (job.lines ?? []).reduce((s, l) => s + (l.q ?? 1) * (l.r ?? 0), 0);
}

// ---- KPI derivation (mirrors prototype kpis() / finKpis()) ----
interface HomeKpis {
  newLeads: number;
  quotesOut: number;
  quotesSum: number;
  collected: number;
  unpaid: number;
}

function deriveKpis(leads: Lead[], estimates: Estimate[], invoices: Invoice[]): HomeKpis {
  // New this week: New customer stage, or Contacted & age<=7 (matches sampleKpis).
  const newLeads = leads.filter(
    (l) => l.stage === "New customer" || (l.stage === "Contacted" && l.age <= 7)
  ).length;

  const sentEsts = estimates.filter((e) => e.status === "sent");
  const quotesOut = sentEsts.length;
  const quotesSum = sentEsts.reduce((s, e) => s + estTotal(e), 0);

  // Non-draft invoices → collected = Σ (payments + deposit); unpaid = Σ due on the unpaid ones.
  const live = invoices.filter((i) => !i.archived && i.status !== "draft");
  const collected = live.reduce((s, i) => s + invPaid(i) + (i.depPaid ?? 0), 0);
  const unpaid = live.filter((i) => invDue(i) > 0).reduce((s, i) => s + invDue(i), 0);

  return { newLeads, quotesOut, quotesSum, collected, unpaid };
}

// ---- Ticket (hero manila card) ----
interface TicketProps {
  orgName: string;
  firstName: string;
  attCount: number;
  unpaid: number;
  newLeads: number;
  quotesOut: number;
  quotesSum: number;
  collected: number;
}

function Ticket({
  orgName,
  firstName,
  attCount,
  unpaid,
  newLeads,
  quotesOut,
  quotesSum,
  collected,
}: TicketProps) {
  const router = useRouter();

  // Prototype thesis: "9 things need you today · $1,060 still to collect"
  const thesis =
    attCount > 0 ? (
      <>
        <b className="fig">{attCount}</b>{" "}
        {attCount === 1 ? "thing needs" : "things need"} you today
        {unpaid > 0 && (
          <>
            {" "}
            ·{" "}
            <b className="fig">
              {fmt$(unpaid)}
            </b>{" "}
            still to collect
          </>
        )}
      </>
    ) : (
      "You're all caught up — nothing's waiting on you this morning."
    );

  return (
    <div className="ticket">
      <div className="eyebrow">{formatEyebrowDate(orgName.toUpperCase())}</div>
      <h1>
        {timeGreeting()}, {firstName}
      </h1>
      <div className="thesis">{thesis}</div>
      <div className="daystrip">
        <div className="daycell" onClick={() => router.push("/customers")}>
          <div className="dl">New leads</div>
          <div className="dv">{newLeads}</div>
        </div>
        <div className="daycell" onClick={() => router.push("/quotes")}>
          <div className="dl">Quotes out</div>
          <div className="dv">{quotesOut > 0 ? fmt$(quotesSum) : "0"}</div>
        </div>
        <div className="daycell" onClick={() => router.push("/money")}>
          <div className="dl">Collected · unpaid</div>
          <div className="dv">
            {fmt$(collected)}{" "}
            <span style={{ opacity: 0.45 }}>/</span>{" "}
            {fmt$(unpaid)}
          </div>
        </div>
        <div
          className="daycell"
          onClick={() =>
            document.getElementById("attCard")?.scrollIntoView({ behavior: "smooth" })
          }
        >
          <div className="dl">Needs you</div>
          <div className="dv">{attCount}</div>
        </div>
      </div>
    </div>
  );
}

// ---- Demo tour cards ----
function TourCards() {
  return (
    <>
      <div
        className="card"
        style={{
          borderColor: "#9C5B34",
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          gap: "12px",
          flexWrap: "wrap",
        }}
      >
        <div style={{ flex: 1, minWidth: "240px" }}>
          <b style={{ fontSize: "13.5px" }}>
            ▶ Full demo{" "}
            <span
              className="pill"
              style={{
                background: "var(--paper)",
                color: "#9C5B34",
                fontSize: "10px",
                border: "1px solid var(--manila-line)",
              }}
            >
              new customer → paid
            </span>
          </b>
          <div className="muted" style={{ fontSize: "12px" }}>
            A guided click-through of the <b>real screens</b>: add a customer → AI builds a
            Good · Better · Best quote → they approve → it becomes a job → assign the crew →
            the tech clocks in &amp; asks the AI → invoice + auto-reminders.
          </div>
        </div>
        {/* deferred: guided demo tours (separate feature) */}
        <button className="btn primary" disabled style={{ cursor: "not-allowed", opacity: 0.6 }}>
          Start tour
        </button>
      </div>

      <div
        className="card"
        style={{
          borderColor: "#4A639E",
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          gap: "12px",
          flexWrap: "wrap",
        }}
      >
        <div style={{ flex: 1, minWidth: "240px" }}>
          <b style={{ fontSize: "13.5px" }}>
            ▶ AI Front Desk{" "}
            <span
              className="pill"
              style={{
                background: "var(--blue-bg)",
                color: "var(--blue)",
                fontSize: "10px",
              }}
            >
              missed call → booked job
            </span>
          </b>
          <div className="muted" style={{ fontSize: "12px" }}>
            A guided click-through of the <b>real screens</b>: set up the AI Front Desk → it
            answers &amp; routes calls → a missed call is caught, texted back, and booked into a
            job — nobody typed a thing.
          </div>
        </div>
        {/* deferred: guided demo tours (separate feature) */}
        <button className="btn primary" disabled style={{ cursor: "not-allowed", opacity: 0.6 }}>
          Start tour
        </button>
      </div>
    </>
  );
}

// ---- Today tasks card ----
function TodayCard() {
  const tasks = useAppStore((s) => s.tasks);
  const leads = useAppStore((s) => s.leads);
  const taskDone = useAppStore((s) => s.taskDone);

  const overdue = (due: string) => due < TODAY_ISO;

  const open = tasks.filter((t) => !t.done);

  return (
    <div className="card">
      <h3>Today</h3>
      {open.length === 0 ? (
        <div className="empty-att">No tasks.</div>
      ) : (
        open.map((t) => {
          const nm = leadName(leads, t.leadId);
          const od = overdue(t.due);
          return (
            <div className="att-item" key={t.id}>
              <div
                className="att-ico"
                style={{ background: od ? "var(--red-bg)" : "var(--green-50)" }}
              >
                {od ? "⚠" : "✓"}
              </div>
              <div className="att-body">
                <b style={{ fontWeight: 600 }}>{t.t}</b>
                <div className="why">
                  {dueLabel(t.due)}
                  {nm ? ` · ${nm}` : ""}
                </div>
              </div>
              <button className="btn sm ghost" onClick={() => taskDone(t.id)}>
                Done
              </button>
            </div>
          );
        })
      )}
    </div>
  );
}

// ---- Needs attention — store-derived + wired ----
interface AttAction {
  lbl: string;
  fn: () => void;
}

interface AttItem {
  key: string;
  grp: number;
  val: number;
  bg: string;
  title: string;
  why: string;
  actions: AttAction[];
}

const GRP_LABELS: Record<number, string> = {
  1: "Answer now",
  2: "Money on the table",
  3: "Going cold",
  4: "Promises",
};

/** Last "them" text on a lead (for the unread-reply why line). */
function lastTheirText(lead: Lead): string {
  const theirs = (lead.acts ?? []).filter((a) => a.type === "text" && a.from === "them");
  const last = theirs[theirs.length - 1];
  return last?.t ?? "New message";
}

// ---- attention builder — one small function per group, all store-derived ----
interface AttSources {
  leads: Lead[];
  estimates: Estimate[];
  invoices: Invoice[];
  jobs: Job[];
  tasks: Task[];
}

interface AttHandlers {
  openModal: (id: (typeof MODAL)[keyof typeof MODAL], params?: Record<string, unknown>) => void;
  updateInvoice: (id: number, patch: Partial<Invoice>) => void;
  taskDone: (id: number) => void;
  goJobs: () => void;
}

/** Group 1 — answer now: unread replies + brand-new leads. */
function group1(src: AttSources, h: AttHandlers): AttItem[] {
  const out: AttItem[] = [];
  // 1a — unread reply (key carries reply count so a NEW reply re-surfaces)
  for (const l of src.leads) {
    if (l.archived || l.trash) continue;
    const theirs = (l.acts ?? []).filter((a) => a.type === "text" && a.from === "them");
    if (!l.unread) continue;
    out.push({
      key: `tx-${l.id}-${theirs.length}`,
      grp: 1,
      val: leadVal(l, src.estimates),
      bg: "var(--blue-bg)",
      title: l.name,
      why: `Replied · "${lastTheirText(l)}"`,
      actions: [
        { lbl: "Open thread", fn: () => h.openModal(MODAL.THREAD, { leadId: l.id }) },
        { lbl: "View lead", fn: () => h.openModal(MODAL.LEAD, { leadId: l.id }) },
      ],
    });
  }
  // 1b — brand-new uncontacted lead (New customer, age 0, no acts)
  for (const l of src.leads) {
    if (l.archived || l.trash) continue;
    if (l.stage === "New customer" && l.age === 0 && !(l.acts ?? []).length) {
      out.push({
        key: `new-${l.id}`,
        grp: 1,
        val: leadVal(l, src.estimates),
        bg: "var(--green-50)",
        title: l.name,
        why: `New lead${l.job ? " · " + l.job : ""}`,
        actions: [
          { lbl: "Call now", fn: () => h.openModal(MODAL.CALL, { leadId: l.id }) },
          { lbl: "View", fn: () => h.openModal(MODAL.LEAD, { leadId: l.id }) },
        ],
      });
    }
  }
  return out;
}

/** Group 2 — money on the table: viewed quotes, overdue invoices, unscheduled won jobs. */
function group2(src: AttSources, h: AttHandlers): AttItem[] {
  const out: AttItem[] = [];
  // 2a — quote opened, still warm (sent + viewed)
  for (const e of src.estimates) {
    if (e.archived || e.trash) continue;
    if (e.status !== "sent" || !e.viewed) continue;
    const l = src.leads.find((x) => x.id === e.leadId);
    if (!l || l.archived) continue;
    out.push({
      key: `vw-${e.id}`,
      grp: 2,
      val: estTotal(e),
      bg: "var(--green-50)",
      title: l.name,
      why: `Opened the quote · ${e.age === 0 ? "today" : e.age + "d ago"} · still warm`,
      actions: [
        { lbl: "Call", fn: () => h.openModal(MODAL.CALL, { leadId: l.id }) },
        { lbl: "View quote", fn: () => h.openModal(MODAL.EST, { estId: e.id }) },
      ],
    });
  }
  // 2b — overdue unpaid invoice (real money outranks quotes)
  for (const i of src.invoices) {
    if (i.archived) continue;
    if (i.status === "draft" || !invOver(i)) continue;
    const remindersSent = !!(i.fu && i.fu.on && i.fu.stage >= 2);
    out.push({
      key: `inv-${i.id}-${i.age}`,
      grp: 2,
      val: invDue(i),
      bg: "var(--red-bg)",
      title: i.cust,
      why: `Unpaid ${i.age}d overdue · ${i.num}${remindersSent ? " · reminders sent" : ""}`,
      actions: [
        {
          lbl: "Remind",
          fn: () =>
            h.updateInvoice(i.id, {
              fu: { on: true, stage: Math.min((i.fu?.stage ?? 0) + 1, 2) },
            }),
        },
        { lbl: "Take payment", fn: () => h.openModal(MODAL.INVOICE, { invoiceId: i.id }) },
      ],
    });
  }
  // 2c — won but never scheduled: won lead whose job is unscheduled (or has no scheduled job)
  for (const l of src.leads) {
    if (l.archived || l.trash) continue;
    if (l.stage !== "Won") continue;
    const jobs = src.jobs.filter((j) => j.leadId === l.id && !j.archived);
    if (!jobs.length) continue; // no job yet → nothing to slot from here
    const hasScheduled = jobs.some((j) => j.status !== "unscheduled");
    if (hasScheduled) continue;
    const job = jobs[0];
    if (!job) continue;
    out.push({
      key: `slot-${job.id}`,
      grp: 2,
      val: jobPrice(job),
      bg: "var(--amber-bg)",
      title: l.name,
      why: "Won · needs scheduling",
      actions: [{ lbl: "Pick a slot", fn: h.goJobs }],
    });
  }
  return out;
}

/** Group 4 — promises: open tasks due today or overdue. */
function group4(src: AttSources, h: AttHandlers): AttItem[] {
  const out: AttItem[] = [];
  const today = TODAY_ISO;
  for (const t of src.tasks) {
    if (t.done) continue;
    const isOverdue = t.due < today;
    const isToday = t.due === today;
    if (!isOverdue && !isToday) continue;
    const nm = leadName(src.leads, t.leadId);
    const actions: AttAction[] = [{ lbl: "Done", fn: () => h.taskDone(t.id) }];
    if (t.leadId != null) {
      const leadId = t.leadId;
      actions.push({ lbl: "Open lead", fn: () => h.openModal(MODAL.LEAD, { leadId }) });
    }
    out.push({
      key: `tk-${t.id}-${t.due}`,
      grp: 4,
      val: 0,
      bg: isOverdue ? "var(--red-bg)" : "var(--amber-bg)",
      title: t.t,
      why: isOverdue
        ? `Task overdue${nm ? " · " + nm : ""}`
        : `Due today${nm ? " · " + nm : ""}`,
      actions,
    });
  }
  return out;
}

function buildAttention(src: AttSources, h: AttHandlers): AttItem[] {
  const items = [...group1(src, h), ...group2(src, h), ...group4(src, h)];
  // Stable group order, then dollars-first within a group (mirrors prototype sort).
  return items.sort((a, b) => a.grp - b.grp || b.val - a.val);
}

function NeedsAttention() {
  const leads = useAppStore((s) => s.leads);
  const estimates = useAppStore((s) => s.estimates);
  const invoices = useAppStore((s) => s.invoices);
  const jobs = useAppStore((s) => s.jobs);
  const tasks = useAppStore((s) => s.tasks);
  const openModal = useOpenModal();
  const updateInvoice = useAppStore((s) => s.updateInvoice);
  const taskDone = useAppStore((s) => s.taskDone);
  const router = useRouter();

  const [dismissed, setDismissed] = useState<Set<string>>(new Set());

  const all = buildAttention(
    { leads, estimates, invoices, jobs, tasks },
    {
      openModal,
      updateInvoice,
      taskDone,
      goJobs: () => router.push("/jobs"),
    }
  );
  const items = all.filter((a) => !dismissed.has(a.key));
  const totalVal = items.reduce((s, a) => s + (a.val ?? 0), 0);

  const accent = (bg: string) => {
    if (/red/.test(bg)) return "urgent";
    if (/amber/.test(bg)) return "warm";
    return "";
  };

  const dismiss = (key: string) =>
    setDismissed((prev) => {
      const next = new Set(prev);
      next.add(key);
      return next;
    });

  let lastGrp = 0;

  return (
    <div className="card" id="attCard">
      <h3 style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between" }}>
        Needs attention
        <span className="muted" style={{ fontWeight: 600, fontSize: "12px" }}>
          {items.length} items{totalVal > 0 ? ` · $${totalVal.toLocaleString()} riding on them` : ""}
        </span>
      </h3>
      {items.length === 0 ? (
        <div className="empty-att">You&rsquo;re all caught up.</div>
      ) : (
        items.map((a) => {
          const showHdr = a.grp !== lastGrp;
          lastGrp = a.grp;
          return (
            <div key={a.key}>
              {showHdr && (
                <div
                  className="navlabel"
                  style={{ padding: `${lastGrp > 1 ? "12px" : "2px"} 0 4px` }}
                >
                  {GRP_LABELS[a.grp]}
                </div>
              )}
              <div className={`att-item`}>
                <div className={`att-ico ${accent(a.bg)}`} style={{ background: a.bg }} />
                <div className="att-body">
                  <b>{a.title}</b>
                  <div className="why">{a.why}</div>
                </div>
                <div className="att-actions">
                  {a.val > 0 && (
                    <span className="att-val">${a.val.toLocaleString()}</span>
                  )}
                  {a.actions.map((act) => (
                    <button key={act.lbl} className="btn sm" onClick={act.fn}>
                      {act.lbl}
                    </button>
                  ))}
                  <button
                    className="att-nn"
                    title="Not now"
                    onClick={() => dismiss(a.key)}
                  >
                    ✕
                  </button>
                </div>
              </div>
            </div>
          );
        })
      )}
    </div>
  );
}

// ---- Where wins come from ----
function WinsFromCard() {
  const leads = useAppStore((s) => s.leads);
  const estimates = useAppStore((s) => s.estimates);

  // Build live ROI from store data (mirrors liveRoi())
  const by: Record<string, { src: string; leads: number; won: number; val: number }> = {};
  const row = (s: string) => {
    const existing = by[s];
    if (existing) return existing;
    const created = { src: s, leads: 0, won: 0, val: 0 };
    by[s] = created;
    return created;
  };

  // count leads
  for (const l of leads) {
    const r = row(l.source || "—");
    r.leads++;
    if (l.stage === "Won") r.won++;
  }
  // count accepted estimate values
  for (const e of estimates) {
    if (e.status !== "accepted") continue;
    const l = leads.find((x) => x.id === e.leadId);
    if (!l) continue;
    row(l.source || "—").val += estTotal(e);
  }

  const rows = Object.values(by).sort(
    (a, b) => (b.val - a.val) || (b.won - a.won) || (b.leads - a.leads)
  );

  return (
    <div className="card">
      <h3>
        Where wins come from{" "}
        <span className="muted" style={{ fontWeight: 500 }}>
          · live from your leads
        </span>
      </h3>
      {rows.length === 0 ? (
        <div className="empty-att">
          Fills itself from the source chip on every lead — your first win draws the first bar.
        </div>
      ) : (
        rows.slice(0, 6).map((r) => {
          const pct = r.leads ? Math.round((100 * r.won) / r.leads) : 0;
          return (
            <div className="roi-row" key={r.src}>
              <b style={{ fontSize: "12.5px" }}>{r.src}</b>
              <div className="roi-bar">
                <i style={{ width: `${pct}%` }} />
              </div>
              <div className="roi-stat">
                {r.won}/{r.leads} won · ${r.val.toLocaleString()}
              </div>
            </div>
          );
        })
      )}
    </div>
  );
}

// ---- AI Front Desk promo lockcard ----
function FrontDeskCard() {
  const router = useRouter();
  const setToggle = useAppStore((s) => s.setToggle);

  const turnOn = () => {
    setToggle("frontDesk", true);
    router.push("/settings");
  };

  return (
    <div className="lockcard" style={{ marginBottom: "14px", position: "relative" }}>
      <span className="lk">included · off</span>
      <h4>Missed calls go to voicemail today</h4>
      <div className="muted" style={{ fontSize: "12px" }}>
        Most callers just dial the next name. Turn on the AI Front Desk: missed calls text
        themselves back, parsed &amp; held — nothing books without your yes.{" "}
        <span className="linklike" onClick={turnOn} style={{ cursor: "pointer" }}>
          Turn it on →
        </span>
      </div>
    </div>
  );
}

// ---- Main page ----
export default function DashboardPage() {
  const brand = useAppStore((s) => s.brand);
  const leads = useAppStore((s) => s.leads);
  const estimates = useAppStore((s) => s.estimates);
  const invoices = useAppStore((s) => s.invoices);
  const jobs = useAppStore((s) => s.jobs);
  const tasks = useAppStore((s) => s.tasks);

  const kpis = deriveKpis(leads, estimates, invoices);

  // Attention count must match the rendered list — recompute the length here.
  // (Actions are irrelevant to the count, so pass no-op handlers.)
  const noop = () => {};
  const attCount = buildAttention(
    { leads, estimates, invoices, jobs, tasks },
    { openModal: noop, updateInvoice: noop, taskDone: noop, goJobs: noop }
  ).length;

  return (
    <div>
      {/* Hero ticket — matches prototype vHome() output */}
      <Ticket
        orgName={brand.name}
        firstName={OWNER_FIRST}
        attCount={attCount}
        unpaid={kpis.unpaid}
        newLeads={kpis.newLeads}
        quotesOut={kpis.quotesOut}
        quotesSum={kpis.quotesSum}
        collected={kpis.collected}
      />

      {/* Demo tour cards */}
      <TourCards />

      {/* Two-column section */}
      <div className="row2" style={{ marginTop: "14px" }}>
        <div>
          {/* Needs-attention card */}
          <NeedsAttention />

          {/* AI Front Desk promo lockcard */}
          <FrontDeskCard />
        </div>

        <div>
          {/* Where wins come from */}
          <WinsFromCard />

          {/* Today / tasks */}
          <TodayCard />
        </div>
      </div>
    </div>
  );
}
