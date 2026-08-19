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

// The caller's own local day, as absolute instants — what every myDay call now carries. The
// window is the client's because there is no org timezone column; see the input's own comment.
const dayWindow = (d: Date): { dayStart: Date; dayEnd: Date } => {
  const dayStart = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const dayEnd = new Date(dayStart);
  dayEnd.setDate(dayEnd.getDate() + 1);
  return { dayStart, dayEnd };
};
const TODAY = dayWindow(new Date());

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
    if (orgId) {
      // Teardown order matters now: the field surface WRITES TIME ENTRIES (start/complete drive the
      // technician's clock), and time_entries has composite FKs onto both jobs and users. Deleting
      // the org first tries to cascade into jobs/users while those rows are still referenced.
      // Clearing hours first is also what proves the wiring ran at all.
      await admin`delete from time_entries where org_id = ${orgId}`;
      // And visits before the org, for the same reason one layer down: job_visits_assignee_fk has
      // no ON DELETE action, so a crew row cannot go while a visit still points at it. Harmless
      // before this suite had crewed visits; required now that the multi-visit cases create them.
      await admin`delete from job_visits where org_id = ${orgId}`;
      await admin`delete from orgs where id = ${orgId}`;
    }
    await admin.end({ timeout: 5 });
    await closeDb();
  });

  it("myDay returns only MY active jobs", async () => {
    const callerA = appRouter.createCaller(ctxFor(techAId, orgId, "tech"));
    const resultA = await callerA.v1.field.myDay(TODAY);
    expect(resultA.items).toHaveLength(1);
    expect(resultA.items[0]!.id).toBe(jobAId);

    const callerB = appRouter.createCaller(ctxFor(techBId, orgId, "tech"));
    const resultB = await callerB.v1.field.myDay(TODAY);
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

  // THE ASYMMETRY, closed. The job sheet's "✓ Mark done" has always accepted a scheduled visit
  // (SetVisitStatusUseCase allows pending → complete deliberately), but this endpoint went
  // through Job.complete(), which refuses anything but in_progress — so My day's ✓ Complete
  // returned BAD_REQUEST on the very job the sheet would happily close. The field router starts
  // it first now; Job.complete() itself is untouched, because it is also the office path.
  it("tech completes a SCHEDULED job in one call, without a Start first", async () => {
    const [j] = await admin<{ id: string }[]>`
      insert into jobs (org_id, lead_id, num, status, total_cents, assignee_user_id)
      values (${orgId}, ${leadId}, ${"JOB-TA-SKIP-" + randomUUID().slice(0, 8)}, 'scheduled', 0, ${techAId})
      returning id
    `;
    const caller = appRouter.createCaller(ctxFor(techAId, orgId, "tech"));
    const completed = await caller.v1.field.complete({ jobId: j!.id });
    expect(completed.status).toBe("complete");
  });

  /**
   * THE TWO DONES, reconciled.
   *
   * The sheet's foot was already right: it runs `setVisitStatus`, and SetVisitStatusUseCase
   * derives job status from the visit set, so finishing visit 1 of 2 leaves the job open. My
   * day's ✓ Complete went to CompleteJobUseCase, which reads no visits at all — it completed the
   * job, emitted `job.completed` (→ ensure-an-invoice), and left visit 2 sitting `pending` on a
   * `complete` job. Same intent, two entry points, opposite answers, and the wrong one bills a
   * job that finishes next week.
   */
  it("completing from My day finishes the VISIT, not a job with a trip still to run", async () => {
    const [j] = await admin<{ id: string }[]>`
      insert into jobs (org_id, lead_id, num, status, total_cents, assignee_user_id)
      values (${orgId}, ${leadId}, ${"JOB-TA-MULTI-" + randomUUID().slice(0, 8)}, 'scheduled', 0, ${techAId})
      returning id`;
    await admin`
      insert into job_visits (org_id, job_id, scheduled_date, assignee_user_id, duration_minutes, status, position)
      values (${orgId}, ${j!.id}, current_date, ${techAId}, 120, 'pending', 1)`;
    await admin`
      insert into job_visits (org_id, job_id, scheduled_date, assignee_user_id, duration_minutes, status, position)
      values (${orgId}, ${j!.id}, current_date + 2, ${techAId}, 120, 'pending', 2)`;

    const caller = appRouter.createCaller(ctxFor(techAId, orgId, "tech"));
    const after = await caller.v1.field.complete({ jobId: j!.id });

    expect(after.status).not.toBe("complete");

    const rows = await admin<{ status: string; position: number }[]>`
      select status, position from job_visits where job_id = ${j!.id} order by position`;
    expect(rows.map((r) => r.status)).toEqual(["complete", "pending"]);

    // And the job row itself, read back rather than taken from the DTO.
    const [job] = await admin<{ status: string; completed_at: string | null }[]>`
      select status, completed_at from jobs where id = ${j!.id}`;
    expect(job!.status).not.toBe("complete");
    expect(job!.completed_at).toBeNull();
  });

  it("the SECOND completion closes the job — the cascade still finishes what it should", async () => {
    const [j] = await admin<{ id: string }[]>`
      insert into jobs (org_id, lead_id, num, status, total_cents, assignee_user_id)
      values (${orgId}, ${leadId}, ${"JOB-TA-MULTI2-" + randomUUID().slice(0, 8)}, 'scheduled', 0, ${techAId})
      returning id`;
    for (const pos of [1, 2]) {
      await admin`
        insert into job_visits (org_id, job_id, scheduled_date, assignee_user_id, duration_minutes, status, position)
        values (${orgId}, ${j!.id}, current_date, ${techAId}, 120, 'pending', ${pos})`;
    }

    const caller = appRouter.createCaller(ctxFor(techAId, orgId, "tech"));
    await caller.v1.field.complete({ jobId: j!.id });
    const after = await caller.v1.field.complete({ jobId: j!.id });

    expect(after.status).toBe("complete");
    const rows = await admin<{ status: string }[]>`
      select status from job_visits where job_id = ${j!.id}`;
    expect(rows.every((r) => r.status === "complete")).toBe(true);
  });

  /**
   * BOOKING THE RETURN TRIP FROM THE DOOR.
   *
   * The commitment is made at the customer's kitchen table whether or not the software records
   * it — and a technician could not record it: every procedure in visit-router.ts is
   * ownerOrOffice. Since #389 he can even sign a customer for found work and then have no way to
   * book the trip that performs it.
   *
   * What he creates is UNPLACED on purpose. He records that a return is needed and why; the
   * office picks the slot, because parts arrival and the rest of the week's load are not things
   * he can see from the doorstep.
   */
  it("a tech on the job books an unplaced follow-up, and the job stays open", async () => {
    const [j] = await admin<{ id: string }[]>`
      insert into jobs (org_id, lead_id, num, status, total_cents, assignee_user_id)
      values (${orgId}, ${leadId}, ${"JOB-TA-FU-" + randomUUID().slice(0, 8)}, 'in_progress', 0, ${techAId})
      returning id`;
    await admin`
      insert into job_visits (org_id, job_id, scheduled_date, assignee_user_id, duration_minutes, status, position)
      values (${orgId}, ${j!.id}, current_date, ${techAId}, 120, 'complete', 1)`;

    const caller = appRouter.createCaller(ctxFor(techAId, orgId, "tech"));
    const after = await caller.v1.field.addFollowUpVisit({
      jobId: j!.id,
      reason: "Waiting on the 40-gal tank — back once it lands",
    });

    expect(after.status).not.toBe("complete");
    expect(after.visits).toHaveLength(2);

    const [added] = await admin<
      { scheduled_date: string | null; assignee_user_id: string | null; status: string; notes: string | null; position: number }[]
    >`select scheduled_date, assignee_user_id, status, notes, position
        from job_visits where job_id = ${j!.id} and position = 2`;

    expect(added!.scheduled_date).toBeNull();
    expect(added!.assignee_user_id).toBeNull();
    expect(added!.status).toBe("pending");
    expect(added!.notes).toBe("Waiting on the 40-gal tank — back once it lands");
  });

  it("an off-job tech cannot book a visit on it", async () => {
    const caller = appRouter.createCaller(ctxFor(techAId, orgId, "tech"));
    await expect(
      caller.v1.field.addFollowUpVisit({ jobId: jobBId, reason: "not my job" }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });

    const rows = await admin<{ n: string }[]>`
      select count(*) as n from job_visits where job_id = ${jobBId}`;
    expect(Number(rows[0]!.n)).toBe(0);
  });

  /**
   * BOOKING THE RETURN TRIP AFTER "DONE" — and the money rule that decides whether he may.
   *
   * "just clicked done and theres no way to add another visit, just take payment." He finishes,
   * then finds out the part is on order. Reopening the job is how the return trip gets booked, and
   * the ONE thing that must never happen is a reopen disturbing money already taken — or quietly
   * producing work that can never be billed, because CreateInvoiceFromJobUseCase is idempotent on
   * `source_job_id` and the existing bill will not pick a later visit up.
   *
   * These seed the INVOICE directly, not through the invoicing router: the guard has to hold
   * whatever raised the bill, and the field surface is the one place a technician can reach it.
   */
  const finishedJobWithBill = async (
    status: string | null,
    amountPaidCents = 0,
  ): Promise<string> => {
    const [j] = await admin<{ id: string }[]>`
      insert into jobs (org_id, lead_id, num, status, total_cents, assignee_user_id)
      values (${orgId}, ${leadId}, ${"JOB-TA-RT-" + randomUUID().slice(0, 8)}, 'complete', 40000, ${techAId})
      returning id`;
    await admin`
      insert into job_visits (org_id, job_id, scheduled_date, assignee_user_id, duration_minutes, status, position, completed_at)
      values (${orgId}, ${j!.id}, current_date, ${techAId}, 120, 'complete', 1, now())`;
    if (status !== null) {
      await admin`
        insert into invoices (org_id, num, source_job_id, lead_id, status, total_cents, amount_paid_cents)
        values (${orgId}, ${"INV-RT-" + randomUUID().slice(0, 8)}, ${j!.id}, ${leadId}, ${status}, 40000, ${amountPaidCents})`;
    }
    return j!.id;
  };

  const visitCount = async (jobId: string): Promise<number> => {
    const rows = await admin<{ n: string }[]>`
      select count(*) as n from job_visits where job_id = ${jobId}`;
    return Number(rows[0]!.n);
  };

  it("stamps the job's bill onto the field agenda so the card can say Paid without opening the sheet", async () => {
    const paidJobId = await finishedJobWithBill("paid", 40000);
    const unbilledJobId = await finishedJobWithBill(null, 0);
    // The helper leaves jobs.completed_at NULL (its return-trip consumers never list) — myDay's
    // complete-inside-today window needs the stamp to include finished work at all.
    await admin`update jobs set completed_at = now() where id in (${paidJobId}, ${unbilledJobId})`;
    const caller = appRouter.createCaller(ctxFor(techAId, orgId, "tech"));

    const day = await caller.v1.field.myDay(TODAY);
    const paidItem = day.items.find((i) => i.id === paidJobId);
    const unbilledItem = day.items.find((i) => i.id === unbilledJobId);
    expect(paidItem?.bill).toMatchObject({ status: "paid", amountPaid: { cents: 40000 } });
    expect(unbilledItem?.bill).toBeNull();
    // The card's who-is-this-for line — resolved from the same customers read the call bar uses.
    // It was left null on the field path, so the line never rendered.
    expect(paidItem?.customerName).toBe("Field Test Customer");
  });


    /**
     * A job tap can no longer land hours, so it can no longer reopen a signed-off week either.
     * The property itself still matters and still has a test — timesheet-policy.int.test.ts proves
     * it against the only writer there is now, a typed entry.
     */

  it("keeps bill STATUS but nulls the paid AMOUNT for a price-blind tech", async () => {
    const paidJobId = await finishedJobWithBill("paid", 40000);
    await admin`update jobs set completed_at = now() where id = ${paidJobId}`;
    // Upsert — the suite org has no org_settings row until something writes one, and a bare
    // UPDATE would no-op into a false pass the other way.
    await admin`
      insert into org_settings (org_id, tech_sees_price, booking)
      values (${orgId}, false, '{"services": [], "notServices": "", "serviceFee": 0, "feeCredited": false}'::jsonb)
      on conflict (org_id) do update set tech_sees_price = false`;
    try {
      const caller = appRouter.createCaller(ctxFor(techAId, orgId, "tech"));
      const day = await caller.v1.field.myDay(TODAY);
      const item = day.items.find((i) => i.id === paidJobId);
      // Paid is a FACT about the job; the figure is a price and follows techSeesPrice.
      expect(item?.bill?.status).toBe("paid");
      expect(item?.bill?.amountPaid).toBeNull();
    } finally {
      await admin`update org_settings set tech_sees_price = true where org_id = ${orgId}`;
    }
  });

  it("REFUSES the return trip on a finished job whose bill is PAID, and changes nothing", async () => {
    const jobId = await finishedJobWithBill("paid", 40000);
    const caller = appRouter.createCaller(ctxFor(techAId, orgId, "tech"));

    await expect(
      caller.v1.field.addFollowUpVisit({ jobId, reason: "wrong fitting, back tomorrow" }),
    ).rejects.toMatchObject({
      code: "CONFLICT",
      message: expect.stringContaining("Payment has already been taken"),
    });

    const [row] = await admin<{ status: string }[]>`select status from jobs where id = ${jobId}`;
    expect(row!.status).toBe("complete");
    expect(await visitCount(jobId)).toBe(1);
  });

  it("REFUSES on a PART-paid bill too — a deposit against the bill is money taken", async () => {
    const jobId = await finishedJobWithBill("partial", 15000);
    const caller = appRouter.createCaller(ctxFor(techAId, orgId, "tech"));

    await expect(
      caller.v1.field.addFollowUpVisit({ jobId, reason: "second half" }),
    ).rejects.toMatchObject({ code: "CONFLICT" });

    const [row] = await admin<{ status: string }[]>`select status from jobs where id = ${jobId}`;
    expect(row!.status).toBe("complete");
    expect(await visitCount(jobId)).toBe(1);
  });

  it("REFUSES when the bill is already with the customer", async () => {
    const jobId = await finishedJobWithBill("sent");
    const caller = appRouter.createCaller(ctxFor(techAId, orgId, "tech"));

    await expect(
      caller.v1.field.addFollowUpVisit({ jobId, reason: "back for the trim" }),
    ).rejects.toMatchObject({
      code: "CONFLICT",
      message: expect.stringContaining("already gone to the customer"),
    });
    expect(await visitCount(jobId)).toBe(1);
  });

  it("ALLOWS the return trip on a finished job with no bill — the job reopens", async () => {
    const jobId = await finishedJobWithBill(null);
    const caller = appRouter.createCaller(ctxFor(techAId, orgId, "tech"));

    const after = await caller.v1.field.addFollowUpVisit({
      jobId,
      reason: "Part on order — back once the tank lands",
    });

    expect(after.status).toBe("in_progress");
    expect(after.visits).toHaveLength(2);

    const [row] = await admin<{ status: string; completed_at: Date | null }[]>`
      select status, completed_at from jobs where id = ${jobId}`;
    expect(row!.status).toBe("in_progress");
    expect(row!.completed_at).toBeNull();

    const [added] = await admin<
      { scheduled_date: string | null; assignee_user_id: string | null; status: string; notes: string | null }[]
    >`select scheduled_date, assignee_user_id, status, notes
        from job_visits where job_id = ${jobId} and position = 2`;
    expect(added!.scheduled_date).toBeNull();
    expect(added!.assignee_user_id).toBeNull();
    expect(added!.status).toBe("pending");
    expect(added!.notes).toBe("Part on order — back once the tank lands");
  });

  it("ALLOWS the return trip behind an untouched DRAFT bill", async () => {
    const jobId = await finishedJobWithBill("draft");
    const caller = appRouter.createCaller(ctxFor(techAId, orgId, "tech"));

    const after = await caller.v1.field.addFollowUpVisit({ jobId, reason: "customer went out" });
    expect(after.status).toBe("in_progress");
    expect(await visitCount(jobId)).toBe(2);
  });

  it("a CANCELED job still refuses — there is no un-cancel", async () => {
    const [j] = await admin<{ id: string }[]>`
      insert into jobs (org_id, lead_id, num, status, total_cents, assignee_user_id, cancel_reason)
      values (${orgId}, ${leadId}, ${"JOB-TA-FUX-" + randomUUID().slice(0, 8)}, 'canceled', 0, ${techAId}, 'customer pulled out')
      returning id`;
    const caller = appRouter.createCaller(ctxFor(techAId, orgId, "tech"));

    await expect(
      caller.v1.field.addFollowUpVisit({ jobId: j!.id, reason: "too late" }),
    ).rejects.toMatchObject({
      code: "CONFLICT",
      message: expect.stringContaining("canceled"),
    });
    expect(await visitCount(j!.id)).toBe(0);
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

  it("myDay is ordered by the earliest live VISIT, not by insert order", async () => {
    // Rewritten: this used to seed `jobs.scheduled_start` directly, a column no production path
    // writes. It passed while proving nothing a real job would exercise — every live job has a
    // null there, so the comparator was "equal" for every pair and the day came back in
    // random-UUID order. Scheduling goes through VISITS; the test now seeds what it asserts.
    const [orderTech] = await admin<{ id: string }[]>`
      insert into users (org_id, auth_user_id, email, role)
      values (${orgId}, ${randomUUID()}, 'ordertech@field.test', 'tech')
      returning id
    `;
    const orderTechId = orderTech!.id;

    const [jobLater] = await admin<{ id: string }[]>`
      insert into jobs (org_id, lead_id, num, status, total_cents, assignee_user_id)
      values (${orgId}, ${leadId}, 'JOB-ORDER-LATER', 'scheduled', 0, ${orderTechId})
      returning id
    `;
    const [jobEarlier] = await admin<{ id: string }[]>`
      insert into jobs (org_id, lead_id, num, status, total_cents, assignee_user_id)
      values (${orgId}, ${leadId}, 'JOB-ORDER-EARLIER', 'scheduled', 0, ${orderTechId})
      returning id
    `;
    // Unplaced: assigned, never given a day. It must still be RETURNED — hiding it is how work
    // goes missing — just not at the head of the route.
    const [jobUnplaced] = await admin<{ id: string }[]>`
      insert into jobs (org_id, lead_id, num, status, total_cents, assignee_user_id)
      values (${orgId}, ${leadId}, 'JOB-ORDER-UNPLACED', 'scheduled', 0, ${orderTechId})
      returning id
    `;
    // The 3pm visit is inserted FIRST, so insert order and created_at both disagree with the clock.
    await admin`
      insert into job_visits (org_id, job_id, status, position, scheduled_date, scheduled_start)
      values (${orgId}, ${jobLater!.id}, 'pending', 1, current_date, '15:00')
    `;
    await admin`
      insert into job_visits (org_id, job_id, status, position, scheduled_date, scheduled_start)
      values (${orgId}, ${jobEarlier!.id}, 'pending', 1, current_date, '08:30')
    `;
    await admin`
      insert into job_visits (org_id, job_id, status, position)
      values (${orgId}, ${jobUnplaced!.id}, 'pending', 1)
    `;

    try {
      const caller = appRouter.createCaller(ctxFor(orderTechId, orgId, "tech"));
      const result = await caller.v1.field.myDay(TODAY);

      expect(result.items.map((i) => i.id)).toEqual([
        jobEarlier!.id,
        jobLater!.id,
        jobUnplaced!.id,
      ]);
    } finally {
      await admin`delete from jobs where id in (${jobLater!.id}, ${jobEarlier!.id}, ${jobUnplaced!.id})`;
      await admin`delete from users where id = ${orderTechId}`;
    }
  });

  // ── v1.field.day — the day pager's read: one named day of the caller's route ──────

  it("day returns exactly the visits dated that day — complete ones kept, other days and unplaced work excluded", async () => {
    const [dayTech] = await admin<{ id: string }[]>`
      insert into users (org_id, auth_user_id, email, role)
      values (${orgId}, ${randomUUID()}, 'daytech@field.test', 'tech')
      returning id
    `;
    const dayTechId = dayTech!.id;
    // A near date inside the pager bound, phrased from the DB's own clock so the test never
    // straddles the suite's runtime day.
    const [dayRow] = await admin<{ day: string }[]>`
      select to_char(current_date + 2, 'YYYY-MM-DD') as day
    `;
    const day = dayRow!.day;
    const [otherDayRow] = await admin<{ day: string }[]>`
      select to_char(current_date + 3, 'YYYY-MM-DD') as day
    `;
    const otherDay = otherDayRow!.day;

    const seedJob = async (num: string): Promise<string> => {
      const [row] = await admin<{ id: string }[]>`
        insert into jobs (org_id, lead_id, num, status, total_cents, assignee_user_id)
        values (${orgId}, ${leadId}, ${num}, 'scheduled', 0, ${dayTechId})
        returning id
      `;
      return row!.id;
    };
    // Inserted afternoon-first so insert order disagrees with the clock; the worked (complete)
    // stop must keep its slot at the head of the day.
    const jobAfternoon = await seedJob("JOB-DAY-PM");
    const jobWorked = await seedJob("JOB-DAY-DONE");
    const jobOtherDay = await seedJob("JOB-DAY-OTHER");
    const jobUnplaced = await seedJob("JOB-DAY-UNPLACED");
    // A called-off job whose dated visit nobody canceled — Job.cancel() does not touch visits.
    // The route must not offer it as a stop.
    const [canceledRow] = await admin<{ id: string }[]>`
      insert into jobs (org_id, lead_id, num, status, total_cents, assignee_user_id)
      values (${orgId}, ${leadId}, 'JOB-DAY-CANCELED', 'canceled', 0, ${dayTechId})
      returning id
    `;
    const jobCanceled = canceledRow!.id;
    await admin`
      insert into job_visits (org_id, job_id, status, position, scheduled_date, scheduled_start)
      values (${orgId}, ${jobAfternoon}, 'pending', 1, ${day}::date, '14:00')
    `;
    await admin`
      insert into job_visits (org_id, job_id, status, position, scheduled_date, scheduled_start)
      values (${orgId}, ${jobWorked}, 'complete', 1, ${day}::date, '08:00')
    `;
    await admin`
      insert into job_visits (org_id, job_id, status, position, scheduled_date, scheduled_start)
      values (${orgId}, ${jobOtherDay}, 'pending', 1, ${otherDay}::date, '09:00')
    `;
    await admin`
      insert into job_visits (org_id, job_id, status, position)
      values (${orgId}, ${jobUnplaced}, 'pending', 1)
    `;
    await admin`
      insert into job_visits (org_id, job_id, status, position, scheduled_date, scheduled_start)
      values (${orgId}, ${jobCanceled}, 'pending', 1, ${day}::date, '11:00')
    `;

    try {
      const caller = appRouter.createCaller(ctxFor(dayTechId, orgId, "tech"));
      const result = await caller.v1.field.day({ date: day });
      expect(result.items.map((i) => i.id)).toEqual([jobWorked, jobAfternoon]);
      // The customers behind the page ride along, same as myDay — the call bar needs a name.
      expect(result.customers.map((c) => c.id)).toContain(leadId);

      // The same read a day over holds only that day's stop.
      const other = await caller.v1.field.day({ date: otherDay });
      expect(other.items.map((i) => i.id)).toEqual([jobOtherDay]);
    } finally {
      await admin`delete from jobs where id in (${jobAfternoon}, ${jobWorked}, ${jobOtherDay}, ${jobUnplaced}, ${jobCanceled})`;
      await admin`delete from users where id = ${dayTechId}`;
    }
  });

  it("standardDay answers the caller's own crew row, the org default, and a day off", async () => {
    const caller = appRouter.createCaller(ctxFor(techAId, orgId, "tech"));
    // Next Monday and next Sunday, from the DB's own clock so the pager bound never bites.
    const [mon] = await admin<{ d: string }[]>`
      select to_char(current_date + (case when (8 - extract(dow from current_date)::int) % 7 = 0
                                          then 7
                                          else ((8 - extract(dow from current_date)::int) % 7 + 7) % 7 end),
                     'YYYY-MM-DD') as d`;
    const [sun] = await admin<{ d: string }[]>`
      select to_char(current_date + ((7 - extract(dow from current_date)::int) % 7), 'YYYY-MM-DD') as d`;
    const monday = mon!.d;
    const sunday = sun!.d;

    // Org defaults exist lazily (getConfig inserts 8..17 weekdays, closed Sunday) — the fallback.
    const orgDefault = await caller.v1.field.standardDay({ date: monday });
    expect(orgDefault.minutes).toBe(9 * 60);

    // A personal row wins: Monday 7..15 → 8h.
    await admin`
      insert into crew_schedules (org_id, user_id, weekday, open_hour, close_hour)
      values (${orgId}, ${techAId}, 1, 7, 15)
      on conflict (org_id, user_id, weekday) do update set open_hour = 7, close_hour = 15`;
    try {
      const personal = await caller.v1.field.standardDay({ date: monday });
      expect(personal.minutes).toBe(8 * 60);

      // Sunday: org closed (0..0) and no personal row → no standard.
      const dayOff = await caller.v1.field.standardDay({ date: sunday });
      expect(dayOff.minutes).toBeNull();
    } finally {
      await admin`delete from crew_schedules where org_id = ${orgId} and user_id = ${techAId}`;
    }
  });

  it("day refuses a date past the pager bound instead of scanning history", async () => {
    const caller = appRouter.createCaller(ctxFor(techAId, orgId, "tech"));
    await expect(caller.v1.field.day({ date: "2020-01-01" })).rejects.toMatchObject({
      code: "BAD_REQUEST",
    });
  });

  it("day is assignee-scoped: another tech's visit on that day is not my route", async () => {
    const [dayRow] = await admin<{ day: string }[]>`
      select to_char(current_date + 2, 'YYYY-MM-DD') as day
    `;
    const day = dayRow!.day;
    // techB holds a visit on the asked day; techA asks.
    const [job] = await admin<{ id: string }[]>`
      insert into jobs (org_id, lead_id, num, status, total_cents, assignee_user_id)
      values (${orgId}, ${leadId}, 'JOB-DAY-THEIRS', 'scheduled', 0, ${techBId})
      returning id
    `;
    await admin`
      insert into job_visits (org_id, job_id, status, position, scheduled_date, scheduled_start)
      values (${orgId}, ${job!.id}, 'pending', 1, ${day}::date, '10:00')
    `;
    try {
      const callerA = appRouter.createCaller(ctxFor(techAId, orgId, "tech"));
      const mine = await callerA.v1.field.day({ date: day });
      expect(mine.items.map((i) => i.id)).not.toContain(job!.id);
    } finally {
      await admin`delete from jobs where id = ${job!.id}`;
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
      const day = await caller.v1.field.myDay(TODAY);
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
      const day = await caller.v1.field.myDay(TODAY);
      expect(day.items.map((i) => i.id)).toContain(jobId);

      const started = await caller.v1.field.start({ jobId });
      expect(started.status).toBe("in_progress");

      // Starting the job records NO hours. Dispatch taps stopped writing to the timesheet when
      // the clock was removed — the technician types their day on My hours, and a tap that also
      // wrote hours would be counted twice by job costing, which reads exactly those rows.
      const rows = await admin`
        select id from time_entries where tech_user_id = ${visitTechId} and deleted_at is null`;
      expect(rows).toHaveLength(0);

    } finally {
      // time_entries holds composite FKs onto BOTH jobs and users, so hours go first.
      await admin`delete from time_entries where org_id = ${orgId} and tech_user_id = ${visitTechId}`;
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
      const day = await caller.v1.field.myDay(TODAY);
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
      const day = await caller.v1.field.myDay(TODAY);
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
      const day = await techCaller.v1.field.myDay(TODAY);
      const mine = day.items.find((i) => i.id === pricedJobId);
      expect(mine?.lines[0]?.rate).toBeNull();
      expect(mine?.lines[0]?.cost).toBeNull();
      // Found work is the ONE exemption: the customer reads that price off this device and signs
      // for it, so the technician's own screens keep it whatever techSeesPrice says. Cost still goes.
      expect(mine?.addons[0]?.rate?.cents).toBe(12000);
      expect(mine?.addons[0]?.cost).toBeNull();
      // Aggregate total is still redacted — the money-leak fix.
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
      const techDay = await techCaller.v1.field.myDay(TODAY);
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

  // ── v1.field.addAddon — proposed-only tech found-work write (rate NOT redacted) ────

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

    // FOUND WORK IS THE EXEMPTION to techSeesPrice, and these two tests are where it is pinned.
    // The rate used to be forced to 0 on write and nulled on read for a !seesPrice tech. Both were
    // wrong for the same reason: the CUSTOMER is asked to sign for found work on this device, so a
    // shop that hides margins from its techs would have produced a $0 addendum for real work and
    // then billed nothing. Cost is still stripped — that is the margin.
    it("assigned tech adds an addon → DB row is proposed and carries the price the customer will sign", async () => {
      const caller = appRouter.createCaller(ctxFor(addonTechId, orgId, "tech"));
      const dto = await caller.v1.field.addAddon({
        jobId: addonJobId,
        description: "Extra shutoff valve",
        rateCents: 9999,
      });

      const added = dto.addons.find((a) => a.description === "Extra shutoff valve");
      expect(added).toBeDefined();
      expect(added!.status).toBe("proposed");
      expect(added!.rate?.cents).toBe(9999);
      expect(added!.cost).toBeNull();

      const [row] = await admin<{ status: string; rate_cents: number }[]>`
        select status, rate_cents from job_addons where job_id = ${addonJobId} and description = 'Extra shutoff valve'`;
      expect(row!.status).toBe("proposed");
      expect(row!.rate_cents).toBe(9999);
    });

    it("the JOB's own prices stay hidden from that same tech — the exemption is add-ons only", async () => {
      const caller = appRouter.createCaller(ctxFor(addonTechId, orgId, "tech"));
      const dto = await caller.v1.field.addAddon({
        jobId: addonJobId,
        description: "Pressure reducer check",
        rateCents: 9999,
      });
      expect(dto.total).toBeNull();
      for (const l of dto.lines) expect(l.rate).toBeNull();

      const [row] = await admin<{ rate_cents: number }[]>`
        select rate_cents from job_addons where job_id = ${addonJobId} and description = 'Pressure reducer check'`;
      expect(row!.rate_cents).toBe(9999);
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

  // ── v1.field.setVisitEnroute / setVisitStatus — the tech drives his own visit ──
  //
  // These taps are the dispatch surface AND the timesheet: each one moves the technician's clock.
  // So every case asserts both facts — the visit moved, and the hours behind it exist. A fresh
  // technician per case keeps each one starting from an idle clock (and away from the one-running-
  // entry-per-tech index).
  describe("visit steps from the field surface", () => {
    interface ClockRow {
      kind: string;
      job_id: string | null;
      running: boolean;
      src: string;
      status: string;
    }

    const seedStepTech = async (email: string): Promise<string> => {
      const [row] = await admin<{ id: string }[]>`
        insert into users (org_id, auth_user_id, email, role)
        values (${orgId}, ${randomUUID()}, ${email}, 'tech')
        returning id
      `;
      return row!.id;
    };

    // A scheduled job with one pending visit, both assigned to `techId`.
    const seedStepJob = async (num: string, techId: string): Promise<{ jobId: string; visitId: string }> => {
      const [job] = await admin<{ id: string }[]>`
        insert into jobs (org_id, lead_id, num, status, total_cents, assignee_user_id)
        values (${orgId}, ${leadId}, ${num}, 'scheduled', 0, ${techId})
        returning id
      `;
      const [visit] = await admin<{ id: string }[]>`
        insert into job_visits (org_id, job_id, assignee_user_id, status, position)
        values (${orgId}, ${job!.id}, ${techId}, 'pending', 1)
        returning id
      `;
      return { jobId: job!.id, visitId: visit!.id };
    };

    // time_entries FKs the job with no cascade, so hours go before the job they point at.
    const dropStepFixture = async (techId: string, jobId: string): Promise<void> => {
      await admin`delete from time_entries where tech_user_id = ${techId}`;
      await admin`delete from jobs where id = ${jobId}`;
      await admin`delete from users where id = ${techId}`;
    };

    // Soft-deleted rows are excluded on purpose: a segment shorter than a minute is DISCARDED, and
    // a test that counted it would be asserting rows the timesheet never shows.
    const clockRows = (techId: string) => admin<ClockRow[]>`
      select kind, job_id, running, src, status
      from time_entries
      where tech_user_id = ${techId} and deleted_at is null
      order by created_at asc
    `;

    const enrouteStamp = async (visitId: string): Promise<Date | null> => {
      const [row] = await admin<{ enroute_at: Date | null }[]>`
        select enroute_at from job_visits where id = ${visitId}
      `;
      return row!.enroute_at;
    };

    it("On my way stamps the visit and writes no hours", async () => {
      const techId = await seedStepTech("step-enroute@field.test");
      const { jobId, visitId } = await seedStepJob("JOB-STEP-ENROUTE", techId);
      try {
        const caller = appRouter.createCaller(ctxFor(techId, orgId, "tech"));
        const dto = await caller.v1.field.setVisitEnroute({ jobId, visitId });

        // Dispatch fact: a stamp, NOT a fifth status — the visit is still pending.
        expect(dto.visits[0]!.status).toBe("pending");
        expect(dto.visits[0]!.enrouteAt).not.toBeNull();
        expect(await enrouteStamp(visitId)).not.toBeNull();

        // And NOT a payroll fact. Dispatch taps stopped writing hours when the clock was
        // removed: hours are typed on My hours, and a tap that also wrote them would be counted
        // twice by job costing, which reads those same rows.
        expect(await clockRows(techId)).toHaveLength(0);
      } finally {
        await dropStepFixture(techId, jobId);
      }
    });

    it("Arrived moves the visit to in_progress and writes no hours", async () => {
      const techId = await seedStepTech("step-arrived@field.test");
      const { jobId, visitId } = await seedStepJob("JOB-STEP-ARRIVED", techId);
      try {
        const caller = appRouter.createCaller(ctxFor(techId, orgId, "tech"));
        const dto = await caller.v1.field.setVisitStatus({ jobId, visitId, status: "in_progress" });

        expect(dto.visits[0]!.status).toBe("in_progress");

        expect(await clockRows(techId)).toHaveLength(0);
      } finally {
        await dropStepFixture(techId, jobId);
      }
    });

    it("Arrived then Done moves the visit and leaves the timesheet untouched", async () => {
      const techId = await seedStepTech("step-done@field.test");
      const { jobId, visitId } = await seedStepJob("JOB-STEP-DONE", techId);
      try {
        const caller = appRouter.createCaller(ctxFor(techId, orgId, "tech"));
        await caller.v1.field.setVisitStatus({ jobId, visitId, status: "in_progress" });
        const dto = await caller.v1.field.setVisitStatus({ jobId, visitId, status: "complete" });

        expect(dto.visits[0]!.status).toBe("complete");

        // There is no clock to stay on between calls. A whole day of tapping produces no rows;
        // the technician writes Regular, Job and Break on My hours and submits the week.
        expect(await clockRows(techId)).toHaveLength(0);
      } finally {
        await dropStepFixture(techId, jobId);
      }
    });

    it("Done on an idle clock writes no hours — a stray tap must not put him back on it", async () => {
      // Deliberate: the exit taps never auto-open. A Done tapped from the truck at 8pm, hours
      // after End day, would otherwise start a segment nobody is inside and quietly bill it.
      const techId = await seedStepTech("step-done-idle@field.test");
      const { jobId, visitId } = await seedStepJob("JOB-STEP-DONE-IDLE", techId);
      try {
        const caller = appRouter.createCaller(ctxFor(techId, orgId, "tech"));
        const dto = await caller.v1.field.setVisitStatus({ jobId, visitId, status: "complete" });

        // The dispatch half still succeeds — the visit is done either way.
        expect(dto.visits[0]!.status).toBe("complete");
        expect(await clockRows(techId)).toHaveLength(0);
      } finally {
        await dropStepFixture(techId, jobId);
      }
    });

    it("On my way then Arrived writes nothing at all to the timesheet", async () => {
      // This used to assert the write ORDER of the clock segments. Nothing is written now, so the
      // property worth keeping is the stronger one: a full dispatch chain leaves payroll alone.
      const techId = await seedStepTech("step-chain@field.test");
      const { jobId, visitId } = await seedStepJob("JOB-STEP-CHAIN", techId);
      try {
        const caller = appRouter.createCaller(ctxFor(techId, orgId, "tech"));
        await caller.v1.field.setVisitEnroute({ jobId, visitId });
        await caller.v1.field.setVisitStatus({ jobId, visitId, status: "in_progress" });

        expect(await clockRows(techId)).toHaveLength(0);
      } finally {
        await dropStepFixture(techId, jobId);
      }
    });

    it("a tech is FORBIDDEN on someone else's job — no stamp, no hours", async () => {
      const ownerTechId = await seedStepTech("step-owner-tech@field.test");
      const strangerId = await seedStepTech("step-stranger@field.test");
      const { jobId, visitId } = await seedStepJob("JOB-STEP-FORBIDDEN", ownerTechId);
      try {
        const stranger = appRouter.createCaller(ctxFor(strangerId, orgId, "tech"));
        await expect(
          stranger.v1.field.setVisitEnroute({ jobId, visitId }),
        ).rejects.toMatchObject({ code: "FORBIDDEN" });
        await expect(
          stranger.v1.field.setVisitStatus({ jobId, visitId, status: "in_progress" }),
        ).rejects.toMatchObject({ code: "FORBIDDEN" });

        // Neither half of the write happened: the assignment gate fires before both.
        expect(await enrouteStamp(visitId)).toBeNull();
        expect(await clockRows(strangerId)).toHaveLength(0);
        const [visit] = await admin<{ status: string }[]>`
          select status from job_visits where id = ${visitId}
        `;
        expect(visit!.status).toBe("pending");
      } finally {
        await admin`delete from time_entries where tech_user_id = ${strangerId}`;
        await admin`delete from users where id = ${strangerId}`;
        await dropStepFixture(ownerTechId, jobId);
      }
    });

    it("an owner through the field surface moves the visit but is put on no clock", async () => {
      const techId = await seedStepTech("step-owner-surface@field.test");
      const { jobId, visitId } = await seedStepJob("JOB-STEP-OWNER", techId);
      try {
        const caller = appRouter.createCaller(ctxFor(ownerUserId, orgId, "owner"));
        const dto = await caller.v1.field.setVisitStatus({ jobId, visitId, status: "in_progress" });

        expect(dto.visits[0]!.status).toBe("in_progress");
        // The dispatcher did not do the work; filing hours against her would be an invented record.
        expect(await clockRows(ownerUserId)).toHaveLength(0);
        expect(await clockRows(techId)).toHaveLength(0);
      } finally {
        await admin`delete from time_entries where tech_user_id = ${ownerUserId}`;
        await dropStepFixture(techId, jobId);
      }
    });

    it("the field API refuses ↩ Reopen — it stays an office correction", async () => {
      const techId = await seedStepTech("step-reopen@field.test");
      const { jobId, visitId } = await seedStepJob("JOB-STEP-REOPEN", techId);
      // A SECOND pending visit keeps the job open after the first is done, so the refusal below
      // can only come from the input enum — not from the closed-job gate standing in for it.
      await admin`
        insert into job_visits (org_id, job_id, assignee_user_id, status, position)
        values (${orgId}, ${jobId}, ${techId}, 'pending', 2)
      `;
      try {
        const caller = appRouter.createCaller(ctxFor(techId, orgId, "tech"));
        const done = await caller.v1.field.setVisitStatus({ jobId, visitId, status: "complete" });
        expect(done.status).not.toBe("complete"); // the job is still open

        // Cast because the field input enum has no such value — this is a hand-rolled client
        // request, which is exactly what the enum is there to stop.
        await expect(
          caller.v1.field.setVisitStatus({
            jobId,
            visitId,
            status: "pending" as unknown as "complete",
          }),
        ).rejects.toMatchObject({ code: "BAD_REQUEST" });

        const [visit] = await admin<{ status: string }[]>`
          select status from job_visits where id = ${visitId}
        `;
        expect(visit!.status).toBe("complete");
      } finally {
        await dropStepFixture(techId, jobId);
      }
    });
  });

  // -------------------------------------------------------------------------
  // signQuote — on-glass sign-off. Before this endpoint existed the tech modal
  // called v1.jobs.setLines (ownerOrOffice), so a technician got FORBIDDEN and
  // was told to check their connection. Nothing about that flow worked.
  // -------------------------------------------------------------------------
  describe("signQuote", () => {
    // Own fixtures, not the shared jobAId/jobBId: earlier tests in this suite COMPLETE those jobs,
    // and a terminal job is correctly refused here. Sharing them made this test fail for a reason
    // that had nothing to do with signing.
    let sigJobA = "";
    let sigJobB = "";

    beforeAll(async () => {
      const [a] = await admin<{ id: string }[]>`
        insert into jobs (org_id, lead_id, num, status, total_cents, assignee_user_id)
        values (${orgId}, ${leadId}, 'JOB-SIG-A', 'scheduled', 0, ${techAId})
        returning id
      `;
      sigJobA = a!.id;
      const [b] = await admin<{ id: string }[]>`
        insert into jobs (org_id, lead_id, num, status, total_cents, assignee_user_id)
        values (${orgId}, ${leadId}, 'JOB-SIG-B', 'scheduled', 0, ${techBId})
        returning id
      `;
      sigJobB = b!.id;
    });

    it("a TECH can price and sign their own job — the whole point of this endpoint", async () => {
      const caller = appRouter.createCaller(ctxFor(techAId, orgId, "tech"));
      const dto = await caller.v1.field.signQuote({
        jobId: sigJobA,
        lines: [
          { description: "Water heater swap", quantity: 1, rateCents: 150_000, costCents: 0 },
          { description: "Haul-away", quantity: 1, rateCents: 5_000, costCents: 0 },
        ],
        signerName: "Dave Chen",
        signatureSvg: "M10,10 L40,30",
      });
      expect(dto.lines).toHaveLength(2);

      const [row] = await admin<{
        signer_name: string | null;
        signature_svg: string | null;
        signed_at: Date | null;
        signed_by_user_id: string | null;
        signed_snapshot: { totalCents: number; authorizationText: string } | null;
      }[]>`
        select signer_name, signature_svg, signed_at, signed_by_user_id, signed_snapshot
        from jobs where id = ${sigJobA}
      `;
      expect(row!.signer_name).toBe("Dave Chen");
      expect(row!.signature_svg).toBe("M10,10 L40,30");
      expect(row!.signed_at).not.toBeNull();
      // The witness: who was standing there. This is the in-person substitute for the customer's
      // own IP on the web path, which on a tech's tablet would attest to nothing.
      expect(row!.signed_by_user_id).toBe(techAId);
      // The frozen document, built server-side from the lines actually written.
      expect(row!.signed_snapshot!.totalCents).toBe(155_000);
      expect(row!.signed_snapshot!.authorizationText).toMatch(/both the quote and the final bill/i);
    });

    it("a tech CANNOT sign a job assigned to someone else", async () => {
      const caller = appRouter.createCaller(ctxFor(techAId, orgId, "tech"));
      await expect(
        caller.v1.field.signQuote({
          jobId: sigJobB,
          lines: [{ description: "sneaky", quantity: 1, rateCents: 100_000, costCents: 0 }],
          signerName: "Dave Chen",
        }),
      ).rejects.toMatchObject({ code: "FORBIDDEN" });

      const [row] = await admin<{ signer_name: string | null }[]>`
        select signer_name from jobs where id = ${sigJobB}
      `;
      expect(row!.signer_name).toBeNull();
    });

    it("signs with a typed name and no drawing", async () => {
      const caller = appRouter.createCaller(ctxFor(techBId, orgId, "tech"));
      await caller.v1.field.signQuote({
        jobId: sigJobB,
        lines: [{ description: "Diagnostic", quantity: 1, rateCents: 9_500, costCents: 0 }],
        signerName: "Marta Reyes",
      });
      const [row] = await admin<{ signer_name: string | null; signature_svg: string | null }[]>`
        select signer_name, signature_svg from jobs where id = ${sigJobB}
      `;
      expect(row!.signer_name).toBe("Marta Reyes");
      expect(row!.signature_svg).toBe("");
    });

    it("the signature reaches the OFFICE and governs the INVOICE — the whole chain", async () => {
      // The end-to-end claim this feature makes: a customer signs on the tech's tablet, the office
      // can produce that signature, and the invoice knows what was authorised. Each link was
      // separately broken at some point; this asserts all of them at once.
      const [j] = await admin<{ id: string }[]>`
        insert into jobs (org_id, lead_id, num, status, total_cents, assignee_user_id)
        values (${orgId}, ${leadId}, 'JOB-SIG-CHAIN', 'scheduled', 0, ${techAId})
        returning id
      `;
      const jobId = j!.id;
      const tech = appRouter.createCaller(ctxFor(techAId, orgId, "tech"));
      await tech.v1.field.signQuote({
        jobId,
        lines: [{ description: "Water heater", quantity: 1, rateCents: 2_000_000, costCents: 0 }],
        signerName: "Dave Chen",
        signatureSvg: "M10,10 L40,30",
      });

      // 1. The OFFICE can read the signature back — not write-only.
      const office = appRouter.createCaller(ctxFor(ownerUserId, orgId, "owner"));
      const fetched = await office.v1.jobs.get({ jobId });
      expect(fetched.signature).not.toBeNull();
      expect(fetched.signature!.signerName).toBe("Dave Chen");
      expect(fetched.signature!.snapshot.totalCents).toBe(2_000_000);
      expect(fetched.signature!.snapshot.authorizationText).toMatch(/both the quote and the final bill/i);

      // 2. An invoice for the signed amount cites the authorisation and does NOT warn.
      await admin`update jobs set status = 'complete', total_cents = 2000000 where id = ${jobId}`;
      const inv = await office.v1.invoicing.createFromJob({ jobId });
      expect(inv.authorization).not.toBeNull();
      expect(inv.authorization!.source).toBe("job");
      expect(inv.authorization!.signerName).toBe("Dave Chen");
      expect(inv.authorization!.authorizedCents).toBe(2_000_000);
      expect(inv.authorization!.overage).toBeNull();

      // 3. Push the bill ABOVE what was signed — the shop is warned, with the exact excess.
      await admin`update invoices set total_cents = 3500000 where id = ${inv.id}`;
      const over = await office.v1.invoicing.get({ invoiceId: inv.id });
      expect(over.authorization!.overage).not.toBeNull();
      expect(over.authorization!.overage!.excessCents).toBe(1_500_000);
      expect(over.authorization!.overage!.authorizedCents).toBe(2_000_000);
      expect(over.authorization!.overage!.invoicedCents).toBe(3_500_000);

      await admin`delete from invoices where id = ${inv.id}`;
      await admin`delete from jobs where id = ${jobId}`;
    });

    it("an UNSIGNED job's invoice carries no authorisation and no warning", async () => {
      // No signed amount means nothing to exceed. Warning here would train people to dismiss the
      // banner, and it only works while it stays rare.
      const [j] = await admin<{ id: string }[]>`
        insert into jobs (org_id, lead_id, num, status, total_cents, assignee_user_id)
        values (${orgId}, ${leadId}, 'JOB-UNSIGNED', 'complete', 900000, ${techAId})
        returning id
      `;
      const office = appRouter.createCaller(ctxFor(ownerUserId, orgId, "owner"));
      const inv = await office.v1.invoicing.createFromJob({ jobId: j!.id });
      expect(inv.authorization).toBeNull();
      await admin`delete from invoices where id = ${inv.id}`;
      await admin`delete from jobs where id = ${j!.id}`;
    });

    it("refuses a blank name and writes NOTHING — not even the lines", async () => {
      // The price and the signature move together. Saving lines while refusing the signature
      // would leave the customer having watched themselves sign and the shop holding a number.
      const [j] = await admin<{ id: string }[]>`
        insert into jobs (org_id, lead_id, num, status, total_cents, assignee_user_id)
        values (${orgId}, ${leadId}, 'JOB-SIG-BLANK', 'scheduled', 0, ${techAId})
        returning id
      `;
      const caller = appRouter.createCaller(ctxFor(techAId, orgId, "tech"));
      await expect(
        caller.v1.field.signQuote({
          jobId: j!.id,
          lines: [{ description: "Repair", quantity: 1, rateCents: 40_000, costCents: 0 }],
          signerName: "   ",
        }),
      ).rejects.toBeTruthy();

      const lines = await admin`select id from job_lines where job_id = ${j!.id} and deleted_at is null`;
      expect(lines).toHaveLength(0);
      const [row] = await admin<{ signed_at: Date | null }[]>`select signed_at from jobs where id = ${j!.id}`;
      expect(row!.signed_at).toBeNull();
      // No orphan estimate either — the whole sign rolled back as one transaction.
      const [est] = await admin<{ n: string }[]>`
        select count(*)::text as n from estimates where org_id = ${orgId} and origin = 'field'
          and signer_name = '   '
      `;
      expect(est!.n).toBe("0");
      await admin`delete from jobs where id = ${j!.id}`;
    });

    // -----------------------------------------------------------------------
    // Estimating, part 1: a quote sold in the field is a REAL quote. The sign
    // must also produce an accepted estimate on the job's lead — the record the
    // rail, won revenue, and the learning estimator all read.
    // -----------------------------------------------------------------------

    it("the sign mints an ACCEPTED field-origin estimate the office can read — and re-signing UPDATES it, never duplicates", async () => {
      // Own lead: the suite's shared lead accumulates field estimates from the earlier sign
      // tests, and this test counts estimates per lead to prove no duplicates.
      const [estLead] = await admin<{ id: string }[]>`
        insert into leads (org_id, name) values (${orgId}, 'Field Estimate Customer') returning id
      `;
      const estLeadId = estLead!.id;
      const [j] = await admin<{ id: string }[]>`
        insert into jobs (org_id, lead_id, num, status, total_cents, assignee_user_id, title)
        values (${orgId}, ${estLeadId}, 'JOB-SIG-EST', 'scheduled', 0, ${techAId}, 'Repipe laundry')
        returning id
      `;
      const jobId = j!.id;
      const tech = appRouter.createCaller(ctxFor(techAId, orgId, "tech"));
      await tech.v1.field.signQuote({
        jobId,
        lines: [
          { description: "Repipe laundry line", quantity: 1, rateCents: 120_000, costCents: 0 },
          { description: "Shutoff valve", quantity: 2, rateCents: 4_000, costCents: 0 },
        ],
        signerName: "Priya Nair",
        signatureSvg: "M1,1 L9,9",
      });

      // 1. The estimate row: right org, right lead, accepted, field-born, signed.
      const [linked] = await admin<{ source_estimate_id: string | null }[]>`
        select source_estimate_id from jobs where id = ${jobId}
      `;
      expect(linked!.source_estimate_id).not.toBeNull();
      const estId = linked!.source_estimate_id!;
      const [est] = await admin<{
        org_id: string;
        lead_id: string;
        status: string;
        origin: string;
        title: string | null;
        signer_name: string | null;
        accepted_at: Date | null;
        signed_snapshot: { totalCents: number } | null;
      }[]>`
        select org_id, lead_id, status, origin, title, signer_name, accepted_at, signed_snapshot
        from estimates where id = ${estId}
      `;
      expect(est!.org_id).toBe(orgId);
      expect(est!.lead_id).toBe(estLeadId);
      expect(est!.status).toBe("accepted");
      expect(est!.origin).toBe("field");
      expect(est!.title).toBe("Repipe laundry");
      expect(est!.signer_name).toBe("Priya Nair");
      expect(est!.accepted_at).not.toBeNull();
      expect(est!.signed_snapshot!.totalCents).toBe(128_000);

      // 2. Its lines are the SIGNED lines.
      const estLines = await admin<{ description: string; rate_cents: number }[]>`
        select description, rate_cents from estimate_lines
        where estimate_id = ${estId} and deleted_at is null order by position
      `;
      expect(estLines).toHaveLength(2);
      expect(estLines[0]!.description).toBe("Repipe laundry line");
      expect(estLines[1]!.rate_cents).toBe(4_000);

      // 3. It appears in the office quoting list read — the rail's data source —
      //    with ZERO changes to that reader.
      const office = appRouter.createCaller(ctxFor(ownerUserId, orgId, "owner"));
      const accepted = await office.v1.quoting.list({ status: "accepted", limit: 200 });
      const listed = accepted.items.find((e) => e.id === estId);
      expect(listed).toBeTruthy();
      expect(listed!.total.cents).toBe(128_000);

      // 4. Re-sign the SAME job at a new price: the estimate is REPLACED, not duplicated.
      await tech.v1.field.signQuote({
        jobId,
        lines: [{ description: "Repipe laundry line + valve", quantity: 1, rateCents: 140_000, costCents: 0 }],
        signerName: "Priya Nair",
      });
      const [after] = await admin<{ n: string }[]>`
        select count(*)::text as n from estimates
        where org_id = ${orgId} and lead_id = ${estLeadId} and origin = 'field' and deleted_at is null
      `;
      expect(after!.n).toBe("1");
      const [resigned] = await admin<{ signed_snapshot: { totalCents: number } }[]>`
        select signed_snapshot from estimates where id = ${estId}
      `;
      expect(resigned!.signed_snapshot.totalCents).toBe(140_000);
      const liveLines = await admin<{ description: string }[]>`
        select description from estimate_lines where estimate_id = ${estId} and deleted_at is null
      `;
      expect(liveLines).toHaveLength(1);

      await admin`update jobs set source_estimate_id = null where id = ${jobId}`;
      await admin`delete from estimate_lines where estimate_id = ${estId}`;
      await admin`delete from estimates where id = ${estId}`;
      await admin`delete from jobs where id = ${jobId}`;
      await admin`delete from leads where id = ${estLeadId}`;
    });

    it("a job sold from an OFFICE quote keeps that quote — the sign does not mint a second accepted estimate", async () => {
      // Office-born accepted estimate + the job it created (source_estimate_id already set).
      // Own lead, so the no-second-estimate count below is scoped to this fixture alone.
      const [offLead] = await admin<{ id: string }[]>`
        insert into leads (org_id, name) values (${orgId}, 'Office Quote Customer') returning id
      `;
      const offLeadId = offLead!.id;
      const [e] = await admin<{ id: string }[]>`
        insert into estimates (org_id, lead_id, num, status, origin, accepted_at)
        values (${orgId}, ${offLeadId}, 'EST-OFFICE-1', 'accepted', 'office', now())
        returning id
      `;
      const officeEstId = e!.id;
      const [j] = await admin<{ id: string }[]>`
        insert into jobs (org_id, lead_id, num, status, total_cents, assignee_user_id, source_estimate_id)
        values (${orgId}, ${offLeadId}, 'JOB-SIG-OFFICE', 'scheduled', 0, ${techAId}, ${officeEstId})
        returning id
      `;
      const tech = appRouter.createCaller(ctxFor(techAId, orgId, "tech"));
      await tech.v1.field.signQuote({
        jobId: j!.id,
        lines: [{ description: "Found extra work", quantity: 1, rateCents: 60_000, costCents: 0 }],
        signerName: "Priya Nair",
      });
      // The job's signature landed (unchanged behavior)…
      const [job] = await admin<{ signer_name: string | null; source_estimate_id: string }[]>`
        select signer_name, source_estimate_id from jobs where id = ${j!.id}
      `;
      expect(job!.signer_name).toBe("Priya Nair");
      // …the office estimate is still the job's source, untouched and alone.
      expect(job!.source_estimate_id).toBe(officeEstId);
      const [count] = await admin<{ n: string }[]>`
        select count(*)::text as n from estimates
        where org_id = ${orgId} and lead_id = ${offLeadId} and deleted_at is null
      `;
      expect(count!.n).toBe("1");
      const [office] = await admin<{ origin: string; num: string }[]>`
        select origin, num from estimates where id = ${officeEstId}
      `;
      expect(office!.origin).toBe("office");

      await admin`update jobs set source_estimate_id = null where id = ${j!.id}`;
      await admin`delete from estimates where id = ${officeEstId}`;
      await admin`delete from jobs where id = ${j!.id}`;
      await admin`delete from leads where id = ${offLeadId}`;
    });

    it("signing a job whose customer is ARCHIVED fails loudly and writes NOTHING — no lines, no estimate", async () => {
      const [archivedLead] = await admin<{ id: string }[]>`
        insert into leads (org_id, name, deleted_at) values (${orgId}, 'Archived Customer', now())
        returning id
      `;
      const [j] = await admin<{ id: string }[]>`
        insert into jobs (org_id, lead_id, num, status, total_cents, assignee_user_id)
        values (${orgId}, ${archivedLead!.id}, 'JOB-SIG-ARCH', 'scheduled', 0, ${techAId})
        returning id
      `;
      const tech = appRouter.createCaller(ctxFor(techAId, orgId, "tech"));
      await expect(
        tech.v1.field.signQuote({
          jobId: j!.id,
          lines: [{ description: "Repair", quantity: 1, rateCents: 50_000, costCents: 0 }],
          signerName: "Priya Nair",
        }),
      ).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });

      // The whole transaction rolled back: no job lines, no signature, no estimate.
      const jobLines = await admin`select id from job_lines where job_id = ${j!.id} and deleted_at is null`;
      expect(jobLines).toHaveLength(0);
      const [row] = await admin<{ signed_at: Date | null }[]>`select signed_at from jobs where id = ${j!.id}`;
      expect(row!.signed_at).toBeNull();
      const [ests] = await admin<{ n: string }[]>`
        select count(*)::text as n from estimates
        where org_id = ${orgId} and lead_id = ${archivedLead!.id}
      `;
      expect(ests!.n).toBe("0");

      await admin`delete from jobs where id = ${j!.id}`;
      await admin`delete from leads where id = ${archivedLead!.id}`;
    });
  });

  // =========================================================================
  // A DAY YOU FINISHED IS STILL A DAY.
  //
  // Owen, testing: "jobs are disappearing after I finish them, the jobs for the day should still
  // be showing but with done status maybe". myDay was two hard status equalities — scheduled and
  // in_progress — so a job left the agenda the instant it was completed, and the technician had no
  // way to check what he had done, or that his last tap had landed at all.
  //
  // The window is the CLIENT'S day, sent as absolute instants. The case that actually catches a
  // regression is the second one: 6pm Pacific is already tomorrow in UTC, so any server-side
  // `completed_at::date = current_date` empties the list every afternoon.
  // =========================================================================
  describe("myDay — work finished today stays on the agenda", () => {
    let windowTechId = "";

    const seedWindowJob = async (
      num: string,
      status: string,
      completedAt: Date | null,
    ): Promise<string> => {
      const [row] = await admin<{ id: string }[]>`
        insert into jobs (org_id, lead_id, num, status, total_cents, assignee_user_id, completed_at)
        values (${orgId}, ${leadId}, ${num}, ${status}, 0, ${windowTechId}, ${completedAt})
        returning id
      `;
      return row!.id;
    };

    beforeAll(async () => {
      const [t] = await admin<{ id: string }[]>`
        insert into users (org_id, auth_user_id, email, role)
        values (${orgId}, ${randomUUID()}, 'windowtech@field.test', 'tech')
        returning id
      `;
      windowTechId = t!.id;
    });

    afterAll(async () => {
      if (windowTechId) await admin`delete from users where id = ${windowTechId}`;
    });

    it("keeps a job finished today, drops one finished yesterday, and never shows a canceled one", async () => {
      const now = new Date();
      const finishedToday = await seedWindowJob("JOB-WIN-TODAY", "complete", now);
      const finishedYesterday = await seedWindowJob(
        "JOB-WIN-YDAY",
        "complete",
        new Date(now.getTime() - 30 * 60 * 60 * 1000),
      );
      // Canceled is never "what I did today", whenever it happened.
      const canceled = await seedWindowJob("JOB-WIN-CANC", "canceled", null);
      const stillOpen = await seedWindowJob("JOB-WIN-OPEN", "scheduled", null);

      try {
        const day = await appRouter
          .createCaller(ctxFor(windowTechId, orgId, "tech"))
          .v1.field.myDay(TODAY);
        const ids = day.items.map((i) => i.id);

        expect(ids).toContain(finishedToday);
        expect(ids).toContain(stillOpen);
        expect(ids).not.toContain(finishedYesterday);
        expect(ids).not.toContain(canceled);

        // …and it carries the status the card renders as "Done", not a silently dropped row.
        expect(day.items.find((i) => i.id === finishedToday)!.status).toBe("complete");
      } finally {
        await admin`delete from jobs where id in (${finishedToday}, ${finishedYesterday}, ${canceled}, ${stillOpen})`;
      }
    });

    it("a job finished at 6pm Pacific — already tomorrow in UTC — is still on today's list", async () => {
      // THE regression case. 2026-03-10T01:30:00Z is 2026-03-09 5:30pm Pacific: a
      // `completed_at::date = current_date` comparison in UTC puts this job on the 10th and the
      // technician's whole afternoon disappears. Absolute instants from the client get it right
      // without an org timezone column, which does not exist.
      const pacificDayStart = new Date("2026-03-09T08:00:00Z"); // local midnight, UTC-8
      const pacificDayEnd = new Date("2026-03-10T08:00:00Z");
      const completedAt = new Date("2026-03-10T01:30:00Z");

      const evening = await seedWindowJob("JOB-WIN-PM", "complete", completedAt);
      try {
        const day = await appRouter
          .createCaller(ctxFor(windowTechId, orgId, "tech"))
          .v1.field.myDay({ dayStart: pacificDayStart, dayEnd: pacificDayEnd });

        expect(day.items.map((i) => i.id)).toContain(evening);
      } finally {
        await admin`delete from jobs where id = ${evening}`;
      }
    });

    it("refuses a window that runs backwards, and one longer than a day", async () => {
      const caller = appRouter.createCaller(ctxFor(windowTechId, orgId, "tech"));
      const start = new Date("2026-03-09T08:00:00Z");

      await expect(
        caller.v1.field.myDay({ dayStart: start, dayEnd: new Date("2026-03-08T08:00:00Z") }),
      ).rejects.toMatchObject({ code: "BAD_REQUEST" });

      await expect(
        caller.v1.field.myDay({ dayStart: start, dayEnd: new Date("2026-04-09T08:00:00Z") }),
      ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    });

    // The office list shares listConds. The new filter member is optional and additive, and
    // v1.jobs.list never sets it — a completed job stays in the office's book forever, which is
    // also why Owen never hit the vanishing-job bug at the desk.
    it("the office list is untouched: a job finished last year is still in the book", async () => {
      const ancient = await seedWindowJob("JOB-WIN-OLD", "complete", new Date("2025-01-05T12:00:00Z"));
      try {
        const office = appRouter.createCaller(ctxFor(ownerUserId, orgId, "owner"));
        const list = await office.v1.jobs.list({ limit: 50 });
        expect(list.items.map((i) => i.id)).toContain(ancient);
      } finally {
        await admin`delete from jobs where id = ${ancient}`;
      }
    });
  });
});
