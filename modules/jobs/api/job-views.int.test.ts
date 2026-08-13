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
  let crewUserId = "";

  // A visit is PLACED only with a day AND a crew (see PLACED in job-views.ts). Every dated
  // fixture therefore carries an assignee: a dated visit with nobody on it is "Needs a slot",
  // which is what the half-planned case below asserts deliberately.
  const addJob = async (
    num: string,
    status: string,
    visitDate: string | null,
    opts: { assign?: boolean } = {},
  ) => {
    const assign = opts.assign ?? visitDate !== null;
    const [j] = await admin<{ id: string }[]>`
      insert into jobs (org_id, lead_id, num, status, total_cents)
      values (${orgId}, ${leadId}, ${num}, ${status}, 50000) returning id`;
    if (visitDate !== undefined) {
      await admin`
        insert into job_visits (org_id, job_id, scheduled_date, assignee_user_id, duration_minutes, status)
        values (${orgId}, ${j!.id}, ${visitDate}, ${assign ? crewUserId : null}, 120, 'pending')`;
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
    const [u] = await admin<{ id: string }[]>`
      insert into users (org_id, auth_user_id, email, name, role, is_field_crew)
      values (${orgId}, gen_random_uuid(), 'crew-' || gen_random_uuid() || '@jobviews.test',
              'View Crew', 'tech', true)
      returning id`;
    crewUserId = u!.id;

    await addJob("V-SLOT1", "scheduled", null);          // visit with no date -> needs a slot
    await addJob("V-SLOT2", "scheduled", null);
    await addJob("V-TODAY1", "scheduled", TODAY);
    await addJob("V-TODAY2", "scheduled", TODAY);
    await addJob("V-TODAY3", "scheduled", TODAY);
    await addJob("V-WEEK1", "scheduled", "2026-08-18");   // within 7 days
    await addJob("V-WEEK2", "scheduled", "2026-08-22");   // exactly today+7
    await addJob("V-OVERDUE", "scheduled", "2026-08-01"); // past, outstanding -> LATE
    await addJob("V-LATER1", "scheduled", "2026-09-10");  // beyond the week

    // THE THREE SHAPES `late` MUST NOT SWALLOW.
    //
    // A job carrying an overdue trip AND one today belongs on today's run — a day view that omits
    // work going out today is not a day view — so today outranks late.
    const both = await addJob("V-BOTH", "scheduled", "2026-08-01");
    await admin`
      insert into job_visits (org_id, job_id, scheduled_date, assignee_user_id, duration_minutes, status, position)
      values (${orgId}, ${both}, ${TODAY}, ${crewUserId}, 120, 'pending', 2)`;

    // A finished visit is history. OUTSTANDING excludes it, so this job is back to needing a slot
    // rather than being reported late forever for a trip that already happened.
    const [lateDone] = await admin<{ id: string }[]>`
      insert into jobs (org_id, lead_id, num, status, total_cents)
      values (${orgId}, ${leadId}, 'V-LATEDONE', 'scheduled', 50000) returning id`;
    await admin`
      insert into job_visits (org_id, job_id, scheduled_date, assignee_user_id, duration_minutes, status)
      values (${orgId}, ${lateDone!.id}, '2026-08-01', ${crewUserId}, 120, 'complete')`;

    // Half-planned: a day was picked and nobody was put on it. PLACED needs both — the board has
    // no lane to draw a visit for nobody — so this is a slot problem, not a lateness problem.
    await addJob("V-LATENOCREW", "scheduled", "2026-08-05", { assign: false });
    const billed = await addJob("V-DONE1", "complete", "2026-08-02");
    await addJob("V-UNBILLED1", "complete", "2026-08-03");
    await addJob("V-UNBILLED2", "complete", "2026-08-04");
    await admin`
      insert into invoices (org_id, lead_id, source_job_id, num, status, total_cents)
      values (${orgId}, ${leadId}, ${billed}, 'INV-V1', 'sent', 50000)`;

    // Estimate visits. A completed SCOPING visit (kind estimate, no money anywhere) is not
    // billable work — it must land in `done`, not "Done, not billed". A completed estimate
    // SIGNED on site carries priced job_lines while total_cents stays 0 (the sign path never
    // updates that snapshot) — it IS billable and must stay in needsInvoice. The svc columns
    // deliberately hold a trade name: that is the voice-booking shape the old svc-based
    // predicate misread as billable work.
    await admin`
      insert into jobs (org_id, lead_id, num, status, kind, svc, total_cents)
      values (${orgId}, ${leadId}, 'V-EST-SCOPE', 'complete', 'estimate', 'Water heater repair', 0)`;
    const [signed] = await admin<{ id: string }[]>`
      insert into jobs (org_id, lead_id, num, status, kind, svc, total_cents)
      values (${orgId}, ${leadId}, 'V-EST-SIGNED', 'complete', 'estimate', 'Water heater repair', 0) returning id`;
    await admin`
      insert into job_lines (org_id, job_id, description, quantity, rate_cents, cost_cents, position)
      values (${orgId}, ${signed!.id}, 'Water heater swap', 1, 90000, 0, 0)`;

    // THE FOLLOW-UP SHAPE. First trip done, part on order, second visit booked from the field
    // with no date and nobody on it — exactly what field.addFollowUpVisit writes. The job is
    // still open (the visit cascade only completes a job when every active visit is complete),
    // so this row is outstanding work that has to reach somebody's screen.
    const followUp = await admin<{ id: string }[]>`
      insert into jobs (org_id, lead_id, num, status, total_cents)
      values (${orgId}, ${leadId}, 'V-FOLLOWUP', 'in_progress', 50000) returning id`;
    await admin`
      insert into job_visits (org_id, job_id, scheduled_date, assignee_user_id, duration_minutes, status, position)
      values (${orgId}, ${followUp[0]!.id}, '2026-08-04', ${crewUserId}, 120, 'complete', 1)`;
    await admin`
      insert into job_visits (org_id, job_id, scheduled_date, assignee_user_id, duration_minutes, status, position, notes)
      values (${orgId}, ${followUp[0]!.id}, null, null, 60, 'pending', 2, 'Waiting on the 40-gal tank')`;
  });

  /**
   * A job whose only PLACED visit is already finished still needs a slot.
   *
   * `needsSlot` asked "is any visit placed", which a completed first trip answers yes to — so the
   * follow-up fell through to `week` (its finished visit is dated in the past, and week includes
   * overdue) and read as work going out this week. Letting a technician book a return trip makes
   * this the normal shape rather than a corner, so the bands have to read OUTSTANDING placement:
   * placed AND not yet complete.
   */
  it("a finished first visit plus an unplaced follow-up needs a slot, not a week band", async () => {
    const caller = appRouter.createCaller(ctxFor(orgId, "owner"));

    const slot = await caller.v1.jobs.list({ view: "needsSlot", today: TODAY, limit: 50 });
    expect(slot.items.map((j) => j.num)).toContain("V-FOLLOWUP");

    // And only once — landing in two bands breaks the mutual exclusivity the counts depend on.
    for (const view of ["today", "week", "upcoming"] as const) {
      const page = await caller.v1.jobs.list({ view, today: TODAY, limit: 50 });
      expect(page.items.map((j) => j.num)).not.toContain("V-FOLLOWUP");
    }
  });

  afterAll(async () => {
    // job_visits_assignee_fk has no ON DELETE action, so the crew row cannot go while a visit
    // still points at it — drop this org's visits first, then let the org cascade take the rest.
    if (orgId) {
      await admin`delete from job_visits where org_id = ${orgId}`;
      await admin`delete from orgs where id = ${orgId}`;
    }
    await admin.end({ timeout: 5 });
    await closeDb();
  });

  it("counts each view correctly", async () => {
    const caller = appRouter.createCaller(ctxFor(orgId, "owner"));
    const { counts: c } = await caller.v1.jobs.viewCounts({ today: TODAY });
    // 2 never scheduled, + V-FOLLOWUP and V-LATEDONE (only dated visit already finished),
    // + V-LATENOCREW (a day but no crew — dated is not placed).
    expect(c.needsSlot).toBe(5);
    expect(c.today).toBe(4);       // 3 booked today + V-BOTH, where today outranks its overdue trip
    expect(c.late).toBe(1);        // V-OVERDUE — it used to be counted inside week
    expect(c.week).toBe(2);        // the 2 genuinely within 7 days, overdue no longer among them
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
    for (const view of ["needsSlot", "late", "today", "week", "upcoming", "needsInvoice", "done", "archived"] as const) {
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
      insert into job_visits (org_id, job_id, scheduled_date, assignee_user_id, duration_minutes, status)
      values (${orgId}, ${twice}, '2026-08-19', ${crewUserId}, 120, 'pending')`;

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
    expect(page.items.map((j) => j.num).sort()).toEqual([
      "V-FOLLOWUP", "V-LATEDONE", "V-LATENOCREW", "V-SLOT1", "V-SLOT2",
    ]);
  });

  /**
   * LATE — a trip booked onto a past day that has not happened.
   *
   * It used to fall into `week`: byWeekEnd is `scheduled_date <= today+7` with no lower bound, so
   * every past date satisfied it. That was deliberate and documented as a product decision to
   * revisit; this is the revisit. Overdue work is the most actionable state on the screen and it
   * was scattered through a 34-row band with no way to ask for it.
   */
  it("counts a past-due outstanding visit as late, and keeps it out of This week", async () => {
    const caller = appRouter.createCaller(ctxFor(orgId, "owner"));
    const late = await caller.v1.jobs.list({ view: "late", today: TODAY, limit: 50 });
    expect(late.items.map((j) => j.num)).toEqual(["V-OVERDUE"]);

    // Membership, not an exact set: a later test seeds V-TWICE into this same org.
    const week = await caller.v1.jobs.list({ view: "week", today: TODAY, limit: 50 });
    const weekNums = week.items.map((j) => j.num);
    expect(weekNums).toContain("V-WEEK1");
    expect(weekNums).toContain("V-WEEK2");
    expect(weekNums).not.toContain("V-OVERDUE");
  });

  it("files a job with BOTH an overdue trip and one today under Today, not Late", async () => {
    // A day view that omits work going out today is not a day view. The overdue trip is still
    // named on the row — see jobWhenLabel — but the job belongs on the run.
    const caller = appRouter.createCaller(ctxFor(orgId, "owner"));
    const today = await caller.v1.jobs.list({ view: "today", today: TODAY, limit: 50 });
    expect(today.items.map((j) => j.num)).toContain("V-BOTH");
    const late = await caller.v1.jobs.list({ view: "late", today: TODAY, limit: 50 });
    expect(late.items.map((j) => j.num)).not.toContain("V-BOTH");
  });

  it("stops calling an overdue visit late once it is finished", async () => {
    // A finished visit is history. Without OUTSTANDING, a job whose first trip is done reports
    // late forever for work that already happened.
    const caller = appRouter.createCaller(ctxFor(orgId, "owner"));
    const late = await caller.v1.jobs.list({ view: "late", today: TODAY, limit: 50 });
    expect(late.items.map((j) => j.num)).not.toContain("V-LATEDONE");
  });

  it("leaves a past-dated visit with no crew in Needs a slot, not Late", async () => {
    // PLACED is a day AND a crew. A day with nobody on it is a slot problem; calling it late
    // would name the wrong missing thing and send the dispatcher to the wrong control.
    const caller = appRouter.createCaller(ctxFor(orgId, "owner"));
    const late = await caller.v1.jobs.list({ view: "late", today: TODAY, limit: 50 });
    expect(late.items.map((j) => j.num)).not.toContain("V-LATENOCREW");
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

  /**
   * "ALL" MUST MEAN ALL.
   *
   * The Jobs list sent `activeOnly` for its All chip, which excludes complete and canceled — so All
   * reported 39 while the seven bands summed to 65, hiding Done and Done-not-billed from the chip
   * that claimed to contain them. The Active/Archived toggle already separates the archive, so All
   * within Active is "not archived" and nothing more.
   */
  it("excludeArchived counts every band except the archived one", async () => {
    const caller = appRouter.createCaller(ctxFor(orgId, "owner"));
    const { counts } = await caller.v1.jobs.viewCounts({ today: TODAY });
    const bands = (["needsSlot", "late", "today", "week", "upcoming", "needsInvoice", "done"] as const)
      .reduce((a, k) => a + counts[k], 0);

    const all = await caller.v1.jobs.count({ excludeArchived: true, today: TODAY });
    expect(all.total).toBe(bands);

    // And it is strictly larger than activeOnly, which is what made All understate itself.
    const openOnly = await caller.v1.jobs.count({ activeOnly: true });
    expect(all.total).toBeGreaterThanOrEqual(openOnly.total);
    expect(all.total).toBe(openOnly.total + counts.done + counts.needsInvoice);

    // The archived band is genuinely excluded.
    const everything = await caller.v1.jobs.count({});
    expect(everything.total).toBe(all.total + counts.archived);
  });

  it("rejects excludeArchived without today — the predicate is date-relative", async () => {
    const caller = appRouter.createCaller(ctxFor(orgId, "owner"));
    await expect(caller.v1.jobs.count({ excludeArchived: true })).rejects.toThrow();
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
