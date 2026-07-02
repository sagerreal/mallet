"use client";

/**
 * My Day page — pixel-faithful port of the prototype's vMyDay().
 * Uses SAMPLE_JOBS / SAMPLE_TECHS / SAMPLE_LEADS / TODAY_ISO from lib/prototype-sample.ts.
 * No live hooks. All interactive actions are console-logged stubs.
 *
 * Prototype source: vMyDay() lines 4329-4374.
 */

import { useState } from "react";
import {
  SAMPLE_JOBS,
  SAMPLE_TECHS,
  SAMPLE_LEADS,
  TODAY_ISO,
  type SampleJob,
  type SampleVisit,
  type SampleTech,
} from "@/lib/prototype-sample";

// ---- helpers ---------------------------------------------------------------

function stub(action: string, ...args: unknown[]): void {
  // eslint-disable-next-line no-console
  console.log(`[stub] ${action}`, ...args);
}

function timeLabel(h: number): string {
  const hr = Math.floor(h);
  const mn = Math.round((h - hr) * 60);
  const period = hr < 12 ? "a" : "p";
  let d = hr % 12;
  if (d === 0) d = 12;
  return mn > 0 ? `${d}:${String(mn).padStart(2, "0")}${period}` : `${d}${period}`;
}

function hmLabel(h: number): string {
  const hrs = Math.floor(h);
  const mins = Math.round((h - hrs) * 60);
  if (!hrs && mins) return `${mins}m`;
  if (!mins) return `${hrs}h`;
  return `${hrs}h ${mins}m`;
}

function custName(j: SampleJob): string {
  const lead = SAMPLE_LEADS.find((l) => l.id === j.leadId);
  return lead?.name ?? "—";
}

function custPhone(j: SampleJob): string {
  return j.phone || SAMPLE_LEADS.find((l) => l.id === j.leadId)?.phone || "";
}

function custAddr(j: SampleJob): string {
  return j.addr || SAMPLE_LEADS.find((l) => l.id === j.leadId)?.address || "";
}

function jobMode(j: SampleJob): "estimate" | "install" | "service" {
  if (j.svc === "estimate") return "estimate";
  const priced = (j.lines ?? []).some((l) => (l.q ?? 1) * (l.r ?? 0) > 0);
  return priced ? "install" : "service";
}

interface SvcMeta {
  lbl: string;
  c: string;
}

const SVC_META: Record<string, SvcMeta> = {
  estimate: { lbl: "Estimate", c: "var(--amber)" },
  service: { lbl: "Price on site", c: "#9C5B34" },
  install: { lbl: "Priced", c: "#4A639E" },
};

function svcMeta(key: string): SvcMeta {
  return SVC_META[key] ?? (SVC_META.service as SvcMeta);
}

const JST: Record<string, { l: string; c: string; bg: string }> = {
  unscheduled: { l: "Unscheduled", c: "var(--amber)", bg: "var(--amber-bg)" },
  scheduled: { l: "Scheduled", c: "var(--ink-2)", bg: "var(--paper)" },
  enroute: { l: "On the way", c: "var(--ink-2)", bg: "var(--paper)" },
  onsite: { l: "On site", c: "var(--green-700)", bg: "var(--green-50)" },
  done: { l: "Done", c: "var(--ink-3)", bg: "var(--paper)" },
};

function jst(status: string): { l: string; c: string; bg: string } {
  return JST[status] ?? (JST.scheduled as { l: string; c: string; bg: string });
}

interface TodayStop {
  job: SampleJob;
  visit: SampleVisit;
}

function todayStops(techId: number): TodayStop[] {
  const out: TodayStop[] = [];
  SAMPLE_JOBS.filter((j) => !j.archived).forEach((j) => {
    (j.visits ?? []).forEach((v) => {
      if (v.techId === techId && v.date === TODAY_ISO && v.start != null) {
        out.push({ job: j, visit: v });
      }
    });
  });
  return out.sort((a, b) => (a.visit.start ?? 0) - (b.visit.start ?? 0));
}

