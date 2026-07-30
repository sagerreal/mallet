import { describe, it, expect, beforeEach } from "vitest";
import {
  asOrgId,
  asLeadId,
  asJobId,
  asVisitId,
  FixedClock,
  isOk,
  zeroMoney,
  type OrgId,
  type LeadId,
  type JobId,
  type VisitId,
  type EstimateId,
  type CursorPage,
  type Paginated,
  buildPage,
} from "@mallet/shared/types";
import { InMemoryEventBus } from "@mallet/shared/ports";
import { Job, JobVisit, type JobProps, type JobVisitProps } from "../domain/job";
import type { JobRepository } from "../domain/job-repository";
import { ScheduleJobUseCase } from "./schedule-job";
import { SetVisitStatusUseCase } from "./set-visit-status";

// ── constants ────────────────────────────────────────────────────────────────

const ORG: OrgId = asOrgId("22222222-2222-2222-2222-222222222222");
const LEAD: LeadId = asLeadId("33333333-3333-3333-3333-333333333333");
const MISSING_JOB: JobId = asJobId("99999999-9999-9999-9999-999999999999");
const MISSING_VISIT: VisitId = asVisitId("99999999-9999-9999-9999-999999999999");
const VISIT_A: VisitId = asVisitId("aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa");
const VISIT_B: VisitId = asVisitId("bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb");

// ── FakeJobRepository ────────────────────────────────────────────────────────

class FakeJobRepository implements JobRepository {
  private readonly store = new Map<JobId, Job>();
  private seq = 1000;

  async nextNumber(): Promise<string> {
    const n = this.seq;
    this.seq += 1;
    return `JOB-${n}`;
  }

  async save(job: Job): Promise<void> {
    this.store.set(job.props.id, job);
  }

  async insertForEstimate(job: Job): Promise<boolean> {
    const src = job.props.sourceEstimateId;
    if (src && [...this.store.values()].some((j) => j.props.sourceEstimateId === src)) {
      return false;
    }
    this.store.set(job.props.id, job);
    return true;
  }

  async insertManual(job: Job): Promise<void> {
    this.store.set(job.props.id, job);
  }

  async archiveByLead(): Promise<number> { return 0; }
  async archive(id: JobId, _now: Date): Promise<number> {
    return this.store.delete(id) ? 1 : 0;
  }

  async findById(id: JobId): Promise<Job | null> {
    return this.store.get(id) ?? null;
  }

  async findBySourceEstimate(estimateId: EstimateId): Promise<Job | null> {
    return [...this.store.values()].find((j) => j.props.sourceEstimateId === estimateId) ?? null;
  }

  async list(page: CursorPage, _filter?: unknown): Promise<Paginated<Job>> {
    const rows = [...this.store.values()];
    return buildPage(rows.slice(0, page.limit + 1), page, (j) => ({
      createdAt: j.props.createdAt,
      id: j.props.id,
    }));
  }

  async listByLead(_leadId: LeadId, page: CursorPage): Promise<Paginated<Job>> {
    return this.list(page);
  }
  // execution stubs — implemented in Task 5
  async listExecution() { return { lines: [], addons: [], verifyAnswers: [], photos: [] }; }
  async listExecutionForJobs() { return new Map(); }
  async addLine() {}
  async updateLine() { return 0; }
  async removeLine() { return 0; }
  async replaceLines() {}
  async saveOnSiteSignature(): Promise<void> {}
  async addAddon() {}
  async setAddonStatus() { return 0; }
  async setAddonInvoiceSkip() { return 0; }
  async upsertVerifyAnswer() {}
  async removeVerifyAnswer() { return 0; }
  async addPhoto() {}
  async removePhoto() { return 0; }
  async listRecentForCallbackScan() { return []; }
  async listConfirmedCallbacksWithOriginals() { return []; }
}

// ── domain helpers ───────────────────────────────────────────────────────────

const seqIds = () => {
  let n = 0;
  return {
    newId: () => {
      n += 1;
      return `00000000-0000-0000-0000-${String(n).padStart(12, "0")}`;
    },
  };
};

