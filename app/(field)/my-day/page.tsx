"use client";

/**
 * My Day page — tech-scoped agenda. CARDS ARE VISITS.
 *
 * Fetches the caller's assigned jobs via v1.field.myDay (anyRole, assignee-scoped) and renders
 * one CARD PER VISIT (visit-cards.ts) in two buckets: the route still to drive, and what finished
 * today. The Zustand jobs slice is hydrated from the SAME query by FieldJobsHydrator in the
 * (field) layout, which is what the tech-job-modal reads when a card is tapped.
 *
 * Visit-level actions write v1.field.setVisitEnroute / setVisitStatus — the exact mutations the
 * job sheet's own buttons use, so the card and the sheet can never disagree about what a tap
 * does. A job with no visits keeps the job-level pair (v1.field.start / complete). Every write is
 * optimistic against the myDay cache (the house pattern; the card must move NOW), reconciled by
 * refetch, rolled back + reported on failure.
 *
 * The day clock at the top is its own component and its own query — a real time entry, not page
 * state, so it survives a reload (see features/field/day-clock.tsx).
 */

import { haptics } from "@/lib/haptics";
import { api } from "@/lib/trpc/client";
import type { RouterOutputs } from "@/lib/trpc/client";
import { useOpenModal, usePushModal } from "@/lib/store/app-store";
import { MODAL } from "@/lib/store/modal-ids";
import { DayClock } from "@/features/field/day-clock";
import { useTimesheetClock } from "@/features/settings/use-timesheet-clock";
import { reportWriteError, reportWriteNotice } from "@/lib/store/write-error";
import { shouldShowLoadFailed } from "@/lib/first-run";
import { LoadFailed } from "@/components/shared/load-failed";
import { useMyDayInput } from "@/features/field/my-day-input";
import { todayISO, addDaysISO } from "@/lib/clock";
// fmt$2, never fmt$: this card names the sum a technician is about to take at the door, and the
// close-out it opens prints the balance to the cent. Rounded to whole dollars they disagreed, and
// the man holding the cash was short the difference.
import { fmt$2 } from "@/lib/format";
import { useAppStore } from "@/lib/store/app-store";
import { deriveDayCards, type DayCard } from "./visit-cards";
import type { CardMoney } from "./job-card";
import { deriveDayView } from "./day-view";
import { JobCard } from "./job-card";
import { DayPager, DAY_PAGER_REACH } from "./day-pager";
import { DaySummaryCard } from "./day-summary-card";
import { useEffect, useRef, useState } from "react";

type JobSummary = RouterOutputs["v1"]["field"]["myDay"]["items"][number];
type FieldCustomer = RouterOutputs["v1"]["field"]["myDay"]["customers"][number];
type VisitSummary = JobSummary["visits"][number];

/** How many times an interrupted "On my way" is re-sent before the tech is told. See below. */
const ENROUTE_RETRIES = 2;



