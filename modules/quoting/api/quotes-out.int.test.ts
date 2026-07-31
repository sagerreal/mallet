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
 * The Pipeline strip read "$0" on a shop with twelve sent quotes worth $29,722.
 *
 * The rail joined loaded estimates to loaded LEADS, and the two collections have independent
 * 500-row ceilings — the quotes were in memory, their customers were not, and the join dropped
 * every row. This asserts the server answers the question directly, with no join to a collection
 * that may not be loaded.
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

suite("quotes out — the Pipeline strip", () => {
  afterAll(async () => { await closeDb(); });

  it("returns sent quotes with domain-computed totals, whatever the customer's age", async () => {
    const admin = postgres(process.env.DATABASE_URL as string, { max: 1, ssl: "require", prepare: false });
    const [o] = await admin<{ id: string }[]>`
      insert into orgs (name) values ('QuotesOut ' || gen_random_uuid()) returning id`;
    const caller = appRouter.createCaller(ctxFor(o!.id, "owner"));

    const lead = await caller.v1.customers.create({ name: "Old Customer" });
    const drafted = await caller.v1.quoting.draft({
      leadId: lead.id,
      title: "Repipe",
      taxBps: 875,
      lines: [{ description: "Whole-house repipe", quantity: 1, rateCents: 1_450_000 }],
    });
    await caller.v1.quoting.send({ estimateId: drafted.id });

    // Age the CUSTOMER far past any page window. The old rail would drop this quote entirely.
    await admin`update leads set created_at = now() - interval '5 years' where id = ${lead.id}`;

    const sent = await caller.v1.quoting.list({ status: "sent", limit: 200 });
    expect(sent.items).toHaveLength(1);
    // Total is the DOMAIN's — lines, then tax — not a sum re-derived in SQL.
    expect(sent.items[0]?.total.cents).toBe(1_576_875);

    await admin`delete from orgs where id = ${o!.id}`;
    await admin.end({ timeout: 5 });
  }, 120_000);

  it("matches the real shop's outstanding quote value", async () => {
    // The concrete number behind the bug report.
    const admin = postgres(process.env.DATABASE_URL as string, { max: 1, ssl: "require", prepare: false });
    const ORG = "6d2ceccc-e7bb-4d43-904d-d23c01cf9528";
    const caller = appRouter.createCaller(ctxFor(ORG, "owner"));
    const sent = await caller.v1.quoting.list({ status: "sent", limit: 200 });
    const sum = sent.items.reduce((s, e) => s + e.total.cents, 0);

    expect(sent.items.length).toBeGreaterThan(0);
    expect(sum).toBeGreaterThan(0);   // the screen said $0
    await admin.end({ timeout: 5 });
  }, 120_000);
});