const makeVisitProps = (overrides: Partial<JobVisitProps> = {}): JobVisitProps => ({
  id: VISIT_A,
  assigneeUserId: null,
  scheduledDate: null,
  scheduledStart: null,
  scheduledEnd: null,
  durationMinutes: null,
  status: "pending",
  enrouteAt: null,
  startedAt: null,
  completedAt: null,
  notes: null,
  position: 1,
  ...overrides,
});

const makeVisit = (overrides: Partial<JobVisitProps> = {}): JobVisit => {
  const r = JobVisit.create(makeVisitProps(overrides));
  if (!isOk(r)) throw new Error(r.error.message);
  return r.value;
};

// ── SetVisitStatusUseCase ────────────────────────────────────────────────────

describe("SetVisitStatusUseCase", () => {
  let clock: FixedClock;
  let repo: FakeJobRepository;
  let bus: InMemoryEventBus;
  let useCase: SetVisitStatusUseCase;

  /**
   * Schedules a job then replaces its visits list with a single visit that has
   * the given status. Returns { jobId, visitId }.
   */
  const seedJobWithVisit = async (
    visitStatus: JobVisitProps["status"] = "pending",
  ): Promise<{ jobId: JobId; visitId: VisitId }> => {
    const schedResult = await new ScheduleJobUseCase(repo, bus, clock, seqIds()).exec({
      orgId: ORG,
      leadId: LEAD,
      title: "Test job",
      scheduledStart: null,
      scheduledEnd: null,
      assigneeUserId: null,
    });
    if (!isOk(schedResult)) throw new Error("schedule failed");
    const job = schedResult.value;

    const visit = makeVisit({ status: visitStatus });
    const updatedResult = job.withVisits([visit], clock.now());
    if (!isOk(updatedResult)) throw new Error(`withVisits failed: ${updatedResult.error.message}`);
    await repo.save(updatedResult.value);

    return { jobId: job.props.id, visitId: VISIT_A };
  };

  /** Like seedJobWithVisit but seeds TWO visits (VISIT_A, VISIT_B) with the given statuses. */
  const seedJobWithTwoVisits = async (
    statusA: JobVisitProps["status"],
    statusB: JobVisitProps["status"],
  ): Promise<{ jobId: JobId }> => {
    const schedResult = await new ScheduleJobUseCase(repo, bus, clock, seqIds()).exec({
      orgId: ORG,
      leadId: LEAD,
      title: "Test job",
      scheduledStart: null,
      scheduledEnd: null,
      assigneeUserId: null,
    });
    if (!isOk(schedResult)) throw new Error("schedule failed");
    const job = schedResult.value;

    const visits = [
      makeVisit({ id: VISIT_A, status: statusA, position: 1 }),
      makeVisit({ id: VISIT_B, status: statusB, position: 2 }),
    ];
    const updatedResult = job.withVisits(visits, clock.now());
    if (!isOk(updatedResult)) throw new Error(`withVisits failed: ${updatedResult.error.message}`);
    await repo.save(updatedResult.value);

    return { jobId: job.props.id };
  };

  beforeEach(() => {
    clock = new FixedClock(new Date("2026-07-01T10:00:00Z"));
    repo = new FakeJobRepository();
    bus = new InMemoryEventBus();
    useCase = new SetVisitStatusUseCase(repo, bus, clock);
  });

  // ── not-found paths ──────────────────────────────────────────────────────

  it("returns not_found error when the job does not exist", async () => {
    const result = await useCase.exec({
      jobId: MISSING_JOB,
      visitId: MISSING_VISIT,
      status: "in_progress",
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.kind).toBe("not_found");
      expect(result.error.message).toMatch(/job/i);
    }
  });

  it("returns not_found error when the visit does not exist on the job", async () => {
    const { jobId } = await seedJobWithVisit("pending");
    const result = await useCase.exec({
      jobId,
      visitId: MISSING_VISIT,
      status: "in_progress",
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.kind).toBe("not_found");
      expect(result.error.message).toMatch(/visit/i);
    }
  });

  // ── idempotent same-status no-op ─────────────────────────────────────────

  it("returns ok with the current job unchanged when the status is already the requested value", async () => {
    const { jobId, visitId } = await seedJobWithVisit("pending");
    const result = await useCase.exec({ jobId, visitId, status: "pending" });
    expect(result.ok).toBe(true);
    if (isOk(result)) {
      const visit = result.value.props.visits.find((v) => v.props.id === visitId);
      expect(visit?.props.status).toBe("pending");
    }
  });

  // ── invalid transitions ──────────────────────────────────────────────────

  it("returns validation error for complete → in_progress (reopen goes to pending only)", async () => {
    const { jobId, visitId } = await seedJobWithVisit("complete");
    const result = await useCase.exec({ jobId, visitId, status: "in_progress" });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.kind).toBe("validation");
      expect(result.error.message).toContain("complete");
    }
  });

  it("returns validation error when attempting to leave a terminal canceled status", async () => {
    const { jobId, visitId } = await seedJobWithVisit("canceled");
    const result = await useCase.exec({ jobId, visitId, status: "pending" });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.kind).toBe("validation");
      expect(result.error.message).toContain("canceled");
    }
  });

  it("returns validation error for in_progress → pending (backward transition)", async () => {
    const { jobId, visitId } = await seedJobWithVisit("in_progress");
    const result = await useCase.exec({ jobId, visitId, status: "pending" });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.kind).toBe("validation");
    }
  });

  // ── ALLOWED_TRANSITIONS: all four valid paths ────────────────────────────

  it("pending → in_progress: updates status and stamps startedAt with clock.now()", async () => {
    const { jobId, visitId } = await seedJobWithVisit("pending");
    const result = await useCase.exec({ jobId, visitId, status: "in_progress" });
    expect(result.ok).toBe(true);
    if (isOk(result)) {
      const visit = result.value.props.visits.find((v) => v.props.id === visitId);
      expect(visit?.props.status).toBe("in_progress");
      expect(visit?.props.startedAt).toEqual(new Date("2026-07-01T10:00:00Z"));
      expect(visit?.props.completedAt).toBeNull();
    }
  });

  it("pending → canceled: updates status, leaves startedAt and completedAt null", async () => {
    const { jobId, visitId } = await seedJobWithVisit("pending");
    const result = await useCase.exec({ jobId, visitId, status: "canceled" });
    expect(result.ok).toBe(true);
    if (isOk(result)) {
      const visit = result.value.props.visits.find((v) => v.props.id === visitId);
      expect(visit?.props.status).toBe("canceled");
      expect(visit?.props.startedAt).toBeNull();
      expect(visit?.props.completedAt).toBeNull();
    }
  });

  it("in_progress → complete: updates status and stamps completedAt with clock.now()", async () => {
    const { jobId, visitId } = await seedJobWithVisit("in_progress");
    clock.advance(30_000); // advance so completedAt differs from seed time
    const completedAt = clock.now();
    const result = await useCase.exec({ jobId, visitId, status: "complete" });
    expect(result.ok).toBe(true);
    if (isOk(result)) {
      const visit = result.value.props.visits.find((v) => v.props.id === visitId);
      expect(visit?.props.status).toBe("complete");
      expect(visit?.props.completedAt).toEqual(completedAt);
    }
  });

  it("in_progress → canceled: updates status, leaves completedAt null", async () => {
    const { jobId, visitId } = await seedJobWithVisit("in_progress");
    const result = await useCase.exec({ jobId, visitId, status: "canceled" });
    expect(result.ok).toBe(true);
    if (isOk(result)) {
      const visit = result.value.props.visits.find((v) => v.props.id === visitId);
      expect(visit?.props.status).toBe("canceled");
      expect(visit?.props.completedAt).toBeNull();
    }
  });

  // ── startedAt / completedAt stamping branches ────────────────────────────

  it("does not overwrite startedAt on non-in_progress transitions (pending → canceled)", async () => {
    const { jobId, visitId } = await seedJobWithVisit("pending");
    const result = await useCase.exec({ jobId, visitId, status: "canceled" });
    expect(isOk(result)).toBe(true);
    if (isOk(result)) {
      const visit = result.value.props.visits.find((v) => v.props.id === visitId);
      // startedAt was null on the pending visit and must remain null
      expect(visit?.props.startedAt).toBeNull();
    }
  });

  it("does not stamp completedAt on pending → in_progress transition", async () => {
    const { jobId, visitId } = await seedJobWithVisit("pending");
    const result = await useCase.exec({ jobId, visitId, status: "in_progress" });
    expect(isOk(result)).toBe(true);
    if (isOk(result)) {
      const visit = result.value.props.visits.find((v) => v.props.id === visitId);
      expect(visit?.props.completedAt).toBeNull();
    }
  });

  it("preserves an existing startedAt when transitioning in_progress → complete", async () => {
    // Seed a visit that already has startedAt recorded.
    const startedAt = new Date("2026-06-15T08:00:00Z");
    const { jobId } = await seedJobWithVisit("pending");

    // Replace the seeded pending visit with one that is already in_progress + has startedAt set.
    const savedJob = await repo.findById(jobId);
    if (!savedJob) throw new Error("job not found after seed");
    const inProgressVisit = makeVisit({ status: "in_progress", startedAt });
    const patched = savedJob.withVisits([inProgressVisit], clock.now());
    if (!isOk(patched)) throw new Error("patch failed");
    await repo.save(patched.value);

    const result = await useCase.exec({ jobId, visitId: VISIT_A, status: "complete" });
    expect(isOk(result)).toBe(true);
    if (isOk(result)) {
      const visit = result.value.props.visits.find((v) => v.props.id === VISIT_A);
      // startedAt must NOT be overwritten by the complete transition
      expect(visit?.props.startedAt).toEqual(startedAt);
      // completedAt must be stamped with clock.now()
      expect(visit?.props.completedAt).toEqual(clock.now());
    }
  });

  // ── job-status derivation (client/server agreement — no flash-then-revert) ─

  it("pending → complete: ungated Mark done completes the visit (startedAt stays null) AND the job", async () => {
    const { jobId, visitId } = await seedJobWithVisit("pending");
    const result = await useCase.exec({ jobId, visitId, status: "complete" });
    expect(result.ok).toBe(true);
    if (isOk(result)) {
      const visit = result.value.props.visits.find((v) => v.props.id === visitId);
      expect(visit?.props.status).toBe("complete");
      expect(visit?.props.startedAt).toBeNull(); // never tapped On my way / Arrived
      expect(visit?.props.completedAt).toEqual(clock.now());
      // every active visit is complete → the job is complete, stamped
      expect(result.value.props.status).toBe("complete");
      expect(result.value.props.completedAt).toEqual(clock.now());
    }
  });

  it("emits job.completed when the last visit completes the job", async () => {
    const { jobId, visitId } = await seedJobWithVisit("in_progress");
    const result = await useCase.exec({ jobId, visitId, status: "complete" });
    expect(result.ok).toBe(true);
    const completedEvents = bus.recorded.filter((e) => e.name === "job.completed");
    expect(completedEvents).toHaveLength(1);
    expect(completedEvents[0]?.payload).toMatchObject({ jobId });
  });

  it("complete → pending (reopen): clears the visit completedAt and returns the complete job to in_progress", async () => {
    const { jobId, visitId } = await seedJobWithVisit("pending");
    const done = await useCase.exec({ jobId, visitId, status: "complete" });
    expect(done.ok).toBe(true); // job is now complete

    const result = await useCase.exec({ jobId, visitId, status: "pending" });
    expect(result.ok).toBe(true);
    if (isOk(result)) {
      const visit = result.value.props.visits.find((v) => v.props.id === visitId);
      expect(visit?.props.status).toBe("pending");
      expect(visit?.props.completedAt).toBeNull(); // reopen clears the stamp
      expect(result.value.props.status).toBe("in_progress");
      expect(result.value.props.completedAt).toBeNull();
    }
  });

  // ── enrouteAt ("On my way") stamp ────────────────────────────────────────

  it("complete → pending (reopen): clears the enrouteAt stamp", async () => {
    // A visit that was travelled to, worked and finished still carries the stamp of that trip.
    const enrouteAt = new Date("2026-06-15T07:30:00Z");
    const { jobId } = await seedJobWithVisit("pending");
    const savedJob = await repo.findById(jobId);
    if (!savedJob) throw new Error("job not found after seed");
    const patched = savedJob.withVisits([makeVisit({ status: "complete", enrouteAt })], clock.now());
    if (!isOk(patched)) throw new Error("patch failed");
    await repo.save(patched.value);

    const result = await useCase.exec({ jobId, visitId: VISIT_A, status: "pending" });

    expect(isOk(result)).toBe(true);
    if (isOk(result)) {
      const visit = result.value.props.visits.find((v) => v.props.id === VISIT_A);
      // A reopened visit is a fresh trip — the old departure time must not survive it.
      expect(visit?.props.enrouteAt).toBeNull();
    }
  });

  it("pending → in_progress (Arrived): keeps the enrouteAt stamp", async () => {
    const enrouteAt = new Date("2026-07-01T09:40:00Z");
    const { jobId } = await seedJobWithVisit("pending");
    const savedJob = await repo.findById(jobId);
    if (!savedJob) throw new Error("job not found after seed");
    const patched = savedJob.withVisits([makeVisit({ enrouteAt })], clock.now());
    if (!isOk(patched)) throw new Error("patch failed");
    await repo.save(patched.value);

    const result = await useCase.exec({ jobId, visitId: VISIT_A, status: "in_progress" });

    expect(isOk(result)).toBe(true);
    if (isOk(result)) {
      const visit = result.value.props.visits.find((v) => v.props.id === VISIT_A);
      // Arriving ends the trip; it does not erase when it started.
      expect(visit?.props.enrouteAt).toEqual(enrouteAt);
    }
  });

  it("does not complete the job while another active visit is still open", async () => {
    const { jobId } = await seedJobWithTwoVisits("pending", "pending");
    const result = await useCase.exec({ jobId, visitId: VISIT_A, status: "complete" });
    expect(result.ok).toBe(true);
    if (isOk(result)) {
      expect(result.value.props.status).toBe("scheduled"); // B is still pending
      expect(bus.recorded.filter((e) => e.name === "job.completed")).toHaveLength(0);
    }
  });

  it("ignores canceled visits when deriving job completion", async () => {
    const { jobId } = await seedJobWithTwoVisits("pending", "canceled");
    const result = await useCase.exec({ jobId, visitId: VISIT_A, status: "complete" });
    expect(result.ok).toBe(true);
    if (isOk(result)) {
      expect(result.value.props.status).toBe("complete"); // the canceled visit doesn't block
    }
  });

  it("keeps visits on a CANCELED job untouchable (terminal for field writes)", async () => {
    const { jobId, visitId } = await seedJobWithVisit("pending");
    const saved = await repo.findById(jobId);
    if (!saved) throw new Error("job not found");
    const canceled = saved.cancel("customer bailed", clock.now());
    if (!isOk(canceled)) throw new Error("cancel failed");
    await repo.save(canceled.value);

    const result = await useCase.exec({ jobId, visitId, status: "complete" });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.kind).toBe("validation");
  });

  // ── persistence ──────────────────────────────────────────────────────────

  it("persists the updated job so a subsequent findById reflects the new visit status", async () => {
    const { jobId, visitId } = await seedJobWithVisit("pending");
    const result = await useCase.exec({ jobId, visitId, status: "in_progress" });
    expect(isOk(result)).toBe(true);

    const saved = await repo.findById(jobId);
    const visit = saved?.props.visits.find((v) => v.props.id === visitId);
    expect(visit?.props.status).toBe("in_progress");
  });
});
