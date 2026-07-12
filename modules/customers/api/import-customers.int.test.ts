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

// Capstone: exercise the WHOLE request stack via createCaller for the bulk-import procedure —
// auth gate, RBAC, the org-scoped transaction, the use-case, the Drizzle repo, and live RLS —
// without spinning up HTTP. Mirrors the setup in lead-router.int.test.ts.
const hasDb = Boolean(process.env.APP_DATABASE_URL && process.env.DATABASE_URL);
const suite = hasDb ? describe : describe.skip;

// authProvider is never invoked here: createCaller injects the Principal directly, bypassing
// token verification. A throwing stub makes accidental use loud.
const stubAuth: AuthProvider = {
  authenticate: async () => {
    throw new Error("authProvider should not be called in createCaller tests");
  },
};

const ctxFor = (orgId: string, role: Role): Context => ({
  principal: { userId: asUserId(randomUUID()), orgId: asOrgId(orgId), role } satisfies Principal,
  unmapped: null,
  tx: null,
  deps: { authProvider: stubAuth, bus: new InMemoryEventBus(), clock: systemClock, ids: uuidGenerator, paymentLinkGateway: null, photoStorageGateway: null, llmClient: null, apiKeyAuthenticator: { authenticate: async () => null }, tokenVerifier: { verify: async () => null }, signupStore: { createOrgForUser: async () => { throw new Error("unused in this test"); } } },
});

suite("v1.customers.importCustomers", () => {
  let admin: Sql;
  let orgId = "";

  beforeAll(async () => {
    admin = postgres(process.env.DATABASE_URL as string, { max: 1, ssl: "require", prepare: false });
    const [org] = await admin<{ id: string }[]>`
      insert into orgs (name) values ('ApiTest Import ' || gen_random_uuid()) returning id`;
    orgId = org!.id;
  });

  afterAll(async () => {
    if (orgId) await admin`delete from orgs where id = ${orgId}`;
    await admin.end({ timeout: 5 });
    await closeDb();
  });

  it("creates new customers, dedupes by phone, tolerates a bad email, and reports per-row errors", async () => {
    const caller = appRouter.createCaller(ctxFor(orgId, "owner"));

    const res = await caller.v1.customers.importCustomers({
      rows: [
        { name: "Gary Pratt", phone: "(925) 555-0100", email: "gary@x.com", source: "Import", address: "1 Pine Rd", notes: null },
        { name: "Gary Again", phone: "925.555.0100", email: null, source: "Import", address: null, notes: null }, // same phone → dedupe
        { name: "No Phone Person", phone: null, email: null, source: "Import", address: null, notes: null },
        // Malformed email: leniently dropped, row still created. Previously this would have thrown at
        // the batch-wide Zod boundary (z.string().email()), failing the entire request.
        { name: "Bad Email", phone: null, email: "not-an-email", source: "Import", address: null, notes: null },
        // Whitespace-only name: passes z.string().min(1) (raw length) but ensureCustomer trims → empty
        // → returns err. Increments failed + errors WITHOUT throwing / rolling back the tx.
        { name: "   ", phone: null, email: null, source: "Import", address: null, notes: null },
      ],
    });

    expect(res.created).toBe(3); // Gary Pratt + No Phone Person + Bad Email
    expect(res.deduped).toBe(1); // Gary Again (phone collision)
    expect(res.failed).toBe(1); // the whitespace-only name row
    expect(res.errors).toHaveLength(1);
    expect(res.errors[0]!.index).toBe(4); // points to the whitespace-only-name row
  });

  it("rejects a batch over the 500-row cap with BAD_REQUEST", async () => {
    const caller = appRouter.createCaller(ctxFor(orgId, "owner"));
    const rows = Array.from({ length: 501 }, (_, i) => ({
      name: `C${i}`, phone: null, email: null, source: null, address: null, notes: null,
    }));
    await expect(caller.v1.customers.importCustomers({ rows })).rejects.toMatchObject({
      code: "BAD_REQUEST",
    });
  });
});
