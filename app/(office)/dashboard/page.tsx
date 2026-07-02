"use client";

import { useRouter } from "next/navigation";
import { useCustomers } from "@/features/customers/hooks";
import { useJobs } from "@/features/jobs/hooks";
import { useInvoices } from "@/features/invoices/hooks";
import { useMe } from "@/features/identity/hooks";
import { formatMoney } from "@/lib/format";

// ---- Greeting helpers ----
function timeGreeting(): string {
  const h = new Date().getHours();
  if (h < 12) return "Good morning";
  if (h < 17) return "Good afternoon";
  return "Good evening";
}

function formatEyebrowDate(orgName: string): string {
  let result = orgName;
  try {
    const now = new Date();
    const formatted = now.toLocaleDateString("en-US", {
      weekday: "short",
      month: "short",
      day: "numeric",
    }).replace(",", "");
    result += ` · ${formatted}`;
  } catch {
    // ignore
  }
  return result;
}

// ---- Ticket (hero manila card) ----
interface TicketProps {
  orgName: string;
  firstName: string;
  attCount: number;
  unpaidCents: number;
  newLeads: number;
  quotesOut: number;
  quotesSum: number;
  collectedCents: number;
}

function Ticket({
  orgName,
  firstName,
  attCount,
  unpaidCents,
  newLeads,
  quotesOut,
  quotesSum,
  collectedCents,
}: TicketProps) {
  const router = useRouter();

  const thesis = attCount > 0
    ? (
      <>
        <b className="fig">{attCount}</b>{" "}
        {attCount === 1 ? "thing needs" : "things need"} you today
        {unpaidCents > 0 && (
          <> · <b className="fig">{formatMoney(unpaidCents)}</b> still to collect</>
        )}
      </>
    )
    : "You're all caught up — nothing's waiting on you right now.";

  return (
    <div className="ticket">
      <div className="eyebrow">{formatEyebrowDate(orgName.toUpperCase())}</div>
      <h1>{timeGreeting()}, {firstName}</h1>
      <div className="thesis">{thesis}</div>
      <div className="daystrip">
        <div className="daycell" onClick={() => router.push("/customers")}>
          <div className="dl">New leads</div>
          <div className="dv">{newLeads}</div>
        </div>
        <div className="daycell" onClick={() => router.push("/quotes")}>
          <div className="dl">Quotes out</div>
          <div className="dv">{quotesOut > 0 ? formatMoney(quotesSum) : "0"}</div>
        </div>
        <div className="daycell" onClick={() => router.push("/money")}>
          <div className="dl">Collected · Unpaid</div>
          <div className="dv">
            {formatMoney(collectedCents)}{" "}
            <span style={{ opacity: 0.45 }}>/</span>{" "}
            {formatMoney(unpaidCents)}
          </div>
        </div>
        <div className="daycell">
          <div className="dl">Needs you</div>
          <div className="dv">{attCount}</div>
        </div>
      </div>
    </div>
  );
}

// ---- Demo tour cards ----
function TourCards() {
  // Visual-only for this pass. startJobTour / startEstimateTour are deferred.
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
        {/* STUB: tour not wired yet — button is inert */}
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
        {/* STUB: tour not wired yet — button is inert */}
        <button className="btn primary" disabled style={{ cursor: "not-allowed", opacity: 0.6 }}>
          Start tour
        </button>
      </div>
    </>
  );
}

// ---- Onboarding checklist ("Get Mallet ready") ----
interface SetupStep {
  key: string;
  title: string;
  unlock: string;
  done: boolean;
}

interface OnboardingProps {
  steps: SetupStep[];
}

