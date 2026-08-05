"use client";

/**
 * My Day page — tech-scoped agenda.
 *
 * Fetches the caller's assigned jobs via v1.field.myDay (anyRole, assignee-scoped).
 * The agenda renders straight from the query; the Zustand jobs slice is hydrated
 * from the SAME query by FieldJobsHydrator in the (field) layout, which is what
 * the tech-job-modal (checklist check-offs, found work) reads when a card is tapped.
 *
 * Actions: v1.field.start / v1.field.complete — assignee-guarded on the server.
 * The day clock at the top is its own component and its own query — a real time entry, not page
 * state, so it survives a reload (see features/field/day-clock.tsx).
 */

import { haptics } from "@/lib/haptics";
import { api } from "@/lib/trpc/client";
import type { RouterOutputs } from "@/lib/trpc/client";
import { useOpenModal } from "@/lib/store/app-store";
import { MODAL } from "@/lib/store/modal-ids";
import { DayClock } from "@/features/field/day-clock";
import { reportWriteError, reportWriteNotice } from "@/lib/store/write-error";
import { shouldShowLoadFailed } from "@/lib/first-run";
import { LoadFailed } from "@/components/shared/load-failed";
import { useMyDayInput } from "@/features/field/my-day-input";

type JobSummary = RouterOutputs["v1"]["field"]["myDay"]["items"][number];

// ---- helpers ---------------------------------------------------------------

function timeLabel(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  const hr = d.getHours();
  const mn = d.getMinutes();
  const period = hr < 12 ? "a" : "p";
  const display = hr % 12 === 0 ? 12 : hr % 12;
  return mn > 0 ? `${display}:${String(mn).padStart(2, "0")}${period}` : `${display}${period}`;
}

function statusLabel(status: string): { l: string; c: string; bg: string } {
  const map: Record<string, { l: string; c: string; bg: string }> = {
    scheduled: { l: "Scheduled", c: "var(--ink-2)", bg: "var(--paper)" },
    in_progress: { l: "In progress", c: "var(--green-700)", bg: "var(--green-50)" },
    // "complete", not "completed" — modules/jobs/domain/job.ts. The old key never matched, which
    // was invisible only because myDay filters completed jobs out; an optimistic complete shows
    // the status locally, so a wrong key would render the raw string "complete" at the user.
    complete: { l: "Done", c: "var(--ink-3)", bg: "var(--paper)" },
    canceled: { l: "Canceled", c: "var(--red-600, #dc2626)", bg: "var(--red-50, #fef2f2)" },
  };
  return map[status] ?? { l: status, c: "var(--ink-2)", bg: "var(--paper)" };
}

// ============================================================================
// Job card — one assigned job row in the agenda
// ============================================================================

interface JobCardProps {
  job: JobSummary;
  onOpen: (jobId: string) => void;
  onStart: (jobId: string) => void;
  onComplete: (jobId: string) => void;
  isPending: boolean;
}

