import { describe, it, expect, beforeAll, afterAll } from "vitest";
import postgres from "postgres";
import type { Sql } from "postgres";
import { asOrgId, asUserId, systemClock } from "@mallet/shared/types";
import { InMemoryEventBus, uuidGenerator } from "@mallet/shared/ports";
import { closeDb } from "@mallet/shared/db/client";
import type { Principal, Role } from "@mallet/identity";
import { appRouter } from "@/trpc/root";
import type { Context } from "@/trpc/init";

/**
 * v1.jobs.laborByJob against the live database.
 *
 * The rollup arithmetic is unit-tested in labor-rollup.test.ts; what can only be proved here is
 * the QUERY — that the week window picks the right entries, that ONLY job time counts, that the
 * cost rate comes off the person who entered the hours, and that RLS keeps another shop's out.
 *
 * Labour is the TIMESHEET now, not visit stamps. A person types blocks of Regular, Job or Break
 * and names the job on the job blocks; those blocks are what a job costs. Everything this file
 * seeds is therefore a time entry, and the visit-only cases it used to cover (a booked-length
 * fallback, a canceled visit) have no equivalent — an entry either exists or it does not.
 */
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

const MON = "2026-08-03";
const TUE = "2026-08-04";
const SUN = "2026-08-09";
/** The Monday AFTER the window — the row that proves the week boundary is real. */
const NEXT_MON = "2026-08-10";

