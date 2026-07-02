/**
 * lib/store/slices/jobs-slice.ts
 * Job + visit data and mutations (seeded from sample). Immutable updates only.
 * Job status is DERIVED from its placed visits (jobRecalc), mirroring the
 * prototype: no placed visits → unscheduled; all placed visits done → done;
 * otherwise scheduled.
 */

import type { StateCreator } from "zustand";
import type { Job, Visit } from "../types";
import { SAMPLE_JOBS } from "@/lib/prototype-sample";

const SEED_JOBS: Job[] = SAMPLE_JOBS.map((j) => ({
  ...j,
  visits: (j.visits ?? []).map((v) => ({ ...v })),
})) as unknown as Job[];

let _nextJobId = 900;
let _nextVisitId = 9800;

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
});