// Phone icon (matches prototype ICON_PHONE)
function PhoneIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" style={{ width: 16, height: 16 }}>
      <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07A19.5 19.5 0 0 1 4.9 13a19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 3.8 2h3a2 2 0 0 1 2 1.72c.127.96.361 1.903.7 2.81a2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l.96-.96a2 2 0 0 1 2.11-.45c.907.339 1.85.573 2.81.7A2 2 0 0 1 22 16.92z" />
    </svg>
  );
}

// Nav icon (matches prototype ICON_NAV)
function NavIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" style={{ width: 16, height: 16 }}>
      <polygon points="3 11 22 2 13 21 11 13 3 11" />
    </svg>
  );
}

// ============================================================================
// Stop card — one visit row in the agenda
// ============================================================================

interface StopCardProps {
  stop: TodayStop;
  visitStatus: Record<number, string>;
  onStatusChange: (visitId: number, status: string) => void;
}

function StopCard({ stop, visitStatus, onStatusChange }: StopCardProps) {
  const { job: j, visit: v } = stop;
  const mode = jobMode(j);
  const meta = svcMeta(mode);
  const curStatus = visitStatus[v.id] ?? v.status;
  const s = jst(curStatus);
  const nm = custName(j);
  const addr = custAddr(j);
  const ph = custPhone(j);
  const title = j.title ?? "";

  function changeStatus(newStatus: string): void {
    stub("visitStatus", v.id, newStatus);
    onStatusChange(v.id, newStatus);
  }

  const acts =
    curStatus === "scheduled" ? (
      <>
        <button className="btn sm primary" onClick={() => changeStatus("enroute")}>
          On my way →
        </button>
        <button className="btn sm ghost" onClick={() => changeStatus("done")}>
          ✓ Done
        </button>
      </>
    ) : curStatus === "enroute" ? (
      <>
        <button className="btn sm primary" onClick={() => changeStatus("onsite")}>
          Arrived →
        </button>
        <button className="btn sm ghost" onClick={() => changeStatus("done")}>
          ✓ Done
        </button>
      </>
    ) : curStatus === "onsite" ? (
      <>
        <button className="btn sm primary" onClick={() => stub("visitTimerStart", v.id)}>
          Start timer
        </button>
        <button className="btn sm" onClick={() => changeStatus("done")}>
          ✓ Mark done
        </button>
      </>
    ) : (
      <button className="btn sm ghost" onClick={() => changeStatus("onsite")}>
        ↩ Reopen
      </button>
    );

  return (
    <div className="md-stop" onClick={() => stub("openJob", j.id)}>
      <div className="md-time">
        {timeLabel(v.start ?? 0)}–{timeLabel((v.start ?? 0) + (v.dur ?? 0))}
      </div>
      <div className="md-body">
        <div className="md-line1">
          <b>{nm}</b>
          <span className="md-type" style={{ color: meta.c }}>
            {meta.lbl}
          </span>
          <span className="stpill" style={{ color: s.c, background: s.bg }}>
            {s.l}
          </span>
        </div>
        <div className="md-sub">
          {title}
          {addr ? ` · ${addr}` : ""}
        </div>
        <div className="md-acts" onClick={(e) => e.stopPropagation()}>
          {ph ? (
            <button className="md-ic" title={`Call ${nm.split(" ")[0]}`} onClick={() => stub("jobCall", j.id)}>
              <PhoneIcon />
            </button>
          ) : null}
          {addr ? (
            <button className="md-ic" title="Navigate" onClick={() => stub("openDirections", addr)}>
              <NavIcon />
            </button>
          ) : null}
          <span style={{ flex: 1, minWidth: 8 }} />
          {acts}
        </div>
      </div>
    </div>
  );
}

// ============================================================================
// Clock card
// ============================================================================

const TS_KINDS: Record<string, string> = {
  job: "Job",
  travel: "Travel",
  break: "Break",
  shop: "Shop",
};

interface ClockCardProps {
  tech: SampleTech;
  clockState: "idle" | "travel" | "break" | "shop";
  onClockStart: (kind: "travel" | "break" | "shop") => void;
  onClockStop: () => void;
}

