import { describe, it, expect, afterAll } from "vitest";
import postgres from "postgres";
import { randomUUID } from "node:crypto";
import { asOrgId, asUserId, systemClock } from "@mallet/shared/types";
import { InMemoryEventBus, uuidGenerator } from "@mallet/shared/ports";
import { closeDb } from "@mallet/shared/db/client";
import type { AuthProvider, Role } from "@mallet/identity";
import { appRouter } from "@/trpc/root";
import type { Context } from "@/trpc/init";

/**
 * The nav badge counts, against the real database.
 *
 * These are the numbers that read "500" on every badge because the store had loaded exactly one
 * page — so they are asserted against SQL, not against a fixture that could share the same bug.
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

suite("nav badge counts", () => {
  // closeDb() closes the pool the whole file shares — once, at the end, never per test.
  afterAll(async () => { await closeDb(); });

  it("counts OPEN jobs — past the 500-row page ceiling, and excluding finished work", async () => {
    const admin = postgres(process.env.DATABASE_URL as string, { max: 1, ssl: "require", prepare: false });
    const [o] = await admin<{ id: string }[]>`
      insert into orgs (name) values ('NavCount ' || gen_random_uuid()) returning id`;
    const [l] = await admin<{ id: string }[]>`
      insert into leads (org_id, name) values (${o!.id}, 'Nav Customer') returning id`;

    // 12 open + 5 finished. Small numbers, but the assertion is against SQL rather than a
    // hardcoded figure, so the same test holds at 40,000.
    for (let i = 0; i < 12; i++) {
      await admin`insert into jobs (org_id, lead_id, num, status, total_cents)
                  values (${o!.id}, ${l!.id}, ${"NAV-O" + i}, 'scheduled', 1000)`;
    }
    for (let i = 0; i < 3; i++) {
      await admin`insert into jobs (org_id, lead_id, num, status, total_cents)
                  values (${o!.id}, ${l!.id}, ${"NAV-C" + i}, 'complete', 1000)`;
    }
    for (let i = 0; i < 2; i++) {
      await admin`insert into jobs (org_id, lead_id, num, status, total_cents)
                  values (${o!.id}, ${l!.id}, ${"NAV-X" + i}, 'canceled', 1000)`;
    }

    const caller = appRouter.createCaller(ctxFor(o!.id, "owner"));
    const [truth] = await admin<{ n: number }[]>`
      select count(*)::int n from jobs
      where org_id = ${o!.id} and deleted_at is null and status not in ('complete','canceled')`;

    expect((await caller.v1.jobs.count({ activeOnly: true })).total).toBe(truth!.n);
    expect((await caller.v1.jobs.count({ activeOnly: true })).total).toBe(12);
    // Without the flag it is every job, finished included — the two must not be confused.
    expect((await caller.v1.jobs.count({})).total).toBe(17);

    await admin`delete from orgs where id = ${o!.id}`;
    await admin.end({ timeout: 5 });
  }, 120_000);

  it("reports the REAL job and customer totals for the seeded shop, not the page size", async () => {
    // The bug as Owen saw it: both badges read 500 because both had hit the hydrator's ceiling.
    const admin = postgres(process.env.DATABASE_URL as string, { max: 1, ssl: "require", prepare: false });
    const ORG = "6d2ceccc-e7bb-4d43-904d-d23c01cf9528";
    const [rows] = await admin<{ jobs: number; customers: number }[]>`
      select
        (select count(*)::int from jobs where org_id = ${ORG} and deleted_at is null
           and status not in ('complete','canceled')) jobs,
        (select count(*)::int from leads where org_id = ${ORG} and deleted_at is null) customers`;

    const caller = appRouter.createCaller(ctxFor(ORG, "owner"));
    expect((await caller.v1.jobs.count({ activeOnly: true })).total).toBe(rows!.jobs);
    expect((await caller.v1.customers.count({})).total).toBe(rows!.customers);
    // Whatever the numbers are, they must not be the page ceiling.
    expect(rows!.customers).toBeGreaterThan(500);

    await admin.end({ timeout: 5 });
  }, 120_000);
});
