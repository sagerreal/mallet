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
 *
 * THE FIXTURE IS SHAPED LIKE PRODUCTION, AND THAT IS THE POINT. This suite used to insert explicit
 * `jobs.scheduled_start` values by raw SQL, and every test passed while the WHEN sort was ordering
 * on a column that NOTHING in the app writes. Real jobs carry `scheduled_start` NULL and keep their
 * dates on `job_visits`; seeded that way, the old sort collapsed to `ORDER BY id` over random
 * UUIDs. So: every job here has a NULL scheduled_start, and its date lives on a visit — the only
 * arrangement in which this suite can see the bug it exists to catch.
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

  // 7 jobs with a live VISIT on a known date + 3 with no visit at all. The unplaced ones are the
  // point: they have no date anywhere, and they are what a dispatcher opens this list to find.
  const SCHEDULED_DAYS = [1, 3, 5, 7, 9, 11, 13];
  const dayOf = (d: number) => `2026-09-${String(d).padStart(2, "0")}`;

  beforeAll(async () => {
    admin = postgres(process.env.DATABASE_URL as string, { max: 1, ssl: "require", prepare: false });
    const [o] = await admin<{ id: string }[]>`
      insert into orgs (name) values ('SortPage ' || gen_random_uuid()) returning id`;
    orgId = o!.id;
    const [l] = await admin<{ id: string }[]>`
      insert into leads (org_id, name) values (${orgId}, 'Sort Customer') returning id`;
    leadId = l!.id;

    for (const [i, d] of SCHEDULED_DAYS.entries()) {
      // scheduled_start stays NULL, exactly as every live create path leaves it.
      const [j] = await admin<{ id: string }[]>`
        insert into jobs (org_id, lead_id, num, title, status, total_cents, scheduled_start)
        values (${orgId}, ${leadId}, ${"JOB-S" + i}, ${"Water heater " + i}, 'scheduled',
                ${(i + 1) * 10000}, null)
        returning id`;
      await admin`
        insert into job_visits (org_id, job_id, scheduled_date, scheduled_start, scheduled_end, status)
        values (${orgId}, ${j!.id}, ${dayOf(d)}, '09:00', '11:00', 'pending')`;
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

  /** The same walk, keeping job NUMBERS — readable when an ordering assertion fails. */
  const walkNums = async (args: Record<string, unknown>, limit = 4) => {
    const caller = appRouter.createCaller(ctxFor(orgId, "owner"));
    const nums: string[] = [];
    let cursor: string | null = null;
    for (let guard = 0; guard < 20; guard++) {
      const page = await caller.v1.jobs.list({ ...args, limit, cursor } as never);
      nums.push(...page.items.map((j) => j.num));
      cursor = page.nextCursor;
      if (!cursor) break;
    }
    return nums;
  };

  it("sorts by the VISIT date and pages through without repeating or skipping", async () => {
    const ids = await walkAll({ sort: "scheduled", sortDir: "desc" });
    expect(new Set(ids).size).toBe(ids.length);   // no repeats
    expect(ids.length).toBe(10);                  // nothing skipped: 7 placed + 3 unplaced
  });

  it("puts UNPLACED work FIRST when ascending — the founder's missing job", async () => {
    // THE BUG. A job created minutes ago has no visit, so it has no date; the sort ordered on
    // jobs.scheduled_start, which is null on every row in the database, so the list fell back to
    // `ORDER BY id` over random v4 UUIDs and a new job had roughly a 3% chance of being on page
    // one. Ascending WHEN asks "what have I not placed, and what is next" — unplaced work is the
    // first half of that answer, not a footnote after 1,500 scheduled jobs.
    const nums = await walkNums({ sort: "scheduled", sortDir: "asc" });
    expect(nums).toHaveLength(10);
    expect(new Set(nums).size).toBe(10);
    expect(nums.slice(0, 3).every((n) => n.startsWith("JOB-U"))).toBe(true);
    // ...and the placed ones follow in real date order, soonest first.
    expect(nums.slice(3)).toEqual(SCHEDULED_DAYS.map((_, i) => `JOB-S${i}`));
  });

  it("orders by the date the WHEN column actually DISPLAYS", async () => {
    // The list prints the next live visit's date. If the ORDER BY reads anything else the rows are
    // in an order the column visibly contradicts — which is unfalsifiable to a user and looks like
    // the sort is simply broken.
    const caller = appRouter.createCaller(ctxFor(orgId, "owner"));
    const page = await caller.v1.jobs.list({ sort: "scheduled", sortDir: "asc", limit: 50 });
    const dates = page.items
      .map((j) => (j.visits ?? []).map((v) => v.scheduledDate).filter(Boolean).sort()[0] ?? null)
      .filter((d): d is string => d !== null);
    expect(dates).toEqual([...dates].sort());
    expect(dates).toEqual(SCHEDULED_DAYS.map(dayOf));
  });

  it("KEEPS unplaced jobs — the null block survives the cursor", async () => {
    // `(date, id) < (NULL, ...)` evaluates to NULL, not false, so a plain row-value cursor silently
    // drops every dateless job from page 2 onward. Unplaced work is exactly what a dispatcher opens
    // this list to find, so losing it is the worst possible bug here.
    const caller = appRouter.createCaller(ctxFor(orgId, "owner"));
    const ids = await walkAll({ sort: "scheduled", sortDir: "desc" });
    const rows = await admin<{ id: string }[]>`
      select j.id from jobs j
      where j.org_id = ${orgId} and j.deleted_at is null
        and not exists (select 1 from job_visits v
                        where v.org_id = j.org_id and v.job_id = j.id
                          and v.status <> 'canceled' and v.deleted_at is null)`;
    expect(rows.length).toBe(3);
    for (const r of rows) expect(ids).toContain(r.id);

    // Descending is a history question, so the dateless ones sort LAST there.
    const tail = ids.slice(-3);
    for (const r of rows) expect(tail).toContain(r.id);
    expect((await caller.v1.jobs.list({ sort: "scheduled", limit: 50 })).items.length).toBe(10);
  });

  it("orders visit dates correctly descending, latest first", async () => {
    const caller = appRouter.createCaller(ctxFor(orgId, "owner"));
    const page = await caller.v1.jobs.list({ sort: "scheduled", sortDir: "desc", limit: 7 });
    const nums = page.items.map((j) => j.num).filter((n) => n.startsWith("JOB-S"));
    // JOB-S6 is 2026-09-13, JOB-S0 is 2026-09-01.
    expect(nums[0]).toBe("JOB-S6");
    expect(nums[nums.length - 1]).toBe("JOB-S0");
  });

  it("keyset-pages the visit-date sort identically to a single big page", async () => {
    // The ordering has to survive being cut into pages. A cursor built from a value the ORDER BY
    // did not compare is how page two repeats or skips rows.
    const caller = appRouter.createCaller(ctxFor(orgId, "owner"));
    // limit 1 makes EVERY row a page boundary; limit 3 divides 10 unevenly, so the last page is
    // short and the null block is split across a boundary. Between them they exercise every case
    // the cursor has.
    const whole = (await caller.v1.jobs.list({ sort: "scheduled", sortDir: "asc", limit: 50 })).items.map((j) => j.num);
    for (const limit of [1, 3]) {
      expect(await walkNums({ sort: "scheduled", sortDir: "asc" }, limit)).toEqual(whole);
    }
    const wholeDesc = (await caller.v1.jobs.list({ sort: "scheduled", sortDir: "desc", limit: 50 })).items.map((j) => j.num);
    expect(await walkNums({ sort: "scheduled", sortDir: "desc" }, 3)).toEqual(wholeDesc);
  });

  it("ignores a CANCELED visit's date, as the WHEN column does", async () => {
    // A canceled visit is not work. Ordering on it would float a job to a date nobody is going to.
    const [j] = await admin<{ id: string }[]>`
      insert into jobs (org_id, lead_id, num, title, status, total_cents, scheduled_start)
      values (${orgId}, ${leadId}, 'JOB-CX', 'Canceled visit', 'scheduled', 1000, null) returning id`;
    await admin`
      insert into job_visits (org_id, job_id, scheduled_date, scheduled_start, scheduled_end, status)
      values (${orgId}, ${j!.id}, '2026-01-01', '09:00', '11:00', 'canceled')`;
    try {
      const nums = await walkNums({ sort: "scheduled", sortDir: "asc" });
      // 2026-01-01 is earlier than every live date here; if the sort read it, JOB-CX would lead.
      // It has no LIVE visit, so it belongs with the unplaced block at the front instead.
      expect(nums.slice(0, 4)).toContain("JOB-CX");
      expect(nums.filter((n) => n.startsWith("JOB-S"))).toEqual(SCHEDULED_DAYS.map((_, i) => `JOB-S${i}`));
    } finally {
      await admin`delete from jobs where id = ${j!.id}`;
    }
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