function ClockCard({ tech, clockState, onClockStart, onClockStop }: ClockCardProps) {
  return (
    <div className="card clockcard" style={{ marginBottom: 12 }}>
      <div className="clock-head">
        <div className="clock-meta">
          <b style={{ fontWeight: 700 }}>Time clock</b>
          <div className="muted" style={{ fontSize: 12, marginTop: 2 }}>
            {`0h today · 0h this week`}
            {clockState !== "idle" ? (
              <span style={{ color: "var(--green-700)", fontWeight: 600 }}>
                {` · ● ${TS_KINDS[clockState]} running`}
              </span>
            ) : null}
          </div>
        </div>
        <div className="clock-acts">
          {clockState !== "idle" ? (
            <button className="btn primary" onClick={onClockStop}>
              {`Stop ${(TS_KINDS[clockState] ?? clockState).toLowerCase()}`}
            </button>
          ) : (
            <>
              <button className="btn sm" onClick={() => onClockStart("travel")}>
                Travel
              </button>
              <button className="btn sm" onClick={() => onClockStart("break")}>
                Break
              </button>
              <button className="btn sm" onClick={() => onClockStart("shop")}>
                Shop
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

// ============================================================================
// Page
// ============================================================================

export default function MyDayPage() {
  const [myTech, setMyTech] = useState(1);
  const [visitStatus, setVisitStatus] = useState<Record<number, string>>({});
  const [clockState, setClockState] = useState<"idle" | "travel" | "break" | "shop">("idle");

  const tc: SampleTech | undefined =
    SAMPLE_TECHS.find((t) => t.id === myTech) ?? SAMPLE_TECHS[0];

  if (!tc) {
    return (
      <>
        <h1>My day</h1>
        <div className="empty-att">
          Add who does the work first — your crew shows up here.
        </div>
      </>
    );
  }

  // Non-null capture for use in closures (TypeScript can't narrow through the early return into fn bodies)
  const activeTech: SampleTech = tc;

  const list = todayStops(activeTech.id);
  const totalH = list.reduce((s, e) => s + (e.visit.dur ?? 0), 0);

  function handleStatusChange(visitId: number, status: string): void {
    setVisitStatus((prev) => ({ ...prev, [visitId]: status }));
  }

  function handleClockStart(kind: "travel" | "break" | "shop"): void {
    stub("tsClockStart", activeTech.id, kind);
    setClockState(kind);
  }

  function handleClockStop(): void {
    stub("tsClockStop", activeTech.id);
    setClockState("idle");
  }

  const lastStop = list[list.length - 1];
  const clearBy =
    lastStop != null
      ? timeLabel((lastStop.visit.start ?? 0) + (lastStop.visit.dur ?? 0))
      : null;

  return (
    <>
      <h1>My day</h1>
      <div className="sub">{"Today's stops."}</div>

      {/* Crew selector chip bar (owner/office role) */}
      <div className="chips" style={{ marginBottom: 10 }}>
        {SAMPLE_TECHS.map((t) => (
          <button
            key={t.id}
            className={`chip ${t.id === activeTech.id ? "sel" : ""}`}
            onClick={() => {
              setMyTech(t.id);
              setVisitStatus({});
              setClockState("idle");
            }}
          >
            <span
              className="javatar"
              style={{
                background: t.color,
                width: 18,
                height: 18,
                fontSize: 8,
                display: "inline-flex",
                verticalAlign: "middle",
                marginRight: 4,
              }}
            >
              {t.initials}
            </span>
            {t.name.split(" ")[0]}
          </button>
        ))}
      </div>

      {/* Stop summary line */}
      {list.length > 0 && clearBy != null ? (
        <div className="muted" style={{ fontSize: 12.5, marginBottom: 10 }}>
          <b>
            {list.length} stop{list.length === 1 ? "" : "s"} · {hmLabel(totalH)} booked
          </b>
          {` · first at ${timeLabel(list[0]?.visit.start ?? 0)}, clear by ~${clearBy}`}
        </div>
      ) : null}

      {/* Clock card */}
      <ClockCard
        tech={activeTech}
        clockState={clockState}
        onClockStart={handleClockStart}
        onClockStop={handleClockStop}
      />

      {/* Agenda */}
      <div className="card agenda">
        {list.length > 0 ? (
          list.map((stop) => (
            <StopCard
              key={stop.visit.id}
              stop={stop}
              visitStatus={visitStatus}
              onStatusChange={handleStatusChange}
            />
          ))
        ) : (
          <div className="empty-att">No stops today.</div>
        )}
      </div>
    </>
  );
}
