/**
 * features/home/home-sections.tsx
 * The Handoff's supporting sections: Already-handled receipts, the TODAY strip
 * (board + money line + sellable white space), the ask-Mallet row, and the end
 * marker. Every line traces to a record; every receipt opens it.
 */

"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { useOpenModal } from "@/lib/store/app-store";
import { MODAL } from "@/lib/store/modal-ids";
import { fmt$ } from "@/lib/format";
import { timeLabel, type Receipt, type BoardStop } from "./derive";

const SECTION_LABEL: React.CSSProperties = {
  fontSize: 11,
  fontWeight: 800,
  textTransform: "uppercase",
  letterSpacing: ".07em",
  color: "var(--ink-3)",
  marginBottom: 8,
};

// ---- Already handled — the Front Desk's receipts -----------------------------

export function HandledList({ receipts }: { receipts: Receipt[] }) {
  const openModal = useOpenModal();
  if (receipts.length === 0) return null;

  function open(r: Receipt) {
    if (r.open.kind === "thread") openModal(MODAL.THREAD, { leadId: r.open.id });
    else openModal(MODAL.EST, { estId: r.open.id });
  }

  return (
    <div style={{ marginTop: 18 }}>
      <div style={SECTION_LABEL}>Already handled</div>
      {receipts.map((r) => (
        <div
          key={r.key}
          style={{ display: "flex", alignItems: "baseline", gap: 8, padding: "5px 2px", fontSize: 13 }}
        >
          <span style={{ color: "var(--green-700)", fontWeight: 700 }}>✓</span>
          <span style={{ flex: 1, minWidth: 0 }}>{r.text}</span>
          <button type="button" className="linklike" style={{ fontSize: 12 }} onClick={() => open(r)}>
            {r.openLabel} ›
          </button>
        </div>
      ))}
    </div>
  );
}

// ---- TODAY — the board + money line + sellable white space --------------------

interface TodayStripProps {
  stops: BoardStop[];
  booksSum: number;
  toSchedule: { count: number; sum: number };
  openSlot: string | null;
  money: { quotesOut: number; overdue: number };
}

export function TodayStrip({ stops, booksSum, toSchedule, openSlot, money }: TodayStripProps) {
  return (
    <div style={{ marginTop: 18 }}>
      <div style={SECTION_LABEL}>
        Today{booksSum > 0 ? ` — ${fmt$(booksSum)} on the books` : ""}
      </div>

      {stops.length > 0 ? (
        <div style={{ fontSize: 13.5, lineHeight: 1.9 }}>
          {stops.map((s, i) => (
            <span key={s.key} style={{ whiteSpace: "nowrap" }}>
              {i > 0 && <span className="muted"> · </span>}
              <b className="fig">{timeLabel(s.start)}</b> {s.label}{" "}
              <span className="muted">· {s.techName}</span>
            </span>
          ))}
        </div>
      ) : (
        <div className="muted" style={{ fontSize: 13 }}>
          Nothing on the board today.
        </div>
      )}

      {(toSchedule.count > 0 || openSlot) && (
        <div style={{ fontSize: 12.5, marginTop: 6 }}>
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

      <div className="muted" style={{ fontSize: 12.5, marginTop: 8 }}>
        <Link href="/quotes" className="linklike" style={{ color: "inherit" }}>
          {fmt$(money.quotesOut)} on quotes out
        </Link>
        {" · "}
        <Link href="/money" className="linklike" style={{ color: money.overdue > 0 ? "var(--red)" : "inherit" }}>
          {fmt$(money.overdue)} overdue
        </Link>
      </div>
    </div>
  );
}

// ---- Ask Mallet — the input is right here, seeded with real work --------------

export function AskRow({ chips }: { chips: { label: string; q?: string; href?: string }[] }) {
  const router = useRouter();
  const [value, setValue] = useState("");

  function submit() {
    const q = value.trim();
    if (!q) return;
    router.push(`/assistant?${new URLSearchParams({ q }).toString()}`);
    setValue("");
  }

  return (
    <div style={{ marginTop: 22 }}>
      <div className="taskadd">
        <span aria-hidden="true" style={{ fontSize: 15, paddingLeft: 2 }}>✦</span>
        <input
          type="text"
          aria-label="Tell Mallet what to do"
          placeholder="Tell Mallet what to do…"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") submit();
          }}
        />
        <button
          className="btn sm primary"
          onClick={submit}
          disabled={!value.trim()}
          style={value.trim() ? undefined : { opacity: 0.4 }}
        >
          Go
        </button>
      </div>
      {chips.length > 0 && (
        <div className="chips" style={{ marginTop: 8 }}>
          {chips.map((c) => (
            <button
              key={c.label}
              type="button"
              className="chip"
              onClick={() =>
                c.href
                  ? router.push(c.href)
                  : router.push(`/assistant?${new URLSearchParams({ q: c.q ?? c.label }).toString()}`)
              }
            >
              {c.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// ---- the end marker ------------------------------------------------------------

export function EndMark({ queueEmpty }: { queueEmpty: boolean }) {
  return (
    <div
      className="muted"
      style={{ textAlign: "center", fontSize: 12.5, margin: "26px 0 8px" }}
    >
      ✓ {queueEmpty ? "That's everything — go run the day." : "That's the whole handoff — the rest can wait."}
    </div>
  );
}