function Onboarding({ steps }: OnboardingProps) {
  const done = steps.filter((s) => s.done).length;
  const pct = Math.round((done / steps.length) * 100);
  const allDone = done === steps.length;

  if (allDone) return null;

  return (
    <div className="card setupcard">
      <h3 style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
        Get Mallet ready
        <span className="muted" style={{ fontWeight: 500, fontSize: "12px" }}>
          {/* STUB: dismiss not wired */}
          later
        </span>
      </h3>
      <div className="muted" style={{ fontSize: "12px", margin: "-4px 0 11px" }}>
        A few quick things light up the AI — each is skippable, and Mallet can draft most
        of it from your trade.
      </div>
      <div className="setup-ai">
        {/* STUB: Draft setup + Load sample are deferred actions */}
        <button className="btn primary" disabled style={{ cursor: "not-allowed", opacity: 0.6 }}>
          ✦ Draft my setup
        </button>
        <button className="btn" disabled style={{ cursor: "not-allowed", opacity: 0.6 }}>
          Load a sample shop
        </button>
        <span className="setup-prog">
          <span className="setup-bar">
            <i style={{ width: `${pct}%` }} />
          </span>{" "}
          {done}/{steps.length}
        </span>
      </div>
      {steps.map((s) => (
        <div className="att-item" key={s.key}>
          <div
            className="att-ico"
            style={{ background: s.done ? "var(--green-50)" : "var(--paper)" }}
          >
            {s.done ? "✓" : ""}
          </div>
          <div className="att-body">
            <b style={{ fontWeight: 600, ...(s.done ? { textDecoration: "line-through", color: "var(--ink-3)" } : {}) }}>
              {s.title}
            </b>
            <div className="why">{s.done ? "Done" : s.unlock}</div>
          </div>
          <div className="att-actions">
            {/* STUB: setup step actions are deferred */}
            {s.done ? (
              <button className="btn sm ghost" disabled style={{ opacity: 0.5 }}>Review</button>
            ) : (
              <button className="btn sm primary" disabled style={{ opacity: 0.5 }}>Set up</button>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}

// ---- Main page ----
export default function DashboardPage() {
  const me = useMe();
  const customers = useCustomers();
  const scheduledJobs = useJobs("scheduled");
  const inProgressJobs = useJobs("in_progress");
  const sentInvoices = useInvoices("sent");
  const partialInvoices = useInvoices("partial");
  const paidInvoices = useInvoices("paid");

  // Derive display values from real data (no seed data → shows 0)
  const orgName = me.data?.orgName ?? "Mallet";
  const rawName = me.data?.email?.split("@")[0] ?? "there";
  const firstName = rawName.split(/[._-]+/)[0] ?? "there";

  const newLeads = customers.data?.items?.length ?? 0;

  // Quotes out = sent invoices count (closest proxy we have pre-quoting feature)
  const sentInvItems = sentInvoices.data?.items ?? [];
  const partialInvItems = partialInvoices.data?.items ?? [];
  const paidInvItems = paidInvoices.data?.items ?? [];

  const unpaidItems = [...sentInvItems, ...partialInvItems];
  const unpaidCents = unpaidItems.reduce((sum, inv) => sum + inv.due.cents, 0);
  const collectedCents = paidInvItems.reduce((sum, inv) => sum + (inv.total?.cents ?? 0), 0);

  // Quotes out = sent invoices (approximate)
  const quotesOut = sentInvItems.length;
  const quotesSum = sentInvItems.reduce((sum, inv) => sum + inv.due.cents, 0);

  // "Needs you" = open jobs that are in_progress (need attention)
  const inProgressCount = inProgressJobs.data?.items?.length ?? 0;
  const attCount = inProgressCount;

  // Onboarding steps — derive from real data
  const setupSteps: SetupStep[] = [
    {
      key: "customers",
      title: "Add your first customer",
      unlock: "so Mallet can route quotes and jobs",
      done: newLeads > 0,
    },
    {
      key: "jobs",
      title: "Schedule your first job",
      unlock: "the crew board and time-clock light up",
      done: (scheduledJobs.data?.items?.length ?? 0) > 0,
    },
    {
      key: "invoice",
      title: "Send your first invoice",
      unlock: "payment reminders + the Money dashboard",
      done: sentInvItems.length > 0 || paidInvItems.length > 0,
    },
    {
      key: "ai",
      title: "Turn on the AI Front Desk",
      unlock: "catch missed calls — AI texts back & books jobs",
      done: false,
    },
  ];

  return (
    <div>
      {/* Hero ticket */}
      <Ticket
        orgName={orgName}
        firstName={firstName}
        attCount={attCount}
        unpaidCents={unpaidCents}
        newLeads={newLeads}
        quotesOut={quotesOut}
        quotesSum={quotesSum}
        collectedCents={collectedCents}
      />

      {/* Demo tour cards */}
      <TourCards />

      {/* Onboarding checklist */}
      <Onboarding steps={setupSteps} />

      {/* Needs-attention card */}
      <div className="row2" style={{ marginTop: "14px" }}>
        <div>
          <div className="card" id="attCard">
            <h3 style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between" }}>
              Needs attention
              {attCount > 0 && (
                <span className="muted" style={{ fontWeight: 600, fontSize: "12px" }}>
                  {attCount} item{attCount === 1 ? "" : "s"}
                </span>
              )}
            </h3>
            {attCount === 0 ? (
              <div className="empty-att">
                All clear — nothing is waiting on you. New leads, opened quotes and replies land
                here the minute they need a human.
              </div>
            ) : (
              (inProgressJobs.data?.items ?? []).map((job) => (
                <div className="att-item" key={job.id}>
                  <div className="att-ico warm">⚠</div>
                  <div className="att-body">
                    <b>{job.title ?? job.num}</b>
                    <div className="why">Job in progress — needs your review</div>
                  </div>
                  <div className="att-actions">
                    <a href={`/jobs/${job.id}`} className="btn sm">Open</a>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>

        <div>
          <div className="card">
            <h3>Where wins come from <span className="muted" style={{ fontWeight: 500 }}>· live from your leads</span></h3>
            <div className="empty-att">
              Fills itself from the source chip on every lead — your first win draws the first bar.
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
