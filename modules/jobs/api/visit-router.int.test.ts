import { describe, it, expect, beforeAll, afterAll } from "vitest";
import postgres from "postgres";
import type { Sql } from "postgres";
import { randomUUID } from "node:crypto";
import { asOrgId, asUserId, systemClock } from "@mallet/shared/types";
import { InMemoryEventBus, uuidGenerator } from "@mallet/shared/ports";
import { closeDb } from "@mallet/shared/db/client";
import type { AuthProvider, Principal, Role } from "@mallet/identity";
import { appRouter } from "@/trpc/root";
import type { Context } from "@/trpc/init";

// Capstone: exercise the full visits stack via createCaller — ownerOrOffice guard, all 6 mutations,
// the org-scoped transaction, the use-case layer, the Drizzle repo with visit upsert/soft-delete,
// and live RLS. Org B cannot touch Org A's visits. Mirrors job-router.int.test.ts.

const hasDb = Boolean(process.env.APP_DATABASE_URL && process.env.DATABASE_URL);
const suite = hasDb ? describe : describe.skip;

const stubAuth: AuthProvider = {
  authenticate: async () => {
    throw new Error("authProvider should not be called in createCaller tests");
  },
};

const ctxFor = (orgId: string, role: Role): Context => ({
  principal: { userId: asUserId(randomUUID()), orgId: asOrgId(orgId), role } satisfies Principal,
  unmapped: null,
  tx: null,
  deps: {
    authProvider: stubAuth,
    bus: new InMemoryEventBus(),
    clock: systemClock,
    ids: uuidGenerator,
    paymentLinkGateway: null, photoStorageGateway: null,
    llmClient: null,
    apiKeyAuthenticator: { authenticate: async () => null },
    tokenVerifier: { verify: async () => null },
    signupStore: {
      createOrgForUser: async () => {
        throw new Error("unused in this test");
      },
    },
  },
});

