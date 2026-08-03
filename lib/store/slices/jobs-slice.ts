/**
 * lib/store/slices/jobs-slice.ts
 * Job + visit data and mutations. Immutable updates only.
 *
 * addJob is OPTIMISTIC + PERSIST + RECONCILE (client-authored id):
 *   1. Mint a UUID client-side and prepend optimistically.
 *   2. Fire v1.jobs.create with that same id so the server row id === client id.
 *   3. On success, reconcile (preserve client id; server side may update
 *      derived fields); fold in any optimistic visits already added.
 *   4. On error, remove the optimistic job and dev-log.
 *   Manual jobs with no leadId (leadId === "") are pure local drafts — the DB
 *   requires a non-null lead FK, so the network call is skipped for those.
 *
 * Visit actions (addVisit / placeVisit / updateVisit / removeVisit /
 * setVisitStatus) are OPTIMISTIC + PERSIST + RECONCILE:
 *   1. Apply local change immediately so the UI is instant.
 *   2. Fire the matching v1.visits mutation via trpcVanilla.
 *   3. On success, map the returned full jobDTO via dtoJobToStoreJob and
 *      REPLACE the one job in the store (reconciles server-assigned ids,
 *      computed scheduledEnd, derived status).
 *   4. On error, ROLL BACK to the pre-mutation snapshot and log.
 *
 * Visit actions check job.origin === "db" before firing the network call.
 * addJob now sets origin to JOB_ORIGIN.DB on reconcile so manual jobs with
 * a real lead become DB-tracked and their subsequent visits also persist.
 *
 * RESIZE debounce: updateVisit for duration fires on every mousemove.
 * A module-level timer keyed by visitId collapses the stream to ONE
 * updateVisitDuration mutation per drag (~400 ms trailing).  The local
 * optimistic update still runs every move for smoothness.  The debounced
 * mutation captures the LAST duration value in its closure (never re-reads
 * the store at fire time — a reconcile landing inside the window would make
 * it persist a stale value) and is serialized through the per-visit op chain
 * so it can never race the visit's own createVisit.
 *
 * PENDING-CREATE MERGE GUARD: reconciles and the hydrator's setJobs replace
 * job.visits wholesale from server snapshots. A snapshot read before an
 * in-flight createVisit commits doesn't know the optimistic visit — dropping
 * it made the user (or the schedule board's auto-add) add it again → two
 * rows. Every snapshot merge therefore re-attaches store visits whose create
 * op is still pending and which are absent from the snapshot. Once the op
 * settles the visit arrives from the server (or is rolled back) and the
 * guard no longer applies. addVisit also dedupes: while a job has an
 * unplaced visit with a pending create, it returns THAT visit instead of
 * minting a second one (an explicitly-passed dur is applied to it).
 *
 * PENDING-REMOVAL GUARD (mirror of the above): removeVisit is serialized
 * through the per-visit op chain so the delete can't reach the server before
 * the row exists, and while the removal is unsettled no snapshot merge —
 * including the createVisit reconcile whose DTO still contains the visit —
 * may re-introduce a visit the user deleted.
 *
 * CHAINED-OP EXECUTION GUARD: any op queued behind a createVisit re-checks at
 * EXECUTION time that the visit is still in the store — the create it waited
 * on may have rolled back — and skips both the mutate and (in catch) the
 * snapshot restore when the visit is gone, so a rollback can never resurrect
 * a phantom visit.
 *
 * ADOPTION GUARD: setJobs replaces the job list wholesale. A jobs.list
 * snapshot whose read predates a quoting.accept commit doesn't contain the
 * job the client just adoptJob'd — dropping it re-introduces the "accepted
 * quote's job doesn't appear" bug as an in-then-out flicker. Jobs adopted
 * within the hydrator stale window (HYDRATOR_STALE_MS) are re-attached when
 * absent from an incoming snapshot; the guard hands authority back as soon
 * as a snapshot includes the job, the entry expires, or the job is
 * deleted/archived locally.
 *
 * EVISIT actions in leads-slice are intentionally NOT persisted (they
 * are lead-owned and deferred to a future phase).
 */

import type { StateCreator } from "zustand";
import type { Job, Visit, Addon, VerifyAns, JobLine } from "../types";
import { isVisitPlaced } from "../visit-placement";
import { trpcVanilla } from "@/lib/trpc/vanilla";
import { invalidateLists } from "@/lib/trpc/list-cache";
import { dtoJobToStoreJob, dtoChecklistToStore, hourToHHMM, type JobDTO } from "@/lib/store/dto-mapper";
import { persistVisitStatus, visitWriteName, type VisitWriteSurface } from "@/lib/store/visit-status-write";
import { HYDRATOR_STALE_MS, JOB_ORIGIN } from "@/lib/store/hydrator-config";
import type { RouterOutputs } from "@/lib/trpc/client";
import { reportWriteError } from "../write-error";
import { userMessage } from "@/lib/trpc/error-map";

/** Narrow type for the job summary embedded in the accept response. */
type AcceptJobDTO = NonNullable<RouterOutputs["v1"]["quoting"]["accept"]["job"]>;

// ---------------------------------------------------------------------------
// Module-level debounce timers: keyed by visitId.
// ---------------------------------------------------------------------------
const _durDebounceTimers = new Map<string, ReturnType<typeof setTimeout>>();
const DUR_DEBOUNCE_MS = 400;

// ---------------------------------------------------------------------------
// Per-visit pre-drag rollback snapshots (Fix 3).
// Captured only on the FIRST mousemove of each drag so rollback always
// returns to pre-drag state, not last-move state.
// ---------------------------------------------------------------------------
const _durRollback = new Map<string, Job>();

// ---------------------------------------------------------------------------
// Per-visit operation chain (Fix 2b).
// Ensures create → schedule (and any subsequent ops) on the SAME visit run
// strictly in order while different visits stay concurrent.
// ---------------------------------------------------------------------------
const _visitOpChain = new Map<string, Promise<unknown>>();

// The create-op leg of _visitOpChain: visit ids whose createVisit mutation has
// not settled yet. Powers the pending-create merge guard + addVisit dedupe.
const _pendingVisitCreates = new Set<string>();

// Visit ids the user optimistically removed whose removeVisit outcome has not
// settled. Consulted by every snapshot merge so neither the pending-create
// guard nor an older DTO (e.g. the createVisit reconcile racing the removal)
// re-introduces a visit the user deleted. Cleared when the delete settles, or
// by addVisit's rollback when the visit's own create failed (no row to delete
// — the queued delete then skips its mutate).
const _pendingVisitRemovals = new Set<string>();

/**
 * Refetch every list a job write can move a row in or out of.
 *
 * Jobs and INVOICES together, always. The Money ledger's top half is "finished work nobody has
 * billed", which is a jobs query — so marking a job complete adds a row to Money, and pricing one
 * changes the amount shown there. Invalidating only the jobs lists would leave the ledger stale in
 * exactly the case the ledger exists for.
 */
const invalidateJobLists = (): void => invalidateLists("jobs", "invoices");

// Jobs adopted from a server mutation (adoptJob), keyed to their adoption
// time. setJobs re-attaches store jobs absent from an incoming snapshot while
// their adoption is younger than the hydrator stale window — a list read that
// predates the adopting mutation's commit must not sweep the job out.
const _recentAdoptions = new Map<string, number>();

// Jobs whose checklist was just written through updateJob, keyed to the write
// time. Visit mutations and hydrator snapshots reconcile the WHOLE job from a
// server read that may predate the checklist commit — without this guard a
// late-arriving reconcile transiently wipes a just-attached checklist (or
// resurrects a just-removed one). While an entry is younger than the hydrator
// stale window, merges keep the store job's checklist; updateJob's own
// reconcile (the authoritative answer for that write) bypasses the guard.
// Mirrors _recentAdoptions. Cleared on write failure or entry expiry.
const _recentChecklistWrites = new Map<string, number>();

