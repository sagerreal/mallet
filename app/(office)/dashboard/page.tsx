"use client";

import { useRouter } from "next/navigation";
import {
  SAMPLE_BRAND,
  SAMPLE_LEADS,
  SAMPLE_ESTIMATES,
  OWNER_FIRST,
  SAMPLE_TASKS,
  TODAY_ISO,
  dPlus,
  sampleKpis,
  sampleFinKpis,
  findLead,
} from "@/lib/prototype-sample";

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

// fmt$ equivalent: formats a plain dollar number (not cents)
function fmt$(n: number): string {
  return "$" + n.toLocaleString(undefined, { maximumFractionDigits: 0 });
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
        {/* STUB: startJobTour() not wired — button is inert */}
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
        {/* STUB: startEstimateTour() not wired — button is inert */}
        <button className="btn primary" disabled style={{ cursor: "not-allowed", opacity: 0.6 }}>
          Start tour
        </button>
      </div>
    </>
  );
}

// ---- Today tasks card ----
function TodayCard() {
  const today = TODAY_ISO;
  const overdue = (due: string) => due < today;
  const dueLabel = (due: string) => {
    if (due === today) return "Today";
    if (overdue(due)) return `Overdue (${due})`;
    return due;
  };

  const open = SAMPLE_TASKS.filter((t) => !t.done);

  return (
    <div className="card">
      <h3>Today</h3>
      {open.length === 0 ? (
        <div className="empty-att">No tasks.</div>
      ) : (
        open.map((t) => {
          const ln = t.leadId != null ? findLead(t.leadId) : null;
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
                  {ln ? ` · ${ln.name}` : ""}
                </div>
              </div>
              {/* STUB: taskDone() not wired */}
              <button className="btn sm ghost" disabled style={{ opacity: 0.5 }}>
                Done
              </button>
            </div>
          );
        })
      )}
    </div>
  );
}

// ---- Needs attention — sample data version ----
// The prototype computes 9 attention items from this dataset.
// For the visual replica we render the most prominent ones matching the prototype output.
interface AttItem {
  key: string;
  grp: number;
  val: number;
  bg: string;
  title: string;
  why: string;
  actions: { lbl: string }[];
}

function buildSampleAttention(): AttItem[] {
  const items: AttItem[] = [
    // grp 1 — unread reply (Hector)
    { key: "tx-4-1", grp: 1, val: 0, bg: "var(--blue-bg)", title: "Hector Ruiz", why: 'Replied · "Just sent both pics — the hallway one runs constantly btw"', actions: [{ lbl: "Open thread" }, { lbl: "View lead" }] },
    // grp 1 — new lead Janet (age 0, no acts)
    { key: "new-1", grp: 1, val: 0, bg: "var(--green-50)", title: "Janet Kim", why: "New lead · Water heater making banging noise", actions: [{ lbl: "Call now" }, { lbl: "View" }] },
    // grp 2 — Sandy's quote viewed, 1 reminder sent
    { key: "vw-101", grp: 2, val: 1450, bg: "var(--green-50)", title: "Sandy Whitfield", why: "Opened the quote · 4d ago · still warm", actions: [{ lbl: "Call" }, { lbl: "View quote" }] },
    // grp 2 — Maria's quote viewed (age 1)
    { key: "vw-102", grp: 2, val: 2880, bg: "var(--green-50)", title: "Maria Lopez", why: "Opened the quote · 1d ago · still warm", actions: [{ lbl: "Call" }, { lbl: "View quote" }] },
    // grp 2 — Tom Webb invoice overdue 9d
    { key: "inv-802-9", grp: 2, val: 640, bg: "var(--red-bg)", title: "Tom Webb", why: "Unpaid 9d overdue · INV-2042 · reminders sent", actions: [{ lbl: "Remind" }, { lbl: "Take payment" }] },
    // grp 2 — unscheduled jobs
    { key: "slot-902", grp: 2, val: 2150, bg: "var(--amber-bg)", title: "Linda Park", why: "Won · needs scheduling", actions: [{ lbl: "Pick a slot" }] },
    { key: "slot-906", grp: 2, val: 340, bg: "var(--amber-bg)", title: "Lan Nguyen", why: "Won · needs scheduling", actions: [{ lbl: "Pick a slot" }] },
    // grp 4 — tasks overdue/today
    { key: "tk-1-" + dPlus(-1), grp: 4, val: 0, bg: "var(--red-bg)", title: "Send Hector the two toilet options with prices — he is picking between models", why: "Task overdue · Hector Ruiz", actions: [{ lbl: "Done" }, { lbl: "Open lead" }] },
    { key: "tk-2-" + dPlus(0), grp: 4, val: 0, bg: "var(--amber-bg)", title: "Call Rob back — he is talking to his wife tonight", why: "Due today · Rob Alvarez", actions: [{ lbl: "Done" }, { lbl: "Open lead" }] },
  ];
  return items;
}