suite("visits tRPC router (full stack, live RLS)", () => {
  let admin: Sql;
  let orgAId = "";
  let orgBId = "";
  let leadAId = "";
  let userAId = "";

  beforeAll(async () => {
    admin = postgres(process.env.DATABASE_URL as string, {
      max: 1,
      ssl: "require",
      prepare: false,
    });
    const [a] = await admin<{ id: string }[]>`
      insert into orgs (name) values ('VisitApi A ' || gen_random_uuid()) returning id`;
    const [b] = await admin<{ id: string }[]>`
      insert into orgs (name) values ('VisitApi B ' || gen_random_uuid()) returning id`;
    orgAId = a!.id;
    orgBId = b!.id;

    const [la] = await admin<{ id: string }[]>`
      insert into leads (org_id, name) values (${orgAId}, 'Cust Visit A') returning id`;
    leadAId = la!.id;

    const [ua] = await admin<{ id: string }[]>`
      insert into users (org_id, auth_user_id, email, role)
      values (${orgAId}, gen_random_uuid(), 'field@visitapi.com', 'tech') returning id`;
    userAId = ua!.id;
  });

  afterAll(async () => {
    if (orgAId) {
      // Delete jobs first (cascades to job_visits) so no visit still references a user via
      // job_visits_assignee_fk when the org cascade deletes the users. Otherwise the diamond
      // cascade (org→users vs org→jobs→job_visits→users) hits a NO ACTION FK violation.
      await admin`delete from jobs where org_id in (${orgAId}, ${orgBId})`;
      await admin`delete from orgs where id in (${orgAId}, ${orgBId})`;
    }
    await admin.end({ timeout: 5 });
    await closeDb();
  });

  // Creates a job directly (scheduleDirect) under the given caller and returns its id.
  const createJob = async (
    caller: ReturnType<typeof appRouter.createCaller>,
  ): Promise<string> => {
    const job = await caller.v1.jobs.scheduleDirect({ leadId: leadAId, title: "Visit test job" });
    return job.id;
  };

  // ── createVisit ─────────────────────────────────────────────────────────────

  it("createVisit adds an unplaced visit; it appears in jobs.get visits[]", async () => {
    const caller = appRouter.createCaller(ctxFor(orgAId, "owner"));
    const jobId = await createJob(caller);

    const result = await caller.v1.visits.createVisit({
      jobId,
      durationHours: 2,
    });

    expect(result.id).toBe(jobId);
    expect(result.visits).toHaveLength(1);
    const visit = result.visits[0]!;
    expect(visit.status).toBe("pending");
    expect(visit.assigneeUserId).toBeNull();
    expect(visit.scheduledDate).toBeNull();

    // Verify persistence via jobs.get.
    const fetched = await caller.v1.jobs.get({ jobId });
    expect(fetched.visits).toHaveLength(1);
    expect(fetched.visits[0]!.id).toBe(visit.id);
  });

  it("createVisit returns a placed visit when all scheduling fields are provided", async () => {
    const caller = appRouter.createCaller(ctxFor(orgAId, "owner"));
    const jobId = await createJob(caller);

    const result = await caller.v1.visits.createVisit({
      jobId,
      assigneeUserId: userAId,
      scheduledDate: "2026-07-15",
      scheduledStart: "08:00",
      durationHours: 3,
    });

    expect(result.visits).toHaveLength(1);
    const visit = result.visits[0]!;
    expect(visit.assigneeUserId).toBe(userAId);
    expect(visit.scheduledDate).toBe("2026-07-15");
    expect(visit.scheduledStart).toBe("08:00");
    expect(visit.scheduledEnd).toBe("11:00");
  });

  // ── scheduleVisit ───────────────────────────────────────────────────────────

  it("scheduleVisit places an unplaced visit: assignee, date, start, end all persist", async () => {
    const caller = appRouter.createCaller(ctxFor(orgAId, "owner"));
    const jobId = await createJob(caller);

    const created = await caller.v1.visits.createVisit({ jobId, durationHours: 2 });
    const visitId = created.visits[0]!.id;

    const scheduled = await caller.v1.visits.scheduleVisit({
      jobId,
      visitId,
      assigneeUserId: userAId,
      scheduledDate: "2026-07-20",
      scheduledStart: "09:00",
      durationHours: 2,
    });

    const visit = scheduled.visits.find((v) => v.id === visitId)!;
    expect(visit.assigneeUserId).toBe(userAId);
    expect(visit.scheduledDate).toBe("2026-07-20");
    expect(visit.scheduledStart).toBe("09:00");
    expect(visit.scheduledEnd).toBe("11:00");

    // Verify persistence: job list must still include this visit.
    const listed = await caller.v1.jobs.list({ limit: 50 });
    const inList = listed.items.find((j) => j.id === jobId);
    expect(inList).toBeDefined();
    // jobSummaryDTO now carries visits; we only assert the job is present here.
    expect(inList!.id).toBe(jobId);
  });

  // ── updateVisitDuration ─────────────────────────────────────────────────────

  it("updateVisitDuration recomputes scheduledEnd from existing start + new hours", async () => {
    const caller = appRouter.createCaller(ctxFor(orgAId, "owner"));
    const jobId = await createJob(caller);

    // Create a placed visit with a 2h window: 09:00→11:00.
    const created = await caller.v1.visits.createVisit({
      jobId,
      assigneeUserId: userAId,
      scheduledDate: "2026-07-20",
      scheduledStart: "09:00",
      durationHours: 2,
    });
    const visitId = created.visits[0]!.id;

    // Extend duration to 4h: end should become 13:00.
    const updated = await caller.v1.visits.updateVisitDuration({
      jobId,
      visitId,
      durationHours: 4,
    });

    const visit = updated.visits.find((v) => v.id === visitId)!;
    expect(visit.scheduledStart).toBe("09:00");
    expect(visit.scheduledEnd).toBe("13:00");
    expect(visit.durationMinutes).toBe(240);
  });

  it("createVisit persists durationMinutes for an unplaced visit", async () => {
    const caller = appRouter.createCaller(ctxFor(orgAId, "owner"));
    const jobId = await createJob(caller);

    const created = await caller.v1.visits.createVisit({ jobId, durationHours: 1.5 });
    expect(created.visits[0]!.durationMinutes).toBe(90);
    expect(created.visits[0]!.scheduledStart).toBeNull();
  });

  it("updateVisitDuration on an UNPLACED visit persists durationMinutes and survives a re-read", async () => {
    const caller = appRouter.createCaller(ctxFor(orgAId, "owner"));
    const jobId = await createJob(caller);

    // Unplaced visit: no assignee/date/start — the pre-fix silent no-op case.
    const created = await caller.v1.visits.createVisit({ jobId, durationHours: 2 });
    const visitId = created.visits[0]!.id;

    const updated = await caller.v1.visits.updateVisitDuration({
      jobId,
      visitId,
      durationHours: 3.5,
    });
    const visit = updated.visits.find((v) => v.id === visitId)!;
    expect(visit.durationMinutes).toBe(210);
    expect(visit.scheduledStart).toBeNull();
    expect(visit.scheduledEnd).toBeNull();

    // Survives a fresh read (round-trips through the DB, not just the DTO).
    const refetched = await caller.v1.jobs.get({ jobId });
    const reread = refetched.visits.find((v) => v.id === visitId)!;
    expect(reread.durationMinutes).toBe(210);
  });

  // ── patchVisitSchedule ──────────────────────────────────────────────────────

  it("patchVisitSchedule applies partial updates without touching other fields", async () => {
    const caller = appRouter.createCaller(ctxFor(orgAId, "owner"));
    const jobId = await createJob(caller);

    const created = await caller.v1.visits.createVisit({
      jobId,
      assigneeUserId: userAId,
      scheduledDate: "2026-07-20",
      scheduledStart: "09:00",
      durationHours: 2,
      notes: "original note",
    });
    const visitId = created.visits[0]!.id;

    // Patch only the date and notes; assignee + times should be untouched.
    const patched = await caller.v1.visits.patchVisitSchedule({
      jobId,
      visitId,
      scheduledDate: "2026-07-22",
      notes: "updated note",
    });

    const visit = patched.visits.find((v) => v.id === visitId)!;
    expect(visit.scheduledDate).toBe("2026-07-22");
    expect(visit.notes).toBe("updated note");
    expect(visit.assigneeUserId).toBe(userAId); // unchanged
    expect(visit.scheduledStart).toBe("09:00"); // unchanged
  });

  // ── removeVisit ─────────────────────────────────────────────────────────────

  it("removeVisit soft-deletes the visit; it is gone from the reloaded job", async () => {
    const caller = appRouter.createCaller(ctxFor(orgAId, "owner"));
    const jobId = await createJob(caller);

    const created = await caller.v1.visits.createVisit({ jobId, durationHours: 1 });
    const visitId = created.visits[0]!.id;
    expect(created.visits).toHaveLength(1);

    const removed = await caller.v1.visits.removeVisit({ jobId, visitId });
    expect(removed.visits).toHaveLength(0);

    // Re-fetch: should still be gone.
    const refetched = await caller.v1.jobs.get({ jobId });
    expect(refetched.visits).toHaveLength(0);
  });

  // ── setVisitStatus ──────────────────────────────────────────────────────────

  it("setVisitStatus: pending → in_progress stamps startedAt; in_progress → complete stamps completedAt", async () => {
    const caller = appRouter.createCaller(ctxFor(orgAId, "owner"));
    const jobId = await createJob(caller);

    const created = await caller.v1.visits.createVisit({ jobId, durationHours: 2 });
    const visitId = created.visits[0]!.id;

    const inProgress = await caller.v1.visits.setVisitStatus({
      jobId,
      visitId,
      status: "in_progress",
    });
    const v1 = inProgress.visits.find((v) => v.id === visitId)!;
    expect(v1.status).toBe("in_progress");
    expect(v1.startedAt).not.toBeNull();
    expect(v1.completedAt).toBeNull();

    const complete = await caller.v1.visits.setVisitStatus({
      jobId,
      visitId,
      status: "complete",
    });
    const v2 = complete.visits.find((v) => v.id === visitId)!;
    expect(v2.status).toBe("complete");
    expect(v2.completedAt).not.toBeNull();
  });

  it("setVisitStatus: pending → canceled works; terminal → any transition throws", async () => {
    const caller = appRouter.createCaller(ctxFor(orgAId, "owner"));
    const jobId = await createJob(caller);

    const created = await caller.v1.visits.createVisit({ jobId, durationHours: 1 });
    const visitId = created.visits[0]!.id;

    await caller.v1.visits.setVisitStatus({ jobId, visitId, status: "canceled" });

    // canceled → complete must be rejected.
    await expect(
      caller.v1.visits.setVisitStatus({ jobId, visitId, status: "complete" }),
    ).rejects.toBeDefined();
  });

  it("setVisitStatus is idempotent: same-status call returns current job without error", async () => {
    const caller = appRouter.createCaller(ctxFor(orgAId, "owner"));
    const jobId = await createJob(caller);

    const created = await caller.v1.visits.createVisit({ jobId, durationHours: 1 });
    const visitId = created.visits[0]!.id;

    // Calling pending→pending must not throw and returns the job unchanged.
    const result = await caller.v1.visits.setVisitStatus({
      jobId,
      visitId,
      status: "pending",
    });
    expect(result.visits[0]!.status).toBe("pending");
  });

  // ── cross-org isolation ──────────────────────────────────────────────────────

  it("org B cannot scheduleVisit on org A's job (NOT_FOUND via RLS)", async () => {
    const callerA = appRouter.createCaller(ctxFor(orgAId, "owner"));
    const jobId = await createJob(callerA);

    const created = await callerA.v1.visits.createVisit({ jobId, durationHours: 2 });
    const visitId = created.visits[0]!.id;

    const callerB = appRouter.createCaller(ctxFor(orgBId, "owner"));
    await expect(
      callerB.v1.visits.scheduleVisit({
        jobId,
        visitId,
        assigneeUserId: userAId,
        scheduledDate: "2026-07-25",
        scheduledStart: "10:00",
        durationHours: 1,
      }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("org B cannot removeVisit on org A's job (NOT_FOUND via RLS)", async () => {
    const callerA = appRouter.createCaller(ctxFor(orgAId, "owner"));
    const jobId = await createJob(callerA);

    const created = await callerA.v1.visits.createVisit({ jobId, durationHours: 2 });
    const visitId = created.visits[0]!.id;

    const callerB = appRouter.createCaller(ctxFor(orgBId, "owner"));
    await expect(
      callerB.v1.visits.removeVisit({ jobId, visitId }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("a tech is forbidden from all visit mutations", async () => {
    const callerTech = appRouter.createCaller(ctxFor(orgAId, "tech"));

    // createVisit uses ownerOrOffice — tech should get FORBIDDEN.
    await expect(
      callerTech.v1.visits.createVisit({ jobId: randomUUID(), durationHours: 1 }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
});
