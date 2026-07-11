import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock the vanilla client BEFORE importing the slice.
const mutate = {
  addAddon: vi.fn(),
  setAddonStatus: vi.fn(),
  setAddonInvSkip: vi.fn(),
  setVerifyAnswer: vi.fn(),
  photoUploadUrl: vi.fn(),
  addPhoto: vi.fn(),
};
vi.mock("@/lib/trpc/vanilla", () => ({
  trpcVanilla: {
    v1: {
      jobs: {
        addAddon: { mutate: (...a: unknown[]) => mutate.addAddon(...a) },
        setAddonStatus: { mutate: (...a: unknown[]) => mutate.setAddonStatus(...a) },
        setAddonInvSkip: { mutate: (...a: unknown[]) => mutate.setAddonInvSkip(...a) },
        setVerifyAnswer: { mutate: (...a: unknown[]) => mutate.setVerifyAnswer(...a) },
        photoUploadUrl: { mutate: (...a: unknown[]) => mutate.photoUploadUrl(...a) },
        addPhoto: { mutate: (...a: unknown[]) => mutate.addPhoto(...a) },
      },
    },
  },
}));

import { createStore, type StoreApi } from "zustand/vanilla";
import { createJobsSlice, type JobsSlice } from "./jobs-slice";
import { JOB_ORIGIN } from "@/lib/store/hydrator-config";
import type { Job } from "@/lib/store/types";

const flush = () => new Promise((r) => setTimeout(r, 0));

function seedJob(store: StoreApi<JobsSlice>) {
  const job: Job = {
    id: "job-1",
    leadId: "lead-1",
    svc: "service",
    origin: JOB_ORIGIN.DB,
    title: "T",
    addr: "",
    phone: "",
    status: "scheduled",
    archived: false,
    lines: [],
    addons: [],
    photos: [],
    notes: "",
    acts: [],
    visits: [],
  };
  store.setState({ jobs: [job] });
}

describe("jobs-slice execution actions persist", () => {
  let store: StoreApi<JobsSlice>;

  beforeEach(() => {
    Object.values(mutate).forEach((m) => m.mockReset());
    store = createStore<JobsSlice>((set, get, api) => createJobsSlice(set, get, api));
    seedJob(store);
  });

  it("addAddon optimistically inserts and fires v1.jobs.addAddon", async () => {
    mutate.addAddon.mockResolvedValue({ id: "job-1", leadId: "lead-1", title: "T", status: "scheduled", notes: "", visits: [], lines: [], addons: [{ id: "srv-1", description: "Extra", quantity: 1, rate: { cents: 9000, currency: "USD" }, cost: { cents: 0, currency: "USD" }, isOptional: false, invoiceSkip: false, status: "proposed", position: 0 }], verifyAnswers: [], photos: [] });
    store.getState().addAddon("job-1", { d: "Extra", r: 90 });
    expect(store.getState().jobs[0]!.addons).toHaveLength(1); // optimistic
    await flush();
    expect(mutate.addAddon).toHaveBeenCalledTimes(1);
    const arg = mutate.addAddon.mock.calls[0]![0] as { jobId: string; description: string; rateCents: number };
    expect(arg).toMatchObject({ jobId: "job-1", description: "Extra", rateCents: 9000 });
  });

  it("addAddon rolls back on mutation failure", async () => {
    mutate.addAddon.mockRejectedValue(new Error("boom"));
    store.getState().addAddon("job-1", { d: "Extra", r: 90 });
    expect(store.getState().jobs[0]!.addons).toHaveLength(1); // optimistic
    await flush();
    expect(store.getState().jobs[0]!.addons).toHaveLength(0); // rolled back
  });

  it("checkVerifyItem fires setVerifyAnswer(state=pass)", async () => {
    mutate.setVerifyAnswer.mockResolvedValue({ id: "job-1", leadId: "lead-1", title: "T", status: "scheduled", notes: "", visits: [], lines: [], addons: [], verifyAnswers: [{ itemId: 3, state: "pass", via: "manual", reason: null }], photos: [] });
    store.getState().checkVerifyItem("job-1", "3");
    expect(store.getState().jobs[0]!.verify?.ans["3"]?.st).toBe("pass"); // optimistic
    await flush();
    expect(mutate.setVerifyAnswer.mock.calls[0]![0]).toMatchObject({ jobId: "job-1", itemId: 3, state: "pass" });
  });

  it("overrideVerifyItem fires setVerifyAnswer(state=override, reason)", async () => {
    mutate.setVerifyAnswer.mockResolvedValue({ id: "job-1", leadId: "lead-1", title: "T", status: "scheduled", notes: "", visits: [], lines: [], addons: [], verifyAnswers: [{ itemId: 3, state: "override", via: null, reason: "N/A" }], photos: [] });
    store.getState().overrideVerifyItem("job-1", "3", "N/A");
    await flush();
    expect(mutate.setVerifyAnswer.mock.calls[0]![0]).toMatchObject({ jobId: "job-1", itemId: 3, state: "override", reason: "N/A" });
  });

  it("uncheckVerifyItem fires setVerifyAnswer(state=clear)", async () => {
    mutate.setVerifyAnswer.mockResolvedValue({ id: "job-1", leadId: "lead-1", title: "T", status: "scheduled", notes: "", visits: [], lines: [], addons: [], verifyAnswers: [], photos: [] });
    store.setState({ jobs: [{ ...store.getState().jobs[0]!, verify: { ans: { "3": { st: "pass", via: "manual" } } } }] });
    store.getState().uncheckVerifyItem("job-1", "3");
    await flush();
    expect(mutate.setVerifyAnswer.mock.calls[0]![0]).toMatchObject({ jobId: "job-1", itemId: 3, state: "clear" });
  });

  it("manual-origin jobs do NOT fire network mutations", async () => {
    store.setState({ jobs: [{ ...store.getState().jobs[0]!, origin: JOB_ORIGIN.MANUAL }] });
    store.getState().addAddon("job-1", { d: "Extra", r: 90 });
    await flush();
    expect(mutate.addAddon).not.toHaveBeenCalled();
    expect(store.getState().jobs[0]!.addons).toHaveLength(1); // still optimistic-only
  });
});
