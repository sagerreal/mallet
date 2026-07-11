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
 * optimistic update still runs every move for smoothness.
 *
 * EVISIT actions in leads-slice are intentionally NOT persisted (they
 * are lead-owned and deferred to a future phase).
 */

import type { StateCreator } from "zustand";
import type { Job, Visit, Addon, VerifyAns } from "../types";
import { trpcVanilla } from "@/lib/trpc/vanilla";
import { dtoJobToStoreJob, hourToHHMM, storeStatusToBackend } from "@/lib/store/dto-mapper";
import { JOB_ORIGIN } from "@/lib/store/hydrator-config";

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
const JOB_UPDATE_KEYS = new Set<keyof Job>(["title", "svc", "notes"]);

export interface JobUpdatePayload {
  jobId: string;
  title?: string | null;
  svc?: string | null;
  notes?: string | null;
}

/**
 * Build the v1.jobs.update payload from a Job patch, keeping only DB-backed
 * fields. Returns null when the patch touches only local-only fields (skip the
 * network call). Mirrors buildLeadUpdatePayload in leads-slice.
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

/** True once a visit has crew + day + start. */
function isPlaced(v: Visit): boolean {
  return !!(v.date && v.techId != null && v.start != null);
}

/** Derive job status from its placed visits. */
function recalcStatus(visits: Visit[]): string {
  const placed = visits.filter(isPlaced);
  if (!placed.length) return "unscheduled";
  if (placed.every((v) => v.status === "done")) return "done";
  return "scheduled";
}

function withVisits(job: Job, visits: Visit[]): Job {
  return { ...job, visits, status: recalcStatus(visits) };
}

/** Set one verify answer immutably. */
function withVerify(job: Job, itemId: number, ans: VerifyAns): Job {
  const prev = job.verify?.ans ?? {};
  return { ...job, verify: { ans: { ...prev, [itemId]: ans } } };
}

// ---------------------------------------------------------------------------
// Slice interface
// ---------------------------------------------------------------------------

export interface JobsSlice {
  jobs: Job[];
  setJobs: (jobs: Job[]) => void;
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
  updateJob: (id: string, patch: Partial<Job>) => void;
  setJobSvc: (id: string, svc: string | null) => void;
  addVisit: (jobId: string, dur?: number) => Visit | null;
  updateVisit: (jobId: string, visitId: string, patch: Partial<Visit>) => void;
  placeVisit: (jobId: string, visitId: string, at: { techId: string; date: string; start: number }) => void;
  setVisitStatus: (jobId: string, visitId: string, status: string) => void;
  removeVisit: (jobId: string, visitId: string) => void;
  archiveJob: (id: string) => void;
  deleteJob: (id: string) => void;
  // Found-work / add-ons
  addAddon: (jobId: string, draft: { d: string; r: number; c?: number }) => Addon | null;
  setAddonStatus: (jobId: string, addonId: number, status: Addon["status"]) => void;
  setAddonInvSkip: (jobId: string, addonId: number) => void;
  // Before-you-leave checklist capture
  checkVerifyItem: (jobId: string, itemId: number) => void;
  overrideVerifyItem: (jobId: string, itemId: number, reason: string) => void;
  uncheckVerifyItem: (jobId: string, itemId: number) => void;
  addJobPhoto: (jobId: string) => void;
}

// ---------------------------------------------------------------------------
// Helpers for optimistic pattern
// ---------------------------------------------------------------------------

/** Return the current snapshot of one job (for rollback). */
function snapshot(jobs: Job[], jobId: string): Job | undefined {
  return jobs.find((j) => j.id === jobId);
}

/** Replace one job with the server-reconciled version. */
function reconcileJob(jobs: Job[], reconciled: Job): Job[] {
  return jobs.map((j) => (j.id === reconciled.id ? reconciled : j));
}

/** Restore the snapshot (rollback). */
function restoreJob(jobs: Job[], prior: Job): Job[] {
  return jobs.map((j) => (j.id === prior.id ? prior : j));
}

// ---------------------------------------------------------------------------
// Slice creator
// ---------------------------------------------------------------------------

