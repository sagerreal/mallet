import { describe, it, expect, vi, beforeEach } from "vitest";

const mockCreate = vi.fn();
const mockUpdate = vi.fn();
const mockArchive = vi.fn();

vi.mock("@/lib/trpc/vanilla", () => ({
  trpcVanilla: {
    v1: {
      jobs: {
        create: { mutate: (...a: unknown[]) => mockCreate(...a) },
        update: { mutate: (...a: unknown[]) => mockUpdate(...a) },
        archive: { mutate: (...a: unknown[]) => mockArchive(...a) },
      },
      visits: {
        createVisit: { mutate: vi.fn() },
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

describe("addJob persist", () => {
  beforeEach(() => { mockCreate.mockReset(); });

  it("optimistically inserts the job and returns it synchronously", () => {
    mockCreate.mockResolvedValue({ id: "srv", num: "JOB-1", leadId: "lead-1", sourceEstimateId: null, assigneeUserId: null, title: "Water heater", status: "scheduled", scheduledStart: null, scheduledEnd: null, startedAt: null, completedAt: null, canceledAt: null, cancelReason: null, total: { cents: 0, currency: "USD" }, notes: "gate 4", svc: "service", visits: [], createdAt: "2026-07-10T00:00:00.000Z" });
    const { get } = makeStore();
    const created = get().addJob(draft);
    expect(created.id).toBeTruthy();
    expect(get().jobs[0]!.id).toBe(created.id);
  });

  it("sends a client-authored id + leadId/svc to v1.jobs.create", () => {
    mockCreate.mockResolvedValue({} as never);
    const { get } = makeStore();
    const created = get().addJob(draft);
    expect(mockCreate).toHaveBeenCalledWith(
      expect.objectContaining({ id: created.id, leadId: "lead-1", svc: "service", title: "Water heater" }),
    );
  });

  it("does not call create when leadId is empty (unassigned manual job)", () => {
    mockCreate.mockResolvedValue({} as never);
    const { get } = makeStore();
    get().addJob({ ...draft, leadId: "" });
    expect(mockCreate).not.toHaveBeenCalled();
  });
});

describe("buildJobUpdatePayload", () => {
  it("maps title/svc/notes to the update payload", () => {
    expect(buildJobUpdatePayload("j1", { title: "New" })).toEqual({ jobId: "j1", title: "New" });
    expect(buildJobUpdatePayload("j1", { svc: "estimate" })).toEqual({ jobId: "j1", svc: "estimate" });
    expect(buildJobUpdatePayload("j1", { notes: "x" })).toEqual({ jobId: "j1", notes: "x" });
  });

  it("returns null for a local-only patch (lines/checklist/addr/phone/status)", () => {
    expect(buildJobUpdatePayload("j1", { lines: [] })).toBeNull();
    expect(buildJobUpdatePayload("j1", { checklist: undefined })).toBeNull();
    expect(buildJobUpdatePayload("j1", { addr: "1 Main" })).toBeNull();
    expect(buildJobUpdatePayload("j1", { phone: "555" })).toBeNull();
    expect(buildJobUpdatePayload("j1", { invRequested: true })).toBeNull();
  });
});

describe("updateJob persist", () => {
  beforeEach(() => { mockUpdate.mockReset(); });

  it("persists a title change via v1.jobs.update", () => {
    mockUpdate.mockResolvedValue({} as never);
    const { get } = makeStore();
    const created = get().addJob({ ...draft, leadId: "" }); // local-only add (no create call)
    get().updateJob(created.id, { title: "Renamed" });
    expect(get().jobs.find((j) => j.id === created.id)!.title).toBe("Renamed"); // optimistic
    expect(mockUpdate).toHaveBeenCalledWith(expect.objectContaining({ jobId: created.id, title: "Renamed" }));
  });

  it("does NOT call update for a local-only patch (lines)", () => {
    mockUpdate.mockResolvedValue({} as never);
    const { get } = makeStore();
    const created = get().addJob({ ...draft, leadId: "" });
    get().updateJob(created.id, { lines: [{ d: "x", q: 1, r: 100 }] });
    expect(mockUpdate).not.toHaveBeenCalled();
  });
});

describe("setJobSvc persist", () => {
  beforeEach(() => { mockUpdate.mockReset(); });

  it("routes through update with { svc }", () => {
    mockUpdate.mockResolvedValue({} as never);
    const { get } = makeStore();
    const created = get().addJob({ ...draft, leadId: "" });
    get().setJobSvc(created.id, "estimate");
    expect(get().jobs.find((j) => j.id === created.id)!.svc).toBe("estimate");
    expect(mockUpdate).toHaveBeenCalledWith(expect.objectContaining({ jobId: created.id, svc: "estimate" }));
  });

  it("sends svc: null to mutate and clears the store svc when called with null", () => {
    mockUpdate.mockResolvedValue({} as never);
    const { get } = makeStore();
    const created = get().addJob({ ...draft, leadId: "", svc: "estimate" });
    get().setJobSvc(created.id, null);
    expect(get().jobs.find((j) => j.id === created.id)!.svc).toBeNull();
    expect(mockUpdate).toHaveBeenCalledWith(expect.objectContaining({ jobId: created.id, svc: null }));
  });
});

/** Full jobDTO shape returned by v1.jobs.update (matches jobDTO schema). */
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

describe("updateJob reconcile + rollback", () => {
  beforeEach(() => { mockUpdate.mockReset(); });

  it("reconciles the DTO's svc onto the store including a null-clear", async () => {
    // Server confirms svc cleared to null.
    mockUpdate.mockResolvedValue(makeJobDTO("ignored", { svc: null }));
    const { get } = makeStore();
    const created = get().addJob({ ...draft, leadId: "", svc: "estimate" });
    get().updateJob(created.id, { svc: null });
    // Flush the resolved promise.
    await Promise.resolve();
    await Promise.resolve();
    expect(get().jobs.find((j) => j.id === created.id)!.svc).toBeNull();
  });

  it("reconciles the DTO's svc when set to a non-null value", async () => {
    mockUpdate.mockResolvedValue(makeJobDTO("ignored", { svc: "service" }));
    const { get } = makeStore();
    const created = get().addJob({ ...draft, leadId: "", svc: "estimate" });
    get().updateJob(created.id, { svc: "service" });
    await Promise.resolve();
    await Promise.resolve();
    expect(get().jobs.find((j) => j.id === created.id)!.svc).toBe("service");
  });

  it("rolls back to the pre-patch snapshot on error", async () => {
    mockUpdate.mockRejectedValue(new Error("network"));
    const { get } = makeStore();
    const created = get().addJob({ ...draft, leadId: "", title: "Original", svc: "estimate" });
    get().updateJob(created.id, { title: "Changed" });
    // Optimistic update visible immediately.
    expect(get().jobs.find((j) => j.id === created.id)!.title).toBe("Changed");
    await Promise.resolve();
    await Promise.resolve();
    // After rejection, snapshot restored.
    expect(get().jobs.find((j) => j.id === created.id)!.title).toBe("Original");
  });
});
