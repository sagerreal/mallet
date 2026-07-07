/**
 * features/home/handoff-note.tsx
 * The hero: the Front Desk's morning note. Handwritten sentence bank over the
 * shift report — the note's size is EARNED (busy night → full note; quiet night
 * → one honest line; Front Desk off → an honest "your phone went to voicemail").
 * It never pads and never claims anything without a record behind it.
 */

"use client";

import Link from "next/link";
import { fmt$ } from "@/lib/format";
import type { ShiftReport } from "./derive";

function timeGreeting(): string {
  const h = new Date().getHours();
  if (h < 12) return "Good morning";
  if (h < 17) return "Good afternoon";
  return "Good evening";
}

interface HandoffNoteProps {
  orgName: string;
  ownerFirst: string;
  dateLabel: string;
  frontDeskOn: boolean;
  report: ShiftReport;
  needsOkCount: number;
  /** Dollars riding on the OK queue — the VC-glance number. */
  needsOkValue: number;
}

/** The overnight sentence — exact phrasing per what actually happened. */
function overnightSentence(r: ShiftReport, frontDeskOn: boolean): React.ReactNode {
  if (!frontDeskOn) {
    return (
      <>
        Your phone went to voicemail overnight — the Front Desk is off.{" "}
        <Link href="/settings" className="linklike">
          Turn it on →
        </Link>
      </>
    );
  }
  if (!r.busy) return <>Quiet night — nothing came in after close.</>;

  const calls =
    r.callsAnswered === 1
      ? "A call came in after close — I answered it"
      : `${r.callsAnswered} calls came in after close — I answered ${
          r.callsAnswered === 2 ? "both" : "all " + r.callsAnswered
        }`;

  if (r.booked) {
    return (
      <>
        {calls} and <b>booked one</b> ({fmt$(r.booked.value)}, {r.booked.when}).
      </>
    );
  }
  return <>{calls} and took the details.</>;
}

function needsOkSentence(n: number): string {
  if (n === 0) return "Nothing needs your OK this morning.";
  if (n === 1) return "One thing needs your OK.";
  return `${n} things need your OK.`;
}

export function HandoffNote({
  orgName,
  ownerFirst,
  dateLabel,
  frontDeskOn,
  report,
  needsOkCount,
  needsOkValue,
}: HandoffNoteProps) {
  // The scoreboard is EARNED: it only renders when the night produced something.
  const showStrip = frontDeskOn && (report.busy || needsOkCount > 0);

  return (
    <div className="ticket">
      <div className="eyebrow">
        {orgName.toUpperCase()} · {dateLabel}
      </div>
      <h1>
        {timeGreeting()}, {ownerFirst}
      </h1>
      <div className="thesis" style={{ maxWidth: 720 }}>
        {overnightSentence(report, frontDeskOn)}{" "}
        <b>{needsOkSentence(needsOkCount)}</b>
        {frontDeskOn && report.busy && (
          <span className="muted" style={{ fontSize: 12.5, marginLeft: 8, whiteSpace: "nowrap" }}>
            — Front Desk
          </span>
        )}
      </div>

      {showStrip && (
        <div className="daystrip" style={{ gridTemplateColumns: "repeat(3,1fr)" }}>
          <div className="daycell" style={{ cursor: "default" }}>
            <div className="dl">Calls answered overnight</div>
            <div className="dv">{report.callsAnswered}</div>
          </div>
          <div className="daycell" style={{ cursor: "default" }}>
            <div className="dl">Booked while you slept</div>
            <div className="dv">{report.booked ? fmt$(report.booked.value) : "—"}</div>
          </div>
          <div className="daycell" style={{ cursor: "default", borderRight: "none" }}>
            <div className="dl">Waiting on your OK</div>
            <div className="dv">
              {needsOkValue > 0 ? fmt$(needsOkValue) : needsOkCount}
              {needsOkValue > 0 && (
                <span style={{ fontSize: 12, opacity: 0.6, marginLeft: 6 }}>
                  · {needsOkCount} {needsOkCount === 1 ? "draft" : "drafts"}
                </span>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
