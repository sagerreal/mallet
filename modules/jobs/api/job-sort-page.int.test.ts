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
 * Server-side sort, search and keyset pagination on the jobs list.
 *
 * Everything here crosses a PAGE BOUNDARY on purpose. A broken sort looks perfect on page one —
 * it is page two, where the cursor has to resume the ordering, that repeats rows, skips them, or
 * silently drops the NULL block.
 */
const hasDb = Boolean(process.env.APP_DATABASE_URL && process.env.DATABASE_URL);
const suite = hasDb ? describe : describe.skip;

const stubAuth: AuthProvider = { authenticate: async () => { throw new Error("unused"); } };
const ctxFor = (orgId: string, role: Role): Context => ({
  principal: { userId: asUserId(randomUUID()), orgId: asOrgId(orgId), role },
  unmapped: null,
  tx: null,
  deps: {
    authProvider: stubAuth, bus: new InMemoryEventBus(), clock: systemClock, ids: uuidGenerator,
    paymentLinkGateway: null, connectGateway: null, photoStorageGateway: null, llmClient: null,
    apiKeyAuthenticator: { authenticate: async () => null },
    tokenVerifier: { verify: async () => null },
    signupStore: { createOrgForUser: async () => { throw new Error("unused"); } },
  },
});

suite("jobs list — server-side sort, search, keyset paging", () => {
  let admin: Sql;
  let orgId = "";
  let leadId = "";

  // 7 scheduled jobs on known dates + 3 UNSCHEDULED. The unscheduled ones are the point: they
  // carry scheduled_start NULL and are what a naive row-value cursor loses.
  const SCHEDULED_DAYS = [1, 3, 5, 7, 9, 11, 13];

  beforeAll(async () => {
    admin = postgres(process.env.DATABASE_URL as string, { max: 1, ssl: "require", prepare: false });
    const [o] = await admin<{ id: string }[]>`
      insert into orgs (name) values ('SortPage ' || gen_random_uuid()) returning id`;
    orgId = o!.id;
    const [l] = await admin<{ id: string }[]>`
      insert into leads (org_id, name) values (${orgId}, 'Sort Customer') returning id`;
    leadId = l!.id;

    for (const [i, d] of SCHEDULED_DAYS.entries()) {
      await admin`
        insert into jobs (org_id, lead_id, num, title, status, total_cents, scheduled_start)
        values (${orgId}, ${leadId}, ${"JOB-S" + i}, ${"Water heater " + i}, 'scheduled',
                ${(i + 1) * 10000}, ${`2026-09-${String(d).padStart(2, "0")}T09:00:00Z`})`;
    }
    for (let i = 0; i < 3; i++) {
      await admin`
        insert into jobs (org_id, lead_id, num, title, status, total_cents, scheduled_start)
        values (${orgId}, ${leadId}, ${"JOB-U" + i}, ${"Drain clearing " + i}, 'scheduled', 5000, null)`;
    }
  });

  afterAll(async () => {
    if (orgId) await admin`delete from orgs where id = ${orgId}`;
    await admin.end({ timeout: 5 });
    await closeDb();
  });

  /** Walk every page and return the ids in order, so gaps and repeats are both visible. */
  const walkAll = async (args: Record<string, unknown>) => {
    const caller = appRouter.createCaller(ctxFor(orgId, "owner"));
    const ids: string[] = [];
    let cursor: string | null = null;
    for (let guard = 0; guard < 20; guard++) {
      const page = await caller.v1.jobs.list({ ...args, limit: 4, cursor } as never);
      ids.push(...page.items.map((j) => j.id));
      cursor = page.nextCursor;
      if (!cursor) break;
    }
    return ids;
  };

  it("sorts by scheduled date and pages through without repeating or skipping", async () => {
    const ids = await walkAll({ sort: "scheduled", sortDir: "desc" });
    expect(new Set(ids).size).toBe(ids.length);   // no repeats
    expect(ids.length).toBe(10);                  // nothing skipped: 7 scheduled + 3 unscheduled
  });

  it("KEEPS unscheduled jobs — the null block survives the cursor", async () => {
    // The bug this exists to prevent: `(scheduled_start, id) < (NULL, ...)` evaluates to NULL,
    // not false, so a plain row-value cursor silently drops every unscheduled job from page 2
    // onward. Unscheduled work is exactly what a dispatcher opens this list to find.
    const caller = appRouter.createCaller(ctxFor(orgId, "owner"));
    const ids = await walkAll({ sort: "scheduled", sortDir: "desc" });
    const rows = await admin<{ id: string }[]>`
      select id from jobs where org_id = ${orgId} and scheduled_start is null and deleted_at is null`;
    expect(rows.length).toBe(3);
    for (const r of rows) expect(ids).toContain(r.id);

    // ...and they sort LAST, not scattered through the results.
    const tail = ids.slice(-3);
    for (const r of rows) expect(tail).toContain(r.id);
    expect((await caller.v1.jobs.list({ sort: "scheduled", limit: 50 })).items.length).toBe(10);
  });

  it("orders scheduled dates correctly descending, newest first", async () => {
    const caller = appRouter.createCaller(ctxFor(orgId, "owner"));
    const page = await caller.v1.jobs.list({ sort: "scheduled", sortDir: "desc", limit: 7 });
    const nums = page.items.map((j) => j.num).filter((n) => n.startsWith("JOB-S"));
    // JOB-S6 is 2026-09-13, JOB-S0 is 2026-09-01.
    expect(nums[0]).toBe("JOB-S6");
    expect(nums[nums.length - 1]).toBe("JOB-S0");
  });

  it("sorts by amount across a page boundary", async () => {
    const ids = await walkAll({ sort: "amount", sortDir: "desc" });
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids.length).toBe(10);
  });

  it("searches in the DATABASE, finding rows a loaded page would not contain", async () => {
    const caller = appRouter.createCaller(ctxFor(orgId, "owner"));
    const hits = await caller.v1.jobs.list({ search: "Drain", limit: 50 });
    expect(hits.items.length).toBe(3);
    for (const j of hits.items) expect(j.title).toMatch(/Drain/);
  });

  it("treats a LIKE wildcard as text, not as a wildcard", async () => {
    // Unescaped, "%" matches every job in the org and the search silently stops filtering.
    const caller = appRouter.createCaller(ctxFor(orgId, "owner"));
    expect((await caller.v1.jobs.list({ search: "%", limit: 50 })).items.length).toBe(0);
    expect((await caller.v1.jobs.list({ search: "_", limit: 50 })).items.length).toBe(0);
  });

  it("falls back to page one on a malformed cursor rather than throwing", async () => {
    const caller = appRouter.createCaller(ctxFor(orgId, "owner"));
    const page = await caller.v1.jobs.list({ sort: "scheduled", limit: 4, cursor: "not-a-cursor" });
    expect(page.items.length).toBe(4);
  });

  it("leaves the DEFAULT ordering untouched when no sort is given", async () => {
    // Every existing caller passes no sort. They must keep the historical created_at path.
    const caller = appRouter.createCaller(ctxFor(orgId, "owner"));
    const page = await caller.v1.jobs.list({ limit: 50 });
    expect(page.items.length).toBe(10);
  });

  it("finds jobs by CUSTOMER name — the search the client-side one did", async () => {
    // The old in-browser search built its haystack from customer name + title + address. Moving
    // search to the server without customer name would be a regression on the first search run.
    const caller = appRouter.createCaller(ctxFor(orgId, "owner"));
    const hits = await caller.v1.jobs.list({ search: "Sort Customer", limit: 50 });
    expect(hits.items.length).toBe(10);
  });

  it("count reports the TRUE total, not the page size", async () => {
    // The lie this fixes: the app said "220 of 220" against 1,521 real jobs, because 220 was all
    // it had ever loaded.
    const caller = appRouter.createCaller(ctxFor(orgId, "owner"));
    const page = await caller.v1.jobs.list({ sort: "scheduled", limit: 4 });
    expect(page.items.length).toBe(4);
    expect((await caller.v1.jobs.count({})).total).toBe(10);
  });

  it("count honours the same filters as the list", async () => {
    // A count built from a second hand-copied predicate drifts from its list the first time a
    // filter changes, and "4 of 7" is only worth showing if both halves ask the same question.
    const caller = appRouter.createCaller(ctxFor(orgId, "owner"));
    const searched = await caller.v1.jobs.list({ search: "Drain", limit: 50 });
    expect((await caller.v1.jobs.count({ search: "Drain" })).total).toBe(searched.items.length);
    expect((await caller.v1.jobs.count({ search: "Drain" })).total).toBe(3);
  });

  it("count is org-scoped", async () => {
    const [other] = await admin<{ id: string }[]>`
      insert into orgs (name) values ('SortPage Count ' || gen_random_uuid()) returning id`;
    const caller = appRouter.createCaller(ctxFor(other!.id, "owner"));
    expect((await caller.v1.jobs.count({})).total).toBe(0);
    await admin`delete from orgs where id = ${other!.id}`;
  });

  it("does not leak across tenants", async () => {
    const [other] = await admin<{ id: string }[]>`
      insert into orgs (name) values ('SortPage Other ' || gen_random_uuid()) returning id`;
    const caller = appRouter.createCaller(ctxFor(other!.id, "owner"));
    expect((await caller.v1.jobs.list({ sort: "scheduled", limit: 50 })).items).toHaveLength(0);
    expect((await caller.v1.jobs.list({ search: "Water", limit: 50 })).items).toHaveLength(0);
    await admin`delete from orgs where id = ${other!.id}`;
  });
});