export const createJobsSlice: StateCreator<JobsSlice, [], [], JobsSlice> = (set, get) => ({
  jobs: [],

  setJobs: (jobs) => set({ jobs }),

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
        return reconciled;
      })
      .catch((err: unknown) => {
        // Roll back: remove the optimistic job.
        set(() => ({ jobs: priorJobs.filter((j) => j.id !== id) }));
        if (process.env.NODE_ENV !== "production") {
          // eslint-disable-next-line no-console
          console.error("[jobs-slice] addJob failed — rolled back", { id, err });
        }
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
    if (mutPayload === null) return;
    trpcVanilla.v1.jobs.update
      .mutate(mutPayload)
      .then((dto) => {
        // 3. Reconcile server truth for the persisted scalars, preserving local-only
        //    fields already on the store record (lines/addons/verify/photos/visits).
        set((s) => ({
          jobs: s.jobs.map((j) =>
            j.id === id
              ? { ...j, title: dto.title ?? j.title, svc: dto.svc !== undefined ? dto.svc : j.svc, notes: dto.notes ?? j.notes }
              : j,
          ),
        }));
      })
      .catch((err: unknown) => {
        // 4. Roll back the whole job to the pre-patch snapshot.
        if (prior) set((s) => ({ jobs: restoreJob(s.jobs, prior) }));
        if (process.env.NODE_ENV !== "production") {
          // eslint-disable-next-line no-console
          console.error("[jobs-slice] updateJob failed — rolled back", { id, patch, err });
        }
      });
  },

  setJobSvc: (id, svc) => get().updateJob(id, { svc }),

  // ---------------------------------------------------------------------------
  // addVisit — optimistic temp id; persist via createVisit; reconcile with
  // server id on success so a subsequent placeVisit references the real id.
  // ---------------------------------------------------------------------------
  addVisit: (jobId, dur = 2) => {
    const job = get().jobs.find((j) => j.id === jobId);
    if (!job) return null;

    // Fix 2a: client-authored id so optimistic id === server row id; no id swap on reconcile.
    const id = crypto.randomUUID();
    const visit: Visit = {
      id,
      date: null,
      techId: null,
      start: null,
      dur,
      status: "scheduled",
    };

    // 1. Optimistic update (synchronous — schedule-panel reads .id immediately).
    set((s) => ({
      jobs: s.jobs.map((j) => (j.id === jobId ? withVisits(j, [...j.visits, visit]) : j)),
    }));

    // 2. Only persist DB-origin jobs.
    if (job.origin !== JOB_ORIGIN.DB) return visit;

    const prior = snapshot(get().jobs, jobId);

    // Fix 2b: route network op through per-visit chain so scheduleVisit always
    // awaits the createVisit that must precede it.
    chain(id, () =>
      trpcVanilla.v1.visits.createVisit
        .mutate({ jobId, visitId: id, durationHours: dur })
        .then((dto) => {
          // 3. Reconcile — server row id === client id so board state stays valid.
          set((s) => ({ jobs: reconcileJob(s.jobs, dtoJobToStoreJob(dto)) }));
        })
        .catch((err: unknown) => {
          // 4. Roll back.
          if (prior) set((s) => ({ jobs: restoreJob(s.jobs, prior) }));
          if (process.env.NODE_ENV !== "production") {
            console.error("[jobs-slice] addVisit failed — rolled back", { jobId, err });
          }
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
    chain(visitId, () =>
      trpcVanilla.v1.visits.scheduleVisit
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
        })
        .catch((err: unknown) => {
          if (prior) set((s) => ({ jobs: restoreJob(s.jobs, prior) }));
          if (process.env.NODE_ENV !== "production") {
            console.error("[jobs-slice] placeVisit failed — rolled back", { jobId, visitId, err });
          }
        }),
    );
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

        const currentVisit = guardJob.visits.find((v) => v.id === visitId);
        const durationHours = currentVisit?.dur ?? patch.dur!;

        const preDragSnapshot = _durRollback.get(visitId);

        trpcVanilla.v1.visits.updateVisitDuration
          .mutate({ jobId, visitId, durationHours })
          .then((dto) => {
            _durRollback.delete(visitId);
            set((s) => ({ jobs: reconcileJob(s.jobs, dtoJobToStoreJob(dto)) }));
          })
          .catch((err: unknown) => {
            _durRollback.delete(visitId);
            if (preDragSnapshot) set((s) => ({ jobs: restoreJob(s.jobs, preDragSnapshot) }));
            if (process.env.NODE_ENV !== "production") {
              console.error("[jobs-slice] updateVisit(dur) failed — rolled back", { jobId, visitId, err });
            }
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
        })
        .catch((err: unknown) => {
          if (prior) set((s) => ({ jobs: restoreJob(s.jobs, prior) }));
          if (process.env.NODE_ENV !== "production") {
            console.error("[jobs-slice] updateVisit(patch) failed — rolled back", { jobId, visitId, err });
          }
        });
    }
  },

  // ---------------------------------------------------------------------------
  // setVisitStatus — maps store status words to the backend enum.
  // ---------------------------------------------------------------------------
  setVisitStatus: (jobId, visitId, status) => {
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

    trpcVanilla.v1.visits.setVisitStatus
      .mutate({ jobId, visitId, status: storeStatusToBackend(status) })
      .then((dto) => {
        set((s) => ({ jobs: reconcileJob(s.jobs, dtoJobToStoreJob(dto)) }));
      })
      .catch((err: unknown) => {
        if (prior) set((s) => ({ jobs: restoreJob(s.jobs, prior) }));
        if (process.env.NODE_ENV !== "production") {
          console.error("[jobs-slice] setVisitStatus failed — rolled back", { jobId, visitId, status, err });
        }
      });
  },

  // ---------------------------------------------------------------------------
  // removeVisit — persist via removeVisit mutation.
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

    trpcVanilla.v1.visits.removeVisit
      .mutate({ jobId, visitId })
      .then((dto) => {
        set((s) => ({ jobs: reconcileJob(s.jobs, dtoJobToStoreJob(dto)) }));
      })
      .catch((err: unknown) => {
        if (prior) set((s) => ({ jobs: restoreJob(s.jobs, prior) }));
        if (process.env.NODE_ENV !== "production") {
          console.error("[jobs-slice] removeVisit failed — rolled back", { jobId, visitId, err });
        }
      });
  },

  // ---------------------------------------------------------------------------
  // Archive / delete (soft-delete only — no hard deletes)
  // ---------------------------------------------------------------------------

  // Soft-delete server-side; mark archived locally so it drops off the active list.
  archiveJob: (id) => {
    const prior = snapshot(get().jobs, id);
    set((s) => ({ jobs: s.jobs.map((j) => (j.id === id ? { ...j, archived: true } : j)) }));
    if (prior?.origin !== JOB_ORIGIN.DB) return; // local-only draft — nothing to persist
    trpcVanilla.v1.jobs.archive
      .mutate({ jobId: id })
      .catch((err: unknown) => {
        if (prior) set((s) => ({ jobs: restoreJob(s.jobs, prior) }));
        if (process.env.NODE_ENV !== "production") {
          console.error("[jobs-slice] archiveJob failed — rolled back", { id, err });
        }
      });
  },

  // deleteJob repoints to soft-delete (no hard deletes). Removes from the visible
  // list optimistically; re-inserts on failure.
  deleteJob: (id) => {
    const prior = snapshot(get().jobs, id);
    set((s) => ({ jobs: s.jobs.filter((j) => j.id !== id) }));
    if (prior?.origin !== JOB_ORIGIN.DB) return;
    trpcVanilla.v1.jobs.archive
      .mutate({ jobId: id })
      .catch((err: unknown) => {
        // Rollback: re-insert the removed job at the front (order is not load-bearing here).
        if (prior) set((s) => ({ jobs: [prior, ...s.jobs] }));
        if (process.env.NODE_ENV !== "production") {
          console.error("[jobs-slice] deleteJob failed — rolled back", { id, err });
        }
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
    set((s) => ({
      jobs: patchJob(s.jobs, jobId, (j) => ({ ...j, addons: [...j.addons, addon] })),
    }));
    return addon;
  },

  setAddonStatus: (jobId, addonId, status) =>
    set((s) => ({
      jobs: patchJob(s.jobs, jobId, (j) => ({
        ...j,
        addons: j.addons.map((a) => (a.id === addonId ? { ...a, status } : a)),
      })),
    })),

  setAddonInvSkip: (jobId, addonId) =>
    set((s) => ({
      jobs: patchJob(s.jobs, jobId, (j) => ({
        ...j,
        addons: j.addons.map((a) => (a.id === addonId ? { ...a, invSkip: true } : a)),
      })),
    })),

  checkVerifyItem: (jobId, itemId) =>
    set((s) => ({
      jobs: patchJob(s.jobs, jobId, (j) => withVerify(j, itemId, { st: "pass", via: "manual" })),
    })),

  overrideVerifyItem: (jobId, itemId, reason) =>
    set((s) => ({
      jobs: patchJob(s.jobs, jobId, (j) => withVerify(j, itemId, { st: "override", reason })),
    })),

  uncheckVerifyItem: (jobId, itemId) =>
    set((s) => ({
      jobs: patchJob(s.jobs, jobId, (j) => {
        const { [itemId]: _removed, ...rest } = j.verify?.ans ?? {};
        return { ...j, verify: { ans: rest } };
      }),
    })),

  // Push a field photo and auto-pass the next unanswered photo checklist item.
  addJobPhoto: (jobId) =>
    set((s) => ({
      jobs: patchJob(s.jobs, jobId, (j) => {
        const photos = [...j.photos, ""];
        const items = j.checklist?.items ?? [];
        const ans = j.verify?.ans ?? {};
        const nextPhoto = items.find((it) => it.type === "photo" && !ans[it.id]);
        if (!nextPhoto) return { ...j, photos };
        return {
          ...j,
          photos,
          verify: { ans: { ...ans, [nextPhoto.id]: { st: "pass", via: "photo" } } },
        };
      }),
    })),
});
