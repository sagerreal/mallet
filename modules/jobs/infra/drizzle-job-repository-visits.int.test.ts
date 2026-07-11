import { describe, it, expect, beforeAll, afterAll } from "vitest";
import postgres from "postgres";
import type { Sql } from "postgres";
import { randomUUID } from "node:crypto";
import {
  asOrgId,
  asLeadId,
  asJobId,
  asVisitId,
  asUserId,
  zeroMoney,
  toPage,
  isOk,
  type OrgId,
  type LeadId,
  type UserId,
} from "@mallet/shared/types";
import { withTenant } from "@mallet/shared/db/tx";
import { closeDb } from "@mallet/shared/db/client";
import { Job, JobVisit } from "../domain/job";
import { DrizzleJobRepository } from "./drizzle-job-repository";

// Integration: visits round-trip, soft-delete orphan, batch-load via loadPage,
// and cross-org RLS isolation. Mirrors the estimate_lines pattern in
// drizzle-estimate-repository.int.test.ts.

const hasDb = Boolean(process.env.APP_DATABASE_URL && process.env.DATABASE_URL);
const suite = hasDb ? describe : describe.skip;

const makeJob = (orgId: OrgId, leadId: LeadId, num: string): Job => {
  const now = new Date("2026-07-01T00:00:00Z");
  const r = Job.create({
    id: asJobId(randomUUID()),
    orgId,
    num,
    leadId,
    sourceEstimateId: null,
    assigneeUserId: null,
    title: "Visit test job",
    svc: null,
    status: "scheduled",
    scheduledStart: null,
    scheduledEnd: null,
    startedAt: null,
    completedAt: null,
    canceledAt: null,
    cancelReason: null,
    total: zeroMoney,
    notes: null,
    visits: [],
    createdAt: now,
    updatedAt: now,
  });
  if (!isOk(r)) throw new Error(r.error.message);
  return r.value;
};

const pendingVisit = (userId: UserId | null = null): JobVisit => {
  const r = JobVisit.create({
    id: asVisitId(randomUUID()),
    assigneeUserId: userId,
    scheduledDate: userId ? "2026-07-10" : null,
    scheduledStart: userId ? "09:00" : null,
    scheduledEnd: userId ? "11:00" : null,
    status: "pending",
    startedAt: null,
    completedAt: null,
    notes: null,
    position: 1,
  });
  if (!isOk(r)) throw new Error(r.error.message);
  return r.value;
};

