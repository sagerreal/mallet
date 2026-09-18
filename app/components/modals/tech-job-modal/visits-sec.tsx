/**
 * components/modals/tech-job-modal/visits-sec.tsx
 * The visits SLOT — one stepper on screen, arrows or a swipe to reach the others.
 *
 * THE SHAPE (Owen, Aug 10, picked from a live mock). A multi-visit job used to stack a full
 * stepper per stop, and the collapsed-summary revision that followed confused the same tester in
 * a different way — two treatments for one thing, changing with job state. The slot is ONE
 * treatment: a pager line ("Visit 2 of 3" over one small date line), the stepper for that stop,
 * its own ↩ Reopen when it has one, and horizontal movement between stops. It opens on the stop
 * the job is at; finishing a stop advances it to the next one.
 *
 * ONE DATE LINE. The pager's mono line is the only place a visit's when/how-long is printed —
 * the `.vwhen` block that repeated the date under the stepper is deleted (visit-meta.ts is the
 * line's contents). A single-visit job keeps the line and drops the arrows and the count:
 * "Visit 1 of 1" is a label for a distinction that does not exist.
 *
 * OFF-SCREEN SLIDES ARE `inert`. Every stop stays mounted (that is what makes the swipe a swipe),
 * but a slide you cannot see must not be tabbable or read — an invisible ↩ Reopen in the focus
 * order is how a keyboard user reopens the wrong stop.
 */

"use client";

import { useEffect, useRef, useState } from "react";
import type { Visit } from "@/lib/store/types";
import { STORE_VISIT_STATUS } from "@/lib/store/dto-mapper";
import { useTickingNow } from "@/lib/use-ticking-now";
import { visitPagerMeta } from "./visit-meta";
import { VisitRow } from "./visit-row";
import { FollowUpAsk } from "./follow-up-ask";
import { seqAt } from "./visit-seq";

/**
 * The placed visits in the order they actually run.
 *
 * A COPY, and a deliberate one. `job.visits` comes off a LEFT JOIN with no ORDER BY
 * (drizzle-job-repository.findById), so the array order is not a promise — and the moment the
 * stops are numbered, printing them in an arbitrary order is not untidy, it is a false statement
 * about which stop came first.
 */
function inTimeOrder(placed: readonly Visit[]): Visit[] {
  return [...placed].sort(
    (a, b) => (a.date ?? "").localeCompare(b.date ?? "") || (a.start ?? 0) - (b.start ?? 0),
  );
}

interface VisitsSecProps {
  /** The job's PLACED visits — the tech never sees an "Invalid Date" slide. */
  placed: readonly Visit[];
  /**
   * Unplaced visits still to run — a return trip booked from the field, waiting on the office to
   * set a time. A slide like any other: this technician created it, and a booking that vanished
   * from the sheet reads as a tap that did nothing.
   */
  awaiting: readonly Visit[];
  /** The job's current visit, if it has one. */
  curVisit: Visit | undefined;
  done: boolean;
  /** Owner/office. ↩ Reopen writes a VISIT status, which has no field endpoint. */
  isOffice: boolean;
  /**
   * The one visit this viewer may move forward — the sheet's `actVisit`, the same visit the
   * foot's primary steps. Only that stop's stepper has live nodes.
   */
  stepVisitId: string | undefined;
  onStatus: (visitId: string, status: string) => void;
  /** Books a return trip. Absent when this viewer may not (the server refuses off-job callers). */
  onAddFollowUp?: (reason: string) => Promise<{ ok: boolean; error?: string }>;
}

export function VisitsSec({
  placed,
  awaiting,
  curVisit,
  done,
  isOffice,
  stepVisitId,
  onStatus,
  onAddFollowUp,
}: VisitsSecProps) {
  const rows = inTimeOrder(placed);
  const slides: Visit[] = [...rows, ...awaiting];
  const total = slides.length;

  const landIndex = landOn(slides, stepVisitId);

  const [idx, setIdx] = useState(landIndex);
  // Follow the JOB, not the render: snap to landIndex only when it MOVES (a stop finished, a
  // trip was booked) — a swipe back to an old stop must survive unrelated store writes.
  const landRef = useRef(landIndex);
  useEffect(() => {
    if (landRef.current !== landIndex) {
      landRef.current = landIndex;
      setIdx(landIndex);
    }
  }, [landIndex]);
  const shown = Math.min(idx, Math.max(0, total - 1));

  const { scRef, onScroll } = useSlotScroll(shown, total, idx, setIdx);
  const active = slides[shown];

  return (
    <div className="fsec">
      <div className="fsec-h">
        {/* "Visit", not "Your visit" — the office reads this sheet too. */}
        <span>Visit{total > 1 ? "s" : ""}</span>
        {done && <span style={{ color: "var(--green-700)", fontWeight: 700 }}>✓ Done</span>}
      </div>

      {total === 0 ? (
        <div className="empty-att" style={{ marginBottom: "0" }}>
          Not scheduled yet — the office will set the time.
        </div>
      ) : (
        <>
          <Pager shown={shown} total={total} active={active} onGo={setIdx} />

          <div className="vslots" ref={scRef} onScroll={onScroll}>
            {slides.map((v, i) => (
              <div className="vslide" key={v.id} inert={i !== shown}>
                {rows.includes(v) ? (
                  <VisitRow
                    visit={v}
                    seq={seqAt(i, total)}
                    canReopen={isOffice}
                    canStep={v.id === stepVisitId}
                    onStatus={(status) => onStatus(v.id, status)}
                  />
                ) : (
                  <AwaitingSlide visit={v} />
                )}
              </div>
            ))}
          </div>
        </>
      )}

      {onAddFollowUp ? (
        <div style={{ marginTop: "var(--space-3)" }}>
          <FollowUpAsk onBook={onAddFollowUp} />
        </div>
      ) : null}
    </div>
  );
}