// Jobs whose lines were just written through setJobLines, keyed to the write
// time. On-site pricing persists lines and then "Mark done" triggers a myDay
// refetch whose jobs.list read may PREDATE the setLines commit — without this
// guard the stale (empty-lines) snapshot overwrites the just-priced job and the
// wrap-up bills $0. While an entry is younger than the hydrator stale window,
// snapshot merges keep the STORE job's lines; setJobLines' own reconcile (the
// authoritative answer for that write) bypasses the guard. Mirrors
// _recentChecklistWrites. Cleared on write failure or entry expiry.
const _recentLineWrites = new Map<string, number>();

function chain(visitId: string, fn: () => Promise<unknown>): void {
  const prev = _visitOpChain.get(visitId) ?? Promise.resolve();
  const next = prev.then(fn).finally(() => {
    // Clean up only if this is still the tail of the chain.
    if (_visitOpChain.get(visitId) === next) _visitOpChain.delete(visitId);
  });
  _visitOpChain.set(visitId, next);
}

let _nextAuxId = 6000; // addons + other field-created ids (mirrors state.nextId)

// ---------------------------------------------------------------------------
// Field-filter helpers for updateJob persist
// ---------------------------------------------------------------------------

// Job fields that have a DB column via v1.jobs.update. Everything else on Job is
// local-only (visits ride their own mutations; lines/addons/verify/photos are
// Phase-5; addr/phone have no job column; status/archived derive server-side).
// The persisted set. addr/phone/completion/invRequested were absent here for want of columns, so
// the office job modal's Service address row and the close-out sheet's "What was done" wrote to
// the store and nowhere else — erased by the next jobs.list refetch.
const JOB_UPDATE_KEYS = new Set<keyof Job>([
  "title", "svc", "notes", "checklist", "addr", "phone", "completion", "invRequested", "kind",
]);

/** Wire shape of a checklist item for v1.jobs.update (no store-only `position` —
 *  order on the wire is the array order). */
interface JobChecklistItemPayload {
  id: string;
  text: string;
  type: "check" | "photo";
  required: boolean;
}

export interface JobUpdatePayload {
  jobId: string;
  title?: string | null;
  svc?: string | null;
  notes?: string | null;
  checklist?: { name: string; items: JobChecklistItemPayload[] } | null;
  addr?: string | null;
  phone?: string | null;
  completion?: string | null;
  invRequested?: boolean;
  kind?: "work" | "estimate";
}

/**
 * Build the v1.jobs.update payload from a Job patch, keeping only DB-backed
 * fields. Returns null when the patch touches only local-only fields (skip the
 * network call). Mirrors buildLeadUpdatePayload in leads-slice.
 *
 * checklist: the key being PRESENT in the patch signals intent — an object
 * attaches/replaces; undefined (the store's "removed" representation) maps to
 * an explicit null so the server detaches it.
 */
export function buildJobUpdatePayload(
  jobId: string,
  patch: Partial<Job>,
): JobUpdatePayload | null {
  const payload: JobUpdatePayload = { jobId };
  let hasPersisted = false;
  for (const key of Object.keys(patch) as (keyof Job)[]) {
    if (!JOB_UPDATE_KEYS.has(key)) continue;
    hasPersisted = true;
    if (key === "title") payload.title = patch.title;
    else if (key === "svc") payload.svc = patch.svc;
    else if (key === "notes") payload.notes = patch.notes;
    else if (key === "addr") payload.addr = patch.addr;
    else if (key === "phone") payload.phone = patch.phone;
    else if (key === "completion") payload.completion = patch.completion;
    else if (key === "invRequested") payload.invRequested = patch.invRequested;
    else if (key === "kind") payload.kind = patch.kind === "estimate" ? "estimate" : "work";
    else if (key === "checklist") {
      payload.checklist = patch.checklist
        ? {
            name: patch.checklist.name,
            items: patch.checklist.items.map(({ id, text, type, required }) => ({
              id,
              text,
              type,
              required,
            })),
          }
        : null;
    }
  }
  return hasPersisted ? payload : null;
}

// ---------------------------------------------------------------------------
// Pure local helpers
// ---------------------------------------------------------------------------

/** Immutably replace one job by id. */
function patchJob(jobs: Job[], id: string, fn: (j: Job) => Job): Job[] {
  return jobs.map((j) => (j.id === id ? fn(j) : j));
}

/**
 * Persistable-line predicate for setJobLines. A server-redacted rate (r === null)
 * cannot be persisted and never originates from a pricing surface; a blank
 * description is likewise dropped. The SAME predicate gates the optimistic set
 * AND the wire payload so the store and DB never diverge (a line the wire drops
 * must not linger in the store behind the _recentLineWrites guard).
 */
function isPersistableLine(l: JobLine): boolean {
  return l.r != null && l.d.trim().length > 0;
}

/** Derive job status from its placed visits. */
function recalcStatus(visits: Visit[]): string {
  const placed = visits.filter(isVisitPlaced);
  if (!placed.length) return "unscheduled";
  if (placed.every((v) => v.status === "done")) return "done";
  return "scheduled";
}

function withVisits(job: Job, visits: Visit[]): Job {
  return { ...job, visits, status: recalcStatus(visits) };
}

/** Set one verify answer immutably. */
function withVerify(job: Job, itemId: string, ans: VerifyAns): Job {
  const prev = job.verify?.ans ?? {};
  return { ...job, verify: { ans: { ...prev, [itemId]: ans } } };
}

// ---------------------------------------------------------------------------
// Slice interface
// ---------------------------------------------------------------------------