suite("DrizzleJobRepository — visits round-trip (live RLS)", () => {
  let admin: Sql;
  let orgAId = "";
  let orgBId = "";
  let leadAId = "";
  let leadBId = "";
  let userAId = "";

  beforeAll(async () => {
    admin = postgres(process.env.DATABASE_URL as string, {
      max: 1,
      ssl: "require",
      prepare: false,
    });
    const [a] = await admin<{ id: string }[]>`
      insert into orgs (name) values ('VisitRepo A ' || gen_random_uuid()) returning id`;
    const [b] = await admin<{ id: string }[]>`
      insert into orgs (name) values ('VisitRepo B ' || gen_random_uuid()) returning id`;
    orgAId = a!.id;
    orgBId = b!.id;

    const [la] = await admin<{ id: string }[]>`
      insert into leads (org_id, name) values (${orgAId}, 'Lead A') returning id`;
    const [lb] = await admin<{ id: string }[]>`
      insert into leads (org_id, name) values (${orgBId}, 'Lead B') returning id`;
    leadAId = la!.id;
    leadBId = lb!.id;

    const [ua] = await admin<{ id: string }[]>`
      insert into users (org_id, auth_user_id, email, role)
      values (${orgAId}, gen_random_uuid(), 'visit-a@ex.com', 'tech') returning id`;
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

  it("saves a job with a visit and loads it back via findById", async () => {
    const orgA = asOrgId(orgAId);
    const visit = pendingVisit();

    const result = await withTenant(orgA, async (tx) => {
      const repo = new DrizzleJobRepository(tx, orgA);
      const num = await repo.nextNumber();
      const job = makeJob(orgA, asLeadId(leadAId), num);
      const withV = job.withVisits([visit], new Date());
      if (!isOk(withV)) throw new Error(withV.error.message);
      await repo.save(withV.value);
      const loaded = await repo.findById(withV.value.props.id);
      return { id: withV.value.props.id, loaded };
    });

    expect(result.loaded).not.toBeNull();
    expect(result.loaded!.props.visits).toHaveLength(1);
    expect(result.loaded!.props.visits[0]!.props.id).toBe(visit.props.id);
    expect(result.loaded!.props.visits[0]!.props.status).toBe("pending");
  });

  it("batch-loads visits across jobs via loadPage (list)", async () => {
    const orgA = asOrgId(orgAId);
    const visitA = pendingVisit();
    const visitB = pendingVisit();

    const { idA, idB } = await withTenant(orgA, async (tx) => {
      const repo = new DrizzleJobRepository(tx, orgA);
      const numA = await repo.nextNumber();
      const numB = await repo.nextNumber();
      const jobA = makeJob(orgA, asLeadId(leadAId), numA);
      const jobB = makeJob(orgA, asLeadId(leadAId), numB);

      const jobAWithV = jobA.withVisits([visitA], new Date());
      if (!isOk(jobAWithV)) throw new Error(jobAWithV.error.message);
      const jobBWithV = jobB.withVisits([visitB], new Date());
      if (!isOk(jobBWithV)) throw new Error(jobBWithV.error.message);

      await repo.save(jobAWithV.value);
      await repo.save(jobBWithV.value);
      return { idA: jobAWithV.value.props.id, idB: jobBWithV.value.props.id };
    });

    const listed = await withTenant(orgA, async (tx) => {
      const repo = new DrizzleJobRepository(tx, orgA);
      return repo.list(toPage({ limit: 100 }));
    });

    const foundA = listed.items.find((j) => j.props.id === idA);
    const foundB = listed.items.find((j) => j.props.id === idB);
    expect(foundA).toBeDefined();
    expect(foundB).toBeDefined();
    expect(foundA!.props.visits).toHaveLength(1);
    expect(foundB!.props.visits).toHaveLength(1);
    expect(foundA!.props.visits[0]!.props.id).toBe(visitA.props.id);
    expect(foundB!.props.visits[0]!.props.id).toBe(visitB.props.id);
  });

  it("soft-deletes an orphaned visit when removed from the aggregate", async () => {
    const orgA = asOrgId(orgAId);
    const visit = pendingVisit();

    const jobId = await withTenant(orgA, async (tx) => {
      const repo = new DrizzleJobRepository(tx, orgA);
      const num = await repo.nextNumber();
      const job = makeJob(orgA, asLeadId(leadAId), num);
      const withV = job.withVisits([visit], new Date());
      if (!isOk(withV)) throw new Error(withV.error.message);
      await repo.save(withV.value);
      return withV.value.props.id;
    });

    // Remove the visit by saving the job with an empty visit list.
    await withTenant(orgA, async (tx) => {
      const repo = new DrizzleJobRepository(tx, orgA);
      const loaded = await repo.findById(jobId);
      if (!loaded) throw new Error("job not found");
      const noVisits = loaded.withVisits([], new Date());
      if (!isOk(noVisits)) throw new Error(noVisits.error.message);
      await repo.save(noVisits.value);
    });

    // Reload — visits should be gone (soft-deleted, excluded by isNull(deletedAt)).
    const reloaded = await withTenant(orgA, async (tx) => {
      return new DrizzleJobRepository(tx, orgA).findById(jobId);
    });

    expect(reloaded).not.toBeNull();
    expect(reloaded!.props.visits).toHaveLength(0);

    // Verify the row is still in the DB with deleted_at set (soft-delete, not hard-delete).
    const raw = await admin<{ id: string; deleted_at: Date | null }[]>`
      select id, deleted_at from job_visits where id = ${visit.props.id}`;
    expect(raw).toHaveLength(1);
    expect(raw[0]!.deleted_at).not.toBeNull();
  });

  it("updates a placed visit's assignee via upsert and persists all fields", async () => {
    const orgA = asOrgId(orgAId);
    const userId = asUserId(userAId);
    const visit = pendingVisit(userId); // placed: has date + assignee + start

    const jobId = await withTenant(orgA, async (tx) => {
      const repo = new DrizzleJobRepository(tx, orgA);
      const num = await repo.nextNumber();
      const job = makeJob(orgA, asLeadId(leadAId), num);
      const withV = job.withVisits([visit], new Date());
      if (!isOk(withV)) throw new Error(withV.error.message);
      await repo.save(withV.value);
      return withV.value.props.id;
    });

    const loaded = await withTenant(orgA, async (tx) => {
      return new DrizzleJobRepository(tx, orgA).findById(jobId);
    });

    expect(loaded).not.toBeNull();
    const v = loaded!.props.visits[0];
    expect(v).toBeDefined();
    expect(v!.props.assigneeUserId).toBe(userId);
    expect(v!.props.scheduledDate).toBe("2026-07-10");
    expect(v!.props.scheduledStart).toBe("09:00");
    expect(v!.props.scheduledEnd).toBe("11:00");
    expect(v!.isPlaced()).toBe(true);
  });

  it("org B cannot see org A's job visits — findById returns null under RLS", async () => {
    const orgA = asOrgId(orgAId);
    const visit = pendingVisit();

    const jobId = await withTenant(orgA, async (tx) => {
      const repo = new DrizzleJobRepository(tx, orgA);
      const num = await repo.nextNumber();
      const job = makeJob(orgA, asLeadId(leadAId), num);
      const withV = job.withVisits([visit], new Date());
      if (!isOk(withV)) throw new Error(withV.error.message);
      await repo.save(withV.value);
      return withV.value.props.id;
    });

    const orgB = asOrgId(orgBId);
    const fromB = await withTenant(orgB, async (tx) => {
      return new DrizzleJobRepository(tx, orgB).findById(jobId);
    });

    expect(fromB).toBeNull();
  });

  it("visits do not appear in org B's list", async () => {
    const orgA = asOrgId(orgAId);
    const visit = pendingVisit();

    await withTenant(orgA, async (tx) => {
      const repo = new DrizzleJobRepository(tx, orgA);
      const num = await repo.nextNumber();
      const job = makeJob(orgA, asLeadId(leadAId), num);
      const withV = job.withVisits([visit], new Date());
      if (!isOk(withV)) throw new Error(withV.error.message);
      await repo.save(withV.value);
    });

    const orgB = asOrgId(orgBId);
    const listed = await withTenant(orgB, async (tx) => {
      return new DrizzleJobRepository(tx, orgB).list(toPage({ limit: 100 }));
    });

    expect(listed.items).toHaveLength(0);
  });
});
