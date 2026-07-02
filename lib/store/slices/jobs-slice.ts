/**
 * lib/store/slices/jobs-slice.ts
 * Job + visit data and mutations (seeded from sample). Immutable updates only.
 * Job status is DERIVED from its placed visits (jobRecalc), mirroring the
 * prototype: no placed visits → unscheduled; all placed visits done → done;
 * otherwise scheduled.
 */

import type { StateCreator } from "zustand";
import type { Job, Visit, Addon, VerifyAns } from "../types";
import { SAMPLE_JOBS } from "@/lib/prototype-sample";

const SEED_JOBS: Job[] = SAMPLE_JOBS.map((j) => ({
  ...j,
  visits: (j.visits ?? []).map((v) => ({ ...v })),
})) as unknown as Job[];

let _nextJobId = 900;
let _nextVisitId = 9800;
let _nextAuxId = 6000; // addons + other field-created ids (mirrors state.nextId)

/** Immutably replace one job by id (mirrors the recurring map pattern). */
function patchJob(jobs: Job[], id: number, fn: (j: Job) => Job): Job[] {
  return jobs.map((j) => (j.id === id ? fn(j) : j));
}

/** True once a visit has crew + day + start (mirrors prototype vPlaced). */
function isPlaced(v: Visit): boolean {
  return !!(v.date && v.techId != null && v.start != null);
}

/** Derive job status from its placed visits (mirrors prototype jobRecalc). */
function recalcStatus(visits: Visit[]): string {
  const placed = visits.filter(isPlaced);
  if (!placed.length) return "unscheduled";
  if (placed.every((v) => v.status === "done")) return "done";
  return "scheduled";
}

function withVisits(job: Job, visits: Visit[]): Job {
  return { ...job, visits, status: recalcStatus(visits) };
}

export interface JobsSlice {
  jobs: Job[];
  addJob: (draft: Omit<Job, "id">) => Job;
  updateJob: (id: number, patch: Partial<Job>) => void;
  setJobSvc: (id: number, svc: string) => void;
  addVisit: (jobId: number, dur?: number) => Visit | null;
  updateVisit: (jobId: number, visitId: number, patch: Partial<Visit>) => void;
  placeVisit: (jobId: number, visitId: number, at: { techId: number; date: string; start: number }) => void;
  setVisitStatus: (jobId: number, visitId: number, status: string) => void;
  removeVisit: (jobId: number, visitId: number) => void;
  archiveJob: (id: number) => void;
  deleteJob: (id: number) => void;
  // Found-work / add-ons (prototype addAddon / approveAddon / declineAddon).
  addAddon: (jobId: number, draft: { d: string; r: number; c?: number }) => Addon | null;
  setAddonStatus: (jobId: number, addonId: number, status: Addon["status"]) => void;
  setAddonInvSkip: (jobId: number, addonId: number) => void;
  // Before-you-leave checklist capture (prototype jobCheckItem / jobOverride /
  // jobUncheck / jobPhoto).
  checkVerifyItem: (jobId: number, itemId: number) => void;
  overrideVerifyItem: (jobId: number, itemId: number, reason: string) => void;
  uncheckVerifyItem: (jobId: number, itemId: number) => void;
  addJobPhoto: (jobId: number) => void;
}

/** Set one verify answer immutably (mirrors prototype jobVerifySet). */
function withVerify(job: Job, itemId: number, ans: VerifyAns): Job {
  const prev = job.verify?.ans ?? {};
  return { ...job, verify: { ans: { ...prev, [itemId]: ans } } };
}

export const createJobsSlice: StateCreator<JobsSlice, [], [], JobsSlice> = (set, get) => ({
  jobs: SEED_JOBS,

  addJob: (draft) => {
    const newJob: Job = { ...draft, id: ++_nextJobId };
    set((s) => ({ jobs: [newJob, ...s.jobs] }));
    return newJob;
  },

  updateJob: (id, patch) =>
    set((s) => ({ jobs: s.jobs.map((j) => (j.id === id ? { ...j, ...patch } : j)) })),

  setJobSvc: (id, svc) =>
    set((s) => ({ jobs: s.jobs.map((j) => (j.id === id ? { ...j, svc } : j)) })),

  addVisit: (jobId, dur = 2) => {
    const job = get().jobs.find((j) => j.id === jobId);
    if (!job) return null;
    const visit: Visit = {
      id: ++_nextVisitId,
      date: null,
      techId: null,
      start: null,
      dur,
      status: "scheduled",
    };
    set((s) => ({
      jobs: s.jobs.map((j) => (j.id === jobId ? withVisits(j, [...j.visits, visit]) : j)),
    }));
    return visit;
  },

  updateVisit: (jobId, visitId, patch) =>
    set((s) => ({
      jobs: s.jobs.map((j) =>
        j.id === jobId
          ? withVisits(j, j.visits.map((v) => (v.id === visitId ? { ...v, ...patch } : v)))
          : j
      ),
    })),

  placeVisit: (jobId, visitId, at) =>
    set((s) => ({
      jobs: s.jobs.map((j) =>
        j.id === jobId
          ? withVisits(j, j.visits.map((v) => (v.id === visitId ? { ...v, ...at } : v)))
          : j
      ),
    })),

  setVisitStatus: (jobId, visitId, status) =>
    set((s) => ({
      jobs: s.jobs.map((j) =>
        j.id === jobId
          ? withVisits(j, j.visits.map((v) => (v.id === visitId ? { ...v, status } : v)))
          : j
      ),
    })),

  removeVisit: (jobId, visitId) =>
    set((s) => ({
      jobs: s.jobs.map((j) =>
        j.id === jobId ? withVisits(j, j.visits.filter((v) => v.id !== visitId)) : j
      ),
    })),

  archiveJob: (id) =>
    set((s) => ({ jobs: s.jobs.map((j) => (j.id === id ? { ...j, archived: true } : j)) })),

  deleteJob: (id) =>
    set((s) => ({ jobs: s.jobs.map((j) => (j.id === id ? { ...j, archived: true } : j)) })),

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
        const ans = { ...(j.verify?.ans ?? {}) };
        delete ans[itemId];
        return { ...j, verify: { ans } };
      }),
    })),

  // Push a field photo and auto-pass the next unanswered photo checklist item
  // (mirrors prototype jobPhoto's checklist-matching side effect).
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