export interface JobsSlice {
  jobs: Job[];
  setJobs: (jobs: Job[]) => void;
  /** Upsert a SCOPED read (the dispatch board's window) without dropping the rest. */
  mergeJobs: (jobs: Job[]) => void;
  /**
   * Optimistically inserts the job and fires v1.jobs.create.
   * Returns { job } synchronously (the optimistic record with the client-authored id)
   * and { persisted } — a promise that resolves to the reconciled Job after the
   * server responds (origin flips to "db").  Mirrors addLead's { lead, persisted }.
   *
   * Callers that need to run a subsequent operation that requires the job to be
   * DB-origin (e.g. addVisit, which only persists when origin === "db") MUST
   * await `persisted` first.
   */
  addJob: (draft: Omit<Job, "id">) => { job: Job; persisted: Promise<Job> };
  /**
   * Optimistic apply + persist DB-backed fields. Resolves { ok: true } once the
   * server confirms (or when the patch was local-only), { ok: false } after a
   * rollback — it NEVER rejects, so fire-and-forget callers stay safe while
   * interactive callers can await and surface the failure.
   */
  updateJob: (id: string, patch: Partial<Job>) => Promise<{ ok: boolean }>;
  /**
   * Bulk-replace a job's priced lines and PERSIST them (on-site pricing). Unlike
   * updateJob — whose payload builder drops `lines` (they have no jobs.update
   * column) — this persists via v1.jobs.setLines so the price survives the
   * post-complete refetch. Optimistic set + persist + reconcile from the
   * returned full jobDTO; rolls back on failure. Resolves { ok } — never
   * rejects — so interactive callers can surface a failure.
   */
  setJobLines: (jobId: string, lines: JobLine[]) => Promise<{ ok: boolean }>;
  /**
   * On-glass sign-off from the FIELD surface: the priced lines and the customer's signature, in
   * one assignment-gated call.
   *
   * Separate from setJobLines rather than an optional argument on it, because they are different
   * endpoints for different callers. setJobLines writes v1.jobs.setLines, which is ownerOrOffice —
   * a technician calling it gets FORBIDDEN, which is exactly what used to happen here and was
   * reported to the tech as a connection problem.
   *
   * Resolves { ok, error } and never rejects; `error` carries the server's own sentence so a
   * refusal ("type the customer's name to sign") reaches the tech instead of a generic retry.
   */
  signJobQuote: (
    jobId: string,
    input: {
      lines: { description: string; quantity: number; rateCents: number; costCents: number }[];
      signerName: string;
      signatureSvg?: string;
    },
  ) => Promise<{ ok: boolean; error?: string }>;
  setJobSvc: (id: string, svc: string | null) => void;
  addVisit: (jobId: string, dur?: number) => Visit | null;
  updateVisit: (jobId: string, visitId: string, patch: Partial<Visit>) => void;
  placeVisit: (jobId: string, visitId: string, at: { techId: string; date: string; start: number }) => void;
  /**
   * Move a visit through its steps. `surface` decides which API is written: a technician's taps
   * go to the assignment-gated field endpoints (and move their clock), the office's to v1.visits.
   * Required, not defaulted — a wrong guess here either 403s a technician or silently files hours
   * against the wrong person.
   */
  setVisitStatus: (jobId: string, visitId: string, status: string, surface: VisitWriteSurface) => void;
  /**
   * Write a visit's scope notes from the FIELD surface (v1.field.setVisitNotes — anyRole,
   * assignment-gated). The visit's notes column is what the office pipeline's "quote it ›"
   * card keys on (scopedEstimateVisit), so this write IS the tech→office handoff signal.
   * Resolves { ok, error } and never rejects, so the Scope row can surface a refusal.
   */
  setVisitNotes: (jobId: string, visitId: string, notes: string) => Promise<{ ok: boolean; error?: string }>;
  /**
   * Local-only append of an already-persisted photo path (the field Scope strip uploads via
   * uploadFieldPhoto, which writes the DB row itself — this just keeps the store in step).
   */
  adoptJobPhotoPath: (jobId: string, storagePath: string) => void;
  removeVisit: (jobId: string, visitId: string) => void;
  /**
   * Adopt a job DTO returned by a server mutation (e.g. the job created by quoting.accept).
   * Maps via dtoJobToStoreJob (so Fix 1 status remap applies) then either replaces the
   * existing store entry if a matching id exists, or appends a new one. No network call.
   */
  adoptJob: (dto: AcceptJobDTO) => void;
  archiveJob: (id: string) => void;
  deleteJob: (id: string) => void;
  // Found-work / add-ons
  addAddon: (jobId: string, draft: { d: string; r: number; c?: number }) => Addon | null;
  /**
   * Tech-surface found-work write. Calls v1.field.addAddon (anyRole, assignment-gated,
   * proposed-only, rate-zeroed when !seesPrice). The copilot card uses this action; the
   * existing office FoundWorkSec keeps addAddon unchanged.
   *
   * Returns the optimistic Addon synchronously (null when description is blank).
   */
  addAddonField: (jobId: string, draft: { d: string; r: number }) => Addon | null;
  setAddonStatus: (jobId: string, addonId: number, status: Addon["status"]) => void;
  setAddonInvSkip: (jobId: string, addonId: number) => void;
  // Before-you-leave checklist capture
  checkVerifyItem: (jobId: string, itemId: string) => void;
  overrideVerifyItem: (jobId: string, itemId: string, reason: string) => void;
  uncheckVerifyItem: (jobId: string, itemId: string) => void;
  addJobPhoto: (jobId: string) => void;
}

// ---------------------------------------------------------------------------
// Helpers for optimistic pattern
// ---------------------------------------------------------------------------

/** Return the current snapshot of one job (for rollback). */
function snapshot(jobs: Job[], jobId: string): Job | undefined {
  return jobs.find((j) => j.id === jobId);
}

/**
 * Merge guard: re-attach the prior store job's visits whose createVisit is
 * still in flight and which the incoming server snapshot doesn't know yet
 * (it was read before that create committed). Without this, snapshot merges
 * made the optimistic visit vanish → the user / the board's auto-add added
 * it again → duplicate visits. Only pending-create survivors are kept; once
 * the op settles they come from the server or are rolled back.
 *
 * The inverse also holds: a snapshot must not RE-INTRODUCE a visit whose
 * optimistic removal is unsettled (the createVisit reconcile's DTO still
 * contains it, and a stale hydrator snapshot may too) — those are stripped.
 */
function withPendingCreateVisits(prior: Job, incoming: Job): Job {
  const kept = incoming.visits.filter((v) => !_pendingVisitRemovals.has(v.id));
  const survivors = prior.visits.filter(
    (v) =>
      _pendingVisitCreates.has(v.id) &&
      !_pendingVisitRemovals.has(v.id) &&
      !kept.some((iv) => iv.id === v.id),
  );
  if (kept.length === incoming.visits.length && survivors.length === 0) return incoming;
  return { ...incoming, visits: [...kept, ...survivors] };
}

/**
 * Checklist merge guard: while a checklist write on this job is younger than
 * the hydrator stale window, snapshot/reconcile merges keep the STORE job's
 * checklist — the incoming server read may predate the checklist commit.
 * Expired entries are dropped here (same lazy cleanup as the adoption guard).
 */
function withRecentChecklist(prior: Job, incoming: Job): Job {
  const writtenAt = _recentChecklistWrites.get(incoming.id);
  if (writtenAt === undefined) return incoming;
  if (Date.now() - writtenAt > HYDRATOR_STALE_MS) {
    _recentChecklistWrites.delete(incoming.id);
    return incoming;
  }
  if (incoming.checklist === prior.checklist) return incoming;
  return { ...incoming, checklist: prior.checklist };
}

/**
 * Line merge guard (mirror of withRecentChecklist): while a setJobLines write on
 * this job is younger than the hydrator stale window, snapshot/reconcile merges
 * keep the STORE job's lines — the incoming server read may predate the setLines
 * commit (the post-"Mark done" refetch races it). Expired entries are dropped
 * here (same lazy cleanup as the checklist/adoption guards).
 */
function withRecentLines(prior: Job, incoming: Job): Job {
  const writtenAt = _recentLineWrites.get(incoming.id);
  if (writtenAt === undefined) return incoming;
  if (Date.now() - writtenAt > HYDRATOR_STALE_MS) {
    _recentLineWrites.delete(incoming.id);
    return incoming;
  }
  if (incoming.lines === prior.lines) return incoming;
  return { ...incoming, lines: prior.lines };
}

/** Compose every snapshot-merge guard (pending visits + recent checklist + recent lines). */
function mergeIncomingJob(prior: Job, incoming: Job): Job {
  return withRecentLines(prior, withRecentChecklist(prior, withPendingCreateVisits(prior, incoming)));
}

/** Replace one job with the server-reconciled version (merge-guarded). */
function reconcileJob(jobs: Job[], reconciled: Job): Job[] {
  return jobs.map((j) => (j.id === reconciled.id ? mergeIncomingJob(j, reconciled) : j));
}

/** Restore the snapshot (rollback). */
function restoreJob(jobs: Job[], prior: Job): Job[] {
  return jobs.map((j) => (j.id === prior.id ? prior : j));
}

/**
 * True while the visit is still present on the store job. Chained ops
 * re-check this at EXECUTION time — the createVisit they were queued behind
 * may have rolled back and removed the visit — and again at catch time so a
 * rollback restore can never resurrect a visit that is no longer in the store.
 */
function visitExists(jobs: Job[], jobId: string, visitId: string): boolean {
  return jobs.find((j) => j.id === jobId)?.visits.some((v) => v.id === visitId) ?? false;
}

// ---------------------------------------------------------------------------
// Slice creator
// ---------------------------------------------------------------------------

