import { describe, it, expect, beforeAll, afterAll } from "vitest";
import postgres from "postgres";
import type { Sql } from "postgres";
import { randomUUID } from "node:crypto";
import {
  asOrgId,
  asLeadId,
  asEstimateId,
  asUserId,
  asJobId,
  zeroMoney,
  money,
  toPage,
  isOk,
  type OrgId,
  type LeadId,
  type EstimateId,
  type UserId,
} from "@mallet/shared/types";
import { withTenant } from "@mallet/shared/db/tx";
import { closeDb } from "@mallet/shared/db/client";
import { Job } from "../domain/job";
import { DrizzleJobRepository } from "./drizzle-job-repository";

const hasDb = Boolean(process.env.APP_DATABASE_URL && process.env.DATABASE_URL);
const suite = hasDb ? describe : describe.skip;

interface JobOverrides {
  sourceEstimateId?: EstimateId | null;
  assigneeUserId?: UserId | null;
  num?: string;
}

interface ManualJobOverrides {
  num: string;
  svc?: string | null;
}

const draftJob = (orgId: OrgId, leadId: LeadId, o: JobOverrides = {}): Job => {
  const now = new Date("2026-06-01T00:00:00Z");
  const r = Job.create({
    id: asJobId(randomUUID()),
    orgId,
    num: o.num ?? `JOB-${Math.floor(now.getTime() / 1000)}`,
    leadId,
    sourceEstimateId: o.sourceEstimateId ?? null,
    assigneeUserId: o.assigneeUserId ?? null,
    title: "Job",
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

// Builds a manually-created job (no source estimate) with a random id for insertManual tests.
const makeManualJob = (orgId: OrgId, leadId: LeadId, o: ManualJobOverrides): Job => {
  const now = new Date("2026-06-01T00:00:00Z");
  const r = Job.create({
    id: asJobId(randomUUID()),
    orgId,
    num: o.num,
    leadId,
    sourceEstimateId: null,
    assigneeUserId: null,
    title: "Manual Job",
    svc: o.svc ?? null,
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

suite("DrizzleJobRepository against live Supabase RLS", () => {
  let admin: Sql;
  let orgAId = "";
  let orgBId = "";
  let leadAId = "";
  let leadBId = "";
  let estAId = "";
  let estA2Id = "";
  let estBId = "";
  let userBId = "";

  beforeAll(async () => {
    admin = postgres(process.env.DATABASE_URL as string, { max: 1, ssl: "require", prepare: false });
    const [a] = await admin<{ id: string }[]>`insert into orgs (name) values ('JobT A ' || gen_random_uuid()) returning id`;
    const [b] = await admin<{ id: string }[]>`insert into orgs (name) values ('JobT B ' || gen_random_uuid()) returning id`;
    orgAId = a!.id;
    orgBId = b!.id;
    const [la] = await admin<{ id: string }[]>`insert into leads (org_id, name) values (${orgAId}, 'Lead A') returning id`;
    const [lb] = await admin<{ id: string }[]>`insert into leads (org_id, name) values (${orgBId}, 'Lead B') returning id`;
    leadAId = la!.id;
    leadBId = lb!.id;
    const [ea] = await admin<{ id: string }[]>`insert into estimates (org_id, num, lead_id, status) values (${orgAId}, 'EST-A1', ${leadAId}, 'accepted') returning id`;
    const [ea2] = await admin<{ id: string }[]>`insert into estimates (org_id, num, lead_id, status) values (${orgAId}, 'EST-A2', ${leadAId}, 'accepted') returning id`;
    const [eb] = await admin<{ id: string }[]>`insert into estimates (org_id, num, lead_id, status) values (${orgBId}, 'EST-B1', ${leadBId}, 'accepted') returning id`;
    estAId = ea!.id;
    estA2Id = ea2!.id;
    estBId = eb!.id;
    const [ub] = await admin<{ id: string }[]>`insert into users (org_id, auth_user_id, email, role) values (${orgBId}, gen_random_uuid(), 'b@ex.com', 'tech') returning id`;
    userBId = ub!.id;
  });

  afterAll(async () => {
    if (orgAId) await admin`delete from orgs where id in (${orgAId}, ${orgBId})`;
    await admin.end({ timeout: 5 });
    await closeDb();
  });

  it("allocates gapless per-org JOB numbers starting at JOB-1000", async () => {
    const orgA = asOrgId(orgAId);
    const nums = await withTenant(orgA, async (tx) => {
      const repo = new DrizzleJobRepository(tx, orgA);
      return [await repo.nextNumber(), await repo.nextNumber()];
    });
    expect(nums).toEqual(["JOB-1000", "JOB-1001"]);
  });

  it("round-trips a job and finds it by source estimate", async () => {
    const orgA = asOrgId(orgAId);
    const result = await withTenant(orgA, async (tx) => {
      const repo = new DrizzleJobRepository(tx, orgA);
      const job = draftJob(orgA, asLeadId(leadAId), {
        sourceEstimateId: asEstimateId(estAId),
        num: await repo.nextNumber(),
      });
      await repo.save(job);
      const byId = await repo.findById(job.props.id);
      const bySource = await repo.findBySourceEstimate(asEstimateId(estAId));
      return { byIdId: byId?.props.id, bySourceId: bySource?.props.id, expected: job.props.id };
    });
    expect(result.byIdId).toBe(result.expected);
    expect(result.bySourceId).toBe(result.expected);
  });

  it("cannot see another org's job — by id or in a list", async () => {
    const orgA = asOrgId(orgAId);
    const jobId = await withTenant(orgA, async (tx) => {
      const repo = new DrizzleJobRepository(tx, orgA);
      const job = draftJob(orgA, asLeadId(leadAId), { num: await repo.nextNumber() });
      await repo.save(job);
      return job.props.id;
    });
    const orgB = asOrgId(orgBId);
    const seen = await withTenant(orgB, async (tx) => {
      const repo = new DrizzleJobRepository(tx, orgB);
      const byId = await repo.findById(jobId);
      const listed = await repo.list(toPage({ limit: 100 }));
      return { byId, ids: listed.items.map((j) => j.props.id) };
    });
    expect(seen.byId).toBeNull();
    expect(seen.ids).not.toContain(jobId);
  });

  it("RLS WITH CHECK rejects a job stamped with another org's id", async () => {
    const orgA = asOrgId(orgAId);
    let rejected = false;
    try {
      await withTenant(orgA, async (tx) => {
        const repo = new DrizzleJobRepository(tx, asOrgId(orgBId));
        await repo.save(draftJob(asOrgId(orgBId), asLeadId(leadBId)));
      });
    } catch {
      rejected = true;
    }
    expect(rejected).toBe(true);
  });

  it("composite FKs reject cross-tenant lead / estimate / assignee references", async () => {
    const orgA = asOrgId(orgAId);
    const attempt = (job: Job) =>
      withTenant(orgA, async (tx) => {
        await new DrizzleJobRepository(tx, orgA).save(job);
      }).then(
        () => false,
        () => true,
      );

    expect(await attempt(draftJob(orgA, asLeadId(leadBId)))).toBe(true); // lead in org B
    expect(
      await attempt(draftJob(orgA, asLeadId(leadAId), { sourceEstimateId: asEstimateId(estBId) })),
    ).toBe(true); // estimate in org B
    expect(
      await attempt(draftJob(orgA, asLeadId(leadAId), { assigneeUserId: asUserId(userBId) })),
    ).toBe(true); // user in org B
  });

  it("partial-unique backstops one-job-per-source-estimate under a double insert", async () => {
    const orgA = asOrgId(orgAId);
    let rejected = false;
    try {
      await withTenant(orgA, async (tx) => {
        const repo = new DrizzleJobRepository(tx, orgA);
        const src = asEstimateId(estA2Id);
        await repo.save(draftJob(orgA, asLeadId(leadAId), { sourceEstimateId: src, num: await repo.nextNumber() }));
        await repo.save(draftJob(orgA, asLeadId(leadAId), { sourceEstimateId: src, num: await repo.nextNumber() }));
      });
    } catch {
      rejected = true;
    }
    expect(rejected).toBe(true);
  });

  it("persists svc on insertManual and reads it back", async () => {
    const orgA = asOrgId(orgAId);
    const result = await withTenant(orgA, async (tx) => {
      const repo = new DrizzleJobRepository(tx, orgA);
      const num = await repo.nextNumber();
      const job = makeManualJob(orgA, asLeadId(leadAId), { num, svc: "estimate" });
      await repo.insertManual(job);
      const back = await repo.findById(job.props.id);
      return { svc: back?.props.svc ?? null };
    });
    expect(result.svc).toBe("estimate");
  });

  it("archive soft-deletes the job so findById returns null", async () => {
    const orgA = asOrgId(orgAId);
    const result = await withTenant(orgA, async (tx) => {
      const repo = new DrizzleJobRepository(tx, orgA);
      const num = await repo.nextNumber();
      const job = makeManualJob(orgA, asLeadId(leadAId), { num, svc: "service" });
      await repo.insertManual(job);
      const count = await repo.archive(job.props.id, new Date());
      const found = await repo.findById(job.props.id);
      return { count, found };
    });
    expect(result.count).toBe(1);
    expect(result.found).toBeNull();
  });
});
