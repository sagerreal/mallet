"use client";

/**
 * My Hours page — tech-scoped timesheet view.
 *
 * Fetches the caller's own time entries via v1.timesheets.list (anyRole; the
 * router enforces caller-scoping for techs — it ignores any techUserId input and
 * always uses ctx.principal.userId when role === "tech"). Does NOT depend on the
 * office Zustand store (timesheets / techs), which is only hydrated under the
 * ownerOrOffice layout.
 *
 * The page passes no techUserId — the server resolves the caller automatically.
 * Week navigation is client-side pagination over the already-fetched items.
 */

import { useState } from "react";
import { todayISO } from "@/lib/clock";
import { api } from "@/lib/trpc/client";
import type { RouterOutputs } from "@/lib/trpc/client";

type TimeEntryDTO = RouterOutputs["v1"]["timesheets"]["list"]["items"][number];

// ---- date helpers ----------------------------------------------------------

function addDays(iso: string, n: number): string {
  const d = new Date(iso + "T12:00:00");
  d.setDate(d.getDate() + n);
  return d.toISOString().slice(0, 10);
}

/** Monday of the week containing iso */
function weekStart(iso: string): string {
  const d = new Date(iso + "T12:00:00");
  const dow = (d.getDay() + 6) % 7; // 0 = Mon
  return addDays(iso, -dow);
}

function weekDates(wk: string): string[] {
  return Array.from({ length: 7 }, (_, i) => addDays(wk, i));
}

function dateLabel(iso: string): string {
  return new Date(iso + "T12:00:00").toLocaleDateString(undefined, {
    weekday: "long",
    month: "short",
    day: "numeric",
  });
}

function shortDateLabel(iso: string): string {
  return new Date(iso + "T12:00:00").toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
  });
}

// ---- time helpers -----------------------------------------------------------

function tsHours(e: TimeEntryDTO): number {
  if (!e.startTime || !e.endTime) return 0;
  const [sh = 0, sm = 0] = e.startTime.split(":").map(Number);
  const [eh = 0, em = 0] = e.endTime.split(":").map(Number);
  return Math.max(0, eh + em / 60 - (sh + sm / 60));
}

function tsPaid(e: TimeEntryDTO): number {
  return e.kind === "break" ? 0 : tsHours(e);
}

// ---- week filter -----------------------------------------------------------

function weekEntries(entries: TimeEntryDTO[], wk: string): TimeEntryDTO[] {
  const days = new Set(weekDates(wk));
  return entries.filter((e) => days.has(e.workDate));
}

function rollup(entries: TimeEntryDTO[], wk: string): { paid: number; ot: number; approved: boolean } {
  const es = weekEntries(entries, wk);
  const paid = es.reduce((s, e) => s + tsPaid(e), 0);
  const ot = Math.max(0, paid - 40);
  const approved = es.length > 0 && es.every((e) => e.status === "approved");
  return { paid, ot, approved };
}

// ============================================================================
// Sub-components
// ============================================================================

const TS_KIND_LABELS: Record<string, string> = {
  job: "Job",
  travel: "Travel",
  break: "Break",
  shop: "Shop",
};

interface EntryRowProps {
  entry: TimeEntryDTO;
}

function EntryRow({ entry: e }: EntryRowProps) {
  const hrs = tsHours(e);
  const kindLabel = TS_KIND_LABELS[e.kind] ?? e.kind;
  return (
    <div className="ts-e">
      <span
        className={`ts-kind ${e.kind === "job" ? "job" : ""}`}
        style={{ flex: "none", width: 56, textAlign: "center" }}
      >
        {kindLabel}
      </span>
      <span className="ts-elabel" style={{ flex: 1, minWidth: 0 }}>
        {kindLabel}
        {e.note ? <span className="muted"> · {e.note}</span> : null}
      </span>
      <span className="ts-etime">
        {e.startTime}–{e.endTime ?? "—"}
      </span>
      <span className="ts-ehrs" style={{ fontVariantNumeric: "tabular-nums" }}>
        {hrs.toFixed(2)} h
      </span>
    </div>
  );
}

