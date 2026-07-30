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
 * The Jobs list showed "$0" in the Amount column on every row while the jobs carried real prices.
 * The money was in the database and simply never fetched: the list DTO returned empty lines[], and
 * the column sums lines.
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

suite("jobs list rows carry money and a customer name", () => {
  afterAll(async () => { await closeDb(); });

  it("returns LINE ITEMS, so the Amount column is not $0", async () => {
    const admin = postgres(process.env.DATABASE_URL as string, { max: 1, ssl: "require", prepare: false });
    const [o] = await admin<{ id: string }[]>`
      insert into orgs (name) values ('AmountCol ' || gen_random_uuid()) returning id`;
    const [l] = await admin<{ id: string }[]>`
      insert into leads (org_id, name) values (${o!.id}, 'Ortiz Plumbing') returning id`;
    const [j] = await admin<{ id: string }[]>`
      insert into jobs (org_id, lead_id, num, status, total_cents)
      values (${o!.id}, ${l!.id}, 'AMT-1', 'scheduled', 0) returning id`;
    await admin`
      insert into job_lines (org_id, job_id, description, quantity, rate_cents, cost_cents, position)
      values (${o!.id}, ${j!.id}, 'Hose bib replacement', 1, 22500, 7000, 0)`;

    const caller = appRouter.createCaller(ctxFor(o!.id, "owner"));
    const page = await caller.v1.jobs.list({ limit: 10 });
    const row = page.items.find((i) => i.num === "AMT-1");

    if (!row) throw new Error("AMT-1 not returned by the list");
    expect(row.lines).toHaveLength(1);
    const [first] = row.lines;
    // rate is nullable on the wire — it is redacted for techs who cannot see prices.
    expect(first?.rate?.cents).toBe(22500);
    // ...and the customer name comes from the server, not a store lookup that may not have it.
    expect(row.customerName).toBe("Ortiz Plumbing");

    await admin`delete from orgs where id = ${o!.id}`;
    await admin.end({ timeout: 5 });
  }, 120_000);

  it("resolves customer names for jobs whose customer is past the store's page ceiling", async () => {
    // The real seeded shop: 606 customers, of which the store loads 500. A paginated job list must
    // not render "—" for the rest.
    const admin = postgres(process.env.DATABASE_URL as string, { max: 1, ssl: "require", prepare: false });
    const ORG = "6d2ceccc-e7bb-4d43-904d-d23c01cf9528";
    const caller = appRouter.createCaller(ctxFor(ORG, "owner"));
    const page = await caller.v1.jobs.list({ limit: 50 });
    expect(page.items.length).toBeGreaterThan(0);
    for (const row of page.items) {
      expect(row.customerName, `${row.num} has no customer name`).toBeTruthy();
    }
    await admin.end({ timeout: 5 });
  }, 120_000);
});
