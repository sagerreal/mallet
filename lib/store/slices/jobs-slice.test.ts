import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const mockCreate = vi.fn();
const mockUpdate = vi.fn();
const mockArchive = vi.fn();
const mockSetLines = vi.fn();
const mockCreateVisit = vi.fn();
const mockUpdateVisitDuration = vi.fn();
const mockSetVisitStatus = vi.fn();
const mockSetVisitEnroute = vi.fn();
const mockRemoveVisit = vi.fn();
const mockScheduleVisit = vi.fn();
const mockFieldSetVisitStatus = vi.fn();
const mockFieldSetVisitEnroute = vi.fn();

// jobs-slice imports RouterOutputs from @/lib/trpc/client for type purposes only.
vi.mock("@/lib/trpc/client", () => ({ api: {} }));

// The Jobs list renders a server PAGE, not the store, so a create that does not invalidate leaves
// the new row off screen until the window loses and regains focus — saved, but invisible.
const mockInvalidate = vi.fn();
vi.mock("@/lib/trpc/list-cache", () => ({ invalidateLists: (...d: unknown[]) => mockInvalidate(...d) }));

vi.mock("@/lib/trpc/vanilla", () => ({
  trpcVanilla: {
    v1: {
      jobs: {
        create: { mutate: (...a: unknown[]) => mockCreate(...a) },
        update: { mutate: (...a: unknown[]) => mockUpdate(...a) },
        archive: { mutate: (...a: unknown[]) => mockArchive(...a) },
        setLines: { mutate: (...a: unknown[]) => mockSetLines(...a) },
      },
      visits: {
        createVisit: { mutate: (...a: unknown[]) => mockCreateVisit(...a) },
        updateVisitDuration: { mutate: (...a: unknown[]) => mockUpdateVisitDuration(...a) },
        setVisitStatus: { mutate: (...a: unknown[]) => mockSetVisitStatus(...a) },
        setVisitEnroute: { mutate: (...a: unknown[]) => mockSetVisitEnroute(...a) },
        removeVisit: { mutate: (...a: unknown[]) => mockRemoveVisit(...a) },
        scheduleVisit: { mutate: (...a: unknown[]) => mockScheduleVisit(...a) },
      },
      field: {
        setVisitStatus: { mutate: (...a: unknown[]) => mockFieldSetVisitStatus(...a) },
        setVisitEnroute: { mutate: (...a: unknown[]) => mockFieldSetVisitEnroute(...a) },
      },
    },
  },
}));

import { createJobsSlice, buildJobUpdatePayload } from "./jobs-slice";
import type { JobsSlice } from "./jobs-slice";
import type { Job } from "@/lib/store/types";
// The hydrator's OWN list mapper, so the execution-guard tests below are driven by the shape
// v1.jobs.list really sends rather than by a store fixture written to suit the assertion.
import { toStoreJob } from "@/features/jobs/jobs-hydrator";

function makeStore() {
  let state: JobsSlice;
  const set = (partial: Partial<JobsSlice> | ((s: JobsSlice) => Partial<JobsSlice>)) => {
    const next = typeof partial === "function" ? partial(state) : partial;
    state = { ...state, ...next };
  };
  const get = () => state;
  state = createJobsSlice(set as never, get as never, {} as never);
  return { get, set };
}

const draft: Omit<Job, "id"> = {
  leadId: "lead-1", svc: "service", origin: "manual", title: "Water heater",
  addr: "1 Main", phone: "555", status: "unscheduled", archived: false,
  lines: [], addons: [], photos: [], notes: "gate 4", acts: [], visits: [],
};

/** Full jobDTO shape returned by v1.jobs.create / v1.jobs.update (matches jobDTO schema). */
function makeJobDTO(id: string, overrides: Record<string, unknown> = {}) {
  return {
    id,
    num: "JOB-1",
    leadId: "lead-1",
    sourceEstimateId: null,
    assigneeUserId: null,
    title: "Water heater",
    svc: "estimate",
    status: "scheduled",
    scheduledStart: null,
    scheduledEnd: null,
    startedAt: null,
    completedAt: null,
    canceledAt: null,
    cancelReason: null,
    total: { cents: 0, currency: "USD" },
    notes: "gate 4",
    visits: [],
    createdAt: "2026-07-10T00:00:00.000Z",
    ...overrides,
  };
}

describe("addJob persist", () => {
  beforeEach(() => { mockCreate.mockReset(); mockInvalidate.mockReset(); });

  it("optimistically inserts the job and returns { job } synchronously", () => {
    mockCreate.mockResolvedValue(makeJobDTO("srv"));
    const { get } = makeStore();
    const { job } = get().addJob(draft);
    expect(job.id).toBeTruthy();
    expect(get().jobs[0]!.id).toBe(job.id);
  });

  it("sends a client-authored id + leadId/svc to v1.jobs.create", () => {
    mockCreate.mockResolvedValue(makeJobDTO("srv-x"));
    const { get } = makeStore();
    const { job } = get().addJob(draft);
    expect(mockCreate).toHaveBeenCalledWith(
      expect.objectContaining({ id: job.id, leadId: "lead-1", svc: "service", title: "Water heater" }),
    );
  });

  it("does not call create when leadId is empty (unassigned manual job)", () => {
    const { get } = makeStore();
    get().addJob({ ...draft, leadId: "" });
    expect(mockCreate).not.toHaveBeenCalled();
  });

  it("persisted resolves to the reconciled job with origin DB after the server responds", async () => {
    const serverDTO = {
      id: "srv-id",
      num: "JOB-1",
      leadId: "lead-1",
      sourceEstimateId: null,
      assigneeUserId: null,
      title: "Water heater",
      status: "scheduled",
      scheduledStart: null,
      scheduledEnd: null,
      startedAt: null,
      completedAt: null,
      canceledAt: null,
      cancelReason: null,
      total: { cents: 0, currency: "USD" },
      notes: "gate 4",
      svc: "service",
      visits: [],
      createdAt: "2026-07-10T00:00:00.000Z",
    };
    mockCreate.mockResolvedValue(serverDTO);
    const { get } = makeStore();
    const { job, persisted } = get().addJob(draft);
    // Optimistic record still "manual" synchronously.
    expect(job.origin).toBe("manual");
    // After awaiting persisted, the store job is reconciled with origin "db".
    const reconciled = await persisted;
    expect(reconciled.origin).toBe("db");
    expect(get().jobs.find((j) => j.id === job.id)!.origin).toBe("db");
  });

  it("persisted rejects and rolls back on server error", async () => {
    mockCreate.mockRejectedValue(new Error("server error"));
    const { get } = makeStore();
    const { job, persisted } = get().addJob(draft);
    expect(get().jobs.some((j) => j.id === job.id)).toBe(true); // optimistic row present
    await expect(persisted).rejects.toThrow("server error");
    // After rejection, the optimistic row is removed.
    expect(get().jobs.some((j) => j.id === job.id)).toBe(false);
  });

  it("persisted for a leadless job resolves immediately to the local-only job", async () => {
    const { get } = makeStore();
    const { job, persisted } = get().addJob({ ...draft, leadId: "" });
    const resolved = await persisted;
    expect(resolved.id).toBe(job.id);
    expect(mockCreate).not.toHaveBeenCalled();
  });

  it("refetches the jobs lists once the create COMMITS, so the new row appears without a reload", async () => {
    // The Jobs list renders a server page, not the store, so the optimistic prepend is invisible to
    // it. Only an invalidation after the write lands puts the new job on screen — and it must be
    // after, or the refetch races the commit and returns a page that predates it.
    mockCreate.mockResolvedValue(makeJobDTO("srv-inv"));
    const { get } = makeStore();
    const { persisted } = get().addJob(draft);
    expect(mockInvalidate).not.toHaveBeenCalled(); // not before the server answers
    await persisted;
    expect(mockInvalidate).toHaveBeenCalledWith("jobs", "invoices");
  });

  it("does NOT refetch when the create failed — there is nothing new to show", async () => {
    mockCreate.mockRejectedValue(new Error("server error"));
    const { get } = makeStore();
    const { persisted } = get().addJob(draft);
    await expect(persisted).rejects.toThrow();
    expect(mockInvalidate).not.toHaveBeenCalled();
  });
});

describe("buildJobUpdatePayload", () => {
  it("maps title/svc/notes to the update payload", () => {
    expect(buildJobUpdatePayload("j1", { title: "New" })).toEqual({ jobId: "j1", title: "New" });
    expect(buildJobUpdatePayload("j1", { svc: "estimate" })).toEqual({ jobId: "j1", svc: "estimate" });
    expect(buildJobUpdatePayload("j1", { notes: "x" })).toEqual({ jobId: "j1", notes: "x" });
  });

  // `lines` stays out of this payload on purpose — it has its own endpoint (setJobLines), because
  // job_lines is a child table rather than a column on jobs.
  it("returns null for a genuinely local-only patch", () => {
    expect(buildJobUpdatePayload("j1", { lines: [] })).toBeNull();
  });

  /**
   * These four USED to return null, and that was the bug: the office job modal's Service address
   * row and the close-out sheet's "What was done" wrote to the store and nowhere else, so the next
   * jobs.list refetch erased what had been typed. They have columns now.
   */
  it("persists the service address — the field a crew drives to", () => {
    expect(buildJobUpdatePayload("j1", { addr: "1 Main" })).toEqual({ jobId: "j1", addr: "1 Main" });
  });

  it("persists a job-specific phone", () => {
    expect(buildJobUpdatePayload("j1", { phone: "555" })).toEqual({ jobId: "j1", phone: "555" });
  });

  it("persists the completion note — it is shown to the customer on the invoice", () => {
    expect(buildJobUpdatePayload("j1", { completion: "Replaced 40-gal heater" }))
      .toEqual({ jobId: "j1", completion: "Replaced 40-gal heater" });
  });

  it("persists the ready-to-bill flag", () => {
    expect(buildJobUpdatePayload("j1", { invRequested: true })).toEqual({ jobId: "j1", invRequested: true });
  });

  it("maps an attached checklist to the wire shape (drops store-only position)", () => {
    const payload = buildJobUpdatePayload("j1", {
      checklist: {
        name: "Before you leave",
        items: [
          { id: "i1", text: "Photo of the valve", type: "photo", required: true, position: 0 },
          { id: "i2", text: "Test water pressure", type: "check", required: false, position: 1 },
        ],
      },
    });
    expect(payload).toEqual({
      jobId: "j1",
      checklist: {
        name: "Before you leave",
        items: [
          { id: "i1", text: "Photo of the valve", type: "photo", required: true },
          { id: "i2", text: "Test water pressure", type: "check", required: false },
        ],
      },
    });
  });

  it("maps a checklist removal (key present, value undefined) to an explicit null", () => {
    expect(buildJobUpdatePayload("j1", { checklist: undefined })).toEqual({
      jobId: "j1",
      checklist: null,
    });
  });
});