suite("v1.jobs.laborByJob (live DB)", () => {
  let admin: Sql;
  let orgId = "";
  let otherOrgId = "";
  let ownerId = "";
  let cheapTechId = "";
  let pricyTechId = "";
  let leadId = "";

  const addJob = async (num: string, totalCents: number, org = orgId, lead = leadId) => {
    const [j] = await admin<{ id: string }[]>`
      insert into jobs (org_id, lead_id, num, status, total_cents)
      values (${org}, ${lead}, ${num}, 'in_progress', ${totalCents}) returning id`;
    return j!.id;
  };

  /**
   * One typed timesheet block. `kind` defaults to job time because that is what this file is
   * about; the Regular and Break cases pass it explicitly to prove they are excluded.
   */
  const addEntry = async (
    jobId: string | null,
    e: { date: string; tech: string; start: string; end: string | null; kind?: string; org?: string },
  ) => {
    await admin`
      insert into time_entries (org_id, tech_user_id, job_id, work_date, kind, start_time, end_time, src, status)
      values (${e.org ?? orgId}, ${e.tech}, ${jobId}, ${e.date}, ${e.kind ?? "job"},
              ${e.start}, ${e.end}, 'manual', 'draft')`;
  };

  let poCounter = 0;

  /**
   * One purchase order with lines, inserted directly like every other fixture in this file — the
   * domain layer's own placement rule (a placed order must carry its number, a draft must not) is
   * a DB check constraint, so `num` is only set for a non-draft.
   */
  const addPO = async (
    jobId: string | null,
    status: "draft" | "ordered" | "cancelled",
    opts: { lines: { qty: number; unitCostMillicents: number }[]; freightCents?: number; taxCents?: number },
  ) => {
    const num = status === "draft" ? null : `PO-COSTING-${++poCounter}`;
    const [po] = await admin<{ id: string }[]>`
      insert into purchase_orders (org_id, vendor, status, job_id, num, freight_cents, tax_cents)
      values (${orgId}, 'Costing Supply Co', ${status}, ${jobId}, ${num},
              ${opts.freightCents ?? 0}, ${opts.taxCents ?? 0})
      returning id`;
    for (const l of opts.lines) {
      await admin`
        insert into purchase_order_lines (org_id, po_id, description, qty, unit_cost_millicents)
        values (${orgId}, ${po!.id}, 'Part', ${l.qty}, ${l.unitCostMillicents})`;
    }
    return po!.id;
  };

  beforeAll(async () => {
    admin = postgres(process.env.DATABASE_URL as string, { max: 1, ssl: "require", prepare: false });

    const [o] = await admin<{ id: string }[]>`
      insert into orgs (name) values ('Costing ' || gen_random_uuid()) returning id`;
    orgId = o!.id;
    const [o2] = await admin<{ id: string }[]>`
      insert into orgs (name) values ('CostingOther ' || gen_random_uuid()) returning id`;
    otherOrgId = o2!.id;

    const mkUser = async (org: string, role: string, rate: number | null) => {
      const [u] = await admin<{ id: string }[]>`
        insert into users (org_id, auth_user_id, email, name, role, is_field_crew, cost_rate_cents)
        values (${org}, gen_random_uuid(), 'c-' || gen_random_uuid() || '@costing.test',
                'Costing Crew', ${role}, true, ${rate})
        returning id`;
      return u!.id;
    };
    ownerId = await mkUser(orgId, "owner", null);
    cheapTechId = await mkUser(orgId, "tech", 3200); // $32/h burdened
    pricyTechId = await mkUser(orgId, "tech", 6000); // $60/h burdened

    const [l] = await admin<{ id: string }[]>`
      insert into leads (org_id, name) values (${orgId}, 'Costing Customer') returning id`;
    leadId = l!.id;

    // 2.5h of job time by the $32/h tech → $80.
    const measured = await addJob("C-MEASURED", 180_000);
    await addEntry(measured, { date: TUE, tech: cheapTechId, start: "08:00", end: "10:30" });

    // Two people's blocks on one job — proves the rate follows whoever entered the hours.
    const twoCrew = await addJob("C-TWOCREW", 240_000);
    await addEntry(twoCrew, { date: MON, tech: cheapTechId, start: "09:00", end: "10:00" });
    await addEntry(twoCrew, { date: TUE, tech: pricyTechId, start: "09:00", end: "10:00" });

    // Regular and Break blocks naming this job's day — neither is a job's cost. Regular is paid
    // work nobody attributed and Break is not work at all, so this job stays absent entirely.
    const untimed = await addJob("C-UNATTRIBUTED", 90_000);
    await addEntry(null, { date: TUE, tech: cheapTechId, start: "11:00", end: "13:00", kind: "shop" });
    await addEntry(null, { date: TUE, tech: cheapTechId, start: "13:00", end: "13:30", kind: "break" });
    void untimed;

    // Outside the window entirely.
    const nextWeek = await addJob("C-NEXTWEEK", 50_000);
    await addEntry(nextWeek, { date: NEXT_MON, tech: cheapTechId, start: "09:00", end: "11:00" });

    // Still running — no end time, so no length and nothing honest to cost.
    const openRow = await addJob("C-OPEN", 50_000);
    await addEntry(openRow, { date: TUE, tech: cheapTechId, start: "09:00", end: null });

    // Another shop's hours, on the same days.
    const [ol] = await admin<{ id: string }[]>`
      insert into leads (org_id, name) values (${otherOrgId}, 'Other Customer') returning id`;
    const otherOwner = await mkUser(otherOrgId, "owner", 5000);
    const otherJob = await addJob("C-OTHERORG", 99_000, otherOrgId, ol!.id);
    await addEntry(otherJob, { org: otherOrgId, date: TUE, tech: otherOwner, start: "09:00", end: "13:00" });
  });

  afterAll(async () => {
    for (const org of [orgId, otherOrgId]) {
      if (!org) continue;
      // Entries reference users with no ON DELETE, so they go before the org cascade reaches them.
      await admin`delete from time_entries where org_id = ${org}`;
      await admin`delete from job_visits where org_id = ${org}`;
      // purchase_orders' FK to jobs has no ON DELETE either — same reasoning.
      await admin`delete from purchase_order_lines where org_id = ${org}`;
      await admin`delete from purchase_orders where org_id = ${org}`;
      await admin`delete from orgs where id = ${org}`;
    }
    await admin.end({ timeout: 5 });
    await closeDb();
  });

  const week = () =>
    appRouter.createCaller(ctxFor(ownerId, orgId, "owner")).v1.jobs.laborByJob({ from: MON, to: SUN });

  it("costs a typed block at the rate of whoever entered it", async () => {
    const row = (await week()).items.find((i) => i.num === "C-MEASURED");
    expect(row).toMatchObject({ visits: 1, hours: 2.5, costCents: 8000, source: "measured" });
    expect(row?.quotedCents).toBe(180_000);
    expect(row?.customerName).toBe("Costing Customer");
  });

  /**
   * The rate belongs to whoever worked those hours. Costing a whole job at one person's rate —
   * the job's assignee, or the caller — is the quiet way a two-crew job reports a wrong margin.
   */
  it("takes each block's rate from its own author: 1h at $32 + 1h at $60 = $92", async () => {
    const row = (await week()).items.find((i) => i.num === "C-TWOCREW");
    expect(row).toMatchObject({ visits: 2, hours: 2, costCents: 9200 });
  });

  /**
   * ONLY JOB TIME IS A JOB'S COST. Regular is paid work nobody attributed and Break is not work,
   * so neither may land on a job — and a job with no job blocks is absent rather than costing 0,
   * because 0 reads as "measured, free".
   */
  it("counts neither Regular nor Break", async () => {
    expect((await week()).items.map((i) => i.num)).not.toContain("C-UNATTRIBUTED");
  });

  it("keeps the week window: next Monday's block is not in this week", async () => {
    expect((await week()).items.map((i) => i.num)).not.toContain("C-NEXTWEEK");
  });

  /**
   * A row with no end time has no length. Costing it as if it ended now would change the job's
   * margin every time the page was opened.
   */
  it("ignores a block that has not been closed out", async () => {
    expect((await week()).items.map((i) => i.num)).not.toContain("C-OPEN");
  });

  it("never returns another shop's hours", async () => {
    expect((await week()).items.map((i) => i.num)).not.toContain("C-OTHERORG");
  });

  /**
   * Hours without money, never hours at $0. A shop that has not told us what somebody costs must
   * see the time they worked and be told the money is unknown — the alternative reports a job as
   * more profitable than it was, which is the one direction this must never be wrong in.
   */
  it("counts hours from somebody with no burdened rate, with no cost against them", async () => {
    const orphanJob = await addJob("C-ORPHAN", 40_000);
    await addEntry(orphanJob, { date: TUE, tech: ownerId, start: "14:00", end: "15:30" });

    const row = (await week()).items.find((i) => i.num === "C-ORPHAN");
    expect(row).toMatchObject({ hours: 1.5, costCents: null, costIsPartial: false });
  });

  /**
   * Half a rate table is still worth showing, as long as it says it is half. Silently reporting
   * only the priced half as if it were the whole cost is the flattering-direction error again.
   */
  it("flags a job as partial when only some of its hours are priced", async () => {
    const mixed = await addJob("C-PARTIAL", 40_000);
    await addEntry(mixed, { date: TUE, tech: cheapTechId, start: "08:00", end: "09:00" });
    await addEntry(mixed, { date: TUE, tech: ownerId, start: "09:00", end: "10:00" });

    const row = (await week()).items.find((i) => i.num === "C-PARTIAL");
    expect(row).toMatchObject({ hours: 2, costCents: 3200, costIsPartial: true });
  });

  /**
   * QUOTED AND PURCHASED ARE NOT ADDED TOGETHER, and freight/tax live once per ORDER — a naive
   * join-then-sum over the lines would multiply them by the line count. Two lines here is the
   * point: a bug that adds freight+tax per line would report $45 instead of $35.
   */
  it("charges a placed order's lines plus freight and tax, counted ONCE per order", async () => {
    const job = await addJob("C-PO-ORDERED", 500_00);
    await addEntry(job, { date: TUE, tech: cheapTechId, start: "08:00", end: "09:00" });
    await addPO(job, "ordered", {
      freightCents: 800,
      taxCents: 200,
      lines: [
        { qty: 2, unitCostMillicents: 500_000 }, // 2 × $5.00 = $10.00
        { qty: 1, unitCostMillicents: 1_500_000 }, // 1 × $15.00 = $15.00
      ],
    });

    const row = (await week()).items.find((i) => i.num === "C-PO-ORDERED");
    expect(row?.purchasedCents).toBe(3_500); // 1,000 + 1,500 + 800 + 200
    expect(row?.materialsCents).toBe(0); // quoted materials are a separate figure, untouched
  });

  /**
   * TWO orders on one job must SUM, not overwrite — the accumulate loop in `purchasedByJob`
   * (`out.set(jobId, (out.get(jobId) ?? 0) + cents)`) was untested until now, and it is exactly
   * the loop a leftJoin/innerJoin regression on the per-order query would silently break.
   */
  it("sums TWO purchase orders on one job", async () => {
    const job = await addJob("C-PO-TWOORDERS", 500_00);
    await addEntry(job, { date: TUE, tech: cheapTechId, start: "08:00", end: "09:00" });
    await addPO(job, "ordered", { lines: [{ qty: 1, unitCostMillicents: 1_000_000 }] }); // $10
    await addPO(job, "ordered", { freightCents: 500, lines: [{ qty: 1, unitCostMillicents: 2_000_000 }] }); // $20 + $5

    const row = (await week()).items.find((i) => i.num === "C-PO-TWOORDERS");
    expect(row?.purchasedCents).toBe(3_500); // 1,000 + (2,000 + 500)
  });

  it("counts nothing from a draft order — a draft is not money committed", async () => {
    const job = await addJob("C-PO-DRAFT", 500_00);
    await addEntry(job, { date: TUE, tech: cheapTechId, start: "08:00", end: "09:00" });
    await addPO(job, "draft", { freightCents: 500, lines: [{ qty: 1, unitCostMillicents: 1_000_000 }] });

    const row = (await week()).items.find((i) => i.num === "C-PO-DRAFT");
    expect(row?.purchasedCents).toBe(0);
  });

  it("counts nothing from a cancelled order — it never happened", async () => {
    const job = await addJob("C-PO-CANCELLED", 500_00);
    await addEntry(job, { date: TUE, tech: cheapTechId, start: "08:00", end: "09:00" });
    await addPO(job, "cancelled", { freightCents: 500, lines: [{ qty: 1, unitCostMillicents: 1_000_000 }] });

    const row = (await week()).items.find((i) => i.num === "C-PO-CANCELLED");
    expect(row?.purchasedCents).toBe(0);
  });

  /**
   * A stock/truck-restock order has no job — `job_id` is nullable for exactly this case. It must
   * never land on whichever job happens to be in the week rather than vanishing.
   */
  it("never attributes a stock order (no job) to any job in the week", async () => {
    await addPO(null, "ordered", {
      freightCents: 900,
      taxCents: 100,
      lines: [{ qty: 1, unitCostMillicents: 10_000_000 }],
    });

    const row = (await week()).items.find((i) => i.num === "C-MEASURED");
    expect(row?.purchasedCents).toBe(0);
  });

  it("a tech is refused — labor cost is not a field surface", async () => {
    const caller = appRouter.createCaller(ctxFor(cheapTechId, orgId, "tech"));
    await expect(caller.v1.jobs.laborByJob({ from: MON, to: SUN })).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
});
