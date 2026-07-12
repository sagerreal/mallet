import { describe, it, expect, beforeAll, afterAll } from "vitest";
import postgres from "postgres";
import type { Sql } from "postgres";
import { randomUUID } from "node:crypto";
import { asOrgId, asUserId, systemClock } from "@mallet/shared/types";
import { InMemoryEventBus, uuidGenerator } from "@mallet/shared/ports";
import { closeDb } from "@mallet/shared/db/client";
import type { Principal, Role } from "@mallet/identity";
import { appRouter } from "@/trpc/root";
import type { Context } from "@/trpc/init";

// Integration tests for the tech-facing field surface: v1.field.myDay / start / complete /
// setVerifyAnswer.
// The assignment boundary is the security primitive: a tech may only act on jobs assigned to them.
const hasDb = Boolean(process.env.APP_DATABASE_URL && process.env.DATABASE_URL);
const suite = hasDb ? describe : describe.skip;

const stubAuth = {
  authenticate: async () => {
    throw new Error("authProvider should not be called in createCaller tests");
  },
};

const ctxFor = (userId: string, orgId: string, role: Role): Context => ({
  principal: { userId: asUserId(userId), orgId: asOrgId(orgId), role } satisfies Principal,
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
    signupStore: { createOrgForUser: async () => { throw new Error("unused in this test"); } },
  },
});