describe("updateJob persist", () => {
  beforeEach(() => { mockUpdate.mockReset(); });

  it("persists a title change via v1.jobs.update", () => {
    mockUpdate.mockResolvedValue({} as never);
    const { get } = makeStore();
    const { job: created } = get().addJob({ ...draft, leadId: "" }); // local-only add (no create call)
    get().updateJob(created.id, { title: "Renamed" });
    expect(get().jobs.find((j) => j.id === created.id)!.title).toBe("Renamed"); // optimistic
    expect(mockUpdate).toHaveBeenCalledWith(expect.objectContaining({ jobId: created.id, title: "Renamed" }));
  });

  it("does NOT call update for a local-only patch (lines)", () => {
    mockUpdate.mockResolvedValue({} as never);
    const { get } = makeStore();
    const { job: created } = get().addJob({ ...draft, leadId: "" });
    get().updateJob(created.id, { lines: [{ d: "x", q: 1, r: 100 }] });
    expect(mockUpdate).not.toHaveBeenCalled();
  });
});

/**
 * setJobSvc is GONE. It existed to push the retired magic value ('estimate') through the trade-
 * label column — kind carries that now, and the Type toggle writes it via updateJob({ kind }).
 */
describe("the Type toggle persists kind", () => {
  beforeEach(() => { mockUpdate.mockReset(); });

  it("routes through update with { kind }", () => {
    mockUpdate.mockResolvedValue({} as never);
    const { get } = makeStore();
    const { job: created } = get().addJob({ ...draft, leadId: "" });
    void get().updateJob(created.id, { kind: "estimate" });
    expect(get().jobs.find((j) => j.id === created.id)!.kind).toBe("estimate");
    expect(mockUpdate).toHaveBeenCalledWith(expect.objectContaining({ jobId: created.id, kind: "estimate" }));
  });

  it("flips back to flat rate as kind 'work'", () => {
    mockUpdate.mockResolvedValue({} as never);
    const { get } = makeStore();
    const { job: created } = get().addJob({ ...draft, leadId: "", kind: "estimate" });
    void get().updateJob(created.id, { kind: "work" });
    expect(get().jobs.find((j) => j.id === created.id)!.kind).toBe("work");
    expect(mockUpdate).toHaveBeenCalledWith(expect.objectContaining({ jobId: created.id, kind: "work" }));
  });
});

describe("updateJob reconcile + rollback", () => {
  beforeEach(() => { mockUpdate.mockReset(); });

  it("reconciles the DTO's svc onto the store including a null-clear", async () => {
    // Server confirms svc cleared to null.
    mockUpdate.mockResolvedValue(makeJobDTO("ignored", { svc: null }));
    const { get } = makeStore();
    const { job: created } = get().addJob({ ...draft, leadId: "", svc: "estimate" });
    get().updateJob(created.id, { svc: null });
    // Flush the resolved promise.
    await Promise.resolve();
    await Promise.resolve();
    expect(get().jobs.find((j) => j.id === created.id)!.svc).toBeNull();
  });

  it("reconciles the DTO's svc when set to a non-null value", async () => {
    mockUpdate.mockResolvedValue(makeJobDTO("ignored", { svc: "service" }));
    const { get } = makeStore();
    const { job: created } = get().addJob({ ...draft, leadId: "", svc: "estimate" });
    get().updateJob(created.id, { svc: "service" });
    await Promise.resolve();
    await Promise.resolve();
    expect(get().jobs.find((j) => j.id === created.id)!.svc).toBe("service");
  });

  it("rolls back to the pre-patch snapshot on error", async () => {
    mockUpdate.mockRejectedValue(new Error("network"));
    const { get } = makeStore();
    const { job: created } = get().addJob({ ...draft, leadId: "", title: "Original", svc: "estimate" });
    get().updateJob(created.id, { title: "Changed" });
    // Optimistic update visible immediately.
    expect(get().jobs.find((j) => j.id === created.id)!.title).toBe("Changed");
    await Promise.resolve();
    await Promise.resolve();
    // After rejection, snapshot restored.
    expect(get().jobs.find((j) => j.id === created.id)!.title).toBe("Original");
  });
});

// ---------------------------------------------------------------------------
// updateJob outcome — callers (e.g. the job checklist block) await the returned
// promise to surface persist failures instead of failing silently.
// ---------------------------------------------------------------------------

