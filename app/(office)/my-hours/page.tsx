"use client";

/**
 * My Hours page — pixel-faithful port of the prototype's vMyTime().
 * Uses SAMPLE_TECHS / SAMPLE_TIME_ENTRIES from lib/prototype-sample.ts.
 * No live hooks. All interactive actions are console-logged stubs.
 *
 * Prototype source: vMyTime() lines 3716-3731, tsEntriesBlock() lines 3670-3678.
 */

import { useState } from "react";
import {
  SAMPLE_TECHS,
  SAMPLE_TIME_ENTRIES,
  TODAY_ISO,
  type SampleTech,
  type SampleTimeEntry,
} from "@/lib/prototype-sample";

// ---- helpers ---------------------------------------------------------------

function stub(action: string, ...args: unknown[]): void {
  // eslint-disable-next-line no-console
  console.log(`[stub] ${action}`, ...args);
}

function addDays(iso: string, n: number): string {
  const d = new Date(iso + "T12:00:00");
  d.setDate(d.getDate() + n);
  return d.toISOString().slice(0, 10);
}

/** Monday of the week containing iso (matches prototype tsWeekStart) */
function weekStart(iso: string): string {
  const d = new Date(iso + "T12:00:00");
  const dow = (d.getDay() + 6) % 7; // 0=Mon
  return addDays(iso, -dow);
}

function weekDates(wk: string): string[] {
  return Array.from({ length: 7 }, (_, i) => addDays(wk, i));
}

function tsHours(e: SampleTimeEntry): number {
  if (!e.start || !e.end) return 0;
  const startParts = e.start.split(":").map(Number);
  const endParts = e.end.split(":").map(Number);
  const sh = startParts[0] ?? 0;
  const sm = startParts[1] ?? 0;
  const eh = endParts[0] ?? 0;
  const em = endParts[1] ?? 0;
  return Math.max(0, (eh + em / 60) - (sh + sm / 60));
}

function tsPaid(e: SampleTimeEntry): number {
  if (e.kind === "break") return 0;
  return tsHours(e);
}

function tsHrsLabel(h: number): string {
  const H = Math.floor(h);
  const M = Math.round((h - H) * 60);
  return M ? `${H}h ${M}m` : `${H}h`;
}

function weekEntries(techId: number, wk: string): SampleTimeEntry[] {
  const days = weekDates(wk);
  return SAMPLE_TIME_ENTRIES.filter(
    (e) => e.techId === techId && days.includes(e.date)
  );
}

function rollup(techId: number, wk: string): { paid: number; ot: number; approved: boolean } {
  const es = weekEntries(techId, wk);
  const paid = es.reduce((s, e) => s + tsPaid(e), 0);
  const ot = Math.max(0, paid - 40);
  const approved = es.length > 0 && es.every((e) => e.status === "approved");
  return { paid, ot, approved };
}

const TS_KINDS: Record<string, string> = {
  job: "Job",
  travel: "Travel",
  break: "Break",
  shop: "Shop",
};

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

// ============================================================================
// Entry row
// ============================================================================

interface EntryRowProps {
  entry: SampleTimeEntry;
}

function EntryRow({ entry: e }: EntryRowProps) {
  const hrs = tsHours(e);
  const isJob = e.kind === "job";
  return (
    <div className="ts-e">
      <span
        className={`ts-kind ${isJob ? "job" : ""}`}
        style={{ flex: "none", width: 56, textAlign: "center" }}
      >
        {TS_KINDS[e.kind] ?? e.kind}
      </span>
      <span className="ts-elabel" style={{ flex: 1, minWidth: 0 }}>
        {isJob && e.jobTitle ? e.jobTitle : TS_KINDS[e.kind] ?? e.kind}
        {e.note ? <span className="muted"> · {e.note}</span> : null}
      </span>
      <span className="ts-etime">
        {e.start}–{e.end ?? "—"}
      </span>
      <span className="ts-ehrs" style={{ fontVariantNumeric: "tabular-nums" }}>
        {hrs.toFixed(2)} h
      </span>
    </div>
  );
}

// ============================================================================
// Day block
// ============================================================================

interface DayBlockProps {
  date: string;
  entries: SampleTimeEntry[];
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

// ============================================================================
// Entries block (mirrors tsEntriesBlock)
// ============================================================================

interface EntriesBlockProps {
  techId: number;
  wk: string;
}

function EntriesBlock({ techId, wk }: EntriesBlockProps) {
  const es = weekEntries(techId, wk);
  if (!es.length) {
    return <div className="empty-att">No entries this week.</div>;
  }

  const byDay: Record<string, SampleTimeEntry[]> = {};
  es.forEach((e) => {
    const arr = byDay[e.date] ?? [];
    byDay[e.date] = [...arr, e];
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
  const [myTech] = useState(1); // prototype: state.myTech = 1 (Mike Rivera)
  const [tsWeek, setTsWeek] = useState(() => weekStart(TODAY_ISO));

  const tc: SampleTech | undefined =
    SAMPLE_TECHS.find((t) => t.id === myTech) ?? SAMPLE_TECHS[0];

  if (!tc) {
    return (
      <>
        <h1>My hours</h1>
        <div className="empty-att">No crew yet.</div>
      </>
    );
  }

  // Non-null capture for closures
  const activeTech: SampleTech = tc;

  const r = rollup(activeTech.id, tsWeek);
  const thisWeek = weekStart(TODAY_ISO);
  const wkEnd = addDays(tsWeek, 6);

  function navWeek(delta: number): void {
    stub("tsWeekNav", delta);
    setTsWeek((prev) => addDays(prev, delta * 7));
  }

  function goThisWeek(): void {
    stub("tsWeekNav", "today");
    setTsWeek(thisWeek);
  }

  function addEntry(): void {
    stub("tsAddEntry", activeTech.id);
  }

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

      {/* Entries */}
      <EntriesBlock techId={activeTech.id} wk={tsWeek} />

      {/* Approve / add */}
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
      ) : (
        <div style={{ marginTop: 8 }}>
          <button className="btn sm" onClick={addEntry}>
            + Add entry
          </button>
        </div>
      )}
    </>
  );
}
