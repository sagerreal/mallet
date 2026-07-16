// PURE callback-detection logic — NO I/O, NO Date.now()/argless new Date(), NO infra imports.
// Deterministic: all inputs are passed in. This is the pure-logic heart of AI Foreman Phase 1B;
// the reader (1B.3) projects DB rows into JobLite and feeds this function.
//
// The detection rule (Owen's decision, from the approved spec):
//   Mallet is strictly one-off jobs (no recurring), so a repeat at the same site for the same
//   service within a short window is a CLEAN callback signal. A job is a candidate callback of
//   the MOST RECENTLY COMPLETED earlier job that shares the same customer (leadId) and the same
//   service (svc, case-insensitive + trimmed; both-null never matches), was completed within
//   `windowDays` days BEFORE this job's reference time, is not the job itself, and this job is
//   not already flagged (callbackOf already set → skip; it's confirmed/handled).
//   Canceled or non-complete originals are excluded. Ties → most-recently-completed wins.
import type { JobId } from "@mallet/shared/types";

// ── Contract (1B.3 depends on these exact names) ─────────────────────────────

// The minimal job shape the detector needs. The reader (1B.3) projects full DB rows to this so
// this file stays pure and decoupled from the DB/ORM layer.
export interface JobLite {
  readonly id: JobId;
  readonly leadId: string;              // customer = "same site" key (address isn't on the job)
  readonly svc: string | null;          // service; case-insensitive+trim match; null never matches
  readonly status: string;              // "scheduled" | "in_progress" | "complete" | "canceled"
  readonly completedAt: Date | null;    // when the original was completed (originals must have this)
  readonly scheduledStart: Date | null; // this job's reference time; may be null → fall back to createdAt
  readonly createdAt: Date;             // fallback reference time when scheduledStart is absent
  readonly callbackOf: JobId | null;    // already-flagged jobs are skipped (confirmed/handled)
}

// The detection output. One candidate per job that has an eligible original.
export interface CallbackCandidate {
  readonly jobId: JobId;          // the later job that looks like a callback
  readonly originalJobId: JobId;  // the earlier completed job it repeats
}

// Default detection window. A repeat at the same site for the same service within 45 days of a
// completed job is a strong signal — the original work may not have held.
export const CALLBACK_WINDOW_DAYS = 45;

// ── refTimeOf ────────────────────────────────────────────────────────────────

/**
 * The reference time a candidate job is "compared from": scheduledStart when set, else createdAt.
 * A callback is booked/scheduled AFTER the original completed; we want the best available
 * timestamp for the moment this new job entered the system as a future event.
 * Exported so tests can assert the fallback rule in isolation.
 */
export function refTimeOf(job: Pick<JobLite, "scheduledStart" | "createdAt">): Date {
  return job.scheduledStart ?? job.createdAt;
}

// ── detectCallbacks ──────────────────────────────────────────────────────────

/**
 * Given a shop's full job list, return one CallbackCandidate per job that repeats a completed
 * earlier job by the same customer for the same service within `windowDays` (default 45).
 *
 * Jobs already flagged (callbackOf set) are silently skipped — they're confirmed/handled.
 * Pure: never mutates `jobs`; never reads the clock; returns a new array every call.
 */
export function detectCallbacks(
  jobs: readonly JobLite[],
  windowDays: number = CALLBACK_WINDOW_DAYS,
): CallbackCandidate[] {
  const candidates: CallbackCandidate[] = [];

  for (const job of jobs) {
    // Already confirmed/handled → skip; don't re-emit it.
    if (job.callbackOf !== null) continue;

    const best = findBestOriginal(job, jobs, windowDays);
    if (best !== null) {
      candidates.push({ jobId: job.id, originalJobId: best.id });
    }
  }

  return candidates;
}

// ── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Find the most-recently-completed eligible original for `job`, or null when none exists.
 * An eligible original must be: a different job, same customer (leadId), same service (svc,
 * case-insensitive+trim; null never matches), status==="complete" with a completedAt timestamp,
 * and that completedAt is strictly before the job's refTime and within the window.
 */
function findBestOriginal(
  job: JobLite,
  allJobs: readonly JobLite[],
  windowDays: number,
): JobLite | null {
  const refTime = refTimeOf(job);
  let best: JobLite | null = null;

  for (const candidate of allJobs) {
    // Never link a job to itself.
    if (candidate.id === job.id) continue;
    // Only status==="complete" with a real completedAt qualifies as an original.
    if (!isCompleteWithTimestamp(candidate)) continue;
    // Same customer required.
    if (candidate.leadId !== job.leadId) continue;
    // Same service required — null never matches.
    if (!sameService(candidate.svc, job.svc)) continue;
    // The original must have completed strictly before the job's refTime and within the window.
    if (!withinWindow(candidate.completedAt!, refTime, windowDays)) continue;

    // Among eligible originals, pick the most recently completed (latest completedAt wins).
    if (best === null || candidate.completedAt!.getTime() > best.completedAt!.getTime()) {
      best = candidate;
    }
  }

  return best;
}

/** A job qualifies as a callback *original* only when it is complete AND has a completedAt date. */
function isCompleteWithTimestamp(job: JobLite): job is JobLite & { completedAt: Date } {
  return job.status === "complete" && job.completedAt !== null;
}

/**
 * Two service values match when BOTH are non-null and their trimmed, lower-cased strings are
 * equal. Both-null is explicitly NOT a match — we refuse to link two service-less jobs.
 */
function sameService(a: string | null, b: string | null): boolean {
  if (a === null || b === null) return false;
  return a.trim().toLowerCase() === b.trim().toLowerCase();
}

/**
 * The original's completedAt must be strictly before the candidate job's refTime AND within
 * `windowDays` of it. The window boundary is inclusive: exactly `windowDays` days before counts.
 *
 * "strictly before" ensures the original was finished before the new job was even booked, which
 * prevents a job marking itself (or a concurrent job) as the other's callback.
 */
function withinWindow(completedAt: Date, refTime: Date, windowDays: number): boolean {
  const windowMs = windowDays * 24 * 60 * 60 * 1000;
  const gapMs = refTime.getTime() - completedAt.getTime();
  // gapMs > 0 → completedAt is strictly before refTime
  // gapMs <= windowMs → within the window (inclusive boundary)
  return gapMs > 0 && gapMs <= windowMs;
}