export const createJobsSlice: StateCreator<JobsSlice, [], [], JobsSlice> = (set, get) => ({
  jobs: [],

  // Hydrator path: wholesale list replace, but a list snapshot read before an
  // in-flight createVisit commits must not drop the optimistic visit (same
  // pending-create guard as the mutation reconciles), and a snapshot read
  // before an adopting mutation (quoting.accept) committed must not sweep out
  // the adopted job (adoption guard).
  setJobs: (jobs) =>
    set((s) => {
      const now = Date.now();
      const incomingIds = new Set(jobs.map((j) => j.id));
      // Adoption-guard bookkeeping: an entry expires after the hydrator stale
      // window, or as soon as a snapshot includes the job (the server list
      // knows it now — snapshots are authoritative again).
      for (const [id, adoptedAt] of _recentAdoptions) {
        if (incomingIds.has(id) || now - adoptedAt > HYDRATOR_STALE_MS) {
          _recentAdoptions.delete(id);
        }
      }
      const adoptedSurvivors = s.jobs.filter(
        (j) => !incomingIds.has(j.id) && _recentAdoptions.has(j.id),
      );
      const merged = jobs.map((incoming) => {
        const prior = s.jobs.find((j) => j.id === incoming.id);
        return prior ? mergeIncomingJob(prior, incoming) : incoming;
      });
      return { jobs: adoptedSurvivors.length ? [...adoptedSurvivors, ...merged] : merged };
    }),

  // ---------------------------------------------------------------------------
  // mergeJobs — add a SCOPED read into the store without removing anything.
  //
  // setJobs replaces the collection, which is right for a hydrator holding the
  // whole book and wrong for a window. The dispatch board fetches the day or
  // week on screen, and a dozen other surfaces read s.jobs; if the board's
  // window replaced the collection, opening the board would empty every one of
  // them. So this upserts and leaves the rest alone.
  //
  // Uses the same mergeIncomingJob as setJobs, so an incoming row never clobbers
  // an optimistic visit or a just-written checklist — the guards are in the
  // merge, not in the caller.
  // ---------------------------------------------------------------------------
  mergeJobs: (incoming) =>
    set((s) => {
      if (incoming.length === 0) return {};
      const byId = new Map(incoming.map((j) => [j.id, j]));
      const updated = s.jobs.map((prior) => {
        const next = byId.get(prior.id);
        if (!next) return prior;
        byId.delete(prior.id);
        return mergeIncomingJob(prior, next);
      });
      // Whatever is left in byId is new to the store; order follows the read.
      return byId.size ? { jobs: [...updated, ...byId.values()] } : { jobs: updated };
    }),

  // ---------------------------------------------------------------------------
  // adoptJob — merge a job DTO received from a server mutation into the store
  // without a network call. Used by the estimates-slice accept path to surface
  // the job that CreateJobFromEstimateUseCase created during quoting.accept.
  //
  // Maps via dtoJobToStoreJob so the Fix 1 status remap (zero active visits +
  // backend "scheduled" → store "unscheduled") applies automatically.
  //
  // Replace by id if the job is already in the store (idempotent re-accept),
  // else prepend — mirrors the reconcileJob / addJob pattern elsewhere.
  // ---------------------------------------------------------------------------
  adoptJob: (dto) => {
    // Cast: AcceptJobDTO (jobSummaryDTO shape) is structurally compatible with the
    // fields dtoJobToStoreJob actually reads; the surplus fields on JobDTO are not
    // accessed by the mapper.
    const mapped = dtoJobToStoreJob(dto as unknown as JobDTO);
    // Adoption guard: protect the job from a stale hydrator snapshot (a
    // jobs.list read that predates the adopting mutation's commit) until the
    // snapshot stream catches up or the stale window passes.
    _recentAdoptions.set(mapped.id, Date.now());
    set((s) => {
      const exists = s.jobs.some((j) => j.id === mapped.id);
      const jobs = exists ? reconcileJob(s.jobs, mapped) : [mapped, ...s.jobs];
      return { jobs };
    });
  },

  // ---------------------------------------------------------------------------
  // addJob — client-authored id (so the returned id is valid for an immediate
  // addVisit) + optimistic insert + persist via v1.jobs.create + reconcile/rollback.
  // A manual job with no leadId (leadId === "") is a pure local draft — the DB
  // requires a lead FK, so we skip the network call and keep it store-only.
  //
  // Returns { job } synchronously (the optimistic record) and { persisted } — a
  // promise that resolves to the reconciled Job (origin "db") after the server
  // responds, or rejects on failure.  Callers that call addVisit right after
  // MUST await persisted first so addVisit sees origin === "db" and persists.
  // ---------------------------------------------------------------------------
  addJob: (draft) => {
    const id = crypto.randomUUID();
    const newJob: Job = { ...draft, id };
    set((s) => ({ jobs: [newJob, ...s.jobs] }));

    // No lead to attach to → cannot persist (jobs.lead_id is NOT NULL, composite FK).
    // Return a persisted promise that resolves immediately to the local-only job.
    if (!newJob.leadId) {
      return { job: newJob, persisted: Promise.resolve(newJob) };
    }

    // Snapshot AFTER the optimistic prepend (includes newJob). Rollback filters
    // newJob out by id rather than restoring wholesale, so a concurrent write to
    // `jobs` between the prepend and a failure is preserved, not clobbered.
    const priorJobs = get().jobs;
    const persisted: Promise<Job> = trpcVanilla.v1.jobs.create
      .mutate({
        id,
        leadId: newJob.leadId,
        title: newJob.title || undefined,
        svc: newJob.svc || undefined,
        // 'estimate' = scoping visit. Used to ride in svc, squatting in the trade-label column.
        kind: newJob.kind === "estimate" ? "estimate" : undefined,
        addr: newJob.addr || undefined,
        phone: newJob.phone || undefined,
        notes: newJob.notes || undefined,
      })
      .then((dto) => {
        // Reconcile: server row id === client id (client-authored), so the board
        // and any queued addVisit calls remain valid. Fold in any optimistic
        // visits already added. Mark origin DB so subsequent visit actions persist.
        const reconciled: Job = {
          ...dtoJobToStoreJob(dto),
          id,
          origin: JOB_ORIGIN.DB,
          visits: get().jobs.find((j) => j.id === id)?.visits ?? newJob.visits,
        };
        set((s) => ({
          jobs: s.jobs.map((j) => (j.id === id ? reconciled : j)),
        }));
        invalidateJobLists();
        return reconciled;
      })
      .catch((err: unknown) => {
        // Roll back: remove the optimistic job.
        set(() => ({ jobs: priorJobs.filter((j) => j.id !== id) }));
        reportWriteError("addJob", err);
        throw err instanceof Error ? err : new Error("addJob failed");
      });

    return { job: newJob, persisted };
  },

  updateJob: (id, patch) => {
    const prior = snapshot(get().jobs, id);
    // 1. Optimistic apply (local-only fields update the store regardless).
    set((s) => ({ jobs: s.jobs.map((j) => (j.id === id ? { ...j, ...patch } : j)) }));
    // 2. Persist only DB-backed fields; skip if the patch is local-only.
    const mutPayload = buildJobUpdatePayload(id, patch);
    if (mutPayload === null) return Promise.resolve({ ok: true });
    // Checklist merge guard: from the optimistic apply on, snapshot merges must
    // not overwrite the checklist with a server read that predates this write.
    const touchesChecklist = "checklist" in patch;
    if (touchesChecklist) _recentChecklistWrites.set(id, Date.now());
    // 3. Return the outcome ({ ok }) — never rejects — so interactive callers
    //    (the job checklist block) can surface a failure instead of losing it.
    return trpcVanilla.v1.jobs.update
      .mutate(mutPayload)
      .then((dto) => {
        // Reconcile server truth for the persisted fields, preserving local-only
        // fields already on the store record (lines/addons/verify/photos/visits).
        // checklist adopts the DTO value outright (undefined when detached) —
        // it is DB-backed now, so the server answer is authoritative.
        if (touchesChecklist) _recentChecklistWrites.set(id, Date.now());
        set((s) => ({
          jobs: s.jobs.map((j) =>
            j.id === id
              ? {
                  ...j,
                  title: dto.title ?? j.title,
                  svc: dto.svc !== undefined ? dto.svc : j.svc,
                  notes: dto.notes ?? j.notes,
                  addr: dto.addr ?? j.addr,
                  phone: dto.phone ?? j.phone,
                  completion: dto.completion ?? j.completion,
                  invRequested: dto.invRequested,
                  kind: dto.kind,
                  checklist: dtoChecklistToStore(dto.checklist),
                }
              : j,
          ),
        }));
        // A status change moves the job between lifecycle bands, and into Money's ready-to-bill.
        invalidateJobLists();
        return { ok: true };
      })
      .catch((err: unknown) => {
        // 4. Roll back the whole job to the pre-patch snapshot.
        if (touchesChecklist) _recentChecklistWrites.delete(id);
        if (prior) set((s) => ({ jobs: restoreJob(s.jobs, prior) }));
        reportWriteError("updateJob", err);
        return { ok: false };
      });
  },

  // ---------------------------------------------------------------------------
  // setJobLines — the MONEY-persistence path for on-site pricing. updateJob's
  // payload builder silently drops `lines` (no jobs.update column), so a price
  // set through it lived only in the volatile store and was erased by the next
  // jobs.list refetch (fired right after "Mark done"). This persists the lines
  // to job_lines via v1.jobs.setLines (one atomic org-tx replace) and reconciles
  // from the returned full jobDTO so the store carries server-assigned line ids.
  //
  // The _recentLineWrites guard (mirroring _recentChecklistWrites) protects the
  // just-written lines during the hydrator stale window so the post-complete
  // refetch cannot erase them before the write's own reconcile lands. Because
  // that guard keeps the STORE lines, the optimistic set applies the SAME
  // isPersistableLine filter as the wire payload — otherwise a line the wire
  // dropped would linger in the store for up to the stale window.
  //
  // Never rejects — returns { ok } — so interactive callers surface the failure.
  // ---------------------------------------------------------------------------
  setJobLines: (jobId, lines) => {
    const prior = snapshot(get().jobs, jobId);
    // Persistable lines only — the SAME predicate feeds the optimistic set and
    // the wire payload so a line the wire drops never lingers in the store
    // behind the _recentLineWrites guard (up to the stale window).
    const persistable = lines.filter(isPersistableLine);
    // 1. Optimistic set (filtered — matches what the DB will hold).
    set((s) => ({ jobs: s.jobs.map((j) => (j.id === jobId ? { ...j, lines: persistable } : j)) }));

    const job = get().jobs.find((j) => j.id === jobId);
    // A pure local draft (never persisted — no lead FK) has no DB row to write
    // lines to; keep them store-only, matching updateJob's local-only short-circuit.
    if (!job || job.origin !== JOB_ORIGIN.DB) return Promise.resolve({ ok: true });

    // Map store lines (dollars) → wire lines (integer cents).
    const wireLines = persistable
      .map((l) => ({
        description: l.d,
        quantity: l.q ?? 1,
        rateCents: Math.round((l.r ?? 0) * 100),
        costCents: l.c != null ? Math.round(l.c * 100) : 0,
      }));

    // Guard the optimistic lines against a stale hydrator snapshot from now on.
    _recentLineWrites.set(jobId, Date.now());

    return trpcVanilla.v1.jobs.setLines
      .mutate({ jobId, lines: wireLines })
      .then((dto) => {
        // Re-stamp so the window is measured from the reconcile, then reconcile
        // the full job (server line ids replace optimistic; merge-guarded).
        _recentLineWrites.set(jobId, Date.now());
        set((s) => ({ jobs: reconcileJob(s.jobs, dtoJobToStoreJob(dto)) }));
        // Pricing changes the Amount column and the ready-to-bill total on Money.
        invalidateJobLists();
        return { ok: true };
      })
      .catch((err: unknown) => {
        _recentLineWrites.delete(jobId);
        if (prior) set((s) => ({ jobs: restoreJob(s.jobs, prior) }));
        reportWriteError("setJobLines", err);
        return { ok: false };
      });
  },

  // ---------------------------------------------------------------------------
  // signJobQuote — the FIELD money+signature path. One call so the price and the
  // signature land in the same transaction; see the interface note for why this is
  // not just setJobLines with an extra argument.
  // ---------------------------------------------------------------------------
  signJobQuote: (jobId, input) => {
    const prior = snapshot(get().jobs, jobId);
    // Optimistic lines in STORE units (dollars) so the job reads correctly the moment the modal
    // closes, mirroring setJobLines.
    const optimistic = input.lines.map((l) => ({ d: l.description, q: l.quantity, r: l.rateCents / 100 }));
    set((s) => ({ jobs: s.jobs.map((j) => (j.id === jobId ? { ...j, lines: optimistic } : j)) }));
    _recentLineWrites.set(jobId, Date.now());

    return trpcVanilla.v1.field.signQuote
      .mutate(input.signatureSvg ? { jobId, ...input } : { jobId, lines: input.lines, signerName: input.signerName })
      .then((dto) => {
        _recentLineWrites.set(jobId, Date.now());
        set((s) => ({ jobs: reconcileJob(s.jobs, dtoJobToStoreJob(dto)) }));
        invalidateJobLists();
        return { ok: true };
      })
      .catch((err: unknown) => {
        _recentLineWrites.delete(jobId);
        if (prior) set((s) => ({ jobs: restoreJob(s.jobs, prior) }));
        reportWriteError("signJobQuote", err);
        // Surface the server's wording. A signature refusal names something the tech can fix on
        // the spot; replacing it with "check your connection" is what sent them home empty.
        return { ok: false, error: userMessage(err) };
      });
  },

  setJobSvc: (id, svc) => get().updateJob(id, { svc }),

  // ---------------------------------------------------------------------------
  // addVisit — optimistic temp id; persist via createVisit; reconcile with
  // server id on success so a subsequent placeVisit references the real id.
  // ---------------------------------------------------------------------------
  addVisit: (jobId, dur) => {
    const job = get().jobs.find((j) => j.id === jobId);
    if (!job) return null;

    // Duplicate guard: while this job already has an UNPLACED visit whose
    // createVisit is still in flight, return that visit instead of minting a
    // second — protects the schedule board's auto-add (and a double-click)
    // when a snapshot merge briefly raced the create. Settled creates are no
    // longer in the set, so adding a real second visit later is not blocked.
    const pendingUnplaced = job.visits.find(
      (v) => !isVisitPlaced(v) && _pendingVisitCreates.has(v.id),
    );
    if (pendingUnplaced) {
      // An explicitly-requested duration must not be silently dropped — apply
      // it to the deduped visit via the normal duration path (debounced +
      // chained behind this visit's own pending create).
      if (dur != null && dur !== pendingUnplaced.dur) {
        get().updateVisit(jobId, pendingUnplaced.id, { dur });
        return { ...pendingUnplaced, dur };
      }
      return pendingUnplaced;
    }

    const initialDur = dur ?? 2;
    // Fix 2a: client-authored id so optimistic id === server row id; no id swap on reconcile.
    const id = crypto.randomUUID();
    const visit: Visit = {
      id,
      date: null,
      techId: null,
      start: null,
      dur: initialDur,
      status: "scheduled",
    };

    // Rollback snapshot BEFORE the optimistic insert, so a failed create
    // removes the optimistic visit instead of restoring a state that has it.
    const prior = snapshot(get().jobs, jobId);

    // 1. Optimistic update (synchronous — schedule-panel reads .id immediately).
    set((s) => ({
      jobs: s.jobs.map((j) => (j.id === jobId ? withVisits(j, [...j.visits, visit]) : j)),
    }));

    // 2. Only persist DB-origin jobs.
    if (job.origin !== JOB_ORIGIN.DB) return visit;

    // Track the in-flight create for the merge guard + addVisit dedupe.
    _pendingVisitCreates.add(id);

    // Fix 2b: route network op through per-visit chain so scheduleVisit always
    // awaits the createVisit that must precede it.
    chain(id, () =>
      trpcVanilla.v1.visits.createVisit
        .mutate({ jobId, visitId: id, durationHours: initialDur })
        .then((dto) => {
          // 3. Reconcile — server row id === client id so board state stays valid.
          set((s) => ({ jobs: reconcileJob(s.jobs, dtoJobToStoreJob(dto)) }));
          invalidateJobLists();
        })
        .catch((err: unknown) => {
          // 4. Roll back. The row never existed, so a removal queued behind this
          // create has nothing to delete — cancel it (the queued op checks the
          // set at execution time and skips its mutate).
          _pendingVisitRemovals.delete(id);
          if (prior) set((s) => ({ jobs: restoreJob(s.jobs, prior) }));
          reportWriteError("addVisit", err);
        })
        .finally(() => {
          _pendingVisitCreates.delete(id);
        }),
    );

    return visit;
  },

  // ---------------------------------------------------------------------------
  // placeVisit — maps to scheduleVisit (requires crew + date + start).
  // ---------------------------------------------------------------------------
  placeVisit: (jobId, visitId, at) => {
    const prior = snapshot(get().jobs, jobId);

    // 1. Optimistic update.
    set((s) => ({
      jobs: s.jobs.map((j) =>
        j.id === jobId
          ? withVisits(j, j.visits.map((v) => (v.id === visitId ? { ...v, ...at } : v)))
          : j
      ),
    }));

    const job = get().jobs.find((j) => j.id === jobId);
    if (!job || job.origin !== JOB_ORIGIN.DB) return;

    // Find the placed visit to read its duration.
    const visit = job.visits.find((v) => v.id === visitId);
    const durationHours = visit?.dur ?? 2;

    // Fix 2b: chain scheduleVisit after any pending createVisit for this visitId.
    chain(visitId, () => {
      // Execution-time re-check: the create this op was queued behind may have
      // rolled back and removed the visit — nothing to schedule.
      if (!visitExists(get().jobs, jobId, visitId)) return Promise.resolve();
      return trpcVanilla.v1.visits.scheduleVisit
        .mutate({
          jobId,
          visitId,
          assigneeUserId: at.techId,
          scheduledDate: at.date,
          scheduledStart: hourToHHMM(at.start),
          durationHours,
        })
        .then((dto) => {
          set((s) => ({ jobs: reconcileJob(s.jobs, dtoJobToStoreJob(dto)) }));
          invalidateJobLists();
        })
        .catch((err: unknown) => {
          // Skip the restore when the visit is gone — the snapshot predates
          // its removal and restoring it would resurrect a phantom.
          if (prior && visitExists(get().jobs, jobId, visitId)) {
            set((s) => ({ jobs: restoreJob(s.jobs, prior) }));
          }
          reportWriteError("placeVisit", err);
        });
    });
  },

  // ---------------------------------------------------------------------------
  // updateVisit — routes to updateVisitDuration (dur only) or patchVisitSchedule
  // (date / techId / start).  Duration uses a trailing debounce so resize drags
  // collapse to one mutation while still updating the UI every frame.
  // ---------------------------------------------------------------------------
  updateVisit: (jobId, visitId, patch) => {
    const prior = snapshot(get().jobs, jobId);

    // 1. Optimistic update.
    set((s) => ({
      jobs: s.jobs.map((j) =>
        j.id === jobId
          ? withVisits(j, j.visits.map((v) => (v.id === visitId ? { ...v, ...patch } : v)))
          : j
      ),
    }));

    const job = get().jobs.find((j) => j.id === jobId);
    if (!job || job.origin !== JOB_ORIGIN.DB) return;

    const isDurOnly = "dur" in patch && !("date" in patch) && !("techId" in patch) && !("start" in patch);

    if (isDurOnly && patch.dur != null) {
      // Capture the typed/dragged value NOW. The timer must NOT re-read the
      // store at fire time — a reconcile landing inside the debounce window
      // would make it persist a stale value instead of what the user set.
      const durationHours = patch.dur;

      // Fix 3: capture the pre-drag rollback snapshot only on the FIRST call of a
      // new drag (no pending debounce timer yet), so rollback always returns to
      // the state before the drag started, not to the last-move state.
      if (!_durDebounceTimers.has(visitId)) {
        _durRollback.set(visitId, prior ?? {} as Job);
      }

      // Debounce: cancel any pending timer for this visit.
      const existing = _durDebounceTimers.get(visitId);
      if (existing !== undefined) clearTimeout(existing);

      const timer = setTimeout(() => {
        _durDebounceTimers.delete(visitId);

        // Fix 4: guard against the visit having been removed during the 400 ms window.
        // The debounce window makes post-navigation firing benign (reconcile carries
        // correct per-job data), but this prevents a mutation against a removed visit.
        const guardJob = get().jobs.find((j) => j.id === jobId);
        if (!guardJob?.visits.some((v) => v.id === visitId)) {
          _durRollback.delete(visitId);
          return;
        }

        const preDragSnapshot = _durRollback.get(visitId);

        // Serialize behind any in-flight createVisit (and other ops) on this
        // visit so the duration write can never race — or beat — the row's
        // own creation.
        chain(visitId, () => {
          // Execution-time re-check (the timer-fire guard above is not enough):
          // the createVisit this op was queued behind may have rolled back and
          // removed the visit — mutating would 404 and the catch's restore
          // would resurrect a visit with no DB row.
          if (!visitExists(get().jobs, jobId, visitId)) {
            _durRollback.delete(visitId);
            return Promise.resolve();
          }
          return trpcVanilla.v1.visits.updateVisitDuration
            .mutate({ jobId, visitId, durationHours })
            .then((dto) => {
              _durRollback.delete(visitId);
              set((s) => ({ jobs: reconcileJob(s.jobs, dtoJobToStoreJob(dto)) }));
              invalidateJobLists();
            })
            .catch((err: unknown) => {
              _durRollback.delete(visitId);
              // Skip the restore when the visit is gone at catch time — the
              // snapshot was captured while it existed and would resurrect it.
              if (preDragSnapshot && visitExists(get().jobs, jobId, visitId)) {
                set((s) => ({ jobs: restoreJob(s.jobs, preDragSnapshot) }));
              }
              reportWriteError("updateVisit", err);
            });
        });
      }, DUR_DEBOUNCE_MS);

      _durDebounceTimers.set(visitId, timer);
    } else {
      // patchVisitSchedule for date / techId / start changes.
      const patchInput: {
        jobId: string;
        visitId: string;
        assigneeUserId?: string | null;
        scheduledDate?: string | null;
        scheduledStart?: string | null;
      } = { jobId, visitId };

      if ("techId" in patch) patchInput.assigneeUserId = patch.techId;
      if ("date" in patch) patchInput.scheduledDate = patch.date;
      if ("start" in patch) {
        patchInput.scheduledStart = patch.start != null ? hourToHHMM(patch.start) : null;
      }

      trpcVanilla.v1.visits.patchVisitSchedule
        .mutate(patchInput)
        .then((dto) => {
          set((s) => ({ jobs: reconcileJob(s.jobs, dtoJobToStoreJob(dto)) }));
          invalidateJobLists();
        })
        .catch((err: unknown) => {
          if (prior) set((s) => ({ jobs: restoreJob(s.jobs, prior) }));
          reportWriteError("updateVisit", err);
        });
    }
  },

  // ---------------------------------------------------------------------------
  // setVisitStatus — optimistic, then persist through whichever API the caller can
  // reach: persistVisitStatus picks the endpoint from `surface` (a tech's taps go to
  // the assignment-gated field API and move their clock; the office's go to v1.visits)
  // and routes "enroute" to the stamp endpoint, since it is not a status at all.
  // ---------------------------------------------------------------------------
  setVisitStatus: (jobId, visitId, status, surface) => {
    const prior = snapshot(get().jobs, jobId);

    // 1. Optimistic update.
    set((s) => ({
      jobs: s.jobs.map((j) =>
        j.id === jobId
          ? withVisits(j, j.visits.map((v) => (v.id === visitId ? { ...v, status } : v)))
          : j
      ),
    }));

    const job = get().jobs.find((j) => j.id === jobId);
    if (!job || job.origin !== JOB_ORIGIN.DB) return;

    // Serialize behind the visit's own createVisit (and any other in-flight op)
    // so the status write can never race the row's creation or deletion.
    chain(visitId, () => {
      // Execution-time re-check: the visit may have been removed (or its
      // create rolled back) while this op waited in the chain.
      if (!visitExists(get().jobs, jobId, visitId)) return Promise.resolve();
      return persistVisitStatus(surface, jobId, visitId, status)
        .then((dto) => {
          set((s) => ({ jobs: reconcileJob(s.jobs, dtoJobToStoreJob(dto)) }));
          invalidateJobLists();
        })
        .catch((err: unknown) => {
          // Skip the restore when the visit is gone at catch time — the
          // snapshot contains it and restoring would resurrect a phantom.
          if (prior && visitExists(get().jobs, jobId, visitId)) {
            set((s) => ({ jobs: restoreJob(s.jobs, prior) }));
          }
          reportWriteError(visitWriteName(status), err);
        });
    });
  },

  // ---------------------------------------------------------------------------
  // setVisitNotes — the field scope write. Optimistic scopeNotes + persist via
  // v1.field.setVisitNotes + reconcile from the returned jobDTO; rollback +
  // { ok: false, error } on refusal so the Scope row shows the server's words.
  // ---------------------------------------------------------------------------
  setVisitNotes: (jobId, visitId, notes) => {
    const prior = snapshot(get().jobs, jobId);
    const trimmed = notes.trim();

    // 1. Optimistic update — empty clears the field (mirrors the server's NULL).
    set((s) => ({
      jobs: s.jobs.map((j) =>
        j.id === jobId
          ? withVisits(
              j,
              j.visits.map((v) =>
                v.id === visitId
                  ? trimmed
                    ? { ...v, scopeNotes: trimmed }
                    : (({ scopeNotes: _dropped, ...rest }) => rest)(v)
                  : v,
              ),
            )
          : j,
      ),
    }));

    const job = get().jobs.find((j) => j.id === jobId);
    if (!job || job.origin !== JOB_ORIGIN.DB) return Promise.resolve({ ok: true });

    return trpcVanilla.v1.field.setVisitNotes
      .mutate({ jobId, visitId, notes: trimmed })
      .then((dto) => {
        set((s) => ({ jobs: reconcileJob(s.jobs, dtoJobToStoreJob(dto)) }));
        invalidateJobLists();
        return { ok: true };
      })
      .catch((err: unknown) => {
        if (prior && visitExists(get().jobs, jobId, visitId)) {
          set((s) => ({ jobs: restoreJob(s.jobs, prior) }));
        }
        reportWriteError("setVisitNotes", err);
        return { ok: false, error: userMessage(err) };
      });
  },

  // ---------------------------------------------------------------------------
  // adoptJobPhotoPath — local-only: the upload path already persisted the photo
  // row (uploadFieldPhoto → v1.field.addPhoto); this keeps the store's photos
  // strip in step without a refetch. Snapshot merges preserve store photos.
  // ---------------------------------------------------------------------------
  adoptJobPhotoPath: (jobId, storagePath) => {
    set((s) => ({
      jobs: patchJob(s.jobs, jobId, (j) =>
        j.photos.includes(storagePath) ? j : { ...j, photos: [...j.photos, storagePath] },
      ),
    }));
  },

  // ---------------------------------------------------------------------------
  // removeVisit — persist via removeVisit mutation, serialized through the
  // per-visit op chain so the delete can never reach the server before the
  // row's own createVisit commits. While the removal is unsettled the visit id
  // sits in _pendingVisitRemovals so no snapshot merge (including the create's
  // own reconcile, whose DTO still contains the visit) re-introduces it.
  // ---------------------------------------------------------------------------
  removeVisit: (jobId, visitId) => {
    const prior = snapshot(get().jobs, jobId);

    // 1. Optimistic update.
    set((s) => ({
      jobs: s.jobs.map((j) =>
        j.id === jobId ? withVisits(j, j.visits.filter((v) => v.id !== visitId)) : j
      ),
    }));

    const job = get().jobs.find((j) => j.id === jobId);
    if (!job || job.origin !== JOB_ORIGIN.DB) return;

    // Track the unsettled removal so no snapshot merge resurrects the visit.
    _pendingVisitRemovals.add(visitId);

    chain(visitId, () => {
      // If the create this removal was queued behind rolled back, addVisit's
      // catch cancelled the removal — the visit never had a DB row, so there
      // is nothing to delete (and the store no longer shows it).
      if (!_pendingVisitRemovals.has(visitId)) return Promise.resolve();
      return trpcVanilla.v1.visits.removeVisit
        .mutate({ jobId, visitId })
        .then((dto) => {
          _pendingVisitRemovals.delete(visitId);
          set((s) => ({ jobs: reconcileJob(s.jobs, dtoJobToStoreJob(dto)) }));
          invalidateJobLists();
        })
        .catch((err: unknown) => {
          _pendingVisitRemovals.delete(visitId);
          if (prior) set((s) => ({ jobs: restoreJob(s.jobs, prior) }));
          reportWriteError("removeVisit", err);
        });
    });
  },

  // ---------------------------------------------------------------------------
  // Archive / delete (soft-delete only — no hard deletes)
  // ---------------------------------------------------------------------------

  // Soft-delete server-side; mark archived locally so it drops off the active list.
  archiveJob: (id) => {
    const prior = snapshot(get().jobs, id);
    // A locally archived job must not be protected from hydrator sweeps.
    _recentAdoptions.delete(id);
    set((s) => ({ jobs: s.jobs.map((j) => (j.id === id ? { ...j, archived: true } : j)) }));
    if (prior?.origin !== JOB_ORIGIN.DB) return; // local-only draft — nothing to persist
    trpcVanilla.v1.jobs.archive
      .mutate({ jobId: id })
      .then(() => invalidateJobLists())
      .catch((err: unknown) => {
        if (prior) set((s) => ({ jobs: restoreJob(s.jobs, prior) }));
        reportWriteError("archiveJob", err);
      });
  },

  // deleteJob repoints to soft-delete (no hard deletes). Removes from the visible
  // list optimistically; re-inserts on failure.
  deleteJob: (id) => {
    const prior = snapshot(get().jobs, id);
    // The adoption guard must not resurrect a job the user just deleted.
    _recentAdoptions.delete(id);
    set((s) => ({ jobs: s.jobs.filter((j) => j.id !== id) }));
    if (prior?.origin !== JOB_ORIGIN.DB) return;
    trpcVanilla.v1.jobs.archive
      .mutate({ jobId: id })
      .then(() => invalidateJobLists())
      .catch((err: unknown) => {
        // Rollback: re-insert the removed job at the front (order is not load-bearing here).
        if (prior) set((s) => ({ jobs: [prior, ...s.jobs] }));
        reportWriteError("deleteJob", err);
      });
  },

  addAddon: (jobId, draft) => {
    const d = draft.d.trim();
    if (!d) return null;
    const addon: Addon = {
      id: ++_nextAuxId,
      d,
      q: 1,
      r: Math.max(0, draft.r || 0),
      ...(draft.c != null ? { c: Math.max(0, draft.c) } : {}),
      status: "proposed",
      when: "Just now",
    };
    const prior = snapshot(get().jobs, jobId);
    set((s) => ({
      jobs: patchJob(s.jobs, jobId, (j) => ({ ...j, addons: [...j.addons, addon] })),
    }));

    const job = get().jobs.find((j) => j.id === jobId);
    if (!job || job.origin !== JOB_ORIGIN.DB) return addon;

    trpcVanilla.v1.jobs.addAddon
      .mutate({
        jobId,
        description: d,
        quantity: 1,
        rateCents: Math.round((draft.r || 0) * 100),
        costCents: draft.c != null ? Math.round(draft.c * 100) : 0,
      })
      .then((dto) => set((s) => ({ jobs: reconcileJob(s.jobs, dtoJobToStoreJob(dto)) })))
      .catch((err: unknown) => {
        if (prior) set((s) => ({ jobs: restoreJob(s.jobs, prior) }));
        reportWriteError("addAddon", err);
      });

    return addon;
  },

  // ---------------------------------------------------------------------------
  // addAddonField — tech-surface found-work write via v1.field.addAddon.
  // Same optimistic pattern as addAddon but routes to the field endpoint which:
  //   • enforces assignment + non-terminal gates server-side
  //   • forces status:"proposed" (never accepted from the field)
  //   • zeroes rateCents when the org's techSeesPrice is off
  // The copilot card calls this; office FoundWorkSec continues to use addAddon.
  // ---------------------------------------------------------------------------
  addAddonField: (jobId, draft) => {
    const d = draft.d.trim();
    if (!d) return null;
    const addon: Addon = {
      id: ++_nextAuxId,
      d,
      q: 1,
      r: Math.max(0, draft.r || 0),
      status: "proposed",
      when: "Just now",
    };
    const prior = snapshot(get().jobs, jobId);
    set((s) => ({
      jobs: patchJob(s.jobs, jobId, (j) => ({ ...j, addons: [...j.addons, addon] })),
    }));

    const job = get().jobs.find((j) => j.id === jobId);
    if (!job || job.origin !== JOB_ORIGIN.DB) return addon;

    trpcVanilla.v1.field.addAddon
      .mutate({
        jobId,
        description: d,
        rateCents: Math.round((draft.r || 0) * 100),
      })
      .then((dto) => set((s) => ({ jobs: reconcileJob(s.jobs, dtoJobToStoreJob(dto)) })))
      .catch((err: unknown) => {
        if (prior) set((s) => ({ jobs: restoreJob(s.jobs, prior) }));
        reportWriteError("addAddonField", err);
      });

    return addon;
  },

  setAddonStatus: (jobId, addonId, status) => {
    const prior = snapshot(get().jobs, jobId);
    set((s) => ({
      jobs: patchJob(s.jobs, jobId, (j) => ({
        ...j,
        addons: j.addons.map((a) => (a.id === addonId ? { ...a, status } : a)),
      })),
    }));

    const job = get().jobs.find((j) => j.id === jobId);
    if (!job || job.origin !== JOB_ORIGIN.DB) return;

    const target = job.addons.find((a) => a.id === addonId);
    // Locally-added addon not yet reconciled (no dbId) → skip network, optimistic-only.
    if (!target?.dbId) return;

    trpcVanilla.v1.jobs.setAddonStatus
      .mutate({ jobId, addonId: target.dbId, status })
      .then((dto) => set((s) => ({ jobs: reconcileJob(s.jobs, dtoJobToStoreJob(dto)) })))
      .catch((err: unknown) => {
        if (prior) set((s) => ({ jobs: restoreJob(s.jobs, prior) }));
        reportWriteError("setAddonStatus", err);
      });
  },

  setAddonInvSkip: (jobId, addonId) => {
    const prior = snapshot(get().jobs, jobId);
    set((s) => ({
      jobs: patchJob(s.jobs, jobId, (j) => ({
        ...j,
        addons: j.addons.map((a) => (a.id === addonId ? { ...a, invSkip: true } : a)),
      })),
    }));

    const job = get().jobs.find((j) => j.id === jobId);
    if (!job || job.origin !== JOB_ORIGIN.DB) return;

    const target = job.addons.find((a) => a.id === addonId);
    // Locally-added addon not yet reconciled (no dbId) → skip network, optimistic-only.
    if (!target?.dbId) return;

    trpcVanilla.v1.jobs.setAddonInvSkip
      .mutate({ jobId, addonId: target.dbId, invoiceSkip: true })
      .then((dto) => set((s) => ({ jobs: reconcileJob(s.jobs, dtoJobToStoreJob(dto)) })))
      .catch((err: unknown) => {
        if (prior) set((s) => ({ jobs: restoreJob(s.jobs, prior) }));
        reportWriteError("setAddonInvSkip", err);
      });
  },

  checkVerifyItem: (jobId, itemId) => {
    const prior = snapshot(get().jobs, jobId);
    set((s) => ({
      jobs: patchJob(s.jobs, jobId, (j) => withVerify(j, itemId, { st: "pass", via: "manual" })),
    }));

    const job = get().jobs.find((j) => j.id === jobId);
    if (!job || job.origin !== JOB_ORIGIN.DB) return;

    // v1.field.setVerifyAnswer is anyRole (owner/office/tech) with a server-side
    // assignment gate for techs — the office path behaves exactly like the old
    // v1.jobs.setVerifyAnswer call; the tech path now actually persists.
    trpcVanilla.v1.field.setVerifyAnswer
      .mutate({ jobId, itemId, state: "pass", via: "manual" })
      .then((dto) => set((s) => ({ jobs: reconcileJob(s.jobs, dtoJobToStoreJob(dto)) })))
      .catch((err: unknown) => {
        if (prior) set((s) => ({ jobs: restoreJob(s.jobs, prior) }));
        reportWriteError("checkVerifyItem", err);
      });
  },

  overrideVerifyItem: (jobId, itemId, reason) => {
    const prior = snapshot(get().jobs, jobId);
    set((s) => ({
      jobs: patchJob(s.jobs, jobId, (j) => withVerify(j, itemId, { st: "override", reason })),
    }));

    const job = get().jobs.find((j) => j.id === jobId);
    if (!job || job.origin !== JOB_ORIGIN.DB) return;

    trpcVanilla.v1.field.setVerifyAnswer
      .mutate({ jobId, itemId, state: "override", reason })
      .then((dto) => set((s) => ({ jobs: reconcileJob(s.jobs, dtoJobToStoreJob(dto)) })))
      .catch((err: unknown) => {
        if (prior) set((s) => ({ jobs: restoreJob(s.jobs, prior) }));
        reportWriteError("overrideVerifyItem", err);
      });
  },

  uncheckVerifyItem: (jobId, itemId) => {
    const prior = snapshot(get().jobs, jobId);
    set((s) => ({
      jobs: patchJob(s.jobs, jobId, (j) => {
        const { [itemId]: _removed, ...rest } = j.verify?.ans ?? {};
        return { ...j, verify: { ans: rest } };
      }),
    }));

    const job = get().jobs.find((j) => j.id === jobId);
    if (!job || job.origin !== JOB_ORIGIN.DB) return;

    trpcVanilla.v1.field.setVerifyAnswer
      .mutate({ jobId, itemId, state: "clear" })
      .then((dto) => set((s) => ({ jobs: reconcileJob(s.jobs, dtoJobToStoreJob(dto)) })))
      .catch((err: unknown) => {
        if (prior) set((s) => ({ jobs: restoreJob(s.jobs, prior) }));
        reportWriteError("uncheckVerifyItem", err);
      });
  },

  // Push a field photo and auto-pass the next unanswered photo checklist item.
  // The PHOTO stays store-only for now (the prototype demo path — no file param;
  // real uploads use uploadJobPhoto from lib/store/upload-job-photo.ts), but the
  // CHECK-OFF persists through the same v1.field.setVerifyAnswer path as
  // checkVerifyItem (state=pass, via=photo) so it survives a refresh for every role.
  addJobPhoto: (jobId) => {
    const current = snapshot(get().jobs, jobId);
    if (!current) return;
    const items = current.checklist?.items ?? [];
    const ans = current.verify?.ans ?? {};
    const nextPhoto = items.find((it) => it.type === "photo" && !ans[it.id]);

    // 1. Optimistic apply: photo + (when a photo item is open) its pass answer.
    set((s) => ({
      jobs: patchJob(s.jobs, jobId, (j) => {
        const photos = [...j.photos, ""];
        if (!nextPhoto) return { ...j, photos };
        return {
          ...j,
          photos,
          verify: { ans: { ...(j.verify?.ans ?? {}), [nextPhoto.id]: { st: "pass", via: "photo" } } },
        };
      }),
    }));

    // 2. Persist the answer (nothing to persist when no photo item was open).
    if (!nextPhoto || current.origin !== JOB_ORIGIN.DB) return;
    trpcVanilla.v1.field.setVerifyAnswer
      .mutate({ jobId, itemId: nextPhoto.id, state: "pass", via: "photo" })
      .then((dto) =>
        set((s) => ({
          jobs: s.jobs.map((j) =>
            // Keep the store-only photos across the reconcile — the server DTO
            // can't know them (the file itself is not persisted on this path).
            j.id === jobId ? { ...mergeIncomingJob(j, dtoJobToStoreJob(dto)), photos: j.photos } : j,
          ),
        })),
      )
      .catch((err: unknown) => {
        set((s) => ({ jobs: restoreJob(s.jobs, current) }));
        reportWriteError("addJobPhoto", err);
      });
  },
});