function JobCard({ job, onOpen, onStart, onComplete, isPending }: JobCardProps) {
  const s = statusLabel(job.status);

  const acts =
    job.status === "scheduled" ? (
      <button
        className="btn sm primary"
        onClick={() => onStart(job.id)}
        disabled={isPending}
      >
        Start job
      </button>
    ) : job.status === "in_progress" ? (
      <button
        className="btn sm"
        onClick={() => onComplete(job.id)}
        disabled={isPending}
      >
        ✓ Complete
      </button>
    ) : null;

  return (
    // Card tap opens the tech job view (checklist, found work). The action
    // buttons stopPropagation below so Start/Complete don't also open it.
    <div className="md-stop" style={{ cursor: "pointer" }} onClick={() => onOpen(job.id)}>
      <div className="md-time">{timeLabel(job.scheduledStart)}</div>
      <div className="md-body">
        <div className="md-line1">
          {/* Focusable open control — keyboard access without the row being a button
              (it contains the Start/Complete action buttons below). */}
          <button
            type="button"
            className="rowopen"
            aria-label={`Open ${job.title ?? `Job #${job.num}`}`}
            onClick={(e) => { e.stopPropagation(); onOpen(job.id); }}
          >
            <b>{job.title ?? `Job #${job.num}`}</b>
          </button>
          <span className="stpill" style={{ color: s.c, background: s.bg }}>
            {s.l}
          </span>
        </div>
        <div className="md-sub">
          #{job.num}
          {job.notes ? ` · ${job.notes}` : ""}
        </div>
        {acts ? (
          <div className="md-acts" onClick={(e) => e.stopPropagation()}>
            {acts}
          </div>
        ) : null}
      </div>
    </div>
  );
}

// ============================================================================
// Page
// ============================================================================

export default function MyDayPage() {
  const utils = api.useUtils();
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

  /**
   * Move the card NOW.
   *
   * This page used to render straight off the query and only change after a second round trip:
   * ~1.3s for the write, then ~1.2s for the refetch. For those ~2.5 seconds the button sat there
   * still saying "Start job", so people pressed it again — and again. Every "it does nothing" and
   * every "I had to hit it six times" was this. The house pattern is optimistic-then-reconcile
   * (CLAUDE.md); this brings the page in line with it.
   */
  /**
   * The clock does things to your hours that the button does not look like it did. Say them.
   *
   * A segment under a minute is thrown away rather than rounded up — right, because a timesheet is
   * kept to the minute and inventing one would be a lie on a payroll record — but until now that
   * happened in total silence, so the hours simply never appeared and the clock looked broken.
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

  const optimisticStatus = (jobId: string, status: JobSummary["status"]) => {
    // The SAME input the query above was made with. setData matches on it: pass anything else and
    // this patches a cache entry nobody is reading, the card never moves, and the button sits on
    // "✓ Complete" for the whole round trip — precisely the failure this path exists to prevent.
    utils.v1.field.myDay.setData(dayInput, (prev) =>
      prev
        ? { ...prev, items: prev.items.map((j) => (j.id === jobId ? { ...j, status } : j)) }
        : prev,
    );
  };

  const startMutation = api.v1.field.start.useMutation({
    onMutate: ({ jobId }) => optimisticStatus(jobId, "in_progress"),
    onSuccess: (dto) => { announceClock(dto.clockNotice); void refetch(); },
    // Roll the guess back and SAY so — a write that failed silently is what made this page
    // untrustworthy in the first place.
    onError: (err) => {
      void refetch();
      reportWriteError("field.start", err);
    },
  });
  const completeMutation = api.v1.field.complete.useMutation({
    onMutate: ({ jobId }) => optimisticStatus(jobId, "complete"),
    onSuccess: (dto) => { announceClock(dto.clockNotice); void refetch(); },
    onError: (err) => {
      void refetch();
      reportWriteError("field.complete", err);
    },
  });

  const openModal = useOpenModal();

  // Covers the WHOLE round trip, not just the write: the refetch is the slower half, and leaving
  // the button live during it is what allowed the second press.
  const isPending = startMutation.isPending || completeMutation.isPending || isFetching;

  function handleOpen(jobId: string): void {
    // The modal reads store.jobs — hydrated from this same myDay query by
    // FieldJobsHydrator in the (field) layout.
    openModal(MODAL.TECH_JOB, { jobId });
  }

  function handleStart(jobId: string): void {
    haptics.commit();
    startMutation.mutate({ jobId });
  }

  function handleComplete(jobId: string): void {
    // A finished job is a completed task, not just a state change — success, not commit.
    haptics.success();
    completeMutation.mutate({ jobId });
  }

  const items = data?.items ?? [];

  // A dead fetch is not a free afternoon. Until now ANY myDay error fell through to
  // `data?.items ?? []` and rendered "No jobs assigned to you today" — indistinguishable from a
  // genuinely empty day, and the tech's only recourse was to guess. If rows are already in hand
  // (a refetch failed) they stay: slightly stale beats a wall.
  const loadFailed = shouldShowLoadFailed({ isFetched, isError, count: items.length });

  return (
    <>
      <h1>My day</h1>
      <div className="sub">{"Today's jobs."}</div>

      {/* The day clock owns its own query — it must not wait on the agenda, and the agenda's
          loading state must not blank the row that says whether he is being paid. */}
      <DayClock />

      {isLoading ? (
        <div className="card agenda">
          {[0, 1, 2].map((i) => (
            <div key={i} className="sk-row">
              <div className="sk" style={{ width: 64, height: 14, flexShrink: 0 }} />
              <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: "var(--space-2)", justifyContent: "center" }}>
                <div className="sk" style={{ width: "60%", height: 14 }} />
                <div className="sk" style={{ width: "40%", height: 12 }} />
              </div>
            </div>
          ))}
        </div>
      ) : loadFailed ? (
        <div className="card agenda">
          <LoadFailed noun="jobs" onRetry={() => void refetch()} retrying={isRefetching} />
        </div>
      ) : (
        <div className="card agenda">
          {items.length > 0 ? (
            items.map((job) => (
              <JobCard
                key={job.id}
                job={job}
                onOpen={handleOpen}
                onStart={handleStart}
                onComplete={handleComplete}
                isPending={isPending}
              />
            ))
          ) : (
            <div className="empty-att">No jobs assigned to you today.</div>
          )}
        </div>
      )}
    </>
  );
}
