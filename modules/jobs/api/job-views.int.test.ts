import { describe, it, expect, beforeAll, afterAll } from "vitest";
import postgres from "postgres";
import type { Sql } from "postgres";
import { randomUUID } from "node:crypto";
import { asOrgId, asUserId, systemClock } from "@mallet/shared/types";
import { InMemoryEventBus, uuidGenerator } from "@mallet/shared/ports";
import { closeDb } from "@mallet/shared/db/client";
import type { AuthProvider, Role } from "@mallet/identity";
import { appRouter } from "@/trpc/root";
import type { Context } from "@/trpc/init";

/**
 * The scoped views — the SQL twin of the lifecycle bands.
 *
 * The property that matters most here is MUTUAL EXCLUSIVITY. The grouped list got it for free;
 * in SQL it is the first thing to break, and a job counted in two bands makes every number on the
 * screen quietly wrong.
 */
const hasDb = Boolean(process.env.APP_DATABASE_URL && process.env.DATABASE_URL);
const suite = hasDb ? describe : describe.skip;

const stubAuth: AuthProvider = { authenticate: async () => { throw new Error("unused"); } };
const ctxFor = (orgId: string, role: Role): Context => ({
  principal: { userId: asUserId(randomUUID()), orgId: asOrgId(orgId), role },
  unmapped: null, tx: null,
  deps: {
    authProvider: stubAuth, bus: new InMemoryEventBus(), clock: systemClock, ids: uuidGenerator,
    paymentLinkGateway: null, connectGateway: null, photoStorageGateway: null, llmClient: null,
    apiKeyAuthenticator: { authenticate: async () => null },
    tokenVerifier: { verify: async () => null },
    signupStore: { createOrgForUser: async () => { throw new Error("unused"); } },
  },
});

const TODAY = "2026-08-15";

