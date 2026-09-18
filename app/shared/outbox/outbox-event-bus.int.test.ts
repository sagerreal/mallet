import { describe, it, expect, beforeAll, afterAll } from "vitest";
import postgres from "postgres";
import type { Sql } from "postgres";
import { randomUUID } from "node:crypto";
import { asOrgId, asUserId, systemClock } from "@mallet/shared/types";
import { InMemoryEventBus, uuidGenerator } from "@mallet/shared/ports";
import { withTenant } from "@mallet/shared/db/tx";
import { closeDb } from "@mallet/shared/db/client";
import { outbox } from "@mallet/shared/db/schema";
import { OutboxEventBus } from "./outbox-event-bus";
import type { AuthProvider, Principal, Role } from "@mallet/identity";
import { appRouter } from "@/trpc/root";
import type { Context } from "@/trpc/init";

// Transactional-outbox write side against live RLS: a real mutation's event lands in the outbox
// (proving the orgTx rewire), the outbox is org-isolated, an emit rolls back with its tx, and an
// event stamped with a foreign org is rejected by RLS.
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

suite("transactional outbox (write side, live RLS)", () => {
  let admin: Sql;
  let orgAId = "";
  let orgBId = "";

  beforeAll(async () => {
    admin = postgres(process.env.DATABASE_URL as string, { max: 1, ssl: "require", prepare: false });
    const [a] = await admin<{ id: string }[]>`insert into orgs (name) values ('Outbox A ' || gen_random_uuid()) returning id`;
    const [b] = await admin<{ id: string }[]>`insert into orgs (name) values ('Outbox B ' || gen_random_uuid()) returning id`;
    orgAId = a!.id;
    orgBId = b!.id;
  });

  afterAll(async () => {
    if (orgAId) await admin`delete from orgs where id in (${orgAId}, ${orgBId})`;
    await admin.end({ timeout: 5 });
    await closeDb();
  });

  it("captures a mutation's domain event in the outbox atomically (orgTx rewire)", async () => {
    const caller = appRouter.createCaller(ctxFor(orgAId, "owner"));
    const created = await caller.v1.customers.create({ name: "Outbox Cust", source: "web" });

    const rows = await admin<{ event_name: string; payload: { leadId?: string }; published_at: string | null; occurred_at: string }[]>`
      select event_name, payload, published_at, occurred_at from outbox where org_id = ${orgAId} and event_name = 'customer.created'`;
    expect(rows).toHaveLength(1);
    expect(rows[0]!.published_at).toBeNull(); // unpublished — the relay hasn't run
    expect(rows[0]!.occurred_at).toBeTruthy();
    expect(rows[0]!.payload.leadId).toBe(created.id); // payload persisted as jsonb
  });

  it("is org-isolated by RLS: org B cannot see org A's outbox rows", async () => {
    // Ensure org A has at least one row.
    await appRouter.createCaller(ctxFor(orgAId, "owner")).v1.customers.create({ name: "Iso Cust", source: "web" });

    const seenByA = await withTenant(asOrgId(orgAId), (tx) => tx.select().from(outbox));
    const seenByB = await withTenant(asOrgId(orgBId), (tx) => tx.select().from(outbox));
    expect(seenByA.length).toBeGreaterThan(0);
    expect(seenByB).toHaveLength(0); // fail-closed cross-tenant
  });

  it("rolls the outbox write back with its transaction (no orphan event on failure)", async () => {
    const marker = `test.rollback.${randomUUID()}`;
    await expect(
      withTenant(asOrgId(orgAId), async (tx) => {
        await new OutboxEventBus(tx, asOrgId(orgAId)).emit({
          name: marker,
          orgId: asOrgId(orgAId),
          payload: { hello: "world" },
          occurredAt: new Date("2026-07-01T00:00:00Z"),
        });
        throw new Error("boom"); // abort the tx after emitting
      }),
    ).rejects.toThrow("boom");

    const rows = await admin<{ id: string }[]>`select id from outbox where event_name = ${marker}`;
    expect(rows).toHaveLength(0); // the emit rolled back with the tx
  });

  it("assigns a strictly increasing seq to events emitted in the same tx (recoverable order)", async () => {
    // now()/created_at is tx-constant, so seq is the only key that orders two same-tx emits.
    const tag = randomUUID();
    await withTenant(asOrgId(orgAId), async (tx) => {
      const bus = new OutboxEventBus(tx, asOrgId(orgAId));
      await bus.emit({ name: `test.first.${tag}`, orgId: asOrgId(orgAId), payload: { n: 1 }, occurredAt: new Date("2026-07-01T00:00:00Z") });
      await bus.emit({ name: `test.second.${tag}`, orgId: asOrgId(orgAId), payload: { n: 2 }, occurredAt: new Date("2026-07-01T00:00:00Z") });
    });
    const rows = await admin<{ event_name: string; seq: string }[]>`
      select event_name, seq from outbox where event_name like ${"test.%." + tag} order by seq asc`;
    expect(rows.map((r) => r.event_name)).toEqual([`test.first.${tag}`, `test.second.${tag}`]);
    expect(Number(rows[1]!.seq)).toBeGreaterThan(Number(rows[0]!.seq)); // strict order despite equal created_at
  });

  it("rejects an event stamped with a foreign org id (RLS WITH CHECK, fail-closed)", async () => {
    await expect(
      withTenant(asOrgId(orgAId), (tx) =>
        // orgId in the event is org B, but the tx is scoped to org A → RLS WITH CHECK rejects.
        new OutboxEventBus(tx, asOrgId(orgAId)).emit({
          name: "test.cross_tenant",
          orgId: asOrgId(orgBId),
          payload: {},
          occurredAt: new Date("2026-07-01T00:00:00Z"),
        }),
      ),
    ).rejects.toThrow();
  });
});