function NeedsAttention() {
  const items = buildSampleAttention();
  const totalVal = items.reduce((s, a) => s + (a.val ?? 0), 0);

  const accent = (bg: string) => {
    if (/red/.test(bg)) return "urgent";
    if (/amber/.test(bg)) return "warm";
    return "";
  };

  let lastGrp = 0;
  const GRP_LABELS: Record<number, string> = {
    1: "Answer now",
    2: "Money on the table",
    3: "Going cold",
    4: "Promises",
  };

  return (
    <div className="card" id="attCard">
      <h3 style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between" }}>
        Needs attention
        <span className="muted" style={{ fontWeight: 600, fontSize: "12px" }}>
          {items.length} items{totalVal > 0 ? ` · $${totalVal.toLocaleString()} riding on them` : ""}
        </span>
      </h3>
      {items.map((a) => {
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
                {/* STUB: attention actions not wired to backend */}
                {a.actions.map((act) => (
                  <button key={act.lbl} className="btn sm" disabled style={{ opacity: 0.6 }}>
                    {act.lbl}
                  </button>
                ))}
                <button className="att-nn" title="Not now" disabled style={{ opacity: 0.4 }}>
                  ✕
                </button>
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ---- Where wins come from ----
function WinsFromCard() {
  // Build live ROI from sample data (mirrors liveRoi())
  const by: Record<string, { src: string; leads: number; won: number; val: number }> = {};
  const row = (s: string) => {
    if (!by[s]) by[s] = { src: s, leads: 0, won: 0, val: 0 };
    return by[s];
  };

  // count leads
  for (const l of SAMPLE_LEADS) {
    const r = row(l.source || "—");
    r.leads++;
    if (l.stage === "Won") r.won++;
  }
  // count accepted estimate values
  for (const e of SAMPLE_ESTIMATES) {
    if (e.status !== "accepted" || !e.leadId) continue;
    const l = findLead(e.leadId);
    if (!l) continue;
    const total = e.lines.reduce((s: number, ln: { q: number; r: number }) => s + ln.q * ln.r, 0);
    row(l.source || "—").val += total;
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

// ---- Main page ----
export default function DashboardPage() {
  const kpis = sampleKpis();
  const fin = sampleFinKpis();

  return (
    <div>
      {/* Hero ticket — matches prototype vHome() output */}
      <Ticket
        orgName={SAMPLE_BRAND.name}
        firstName={OWNER_FIRST}
        attCount={kpis.att}
        unpaid={fin.unpaid}
        newLeads={kpis.newWk}
        quotesOut={kpis.awaitN}
        quotesSum={kpis.awaitSum}
        collected={fin.collected}
      />

      {/* Demo tour cards */}
      <TourCards />

      {/* Two-column section */}
      <div className="row2" style={{ marginTop: "14px" }}>
        <div>
          {/* Needs-attention card */}
          <NeedsAttention />

          {/* AI Front Desk promo lockcard */}
          <div className="lockcard" style={{ marginBottom: "14px", position: "relative" }}>
            <span className="lk">included · off</span>
            <h4>Missed calls go to voicemail today</h4>
            <div className="muted" style={{ fontSize: "12px" }}>
              Most callers just dial the next name. Turn on the AI Front Desk: missed calls text
              themselves back, parsed &amp; held — nothing books without your yes.{" "}
              {/* STUB: turn-on action not wired */}
              <span className="linklike" style={{ opacity: 0.5 }}>
                Turn it on →
              </span>
            </div>
          </div>
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
