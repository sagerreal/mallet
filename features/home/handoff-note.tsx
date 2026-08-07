/**
 * features/home/handoff-note.tsx
 * The hero: one dollar figure — the money waiting on the owner's OK — as the
 * grammatical SUBJECT of the Front Desk's note. No stat cells, no labels: the
 * figure drains as drafts are sent (useAnimatedNumber chases the store), and at
 * zero it becomes the sign-off. Every clause is a past-tense fact with a record
 * behind it.
 */

"use client";

import Link from "next/link";
import { useAnimatedNumber } from "./use-animated-number";
import type { ShiftReport } from "./derive";

function timeGreeting(): string {
  const h = new Date().getHours();
  if (h < 12) return "Good morning";
  if (h < 17) return "Good afternoon";
  return "Good evening";
}

const COUNT_WORDS = ["zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine"];
function countWord(n: number): string {
  return COUNT_WORDS[n] ?? String(n);
}

/**
 * What is waiting, as one clause.
 *
 * The board counts two different things — open pieces of work that need the SHOP (`queueCount`)
 * and how many of those already carry a prepared text (`textsReady`) — so when a caller knows
 * both, the sentence states both. A caller that only has a queue keeps the original wording;
 * nothing about it moved.
 */
function queueClause(queueCount: number, textsReady?: number): string {
  if (textsReady === undefined) {
    return `${countWord(queueCount)} ${queueCount === 1 ? "text" : "texts"} below, ready to send.`;
  }
  const items = `${queueCount} ${queueCount === 1 ? "item" : "items"}`;
  return `${items} · ${textsReady} ${textsReady === 1 ? "text" : "texts"} ready to send.`;
}

/** The night, as one factual clause. */
function nightClause(r: ShiftReport, frontDeskOn: boolean): React.ReactNode {
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
  // acts are local-only (never hydrated) — an empty report usually means "no data",
  // not "quiet night". Never state a negative the client cannot know.
  if (!r.busy) return "";

  const answered =
    r.callsAnswered === 1
      ? "A call came in after close — answered it"
      : `${r.callsAnswered} calls came in after close — answered ${
          r.callsAnswered === 2 ? "both" : "all " + countWord(r.callsAnswered)
        }`;

  if (r.booked) {
    return (
      <>
        {answered} and <b>booked {r.booked.lead.name.split(" ")[0]}</b> for {r.booked.when}.
      </>
    );
  }
  return `${answered} and took the details.`;
}

interface HandoffNoteProps {
  orgName: string;
  ownerFirst: string;
  dateLabel: string;
  frontDeskOn: boolean;
  report: ShiftReport;
  queueCount: number;
  queueValue: number;
  /**
   * How many of the waiting items already have a text written. Optional: callers that don't know
   * (anything but the board) keep the original "N texts below, ready to send" sentence, so adding
   * the board's figure changed no existing copy.
   */
  textsReady?: number;
  /**
   * Cold reload: the report/queue derive from not-yet-hydrated store slices. While true, the
   * thesis line renders as a skeleton — a derived-from-nothing "Quiet night" or "Nothing's
   * waiting on you" would be a statement the app can't yet stand behind. Identity (org name,
   * greeting) is server-seeded and stays.
   */
  loading?: boolean;
}

export function HandoffNote({
  orgName,
  ownerFirst,
  dateLabel,
  frontDeskOn,
  report,
  queueCount,
  queueValue,
  textsReady,
  loading = false,
}: HandoffNoteProps) {
  const shown = useAnimatedNumber(queueValue);

  if (loading) {
    return (
      <div className="ticket">
        <div className="eyebrow">
          {orgName.toUpperCase()} · {dateLabel}
        </div>
        <h1 data-dynamic>
          {timeGreeting()}, {ownerFirst}.
        </h1>
        <div className="thesis" style={{ maxWidth: 680 }} aria-hidden="true">
          <span className="sk" style={{ display: "inline-block", width: "min(320px, 80%)", height: 14 }} />
        </div>
        <span className="sr-only">Loading today&rsquo;s summary…</span>
      </div>
    );
  }

  return (
    <div className="ticket">
      <div className="eyebrow">
        {orgName.toUpperCase()} · {dateLabel}
      </div>
      {/* data-dynamic: the greeting is derived from the wall clock during SSR, which
          the E2E clock freeze (a browser-side shim) cannot reach — mask it in visual
          baselines so a real regression here isn't hidden behind a time-of-day flake. */}
      <h1 data-dynamic>
        {timeGreeting()}, {ownerFirst}.
      </h1>

      {queueCount > 0 ? (
        <>
          {queueValue > 0 && (
            <div className="herofig" aria-label={`$${queueValue.toLocaleString("en-US")} waiting on your OK`}>
              ${shown.toLocaleString("en-US")}
            </div>
          )}
          <div className="thesis" style={{ maxWidth: 680, marginTop: queueValue > 0 ? 4 : undefined }}>
            {queueValue > 0 ? "is waiting on your OK — " : "Waiting on your OK: "}
            {queueClause(queueCount, textsReady)} {nightClause(report, frontDeskOn)}
          </div>
        </>
      ) : (
        <div className="thesis" style={{ maxWidth: 680 }}>
          <b>Nothing&apos;s waiting on you. Go run the day.</b> {nightClause(report, frontDeskOn)}
        </div>
      )}

      {frontDeskOn && report.busy && (
        <div
          className="muted"
          style={{ textAlign: "right", fontSize: "var(--type-base)", marginTop: "var(--space-3)", color: "var(--manila-ink)", opacity: 0.55 }}
        >
          — Front Desk
        </div>
      )}
    </div>
  );
}
