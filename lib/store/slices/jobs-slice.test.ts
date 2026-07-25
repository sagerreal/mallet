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
  beforeEach(() => { mockCreate.mockReset(); });

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
});

describe("buildJobUpdatePayload", () => {
  it("maps title/svc/notes to the update payload", () => {
    expect(buildJobUpdatePayload("j1", { title: "New" })).toEqual({ jobId: "j1", title: "New" });
    expect(buildJobUpdatePayload("j1", { svc: "estimate" })).toEqual({ jobId: "j1", svc: "estimate" });
    expect(buildJobUpdatePayload("j1", { notes: "x" })).toEqual({ jobId: "j1", notes: "x" });
  });

  it("returns null for a local-only patch (lines/addr/phone/status)", () => {
    expect(buildJobUpdatePayload("j1", { lines: [] })).toBeNull();
    expect(buildJobUpdatePayload("j1", { addr: "1 Main" })).toBeNull();
    expect(buildJobUpdatePayload("j1", { phone: "555" })).toBeNull();
    expect(buildJobUpdatePayload("j1", { invRequested: true })).toBeNull();
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

describe("setJobSvc persist", () => {
  beforeEach(() => { mockUpdate.mockReset(); });

  it("routes through update with { svc }", () => {
    mockUpdate.mockResolvedValue({} as never);
    const { get } = makeStore();
    const { job: created } = get().addJob({ ...draft, leadId: "" });
    get().setJobSvc(created.id, "estimate");
    expect(get().jobs.find((j) => j.id === created.id)!.svc).toBe("estimate");
    expect(mockUpdate).toHaveBeenCalledWith(expect.objectContaining({ jobId: created.id, svc: "estimate" }));
  });

  it("sends svc: null to mutate and clears the store svc when called with null", () => {
    mockUpdate.mockResolvedValue({} as never);
    const { get } = makeStore();
    const { job: created } = get().addJob({ ...draft, leadId: "", svc: "estimate" });
    get().setJobSvc(created.id, null);
    expect(get().jobs.find((j) => j.id === created.id)!.svc).toBeNull();
    expect(mockUpdate).toHaveBeenCalledWith(expect.objectContaining({ jobId: created.id, svc: null }));
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