interface DayBlockProps {
  date: string;
  entries: TimeEntryDTO[];
}

function DayBlock({ date, entries }: DayBlockProps) {
  const dayPaid = entries.reduce((s, e) => s + tsPaid(e), 0);
  return (
    <div className="ts-day">
      <div className="ts-dhdr">
        <span>{dateLabel(date)}</span>
        <span className="num">{dayPaid.toFixed(2)} h</span>
      </div>
      {entries.map((e) => (
        <EntryRow key={e.id} entry={e} />
      ))}
    </div>
  );
}

interface WeekEntriesProps {
  entries: TimeEntryDTO[];
  wk: string;
}

function WeekEntries({ entries, wk }: WeekEntriesProps) {
  const es = weekEntries(entries, wk);
  if (!es.length) {
    return <div className="empty-att">No hours logged yet.</div>;
  }

  const byDay: Record<string, TimeEntryDTO[]> = {};
  es.forEach((e) => {
    byDay[e.workDate] = [...(byDay[e.workDate] ?? []), e];
  });

  const days = weekDates(wk).filter((d) => byDay[d]);

  return (
    <>
      {days.map((d) => (
        <DayBlock key={d} date={d} entries={byDay[d] ?? []} />
      ))}
    </>
  );
}

// ============================================================================
// Page
// ============================================================================

export default function MyHoursPage() {
  // v1.timesheets.list — server auto-scopes to caller when role === "tech".
  // Fetch a wide window (180 days back → today) so week-navigation works client-side.
  const today = todayISO();
  const fromDate = addDays(today, -84); // 12 weeks back
  const toDate = addDays(today, 7);     // this week + 1 for safety

  const { data, isLoading } = api.v1.timesheets.list.useQuery(
    { fromDate, toDate, limit: 500 },
    { staleTime: 60_000 },
  );

  const [tsWeek, setTsWeek] = useState(() => weekStart(today));

  function navWeek(delta: number): void {
    setTsWeek((prev) => addDays(prev, delta * 7));
  }

  function goThisWeek(): void {
    setTsWeek(weekStart(today));
  }

  if (isLoading) {
    return (
      <>
        <h1>My hours</h1>
        <div className="muted" style={{ marginTop: 16 }}>Loading…</div>
      </>
    );
  }

  const entries = data?.items ?? [];
  const thisWeek = weekStart(today);
  const r = rollup(entries, tsWeek);
  const wkEnd = addDays(tsWeek, 6);

  return (
    <>
      <h1>My hours</h1>

      {/* Week nav */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 10,
          margin: "10px 0",
          flexWrap: "wrap",
        }}
      >
        <button className="btn sm" onClick={() => navWeek(-1)}>
          ‹ Prev
        </button>
        <b style={{ fontWeight: 700 }}>
          {shortDateLabel(tsWeek)} – {shortDateLabel(wkEnd)}
        </b>
        <button className="btn sm" onClick={() => navWeek(1)}>
          Next ›
        </button>
        {tsWeek !== thisWeek ? (
          <button className="btn sm ghost" onClick={goThisWeek}>
            This week
          </button>
        ) : null}
        <span style={{ flex: 1 }} />
        <span
          className="muted"
          style={{ fontSize: 12, fontVariantNumeric: "tabular-nums" }}
        >
          {r.paid.toFixed(2)} paid h
          {r.ot ? ` · ${r.ot.toFixed(2)} OT` : ""}
        </span>
      </div>

      {/* Entries for the selected week */}
      <WeekEntries entries={entries} wk={tsWeek} />

      {/* Approval status */}
      {r.approved ? (
        <span
          className="pill"
          style={{
            background: "var(--green-50)",
            color: "var(--green-700)",
            border: "1px solid var(--green-100)",
            display: "inline-block",
            marginTop: 8,
          }}
        >
          ✓ Approved — locked
        </span>
      ) : null}
    </>
  );
}
