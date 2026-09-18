/**
 * app/(field)/my-day/visit-cards.ts
 *
 * CARDS ARE VISITS — the derivation the redesigned agenda renders from. Pure: no React, no store,
 * no clock (the caller supplies its own local "today").
 *
 * WHY. One row per JOB cannot draw a two-stop day: the morning stop and the return trip are
 * different drives at different hours, and a single row can only say one thing. One card per
 * VISIT says each thing where it happens. A job with no visits at all still gets a job-level
 * card — hiding it is how work goes missing.
 *
 * The buckets are the mock's two sections. UPCOMING is the route still to drive (pending,
 * en-route, on-site — any date, because carried-over work must stay visible on today's list).
 * FINISHED is what ran TODAY only: a stop completed some earlier day belongs to the pager's view
 * of that day, and listing it under today would claim work today didn't do.
 */

/** The visit fields this reads — structural, so the DTO and a test fixture both satisfy it. */
export interface DayCardVisit {
  readonly id: string;
  readonly status: string;
  readonly scheduledDate: string | null;
  readonly scheduledStart: string | null;
  readonly enrouteAt: string | null;
  readonly startedAt: string | null;
  readonly completedAt: string | null;
}

export interface DayCardJob {
  readonly id: string;
  readonly status: string;
  readonly visits: readonly DayCardVisit[];
  /** jobSummaryDTO.completedAt — only read for the visit-less job-level card. */
  readonly completedAt: string | null;
}

/** The four segments of the card's strip: scheduled → en route → on site → done. */
export type CardStep = 0 | 1 | 2 | 3;

export interface DayCard {
  /** Unique across the whole list — jobId for a job-level card, jobId:visitId otherwise. */
  readonly key: string;
  readonly jobId: string;
  /** Null = the job-level card of a visit-less job (acts on v1.field.start/complete). */
  readonly visitId: string | null;
  readonly step: CardStep;
  readonly day: string | null;
  readonly start: string | null;
  /** ISO instant the stop was finished — set on every finished-bucket card. */
  readonly completedAt: string | null;
  /** ISO instant the tech went on site — the "On site · since" stamp. */
  readonly startedAt: string | null;
}

export interface DayCards {
  readonly upcoming: readonly DayCard[];
  readonly finished: readonly DayCard[];
}

/**
 * Where a visit is in its lifecycle, as a segment count. En route is a STAMP on a still-pending
 * visit, not a status (see job-dto.ts) — and it is optional, never a gate: an on-site visit that
 * skipped the on-my-way text is simply on site.
 */
export function visitStep(v: Pick<DayCardVisit, "status" | "enrouteAt">): CardStep {
  if (v.status === "complete") return 3;
  if (v.status === "in_progress") return 2;
  return v.enrouteAt ? 1 : 0;
}

/** An ISO instant's calendar day where THIS DEVICE is — the same "today" the caller passed. */
function localDayOf(iso: string): string {
  const d = new Date(iso);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/** Within one job: dated before unplaced, then date, then start ("00:00" when unslotted). */
function byVisitSlot(a: DayCardVisit, b: DayCardVisit): number {
  const ak = a.scheduledDate === null ? null : `${a.scheduledDate}T${a.scheduledStart ?? "00:00"}`;
  const bk = b.scheduledDate === null ? null : `${b.scheduledDate}T${b.scheduledStart ?? "00:00"}`;
  if (ak === bk) return 0;
  if (ak === null) return 1;
  if (bk === null) return -1;
  return ak < bk ? -1 : 1;
}

const jobLevelStep = (status: string): CardStep =>
  status === "complete" ? 3 : status === "in_progress" ? 2 : 0;

/**
 * The whole list, in the order the server sent the jobs (my-day-order.ts already put the route in
 * driving order; within a job, visits run by their own slots). Finished re-sorts by when each
 * stop actually ended — the order the day was worked, not the order it was booked.
 */
export function deriveDayCards(jobs: readonly DayCardJob[], today: string): DayCards {
  const upcoming: DayCard[] = [];
  const finished: DayCard[] = [];

  for (const j of jobs) {
    // Defensive: myDay's filter already excludes called-off jobs, but a card for one would tell a
    // tech to drive to canceled work, so the rule is enforced where the cards are made too.
    if (j.status === "canceled") continue;

    const active = j.visits.filter((v) => v.status !== "canceled");
    if (active.length === 0) {
      const step = jobLevelStep(j.status);
      const card: DayCard = {
        key: j.id,
        jobId: j.id,
        visitId: null,
        step,
        day: null,
        start: null,
        completedAt: j.completedAt,
        startedAt: null,
      };
      // A job with no visits carries no date, so no day owns it and the pager cannot reach it.
      // Dropping it would make assigned work invisible everywhere rather than move it, so it stays.
      // It renders as "Not scheduled", which is the truth about it.
      (step === 3 ? finished : upcoming).push(card);
      continue;
    }

    for (const v of [...active].sort(byVisitSlot)) {
      const step = visitStep(v);
      const card: DayCard = {
        key: `${j.id}:${v.id}`,
        jobId: j.id,
        visitId: v.id,
        step,
        day: v.scheduledDate,
        start: v.scheduledStart,
        completedAt: v.completedAt,
        startedAt: v.startedAt,
      };
      if (step === 3) {
        // Finished belongs to the day it FINISHED. A stop completed some earlier day is that
        // day's record (the pager shows it there); on today's list it would be a false claim.
        // A complete visit with NO stamp (legacy rows predating stampsFor) stays visible —
        // dropping work over a missing timestamp is how work goes missing.
        if (v.completedAt == null || localDayOf(v.completedAt) === today) finished.push(card);
        continue;
      }
      // TODAY'S LIST IS TODAY'S — nothing else. A stop booked for another day belongs to that day
      // and the pager reaches it (deriveDayView filters to the date being viewed); a stop with no
      // date at all is not booked work yet. The server returns everything open
      // (openOrCompletedBetween) because the office needs it; this screen is one technician's route
      // for one day.
      //
      // The FINISHED bucket below has always applied this rule. The open bucket never did.
      // Only a DATED stop can belong to another day. An unplaced visit carries no date, so no day
      // owns it and the pager cannot reach it — same reason the job-level card above stays.
      if (card.day !== null && card.day !== today) continue;
      upcoming.push(card);
    }
  }

  const doneOrder = (c: DayCard) => c.completedAt ?? "";
  return {
    upcoming,
    finished: [...finished].sort((a, b) => (doneOrder(a) < doneOrder(b) ? -1 : doneOrder(a) > doneOrder(b) ? 1 : 0)),
  };
}
