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
 * The Pipeline board's four columns, in SQL.
 *
 * The board partitioned an in-memory array, so exclusivity was free. Here each column has to
 * exclude the ones before it explicitly — and a customer counted in two columns makes every number
 * on the board wrong.
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

suite("pipeline board columns", () => {
  let admin: Sql;
  let orgId = "";

  const addLead = async (name: string) => {
    const [l] = await admin<{ id: string }[]>`
      insert into leads (org_id, name) values (${orgId}, ${name}) returning id`;
    return l!.id;
  };
  const addEstimate = (leadId: string, num: string, status: string) =>
    admin`insert into estimates (org_id, lead_id, num, status) values (${orgId}, ${leadId}, ${num}, ${status})`;

  beforeAll(async () => {
    admin = postgres(process.env.DATABASE_URL as string, { max: 1, ssl: "require", prepare: false });
    const [o] = await admin<{ id: string }[]>`
      insert into orgs (name) values ('LeadViews ' || gen_random_uuid()) returning id`;
    orgId = o!.id;

    await addLead("Untouched One");
    await addLead("Untouched Two");
    await addEstimate(await addLead("Drafting"), "E-D1", "draft");
    await addEstimate(await addLead("Quoted Out"), "E-S1", "sent");
    await addEstimate(await addLead("Closed Won"), "E-A1", "accepted");

    // The interesting one: a customer with BOTH a live quote and an accepted one. Won must win —
    // a customer who said yes is won even with other paper still out.
    const both = await addLead("Both");
    await addEstimate(both, "E-B1", "sent");
    await addEstimate(both, "E-B2", "accepted");
  });

  afterAll(async () => {
    if (orgId) await admin`delete from orgs where id = ${orgId}`;
    await admin.end({ timeout: 5 });
    await closeDb();
  });

  it("counts each column", async () => {
    const caller = appRouter.createCaller(ctxFor(orgId, "owner"));
    const c = await caller.v1.customers.viewCounts();
    expect(c.intake).toBe(2);
    expect(c.quoting).toBe(1);
    expect(c.out).toBe(1);
    expect(c.won).toBe(2);   // Closed Won + Both
  });

  it("columns are MUTUALLY EXCLUSIVE and account for every live customer", async () => {
    const caller = appRouter.createCaller(ctxFor(orgId, "owner"));
    const c = await caller.v1.customers.viewCounts();
    const [total] = await admin<{ n: number }[]>`
      select count(*)::int n from leads where org_id = ${orgId} and deleted_at is null`;
    expect(Object.values(c).reduce((a, b) => a + b, 0)).toBe(total!.n);

    const seen = new Set<string>();
    for (const view of ["intake", "quoting", "out", "won"] as const) {
      const page = await caller.v1.customers.list({ view, limit: 50 });
      for (const l of page.items) {
        expect(seen.has(l.id), `${l.name} is in more than one column`).toBe(false);
        seen.add(l.id);
      }
    }
    expect(seen.size).toBe(total!.n);
  });

  it("intake means UNPAPERED, not stage = new", async () => {
    // Every lead here is at stage "new" — the default — but four of them have paper. A stage
    // filter would put all six in the first column, which is exactly what the board showed.
    const caller = appRouter.createCaller(ctxFor(orgId, "owner"));
    const page = await caller.v1.customers.list({ view: "intake", limit: 50 });
    expect(page.items.map((l) => l.name).sort()).toEqual(["Untouched One", "Untouched Two"]);
    const [stageNew] = await admin<{ n: number }[]>`
      select count(*)::int n from leads where org_id = ${orgId} and stage = 'new' and deleted_at is null`;
    expect(stageNew!.n).toBe(6);
  });

  it("an accepted quote wins over a live one", async () => {
    const caller = appRouter.createCaller(ctxFor(orgId, "owner"));
    const out = await caller.v1.customers.list({ view: "out", limit: 50 });
    expect(out.items.map((l) => l.name)).not.toContain("Both");
    const won = await caller.v1.customers.list({ view: "won", limit: 50 });
    expect(won.items.map((l) => l.name)).toContain("Both");
  });

  it("does not leak across tenants", async () => {
    const [other] = await admin<{ id: string }[]>`
      insert into orgs (name) values ('LeadViews Other ' || gen_random_uuid()) returning id`;
    const caller = appRouter.createCaller(ctxFor(other!.id, "owner"));
    const c = await caller.v1.customers.viewCounts();
    expect(Object.values(c).reduce((a, b) => a + b, 0)).toBe(0);
    await admin`delete from orgs where id = ${other!.id}`;
  });
});
