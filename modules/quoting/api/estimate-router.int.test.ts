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

// Capstone: the whole quoting stack via createCaller — auth, RBAC, org-scoped tx, use-cases,
// Drizzle repo, live RLS. Owner in org A drafts -> sends -> accepts; org B sees nothing; a tech
// is forbidden.
const hasDb = Boolean(process.env.APP_DATABASE_URL && process.env.DATABASE_URL);
const suite = hasDb ? describe : describe.skip;

const stubAuth: AuthProvider = {
  authenticate: async () => {
    throw new Error("authProvider should not be called in createCaller tests");
  },
};

const ctxFor = (orgId: string, role: Role): Context => ({
  principal: { userId: asUserId(randomUUID()), orgId: asOrgId(orgId), role } satisfies Principal,
  tx: null,
  deps: { authProvider: stubAuth, bus: new InMemoryEventBus(), clock: systemClock, ids: uuidGenerator, paymentLinkGateway: null },
});

suite("quoting tRPC router (full stack, live RLS)", () => {
  let admin: Sql;
  let orgAId = "";
  let orgBId = "";
  let leadAId = "";

  beforeAll(async () => {
    admin = postgres(process.env.DATABASE_URL as string, { max: 1, ssl: "require", prepare: false });
    const [a] = await admin<{ id: string }[]>`
      insert into orgs (name) values ('QuoteApi A ' || gen_random_uuid()) returning id`;
    const [b] = await admin<{ id: string }[]>`
      insert into orgs (name) values ('QuoteApi B ' || gen_random_uuid()) returning id`;
    orgAId = a!.id;
    orgBId = b!.id;
    const [la] = await admin<{ id: string }[]>`
      insert into leads (org_id, name) values (${orgAId}, 'Cust A') returning id`;
    leadAId = la!.id;
  });

  afterAll(async () => {
    if (orgAId) await admin`delete from orgs where id in (${orgAId}, ${orgBId})`;
    await admin.end({ timeout: 5 });
    await closeDb();
  });

  it("owner drafts, sends, and accepts an estimate with correct totals", async () => {
    const caller = appRouter.createCaller(ctxFor(orgAId, "owner"));
    const drafted = await caller.v1.quoting.draft({
      leadId: leadAId,
      title: "Deck rebuild",
      taxBps: 1_000, // 10%
      depBps: 5_000, // 50%
      lines: [
        { description: "Labor", quantity: 10, rateCents: 10_000 }, // 100000c
        { description: "Optional sealant", quantity: 1, rateCents: 5_000, isOptional: true },
      ],
    });
    expect(drafted.status).toBe("draft");
    expect(drafted.num).toMatch(/^EST-\d+$/);
    expect(drafted.subtotal.cents).toBe(100_000); // optional line excluded
    expect(drafted.tax.cents).toBe(10_000);
    expect(drafted.total.cents).toBe(110_000);
    expect(drafted.depositDue.cents).toBe(55_000);

    const sent = await caller.v1.quoting.send({ estimateId: drafted.id });
    expect(sent.status).toBe("sent");

    const accepted = await caller.v1.quoting.accept({ estimateId: drafted.id });
    expect(accepted.status).toBe("accepted");

    const fetched = await caller.v1.quoting.get({ estimateId: drafted.id });
    expect(fetched.total.cents).toBe(110_000);

    const listed = await caller.v1.quoting.list({ limit: 50 });
    expect(listed.items.some((e) => e.id === drafted.id)).toBe(true);
  });

  it("a different org sees no estimates", async () => {
    const caller = appRouter.createCaller(ctxFor(orgBId, "owner"));
    const listed = await caller.v1.quoting.list({ limit: 50 });
    expect(listed.items).toHaveLength(0);
  });

  it("a tech is forbidden from the quoting API", async () => {
    const caller = appRouter.createCaller(ctxFor(orgAId, "tech"));
    await expect(
      caller.v1.quoting.draft({ leadId: leadAId, lines: [{ description: "x", quantity: 1, rateCents: 1 }] }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
});