suite("jobs scoped views", () => {
  let admin: Sql;
  let orgId = "";
  let leadId = "";

  const addJob = async (num: string, status: string, visitDate: string | null) => {
    const [j] = await admin<{ id: string }[]>`
      insert into jobs (org_id, lead_id, num, status, total_cents)
      values (${orgId}, ${leadId}, ${num}, ${status}, 50000) returning id`;
    if (visitDate !== undefined) {
      await admin`
        insert into job_visits (org_id, job_id, scheduled_date, duration_minutes, status)
        values (${orgId}, ${j!.id}, ${visitDate}, 120, 'pending')`;
    }
    return j!.id;
  };

  beforeAll(async () => {
    admin = postgres(process.env.DATABASE_URL as string, { max: 1, ssl: "require", prepare: false });
    const [o] = await admin<{ id: string }[]>`
      insert into orgs (name) values ('JobViews ' || gen_random_uuid()) returning id`;
    orgId = o!.id;
    const [l] = await admin<{ id: string }[]>`
      insert into leads (org_id, name) values (${orgId}, 'View Customer') returning id`;
    leadId = l!.id;

    await addJob("V-SLOT1", "scheduled", null);          // visit with no date -> needs a slot
    await addJob("V-SLOT2", "scheduled", null);
    await addJob("V-TODAY1", "scheduled", TODAY);
    await addJob("V-TODAY2", "scheduled", TODAY);
    await addJob("V-TODAY3", "scheduled", TODAY);
    await addJob("V-WEEK1", "scheduled", "2026-08-18");   // within 7 days
    await addJob("V-WEEK2", "scheduled", "2026-08-22");   // exactly today+7
    await addJob("V-OVERDUE", "scheduled", "2026-08-01"); // past -> week, matching today-derive
    await addJob("V-LATER1", "scheduled", "2026-09-10");  // beyond the week
    const billed = await addJob("V-DONE1", "complete", "2026-08-02");
    await addJob("V-UNBILLED1", "complete", "2026-08-03");
    await addJob("V-UNBILLED2", "complete", "2026-08-04");
    await admin`
      insert into invoices (org_id, lead_id, source_job_id, num, status, total_cents)
      values (${orgId}, ${leadId}, ${billed}, 'INV-V1', 'sent', 50000)`;
  });

  afterAll(async () => {
    if (orgId) await admin`delete from orgs where id = ${orgId}`;
    await admin.end({ timeout: 5 });
    await closeDb();
  });

  it("counts each view correctly", async () => {
    const caller = appRouter.createCaller(ctxFor(orgId, "owner"));
    const c = await caller.v1.jobs.viewCounts({ today: TODAY });
    expect(c.needsSlot).toBe(2);
    expect(c.today).toBe(3);
    expect(c.week).toBe(3);        // 2 within 7 days + 1 overdue
    expect(c.upcoming).toBe(1);
    expect(c.needsInvoice).toBe(2);
    expect(c.done).toBe(1);
  });

  it("views are MUTUALLY EXCLUSIVE and account for every job", async () => {
    // The property the grouped list had for free. A job in two bands makes every number wrong.
    const caller = appRouter.createCaller(ctxFor(orgId, "owner"));
    const c = await caller.v1.jobs.viewCounts({ today: TODAY });
    const summed = Object.values(c).reduce((a, b) => a + b, 0);
    const [total] = await admin<{ n: number }[]>`
      select count(*)::int n from jobs where org_id = ${orgId} and deleted_at is null`;
    expect(summed).toBe(total!.n);

    // And no id appears in two views.
    const seen = new Set<string>();
    for (const view of ["needsSlot", "today", "week", "upcoming", "needsInvoice", "done"] as const) {
      const page = await caller.v1.jobs.list({ view, today: TODAY, limit: 50 });
      for (const j of page.items) {
        expect(seen.has(j.id), `${j.num} appears in more than one view`).toBe(false);
        seen.add(j.id);
      }
    }
    expect(seen.size).toBe(total!.n);
  });

  it("a job scheduled TODAY is not also counted in This week", async () => {
    // week has to exclude today explicitly, or this afternoon's job lands in both.
    const caller = appRouter.createCaller(ctxFor(orgId, "owner"));
    const week = await caller.v1.jobs.list({ view: "week", today: TODAY, limit: 50 });
    expect(week.items.map((j) => j.num)).not.toContain("V-TODAY1");
  });

  it("needsSlot means no date placed, not 'no visit row'", async () => {
    const caller = appRouter.createCaller(ctxFor(orgId, "owner"));
    const page = await caller.v1.jobs.list({ view: "needsSlot", today: TODAY, limit: 50 });
    expect(page.items.map((j) => j.num).sort()).toEqual(["V-SLOT1", "V-SLOT2"]);
  });

  it("separates finished work by whether it was billed", async () => {
    const caller = appRouter.createCaller(ctxFor(orgId, "owner"));
    const unbilled = await caller.v1.jobs.list({ view: "needsInvoice", today: TODAY, limit: 50 });
    expect(unbilled.items.map((j) => j.num).sort()).toEqual(["V-UNBILLED1", "V-UNBILLED2"]);
    const done = await caller.v1.jobs.list({ view: "done", today: TODAY, limit: 50 });
    expect(done.items.map((j) => j.num)).toEqual(["V-DONE1"]);
  });

  it("view counts respect an active search", async () => {
    // The dropdown must recount when the list is filtered, or the numbers describe a different
    // list than the one on screen.
    const caller = appRouter.createCaller(ctxFor(orgId, "owner"));
    const c = await caller.v1.jobs.viewCounts({ today: TODAY, search: "V-TODAY" });
    expect(c.today).toBe(3);
    expect(c.needsSlot).toBe(0);
  });

  it("does not leak across tenants", async () => {
    const [other] = await admin<{ id: string }[]>`
      insert into orgs (name) values ('JobViews Other ' || gen_random_uuid()) returning id`;
    const caller = appRouter.createCaller(ctxFor(other!.id, "owner"));
    const c = await caller.v1.jobs.viewCounts({ today: TODAY });
    expect(Object.values(c).reduce((a, b) => a + b, 0)).toBe(0);
    await admin`delete from orgs where id = ${other!.id}`;
  });
});