export default function MyDayPage() {
  const utils = api.useUtils();
  // Which day the agenda is looking at. 0 = today (the live path below, untouched); the pager
  // moves it within ±DAY_PAGER_REACH. Paging is a VIEW change only — it must never touch the
  // running clock, which is a server-side time entry the DayClock merely renders.
  const [dayOffset, setDayOffset] = useState(0);
  const slideDir = useRef<"fwd" | "back" | null>(null);
  const viewDate = addDaysISO(todayISO(), dayOffset);
  const viewingToday = dayOffset === 0;
  // The agenda must stay live once mounted: the dispatcher reassigns a visit at a desk while this
  // page sits open on a phone in the truck, and no store invalidation can reach a different
  // device. Focus refetch covers "picked the phone back up"; the interval covers "screen was on
  // the whole time".
  // ONE builder, shared with the hydrator and with setData below — see features/field/my-day-input.
  const dayInput = useMyDayInput();
  const { data, isLoading, isFetching, isFetched, isError, isRefetching, refetch } = api.v1.field.myDay.useQuery(dayInput, {
    staleTime: 30_000,
    refetchOnWindowFocus: true,
    refetchInterval: 60_000,
  });

  // The paged-to day — v1.field.day, the visit-scoped read built for exactly this. No polling:
  // yesterday does not change under you the way today does.
  const pagedDay = api.v1.field.day.useQuery(
    { date: viewDate },
    { enabled: !viewingToday, staleTime: 300_000, refetchOnWindowFocus: false },
  );

  // How long today's working day IS (crew schedule, else org hours) — the ring's denominator.
  // The booked visits are the fallback for a shop that never set hours up.
  const standardDay = api.v1.field.standardDay.useQuery(
    { date: todayISO() },
    { enabled: viewingToday, staleTime: 600_000, refetchOnWindowFocus: false },
  );

  // The job sheet reads the STORE (hydrated from today's myDay). A paged day's jobs may not be
  // in it, so adopt them — merge-in, never setJobs, which would wipe today's agenda.
  const adoptJob = useAppStore((s) => s.adoptJob);
  useEffect(() => {
    if (viewingToday || !pagedDay.data) return;
    for (const item of pagedDay.data.items) {
      adoptJob(item as unknown as Parameters<typeof adoptJob>[0]);
    }
  }, [viewingToday, pagedDay.data, adoptJob]);

  /**
   * The clock does things to your hours that the button does not look like it did. Say them.
   * A segment under a minute is thrown away rather than rounded up — right, because a timesheet
   * is kept to the minute — but silence here is why the clock once looked broken.
   */
  const announceClock = (notice: "segment_too_short" | "close_bounded" | null) => {
    if (notice === "segment_too_short") {
      reportWriteNotice(
        "clock",
        "That was under a minute, so it wasn't recorded. Add the time on My hours if it should count.",
      );
    }
    if (notice === "close_bounded") {
      reportWriteNotice(
        "clock",
        "That segment ran far too long to be real, so its end was capped. Correct it on My hours.",
      );
    }
  };

  /** Move the card NOW — patch the exact cache entry this page reads (same input, or it's a miss). */
  const patchJob = (jobId: string, patch: (j: JobSummary) => JobSummary) => {
    utils.v1.field.myDay.setData(dayInput, (prev) =>
      prev ? { ...prev, items: prev.items.map((j) => (j.id === jobId ? patch(j) : j)) } : prev,
    );
  };
  const patchVisit = (jobId: string, visitId: string, patch: Partial<VisitSummary>) => {
    patchJob(jobId, (j) => ({
      ...j,
      visits: j.visits.map((v) => (v.id === visitId ? { ...v, ...patch } : v)),
    }));
  };

  /**
   * Start job / complete MOVE THE CLOCK server-side, and so do the visit taps (runVisitClockTap).
   * The clock card reads `open`/`list` on long staleTimes — without these invalidations it kept
   * showing the previous segment until something else remounted it.
   */
  const refreshClock = (): void => {
    void utils.v1.timesheets.open.invalidate();
    void utils.v1.timesheets.list.invalidate();
  };

  // ── job-level pair, for the visit-less card ────────────────────────────────
  const startMutation = api.v1.field.start.useMutation({
    onMutate: ({ jobId }) => patchJob(jobId, (j) => ({ ...j, status: "in_progress" })),
    onSuccess: (dto) => { announceClock(dto.clockNotice); refreshClock(); void refetch(); },
    onError: (err) => { void refetch(); reportWriteError("field.start", err); },
  });
  const completeMutation = api.v1.field.complete.useMutation({
    onMutate: ({ jobId }) => patchJob(jobId, (j) => ({ ...j, status: "complete" })),
    onSuccess: (dto) => { announceClock(dto.clockNotice); refreshClock(); void refetch(); },
    onError: (err) => { void refetch(); reportWriteError("field.complete", err); },
  });

  // ── visit-level actions — the same writes the job sheet makes ─────────────
  /**
   * NOT OPTIMISTIC, alone among the taps on this card. The others assert a local state change; this
   * one asserts that the CUSTOMER WAS TEXTED, and the optimistic patch removed the button on the
   * tap — so a request the phone never finished sending (backgrounded, out of signal, reloaded)
   * left a card claiming the text had gone, with the only contradiction a toast that died with the
   * page. The circle stays until the server confirms; an interrupted tap is still there to tap.
   *
   * Retried because the endpoint is explicitly idempotent (field-router: a repeat tap is a no-op
   * the clock resolves for itself), and a truck between cells is the ordinary case out here.
   */
  const enrouteMutation = api.v1.field.setVisitEnroute.useMutation({
    retry: ENROUTE_RETRIES,
    onSuccess: () => void refetch(),
    onError: (err) => { void refetch(); reportWriteError("field.setVisitEnroute", err); },
  });
  const visitStatusMutation = api.v1.field.setVisitStatus.useMutation({
    onMutate: ({ jobId, visitId, status }) =>
      patchVisit(
        jobId,
        visitId,
        status === "complete"
          ? { status, completedAt: new Date().toISOString() }
          : { status, startedAt: new Date().toISOString() },
      ),
    onSuccess: () => { refreshClock(); void refetch(); },
    onError: (err) => { void refetch(); reportWriteError("field.setVisitStatus", err); },
  });

  const openModal = useOpenModal();
  const pushModal = usePushModal();

  // Covers the WHOLE round trip, not just the write: the refetch is the slower half, and leaving
  // the buttons live during it is what allowed the double press.
  const isPending =
    startMutation.isPending ||
    completeMutation.isPending ||
    enrouteMutation.isPending ||
    visitStatusMutation.isPending ||
    isFetching;

  const items = viewingToday ? (data?.items ?? []) : (pagedDay.data?.items ?? []);
  const customers = viewingToday ? (data?.customers ?? []) : (pagedDay.data?.customers ?? []);
  const hasClock = useTimesheetClock();

  const jobsById = new Map(items.map((j) => [j.id, j]));
  const customersById = new Map(customers.map((c) => [c.id, c]));
  const todayCards = deriveDayCards(viewingToday ? items : [], todayISO());
  const dayView = deriveDayView(viewingToday ? [] : items, viewDate);
  const upcoming = viewingToday ? todayCards.upcoming : dayView.open;
  // Only today's view separates these: a past or future day IS its own date, so everything on it is
  // "that day's work" and calling any of it overdue would be nonsense.
  const overdue = viewingToday ? todayCards.overdue : [];
  const finished = viewingToday ? todayCards.finished : dayView.finished;

  // A dead fetch is not a free afternoon: rows already in hand stay (stale beats a wall), and an
  // error with nothing in hand says so instead of rendering a convincing empty day.
  const loadFailed = shouldShowLoadFailed({ isFetched, isError, count: items.length });

  function renderCard(card: DayCard) {
    const job = jobsById.get(card.jobId);
    if (!job) return null;
    const customer: FieldCustomer | undefined = customersById.get(job.leadId);
    const openSheet = () => openModal(MODAL.TECH_JOB, { jobId: job.id });
    /**
     * The finished card's money slot — the SAME rule as the sheet's doneFootAction: collect
     * while money is still due, office only when the office was actually asked. A "sent" bill
     * is NOT an office signal — the tech's own close-out sends the invoice as a prerequisite
     * of taking payment, so an interrupted close-out must leave the card collectible, and a
     * partial payment still has a balance to take at the door. A voided bill keeps the job's
     * one invoice slot so the card offers nothing.
     */
    const cardMoney = (): CardMoney | null => {
      if (card.step !== 3) return null;
      // THE JOB, not the visit. A finished stop on a job with a trip still to run (the
      // return-trip shape) must not offer the door money — the close-out refuses an open job,
      // and the office bills after the LAST trip. The cascade flips the job on the server, so
      // the circle appears on the refetch after the finishing tap, never optimistically wrong.
      if (job.status !== "complete") return null;
      const bill = job.bill ?? null;
      if (bill?.status === "paid")
        return {
          kind: "paid",
          label: bill.amountPaid ? `Paid ✓ · ${fmt$2(bill.amountPaid.cents / 100)}` : "Paid ✓",
        };
      if (bill?.status === "void") return null;
      if (job.invRequested)
        return { kind: "office", amount: job.total ? fmt$2(job.total.cents / 100) : null };
      // Due = the job's figure less what the ledger already took — both redaction-aligned
      // (a price-blind tech gets both as null and a plain label).
      const dueCents = job.total ? Math.max(0, job.total.cents - (bill?.amountPaid?.cents ?? 0)) : null;
      return {
        kind: "collect",
        label: dueCents !== null && dueCents > 0 ? `Take payment · ${fmt$2(dueCents / 100)}` : "Take payment",
      };
    };
    const money = cardMoney();
    // Narrowed ONCE — every closure below branches on it, so no `as string` can ever send a
    // null visitId to the server from a future call site.
    const visitId = card.visitId;

    const arrive = () => {
      haptics.commit();
      if (visitId === null) startMutation.mutate({ jobId: job.id });
      else visitStatusMutation.mutate({ jobId: job.id, visitId, status: "in_progress" });
    };
    const done = () => {
      // A finished stop is a completed task, not just a state change — success, not commit.
      haptics.success();
      if (visitId === null) completeMutation.mutate({ jobId: job.id });
      else visitStatusMutation.mutate({ jobId: job.id, visitId, status: "complete" });
    };
    const myWay = () => {
      if (visitId === null) return;
      haptics.commit();
      enrouteMutation.mutate({ jobId: job.id, visitId });
    };

    return (
      <JobCard
        key={card.key}
        card={card}
        title={job.title ?? `Job #${job.num}`}
        customerName={job.customerName}
        addr={job.addr ?? customer?.address ?? null}
        callback={Boolean(job.callbackOf)}
        notes={job.notes}
        isPending={isPending}
        onOpen={openSheet}
        onDirections={(addr) => window.open(`https://maps.google.com/?q=${encodeURIComponent(addr)}`, "_blank", "noopener,noreferrer")}
        onMyWay={viewingToday && visitId !== null && card.step === 0 ? myWay : null}
        onArrived={viewingToday && card.step < 2 ? arrive : null}
        onDone={viewingToday && card.step < 3 ? done : null}
        money={money}
        onCollect={money?.kind === "collect" ? () => pushModal(MODAL.CLOSE_OUT, { jobId: job.id, from: "field-job" }) : null}
        onReceipt={money?.kind === "paid" ? () => pushModal(MODAL.CLOSE_OUT, { jobId: job.id, from: "field-job" }) : null}
      />
    );
  }

  return (
    <>
      <h1>My day</h1>

      {/* The day clock owns its own queries — it must not wait on the agenda, and the agenda's
          loading state must not blank the row that says whether he is being paid. A sheet shop
          has no punch clock — its crew type their week on My hours instead, so the control hides
          entirely rather than sitting inert. */}
      {viewingToday && hasClock ? (
        <DayClock
          jobs={items}
          // The DAY TOTAL card's denominator: the length of this person's working day (their
          // crew-schedule row, else the org's default hours). A shop that never set hours up
          // falls back to today's booked visit load, so the ring still means something.
          scheduledMinutes={
            standardDay.data?.minutes ??
            items
              .flatMap((j) => j.visits)
              .filter((v) => v.scheduledDate === todayISO() && v.status !== "canceled")
              .reduce((n, v) => n + (v.durationMinutes ?? 0), 0)
          }
        />
      ) : null}
      {!viewingToday ? (
        <DaySummaryCard
          dateISO={viewDate}
          isPast={dayOffset < 0}
          scheduledMinutes={dayView.scheduledMinutes}
          jobCount={dayView.jobCount}
        />
      ) : null}

      <DayPager
        dateISO={viewDate}
        offset={dayOffset}
        onStep={(delta) => {
          slideDir.current = delta > 0 ? "fwd" : "back";
          setDayOffset((o) => Math.max(-DAY_PAGER_REACH, Math.min(DAY_PAGER_REACH, o + delta)));
        }}
        onToday={() => {
          slideDir.current = dayOffset > 0 ? "back" : "fwd";
          setDayOffset(0);
        }}
      />

      {(viewingToday ? isLoading : pagedDay.isLoading) ? (
        // The skeleton is the CARD's own shape — title line, address line, the circle row — so
        // content arrival replaces it without a jump.
        <div className="mdc-rail">
          {[0, 1].map((i) => (
            <div key={i} className="card mdc" style={{ cursor: "default" }}>
              <div className="sk" style={{ width: "55%", height: 16 }} />
              <div className="sk" style={{ width: "40%", height: 12, marginTop: "var(--space-3)" }} />
              <div style={{ display: "flex", gap: "var(--space-4)", marginTop: "var(--space-4)" }}>
                {[0, 1, 2].map((c) => (
                  <div key={c} className="sk" style={{ width: 44, height: 44, borderRadius: "var(--radius-pill)" }} />
                ))}
              </div>
            </div>
          ))}
        </div>
      ) : (viewingToday ? loadFailed : shouldShowLoadFailed({ isFetched: pagedDay.isFetched, isError: pagedDay.isError, count: items.length })) ? (
        <div className="card agenda">
          <LoadFailed
            noun="jobs"
            onRetry={() => void (viewingToday ? refetch() : pagedDay.refetch())}
            retrying={viewingToday ? isRefetching : pagedDay.isRefetching}
          />
        </div>
      ) : (
        <div key={viewDate} className={`mdp-pane ${slideDir.current === "back" ? "slide-back" : slideDir.current === "fwd" ? "slide-fwd" : ""}`}>
          {/* Overdue counts as content: a day whose only work is late is not an empty day, and
              "No open jobs assigned to you" over three overdue stops is the opposite of true. */}
          {overdue.length === 0 && upcoming.length === 0 && finished.length === 0 ? (
            <div className="card agenda">
              <div className="empty-att">
                {viewingToday
                  ? "No open jobs assigned to you."
                  : dayOffset < 0
                    ? "Nothing ran this day."
                    : "Nothing booked this day yet."}
              </div>
            </div>
          ) : (
            <>
              {/* Booked before today and still open. First, because it is the work that has been
                  waiting longest — and named, because under "Upcoming" it read as this morning. */}
              {overdue.length > 0 ? (
                <>
                  <h2 className="mdc-sec mdc-late">Overdue</h2>
                  <div className="mdc-rail">{overdue.map(renderCard)}</div>
                </>
              ) : null}
              {upcoming.length > 0 || viewingToday ? (
                <h2 className="mdc-sec">{viewingToday ? "Upcoming" : dayOffset < 0 ? "Not finished" : "Scheduled"}</h2>
              ) : null}
              {upcoming.length > 0 ? (
                <div className="mdc-rail">{upcoming.map(renderCard)}</div>
              ) : viewingToday ? (
                <div className="card mdc" style={{ cursor: "default" }}>
                  <div className="empty-att">Nothing left on the route — nice work.</div>
                </div>
              ) : null}
              {finished.length > 0 ? (
                <>
                  <h2 className="mdc-sec">{viewingToday ? "Finished today" : "Finished"}</h2>
                  <div className="mdc-rail">{finished.map(renderCard)}</div>
                </>
              ) : null}
            </>
          )}
        </div>
      )}
    </>
  );
}