suite("v1.field — tech assignee guard (live RLS)", () => {
  let admin: Sql;
  let orgId = "";
  let techAId = "";
  let techBId = "";
  let ownerUserId = "";
  let leadId = "";
  let jobAId = ""; // assigned to techA
  let jobBId = ""; // assigned to techB

  beforeAll(async () => {
    admin = postgres(process.env.DATABASE_URL as string, { max: 1, ssl: "require", prepare: false });

    // Seed org
    const [org] = await admin<{ id: string }[]>`
      insert into orgs (name) values ('Field Test Org ' || gen_random_uuid()) returning id
    `;
    orgId = org!.id;

    // Seed users: techA, techB, owner
    const [tA] = await admin<{ id: string }[]>`
      insert into users (org_id, auth_user_id, email, role)
      values (${orgId}, ${randomUUID()}, 'techA@field.test', 'tech')
      returning id
    `;
    techAId = tA!.id;

    const [tB] = await admin<{ id: string }[]>`
      insert into users (org_id, auth_user_id, email, role)
      values (${orgId}, ${randomUUID()}, 'techB@field.test', 'tech')
      returning id
    `;
    techBId = tB!.id;

    const [ow] = await admin<{ id: string }[]>`
      insert into users (org_id, auth_user_id, email, role)
      values (${orgId}, ${randomUUID()}, 'owner@field.test', 'owner')
      returning id
    `;
    ownerUserId = ow!.id;

    // Seed lead
    const [lead] = await admin<{ id: string }[]>`
      insert into leads (org_id, name) values (${orgId}, 'Field Test Customer') returning id
    `;
    leadId = lead!.id;

    // Seed two scheduled jobs — one assigned to techA, one to techB
    const [jA] = await admin<{ id: string }[]>`
      insert into jobs (org_id, lead_id, num, status, total_cents, assignee_user_id)
      values (${orgId}, ${leadId}, 'JOB-TA-01', 'scheduled', 0, ${techAId})
      returning id
    `;
    jobAId = jA!.id;

    const [jB] = await admin<{ id: string }[]>`
      insert into jobs (org_id, lead_id, num, status, total_cents, assignee_user_id)
      values (${orgId}, ${leadId}, 'JOB-TB-01', 'scheduled', 0, ${techBId})
      returning id
    `;
    jobBId = jB!.id;
  });

  afterAll(async () => {
    if (orgId) await admin`delete from orgs where id = ${orgId}`;
    await admin.end({ timeout: 5 });
    await closeDb();
  });

  it("myDay returns only MY active jobs", async () => {
    const callerA = appRouter.createCaller(ctxFor(techAId, orgId, "tech"));
    const resultA = await callerA.v1.field.myDay();
    expect(resultA.items).toHaveLength(1);
    expect(resultA.items[0]!.id).toBe(jobAId);

    const callerB = appRouter.createCaller(ctxFor(techBId, orgId, "tech"));
    const resultB = await callerB.v1.field.myDay();
    expect(resultB.items).toHaveLength(1);
    expect(resultB.items[0]!.id).toBe(jobBId);
  });

  it("tech can start/complete their OWN job", async () => {
    const caller = appRouter.createCaller(ctxFor(techAId, orgId, "tech"));
    const started = await caller.v1.field.start({ jobId: jobAId });
    expect(started.status).toBe("in_progress");

    const completed = await caller.v1.field.complete({ jobId: jobAId });
    expect(completed.status).toBe("complete");
  });

  it("tech gets FORBIDDEN on someone else's job", async () => {
    // techA tries to start techB's job
    const caller = appRouter.createCaller(ctxFor(techAId, orgId, "tech"));
    await expect(caller.v1.field.start({ jobId: jobBId })).rejects.toMatchObject({ code: "FORBIDDEN" });

    // Status must be unchanged
    const [row] = await admin<{ status: string }[]>`select status from jobs where id = ${jobBId}`;
    expect(row!.status).toBe("scheduled");
  });

  it("owner can start any job through the field surface", async () => {
    const caller = appRouter.createCaller(ctxFor(ownerUserId, orgId, "owner"));
    const started = await caller.v1.field.start({ jobId: jobBId });
    expect(started.status).toBe("in_progress");
  });

  it("myDay returns scheduled jobs sorted by scheduledStart asc (not by insert order)", async () => {
    // Seed a fresh tech so the ordering test is isolated from the jobs created in beforeAll.
    const [orderTech] = await admin<{ id: string }[]>`
      insert into users (org_id, auth_user_id, email, role)
      values (${orgId}, ${randomUUID()}, 'ordertech@field.test', 'tech')
      returning id
    `;
    const orderTechId = orderTech!.id;

    // T+2h job inserted FIRST (would come first if sorted by insert order / created_at).
    const tPlus2 = new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString();
    // T+1h job inserted SECOND.
    const tPlus1 = new Date(Date.now() + 1 * 60 * 60 * 1000).toISOString();

    const [jobLater] = await admin<{ id: string }[]>`
      insert into jobs (org_id, lead_id, num, status, total_cents, assignee_user_id, scheduled_start)
      values (${orgId}, ${leadId}, 'JOB-ORDER-LATER', 'scheduled', 0, ${orderTechId}, ${tPlus2})
      returning id
    `;
    const [jobEarlier] = await admin<{ id: string }[]>`
      insert into jobs (org_id, lead_id, num, status, total_cents, assignee_user_id, scheduled_start)
      values (${orgId}, ${leadId}, 'JOB-ORDER-EARLIER', 'scheduled', 0, ${orderTechId}, ${tPlus1})
      returning id
    `;

    try {
      const caller = appRouter.createCaller(ctxFor(orderTechId, orgId, "tech"));
      const result = await caller.v1.field.myDay();

      expect(result.items).toHaveLength(2);
      // Earlier scheduledStart (T+1h, inserted second) must come before later (T+2h, inserted first).
      expect(result.items[0]!.id).toBe(jobEarlier!.id);
      expect(result.items[1]!.id).toBe(jobLater!.id);
    } finally {
      await admin`delete from jobs where id in (${jobLater!.id}, ${jobEarlier!.id})`;
      await admin`delete from users where id = ${orderTechId}`;
    }
  });

  // ── v1.field.setVerifyAnswer — checklist check-offs from the job site ──────

  const CHECKLIST = JSON.stringify({
    name: "Before you leave",
    items: [{ id: "i1", text: "Water back on", type: "check", required: true }],
  });

  const seedChecklistJob = async (num: string, assigneeId: string | null): Promise<string> => {
    const [row] = await admin<{ id: string }[]>`
      insert into jobs (org_id, lead_id, num, status, total_cents, assignee_user_id, checklist)
      values (${orgId}, ${leadId}, ${num}, 'in_progress', 0, ${assigneeId}, ${CHECKLIST}::jsonb)
      returning id
    `;
    return row!.id;
  };

  it("assigned tech saves a verify answer, it survives a myDay re-read, and clear removes it", async () => {
    const jobId = await seedChecklistJob("JOB-VER-01", techAId);
    try {
      const caller = appRouter.createCaller(ctxFor(techAId, orgId, "tech"));

      const dto = await caller.v1.field.setVerifyAnswer({ jobId, itemId: "i1", state: "pass", via: "manual" });
      expect(dto.verifyAnswers).toEqual([{ itemId: "i1", state: "pass", via: "manual", reason: null }]);

      // Survives a re-read through the tech's own surface — myDay must carry the
      // checklist AND the saved answers (execution data), not just job headers.
      const day = await caller.v1.field.myDay();
      const mine = day.items.find((i) => i.id === jobId);
      expect(mine?.checklist?.items[0]?.id).toBe("i1");
      expect(mine?.verifyAnswers).toEqual([{ itemId: "i1", state: "pass", via: "manual", reason: null }]);

      const cleared = await caller.v1.field.setVerifyAnswer({ jobId, itemId: "i1", state: "clear" });
      expect(cleared.verifyAnswers).toEqual([]);
    } finally {
      await admin`delete from jobs where id = ${jobId}`;
    }
  });

  it("tech assigned only via an ACTIVE VISIT can save (job-level assignee is someone else)", async () => {
    const jobId = await seedChecklistJob("JOB-VER-02", techBId);
    await admin`
      insert into job_visits (org_id, job_id, assignee_user_id, status, position)
      values (${orgId}, ${jobId}, ${techAId}, 'pending', 1)
    `;
    try {
      const caller = appRouter.createCaller(ctxFor(techAId, orgId, "tech"));
      const dto = await caller.v1.field.setVerifyAnswer({ jobId, itemId: "i1", state: "pass", via: "manual" });
      expect(dto.verifyAnswers).toEqual([{ itemId: "i1", state: "pass", via: "manual", reason: null }]);
    } finally {
      await admin`delete from jobs where id = ${jobId}`;
    }
  });

  it("tech NOT on the job gets FORBIDDEN and nothing is written (a canceled visit is no claim)", async () => {
    const jobId = await seedChecklistJob("JOB-VER-03", techBId);
    // techA once had a visit here, but it was canceled — that must not grant access.
    await admin`
      insert into job_visits (org_id, job_id, assignee_user_id, status, position)
      values (${orgId}, ${jobId}, ${techAId}, 'canceled', 1)
    `;
    try {
      const caller = appRouter.createCaller(ctxFor(techAId, orgId, "tech"));
      await expect(
        caller.v1.field.setVerifyAnswer({ jobId, itemId: "i1", state: "pass", via: "manual" }),
      ).rejects.toMatchObject({ code: "FORBIDDEN" });

      const rows = await admin`select id from job_verify_answers where job_id = ${jobId}`;
      expect(rows).toHaveLength(0);
    } finally {
      await admin`delete from jobs where id = ${jobId}`;
    }
  });

  it("office/owner saves through the field procedure without an assignment (override with reason)", async () => {
    const jobId = await seedChecklistJob("JOB-VER-04", techBId);
    try {
      const caller = appRouter.createCaller(ctxFor(ownerUserId, orgId, "owner"));
      const dto = await caller.v1.field.setVerifyAnswer({ jobId, itemId: "i1", state: "override", reason: "N/A today" });
      expect(dto.verifyAnswers).toEqual([{ itemId: "i1", state: "override", via: null, reason: "N/A today" }]);
    } finally {
      await admin`delete from jobs where id = ${jobId}`;
    }
  });
});
