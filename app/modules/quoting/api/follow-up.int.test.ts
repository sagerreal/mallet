import { describe, it, expect, beforeAll, afterAll } from "vitest";
import postgres from "postgres";
import type { Sql } from "postgres";
import { randomUUID } from "node:crypto";
import { asOrgId, asUserId, systemClock } from "@mallet/shared/types";
import { InMemoryEventBus, uuidGenerator } from "@mallet/shared/ports";
import { closeDb } from "@mallet/shared/db/client";
import type { AuthProvider, Principal, Role } from "@mallet/identity";
import { appRouter } from "@/trpc/root";
import type { Context } from "@/trpc/init";

/**
 * "Are we still chasing this one?"
 *
 * Follow-up state was client-local, and the estimates hydrator reset it to `{ on: false }` on every
 * refetch. So a toggle the user switched ON read back OFF — and since reminders are driven
 * server-side from document status, the switch disagreed with whether nudges were actually going
 * out. A control that misreports the thing it controls is worse than no control.
 */
const hasDb = Boolean(process.env.APP_DATABASE_URL && process.env.DATABASE_URL);
const suite = hasDb ? describe : describe.skip;

const stubAuth: AuthProvider = {
  authenticate: async () => {
    throw new Error("authProvider should not be called in createCaller tests");
  },
};

const ctxFor = (orgId: string, role: Role): Context => ({
  principal: { userId: asUserId(randomUUID()), orgId: asOrgId(orgId), role } satisfies Principal,
  unmapped: null,
  tx: null,
  deps: { authProvider: stubAuth, bus: new InMemoryEventBus(), clock: systemClock, ids: uuidGenerator, paymentLinkGateway: null, connectGateway: null, photoStorageGateway: null, llmClient: null, apiKeyAuthenticator: { authenticate: async () => null }, tokenVerifier: { verify: async () => null }, signupStore: { createOrgForUser: async () => { throw new Error("unused in this test"); } } },
});

suite("follow-up state survives a refetch (live DB)", () => {
  let admin: Sql;
  let orgId = "";
  let leadId = "";

  beforeAll(async () => {
    admin = postgres(process.env.DATABASE_URL as string, { max: 1, ssl: "require", prepare: false });
    const [o] = await admin<{ id: string }[]>`
      insert into orgs (name) values ('FollowUp ' || gen_random_uuid()) returning id`;
    orgId = o!.id;
    const lead = await appRouter
      .createCaller(ctxFor(orgId, "owner"))
      .v1.customers.create({ name: "Priya Raman", phone: "(555) 480-7788" });
    leadId = lead.id;
  });

  afterAll(async () => {
    if (orgId) await admin`delete from orgs where id = ${orgId}`;
    await admin.end({ timeout: 5 });
    await closeDb();
  });

  const newQuote = () =>
    appRouter.createCaller(ctxFor(orgId, "owner")).v1.quoting.draft({
      leadId,
      title: "Repipe",
      lines: [{ description: "Repipe", quantity: 1, rateCents: 240_000, costCents: 0 }],
    });

  it("starts off — nobody is chasing a quote that has not gone out", async () => {
    const quote = await newQuote();
    expect(quote.followUpOn).toBe(false);
    expect(quote.followUpStage).toBe(0);
  });

  it("stays on after it is switched on", async () => {
    const caller = appRouter.createCaller(ctxFor(orgId, "owner"));
    const quote = await newQuote();
    await caller.v1.quoting.setFollowUp({ estimateId: quote.id, on: true, stage: 1 });

    const read = await caller.v1.quoting.get({ estimateId: quote.id });
    expect(read.followUpOn).toBe(true);
    expect(read.followUpStage).toBe(1);
  });

  it("carries onto the LIST read — the rail renders from that shape", async () => {
    const caller = appRouter.createCaller(ctxFor(orgId, "owner"));
    const quote = await newQuote();
    await caller.v1.quoting.setFollowUp({ estimateId: quote.id, on: true, stage: 2 });

    const page = await caller.v1.quoting.list({ limit: 50 });
    const row = page.items.find((q) => q.id === quote.id);
    expect(row?.followUpOn).toBe(true);
    expect(row?.followUpStage).toBe(2);
  });

  it("can be switched back off", async () => {
    const caller = appRouter.createCaller(ctxFor(orgId, "owner"));
    const quote = await newQuote();
    await caller.v1.quoting.setFollowUp({ estimateId: quote.id, on: true, stage: 1 });
    await caller.v1.quoting.setFollowUp({ estimateId: quote.id, on: false, stage: 0 });
    expect((await caller.v1.quoting.get({ estimateId: quote.id })).followUpOn).toBe(false);
  });

  it("refuses a negative stage rather than storing nonsense", async () => {
    const caller = appRouter.createCaller(ctxFor(orgId, "owner"));
    const quote = await newQuote();
    await expect(
      caller.v1.quoting.setFollowUp({ estimateId: quote.id, on: true, stage: -1 }),
    ).rejects.toThrow();
  });

  it("another org cannot reach into this one's quote", async () => {
    const caller = appRouter.createCaller(ctxFor(orgId, "owner"));
    const quote = await newQuote();
    const [other] = await admin<{ id: string }[]>`
      insert into orgs (name) values ('FollowUp Other ' || gen_random_uuid()) returning id`;
    try {
      await expect(
        appRouter
          .createCaller(ctxFor(other!.id, "owner"))
          .v1.quoting.setFollowUp({ estimateId: quote.id, on: true, stage: 1 }),
      ).rejects.toThrow();
    } finally {
      await admin`delete from orgs where id = ${other!.id}`;
    }
  });
});
