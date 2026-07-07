/**
 * features/home/home-sections.tsx
 * Below the ledger: today's board as one dispatcher's line (prose, no labels),
 * and the ask-input with the day's top suggestion folded into its placeholder.
 * The receipts + sent ledger lives in ok-queue.tsx; there is no end marker —
 * the drained hero IS the sign-off.
 */

"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { fmt$ } from "@/lib/format";
import { timeLabel, type BoardStop } from "./derive";

// ---- Today — the dispatcher's line ---------------------------------------------

interface TodayStripProps {
  stops: BoardStop[];
  booksSum: number;
  toSchedule: { count: number; sum: number };
  openSlot: string | null;
  money: { quotesOut: number; overdue: number };
}

export function TodayStrip({ stops, booksSum, toSchedule, openSlot, money }: TodayStripProps) {
  return (
    <div style={{ marginTop: 22, borderTop: "1px solid var(--line)", paddingTop: 14 }}>
      <div style={{ fontSize: 13.5, lineHeight: 1.9 }}>
        <b>Today</b>
        {stops.length > 0 ? (
          <>
            {" — "}
            {stops.map((s, i) => (
              <span key={s.key} style={{ whiteSpace: "nowrap" }}>
                {i > 0 && <span className="muted"> · </span>}
                <b className="fig">{timeLabel(s.start)}</b> {s.label}{" "}
                <span className="muted">· {s.techName}</span>
              </span>
            ))}
            {booksSum > 0 && (
              <span className="muted">
                {" — "}
                <span style={{ whiteSpace: "nowrap" }}>
                  <b className="fig" style={{ color: "var(--ink)" }}>{fmt$(booksSum)}</b> on the books
                </span>
              </span>
            )}
          </>
        ) : (
          <span className="muted"> — nothing on the board.</span>
        )}
      </div>

      {(toSchedule.count > 0 || openSlot) && (
        <div style={{ fontSize: 12.5, marginTop: 5 }}>
          {toSchedule.count > 0 && (
            <Link href="/jobs?tab=schedule" className="linklike">
              {toSchedule.count} won {toSchedule.count === 1 ? "job" : "jobs"} to schedule (
              {fmt$(toSchedule.sum)}) — pick slots ›
            </Link>
          )}
          {toSchedule.count > 0 && openSlot && <span className="muted"> · </span>}
          {openSlot && (
            <Link href="/jobs?tab=schedule" className="linklike">
              {openSlot} — fill it ›
            </Link>
          )}
        </div>
      )}

      <div className="muted" style={{ fontSize: 12.5, marginTop: 7 }}>
        <Link href="/quotes" className="linklike" style={{ color: "inherit" }}>
          {fmt$(money.quotesOut)} on quotes out
        </Link>
        {" · "}
        <Link
          href="/money"
          className="linklike"
          style={{ color: money.overdue > 0 ? "var(--red)" : "inherit" }}
        >
          {fmt$(money.overdue)} overdue
        </Link>
      </div>
    </div>
  );
}

// ---- Ask Mallet — capability kept, chrome deleted --------------------------------

export function AskRow({ suggestion }: { suggestion: string | null }) {
  const router = useRouter();
  const [value, setValue] = useState("");

  function submit() {
    const q = value.trim();
    if (!q) return;
    router.push(`/assistant?${new URLSearchParams({ q }).toString()}`);
    setValue("");
  }

  const placeholder = suggestion
    ? `Tell Mallet what to do — try "${suggestion}"`
    : "Tell Mallet what to do…";

  return (
    <div className="taskadd" style={{ marginTop: 20 }}>
      <input
        type="text"
        aria-label="Tell Mallet what to do"
        placeholder={placeholder}
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") submit();
        }}
      />
      <button
        className="btn sm ghost"
        onClick={submit}
        disabled={!value.trim()}
        style={value.trim() ? undefined : { opacity: 0.4 }}
      >
        Go
      </button>
    </div>
  );
}