/**
 * The scroller, kept in step with `idx` both ways.
 *
 * A programmatic smooth scroll EMITS scroll events, and rounding its intermediate positions back
 * into `idx` is a fight the arrow loses: tap ›, the animation passes 40% of a slide, the handler
 * rounds that to the old index, the effect scrolls back. Caught live — the arrow looked dead.
 * While a scroll WE started is in flight, the handler stays out of it; a finger swipe never
 * coincides with the same half-second as an arrow tap.
 */
function useSlotScroll(
  shown: number,
  total: number,
  idx: number,
  setIdx: (i: number) => void,
) {
  const scRef = useRef<HTMLDivElement>(null);
  const progAt = useRef(0);
  useEffect(() => {
    const sc = scRef.current;
    // clientWidth 0 = no layout (jsdom, display:none) — nothing to scroll and nothing to gain.
    if (!sc || !sc.clientWidth) return;
    const reduce =
      typeof window.matchMedia === "function" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    progAt.current = Date.now();
    sc.scrollTo?.({ left: shown * sc.clientWidth, behavior: reduce ? "auto" : "smooth" });
  }, [shown, total]);

  const onScroll = () => {
    const sc = scRef.current;
    if (!sc || !sc.clientWidth) return;
    if (Date.now() - progAt.current < 500) return;
    const i = Math.round(sc.scrollLeft / sc.clientWidth);
    if (i !== idx && i >= 0 && i < total) setIdx(i);
  };

  return { scRef, onScroll };
}

/**
 * WHERE THE SLOT OPENS — the stop the job is at.
 *
 * The viewer's own movable visit first (the foot's), else the first stop that has not finished
 * (a return trip waiting on a time counts — that IS where the job is), else the last stop: on a
 * finished job the most recent record is the one that gets read back.
 */
function landOn(slides: readonly Visit[], stepVisitId: string | undefined): number {
  const own = stepVisitId ? slides.findIndex((v) => v.id === stepVisitId) : -1;
  if (own >= 0) return own;
  const open = slides.findIndex((v) => v.status !== STORE_VISIT_STATUS.DONE);
  return open >= 0 ? open : Math.max(0, slides.length - 1);
}

/**
 * The pager row: ‹ Visit N of M over the one date line ›. On a ONE-stop job the date line keeps
 * its place and the count and arrows go — "Visit 1 of 1" is a label for a distinction that does
 * not exist.
 */
function Pager({
  shown,
  total,
  active,
  onGo,
}: {
  shown: number;
  total: number;
  active: Visit | undefined;
  onGo: (next: (i: number) => number) => void;
}) {
  if (total <= 1) {
    return (
      <div className="vpager">
        <div className="vpager-mid">{active ? <MetaLine visit={active} /> : null}</div>
      </div>
    );
  }
  return (
    <div className="vpager">
      <button
        type="button"
        className="varr"
        aria-label="Previous visit"
        disabled={shown === 0}
        onClick={() => onGo((i) => Math.max(0, i - 1))}
      >
        ‹
      </button>
      <div className="vpager-mid">
        <b>
          Visit {shown + 1} of {total}
        </b>
        {active ? <MetaLine visit={active} /> : null}
      </div>
      <button
        type="button"
        className="varr"
        aria-label="Next visit"
        disabled={shown === total - 1}
        onClick={() => onGo((i) => Math.min(total - 1, i + 1))}
      >
        ›
      </button>
    </div>
  );
}

/**
 * The pager's one date line. Split out because the ON-SITE state ticks — the elapsed figure is
 * the number a technician on site actually watches — and the interval must exist only while an
 * on-site stop is the one showing, not all day for every visit of the job.
 */
function MetaLine({ visit }: { visit: Visit }) {
  const live = visit.status === STORE_VISIT_STATUS.ONSITE && Boolean(visit.startedAt);
  return live ? <TickingMeta visit={visit} /> : <span>{visitPagerMeta(visit)}</span>;
}

function TickingMeta({ visit }: { visit: Visit }) {
  const now = useTickingNow();
  // data-dynamic: genuinely live — masked out of the visual baseline (e2e/helpers/ui.ts).
  return <span data-dynamic>{visitPagerMeta(visit, now)}</span>;
}

/**
 * A visit that is still to run but has nowhere to sit on the board yet — a slide with no stepper,
 * because there is nothing to step through. It carries the reason: that is the whole content of
 * the stop and the thing that stops the office ringing the technician to ask what it is for.
 * The pager line above names what is actually missing (a time, or a tech) — see visitPagerMeta.
 */
function AwaitingSlide({ visit }: { visit: Visit }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-1)" }}>
      <b style={{ fontSize: "var(--type-base)" }}>
        {visit.date ? "Booked — waiting on a tech" : "Return trip — waiting on a time"}
      </b>
      {visit.scopeNotes ? (
        <span className="muted" style={{ fontSize: "var(--type-sm)" }}>
          {visit.scopeNotes}
        </span>
      ) : null}
    </div>
  );
}