describe("updateJob returns the mutation outcome", () => {
  beforeEach(() => { mockUpdate.mockReset(); });

  it("resolves { ok: true } after a successful persist", async () => {
    mockUpdate.mockResolvedValue(makeJobDTO("ignored", { title: "Renamed" }));
    const { get } = makeStore();
    const { job: created } = get().addJob({ ...draft, leadId: "" });
    await expect(get().updateJob(created.id, { title: "Renamed" })).resolves.toEqual({ ok: true });
  });

  it("resolves { ok: true } for a local-only patch without a network call", async () => {
    const { get } = makeStore();
    const { job: created } = get().addJob({ ...draft, leadId: "" });
    await expect(
      get().updateJob(created.id, { lines: [{ d: "x", q: 1, r: 100 }] }),
    ).resolves.toEqual({ ok: true });
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  it("resolves { ok: false } on persist failure (never rejects) and still rolls back", async () => {
    mockUpdate.mockRejectedValue(new Error("network"));
    const { get } = makeStore();
    const { job: created } = get().addJob({ ...draft, leadId: "", title: "Original" });
    await expect(get().updateJob(created.id, { title: "Changed" })).resolves.toEqual({ ok: false });
    expect(get().jobs.find((j) => j.id === created.id)!.title).toBe("Original");
  });
});

// ---------------------------------------------------------------------------
// Checklist merge guard — a snapshot/reconcile whose server read predates a
// just-persisted checklist write must not wipe (or resurrect) the checklist.
// Mirrors the adoption guard's stale-window bookkeeping.
// ---------------------------------------------------------------------------

describe("checklist merge guard (recent checklist writes survive stale snapshots)", () => {
  beforeEach(() => {
    mockUpdate.mockReset();
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-12T00:00:00Z"));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  const storeChecklist = {
    name: "Close-out",
    items: [{ id: "i1", text: "Sweep the work area", type: "check" as const, required: false, position: 0 }],
  };
  const wireChecklist = {
    name: "Close-out",
    items: [{ id: "i1", text: "Sweep the work area", type: "check", required: false }],
  };

  it("a stale snapshot without the checklist does not wipe a just-attached one", async () => {
    mockUpdate.mockResolvedValue(makeJobDTO("ignored", { checklist: wireChecklist }));
    const { get } = makeStore();
    const { job: created } = get().addJob({ ...draft, leadId: "" });
    await get().updateJob(created.id, { checklist: storeChecklist });
    expect(get().jobs.find((j) => j.id === created.id)!.checklist?.name).toBe("Close-out");

    // Snapshot read before the checklist commit — same job, checklist missing.
    const stale = { ...get().jobs.find((j) => j.id === created.id)!, checklist: undefined };
    get().setJobs([stale]);
    expect(get().jobs.find((j) => j.id === created.id)!.checklist?.name).toBe("Close-out");
  });

  it("a stale snapshot cannot resurrect a just-removed checklist", async () => {
    const { get } = makeStore();
    const { job: created } = get().addJob({ ...draft, leadId: "" });
    // Attach first (persisted), then remove (persisted).
    mockUpdate.mockResolvedValueOnce(makeJobDTO("ignored", { checklist: wireChecklist }));
    await get().updateJob(created.id, { checklist: storeChecklist });
    expect(get().jobs.find((j) => j.id === created.id)!.checklist?.name).toBe("Close-out");
    mockUpdate.mockResolvedValueOnce(makeJobDTO("ignored", { checklist: null }));
    await get().updateJob(created.id, { checklist: undefined });
    expect(get().jobs.find((j) => j.id === created.id)!.checklist).toBeUndefined();

    const stale = { ...get().jobs.find((j) => j.id === created.id)!, checklist: storeChecklist };
    get().setJobs([stale]);
    expect(get().jobs.find((j) => j.id === created.id)!.checklist).toBeUndefined();
  });

  it("hands authority back to snapshots after the stale window", async () => {
    mockUpdate.mockResolvedValue(makeJobDTO("ignored", { checklist: wireChecklist }));
    const { get } = makeStore();
    const { job: created } = get().addJob({ ...draft, leadId: "" });
    await get().updateJob(created.id, { checklist: storeChecklist });

    vi.setSystemTime(new Date("2026-07-12T00:00:31Z")); // > 30 s HYDRATOR_STALE_MS
    const stale = { ...get().jobs.find((j) => j.id === created.id)!, checklist: undefined };
    get().setJobs([stale]);
    expect(get().jobs.find((j) => j.id === created.id)!.checklist).toBeUndefined();
  });

  it("a failed checklist write does not leave a guard entry behind", async () => {
    mockUpdate.mockRejectedValue(new Error("network"));
    const { get } = makeStore();
    const { job: created } = get().addJob({ ...draft, leadId: "" });
    await get().updateJob(created.id, { checklist: storeChecklist });
    // Rolled back — and a subsequent snapshot without a checklist stays authoritative.
    const stale = { ...get().jobs.find((j) => j.id === created.id)!, checklist: undefined };
    get().setJobs([stale]);
    expect(get().jobs.find((j) => j.id === created.id)!.checklist).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// adoptJob — insert or replace by id; applies Fix 1 status remap; no network call
// ---------------------------------------------------------------------------

/** Minimal jobSummaryDTO-shaped object (as returned by quoting.accept "job" field). */
function makeAcceptJobDTO(id: string, overrides: Record<string, unknown> = {}) {
  return {
    id,
    num: "JOB-2",
    leadId: "lead-1",
    title: "Auto-job",
    svc: null,
    status: "scheduled",
    assigneeUserId: null,
    scheduledStart: null,
    total: { cents: 15000, currency: "USD" },
    notes: null,
    visits: [],
    createdAt: "2026-07-11T00:00:00.000Z",
    lines: [],
    addons: [],
    verifyAnswers: [],
    photos: [],
    ...overrides,
  };
}

describe("adoptJob", () => {
  it("appends a new job when the id is not already in the store", () => {
    const { get } = makeStore();
    const dto = makeAcceptJobDTO("adopt-new");
    get().adoptJob(dto as never);
    const found = get().jobs.find((j) => j.id === "adopt-new");
    expect(found).toBeDefined();
    expect(found!.origin).toBe("db");
  });

  it("replaces an existing job by id when already present", () => {
    const { get } = makeStore();
    // Seed an existing job with old title.
    get().setJobs([{ ...draft, id: "adopt-replace", origin: "db", title: "Old title" }]);
    const dto = makeAcceptJobDTO("adopt-replace", { title: "New title" });
    get().adoptJob(dto as never);
    const jobs = get().jobs.filter((j) => j.id === "adopt-replace");
    expect(jobs).toHaveLength(1); // not duplicated
    expect(jobs[0]!.title).toBe("New title");
  });

  it("applies Fix 1 remap: zero visits + scheduled → store status 'unscheduled'", () => {
    const { get } = makeStore();
    const dto = makeAcceptJobDTO("adopt-status", { status: "scheduled", visits: [] });
    get().adoptJob(dto as never);
    expect(get().jobs.find((j) => j.id === "adopt-status")!.status).toBe("unscheduled");
  });

  it("does NOT remap: zero visits + in_progress stays 'scheduled'", () => {
    const { get } = makeStore();
    const dto = makeAcceptJobDTO("adopt-inprogress", { status: "in_progress", visits: [] });
    get().adoptJob(dto as never);
    expect(get().jobs.find((j) => j.id === "adopt-inprogress")!.status).toBe("scheduled");
  });

  it("makes no network call (mockCreate/Update/Archive untouched)", () => {
    mockCreate.mockReset(); mockUpdate.mockReset(); mockArchive.mockReset();
    const { get } = makeStore();
    get().adoptJob(makeAcceptJobDTO("adopt-nonet") as never);
    expect(mockCreate).not.toHaveBeenCalled();
    expect(mockUpdate).not.toHaveBeenCalled();
    expect(mockArchive).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Visit hardening (live-testing batch 2): addVisit dedupe, pending-create
// merge guard, duration-debounce value capture + chaining.
// ---------------------------------------------------------------------------

/** Deferred promise — lets a test hold a mutation in flight. */
function deferred<T>() {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

/** Full visitDTO shape (matches the visitDTO zod schema). */
function makeVisitDTO(id: string, overrides: Record<string, unknown> = {}) {
  return {
    id,
    assigneeUserId: null,
    scheduledDate: null,
    scheduledStart: null,
    scheduledEnd: null,
    durationMinutes: 120,
    status: "pending",
    enrouteAt: null,
    startedAt: null,
    completedAt: null,
    notes: null,
    position: 1,
    ...overrides,
  };
}

/** Seed one DB-origin job (optionally with store visits) into a fresh store. */
function seedDbJob(
  get: ReturnType<typeof makeStore>["get"],
  id: string,
  visits: Job["visits"] = [],
) {
  get().setJobs([{ ...draft, id, origin: "db", visits }]);
}

// Chained ops (chain() + .then/.catch/.finally) settle across several
// microtask turns — flush generously.
const flush = async () => {
  for (let i = 0; i < 10; i += 1) await Promise.resolve();
};

describe("addVisit dedupe guard (pending create)", () => {
  beforeEach(() => { mockCreateVisit.mockReset(); });

  it("returns the existing unplaced visit while its create is still in flight", async () => {
    const d = deferred<unknown>();
    mockCreateVisit.mockReturnValue(d.promise);
    const { get } = makeStore();
    seedDbJob(get, "j-dedupe");

    const first = get().addVisit("j-dedupe");
    const second = get().addVisit("j-dedupe");

    expect(first).not.toBeNull();
    expect(second!.id).toBe(first!.id); // no second row minted
    expect(get().jobs[0]!.visits).toHaveLength(1);
    await flush(); // chain() defers the mutate by a microtask
    expect(mockCreateVisit).toHaveBeenCalledTimes(1);
  });

  it("allows a real second visit once the first create settles", async () => {
    const d = deferred<unknown>();
    mockCreateVisit.mockReturnValueOnce(d.promise);
    const { get } = makeStore();
    seedDbJob(get, "j-second");

    const first = get().addVisit("j-second")!;
    d.resolve(makeJobDTO("j-second", { visits: [makeVisitDTO(first.id)] }));
    await flush();

    mockCreateVisit.mockReturnValueOnce(deferred<unknown>().promise);
    const second = get().addVisit("j-second")!;
    expect(second.id).not.toBe(first.id);
    expect(get().jobs[0]!.visits).toHaveLength(2);
    await flush();
    expect(mockCreateVisit).toHaveBeenCalledTimes(2);
  });

  it("does not dedupe local-only jobs (no create in flight)", () => {
    const { get } = makeStore();
    get().setJobs([{ ...draft, id: "j-local-v", origin: "manual" }]);

    const first = get().addVisit("j-local-v")!;
    const second = get().addVisit("j-local-v")!;
    expect(second.id).not.toBe(first.id);
    expect(get().jobs[0]!.visits).toHaveLength(2);
    expect(mockCreateVisit).not.toHaveBeenCalled();
  });

  it("rolls back the optimistic visit when the create fails", async () => {
    const d = deferred<unknown>();
    mockCreateVisit.mockReturnValue(d.promise);
    const { get } = makeStore();
    seedDbJob(get, "j-fail");

    get().addVisit("j-fail");
    expect(get().jobs[0]!.visits).toHaveLength(1);
    d.reject(new Error("network"));
    await flush();
    expect(get().jobs[0]!.visits).toHaveLength(0); // optimistic row removed
  });
});

describe("pending-create merge guard", () => {
  beforeEach(() => {
    mockCreateVisit.mockReset();
    mockSetVisitStatus.mockReset();
  });

  it("setJobs (hydrator snapshot) keeps a visit whose create is still in flight", () => {
    const d = deferred<unknown>();
    mockCreateVisit.mockReturnValue(d.promise);
    const { get } = makeStore();
    seedDbJob(get, "j-guard");
    const visit = get().addVisit("j-guard")!;

    // A list snapshot read BEFORE the create committed: no visits.
    get().setJobs([{ ...draft, id: "j-guard", origin: "db", visits: [] }]);

    const ids = get().jobs[0]!.visits.map((v) => v.id);
    expect(ids).toContain(visit.id); // optimistic visit survived the merge
  });

  it("mutation reconcile keeps the pending visit absent from the returned DTO", async () => {
    const create = deferred<unknown>();
    mockCreateVisit.mockReturnValue(create.promise);
    const serverVisit = { id: "aaaaaaaa-0000-0000-0000-000000000001", date: null, techId: null, start: null, dur: 2, status: "scheduled" };
    const { get } = makeStore();
    seedDbJob(get, "j-recon", [serverVisit]);

    const optimistic = get().addVisit("j-recon")!; // create stays in flight

    // A concurrent setVisitStatus on the server-known visit resolves with a
    // DTO snapshot that does not include the still-uncommitted visit.
    mockSetVisitStatus.mockResolvedValue(
      makeJobDTO("j-recon", { visits: [makeVisitDTO(serverVisit.id)] }),
    );
    get().setVisitStatus("j-recon", serverVisit.id, "onsite", "office");
    await flush();

    const ids = get().jobs[0]!.visits.map((v) => v.id);
    expect(ids).toContain(serverVisit.id);
    expect(ids).toContain(optimistic.id); // NOT stomped by the reconcile
  });

  it("after the create settles, snapshots are authoritative again", async () => {
    const d = deferred<unknown>();
    mockCreateVisit.mockReturnValue(d.promise);
    const { get } = makeStore();
    seedDbJob(get, "j-settled");
    const visit = get().addVisit("j-settled")!;

    d.resolve(makeJobDTO("j-settled", { visits: [makeVisitDTO(visit.id)] }));
    await flush();

    // Server later says the visit is gone (e.g. removed elsewhere) — no guard.
    get().setJobs([{ ...draft, id: "j-settled", origin: "db", visits: [] }]);
    expect(get().jobs[0]!.visits).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// setVisitStatus("enroute") — "On my way" is a STAMP, not a status change, so it
// must reach its own endpoint. Sent through setVisitStatus it maps to "pending",
// the status the visit already has, and the server discards it as idempotent.
// ---------------------------------------------------------------------------

describe("setVisitStatus — On my way (office surface)", () => {
  const SCHEDULED_VISIT = {
    id: "aaaaaaaa-0000-0000-0000-0000000000e1",
    date: null,
    techId: null,
    start: null,
    dur: 2,
    status: "scheduled",
  };
  const ENROUTE_AT = "2026-07-15T08:40:00.000Z";

  beforeEach(() => {
    mockSetVisitStatus.mockReset();
    mockSetVisitEnroute.mockReset();
  });

  it("persists via v1.visits.setVisitEnroute, not setVisitStatus", async () => {
    mockSetVisitEnroute.mockResolvedValue(
      makeJobDTO("j-enroute", {
        visits: [makeVisitDTO(SCHEDULED_VISIT.id, { enrouteAt: ENROUTE_AT })],
      }),
    );
    const { get } = makeStore();
    seedDbJob(get, "j-enroute", [SCHEDULED_VISIT]);

    get().setVisitStatus("j-enroute", SCHEDULED_VISIT.id, "enroute", "office");
    await flush();

    expect(mockSetVisitEnroute).toHaveBeenCalledWith({
      jobId: "j-enroute",
      visitId: SCHEDULED_VISIT.id,
    });
    expect(mockSetVisitStatus).not.toHaveBeenCalled();
  });

  it("keeps the visit 'enroute' after the server DTO reconciles (pending + stamp)", async () => {
    mockSetVisitEnroute.mockResolvedValue(
      makeJobDTO("j-enroute", {
        visits: [makeVisitDTO(SCHEDULED_VISIT.id, { status: "pending", enrouteAt: ENROUTE_AT })],
      }),
    );
    const { get } = makeStore();
    seedDbJob(get, "j-enroute", [SCHEDULED_VISIT]);

    get().setVisitStatus("j-enroute", SCHEDULED_VISIT.id, "enroute", "office");
    await flush();

    // Reconciled from the DTO alone — the same derivation a page reload runs.
    expect(get().jobs[0]!.visits[0]!.status).toBe("enroute");
  });

  it("rolls the visit back to 'scheduled' when the stamp write fails", async () => {
    mockSetVisitEnroute.mockRejectedValue(new Error("offline"));
    const { get } = makeStore();
    seedDbJob(get, "j-enroute", [SCHEDULED_VISIT]);

    get().setVisitStatus("j-enroute", SCHEDULED_VISIT.id, "enroute", "office");
    await flush();

    expect(get().jobs[0]!.visits[0]!.status).toBe("scheduled");
  });

  it("still routes a real status change to setVisitStatus", async () => {
    mockSetVisitStatus.mockResolvedValue(
      makeJobDTO("j-enroute", {
        visits: [makeVisitDTO(SCHEDULED_VISIT.id, { status: "in_progress" })],
      }),
    );
    const { get } = makeStore();
    seedDbJob(get, "j-enroute", [SCHEDULED_VISIT]);

    get().setVisitStatus("j-enroute", SCHEDULED_VISIT.id, "onsite", "office");
    await flush();

    expect(mockSetVisitStatus).toHaveBeenCalledWith({
      jobId: "j-enroute",
      visitId: SCHEDULED_VISIT.id,
      status: "in_progress",
    });
    expect(mockSetVisitEnroute).not.toHaveBeenCalled();
  });

  // The optimistic patch carries the STAMP as well as the status. Without it the stepper — which
  // reads the two together — reported the tap just made as "skipped" until the DTO landed, which
  // is two taps' worth of time on a slow connection. See lib/store/visit-stamps.ts.
  it("stamps the step optimistically, so a second tap does not report the first as skipped", () => {
    mockSetVisitEnroute.mockReturnValue(new Promise(() => {}));
    mockSetVisitStatus.mockReturnValue(new Promise(() => {}));
    const { get } = makeStore();
    seedDbJob(get, "j-enroute", [SCHEDULED_VISIT]);

    get().setVisitStatus("j-enroute", SCHEDULED_VISIT.id, "enroute", "office");
    const enrouteAt = get().jobs[0]!.visits[0]!.enrouteAt;
    expect(enrouteAt).toBeTruthy();

    get().setVisitStatus("j-enroute", SCHEDULED_VISIT.id, "onsite", "office");
    const moved = get().jobs[0]!.visits[0]!;
    expect(moved.status).toBe("onsite");
    // The drive's stamp survives the second tap; the arrival gets its own.
    expect(moved.enrouteAt).toBe(enrouteAt);
    expect(moved.startedAt).toBeTruthy();
  });
});

// ---------------------------------------------------------------------------
// The field surface. A technician's endpoints are assignment-gated (the office's
// are ownerOrOffice and would refuse his token) and they are the ones that move
// his clock — so the wrong endpoint is a lost timesheet segment, not just a 403.
// ---------------------------------------------------------------------------

describe("setVisitStatus — field surface", () => {
  const FIELD_VISIT = {
    id: "aaaaaaaa-0000-0000-0000-0000000000f1",
    date: null,
    techId: null,
    start: null,
    dur: 2,
    status: "scheduled",
  };

  beforeEach(() => {
    mockSetVisitStatus.mockReset();
    mockSetVisitEnroute.mockReset();
    mockFieldSetVisitStatus.mockReset();
    mockFieldSetVisitEnroute.mockReset();
  });

  it("sends On my way to v1.field.setVisitEnroute, never the office endpoint", async () => {
    mockFieldSetVisitEnroute.mockResolvedValue(
      makeJobDTO("j-field", {
        visits: [makeVisitDTO(FIELD_VISIT.id, { enrouteAt: "2026-07-15T08:40:00.000Z" })],
      }),
    );
    const { get } = makeStore();
    seedDbJob(get, "j-field", [FIELD_VISIT]);

    get().setVisitStatus("j-field", FIELD_VISIT.id, "enroute", "field");
    await flush();

    expect(mockFieldSetVisitEnroute).toHaveBeenCalledWith({
      jobId: "j-field",
      visitId: FIELD_VISIT.id,
    });
    expect(mockSetVisitEnroute).not.toHaveBeenCalled();
  });

  it("sends Arrived to v1.field.setVisitStatus as in_progress", async () => {
    mockFieldSetVisitStatus.mockResolvedValue(
      makeJobDTO("j-field", { visits: [makeVisitDTO(FIELD_VISIT.id, { status: "in_progress" })] }),
    );
    const { get } = makeStore();
    seedDbJob(get, "j-field", [FIELD_VISIT]);

    get().setVisitStatus("j-field", FIELD_VISIT.id, "onsite", "field");
    await flush();

    expect(mockFieldSetVisitStatus).toHaveBeenCalledWith({
      jobId: "j-field",
      visitId: FIELD_VISIT.id,
      status: "in_progress",
    });
    expect(mockSetVisitStatus).not.toHaveBeenCalled();
  });

  it("sends Mark done to v1.field.setVisitStatus as complete", async () => {
    mockFieldSetVisitStatus.mockResolvedValue(
      makeJobDTO("j-field", { visits: [makeVisitDTO(FIELD_VISIT.id, { status: "complete" })] }),
    );
    const { get } = makeStore();
    seedDbJob(get, "j-field", [FIELD_VISIT]);

    get().setVisitStatus("j-field", FIELD_VISIT.id, "done", "field");
    await flush();

    expect(mockFieldSetVisitStatus).toHaveBeenCalledWith({
      jobId: "j-field",
      visitId: FIELD_VISIT.id,
      status: "complete",
    });
  });

  it("reconciles the field response like any other write", async () => {
    mockFieldSetVisitStatus.mockResolvedValue(
      makeJobDTO("j-field", { visits: [makeVisitDTO(FIELD_VISIT.id, { status: "in_progress" })] }),
    );
    const { get } = makeStore();
    seedDbJob(get, "j-field", [FIELD_VISIT]);

    get().setVisitStatus("j-field", FIELD_VISIT.id, "onsite", "field");
    await flush();

    expect(get().jobs[0]!.visits[0]!.status).toBe("onsite");
  });

  it("rolls the visit back when the field write fails", async () => {
    mockFieldSetVisitStatus.mockRejectedValue(new Error("offline"));
    const { get } = makeStore();
    seedDbJob(get, "j-field", [FIELD_VISIT]);

    get().setVisitStatus("j-field", FIELD_VISIT.id, "onsite", "field");
    await flush();

    expect(get().jobs[0]!.visits[0]!.status).toBe("scheduled");
  });

  it("keeps the office on its own endpoints — the field API is never called for it", async () => {
    mockSetVisitStatus.mockResolvedValue(
      makeJobDTO("j-field", { visits: [makeVisitDTO(FIELD_VISIT.id, { status: "in_progress" })] }),
    );
    const { get } = makeStore();
    seedDbJob(get, "j-field", [FIELD_VISIT]);

    get().setVisitStatus("j-field", FIELD_VISIT.id, "onsite", "office");
    await flush();

    expect(mockFieldSetVisitStatus).not.toHaveBeenCalled();
    expect(mockSetVisitStatus).toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Visit-status merge guard — the "I've arrived" flicker.
//
// Tapping "Start driving" reconciles and invalidates, which dispatches a myDay
// refetch whose DATABASE READ predates nothing yet — but the tech taps "I've
// arrived" a second later, INSIDE that refetch's flight. The refetch resolves
// carrying the visit as it was before the arrival committed, setJobs merges it,
// and the sheet snaps back to "on the way" until the arrival's own DTO lands.
// Two states, ~a second apart: the flicker.
//
// The other three snapshot guards (pending visits, recent checklist, recent
// lines) already pin their fields against exactly this race. This is the
// visit's own status and step stamps getting the same protection.
// ---------------------------------------------------------------------------

describe("visit-status merge guard (a stale snapshot cannot revert a just-tapped step)", () => {
  const ENROUTE_STAMP = "2026-07-15T08:40:00.000Z";
  const ARRIVED_AT = "2026-07-15T08:52:00.000Z";

  // A distinct visit id per test: the per-visit op chain is module state, and a test whose
  // mutation never settles would otherwise park every later test's op behind it forever.
  const enrouteVisit = (suffix: string) => ({
    id: `aaaaaaaa-0000-0000-0000-0000000000${suffix}`,
    date: null,
    techId: null,
    start: null,
    dur: 2,
    status: "enroute",
    enrouteAt: ENROUTE_STAMP,
    startedAt: null,
  });

  /** The myDay row an in-flight refetch resolves with: still on the way, no arrival stamp. */
  const staleSnapshot = (visits: Job["visits"]) =>
    ({ ...draft, id: "j-arrive", origin: "db" as const, visits });

  beforeEach(() => {
    mockFieldSetVisitStatus.mockReset();
    mockFieldSetVisitEnroute.mockReset();
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-15T08:52:00Z"));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("holds the arrival while the pre-commit refetch lands", () => {
    const visit = enrouteVisit("a1");
    mockFieldSetVisitStatus.mockReturnValue(new Promise(() => {})); // still in flight
    const { get } = makeStore();
    seedDbJob(get, "j-arrive", [visit]);

    get().setVisitStatus("j-arrive", visit.id, "onsite", "field");
    expect(get().jobs[0]!.visits[0]!.status).toBe("onsite");

    // Refetch #1 — dispatched by the "Start driving" reconcile, read before the arrival
    // committed — resolves now.
    get().setJobs([staleSnapshot([visit])]);

    const v = get().jobs[0]!.visits[0]!;
    expect(v.status).toBe("onsite");
    expect(v.startedAt).toBeTruthy();
  });

  it("lets the write's own response through — the server's stamp wins over the device's", async () => {
    const visit = enrouteVisit("a2");
    mockFieldSetVisitStatus.mockResolvedValue(
      makeJobDTO("j-arrive", {
        visits: [makeVisitDTO(visit.id, {
          status: "in_progress",
          enrouteAt: ENROUTE_STAMP,
          startedAt: ARRIVED_AT,
        })],
      }),
    );
    const { get } = makeStore();
    seedDbJob(get, "j-arrive", [visit]);

    get().setVisitStatus("j-arrive", visit.id, "onsite", "field");
    await flush();

    const v = get().jobs[0]!.visits[0]!;
    expect(v.status).toBe("onsite");
    expect(v.startedAt).toBe(ARRIVED_AT);
  });

  it("still holds the arrival after its own reconcile — a later stale refetch cannot revert it", async () => {
    const visit = enrouteVisit("a3");
    mockFieldSetVisitStatus.mockResolvedValue(
      makeJobDTO("j-arrive", {
        visits: [makeVisitDTO(visit.id, { status: "in_progress", startedAt: ARRIVED_AT })],
      }),
    );
    const { get } = makeStore();
    seedDbJob(get, "j-arrive", [visit]);

    get().setVisitStatus("j-arrive", visit.id, "onsite", "field");
    await flush();

    get().setJobs([staleSnapshot([visit])]);
    expect(get().jobs[0]!.visits[0]!.status).toBe("onsite");
  });

  it("hands authority back to snapshots after the stale window", () => {
    const visit = enrouteVisit("a4");
    mockFieldSetVisitStatus.mockReturnValue(new Promise(() => {}));
    const { get } = makeStore();
    seedDbJob(get, "j-arrive", [visit]);

    get().setVisitStatus("j-arrive", visit.id, "onsite", "field");
    vi.setSystemTime(new Date("2026-07-15T08:52:31Z")); // > 30 s HYDRATOR_STALE_MS
    get().setJobs([staleSnapshot([visit])]);

    expect(get().jobs[0]!.visits[0]!.status).toBe("enroute");
  });

  it("a failed write leaves no guard entry behind", async () => {
    const visit = enrouteVisit("a5");
    mockFieldSetVisitStatus.mockRejectedValue(new Error("offline"));
    const { get } = makeStore();
    seedDbJob(get, "j-arrive", [visit]);

    get().setVisitStatus("j-arrive", visit.id, "onsite", "field");
    await flush();
    // Rolled back — and the next snapshot is authoritative again, not pinned to "onsite".
    expect(get().jobs[0]!.visits[0]!.status).toBe("enroute");
    get().setJobs([staleSnapshot([{ ...visit, status: "done" }])]);
    expect(get().jobs[0]!.visits[0]!.status).toBe("done");
  });

  it("guards only the visit that was written, not its siblings", () => {
    const visit = enrouteVisit("a6");
    const sibling = { ...enrouteVisit("a7"), status: "scheduled" };
    mockFieldSetVisitStatus.mockReturnValue(new Promise(() => {}));
    const { get } = makeStore();
    seedDbJob(get, "j-arrive", [visit, sibling]);

    get().setVisitStatus("j-arrive", visit.id, "onsite", "field");
    // The snapshot knows something new about the SIBLING; only the written visit is pinned.
    get().setJobs([staleSnapshot([visit, { ...sibling, status: "done" }])]);

    expect(get().jobs[0]!.visits[0]!.status).toBe("onsite");
    expect(get().jobs[0]!.visits[1]!.status).toBe("done");
  });
});

// ---------------------------------------------------------------------------
// TWO TAPS, ONE VISIT — the guard against the PREDECESSOR's own reconcile.
//
// The guard above stops a stale HYDRATOR snapshot reverting a just-tapped step. It did not stop
// the write that armed it: "Start driving" and "On site" a second apart left op1 in flight when
// op2 armed the same map entry, and op1's `.then` deleted that entry unconditionally before
// reconciling its OWN dto — `pending` + a departure stamp, which maps back to "enroute". The
// sheet fell from On site to On the way and sat there for op2's whole round trip.
//
// Every existing two-tap test keeps BOTH mutations permanently pending, so none of them ever let
// the first op's reconcile resolve after the second tap. That is why it shipped.
// ---------------------------------------------------------------------------

describe("two taps on one visit (the in-flight predecessor's own reconcile)", () => {
  const ENROUTE_STAMP = "2026-07-15T08:40:00.000Z";

  /** A distinct visit id per test — the per-visit op chain is module state. */
  const scheduledVisit = (suffix: string) => ({
    id: `aaaaaaaa-0000-0000-0000-0000000000${suffix}`,
    date: null,
    techId: null,
    start: null,
    dur: 2,
    status: "scheduled",
  });

  beforeEach(() => {
    mockFieldSetVisitStatus.mockReset();
    mockFieldSetVisitEnroute.mockReset();
    mockUpdate.mockReset();
  });

  it("keeps On site when the still-in-flight On my way reconciles after it", async () => {
    const visit = scheduledVisit("b1");
    const drive = deferred<unknown>();
    mockFieldSetVisitEnroute.mockReturnValue(drive.promise);
    mockFieldSetVisitStatus.mockReturnValue(new Promise(() => {})); // op2 never settles
    const { get } = makeStore();
    seedDbJob(get, "j-two", [visit]);

    get().setVisitStatus("j-two", visit.id, "enroute", "field"); // t0
    get().setVisitStatus("j-two", visit.id, "onsite", "field"); // t1 — op1 still in flight
    expect(get().jobs[0]!.visits[0]!.status).toBe("onsite");

    // t2 — op1's own answer lands: pending + a departure stamp, i.e. "enroute".
    drive.resolve(
      makeJobDTO("j-two", {
        visits: [makeVisitDTO(visit.id, { status: "pending", enrouteAt: ENROUTE_STAMP })],
      }),
    );
    await flush();

    const v = get().jobs[0]!.visits[0]!;
    expect(v.status).toBe("onsite");
    expect(v.startedAt).toBeTruthy();
    // The server's departure stamp is still the authority for the step op1 owns.
    expect(v.enrouteAt).toBe(ENROUTE_STAMP);
  });

  it("a stale snapshot after the predecessor's reconcile still cannot revert the newer tap", async () => {
    const visit = scheduledVisit("b2");
    const drive = deferred<unknown>();
    mockFieldSetVisitEnroute.mockReturnValue(drive.promise);
    mockFieldSetVisitStatus.mockReturnValue(new Promise(() => {}));
    const { get } = makeStore();
    seedDbJob(get, "j-two", [visit]);

    get().setVisitStatus("j-two", visit.id, "enroute", "field");
    get().setVisitStatus("j-two", visit.id, "onsite", "field");
    drive.resolve(
      makeJobDTO("j-two", {
        visits: [makeVisitDTO(visit.id, { status: "pending", enrouteAt: ENROUTE_STAMP })],
      }),
    );
    await flush();

    // The refetch op1's reconcile dispatched resolves — a read taken before either tap.
    get().setJobs([{ ...draft, id: "j-two", origin: "db" as const, visits: [visit] }]);
    expect(get().jobs[0]!.visits[0]!.status).toBe("onsite");
  });

  it("a FAILED On my way discards neither the newer tap nor the work saved since", async () => {
    const visit = scheduledVisit("b3");
    const drive = deferred<unknown>();
    mockFieldSetVisitEnroute.mockReturnValue(drive.promise);
    mockFieldSetVisitStatus.mockReturnValue(new Promise(() => {}));
    mockUpdate.mockReturnValue(new Promise(() => {})); // the note stays optimistic
    const { get } = makeStore();
    seedDbJob(get, "j-two", [visit]);

    get().setVisitStatus("j-two", visit.id, "enroute", "field"); // t0
    get().setVisitStatus("j-two", visit.id, "onsite", "field"); // t1
    void get().updateJob("j-two", { notes: "shut-off is behind the dryer" }); // t1.5

    drive.reject(new Error("offline")); // t2 — op1 fails
    await flush();

    const j = get().jobs[0]!;
    // The whole-job snapshot op1 took at t0 predates BOTH: restoring it wiped the newer step
    // and the note with it.
    expect(j.visits[0]!.status).toBe("onsite");
    expect(j.visits[0]!.startedAt).toBeTruthy();
    expect(j.notes).toBe("shut-off is behind the dryer");
  });

  it("rolls a lone failed step back to what the server last confirmed", async () => {
    const visit = scheduledVisit("b4");
    mockFieldSetVisitEnroute.mockRejectedValue(new Error("offline"));
    const { get } = makeStore();
    seedDbJob(get, "j-two", [visit]);

    get().setVisitStatus("j-two", visit.id, "enroute", "field");
    await flush();

    const v = get().jobs[0]!.visits[0]!;
    expect(v.status).toBe("scheduled");
    expect(v.enrouteAt ?? null).toBeNull();
  });

  it("rolls a failed SECOND tap back to the first tap's confirmed step, not past it", async () => {
    const visit = scheduledVisit("b5");
    const drive = deferred<unknown>();
    mockFieldSetVisitEnroute.mockReturnValue(drive.promise);
    mockFieldSetVisitStatus.mockRejectedValue(new Error("offline"));
    const { get } = makeStore();
    seedDbJob(get, "j-two", [visit]);

    get().setVisitStatus("j-two", visit.id, "enroute", "field");
    get().setVisitStatus("j-two", visit.id, "onsite", "field");
    drive.resolve(
      makeJobDTO("j-two", {
        visits: [makeVisitDTO(visit.id, { status: "pending", enrouteAt: ENROUTE_STAMP })],
      }),
    );
    await flush();

    // The drive COMMITTED; only the arrival failed. Rolling back to the pre-drive snapshot would
    // deny a departure the server is holding.
    const v = get().jobs[0]!.visits[0]!;
    expect(v.status).toBe("enroute");
    expect(v.enrouteAt).toBe(ENROUTE_STAMP);
    expect(v.startedAt ?? null).toBeNull();
  });
});

describe("updateVisit duration debounce", () => {
  beforeEach(() => {
    mockCreateVisit.mockReset();
    mockUpdateVisitDuration.mockReset();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  const storeVisit = (id: string) =>
    ({ id, date: null, techId: null, start: null, dur: 2, status: "scheduled" });

  it("collapses a typing burst to ONE mutation carrying the LAST value", async () => {
    mockUpdateVisitDuration.mockResolvedValue(
      makeJobDTO("j-burst", { visits: [makeVisitDTO("bbbbbbbb-0000-0000-0000-000000000001", { durationMinutes: 300 })] }),
    );
    const { get } = makeStore();
    seedDbJob(get, "j-burst", [storeVisit("bbbbbbbb-0000-0000-0000-000000000001")]);

    get().updateVisit("j-burst", "bbbbbbbb-0000-0000-0000-000000000001", { dur: 3 });
    get().updateVisit("j-burst", "bbbbbbbb-0000-0000-0000-000000000001", { dur: 5 });
    await vi.advanceTimersByTimeAsync(400);
    await flush();

    expect(mockUpdateVisitDuration).toHaveBeenCalledTimes(1);
    expect(mockUpdateVisitDuration).toHaveBeenCalledWith(
      expect.objectContaining({ durationHours: 5 }),
    );
  });

  it("persists the CAPTURED value even when a reconcile stomps the store dur inside the window", async () => {
    mockUpdateVisitDuration.mockResolvedValue(
      makeJobDTO("j-stomp", { visits: [makeVisitDTO("bbbbbbbb-0000-0000-0000-000000000002", { durationMinutes: 300 })] }),
    );
    const { get } = makeStore();
    seedDbJob(get, "j-stomp", [storeVisit("bbbbbbbb-0000-0000-0000-000000000002")]);

    get().updateVisit("j-stomp", "bbbbbbbb-0000-0000-0000-000000000002", { dur: 5 });
    // A stale snapshot lands during the debounce window and resets dur to 2.
    get().setJobs([{ ...draft, id: "j-stomp", origin: "db", visits: [storeVisit("bbbbbbbb-0000-0000-0000-000000000002")] }]);
    await vi.advanceTimersByTimeAsync(400);
    await flush();

    // The old code re-read the store here and would have sent 2.
    expect(mockUpdateVisitDuration).toHaveBeenCalledWith(
      expect.objectContaining({ durationHours: 5 }),
    );
  });

  it("serializes the duration mutation behind the visit's in-flight createVisit", async () => {
    const create = deferred<unknown>();
    mockCreateVisit.mockReturnValue(create.promise);
    mockUpdateVisitDuration.mockResolvedValue(makeJobDTO("j-chain", { visits: [] }));
    const { get } = makeStore();
    seedDbJob(get, "j-chain");

    const visit = get().addVisit("j-chain")!; // create stays pending
    get().updateVisit("j-chain", visit.id, { dur: 3 });
    await vi.advanceTimersByTimeAsync(400);
    await flush();

    // Debounce fired, but the mutation is queued behind the pending create.
    expect(mockUpdateVisitDuration).not.toHaveBeenCalled();

    create.resolve(makeJobDTO("j-chain", { visits: [makeVisitDTO(visit.id)] }));
    await flush();

    expect(mockUpdateVisitDuration).toHaveBeenCalledTimes(1);
    expect(mockUpdateVisitDuration).toHaveBeenCalledWith(
      expect.objectContaining({ visitId: visit.id, durationHours: 3 }),
    );
  });
});

// ---------------------------------------------------------------------------
// Review batch 2 — Fix 1 (HIGH): removeVisit must be chained behind the visit's
// own createVisit, and no snapshot merge may re-introduce a visit the user
// optimistically removed while its delete is unsettled.
// ---------------------------------------------------------------------------

describe("removeVisit vs in-flight createVisit", () => {
  beforeEach(() => {
    mockCreateVisit.mockReset();
    mockRemoveVisit.mockReset();
  });

  it("queues the delete behind the create and keeps the visit gone after the create reconciles", async () => {
    const create = deferred<unknown>();
    mockCreateVisit.mockReturnValue(create.promise);
    const { get } = makeStore();
    seedDbJob(get, "j-rm-race");

    const visit = get().addVisit("j-rm-race")!;
    get().removeVisit("j-rm-race", visit.id);
    expect(get().jobs[0]!.visits).toHaveLength(0); // optimistic removal

    await flush();
    // The delete waits for the create — nothing sent yet.
    expect(mockRemoveVisit).not.toHaveBeenCalled();

    // The create commits; its reconcile DTO still CONTAINS the removed visit.
    mockRemoveVisit.mockResolvedValue(makeJobDTO("j-rm-race", { visits: [] }));
    create.resolve(makeJobDTO("j-rm-race", { visits: [makeVisitDTO(visit.id)] }));
    await flush();

    expect(get().jobs[0]!.visits).toHaveLength(0); // create reconcile did NOT resurrect it
    expect(mockRemoveVisit).toHaveBeenCalledTimes(1);
    expect(mockRemoveVisit).toHaveBeenCalledWith({ jobId: "j-rm-race", visitId: visit.id });
  });

  it("skips the delete entirely when the create rolled back (no row to remove)", async () => {
    const create = deferred<unknown>();
    mockCreateVisit.mockReturnValue(create.promise);
    const { get } = makeStore();
    seedDbJob(get, "j-rm-dead");

    const visit = get().addVisit("j-rm-dead")!;
    get().removeVisit("j-rm-dead", visit.id);
    create.reject(new Error("network"));
    await flush();

    expect(mockRemoveVisit).not.toHaveBeenCalled();
    expect(get().jobs[0]!.visits).toHaveLength(0); // stays deleted — not resurrected
  });

  it("a snapshot merge cannot re-introduce a visit whose removal is still in flight", async () => {
    const remove = deferred<unknown>();
    mockRemoveVisit.mockReturnValue(remove.promise);
    const serverVisit = { id: "cccccccc-0000-0000-0000-000000000001", date: null, techId: null, start: null, dur: 2, status: "scheduled" };
    const { get } = makeStore();
    seedDbJob(get, "j-rm-snap", [serverVisit]);

    get().removeVisit("j-rm-snap", serverVisit.id);
    await flush();

    // A stale hydrator snapshot that still contains the removed visit.
    get().setJobs([{ ...draft, id: "j-rm-snap", origin: "db", visits: [serverVisit] }]);
    expect(get().jobs[0]!.visits).toHaveLength(0);

    remove.resolve(makeJobDTO("j-rm-snap", { visits: [] }));
    await flush();
    expect(get().jobs[0]!.visits).toHaveLength(0);
  });

  it("rolls the visit back when the delete itself fails", async () => {
    mockRemoveVisit.mockRejectedValue(new Error("boom"));
    const serverVisit = { id: "cccccccc-0000-0000-0000-000000000002", date: null, techId: null, start: null, dur: 2, status: "scheduled" };
    const { get } = makeStore();
    seedDbJob(get, "j-rm-fail", [serverVisit]);

    get().removeVisit("j-rm-fail", serverVisit.id);
    expect(get().jobs[0]!.visits).toHaveLength(0); // optimistic
    await flush();
    expect(get().jobs[0]!.visits).toHaveLength(1); // restored on failure
  });
});

// ---------------------------------------------------------------------------
// Review batch 2 — Fix 2 (MEDIUM): a chained mutation queued behind a
// createVisit that rolled back must re-check the visit at EXECUTION time and
// must not restore a rollback snapshot for a visit that is no longer in the
// store (that would resurrect a phantom).
// ---------------------------------------------------------------------------

describe("chained op execution guards (create rollback / mid-flight removal)", () => {
  beforeEach(() => {
    mockCreateVisit.mockReset();
    mockUpdateVisitDuration.mockReset();
    mockRemoveVisit.mockReset();
    mockScheduleVisit.mockReset();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  const storeVisit = (id: string) =>
    ({ id, date: null, techId: null, start: null, dur: 2, status: "scheduled" });

  it("skips the queued duration mutate when its createVisit rolled back", async () => {
    const create = deferred<unknown>();
    mockCreateVisit.mockReturnValue(create.promise);
    const { get } = makeStore();
    seedDbJob(get, "j-dur-dead");

    const visit = get().addVisit("j-dur-dead")!;
    get().updateVisit("j-dur-dead", visit.id, { dur: 3 });
    await vi.advanceTimersByTimeAsync(400); // timer fires while the create is in flight
    create.reject(new Error("network"));    // create rolls back; optimistic visit removed
    await flush();

    expect(mockUpdateVisitDuration).not.toHaveBeenCalled();
    expect(get().jobs[0]!.visits).toHaveLength(0); // NOT resurrected by a rollback restore
  });

  it("does not restore a removed visit when the duration mutate fails after the removal", async () => {
    const dur = deferred<unknown>();
    mockUpdateVisitDuration.mockReturnValue(dur.promise);
    mockRemoveVisit.mockResolvedValue(makeJobDTO("j-dur-rm", { visits: [] }));
    const v = storeVisit("cccccccc-0000-0000-0000-000000000003");
    const { get } = makeStore();
    seedDbJob(get, "j-dur-rm", [v]);

    get().updateVisit("j-dur-rm", v.id, { dur: 4 });
    await vi.advanceTimersByTimeAsync(400);
    await flush(); // duration mutate now in flight

    get().removeVisit("j-dur-rm", v.id); // optimistic removal; delete queued behind the dur op
    dur.reject(new Error("conflict"));
    await flush();

    expect(get().jobs[0]!.visits).toHaveLength(0); // preDragSnapshot NOT restored
  });

  it("skips the queued scheduleVisit when its createVisit rolled back", async () => {
    const create = deferred<unknown>();
    mockCreateVisit.mockReturnValue(create.promise);
    const { get } = makeStore();
    seedDbJob(get, "j-place-dead");

    const visit = get().addVisit("j-place-dead")!;
    get().placeVisit("j-place-dead", visit.id, { techId: "t1", date: "2026-07-13", start: 9 });
    create.reject(new Error("network"));
    await flush();

    expect(mockScheduleVisit).not.toHaveBeenCalled();
    expect(get().jobs[0]!.visits).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Review batch 2 — Fix 3 (MEDIUM): a stale hydrator setJobs snapshot must not
// sweep out a job adopted from a server mutation (quoting.accept) after the
// snapshot's read started. Mirrors the pending-create visit guard.
// ---------------------------------------------------------------------------

describe("setJobs adoption guard (adoptJob vs stale hydrator snapshot)", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("keeps a recently-adopted job that is absent from an older snapshot", () => {
    const { get } = makeStore();
    get().adoptJob(makeAcceptJobDTO("adopt-guard-1") as never);
    // Stale snapshot (read before the accept committed) without the adopted job.
    get().setJobs([{ ...draft, id: "other-job", origin: "db" }]);
    expect(get().jobs.some((j) => j.id === "adopt-guard-1")).toBe(true);
    expect(get().jobs.some((j) => j.id === "other-job")).toBe(true);
  });

  it("stops protecting once the adoption is older than the hydrator stale window", () => {
    vi.setSystemTime(new Date("2026-07-12T00:00:00Z"));
    const { get } = makeStore();
    get().adoptJob(makeAcceptJobDTO("adopt-guard-2") as never);
    vi.setSystemTime(new Date("2026-07-12T00:00:31Z")); // > 30 s HYDRATOR_STALE_MS
    get().setJobs([]);
    expect(get().jobs.some((j) => j.id === "adopt-guard-2")).toBe(false);
  });

  it("hands authority back to the server once a snapshot includes the job", () => {
    const { get } = makeStore();
    get().adoptJob(makeAcceptJobDTO("adopt-guard-3") as never);
    get().setJobs([{ ...draft, id: "adopt-guard-3", origin: "db" }]); // server knows it now
    get().setJobs([]); // later authoritative snapshot without it
    expect(get().jobs.some((j) => j.id === "adopt-guard-3")).toBe(false);
  });

  it("deleteJob clears the guard so a snapshot cannot resurrect a deleted job", () => {
    mockArchive.mockResolvedValue({ ok: true });
    const { get } = makeStore();
    get().adoptJob(makeAcceptJobDTO("adopt-guard-4") as never);
    get().deleteJob("adopt-guard-4");
    get().setJobs([]);
    expect(get().jobs.some((j) => j.id === "adopt-guard-4")).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Review batch 2 — LOW: the addVisit dedupe silently ignored a caller-passed
// dur; an explicitly-requested duration now applies to the deduped visit.
// ---------------------------------------------------------------------------

describe("addVisit dedupe applies an explicit dur", () => {
  beforeEach(() => {
    mockCreateVisit.mockReset();
    mockUpdateVisitDuration.mockReset();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("applies an explicitly-passed dur to the deduped pending visit and persists it", async () => {
    const create = deferred<unknown>();
    mockCreateVisit.mockReturnValue(create.promise);
    const { get } = makeStore();
    seedDbJob(get, "j-dedupe-dur");

    const first = get().addVisit("j-dedupe-dur")!;      // default dur 2
    const second = get().addVisit("j-dedupe-dur", 4)!;  // dedupe + explicit dur
    expect(second.id).toBe(first.id);
    expect(second.dur).toBe(4);
    expect(get().jobs[0]!.visits[0]!.dur).toBe(4); // optimistic

    mockUpdateVisitDuration.mockResolvedValue(
      makeJobDTO("j-dedupe-dur", { visits: [makeVisitDTO(first.id, { durationMinutes: 240 })] }),
    );
    await vi.advanceTimersByTimeAsync(400);
    create.resolve(makeJobDTO("j-dedupe-dur", { visits: [makeVisitDTO(first.id)] }));
    await flush();

    expect(mockUpdateVisitDuration).toHaveBeenCalledWith(
      expect.objectContaining({ visitId: first.id, durationHours: 4 }),
    );
    expect(get().jobs[0]!.visits[0]!.dur).toBe(4);
  });

  it("without an explicit dur the deduped visit keeps its duration", async () => {
    const create = deferred<unknown>();
    mockCreateVisit.mockReturnValue(create.promise);
    const { get } = makeStore();
    seedDbJob(get, "j-dedupe-nodur");

    const first = get().addVisit("j-dedupe-nodur", 3)!;
    const second = get().addVisit("j-dedupe-nodur")!; // no dur passed — leave as-is
    expect(second.id).toBe(first.id);
    expect(get().jobs[0]!.visits[0]!.dur).toBe(3);
    await vi.advanceTimersByTimeAsync(400);
    await flush();
    expect(mockUpdateVisitDuration).not.toHaveBeenCalled();
  });
});

describe("archiveJob / deleteJob persist", () => {
  beforeEach(() => { mockArchive.mockReset(); });

  it("archiveJob marks archived optimistically and calls v1.jobs.archive", () => {
    mockArchive.mockResolvedValue({ ok: true });
    const { get } = makeStore();
    // Seed a db-origin job directly via setJobs so leadId presence is irrelevant.
    get().setJobs([{ ...draft, id: "j-arch", origin: "db" }]);
    get().archiveJob("j-arch");
    expect(get().jobs.find((j) => j.id === "j-arch")!.archived).toBe(true);
    expect(mockArchive).toHaveBeenCalledWith({ jobId: "j-arch" });
  });

  it("deleteJob removes the job optimistically and calls v1.jobs.archive", () => {
    mockArchive.mockResolvedValue({ ok: true });
    const { get } = makeStore();
    get().setJobs([{ ...draft, id: "j-del", origin: "db" }]);
    get().deleteJob("j-del");
    expect(get().jobs.some((j) => j.id === "j-del")).toBe(false);
    expect(mockArchive).toHaveBeenCalledWith({ jobId: "j-del" });
  });

  it("archiveJob does NOT call the server for a local-only (leadless manual) job", () => {
    mockArchive.mockResolvedValue({ ok: true });
    const { get } = makeStore();
    get().setJobs([{ ...draft, id: "j-local", origin: "manual" }]);
    get().archiveJob("j-local");
    expect(mockArchive).not.toHaveBeenCalled();
  });
});

// The MONEY-persistence path: on-site prices must reach the DB via v1.jobs.setLines
// (updateJob's payload builder drops `lines`), and must survive the post-"Mark done"
// jobs.list refetch that races the setLines commit.
describe("setJobLines persist + refetch survival", () => {
  beforeEach(() => { mockSetLines.mockReset(); });

  const priced = [
    { d: "Diagnostic", q: 1, r: 120 },
    { d: "Parts", q: 2, r: 40, c: 15 },
  ];

  it("optimistically sets lines and persists via v1.jobs.setLines with cents", async () => {
    // Echo the two lines back so the reconcile keeps them.
    mockSetLines.mockResolvedValue(makeJobDTO("j-price", {
      lines: [
        { id: "srv-l1", description: "Diagnostic", quantity: 1, rate: { cents: 12000, currency: "USD" }, cost: null },
        { id: "srv-l2", description: "Parts", quantity: 2, rate: { cents: 4000, currency: "USD" }, cost: { cents: 1500, currency: "USD" } },
      ],
    }));
    const { get } = makeStore();
    get().setJobs([{ ...draft, id: "j-price", origin: "db", lines: [] }]);

    const res = await get().setJobLines("j-price", priced);
    expect(res.ok).toBe(true);
    // Store lines are in DOLLARS; wire payload is in integer CENTS.
    expect(mockSetLines).toHaveBeenCalledWith({
      jobId: "j-price",
      lines: [
        { description: "Diagnostic", quantity: 1, rateCents: 12000, costCents: 0 },
        { description: "Parts", quantity: 2, rateCents: 4000, costCents: 1500 },
      ],
    });
    const job = get().jobs.find((j) => j.id === "j-price")!;
    expect(job.lines).toHaveLength(2);
    expect(job.lines[0]).toMatchObject({ d: "Diagnostic", r: 120 });
    expect(job.lines[1]).toMatchObject({ d: "Parts", r: 40, c: 15 });
  });

  it("does NOT persist for a local-only (non-db) job, keeping lines store-only", async () => {
    const { get } = makeStore();
    get().setJobs([{ ...draft, id: "j-local-price", origin: "manual", lines: [] }]);
    const res = await get().setJobLines("j-local-price", priced);
    expect(res.ok).toBe(true);
    expect(mockSetLines).not.toHaveBeenCalled();
    expect(get().jobs.find((j) => j.id === "j-local-price")!.lines).toHaveLength(2);
  });

  it("survives a stale setJobs refetch during the write window (recent-line guard)", async () => {
    // The server echoes the priced lines.
    mockSetLines.mockResolvedValue(makeJobDTO("j-guard", {
      lines: [
        { id: "srv-l1", description: "Diagnostic", quantity: 1, rate: { cents: 12000, currency: "USD" }, cost: null },
        { id: "srv-l2", description: "Parts", quantity: 2, rate: { cents: 4000, currency: "USD" }, cost: { cents: 1500, currency: "USD" } },
      ],
    }));
    const { get } = makeStore();
    get().setJobs([{ ...draft, id: "j-guard", origin: "db", lines: [] }]);
    await get().setJobLines("j-guard", priced);

    // A hydrator snapshot read BEFORE the setLines commit lands (empty lines) must
    // NOT erase the just-written price — the _recentLineWrites guard protects it.
    get().setJobs([{ ...draft, id: "j-guard", origin: "db", lines: [] }]);
    const job = get().jobs.find((j) => j.id === "j-guard")!;
    expect(job.lines).toHaveLength(2);
  });

  it("rolls back to the prior lines and reports { ok:false } when the persist fails", async () => {
    mockSetLines.mockRejectedValue(new Error("db down"));
    const { get } = makeStore();
    const original = [{ d: "Old", q: 1, r: 50 }];
    get().setJobs([{ ...draft, id: "j-fail", origin: "db", lines: original }]);

    const res = await get().setJobLines("j-fail", priced);
    expect(res.ok).toBe(false);
    // No silent loss: the prior lines are restored, not left as the failed optimistic set.
    const job = get().jobs.find((j) => j.id === "j-fail")!;
    expect(job.lines).toEqual(original);
  });

  // Fix 1 (batch 6): the close-out "enter a bill" path (commitBill) persists the
  // MERGED FULL SET (existing job.lines + the newly-entered bill) through
  // setJobLines — setLines is a bulk replace, not an append. The persisted
  // price must survive the post-"Log & send" refetch (recent-line guard),
  // exactly like the tech-quote / price-builder surfaces.
  it("persists the merged full set (existing + new bill) and survives a refetch", async () => {
    const existing = [{ d: "Diagnostic", q: 1, r: 89 }];
    const merged = [...existing, { d: "Work performed", q: 1, r: 450 }];
    // Server echoes the merged set back.
    mockSetLines.mockResolvedValue(makeJobDTO("j-closeout", {
      lines: [
        { id: "srv-l1", description: "Diagnostic", quantity: 1, rate: { cents: 8900, currency: "USD" }, cost: null },
        { id: "srv-l2", description: "Work performed", quantity: 1, rate: { cents: 45000, currency: "USD" }, cost: null },
      ],
    }));
    const { get } = makeStore();
    get().setJobs([{ ...draft, id: "j-closeout", origin: "db", lines: existing }]);

    // commitBill passes the complete intended set — not an append delta.
    const res = await get().setJobLines("j-closeout", merged);
    expect(res.ok).toBe(true);
    expect(mockSetLines).toHaveBeenCalledWith({
      jobId: "j-closeout",
      lines: [
        { description: "Diagnostic", quantity: 1, rateCents: 8900, costCents: 0 },
        { description: "Work performed", quantity: 1, rateCents: 45000, costCents: 0 },
      ],
    });
    // A stale post-"Log & send" refetch (empty lines) must NOT erase the bill.
    get().setJobs([{ ...draft, id: "j-closeout", origin: "db", lines: [] }]);
    const job = get().jobs.find((j) => j.id === "j-closeout")!;
    expect(job.lines).toHaveLength(2);
    expect(job.lines[1]).toMatchObject({ d: "Work performed", r: 450 });
  });

  // Fix 2 (batch 6): the optimistic set applies the SAME predicate as the wire
  // payload (drop r == null / blank description), so a line the wire drops
  // never lingers in the store behind the _recentLineWrites guard.
  it("optimistic set drops the same non-persistable lines the wire payload drops", async () => {
    mockSetLines.mockResolvedValue(makeJobDTO("j-filter", {
      lines: [
        { id: "srv-l1", description: "Real line", quantity: 1, rate: { cents: 10000, currency: "USD" }, cost: null },
      ],
    }));
    const { get } = makeStore();
    get().setJobs([{ ...draft, id: "j-filter", origin: "db", lines: [] }]);

    // A redacted-rate line (r: null) and a blank-description line must NOT reach
    // the store optimistically — they never reach the wire either.
    const mixed = [
      { d: "Real line", q: 1, r: 100 },
      { d: "Redacted", q: 1, r: null as unknown as number },
      { d: "   ", q: 1, r: 200 },
    ];
    // Read the store synchronously right after the optimistic set (before await).
    const p = get().setJobLines("j-filter", mixed);
    const optimistic = get().jobs.find((j) => j.id === "j-filter")!;
    expect(optimistic.lines).toHaveLength(1);
    expect(optimistic.lines[0]).toMatchObject({ d: "Real line", r: 100 });
    await p;
    expect(mockSetLines).toHaveBeenCalledWith({
      jobId: "j-filter",
      lines: [{ description: "Real line", quantity: 1, rateCents: 10000, costCents: 0 }],
    });
  });
});

// ---------------------------------------------------------------------------
// The optimistic status derivation — the THIRD copy of the terminal-status rule.
//
// dbe2fc8 gave the two DTO mappers (dto-mapper's dtoJobToStoreJob and the jobs hydrator's
// toStoreJob) a guard: a terminal backend status always outranks the visit-placement recalc.
// It missed this one, and no test covered it — which is exactly why that commit shipped green.
//
// A job completed straight from My Day has one complete visit that nobody dragged onto the
// Schedule board, so NOTHING is placed. Without the guard, the next optimistic visit write
// derived that job back to "unscheduled": its revenue dropped out of Money's ready-to-bill list
// and the field's done card swapped out from under the technician mid-close-out.
// ---------------------------------------------------------------------------

describe("optimistic visit writes never derive away a terminal status", () => {
  const UNPLACED_DONE_VISIT = {
    id: "aaaaaaaa-0000-0000-0000-0000000000f1",
    date: null, techId: null, start: null, dur: 1, status: "done",
  };
  const PLACED_DONE_VISIT = {
    id: "aaaaaaaa-0000-0000-0000-0000000000f2",
    date: "2026-07-30", techId: "tech-1", start: 9, dur: 1, status: "done",
  };

  const seedDoneJob = (get: ReturnType<typeof makeStore>["get"], visits: Job["visits"]) => {
    get().setJobs([{ ...draft, id: "j-done", origin: "db", status: "done", visits }]);
  };

  beforeEach(() => {
    mockSetVisitStatus.mockReset();
    mockUpdateVisitDuration.mockReset();
    mockCreateVisit.mockReset();
  });

  it("keeps a done job done when its only visit was never placed", () => {
    mockUpdateVisitDuration.mockReturnValue(new Promise(() => {}));
    const { get } = makeStore();
    seedDoneJob(get, [UNPLACED_DONE_VISIT]);

    get().updateVisit("j-done", UNPLACED_DONE_VISIT.id, { dur: 2 });

    expect(get().jobs[0]!.status).toBe("done");
  });

  it("keeps a done job done when a new (unplaced) visit is added to it", () => {
    mockCreateVisit.mockReturnValue(new Promise(() => {}));
    const { get } = makeStore();
    seedDoneJob(get, [UNPLACED_DONE_VISIT]);

    get().addVisit("j-done");

    expect(get().jobs[0]!.status).toBe("done");
  });

  it("still reads an unplaced visit on a NON-terminal job as unscheduled", () => {
    mockUpdateVisitDuration.mockReturnValue(new Promise(() => {}));
    const { get } = makeStore();
    get().setJobs([
      { ...draft, id: "j-open", origin: "db", status: "scheduled", visits: [
        { ...UNPLACED_DONE_VISIT, status: "scheduled" },
      ] },
    ]);

    get().updateVisit("j-open", UNPLACED_DONE_VISIT.id, { dur: 2 });

    expect(get().jobs[0]!.status).toBe("unscheduled");
  });

  // The reviewer's divergence case: cancel-job.ts does not cascade to visits, so a canceled job
  // can still carry a placed PENDING one, and those jobs are still drawn on the board. Guarding
  // only the no-placed-visit branch left the three copies disagreeing — both mappers said "done",
  // this one said "scheduled".
  it("keeps a terminal job terminal even with a placed, still-pending visit", () => {
    mockUpdateVisitDuration.mockReturnValue(new Promise(() => {}));
    const { get } = makeStore();
    seedDoneJob(get, [{ ...PLACED_DONE_VISIT, status: "scheduled" }]);

    get().updateVisit("j-done", PLACED_DONE_VISIT.id, { dur: 3 });

    expect(get().jobs[0]!.status).toBe("done");
  });

  // Reopen's JOB-level flip is the server's call (set-visit-status.ts reopens a complete job
  // before the visit write, and re-completes it if the set still ends up all-complete) — not
  // something this optimistic leg may guess from a stale status. The VISIT moves instantly; the
  // job follows on the reconcile.
  it("moves the visit instantly on Reopen and lets the reconcile move the job", async () => {
    mockSetVisitStatus.mockResolvedValue(
      makeJobDTO("j-done", {
        status: "scheduled",
        visits: [makeVisitDTO(PLACED_DONE_VISIT.id, {
          status: "pending", assigneeUserId: "tech-1",
          scheduledDate: "2026-07-30", scheduledStart: "09:00", scheduledEnd: "10:00",
        })],
      }),
    );
    const { get } = makeStore();
    seedDoneJob(get, [PLACED_DONE_VISIT]);

    get().setVisitStatus("j-done", PLACED_DONE_VISIT.id, "scheduled", "office");
    expect(get().jobs[0]!.visits[0]!.status).toBe("scheduled");

    await flush();
    expect(get().jobs[0]!.status).toBe("scheduled");
  });
});

// ---------------------------------------------------------------------------
// The execution merge guard — a record carrying no execution must not un-price a job.
//
// The bug: the store REPLACES a job from whatever a mutation returns, and the visit endpoints
// returned a job header with `lines: []` because toJobDTO defaults to an empty execution. So every
// visit tap wiped the price client-side. The technician's done card then read "No price set — the
// office invoices it" on an agreed $185, the next list refetch (which does carry lines) put the
// $185 back, and the card flapped between the two in front of the customer.
//
// Driven through the REAL mappers — the hydrator's list mapper and the mutation-reconcile mapper —
// because the whole failure lived in the gap between the two wire shapes, and a hand-written store
// fixture would test neither.
// ---------------------------------------------------------------------------

describe("execution merge guard (a lines-less record cannot un-price a job)", () => {
  const PRICED_LINE = {
    id: "line-1",
    description: "Annual plumbing inspection",
    quantity: 1,
    rate: { cents: 18500, currency: "USD" },
    cost: { cents: 4000, currency: "USD" },
    position: 0,
  };

  /** A v1.jobs.list row, shaped as the wire sends it, run through the hydrator's own mapper. */
  const listRow = (id: string, lines: unknown[]) =>
    toStoreJob({
      id,
      num: "JOB-2545",
      leadId: "lead-1",
      customerName: "Summit customer",
      sourceEstimateId: null,
      title: "Flat rate test 3",
      svc: "service",
      kind: "work",
      status: "complete",
      assigneeUserId: null,
      scheduledStart: null,
      // The stale header total the list used to carry on a priced job. The store derives money
      // from the LINES, so this must not be what decides anything.
      total: { cents: 0, currency: "USD" },
      notes: "",
      addr: "",
      phone: "",
      completion: null,
      invRequested: false,
      scope: null,
      callbackOf: null,
      callbackReason: null,
      checklist: null,
      requiredCerts: null,
      visits: [],
      createdAt: "2026-08-04T22:35:40.743Z",
      lines,
      addons: [],
      verifyAnswers: [],
      photos: [],
    } as never);

  const jobTotal = (j: Job) => (j.lines ?? []).reduce((s, l) => s + (l.q ?? 1) * (l.r ?? 0), 0);

  it("a hydrator refetch that carries the lines keeps the job priced", () => {
    const { get } = makeStore();
    get().setJobs([listRow("j-2545", [PRICED_LINE])]);
    get().setJobs([listRow("j-2545", [PRICED_LINE])]);
    expect(jobTotal(get().jobs[0]!)).toBe(185);
  });

  it("a refetch carrying NO execution leaves the priced job priced", () => {
    const { get } = makeStore();
    get().setJobs([listRow("j-2545", [PRICED_LINE])]);
    expect(jobTotal(get().jobs[0]!)).toBe(185);

    // The record the bug shipped: same job, no lines at all.
    get().setJobs([listRow("j-2545", [])]);
    expect(get().jobs[0]!.lines).toHaveLength(1);
    expect(jobTotal(get().jobs[0]!)).toBe(185);
  });

  it("a visit tap whose response omits the execution does not un-price the job", async () => {
    // This is the exact response shape the visit endpoints used to return: a full job header
    // built by toJobDTO with no execution argument, so `lines` arrives absent.
    const visitId = "aaaaaaaa-0000-0000-0000-00000000e001";
    mockSetVisitStatus.mockResolvedValue(
      makeJobDTO("j-2545", {
        status: "complete",
        visits: [makeVisitDTO(visitId, { status: "complete" })],
      }),
    );
    const { get } = makeStore();
    get().setJobs([
      {
        ...listRow("j-2545", [PRICED_LINE]),
        origin: "db",
        visits: [{ id: visitId, date: null, techId: null, start: null, dur: 2, status: "scheduled" }],
      },
    ]);

    get().setVisitStatus("j-2545", visitId, "done", "office");
    await flush();

    expect(mockSetVisitStatus).toHaveBeenCalled();
    expect(get().jobs[0]!.lines).toHaveLength(1);
    expect(jobTotal(get().jobs[0]!)).toBe(185);
  });

  it("clearing the price on THIS device still clears it", async () => {
    // The guard must not become a ratchet. setJobLines empties the store job optimistically, so
    // by the time the (also empty) reconcile lands there is nothing left to re-attach.
    mockSetLines.mockResolvedValue(makeJobDTO("j-2545", { lines: [] }));
    const { get } = makeStore();
    get().setJobs([{ ...listRow("j-2545", [PRICED_LINE]), origin: "db" }]);

    const res = await get().setJobLines("j-2545", []);
    expect(res.ok).toBe(true);
    expect(get().jobs[0]!.lines).toHaveLength(0);
    expect(jobTotal(get().jobs[0]!)).toBe(0);
  });

  it("a job that genuinely has no lines is not given somebody else's", () => {
    const { get } = makeStore();
    get().setJobs([listRow("j-unpriced", [])]);
    get().setJobs([listRow("j-unpriced", [])]);
    expect(get().jobs[0]!.lines).toHaveLength(0);
  });
});

/**
 * THE OPTIMISTIC STATUS MUST AGREE WITH THE SERVER'S.
 *
 * set-visit-status.ts derives the job from EVERY ACTIVE visit: "every active (non-canceled) visit
 * complete → the job completes". The store's optimistic copy filtered to PLACED visits first, and
 * a return trip booked from the field has no date, no tech and no start — that is precisely what
 * makes it outstanding. So finishing the one placed visit made the store call the job done, the
 * sheet swapped to its close-out branch ("Take payment"), and the server's answer — still open —
 * swapped it back a moment later. That flash is the whole bug.
 */
describe("setVisitStatus — a job with an unplaced return trip stays open", () => {
  const PLACED = {
    id: "aaaaaaaa-0000-0000-0000-0000000000c1",
    date: "2026-08-10",
    techId: "tech-1",
    start: 12,
    dur: 1.5,
    status: "scheduled",
  };
  // What field.addFollowUpVisit writes: no date, no tech, waiting on the office.
  const RETURN_TRIP = {
    id: "aaaaaaaa-0000-0000-0000-0000000000c2",
    date: null,
    techId: null,
    start: null,
    dur: 1,
    status: "scheduled",
  };

  beforeEach(() => { mockSetVisitStatus.mockReset(); });

  it("does not flash the job to done when the placed visit finishes", () => {
    const { get } = makeStore();
    seedDbJob(get, "j-return", [PLACED, RETURN_TRIP] as Job["visits"]);

    get().setVisitStatus("j-return", PLACED.id, "done", "field");

    // OPTIMISTIC state, read synchronously — before any server answer.
    expect(get().jobs.find((j) => j.id === "j-return")?.status).toBe("scheduled");
  });

  it("still completes the job once the return trip is done too", () => {
    const { get } = makeStore();
    seedDbJob(get, "j-return-2", [
      { ...PLACED, status: "done" },
      RETURN_TRIP,
    ] as Job["visits"]);

    get().setVisitStatus("j-return-2", RETURN_TRIP.id, "done", "field");

    expect(get().jobs.find((j) => j.id === "j-return-2")?.status).toBe("done");
  });
});
