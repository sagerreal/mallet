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
 * Time clock card: kept as local/deferred state (clock → timesheets not yet wired).
 */

import { useState } from "react";
import { api } from "@/lib/trpc/client";
import type { RouterOutputs } from "@/lib/trpc/client";
import { useOpenModal } from "@/lib/store/app-store";
import { MODAL } from "@/lib/store/modal-ids";

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
    completed: { l: "Done", c: "var(--ink-3)", bg: "var(--paper)" },
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
    <div
      className="md-stop"
      role="button"
      tabIndex={0}
      style={{ cursor: "pointer" }}
      onClick={() => onOpen(job.id)}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onOpen(job.id);
        }
      }}
    >
      <div className="md-time">{timeLabel(job.scheduledStart)}</div>
      <div className="md-body">
        <div className="md-line1">
          <b>{job.title ?? `Job #${job.num}`}</b>
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
// Clock card (local/deferred — not wired to timesheets yet)
// ============================================================================

const TS_KINDS: Record<string, string> = {
  travel: "Travel",
  break: "Break",
  shop: "Shop",
};

interface ClockCardProps {
  clockState: "idle" | "travel" | "break" | "shop";
  onClockStart: (kind: "travel" | "break" | "shop") => void;
  onClockStop: () => void;
}

function ClockCard({ clockState, onClockStart, onClockStop }: ClockCardProps) {
  return (
    <div className="card clockcard" style={{ marginBottom: 12 }}>
      <div className="clock-head">
        <div className="clock-meta">
          <b style={{ fontWeight: 700 }}>Time clock</b>
          <div className="muted" style={{ fontSize: 12, marginTop: 2 }}>
            {clockState !== "idle" ? (
              <span style={{ color: "var(--green-700)", fontWeight: 600 }}>
                {`● ${TS_KINDS[clockState] ?? clockState} running`}
              </span>
            ) : (
              "Not clocked in"
            )}
          </div>
        </div>
        <div className="clock-acts">
          {clockState !== "idle" ? (
            <button className="btn primary" onClick={onClockStop}>
              {`Stop ${(TS_KINDS[clockState] ?? clockState).toLowerCase()}`}
            </button>
          ) : (
            <>
              <button className="btn sm" onClick={() => onClockStart("travel")}>
                Travel
              </button>
              <button className="btn sm" onClick={() => onClockStart("break")}>
                Break
              </button>
              <button className="btn sm" onClick={() => onClockStart("shop")}>
                Shop
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

// ============================================================================
// Page
// ============================================================================

export default function MyDayPage() {
  const { data, isLoading, refetch } = api.v1.field.myDay.useQuery(undefined, {
    staleTime: 30_000,
  });

  const startMutation = api.v1.field.start.useMutation({
    onSuccess: () => { void refetch(); },
  });
  const completeMutation = api.v1.field.complete.useMutation({
    onSuccess: () => { void refetch(); },
  });

  const [clockState, setClockState] = useState<"idle" | "travel" | "break" | "shop">("idle");
  const openModal = useOpenModal();

  const isPending = startMutation.isPending || completeMutation.isPending;

  function handleOpen(jobId: string): void {
    // The modal reads store.jobs — hydrated from this same myDay query by
    // FieldJobsHydrator in the (field) layout.
    openModal(MODAL.TECH_JOB, { jobId });
  }

  function handleStart(jobId: string): void {
    startMutation.mutate({ jobId });
  }

  function handleComplete(jobId: string): void {
    completeMutation.mutate({ jobId });
  }

  function handleClockStart(kind: "travel" | "break" | "shop"): void {
    // deferred: clock → timesheets time entries
    setClockState(kind);
  }

  function handleClockStop(): void {
    // deferred: clock → timesheets time entries
    setClockState("idle");
  }

  if (isLoading) {
    return (
      <>
        <h1>My day</h1>
        <div className="muted" style={{ marginTop: 16 }}>Loading…</div>
      </>
    );
  }

  const items = data?.items ?? [];

  return (
    <>
      <h1>My day</h1>
      <div className="sub">{"Today's jobs."}</div>

      {/* Clock card */}
      <ClockCard
        clockState={clockState}
        onClockStart={handleClockStart}
        onClockStop={handleClockStop}
      />

      {/* Agenda */}
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
    </>
  );
}
