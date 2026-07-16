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
  asVisitId,
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
import { Job, JobVisit, type CallbackReason } from "../domain/job";
import { DrizzleJobRepository } from "./drizzle-job-repository";

const hasDb = Boolean(process.env.APP_DATABASE_URL && process.env.DATABASE_URL);
const suite = hasDb ? describe : describe.skip;

interface JobOverrides {
  sourceEstimateId?: EstimateId | null;
  assigneeUserId?: UserId | null;
  num?: string;
  visits?: readonly JobVisit[];
}

// Builds an unplaced default-length visit (mirrors the one CreateJobFromEstimateUseCase seeds).
const makeVisit = (position = 1, durationMinutes = 120): JobVisit => {
  const r = JobVisit.create({
    id: asVisitId(randomUUID()),
    assigneeUserId: null,
    scheduledDate: null,
    scheduledStart: null,
    scheduledEnd: null,
    durationMinutes,
    status: "pending",
    startedAt: null,
    completedAt: null,
    notes: null,
    position,
  });
  if (!isOk(r)) throw new Error(r.error.message);
  return r.value;
};

interface ManualJobOverrides {
  num: string;
  svc?: string | null;
  scope?: string | null;
  callbackOf?: string | null;
  callbackReason?: CallbackReason | null;
  requiredCerts?: readonly string[] | null;
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
    checklist: null,
    visits: o.visits ?? [],
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
    scope: o.scope ?? null,
    callbackOf: o.callbackOf ? asJobId(o.callbackOf) : null,
    callbackReason: o.callbackReason ?? null,
    requiredCerts: o.requiredCerts ?? null,
    status: "scheduled",
    scheduledStart: null,
    scheduledEnd: null,
    startedAt: null,
    completedAt: null,
    canceledAt: null,
    cancelReason: null,
    total: zeroMoney,
    notes: null,
    checklist: null,
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

  it("insertForEstimate persists the aggregate's visits alongside the header", async () => {
    const orgA = asOrgId(orgAId);
    const [est] = await admin<{ id: string }[]>`
      insert into estimates (org_id, num, lead_id, status)
      values (${orgAId}, 'EST-A-VISIT', ${leadAId}, 'accepted') returning id`;
    const result = await withTenant(orgA, async (tx) => {
      const repo = new DrizzleJobRepository(tx, orgA);
      const job = draftJob(orgA, asLeadId(leadAId), {
        sourceEstimateId: asEstimateId(est!.id),
        num: await repo.nextNumber(),
        visits: [makeVisit()],
      });
      const inserted = await repo.insertForEstimate(job);
      const back = await repo.findById(job.props.id);
      return { inserted, visits: back?.props.visits ?? [] };
    });
    expect(result.inserted).toBe(true);
    expect(result.visits).toHaveLength(1);
    expect(result.visits[0]!.props.durationMinutes).toBe(120);
    expect(result.visits[0]!.props.position).toBe(1);
    expect(result.visits[0]!.props.status).toBe("pending");
  });

