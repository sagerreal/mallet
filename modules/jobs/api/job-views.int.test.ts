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
import { ARCHIVE_AFTER_DAYS } from "../infra/job-views";

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

    // Estimate visits. A completed SCOPING visit (svc estimate, no money anywhere) is not
    // billable work — it must land in `done`, not "Done, not billed". A completed estimate
    // SIGNED on site carries priced job_lines while total_cents stays 0 (the sign path never
    // updates that snapshot) — it IS billable and must stay in needsInvoice.
    await admin`
      insert into jobs (org_id, lead_id, num, status, svc, total_cents)
      values (${orgId}, ${leadId}, 'V-EST-SCOPE', 'complete', 'estimate', 0)`;
    const [signed] = await admin<{ id: string }[]>`
      insert into jobs (org_id, lead_id, num, status, svc, total_cents)
      values (${orgId}, ${leadId}, 'V-EST-SIGNED', 'complete', 'estimate', 0) returning id`;
    await admin`
      insert into job_lines (org_id, job_id, description, quantity, rate_cents, cost_cents, position)
      values (${orgId}, ${signed!.id}, 'Water heater swap', 1, 90000, 0, 0)`;
  });

  afterAll(async () => {
    if (orgId) await admin`delete from orgs where id = ${orgId}`;
    await admin.end({ timeout: 5 });
    await closeDb();
  });

  it("counts each view correctly", async () => {
    const caller = appRouter.createCaller(ctxFor(orgId, "owner"));
    const { counts: c } = await caller.v1.jobs.viewCounts({ today: TODAY });
    expect(c.needsSlot).toBe(2);
    expect(c.today).toBe(3);
    expect(c.week).toBe(3);        // 2 within 7 days + 1 overdue
    expect(c.upcoming).toBe(1);
    // The two 50000-cent unbilled jobs + the SIGNED estimate (priced lines, total_cents 0).
    // The unpriced scoping estimate is NOT money on the floor — it counts as done.
    expect(c.needsInvoice).toBe(3);
    expect(c.done).toBe(2);
  });

  // The Dashboard's money tiles. They were added up from the loaded page, so a shop with more
  // jobs than one page stated a fraction of the real figure as fact on its first screen.
  it("sums the money for each band in the database, not from a page", async () => {
    const caller = appRouter.createCaller(ctxFor(orgId, "owner"));
    const r = await caller.v1.jobs.viewCounts({ today: TODAY });
    // Every visit-seeded job carries 50000 cents, so those sums are count × 50000.
    expect(r.needsSlotCents).toBe(r.counts.needsSlot * 50000);
    expect(r.todayCents).toBe(r.counts.today * 50000);
    // needsInvoice holds V-UNBILLED1 + V-UNBILLED2 (50000 each) + V-EST-SIGNED, whose
    // total_cents is 0 because on-site signed prices live in job_lines, not the snapshot.
    expect(r.needsInvoiceCents).toBe(100_000);
  });

  it("views are MUTUALLY EXCLUSIVE and account for every job", async () => {
    // The property the grouped list had for free. A job in two bands makes every number wrong.
    const caller = appRouter.createCaller(ctxFor(orgId, "owner"));
    const { counts: c } = await caller.v1.jobs.viewCounts({ today: TODAY });
    const summed = Object.values(c).reduce((a, b) => a + b, 0);
    const [total] = await admin<{ n: number }[]>`
      select count(*)::int n from jobs where org_id = ${orgId} and deleted_at is null`;
    expect(summed).toBe(total!.n);

    // And no id appears in two views.
    const seen = new Set<string>();
    for (const view of ["needsSlot", "today", "week", "upcoming", "needsInvoice", "done", "archived"] as const) {
      const page = await caller.v1.jobs.list({ view, today: TODAY, limit: 50 });
      for (const j of page.items) {
        expect(seen.has(j.id), `${j.num} appears in more than one view`).toBe(false);
        seen.add(j.id);
      }
    }
    expect(seen.size).toBe(total!.n);
  });

  // The dispatch board's window. Not a named view — those are relative to today and the board
  // navigates anywhere — so it is its own filter, and the property that matters is that a job with
  // several visits in range comes back ONCE. An EXISTS gives that; a join would not.
  it("returns jobs with a visit in the window, each exactly once", async () => {
    const caller = appRouter.createCaller(ctxFor(orgId, "owner"));

    // A job with two visits inside the same week — the row-multiplication trap.
    const twice = await addJob("V-TWICE", "scheduled", "2026-08-18");
    await admin`
      insert into job_visits (org_id, job_id, scheduled_date, duration_minutes, status)
      values (${orgId}, ${twice}, '2026-08-19', 120, 'pending')`;

    const page = await caller.v1.jobs.list({ visitFrom: "2026-08-17", visitTo: "2026-08-23", limit: 100 });
    const nums = page.items.map((j) => j.num);
    expect(nums.filter((n) => n === "V-TWICE")).toHaveLength(1);
    expect(nums).toContain("V-WEEK1"); // 2026-08-18
    expect(nums).toContain("V-WEEK2"); // 2026-08-22
    expect(nums).not.toContain("V-LATER1"); // 2026-09-10, outside
    expect(nums).not.toContain("V-OVERDUE"); // 2026-08-01, outside
  });

  it("includes both boundary days — the range is inclusive at each end", async () => {
    const caller = appRouter.createCaller(ctxFor(orgId, "owner"));
    const oneDay = await caller.v1.jobs.list({ visitFrom: "2026-08-22", visitTo: "2026-08-22", limit: 100 });
    expect(oneDay.items.map((j) => j.num)).toContain("V-WEEK2");
    const before = await caller.v1.jobs.list({ visitFrom: "2026-08-23", visitTo: "2026-08-25", limit: 100 });
    expect(before.items.map((j) => j.num)).not.toContain("V-WEEK2");
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
    expect(unbilled.items.map((j) => j.num).sort()).toEqual(["V-EST-SIGNED", "V-UNBILLED1", "V-UNBILLED2"]);
    const done = await caller.v1.jobs.list({ view: "done", today: TODAY, limit: 50 });
    expect(done.items.map((j) => j.num).sort()).toEqual(["V-DONE1", "V-EST-SCOPE"]);
  });

  it("a finished scoping visit is never 'money on the floor'; a signed estimate is", async () => {
    // The founder's completed estimate walkthrough showed up under "Done, not billed" and its
    // modal offered to invoice it — a $0 draft for a visit whose deliverable is a QUOTE. The
    // view must split estimates by priced-ness, and priced-ness must read job_lines: the sign
    // path writes lines and never syncs total_cents.
    const caller = appRouter.createCaller(ctxFor(orgId, "owner"));
    const unbilled = await caller.v1.jobs.list({ view: "needsInvoice", today: TODAY, limit: 50 });
    expect(unbilled.items.map((j) => j.num)).not.toContain("V-EST-SCOPE");
    expect(unbilled.items.map((j) => j.num)).toContain("V-EST-SIGNED");
    const done = await caller.v1.jobs.list({ view: "done", today: TODAY, limit: 50 });
    expect(done.items.map((j) => j.num)).toContain("V-EST-SCOPE");
  });

  it("view counts respect an active search", async () => {
    // The dropdown must recount when the list is filtered, or the numbers describe a different
    // list than the one on screen.
    const caller = appRouter.createCaller(ctxFor(orgId, "owner"));
    const { counts: c } = await caller.v1.jobs.viewCounts({ today: TODAY, search: "V-TODAY" });
    expect(c.today).toBe(3);
    expect(c.needsSlot).toBe(0);
  });

  it("pins the archive cutoff — moving it silently shifts jobs between Done and Archived", () => {
    expect(ARCHIVE_AFTER_DAYS).toBe(7);
  });

  it("sums TODAY's money server-side, not from whatever the browser loaded", () => {
    // The headline "$X scheduled today" read the store, so on a shop with more jobs than one page
    // it stated a figure derived from whichever 500 rows happened to be cached.
    return (async () => {
      const caller = appRouter.createCaller(ctxFor(orgId, "owner"));
      const { todayCents } = await caller.v1.jobs.viewCounts({ today: TODAY });
      const [truth] = await admin<{ n: number }[]>`
        select coalesce(sum(j.total_cents), 0)::int n from jobs j
        where j.org_id = ${orgId} and j.deleted_at is null
          and j.status not in ('complete','canceled')
          and exists (select 1 from job_visits v where v.org_id = j.org_id and v.job_id = j.id
                        and v.status <> 'canceled' and v.deleted_at is null
                        and v.scheduled_date = ${TODAY})`;
      expect(todayCents).toBe(truth!.n);
      expect(todayCents).toBeGreaterThan(0);
    })();
  });

  it("does not leak across tenants", async () => {
    const [other] = await admin<{ id: string }[]>`
      insert into orgs (name) values ('JobViews Other ' || gen_random_uuid()) returning id`;
    const caller = appRouter.createCaller(ctxFor(other!.id, "owner"));
    const { counts: c } = await caller.v1.jobs.viewCounts({ today: TODAY });
    expect(Object.values(c).reduce((a, b) => a + b, 0)).toBe(0);
    await admin`delete from orgs where id = ${other!.id}`;
  });
});
