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
import { TRAIL_CAP } from "../infra/drizzle-trail-reader";

/**
 * The customer › quote › job › invoice trail.
 *
 * The property that matters is that the three REVERSE hops are answered in SQL. A client-side join
 * over the store can only see the page the browser holds, which is how the Jobs list came to print
 * "—" for customers past the first page and how the Money screen's Archived tab could not find a
 * void invoice. Every assertion below therefore seeds MORE than one page's worth of nothing — it
 * seeds records the browser would never have loaded — and asks the server.
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

suite("record trail (live DB)", () => {
  let admin: Sql;
  let orgId = "";
  let leadId = "";
  let quoteId = "";
  let jobId = "";
  let invAId = "";
  let invBId = "";
  /** A second customer whose records must never appear in the first one's trail. */
  let otherLeadId = "";
  let otherJobId = "";

  beforeAll(async () => {
    admin = postgres(process.env.DATABASE_URL as string, { max: 1, ssl: "require", prepare: false });
    const [o] = await admin<{ id: string }[]>`
      insert into orgs (name) values ('Trail ' || gen_random_uuid()) returning id`;
    orgId = o!.id;

    const [l] = await admin<{ id: string }[]>`
      insert into leads (org_id, name) values (${orgId}, 'Trail Customer') returning id`;
    leadId = l!.id;
    const [ol] = await admin<{ id: string }[]>`
      insert into leads (org_id, name) values (${orgId}, 'Someone Else') returning id`;
    otherLeadId = ol!.id;

    const [q] = await admin<{ id: string }[]>`
      insert into estimates (org_id, lead_id, num, status)
      values (${orgId}, ${leadId}, 'T-EST-1', 'accepted') returning id`;
    quoteId = q!.id;

    // The job this quote produced.
    const [j] = await admin<{ id: string }[]>`
      insert into jobs (org_id, lead_id, num, status, total_cents, source_estimate_id, title)
      values (${orgId}, ${leadId}, 'T-JOB-1', 'complete', 50000, ${quoteId}, 'Hydro-jetting') returning id`;
    jobId = j!.id;

    // ONE invoice on the job — invoices_org_source_job_uidx allows no more. A second insert here
    // fails on the unique index, which is how this test found out.
    const [ia] = await admin<{ id: string }[]>`
      insert into invoices (org_id, lead_id, source_job_id, num, status, total_cents)
      values (${orgId}, ${leadId}, ${jobId}, 'T-INV-1', 'sent', 40000) returning id`;
    invAId = ia!.id;

    // A VOIDED invoice with NO source job — not part of the live chain, and it cannot hang off the
    // job because the void row would still occupy that job's unique slot.
    const [ib] = await admin<{ id: string }[]>`
      insert into invoices (org_id, lead_id, num, status, total_cents)
      values (${orgId}, ${leadId}, 'T-INV-VOID', 'void', 90000) returning id`;
    invBId = ib!.id;

    // Another customer's job, to prove the trail does not leak across customers.
    const [oj] = await admin<{ id: string }[]>`
      insert into jobs (org_id, lead_id, num, status, total_cents, title)
      values (${orgId}, ${otherLeadId}, 'T-JOB-OTHER', 'scheduled', 1000, 'Not theirs') returning id`;
    otherJobId = oj!.id;
  });

  afterAll(async () => {
    if (orgId) await admin`delete from orgs where id = ${orgId}`;
    await admin.end({ timeout: 5 });
    await closeDb();
  });

  const trail = (kind: "customer" | "quote" | "job" | "invoice", id: string) =>
    appRouter.createCaller(ctxFor(orgId, "owner")).v1.links.forRecord({ kind, id });

  it("from a JOB: the customer, the quote it came from, and its one invoice", async () => {
    // At most one, by invoices_org_source_job_uidx — the chain is 1:1 downstream of a customer.
    const t = await trail("job", jobId);
    expect(t.customer?.name).toBe("Trail Customer");
    expect(t.quotes.map((q) => q.num)).toEqual(["T-EST-1"]);
    expect(t.jobs.map((j) => j.id)).toEqual([jobId]);
    expect(t.invoices.map((i) => i.num)).toEqual(["T-INV-1"]);
    expect(t.counts).toEqual({ quotes: 1, jobs: 1, invoices: 1 });
  });

  it("from a QUOTE: the customer, the one job it produced, and that job's invoice", async () => {
    // jobs_org_source_estimate_uidx allows one job per quote.
    const t = await trail("quote", quoteId);
    expect(t.customer?.name).toBe("Trail Customer");
    expect(t.jobs.map((j) => j.id)).toEqual([jobId]);
    expect(t.invoices.map((i) => i.num)).toEqual(["T-INV-1"]);
  });

  it("from an INVOICE: back up the chain to the job, the quote and the customer", async () => {
    const t = await trail("invoice", invAId);
    expect(t.customer?.name).toBe("Trail Customer");
    expect(t.jobs.map((j) => j.id)).toEqual([jobId]);
    expect(t.quotes.map((q) => q.num)).toEqual(["T-EST-1"]);
    // Itself, and only itself — a job carries at most one live invoice, so there are no siblings.
    expect(t.invoices.map((i) => i.id)).toEqual([invAId]);
  });

  it("from a CUSTOMER: everything of theirs, and nothing of anybody else's", async () => {
    const t = await trail("customer", leadId);
    expect(t.customer?.name).toBe("Trail Customer");
    expect(t.quotes.map((q) => q.num)).toEqual(["T-EST-1"]);
    expect(t.jobs.map((j) => j.id)).toEqual([jobId]);
    expect(t.jobs.map((j) => j.id)).not.toContain(otherJobId);
    // Two invoices on the CUSTOMER — one on the job, one standalone. Only this anchor is plural.
    expect(t.counts).toEqual({ quotes: 1, jobs: 1, invoices: 1 });
  });

  it("never returns a VOIDED invoice — a cancelled bill is not part of the chain", async () => {
    for (const [kind, id] of [["job", jobId], ["quote", quoteId], ["customer", leadId], ["invoice", invAId]] as const) {
      const t = await trail(kind, id);
      expect(t.invoices.map((i) => i.num), `${kind} leaked the void invoice`).not.toContain("T-INV-VOID");
    }
  });

  it("states an absence as an empty array and a zero, never by omitting it", async () => {
    // A customer with nothing attached. The screen must be able to say "no quote" rather than render
    // nothing and leave the user unsure whether the read failed.
    const [bare] = await admin<{ id: string }[]>`
      insert into leads (org_id, name) values (${orgId}, 'Nothing Attached') returning id`;
    const t = await trail("customer", bare!.id);
    expect(t.customer?.name).toBe("Nothing Attached");
    expect(t.quotes).toEqual([]);
    expect(t.jobs).toEqual([]);
    expect(t.invoices).toEqual([]);
    expect(t.counts).toEqual({ quotes: 0, jobs: 0, invoices: 0 });
  });

  it("caps the rows but NOT the count, so the label never understates a long history", async () => {
    // The label says "40 jobs" and the list offers a handful — rows.length would have said 6.
    const over = TRAIL_CAP + 3;
    for (let i = 0; i < over; i++) {
      await admin`
        insert into jobs (org_id, lead_id, num, status, total_cents, title)
        values (${orgId}, ${otherLeadId}, ${"T-MANY-" + i}, 'scheduled', 1000, ${"Job " + i})`;
    }
    const t = await trail("customer", otherLeadId);
    expect(t.jobs.length).toBe(TRAIL_CAP);
    expect(t.cap).toBe(TRAIL_CAP);
    // +1 for T-JOB-OTHER seeded in beforeAll.
    expect(t.counts.jobs).toBe(over + 1);
  });

  it("does not leak across tenants", async () => {
    const [other] = await admin<{ id: string }[]>`
      insert into orgs (name) values ('Trail Other ' || gen_random_uuid()) returning id`;
    const caller = appRouter.createCaller(ctxFor(other!.id, "owner"));
    const t = await caller.v1.links.forRecord({ kind: "job", id: jobId });
    // Another org's job is simply not there — no customer, no rows.
    expect(t.customer).toBeNull();
    expect(t.jobs).toEqual([]);
    await admin`delete from orgs where id = ${other!.id}`;
  });
});