  it("insertForEstimate that loses the conflict inserts no visits", async () => {
    const orgA = asOrgId(orgAId);
    const [est] = await admin<{ id: string }[]>`
      insert into estimates (org_id, num, lead_id, status)
      values (${orgAId}, 'EST-A-RACE', ${leadAId}, 'accepted') returning id`;
    const result = await withTenant(orgA, async (tx) => {
      const repo = new DrizzleJobRepository(tx, orgA);
      const src = asEstimateId(est!.id);
      const winner = draftJob(orgA, asLeadId(leadAId), {
        sourceEstimateId: src,
        num: await repo.nextNumber(),
        visits: [makeVisit()],
      });
      const won = await repo.insertForEstimate(winner);
      const loser = draftJob(orgA, asLeadId(leadAId), {
        sourceEstimateId: src,
        num: await repo.nextNumber(),
        visits: [makeVisit()],
      });
      const lost = await repo.insertForEstimate(loser);
      const raced = await repo.findBySourceEstimate(src);
      return {
        won,
        lost,
        winnerId: winner.props.id,
        winnerVisitId: winner.props.visits[0]!.props.id,
        racedId: raced?.props.id,
        racedVisits: raced?.props.visits ?? [],
      };
    });
    expect(result.won).toBe(true);
    expect(result.lost).toBe(false);
    expect(result.racedId).toBe(result.winnerId);
    // Only the winner's visit exists — the losing insert must not attach a phantom visit.
    expect(result.racedVisits).toHaveLength(1);
    expect(result.racedVisits[0]!.props.id).toBe(result.winnerVisitId);
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

  it("persists scope on insertManual and reads it back; null when omitted", async () => {
    const orgA = asOrgId(orgAId);
    const result = await withTenant(orgA, async (tx) => {
      const repo = new DrizzleJobRepository(tx, orgA);

      // Job WITH a scope note
      const numWith = await repo.nextNumber();
      const withScope = makeManualJob(orgA, asLeadId(leadAId), {
        num: numWith,
        scope: "  water heater is ~15 years old, original install  ",
      });
      await repo.insertManual(withScope);
      const backWith = await repo.findById(withScope.props.id);

      // Job WITHOUT a scope note (null)
      const numWithout = await repo.nextNumber();
      const withoutScope = makeManualJob(orgA, asLeadId(leadAId), { num: numWithout });
      await repo.insertManual(withoutScope);
      const backWithout = await repo.findById(withoutScope.props.id);

      return {
        foundWith: backWith !== null,
        withScope: backWith?.props.scope,
        foundWithout: backWithout !== null,
        withoutScope: backWithout?.props.scope,
      };
    });
    // The domain trims on create, so the stored value is already trimmed.
    expect(result.foundWith).toBe(true);
    expect(result.withScope).toBe("water heater is ~15 years old, original install");
    expect(result.foundWithout).toBe(true);
    expect(result.withoutScope).toBeNull();
  });

  it("persists requiredCerts on insertManual and reads them back; null when omitted", async () => {
    const orgA = asOrgId(orgAId);
    const result = await withTenant(orgA, async (tx) => {
      const repo = new DrizzleJobRepository(tx, orgA);

      // Job WITH a cert requirement (resolved at create on the AI path)
      const numWith = await repo.nextNumber();
      const withCerts = makeManualJob(orgA, asLeadId(leadAId), {
        num: numWith,
        requiredCerts: ["Gas", "Boiler"],
      });
      await repo.insertManual(withCerts);
      const backWith = await repo.findById(withCerts.props.id);

      // Job WITHOUT a requirement (the manual-office default)
      const numWithout = await repo.nextNumber();
      const withoutCerts = makeManualJob(orgA, asLeadId(leadAId), { num: numWithout });
      await repo.insertManual(withoutCerts);
      const backWithout = await repo.findById(withoutCerts.props.id);

      return {
        withCerts: backWith?.props.requiredCerts,
        withoutCerts: backWithout?.props.requiredCerts,
      };
    });
    expect(result.withCerts).toEqual(["Gas", "Boiler"]);
    expect(result.withoutCerts).toBeNull();
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

  it("persists callbackOf + callbackReason on insertManual and reads them back", async () => {
    const orgA = asOrgId(orgAId);
    const result = await withTenant(orgA, async (tx) => {
      const repo = new DrizzleJobRepository(tx, orgA);

      // Job A — the original job that B will reference as its callback target.
      const numA = await repo.nextNumber();
      const jobA = makeManualJob(orgA, asLeadId(leadAId), { num: numA });
      await repo.insertManual(jobA);

      // Job B — a callback of A with an explicit reason.
      const numB = await repo.nextNumber();
      const jobB = makeManualJob(orgA, asLeadId(leadAId), {
        num: numB,
        callbackOf: jobA.props.id,
        callbackReason: "callback",
      });
      await repo.insertManual(jobB);
      const backB = await repo.findById(jobB.props.id);

      // Job C — no callback link; both fields must read back as null.
      const numC = await repo.nextNumber();
      const jobC = makeManualJob(orgA, asLeadId(leadAId), { num: numC });
      await repo.insertManual(jobC);
      const backC = await repo.findById(jobC.props.id);

      return {
        backB,
        backC,
        aId: jobA.props.id,
      };
    });
    expect(result.backB).not.toBeNull();
    expect(result.backC).not.toBeNull();
    expect(result.backB!.props.callbackOf).toBe(result.aId);
    expect(result.backB!.props.callbackReason).toBe("callback");
    expect(result.backC!.props.callbackOf).toBeNull();
    expect(result.backC!.props.callbackReason).toBeNull();
  });

  it("allows callbackOf with a null reason (unconfirmed candidate link)", async () => {
    const orgA = asOrgId(orgAId);
    const result = await withTenant(orgA, async (tx) => {
      const repo = new DrizzleJobRepository(tx, orgA);
      const numA = await repo.nextNumber();
      const jobA = makeManualJob(orgA, asLeadId(leadAId), { num: numA });
      await repo.insertManual(jobA);

      const numB = await repo.nextNumber();
      const jobB = makeManualJob(orgA, asLeadId(leadAId), {
        num: numB,
        callbackOf: jobA.props.id,
        callbackReason: null,
      });
      await repo.insertManual(jobB);
      const back = await repo.findById(jobB.props.id);
      return {
        callbackOf: back?.props.callbackOf ?? "missing",
        callbackReason: back?.props.callbackReason,
        aId: jobA.props.id,
      };
    });
    expect(result.callbackOf).toBe(result.aId);
    expect(result.callbackReason).toBeNull();
  });

  it("composite FK rejects a callbackOf pointing at a different org's job", async () => {
    const orgA = asOrgId(orgAId);
    const orgB = asOrgId(orgBId);

    // Create a job in org B to use as the cross-tenant target.
    const jobBId = await withTenant(orgB, async (tx) => {
      const repo = new DrizzleJobRepository(tx, orgB);
      const num = await repo.nextNumber();
      const job = makeManualJob(orgB, asLeadId(leadBId), { num });
      await repo.insertManual(job);
      return job.props.id;
    });

    // Attempt to create a job in org A referencing org B's job as callbackOf — must fail.
    let rejected = false;
    try {
      await withTenant(orgA, async (tx) => {
        const repo = new DrizzleJobRepository(tx, orgA);
        const num = await repo.nextNumber();
        // Bypass domain validation to test the DB constraint directly.
        const job = Job.create({
          id: asJobId(randomUUID()),
          orgId: orgA,
          num,
          leadId: asLeadId(leadAId),
          sourceEstimateId: null,
          assigneeUserId: null,
          title: "Cross-org callback attempt",
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
          callbackOf: jobBId, // org B's job — cross-tenant!
          callbackReason: "callback",
          checklist: null,
          visits: [],
          createdAt: new Date(),
          updatedAt: new Date(),
        });
        if (!isOk(job)) throw new Error("domain rejected");
        await repo.insertManual(job.value);
      });
    } catch {
      rejected = true;
    }
    expect(rejected).toBe(true);
  });

  it("archiveByLead sweeps a lead's ACTIVE jobs + their visits, preserves terminal, isolates other leads", async () => {
    const orgA = asOrgId(orgAId);
    // Two FRESH leads in org A so the counts are isolated from jobs other tests left on leadA:
    // `sweep` owns the active + terminal jobs; `keep` owns the untouched isolation job.
    const [sweep] = await admin<{ id: string }[]>`
      insert into leads (org_id, name) values (${orgAId}, 'Sweep Lead') returning id`;
    const [keep] = await admin<{ id: string }[]>`
      insert into leads (org_id, name) values (${orgAId}, 'Keep Lead') returning id`;
    // A scheduled job WITH a visit on `sweep` (should be swept), and a job on `keep` (untouched).
    const seed = await withTenant(orgA, async (tx) => {
      const repo = new DrizzleJobRepository(tx, orgA);
      const active = draftJob(orgA, asLeadId(sweep!.id), {
        num: await repo.nextNumber(),
        visits: [makeVisit()],
      });
      await repo.save(active);
      const other = draftJob(orgA, asLeadId(keep!.id), { num: await repo.nextNumber() });
      await repo.save(other);
      return { activeId: active.props.id, visitId: active.props.visits[0]!.props.id, otherId: other.props.id };
    });
    // A COMPLETE (terminal) job on `sweep`, inserted raw so it must survive the cascade as history.
    const [done] = await admin<{ id: string }[]>`
      insert into jobs (org_id, num, lead_id, title, status)
      values (${orgAId}, 'JOB-DONE-SWEEP', ${sweep!.id}, 'Done', 'complete') returning id`;

    const out = await withTenant(orgA, async (tx) => {
      const repo = new DrizzleJobRepository(tx, orgA);
      const swept = await repo.archiveByLead(asLeadId(sweep!.id), new Date());
      return {
        swept,
        activeFound: await repo.findById(asJobId(seed.activeId)),
        otherFound: await repo.findById(asJobId(seed.otherId)),
        doneFound: await repo.findById(asJobId(done!.id)),
      };
    });
    // The visit's deleted_at is checked directly — findById on the archived job returns null.
    const [visitRow] = await admin<{ deleted_at: string | null }[]>`
      select deleted_at from job_visits where id = ${seed.visitId}`;

    expect(out.swept).toBe(1); // only the scheduled job, not the complete one
    expect(out.activeFound).toBeNull(); // active job swept
    expect(visitRow!.deleted_at).not.toBeNull(); // its visit swept too — no orphan on the board
    expect(out.doneFound).not.toBeNull(); // terminal job preserved as history
    expect(out.otherFound).not.toBeNull(); // lead B's job untouched
  });

  it("listConfirmedCallbacksWithOriginals returns confirmed pairs, excludes non-callback reasons, date filter, and org-B isolation", async () => {
    const orgA = asOrgId(orgAId);
    const orgB = asOrgId(orgBId);

    // Fresh leads so this test doesn't collide with other test data.
    const [autopsyLeadA] = await admin<{ id: string }[]>`
      insert into leads (org_id, name) values (${orgAId}, 'Autopsy Lead A ' || gen_random_uuid()) returning id`;
    const [autopsyLeadB] = await admin<{ id: string }[]>`
      insert into leads (org_id, name) values (${orgBId}, 'Autopsy Lead B ' || gen_random_uuid()) returning id`;

    const now = new Date();
    // sinceBase is 1 second before "now" — so only jobs inserted in THIS test run (at `now`)
    // pass the since filter, while jobs left by other tests in orgA are excluded.
    const sinceBase = new Date(now.getTime() - 1000);
    const thirtyDaysAgo = new Date(now.getTime() - 30 * 86400000);
    const completedAtDate = new Date(now.getTime() - 60 * 86400000);
    // An ancient date clearly before sinceBase so the callback job there is excluded.
    const ancientDate = new Date(now.getTime() - 200 * 86400000);

    const checklistPayload = JSON.stringify({
      name: "Plumbing Safety Check",
      items: [
        { id: "item-1", text: "Check pipe pressure", type: "check", required: true },
        { id: "item-2", text: "Photo of shutoff valve", type: "photo", required: false },
      ],
    });

    // Org A original job — completed, has a checklist snapshot.
    const [origA] = await admin<{ id: string }[]>`
      insert into jobs (org_id, num, lead_id, title, svc, status, completed_at, checklist, created_at, updated_at)
      values (
        ${orgAId}, 'JOB-AUTOPSY-ORIG-A', ${autopsyLeadA!.id}, 'Original Plumbing Job', 'drain cleaning',
        'complete', ${completedAtDate.toISOString()}, ${checklistPayload}::jsonb,
        ${thirtyDaysAgo.toISOString()}, ${thirtyDaysAgo.toISOString()}
      ) returning id`;

    // Org A confirmed callback — created "now", references origA.
    const [callbackA] = await admin<{ id: string }[]>`
      insert into jobs (org_id, num, lead_id, title, svc, status, callback_of, callback_reason, created_at, updated_at)
      values (
        ${orgAId}, 'JOB-AUTOPSY-CB-A', ${autopsyLeadA!.id}, 'Callback Job', 'drain cleaning',
        'scheduled', ${origA!.id}, 'callback', ${now.toISOString()}, ${now.toISOString()}
      ) returning id`;

    // A job with callbackReason = 'new_issue' — must NOT be returned (not a confirmed callback).
    const [newIssueA] = await admin<{ id: string }[]>`
      insert into jobs (org_id, num, lead_id, title, svc, status, callback_of, callback_reason, created_at, updated_at)
      values (
        ${orgAId}, 'JOB-AUTOPSY-NI-A', ${autopsyLeadA!.id}, 'New Issue Job', 'drain cleaning',
        'scheduled', ${origA!.id}, 'new_issue', ${now.toISOString()}, ${now.toISOString()}
      ) returning id`;

    // A job with callbackOf set but callback_reason NULL (unconfirmed candidate) — must NOT be returned.
    const [nullReasonA] = await admin<{ id: string }[]>`
      insert into jobs (org_id, num, lead_id, title, svc, status, callback_of, created_at, updated_at)
      values (
        ${orgAId}, 'JOB-AUTOPSY-NULL-A', ${autopsyLeadA!.id}, 'Null Reason Job', 'drain cleaning',
        'scheduled', ${origA!.id}, ${now.toISOString()}, ${now.toISOString()}
      ) returning id`;

    // A confirmed callback whose CALLBACK job was created before `since` — must be excluded.
    const [ancientCallbackA] = await admin<{ id: string }[]>`
      insert into jobs (org_id, num, lead_id, title, svc, status, callback_of, callback_reason, created_at, updated_at)
      values (
        ${orgAId}, 'JOB-AUTOPSY-ANCIENT-A', ${autopsyLeadA!.id}, 'Ancient Callback', 'drain cleaning',
        'scheduled', ${origA!.id}, 'callback', ${ancientDate.toISOString()}, ${ancientDate.toISOString()}
      ) returning id`;

    // Org B original job + confirmed callback — must NOT appear when reading as org A.
    const [origB] = await admin<{ id: string }[]>`
      insert into jobs (org_id, num, lead_id, title, svc, status, completed_at, created_at, updated_at)
      values (
        ${orgBId}, 'JOB-AUTOPSY-ORIG-B', ${autopsyLeadB!.id}, 'Org B Original', 'hvac',
        'complete', ${completedAtDate.toISOString()}, ${thirtyDaysAgo.toISOString()}, ${thirtyDaysAgo.toISOString()}
      ) returning id`;
    const [callbackB] = await admin<{ id: string }[]>`
      insert into jobs (org_id, num, lead_id, title, svc, status, callback_of, callback_reason, created_at, updated_at)
      values (
        ${orgBId}, 'JOB-AUTOPSY-CB-B', ${autopsyLeadB!.id}, 'Org B Callback', 'hvac',
        'scheduled', ${origB!.id}, 'callback', ${now.toISOString()}, ${now.toISOString()}
      ) returning id`;

    // `since` = sinceBase (1 second ago) — includes jobs seeded at `now`, excludes ancient ones
    // and any "callback" jobs left by other tests in orgA (which have older created_at).
    const since = sinceBase;

    const pairs = await withTenant(orgA, async (tx) => {
      const repo = new DrizzleJobRepository(tx, orgA);
      return repo.listConfirmedCallbacksWithOriginals(since);
    });

    // Exactly one pair: the confirmed callback → its original.
    expect(pairs).toHaveLength(1);
    const pair = pairs[0]!;
    expect(pair.callback.id).toBe(callbackA!.id);
    expect(pair.callback.num).toBe("JOB-AUTOPSY-CB-A");
    expect(pair.callback.svc).toBe("drain cleaning");
    expect(pair.original.id).toBe(origA!.id);
    expect(pair.original.num).toBe("JOB-AUTOPSY-ORIG-A");
    expect(pair.original.svc).toBe("drain cleaning");

    // Checklist snapshot is present on the original.
    expect(pair.original.checklist).not.toBeNull();
    expect(pair.original.checklist!.name).toBe("Plumbing Safety Check");
    expect(pair.original.checklist!.items).toHaveLength(2);
    expect(pair.original.checklist!.items[0]!.text).toBe("Check pipe pressure");

    // Non-callback reason must not appear (new_issue AND null reason).
    const callbackIds = pairs.map((p) => p.callback.id as string);
    expect(callbackIds).not.toContain(newIssueA!.id);
    expect(callbackIds).not.toContain(nullReasonA!.id);

    // Ancient callback (before `since`) must not appear.
    expect(callbackIds).not.toContain(ancientCallbackA!.id);

    // Org B's callback must not appear (RLS + explicit org filter).
    expect(callbackIds).not.toContain(callbackB!.id);
  });

  it("listRecentForCallbackScan returns recent org-A rows and excludes ancient + org-B jobs", async () => {
    const orgA = asOrgId(orgAId);
    const orgB = asOrgId(orgBId);

    // Fresh dedicated lead so this test doesn't collide with other test data on leadA.
    const [scanLead] = await admin<{ id: string }[]>`
      insert into leads (org_id, name) values (${orgAId}, 'Scan Lead ' || gen_random_uuid()) returning id`;

    const now = new Date();
    const tenDaysAgo = new Date(now.getTime() - 10 * 86400000);
    const completedAt = new Date(now.getTime() - 20 * 86400000);

    // Insert original job (completed, 10 days ago) and callback candidate (today) via raw SQL
    // so we can control created_at / completed_at precisely.
    const [origRow] = await admin<{ id: string }[]>`
      insert into jobs (org_id, num, lead_id, title, svc, status, completed_at, created_at, updated_at)
      values (
        ${orgAId}, 'JOB-SCAN-ORIG', ${scanLead!.id}, 'Original', 'drain cleaning',
        'complete', ${completedAt.toISOString()}, ${tenDaysAgo.toISOString()}, ${tenDaysAgo.toISOString()}
      ) returning id`;

    const [newRow] = await admin<{ id: string }[]>`
      insert into jobs (org_id, num, lead_id, title, svc, status, created_at, updated_at)
      values (
        ${orgAId}, 'JOB-SCAN-NEW', ${scanLead!.id}, 'Callback', 'drain cleaning',
        'scheduled', ${now.toISOString()}, ${now.toISOString()}
      ) returning id`;

    // Ancient job (200 days ago) — must be excluded by the `since` filter.
    const ancientDate = new Date(now.getTime() - 200 * 86400000);
    const [ancientRow] = await admin<{ id: string }[]>`
      insert into jobs (org_id, num, lead_id, title, svc, status, created_at, updated_at)
      values (
        ${orgAId}, 'JOB-SCAN-ANCIENT', ${scanLead!.id}, 'Ancient', 'drain cleaning',
        'complete', ${ancientDate.toISOString()}, ${ancientDate.toISOString()}
      ) returning id`;

    // Fresh lead + job in org B — must not appear in org A's scan.
    const [scanLeadB] = await admin<{ id: string }[]>`
      insert into leads (org_id, name) values (${orgBId}, 'Scan Lead B ' || gen_random_uuid()) returning id`;
    const [orgBRow] = await admin<{ id: string }[]>`
      insert into jobs (org_id, num, lead_id, title, svc, status, created_at, updated_at)
      values (
        ${orgBId}, 'JOB-SCAN-B', ${scanLeadB!.id}, 'Org B Job', 'drain cleaning',
        'scheduled', ${now.toISOString()}, ${now.toISOString()}
      ) returning id`;

    // Use a `since` that is 135 days ago (90 + 45 lookback from "now") — covers orig+new, excludes ancient.
    const since = new Date(now.getTime() - 135 * 86400000);

    const rows = await withTenant(orgA, async (tx) => {
      const repo = new DrizzleJobRepository(tx, orgA);
      return repo.listRecentForCallbackScan(since);
    });

    const ids = rows.map((r) => r.id as string);

    // Both recent jobs are returned.
    expect(ids).toContain(origRow!.id);
    expect(ids).toContain(newRow!.id);

    // Ancient job excluded.
    expect(ids).not.toContain(ancientRow!.id);

    // Org B's job excluded (RLS + explicit orgId filter).
    expect(ids).not.toContain(orgBRow!.id);

    // Field projection: verify key columns project correctly.
    const origResult = rows.find((r) => (r.id as string) === origRow!.id);
    expect(origResult).toBeDefined();
    expect(origResult!.svc).toBe("drain cleaning");
    expect(origResult!.num).toBe("JOB-SCAN-ORIG");
    expect(origResult!.status).toBe("complete");
    expect(origResult!.completedAt).not.toBeNull();
    expect(origResult!.callbackReason).toBeNull();
    expect(origResult!.callbackOf).toBeNull();
  });
});
