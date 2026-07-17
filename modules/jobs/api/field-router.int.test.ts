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
import type { PhotoStorageGateway } from "../domain/photo-storage-gateway";

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
    paymentLinkGateway: null, connectGateway: null, photoStorageGateway: null,
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

  // ── Converged assignment semantics: visit-assigned techs SEE and can START ──

  it("tech assigned only via an ACTIVE VISIT sees the job in myDay and can start it", async () => {
    // Fresh tech so myDay is isolated from the beforeAll jobs.
    const [vTech] = await admin<{ id: string }[]>`
      insert into users (org_id, auth_user_id, email, role)
      values (${orgId}, ${randomUUID()}, 'visittech@field.test', 'tech')
      returning id
    `;
    const visitTechId = vTech!.id;
    const [row] = await admin<{ id: string }[]>`
      insert into jobs (org_id, lead_id, num, status, total_cents, assignee_user_id)
      values (${orgId}, ${leadId}, 'JOB-VISIT-SEE', 'scheduled', 0, ${techBId})
      returning id
    `;
    const jobId = row!.id;
    await admin`
      insert into job_visits (org_id, job_id, assignee_user_id, status, position)
      values (${orgId}, ${jobId}, ${visitTechId}, 'pending', 1)
    `;
    try {
      const caller = appRouter.createCaller(ctxFor(visitTechId, orgId, "tech"));
      const day = await caller.v1.field.myDay();
      expect(day.items.map((i) => i.id)).toContain(jobId);

      const started = await caller.v1.field.start({ jobId });
      expect(started.status).toBe("in_progress");
    } finally {
      await admin`delete from jobs where id = ${jobId}`;
      await admin`delete from users where id = ${visitTechId}`;
    }
  });

  it("a job claimed only through a CANCELED visit stays out of myDay", async () => {
    const [cTech] = await admin<{ id: string }[]>`
      insert into users (org_id, auth_user_id, email, role)
      values (${orgId}, ${randomUUID()}, 'canceledtech@field.test', 'tech')
      returning id
    `;
    const canceledTechId = cTech!.id;
    const [row] = await admin<{ id: string }[]>`
      insert into jobs (org_id, lead_id, num, status, total_cents, assignee_user_id)
      values (${orgId}, ${leadId}, 'JOB-VISIT-CANC', 'scheduled', 0, ${techBId})
      returning id
    `;
    const jobId = row!.id;
    await admin`
      insert into job_visits (org_id, job_id, assignee_user_id, status, position)
      values (${orgId}, ${jobId}, ${canceledTechId}, 'canceled', 1)
    `;
    try {
      const caller = appRouter.createCaller(ctxFor(canceledTechId, orgId, "tech"));
      const day = await caller.v1.field.myDay();
      expect(day.items.map((i) => i.id)).not.toContain(jobId);
    } finally {
      await admin`delete from jobs where id = ${jobId}`;
      await admin`delete from users where id = ${canceledTechId}`;
    }
  });

  // ── Terminal-status gate: closed jobs reject tech check-off writes ─────────

  it("tech write on a COMPLETE job is BAD_REQUEST; office may still correct it", async () => {
    const [row] = await admin<{ id: string }[]>`
      insert into jobs (org_id, lead_id, num, status, total_cents, assignee_user_id, checklist)
      values (${orgId}, ${leadId}, 'JOB-CLOSED-01', 'complete', 0, ${techAId}, ${CHECKLIST}::jsonb)
      returning id
    `;
    const jobId = row!.id;
    try {
      const techCaller = appRouter.createCaller(ctxFor(techAId, orgId, "tech"));
      await expect(
        techCaller.v1.field.setVerifyAnswer({ jobId, itemId: "i1", state: "pass", via: "manual" }),
      ).rejects.toMatchObject({
        code: "BAD_REQUEST",
        message: "This job is closed — ask the office to change it.",
      });
      const rows = await admin`select id from job_verify_answers where job_id = ${jobId}`;
      expect(rows).toHaveLength(0);

      // Office corrections stay allowed on closed jobs.
      const ownerCaller = appRouter.createCaller(ctxFor(ownerUserId, orgId, "owner"));
      const dto = await ownerCaller.v1.field.setVerifyAnswer({ jobId, itemId: "i1", state: "pass", via: "manual" });
      expect(dto.verifyAnswers).toEqual([{ itemId: "i1", state: "pass", via: "manual", reason: null }]);
    } finally {
      await admin`delete from jobs where id = ${jobId}`;
    }
  });

  // ── Server-side money redaction on the field surface ───────────────────────

  describe("money redaction (tech devices)", () => {
    let redactTechId = "";
    let pricedJobId = "";

    beforeAll(async () => {
      const [rt] = await admin<{ id: string }[]>`
        insert into users (org_id, auth_user_id, email, role)
        values (${orgId}, ${randomUUID()}, 'redacttech@field.test', 'tech')
        returning id
      `;
      redactTechId = rt!.id;
      const [row] = await admin<{ id: string }[]>`
        insert into jobs (org_id, lead_id, num, status, total_cents, assignee_user_id, checklist)
        values (${orgId}, ${leadId}, 'JOB-REDACT-01', 'in_progress', 25000, ${redactTechId}, ${CHECKLIST}::jsonb)
        returning id
      `;
      pricedJobId = row!.id;
      await admin`
        insert into job_lines (org_id, job_id, description, quantity, rate_cents, cost_cents)
        values (${orgId}, ${pricedJobId}, 'Panel swap', 1, 25000, 9000)
      `;
      await admin`
        insert into job_addons (org_id, job_id, description, quantity, rate_cents, cost_cents)
        values (${orgId}, ${pricedJobId}, 'Extra outlet', 1, 12000, 4000)
      `;
    });

    afterAll(async () => {
      if (pricedJobId) await admin`delete from jobs where id = ${pricedJobId}`;
      if (redactTechId) await admin`delete from users where id = ${redactTechId}`;
      await admin`delete from org_settings where org_id = ${orgId}`;
    });

    it("tech myDay ALWAYS strips cost; rate stays while techSeesPrice is on (default)", async () => {
      const caller = appRouter.createCaller(ctxFor(redactTechId, orgId, "tech"));
      const day = await caller.v1.field.myDay();
      const mine = day.items.find((i) => i.id === pricedJobId);
      expect(mine?.lines[0]?.rate?.cents).toBe(25000);
      expect(mine?.lines[0]?.cost).toBeNull();
      expect(mine?.addons[0]?.rate?.cents).toBe(12000);
      expect(mine?.addons[0]?.cost).toBeNull();
      // total survives while seesPrice is on (only the redacted path nulls it)
      expect(mine?.total).not.toBeNull();
    });

    it("tech myDay strips rate too when the org turns techSeesPrice off; owner unchanged", async () => {
      await admin`
        insert into org_settings (org_id, tech_sees_price, booking)
        values (${orgId}, false, '{"services": [], "notServices": "", "serviceFee": 0, "feeCredited": false}'::jsonb)
        on conflict (org_id) do update set tech_sees_price = false
      `;
      const techCaller = appRouter.createCaller(ctxFor(redactTechId, orgId, "tech"));
      const day = await techCaller.v1.field.myDay();
      const mine = day.items.find((i) => i.id === pricedJobId);
      expect(mine?.lines[0]?.rate).toBeNull();
      expect(mine?.lines[0]?.cost).toBeNull();
      expect(mine?.addons[0]?.rate).toBeNull();
      // Aggregate total is also redacted — the money-leak fix.
      expect(mine?.total).toBeNull();

      // setVerifyAnswer's returned jobDTO is redacted the same way for techs.
      const dto = await techCaller.v1.field.setVerifyAnswer({ jobId: pricedJobId, itemId: "i1", state: "pass", via: "manual" });
      expect(dto.lines[0]?.rate).toBeNull();
      expect(dto.lines[0]?.cost).toBeNull();
      // Total is null in the setVerifyAnswer response too.
      expect(dto.total).toBeNull();

      // Owner/office responses are never redacted — same procedure, full figures.
      const ownerCaller = appRouter.createCaller(ctxFor(ownerUserId, orgId, "owner"));
      const officeDto = await ownerCaller.v1.field.setVerifyAnswer({ jobId: pricedJobId, itemId: "i1", state: "pass", via: "manual" });
      expect(officeDto.lines[0]?.rate?.cents).toBe(25000);
      expect(officeDto.lines[0]?.cost?.cents).toBe(9000);
      // Office always receives the real total.
      expect(officeDto.total?.cents).toBe(25000);
    });

    it("tech myDay total is null when techSeesPrice off; office setVerifyAnswer total is real cents", async () => {
      // Ensure techSeesPrice is off (may have been set by the prior test; be explicit).
      await admin`
        insert into org_settings (org_id, tech_sees_price, booking)
        values (${orgId}, false, '{"services": [], "notServices": "", "serviceFee": 0, "feeCredited": false}'::jsonb)
        on conflict (org_id) do update set tech_sees_price = false
      `;
      const techCaller = appRouter.createCaller(ctxFor(redactTechId, orgId, "tech"));
      const techDay = await techCaller.v1.field.myDay();
      const techMine = techDay.items.find((i) => i.id === pricedJobId);
      expect(techMine?.total).toBeNull();

      // Reset to default (tech sees price) so other tests are not affected.
      await admin`update org_settings set tech_sees_price = true where org_id = ${orgId}`;
      // Owner/office always receive real total via setVerifyAnswer (myDay is scoped
      // to the caller's own assignments so the owner wouldn't see the tech's job there).
      const ownerCaller = appRouter.createCaller(ctxFor(ownerUserId, orgId, "owner"));
      const ownerDto = await ownerCaller.v1.field.setVerifyAnswer({ jobId: pricedJobId, itemId: "i1", state: "pass", via: "manual" });
      expect(ownerDto.total?.cents).toBe(25000);
    });
  });

  // ── v1.field.addAddon — proposed-only, rate-redacted tech found-work write ────

  describe("field addAddon endpoint", () => {
    let addonTechId = "";
    let addonTechSeesId = "";
    let addonJobId = "";      // assigned to addonTechId (no seesPrice)
    let addonJobSeesId = ""; // assigned to addonTechSeesId (seesPrice = true)
    let offJobId = "";        // assigned to addonTechId (terminal)
    let doneAddonJobId = ""; // complete job for terminal gate test

    beforeAll(async () => {
      // Turn seesPrice OFF for the org so we can test the redaction contract.
      await admin`
        insert into org_settings (org_id, tech_sees_price, booking)
        values (${orgId}, false, '{"services": [], "notServices": "", "serviceFee": 0, "feeCredited": false}'::jsonb)
        on conflict (org_id) do update set tech_sees_price = false
      `;

      const [at] = await admin<{ id: string }[]>`
        insert into users (org_id, auth_user_id, email, role)
        values (${orgId}, gen_random_uuid(), 'addontech@f.ex', 'tech') returning id`;
      addonTechId = at!.id;

      const [ast] = await admin<{ id: string }[]>`
        insert into users (org_id, auth_user_id, email, role)
        values (${orgId}, gen_random_uuid(), 'addontechsees@f.ex', 'tech') returning id`;
      addonTechSeesId = ast!.id;

      const [aj] = await admin<{ id: string }[]>`
        insert into jobs (org_id, lead_id, num, status, assignee_user_id)
        values (${orgId}, ${leadId}, 'JOB-ADDON-01', 'in_progress', ${addonTechId}) returning id`;
      addonJobId = aj!.id;

      const [asj] = await admin<{ id: string }[]>`
        insert into jobs (org_id, lead_id, num, status, assignee_user_id)
        values (${orgId}, ${leadId}, 'JOB-ADDON-02', 'in_progress', ${addonTechSeesId}) returning id`;
      addonJobSeesId = asj!.id;

      const [oj] = await admin<{ id: string }[]>`
        insert into jobs (org_id, lead_id, num, status, assignee_user_id)
        values (${orgId}, ${leadId}, 'JOB-ADDON-OFF', 'in_progress', ${techBId}) returning id`;
      offJobId = oj!.id;

      const [dj] = await admin<{ id: string }[]>`
        insert into jobs (org_id, lead_id, num, status, completed_at, assignee_user_id)
        values (${orgId}, ${leadId}, 'JOB-ADDON-DONE', 'complete', now(), ${addonTechId}) returning id`;
      doneAddonJobId = dj!.id;
    });

    afterAll(async () => {
      for (const id of [addonJobId, addonJobSeesId, offJobId, doneAddonJobId]) {
        if (id) await admin`delete from jobs where id = ${id}`;
      }
      for (const id of [addonTechId, addonTechSeesId]) {
        if (id) await admin`delete from users where id = ${id}`;
      }
      // Restore seesPrice so other tests are not affected.
      await admin`update org_settings set tech_sees_price = true where org_id = ${orgId}`;
    });

    it("assigned tech adds an addon → DB row is proposed + response is redacted", async () => {
      const caller = appRouter.createCaller(ctxFor(addonTechId, orgId, "tech"));
      const dto = await caller.v1.field.addAddon({
        jobId: addonJobId,
        description: "Extra shutoff valve",
        rateCents: 9999, // !seesPrice → must be stored as 0
      });

      // Response: rate is null (redacted) because seesPrice is off for this org.
      const added = dto.addons.find((a) => a.description === "Extra shutoff valve");
      expect(added).toBeDefined();
      expect(added!.status).toBe("proposed");
      expect(added!.rate).toBeNull();
      expect(added!.cost).toBeNull();

      // DB row: rate_cents must be 0 (not 9999) — the money contract.
      const [row] = await admin<{ status: string; rate_cents: number }[]>`
        select status, rate_cents from job_addons where job_id = ${addonJobId} and description = 'Extra shutoff valve'`;
      expect(row!.status).toBe("proposed");
      expect(row!.rate_cents).toBe(0);
    });

    it("!seesPrice tech sending rateCents 9999 → stored 0 in the DB", async () => {
      // Explicit DB assertion from a second add call (distinct description).
      const caller = appRouter.createCaller(ctxFor(addonTechId, orgId, "tech"));
      await caller.v1.field.addAddon({
        jobId: addonJobId,
        description: "Pressure reducer check",
        rateCents: 9999,
      });
      const [row] = await admin<{ rate_cents: number }[]>`
        select rate_cents from job_addons where job_id = ${addonJobId} and description = 'Pressure reducer check'`;
      expect(row!.rate_cents).toBe(0);
    });

    it("seesPrice tech's rate is preserved in the DB", async () => {
      // Turn seesPrice ON just for this test.
      await admin`update org_settings set tech_sees_price = true where org_id = ${orgId}`;
      try {
        const caller = appRouter.createCaller(ctxFor(addonTechSeesId, orgId, "tech"));
        const dto = await caller.v1.field.addAddon({
          jobId: addonJobSeesId,
          description: "Expansion tank",
          rateCents: 4500,
        });
        // seesPrice → rate is visible in the response.
        const added = dto.addons.find((a) => a.description === "Expansion tank");
        expect(added!.rate?.cents).toBe(4500);
        expect(added!.status).toBe("proposed");

        const [row] = await admin<{ rate_cents: number }[]>`
          select rate_cents from job_addons where job_id = ${addonJobSeesId} and description = 'Expansion tank'`;
        expect(row!.rate_cents).toBe(4500);
      } finally {
        await admin`update org_settings set tech_sees_price = false where org_id = ${orgId}`;
      }
    });

    it("tech off-job gets FORBIDDEN — assignment gate fires before the write", async () => {
      const caller = appRouter.createCaller(ctxFor(addonTechId, orgId, "tech"));
      await expect(
        caller.v1.field.addAddon({ jobId: offJobId, description: "Trespassing addon" }),
      ).rejects.toMatchObject({ code: "FORBIDDEN" });

      const [n] = await admin<{ c: string }[]>`
        select count(*)::text as c from job_addons where job_id = ${offJobId}`;
      expect(n!.c).toBe("0");
    });

    it("terminal job → BAD_REQUEST even for the assigned tech", async () => {
      const caller = appRouter.createCaller(ctxFor(addonTechId, orgId, "tech"));
      await expect(
        caller.v1.field.addAddon({ jobId: doneAddonJobId, description: "Post-close addon" }),
      ).rejects.toMatchObject({ code: "BAD_REQUEST" });

      const [n] = await admin<{ c: string }[]>`
        select count(*)::text as c from job_addons where job_id = ${doneAddonJobId}`;
      expect(n!.c).toBe("0");
    });

    it("office caller through the OFFICE endpoint is unaffected (existing contract)", async () => {
      // The office endpoint uses ownerOrOffice and has no terminal gate by default.
      // Verify the office addAddon (v1.jobs.addAddon) still works and stores full rate.
      const caller = appRouter.createCaller(ctxFor(ownerUserId, orgId, "owner"));
      const dto = await caller.v1.jobs.addAddon({
        jobId: addonJobId,
        description: "Office-added material",
        rateCents: 7500,
        costCents: 3000,
        quantity: 1,
      });
      const added = dto.addons.find((a) => a.description === "Office-added material");
      expect(added!.rate?.cents).toBe(7500);
      expect(added!.cost?.cents).toBe(3000);
      expect(added!.status).toBe("proposed");
    });
  });

  // ── field photo endpoints (PR2 C2) ────────────────────────────────────────────
  describe("field photo endpoints", () => {
    let photoTechId = "";
    let photoJobId = "";
    let doneJobId = "";

    // A fake gateway so the mint path is testable without Supabase Storage env.
    const fakeGateway: PhotoStorageGateway = {
      createUploadUrl: async (cmd) => ({
        ok: true as const,
        value: {
          signedUrl: "https://fake/upload",
          token: "tok",
          storagePath: `${cmd.orgId}/${cmd.jobId}/${cmd.objectId}.${cmd.ext}`,
        },
      }),
      download: async () => ({
        ok: false as const,
        error: { kind: "external_service" as const, service: "fake-storage", message: "unused in this suite", retryable: false },
      }),
    };
    const ctxWithGateway = (userId: string, role: Role): Context => {
      const base = ctxFor(userId, orgId, role);
      return { ...base, deps: { ...base.deps, photoStorageGateway: fakeGateway } };
    };

    beforeAll(async () => {
      const [pt] = await admin<{ id: string }[]>`
        insert into users (org_id, auth_user_id, email, role)
        values (${orgId}, gen_random_uuid(), 'phototech@f.ex', 'tech') returning id`;
      photoTechId = pt!.id;
      const [pj] = await admin<{ id: string }[]>`
        insert into jobs (org_id, lead_id, num, status, assignee_user_id)
        values (${orgId}, ${leadId}, 'JOB-PHOTO-01', 'in_progress', ${photoTechId}) returning id`;
      photoJobId = pj!.id;
      const [dj] = await admin<{ id: string }[]>`
        insert into jobs (org_id, lead_id, num, status, completed_at, assignee_user_id)
        values (${orgId}, ${leadId}, 'JOB-PHOTO-DONE', 'complete', now(), ${photoTechId}) returning id`;
      doneJobId = dj!.id;
    });

    it("photoUploadUrl: PRECONDITION_FAILED when the gateway is unbound", async () => {
      const caller = appRouter.createCaller(ctxFor(photoTechId, orgId, "tech"));
      await expect(
        caller.v1.field.photoUploadUrl({ jobId: photoJobId, objectId: crypto.randomUUID(), ext: "jpg" }),
      ).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
    });

    it("photoUploadUrl: tech mints for THEIR job; FORBIDDEN for someone else's; BAD_REQUEST terminal", async () => {
      const caller = appRouter.createCaller(ctxWithGateway(photoTechId, "tech"));
      const objectId = crypto.randomUUID();
      const minted = await caller.v1.field.photoUploadUrl({ jobId: photoJobId, objectId, ext: "jpg" });
      expect(minted.storagePath).toBe(`${orgId}/${photoJobId}/${objectId}.jpg`);

      // techA (not on photoJob's sibling doneJob? — use jobB owned by techB) is off this job
      const stranger = appRouter.createCaller(ctxWithGateway(techAId, "tech"));
      await expect(
        stranger.v1.field.photoUploadUrl({ jobId: photoJobId, objectId: crypto.randomUUID(), ext: "jpg" }),
      ).rejects.toMatchObject({ code: "FORBIDDEN" });

      // terminal job → BAD_REQUEST for the assigned tech
      await expect(
        caller.v1.field.photoUploadUrl({ jobId: doneJobId, objectId: crypto.randomUUID(), ext: "jpg" }),
      ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    });

    it("addPhoto: persists the row for the assigned tech and returns a cost-redacted DTO", async () => {
      const caller = appRouter.createCaller(ctxFor(photoTechId, orgId, "tech"));
      const photoId = crypto.randomUUID();
      const dto = await caller.v1.field.addPhoto({
        jobId: photoJobId,
        id: photoId,
        storagePath: `${orgId}/${photoJobId}/${photoId}.jpg`,
        caption: "before shot",
      });
      expect(dto.photos.some((p) => p.id === photoId)).toBe(true);
      // Redaction shape holds on the field response (cost is ALWAYS null for techs).
      for (const line of dto.lines) expect(line.cost).toBeNull();

      const [row] = await admin<{ id: string }[]>`select id from job_photos where id = ${photoId}`;
      expect(row?.id).toBe(photoId);
    });

    it("addPhoto: rejects a storagePath outside the job's org/job prefix (use-case guard)", async () => {
      const caller = appRouter.createCaller(ctxFor(photoTechId, orgId, "tech"));
      await expect(
        caller.v1.field.addPhoto({
          jobId: photoJobId,
          id: crypto.randomUUID(),
          storagePath: `${orgId}/99999999-9999-9999-9999-999999999999/evil.jpg`,
        }),
      ).rejects.toMatchObject({ code: "BAD_REQUEST" });
      const [n] = await admin<{ c: string }[]>`
        select count(*)::text as c from job_photos where storage_path like '%evil.jpg'`;
      expect(n!.c).toBe("0");
    });

    it("addPhoto: BAD_REQUEST on a terminal job even for the assigned tech", async () => {
      const caller = appRouter.createCaller(ctxFor(photoTechId, orgId, "tech"));
      const photoId = crypto.randomUUID();
      await expect(
        caller.v1.field.addPhoto({
          jobId: doneJobId,
          id: photoId,
          storagePath: `${orgId}/${doneJobId}/${photoId}.jpg`,
        }),
      ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    });
  });
});
